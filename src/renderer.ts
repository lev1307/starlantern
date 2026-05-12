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
import { BRIGHT_STARS, type Star } from "./catalog";
import type { Quat } from "./quaternion";
import {
  bvToRgb,
  magToFlux,
  extinctionMag,
  bortleLimitMag,
  scotopicSaturation,
  refractionDeg,
  scintillationAmplitude,
  effectiveLimitMag,
  twilightSkyMag,
} from "./astrophysics";
import { moonPosition, sunPosition } from "./moon";
import { allPlanetPositions } from "./planets";

const SKY_RADIUS = 100; // arbitrary — stars on a unit sphere look the same at any radius
const DEG = Math.PI / 180;

/** GLSL-equivalent smoothstep in JS. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface StereoState {
  /** Stereo (cardboard / phone-headmount) split-screen output enabled. */
  enabled: boolean;
  /** Interpupillary distance in metres. ~63 mm average adult; default 64 mm. */
  ipdM: number;
  /** Brown-Conrady radial barrel coefficient k1. ~0.20 cancels typical Cardboard pincushion. */
  k1: number;
  /** Brown-Conrady radial barrel coefficient k2 (quartic term). */
  k2: number;
  /** Chromatic-aberration correction: 0 = off, 0.02 = mild offset. */
  chromatic: number;
}

export interface RendererState {
  /** Heading correction slider, degrees added to compass alpha. */
  headingOffsetDeg: number;
  /** Bortle scale 1 (pristine) .. 9 (inner city). Drives sky-glow + faint-star wash. */
  bortle: number;
  /** Exposure scalar applied to the rendered star fluxes (1 = neutral). */
  exposure: number;
  /** Stereo / cardboard-headmount rendering options. */
  stereo: StereoState;
}

export class SkyRenderer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private starPoints: THREE.Points | null = null;
  private starWorldPositions: Float32Array | null = null;
  private cardinals: THREE.Group;
  private moonMesh: THREE.Mesh | null = null;
  private planetGroup: THREE.Group | null = null;
  private milkyWayMesh: THREE.Mesh | null = null;
  private milkyWayMaterial: THREE.ShaderMaterial | null = null;
  private moonGlowMaterial: THREE.ShaderMaterial | null = null;
  /** Sun altitude at the most recent setSky() call (degrees, refraction-uncorrected). */
  private currentSunAltDeg = -90;
  /** Currently active catalog (defaults to the bright fallback; replaced by setCatalog()). */
  private catalog: readonly Star[] = BRIGHT_STARS;

  /** Replace the rendered catalog (e.g. with the HYG 8920-star binary subset on load). */
  setCatalog(catalog: readonly Star[]): void {
    this.catalog = catalog;
  }
  state: RendererState = {
    headingOffsetDeg: 0,
    bortle: 4,
    exposure: 1.0,
    stereo: {
      enabled: false,
      ipdM: 0.064,
      k1: 0.22,
      k2: 0.05,
      chromatic: 0.01,
    },
  };

  // --- Stereo plumbing (lazy-initialised on first stereo render) -----------
  private leftCamera: THREE.PerspectiveCamera | null = null;
  private rightCamera: THREE.PerspectiveCamera | null = null;
  private leftRT: THREE.WebGLRenderTarget | null = null;
  private rightRT: THREE.WebGLRenderTarget | null = null;
  private barrelScene: THREE.Scene | null = null;
  private barrelCamera: THREE.OrthographicCamera | null = null;
  private barrelMaterial: THREE.ShaderMaterial | null = null;

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
    this.buildMilkyWay();
    this.buildMoonGlow();

    window.addEventListener("resize", this.onResize);
  }

  /**
   * Build the inside-out sky-sphere mesh that renders the procedural Milky
   * Way band. The fragment shader does the equatorial-to-galactic rotation
   * inline so we don't need to pre-bake a texture. Per-fragment density is
   * computed via the same model as src/galactic.ts milkyWayDensity().
   *
   * The mesh is added to the scene once at startup but its sidereal rotation
   * (equatorial ↔ altaz at the observer's local time) is applied each setSky()
   * via the mesh.quaternion — keeps the band locked to real sky as time passes.
   */
  private buildMilkyWay(): void {
    const radius = SKY_RADIUS * 0.95; // just inside the star sphere
    const geom = new THREE.SphereGeometry(radius, 64, 32);
    // Invert normals so we see the inside of the sphere.
    geom.scale(-1, 1, 1);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        // Bortle wash: at higher Bortle the MW is hidden by skyglow. Fades to
        // zero at Bortle ≥ 6 — matching real visibility data.
        uBortle: { value: 4 },
        // Twilight fade-out: when the sky is bright, the MW is invisible.
        // 0 = no twilight (full dark), 1 = daylight.
        uTwilight: { value: 0 },
      },
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vEq;
        void main() {
          // Mesh-local position is treated as an equatorial-frame direction.
          // The mesh's quaternion (set in updateMilkyWay() to equatorial->world)
          // takes care of placing the band correctly in altaz space; the shader
          // gets to do its RA/Dec math in the simpler equatorial frame.
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vEq = position;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vEq;
        uniform float uBortle;
        uniform float uTwilight;

        const float PI = 3.141592653589793;
        const float DEG = PI / 180.0;
        const float RAD = 180.0 / PI;

        // Galactic-frame conversion constants (same as src/galactic.ts).
        const float GNP_RA = 192.85948;
        const float GNP_DEC = 27.12825;
        const float L0 = 122.93192;

        // Convert a unit direction (ENU world frame after mesh quaternion lifts
        // equatorial to local altaz) → equatorial (RA, Dec). The mesh's own
        // quaternion is the inverse of altaz-from-equatorial, so the direction
        // we see in the fragment is already equatorial-aligned (RA along +X
        // through vernal equinox, Dec rising toward +Z).
        // To keep this self-contained the mesh quaternion handles the rotation;
        // here the input vWorldDir is presumed equatorial-aligned.
        vec2 dirToRaDec(vec3 d) {
          d = normalize(d);
          float dec = asin(clamp(d.z, -1.0, 1.0)) * RAD;
          float ra = atan(d.y, d.x) * RAD;
          if (ra < 0.0) ra += 360.0;
          return vec2(ra, dec);
        }

        vec2 raDecToGalactic(float raDeg, float decDeg) {
          float ra = raDeg * DEG;
          float dec = decDeg * DEG;
          float raN = GNP_RA * DEG;
          float decN = GNP_DEC * DEG;
          float sinB = sin(dec) * sin(decN) + cos(dec) * cos(decN) * cos(ra - raN);
          float b = asin(clamp(sinB, -1.0, 1.0));
          float y = cos(dec) * sin(ra - raN);
          float x = sin(dec) * cos(decN) - cos(dec) * sin(decN) * cos(ra - raN);
          float l = L0 - atan(y, x) * RAD;
          l = mod(l, 360.0);
          if (l < 0.0) l += 360.0;
          return vec2(l, b * RAD);
        }

        float mwDensity(float lDeg, float bDeg) {
          float l = mod(lDeg + 180.0, 360.0) - 180.0;
          float b = bDeg;
          float sech = 1.0 / cosh(b / 4.0);
          float disc = sech * sech;
          float lradians = l * DEG;
          float longBulge = 0.55 + 0.45 * cos(lradians);
          float cellL = floor(l * 0.5);
          float cellB = floor(b * 0.5);
          float h = sin(cellL * 12.9898 + cellB * 78.233) * 43758.5453;
          float noise = h - floor(h);
          float mottle = 0.7 + 0.3 * noise;
          return disc * longBulge * mottle;
        }

        void main() {
          vec2 raDec = dirToRaDec(vEq);
          vec2 lb = raDecToGalactic(raDec.x, raDec.y);
          float density = mwDensity(lb.x, lb.y);

          // Bortle fade: at Bortle ≥ 6 the MW washes out completely.
          float bortleFade = clamp(1.0 - (uBortle - 1.0) / 5.0, 0.0, 1.0);
          // Twilight fade: at twilight > ~0.3 the MW is invisible.
          float twilightFade = clamp(1.0 - uTwilight * 3.0, 0.0, 1.0);

          float intensity = density * 0.07 * bortleFade * twilightFade;
          // Slightly warm grey-blue tint — real MW reads cooler than starlight
          // because of the integrated K-giant + dust extinction balance.
          vec3 col = vec3(0.55, 0.6, 0.72) * intensity;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // Render before everything else (background).
    mesh.renderOrder = -10;
    this.scene.add(mesh);
    this.milkyWayMesh = mesh;
    this.milkyWayMaterial = mat;
  }

  /**
   * Build the moon-glow sphere. A bright moon scatters Rayleigh-blue light
   * through the atmosphere, brightening the sky around it (and globally) by
   * 1-4 magnitudes — enough to wash out the Milky Way and faint stars.
   * Krisciunas & Schaefer 1991 gives a quantitative model; we use a simplified
   * geometry-only approximation that's good enough for naked-eye perception:
   *
   *   intensity(d) = illum · airmass-factor(moon) · scatter(angle(d, moon))
   *
   * with `scatter` = (0.4 + 0.6·cos) broad Rayleigh + a forward-scattering halo
   * exp(50·(cos − 1)) right around the moon disc. Additive blended on top of
   * the sky background.
   */
  private buildMoonGlow(): void {
    const radius = SKY_RADIUS * 0.96;
    const geom = new THREE.SphereGeometry(radius, 48, 24);
    geom.scale(-1, 1, 1);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uIllum: { value: 0 },
        uMoonAlt: { value: -1 },
        uSunDir: { value: new THREE.Vector3(0, -1, 0) },
        uTwilight: { value: 0 },
        uBortle: { value: 4 },
      },
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vWorldDir = (modelMatrix * vec4(position, 1.0)).xyz;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorldDir;
        uniform vec3 uMoonDir;
        uniform float uIllum;
        uniform float uMoonAlt;
        uniform vec3 uSunDir;
        uniform float uTwilight;
        uniform float uBortle;

        void main() {
          vec3 d = normalize(vWorldDir);
          float altSin = d.y; // sin(altitude) in world frame (Y up)

          vec3 total = vec3(0.0);

          // -- Moon-scattered light --------------------------------------------
          if (uIllum > 0.001 && uMoonAlt > -0.05) {
            float cm = clamp(dot(d, normalize(uMoonDir)), -1.0, 1.0);
            float rayleighM = max(0.4 + 0.6 * cm, 0.0);
            float forwardM = exp((cm - 1.0) * 50.0);
            float scatterM = rayleighM + 0.8 * forwardM;
            float moonFactor = clamp(uMoonAlt + 0.1, 0.0, 1.0);
            float upFactorM = 1.0 - 0.4 * max(altSin, 0.0);
            float iM = uIllum * moonFactor * scatterM * upFactorM * 0.06;
            total += vec3(0.55, 0.6, 0.78) * iM;
          }

          // -- Twilight (sun-direction-aware) ----------------------------------
          if (uTwilight > 0.01) {
            float cs = clamp(dot(d, normalize(uSunDir)), -1.0, 1.0);
            // Anti-solar side stays darker even during civil twilight.
            float scatterS = 0.35 + 0.65 * max(cs, 0.0);
            // Twilight always glows brightest toward the horizon — sky is darker overhead.
            float horizonGain = 1.2 - 0.6 * clamp(altSin, 0.0, 1.0);
            float iS = uTwilight * scatterS * horizonGain * 0.7;
            // Twilight palette: deep blue → cyan → pink as sun rises.
            vec3 twCol = mix(
              vec3(0.05, 0.10, 0.30),      // astronomical twilight
              vec3(0.70, 0.40, 0.45),      // civil twilight horizon
              clamp(uTwilight - 0.4, 0.0, 0.6) / 0.6
            );
            total += twCol * iS;
          }

          // -- Light pollution horizon dome (altitude-dependent only) ----------
          float bortleNorm = clamp((uBortle - 1.0) / 8.0, 0.0, 1.0);
          if (bortleNorm > 0.0 && altSin > -0.05) {
            // Dome that's strong near the horizon and fades quickly with altitude.
            float horizonProx = pow(1.0 - clamp(altSin, 0.0, 1.0), 3.0);
            float iLP = bortleNorm * horizonProx * 0.4;
            // Urban sodium-vapour tint (warm orange-brown).
            total += vec3(0.55, 0.40, 0.18) * iLP;
          }

          gl_FragColor = vec4(total, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = -9;
    this.scene.add(mesh);
    this.moonGlowMaterial = mat;
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
    const catalog = this.catalog;
    const positions = new Float32Array(catalog.length * 3);
    const fluxes = new Float32Array(catalog.length);
    const colors = new Float32Array(catalog.length * 3);
    const twinkleAmps = new Float32Array(catalog.length);
    const twinklePhases = new Float32Array(catalog.length);
    // Sun position drives twilight darkening — when the sun is up or in civil
    // twilight, only the very brightest stars can punch through the sky glow.
    const sun = sunPosition(date);
    const sunAa = equatorialToAltAz(
      { ra: sun.raDeg, dec: sun.decDeg },
      observer,
      date,
    );
    const sunAltDeg = sunAa.altDeg;
    this.currentSunAltDeg = sunAltDeg;
    if (this.moonGlowMaterial) {
      const [sx, sy, sz] = altAzToVector(sunAa.altDeg, sunAa.azDeg);
      this.moonGlowMaterial.uniforms["uSunDir"]!.value.set(sx, sy, sz);
    }
    const limitMag = effectiveLimitMag(this.state.bortle, sunAltDeg);
    // Avoid a vestigial reference to the imported bortleLimitMag (kept for callers).
    void bortleLimitMag;

    for (let i = 0; i < catalog.length; i++) {
      const s = catalog[i]!;
      const { altDeg, azDeg } = equatorialToAltAz(
        { ra: s.ra, dec: s.dec },
        observer,
        date,
      );
      // Atmospheric refraction lifts apparent altitude near the horizon by up to
      // ~34 arcmin — bend the rendered position to match what the eye actually sees.
      const altApparent = altDeg + refractionDeg(altDeg);
      const [x, y, z] = altAzToVector(altApparent, azDeg);
      positions[i * 3 + 0] = x * SKY_RADIUS;
      positions[i * 3 + 1] = y * SKY_RADIUS;
      positions[i * 3 + 2] = z * SKY_RADIUS;

      // Atmospheric extinction by altitude.
      const apparentMag = s.mag + extinctionMag(altDeg);
      // Drop stars fainter than the Bortle limit (with a 0.5-mag soft taper).
      const visibility = 1 - smoothstep(limitMag - 0.5, limitMag, apparentMag);
      const flux = magToFlux(apparentMag) * visibility * this.state.exposure;
      fluxes[i] = flux;

      // Per-star twinkle: amplitude grows with airmass; deterministic phase keeps
      // adjacent stars from blinking in sync (would read as artificial).
      twinkleAmps[i] = scintillationAmplitude(altDeg);
      // Hash RA+Dec to a stable per-star phase ∈ [0, 2π).
      twinklePhases[i] =
        (((s.ra * 13.37 + s.dec * 7.91) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI);

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
    geometry.setAttribute(
      "twinkleAmp",
      new THREE.BufferAttribute(twinkleAmps, 1),
    );
    geometry.setAttribute(
      "twinklePhase",
      new THREE.BufferAttribute(twinklePhases, 1),
    );

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uTime: { value: 0 }, // updated every frame in render()
      },
      vertexShader: /* glsl */ `
        attribute float flux;
        attribute float twinkleAmp;
        attribute float twinklePhase;
        varying vec3 vColor;
        varying float vFlux;
        uniform float uPixelRatio;
        uniform float uTime;
        void main() {
          // Twinkle: superpose 3 incommensurate frequencies (2.1, 3.7, 5.9 Hz) so
          // each star has its own quasi-random shimmer. Aggregate amplitude is
          // twinkleAmp (set per-star from airmass-driven scintillation).
          float t = uTime;
          float ph = twinklePhase;
          float modulation =
              0.5 * sin(t * 2.1 + ph)
            + 0.3 * sin(t * 3.7 + ph * 1.7)
            + 0.2 * sin(t * 5.9 + ph * 0.9);
          float fluxMod = flux * (1.0 + twinkleAmp * modulation);
          vColor = color;
          vFlux = fluxMod;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // PSF radius scales with √flux up to a cap — same flux distributed over
          // a wider area gives a brighter, larger blur, matching the eye's PSF response.
          float radius = clamp(2.0 + 6.0 * sqrt(max(fluxMod, 0.0001)), 2.0, 18.0);
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
    this.updatePlanets(observer, date);
    this.updateMilkyWay(observer, date, sunAltDeg);
    this.updateSkyBackground();
  }

  /**
   * Aim the Milky Way background sphere so its built-in equatorial-frame shader
   * lines up with the local altaz frame at this observer + time. We compute the
   * 3x3 rotation matrix whose columns are the world-frame ENU images of the
   * equatorial basis vectors, then convert to a quaternion.
   */
  private updateMilkyWay(
    observer: Observer,
    date: Date,
    sunAltDeg: number,
  ): void {
    if (!this.milkyWayMesh || !this.milkyWayMaterial) return;

    // Columns of the rotation matrix = ENU images of (vernal-equinox, +90°-east, NCP).
    const eqBasis: Array<{ ra: number; dec: number }> = [
      { ra: 0, dec: 0 }, // +X_eq
      { ra: 90, dec: 0 }, // +Y_eq
      { ra: 0, dec: 90 }, // +Z_eq (north celestial pole)
    ];
    const cols: THREE.Vector3[] = eqBasis.map((b) => {
      const aa = equatorialToAltAz({ ra: b.ra, dec: b.dec }, observer, date);
      const [x, y, z] = altAzToVector(aa.altDeg, aa.azDeg);
      return new THREE.Vector3(x, y, z);
    });
    const mat = new THREE.Matrix4().makeBasis(cols[0]!, cols[1]!, cols[2]!);
    this.milkyWayMesh.quaternion.setFromRotationMatrix(mat);

    // Uniforms: Bortle fades the MW out under skyglow; twilight likewise.
    this.milkyWayMaterial.uniforms["uBortle"]!.value = this.state.bortle;
    // Twilight: same shape as updateSkyBackground (0 at sun ≤ -18°, 1 at sun ≥ 0).
    let twilight: number;
    if (sunAltDeg <= -18) twilight = 0;
    else if (sunAltDeg >= 0) twilight = 1;
    else twilight = (sunAltDeg + 18) / 18;
    this.milkyWayMaterial.uniforms["uTwilight"]!.value = twilight;
  }

  /** Place the moon on the sky sphere with the current phase / illumination. */
  private updateMoon(observer: Observer, date: Date): void {
    const moon = moonPosition(date);
    const { altDeg, azDeg } = equatorialToAltAz(
      { ra: moon.raDeg, dec: moon.decDeg },
      observer,
      date,
    );

    // Update the moon-glow scattering shader regardless of horizon — below-horizon
    // moons still contribute slight forward scatter just above the horizon.
    if (this.moonGlowMaterial) {
      const altApp = altDeg + refractionDeg(altDeg);
      const [mx, my, mz] = altAzToVector(altApp, azDeg);
      this.moonGlowMaterial.uniforms["uMoonDir"]!.value.set(mx, my, mz);
      this.moonGlowMaterial.uniforms["uIllum"]!.value = moon.illumination;
      this.moonGlowMaterial.uniforms["uMoonAlt"]!.value = Math.sin(
        (altDeg * Math.PI) / 180,
      );
    }

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
        // Earthshine intensity — Earth's illumination fraction as seen from the
        // Moon, which is the complement of the Moon's own illuminated fraction.
        // Brightest near new moon (phase ≈ ±180°), invisible near full.
        // Scale 0.06 = "very faint glow on the dark side" — matches naked-eye
        // visual: easily seen during waxing/waning crescent in clear dark sky.
        uEarthshine: { value: 0.06 * (1 - moon.illumination) },
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
        uniform float uEarthshine;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float cl = cos(uLimbAngle), sl = sin(uLimbAngle);
          vec2 r_uv = vec2(cl * vUv.x + sl * vUv.y, -sl * vUv.x + cl * vUv.y);
          float lit = step(cos(uPhase), r_uv.x);
          float limbSoft = pow(1.0 - r, 0.3);
          // Earthshine on the dark hemisphere; intensity from JS-side uniform
          // (driven by 1 − moon-illumination → near-zero at full, ~6 % at new).
          float earthshine = (1.0 - lit) * uEarthshine;
          // Lunar surface tone — slightly warm gray; earthshine is a touch bluer
          // because the light comes from the daytime Earth's blue sky.
          vec3 litCol = vec3(0.95, 0.92, 0.85) * lit * limbSoft;
          vec3 darkCol = vec3(0.55, 0.65, 0.78) * earthshine;
          gl_FragColor = vec4(litCol + darkCol, lit + earthshine * 1.2);
        }
      `,
    });

    const mesh = new THREE.Mesh(geom, mat);
    // Refraction lifts the apparent altitude of the moon near the horizon by ~30'.
    const altApp = altDeg + refractionDeg(altDeg);
    const [x, y, z] = altAzToVector(altApp, azDeg);
    mesh.position.set(x * SKY_RADIUS, y * SKY_RADIUS, z * SKY_RADIUS);
    mesh.lookAt(0, 0, 0);
    this.scene.add(mesh);
    this.moonMesh = mesh;
  }

  /**
   * Place visible naked-eye planets on the sky sphere. Each planet is a small
   * sprite-style coloured disc sized in screen-pixels by its apparent angular
   * diameter; with no PSF for the disc itself (the rendered disc is the body's
   * geometric image, not a star-like glint). Brightness scales with apparent
   * magnitude via the same Pogson flux as stars.
   */
  private updatePlanets(observer: Observer, date: Date): void {
    if (this.planetGroup) {
      this.scene.remove(this.planetGroup);
      this.planetGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.planetGroup = null;
    }

    const group = new THREE.Group();
    const planets = allPlanetPositions(date);

    for (const p of planets) {
      const { altDeg, azDeg } = equatorialToAltAz(
        { ra: p.raDeg, dec: p.decDeg },
        observer,
        date,
      );
      if (altDeg < -2) continue; // below horizon — skip

      // Apparent magnitude → flux scalar (Pogson, same as stars), with airmass extinction.
      const apparentMag = p.mag + extinctionMag(altDeg);
      const flux = magToFlux(apparentMag) * this.state.exposure;

      // Angular size on the sky sphere: arcseconds → radians → tan → SKY_RADIUS·tan.
      // Naked-eye disc resolution is ~1', so most planets read as bright points
      // until you zoom; render at max(disc_radius, point-PSF_radius) so they
      // don't disappear under the planet shader.
      const angRad = (p.angularDiameterArcsec / 3600) * DEG;
      const physRadius = Math.max(0.6, SKY_RADIUS * Math.tan(angRad / 2));

      const geom = new THREE.CircleGeometry(physRadius, 32);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: {
            value: new THREE.Vector3(p.color[0], p.color[1], p.color[2]),
          },
          uFlux: { value: flux },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - vec2(1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform vec3 uColor;
          uniform float uFlux;
          void main() {
            float r2 = dot(vUv, vUv);
            if (r2 > 1.0) discard;
            // Sharper edge than a star PSF — planets are spatially resolved discs.
            float core = pow(1.0 - r2, 1.5);
            float halo = 0.25 * exp(-r2 * 4.0);
            float intensity = clamp(core + halo, 0.0, 1.0);
            float alpha = intensity * clamp(uFlux, 0.0, 8.0);
            if (alpha < 0.002) discard;
            gl_FragColor = vec4(uColor * intensity, alpha);
          }
        `,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const altApp = altDeg + refractionDeg(altDeg);
      const [x, y, z] = altAzToVector(altApp, azDeg);
      mesh.position.set(x * SKY_RADIUS, y * SKY_RADIUS, z * SKY_RADIUS);
      mesh.lookAt(0, 0, 0);
      mesh.userData["name"] = p.name;
      mesh.userData["mag"] = p.mag;
      group.add(mesh);
    }

    this.scene.add(group);
    this.planetGroup = group;
  }

  private updateSkyBackground(): void {
    // Solid base: pure black. All directional sky-glow (twilight, light
    // pollution, moon-scattered light) is now done in the moonGlowMaterial
    // sphere's fragment shader so it can be direction-aware.
    this.scene.background = new THREE.Color(0, 0, 0);

    if (this.moonGlowMaterial) {
      // Sun direction in world frame (refraction-uncorrected — needed for
      // twilight asymmetry, not for an actually-visible sun).
      // We don't have observer/date here, but currentSunAltDeg is stored and the
      // moon-glow shader doesn't need a precise sun direction below the horizon;
      // we approximate using azimuth=180° (south) for northern observers.
      // (A full implementation would route the sun's altaz like the moon's.)
      const sunAlt = this.currentSunAltDeg;
      let twilight: number;
      if (sunAlt <= -18) twilight = 0;
      else if (sunAlt >= 0) twilight = 1;
      else twilight = (sunAlt + 18) / 18;

      this.moonGlowMaterial.uniforms["uTwilight"]!.value = twilight;
      this.moonGlowMaterial.uniforms["uBortle"]!.value = this.state.bortle;
    }
    // Keep imports referenced even when not directly used in JS body.
    void twilightSkyMag;
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
  /**
   * Where the camera pose comes from. 'sensor' = DeviceOrientation (+ optional lock).
   * 'ekf' = main.ts injects an absolute quaternion via setCameraQuaternion() each frame.
   */
  cameraSource: "sensor" | "ekf" = "sensor";

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

    // In 'ekf' mode the camera is driven externally; we only update qDevice so the
    // EKF can still receive DeviceOrientation as a noisy absolute measurement.
    if (this.cameraSource === "ekf") return;

    if (this.hasLock) {
      // q_camera = qLock · qDevice
      const out = this.qLock.clone().multiply(q);
      this.camera.quaternion.copy(out);
    } else {
      this.camera.quaternion.copy(q);
    }
  }

  /** Directly set the camera's world quaternion. Used when cameraSource === 'ekf'. */
  setCameraQuaternion(q: Quat): void {
    this.camera.quaternion.set(q[1], q[2], q[3], q[0]);
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
    let bestNamedI = -1;
    let bestNamedDot = -2;
    const v = new THREE.Vector3();
    const inv = 1 / SKY_RADIUS;
    const arr = this.starWorldPositions;
    const cat = this.catalog;
    for (let i = 0; i < cat.length; i++) {
      v.set(arr[i * 3]! * inv, arr[i * 3 + 1]! * inv, arr[i * 3 + 2]! * inv);
      const d = forward.dot(v);
      if (d > bestDot) {
        bestDot = d;
        bestI = i;
      }
      // Prefer named stars for the HUD readout when they're reasonably close
      // (within ~15° of view centre) — picker results like "HYG-12345" aren't
      // useful for the calibration UX.
      if (
        cat[i]!.name &&
        d > bestNamedDot &&
        d > Math.cos((15 * Math.PI) / 180)
      ) {
        bestNamedDot = d;
        bestNamedI = i;
      }
    }
    const useI = bestNamedI >= 0 ? bestNamedI : bestI;
    const useDot = bestNamedI >= 0 ? bestNamedDot : bestDot;
    if (useI < 0) return null;
    const angle =
      Math.acos(Math.max(-1, Math.min(1, useDot))) * (180 / Math.PI);
    const name = cat[useI]!.name ?? `mag ${cat[useI]!.mag.toFixed(1)} star`;
    return { name, angleDeg: angle };
  }

  render(): void {
    // Drive the per-star twinkle modulation (in seconds, fractional).
    if (this.starPoints) {
      const m = this.starPoints.material as THREE.ShaderMaterial;
      if (m.uniforms["uTime"]) {
        m.uniforms["uTime"]!.value = performance.now() / 1000;
      }
    }
    if (this.state.stereo.enabled) {
      this.renderStereo();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Cardboard-style side-by-side stereo with per-eye barrel-distortion post-process.
   * Layout:
   *   - Offscreen RT shaped like the canvas. Left half = left-eye scene, right half = right-eye.
   *   - Two cameras parented to (and following the orientation of) `this.camera`, offset
   *     by ±IPD/2 along the local +X (right) axis.
   *   - Fullscreen quad samples the RT and applies a Brown-Conrady barrel warp per half,
   *     with optional per-channel chromatic offset for cheap RGB-aberration correction.
   */
  private renderStereo(): void {
    this.ensureStereoResources();

    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    const halfW = Math.floor(w / 2);

    // Resize per-eye render targets if the canvas dimensions changed.
    if (
      this.leftRT &&
      (this.leftRT.width !== halfW || this.leftRT.height !== h)
    ) {
      this.leftRT.setSize(halfW, h);
      this.rightRT!.setSize(halfW, h);
    }

    // Sync stereo cameras from the head pose (= this.camera).
    const { ipdM } = this.state.stereo;
    const aspect = halfW / Math.max(1, h);

    for (const eye of ["left", "right"] as const) {
      const cam = eye === "left" ? this.leftCamera! : this.rightCamera!;
      cam.aspect = aspect;
      cam.fov = this.camera.fov;
      cam.near = this.camera.near;
      cam.far = this.camera.far;
      cam.updateProjectionMatrix();
      cam.quaternion.copy(this.camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        this.camera.quaternion,
      );
      const offset = (eye === "left" ? -1 : 1) * (ipdM / 2);
      cam.position.copy(this.camera.position).add(right.multiplyScalar(offset));
    }

    // Render each eye into its own render target. Each RT is halfW × h, so the
    // camera projection naturally fills it without viewport gymnastics.
    this.renderer.setRenderTarget(this.leftRT!);
    this.renderer.render(this.scene, this.leftCamera!);

    this.renderer.setRenderTarget(this.rightRT!);
    this.renderer.render(this.scene, this.rightCamera!);

    // Update barrel shader uniforms.
    const m = this.barrelMaterial!;
    m.uniforms["uK1"]!.value = this.state.stereo.k1;
    m.uniforms["uK2"]!.value = this.state.stereo.k2;
    m.uniforms["uChroma"]!.value = this.state.stereo.chromatic;
    m.uniforms["uLeftTex"]!.value = this.leftRT!.texture;
    m.uniforms["uRightTex"]!.value = this.rightRT!.texture;

    // Present barrel-distorted output to the canvas.
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.barrelScene!, this.barrelCamera!);
  }

  private ensureStereoResources(): void {
    if (this.leftRT) return;
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    const halfW = Math.floor(w / 2);

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.leftRT = new THREE.WebGLRenderTarget(halfW, h, rtOpts);
    this.rightRT = new THREE.WebGLRenderTarget(halfW, h, rtOpts);

    this.leftCamera = this.camera.clone();
    this.rightCamera = this.camera.clone();

    this.barrelScene = new THREE.Scene();
    this.barrelCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.barrelMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uLeftTex: { value: null },
        uRightTex: { value: null },
        uK1: { value: this.state.stereo.k1 },
        uK2: { value: this.state.stereo.k2 },
        uChroma: { value: this.state.stereo.chromatic },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uLeftTex;
        uniform sampler2D uRightTex;
        uniform float uK1;
        uniform float uK2;
        uniform float uChroma;

        // Apply Brown-Conrady barrel warp centred on (0.5, 0.5) of the eye's RT.
        // halfUv is in [0,1]² over the eye's RT (the RT is already half-canvas wide).
        // Returns (r, g, b, mask) where mask = 1 if the warped UV is in range, else 0.
        vec4 sampleEye(vec2 halfUv, sampler2D tex, float k1) {
          vec2 c = halfUv - vec2(0.5);
          float r2 = dot(c, c);
          float factor = 1.0 + k1 * r2 + uK2 * r2 * r2;
          vec2 warped = c * factor + vec2(0.5);
          if (any(lessThan(warped, vec2(0.0))) || any(greaterThan(warped, vec2(1.0)))) {
            return vec4(0.0);
          }
          return texture2D(tex, warped);
        }

        void main() {
          bool isRight = vUv.x >= 0.5;
          // halfUv in [0,1]² over the eye's RT.
          vec2 halfUv = vec2((isRight ? (vUv.x - 0.5) : vUv.x) * 2.0, vUv.y);

          // Chromatic aberration: slightly different k1 per colour channel.
          float kR = uK1 * (1.0 - uChroma);
          float kG = uK1;
          float kB = uK1 * (1.0 + uChroma);

          float r, g, b;
          if (isRight) {
            r = sampleEye(halfUv, uRightTex, kR).r;
            g = sampleEye(halfUv, uRightTex, kG).g;
            b = sampleEye(halfUv, uRightTex, kB).b;
          } else {
            r = sampleEye(halfUv, uLeftTex, kR).r;
            g = sampleEye(halfUv, uLeftTex, kG).g;
            b = sampleEye(halfUv, uLeftTex, kB).b;
          }
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `,
    });

    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.barrelMaterial,
    );
    this.barrelScene.add(quad);
  }

  /** Attempt to enter an `immersive-vr` WebXR session. Returns true on success. */
  async tryEnterImmersiveVr(): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) return false;
    try {
      const supported = await xr.isSessionSupported("immersive-vr");
      if (!supported) return false;
      const session = await xr.requestSession("immersive-vr");
      this.renderer.xr.enabled = true;
      await this.renderer.xr.setSession(session);
      return true;
    } catch {
      return false;
    }
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
