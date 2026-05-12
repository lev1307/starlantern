// Galactic-coordinate helpers + a procedural naked-eye Milky Way density model.
//
// The Milky Way as seen by the human eye is a faint diffuse band along the
// galactic equator, brightest toward the galactic centre (Sagittarius), with
// dark dust lanes carving it up. A telescope shows structure; the eye sees
// shape, not stars. For naked-eye realism we model it as a single scalar
// density per (l, b) in galactic coordinates, sampled per fragment.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Galactic North Pole, J2000 (Reid & Brunthaler 2004).
const GNP_RA_DEG = 192.85948;
const GNP_DEC_DEG = 27.12825;
// Galactic centre, J2000.
const GC_RA_DEG = 266.40499;
const GC_DEC_DEG = -28.93617;
// Longitude of the celestial north pole in galactic coordinates, used for the
// rotation about the galactic pole.
const L0_DEG = 122.93192;

/**
 * Equatorial (RA, Dec) → Galactic (l, b), both in degrees, J2000.
 * Standard rotation, e.g. Binney & Merrifield (1998) eq. 2.91-2.94.
 */
export function equatorialToGalactic(
  raDeg: number,
  decDeg: number,
): { lDeg: number; bDeg: number } {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const raN = GNP_RA_DEG * DEG;
  const decN = GNP_DEC_DEG * DEG;
  const sinB =
    Math.sin(dec) * Math.sin(decN) +
    Math.cos(dec) * Math.cos(decN) * Math.cos(ra - raN);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));
  const y = Math.cos(dec) * Math.sin(ra - raN);
  const x =
    Math.sin(dec) * Math.cos(decN) -
    Math.cos(dec) * Math.sin(decN) * Math.cos(ra - raN);
  let l = L0_DEG - Math.atan2(y, x) * RAD;
  l = ((l % 360) + 360) % 360;
  return { lDeg: l, bDeg: b * RAD };
}

// Sanity wrapper: galactic centre in equatorial coords for sanity tests.
export const GALACTIC_CENTRE_EQ = { raDeg: GC_RA_DEG, decDeg: GC_DEC_DEG };

/**
 * Naked-eye Milky Way surface brightness (dimensionless 0-1) at galactic
 * coordinates (l, b). Composes three terms that approximate the visual shape:
 *
 *   - sech²(b / b₀) vertical disc profile, b₀ ≈ 4° (the disc reads as roughly
 *     8° thick to the eye, falling off fast above)
 *   - cos-weighted longitude bulge centred on Sagittarius (l = 0°), so the
 *     band is brightest there and dimmest in the anticentre (l = 180°)
 *   - a coarse, deterministic noise term that breaks the band into the
 *     mottled "patches and rifts" appearance — pure value-noise hashed from
 *     (l, b) so the pattern is stable across frames and observers.
 *
 * The result is intended to be summed into the sky background colour with a
 * small weight (~0.05) so it reads as a faint diffuse band that vanishes
 * under city light pollution, exactly like the real Milky Way.
 */
export function milkyWayDensity(lDeg: number, bDeg: number): number {
  // Wrap l to [-180, 180].
  let l = ((((lDeg + 180) % 360) + 360) % 360) - 180;
  const b = bDeg;

  // Vertical disc profile: sech² with scale-height b0 ≈ 4°.
  const b0 = 4.0;
  const sech = 1 / Math.cosh(b / b0);
  const disc = sech * sech;

  // Longitude bulge: brightest at l=0 (galactic centre / Sagittarius bulge),
  // tapering through the spiral arms, dim toward the anticentre.
  // 0.55 + 0.45 cos(l) gives a smooth profile that doesn't drop to zero in the
  // anticentre — the real MW is dimmer but never invisible there.
  const lradians = l * DEG;
  const longBulge = 0.55 + 0.45 * Math.cos(lradians);

  // Coarse mottle noise: value-noise hashed from rounded (l, b) cells.
  const cellL = Math.floor(l * 0.5);
  const cellB = Math.floor(b * 0.5);
  const h = Math.sin(cellL * 12.9898 + cellB * 78.233) * 43758.5453;
  const noise = h - Math.floor(h); // ∈ [0, 1)
  const mottle = 0.7 + 0.3 * noise;

  return disc * longBulge * mottle;
}
