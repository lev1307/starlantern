# Field shoot — shot list

Written 2026-08-09 so that on a clear night you are executing, not deciding.

**The one thing this shoot must produce:** 15 seconds of Starlantern's badge holding arcminutes
while a compass-driven app slides. Everything else is a bonus. If you get cold, tired, or clouded
out, get Shot 3 and go home.

---

## When: the window is now, and it is unusually good

Computed from the repo's own Meeus model (`src/moon.ts`) and shower table (`src/meteors.ts`):

| Date (2026) | Moon illum.       | Notes                                                                   |
| ----------- | ----------------- | ----------------------------------------------------------------------- |
| Aug 9       | 12%               | usable                                                                  |
| Aug 10      | 5%                | good                                                                    |
| Aug 11      | 1%                | very good                                                               |
| **Aug 12**  | **0% — new moon** | **Perseid peak (ZHR 100 in the app's model). Best night of the month.** |
| Aug 13      | 2%                | Perseids still near peak                                                |
| Aug 14–16   | 6–12%             | good                                                                    |
| Aug 17–20   | 29–58%            | degrading                                                               |
| Aug 27      | 100%              | full moon — useless for faint sky                                       |

New moon landing exactly on the Perseid peak is a coincidence worth using. It also gives the posts a
topical hook if you publish in that week.

**Moon matters differently per shot.** The dark sky window is for the _beauty_ shots. The
**accuracy shot does not need a dark sky** — it needs enough stars to solve, which works fine under
moonlight or from a suburban street. Do not postpone the accuracy shot waiting for perfect
conditions; it is the shot that matters and it has the loosest requirements.

Time: astronomical dark in Munich in mid-August starts roughly 22:30–23:00 CEST.

---

## Critical: you must run the dev server, not the live site

Telemetry POSTs to `/__log`, which is served **only by the Vite dev-server plugin**. The production
`/api/log` was never implemented, so **filming on ar-night-sky.vercel.app captures no numbers at
all** — you would come home with video and no data to fill the `{{...}}` placeholders in the launch
copy.

Sensors and camera also need HTTPS, so a plain LAN IP won't work. The repo already has the fix:

```bash
npm run dev
```

```bash
npm run tunnel
```

That second command prints an HTTPS `trycloudflare.com` URL. Open **that** on the phone. Logs land
in `logs/session-*.jsonl` on the laptop.

**This means the laptop comes with you**, and it means you need signal at the site — which you need
anyway, because plate-solving currently round-trips to astrometry.net. Pick somewhere dark-ish with
coverage rather than genuinely remote. (This constraint is exactly the argument for the on-device
WASM solver; note how it feels tonight, it's launch-post material.)

---

## Pre-flight — do this at home, in the light

- [ ] `npm run gen-tle` — SGP4 drifts ~1°/week; stale TLEs put the ISS in the wrong place on camera.
- [ ] `npm run dev` + `npm run tunnel`, open the HTTPS URL on the phone, **grant motion + camera +
      location**, and confirm a `logs/session-*.jsonl` file appears and grows on the laptop.
- [ ] **Dry-run the full chain indoors**: display a star field on your monitor at full brightness,
      dim the room, point the phone at it and hit "Lock to sky". It will genuinely solve. This
      verifies camera → upload → solve → badge → telemetry end to end _before_ you are standing in
      a field at midnight. This is the single highest-value 10 minutes of the whole exercise.
- [ ] Install the comparison app on the second phone and **calibrate it properly** (figure-of-eight
      motion, per its own instructions). See fairness note below.
- [ ] Both phones charged; disable auto-lock and auto-brightness on the filming phone.
- [ ] Third camera (or a friend) for the side-by-side. Tripod or a beanbag.
- [ ] Clean both lenses. A smeared lens is the most common cause of a failed solve.
- [ ] Red headlamp; a jacket (Munich, ~12 °C at 01:00 in August); the laptop and a power bank.

---

## Which app to film alongside — and how to be fair about it

**Use Stellarium Mobile (free) or Star Walk 2.** Stellarium Mobile is the stronger choice: it is the
app people will name in the comments ("but Stellarium…"), so demonstrating against it pre-empts the
objection. Star Walk 2 is the mass-market one (10M+ installs) if you want the "what most people
actually use" framing.

**Be scrupulously fair, for self-interested reasons.** Your entire positioning is "I measure things
honestly." If the comparison looks rigged, the accuracy claim dies with it, and Reddit will find the
rig within an hour.

- Calibrate the other app exactly as it asks. Give it its best shot.
- Do **not** stand next to a car, railing, or steel fence to exaggerate its drift. Open ground.
- Film both phones in the same frame, at the same time, pointed at the same star.
- Don't caption it with the competitor's name in a mocking way. Show it; let it speak.
- If on the night it happens to do well, say so. "It was within a few degrees tonight and still
  drifted; here's the same test near a car" is a _more_ credible story than a staged blowout.

---

## The shots, in order of what to protect if the night goes badly

### Shot 1 — Cold open: the lock happening (20 s, HUD **expanded**)

Establishes that this is a real instrument doing real work.

- HUD expanded so the controls are visible; badge shows grey **NO LOCK**.
- Tap **Lock to sky**. Film the whole sequence: "hold still…" → capture → upload → solve.
- The badge must be legible: grey **NO LOCK** → blue pulsing **SOLVING** → green **LOCKED** with an
  arcminute value.
- Hold 3 seconds on the green badge before cutting.

**Must be on camera:** the state transition and the arcminute number. That's the shot.

### Shot 2 — The sky, clean (20 s, HUD **collapsed**, badge visible)

- Tap **⌃** (top-right) to collapse the HUD. Sky plus the badge alone — this is what the app was
  designed to look like for exactly this purpose.
- Slow pan across the Milky Way. Badge stays green in-frame the whole time.
- On Aug 12–13, hold on the Perseid radiant (Perseus, NE, rising through the night) and let the
  renderer's meteors run.

### Shot 3 — 🔴 THE MONEY SHOT: side-by-side drift (15 s, HUD **collapsed**)

**If you get one thing, get this.** Do it early, before your hands are cold.

1. Both phones side by side in frame, both showing the same bright star. Use **Altair or Arcturus**
   (comfortable 35–50° altitude in the south/west around 23:00 CEST in mid-August) rather than Vega
   near the zenith — a zenith shot is miserable to film and the phones tilt out of frame. Confirm
   what's actually up in the app before you commit.
2. Hold both on the star. Both look correct. **This is important** — start from agreement.
3. Pan smoothly ~90° away and back. Twice. Do it at a normal, human speed.
4. Return to the star. Starlantern's label is still on it; the other app's is not.
5. Hold 3 seconds on the discrepancy with both badges/labels legible.

**What the readout must show:** green **LOCKED** and an arcminute value, continuously, throughout
the pan. If it goes amber mid-shot, that's still usable and arguably more honest — but re-lock and
re-shoot to try for a clean take first.

**Framing:** get close enough that both screens are readable at phone-video resolution. Test by
watching the take back at phone size before moving on. Vertical framing is fine — most of this is
going on Reddit and it will be watched on a phone.

### Shot 4 — Drift and recovery (20 s, HUD **collapsed**)

The honest counterpart to Shot 3, and it makes the whole thing more believable.

- From a lock, walk around / move for a minute. Film the badge climbing: green → amber
  **DRIFTING** with a rising number.
- Re-lock. Film it snapping back to green and arcminutes.

This says "the system knows when it's degraded and tells you", which is the actual product claim.

### Shot 5 — B-roll (whatever time is left)

- Bortle slider 9 → 1, Milky Way emerging.
- Moon at high zoom (a later night — during the Aug 9–16 window there's essentially no moon).
- An ISS pass if one falls in the window (check the app; TLEs refreshed in pre-flight).
- Twilight gradient / Belt of Venus if you arrive early.

---

## Data capture — this is how the launch numbers get filled

The video is the marketing; the log is the evidence. Both matter.

- [ ] Do **at least 6–8 separate locks** over the session, spread across the night and across
      different parts of the sky. Median and p95 need a sample; two solves give you neither.
- [ ] Leave gaps of 1–5 minutes between some of them — the drift number is derived from how far the
      estimate moved between consecutive fixes, so varied intervals give a better curve.
- [ ] Deliberately include some **hard** attempts: low altitude, thin cloud, a bit of skyglow. The
      failures are what produce an honest solve-success-rate rather than a flattering one.
- [ ] Note the Bortle of the site and the date — the launch copy quotes them as context.
- [ ] Before leaving, confirm `logs/session-*.jsonl` on the laptop has grown and contains
      `accuracy.stats` and `platesolve.success` lines.

Afterwards, bring me the log file and I'll extract the five numbers and fill the placeholders in the
three marketing docs.

---

## Bad-weather fallback — Munich is overcast for a week

The failure mode to avoid is not "bad video". It's the launch sliding indefinitely while waiting for
a perfect night — which is precisely the build→sell stall ADR-022 exists to prevent. So this has a
deadline.

**Escalate in this order:**

1. **Wait for a gap, not a night.** Shot 3 needs ~10 seconds of a clear patch with a few bright
   stars in it. That is a far lower bar than a Milky Way shot, and Munich gaps happen. Keep the kit
   by the door and go out on 20 minutes' notice.
2. **Drive 50–100 km.** Cloud cover varies enormously over that distance — south toward the Alps or
   north over the Danube plain often differ from the city. Check `meteoblue` seeing forecast or
   `clearoutside.com` and pick a signal-covered spot.
3. **Shoot the drift comparison from a city street.** It does not need dark sky, only a few
   solvable stars. A Bortle 6 Munich street is fine. This costs you Shots 2 and 5, not Shot 3.
4. **Labelled bench demo.** Point the phone at a large monitor showing a high-resolution star field;
   it will solve. Legitimate as an _explicitly labelled_ bench test of the pipeline — "bench test,
   simulated sky" on screen. **Never present it as field footage.** If that label would embarrass
   you in a comment thread, don't publish it at all.
5. **Post without the video.** A screen recording of the badge cycling through its states, plus the
   measurement-methodology paragraph, is a weaker post but a real one. HN in particular will engage
   with the methodology on its own merits.

**Hard rule: if there is no usable footage by 23 August 2026, post anyway using option 5.** Two
weeks is a generous weather allowance. The launch copy is written, the app is live, and an
unpublished post converts nobody.

---

## After the shoot

1. Bring me `logs/session-*.jsonl` → I extract the five numbers and fill the placeholders.
2. Cut Shot 3 to 15 seconds — it is the Show HN video, the Reddit video and the cold-email video.
   Don't over-edit. No music, no titles beyond one line of context.
3. Then, and only then, post. Tuesday–Thursday, 8–10am Pacific.

The gate on this project is one clear night and about ninety minutes of your time.
