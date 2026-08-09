// AR Night Sky — Step 1 + Step 2 entry point.
//
// Step 1: SensorHub (DeviceOrientation + Geolocation) + SkyRenderer + heading-offset slider.
// Step 2: "Lock to sky" — phone-cam capture → astrometry.net plate-solve → camera-correction
// quaternion that maps device frame to true world frame. EKF code lives in src/ekf.ts and is
// unit-tested (used in a later iteration when DeviceMotion is wired for continuous drift correction).
// See _brain/tracks/webapp/step1-base.md and step2-platesolve.md.

import { SensorHub } from "./sensors";
import { SkyRenderer } from "./renderer";
import { CameraCapture } from "./camera";
import { PlateSolver } from "./platesolve";
import { OrientationEKF } from "./ekf";
import type { Quat } from "./quaternion";
import { loadStarCatalog } from "./catalog";
import { loadSatellites, satelliteSnapshotInfo } from "./satellites";
import { getSessionId, track, trackBoot } from "./telemetry";
import { AccuracyStats, readout } from "./accuracy";

const app = document.getElementById("app");
if (!app) throw new Error("No #app container found");

// Boot beacon — first thing in the log so we can grep "did the page even load?"
trackBoot();

// --- Layout ---------------------------------------------------------------
app.innerHTML = `
  <canvas id="sky"></canvas>
  <button id="hud-toggle" type="button" aria-label="Toggle HUD" title="Show/hide HUD">⌃</button>
  <div id="accuracy" class="acc acc-idle" role="status" aria-live="polite" title="Pointing accuracy (tap to hide)">
    <span class="acc-dot"></span>
    <span class="acc-body">
      <span class="acc-head">
        <span id="acc-label" class="acc-label">NO LOCK</span>
        <span id="acc-value" class="acc-value">—</span>
      </span>
      <span id="acc-detail" class="acc-detail">compass only — tap Lock to sky</span>
    </span>
  </div>
  <div id="hud">
    <div id="status" class="hud-card">
      <div class="hud-row"><span class="lbl">Location</span><span id="loc">—</span></div>
      <div class="hud-row"><span class="lbl">Heading</span><span id="hdg">—</span></div>
      <div class="hud-row"><span class="lbl">UTC</span><span id="utc">—</span></div>
      <div class="hud-row"><span class="lbl">Sun alt</span><span id="sun-alt">—</span></div>
      <div class="hud-row"><span class="lbl">Pointing</span><span id="pick">—</span></div>
    </div>
    <div id="controls" class="hud-card">
      <label>
        Heading offset
        <input id="offset" type="range" min="-180" max="180" step="0.5" value="0" />
        <span id="offset-val">0°</span>
      </label>
      <label>
        Bortle
        <input id="bortle" type="range" min="1" max="9" step="1" value="4" />
        <span id="bortle-val">4</span>
      </label>
      <label>
        Exposure
        <input id="exposure" type="range" min="0.2" max="3" step="0.05" value="1" />
        <span id="exposure-val">1.0×</span>
      </label>
      <label>
        Kp (aurora)
        <input id="kp" type="range" min="0" max="9" step="0.1" value="3" />
        <span id="kp-val">3.0</span>
      </label>
      <label>
        Realism (1 = eye, 0 = camera)
        <input id="realism" type="range" min="0" max="1" step="0.01" value="1" />
        <span id="realism-val">1.00</span>
      </label>
      <label class="preview-night-label">
        <input id="preview-night" type="checkbox" />
        <span>Preview night sky (override clock)</span>
      </label>
      <details class="stereo-details">
        <summary>Stereo (headmount)</summary>
        <div class="btn-row">
          <button id="vr-btn" type="button">Enter stereo</button>
          <button id="xr-btn" type="button">Try WebXR</button>
        </div>
        <label>
          IPD (mm)
          <input id="ipd" type="range" min="50" max="80" step="0.5" value="64" />
          <span id="ipd-val">64.0</span>
        </label>
        <label>
          Barrel k1
          <input id="k1" type="range" min="0" max="0.6" step="0.01" value="0.22" />
          <span id="k1-val">0.22</span>
        </label>
        <label>
          Barrel k2
          <input id="k2" type="range" min="0" max="0.3" step="0.005" value="0.05" />
          <span id="k2-val">0.05</span>
        </label>
        <label>
          Chromatic
          <input id="chroma" type="range" min="0" max="0.05" step="0.001" value="0.01" />
          <span id="chroma-val">0.010</span>
        </label>
      </details>
      <div class="btn-row">
        <button id="start-btn">Start (grant sensors)</button>
        <button id="manual-btn" type="button">Use manual location</button>
      </div>
      <div class="btn-row">
        <button id="lock-btn" type="button">Lock to sky (plate-solve)</button>
        <button id="unlock-btn" type="button" disabled>Clear lock</button>
      </div>
      <label class="auto-lock-label">
        <input id="auto-lock" type="checkbox" />
        <span>Auto re-lock when steady &amp; drifting</span>
      </label>
      <div class="hud-row"><span class="lbl">Lock</span><span id="lock-status">unlocked</span></div>
      <div class="hud-row"><span class="lbl">EKF</span><span id="ekf-status">idle</span></div>
    </div>
  </div>
  <div id="overlay" class="overlay">
    <div class="overlay-inner">
      <h1>Starlantern</h1>
      <p>Point your phone at the night sky and see it as it would look under perfect dark conditions — every star, the Milky Way, planets, ISS, even meteors. Locked to reality via phone-camera plate-solving.</p>
      <button id="overlay-start" class="big-btn">Start</button>
      <p class="tiny">Use outdoors away from metal for accurate heading. iOS will ask for motion access; allow it.</p>
      <p class="tiny support-line">Free + AGPL-licensed. <a href="https://ko-fi.com/lev1307" target="_blank" rel="noopener">Support development</a> if you like it.</p>
    </div>
  </div>
`;

// Lightweight CSS injected here keeps Step 1 single-file-friendly.
const style = document.createElement("style");
style.textContent = `
  #sky { position: fixed; inset: 0; }
  #hud {
    position: fixed; inset: 0; pointer-events: none;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 1rem; gap: 0.5rem; font: 13px/1.4 system-ui, sans-serif;
  }
  .hud-card {
    pointer-events: auto;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
    padding: 0.65rem 0.85rem; color: #ddd;
    max-width: 320px;
  }
  #hud-toggle {
    position: fixed; top: 0.6rem; right: 0.6rem; z-index: 5;
    width: 2.2rem; height: 2.2rem; padding: 0; flex: none;
    border-radius: 50%; font-size: 1.1rem; line-height: 1;
    background: rgba(0,0,0,0.55); color: #ddd;
    border: 1px solid rgba(255,255,255,0.15); backdrop-filter: blur(6px);
    cursor: pointer; user-select: none;
  }
  #hud-toggle.hud-collapsed { opacity: 0.35; }
  #hud.hud-hidden .hud-card { display: none; }
  .hud-row { display: flex; justify-content: space-between; gap: 1rem; }
  .lbl { opacity: 0.5; }
  #controls label { display: block; }
  #controls input[type=range] { width: 100%; }
  .btn-row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
  button {
    flex: 1; background: rgba(255,255,255,0.08); color: #eee;
    border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
    padding: 0.45rem 0.6rem; font: inherit; cursor: pointer;
  }
  button:hover { background: rgba(255,255,255,0.14); }
  .auto-lock-label, .preview-night-label {
    display: flex !important; align-items: center; gap: 0.5rem;
    margin-top: 0.5rem; cursor: pointer; user-select: none;
    font-size: 12px; opacity: 0.8;
  }
  .auto-lock-label input, .preview-night-label input { width: auto; margin: 0; }
  .stereo-details { margin-top: 0.5rem; }
  .stereo-details summary { cursor: pointer; opacity: 0.7; font-weight: 500; }
  .stereo-details[open] summary { opacity: 1; }
  .stereo-details label { margin-top: 0.35rem; }
  /* Pointing-accuracy badge. Deliberately outside #hud so collapsing the debug
     HUD leaves a clean sky with only this — the shot worth recording. */
  .acc {
    position: fixed; top: 0.6rem; left: 50%; transform: translateX(-50%);
    z-index: 6; pointer-events: auto; cursor: pointer; user-select: none;
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    /* Fixed floor so the badge doesn't resize as it changes state — it is
       centre-anchored, and a width jump reads as a glitch on video. */
    min-width: 12.5rem; box-sizing: border-box;
    padding: 0.4rem 0.7rem 0.4rem 0.6rem;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(6px);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 999px;
    font: 12px/1.25 system-ui, sans-serif; color: #ddd;
    transition: opacity 0.2s ease;
  }
  .acc.acc-hidden { opacity: 0; pointer-events: none; }
  .acc-dot {
    width: 0.5rem; height: 0.5rem; flex: none; border-radius: 50%;
    background: #888; box-shadow: 0 0 6px currentColor; color: #888;
  }
  .acc-body { display: flex; flex-direction: column; gap: 0.1rem; }
  .acc-head { display: flex; align-items: baseline; gap: 0.45rem; }
  .acc-label { font-weight: 600; letter-spacing: 0.08em; font-size: 11px; }
  .acc-value {
    font: 600 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  .acc-detail { opacity: 0.55; font-size: 10px; white-space: nowrap; }
  .acc-locked   .acc-dot { background: #5fe08a; color: #5fe08a; }
  .acc-locked   .acc-label, .acc-locked   .acc-value { color: #5fe08a; }
  .acc-drifting .acc-dot { background: #f0b429; color: #f0b429; }
  .acc-drifting .acc-label, .acc-drifting .acc-value { color: #f0b429; }
  .acc-lost     .acc-dot { background: #f2665e; color: #f2665e; }
  .acc-lost     .acc-label, .acc-lost     .acc-value { color: #f2665e; }
  .acc-solving  .acc-dot { background: #88aaff; color: #88aaff; animation: acc-pulse 1s ease-in-out infinite; }
  .acc-solving  .acc-label { color: #88aaff; }
  @keyframes acc-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { .acc-solving .acc-dot { animation: none; } }
  /* On a phone the centred badge and the top-left status card fight for the
     same strip. Reserve the strip for the badge; wide screens have room for
     both side by side and need no offset. */
  @media (max-width: 720px) { #status { margin-top: 2.75rem; } }
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.85);
    display: flex; align-items: center; justify-content: center;
    z-index: 10;
  }
  .overlay-inner { text-align: center; max-width: 32ch; padding: 1.5rem; }
  .overlay h1 { font-weight: 200; letter-spacing: 0.15em; }
  .big-btn {
    margin: 1rem auto; padding: 0.8rem 1.6rem; font-size: 1rem;
    background: #88aaff; color: #000; border: none; border-radius: 8px;
  }
  .tiny { opacity: 0.4; font-size: 0.8rem; }
  .support-line { margin-top: 0.4rem; opacity: 0.55; }
  .support-line a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .support-line a:hover { opacity: 0.9; }
`;
document.head.appendChild(style);

// --- Wiring ---------------------------------------------------------------
const canvas = document.getElementById("sky") as HTMLCanvasElement;
const renderer = new SkyRenderer(canvas);

const sensors = new SensorHub();

const $loc = document.getElementById("loc")!;
const $hdg = document.getElementById("hdg")!;
const $utc = document.getElementById("utc")!;
const $sunAlt = document.getElementById("sun-alt")!;
const $pick = document.getElementById("pick")!;
const $offset = document.getElementById("offset") as HTMLInputElement;
const $offsetVal = document.getElementById("offset-val")!;
const $start = document.getElementById("start-btn") as HTMLButtonElement;
const $manual = document.getElementById("manual-btn") as HTMLButtonElement;
const $overlay = document.getElementById("overlay")!;
const $overlayStart = document.getElementById(
  "overlay-start",
) as HTMLButtonElement;
const $lock = document.getElementById("lock-btn") as HTMLButtonElement;
const $unlock = document.getElementById("unlock-btn") as HTMLButtonElement;
const $lockStatus = document.getElementById("lock-status")!;
const $ekfStatus = document.getElementById("ekf-status")!;
const $autoLock = document.getElementById("auto-lock") as HTMLInputElement;
const $acc = document.getElementById("accuracy")!;
const $accLabel = document.getElementById("acc-label")!;
const $accValue = document.getElementById("acc-value")!;
const $accDetail = document.getElementById("acc-detail")!;
// Tap the badge to hide it — for recording a completely unadorned sky.
$acc.addEventListener("click", () => {
  const hidden = $acc.classList.toggle("acc-hidden");
  track("accuracy_badge.toggle", { hidden });
});
const $hud = document.getElementById("hud")!;
const $hudToggle = document.getElementById("hud-toggle") as HTMLButtonElement;
$hudToggle.addEventListener("click", () => {
  const hidden = $hud.classList.toggle("hud-hidden");
  $hudToggle.classList.toggle("hud-collapsed", hidden);
  $hudToggle.textContent = hidden ? "⌄" : "⌃";
  track("hud.toggle", { hidden });
});

const camera = new CameraCapture();
const solver = new PlateSolver();
let lockTimeMs: number | null = null;

// --- Multiplicative EKF -------------------------------------------------
// Predict: every DeviceMotion sample (rotationRate as body-frame ω).
// Update:  every DeviceOrientation reading at σ ≈ 5° (compass noisy), and
//          every plate-solve success at σ ≈ 5e-5 rad (~10 arcsec, astrometry).
// When ekfActive, the renderer's camera quaternion is overwritten with the
// EKF's posterior every frame — replacing the static-correction lock.
const ekf = new OrientationEKF();
let ekfActive = false;
let ekfHasAbsolute = false;

// Accuracy bookkeeping: time-to-first-lock, measured drift between solves,
// solve success rate. These are the numbers the launch post quotes, so they are
// collected from real runs rather than asserted.
const accStats = new AccuracyStats();
let lastMotionTMs: number | null = null;

$offset.addEventListener("input", () => {
  renderer.state.headingOffsetDeg = parseFloat($offset.value);
  $offsetVal.textContent = `${renderer.state.headingOffsetDeg.toFixed(1)}°`;
  track("slider.offset", { value: renderer.state.headingOffsetDeg });
});

const $bortle = document.getElementById("bortle") as HTMLInputElement;
const $bortleVal = document.getElementById("bortle-val")!;
const $exposure = document.getElementById("exposure") as HTMLInputElement;
const $exposureVal = document.getElementById("exposure-val")!;
const $kp = document.getElementById("kp") as HTMLInputElement;
const $kpVal = document.getElementById("kp-val")!;
const $realism = document.getElementById("realism") as HTMLInputElement;
const $realismVal = document.getElementById("realism-val")!;
const $previewNight = document.getElementById(
  "preview-night",
) as HTMLInputElement;

// Optional clock override for daytime testing. When set, all setSky() calls
// use this instead of the real wall clock so the renderer paints the sky as
// it would look at the chosen instant — lets the user verify Bortle, Milky
// Way, twilight, etc., while the actual sun is up outside.
let previewClockMs: number | null = null;
function nowDate(): Date {
  return previewClockMs == null ? new Date() : new Date(previewClockMs);
}

function refreshSky(): void {
  const fix = sensors.getLocation();
  if (fix)
    renderer.setSky({ latDeg: fix.latDeg, lonDeg: fix.lonDeg }, nowDate());
}

// Kick off the full HYG (~8920 stars, mag ≤ 6.5) catalog load. Until the
// fetch resolves, the renderer keeps using the embedded BRIGHT_STARS fallback,
// so something is always painted from the very first frame.
void (async () => {
  try {
    const full = await loadStarCatalog();
    renderer.setCatalog(full);
    refreshSky();
    console.info(`[ar-night-sky] loaded ${full.length}-star catalog`);
  } catch (err) {
    console.warn(
      "[ar-night-sky] full catalog failed, using bright fallback",
      err,
    );
  }
})();

// Load the satellite TLE snapshot in parallel. The renderer asks for visible
// satellites every frame; until this resolves, the query returns [].
void (async () => {
  try {
    await loadSatellites();
    const info = satelliteSnapshotInfo();
    console.info(
      `[ar-night-sky] satellite TLEs loaded — ${info?.count ?? 0} tracked (snapshot ${info?.fetchedAt ?? "?"})`,
    );
  } catch (err) {
    console.warn("[ar-night-sky] satellite TLE load failed", err);
  }
})();

$bortle.addEventListener("input", () => {
  renderer.state.bortle = parseFloat($bortle.value);
  $bortleVal.textContent = `${renderer.state.bortle.toFixed(0)}`;
  refreshSky();
  track("slider.bortle", { value: renderer.state.bortle });
});

$exposure.addEventListener("input", () => {
  renderer.state.exposure = parseFloat($exposure.value);
  $exposureVal.textContent = `${renderer.state.exposure.toFixed(2)}×`;
  refreshSky();
  track("slider.exposure", { value: renderer.state.exposure });
});

$kp.addEventListener("input", () => {
  renderer.state.kp = parseFloat($kp.value);
  $kpVal.textContent = renderer.state.kp.toFixed(1);
  refreshSky();
  track("slider.kp", { value: renderer.state.kp, source: "user" });
});

$realism.addEventListener("input", () => {
  renderer.state.realism = parseFloat($realism.value);
  $realismVal.textContent = renderer.state.realism.toFixed(2);
  refreshSky();
  track("slider.realism", { value: renderer.state.realism });
});

// "Preview night sky" — for daytime testing of Bortle / Milky Way / DSOs. When
// checked, we freeze the renderer's clock at the next astronomical midnight
// (UTC) at the observer's longitude — sun ~12° below horizon, full darkness.
$previewNight.addEventListener("change", () => {
  if (!$previewNight.checked) {
    previewClockMs = null;
    track("preview_night.off");
  } else {
    const fix = sensors.getLocation();
    const lonDeg = fix?.lonDeg ?? 0;
    // Local apparent midnight: rotate UTC so the sun is anti-meridian.
    const utcHourAtLocalMidnight = (24 - lonDeg / 15) % 24;
    const d = new Date();
    d.setUTCHours(Math.floor(utcHourAtLocalMidnight), 0, 0, 0);
    // If that midnight is in the past for today, that's fine — sky math only
    // cares about the absolute instant, and the renderer renders it.
    previewClockMs = d.getTime();
    track("preview_night.on", { iso: d.toISOString() });
  }
  refreshSky();
});

// Pull the live Kp from NOAA SWPC via /api/kp on load (and every 10 min while
// the page stays open). Falls back silently to the slider default on failure.
async function refreshLiveKp(): Promise<void> {
  try {
    const r = await fetch("/api/kp");
    if (!r.ok) {
      track("kp.fetch_failed", { status: r.status });
      return;
    }
    const data = (await r.json()) as { kp?: number };
    if (typeof data.kp !== "number" || !Number.isFinite(data.kp)) {
      track("kp.fetch_bad_data", { data });
      return;
    }
    renderer.state.kp = Math.max(0, Math.min(9, data.kp));
    $kp.value = renderer.state.kp.toString();
    $kpVal.textContent = `${renderer.state.kp.toFixed(1)} (live)`;
    refreshSky();
    track("kp.live", { value: renderer.state.kp });
  } catch (err) {
    track("kp.fetch_exception", {
      message: err instanceof Error ? err.message : String(err),
    });
    // Network errors are fine — slider default (Kp=3) still works.
  }
}
refreshLiveKp();
setInterval(refreshLiveKp, 10 * 60 * 1000);

// --- Stereo / headmount calibration --------------------------------------
const $vr = document.getElementById("vr-btn") as HTMLButtonElement;
const $xr = document.getElementById("xr-btn") as HTMLButtonElement;
const $ipd = document.getElementById("ipd") as HTMLInputElement;
const $ipdVal = document.getElementById("ipd-val")!;
const $k1 = document.getElementById("k1") as HTMLInputElement;
const $k1Val = document.getElementById("k1-val")!;
const $k2 = document.getElementById("k2") as HTMLInputElement;
const $k2Val = document.getElementById("k2-val")!;
const $chroma = document.getElementById("chroma") as HTMLInputElement;
const $chromaVal = document.getElementById("chroma-val")!;

$vr.addEventListener("click", () => {
  const s = renderer.state.stereo;
  s.enabled = !s.enabled;
  $vr.textContent = s.enabled ? "Exit stereo" : "Enter stereo";
  track("stereo.toggle", { enabled: s.enabled });
  // Side-by-side stereo on phones really wants landscape + fullscreen. Best-effort.
  if (s.enabled && document.fullscreenEnabled && !document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }
});

$xr.addEventListener("click", async () => {
  $xr.disabled = true;
  const prev = $xr.textContent;
  $xr.textContent = "trying…";
  track("webxr.attempt");
  try {
    const ok = await renderer.tryEnterImmersiveVr();
    track("webxr.result", { ok });
    $xr.textContent = ok ? "WebXR active" : "no WebXR";
  } catch (err) {
    track("webxr.error", {
      message: err instanceof Error ? err.message : String(err),
    });
    $xr.textContent = "no WebXR";
  } finally {
    setTimeout(() => {
      $xr.textContent = prev ?? "Try WebXR";
      $xr.disabled = false;
    }, 1500);
  }
});

$ipd.addEventListener("input", () => {
  renderer.state.stereo.ipdM = parseFloat($ipd.value) / 1000;
  $ipdVal.textContent = parseFloat($ipd.value).toFixed(1);
  track("slider.ipd", { value_mm: parseFloat($ipd.value) });
});
$k1.addEventListener("input", () => {
  renderer.state.stereo.k1 = parseFloat($k1.value);
  $k1Val.textContent = renderer.state.stereo.k1.toFixed(2);
  track("slider.k1", { value: renderer.state.stereo.k1 });
});
$k2.addEventListener("input", () => {
  renderer.state.stereo.k2 = parseFloat($k2.value);
  $k2Val.textContent = renderer.state.stereo.k2.toFixed(3);
  track("slider.k2", { value: renderer.state.stereo.k2 });
});
$chroma.addEventListener("input", () => {
  renderer.state.stereo.chromatic = parseFloat($chroma.value);
  $chromaVal.textContent = renderer.state.stereo.chromatic.toFixed(3);
  track("slider.chroma", { value: renderer.state.stereo.chromatic });
});

let latestOrientation: { a: number; b: number; g: number } | null = null;

sensors.onOrientation((o) => {
  latestOrientation = { a: o.alphaDeg, b: o.betaDeg, g: o.gammaDeg };
  // After renderer.setOrientation() runs in the tick loop it stores a body→world
  // quaternion at renderer.getDeviceQuaternion(). The MEKF accepts it as a noisy
  // absolute measurement with σ ≈ 5° (compass + tilt drift).
  if (ekfActive) {
    const qDev = renderer.getDeviceQuaternion();
    // Skip the very first identity reading before setOrientation has executed.
    if (qDev[0] !== 1 || qDev[1] !== 0 || qDev[2] !== 0 || qDev[3] !== 0) {
      ekf.update(qDev, 0.087); // 5° in rad
      ekfHasAbsolute = true;
    }
  }
});

sensors.onRotationRate((r) => {
  if (!ekfActive) return;
  const dt = lastMotionTMs == null ? 0 : (r.tMs - lastMotionTMs) / 1000;
  lastMotionTMs = r.tMs;
  if (dt <= 0 || dt > 0.5) return; // skip absurd gaps
  // DeviceMotionEventRotationRate fields (deg/s, body frame):
  //   alpha = rotation around Z (screen-perpendicular)
  //   beta  = rotation around X (top-to-bottom)
  //   gamma = rotation around Y (left-to-right)
  // NOTE: this is raw device-body frame. The EKF's body is the camera-axis
  // frame (post tilt+mirror), so there's a known frame mismatch here that
  // surfaces if the EKF drives the camera pre-plate-solve. Today the EKF
  // is only allowed to drive the camera AFTER a plate-solve lock, which
  // pulls the state back to ground-truth often enough to mask the drift.
  // Fixing the mismatch properly is a dedicated refactor (separate task).
  const DEG = Math.PI / 180;
  const omega: [number, number, number] = [
    r.betaDps * DEG,
    r.gammaDps * DEG,
    r.alphaDps * DEG,
  ];
  ekf.predict(omega, dt);
});

async function start(): Promise<void> {
  track("start.invoked", {
    requires_ios_permission: sensors.requiresOrientationPermission,
  });
  $overlay.style.display = "none";

  // Orientation permission (iOS prompts; everyone else auto-grants).
  const orientResult = await sensors.requestOrientationPermission();
  track("permission.orientation", { result: orientResult });
  if (orientResult !== "granted") {
    alert("Motion sensor access denied. Use mouse drag on desktop.");
  }

  // DeviceMotion: provides angular velocity (rotationRate). Used by the EKF
  // predict step for continuous drift correction between plate-solves.
  const motionResult = await sensors.requestMotionPermission();
  track("permission.motion", { result: motionResult });
  if (motionResult === "granted") {
    ekfActive = true;
    $ekfStatus.textContent = "active (predict-only until first absolute fix)";
  } else {
    $ekfStatus.textContent = "no motion sensor (static-correction lock only)";
  }

  // Best-effort location fix. Falls back to a sensible default if denied.
  try {
    const fix = await sensors.requestLocation();
    track("permission.geolocation", {
      result: "granted",
      lat: fix.latDeg,
      lon: fix.lonDeg,
      accuracy_m: fix.accuracyM,
      alt_m: fix.altM,
    });
    renderer.setSky({ latDeg: fix.latDeg, lonDeg: fix.lonDeg }, nowDate());
  } catch (err) {
    track("permission.geolocation", {
      result: "denied_or_failed",
      message: err instanceof Error ? err.message : String(err),
      fallback: "Munich (TUM)",
    });
    // Default: Munich (TUM, where the founder is). Manual override available.
    sensors.setManualLocation(48.1486, 11.5675, 520);
    renderer.setSky({ latDeg: 48.1486, lonDeg: 11.5675 }, nowDate());
  }

  // Desktop fallback for testing without a phone.
  renderer.enableMouseLook();

  // Update star altaz periodically — sidereal sky drifts ~15°/h.
  setInterval(() => {
    const fix = sensors.getLocation();
    if (fix)
      renderer.setSky({ latDeg: fix.latDeg, lonDeg: fix.lonDeg }, nowDate());
  }, 30_000);
}

$start.addEventListener("click", () => void start());
$overlayStart.addEventListener("click", () => void start());

// --- Lock state & doLock() refactor ---------------------------------------
// Shared between the manual "Lock to sky" button and the auto re-lock
// interval. lockInFlight prevents overlapping attempts. lastLockEndedAtMs is
// used by the auto path to enforce a minimum cooldown between solves.
let lockInFlight = false;
let lastLockEndedAtMs = 0;

type LockSource = "manual" | "auto";

/**
 * Pick how many frames to stack based on the rotation rate observed during
 * the stillness gate. Steady-as-a-rock → deeper stack for better SNR.
 * Quivering hand → fewer frames to minimize misregistration.
 *
 *   < 0.15 °/s  → 16 frames  (SNR boost ~4×, capture ~500 ms)
 *   < 0.30 °/s  →  8 frames  (SNR boost ~2.8×, capture ~250 ms)
 *   else        →  4 frames  (SNR boost ~2×,  capture ~125 ms)
 */
function pickFrameCount(rateDps: number | null): number {
  if (rateDps == null) return 8; // no gyro / desktop → default
  if (rateDps < 0.15) return 16;
  if (rateDps < 0.3) return 8;
  return 4;
}

async function doLock(source: LockSource): Promise<void> {
  if (lockInFlight) {
    track("platesolve.aborted", { reason: "already_in_flight", source });
    return;
  }
  const fix = sensors.getLocation();
  if (!fix) {
    track("platesolve.aborted", { reason: "no_location", source });
    if (source === "manual") {
      alert("Need a location fix first — grant GPS or use manual location.");
    }
    return;
  }
  lockInFlight = true;
  accStats.noteAttempt(Date.now());
  $lock.disabled = true;
  const prevLabel = $lock.textContent;
  const tStart = performance.now();
  const prefix = source === "auto" ? "[auto] " : "";
  track("platesolve.start", {
    source,
    lat: fix.latDeg,
    lon: fix.lonDeg,
  });
  try {
    $lockStatus.textContent = `${prefix}opening camera…`;
    track("platesolve.camera_open_begin", { source });
    await camera.open();
    track("platesolve.camera_open_done", {
      source,
      ms: Math.round(performance.now() - tStart),
    });

    // -- Stillness gate -------------------------------------------------
    const STILL_DPS = 0.5;
    const STILL_MS = 600;
    const STILL_TIMEOUT_MS = 8000;
    $lockStatus.textContent = `${prefix}hold still…`;
    track("platesolve.still_wait_begin", {
      source,
      threshold_dps: STILL_DPS,
      required_ms: STILL_MS,
    });
    const tStill0 = performance.now();
    let stillSince: number | null = null;
    let stillResult: "stable" | "timeout" | "no_gyro" = "stable";
    let lastRateDps: number | null = null;
    let minRateDuringHold = Infinity;
    let firstGyroAt: number | null = null;
    let lastStatusMs = 0;
    while (true) {
      const r = sensors.getRotationRate();
      const now = performance.now();
      if (r) {
        if (firstGyroAt == null) firstGyroAt = now;
        const rateDps = Math.hypot(r.alphaDps, r.betaDps, r.gammaDps);
        lastRateDps = rateDps;
        if (rateDps < STILL_DPS) {
          if (stillSince == null) {
            stillSince = now;
            minRateDuringHold = rateDps;
          } else {
            if (rateDps < minRateDuringHold) minRateDuringHold = rateDps;
          }
          if (now - stillSince >= STILL_MS) break;
        } else {
          stillSince = null;
          minRateDuringHold = Infinity;
        }
        // Throttle the HUD update to ~4 Hz so it stays readable on the phone.
        if (now - lastStatusMs > 250) {
          lastStatusMs = now;
          const heldFor = stillSince ? Math.round(now - stillSince) : 0;
          $lockStatus.textContent = `${prefix}hold still… ${heldFor}/${STILL_MS} ms (rate ${rateDps.toFixed(2)}°/s)`;
        }
      } else if (firstGyroAt == null && now - tStill0 > 1500) {
        stillResult = "no_gyro";
        break;
      }
      if (now - tStill0 > STILL_TIMEOUT_MS) {
        stillResult = "timeout";
        break;
      }
      await new Promise((res) => setTimeout(res, 50));
    }
    track("platesolve.still_wait_done", {
      source,
      result: stillResult,
      wait_ms: Math.round(performance.now() - tStill0),
      last_rate_dps: lastRateDps,
      min_rate_during_hold_dps: Number.isFinite(minRateDuringHold)
        ? minRateDuringHold
        : null,
    });
    if (stillResult === "timeout") {
      if (source === "auto") {
        // Don't bother capturing if auto-relock can't even get a still window.
        track("platesolve.aborted", { source, reason: "still_timeout" });
        $lockStatus.textContent = "auto re-lock: couldn't find a still moment";
        return;
      }
      $lockStatus.textContent = `${prefix}still-wait timed out — capturing anyway (may blur)`;
    }

    // Adaptive frame count from the minimum rate observed during the hold.
    // If we skipped the gate (no_gyro), fall back to default 8.
    const frames =
      stillResult === "stable"
        ? pickFrameCount(minRateDuringHold)
        : pickFrameCount(null);

    // -- Capture with motion monitoring ---------------------------------
    let captureRotPeak = 0;
    let captureRotSum = 0;
    let captureRotN = 0;
    const unsubscribeRot = sensors.onRotationRate((r) => {
      const mag = Math.hypot(r.alphaDps, r.betaDps, r.gammaDps);
      if (mag > captureRotPeak) captureRotPeak = mag;
      captureRotSum += mag;
      captureRotN += 1;
    });

    $lockStatus.textContent = `${prefix}capturing (stacking ${frames} frames)…`;
    track("platesolve.capture_begin", { source, frames });
    const tCap = performance.now();
    const capture = await camera.grabStacked(frames);
    unsubscribeRot();
    const captureRotMean = captureRotN > 0 ? captureRotSum / captureRotN : 0;
    track("platesolve.capture_done", {
      source,
      frames,
      ms: Math.round(performance.now() - tCap),
      bytes: capture.blob.size,
      utc_ms: capture.utcMs,
      rot_peak_dps: Math.round(captureRotPeak * 100) / 100,
      rot_mean_dps: Math.round(captureRotMean * 100) / 100,
      rot_samples: captureRotN,
      sharpness: Math.round(capture.sharpness * 100) / 100,
    });

    // Hard abort if peak motion exceeded the streak-threshold.
    const HARD_ABORT_DPS = 2.0;
    if (captureRotPeak > HARD_ABORT_DPS) {
      track("platesolve.aborted", {
        source,
        reason: "motion_during_capture",
        peak_dps: captureRotPeak,
        mean_dps: captureRotMean,
      });
      $lockStatus.textContent = `moved too much during capture (peak ${captureRotPeak.toFixed(1)}°/s) — try again`;
      return;
    }

    // Sharpness pre-check. Threshold deliberately low — the goal is to catch
    // obviously broken frames (lens cap on, total darkness, severe blur) and
    // avoid burning a 20 s solve cycle. We tune this from real data over
    // time. Manual captures get one more retry hint; auto silently aborts.
    const SHARPNESS_HARD_MIN = 3;
    if (capture.sharpness < SHARPNESS_HARD_MIN) {
      track("platesolve.aborted", {
        source,
        reason: "sharpness_too_low",
        sharpness: capture.sharpness,
        threshold: SHARPNESS_HARD_MIN,
      });
      $lockStatus.textContent =
        source === "manual"
          ? `image too dark/blurry (sharpness ${capture.sharpness.toFixed(1)}) — point at brighter sky or open lens`
          : "auto re-lock: image too dark to solve";
      return;
    }

    const qDevice = renderer.getDeviceQuaternion();

    $lockStatus.textContent = `${prefix}uploading…`;
    const tSolve = performance.now();
    const result = await solver.solve(
      capture.blob,
      { latDeg: fix.latDeg, lonDeg: fix.lonDeg },
      capture.utcMs,
      (s) => {
        $lockStatus.textContent = `${prefix}${s}…`;
        track("platesolve.progress", {
          source,
          state: s,
          ms: Math.round(performance.now() - tSolve),
        });
      },
    );

    renderer.applyLock(result.qCameraWorld, qDevice);
    lockTimeMs = Date.now();
    track("platesolve.success", {
      source,
      total_ms: Math.round(performance.now() - tStart),
      solve_ms: Math.round(performance.now() - tSolve),
      frames_used: frames,
      sharpness: Math.round(capture.sharpness * 100) / 100,
      ra: result.calibration.ra,
      dec: result.calibration.dec,
      radius: result.calibration.radius,
      pixscale: result.calibration.pixscale,
      orientation: result.calibration.orientation,
      parity: result.calibration.parity,
      fov_deg: result.fovDeg,
    });
    $lockStatus.textContent = `${prefix}LOCKED — RA ${result.calibration.ra.toFixed(2)}°, Dec ${result.calibration.dec.toFixed(2)}°`;
    $unlock.disabled = false;
    let innovationRad: number | null = null;
    if (ekfActive) {
      // The correction this fix applies is how far the filter had drifted since
      // the previous one — captured before the update collapses it.
      ({ innovationRad } = ekf.update(result.qCameraWorld, 5e-5));
      ekfHasAbsolute = true;
      renderer.cameraSource = "ekf";
      $ekfStatus.textContent = "locked (plate-solve fix injected)";
      track("ekf.fix_injected", {
        source,
        sigma_rad: 5e-5,
        innovation_deg:
          Math.round(innovationRad * (180 / Math.PI) * 1000) / 1000,
      });
    }
    accStats.noteSuccess(Date.now(), innovationRad);
    track("accuracy.stats", accStats.summary());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    track("platesolve.failure", {
      source,
      message: msg,
      stack: err instanceof Error ? (err.stack ?? null) : null,
      total_ms: Math.round(performance.now() - tStart),
    });
    // Server-side ASTROMETRY_API_KEY missing → friendly message instead of raw 500.
    if (/api[_ ]?key|ASTROMETRY|not configured|500|502/i.test(msg)) {
      $lockStatus.textContent =
        "plate-solve unavailable — astrometry.net API key not configured on the server (see docs/api-setup.md)";
    } else {
      $lockStatus.textContent = `failed: ${msg}`;
    }
    console.error("Plate-solve failed", err);
  } finally {
    lockInFlight = false;
    lastLockEndedAtMs = Date.now();
    $lock.disabled = false;
    $lock.textContent = prevLabel ?? "Lock to sky (plate-solve)";
  }
}

$lock.addEventListener("click", () => {
  void doLock("manual");
});

// --- Auto re-lock loop ----------------------------------------------------
// When the toggle is on AND we already have an initial plate-solved lock AND
// the EKF says it's drifting (yaw σ > AUTO_SIGMA_THRESHOLD_DEG) AND the phone
// is reasonably steady right now AND we haven't fired recently → quietly
// fire another solve in the background.
const AUTO_SIGMA_THRESHOLD_DEG = 0.1;
const AUTO_CURRENT_RATE_DPS = 0.5;
const AUTO_MIN_INTERVAL_MS = 15_000;
const AUTO_CHECK_INTERVAL_MS = 2_000;
$autoLock.addEventListener("change", () => {
  track("auto_relock.toggle", { enabled: $autoLock.checked });
});
setInterval(() => {
  if (!$autoLock.checked) return;
  if (!ekfHasAbsolute) return; // need an initial lock to bootstrap
  if (lockInFlight) return;
  if (Date.now() - lastLockEndedAtMs < AUTO_MIN_INTERVAL_MS) return;
  const sigmaDeg = ekf.yawSigmaRad() * (180 / Math.PI);
  if (sigmaDeg < AUTO_SIGMA_THRESHOLD_DEG) return;
  const r = sensors.getRotationRate();
  if (!r) return;
  const rateDps = Math.hypot(r.alphaDps, r.betaDps, r.gammaDps);
  if (rateDps > AUTO_CURRENT_RATE_DPS) return;
  track("auto_relock.trigger", {
    sigma_deg: Math.round(sigmaDeg * 1000) / 1000,
    current_rate_dps: Math.round(rateDps * 100) / 100,
    secs_since_last_lock: Math.round((Date.now() - lastLockEndedAtMs) / 1000),
  });
  void doLock("auto");
}, AUTO_CHECK_INTERVAL_MS);

$unlock.addEventListener("click", () => {
  renderer.clearLock();
  renderer.cameraSource = "sensor";
  ekfHasAbsolute = false;
  camera.close();
  lockTimeMs = null;
  $lockStatus.textContent = "unlocked";
  $ekfStatus.textContent = ekfActive ? "predict-only" : "idle";
  $unlock.disabled = true;
  track("platesolve.unlock");
});

$manual.addEventListener("click", () => {
  const raw = prompt(
    'Manual location as "lat,lon" (e.g. 48.1486,11.5675 for Munich)',
  );
  if (!raw) {
    track("manual_location.cancelled");
    return;
  }
  const parts = raw.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    track("manual_location.bad_format", { raw });
    alert("Bad format. Expected: lat,lon");
    return;
  }
  sensors.setManualLocation(parts[0]!, parts[1]!, 0);
  renderer.setSky({ latDeg: parts[0]!, lonDeg: parts[1]! }, nowDate());
  track("manual_location.set", { lat: parts[0], lon: parts[1] });
});

// ----- Periodic field-test telemetry --------------------------------------
// Every 2 seconds, ship a snapshot of the current sensor/EKF/render state and
// a frame-rate sample. This is the heartbeat that lets a remote observer
// confirm the app is alive, see what the phone is doing, and catch slow
// degradations that don't surface as a hard error.
let _frames = 0;
let _lastFpsSample = performance.now();
const _origRAF = requestAnimationFrame;
window.requestAnimationFrame = function (cb: FrameRequestCallback): number {
  return _origRAF((t) => {
    _frames++;
    cb(t);
  });
};
setInterval(() => {
  const now = performance.now();
  const fps = (_frames * 1000) / (now - _lastFpsSample);
  _frames = 0;
  _lastFpsSample = now;
  const loc = sensors.getLocation();
  const ori = sensors.getOrientation();
  const rot = sensors.getRotationRate();
  track("sample", {
    fps: Number.isFinite(fps) ? Math.round(fps * 10) / 10 : null,
    locked: renderer.locked,
    camera_source: renderer.cameraSource,
    ekf_active: ekfActive,
    ekf_yaw_sigma_deg: ekfHasAbsolute
      ? Math.round(ekf.yawSigmaRad() * (180 / Math.PI) * 100) / 100
      : null,
    ekf_attitude_sigma_arcmin: ekfHasAbsolute
      ? Math.round(ekf.attitudeSigmaRad() * (180 / Math.PI) * 60 * 10) / 10
      : null,
    measured_drift_deg_per_min: accStats.lastDriftDegPerMin(),
    solve_count: accStats.solveCount,
    loc_lat: loc?.latDeg ?? null,
    loc_lon: loc?.lonDeg ?? null,
    loc_acc_m: loc?.accuracyM ?? null,
    ori_alpha: ori?.alphaDeg ?? null,
    ori_beta: ori?.betaDeg ?? null,
    ori_gamma: ori?.gammaDeg ?? null,
    ori_absolute: ori?.absolute ?? null,
    rot_alpha_dps: rot?.alphaDps ?? null,
    rot_beta_dps: rot?.betaDps ?? null,
    rot_gamma_dps: rot?.gammaDps ?? null,
  });
}, 2000);

// Surface the session id in the HUD so an operator on the chat side can
// correlate a particular run with a particular logfile line.
{
  const sid = document.createElement("div");
  sid.className = "hud-row";
  sid.style.opacity = "0.5";
  sid.style.fontSize = "10px";
  sid.style.fontFamily = "ui-monospace, monospace";
  sid.textContent = `session ${getSessionId()}`;
  const status = document.getElementById("status");
  status?.appendChild(sid);
}

// --- Pointing-accuracy badge ----------------------------------------------
// Refreshed at 5 Hz: fast enough to read as live in a video, slow enough that
// the digits stay legible and we aren't writing DOM text 60×/s.
const ACC_REFRESH_MS = 200;
let lastAccUpdateMs = 0;
let accClass = "acc-idle";

function updateAccuracyBadge(): void {
  const now = performance.now();
  if (now - lastAccUpdateMs < ACC_REFRESH_MS) return;
  lastAccUpdateMs = now;

  const r = readout({
    solving: lockInFlight,
    hasFix: ekfHasAbsolute && renderer.cameraSource === "ekf",
    sigmaRad: ekfActive ? ekf.attitudeSigmaRad() : null,
    secsSinceSolve: accStats.secsSinceSolve(Date.now()),
    measuredDriftDegPerMin: accStats.lastDriftDegPerMin(),
  });

  $accLabel.textContent = r.label;
  $accValue.textContent = r.value;
  $accDetail.textContent = r.detail;

  const nextClass = `acc-${r.state}`;
  if (nextClass !== accClass) {
    $acc.classList.remove(accClass);
    $acc.classList.add(nextClass);
    accClass = nextClass;
  }
}

// --- Render loop ----------------------------------------------------------
function tick(): void {
  if (latestOrientation) {
    // setOrientation always runs so qDevice stays current (used by plate-solve
    // capture). When cameraSource === 'ekf' it skips the camera.quaternion write.
    renderer.setOrientation(
      latestOrientation.a,
      latestOrientation.b,
      latestOrientation.g,
    );
  }

  // EKF only drives the camera after a plate-solve lock. We tried turning it
  // on pre-lock for smoothness, but the device-vs-camera-body frame mismatch
  // (omega is in device frame; EKF body is camera frame) makes the predict
  // step drift in the wrong axes — without high-precision plate-solve updates
  // to clamp it, the rendered sky rotates incorrectly. Pre-lock smoothness
  // is now handled by a slerp inside renderer.setOrientation instead.
  if (renderer.cameraSource === "ekf" && ekfHasAbsolute) {
    renderer.setCameraQuaternion(ekf.state().q as Quat);
    const yawSigma = ekf.yawSigmaRad() * (180 / Math.PI);
    $ekfStatus.textContent = `tracking (yaw σ = ${yawSigma.toFixed(2)}°)`;
  }

  const loc = sensors.getLocation();
  $loc.textContent = loc
    ? `${loc.latDeg.toFixed(3)}, ${loc.lonDeg.toFixed(3)} (±${loc.accuracyM.toFixed(0)} m)`
    : "— (grant GPS)";

  $hdg.textContent = latestOrientation
    ? `α ${latestOrientation.a.toFixed(0)}°  β ${latestOrientation.b.toFixed(0)}°  γ ${latestOrientation.g.toFixed(0)}°`
    : "— (grant motion)";

  const effUtc = nowDate();
  $utc.textContent =
    effUtc.toISOString().slice(11, 19) +
    " Z" +
    (previewClockMs == null ? "" : " ⏰preview");
  const sunAlt = renderer.sunAltitudeDeg;
  const dark =
    sunAlt < -18
      ? "astronomical dark"
      : sunAlt < -12
        ? "astro twilight"
        : sunAlt < -6
          ? "nautical"
          : sunAlt < 0
            ? "civil"
            : "DAYLIGHT";
  $sunAlt.textContent = `${sunAlt.toFixed(1)}° (${dark})`;

  const pick = renderer.pickNearestVisibleStar();
  $pick.textContent = pick
    ? `${pick.name} (${pick.angleDeg.toFixed(1)}° away)`
    : "—";

  if (renderer.locked && lockTimeMs != null) {
    const secsSince = Math.floor((Date.now() - lockTimeMs) / 1000);
    if (!$lockStatus.textContent?.startsWith("LOCKED")) {
      // Don't overwrite a fresh "LOCKED — RA … Dec …" message until ~5 s have passed.
    }
    if (secsSince > 5) {
      $lockStatus.textContent = `locked ${secsSince}s ago (drift growing — re-lock if needed)`;
    }
  }

  updateAccuracyBadge();

  renderer.render();
  requestAnimationFrame(tick);
}
tick();
