// Field-test telemetry: ships every meaningful client-side event to the dev
// server so a remote operator (or you, after the fact) can reconstruct exactly
// what happened on the phone — permissions, sensor samples, slider changes,
// plate-solve lifecycle, FPS, and uncaught errors.
//
// Architecture:
//   - One module-scope event buffer.
//   - Buffer is flushed every FLUSH_INTERVAL_MS (2 s) or when it hits
//     FLUSH_THRESHOLD (50) events, whichever comes first.
//   - Flush is fire-and-forget POST to /__log with keepalive=true so it
//     survives navigation/tab-switch.
//   - On visibilitychange→hidden / pagehide we flush synchronously via
//     navigator.sendBeacon for a last-chance dump.
//   - Telemetry never throws and never rejects — it is a hard rule that a
//     network failure here must not surface to the user.
//
// The matching server-side sink is the `starlantern-log-collector` Vite plugin
// in vite.config.ts. When you deploy to Vercel, point LOG_ENDPOINT at the
// production /api/log function instead (not implemented in v1).

const SESSION_ID = (() => {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
})();

const LOG_ENDPOINT = "/__log";
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 50;

interface Event {
  ts: number;
  session_id: string;
  event: string;
  [k: string]: unknown;
}

const buffer: Event[] = [];
let flushTimer: number | null = null;
let enabled = true;

function payload(events: Event[]): string {
  return JSON.stringify(events);
}

function flush(sync = false): void {
  if (!enabled || buffer.length === 0) return;
  const events = buffer.splice(0);
  const body = payload(events);
  if (sync && typeof navigator.sendBeacon === "function") {
    try {
      navigator.sendBeacon(
        LOG_ENDPOINT,
        new Blob([body], { type: "application/json" }),
      );
      return;
    } catch {
      // fall through to fetch
    }
  }
  fetch(LOG_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    /* telemetry must never break the app */
  });
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Record a single event. Always best-effort. `fields` are merged into the
 * event JSON; do not nest large objects (the server appends one line per
 * event and isn't streaming-parsed).
 */
export function track(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!enabled) return;
  buffer.push({
    ts: Date.now(),
    session_id: SESSION_ID,
    event,
    ...fields,
  });
  if (buffer.length >= FLUSH_THRESHOLD) {
    if (flushTimer != null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  } else {
    scheduleFlush();
  }
}

/**
 * Emit a one-shot boot event with everything I'd ask "what device is this?"
 * in a remote debugging session. Call this once, as early as possible.
 */
export function trackBoot(extra: Record<string, unknown> = {}): void {
  const nav = navigator as Navigator & {
    standalone?: boolean;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  };
  track("boot", {
    url: location.href,
    userAgent: nav.userAgent,
    platform: nav.platform,
    language: nav.language,
    online: nav.onLine,
    cookieEnabled: nav.cookieEnabled,
    standalone: !!nav.standalone,
    devicePixelRatio: window.devicePixelRatio,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    screen_w: window.screen?.width ?? null,
    screen_h: window.screen?.height ?? null,
    touch_points: nav.maxTouchPoints ?? 0,
    has_DeviceOrientation: "DeviceOrientationEvent" in window,
    has_DeviceOrientationAbsolute: "ondeviceorientationabsolute" in window,
    has_DeviceMotion: "DeviceMotionEvent" in window,
    has_Geolocation: "geolocation" in navigator,
    has_WebXR: "xr" in navigator,
    has_Camera: typeof navigator.mediaDevices?.getUserMedia === "function",
    has_sendBeacon: typeof navigator.sendBeacon === "function",
    net_effectiveType: nav.connection?.effectiveType ?? null,
    net_downlink_mbps: nav.connection?.downlink ?? null,
    net_rtt_ms: nav.connection?.rtt ?? null,
    ...extra,
  });
}

/** The 12-char session id, useful to grep one session out of a shared log. */
export function getSessionId(): string {
  return SESSION_ID;
}

/** Stop emitting (e.g. for production tear-down). Cannot be re-enabled. */
export function disableTelemetry(): void {
  enabled = false;
  buffer.length = 0;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

// Wire global error capture as soon as this module is evaluated.
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    track("error.uncaught", {
      message: e.message,
      filename: e.filename ?? null,
      lineno: e.lineno ?? null,
      colno: e.colno ?? null,
      stack: e.error?.stack ?? null,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    const isObj = typeof reason === "object" && reason !== null;
    track("error.unhandledrejection", {
      message:
        isObj && "message" in reason
          ? String((reason as { message: unknown }).message)
          : String(reason),
      stack:
        isObj && "stack" in reason
          ? String((reason as { stack: unknown }).stack)
          : null,
    });
  });
  document.addEventListener("visibilitychange", () => {
    track("visibility", { state: document.visibilityState });
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => {
    track("pagehide");
    flush(true);
  });
  window.addEventListener("online", () => track("net.online"));
  window.addEventListener("offline", () => track("net.offline"));
}
