# Phase-4 cold-email templates

Three templates: planetariums/science museums, university astronomy departments, and AR-glasses OEMs (commercial dual-licensing).

**Universal rules:**

- Send from a personal email (not hello@). Founders get more replies.
- Subject line < 50 chars. No emoji. No marketing words ("amazing", "revolutionary").
- Body < 200 words. They will scan, not read.
- One specific ask per email. "Would 15 minutes next week work?" not "would love to discuss."
- Include the live URL + the demo video. Always.
- Personalise the first sentence. Mention something specific to their institution. "Saw your Wendelstein 80cm telescope project last year" — proves you're not blasting a list.
- Send Tuesday-Thursday, 9-11am their local time.
- Track replies in a spreadsheet. 5-10% reply rate is normal; 1-2% close rate over a quarter is good for B2B.

---

## Template 1: Planetariums + science museums

**Subject:**
> Visitor tool for [Planetarium Name]?

**Body:**

> Hi [Name],
>
> [One specific sentence about their institution — last year's exhibit, recent program, anything that proves attention. e.g. "I visited your December dark-sky weekend and was struck by how engaged the families were."]
>
> I'm building a phone webapp that shows visitors what the night sky would look like at a perfect dark site — based on real photometric data and locked to their physical surroundings via the camera. Live demo: https://ar-night-sky.vercel.app (best on a phone outside; desktop preview also works).
>
> 60-second video: [link]
>
> The use case I'm imagining for [Planetarium]: visitors scan a QR code, see the rendered night sky over their actual city, then scroll a slider to preview Bortle 1 — making the "this is what we lost to light pollution" message visceral instead of abstract.
>
> Would 15 minutes next week work for me to walk you through it? Happy to do a free pilot install if you'd like to try it for an upcoming event.
>
> Best,
> [Your name]
> [TUM, 4th-semester aerospace]
> [link to GitHub or LinkedIn]

**Targets to compile:**

EU first (closer / easier follow-up):
- Deutsches Museum (Munich) — closest, biggest leverage
- Planetarium Hamburg
- Planetarium Stuttgart
- Zeiss-Großplanetarium Berlin
- Volkswagen Planetarium Wolfsburg
- Cité de l'espace (Toulouse)
- Royal Observatory Greenwich
- Tycho Brahe Planetarium (Copenhagen)
- Heureka (Helsinki)

US (larger ticket sizes, harder closes):
- Adler Planetarium (Chicago)
- Hayden Planetarium (NYC)
- Griffith Observatory (LA)
- Fels Planetarium (Philadelphia)

**Ticket size:** €500-3,000/year per institution as a license + setup.

---

## Template 2: University astronomy departments

**Subject:**
> Intro-astronomy classroom tool — TUM aerospace

**Body:**

> Hi [Prof Lastname],
>
> [Specific sentence — recent paper, thesis topic, course they teach.]
>
> I'm a 4th-semester aerospace student at TUM building a webapp that overlays a physically-correct night sky on a phone, locked to reality via plate-solving and IMU fusion. Built primarily for outreach but I think it might fit your intro-astronomy lab — students could compare the rendered sky to what they see, debug their own plate-solves, and walk through atmospheric extinction with a visible Bortle slider.
>
> Live: https://ar-night-sky.vercel.app
> Code (AGPL-3.0): https://github.com/lev1307/[repo-name]
> 60-second video: [link]
>
> I'd love a few minutes of your time for two reasons: (a) feedback on whether the math is doing what astronomers expect, and (b) interest in deploying it as a free teaching tool in your courses (with optional support for €200-500/term if useful).
>
> Would next Tuesday or Wednesday afternoon work?
>
> Best,
> [Your name]
> [TUM aerospace, 4th semester]

**TUM-internal targets first** (per ADR-013 outreach plan):

- TUM Optics Chair (Photonics / Display Optics) — ADR-013 priority 1
- TUM Aerospace Department mentors — your own department, lowest friction
- TUM Observatory / Physics Department (Wendelstein) — domain experts
- TUM Venture Labs (Aerospace or Robotics) — venture-stage support

**EU astronomy departments** (broader Phase 4):

- LMU Munich Observatory
- ESO Garching (HQ next door — outreach team contact)
- Heidelberg Königstuhl
- ETH Zurich Astrophysics
- Cambridge Institute of Astronomy
- Leiden Observatory

---

## Template 3: AR-glasses OEMs (commercial dual-licensing)

**Subject:**
> Native astronomy app for [Xreal NebulaOS / Viture / Rokid]?

**Body:**

> Hi [Name / partnerships@],
>
> [Specific sentence — recent launch, a feature you appreciate. e.g. "Picked up the One Pro at IFA — the electrochromic dimming is clearly the right architecture for the use case I'm building toward."]
>
> I'm developing AR Night Sky — a physically-correct astronomy overlay built on WebXR, currently shipping as a phone webapp with stereoscopic mode. Eventual target: native app for AR glasses with a forward-mounted astrometric camera.
>
> Live demo: https://ar-night-sky.vercel.app
> Stereo mode video: [link]
>
> Two reasons for this email:
>
> 1. Would [Xreal / Viture / Rokid] be open to providing a development unit for porting + testing? The phone version handles plate-solve + IMU fusion already; the port is mostly stereo-rendering + your SDK adapter.
> 2. If a port lands, would commercial licensing for inclusion in the [NebulaOS / Viture App / Rokid] store be on the table? AGPL on the public repo, dual-licensed for commercial use; pricing in the €5-50k range per OEM/year depending on scope.
>
> Happy to demo over a 30-minute call.
>
> Best,
> [Your name]
> [TUM aerospace, 4th semester]

**Targets:**

- Xreal (NebulaOS) — partnerships@xreal.com or via their developer portal
- Viture — developer relations contact via viture.com
- Rokid — partnerships via rokid.com
- Meta Reality Labs (Ray-Ban Display, Quest) — long shot but high reward
- Even Realities (G1) — niche, friendly to indies

**Ticket size:** €5,000-50,000/year per OEM, structured as licensing + revenue share on store sales. Slow sales cycle (3-9 months) but enables MRR by getting featured in the store.

---

## Tracking

Recommend a single Google Sheet with columns:

`institution | contact-name | contact-email | sent-date | reply-date | status | next-action | notes`

Status values: `sent`, `replied`, `intro-call-booked`, `pilot-installed`, `paying`, `dead`.

Realistic numbers: send 30 emails/quarter, expect 3-6 replies, 1-2 intro calls, 0-1 closes. That's normal. The first close is the hardest.
