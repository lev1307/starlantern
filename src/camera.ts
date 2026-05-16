// Phone camera capture for plate-solving.
//
// Plate-solving needs a still image with detectable stars. Long exposure isn't
// directly exposable through MediaDevices — phone browsers typically clamp
// exposure time. Two practical strategies:
//
//   (a) Single high-ISO grab — works on phones with low-light camera modes
//       (Pixel night-sight isn't accessible to the browser, but the underlying
//       sensor gain still helps).
//   (b) Frame stacking — average N consecutive video frames to lift faint stars
//       above the noise floor. Free, works everywhere, but motion blur if the
//       phone moved. We hand-hold for now; tripod is a v2 hardware accessory.
//
// We expose both, defaulting to a quick single grab for the first Step 2 demo.

export interface CaptureResult {
  /** JPEG/PNG blob ready for multipart upload. */
  blob: Blob;
  /** Captured frame dimensions in pixels. */
  width: number;
  height: number;
  /** Performance.now() at the (centre of) capture, ms. */
  tCaptureMs: number;
  /** Wall-clock UTC at capture, used to anchor the WCS→altaz transform. */
  utcMs: number;
  /**
   * Variance of the Laplacian over the green channel — a classic image
   * sharpness metric. Higher is sharper. Empirical reference points for
   * hand-held phone star captures (Rec.709 luminance, 4-neighbour kernel):
   *
   *   <  5   pitch-black or sensor-noise-only frame
   *    5–30  blurry / out-of-focus / moving while capturing
   *   30–80  marginal (dim sky, but stars resolvable)
   *   >80    sharp star points; astrometry.net very likely to solve
   *
   * Logged for every capture so we can tune the threshold from real data.
   */
  sharpness: number;
}

/**
 * Laplacian variance over the green channel of an RGBA frame. We use green
 * (not luminance) because phone Bayer sensors have 2× green pixels and so
 * green has the best SNR for sparse-bright-point images like star fields.
 * Iterates interior pixels only (skips 1-px border to avoid bounds checks).
 *
 * Kernel:
 *     0  1  0
 *     1 -4  1
 *     0  1  0
 *
 * O(N) with two passes (running sum + running sum-of-squares). On a
 * 1920×1080 frame this takes ~40 ms on a modern phone CPU.
 */
function laplacianVariance(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const rowAbove = (y - 1) * width;
    const row = y * width;
    const rowBelow = (y + 1) * width;
    for (let x = 1; x < width - 1; x++) {
      // Green channel = byte offset 1 in RGBA.
      const c = (row + x) * 4 + 1;
      const top = rgba[(rowAbove + x) * 4 + 1]!;
      const bot = rgba[(rowBelow + x) * 4 + 1]!;
      const left = rgba[(row + x - 1) * 4 + 1]!;
      const right = rgba[(row + x + 1) * 4 + 1]!;
      const lap = top + bot + left + right - 4 * rgba[c]!;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export class CameraCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement("canvas");
  }

  /** True if getUserMedia is exposed. */
  get supported(): boolean {
    return (
      typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    );
  }

  /**
   * Open the rear camera. Resolves once the video element is playing and a
   * frame is available. Must be called from a user gesture on iOS.
   */
  async open(): Promise<{ width: number; height: number }> {
    if (this.stream)
      return { width: this.video!.videoWidth, height: this.video!.videoHeight };
    if (!this.supported) throw new Error("Camera API not available");

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.muted = true;
    video.setAttribute("playsinline", "true");
    await video.play();
    // Wait one rAF so videoWidth/Height is non-zero.
    await new Promise((r) => requestAnimationFrame(r));
    this.video = video;
    return { width: video.videoWidth, height: video.videoHeight };
  }

  /** Single frame, encoded as JPEG. Fastest path. */
  async grabSingle(quality = 0.92): Promise<CaptureResult> {
    if (!this.video) await this.open();
    const v = this.video!;
    const w = v.videoWidth;
    const h = v.videoHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    ctx.drawImage(v, 0, 0, w, h);

    const tCaptureMs = performance.now();
    const utcMs = Date.now();
    const sharpness = laplacianVariance(
      ctx.getImageData(0, 0, w, h).data,
      w,
      h,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        quality,
      );
    });
    return { blob, width: w, height: h, tCaptureMs, utcMs, sharpness };
  }

  /**
   * Average `frames` consecutive video frames into a single image. Lifts faint
   * stars out of the noise floor. Increases SNR by √N if frames are aligned.
   */
  async grabStacked(frames = 8, quality = 0.92): Promise<CaptureResult> {
    if (!this.video) await this.open();
    const v = this.video!;
    const w = v.videoWidth;
    const h = v.videoHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");

    const accum = new Float32Array(w * h * 4);
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tmpCtx = tmp.getContext("2d")!;

    for (let f = 0; f < frames; f++) {
      tmpCtx.drawImage(v, 0, 0, w, h);
      const data = tmpCtx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < data.length; i++) accum[i]! += data[i]!;
      // Wait one frame between grabs (~16 ms at 60 fps).
      await new Promise((r) => requestAnimationFrame(r));
    }

    const out = ctx.createImageData(w, h);
    for (let i = 0; i < accum.length; i++) {
      // Clamp at 255 — averaging guards against this in practice, but be safe.
      out.data[i] = Math.min(255, Math.round(accum[i]! / frames));
    }
    ctx.putImageData(out, 0, 0);

    const tCaptureMs = performance.now();
    const utcMs = Date.now();
    // Compute sharpness on the stacked (averaged) frame, not an individual
    // raw frame. Stacking suppresses noise but preserves the gradient of
    // real point sources, so the Laplacian variance is dominated by real
    // structure even on noisy phone sensors.
    const sharpness = laplacianVariance(out.data, w, h);
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        quality,
      );
    });
    return { blob, width: w, height: h, tCaptureMs, utcMs, sharpness };
  }

  /** Stop the camera and release tracks. */
  close(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video = null;
  }
}
