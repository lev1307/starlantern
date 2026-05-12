// Pure-math helpers for the Step 4 stereo pipeline.
//
// Tested in tests/stereo.test.ts so the GPU shader and the JS code stay in sync.

/**
 * Brown-Conrady radial barrel distortion (k1, k2 terms).
 * Input/output coordinates are centered on the lens centre, scaled so the half-screen
 * extent is 1 (so r∈[0, √2] for a unit-aspect quad).
 *
 *   r_distorted = r * (1 + k1·r² + k2·r⁴)
 *
 * Positive k1 ≈ pincushion correction (pre-distorts to cancel the lens's barrel warp).
 * Negative k1 ≈ barrel correction. Cardboard-style lenses typically need k1 ≈ +0.18–0.30.
 */
export function barrelDistort(
  cx: number,
  cy: number,
  k1: number,
  k2: number,
): [number, number] {
  const r2 = cx * cx + cy * cy;
  const factor = 1 + k1 * r2 + k2 * r2 * r2;
  return [cx * factor, cy * factor];
}

/**
 * Per-eye barrel sample. Given a canvas pixel split into left/right halves, returns
 * the source-texture UV (in the eye's own half of the offscreen render target) that
 * should be sampled to produce that output pixel after lens pre-distortion.
 *
 * Inputs:
 *   outU, outV — output UV in [0,1]² over the FULL canvas
 *   k1, k2     — distortion coefficients
 *
 * Returns { eye, srcU, srcV } where:
 *   eye        — 'left' if outU < 0.5, else 'right'
 *   srcU, srcV — source UV in [0,1]² over the SAME half of the RT. Returns NaN, NaN
 *                if the distorted sample lies outside the half-eye image (caller
 *                should render black there).
 */
export function eyeBarrelSample(
  outU: number,
  outV: number,
  k1: number,
  k2: number,
): { eye: "left" | "right"; srcU: number; srcV: number } {
  const isRight = outU >= 0.5;
  // Reproject to half-eye UV in [0,1]² centred on each half.
  const halfU = isRight ? (outU - 0.5) * 2 : outU * 2;
  const halfV = outV;
  // Centre on (0.5, 0.5).
  const cx = halfU - 0.5;
  const cy = halfV - 0.5;
  const [dx, dy] = barrelDistort(cx, cy, k1, k2);
  const srcU = dx + 0.5;
  const srcV = dy + 0.5;
  if (srcU < 0 || srcU > 1 || srcV < 0 || srcV > 1) {
    return { eye: isRight ? "right" : "left", srcU: NaN, srcV: NaN };
  }
  return { eye: isRight ? "right" : "left", srcU, srcV };
}

/**
 * Recommended per-eye camera offset along the head's local +X (right) axis, in metres.
 * The base camera sits at the bridge of the nose; left eye = -ipdM/2, right = +ipdM/2.
 */
export function eyeOffsets(ipdM: number): { leftX: number; rightX: number } {
  const half = ipdM / 2;
  return { leftX: -half, rightX: half };
}
