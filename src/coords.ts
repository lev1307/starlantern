// Coordinate transforms for AR night-sky overlay.
//
// Sign conventions (lock these first per step1-base.md):
//   - longitude: East-positive (ISO 6709 / GPS / WGS84)
//   - latitude:  North-positive
//   - RA: hours of right ascension carried as degrees (0..360, J2000.0 ICRS)
//   - Dec: degrees (-90..+90)
//   - azimuth: degrees measured from North through East (0=N, 90=E, 180=S, 270=W)
//   - altitude: degrees above the horizon (-90..+90)
//
// TODO (deferred to Step 2/3):
//   - Precession from J2000 to date of observation (IAU 2006 P03)
//   - Nutation (IAU 2000A short series)
//   - Annual aberration
//   - Atmospheric refraction
//   - Proper motion
// At ~5° acceptance these are well under tolerance. We ship without them.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export interface Equatorial {
  /** Right ascension in degrees, 0..360, J2000 ICRS. */
  ra: number;
  /** Declination in degrees, -90..+90, J2000 ICRS. */
  dec: number;
}

export interface Observer {
  /** Geodetic latitude in degrees, North-positive. */
  latDeg: number;
  /** Geodetic longitude in degrees, East-positive. */
  lonDeg: number;
}

export interface AltAz {
  /** Altitude above the horizon in degrees. */
  altDeg: number;
  /** Azimuth from North through East in degrees, 0..360. */
  azDeg: number;
}

/** Convert a Date to Julian Date (UTC, no leap-second correction). */
export function dateToJulian(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * Greenwich Mean Sidereal Time in degrees, IAU 1982 polynomial.
 * Accurate to ~1 arcsec over decades — well inside our 5° acceptance.
 */
export function gmstDeg(jd: number): number {
  const d = jd - 2451545.0;
  const t = d / 36525;
  let gmst =
    280.46061837 +
    360.98564736629 * d +
    0.000387933 * t * t -
    (t * t * t) / 38710000;
  gmst = ((gmst % 360) + 360) % 360;
  return gmst;
}

/** Local Mean Sidereal Time in degrees at observer longitude (East-positive). */
export function lmstDeg(jd: number, lonDeg: number): number {
  return (((gmstDeg(jd) + lonDeg) % 360) + 360) % 360;
}

/**
 * Equatorial (RA, Dec) → local horizontal (alt, az) for the given observer & time.
 * Standard spherical formulas; no refraction. Az measured N→E.
 */
export function equatorialToAltAz(
  eq: Equatorial,
  observer: Observer,
  date: Date,
): AltAz {
  const jd = dateToJulian(date);
  const lst = lmstDeg(jd, observer.lonDeg);
  const ha = (((lst - eq.ra) % 360) + 360) % 360; // hour angle in degrees

  const haRad = ha * DEG;
  const decRad = eq.dec * DEG;
  const latRad = observer.latDeg * DEG;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Az from North through East: atan2(-cos(d)sin(H), sin(d)cos(lat) - cos(d)sin(lat)cos(H))
  const y = -Math.cos(decRad) * Math.sin(haRad);
  const x =
    Math.sin(decRad) * Math.cos(latRad) -
    Math.cos(decRad) * Math.sin(latRad) * Math.cos(haRad);
  let az = Math.atan2(y, x) * RAD;
  az = ((az % 360) + 360) % 360;

  return { altDeg: alt * RAD, azDeg: az };
}

/**
 * Convert altaz to a unit-sphere position in a local ENU-style frame used by the renderer:
 *   +X = East, +Y = Up, +Z = South (so the camera, looking towards -Z, faces North initially).
 * Returned vector has |v| = 1.
 */
export function altAzToVector(
  alt: number,
  az: number,
): [number, number, number] {
  const a = alt * DEG;
  const z = az * DEG;
  const cosA = Math.cos(a);
  const x = cosA * Math.sin(z); // East
  const y = Math.sin(a); // Up
  const zc = cosA * Math.cos(z); // North component; we want +Z = South so flip below
  return [x, y, -zc]; // -North = +South
}

/**
 * Geodetic (lat, lon, alt) → ECEF (meters). WGS84 ellipsoid.
 * Not used in Step 1 rendering (altaz is enough) but required by the spec
 * and useful for Step 2 plate-solving baselines.
 */
export function geodeticToEcef(
  latDeg: number,
  lonDeg: number,
  altM: number,
): [number, number, number] {
  const a = 6378137.0; // WGS84 semi-major axis (m)
  const f = 1 / 298.257223563; // WGS84 flattening
  const e2 = f * (2 - f);
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const x = (N + altM) * cosLat * Math.cos(lon);
  const y = (N + altM) * cosLat * Math.sin(lon);
  const z = (N * (1 - e2) + altM) * sinLat;
  return [x, y, z];
}
