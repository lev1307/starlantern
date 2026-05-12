import { describe, it, expect } from "vitest";
import {
  IDENTITY,
  multiply,
  conjugate,
  normalize,
  fromAxisAngle,
  fromRotationVector,
  toRotationVector,
  rotate,
  integrateGyro,
  angleBetween,
  type Quat,
} from "../src/quaternion";

const TAU = Math.PI * 2;

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

describe("quaternion algebra", () => {
  it("identity is (1,0,0,0) and acts as identity for multiplication", () => {
    expect(IDENTITY).toEqual([1, 0, 0, 0]);
    const q: Quat = normalize([0.5, 0.5, 0.5, 0.5]);
    const r = multiply(IDENTITY, q);
    for (let i = 0; i < 4; i++) expect(close(r[i]!, q[i]!)).toBe(true);
  });

  it("q · q* = (|q|², 0, 0, 0) — a real unit-magnitude scalar quaternion", () => {
    const q: Quat = normalize([2, 3, 4, 5]);
    const r = multiply(q, conjugate(q));
    expect(close(r[0]!, 1, 1e-9)).toBe(true);
    expect(close(r[1]!, 0, 1e-9)).toBe(true);
    expect(close(r[2]!, 0, 1e-9)).toBe(true);
    expect(close(r[3]!, 0, 1e-9)).toBe(true);
  });

  it("fromAxisAngle is normalized regardless of input axis length", () => {
    const q = fromAxisAngle([3, 0, 0], Math.PI / 3);
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    expect(close(len, 1, 1e-9)).toBe(true);
  });

  it("90° rotation about Z maps +X → +Y", () => {
    const q = fromAxisAngle([0, 0, 1], Math.PI / 2);
    const v = rotate(q, [1, 0, 0]);
    expect(close(v[0], 0, 1e-9)).toBe(true);
    expect(close(v[1], 1, 1e-9)).toBe(true);
    expect(close(v[2], 0, 1e-9)).toBe(true);
  });

  it("180° rotation about Y maps +X → -X", () => {
    const q = fromAxisAngle([0, 1, 0], Math.PI);
    const v = rotate(q, [1, 0, 0]);
    expect(close(v[0], -1, 1e-9)).toBe(true);
    expect(close(v[1], 0, 1e-9)).toBe(true);
    expect(close(v[2], 0, 1e-9)).toBe(true);
  });

  it("toRotationVector ∘ fromRotationVector is identity for small angles", () => {
    for (const v of [
      [0.001, 0, 0],
      [0, -0.05, 0.02],
      [0.1, 0.1, 0.1],
    ] as const) {
      const out = toRotationVector(fromRotationVector(v));
      expect(close(out[0], v[0], 1e-9)).toBe(true);
      expect(close(out[1], v[1], 1e-9)).toBe(true);
      expect(close(out[2], v[2], 1e-9)).toBe(true);
    }
  });

  it("integrateGyro: constant 1 rad/s about Z for π/2 s → 90° rotation", () => {
    let q: Quat = IDENTITY;
    const dt = 0.001;
    const steps = Math.round(Math.PI / 2 / dt);
    for (let i = 0; i < steps; i++) q = integrateGyro(q, [0, 0, 1], dt);
    const expected = fromAxisAngle([0, 0, 1], Math.PI / 2);
    // First-order quaternion integration accumulates O(dt²) error — at 1571 steps of
    // 1 ms each, residual is ~2×10⁻⁴ rad ≈ 0.01°, well within the EKF measurement σ.
    expect(angleBetween(q, expected)).toBeLessThan(5e-4);
  });

  it("angleBetween is symmetric and zero for identical quaternions", () => {
    const q = fromAxisAngle([1, 1, 1], 0.7);
    expect(angleBetween(q, q)).toBeLessThan(1e-9);
    const r = fromAxisAngle([1, 1, 1], 0.7 + TAU);
    expect(angleBetween(q, r)).toBeLessThan(1e-9);
  });
});
