// Naked-eye deep-sky objects. At a Bortle ≤ 4 sky these are the patches of
// sky that look subtly different from "more stars" — soft glowing clouds, a
// fuzzy oval (Andromeda), the bluish dipper of the Pleiades. They're visible
// without optical aid and a "what the eye sees" renderer that omits them
// reads as too sterile.
//
// Catalog kept tight: only the objects a casual naked-eye observer would
// actually pick out under a dark sky. Each has J2000 RA/Dec, an apparent
// magnitude, an angular extent (major × minor axis in degrees) so the
// rendered patch matches the real angular footprint, and a color hint
// (B-V-like) so M42 reads as pinkish-red, M45 as blue-white, M31 as warm
// yellow, etc.

import type { Equatorial } from "./coords";

export interface NakedEyeDSO {
  /** Common identifier (Messier number, NGC, or familiar name). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** J2000 ICRS coordinates, degrees. */
  pos: Equatorial;
  /** Integrated apparent visual magnitude. */
  mag: number;
  /** Major / minor axis in degrees (apparent angular size). */
  majorDeg: number;
  minorDeg: number;
  /** Position angle of major axis (degrees east of north). 0 = aligned to north. */
  paDeg: number;
  /**
   * Linear-sRGB color tint of the patch. Picked to match what dark-adapted
   * vision actually reports (mostly washed out by scotopic vision — only
   * very bright nebulae like M42 give a perceptible hue).
   */
  color: [number, number, number];
  /** Surface-brightness flavor: 'galaxy' | 'nebula' | 'cluster' — drives the rendered profile. */
  kind: "galaxy" | "nebula" | "cluster";
}

/**
 * Curated list. Magnitudes and sizes from SEDS Messier database / Wikipedia
 * (integrated visual mag, apparent extent in degrees). PA approximated.
 */
export const NAKED_EYE_DSO: readonly NakedEyeDSO[] = [
  {
    id: "M31",
    name: "Andromeda Galaxy",
    pos: { ra: 10.6847, dec: 41.2687 },
    mag: 3.4,
    majorDeg: 3.2,
    minorDeg: 1.0,
    paDeg: 35,
    color: [0.95, 0.88, 0.72],
    kind: "galaxy",
  },
  {
    id: "M33",
    name: "Triangulum Galaxy",
    pos: { ra: 23.4621, dec: 30.6602 },
    mag: 5.7,
    majorDeg: 1.2,
    minorDeg: 0.7,
    paDeg: 23,
    color: [0.9, 0.86, 0.75],
    kind: "galaxy",
  },
  {
    id: "M42",
    name: "Orion Nebula",
    pos: { ra: 83.8221, dec: -5.3911 },
    mag: 4.0,
    majorDeg: 1.1,
    minorDeg: 1.0,
    paDeg: 0,
    color: [0.95, 0.55, 0.6],
    kind: "nebula",
  },
  {
    id: "M45",
    name: "Pleiades",
    pos: { ra: 56.75, dec: 24.1167 },
    mag: 1.6,
    majorDeg: 1.8,
    minorDeg: 1.5,
    paDeg: 0,
    color: [0.78, 0.85, 1.0],
    kind: "cluster",
  },
  {
    id: "M44",
    name: "Beehive Cluster",
    pos: { ra: 130.1, dec: 19.9167 },
    mag: 3.7,
    majorDeg: 1.5,
    minorDeg: 1.5,
    paDeg: 0,
    color: [0.85, 0.9, 1.0],
    kind: "cluster",
  },
  {
    id: "Mel20",
    name: "Alpha Persei Cluster",
    pos: { ra: 51.07, dec: 49.86 },
    mag: 1.2,
    majorDeg: 3.0,
    minorDeg: 2.0,
    paDeg: 90,
    color: [0.95, 0.9, 0.85],
    kind: "cluster",
  },
  {
    id: "NGC869+884",
    name: "Double Cluster",
    pos: { ra: 34.74, dec: 57.13 },
    mag: 4.3,
    majorDeg: 1.0,
    minorDeg: 0.5,
    paDeg: 90,
    color: [0.85, 0.88, 0.95],
    kind: "cluster",
  },
  {
    id: "Mel25",
    name: "Hyades",
    pos: { ra: 66.75, dec: 15.87 },
    mag: 0.5,
    majorDeg: 5.5,
    minorDeg: 5.5,
    paDeg: 0,
    color: [0.95, 0.85, 0.7],
    kind: "cluster",
  },
  {
    id: "Coma",
    name: "Coma Star Cluster",
    pos: { ra: 186.0, dec: 25.85 },
    mag: 1.8,
    majorDeg: 4.5,
    minorDeg: 4.5,
    paDeg: 0,
    color: [0.92, 0.92, 0.95],
    kind: "cluster",
  },
  {
    id: "LMC",
    name: "Large Magellanic Cloud",
    pos: { ra: 80.8939, dec: -69.7561 },
    mag: 0.9,
    majorDeg: 10.75,
    minorDeg: 9.17,
    paDeg: 170,
    color: [0.95, 0.9, 0.78],
    kind: "galaxy",
  },
  {
    id: "SMC",
    name: "Small Magellanic Cloud",
    pos: { ra: 13.158, dec: -72.8003 },
    mag: 2.2,
    majorDeg: 5.33,
    minorDeg: 3.5,
    paDeg: 45,
    color: [0.94, 0.9, 0.8],
    kind: "galaxy",
  },
  // ---- Bortle-1 territory: visible only at truly dark sites -----------------
  {
    id: "NGC7000",
    name: "North America Nebula",
    pos: { ra: 314.75, dec: 44.31 },
    mag: 4.0,
    majorDeg: 2.0,
    minorDeg: 1.7,
    paDeg: 0,
    color: [0.95, 0.55, 0.55],
    kind: "nebula",
  },
  {
    id: "NGC6960",
    name: "Veil Nebula (West)",
    pos: { ra: 312.75, dec: 30.72 },
    mag: 7.0,
    majorDeg: 1.2,
    minorDeg: 0.2,
    paDeg: 165,
    color: [0.5, 0.7, 0.95],
    kind: "nebula",
  },
  {
    id: "M81",
    name: "Bode's Galaxy",
    pos: { ra: 148.888, dec: 69.065 },
    mag: 6.94,
    majorDeg: 0.45,
    minorDeg: 0.22,
    paDeg: 157,
    color: [0.95, 0.88, 0.72],
    kind: "galaxy",
  },
  {
    id: "M104",
    name: "Sombrero Galaxy",
    pos: { ra: 189.998, dec: -11.623 },
    mag: 8.0,
    majorDeg: 0.15,
    minorDeg: 0.07,
    paDeg: 90,
    color: [0.95, 0.88, 0.72],
    kind: "galaxy",
  },
  {
    id: "M13",
    name: "Great Hercules Cluster",
    pos: { ra: 250.4234, dec: 36.4613 },
    mag: 5.8,
    majorDeg: 0.33,
    minorDeg: 0.33,
    paDeg: 0,
    color: [0.95, 0.92, 0.85],
    kind: "cluster",
  },
  {
    id: "M22",
    name: "Sagittarius Cluster",
    pos: { ra: 279.0998, dec: -23.9047 },
    mag: 5.1,
    majorDeg: 0.55,
    minorDeg: 0.55,
    paDeg: 0,
    color: [0.95, 0.88, 0.75],
    kind: "cluster",
  },
  {
    id: "M5",
    name: "M5 Globular Cluster",
    pos: { ra: 229.6384, dec: 2.0811 },
    mag: 5.7,
    majorDeg: 0.38,
    minorDeg: 0.38,
    paDeg: 0,
    color: [0.95, 0.92, 0.85],
    kind: "cluster",
  },
  {
    id: "h+chi",
    name: "Heart and Soul Region",
    pos: { ra: 38.18, dec: 61.45 },
    mag: 6.5,
    majorDeg: 3.0,
    minorDeg: 2.0,
    paDeg: 100,
    color: [0.95, 0.55, 0.55],
    kind: "nebula",
  },
  {
    id: "M7",
    name: "Ptolemy Cluster",
    pos: { ra: 268.46, dec: -34.79 },
    mag: 3.3,
    majorDeg: 1.3,
    minorDeg: 1.3,
    paDeg: 0,
    color: [0.95, 0.92, 0.85],
    kind: "cluster",
  },
  {
    id: "M6",
    name: "Butterfly Cluster",
    pos: { ra: 265.08, dec: -32.22 },
    mag: 4.2,
    majorDeg: 0.42,
    minorDeg: 0.42,
    paDeg: 0,
    color: [0.92, 0.92, 0.95],
    kind: "cluster",
  },
];
