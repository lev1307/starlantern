import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // bind to 0.0.0.0 so phone on same Wi-Fi can connect
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
