// Three.js renderer for the AR sky overlay.
//
// World axes (matches coords.altAzToVector):
//   +X = East, +Y = Up, +Z = South. Camera at origin, looks down -Z (North) by default.
//
// Phone DeviceOrientation (alpha/beta/gamma) → Three.js camera quaternion via
// THREE.Euler order 'YXZ' with the appropriate axis remapping. The orientation
// the browser gives us is the device's *world* orientation, so we apply it to
// the camera directly; +heading-offset slider corrects for magnetometer drift.

import * as THREE from "three";
import { altAzToVector, equatorialToAltAz, type Observer } from "./coords";
import { BRIGHT_STARS } from "./catalog";
import type { Quat } from "./quaternion";

const SKY_RADIUS = 100; // arbitrary — stars on a unit sphere look the same at any radius
const DEG = Math.PI / 180;

export interface RendererState {
  /** Heading correction slider, degrees added to compass alpha. */
  headingOffsetDeg: number;
}

export class SkyRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private starPoints: THREE.Points | null = null;
  private starWorldPositions: Float32Array | null = null;
  private cardinals: THREE.Group;
  state: RendererState = { headingOffsetDeg: 0 };

  constructor(canvas?: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      1000,
    );
    this.camera.position.set(0, 0, 0);
    // Three.js default camera looks down -Z, which is +North in our frame. Good.

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.cardinals = this.buildCardinalMarkers();
    this.scene.add(this.cardinals);

    window.addEventListener("resize", this.onResize);
  }

  attachTo(container: HTMLElement): void {
    container.appendChild(this.renderer.domElement);
    this.onResize();
  }

  /** Update star positions from the current observer + UTC time. */
  setSky(observer: Observer, date: Date): void {
    const positions = new Float32Array(BRIGHT_STARS.length * 3);
    const sizes = new Float32Array(BRIGHT_STARS.length);
    const colors = new Float32Array(BRIGHT_STARS.length * 3);

    for (let i = 0; i < BRIGHT_STARS.length; i++) {
      const s = BRIGHT_STARS[i]!;
      const { altDeg, azDeg } = equatorialToAltAz(
        { ra: s.ra, dec: s.dec },
        observer,
        date,
      );
      const [x, y, z] = altAzToVector(altDeg, azDeg);
      positions[i * 3 + 0] = x * SKY_RADIUS;
      positions[i * 3 + 1] = y * SKY_RADIUS;
      positions[i * 3 + 2] = z * SKY_RADIUS;
      // size = exp(-mag * 0.5), clamped; brighter stars = larger
      sizes[i] = Math.min(8, Math.max(1.5, Math.exp(-s.mag * 0.5) * 4));
      // All white for Step 1 (no B-V color until Step 3).
      colors[i * 3 + 0] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    }

    this.starWorldPositions = positions;

    if (this.starPoints) {
      this.scene.remove(this.starPoints);
      this.starPoints.geometry.dispose();
      (this.starPoints.material as THREE.Material).dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // Tiny stars are pixel-fragile; multiplying by pixel ratio keeps DPI-stable.
          gl_PointSize = size * uPixelRatio * (300.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          // Soft round point with anti-aliased edges (approximates a tiny PSF).
          vec2 p = gl_PointCoord - vec2(0.5);
          float r = length(p);
          float alpha = smoothstep(0.5, 0.0, r);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
    });

    this.starPoints = new THREE.Points(geometry, material);
    this.scene.add(this.starPoints);
  }

  /**
   * Apply DeviceOrientation (alpha, beta, gamma) to the camera.
   * Formula adapted from W3C DeviceOrientation spec: world rotation =
   * R_z(alpha) · R_x(beta) · R_y(gamma), with a final -90° X rotation so that
   * "phone held vertically, screen facing user, top of phone up" looks at the horizon.
   * headingOffsetDeg adds to alpha to correct magnetometer drift.
   */
  /** Pre-correction "device-pose" quaternion (set by setOrientation, used for plate-solve). */
  private qDevice = new THREE.Quaternion();
  /** Lock correction: applied as `q_camera = qLock · qDevice`. Identity until first plate-solve. */
  private qLock = new THREE.Quaternion();
  private hasLock = false;

  setOrientation(alphaDeg: number, betaDeg: number, gammaDeg: number): void {
    const alpha = (alphaDeg + this.state.headingOffsetDeg) * DEG;
    const beta = betaDeg * DEG;
    const gamma = gammaDeg * DEG;

    const e = new THREE.Euler(beta, alpha, -gamma, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(e);
    // Phone "screen up" convention: rotate -90° around X so that camera looks forward
    // instead of straight down when the phone is held upright.
    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI / 2,
    );
    q.multiply(tilt);
    // Mirror around Z (compass convention in DOM is opposite of math convention).
    const mirror = new THREE.Quaternion(
      0,
      0,
      Math.sin(Math.PI / 2),
      Math.cos(Math.PI / 2),
    );
    q.multiply(mirror);

    this.qDevice.copy(q);

    if (this.hasLock) {
      // q_camera = qLock · qDevice
      const out = this.qLock.clone().multiply(q);
      this.camera.quaternion.copy(out);
    } else {
      this.camera.quaternion.copy(q);
    }
  }

  /** Snapshot the device's current pose at the moment of capture (input to plate-solve). */
  getDeviceQuaternion(): Quat {
    const q = this.qDevice;
    return [q.w, q.x, q.y, q.z];
  }

  /**
   * Install a static lock correction so that future device readings render as if
   * the camera were truly at `qWorldAtCapture` when the device was at `qDeviceAtCapture`.
   * qLock = qWorldAtCapture · qDeviceAtCapture⁻¹.
   */
  applyLock(qWorldAtCapture: Quat, qDeviceAtCapture: Quat): void {
    const qWorld = new THREE.Quaternion(
      qWorldAtCapture[1],
      qWorldAtCapture[2],
      qWorldAtCapture[3],
      qWorldAtCapture[0],
    );
    const qDev = new THREE.Quaternion(
      qDeviceAtCapture[1],
      qDeviceAtCapture[2],
      qDeviceAtCapture[3],
      qDeviceAtCapture[0],
    ).invert();
    this.qLock.multiplyQuaternions(qWorld, qDev);
    this.hasLock = true;
  }

  /** True once a successful plate-solve has been applied. */
  get locked(): boolean {
    return this.hasLock;
  }

  clearLock(): void {
    this.qLock.identity();
    this.hasLock = false;
  }

  /** Desktop fallback: drag-look. Returns a cleanup function. */
  enableMouseLook(target: HTMLElement = this.renderer.domElement): () => void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let yaw = 0;
    let pitch = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      target.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw -= (e.clientX - lastX) * 0.005;
      pitch -= (e.clientY - lastY) * 0.005;
      pitch = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, pitch),
      );
      lastX = e.clientX;
      lastY = e.clientY;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(pitch, yaw, 0, "YXZ"),
      );
      this.camera.quaternion.copy(q);
    };
    const onUp = () => {
      dragging = false;
    };

    target.addEventListener("pointerdown", onDown);
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
    return () => {
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
  }

  /**
   * Return the nearest star to the centre of view (used to label the
   * brightest dot the user is pointing at — handy for the calibration step).
   */
  pickNearestVisibleStar(): { name: string; angleDeg: number } | null {
    if (!this.starWorldPositions) return null;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion,
    );
    let bestI = -1;
    let bestDot = -2;
    const v = new THREE.Vector3();
    const inv = 1 / SKY_RADIUS;
    const arr = this.starWorldPositions;
    for (let i = 0; i < BRIGHT_STARS.length; i++) {
      v.set(arr[i * 3]! * inv, arr[i * 3 + 1]! * inv, arr[i * 3 + 2]! * inv);
      const d = forward.dot(v);
      if (d > bestDot) {
        bestDot = d;
        bestI = i;
      }
    }
    if (bestI < 0) return null;
    const angle =
      Math.acos(Math.max(-1, Math.min(1, bestDot))) * (180 / Math.PI);
    return { name: BRIGHT_STARS[bestI]!.name, angleDeg: angle };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private buildCardinalMarkers(): THREE.Group {
    const group = new THREE.Group();
    const points: Array<{ az: number; label: string; color: number }> = [
      { az: 0, label: "N", color: 0x88aaff },
      { az: 90, label: "E", color: 0x666666 },
      { az: 180, label: "S", color: 0x666666 },
      { az: 270, label: "W", color: 0x666666 },
    ];
    for (const p of points) {
      const [x, y, z] = altAzToVector(0, p.az);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 8, 8),
        new THREE.MeshBasicMaterial({ color: p.color }),
      );
      dot.position.set(
        x * SKY_RADIUS * 0.9,
        y * SKY_RADIUS * 0.9,
        z * SKY_RADIUS * 0.9,
      );
      dot.userData["label"] = p.label;
      group.add(dot);
    }
    return group;
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    if (this.starPoints) {
      this.starPoints.geometry.dispose();
      (this.starPoints.material as THREE.Material).dispose();
    }
  }
}
