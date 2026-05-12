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
import {
  bvToRgb,
  magToFlux,
  extinctionMag,
  bortleLimitMag,
  scotopicSaturation,
} from "./astrophysics";
import { moonPosition } from "./moon";

const SKY_RADIUS = 100; // arbitrary — stars on a unit sphere look the same at any radius
const DEG = Math.PI / 180;

/** GLSL-equivalent smoothstep in JS. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface RendererState {
  /** Heading correction slider, degrees added to compass alpha. */
  headingOffsetDeg: number;
  /** Bortle scale 1 (pristine) .. 9 (inner city). Drives sky-glow + faint-star wash. */
  bortle: number;
  /** Exposure scalar applied to the rendered star fluxes (1 = neutral). */
  exposure: number;
}

export class SkyRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private starPoints: THREE.Points | null = null;
  private starWorldPositions: Float32Array | null = null;
  private cardinals: THREE.Group;
  private moonMesh: THREE.Mesh | null = null;
  state: RendererState = { headingOffsetDeg: 0, bortle: 4, exposure: 1.0 };

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

  /**
   * Update star positions + per-star color/flux from the current observer + UTC + Bortle.
   * Pipeline:
   *   - altaz from equatorial + observer + time
   *   - airmass-extinct magnitude → flux
   *   - Bortle floor: stars below the limit go to zero alpha (still in buffer; cheap)
   *   - B-V → Teff → linear-sRGB color; desaturate toward neutral at low flux (Purkinje)
   * The fragment shader draws a Moffat-like soft PSF whose intensity is the per-star flux.
   */
  setSky(observer: Observer, date: Date): void {
    const positions = new Float32Array(BRIGHT_STARS.length * 3);
    const fluxes = new Float32Array(BRIGHT_STARS.length);
    const colors = new Float32Array(BRIGHT_STARS.length * 3);
    const limitMag = bortleLimitMag(this.state.bortle);

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

      // Atmospheric extinction by altitude.
      const apparentMag = s.mag + extinctionMag(altDeg);
      // Drop stars fainter than the Bortle limit (with a 0.5-mag soft taper).
      const visibility = 1 - smoothstep(limitMag - 0.5, limitMag, apparentMag);
      const flux = magToFlux(apparentMag) * visibility * this.state.exposure;
      fluxes[i] = flux;

      // True color from B-V → blackbody RGB, then scotopic desaturation toward neutral.
      const [cr, cg, cb] = bvToRgb(s.bv);
      const sat = scotopicSaturation(flux);
      const NEUTRAL_R = 0.85;
      const NEUTRAL_G = 0.92;
      const NEUTRAL_B = 1.0;
      colors[i * 3 + 0] = NEUTRAL_R + sat * (cr - NEUTRAL_R);
      colors[i * 3 + 1] = NEUTRAL_G + sat * (cg - NEUTRAL_G);
      colors[i * 3 + 2] = NEUTRAL_B + sat * (cb - NEUTRAL_B);
    }

    this.starWorldPositions = positions;

    if (this.starPoints) {
      this.scene.remove(this.starPoints);
      this.starPoints.geometry.dispose();
      (this.starPoints.material as THREE.Material).dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("flux", new THREE.BufferAttribute(fluxes, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: /* glsl */ `
        attribute float flux;
        varying vec3 vColor;
        varying float vFlux;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vFlux = flux;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // PSF radius scales with √flux up to a cap — same flux distributed over
          // a wider area gives a brighter, larger blur, matching the eye's PSF response.
          float radius = clamp(2.0 + 6.0 * sqrt(max(flux, 0.0001)), 2.0, 18.0);
          gl_PointSize = radius * uPixelRatio * (320.0 / -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vFlux;
        void main() {
          // Moffat-like PSF: ((1 + (r/α)²)^-β) with β = 2.5, α = 0.25 in point-coord units.
          vec2 p = (gl_PointCoord - vec2(0.5)) * 2.0; // p in [-1, 1]
          float r2 = dot(p, p);
          float core = pow(1.0 + r2 / 0.06, -2.5);
          // Optional faint halo for bright stars (additive blending so this just glows).
          float halo = 0.18 * exp(-r2 * 6.0);
          float intensity = clamp(core + halo, 0.0, 1.0);
          float alpha = intensity * clamp(vFlux, 0.0, 4.0);
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(vColor * intensity, alpha);
        }
      `,
    });

    this.starPoints = new THREE.Points(geometry, material);
    this.scene.add(this.starPoints);

    this.updateMoon(observer, date);
    this.updateSkyBackground();
  }

  /** Place the moon on the sky sphere with the current phase / illumination. */
  private updateMoon(observer: Observer, date: Date): void {
    const moon = moonPosition(date);
    const { altDeg, azDeg } = equatorialToAltAz(
      { ra: moon.raDeg, dec: moon.decDeg },
      observer,
      date,
    );

    if (this.moonMesh) {
      this.scene.remove(this.moonMesh);
      this.moonMesh.geometry.dispose();
      (this.moonMesh.material as THREE.Material).dispose();
      this.moonMesh = null;
    }
    if (altDeg < -2) return; // below horizon — skip render

    // Render the moon as a flat disk on the sky sphere whose angular size matches.
    const angular = moon.diameterDeg * DEG;
    const radius = SKY_RADIUS * Math.tan(angular / 2);
    const geom = new THREE.CircleGeometry(radius, 64);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        // Phase angle in radians — 0 = full, ±π = new.
        uPhase: { value: moon.phaseAngleDeg * DEG },
        // Bright-limb position angle — orient the terminator correctly in image plane.
        uLimbAngle: { value: moon.brightLimbAngleDeg * DEG },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          // CircleGeometry's "uv" runs from (0,0) at corner to (1,1) at opposite corner —
          // remap to disk-coords in [-1,1]² with center 0.
          vUv = uv * 2.0 - vec2(1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uPhase;
        uniform float uLimbAngle;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          // Rotate uv so the bright-limb mid-point lies along +x.
          float cl = cos(uLimbAngle), sl = sin(uLimbAngle);
          vec2 r_uv = vec2(cl * vUv.x + sl * vUv.y, -sl * vUv.x + cl * vUv.y);
          // The terminator is the great circle at x = cos(phase) on the sphere when
          // projected onto the disk → the visible-illumination test is r_uv.x > cos(phase).
          float lit = step(cos(uPhase), r_uv.x);
          // Soft limb: smooth Lambertian fall-off near edge so it doesn't read like a coin.
          float limbSoft = pow(1.0 - r, 0.3);
          // Earthshine: faint glow on the dark side (~5% of full illumination).
          float earthshine = (1.0 - lit) * 0.05;
          // Lunar surface tone — slightly warm gray.
          vec3 col = vec3(0.95, 0.92, 0.85) * (lit * limbSoft + earthshine);
          gl_FragColor = vec4(col, lit + earthshine * 0.5);
        }
      `,
    });

    const mesh = new THREE.Mesh(geom, mat);
    const [x, y, z] = altAzToVector(altDeg, azDeg);
    mesh.position.set(x * SKY_RADIUS, y * SKY_RADIUS, z * SKY_RADIUS);
    // Orient the disk so its normal points back at the camera (origin).
    mesh.lookAt(0, 0, 0);
    this.scene.add(mesh);
    this.moonMesh = mesh;
  }

  private updateSkyBackground(): void {
    // At higher Bortle, the sky is no longer black — paint a faint background tint.
    // Mapping: Bortle 1 → near-black; Bortle 9 → urban orange-brown haze.
    const b = Math.max(1, Math.min(9, this.state.bortle));
    const t = (b - 1) / 8;
    const r = 0.0 + t * 0.06;
    const g = 0.0 + t * 0.04;
    const blue = 0.0 + t * 0.02;
    this.scene.background = new THREE.Color(r, g, blue);
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
