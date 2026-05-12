// AR Night Sky — entry point
// Step 1 implementation goes here: WebXR + IMU + GPS + Gaia star sphere.
// See _brain/tracks/webapp/step1-base.md for the full subagent prompt.

const app = document.getElementById('app');
if (!app) throw new Error('No #app container found');

app.innerHTML = `
  <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; padding:2rem; text-align:center;">
    <h1 style="font-weight:200; letter-spacing:0.1em;">AR Night Sky</h1>
    <p style="opacity:0.6; max-width:36ch; line-height:1.5;">
      WebXR night-sky overlay locked to reality. Step 1 not yet implemented — see project README and roadmap.
    </p>
    <p style="opacity:0.3; font-size:0.8rem; margin-top:2rem;">v0.0.1 · AGPL-3.0</p>
  </div>
`;
