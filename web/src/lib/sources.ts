import { ChangeDetector, type Reader } from "./pipeline";

const MAX_W = 1920;

function sized(w: number, h: number) {
  const s = Math.min(1, MAX_W / w);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}
function snapshot(src: CanvasImageSource, sw: number, sh: number, crop?: { x: number; y: number; w: number; h: number }) {
  const c = document.createElement("canvas");
  const box = crop ?? { x: 0, y: 0, w: sw, h: sh };
  const { w, h } = sized(box.w, box.h);
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return c;
}

export interface Progress { done: number; total: number }

/** Recording: seek through the file, OCR only where the screen changed. Never leaves the browser. */
export async function readRecording(file: File, reader: Reader, signal: AbortSignal, onProgress: (p: Progress) => void, stepSec = 2) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.preload = "auto"; video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("This browser can't play that file. Try an .mp4 (H.264) or .webm recording in Chrome."));
    });
    const dur = isFinite(video.duration) ? video.duration : 0;
    if (!dur || !video.videoWidth) throw new Error("Couldn't read that video.");
    const det = new ChangeDetector();
    const total = Math.max(1, Math.floor(dur / stepSec) + 1);
    let lastSubmitted: Uint8Array | null = null;
    for (let i = 0; i < total && !signal.aborted; i++) {
      const t = Math.min(dur, i * stepSec);
      await new Promise<void>((res) => { video.onseeked = () => res(); video.currentTime = t; });
      const c = snapshot(video, video.videoWidth, video.videoHeight);
      const { grey } = det.step(c);
      if (!lastSubmitted || det.diff(lastSubmitted, grey) >= 3) {
        lastSubmitted = grey;
        await reader.idleBelow(reader.concurrency * 2);
        reader.submit(c, t * 1000);
      }
      onProgress({ done: i + 1, total });
    }
    if (!signal.aborted) await reader.drain();
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
}

export interface TabOptions {
  /** Called every sample to crop the captured frame (e.g. to an embedded player). Coordinates are in captured-frame pixels. */
  crop?: (videoW: number, videoH: number) => { x: number; y: number; w: number; h: number } | null;
  preferCurrentTab?: boolean;
  onEnded?: () => void;
}

/**
 * Share a tab (or window/screen): sample the stream, wait for the picture to settle, then OCR it.
 * Returns a stop function.
 */
export async function shareTab(reader: Reader, opts: TabOptions = {}) {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia(c?: unknown): Promise<MediaStream> };
  if (!md?.getDisplayMedia) throw new Error("This browser can't share a tab. Use Chrome or Edge on a computer.");
  const stream = await md.getDisplayMedia({
    video: { frameRate: 6, displaySurface: "browser" }, audio: false,
    preferCurrentTab: !!opts.preferCurrentTab, selfBrowserSurface: opts.preferCurrentTab ? "include" : "exclude",
    surfaceSwitching: "include", monitorTypeSurfaces: opts.preferCurrentTab ? "include" : "exclude",
  });
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.srcObject = stream;
  await video.play();
  const det = new ChangeDetector();
  const t0 = performance.now();
  let lastSample: Uint8Array | null = null, lastSubmitted: Uint8Array | null = null, dirtySince = 0;
  let stopped = false;

  const tick = () => {
    if (stopped || !video.videoWidth) return;
    let crop: { x: number; y: number; w: number; h: number } | undefined = undefined;
    if (opts.crop) {
      const cr = opts.crop(video.videoWidth, video.videoHeight);
      if (!cr) return; // Crop target is currently hidden or out of view; do NOT capture entire tab
      crop = cr;
    }
    const c = snapshot(video, video.videoWidth, video.videoHeight, crop);
    const grey = det.grey(c);
    const moving = lastSample ? det.diff(lastSample, grey) >= 2 : true;
    lastSample = grey;
    const differs = !lastSubmitted || det.diff(lastSubmitted, grey) >= 3;
    if (!differs) { dirtySince = 0; return; }
    const now = performance.now();
    if (!dirtySince) dirtySince = now;
    // submit once the picture has settled; but never wait more than 2.5 s while it keeps moving (scrolling)
    if (!moving || now - dirtySince > 2500) {
      lastSubmitted = grey; dirtySince = 0;
      reader.submit(c, now - t0);
    }
  };
  const timer = window.setInterval(tick, 400);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  stream.getVideoTracks()[0].addEventListener("ended", () => { stop(); opts.onEnded?.(); });
  return stop;
}
