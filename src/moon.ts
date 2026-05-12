// Low-precision lunar ephemeris from Meeus, "Astronomical Algorithms" Ch. 47.
// Geocentric apparent position; accuracy ≈ 0.5° in longitude, 0.2° in latitude.
// Plus the analogous Meeus low-precision sun position (Ch. 25) needed for phase.
//
// Returned coordinates are equatorial of date (close to ICRS at ≤ 1° tolerance).
// We deliberately ignore nutation, aberration, and topocentric parallax — they
// shift the moon by ≤ 1°, well inside the Step 1 5° acceptance budget.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function julianCenturiesFromJ2000(jd: number): number {
  return (jd - 2451545.0) / 36525;
}

function dateToJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Mean obliquity of the ecliptic (IAU 1980), degrees. */
function meanObliquityDeg(T: number): number {
  return 23.4392911 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
}

/** Convert ecliptic (lambda, beta) to equatorial (ra, dec). All inputs/outputs degrees. */
function eclipticToEquatorial(
  lambdaDeg: number,
  betaDeg: number,
  obliquityDeg: number,
): { raDeg: number; decDeg: number } {
  const lam = lambdaDeg * DEG;
  const bet = betaDeg * DEG;
  const eps = obliquityDeg * DEG;
  const sinDec =
    Math.sin(bet) * Math.cos(eps) +
    Math.cos(bet) * Math.sin(eps) * Math.sin(lam);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const y = Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps);
  const x = Math.cos(lam);
  let ra = Math.atan2(y, x) * RAD;
  ra = mod360(ra);
  return { raDeg: ra, decDeg: dec * RAD };
}

export interface SunPosition {
  raDeg: number;
  decDeg: number;
  /** Geocentric ecliptic longitude, degrees. */
  lambdaDeg: number;
  /** Distance Earth-Sun in AU. */
  distanceAu: number;
}

export function sunPosition(date: Date): SunPosition {
  const T = julianCenturiesFromJ2000(dateToJulian(date));

  // Meeus 25.2 — geometric mean longitude
  const L0 = mod360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  // Meeus 25.3 — mean anomaly
  const M = mod360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  // Eccentricity
  const e = 0.016708634 - 0.000042037 * T - 1.267e-7 * T * T;

  const Mrad = M * DEG;
  // Equation of center (Meeus 25.4)
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);

  const lambda = mod360(L0 + C);
  // True anomaly
  const v = M + C;
  // Distance R in AU
  const R = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(v * DEG));

  const eps = meanObliquityDeg(T);
  const { raDeg, decDeg } = eclipticToEquatorial(lambda, 0, eps);
  return { raDeg, decDeg, lambdaDeg: lambda, distanceAu: R };
}

export interface MoonPosition {
  raDeg: number;
  decDeg: number;
  /** Geocentric distance in km. */
  distanceKm: number;
  /** Apparent angular diameter, degrees. */
  diameterDeg: number;
  /** Phase angle Sun-Moon-Earth in degrees: 0 = new, 180 = full. */
  phaseAngleDeg: number;
  /** Illuminated fraction of the disk in [0, 1]. */
  illumination: number;
  /** Approximate apparent visual magnitude (rough). */
  mag: number;
  /**
   * Position angle (degrees, +CCW from celestial north) of the bright limb's
   * mid-point. Used by the moon shader to orient the terminator correctly.
   */
  brightLimbAngleDeg: number;
}

export function moonPosition(date: Date): MoonPosition {
  const jd = dateToJulian(date);
  const T = julianCenturiesFromJ2000(jd);

  // Meeus 47 — mean elements (degrees)
  const Lp = mod360(218.3164591 + 481267.88134236 * T - 0.0013268 * T * T);
  const D = mod360(297.8502042 + 445267.1115168 * T - 0.00163 * T * T);
  const M = mod360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mp = mod360(134.9634114 + 477198.8676313 * T + 0.008997 * T * T);
  const F = mod360(93.2720993 + 483202.0175273 * T - 0.0034029 * T * T);

  const sin = (x: number) => Math.sin(x * DEG);
  const cos = (x: number) => Math.cos(x * DEG);

  // Truncated longitude perturbations (largest terms only — ~0.3° accuracy)
  const dLambda =
    6.289 * sin(Mp) -
    1.274 * sin(Mp - 2 * D) +
    0.658 * sin(2 * D) -
    0.214 * sin(2 * Mp) -
    0.186 * sin(M) -
    0.114 * sin(2 * F);

  // Truncated latitude
  const beta =
    5.128 * sin(F) +
    0.281 * sin(Mp + F) -
    0.278 * sin(F - Mp) +
    0.173 * sin(F - 2 * D);

  // Truncated distance, km
  const distanceKm =
    385000.56 -
    20905.355 * cos(Mp) -
    3699.111 * cos(2 * D - Mp) -
    2955.968 * cos(2 * D) -
    569.925 * cos(2 * Mp);

  const lambda = mod360(Lp + dLambda);
  const eps = meanObliquityDeg(T);
  const { raDeg: moonRa, decDeg: moonDec } = eclipticToEquatorial(
    lambda,
    beta,
    eps,
  );

  // Sun position for phase angle.
  const sun = sunPosition(date);
  // Geocentric elongation D_elong = arccos(cos β · cos(λ_moon − λ_sun))
  const dElong = Math.acos(cos(beta) * cos(lambda - sun.lambdaDeg)) * RAD;
  // Meeus 48.2 — phase angle (small-angle approximation, sun distance >> moon distance)
  const sunDistanceKm = sun.distanceAu * 149597870.7;
  const phaseAngle =
    180 -
    dElong -
    (sunDistanceKm > 0
      ? 0.1468 * Math.sin(dElong * DEG) * (1 - 0.0549 * Math.sin(M * DEG))
      : 0);
  const illumination = (1 + Math.cos(phaseAngle * DEG)) / 2;

  // Apparent angular diameter from physical radius (1737 km).
  const diameterDeg = 2 * Math.atan(1737.4 / distanceKm) * RAD;

  // Position angle of bright limb (Meeus 48.5).
  const sunRa = sun.raDeg * DEG;
  const sunDec = sun.decDeg * DEG;
  const mRa = moonRa * DEG;
  const mDec = moonDec * DEG;
  const num = Math.cos(sunDec) * Math.sin(sunRa - mRa);
  const den =
    Math.sin(sunDec) * Math.cos(mDec) -
    Math.cos(sunDec) * Math.sin(mDec) * Math.cos(sunRa - mRa);
  const brightLimbAngle = Math.atan2(num, den) * RAD;

  // Crude visual magnitude approximation. Full moon ~ -12.7; magnitude rises ~3 every 90°.
  const mag =
    -12.7 + 0.026 * Math.abs(phaseAngle) + 4e-9 * Math.pow(phaseAngle, 4);

  return {
    raDeg: moonRa,
    decDeg: moonDec,
    distanceKm,
    diameterDeg,
    phaseAngleDeg: phaseAngle,
    illumination,
    mag,
    brightLimbAngleDeg: brightLimbAngle,
  };
}
