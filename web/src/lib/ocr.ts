// In-browser OCR (Tesseract.js, all assets served from /tesseract). The engine sits behind the
// OcrEngine interface so a cloud OCR / vision model can replace it without touching the pipeline.
import type { OcrEngine, OcrLine } from "./types";
import { buildBlocks } from "./textlayer";

const TARGET_W = 2560;
type Tune = { w?: number; gain?: number; blur?: number; psm?: string };
const tune = (): Tune => (typeof window !== "undefined" && (window as unknown as { __tune?: Tune }).__tune) || {};

/**
 * Upscale, then normalise contrast against the LOCAL background so faint text (grey line numbers
 * on a dark editor) becomes strong dark ink on white, whatever the theme or polarity.
 */
export function prepareForOcr(src: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.min(3, Math.max(1, (tune().w ?? TARGET_W) / src.width));
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  const sharp = ctx.getImageData(0, 0, w, h);

  const bg = document.createElement("canvas");
  bg.width = w; bg.height = h;
  const bctx = bg.getContext("2d", { willReadFrequently: true })!;
  bctx.filter = `blur(${Math.round((tune().blur ?? 10) * scale)}px)`;
  bctx.drawImage(out, 0, 0);
  const blur = bctx.getImageData(0, 0, w, h).data;

  const d = sharp.data;
  const GAIN = tune().gain ?? 8;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 23) { sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; n++; }
  const sign = sum / n < 128 ? 1 : -1; // dark theme: ink is lighter than its surroundings
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const b = blur[i] * 0.299 + blur[i + 1] * 0.587 + blur[i + 2] * 0.114;
    const v = Math.max(0, Math.min(255, 255 - sign * (g - b) * GAIN));
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(sharp, 0, 0);
  return out;
}

interface RawLine { t: string; x0: number; y0: number; x1: number; y1: number; conf: number }


interface WordLike { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

/** Rebuild a line from its words, dropping noise blobs (a stray speck can stretch a line's box tall). */
export function cleanLine(l: { words?: WordLike[]; text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }): RawLine | null {
  const words = (l.words ?? []).filter((w) => w.text.trim());
  if (!words.length) {
    const t = l.text.trim();
    return t ? { t, ...l.bbox, conf: l.confidence } : null;
  }
  const hs = med(words.map((w) => w.bbox.y1 - w.bbox.y0));
  const kept = words.filter((w, i) => {
    const h = w.bbox.y1 - w.bbox.y0;
    if (h > hs * 1.8) return false;
    const edge = i === 0 || i === words.length - 1;
    return !(edge && w.confidence < 40 && w.text.trim().length <= 3 && words.length > 1);
  });
  if (!kept.length) return null;
  const charW = med(kept.map((w) => (w.bbox.x1 - w.bbox.x0) / Math.max(1, w.text.trim().length)));
  let t = kept[0].text.trim();
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i].bbox.x0 - kept[i - 1].bbox.x1;
    t += " ".repeat(Math.max(1, Math.round(gap / Math.max(charW, 1) - 0.35))) + kept[i].text.trim();
  }
  const conf = kept.reduce((s, w) => s + w.confidence, 0) / kept.length;
  return {
    t, conf,
    x0: Math.min(...kept.map((w) => w.bbox.x0)), y0: Math.min(...kept.map((w) => w.bbox.y0)),
    x1: Math.max(...kept.map((w) => w.bbox.x1)), y1: Math.max(...kept.map((w) => w.bbox.y1)),
  };
}

/** Sparse-text mode returns code split into fragments on one row; stitch them back with spaces. */
export function mergeRows(raw: RawLine[]): RawLine[] {
  const L = [...raw].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const rows: RawLine[][] = [];
  for (const l of L) {
    const c = (l.y0 + l.y1) / 2, lh = l.y1 - l.y0;
    const row = rows.find((r) => {
      const rc = (r[0].y0 + r[0].y1) / 2, rh = r[0].y1 - r[0].y0;
      return Math.abs(rc - c) < Math.max(lh, rh) * 0.45;
    });
    if (row) row.push(l); else rows.push([l]);
  }
  const out: RawLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    let cur = { ...row[0] };
    for (const n of row.slice(1)) {
      const lh = Math.min(cur.y1 - cur.y0, n.y1 - n.y0);
      const gap = n.x0 - cur.x1;
      const charW = (cur.x1 - cur.x0) / Math.max(1, cur.t.length);
      // join only fragments that are close; a wide gap is a different column
      if (gap < lh * 2 && gap > -lh * 0.3) {
        const spaces = Math.max(1, Math.round(Math.max(gap, 0) / Math.max(charW, 1)));
        cur = { t: cur.t + " ".repeat(spaces) + n.t, x0: cur.x0, y0: Math.min(cur.y0, n.y0), x1: n.x1, y1: Math.max(cur.y1, n.y1), conf: (cur.conf * cur.t.length + n.conf * n.t.length) / (cur.t.length + n.t.length) };
      } else { out.push(cur); cur = { ...n }; }
    }
    out.push(cur);
  }
  return out;
}

export class TesseractEngine implements OcrEngine {
  private scheduler: any;
  private workers: any[] = [];
  private refiner: any;
  private ready: Promise<void>;

  constructor(private poolSize = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 4) - 1))) {
    this.ready = this.init();
  }

  private async init() {
    const { createWorker, createScheduler } = await import("tesseract.js");
    this.scheduler = createScheduler();
    const base = `${location.origin}/tesseract`;
    for (let i = 0; i < this.poolSize; i++) {
      const w = await createWorker("eng", 1, {
        workerPath: `${base}/worker/worker.min.js`,
        corePath: `${base}/core`,
        langPath: `${base}/lang`,
        gzip: true,
        workerBlobURL: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: "11" as any, preserve_interword_spaces: "1", user_defined_dpi: "300" });
      this.workers.push(w);
      (window as unknown as { __engine?: unknown; __workers?: unknown[] }).__engine = this;
      this.scheduler.addWorker(w);
    }
    // second pass: sparse mode drops small trailing pieces of code lines; a block-mode pass over
    // the cropped code area reads whole lines (and keeps their x-offsets for indentation)
    this.refiner = await createWorker("eng", 1, {
      workerPath: `${base}/worker/worker.min.js`, corePath: `${base}/core`, langPath: `${base}/lang`, gzip: true, workerBlobURL: false,
    });
    await this.refiner.setParameters({ tessedit_pageseg_mode: "6" as any, preserve_interword_spaces: "1", user_defined_dpi: "300" });
  }

  private async refine(prepared: HTMLCanvasElement, lines: OcrLine[]): Promise<OcrLine[]> {
    const W = prepared.width, H = prepared.height;
    const blocks = buildBlocks({ id: 0, ts: 0, w: W, h: H, url: "", lines });
    const codeBlocks = blocks.filter((b) => b.code);
    if (!codeBlocks.length) return lines;
    let kept = lines;
    for (const b of codeBlocks) {
      const lh = Math.max(...b.lines.map((l) => l.y1 - l.y0));
      // stop short of whatever sits to the right of this block
      let right = Math.min(W, b.x1 + 24 * b.charW);
      for (const o of blocks) if (o !== b && o.x0 >= b.x1 && o.y0 < b.y1 && o.y1 > b.y0) right = Math.min(right, o.x0 - 4);
      const cx = Math.max(0, Math.floor(b.x0 - 1.5 * b.charW)), cy = Math.max(0, Math.floor(b.y0 - lh * 0.6));
      const cw = Math.floor(right - cx), ch = Math.min(H - cy, Math.ceil(b.y1 - b.y0 + lh * 1.2));
      if (cw < 40 || ch < 20) continue;
      const crop = document.createElement("canvas");
      crop.width = cw; crop.height = ch;
      crop.getContext("2d")!.drawImage(prepared, cx, cy, cw, ch, 0, 0, cw, ch);
      const { data } = await this.refiner.recognize(crop, {}, { blocks: true, text: false });
      const fresh: OcrLine[] = [];
      for (const bl of data.blocks ?? []) for (const p of bl.paragraphs) for (const l of p.lines) {
        const r = cleanLine(l);
        if (!r || r.conf < 30) continue;
        fresh.push({ t: r.t, x: (cx + r.x0) / W, y: (cy + r.y0) / H, w: (r.x1 - r.x0) / W, h: (r.y1 - r.y0) / H });
      }
      if (fresh.length < b.lines.length * 0.6) continue; // pass 2 did worse; keep pass 1
      const inside = (l: OcrLine) => {
        const x0 = l.x * W, y0 = l.y * H, x1 = x0 + l.w * W, y1 = y0 + l.h * H;
        return x0 >= cx - 2 && x1 <= cx + cw + 2 && y0 >= cy - 2 && y1 <= cy + ch + 2;
      };
      kept = [...kept.filter((l) => !inside(l)), ...fresh];
    }
    return kept;
  }

  async recognize(canvas: HTMLCanvasElement): Promise<OcrLine[]> {
    await this.ready;
    const prepared = prepareForOcr(canvas);
    if (tune().psm) for (const w of this.workers) await w.setParameters({ tessedit_pageseg_mode: tune().psm as any });
    const { data } = await this.scheduler.addJob("recognize", prepared, {}, { blocks: true, text: false });
    const raw: RawLine[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      const t = String(l.text).replace(/\s+$/g, "").replace(/^\s+/, "");
      if (!t || l.confidence < 15) continue;
      raw.push({ t, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, conf: l.confidence });
    }
    if ((window as unknown as { __OCR_DEBUG?: boolean }).__OCR_DEBUG) console.log("OCRRAW" + JSON.stringify(raw));
    const W = prepared.width, H = prepared.height;
    const keep = mergeRows(raw).filter((l) => {
      if (l.conf < 40) return false;
      if (l.t.length <= 2 && l.conf < 60 && !/^\d+$/.test(l.t)) return false; // stray specks
      return true;
    });
    const pass1 = keep.map((l) => ({ t: l.t, x: l.x0 / W, y: l.y0 / H, w: (l.x1 - l.x0) / W, h: (l.y1 - l.y0) / H }));
    if ((window as unknown as { __tune?: { noRefine?: boolean } }).__tune?.noRefine) return pass1;
    try { return await this.refine(prepared, pass1); } catch { return pass1; }
  }

  async dispose() {
    try { await this.scheduler?.terminate(); await this.refiner?.terminate(); } catch { /* already gone */ }
  }
}
