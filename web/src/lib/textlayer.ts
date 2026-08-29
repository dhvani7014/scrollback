// Turns OCR lines into reading-order blocks: editor gutters detected and excluded, code blocks
// found, indentation recovered from x-offsets, blank lines inferred from line pitch.
// (Port of viewer/viewer.js, which is covered by the Playwright editor tests.)
import type { Block, Frame, PxLine } from "./types";

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function findGutterLines(L: PxLine[]): Set<PxLine> {
  const gutter = new Set<PxLine>();
  const isNum = (t: string) => /^\d{1,4}$/.test(t);
  const looksNum = (t: string) => /^[0-9IlOo|SsBb]{1,4}$/.test(t);
  const anchors = L.filter((l) => isNum(l.t));
  if (anchors.length < 3) return gutter;
  const lh = (l: PxLine) => l.y1 - l.y0;
  const aligned = (a: PxLine, b: PxLine) => {
    const tol = Math.max(lh(a), lh(b)) * 0.9;
    return Math.abs(a.x0 - b.x0) <= tol || Math.abs(a.x1 - b.x1) <= tol;
  };
  const par = anchors.map((_, i) => i);
  const find = (i: number): number => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++) if (aligned(anchors[i], anchors[j])) par[find(i)] = find(j);
  const cols = new Map<number, PxLine[]>();
  anchors.forEach((l, i) => { const r = find(i); if (!cols.has(r)) cols.set(r, []); cols.get(r)!.push(l); });
  for (const col of cols.values()) {
    if (col.length < 3) continue;
    col.sort((a, b) => a.y0 - b.y0);
    let steps = 0;
    for (let i = 1; i < col.length; i++) if (Number(col[i].t) === Number(col[i - 1].t) + 1) steps++;
    if (steps / (col.length - 1) < 0.6) continue;
    const tol = Math.max(...col.map(lh));
    const cx0 = Math.min(...col.map((l) => l.x0)) - tol, cx1 = Math.max(...col.map((l) => l.x1)) + tol;
    const gaps: number[] = [];
    for (let i = 1; i < col.length; i++) gaps.push(col[i].y0 - col[i - 1].y0);
    const pitch = median(gaps) || tol * 2;
    const cy0 = col[0].y0 - pitch * 1.6, cy1 = col[col.length - 1].y1 + pitch * 1.6;
    for (const l of L) {
      if (isNum(l.t) ? col.includes(l)
        : looksNum(l.t) && l.x0 >= cx0 && l.x1 <= cx1 && l.y0 >= cy0 && l.y1 <= cy1) gutter.add(l);
    }
  }
  return gutter;
}

export function buildBlocks(f: Frame): Block[] {
  if (f.blocks) return f.blocks;
  const W = f.w || 1280, H = f.h || 720;
  const L: PxLine[] = f.lines.map((l) => ({ t: l.t, x0: l.x * W, x1: (l.x + l.w) * W, y0: l.y * H, y1: (l.y + l.h) * H, ind: 0 }));
  const gset = findGutterLines(L);
  const gutterLines = L.filter((l) => gset.has(l));
  const R = L.filter((l) => !gset.has(l));
  const n = R.length;
  const parent = R.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = R[i], b = R[j];
    const lh = Math.min(a.y1 - a.y0, b.y1 - b.y0) || 1;
    const overlapX = a.x0 < b.x1 + lh * 0.3 && b.x0 < a.x1 + lh * 0.3;
    const gapY = Math.max(b.y0 - a.y1, a.y0 - b.y1);
    if (overlapX && gapY <= lh * 3.2) parent[find(i)] = find(j);
  }
  const groups = new Map<number, PxLine[]>();
  R.forEach((l, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(l); });

  const blocks: Block[] = [];
  for (const lines of groups.values()) {
    lines.sort((a, b) => {
      const ca = (a.y0 + a.y1) / 2, cb = (b.y0 + b.y1) / 2;
      const tol = Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5;
      return Math.abs(ca - cb) < tol ? a.x0 - b.x0 : ca - cb;
    });
    const b: Block = {
      lines, gutter: false, code: false, charW: 0, pitch: 1,
      x0: Math.min(...lines.map((l) => l.x0)), y0: Math.min(...lines.map((l) => l.y0)),
      x1: Math.max(...lines.map((l) => l.x1)), y1: Math.max(...lines.map((l) => l.y1)),
    };
    b.gutter = lines.length >= 3 && lines.every((l) => /^\d{1,4}$/.test(l.t));
    const per = lines.filter((l) => l.t.length >= 6).map((l) => (l.x1 - l.x0) / l.t.length);
    if (!b.gutter && per.length >= 3) {
      const mean = per.reduce((s, v) => s + v, 0) / per.length;
      const sd = Math.sqrt(per.reduce((s, v) => s + (v - mean) ** 2, 0) / per.length);
      b.charW = median(per);
      const codeish = lines.filter((l) => /[{}()\[\]=;:<>_'"#\/\\]/.test(l.t)).length / lines.length;
      b.code = sd / mean < 0.15 && codeish >= 0.5;
      if (b.code) for (const l of lines) {
        const cols = Math.round((l.x0 - b.x0) / b.charW);
        if (cols > 0 && cols <= 48) l.ind = cols;
      }
    }
    const cs = lines.map((l) => (l.y0 + l.y1) / 2);
    const ds: number[] = [];
    for (let i = 1; i < cs.length; i++) if (cs[i] - cs[i - 1] > 0) ds.push(cs[i] - cs[i - 1]);
    b.pitch = median(ds) || 1;
    blocks.push(b);
  }
  if (gutterLines.length) {
    gutterLines.sort((a, b) => a.y0 - b.y0);
    blocks.push({
      lines: gutterLines, gutter: true, code: false, charW: 0, pitch: 1,
      x0: Math.min(...gutterLines.map((l) => l.x0)), y0: gutterLines[0].y0,
      x1: Math.max(...gutterLines.map((l) => l.x1)), y1: gutterLines[gutterLines.length - 1].y1,
    });
  }
  blocks.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  f.blocks = blocks;
  return blocks;
}

export function blockText(b: Block): string {
  const lines = b.lines;
  const centers = lines.map((l) => (l.y0 + l.y1) / 2);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (i > 0 && b.code) {
      const blanks = Math.round((centers[i] - centers[i - 1]) / b.pitch) - 1;
      for (let k = 0; k < Math.min(blanks, 3); k++) out.push("");
    }
    out.push(" ".repeat(l.ind) + l.t);
  });
  return out.join("\n");
}

export function frameText(f: Frame): string {
  return buildBlocks(f).filter((b) => !b.gutter).map(blockText).join("\n\n");
}

/** Normalised line texts, used to decide whether two frames show the same content. */
export function lineKeys(f: { lines: { t: string }[] }): Set<string> {
  return new Set(f.lines.map((l) => l.t.replace(/\s+/g, "").toLowerCase()).filter((t) => t.length > 1));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---- selection -> clipboard ---------------------------------------------------------------
// Chromium serialises a selection over absolutely-positioned spans without line breaks, so build
// the clipboard text ourselves: newline per line, indentation kept, blank lines restored.
type LineEl = HTMLElement & { _line?: PxLine; _block?: Block };

function selectedSliceOf(span: HTMLElement, range: Range): string {
  const full = span.textContent ?? "";
  const r = document.createRange();
  r.selectNodeContents(span);
  let a = 0, b = full.length;
  if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) {
    const pre = document.createRange();
    pre.setStart(span, 0); pre.setEnd(range.startContainer, range.startOffset);
    a = pre.toString().length;
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) {
    const post = document.createRange();
    post.setStart(span, 0); post.setEnd(range.endContainer, range.endOffset);
    b = post.toString().length;
  }
  return full.slice(a, b);
}

export function installCopyHandler(layer: HTMLElement): () => void {
  const onCopy = (e: ClipboardEvent) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.anchorNode || !layer.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const picked = [...layer.querySelectorAll<LineEl>(".ln:not(.gutter)")].filter((s) => range.intersectsNode(s));
    if (!picked.length) return;
    const out: string[] = [];
    picked.forEach((s, i) => {
      if (i > 0) {
        const prev = picked[i - 1];
        if (prev._block === s._block && s._block?.code && prev._line && s._line) {
          const c1 = (prev._line.y0 + prev._line.y1) / 2, c2 = (s._line.y0 + s._line.y1) / 2;
          const blanks = Math.round((c2 - c1) / s._block.pitch) - 1;
          for (let k = 0; k < Math.min(blanks, 3); k++) out.push("");
        }
      }
      out.push(selectedSliceOf(s, range));
    });
    e.clipboardData?.setData("text/plain", out.join("\n"));
    e.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  return () => document.removeEventListener("copy", onCopy);
}
