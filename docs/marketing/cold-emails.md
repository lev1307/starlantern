# Cold-email templates

> **Rewritten 2026-08-09 against ADR-016/017/023.** The AR-glasses OEM template is gone — ADR-016
> removed glasses from the near-term plan, so those emails were selling a product that no longer
> exists. Replaced with **telescope makers / smart-telescope startups** (the real tier-2 licensing
> market) and the **tier-3 validation emails** (ADR-023), which are the cheapest way to find out
> whether the aerospace story is real.

```bash
grep -n "{{" docs/marketing/cold-emails.md && echo "STILL HAS PLACEHOLDERS — fill or cut"
```

**Universal rules**

- Personal email, not `hello@`. Founders get replies; role accounts don't.
- Subject < 50 chars, no emoji, no marketing adjectives.
- Body < 200 words. They scan.
- **One** specific ask. "Would 15 minutes next week work?" beats "would love to discuss."
- First sentence personalised with something only someone paying attention would know.
- Always include the live URL and the video.
- Tuesday–Thursday, 9–11am their local time.
- Track in a sheet. 5–10% reply rate is normal; 1–2% close over a quarter is good.

**What changed in the pitch:** lead with the pointing accuracy, not the rendering. The rendering is
what makes it pretty; the lock is what makes it _defensible_, and it's the only line in the email a
technical reader can't get from any of five free apps.

---

## Template 1 — Telescope makers & smart-telescope startups (tier 2, the real licensing market)

The adjacent market that actually needs this: ZWO (Seestar), Vaonis (Vespera/Stellina), Unistellar
(eVscope), Celestron (StarSense), Sky-Watcher, Explore Scientific. All of them either ship
plate-solve-based alignment or need it, and it is not their core competence.

**Subject:**

> Plate-solve alignment on commodity phone hardware

**Body:**

> Hi [Name],
>
> [Specific sentence — a product decision of theirs you actually have a view on. e.g. "The Seestar's
> > one-tap alignment is the part of the product I point people at when they say smart telescopes are
> > overpriced."]
>
> I've built a phone app that determines its own attitude by plate-solving the sky through the phone
> camera and fusing the solution with the IMU through an MEKF. On commodity hardware, no mount and
> no dedicated optics, it holds a median **{{N1_MEDIAN_ARCMIN}}′** with **{{N4_DRIFT_DEG_MIN}}°/min**
> of drift between fixes, first lock in **{{N5_TTFL_SEC}} s**.
>
> Live: https://ar-night-sky.vercel.app · 60-second video: [link] · Code: AGPL-3.0
>
> I'm not pitching you an app. I'm asking whether the attitude-determination piece is worth
> licensing — as an alignment aid for manual mounts, or as a phone-side companion to an existing
> product. It's dual-licensable away from AGPL.
>
> Would 20 minutes be useful? Happy to send the measurement methodology first if that's the more
> interesting artifact.
>
> [Name] · TUM aerospace

**Ticket size:** licensing in the €5k–50k range, or per-unit royalty. Sales cycle 3–9 months.
**Prerequisite:** do not send until the on-device WASM solver exists or is credibly close — a
network-dependent solver is a non-starter for a product used in the field, and they will say so.

---

## Template 2 — Planetariums & science museums

**Subject:**

> Visitor tool for [Planetarium]?

**Body:**

> Hi [Name],
>
> [One specific sentence about their institution — an exhibit, a programme, a talk you attended.]
>
> I've built a free phone webapp that shows visitors the sky over their actual location as it would
> look at a perfect dark site. It anchors the overlay by plate-solving the phone camera rather than
> using the compass, so it points where the visitor is actually pointing instead of a constellation
> away — which matters when you're asking a room of people to find something.
>
> Live demo: https://ar-night-sky.vercel.app · 60-second video: [link]
>
> The use I imagine for [Planetarium]: visitors scan a QR code outside, see their real sky, then
> drag one slider from Bortle 8 to Bortle 1 and watch the Milky Way appear. It makes "this is what
> light pollution took" concrete rather than rhetorical.
>
> Would 15 minutes next week work? Happy to do a free pilot for an upcoming event.
>
> [Name] · TUM aerospace

**Targets — EU first (easier follow-up):** Deutsches Museum (Munich, closest and highest leverage),
Planetarium Hamburg, Planetarium Stuttgart, Zeiss-Großplanetarium Berlin, Wolfsburg,
Cité de l'espace (Toulouse), Royal Observatory Greenwich, Tycho Brahe (Copenhagen), Heureka
(Helsinki). **US (bigger tickets, harder closes):** Adler, Hayden, Griffith, Fels.

**Ticket size:** €500–3,000/year per institution.

---

## Template 3 — University astronomy & teaching labs

**Subject:**

> Intro-astronomy lab tool — TUM aerospace

**Body:**

> Hi [Prof Lastname],
>
> [Specific sentence — a paper, a course they teach, a thesis topic.]
>
> I'm a TUM aerospace student. I've built a phone app that does attitude determination by
> plate-solving the sky and fusing with the IMU through an MEKF — essentially a star tracker on
> commodity hardware. It logs its own error: median **{{N1_MEDIAN_ARCMIN}}′**, drift
> **{{N4_DRIFT_DEG_MIN}}°/min** between fixes.
>
> Live: https://ar-night-sky.vercel.app · Code (AGPL-3.0):
> https://github.com/lev1307/starlantern · Video: [link]
>
> Two reasons to write. First, I'd value your view on whether I'm characterising the error
> correctly — I quote the filter innovation rather than its covariance, and I'd rather be corrected
> early. Second, it may fit an intro lab: students compare the rendered sky to the real one, run
> their own solves, and see extinction change with altitude on a slider.
>
> Would 15 minutes next Tuesday or Wednesday work?
>
> [Name] · TUM aerospace, 4th semester

**TUM-internal first:** own aerospace department (lowest friction), TUM Observatory / Physics
(Wendelstein), TUM Optics Chair. **Then:** LMU Observatory, ESO Garching outreach (next door),
Heidelberg Königstuhl, ETH Zurich, Leiden, Cambridge IoA.

---

## Template 4 — Tier-3 validation (ADR-023) — send these regardless of everything else

**These are not sales emails.** They exist to find out, cheaply, whether the "this is a star tracker
and star trackers matter in aerospace" story survives contact with someone who works in the sector.
A "no" here is worth as much as a "yes", because it kills a branch that would otherwise sit in the
plan absorbing attention for a year. Send all three; they cost nothing and can go out before the
launch.

Send to: **(a)** your own chair / a professor in the department, **(b)** a REXUS contact,
**(c)** one Munich space company — Isar Aerospace, OroraTech, or Reflex.

**Subject:**

> Phone-based attitude determination — is this interesting?

**Body:**

> Hi [Name],
>
> [One specific sentence: their work, their launch, a lecture of theirs you sat in.]
>
> I've built something as a consumer astronomy app that is, structurally, a star tracker: phone
> camera → plate-solve → attitude determination → EKF fusion with the IMU. On an ordinary phone it
> holds a median **{{N1_MEDIAN_ARCMIN}}′** with **{{N4_DRIFT_DEG_MIN}}°/min** of drift between
> fixes. Demo: https://ar-night-sky.vercel.app, video [link].
>
> I'm not asking for anything and I'm not selling. I'd like a reality check from someone who works
> in the field: is commodity-hardware celestial attitude determination interesting to anyone, and
> if so where — GPS-denied navigation, cubesat ADCS, ground equipment, or nowhere because it's a
> solved problem with four companies doing it better?
>
> A two-line answer, including "this is not interesting", would genuinely help me decide what to
> spend the next year on.
>
> [Name] · TUM aerospace, 4th semester

**How to read the replies:** "solved problem, talk to X, Y, Z" → branch closed, and you got three
names for free. "Interesting, what's your accuracy under vibration / at what update rate?" → branch
open, and the follow-up question tells you what to measure next. Silence from all three → treat as
a weak no; do not re-send.

---

## Tracking

One sheet: `institution | contact | email | sent | replied | status | next-action | notes`
Status values: `sent`, `replied`, `call-booked`, `pilot`, `paying`, `dead`.

Realistic: 30 emails/quarter → 3–6 replies → 1–2 calls → 0–1 closes. The first close is the hardest.
