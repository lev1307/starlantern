// Aurora visibility model. At sufficiently high geomagnetic latitudes the eye
// sees a greenish curtain (557.7 nm O excitation) above the magnetic-north
// horizon. The auroral oval is a ring centered on the geomagnetic pole; its
// equatorward edge moves to lower geomagnetic latitudes as Kp (planetary K
// geomagnetic activity index, 0–9) increases.
//
// For a Munich observer (geomag lat ~49°N), aurora is rare but possible
// during Kp 7+ storms. For high-latitude observers (Tromsø, Fairbanks)
// aurora is the dominant naked-eye feature most clear nights with Kp ≥ 3.
//
// We don't try to model the curtain's actual shape — that requires real-time
// IMAGER data. Instead we model the *visibility envelope*: where in the sky
// the eye would see green glow given the observer's geomagnetic latitude and
// the current Kp.

import type { Observer } from "./coords";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Geomagnetic north pole (IGRF-13 approximation, slowly drifting). Used to
 * convert geographic → geomagnetic latitude. Accurate to ~1° for the next decade.
 */
const GEOMAG_POLE_LAT = 80.7;
const GEOMAG_POLE_LON = -72.7;

export interface AuroralVisibility {
  /** True if any aurora is potentially visible above the horizon at this site. */
  visible: boolean;
  /** Compass azimuth (deg, N=0, E=90) where the auroral oval is, from observer. */
  magNorthAzDeg: number;
  /** Peak altitude (deg) at which the curtain crests. 0 = horizon, 90 = zenith. */
  peakAltDeg: number;
  /** Intensity 0..1 — drives shader alpha. */
  intensity: number;
  /** The observer's geomagnetic latitude, degrees. */
  geomagLatDeg: number;
  /** Equatorward edge of the auroral oval for current Kp, in geomag latitude. */
  ovalEdgeDeg: number;
}

/**
 * Compute geomagnetic latitude of an observer using a dipole approximation
 * (pole at GEOMAG_POLE_LAT/LON). Returns degrees [-90, 90].
 */
export function geomagneticLatitude(observer: Observer): number {
  const lat = observer.latDeg * DEG;
  const lon = observer.lonDeg * DEG;
  const pLat = GEOMAG_POLE_LAT * DEG;
  const pLon = GEOMAG_POLE_LON * DEG;
  const sinGeomag =
    Math.sin(lat) * Math.sin(pLat) +
    Math.cos(lat) * Math.cos(pLat) * Math.cos(lon - pLon);
  return Math.asin(Math.max(-1, Math.min(1, sinGeomag))) * RAD;
}

/**
 * Compass azimuth from observer toward geomagnetic north pole. Returns degrees
 * 0..360 with 0 = geographic north, increasing through east. This is the
 * direction the eye must face to see the auroral oval.
 */
export function magneticNorthAzimuth(observer: Observer): number {
  const lat = observer.latDeg * DEG;
  const lon = observer.lonDeg * DEG;
  const pLat = GEOMAG_POLE_LAT * DEG;
  const pLon = GEOMAG_POLE_LON * DEG;
  const dLon = pLon - lon;
  const y = Math.sin(dLon) * Math.cos(pLat);
  const x =
    Math.cos(lat) * Math.sin(pLat) -
    Math.sin(lat) * Math.cos(pLat) * Math.cos(dLon);
  let az = Math.atan2(y, x) * RAD;
  return ((az % 360) + 360) % 360;
}

/**
 * Equatorward edge of the auroral oval (in geomagnetic latitude) for a given
 * Kp index. Empirical fit: at Kp 0 the oval edge sits near geomag 67°; for
 * each unit of Kp it moves ~2° toward the equator.
 */
export function auroralOvalEdge(kp: number): number {
  const kpClamped = Math.max(0, Math.min(9, kp));
  return 67 - 2 * kpClamped;
}

/**
 * Decide whether and how aurora is visible from the observer at the given Kp.
 *
 * Visibility model (deliberately simple but physically motivated):
 *   - Let Δ = observer.geomag_lat − ovalEdge(Kp). If Δ ≥ 0 the observer is
 *     *inside* (poleward of) the equatorward edge → aurora is overhead, peaks
 *     near the zenith.
 *   - If Δ ∈ [-15°, 0°): observer is just south of the oval; aurora visible
 *     above the magnetic-north horizon, peak altitude = (15 + Δ) * 3°.
 *   - If Δ < -15°: too far south; the curtain is below the horizon.
 *   - Intensity scales with Kp (sub-linear) and with proximity to the edge.
 */
export function auroralVisibility(
  observer: Observer,
  kp: number,
): AuroralVisibility {
  const geomagLat = geomagneticLatitude(observer);
  const ovalEdge = auroralOvalEdge(kp);
  const delta = geomagLat - ovalEdge;
  const magNorthAz = magneticNorthAzimuth(observer);

  if (delta >= 0) {
    // Overhead aurora — peak near zenith, intensity high.
    return {
      visible: true,
      magNorthAzDeg: magNorthAz,
      peakAltDeg: Math.min(85, 60 + delta * 1.5),
      intensity: Math.min(1, 0.4 + kp / 12),
      geomagLatDeg: geomagLat,
      ovalEdgeDeg: ovalEdge,
    };
  }

  if (delta > -15) {
    // Horizon-aurora regime — curtain hangs above the magnetic north horizon.
    const peakAlt = (15 + delta) * 3; // 0° at Δ=-15, 45° at Δ=0
    // Intensity falls with distance from the oval edge AND grows with Kp.
    const proximity = (15 + delta) / 15; // 0..1
    return {
      visible: peakAlt > 1,
      magNorthAzDeg: magNorthAz,
      peakAltDeg: peakAlt,
      intensity: Math.max(0, proximity * Math.min(1, kp / 9) * 0.7),
      geomagLatDeg: geomagLat,
      ovalEdgeDeg: ovalEdge,
    };
  }

  // Too far south — no aurora.
  return {
    visible: false,
    magNorthAzDeg: magNorthAz,
    peakAltDeg: 0,
    intensity: 0,
    geomagLatDeg: geomagLat,
    ovalEdgeDeg: ovalEdge,
  };
}
