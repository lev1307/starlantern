import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true, // bind to 0.0.0.0 so phone on same Wi-Fi can connect
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split heavy third-party deps into their own cacheable chunks so the
        // app chunk shrinks below Vite's 500 kB warning. THREE is the dominant
        // weight; satellite.js (added for ISS passes) is the second.
        manualChunks: {
          three: ["three"],
          satellite: ["satellite.js"],
        },
      },
    },
  },
});
