import { describe, it, expect } from "vitest";
import { OrientationEKF } from "../src/ekf";
import {
  fromAxisAngle,
  angleBetween,
  IDENTITY,
  type Quat,
  type Vec3,
} from "../src/quaternion";

describe("OrientationEKF", () => {
  it("predict with zero omega and zero bias keeps q at identity", () => {
    const ekf = new OrientationEKF();
    for (let i = 0; i < 100; i++) ekf.predict([0, 0, 0], 0.01);
    expect(angleBetween(ekf.state().q, IDENTITY)).toBeLessThan(1e-6);
  });

  it("predict with constant 1 rad/s about Z for 1 s yields ~57.3° rotation about Z", () => {
    const ekf = new OrientationEKF();
    const dt = 0.001;
    for (let i = 0; i < 1000; i++) ekf.predict([0, 0, 1], dt);
    const expected = fromAxisAngle([0, 0, 1], 1);
    expect(angleBetween(ekf.state().q, expected)).toBeLessThan(1e-3);
  });

  it("covariance grows under prediction (yaw uncertainty increases)", () => {
    const ekf = new OrientationEKF();
    const before = ekf.yawSigmaRad();
    for (let i = 0; i < 1000; i++) ekf.predict([0, 0, 0], 0.01);
    const after = ekf.yawSigmaRad();
    expect(after).toBeGreaterThan(before);
  });

  it("a single accurate plate-solve update collapses yaw uncertainty", () => {
    const ekf = new OrientationEKF();
    // drift for 10 s with no bias correction
    for (let i = 0; i < 1000; i++) ekf.predict([0, 0, 0], 0.01);
    const sigmaBefore = ekf.yawSigmaRad();

    const qTrue = fromAxisAngle([0, 0, 1], 0.4);
    ekf.update(qTrue, 1e-4); // 0.0001 rad ≈ 20 arcsec — astrometry.net precision
    const sigmaAfter = ekf.yawSigmaRad();

    expect(sigmaAfter).toBeLessThan(sigmaBefore);
    // After a precise measurement, post-update σ ≈ measurement σ.
    expect(sigmaAfter).toBeLessThan(1e-3);
    expect(angleBetween(ekf.state().q, qTrue)).toBeLessThan(1e-3);
  });

  it("bias is estimated: gyro reports a bias-only omega → predict drifts, plate-solve corrects, bias converges", () => {
    const ekf = new OrientationEKF();
    const trueBias: Vec3 = [0, 0, 0.05]; // 0.05 rad/s yaw bias
    const dt = 0.01;

    // Closed-loop sim: every 30 s, the truth lands at the true orientation (constant
    // since the only "rotation" is the bias illusion). EKF gets that exact q as an update.
    let qTrue: Quat = IDENTITY;
    for (let step = 0; step < 6; step++) {
      for (let i = 0; i < 3000; i++) {
        // gyro reads true_omega + bias; here true_omega = 0, so omegaRaw = bias.
        ekf.predict(trueBias, dt);
      }
      ekf.update(qTrue, 1e-4);
    }

    const { bias } = ekf.state();
    // Bias estimate should approach the truth.
    expect(Math.abs(bias[2] - trueBias[2])).toBeLessThan(0.01);
    // And the orientation residual is small.
    expect(angleBetween(ekf.state().q, qTrue)).toBeLessThan(0.01);
  });

  it("covariance stays symmetric and PSD after many predict/update cycles", () => {
    const ekf = new OrientationEKF();
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 100; j++) ekf.predict([0.01, 0.02, -0.01], 0.01);
      ekf.update(fromAxisAngle([0, 0, 1], 0.1 * i), 1e-3);
    }
    const P = ekf.covariance();
    for (let i = 0; i < 6; i++) {
      for (let j = i; j < 6; j++) {
        expect(Math.abs(P[i]![j]! - P[j]![i]!)).toBeLessThan(1e-6);
      }
      expect(P[i]![i]!).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
