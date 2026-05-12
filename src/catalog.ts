// Embedded bright-star catalog for Step 1.
//
// Source: visual magnitudes and J2000 ICRS positions are public-domain values
// taken from the SIMBAD / Hipparcos catalog and rounded to 4 decimal places.
// This is a curated subset of the ~70 brightest naked-eye stars (mag ≲ 2.5)
// plus the seven stars of the Big Dipper for easy visual verification.
//
// Step 2/3 will replace this with HEALPix-tiled Gaia DR3 (mag ≤ 6.5, ~9k stars).
// Until then, this list is enough to test the coordinate pipeline and
// satisfy the Step 1 acceptance ("point at Vega/Sirius/Polaris, see the dot").

export interface Star {
  name: string;
  /** Right ascension in degrees, J2000 ICRS. */
  ra: number;
  /** Declination in degrees, J2000 ICRS. */
  dec: number;
  /** Apparent visual magnitude (V). */
  mag: number;
}

export const BRIGHT_STARS: Star[] = [
  { name: "Sirius", ra: 101.2872, dec: -16.7161, mag: -1.46 },
  { name: "Canopus", ra: 95.988, dec: -52.6957, mag: -0.74 },
  { name: "Arcturus", ra: 213.9154, dec: 19.1825, mag: -0.05 },
  { name: "Rigil Kentaurus", ra: 219.9021, dec: -60.8339, mag: -0.01 },
  { name: "Vega", ra: 279.2347, dec: 38.7837, mag: 0.03 },
  { name: "Capella", ra: 79.1723, dec: 45.9981, mag: 0.08 },
  { name: "Rigel", ra: 78.6345, dec: -8.2017, mag: 0.13 },
  { name: "Procyon", ra: 114.8255, dec: 5.225, mag: 0.34 },
  { name: "Achernar", ra: 24.4285, dec: -57.2367, mag: 0.46 },
  { name: "Betelgeuse", ra: 88.7929, dec: 7.4071, mag: 0.5 },
  { name: "Hadar", ra: 210.9559, dec: -60.3729, mag: 0.61 },
  { name: "Altair", ra: 297.6959, dec: 8.8683, mag: 0.77 },
  { name: "Acrux", ra: 186.6496, dec: -63.0991, mag: 0.77 },
  { name: "Aldebaran", ra: 68.98, dec: 16.5093, mag: 0.85 },
  { name: "Antares", ra: 247.3519, dec: -26.432, mag: 1.09 },
  { name: "Spica", ra: 201.2983, dec: -11.1613, mag: 0.98 },
  { name: "Pollux", ra: 116.3289, dec: 28.0262, mag: 1.14 },
  { name: "Fomalhaut", ra: 344.4127, dec: -29.6222, mag: 1.16 },
  { name: "Deneb", ra: 310.3579, dec: 45.2803, mag: 1.25 },
  { name: "Mimosa", ra: 191.9303, dec: -59.6888, mag: 1.25 },
  { name: "Regulus", ra: 152.0929, dec: 11.9672, mag: 1.36 },
  { name: "Adhara", ra: 104.6564, dec: -28.9721, mag: 1.5 },
  { name: "Shaula", ra: 263.4022, dec: -37.1038, mag: 1.62 },
  { name: "Castor", ra: 113.6496, dec: 31.8883, mag: 1.58 },
  { name: "Gacrux", ra: 187.7915, dec: -57.1131, mag: 1.63 },
  { name: "Bellatrix", ra: 81.2828, dec: 6.3497, mag: 1.64 },
  { name: "Elnath", ra: 81.5729, dec: 28.6075, mag: 1.65 },
  { name: "Miaplacidus", ra: 138.2999, dec: -69.7172, mag: 1.69 },
  { name: "Alnilam", ra: 84.0533, dec: -1.2019, mag: 1.69 },
  { name: "Alnair", ra: 332.0583, dec: -46.9612, mag: 1.74 },
  { name: "Alnitak", ra: 85.1897, dec: -1.9426, mag: 1.79 },
  { name: "Dubhe", ra: 165.9319, dec: 61.7511, mag: 1.79 },
  { name: "Mirfak", ra: 51.0807, dec: 49.8612, mag: 1.79 },
  { name: "Wezen", ra: 107.0978, dec: -26.3932, mag: 1.83 },
  { name: "Sargas", ra: 264.3297, dec: -43.0023, mag: 1.86 },
  { name: "Kaus Australis", ra: 276.043, dec: -34.3846, mag: 1.85 },
  { name: "Avior", ra: 125.6284, dec: -59.5096, mag: 1.86 },
  { name: "Alkaid", ra: 206.8852, dec: 49.3133, mag: 1.86 },
  { name: "Atria", ra: 252.1661, dec: -69.0277, mag: 1.91 },
  { name: "Menkalinan", ra: 89.882, dec: 44.9474, mag: 1.9 },
  { name: "Alhena", ra: 99.428, dec: 16.3993, mag: 1.93 },
  { name: "Peacock", ra: 306.4119, dec: -56.7351, mag: 1.94 },
  { name: "Mirzam", ra: 95.6749, dec: -17.9559, mag: 1.98 },
  { name: "Polaris", ra: 37.9546, dec: 89.2641, mag: 1.98 },
  { name: "Alphard", ra: 141.8968, dec: -8.6586, mag: 1.98 },
  { name: "Hamal", ra: 31.7933, dec: 23.4624, mag: 2.0 },
  { name: "Algieba", ra: 154.9931, dec: 19.8415, mag: 2.08 },
  { name: "Diphda", ra: 10.8975, dec: -17.987, mag: 2.04 },
  { name: "Mizar", ra: 200.9814, dec: 54.9254, mag: 2.27 },
  { name: "Nunki", ra: 283.8163, dec: -26.2967, mag: 2.05 },
  { name: "Menkent", ra: 211.6708, dec: -36.3699, mag: 2.06 },
  { name: "Alpheratz", ra: 2.0967, dec: 29.0904, mag: 2.07 },
  { name: "Saiph", ra: 86.9391, dec: -9.6697, mag: 2.09 },
  { name: "Kochab", ra: 222.6764, dec: 74.1555, mag: 2.07 },
  { name: "Rasalhague", ra: 263.7335, dec: 12.5601, mag: 2.08 },
  { name: "Algol", ra: 47.0422, dec: 40.9556, mag: 2.12 },
  { name: "Almach", ra: 30.9748, dec: 42.3297, mag: 2.1 },
  { name: "Denebola", ra: 177.2649, dec: 14.5721, mag: 2.14 },
  { name: "Caph", ra: 2.295, dec: 59.1498, mag: 2.27 },
  { name: "Izar", ra: 221.247, dec: 27.0742, mag: 2.37 },
  { name: "Schedar", ra: 10.1268, dec: 56.5374, mag: 2.24 },
  { name: "Merak", ra: 165.4602, dec: 56.3824, mag: 2.37 },
  { name: "Phecda", ra: 178.4577, dec: 53.6948, mag: 2.44 },
  { name: "Megrez", ra: 183.8565, dec: 57.0326, mag: 3.31 },
  { name: "Alioth", ra: 193.5073, dec: 55.9598, mag: 1.76 },
  { name: "Eltanin", ra: 269.1515, dec: 51.4889, mag: 2.23 },
  { name: "Mintaka", ra: 83.0017, dec: -0.2991, mag: 2.23 },
];
