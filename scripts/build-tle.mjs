#!/usr/bin/env node
// Snapshot the most visually-bright satellites' TLE elements from CelesTrak into
// public/data/tle.json. Run at deploy time (or whenever the elements drift > a few
// days — SGP4 accuracy degrades over weeks). Outputs a small array the runtime
// loader fetches and SGP4-propagates.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TARGETS = [
  { name: 'ISS (ZARYA)', catnr: 25544 },
  { name: 'CSS (TIANHE)', catnr: 48274 }, // Chinese space station — also naked-eye bright
  { name: 'HST', catnr: 20580 }, // Hubble, occasionally naked-eye on bright passes
];

const OUT = process.argv[2] ?? 'public/data/tle.json';

async function fetchTLE(catnr) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${catnr}&FORMAT=tle`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TLE fetch failed ${catnr}: ${r.status}`);
  const text = (await r.text()).trim();
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) throw new Error(`TLE for ${catnr} malformed`);
  return { name: lines[0].trim(), line1: lines[1].trim(), line2: lines[2].trim() };
}

const results = [];
for (const t of TARGETS) {
  try {
    const tle = await fetchTLE(t.catnr);
    results.push({ ...tle, catnr: t.catnr });
    console.log(`  ${t.name}: ok (epoch from line 1)`);
  } catch (err) {
    console.warn(`  ${t.name}: skipped (${err.message})`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ fetchedAt: new Date().toISOString(), satellites: results }, null, 2),
);
console.log(`Wrote ${results.length} TLE records to ${OUT}`);
