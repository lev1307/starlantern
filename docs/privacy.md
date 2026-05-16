# Privacy Policy — Starlantern

> **DRAFT — review before publishing.** This is a starter document. Run it past
> a privacy generator (Termly, iubenda) or a lawyer before exposing it as the
> official policy on the live site, especially before accepting EU/UK/CA users.
> Replace `<EFFECTIVE_DATE>` and confirm every claim matches what the app
> actually does at the time of publication.

**Effective date:** `<EFFECTIVE_DATE>`
**Contact:** `hello@starlantern.app`

Starlantern is operated as an open-source project. We collect the minimum data
needed to make the app work and to keep the service available.

## What the app accesses on your device

When you grant permission, the browser-based app uses:

- **Device orientation sensors** (gyroscope + accelerometer + magnetometer) —
  read locally to know which way the phone is pointing. Not transmitted.
- **Geolocation** — read locally to compute which stars are above the horizon
  for your time and place. Not transmitted.
- **Camera** — used only when you tap "Lock to sky." A single still image is
  captured and sent to our plate-solve service (see below).

You can revoke any of these permissions at any time in your browser settings.
The app degrades gracefully when permissions are missing.

## What we send off your device

- **Plate-solve images.** When you tap "Lock to sky," the captured frame is
  forwarded through our serverless proxy
  (`/api/platesolve`) to **astrometry.net** (operated by the Astrometry team
  at the Center for Astrophysics, Harvard & Smithsonian) for star-pattern
  recognition. Images are processed and discarded; astrometry.net's own
  privacy practices apply to the transit. We do not store these images.
- **IP address** — visible to our hosting provider (Vercel) and used for
  per-IP rate-limiting on the plate-solve proxy. Rate-limit state is held in
  memory only and is dropped automatically.
- **Anonymous analytics** — page views and outbound clicks via
  [Plausible Analytics](https://plausible.io), which is cookie-free and
  GDPR-compliant. No personal identifiers are collected.

## What we do not do

- We do not set tracking cookies.
- We do not sell or share data with advertisers.
- We do not collect names, email addresses, or account information from app
  users. (The mailing list, if you join one, is separate and opt-in.)
- We do not retain plate-solve images after processing.

## Third parties involved when you use the app

| Service        | Purpose                               | What it sees                          |
| -------------- | ------------------------------------- | ------------------------------------- |
| Vercel         | Hosting + serverless function runtime | Request IP + timestamps, log lines    |
| astrometry.net | Plate-solve star recognition          | The image you submit, transiently     |
| Plausible      | Anonymous, cookie-free analytics      | Page URL, referrer, anonymized client |
| Cloudflare     | (Email forwarding only)               | Email envelope metadata               |

## Your rights (EU / UK / California)

You may request access to, correction of, or deletion of any personal data we
hold about you by emailing `hello@starlantern.app`. Because we do not maintain
user accounts for the app itself, in most cases we hold none. For mailing-list
subscribers, you may unsubscribe at any time using the link in any email.

## Changes to this policy

Material changes will be reflected in the **Effective date** above and noted
in the project repository's release notes.

## Source code

Starlantern is licensed under AGPL-3.0. The same source that processes your
data on the live site is published at the project's GitHub repository, so the
data handling described here is independently auditable.
