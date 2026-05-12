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
      <div class="btn-row">
        <button id="start-btn">Start (grant sensors)</button>
        <button id="manual-btn" type="button">Use manual location</button>
      </div>
      <div class="btn-row">
        <button id="lock-btn" type="button">Lock to sky (plate-solve)</button>
        <button id="unlock-btn" type="button" disabled>Clear lock</button>
      </div>
      <div class="hud-row"><span class="lbl">Lock</span><span id="lock-status">unlocked</span></div>
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

const camera = new CameraCapture();
const solver = new PlateSolver();
let lockTimeMs: number | null = null;

$offset.addEventListener("input", () => {
  renderer.state.headingOffsetDeg = parseFloat($offset.value);
  $offsetVal.textContent = `${renderer.state.headingOffsetDeg.toFixed(1)}°`;
});

let latestOrientation: { a: number; b: number; g: number } | null = null;

sensors.onOrientation((o) => {
  latestOrientation = { a: o.alphaDeg, b: o.betaDeg, g: o.gammaDeg };
});

async function start(): Promise<void> {
  $overlay.style.display = "none";

  // Orientation permission (iOS prompts; everyone else auto-grants).
  const orientResult = await sensors.requestOrientationPermission();
  if (orientResult !== "granted") {
    alert("Motion sensor access denied. Use mouse drag on desktop.");
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
  camera.close();
  lockTimeMs = null;
  $lockStatus.textContent = "unlocked";
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
    renderer.setOrientation(
      latestOrientation.a,
      latestOrientation.b,
      latestOrientation.g,
    );
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
