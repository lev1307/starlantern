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
];
