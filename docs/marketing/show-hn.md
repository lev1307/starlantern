# Show HN draft

Post when you have a 30-60s outdoor demo video uploaded somewhere (YouTube unlisted, Vimeo, or directly to a tweet you can link).

---

## Title (≤ 80 chars, HN strict)

Pick one. Test the first; have the second as a backup if it dies in /newest.

1. **Show HN: AR Night Sky – stargazing overlay locked to reality via plate-solving**
2. **Show HN: A WebXR night sky that locks to real stars via phone-camera plate-solving**

Keep "Show HN:" prefix exactly. HN moderators enforce it.

---

## URL field

`https://ar-night-sky.vercel.app`

(If you've renamed the repo to `starlantern`, you can either keep the old subdomain or migrate first — but don't do both at once on launch day.)

---

## Comment (post immediately as the first comment)

> Hi HN! I'm a 4th-semester aerospace student building this as a phone prototype for an eventual AR-glasses astronomy product. The webapp is the v1 deliverable.
>
> What it does:
>
> - **Plate-solve lock.** Capture a sky image from the phone camera, solve via astrometry.net, fuse with IMU through a multiplicative EKF for arcminute-accurate overlay. Most sky apps drift 5-20° from magnetometer noise; this locks to within ~1 arcminute.
> - **Photometric rendering.** Per-star Moffat PSF, B-V → Teff → linear-sRGB color, scotopic desaturation, Kasten-Young extinction, wavelength-dependent reddening near the horizon (Sirius rising actually looks orange-yellow, then white-blue as it climbs). 8920-star Gaia DR3 subset (mag ≤ 6.5).
> - **Bortle-aware sky.** GPS → light-pollution lookup → global gain so faint stars stay visible above urban skyglow. Slider lets you preview Bortle 1 (perfect dark site) on top of your actual location.
> - **What's actually in the sky right now.** Sun + moon (with phase, mare, earthshine), VSOP87-truncated planets, ISS / CSS / HST via SGP4 from CelesTrak TLEs, calendar-aware meteor showers (sporadic + 8 majors), 21 naked-eye DSOs, Milky Way + zodiacal light + gegenschein + Belt of Venus + air-glow + adaptation glare on bright stars. Aurora model with live NOAA SWPC Kp index for high-latitude observers.
> - **Stereoscopic mode** for cardboard-style headmounts via WebXR `immersive-vr` opt-in.
>
> Best experience is on a phone, outdoors, dark site. Browser desktop preview works too — set Bortle 1, Exposure 3, drag-look around. UTC slider would help here; for now if your local time is daytime, set the system clock forward to test.
>
> Stack: TypeScript + Three.js + WebGL2 shaders + Vite. ~9k LOC, 146 tests, AGPL-3.0. Vercel auto-deploys; plate-solve is proxied through a serverless function (free astrometry.net Nova key required server-side).
>
> Long-term: this becomes the same code compiled and sold on Google Play / Xreal NebulaOS / Viture store as the AR-glasses optics catch up over the next 5-10 years. The webapp is the practice ground.
>
> Specifically curious about feedback from:
>
> - Astronomers on whether the photometric model is doing the right thing
> - WebXR / Three.js folks on the stereo + barrel-distortion path (broken on some Cardboard variants?)
> - Anyone who's done plate-solve fusion with IMU on a phone — current EKF is MEKF over [δθ, δb], curious what others have used

---

## Tone notes

- HN punishes hype. Keep claims falsifiable.
- Lead with the plate-solving since that's the technical moat (every other star app drifts).
- Explicitly invite scrutiny — "curious about feedback from..." is honored as engagement-positive.
- Don't apologize for the name / domain / WIP-ness. Confidence reads competent.
- If anyone asks about monetization: be honest. "AGPL on GitHub, planning paid Android/iOS apps and commercial dual-licensing for OEMs."

## When to post

- Best HN slot: **Tuesday-Thursday, 8-10am Pacific** (matches lunch in EU, breakfast in US East).
- Avoid weekends, holidays, big news days.
- Stay around for ~2 hours after to answer comments. First-hour comments dramatically affect ranking.

## What to do if it pops

- Have GitHub Sponsors + Ko-fi already enabled (FUNDING.yml is in the repo, you just need to apply for Sponsors).
- Don't link to a paid product. The "buy this" CTA kills HN posts. Let people use the live URL freely.
- Reply to every substantive comment in the first 4 hours.
- Save the conversation — it's grant-application gold.

## What to do if it dies

- Don't repost the same URL within a month — HN penalizes.
- Pivot to Reddit (see `reddit-posts.md` — those have less strict gatekeeping).
- The video alone is reusable for Twitter / LinkedIn forever.
