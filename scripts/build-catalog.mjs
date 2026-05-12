#!/usr/bin/env node
// Filter the HYG-Database CSV to mag ≤ MAG_LIMIT and emit a compact binary file:
//   layout: Float32 RA (deg), Float32 Dec (deg), Float32 Mag (V), Float32 BV
//   N stars → 16·N bytes. mag ≤ 6.5 ≈ 9,096 records → ~145 kB.
//
// Run:   node scripts/build-catalog.mjs <hyg.csv> <out.bin>
// HYG source: https://github.com/astronexus/HYG-Database (Astronexus/Whittman, CC BY-SA 4.0).

import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const MAG_LIMIT = 6.5;
const SRC = process.argv[2] ?? "/tmp/hyg.csv";
const OUT = process.argv[3] ?? "public/data/stars.bin";

const lines = readFileSync(SRC, "utf8").split(/\r?\n/);
const header = lines.shift();
if (!header) throw new Error("empty CSV");

const cols = header.replace(/"/g, "").split(",");
const idx = (name) => {
  const i = cols.indexOf(name);
  if (i < 0) throw new Error(`column '${name}' not found in HYG csv`);
  return i;
};
const iRa = idx("ra");
const iDec = idx("dec");
const iMag = idx("mag");
const iCi = idx("ci");

// Simple CSV row splitter — HYG values have no embedded commas inside quoted fields
// for the columns we use (ra/dec/mag/ci are numeric). A naive split is safe.
const records = [];
for (const line of lines) {
  if (!line) continue;
  const parts = line.split(",");
  const ra = parseFloat(parts[iRa]);
  const dec = parseFloat(parts[iDec]);
  const mag = parseFloat(parts[iMag]);
  const ci = parts[iCi] === "" ? 0.6 : parseFloat(parts[iCi]);
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(mag))
    continue;
  if (mag > MAG_LIMIT) continue;
  // HYG `ra` is in hours; convert to degrees.
  records.push({ ra: ra * 15, dec, mag, bv: Number.isFinite(ci) ? ci : 0.6 });
}

// HYG row 0 is the Sun (ra=0, dec=0, mag=-26.7) — also passes mag ≤ 6.5. Skip it.
const stars = records.filter((s) => !(s.ra === 0 && s.dec === 0 && s.mag < -10));

const buf = Buffer.allocUnsafe(stars.length * 16);
for (let i = 0; i < stars.length; i++) {
  const s = stars[i];
  buf.writeFloatLE(s.ra, i * 16 + 0);
  buf.writeFloatLE(s.dec, i * 16 + 4);
  buf.writeFloatLE(s.mag, i * 16 + 8);
  buf.writeFloatLE(s.bv, i * 16 + 12);
}

writeFileSync(OUT, buf);
console.log(
  `Wrote ${stars.length} stars (mag ≤ ${MAG_LIMIT}) to ${OUT} (${buf.length} bytes)`,
);
