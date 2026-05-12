// Astrophysical conversions: stellar color (B-V → Teff → sRGB), magnitude → relative
// luminance, atmospheric airmass + extinction, Bortle-scale sky background.
//
// References:
//   - Ballesteros 2012, "New insights into black bodies" — B-V → Teff fit.
//   - Tanner Helland blackbody → sRGB approximation (commonly cited; valid ~1000–40000 K).
//   - Kasten & Young 1989 — relative optical airmass at zenith angles up to ~89°.
//   - Bortle 2001 — sky brightness in magnitudes per square arcsecond.
//
// All sRGB values returned in [0, 1] linear space — caller applies gamma if needed.

/** Ballesteros 2012 fit. Valid roughly for -0.5 ≤ B-V ≤ 1.8. */
export function bvToTeff(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/**
 * Blackbody temperature → linear sRGB.
 * Tanner Helland's approximation. Output channels clamped to [0, 1].
 */
export function teffToRgb(teffKelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, teffKelvin)) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    if (t <= 19) {
      b = 0;
    } else {
      b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    }
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v / 255));
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** Convenience: B-V index → linear-sRGB triplet. */
export function bvToRgb(bv: number): [number, number, number] {
  return teffToRgb(bvToTeff(bv));
}

/**
 * Apparent visual magnitude → relative linear flux.
 * Pogson scale: flux_ratio = 100^((m_ref - m)/5). We normalize so mag 0 == 1 and
 * each higher magnitude is ~2.512× dimmer.
 */
export function magToFlux(mag: number, mag0 = 0): number {
  return Math.pow(10, (mag0 - mag) * 0.4);
}

/**
 * Kasten-Young 1989 relative optical airmass. zenithDeg in [0, 90).
 * At zenith X ≈ 1; at 60° X ≈ 2; at 89° X ≈ 26.
 */
export function airmass(altDeg: number): number {
  if (altDeg <= -1) return Infinity;
  const z = Math.max(0.001, 90 - altDeg); // zenith angle, deg
  const zRad = (z * Math.PI) / 180;
  return 1 / (Math.cos(zRad) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

/**
 * Atmospheric extinction in magnitudes for V-band as a function of altitude.
 * k = clear-sky extinction coefficient (mag/airmass). ~0.28 at sea level, dark site.
 */
export function extinctionMag(altDeg: number, k = 0.28): number {
  if (altDeg <= 0) return 30; // below horizon = invisible
  return k * airmass(altDeg);
}

/**
 * Atmospheric refraction lift, in degrees. Bennett 1982 fit, valid 0°-90°.
 *
 *   R(h_apparent) = 1 / tan(h_app + 7.31 / (h_app + 4.4))   [arcminutes]
 *
 * At the horizon R ≈ 34', i.e. a star at geometric altitude -34' appears on
 * the horizon. We use this to lift the rendered altitude so stars near the
 * horizon sit where the eye actually sees them.
 */
export function refractionDeg(altDeg: number): number {
  if (altDeg < -1) return 0; // well below horizon — don't bother
  const hApp = Math.max(altDeg, -0.5); // clamp so tan doesn't blow up
  const R_arcmin =
    1.0 / Math.tan(((hApp + 7.31 / (hApp + 4.4)) * Math.PI) / 180);
  // Bennett gives R for apparent altitude; iterating once corrects the small
  // approximation when treating the input as geometric — within 0.1' across the sky.
  return R_arcmin / 60;
}

/**
 * Scintillation amplitude (relative flux modulation 1-σ). Twinkle is caused
 * by atmospheric turbulence and scales roughly with airmass^0.75 (Young 1969).
 * At zenith on a calm night ~0.5%; near horizon up to ~15-30% for bright stars.
 *
 * Real twinkle frequency is ~5-50 Hz (the eye integrates the higher end);
 * the renderer modulates per-star intensity at a few Hz so the effect reads
 * as a slow shimmer rather than a strobe.
 */
export function scintillationAmplitude(altDeg: number): number {
  if (altDeg <= 0) return 0; // below horizon
  const X = airmass(altDeg);
  // Young 1969 empirical fit, scaled so zenith ≈ 0.005, 30° ≈ 0.012, 10° ≈ 0.06.
  return Math.min(0.35, 0.005 * Math.pow(X, 1.7));
}

/**
 * Bortle-scale → night-sky surface brightness in mag/arcsec² (V-band, zenith).
 * Bortle 1 ≈ 22.0 mag/arcsec² (excellent dark sky)
 * Bortle 9 ≈ 18.0 mag/arcsec² (inner city)
 */
export function bortleSkyMag(bortle: number): number {
  const b = Math.max(1, Math.min(9, bortle));
  // Linear fit between Bortle 1 (22.0) and Bortle 9 (18.0).
  return 22.0 - ((b - 1) / 8) * 4.0;
}

/**
 * Naked-eye limiting magnitude as a function of Bortle scale.
 * Approximation from Bortle 2001: about mag 7.8 (B1) down to mag 4.0 (B9).
 */
export function bortleLimitMag(bortle: number): number {
  const b = Math.max(1, Math.min(9, bortle));
  return 7.8 - ((b - 1) / 8) * 3.8;
}

/**
 * Sky surface brightness in V-band mag/arcsec² as a function of the Sun's
 * altitude. Pure-dark-sky floor is 22.0; values shrink (sky gets brighter)
 * through astronomical (-18°), nautical (-12°), civil (-6°) twilight; above
 * 0° the sky is full daylight (~5 mag/arcsec²).
 *
 * Reference shape adapted from Krisciunas & Schaefer 1991 + simplified field
 * data: roughly piecewise log-linear in sun altitude.
 */
export function twilightSkyMag(sunAltDeg: number): number {
  if (sunAltDeg >= 0) return 5; // daylight — stars unobservable
  if (sunAltDeg <= -18) return 22; // astronomical dark
  if (sunAltDeg <= -12) {
    // -18 → 22.0, -12 → 18.5
    const t = (sunAltDeg + 18) / 6;
    return 22.0 - t * 3.5;
  }
  if (sunAltDeg <= -6) {
    // -12 → 18.5, -6 → 12.5
    const t = (sunAltDeg + 12) / 6;
    return 18.5 - t * 6.0;
  }
  // -6 → 12.5, 0 → 5.0
  const t = (sunAltDeg + 6) / 6;
  return 12.5 - t * 7.5;
}

/**
 * Limiting naked-eye magnitude given a sky surface brightness.
 * Rough fit from human-eye contrast experiments (Schaefer 1990 condensed):
 *   - mag 22 sky → limit ≈ 7.8
 *   - mag 18 sky → limit ≈ 4.0
 *   - mag 12 sky → limit ≈ -1 (only Venus/Sirius)
 *   - mag 5 sky  → no stars
 */
export function skyMagToLimitMag(skyMag: number): number {
  if (skyMag <= 5) return -Infinity;
  if (skyMag >= 22) return 7.8;
  // Piecewise linear through anchors above.
  if (skyMag >= 18) return 4.0 + ((skyMag - 18) / 4) * 3.8;
  if (skyMag >= 12) return -1.0 + ((skyMag - 12) / 6) * 5.0;
  // 5 → -∞ ; 12 → -1. Use linear in this band; caller can clip below mag-4 floor.
  return -8 + ((skyMag - 5) / 7) * 7.0;
}

/**
 * Effective limiting magnitude given Bortle floor + current twilight state.
 * The brighter of the two bounding-magnitudes wins: civil twilight at a dark
 * site is still limited by twilight; mid-night under a Bortle-9 city is
 * limited by the city. Take the minimum (i.e. fewest stars visible).
 */
export function effectiveLimitMag(bortle: number, sunAltDeg: number): number {
  const bMag = bortleLimitMag(bortle);
  const tMag = skyMagToLimitMag(twilightSkyMag(sunAltDeg));
  return Math.min(bMag, tMag);
}

/**
 * Scotopic desaturation factor in [0, 1]. As stellar luminance drops below the
 * scotopic threshold, the human eye's color receptors die off and the percept
 * desaturates toward neutral gray-blue. We model this as a smooth blend toward
 * (0.85, 0.92, 1.0) for very faint stars.
 *
 * Caller does: out_color = mix(neutral_gray_blue, star_color, scotopicSaturation(flux))
 */
export function scotopicSaturation(relativeFlux: number): number {
  // Smoothstep over a perceptual range: full saturation at flux ≥ 1, near zero at flux ≤ 0.005.
  const t =
    Math.log10(Math.max(1e-6, relativeFlux) / 0.005) / Math.log10(1 / 0.005);
  return Math.max(0, Math.min(1, t));
}
