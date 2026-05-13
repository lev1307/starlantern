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
  chromaticExtinction,
  airmass,
} from "./astrophysics";
import { moonPosition, sunPosition } from "./moon";
import { allPlanetPositions } from "./planets";
import { visibleSatellites } from "./satellites";
import { NAKED_EYE_DSO, type NakedEyeDSO } from "./dso";
import { sampleNewMeteors, type MeteorSpec } from "./meteors";
import { auroralVisibility } from "./aurora";

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
  /** Planetary K geomagnetic activity index 0..9. Drives auroral oval extent. */
  kp: number;
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
  private satelliteGroup: THREE.Group | null = null;
  private dsoGroup: THREE.Group | null = null;
  private meteorGroup: THREE.Group | null = null;
  private activeMeteors: Array<{ spec: MeteorSpec; mesh: THREE.Mesh }> = [];
  private lastMeteorSampleMs = 0;
  private auroraMaterial: THREE.ShaderMaterial | null = null;
  /** Observer most recently passed to setSky(); used by per-frame satellite update. */
  private lastObserver: Observer | null = null;
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
    kp: 3,
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
    this.buildAurora();

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
        // Sun's ecliptic longitude (degrees) drives the zodiacal-light cone.
        uSunEclipticLon: { value: 0 },
        // Mean obliquity for the equatorial→ecliptic rotation in the shader.
        uObliquityRad: { value: (23.4393 * Math.PI) / 180 },
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
        uniform float uSunEclipticLon;
        uniform float uObliquityRad;

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

        // Equatorial direction → ecliptic (lambda, beta) in degrees.
        vec2 dirToEcliptic(vec3 dEq, float epsRad) {
          float cosE = cos(epsRad), sinE = sin(epsRad);
          // Rotation about equatorial +X by -epsilon (eq → ecliptic).
          vec3 e = vec3(dEq.x, dEq.y * cosE + dEq.z * sinE, -dEq.y * sinE + dEq.z * cosE);
          e = normalize(e);
          float beta = asin(clamp(e.z, -1.0, 1.0)) * RAD;
          float lambda = atan(e.y, e.x) * RAD;
          lambda = mod(lambda + 360.0, 360.0);
          return vec2(lambda, beta);
        }

        // Zodiacal-light density (dimensionless). Strong cone along the ecliptic
        // toward the sun, weak gegenschein bump at the anti-solar point.
        float zodiacalDensity(float lambdaDeg, float betaDeg, float sunLonDeg) {
          float dLambda = mod(lambdaDeg - sunLonDeg + 540.0, 360.0) - 180.0; // (-180, 180]
          float absDL = abs(dLambda);
          // Vertical fall-off off the ecliptic — sech² with scale-height ~ 18°.
          float sech = 1.0 / cosh(betaDeg / 18.0);
          float discProf = sech * sech;
          // Longitudinal: bright near sun, falling sharply with elongation.
          float coneCore = 0.5 / max(absDL, 5.0);
          // Gegenschein: ~3-4° wide Gaussian at 180° elongation.
          float anti = absDL - 180.0;
          float gegen = 0.4 * exp(-anti * anti / 18.0);
          return discProf * (coneCore + gegen);
        }

        void main() {
          vec3 vEqn = normalize(vEq);
          vec2 raDec = dirToRaDec(vEqn);
          vec2 lb = raDecToGalactic(raDec.x, raDec.y);
          float density = mwDensity(lb.x, lb.y);

          float bortleFade = clamp(1.0 - (uBortle - 1.0) / 5.0, 0.0, 1.0);
          float twilightFade = clamp(1.0 - uTwilight * 3.0, 0.0, 1.0);

          float mwIntensity = density * 0.07 * bortleFade * twilightFade;
          vec3 mwCol = vec3(0.55, 0.6, 0.72) * mwIntensity;

          // Zodiacal light — only meaningful at very dark sites (Bortle ≤ 3) and
          // in the absence of strong twilight. Same fade gates as the MW.
          vec2 ecl = dirToEcliptic(vEqn, uObliquityRad);
          float zod = zodiacalDensity(ecl.x, ecl.y, uSunEclipticLon);
          float zodIntensity = zod * 0.04 * bortleFade * twilightFade;
          // Zodiacal dust scatters sunlight near-white with a faint yellow tint.
          vec3 zodCol = vec3(0.95, 0.92, 0.78) * zodIntensity;

          gl_FragColor = vec4(mwCol + zodCol, 1.0);
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
            float horizonProx = pow(1.0 - clamp(altSin, 0.0, 1.0), 3.0);
            float iLP = bortleNorm * horizonProx * 0.4;
            total += vec3(0.55, 0.40, 0.18) * iLP;
          }

          // -- Belt of Venus + Earth's shadow ----------------------------------
          // During civil twilight (sun -2° to -8°), the anti-solar horizon hosts
          // two stacked bands: a pink-rose "Belt of Venus" (backscattered sunlight
          // reddened by the lower atmosphere) sitting above a darker grey-blue
          // "Earth's shadow" cast on the atmosphere itself. The band rises
          // proportionally as the sun sinks lower — at sun = -2° the belt is
          // 0-5° above the horizon, by sun = -8° it has lifted to ~8-15°.
          if (uTwilight > 0.05 && uTwilight < 0.55) {
            // Map twilight (0..1, with 1=day) → "civil-window" weight [0..1] that
            // peaks at the most pronounced Belt-of-Venus moment.
            // Civil twilight = sun in (-6°, 0°) → uTwilight in (0.667, 1.0).
            // Belt of Venus is most striking just after sunset → uTwilight ~0.55.
            float belt = 1.0 - abs(uTwilight - 0.45) / 0.25;
            belt = clamp(belt, 0.0, 1.0);
            // Anti-solar direction (opposite of uSunDir).
            float antiSun = clamp(-dot(d, normalize(uSunDir)), -1.0, 1.0);
            // The bands only appear opposite the sun (antiSun > ~0.3).
            float antiBand = smoothstep(0.2, 0.8, antiSun);
            // Altitude profile: shadow is 0-3° above horizon, belt 3-10°, fading by 15°.
            float altDeg = asin(clamp(altSin, -1.0, 1.0)) * 57.2957795;
            // Earth-shadow band (subtractive — darker than ambient): 0-3° alt.
            float shadow = smoothstep(3.0, 0.0, altDeg) * smoothstep(0.0, 1.0, altDeg + 1.0);
            // Belt-of-Venus band (additive pink): 3-10° alt.
            float beltAlt = smoothstep(2.0, 5.0, altDeg) * smoothstep(15.0, 6.0, altDeg);
            float iBelt = belt * antiBand * beltAlt * 0.18;
            total += vec3(0.90, 0.55, 0.65) * iBelt;
            // Earth's shadow is a slight blue-grey subtraction from the
            // twilight gradient — we model it as a small darkening factor
            // applied to the (already-accumulated) twilight contribution.
            float iShadow = belt * antiBand * shadow * 0.35;
            total *= (1.0 - iShadow);
          }

          // -- Air-glow ---------------------------------------------------------
          // Faint chemiluminescent emission from O2 / OH in the upper atmosphere,
          // present even at perfect dark sites (~mag 23 / arcsec² zenith). Reads
          // greenish-yellow to the dark-adapted eye; brighter near horizon
          // because the line of sight intercepts more emitting layer.
          if (uTwilight < 0.2) {
            float air = (1.0 - uTwilight * 5.0);
            // sec(zenith angle) — capped — gives the path-length enhancement.
            float secZ = 1.0 / max(altSin + 0.07, 0.07);
            secZ = min(secZ, 6.0);
            // Less air-glow at high Bortle — it's drowned by city light, not
            // physically suppressed, but the eye can't pick it out.
            float bortleSuppress = 1.0 - bortleNorm * 0.7;
            float iAir = 0.011 * air * secZ * bortleSuppress;
            total += vec3(0.18, 0.27, 0.20) * iAir;
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
    this.lastObserver = observer;
    const catalog = this.catalog;
    const positions = new Float32Array(catalog.length * 3);
    const fluxes = new Float32Array(catalog.length);
    const colors = new Float32Array(catalog.length * 3);
    const twinkleAmps = new Float32Array(catalog.length);
    const twinklePhases = new Float32Array(catalog.length);
    // Per-star atmospheric chromatic dispersion strength. Very bright stars near
    // the horizon (Sirius rising, Capella low in autumn) visibly split into
    // red-and-blue components because differential refraction shifts blue ~30"
    // higher than red at altitude 10°. Faint stars don't show it (eye can't
    // resolve the split below mag ~1).
    const dispersions = new Float32Array(catalog.length);
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

      // Chromatic dispersion: scales as (sec(z) - 1) for the differential
      // refraction part, gated by brightness (only the bright stars show it).
      // Cap below altitude 30° — vanishes by zenith.
      const cosZ = Math.max(0.05, Math.sin(Math.max(0.5, altDeg) * DEG));
      const secMinus1 = 1 / cosZ - 1;
      const brightFactor = s.mag < 1.5 ? 1 : s.mag < 2.5 ? 0.4 : 0;
      dispersions[i] = Math.min(1, secMinus1 * 0.6) * brightFactor;
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
      // Wavelength-dependent atmospheric extinction: blue is scattered more
      // than red, so a star near the horizon reddens visibly. Per-channel
      // multipliers ∈ (0, 1]; multiply after scotopic mixing so the existing
      // PSF intensity already encodes the V-band total flux.
      const [eR, eG, eB] = chromaticExtinction(altDeg);
      // Normalise out the V-band part already baked into `flux` (we used
      // extinctionMag at V-band above), keeping only the *color shift*.
      const eV = altDeg > 0 ? Math.pow(10, -0.4 * 0.28 * airmass(altDeg)) : 1;
      const mR = eR / Math.max(eV, 1e-6);
      const mG = eG / Math.max(eV, 1e-6);
      const mB = eB / Math.max(eV, 1e-6);
      colors[i * 3 + 0] = (NEUTRAL_R + sat * (cr - NEUTRAL_R)) * mR;
      colors[i * 3 + 1] = (NEUTRAL_G + sat * (cg - NEUTRAL_G)) * mG;
      colors[i * 3 + 2] = (NEUTRAL_B + sat * (cb - NEUTRAL_B)) * mB;
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
    geometry.setAttribute(
      "dispersion",
      new THREE.BufferAttribute(dispersions, 1),
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
        attribute float dispersion;
        varying vec3 vColor;
        varying float vFlux;
        varying float vDispersion;
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
          vDispersion = dispersion;
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
        varying float vDispersion;
        // Moffat-profile core+halo+glare evaluated at offset gl_PointCoord. Used
        // per channel so chromatic dispersion can shift each color separately.
        float psfIntensity(vec2 p, float bright) {
          float r2 = dot(p, p);
          float core = pow(1.0 + r2 / 0.06, -2.5);
          float halo = (0.18 + 0.35 * bright) * exp(-r2 * (6.0 - 4.0 * bright));
          float glare = bright * 0.06 * exp(-r2 * 1.2);
          return clamp(core + halo + glare, 0.0, 1.4);
        }
        void main() {
          vec2 p = (gl_PointCoord - vec2(0.5)) * 2.0; // p in [-1, 1]
          float bright = smoothstep(0.4, 1.5, vFlux);
          // Atmospheric chromatic dispersion: blue lifted higher than red by
          // differential refraction. The split is along screen-Y (which is
          // roughly aligned with the zenith direction for any reasonable camera
          // pose). Magnitude grows with vDispersion (set per-star from altitude
          // and brightness). Tiny offsets — at the upper bound (~0.18) it's
          // perceptible but doesn't shatter the point.
          float disp = vDispersion * 0.18;
          float iR, iG, iB;
          if (disp < 0.005) {
            // No dispersion → single PSF eval, no overhead.
            float i = psfIntensity(p, bright);
            iR = i; iG = i; iB = i;
          } else {
            // Sample R below, G centered, B above.
            iR = psfIntensity(p + vec2(0.0, -disp), bright);
            iG = psfIntensity(p, bright);
            iB = psfIntensity(p + vec2(0.0,  disp), bright);
          }
          // Use channel-specific intensity but the per-star color tint.
          vec3 rgb = vec3(vColor.r * iR, vColor.g * iG, vColor.b * iB);
          // Single alpha — pick the max of the three so the bounding-disc
          // remains visible while the channel offsets create the color split.
          float alpha = max(max(iR, iG), iB) * clamp(vFlux, 0.0, 4.0);
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(rgb, alpha);
        }
      `,
    });

    this.starPoints = new THREE.Points(geometry, material);
    this.scene.add(this.starPoints);

    this.updateMoon(observer, date);
    this.updatePlanets(observer, date);
    this.updateMilkyWay(observer, date, sunAltDeg);
    this.updateSun(sunAa);
    this.updateDSO(observer, date, sunAltDeg);
    this.updateAurora(observer);
    this.updateSkyBackground();
  }

  private sunMesh: THREE.Mesh | null = null;

  /**
   * Render the sun as a bright yellow-white disc at its altaz position.
   * Half-degree apparent diameter (real value: 31'59" ≈ 0.533°). When the sun
   * is well below the horizon the disc skips render — but during civil
   * twilight a faint glow can still be appropriate to show, so we keep the
   * threshold at altDeg < -2°.
   */
  private updateSun(sunAa: { altDeg: number; azDeg: number }): void {
    if (this.sunMesh) {
      this.scene.remove(this.sunMesh);
      this.sunMesh.geometry.dispose();
      (this.sunMesh.material as THREE.Material).dispose();
      this.sunMesh = null;
    }
    if (sunAa.altDeg < -2) return;

    const angularDeg = 0.533;
    const radius = SKY_RADIUS * Math.tan((angularDeg / 2) * DEG);
    const geom = new THREE.CircleGeometry(radius, 64);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - vec2(1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          // Hard-edged disc with a thin chromatic limb (atmospheric reddening
          // near horizon — handled implicitly by extincted brightness instead).
          float intensity = smoothstep(1.0, 0.96, r);
          // Sun surface tone — white-yellow.
          vec3 col = vec3(1.0, 0.97, 0.85);
          gl_FragColor = vec4(col * intensity, intensity);
        }
      `,
    });

    const mesh = new THREE.Mesh(geom, mat);
    const altApp = sunAa.altDeg + refractionDeg(sunAa.altDeg);
    const [x, y, z] = altAzToVector(altApp, sunAa.azDeg);
    mesh.position.set(x * SKY_RADIUS, y * SKY_RADIUS, z * SKY_RADIUS);
    mesh.lookAt(0, 0, 0);
    mesh.renderOrder = 5; // above stars but below HUD
    this.scene.add(mesh);
    this.sunMesh = mesh;
  }

  /**
   * Build the auroral curtain mesh: an inside-out sphere whose fragment shader
   * generates greenish 557.7 nm-ish vertical bands above a "magnetic-north
   * horizon" direction. The shader writes nothing when intensity ≈ 0, so this
   * is free for low-latitude / quiet-Kp observers.
   */
  private buildAurora(): void {
    const radius = SKY_RADIUS * 0.97; // sit just outside the moon-glow sphere
    const geom = new THREE.SphereGeometry(radius, 64, 32);
    geom.scale(-1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMagNorth: { value: new THREE.Vector3(0, 0, -1) }, // direction in world
        uPeakAlt: { value: 0 },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vWorldDir = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorldDir;
        uniform vec3 uMagNorth;
        uniform float uPeakAlt;
        uniform float uIntensity;
        uniform float uTime;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          if (uIntensity < 0.01) discard;
          vec3 d = normalize(vWorldDir);
          float altSin = d.y;
          float altDeg = degrees(asin(clamp(altSin, -1.0, 1.0)));

          // Below horizon → nothing.
          if (altDeg < 0.0) discard;

          // Azimuth proximity to magnetic-north direction.
          vec3 magN = normalize(uMagNorth);
          // Horizontal projections of d and magN (zero out the up component).
          vec3 dh = normalize(vec3(d.x, 0.0, d.z));
          vec3 mh = normalize(vec3(magN.x, 0.0, magN.z));
          float cosAzDelta = clamp(dot(dh, mh), -1.0, 1.0);
          float azDeltaDeg = degrees(acos(cosAzDelta));

          // Curtain horizontal extent: ±60° from magnetic north.
          if (azDeltaDeg > 70.0) discard;
          float azFade = smoothstep(70.0, 35.0, azDeltaDeg);

          // Vertical envelope centered on peak altitude.
          // Gaussian-ish: stronger in a band, falling above and below.
          float altDelta = altDeg - uPeakAlt;
          float altShape = exp(-pow(altDelta / 12.0, 2.0));

          // Animated curtain ripple via low-frequency noise along an
          // azimuth-aligned coordinate. Aurora flickers visibly on ~1s scale.
          float band = vnoise(vec2(azDeltaDeg * 0.18 + uTime * 0.3,
                                    altDeg * 0.35 - uTime * 0.1));
          float ripple = 0.6 + 0.4 * band;

          // Vertical striations (the "curtain" texture).
          float stripe = vnoise(vec2(azDeltaDeg * 0.6, altDeg * 0.2)) * 0.5 + 0.5;

          // Color: O 557.7 nm green-yellow core with a faint magenta-pink
          // hem at the upper edge (N₂ 630 nm emission). Mix toward pink as
          // altDelta increases.
          float pinkMix = clamp((altDelta) / 25.0, 0.0, 1.0);
          vec3 greenCore = vec3(0.25, 0.95, 0.50);
          vec3 pinkHem = vec3(0.95, 0.55, 0.85);
          vec3 col = mix(greenCore, pinkHem, pinkMix);

          float a = uIntensity * azFade * altShape * ripple * stripe * 0.7;
          if (a < 0.003) discard;
          gl_FragColor = vec4(col * (0.7 + 0.3 * stripe), a);
        }
      `,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = -6; // above the sky-glow sphere, below stars
    this.scene.add(mesh);
    this.auroraMaterial = mat;
  }

  /**
   * Update aurora uniforms from current observer + Kp. Called from setSky();
   * the per-frame `uTime` is bumped in render() so the curtain flickers.
   */
  private updateAurora(observer: Observer): void {
    if (!this.auroraMaterial) return;
    const vis = auroralVisibility(observer, this.state.kp);
    if (!vis.visible || vis.intensity < 0.02) {
      this.auroraMaterial.uniforms["uIntensity"]!.value = 0;
      return;
    }
    // Convert (peak alt, magnetic-north azimuth) → world direction vector.
    const [x, y, z] = altAzToVector(vis.peakAltDeg, vis.magNorthAzDeg);
    this.auroraMaterial.uniforms["uMagNorth"]!.value.set(x, y, z);
    this.auroraMaterial.uniforms["uPeakAlt"]!.value = vis.peakAltDeg;
    // Aurora is washed out by twilight + Bortle, same as Milky Way.
    let twilightDamp: number;
    if (this.currentSunAltDeg <= -18) twilightDamp = 1;
    else if (this.currentSunAltDeg >= 0) twilightDamp = 0;
    else twilightDamp = (this.currentSunAltDeg + 18) / 18;
    const bortleNorm = Math.max(0, Math.min(1, (this.state.bortle - 1) / 8));
    const bortleDamp = 1 - bortleNorm * 0.85;
    this.auroraMaterial.uniforms["uIntensity"]!.value =
      vis.intensity * twilightDamp * bortleDamp;
  }

  /**
   * Render the curated naked-eye DSO catalog (Andromeda, Orion Neb, Pleiades,
   * Beehive, Double Cluster, Hyades, Magellanic Clouds, …) as soft elliptical
   * patches sized to their real angular extent. Visibility scales with Bortle
   * and twilight the same way faint stars do — at Bortle 7 city sky none of
   * these are eye-visible; under a dark sky M31 is an obvious oval and M42 is
   * a noticeable fuzzy reddish star to the unaided eye.
   */
  private updateDSO(
    observer: Observer,
    date: Date,
    sunAltDeg: number,
  ): void {
    if (this.dsoGroup) {
      this.scene.remove(this.dsoGroup);
      this.dsoGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.dsoGroup = null;
    }

    // Above this twilight threshold the eye can't pick out diffuse DSOs.
    if (sunAltDeg > -8) return;
    // Per-Bortle naked-eye DSO limit. At Bortle 1 a dark-adapted observer can
    // see Veil and M81 fuzz; by Bortle 5 only the showpieces (M31, M45, M44)
    // remain; in city sky (Bortle 7+) only M45 is anything more than a star.
    const limitForDSO =
      this.state.bortle <= 1 ? 9.0 :
      this.state.bortle <= 2 ? 7.0 :
      this.state.bortle <= 4 ? 6.0 :
      this.state.bortle <= 6 ? 4.0 :
      2.0;

    const group = new THREE.Group();
    for (const dso of NAKED_EYE_DSO) {
      if (dso.mag > limitForDSO) continue;
      const aa = equatorialToAltAz(dso.pos, observer, date);
      if (aa.altDeg < 2) continue; // below 2° atmospheric extinction kills it

      const altApp = aa.altDeg + refractionDeg(aa.altDeg);
      const apparentMag = dso.mag + extinctionMag(aa.altDeg);
      // Diffuse objects spread their light over a wide angular area; scale flux
      // by 1/area to roughly model surface-brightness perception (the eye sees
      // surface brightness, not integrated mag, for extended objects).
      const areaDeg2 = Math.PI * (dso.majorDeg / 2) * (dso.minorDeg / 2);
      const surfaceMag = apparentMag + 2.5 * Math.log10(Math.max(0.5, areaDeg2));
      const flux = magToFlux(surfaceMag) * this.state.exposure * 8.0; // x8 lift makes them visible at all

      const mesh = this.buildDSOPatch(dso, flux);
      const [x, y, z] = altAzToVector(altApp, aa.azDeg);
      mesh.position.set(x * SKY_RADIUS, y * SKY_RADIUS, z * SKY_RADIUS);
      mesh.lookAt(0, 0, 0);
      group.add(mesh);
    }
    if (group.children.length > 0) {
      this.scene.add(group);
      this.dsoGroup = group;
    }
  }

  /** Build a single DSO patch mesh sized to the object's apparent angular extent. */
  private buildDSOPatch(dso: NakedEyeDSO, flux: number): THREE.Mesh {
    const radiusMajor = SKY_RADIUS * Math.tan((dso.majorDeg / 2) * DEG);
    const radiusMinor = SKY_RADIUS * Math.tan((dso.minorDeg / 2) * DEG);
    // Use a quad and let the shader do the elliptical gaussian.
    const geom = new THREE.PlaneGeometry(radiusMajor * 2, radiusMinor * 2);
    // Rotate the plane in its own frame so paDeg measures from "north" (up).
    geom.rotateZ(dso.paDeg * DEG);

    // Cluster vs galaxy/nebula give slightly different falloff profiles.
    // Clusters: sharper core (many discrete stars), faster falloff.
    // Galaxies/nebulae: broader gaussian.
    const isCluster = dso.kind === "cluster";
    const profileSharp = isCluster ? 4.0 : 2.0;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFlux: { value: flux },
        uColor: { value: new THREE.Color(dso.color[0], dso.color[1], dso.color[2]) },
        uSharp: { value: profileSharp },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - vec2(1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uFlux;
        uniform vec3 uColor;
        uniform float uSharp;
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          // Gaussian-ish radial falloff; sharper for clusters.
          float intensity = exp(-r2 * uSharp);
          float alpha = intensity * clamp(uFlux, 0.0, 6.0);
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(uColor * intensity, alpha);
        }
      `,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 1; // above MW background, below stars
    return mesh;
  }

  /**
   * Place the satellites visible right now (sunlit + above the horizon) as
   * small bright points on the sky sphere. Called per frame from render()
   * because ISS / CSS drift ~4°/min and the human eye sees that motion clearly.
   */
  updateSatellites(): void {
    const observer = this.lastObserver;
    if (!observer) return;
    const date = new Date();
    const sightings = visibleSatellites(observer, date);

    if (this.satelliteGroup) {
      this.scene.remove(this.satelliteGroup);
      this.satelliteGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
      this.satelliteGroup = null;
    }
    if (sightings.length === 0) return;

    const group = new THREE.Group();
    for (const sat of sightings) {
      // Atmospheric refraction + extinction (use the same helpers as stars).
      const altApp = sat.altDeg + refractionDeg(sat.altDeg);
      const apparentMag = sat.mag + extinctionMag(sat.altDeg);
      const flux = magToFlux(apparentMag) * this.state.exposure;
      if (flux < 0.001) continue;

      const geom = new THREE.CircleGeometry(0.5, 16);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
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
          uniform float uFlux;
          void main() {
            float r2 = dot(vUv, vUv);
            if (r2 > 1.0) discard;
            float core = pow(1.0 + r2 / 0.04, -2.5);
            float halo = 0.25 * exp(-r2 * 6.0);
            float intensity = clamp(core + halo, 0.0, 1.0);
            float alpha = intensity * clamp(uFlux, 0.0, 6.0);
            if (alpha < 0.002) discard;
            // Solar panels are mostly silver-white with a slight yellow cast
            // from the gold-tinted multi-layer insulation foil.
            vec3 col = vec3(1.0, 0.97, 0.90) * intensity;
            gl_FragColor = vec4(col, alpha);
          }
        `,
      });
      const mesh = new THREE.Mesh(geom, mat);
      const [x, y, z] = altAzToVector(altApp, sat.azDeg);
      mesh.position.set(x * SKY_RADIUS, y * SKY_RADIUS, z * SKY_RADIUS);
      mesh.lookAt(0, 0, 0);
      mesh.userData["name"] = sat.name;
      mesh.userData["mag"] = sat.mag;
      group.add(mesh);
    }
    this.scene.add(group);
    this.satelliteGroup = group;
  }

  /**
   * Per-frame meteor management. Each frame we (1) sample any new meteors that
   * "occurred" during the elapsed time, instantiating streaks for them, and
   * (2) advance/age active meteors, fading them out and removing those past
   * their duration. Streaks are short additive line segments — the eye sees
   * meteors as bright transient streaks; a 0.5s exposure is essentially the
   * full visual experience.
   */
  private tickMeteors(): void {
    const observer = this.lastObserver;
    if (!observer) return;
    const date = new Date();
    const nowMs = date.getTime();

    // Sample new meteors based on time since last sample, capped at 1s of dt.
    const dt = this.lastMeteorSampleMs > 0
      ? Math.min(1.0, (nowMs - this.lastMeteorSampleMs) / 1000)
      : 0.1;
    this.lastMeteorSampleMs = nowMs;

    // Skip when sun is up — meteors aren't naked-eye visible in daylight.
    if (this.currentSunAltDeg > -6) {
      // Still need to fade out any active meteors that crossed into twilight.
    } else {
      const specs = sampleNewMeteors(date, dt, observer);
      for (const spec of specs) {
        // Magnitude clamp: refuse to render meteors fainter than the Bortle limit + small slack.
        const apparentMag = spec.mag + extinctionMag(Math.max(0, spec.startAlt));
        const limit = effectiveLimitMag(this.state.bortle, this.currentSunAltDeg);
        if (apparentMag > limit + 0.5) continue;
        const mesh = this.buildMeteorMesh(spec);
        if (mesh) {
          if (!this.meteorGroup) {
            this.meteorGroup = new THREE.Group();
            this.scene.add(this.meteorGroup);
          }
          this.meteorGroup.add(mesh);
          this.activeMeteors.push({ spec, mesh });
        }
      }
    }

    // Advance active meteors. Each meteor has its head sweep from start→end
    // across its duration, with a glowing tail that fades over ~0.4s.
    const keep: typeof this.activeMeteors = [];
    for (const m of this.activeMeteors) {
      const tSec = (nowMs - m.spec.startMs) / 1000;
      const lifetime = m.spec.durationS + 0.4; // include tail fade
      if (tSec > lifetime) {
        if (this.meteorGroup) this.meteorGroup.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
        continue;
      }
      const mat = m.mesh.material as THREE.ShaderMaterial;
      mat.uniforms["uT"]!.value = tSec;
      mat.uniforms["uDuration"]!.value = m.spec.durationS;
      keep.push(m);
    }
    this.activeMeteors = keep;
  }

  /** Build a single-meteor streak mesh: a thin quad along the trajectory. */
  private buildMeteorMesh(spec: MeteorSpec): THREE.Mesh | null {
    const [sx, sy, sz] = altAzToVector(
      spec.startAlt + refractionDeg(Math.max(0, spec.startAlt)),
      spec.startAz,
    );
    const [ex, ey, ez] = altAzToVector(
      spec.endAlt + refractionDeg(Math.max(0, spec.endAlt)),
      spec.endAz,
    );
    const start = new THREE.Vector3(sx, sy, sz).multiplyScalar(SKY_RADIUS);
    const end = new THREE.Vector3(ex, ey, ez).multiplyScalar(SKY_RADIUS);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    if (len < 0.1) return null;
    // Build a 2-tri quad aligned along the trajectory, ~0.3% of SKY_RADIUS wide.
    const width = SKY_RADIUS * 0.004;
    const geom = new THREE.PlaneGeometry(len, width);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uT: { value: 0 },
          uDuration: { value: spec.durationS },
          uFlux: {
            value: Math.min(8, magToFlux(spec.mag) * this.state.exposure * 3),
          },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          uniform float uT;
          uniform float uDuration;
          uniform float uFlux;
          void main() {
            // Head position along the streak (0→1 over duration).
            float headProg = clamp(uT / max(uDuration, 0.01), 0.0, 1.0);
            // Tail trails behind the head with exponential brightness falloff.
            float distFromHead = headProg - vUv.x;
            // Behind the head (distFromHead > 0) → visible tail.
            // Ahead of the head (distFromHead < 0) → nothing.
            if (distFromHead < -0.02 || distFromHead > 0.6) discard;
            float tail = exp(-distFromHead * 8.0) * step(-0.02, distFromHead);
            // Lateral falloff (across the width of the streak).
            float lateral = exp(-pow((vUv.y - 0.5) * 6.0, 2.0));
            // Post-duration fade: after the head reaches the end, dim everything.
            float postFade = 1.0 - clamp((uT - uDuration) / 0.4, 0.0, 1.0);
            float intensity = tail * lateral * postFade;
            // Ablation color: hot at head (whitish-blue), cooler in tail (yellow-orange).
            vec3 colorHead = vec3(0.85, 0.92, 1.0);
            vec3 colorTail = vec3(1.0, 0.75, 0.40);
            vec3 col = mix(colorHead, colorTail, clamp(distFromHead * 3.0, 0.0, 1.0));
            float alpha = intensity * uFlux;
            if (alpha < 0.003) discard;
            gl_FragColor = vec4(col * intensity, alpha);
          }
        `,
      }),
    );
    mesh.position.copy(mid);
    // Orient the quad so its +X axis aligns with dir and it faces the camera (origin).
    const xAxis = dir.clone().normalize();
    const radial = mid.clone().normalize(); // outward from observer
    const yAxis = radial.clone().cross(xAxis).normalize().negate();
    const zAxis = xAxis.clone().cross(yAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.renderOrder = 4;
    return mesh;
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
    // Sun's ecliptic longitude drives the zodiacal cone direction.
    this.milkyWayMaterial.uniforms["uSunEclipticLon"]!.value =
      sunPosition(date).lambdaDeg;
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

        // Hashed value-noise — used to build the lunar mare pattern. Coarse
        // cells (~8 across the disc) give the dark / light patchwork that
        // gives the "man in the moon" silhouette at naked-eye resolution.
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float cl = cos(uLimbAngle), sl = sin(uLimbAngle);
          vec2 r_uv = vec2(cl * vUv.x + sl * vUv.y, -sl * vUv.x + cl * vUv.y);
          float lit = step(cos(uPhase), r_uv.x);
          float limbSoft = pow(1.0 - r, 0.3);

          // Lunar mare pattern. Two octaves of value-noise sampled on the
          // disc surface, biased so ~40 % of the visible face is "mare"
          // (basaltic-flood darker regions). The fixed seed scale means the
          // pattern is stable — it's the same Moon every time, in the same
          // orientation up to libration (which we don't model).
          vec2 surf = vUv * 4.0; // coarse cells across the disc
          float mareLow = vnoise(surf);
          float mareHigh = vnoise(surf * 3.1 + vec2(7.3, 1.9));
          float mareMask = smoothstep(0.45, 0.55, mareLow * 0.7 + mareHigh * 0.3);
          // Highlands tone is the original warm gray; mare are noticeably darker.
          vec3 surfaceTone = mix(vec3(0.95, 0.92, 0.85), vec3(0.55, 0.52, 0.47), mareMask);

          float earthshine = (1.0 - lit) * uEarthshine;
          vec3 litCol = surfaceTone * lit * limbSoft;
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
      const discRadius = Math.max(0.6, SKY_RADIUS * Math.tan(angRad / 2));
      // The quad has to be large enough to hold the diffraction spikes (only
      // visible for very bright planets) plus the disc. Spike length scales
      // with flux; we cap the quad at ~6× the disc and rely on the shader
      // to do everything below that. `uDiscFrac` tells the shader what
      // fraction of the quad is the actual planet disc.
      const isVeryBright = p.mag < -2.5;
      const quadRadius = isVeryBright ? discRadius * 5 : discRadius * 1.6;
      const discFrac = discRadius / quadRadius;
      const geom = new THREE.PlaneGeometry(quadRadius * 2, quadRadius * 2);
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: {
            value: new THREE.Vector3(p.color[0], p.color[1], p.color[2]),
          },
          uFlux: { value: flux },
          uDiscFrac: { value: discFrac },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - vec2(1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          uniform vec3 uColor;
          uniform float uFlux;
          uniform float uDiscFrac;
          void main() {
            // Disc-space coordinates: vUv was [-1,1] of the (possibly-oversized)
            // quad; rescale so that |q|=1 is the planet's actual rim.
            vec2 q = vUv / uDiscFrac;
            float qr2 = dot(q, q);
            float intensity = 0.0;
            if (qr2 <= 1.0) {
              // Sharper edge than a star PSF — planets are spatially resolved discs.
              float core = pow(1.0 - qr2, 1.5);
              float halo = 0.25 * exp(-qr2 * 4.0);
              intensity = clamp(core + halo, 0.0, 1.0);
            }
            // Iris diffraction spikes for the very bright planets (Venus at
            // mag -4, Jupiter at mag -2.5). The eye really does see a faint
            // 4-point cross around them. Spike strength scales with flux,
            // becomes invisible below mag ≈ -2.
            float bright = smoothstep(2.0, 6.0, uFlux);
            if (bright > 0.001) {
              float ax = abs(vUv.x);
              float ay = abs(vUv.y);
              float spikeWidth = 0.02 + 0.02 * (1.0 - bright);
              // Vertical bar at x≈0.
              float vBar = exp(-pow(vUv.x / spikeWidth, 2.0));
              // Horizontal bar at y≈0.
              float hBar = exp(-pow(vUv.y / spikeWidth, 2.0));
              // Length falloff along the bar.
              float vLen = exp(-ay * 1.3);
              float hLen = exp(-ax * 1.3);
              float spike = bright * 0.4 * (vBar * vLen + hBar * hLen);
              intensity += spike;
            }
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

  private lastSatRefreshMs = 0;

  render(): void {
    const tSec = performance.now() / 1000;
    // Drive the per-star twinkle modulation (in seconds, fractional).
    if (this.starPoints) {
      const m = this.starPoints.material as THREE.ShaderMaterial;
      if (m.uniforms["uTime"]) {
        m.uniforms["uTime"]!.value = tSec;
      }
    }
    // Aurora curtain flickers continuously even between setSky() calls.
    if (this.auroraMaterial && this.auroraMaterial.uniforms["uTime"]) {
      this.auroraMaterial.uniforms["uTime"]!.value = tSec;
    }
    // Refresh satellites once per second — ISS moves ~4°/min, so 1 Hz is plenty
    // for the eye to read smooth motion while keeping SGP4 cost negligible.
    const now = performance.now();
    if (now - this.lastSatRefreshMs > 1000) {
      this.lastSatRefreshMs = now;
      this.updateSatellites();
    }
    this.tickMeteors();
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
