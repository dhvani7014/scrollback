// Probe Tesseract.js page-segmentation modes on a code-editor + sidebar frame.
//   node scripts/ocr-probe.mjs <image.png> <ground-truth-lines.json>
// Ground truth = the "lines" array of a tools/fixtures_editor*.json frame (normalised boxes).
import { createWorker } from "tesseract.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const langPath = path.resolve(here, "../node_modules/@tesseract.js-data/eng/4.0.0_best_int");
const [imgPath, gtPath] = process.argv.slice(2);
const gt = JSON.parse(fs.readFileSync(gtPath, "utf8"));
const norm = (s) => s.replace(/\s+/g, "");

function sim(a, b) {
  // normalised Levenshtein similarity
  const m = a.length, n = b.length;
  if (!m && !n) return 1;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

const worker = await createWorker("eng", 1, { langPath, gzip: true, cachePath: "/tmp/tess-cache" });
const buf = fs.readFileSync(imgPath);
for (const psm of ["3", "4", "6", "11", "12"]) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" });
  const t0 = Date.now();
  const { data } = await worker.recognize(buf, {}, { blocks: true, text: false });
  const ms = Date.now() - t0;
  const lines = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
    lines.push({ t: l.text.replace(/\n$/, ""), x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, conf: l.confidence });
  }
  // match each ground-truth line to the OCR line with the most similar text
  let exact = 0, simSum = 0, boxOk = 0;
  const misses = [];
  for (const g of gt) {
    const gn = norm(g.t);
    let best = null, bs = -1;
    for (const l of lines) { const s = sim(gn, norm(l.t)); if (s > bs) { bs = s; best = l; } }
    simSum += bs;
    if (bs === 1) exact++; else if (misses.length < 4) misses.push(`${gn}  =>  ${best ? norm(best.t) : "(none)"}`);
    // box check: OCR line centre should fall inside the GT box (loosely)
    if (best) {
      const W = Math.max(...lines.map((l) => l.x1)) / 0.98, H = Math.max(...lines.map((l) => l.y1)) / 0.9;
      void W; void H;
    }
  }
  console.log(`psm ${psm.padEnd(2)}  ${String(ms).padStart(5)} ms  ocr lines ${String(lines.length).padStart(3)} / gt ${gt.length}  exact ${exact}/${gt.length}  mean sim ${(simSum / gt.length * 100).toFixed(1)}%`);
  for (const m of misses) console.log("      ", m);
}
await worker.terminate();
