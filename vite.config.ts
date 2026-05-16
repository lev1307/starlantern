import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

/**
 * Field-test log collector.
 *
 * The client-side telemetry module (src/telemetry.ts) posts batched events
 * to /__log. In dev (and through a cloudflared/ngrok tunnel that forwards
 * to the same Vite port) this middleware appends each event as one JSONL
 * line to `logs/session-<ISO>.jsonl`. One file per `npm run dev` invocation
 * so each test session is naturally isolated.
 *
 * Why JSONL: trivial to tail with `jq -c` or read line-by-line from a Claude
 * Code session. Also degrades gracefully on partial writes (each line is
 * self-contained).
 *
 * This plugin is dev-only — Vite skips it during `vite build`.
 */
function logCollector(): Plugin {
  return {
    name: "starlantern-log-collector",
    apply: "serve",
    configureServer(server) {
      const logsDir = path.resolve("logs");
      fs.mkdirSync(logsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(logsDir, `session-${stamp}.jsonl`);
      // appendFileSync (vs createWriteStream): at one-phone event rates the
      // perf cost is negligible, and lines hit disk immediately — no buffer
      // surprises while tail-following or Reading the file from another tool.
      // eslint-disable-next-line no-console
      console.log(`\n[telemetry] writing client logs → ${file}\n`);
      server.middlewares.use("/__log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const events = Array.isArray(parsed) ? parsed : [parsed];
            const ip =
              (req.headers["x-forwarded-for"] as string | undefined)
                ?.split(",")[0]
                ?.trim() ??
              req.socket.remoteAddress ??
              "unknown";
            const ua = req.headers["user-agent"] ?? "unknown";
            // Stamp each event with the server-side reception time and the
            // request IP/UA — useful when juggling multiple devices.
            const lines = events
              .map((e) =>
                JSON.stringify({
                  recv_ts: new Date().toISOString(),
                  ip,
                  ua,
                  ...e,
                }),
              )
              .join("\n");
            fs.appendFileSync(file, lines + "\n");
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [logCollector()],
  server: {
    host: true, // bind to 0.0.0.0 so phone on same Wi-Fi can connect
    port: 5173,
    // Allow the cloudflared trycloudflare.com subdomain (and any host) to hit
    // the dev server. Vite blocks unknown Host headers by default since v5.
    allowedHosts: true,
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
