# Reddit launch posts

One post per subreddit. Each is tuned to the audience — astronomy subreddits care about photometric accuracy + plate-solve, /r/spaceporn cares about the visual, /r/space wants the broader story.

**Universal rules:**
- Don't post all four on the same day (Reddit anti-spam catches it). Stagger over 4-7 days.
- Always include the live URL **and** the demo video.
- Lead with the video for visual subs (spaceporn, space). Lead with technical depth for astronomy subs.
- Reply to comments for the first 6 hours after posting — comment activity is the ranking signal.

Best posting time: **9-11am Eastern, weekdays.** Sunday evening also works for /r/space.

---

## /r/astronomy

**Flair:** "Astrophotography" or "Equipment / Tools" depending on which is allowed for non-photo posts (check sidebar; some only allow photos via flair).

**Title:**

> Built a webapp that overlays a physically-correct night sky on your phone, locked to reality via camera plate-solving — feedback wanted

**Body:**

> Hey r/astronomy. I've been building this in evenings/weekends for a few months and I'm at the point where I want to know if astronomers think the rendering is doing the right thing.
>
> **Live demo:** https://ar-night-sky.vercel.app (best on a phone, outside, after dark — but desktop preview works if you crank Bortle to 1 and Exposure to 3, then drag to look around).
>
> **Video:** [link to your demo video]
>
> What it tries to do differently from Stellarium / SkyView / Star Walk:
>
> - **Plate-solve lock.** Phone-camera image → astrometry.net → MEKF fuses the solution with IMU readings. Compass alone drifts 5-20° from indoor metal; this should hold within ~1 arcminute.
> - **Photometric pipeline.** Per-star Moffat PSF, B-V → Teff → linear-sRGB color, scotopic Purkinje desaturation toward neutral at low flux, Kasten-Young extinction, Hayes-Latham wavelength-dependent reddening near the horizon. 8920-star Gaia DR3 subset down to mag 6.5.
> - **Bortle-aware.** GPS → light-pollution lookup → global gain compensation so faint stars stay above urban skyglow. Manual Bortle slider lets you preview Bortle 1 from your light-polluted backyard.
> - **What's actually up tonight.** SGP4 ISS/CSS/HST passes, calendar-aware meteor showers, 21 naked-eye DSOs, Milky Way + zodiacal + gegenschein + Belt of Venus + air-glow.
>
> Currently working on AR-glasses port (Viture Pro / Xreal One Pro) but the phone webapp is the v1 deliverable.
>
> **Specific questions for you:**
>
> 1. Is the B-V → color mapping correct? Does Arcturus look the right shade of orange to your eye?
> 2. Bortle slider — at Bortle 1 with the Milky Way + DSOs visible, does the relative brightness feel right?
> 3. Anything obviously wrong about the meteor distribution (ZHR scaling, sporadic vs shower mix)?
>
> Open to harsh feedback. Code is AGPL on GitHub if you want to look at the math.

---

## /r/Stargazing

**Title:**

> Built a free phone webapp that shows you what your sky would look like at a perfect dark site — even from inside a city

**Body:**

> Hi r/Stargazing! Frustrated with my city sky in Munich (Bortle 5-6) and built this so I could preview what the night looks like at Bortle 1 from anywhere.
>
> **Try it:** https://ar-night-sky.vercel.app — works in any phone browser, no install.
>
> **Demo video:** [link]
>
> What it does:
>
> - Point your phone at the sky → get a star overlay locked to reality (uses your camera + GPS + IMU)
> - Slide Bortle from 9 (city) down to 1 (perfect dark site) and watch the Milky Way emerge, faint stars appear, DSOs become visible
> - Shows the moon (with phase + mare), planets, ISS passes, meteor showers, even Belt of Venus during twilight
> - Currently free and AGPL-licensed
>
> Best experience is outdoors at night with motion + GPS granted, but you can preview in a browser by setting your system clock forward and dragging to look around.
>
> Built it as a phone prototype for an eventual AR-glasses port (Viture / Xreal / Rokid). Would love feedback from people who actually use sky apps regularly — what feels off, what's missing, what would make you switch from your current app.

---

## /r/spaceporn

**Title:**

> [OC] Free webapp shows you the night sky as it would look at a perfect dark site, from anywhere — including DSOs, Milky Way, Belt of Venus, ISS passes

**Body (for spaceporn the video IS the post — keep text short):**

> Live demo: https://ar-night-sky.vercel.app
>
> Built this from scratch in TypeScript + Three.js — physically-correct rendering of stars (Gaia DR3 catalog, B-V color, atmospheric extinction), Milky Way, planets, meteors, satellites, aurora, and more. Free + open-source (AGPL).
>
> Best on a phone outdoors but desktop preview works — set Bortle to 1 and Exposure to 3 to see the dark-sky version.

(spaceporn rules require image/video for the post itself — use a 30s rendered clip, or a screenshot of M31 + Pleiades + Milky Way taken from your tonight outdoor test, with `[OC]` tag.)

---

## /r/space

**Title:**

> I built a free webapp that shows what the night sky would look like at a perfect dark site, locked to reality via your phone's camera — feedback welcome

**Body:**

> Hi r/space. Solo founder here, 4th-semester aerospace student. Spent the last few months building a WebXR night-sky overlay with the goal of porting it to AR glasses (Viture / Xreal) once optics catch up.
>
> The phone webapp is the v1 deliverable, fully working today: https://ar-night-sky.vercel.app
>
> **Demo video:** [link]
>
> **Highlights:**
>
> - Phone camera takes a sky photo → plate-solves it via astrometry.net → fuses with your phone's gyroscope through an EKF, locks the overlay to within an arcminute of real stars
> - Renders 8,920 stars from Gaia DR3 with physically-correct color (from B-V index), brightness, twinkle, and atmospheric reddening near the horizon
> - Shows ISS / CSS / HST passes via SGP4 propagation, current planets via VSOP87 Keplerian elements, all 8 major meteor showers with calendar-driven activity
> - Bortle 1 to 9 slider lets you compare your light-polluted sky to a perfect dark site
> - Aurora model with live NOAA SWPC Kp index data
> - Stereoscopic mode for cardboard headmounts
>
> Open-source (AGPL-3.0), TypeScript + Three.js + WebGL2.
>
> Honest about state: it's a v1 prototype, the AR-glasses version is years out (waiting for electrochromic optics), and it works best outdoors at night with motion permissions granted. But every line of the rendering is physically motivated and the math is testable (146 tests pass).
>
> Curious what r/space thinks. Especially: is there demand for "see the sky as it would look at a perfect dark site" as a paid mobile app, or is the free webapp enough?

---

## After-the-fact: replies template

People will ask:

**"How is this different from Stellarium?"**

> Stellarium is a fantastic catalog/atlas + simulator. This is built around the plate-solve lock — your phone camera tells the app what it's actually looking at, instead of relying on the (notoriously unreliable) magnetometer. Drift is ~1 arcminute vs 5-20° for compass-only apps.

**"Is this open-source / can I run it locally?"**

> Yes — AGPL-3.0 on GitHub. `npm install && npm run dev` and you have it on your laptop. Plate-solve needs a free astrometry.net key, everything else works without any backend.

**"Are you going to make a mobile app?"**

> Yes — Capacitor wrapper for Google Play + iOS App Store is the next step. Pricing target ~€5/month or €69 lifetime. The core stays AGPL/free; mobile app is for convenience + push notifications + offline + premium hosted features.

**"Will it work on AR glasses?"**

> That's the long bet. Current consumer AR glasses (Xreal, Viture, Rokid) lack the brightness floor + electrochromic dimming needed for true astronomy use. Phone-tethered USB-C DP-alt mode works in principle. Year 2-3 we'll borrow a unit and validate.

**"This drains battery / overheats my phone."**

> Yes — that's why the long-term play is AR-glasses-with-phone-as-compute. Phone in a cardboard headmount works for 30-60 min before getting warm; AR glasses with their own thermal envelope are the real solution.
