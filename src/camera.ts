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
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        quality,
      );
    });
    return { blob, width: w, height: h, tCaptureMs, utcMs };
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
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/jpeg",
        quality,
      );
    });
    return { blob, width: w, height: h, tCaptureMs, utcMs };
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
