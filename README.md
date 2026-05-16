# Starlantern

> A WebXR night-sky overlay that turns your phone into a window onto a Bortle-1 sky — no matter where you actually are.

Locks to reality via phone-camera plate-solving and renders an idealized dark-sky view (mag ≤ 6.5) with physically motivated colors, atmospheric extinction, and Bortle-aware brightness compensation. The phone version is a prototype for the eventual AR-glasses experience (Xreal / Viture / Rokid).

## Status

🚧 Early development. v1 webapp is the current focus. No releases yet.

## What it does

- **Plate-solve lock.** Captures a sky image from the phone camera, solves it via astrometry.net, fuses with IMU through an EKF for arcminute-accurate overlay. Most sky apps drift 5–20° from magnetometer noise; this one locks to within ~1 arcminute of actual stars.
- **Photometric rendering.** Per-star PSF + B-V→RGB color + scotopic tone curve + atmospheric extinction. Goal: match what a person with perfect eyes would see under a Bortle 1 sky, regardless of where they actually are.
- **Bortle-aware compensation.** GPS → VIIRS light-pollution lookup → global overlay gain so faint stars (down to mag 6.5) stay visible above urban skyglow.
- **Stereoscopic mode.** WebXR + phone-in-cardboard-headmount for hands-free testing.

## Tech stack

TypeScript · Three.js · WebXR · WebGL2 · Vite. Browser-only, runs on a phone, no install.

## Build from source

```bash
git clone https://github.com/<owner>/starlantern.git
cd starlantern
npm install
npm run dev
```

Then open the dev URL on your phone (same Wi-Fi as your laptop). Grant IMU + GPS + camera permissions.

## License

**AGPL-3.0** for source code — see [LICENSE](./LICENSE).

You can build, run, modify, and redistribute this code freely under the AGPL terms. If you use it in a commercial product (especially as a hosted service) the AGPL requires you to either open-source your derivative or obtain a commercial license.

**Commercial license** for proprietary use (no AGPL obligations): contact `hello@starlantern.app`.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [CLA](./CLA.md). Every contributor signs the CLA before merge — this is what lets the project offer commercial licenses while staying open-source.

## Roadmap

- **v1 webapp** (current): Steps 1–4 — phone-only, WebXR, cardboard headmount stereoscopic
- **v2**: port to AR glasses (Viture Pro / Xreal One Pro), clip-on accessory for front camera + sodium-notch filter
- **v3**: tuned OEM SKU when consumer AR optics catch up (~2028–2030)

## Acknowledgements

Stands on the shoulders of: Gaia DR3 mission (ESA), Pan-STARRS / DSS imagery, astrometry.net, JPL Horizons, NASA VIIRS light-pollution data, Stellarium project (algorithmic reference), HEALPix.
