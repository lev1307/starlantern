// Sensor module: DeviceOrientation (heading/pitch/roll) + Geolocation (lat/lon) + UTC time.
//
// iOS Safari requires an explicit user-gesture call to
// DeviceOrientationEvent.requestPermission() (returns 'granted'|'denied').
// Android Chrome grants automatically on https or localhost.
//
// We expose imperative request* functions to be called from a button click,
// and reactive getters that hand the latest reading to the renderer.

export interface Orientation {
  /** Compass heading, 0 = North, 90 = East, 180 = South, 270 = West (degrees). */
  alphaDeg: number;
  /** Tilt forward/back: +90 = phone vertical screen-up, 0 = lying flat (degrees). */
  betaDeg: number;
  /** Roll left/right: -90 = on left side, +90 = on right side (degrees). */
  gammaDeg: number;
  /** True when the reading is referenced to true magnetic / true north. */
  absolute: boolean;
}

export interface GeoFix {
  latDeg: number;
  lonDeg: number;
  altM: number;
  /** Horizontal accuracy in meters (Geolocation API). */
  accuracyM: number;
  /** Timestamp (ms since epoch) of the fix. */
  tMs: number;
}

type OrientationListener = (o: Orientation) => void;

interface IOSDeviceOrientationCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export class SensorHub {
  private orientation: Orientation | null = null;
  private geo: GeoFix | null = null;
  private listeners = new Set<OrientationListener>();
  private watchId: number | null = null;
  private bound: ((e: DeviceOrientationEvent) => void) | null = null;
  private absoluteListenerActive = false;

  /** True if the DeviceOrientation API is available at all (any browser). */
  get supportsOrientation(): boolean {
    return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
  }

  /** Returns true if iOS-style permission prompt is required. */
  get requiresOrientationPermission(): boolean {
    const ctor = (
      window as unknown as { DeviceOrientationEvent?: IOSDeviceOrientationCtor }
    ).DeviceOrientationEvent;
    return typeof ctor?.requestPermission === "function";
  }

  /**
   * Request iOS DeviceOrientation permission. Must be called from a user gesture.
   * On Android / desktop this resolves immediately to 'granted'.
   */
  async requestOrientationPermission(): Promise<"granted" | "denied"> {
    if (!this.supportsOrientation) return "denied";
    if (this.requiresOrientationPermission) {
      const ctor = (
        window as unknown as {
          DeviceOrientationEvent: IOSDeviceOrientationCtor;
        }
      ).DeviceOrientationEvent;
      try {
        const result = await ctor.requestPermission!();
        if (result === "granted") this.startOrientation();
        return result;
      } catch {
        return "denied";
      }
    }
    this.startOrientation();
    return "granted";
  }

  private startOrientation(): void {
    if (this.bound) return;
    this.bound = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      this.orientation = {
        alphaDeg: e.alpha,
        betaDeg: e.beta,
        gammaDeg: e.gamma,
        absolute: e.absolute === true,
      };
      for (const l of this.listeners) l(this.orientation);
    };
    // Try the absolute (compass-referenced) event first; fall back to relative.
    if ("ondeviceorientationabsolute" in window) {
      window.addEventListener(
        "deviceorientationabsolute",
        this.bound as EventListener,
      );
      this.absoluteListenerActive = true;
    }
    window.addEventListener("deviceorientation", this.bound);
  }

  onOrientation(cb: OrientationListener): () => void {
    this.listeners.add(cb);
    if (this.orientation) cb(this.orientation);
    return () => this.listeners.delete(cb);
  }

  getOrientation(): Orientation | null {
    return this.orientation;
  }

  /** Request a one-shot location fix (best for fast startup). */
  requestLocation(): Promise<GeoFix> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Geolocation API not available"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix: GeoFix = {
            latDeg: pos.coords.latitude,
            lonDeg: pos.coords.longitude,
            altM: pos.coords.altitude ?? 0,
            accuracyM: pos.coords.accuracy,
            tMs: pos.timestamp,
          };
          this.geo = fix;
          resolve(fix);
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60_000 },
      );
    });
  }

  /** Optional: continuously refresh location (useful if observer is moving). */
  watchLocation(): void {
    if (this.watchId != null || !("geolocation" in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.geo = {
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          altM: pos.coords.altitude ?? 0,
          accuracyM: pos.coords.accuracy,
          tMs: pos.timestamp,
        };
      },
      undefined,
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
  }

  getLocation(): GeoFix | null {
    return this.geo;
  }

  /** Manual override for desktop testing or when GPS is unavailable. */
  setManualLocation(lat: number, lon: number, altM = 0): void {
    this.geo = {
      latDeg: lat,
      lonDeg: lon,
      altM,
      accuracyM: 0,
      tMs: Date.now(),
    };
  }

  dispose(): void {
    if (this.bound) {
      window.removeEventListener("deviceorientation", this.bound);
      if (this.absoluteListenerActive) {
        window.removeEventListener(
          "deviceorientationabsolute",
          this.bound as EventListener,
        );
      }
      this.bound = null;
    }
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.listeners.clear();
  }
}
