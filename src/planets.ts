// Naked-eye planet positions via truncated Keplerian elements (Standish 1992,
// "Approximate Positions of the Planets" — JPL/NASA). Accuracy ≈ 1-5 arcmin
// for inner planets, ≈ 1 arcmin for outer planets, over 1800-2050 — well
// inside our 5° / 1° visual budgets.
//
// Returned RA/Dec is mean-of-date-ish — we intentionally skip precession,
// nutation, aberration, and light-time correction (all ≤ 1°). Phase angle is
// the geocentric Sun-Planet-Earth angle; magnitude uses Astronomical Almanac
// V-mag formulas; angular size uses physical mean radii.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const AU_KM = 149597870.7;

function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function julianFromDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

function meanObliquityDeg(T: number): number {
  return 23.4392911 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
}

/** Keplerian elements at J2000 + linear rate per Julian century. Angles in deg, a in AU. */
interface KeplerSet {
  /** Semi-major axis (AU), rate per cy. */
  a: number;
  ac: number;
  /** Eccentricity, rate per cy. */
  e: number;
  ec: number;
  /** Inclination to ecliptic (deg), rate per cy. */
  I: number;
  Ic: number;
  /** Mean longitude (deg), rate per cy. */
  L: number;
  Lc: number;
  /** Longitude of perihelion ω̄ = ω + Ω (deg), rate per cy. */
  wbar: number;
  wbarc: number;
  /** Longitude of ascending node (deg), rate per cy. */
  Omega: number;
  Omegac: number;
}

// Standish 1992, valid 1800-2050. Each row is (J2000 value, per-century rate).
const ELEMENTS: Record<string, KeplerSet> = {
  Mercury: {
    a: 0.38709927,
    ac: 0.00000037,
    e: 0.20563593,
    ec: 0.00001906,
    I: 7.00497902,
    Ic: -0.00594749,
    L: 252.2503235,
    Lc: 149472.67411175,
    wbar: 77.45779628,
    wbarc: 0.16047689,
    Omega: 48.33076593,
    Omegac: -0.12534081,
  },
  Venus: {
    a: 0.72333566,
    ac: 0.0000039,
    e: 0.00677672,
    ec: -0.00004107,
    I: 3.39467605,
    Ic: -0.0007889,
    L: 181.9790995,
    Lc: 58517.81538729,
    wbar: 131.60246718,
    wbarc: 0.00268329,
    Omega: 76.67984255,
    Omegac: -0.27769418,
  },
  Earth: {
    a: 1.00000261,
    ac: 0.00000562,
    e: 0.01671123,
    ec: -0.00004392,
    I: -0.00001531,
    Ic: -0.01294668,
    L: 100.46457166,
    Lc: 35999.37244981,
    wbar: 102.93768193,
    wbarc: 0.32327364,
    Omega: 0,
    Omegac: 0,
  },
  Mars: {
    a: 1.52371034,
    ac: 0.00001847,
    e: 0.0933941,
    ec: 0.00007882,
    I: 1.84969142,
    Ic: -0.00813131,
    L: -4.55343205,
    Lc: 19140.30268499,
    wbar: -23.94362959,
    wbarc: 0.44441088,
    Omega: 49.55953891,
    Omegac: -0.29257343,
  },
  Jupiter: {
    a: 5.202887,
    ac: -0.00011607,
    e: 0.04838624,
    ec: -0.00013253,
    I: 1.30439695,
    Ic: -0.00183714,
    L: 34.39644051,
    Lc: 3034.74612775,
    wbar: 14.72847983,
    wbarc: 0.21252668,
    Omega: 100.47390909,
    Omegac: 0.20469106,
  },
  Saturn: {
    a: 9.53667594,
    ac: -0.0012506,
    e: 0.05386179,
    ec: -0.00050991,
    I: 2.48599187,
    Ic: 0.00193609,
    L: 49.95424423,
    Lc: 1222.49362201,
    wbar: 92.59887831,
    wbarc: -0.41897216,
    Omega: 113.66242448,
    Omegac: -0.28867794,
  },
};

/** Mean physical radii in km (IAU 2015 nominal values, equatorial). */
const RADII_KM: Record<string, number> = {
  Mercury: 2440.5,
  Venus: 6051.8,
  Mars: 3389.5,
  Jupiter: 71492,
  Saturn: 60268,
};

/** Visual colour tint per planet — used by the renderer when shading discs. */
export const PLANET_COLOR: Record<string, [number, number, number]> = {
  Mercury: [0.85, 0.83, 0.78],
  Venus: [1.0, 0.95, 0.85],
  Mars: [1.0, 0.55, 0.35],
  Jupiter: [0.92, 0.86, 0.74],
  Saturn: [0.9, 0.82, 0.62],
};

/**
 * Solve Kepler's equation E - e·sin(E) = M for the eccentric anomaly E.
 * Newton-Raphson; converges in ≤ 6 iterations at e < 0.3 (all naked-eye planets).
 */
function solveKepler(M_rad: number, e: number): number {
  let E = M_rad + e * Math.sin(M_rad);
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * Math.sin(E) - M_rad) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

interface HelioVec {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** Heliocentric ecliptic position of a body at Julian centuries T past J2000. */
function helioPosition(name: string, T: number): HelioVec {
  const k = ELEMENTS[name]!;
  const a = k.a + k.ac * T;
  const e = k.e + k.ec * T;
  const I = (k.I + k.Ic * T) * DEG;
  const L = mod360(k.L + k.Lc * T);
  const wbar = mod360(k.wbar + k.wbarc * T);
  const Omega = mod360(k.Omega + k.Omegac * T);

  const omega = (wbar - Omega) * DEG;
  let M = L - wbar;
  // Normalize M to (-180, 180].
  M = ((((M + 180) % 360) + 360) % 360) - 180;
  const Mrad = M * DEG;

  const E = solveKepler(Mrad, e);

  // Position in the orbital plane.
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  // Rotate orbital plane → ecliptic frame: R_z(Ω) · R_x(I) · R_z(ω) · (xp, yp, 0)
  const cosO = Math.cos(Omega * DEG);
  const sinO = Math.sin(Omega * DEG);
  const cosI = Math.cos(I);
  const sinI = Math.sin(I);
  const cosw = Math.cos(omega);
  const sinw = Math.sin(omega);

  const x =
    (cosO * cosw - sinO * sinw * cosI) * xp +
    (-cosO * sinw - sinO * cosw * cosI) * yp;
  const y =
    (sinO * cosw + cosO * sinw * cosI) * xp +
    (-sinO * sinw + cosO * cosw * cosI) * yp;
  const z = sinw * sinI * xp + cosw * sinI * yp;
  const r = Math.hypot(x, y, z);
  return { x, y, z, r };
}

export interface PlanetPosition {
  name: string;
  /** Right ascension in degrees, mean-of-J2000. */
  raDeg: number;
  /** Declination in degrees, mean-of-J2000. */
  decDeg: number;
  /** Geocentric distance in AU. */
  distanceAu: number;
  /** Heliocentric distance in AU. */
  helioDistanceAu: number;
  /** Phase angle (Sun-Planet-Earth) in degrees. */
  phaseAngleDeg: number;
  /** Apparent V-magnitude (Astronomical Almanac formula). */
  mag: number;
  /** Apparent equatorial angular size of the disc, in arcseconds. */
  angularDiameterArcsec: number;
  /** Visible RGB tint (Saturn warm, Mars red-orange, etc.). */
  color: [number, number, number];
}

function magnitudeOf(
  name: string,
  r: number,
  delta: number,
  iDeg: number,
): number {
  // Apparent magnitude formulas from Astronomical Almanac / Mallama 2017 fits.
  const logRD = 5 * Math.log10(r * delta);
  const i = iDeg;
  switch (name) {
    case "Mercury":
      return -0.42 + logRD + 0.038 * i - 0.000273 * i * i + 2e-6 * i * i * i;
    case "Venus":
      return -4.4 + logRD + 0.0009 * i + 2.39e-4 * i * i - 6.5e-7 * i * i * i;
    case "Mars":
      return -1.52 + logRD + 0.016 * i;
    case "Jupiter":
      return -9.4 + logRD + 0.005 * i;
    case "Saturn":
      // Ignore the ring system — at ring-edge it can dim by ~1 mag, but that's
      // a follow-up refinement (Meeus Ch. 45).
      return -8.88 + logRD + 0.044 * i;
    default:
      return 99;
  }
}

export function planetPosition(name: string, date: Date): PlanetPosition {
  if (!(name in ELEMENTS) || name === "Earth") {
    throw new Error(`Unknown planet '${name}'`);
  }
  const T = (julianFromDate(date) - 2451545.0) / 36525;

  const planet = helioPosition(name, T);
  const earth = helioPosition("Earth", T);

  // Geocentric ecliptic vector planet - earth.
  const gx = planet.x - earth.x;
  const gy = planet.y - earth.y;
  const gz = planet.z - earth.z;
  const delta = Math.hypot(gx, gy, gz);

  // Rotate ecliptic → equatorial by obliquity.
  const eps = meanObliquityDeg(T) * DEG;
  const cosEps = Math.cos(eps);
  const sinEps = Math.sin(eps);
  const ex = gx;
  const ey = gy * cosEps - gz * sinEps;
  const ez = gy * sinEps + gz * cosEps;

  let ra = Math.atan2(ey, ex) * RAD;
  ra = mod360(ra);
  const dec = Math.atan2(ez, Math.hypot(ex, ey)) * RAD;

  // Phase angle = angle Sun-Planet-Earth at the planet.
  // From planet: vector to Sun = -planet_helio; vector to Earth = earth - planet.
  const sunVx = -planet.x,
    sunVy = -planet.y,
    sunVz = -planet.z;
  const earthVx = earth.x - planet.x;
  const earthVy = earth.y - planet.y;
  const earthVz = earth.z - planet.z;
  const cosPhase =
    (sunVx * earthVx + sunVy * earthVy + sunVz * earthVz) / (planet.r * delta);
  const phaseDeg = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * RAD;

  const mag = magnitudeOf(name, planet.r, delta, phaseDeg);
  const angularDiameter =
    2 * Math.atan(RADII_KM[name]! / (delta * AU_KM)) * RAD * 3600;

  return {
    name,
    raDeg: ra,
    decDeg: dec,
    distanceAu: delta,
    helioDistanceAu: planet.r,
    phaseAngleDeg: phaseDeg,
    mag,
    angularDiameterArcsec: angularDiameter,
    color: PLANET_COLOR[name]!,
  };
}

export const VISIBLE_PLANETS = [
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
] as const;

export function allPlanetPositions(date: Date): PlanetPosition[] {
  return VISIBLE_PLANETS.map((n) => planetPosition(n, date));
}
