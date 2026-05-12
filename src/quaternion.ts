// Minimal Hamilton-convention quaternion utilities for the EKF.
//
// Quaternions are stored as plain [w,x,y,z] tuples — no class, no DOM coupling.
// The renderer's three.js objects are intentionally not used here so this module
// is pure math, easy to unit test in node.
//
// Conventions (locked, matches coords.ts):
//   - Hamilton product:  (q1 ⊗ q2) rotates first by q2, then by q1
//   - Right-handed rotations, x-y-z axes per WebGL / Three.js
//   - q = (w, x, y, z) with w = cos(θ/2), (x,y,z) = sin(θ/2)·axis
//   - "Active" rotation: q applied to a vector rotates the vector in a fixed frame.

export type Quat = readonly [number, number, number, number];
export type Vec3 = readonly [number, number, number];

export const IDENTITY: Quat = [1, 0, 0, 0];

export function norm(q: Quat): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

export function normalize(q: Quat): Quat {
  const n = norm(q);
  if (n === 0) return IDENTITY;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function conjugate(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** Hamilton product q1 ⊗ q2. */
export function multiply(q1: Quat, q2: Quat): Quat {
  const [w1, x1, y1, z1] = q1;
  const [w2, x2, y2, z2] = q2;
  return [
    w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
    w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
    w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
  ];
}

/** Build a quaternion from a rotation of `angle` radians about unit axis. */
export function fromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const half = angleRad / 2;
  const s = Math.sin(half);
  const c = Math.cos(half);
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  return [c, (axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s];
}

/**
 * Small-angle rotation vector → quaternion. Used for EKF error-state updates.
 * dθ = [δθx, δθy, δθz]; |dθ| should be small (« 1 rad).
 */
export function fromRotationVector(dTheta: Vec3): Quat {
  const angle = Math.hypot(dTheta[0], dTheta[1], dTheta[2]);
  if (angle < 1e-12) return IDENTITY;
  return fromAxisAngle([dTheta[0], dTheta[1], dTheta[2]], angle);
}

/** Convert a quaternion into a small-angle rotation vector (inverse of fromRotationVector for small q). */
export function toRotationVector(q: Quat): Vec3 {
  const qn = normalize(q);
  let w = qn[0];
  let x = qn[1];
  let y = qn[2];
  let z = qn[3];
  if (w < 0) {
    // Pick the shorter rotation.
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }
  const sinHalf = Math.hypot(x, y, z);
  if (sinHalf < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(sinHalf, w);
  const k = angle / sinHalf;
  return [x * k, y * k, z * k];
}

/** Rotate a 3-vector by quaternion q (active rotation). */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const qv: Quat = [0, v[0], v[1], v[2]];
  const r = multiply(multiply(q, qv), conjugate(q));
  return [r[1], r[2], r[3]];
}

/**
 * Integrate quaternion under constant body-frame angular velocity ω for dt seconds.
 * Standard first-order: q_{k+1} = q_k ⊗ exp(0.5 · ω · dt), renormalized.
 */
export function integrateGyro(q: Quat, omega: Vec3, dt: number): Quat {
  const dq = fromRotationVector([omega[0] * dt, omega[1] * dt, omega[2] * dt]);
  return normalize(multiply(q, dq));
}

/** Angle in radians between two unit quaternions (smaller of the two great-circle distances). */
export function angleBetween(a: Quat, b: Quat): number {
  // dot product; the sign-ambiguity means we take |dot|.
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}
