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

const app = document.getElementById("app");
if (!app) throw new Error("No #app container found");

// --- Layout ---------------------------------------------------------------
app.innerHTML = `
  <canvas id="sky"></canvas>
  <div id="hud">
    <div id="status" class="hud-card">
      <div class="hud-row"><span class="lbl">Location</span><span id="loc">—</span></div>
      <div class="hud-row"><span class="lbl">Heading</span><span id="hdg">—</span></div>
      <div class="hud-row"><span class="lbl">UTC</span><span id="utc">—</span></div>
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
      <div class="hud-row"><span class="lbl">Lock</span><span id="lock-status">unlocked</span></div>
      <div class="hud-row"><span class="lbl">EKF</span><span id="ekf-status">idle</span></div>
    </div>
  </div>
  <div id="overlay" class="overlay">
    <div class="overlay-inner">
      <h1>AR Night Sky</h1>
      <p>Step 1 — WebXR base. Grant motion + location, then point your phone at the sky.</p>
      <button id="overlay-start" class="big-btn">Start</button>
      <p class="tiny">Use outdoors away from metal for accurate heading. iOS will prompt for motion access; allow it.</p>
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
  .stereo-details { margin-top: 0.5rem; }
  .stereo-details summary { cursor: pointer; opacity: 0.7; font-weight: 500; }
  .stereo-details[open] summary { opacity: 1; }
  .stereo-details label { margin-top: 0.35rem; }
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
`;
document.head.appendChild(style);

// --- Wiring ---------------------------------------------------------------
const canvas = document.getElementById("sky") as HTMLCanvasElement;
const renderer = new SkyRenderer(canvas);

const sensors = new SensorHub();

const $loc = document.getElementById("loc")!;
const $hdg = document.getElementById("hdg")!;
const $utc = document.getElementById("utc")!;
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
let lastMotionTMs: number | null = null;

$offset.addEventListener("input", () => {
  renderer.state.headingOffsetDeg = parseFloat($offset.value);
  $offsetVal.textContent = `${renderer.state.headingOffsetDeg.toFixed(1)}°`;
});

const $bortle = document.getElementById("bortle") as HTMLInputElement;
const $bortleVal = document.getElementById("bortle-val")!;
const $exposure = document.getElementById("exposure") as HTMLInputElement;
const $exposureVal = document.getElementById("exposure-val")!;
const $kp = document.getElementById("kp") as HTMLInputElement;
const $kpVal = document.getElementById("kp-val")!;

function refreshSky(): void {
  const fix = sensors.getLocation();
  if (fix)
    renderer.setSky({ latDeg: fix.latDeg, lonDeg: fix.lonDeg }, new Date());
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
});

$exposure.addEventListener("input", () => {
  renderer.state.exposure = parseFloat($exposure.value);
  $exposureVal.textContent = `${renderer.state.exposure.toFixed(2)}×`;
  refreshSky();
});

$kp.addEventListener("input", () => {
  renderer.state.kp = parseFloat($kp.value);
  $kpVal.textContent = renderer.state.kp.toFixed(1);
  refreshSky();
});

// Pull the live Kp from NOAA SWPC via /api/kp on load (and every 10 min while
// the page stays open). Falls back silently to the slider default on failure.
async function refreshLiveKp(): Promise<void> {
  try {
    const r = await fetch("/api/kp");
    if (!r.ok) return;
    const data = (await r.json()) as { kp?: number };
    if (typeof data.kp !== "number" || !Number.isFinite(data.kp)) return;
    renderer.state.kp = Math.max(0, Math.min(9, data.kp));
    $kp.value = renderer.state.kp.toString();
    $kpVal.textContent = `${renderer.state.kp.toFixed(1)} (live)`;
    refreshSky();
  } catch {
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
  // Side-by-side stereo on phones really wants landscape + fullscreen. Best-effort.
  if (s.enabled && document.fullscreenEnabled && !document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }
});

$xr.addEventListener("click", async () => {
  $xr.disabled = true;
  const prev = $xr.textContent;
  $xr.textContent = "trying…";
  try {
    const ok = await renderer.tryEnterImmersiveVr();
    $xr.textContent = ok ? "WebXR active" : "no WebXR";
  } catch {
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
});
$k1.addEventListener("input", () => {
  renderer.state.stereo.k1 = parseFloat($k1.value);
  $k1Val.textContent = renderer.state.stereo.k1.toFixed(2);
});
$k2.addEventListener("input", () => {
  renderer.state.stereo.k2 = parseFloat($k2.value);
  $k2Val.textContent = renderer.state.stereo.k2.toFixed(3);
});
$chroma.addEventListener("input", () => {
  renderer.state.stereo.chromatic = parseFloat($chroma.value);
  $chromaVal.textContent = renderer.state.stereo.chromatic.toFixed(3);
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
  const DEG = Math.PI / 180;
  const omega: [number, number, number] = [
    r.betaDps * DEG,
    r.gammaDps * DEG,
    r.alphaDps * DEG,
  ];
  ekf.predict(omega, dt);
});

async function start(): Promise<void> {
  $overlay.style.display = "none";

  // Orientation permission (iOS prompts; everyone else auto-grants).
  const orientResult = await sensors.requestOrientationPermission();
  if (orientResult !== "granted") {
    alert("Motion sensor access denied. Use mouse drag on desktop.");
  }

  // DeviceMotion: provides angular velocity (rotationRate). Used by the EKF
  // predict step for continuous drift correction between plate-solves.
  const motionResult = await sensors.requestMotionPermission();
  if (motionResult === "granted") {
    ekfActive = true;
    $ekfStatus.textContent = "active (predict-only until first absolute fix)";
  } else {
    $ekfStatus.textContent = "no motion sensor (static-correction lock only)";
  }

  // Best-effort location fix. Falls back to a sensible default if denied.
  try {
    const fix = await sensors.requestLocation();
    renderer.setSky({ latDeg: fix.latDeg, lonDeg: fix.lonDeg }, new Date());
  } catch {
    // Default: Munich (TUM, where the founder is). Manual override available.
    sensors.setManualLocation(48.1486, 11.5675, 520);
    renderer.setSky({ latDeg: 48.1486, lonDeg: 11.5675 }, new Date());
  }

  // Desktop fallback for testing without a phone.
  renderer.enableMouseLook();

  // Update star altaz periodically — sidereal sky drifts ~15°/h.
  setInterval(() => {
    const fix = sensors.getLocation();
    if (fix)
      renderer.setSky({ latDeg: fix.latDeg, lonDeg: fix.lonDeg }, new Date());
  }, 30_000);
}

$start.addEventListener("click", () => void start());
$overlayStart.addEventListener("click", () => void start());

$lock.addEventListener("click", async () => {
  const fix = sensors.getLocation();
  if (!fix) {
    alert("Need a location fix first — grant GPS or use manual location.");
    return;
  }
  $lock.disabled = true;
  const prevLabel = $lock.textContent;
  try {
    $lockStatus.textContent = "opening camera…";
    await camera.open();

    $lockStatus.textContent = "capturing (stacking 8 frames)…";
    const capture = await camera.grabStacked(8);

    // Snapshot device pose at the moment of capture (best estimate).
    const qDevice = renderer.getDeviceQuaternion();

    $lockStatus.textContent = "uploading…";
    const result = await solver.solve(
      capture.blob,
      { latDeg: fix.latDeg, lonDeg: fix.lonDeg },
      capture.utcMs,
      (s) => {
        $lockStatus.textContent = `${s}…`;
      },
    );

    renderer.applyLock(result.qCameraWorld, qDevice);
    lockTimeMs = Date.now();
    $lockStatus.textContent = `LOCKED — RA ${result.calibration.ra.toFixed(2)}°, Dec ${result.calibration.dec.toFixed(2)}°`;
    $unlock.disabled = false;
    // Feed the plate-solve into the EKF as a high-precision absolute update.
    if (ekfActive) {
      ekf.update(result.qCameraWorld, 5e-5); // ~10 arcsec stddev
      ekfHasAbsolute = true;
      // Switch camera source to EKF — continuous drift correction from here on.
      renderer.cameraSource = "ekf";
      $ekfStatus.textContent = "locked (plate-solve fix injected)";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    $lockStatus.textContent = `failed: ${msg}`;
    console.error("Plate-solve failed", err);
  } finally {
    $lock.disabled = false;
    $lock.textContent = prevLabel ?? "Lock to sky (plate-solve)";
  }
});

$unlock.addEventListener("click", () => {
  renderer.clearLock();
  renderer.cameraSource = "sensor";
  ekfHasAbsolute = false;
  camera.close();
  lockTimeMs = null;
  $lockStatus.textContent = "unlocked";
  $ekfStatus.textContent = ekfActive ? "predict-only" : "idle";
  $unlock.disabled = true;
});

$manual.addEventListener("click", () => {
  const raw = prompt(
    'Manual location as "lat,lon" (e.g. 48.1486,11.5675 for Munich)',
  );
  if (!raw) return;
  const parts = raw.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    alert("Bad format. Expected: lat,lon");
    return;
  }
  sensors.setManualLocation(parts[0]!, parts[1]!, 0);
  renderer.setSky({ latDeg: parts[0]!, lonDeg: parts[1]! }, new Date());
});

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

  $utc.textContent = new Date().toISOString().slice(11, 19) + " Z";

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

  renderer.render();
  requestAnimationFrame(tick);
}
tick();
