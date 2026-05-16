# AR Night Sky

A WebXR night-sky overlay that locks to reality via phone-camera plate-solving and renders the sky as it would look at a perfect dark site, anywhere — physically-correct stars, Milky Way, planets, ISS passes, meteors, deep-sky objects, twilight, aurora.

**Live demo:** [ar-night-sky.vercel.app](https://ar-night-sky.vercel.app) — works in any phone browser, no install.

## What it does

- **Plate-solve lock.** Phone camera → astrometry.net → multiplicative EKF fuses with IMU for arcminute-accurate overlay. Most sky apps drift 5–20° from magnetometer noise; this locks to within ~1 arcminute of actual stars.
- **Photometric rendering.** 8,920-star Gaia DR3 subset (mag ≤ 6.5) with Moffat PSF, B-V → Teff → linear-sRGB color, scotopic Purkinje desaturation, Kasten-Young extinction, Hayes-Latham wavelength-dependent reddening near the horizon, Young-1969 scintillation twinkle.
- **Bortle-aware compensation.** GPS → light-pollution lookup → global gain. Slider lets you preview Bortle 1 from a Bortle 8 backyard.
- **What's actually in the sky right now:**
  - Sun with twilight gradient, moon with Meeus phase + procedural mare + earthshine, VSOP87-truncated planets with diffraction spikes for Venus/Jupiter
  - ISS / CSS / HST passes via SGP4 + bundled CelesTrak TLEs
  - 8 major meteor showers (Quadrantids → Ursids) + sporadic background, Poisson-sampled and zenith-corrected
  - 21 naked-eye deep-sky objects (M31, M42, M45, M44, Double Cluster, NGC 7000, M81, M104, M13, M22, M5, Heart and Soul, Magellanic Clouds, …)
  - Procedural Milky Way + zodiacal light + gegenschein + Belt of Venus + Earth's shadow + air-glow + adaptation glare on bright stars + atmospheric chromatic dispersion at low altitude
  - Aurora model with live NOAA SWPC Kp index, IGRF-dipole geomagnetic latitude, equatorward-oval-edge model
- **Stereoscopic mode.** WebXR `immersive-vr` + side-by-side rendering for cardboard headmounts, with Brown-Conrady barrel-distortion correction and per-channel chromatic-aberration uniforms.

## Tech stack

TypeScript · Three.js · WebGL2 · Vite. Browser-only, runs on a phone, no install. ~9k LOC, 146 tests, hosted on Vercel.

## Build from source

```bash
git clone https://github.com/<owner>/ar-night-sky.git
cd ar-night-sky
npm install
npm run dev
```

Then open the dev URL on your phone (same Wi-Fi as your laptop). Grant IMU + GPS + camera permissions.

For plate-solve to work, set `ASTROMETRY_API_KEY` server-side — see [docs/api-setup.md](./docs/api-setup.md).

## Support development

This project is solo-developed and AGPL-licensed. If you'd like to support continued development:

- ⭐ Star the repo
- 💖 [GitHub Sponsors](https://github.com/sponsors/lev1307) *(once approved)*
- ☕ Ko-fi *(coming soon)*
- 🐦 Share the live demo with stargazing friends

## License

**AGPL-3.0** for source code — see [LICENSE](./LICENSE).

You can build, run, modify, and redistribute this code freely under the AGPL terms. If you use it in a commercial product (especially as a hosted service) the AGPL requires you to either open-source your derivative or obtain a commercial license.

**Commercial license** for proprietary use (no AGPL obligations): contact `lev13072006@gmail.com` *(temporary contact email — will move to a project domain later)*.

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [CLA](./CLA.md). Every contributor signs the CLA before merge — this is what lets the project offer commercial licenses while staying open-source.

## Roadmap

- **v1 webapp** (shipped): Steps 1–4 + 11 naked-eye realism iters — phone WebXR, cardboard stereoscopic, full naked-eye scene rendering
- **v1.x mobile apps**: Capacitor wrapper for Google Play + iOS App Store, Pro tier with hosted features
- **v2**: port to AR glasses (Viture Pro / Xreal One Pro), clip-on accessory for front camera + sodium-notch filter
- **v3**: tuned OEM SKU when consumer AR optics catch up (~2028–2030)

## Acknowledgements

Stands on the shoulders of: Gaia DR3 mission (ESA), Pan-STARRS / DSS imagery, astrometry.net, JPL Horizons, NASA VIIRS light-pollution data, Stellarium project (algorithmic reference), HEALPix.
