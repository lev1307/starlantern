# Show HN draft

> **Rewritten 2026-08-09 against ADR-016/017.** The May version sold a feature list and an
> AR-glasses future. The claim now is the **lock**: every mainstream sky app drifts 5–20° on
> magnetometer noise; this one plate-solves and holds arcminutes.

---

## 🔴 DO NOT POST WITH PLACEHOLDERS IN IT

This draft contains `{{...}}` tokens for numbers that **have not been measured yet**. They are
deliberately not filled with plausible-looking values, because a fabricated accuracy number is the
one mistake this project cannot recover from — the entire positioning is "we measure this and they
don't". Fill them from a real field run (see `shot-list.md`), or delete the sentence containing them.

Guard before posting:

```bash
grep -n "{{" docs/marketing/show-hn.md && echo "STILL HAS PLACEHOLDERS — DO NOT POST"
```

| Token                  | What it is                                  | Where it comes from                               |
| ---------------------- | ------------------------------------------- | ------------------------------------------------- |
| `{{N1_MEDIAN_ARCMIN}}` | median attitude correction at re-solve      | `accuracy.stats` telemetry, median of innovations |
| `{{N2_P95_ARCMIN}}`    | p95 of the same                             | same log, 95th percentile                         |
| `{{N3_SOLVE_RATE}}`    | solve success rate, with visible-star count | `platesolve.success` ÷ `platesolve.start`         |
| `{{N4_DRIFT_DEG_MIN}}` | EKF drift °/min between solves              | `measured_drift_deg_per_min`                      |
| `{{N5_TTFL_SEC}}`      | time to first lock                          | `timeToFirstLockSec`                              |

---

## Title (≤ 80 chars — HN enforces)

1. **Show HN: A sky app that plate-solves so the overlay doesn't drift**
2. **Show HN: Star overlay locked by plate-solving, not the magnetometer**

Keep the `Show HN:` prefix exactly. Lead with the mechanism, not the name — nobody knows the name.

## URL field

`https://ar-night-sky.vercel.app`

Launching on the vercel.app URL deliberately: `starlantern.app` does not resolve, and a dead link
in a Show HN post is unrecoverable. **Do not rename the Vercel project after posting** — the URL is
derived from the project name.

---

## Comment (post immediately as the first comment)

> Every phone sky app I've used has the same failure: you point at a star, and the label sits
> somewhere else. They derive orientation from the magnetometer, which is pulled around by the
> metal in your phone, your car, your balcony railing. In normal use that's 5–20° of error — a
> couple of constellations' worth.
>
> This one takes a photo of the sky, plate-solves it, and fuses the solution with the IMU through
> a multiplicative EKF. The camera tells the app what it is actually looking at, so the overlay is
> anchored to the sky rather than to a guess about which way is north.
>
> **What I measured** (Munich, {{FIELD_DATE}}, Bortle {{FIELD_BORTLE}}):
>
> - Time to first lock: **{{N5_TTFL_SEC}} s**
> - Attitude correction at re-solve: **median {{N1_MEDIAN_ARCMIN}}′, p95 {{N2_P95_ARCMIN}}′**
> - Drift between solves: **{{N4_DRIFT_DEG_MIN}}°/min**
> - Solve success rate: **{{N3_SOLVE_RATE}}**
>
> A note on how that middle number is derived, because it's the one that matters and it's easy to
> fake. I don't quote the EKF's own covariance — a filter's self-reported σ tells you how confident
> it is, not how right it is, and an overconfident filter reports a small σ while accumulating real
> error. Instead I log the **innovation**: when the next plate-solve lands, how far did it have to
> move the estimate? That's the drift that actually accumulated. Both numbers are recorded so they
> can be compared; if they diverge, the filter is mis-tuned and I want to know.
>
> The app shows this live. There's a badge with the current attitude uncertainty in arcminutes,
> and it goes amber and then red as it degrades. I'd rather show the number than claim a
> capability.
>
> **Honest about what it isn't:**
>
> - Plate-solving currently round-trips to astrometry.net, so it needs signal — which is exactly
>   wrong for dark sites. Porting a lost-in-space solver to WASM to run on-device is the next
>   real piece of work, and it also removes the server, the latency and most of the privacy
>   surface.
> - Accuracy between solves depends on your phone's gyro. Cheap IMUs drift faster.
> - It is not a catalogue. Stellarium goes to magnitude 22 and has a decade of head start; I'm not
>   competing there. This renders naked-eye sky (Gaia subset, mag ≤ 6.5, ~9k stars) and spends its
>   effort on pointing correctly.
>
> The rendering is physically motivated rather than decorative: per-star Moffat PSF, B−V → Teff →
> linear-sRGB colour, scotopic desaturation, Kasten-Young extinction, Hayes-Latham wavelength-
> dependent reddening near the horizon (so a rising Sirius goes orange → white-blue as it climbs).
> Light-pollution compensation from your GPS position, with a Bortle slider so you can see what
> your sky would look like at a dark site.
>
> TypeScript + Three.js + WebGL2, ~9k LOC, 171 tests, AGPL-3.0. Works in a phone browser, no
> install. Desktop preview works too — drag to look around, set Bortle 1 and Exposure 3.
>
> Things I'd genuinely like scrutiny on:
>
> - Anyone who's done plate-solve/IMU fusion on commodity hardware: the filter is a MEKF over
>   [δθ, δb]. What did you use, and where did it bite you?
> - Is innovation-as-drift-measurement the right call, or is there a standard I should be using
>   instead? I'd rather be corrected now than quote a bad number for a year.
> - Astronomers: is the photometric chain doing what you'd expect?

---

## Tone notes

- HN punishes hype and rewards falsifiability. Every claim here is a number or a mechanism.
- **Lead with the problem, not the product.** "You point at a star and the label sits somewhere
  else" is a shared experience; "physically-correct photometric rendering" is a feature list.
- Stating limitations up front is not weakness here — it's the strongest available signal that the
  numbers you _do_ quote are real. The network-dependency admission buys credibility for the
  accuracy claim.
- Do not mention AR glasses. It reads as a pivot away from the thing that works, and it invites
  "so it's a prototype for something else?" — the app is the product (ADR-016).
- If asked about money: "AGPL on GitHub. I'm planning a paid Android build around €15–20 one-time;
  the web version stays free." Don't volunteer it.

## Anticipated hard questions

**"Arcminutes? Prove it."** → The methodology paragraph above, plus: the app logs it live and you
can watch the badge. Long-term answer is the synthetic closed loop (render a field at known truth →
solve it → compare), which runs in CI and is not yet built. Say that plainly if asked.

**"Why not just use the compass better / sensor fusion is a solved problem."** → Fusion doesn't fix
a biased sensor. Hard-iron and soft-iron distortion near a phone's own speaker and battery is a
bias, not noise; averaging it doesn't remove it. Plate-solving replaces the absolute reference.

**"Stellarium has plate-solving."** → Stellarium desktop drives telescope mounts and can plate-solve
via external tooling; the phone apps don't do this in the pointing loop. If someone shows me one
that does, that's genuinely useful information — say so rather than arguing.

**"Battery/heat."** → Real. Continuous camera + WebGL is expensive; the app solves on demand rather
than continuously, which is why lock is an action and not a mode.

## When to post

- **Tuesday–Thursday, 8–10am Pacific.** Avoid weekends and big news days.
- Post the video and the URL. Stay available for ~2 hours; first-hour comments drive ranking.
- Reply to every substantive comment in the first 4 hours. Save the thread — it is grant-application
  and cold-email material.

## If it dies

Don't repost the same URL within a month. Move to Reddit (`reddit-posts.md`), which has softer
gatekeeping, and keep the video — it's reusable indefinitely.
