// Naked-eye satellite pass tracking. SGP4 propagation via satellite.js using
// CelesTrak TLE snapshots fetched at build time into public/data/tle.json.
//
// Only sunlit, above-horizon satellites are considered "visible to the eye".
// A passing ISS is naked-eye obvious (mag -2 to -4), drifting ~4°/min across
// the sky — when present it's one of the most dominant features of the real
// night sky and rendering it is essential for the "what the eye sees" mandate.

import * as sat from "satellite.js";
import { sunPosition } from "./moon";
import { type Observer } from "./coords";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const R_EARTH_KM = 6378.137;
const AU_KM = 149597870.7;

export interface TleRecord {
  name: string;
  line1: string;
  line2: string;
  catnr: number;
}

export interface TleSnapshot {
  fetchedAt: string;
  satellites: TleRecord[];
}

export interface SatelliteSighting {
  name: string;
  /** Apparent altitude in degrees (refraction not yet applied — caller does that). */
  altDeg: number;
  /** Azimuth measured from north through east, degrees. */
  azDeg: number;
  /** Slant range, observer → satellite, km. */
  rangeKm: number;
  /** Estimated apparent visual magnitude. */
  mag: number;
  /** True if satellite is sunlit (otherwise eclipsed → not visible to eye). */
  sunlit: boolean;
}

interface SatRec {
  name: string;
  rec: sat.SatRec;
}

let cache: SatRec[] | null = null;
let snapshotInfo: { fetchedAt: string; count: number } | null = null;

/** Load and parse the bundled TLE snapshot. Idempotent. */
export async function loadSatellites(url = "/data/tle.json"): Promise<void> {
  if (cache) return;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TLE fetch failed: ${resp.status}`);
  const snap = (await resp.json()) as TleSnapshot;
  cache = snap.satellites.map((t) => ({
    name: t.name,
    rec: sat.twoline2satrec(t.line1, t.line2),
  }));
  snapshotInfo = { fetchedAt: snap.fetchedAt, count: cache.length };
}

export function satelliteSnapshotInfo(): {
  fetchedAt: string;
  count: number;
} | null {
  return snapshotInfo;
}

/**
 * Sun position in ECI coordinates, km. Built from our existing geocentric
 * RA/Dec and Earth-Sun distance. ECI axes match satellite.js's convention.
 */
function sunEci(date: Date): { x: number; y: number; z: number } {
  const s = sunPosition(date);
  const R = s.distanceAu * AU_KM;
  const raRad = s.raDeg * DEG;
  const decRad = s.decDeg * DEG;
  return {
    x: R * Math.cos(decRad) * Math.cos(raRad),
    y: R * Math.cos(decRad) * Math.sin(raRad),
    z: R * Math.sin(decRad),
  };
}

/**
 * Geometric sunlit test: is the satellite's ECI position outside Earth's
 * cylindrical shadow as projected along the satellite-to-sun direction?
 *
 *   Project sat onto sun-direction → component `proj`.
 *   Perpendicular component (distance from sat to sun-line): `perp`.
 *   If proj > 0 (sat on sun-facing side) OR perp > R_earth (sat outside cyl
 *   shadow cone), satellite is sunlit.
 */
function isSunlit(
  satEci: { x: number; y: number; z: number },
  date: Date,
): boolean {
  const s = sunEci(date);
  const ds = Math.hypot(s.x, s.y, s.z);
  const sx = s.x / ds,
    sy = s.y / ds,
    sz = s.z / ds;
  const proj = satEci.x * sx + satEci.y * sy + satEci.z * sz;
  if (proj >= 0) return true;
  const sat2 = satEci.x * satEci.x + satEci.y * satEci.y + satEci.z * satEci.z;
  const perp = Math.sqrt(Math.max(0, sat2 - proj * proj));
  return perp > R_EARTH_KM;
}

/**
 * Estimate apparent magnitude of a satellite given its slant range and the
 * phase angle (sun-satellite-observer). Heuristic — real values vary with
 * orientation of the solar panels — but good enough to drive a per-pixel
 * brightness that the eye perceives correctly.
 */
function magnitudeOf(name: string, rangeKm: number, phaseDeg: number): number {
  // Reference magnitudes for each platform at 1000 km, phase 50°.
  const M0: Record<string, number> = {
    "ISS (ZARYA)": -1.8,
    "CSS (TIANHE)": -1.0,
    HST: 1.5,
  };
  const m0 = M0[name] ?? 2.0;
  const rangeTerm = 5 * Math.log10(rangeKm / 1000);
  // Crude phase function: linear add of ~0.013 mag/deg past 0°.
  const phaseTerm = 0.013 * Math.max(0, phaseDeg - 50);
  return m0 + rangeTerm + phaseTerm;
}

/**
 * For each loaded TLE, compute the satellite's sighting at the given observer
 * + time. Returns only sightings that are above the horizon AND sunlit
 * (the eye cannot see eclipsed satellites — they vanish into Earth's shadow
 * mid-pass, a real-sky phenomenon).
 */
export function visibleSatellites(
  observer: Observer,
  date: Date,
): SatelliteSighting[] {
  if (!cache) return [];
  const out: SatelliteSighting[] = [];
  const observerGd = {
    latitude: observer.latDeg * DEG,
    longitude: observer.lonDeg * DEG,
    height: 0.0, // km; sea-level approximation fine for naked-eye accuracy.
  };

  for (const s of cache) {
    const pv = sat.propagate(s.rec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    const eci = pv.position as { x: number; y: number; z: number };
    const sunlit = isSunlit(eci, date);
    if (!sunlit) continue;

    const gmst = sat.gstime(date);
    const ecf = sat.eciToEcf(eci, gmst) as { x: number; y: number; z: number };
    const look = sat.ecfToLookAngles(observerGd, ecf);
    const altDeg = (look.elevation as number) * RAD;
    if (altDeg < 0) continue;
    const azDeg = ((((look.azimuth as number) * RAD) % 360) + 360) % 360;
    const rangeKm = look.rangeSat as number;

    // Phase angle (sun-satellite-observer): vector from sat to sun vs vector
    // from sat to observer.
    const sun = sunEci(date);
    const satToSun = {
      x: sun.x - eci.x,
      y: sun.y - eci.y,
      z: sun.z - eci.z,
    };
    // Observer ECI: convert geodetic to ECI by way of ECF then rotate by gmst.
    // satellite.js has no direct helper; approximate: |observer| ≈ R_earth.
    // For our magnitude-only purposes, the sun-sat-observer angle is dominated
    // by sat-sun direction vs the observer-sun direction; |sat-obs| << |sun|.
    // Use sat-to-(-sat) direction (i.e. anti-sat from Earth center) as a proxy
    // for sat-to-observer direction.
    const satToObs = { x: -eci.x, y: -eci.y, z: -eci.z };
    const dot =
      satToSun.x * satToObs.x +
      satToSun.y * satToObs.y +
      satToSun.z * satToObs.z;
    const ns = Math.hypot(satToSun.x, satToSun.y, satToSun.z);
    const no = Math.hypot(satToObs.x, satToObs.y, satToObs.z);
    const cosPhase = Math.max(-1, Math.min(1, dot / (ns * no)));
    const phaseDeg = Math.acos(cosPhase) * RAD;
    const mag = magnitudeOf(s.name, rangeKm, phaseDeg);

    out.push({
      name: s.name,
      altDeg,
      azDeg,
      rangeKm,
      mag,
      sunlit: true,
    });
  }
  return out;
}
