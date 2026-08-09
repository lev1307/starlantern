// Multiplicative Error-State Kalman Filter (MEKF) for orientation + gyro bias.
//
// Nominal state: q (4-vector quaternion, body→world) + b (3-vector gyro bias).
// Error state:   δθ (3-vector small-angle rotation) + δb (3-vector bias delta).
// Covariance P:  6×6 symmetric over [δθ, δb].
//
// This is the canonical MEKF used in spacecraft attitude estimation (Markley/Crassidis 2014).
// It keeps the quaternion globally consistent (no over-parameterization in P) while letting
// the EKF math operate on a minimal 6-dim error state.
//
// Step 2 use:
//   - predict(omega_raw, dt) every IMU sample (≥60 Hz from DeviceOrientation, lower in practice)
//   - update(q_meas, sigma_rad) every plate-solve return (~1 per minute on a good night)
// Output: get the current nominal q via `state()`; renderer uses that for camera pose.

import {
  multiply,
  fromRotationVector,
  toRotationVector,
  normalize,
  type Quat,
  type Vec3,
} from "./quaternion";

type Matrix = number[][];

function eye(n: number, scale = 1): Matrix {
  const m: Matrix = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = scale;
    m.push(row);
  }
  return m;
}

function matAdd(a: Matrix, b: Matrix): Matrix {
  return a.map((row, i) => row.map((v, j) => v + b[i]![j]!));
}

function matMul(a: Matrix, b: Matrix): Matrix {
  const m = a.length;
  const n = b[0]!.length;
  const k = b.length;
  const out: Matrix = Array.from({ length: m }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += a[i]![p]! * b[p]![j]!;
      out[i]![j] = s;
    }
  }
  return out;
}

function transpose(a: Matrix): Matrix {
  const m = a.length;
  const n = a[0]!.length;
  const out: Matrix = Array.from({ length: n }, () =>
    new Array<number>(m).fill(0),
  );
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) out[j]![i] = a[i]![j]!;
  return out;
}

/** Invert a small symmetric matrix via Gauss-Jordan. Fine for ≤6×6. */
function invert(a: Matrix): Matrix {
  const n = a.length;
  const m: Matrix = a.map((row, i) => {
    const augmented = [...row];
    for (let j = 0; j < n; j++) augmented.push(i === j ? 1 : 0);
    return augmented;
  });
  for (let i = 0; i < n; i++) {
    let pivot = m[i]![i]!;
    if (Math.abs(pivot) < 1e-12) {
      // swap with a lower row
      let swap = -1;
      for (let r = i + 1; r < n; r++) {
        if (Math.abs(m[r]![i]!) > 1e-12) {
          swap = r;
          break;
        }
      }
      if (swap < 0)
        throw new Error("EKF: singular covariance during inversion");
      [m[i], m[swap]] = [m[swap]!, m[i]!];
      pivot = m[i]![i]!;
    }
    for (let j = 0; j < 2 * n; j++) m[i]![j] = m[i]![j]! / pivot;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = m[r]![i]!;
      for (let j = 0; j < 2 * n; j++) m[r]![j] = m[r]![j]! - f * m[i]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

export interface EkfConfig {
  /** Gyro white noise σ (rad / √s). DeviceOrientation is noisy: ~0.02–0.05 is typical. */
  gyroSigma: number;
  /** Gyro bias random-walk σ (rad / s · √s). ~1e-4 is conservative. */
  biasRwSigma: number;
}

const DEFAULT_CONFIG: EkfConfig = {
  gyroSigma: 0.03,
  biasRwSigma: 1e-4,
};

export class OrientationEKF {
  private q: Quat;
  private bias: Vec3;
  private P: Matrix; // 6×6 over [δθ (3), δb (3)]
  private cfg: EkfConfig;

  constructor(qInit: Quat = [1, 0, 0, 0], cfg: Partial<EkfConfig> = {}) {
    this.q = normalize(qInit);
    this.bias = [0, 0, 0];
    // Initial uncertainty: large yaw uncertainty until first plate-solve.
    this.P = eye(6, 1.0);
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  state(): { q: Quat; bias: Vec3 } {
    return { q: this.q, bias: this.bias };
  }

  /** Get the current 6×6 covariance (for tests / diagnostics). */
  covariance(): Matrix {
    return this.P.map((r) => [...r]);
  }

  /** Heading uncertainty (1-σ) in radians, from the z-axis attitude variance. */
  yawSigmaRad(): number {
    return Math.sqrt(Math.max(0, this.P[2]![2]!));
  }

  /**
   * Total attitude uncertainty (1-σ) in radians: the expected magnitude of the
   * δθ error vector, i.e. √trace of the 3×3 attitude block.
   *
   * This is the number to show a user asking "how well are you pointing?".
   * yawSigmaRad() alone understates it — a phone can be confident about heading
   * while uncertain in pitch, and the overlay misaligns either way.
   */
  attitudeSigmaRad(): number {
    const trace =
      Math.max(0, this.P[0]![0]!) +
      Math.max(0, this.P[1]![1]!) +
      Math.max(0, this.P[2]![2]!);
    return Math.sqrt(trace);
  }

  /**
   * Predict step. omegaRaw is the body-frame angular velocity reading from the gyro;
   * dt is seconds elapsed since last call.
   */
  predict(omegaRaw: Vec3, dt: number): void {
    if (dt <= 0) return;

    // Bias-corrected angular velocity.
    const omega: Vec3 = [
      omegaRaw[0] - this.bias[0],
      omegaRaw[1] - this.bias[1],
      omegaRaw[2] - this.bias[2],
    ];

    // Nominal integration: q ← q ⊗ exp(0.5·ω·dt)
    const dq = fromRotationVector([
      omega[0] * dt,
      omega[1] * dt,
      omega[2] * dt,
    ]);
    this.q = normalize(multiply(this.q, dq));

    // Error-state transition (first-order):
    //   δθ_{k+1}  = δθ - dt · δb
    //   δb_{k+1}  = δb
    // F = [[I, -dt·I], [0, I]]; Q = diag(σ_g²·dt², σ_b²·dt) on the 6-dim error state.
    const F: Matrix = eye(6);
    for (let i = 0; i < 3; i++) F[i]![i + 3] = -dt;

    const sg2 = this.cfg.gyroSigma * this.cfg.gyroSigma * dt;
    const sb2 = this.cfg.biasRwSigma * this.cfg.biasRwSigma * dt;
    const Q: Matrix = eye(6, 0);
    for (let i = 0; i < 3; i++) Q[i]![i] = sg2;
    for (let i = 3; i < 6; i++) Q[i]![i] = sb2;

    // P ← F P Fᵀ + Q
    this.P = matAdd(matMul(matMul(F, this.P), transpose(F)), Q);
  }

  /**
   * Update with an absolute orientation measurement q_meas (body→world), assumed
   * isotropic-Gaussian with stdev sigmaRad (radians, 1-σ on each axis).
   * Used when plate-solve returns a WCS pose for the IMU frame at capture time.
   *
   * Returns the innovation magnitude in radians — how far the measurement
   * disagreed with the propagated state before correction. Between two
   * plate-solves that is the filter's true accumulated drift, which is a
   * stronger accuracy claim than the covariance the filter reports about itself.
   */
  update(qMeas: Quat, sigmaRad: number): { innovationRad: number } {
    // Innovation: δ = log(q_meas ⊗ q⁻¹) as a 3-vector small-angle rotation.
    const dq = multiply(qMeas, [this.q[0], -this.q[1], -this.q[2], -this.q[3]]);
    const innov = toRotationVector(dq);
    const innovationRad = Math.hypot(innov[0], innov[1], innov[2]);

    // Measurement Jacobian: H = [I_3, 0_3] (we measure attitude only, not bias).
    const H: Matrix = [
      [1, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
    ];
    const R: Matrix = eye(3, sigmaRad * sigmaRad);

    // S = H P Hᵀ + R, K = P Hᵀ S⁻¹
    const PHt = matMul(this.P, transpose(H));
    const S = matAdd(matMul(H, PHt), R);
    const K = matMul(PHt, invert(S));

    // δx = K · innov  (6-vector: [δθ; δb])
    const dx: number[] = [];
    for (let i = 0; i < 6; i++) {
      dx.push(
        K[i]![0]! * innov[0] + K[i]![1]! * innov[1] + K[i]![2]! * innov[2],
      );
    }

    // Inject δθ into the nominal quaternion: q ← exp(0.5·δθ) ⊗ q
    const dqInj = fromRotationVector([dx[0]!, dx[1]!, dx[2]!]);
    this.q = normalize(multiply(dqInj, this.q));
    this.bias = [
      this.bias[0] + dx[3]!,
      this.bias[1] + dx[4]!,
      this.bias[2] + dx[5]!,
    ];

    // Joseph form covariance update: P ← (I - K H) P (I - K H)ᵀ + K R Kᵀ.
    // Joseph keeps P symmetric & PSD under finite-precision arithmetic.
    const KH = matMul(K, H);
    const I_KH: Matrix = eye(6);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) I_KH[i]![j] = I_KH[i]![j]! - KH[i]![j]!;
    const term1 = matMul(matMul(I_KH, this.P), transpose(I_KH));
    const term2 = matMul(matMul(K, R), transpose(K));
    this.P = matAdd(term1, term2);

    return { innovationRad };
  }
}
