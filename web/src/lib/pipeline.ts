import type { Frame, OcrEngine } from "./types";
import { jaccard, lineKeys } from "./textlayer";

const GW = 320, GH = 180, TX = 20, TY = 12;

/** Tile-grid change detector (same idea as the Mac tool): counts tiles whose pixels moved. */
export class ChangeDetector {
  private prev: Uint8Array | null = null;
  private g = document.createElement("canvas");
  constructor(private sad = 900) { this.g.width = GW; this.g.height = GH; }

  grey(src: CanvasImageSource): Uint8Array {
    const ctx = this.g.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, GW, GH);
    const d = ctx.getImageData(0, 0, GW, GH).data;
    const out = new Uint8Array(GW * GH);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    return out;
  }

  static changedTiles(a: Uint8Array, b: Uint8Array, sad: number): number {
    const tw = GW / TX, th = GH / TY;
    let n = 0;
    for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
      let s = 0;
      for (let y = ty * th; y < (ty + 1) * th; y++) for (let x = tx * tw; x < (tx + 1) * tw; x++) s += Math.abs(a[y * GW + x] - b[y * GW + x]);
      if (s > sad) n++;
    }
    return n;
  }

  /** Tiles that differ from the previous sample (and remember this one). */
  step(src: CanvasImageSource): { grey: Uint8Array; changed: number } {
    const g = this.grey(src);
    const changed = this.prev ? ChangeDetector.changedTiles(this.prev, g, this.sad) : TX * TY;
    this.prev = g;
    return { grey: g, changed };
  }
  diff(a: Uint8Array, b: Uint8Array) { return ChangeDetector.changedTiles(a, b, this.sad); }
}

export type Listener = () => void;

/** Holds the frames read so far; runs OCR with bounded concurrency; skips repeats of the same screen. */
export class Reader {
  frames: Frame[] = [];
  inFlight = 0;
  processed = 0;
  error: string | null = null;
  private nextId = 1;
  private listeners = new Set<Listener>();
  private waiters: (() => void)[] = [];
  private pending: { canvas: HTMLCanvasElement; ts: number } | null = null;
  private stopped = false;

  constructor(private ocr: OcrEngine, private opts: { concurrency?: number; latestOnly?: boolean; maxFrames?: number } = {}) {}

  get concurrency() { return this.opts.concurrency ?? 2; }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  notify() { this.emit(); }
  private emit() { this.listeners.forEach((l) => l()); }

  /** Queue a canvas for OCR. With latestOnly, a newer submission replaces one still waiting. */
  submit(canvas: HTMLCanvasElement, ts: number) {
    if (this.stopped) return;
    if (this.opts.latestOnly) {
      this.pending = { canvas, ts };
      this.pump();
      return;
    }
    this.queue.push({ canvas, ts });
    this.pump();
  }
  private queue: { canvas: HTMLCanvasElement; ts: number }[] = [];

  /** Resolves once the number of waiting+running jobs is below n (backpressure for file reading). */
  async idleBelow(n: number) {
    while (!this.stopped && this.inFlight + this.queue.length >= n) await new Promise<void>((r) => this.waiters.push(r));
  }
  async drain() { await this.idleBelow(1); }

  private pump() {
    while (this.inFlight < this.concurrency) {
      const job = this.opts.latestOnly ? this.takePending() : this.queue.shift();
      if (!job) break;
      this.inFlight++;
      this.run(job).finally(() => {
        this.inFlight--;
        this.processed++;
        this.waiters.splice(0).forEach((r) => r());
        this.emit();
        this.pump();
      });
    }
    this.emit();
  }
  private takePending() { const p = this.pending; this.pending = null; return p; }

  private async run(job: { canvas: HTMLCanvasElement; ts: number }) {
    try {
      const lines = await this.ocr.recognize(job.canvas);
      if (this.stopped) return;
      const blob: Blob = await new Promise((res, rej) => job.canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.82));
      const f: Frame = { id: this.nextId++, ts: job.ts, w: job.canvas.width, h: job.canvas.height, url: URL.createObjectURL(blob), lines };
      this.insert(f);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private insert(f: Frame) {
    // keep frames ordered by time (parallel OCR can finish out of order)
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].ts > f.ts) i--;
    const prev = this.frames[i - 1];
    if (prev && jaccard(lineKeys(prev), lineKeys(f)) >= 0.92) { URL.revokeObjectURL(f.url); return; }
    if (!f.lines.length && !prev) { URL.revokeObjectURL(f.url); return; }
    this.frames.splice(i, 0, f);
    const max = this.opts.maxFrames ?? 400;
    while (this.frames.length > max) URL.revokeObjectURL(this.frames.shift()!.url);
  }

  stop() {
    this.stopped = true;
    this.pending = null;
    this.queue = [];
    this.waiters.splice(0).forEach((r) => r());
    this.emit();
  }
  async dispose() {
    this.stop();
    for (const f of this.frames) URL.revokeObjectURL(f.url);
    await this.ocr.dispose();
  }
}
