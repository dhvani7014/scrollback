// Copies Tesseract worker, wasm core and English model into public/ so OCR runs fully same-origin.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const nm = path.join(root, "node_modules");
const out = path.join(root, "public", "tesseract");
const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
try {
  cp(path.join(nm, "tesseract.js/dist/worker.min.js"), path.join(out, "worker/worker.min.js"));
  const core = path.join(nm, "tesseract.js-core");
  for (const f of fs.readdirSync(core)) if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f) || f === "tesseract-core-lstm.wasm.js") cp(path.join(core, f), path.join(out, "core", f));
  cp(path.join(nm, "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), path.join(out, "lang/eng.traineddata.gz"));
  console.log("tesseract assets copied to public/tesseract");
} catch (e) { console.error("copy-tesseract-assets failed:", e.message); process.exit(1); }
