# Reddit launch posts

> **Rewritten 2026-08-09 against ADR-016/017.** May drafts led with the render and the AR-glasses
> roadmap. These lead with the lock. Placeholders `{{...}}` are unmeasured numbers — same rule as
> the HN draft: fill from a real field run or delete the sentence.

```bash
grep -n "{{" docs/marketing/reddit-posts.md && echo "STILL HAS PLACEHOLDERS — DO NOT POST"
```

**Universal rules**

- Stagger over 4–7 days. Posting all of them the same day trips Reddit's anti-spam.
- Always include the video. On Reddit the video _is_ the post; the link is secondary.
- Reply for the first 6 hours — comment activity is the ranking signal.
- URL is `https://ar-night-sky.vercel.app` until DNS for the custom domain works.
- Best window: **9–11am Eastern, weekdays**; Sunday evening also works for r/space.
- Read each sub's self-promotion rule before posting. r/telescopes and r/astronomy both remove
  posts that read as launches; framing as "built this, want criticism" survives where "check out
  my app" does not.

---

## r/telescopes — highest-value audience, post this one first

These are the people who spend four figures on gear and own manual Dobsonians with no goto. Feature
priority #1 (mount-agnostic push-to) is aimed squarely at them, and this post **tests demand for it
before it gets built** — which is worth more than the traffic.

**Title:**

> My phone app plate-solves the sky instead of trusting the compass — would a mount-agnostic push-to be useful to you?

**Body:**

> I got tired of phone sky apps pointing at the wrong star. They take orientation from the
> magnetometer, which drifts 5–20° around metal — useless next to a telescope.
>
> So this one takes a photo, plate-solves it, and fuses that with the IMU through a Kalman filter.
> Measured on a real night: median correction **{{N1_MEDIAN_ARCMIN}}′**, drift
> **{{N4_DRIFT_DEG_MIN}}°/min** between solves, first lock in **{{N5_TTFL_SEC}} s**. There's a live
> readout on screen showing the current uncertainty, so you can see it degrade rather than trust me.
>
> Free, works in a phone browser, no install: https://ar-night-sky.vercel.app
> Video: [link]
>
> **The actual question.** I know StarSense Explorer does phone plate-solving as a push-to aid, but
> it's locked to Celestron mounts. There are an awful lot of manual Dobs and EQ mounts out there
> with no goto at all.
>
> Would a mount-agnostic version be useful — you put the phone on the tube, pick a target, and it
> walks you there with live nudge arrows? Or is the phone-on-the-scope ergonomics bad enough that
> you'd never use it in practice? I'd rather hear "no" now than build it and find out.
>
> Also happy to be told the accuracy numbers are measured wrong. Code is AGPL if you want to check
> the math.

---

## r/astronomy — technical scrutiny

**Title:**

> Built a phone sky overlay that plate-solves instead of trusting the magnetometer — looking for criticism of how I measure the accuracy

**Body:**

> r/astronomy — I've been building this for a few months and I'd like the measurement methodology
> torn apart before I quote it anywhere else.
>
> **What it does:** phone camera photographs the sky → astrometry.net solve → the solution is fused
> with IMU readings through a multiplicative EKF over [δθ, δb]. The camera provides the absolute
> reference, so the overlay doesn't inherit magnetometer bias.
>
> **What I measure, and how.** I deliberately do _not_ quote the filter's own covariance — a
> filter's σ says how confident it is, not how right it is, and an overconfident filter reports a
> small σ while accumulating real error. Instead I log the **innovation**: when the next solve
> lands, how far does it move the estimate? That's the drift that actually accumulated between
> fixes. On a real night: median **{{N1_MEDIAN_ARCMIN}}′**, p95 **{{N2_P95_ARCMIN}}′**, drift
> **{{N4_DRIFT_DEG_MIN}}°/min**, solve rate **{{N3_SOLVE_RATE}}**.
>
> Is that the right way to characterise this, or is there a standard treatment I should be using?
> This is the number the whole thing rests on and I'd rather be corrected now.
>
> **Rendering** (secondary, but I'd take feedback): per-star Moffat PSF, B−V → Teff → linear-sRGB,
> scotopic desaturation, Kasten-Young extinction, Hayes-Latham wavelength-dependent reddening near
> the horizon. Gaia subset to mag 6.5. Deliberately naked-eye only — no constellation lines, no
> labels over the sky.
>
> Live: https://ar-night-sky.vercel.app · Video: [link] · Code: AGPL-3.0
>
> Specific questions: (1) does the B−V → colour mapping look right to your eye on Arcturus and
> Rigel? (2) at Bortle 1, do relative brightnesses feel plausible? (3) is the extinction curve
> doing the right thing below 20° altitude?

---

## r/Stargazing — practical, non-technical

**Title:**

> Free phone app that actually points where you're pointing — no install, works in the browser

**Body:**

> Every sky app I've tried has the same problem: hold the phone up, and the labels sit a
> constellation away from where they should be. That's the compass being pulled around by metal.
>
> This one photographs the sky and works out where it's looking from the stars themselves, the way
> a spacecraft does. Point it, tap "Lock to sky", and the overlay stays put. There's a little badge
> that tells you how accurate it currently is, in arcminutes.
>
> https://ar-night-sky.vercel.app — no install, works in any phone browser.
> Video: [link]
>
> It also renders what the sky _would_ look like from a dark site: drag the Bortle slider from 9
> down to 1 and the Milky Way comes out. Moon phase, planets, ISS passes and meteor showers are all
> real-time rather than decorative.
>
> Free and open-source. Built it because I live under Munich's Bortle 5–6 sky and wanted to see what
> I'm missing. Would like to hear what feels wrong to people who use sky apps regularly.

---

## r/space — broad audience, story angle

**Title:**

> I built a phone app that determines its orientation from starlight instead of the compass — the same way a spacecraft does

**Body:**

> Aerospace student here. Spacecraft don't use magnetometers to know which way they're pointing —
> they use star trackers: photograph the sky, match the pattern against a catalogue, derive
> attitude. I wanted to know whether a phone could do the same thing well enough to be useful.
>
> It can. The app photographs the sky, plate-solves it, and fuses the result with the phone's gyro
> through a Kalman filter. Where a typical sky app drifts 5–20° on magnetometer noise, this holds
> to **{{N1_MEDIAN_ARCMIN}}′** with **{{N4_DRIFT_DEG_MIN}}°/min** of drift between fixes, and it
> shows you that number live instead of asking you to trust it.
>
> Try it: https://ar-night-sky.vercel.app (phone browser, no install)
> Video: [link]
>
> The rest of it renders the naked-eye sky as it would appear at a perfect dark site — Gaia
> catalogue, physically-motivated star colour and atmospheric extinction, real planet and ISS
> positions, calendar-accurate meteor showers.
>
> Open-source, AGPL-3.0, TypeScript + Three.js. Happy to answer questions about the attitude
> determination — it's the interesting part.

---

## r/spaceporn — optional, lowest priority

Included for completeness, but note the tension: spaceporn rewards **beauty**, which is the
positioning ADR-017 says not to compete on. Post it only if the video happens to be gorgeous, and
treat it as reach rather than as a message that will convert. Requires image/video in the post
itself, `[OC]` tagged.

**Title:**

> [OC] The sky over Munich as it would look at Bortle 1 — rendered live on a phone from the Gaia catalogue

**Body:**

> Live and free: https://ar-night-sky.vercel.app
>
> Rendered in real time in a phone browser — real star colours from B−V index, atmospheric
> extinction, Milky Way, zodiacal light. The overlay is locked to the real sky by plate-solving the
> phone camera, so it stays put when you move.

---

## Reply templates

**"How is this different from Stellarium / SkySafari?"**

> They're better catalogues and I'm not trying to beat them there — Stellarium goes to magnitude 22.
> The difference is the pointing. They derive orientation from the magnetometer and drift 5–20°;
> this plate-solves the camera image and holds arcminutes, and shows you the current number on
> screen. If you want an atlas, use Stellarium. If you want the overlay to sit on the actual star,
> this is the trade.

**"Doesn't StarSense Explorer already do this?"**

> Yes, and it's good — it's the proof people want phone plate-solving as a telescope aid. It's tied
> to Celestron's mounts and their bracket. The gap I'm aiming at is mount-agnostic: any manual Dob
> or EQ, no proprietary hardware.

**"Does it work offline?"**

> Not yet, and that's the honest weak spot: solving currently round-trips to astrometry.net, so it
> needs signal — exactly wrong for a dark site. Moving the solver on-device via WASM is the next
> substantial piece of work. Everything else (rendering, catalogue, ephemerides) is already local.

**"Is it open source?"**

> AGPL-3.0. `npm install && npm run dev` runs it locally. Solving needs a free astrometry.net key;
> nothing else needs a backend.

**"Will there be an app?"**

> Android first, probably €15–20 one-time. The web version stays free.

**"Battery / heat?"**

> Real cost. It solves on demand rather than running the camera continuously, which is why locking
> is a button and not a mode.
