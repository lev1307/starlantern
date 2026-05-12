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
