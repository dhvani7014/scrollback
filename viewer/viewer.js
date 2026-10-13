// Scrollback viewer.
// URL shape:  https://host/s/<sessionId>#k=<base64url AES-256 key>
// The key lives in the fragment, so it is never sent to the server.
// Frame blob = base64( iv[12] || AES-GCM ciphertext || tag ) of JSON:
//   { w, h, jpeg: <base64>, lines: [{ t, x, y, w, h }] }   (coords normalised 0..1, top-left origin)
"use strict";

const MAX_FRAMES = 600;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]}]+[^\s<>"'`)\]}.,;:!?]/gi;

const $ = (id) => document.getElementById(id);
const el = {
  connPill: $("connPill"), connText: $("connText"),
  presPill: $("presPill"), presText: $("presText"),
  empty: $("empty"), emptyTitle: $("emptyTitle"), emptyMsg: $("emptyMsg"), spin: $("spin"),
  wrap: $("frameWrap"), img: $("frameImg"), layer: $("textLayer"),
  slider: $("slider"), timeLabel: $("timeLabel"), countLabel: $("countLabel"),
  liveBtn: $("liveBtn"), liveText: $("liveText"), newBadge: $("newBadge"),
  copyAll: $("copyAll"), toast: $("toast"),
};

// ---- session id + key ------------------------------------------------------
const sessionId =
  (location.pathname.match(/^\/s\/([A-Za-z0-9_-]{8,64})/) || [])[1] ||
  new URLSearchParams(location.search).get("s");
const keyB64 = new URLSearchParams(location.hash.slice(1)).get("k");

function b64ToBytes(b64) {
  b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function setConn(text, cls) {
  el.connText.textContent = text;
  el.connPill.className = "pill " + (cls || "");
}

function showEmpty(title, msg, spinning = false) {
  el.emptyTitle.textContent = title;
  el.emptyMsg.textContent = msg;
  el.spin.style.display = spinning ? "" : "none";
  el.empty.hidden = false;
  el.wrap.hidden = true;
}

if (!sessionId || !keyB64) {
  setConn("Invalid link", "bad");
  showEmpty(
    "This link is incomplete",
    "Ask the presenter for the full Scrollback link. It must include the part after the # — that is the decryption key."
  );
  throw new Error("missing session id or key");
}

let cryptoKey = null;
const keyReady = crypto.subtle
  .importKey("raw", b64ToBytes(keyB64), "AES-GCM", false, ["decrypt"])
  .then((k) => (cryptoKey = k));

async function decryptBlob(blob) {
  const raw = b64ToBytes(blob);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---- state -------------------------------------------------------------------
const frames = []; // { seq, ts, url, lines, w, h }
let viewIdx = -1;
let following = true;
let unseen = 0;
let decryptChain = Promise.resolve();
let decryptFailures = 0;

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtBehind(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `−${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove("show"), 1600);
}

// ---- text layer ------------------------------------------------------------
function buildLineContent(node, text) {
  node.textContent = "";
  let last = 0;
  URL_RE.lastIndex = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) node.append(document.createTextNode(text.slice(last, m.index)));
    const href = /^www\./i.test(m[0]) ? "https://" + m[0] : m[0];
    let safe = null;
    try {
      const u = new URL(href);
      if (u.protocol === "http:" || u.protocol === "https:") safe = u.href;
    } catch {}
    if (safe) {
      const a = document.createElement("a");
      a.href = safe;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = safe;
      a.textContent = m[0];
      node.append(a);
    } else {
      node.append(document.createTextNode(m[0]));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) node.append(document.createTextNode(text.slice(last)));
}

const VIEWER_VERSION = "v3";

function debugDump() {
  const f = frames[viewIdx];
  if (!f) return;
  const out = {
    viewer: VIEWER_VERSION, w: f.w, h: f.h,
    blocks: buildBlocks(f).map((b) => ({
      gutter: b.gutter, code: b.code,
      lines: b.lines.map((l) => ({ t: l.t, x0: Math.round(l.x0), y0: Math.round(l.y0), x1: Math.round(l.x1), y1: Math.round(l.y1), ind: l.ind })),
    })),
  };
  navigator.clipboard.writeText(JSON.stringify(out)).then(
    () => toast("Copied frame debug data"), () => toast("Clipboard blocked"));
}

// ---- reading order: blocks, gutters, indentation ------------------------------
// A flat top-to-bottom list makes a drag-selection sweep up everything between its endpoints,
// including other columns. So lines are clustered into blocks (a block = lines that overlap
// horizontally and sit close vertically); DOM order is block by block, left to right.
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Editor line numbers: a column of consecutive integers, left- or right-aligned. OCR sometimes
// misreads a number ("1" -> "l", "11" -> "I1"), so lines that look digit-like and sit inside the
// column's box count too.
function findGutterLines(L) {
  const gutter = new Set();
  const isNum = (t) => /^\d{1,4}$/.test(t);
  const looksNum = (t) => /^[0-9IlOo|SsBb]{1,4}$/.test(t);
  const anchors = L.filter((l) => isNum(l.t));
  if (anchors.length < 2) return gutter;
  const lh = (l) => l.y1 - l.y0;
  const aligned = (a, b) => {
    const tol = Math.max(lh(a), lh(b)) * 1.2;
    return Math.abs(a.x0 - b.x0) <= tol || Math.abs(a.x1 - b.x1) <= tol;
  };
  const par = anchors.map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++) if (aligned(anchors[i], anchors[j])) par[find(i)] = find(j);
  const cols = new Map();
  anchors.forEach((l, i) => { const r = find(i); if (!cols.has(r)) cols.set(r, []); cols.get(r).push(l); });
  for (const col of cols.values()) {
    if (col.length < 2) continue;
    col.sort((a, b) => a.y0 - b.y0);
    let steps = 0;
    for (let i = 1; i < col.length; i++) if (Number(col[i].t.replace(/\D/g, "")) === Number(col[i - 1].t.replace(/\D/g, "")) + 1) steps++;
    if (col.length > 2 && steps / (col.length - 1) < 0.5) continue; // not line numbers (e.g. a column of amounts)
    const tol = Math.max(...col.map(lh));
    const cx0 = Math.min(...col.map((l) => l.x0)) - tol, cx1 = Math.max(...col.map((l) => l.x1)) + tol;
    const gaps = [];
    for (let i = 1; i < col.length; i++) gaps.push(col[i].y0 - col[i - 1].y0);
    const pitch = median(gaps) || tol * 2; // misread numbers may sit one pitch beyond the clean ones
    const cy0 = col[0].y0 - pitch * 1.6, cy1 = col[col.length - 1].y1 + pitch * 1.6;
    for (const l of L) {
      if (isNum(l.t) ? col.includes(l)
          : looksNum(l.t) && l.x0 >= cx0 && l.x1 <= cx1 && l.y0 >= cy0 && l.y1 <= cy1) gutter.add(l);
    }
  }
  return gutter;
}

function buildBlocks(f) {
  if (f.blocks) return f.blocks;
  const W = f.w || 1280, H = f.h || 720;
  const L = f.lines.map((l) => ({
    t: l.t, x0: l.x * W, x1: (l.x + l.w) * W, y0: l.y * H, y1: (l.y + l.h) * H, ind: 0,
  }));
  const gset = findGutterLines(L);
  const gutterLines = L.filter((l) => gset.has(l));
  const R = L.filter((l) => !gset.has(l));
  const n = R.length;
  const parent = R.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = R[i], b = R[j];
      const lh = Math.min(a.y1 - a.y0, b.y1 - b.y0) || 1;
      const overlapX = a.x0 < b.x1 + lh * 0.3 && b.x0 < a.x1 + lh * 0.3;
      const gapY = Math.max(b.y0 - a.y1, a.y0 - b.y1);
      if (overlapX && gapY <= lh * 3.2) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  R.forEach((l, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(l); });

  const blocks = [];
  for (const lines of groups.values()) {
    lines.sort((a, b) => {
      const ca = (a.y0 + a.y1) / 2, cb = (b.y0 + b.y1) / 2;
      const tol = Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5;
      return Math.abs(ca - cb) < tol ? a.x0 - b.x0 : ca - cb;
    });
    const b = {
      lines, gutter: false, code: false, charW: 0,
      x0: Math.min(...lines.map((l) => l.x0)), y0: Math.min(...lines.map((l) => l.y0)),
      x1: Math.max(...lines.map((l) => l.x1)), y1: Math.max(...lines.map((l) => l.y1)),
    };
    // a column of bare line numbers (editor gutter): never selectable, never copied
    b.gutter = lines.length >= 3 && lines.every((l) => /^\d{1,4}$/.test(l.t));
    // code-like: monospace-consistent glyph width and lots of code punctuation
    const per = lines.filter((l) => l.t.length >= 6).map((l) => (l.x1 - l.x0) / l.t.length);
    if (!b.gutter && per.length >= 3) {
      const mean = per.reduce((s, v) => s + v, 0) / per.length;
      const sd = Math.sqrt(per.reduce((s, v) => s + (v - mean) ** 2, 0) / per.length);
      b.charW = median(per);
      const codeish = lines.filter((l) => /[{}()\[\]=;:<>_'"#\/\\]/.test(l.t)).length / lines.length;
      b.code = sd / mean < 0.15 && codeish >= 0.5;
      if (b.code) {
        // OCR strips leading spaces; recover indentation from how far each line starts to the right
        for (const l of lines) {
          const cols = Math.round((l.x0 - b.x0) / b.charW);
          if (cols > 0 && cols <= 48) l.ind = cols;
        }
      }
    }
    const cs = lines.map((l) => (l.y0 + l.y1) / 2);
    const ds = [];
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
  blocks.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0); // columns left to right
  f.blocks = blocks;
  return blocks;
}

function blockText(b) {
  const lines = b.lines;
  const centers = lines.map((l) => (l.y0 + l.y1) / 2);
  const diffs = [];
  for (let i = 1; i < lines.length; i++) if (centers[i] - centers[i - 1] > 0) diffs.push(centers[i] - centers[i - 1]);
  const pitch = median(diffs) || 1;
  const out = [];
  lines.forEach((l, i) => {
    if (i > 0 && b.code) {
      // a gap of ~2 line pitches means a blank line in the source
      const blanks = Math.round((centers[i] - centers[i - 1]) / pitch) - 1;
      for (let k = 0; k < Math.min(blanks, 3); k++) out.push("");
    }
    out.push(" ".repeat(l.ind) + l.t);
  });
  return out.join("\n");
}

function frameText(f) {
  return buildBlocks(f).filter((b) => !b.gutter).map(blockText).join("\n\n");
}

function addCopyButton(b, sx, sy) {
  const btn = document.createElement("button");
  btn.className = "copyblk";
  btn.type = "button";
  btn.textContent = "Copy code";
  btn.title = `Copy these ${b.lines.length} lines, with indentation`;
  // top-left, just above the first line: that is where the eye lands when reading code
  btn.style.top = Math.max(2, b.y0 * sy - 30) + "px";
  btn.style.left = Math.max(2, b.x0 * sx) + "px";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(blockText(b));
      toast(`Copied ${b.lines.length} lines`);
    } catch {
      toast("Clipboard blocked — select the text instead");
    }
  });
  el.layer.append(btn);
}

function layoutTextLayer() {
  const f = frames[viewIdx];
  if (!f) return;
  const W = el.wrap.clientWidth;
  const H = el.wrap.clientHeight;
  if (!W || !H) return;
  const sx = W / (f.w || 1280), sy = H / (f.h || 720); // frame px -> css px
  el.layer.textContent = "";
  const frag = document.createDocumentFragment();
  const spans = [];
  const blocks = buildBlocks(f);
  let bi = -1;
  for (const b of blocks) {
    bi++;
    for (const l of b.lines) {
      const s = document.createElement("span");
      s.style.setProperty("--bc", `hsl(${(bi * 67) % 360} 90% 62%)`);
      s.className = "ln" + (b.gutter ? " gutter" : "");
      buildLineContent(s, " ".repeat(l.ind) + l.t);
      // leading spaces sit to the left of the glyphs, so widen the box leftwards by that much
      const indPx = l.ind * b.charW;
      const hgt = (l.y1 - l.y0) * sy;
      s.style.left = (l.x0 - indPx) * sx + "px";
      s.style.top = l.y0 * sy + "px";
      s.style.fontSize = Math.max(6, hgt * 0.82) + "px";
      s.style.height = hgt + "px";
      s._line = l; s._block = b;
      frag.append(s);
      spans.push([s, (l.x1 - l.x0 + indPx) * sx]);
    }
  }
  el.layer.append(frag);
  // Stretch each line horizontally so selection boxes match the pixels underneath.
  for (const [s, targetW] of spans) {
    const natural = s.scrollWidth || s.getBoundingClientRect().width;
    if (natural > 0 && targetW > 0) s.style.transform = `scaleX(${(targetW / natural).toFixed(4)})`;
  }
  for (const b of blocks) if (b.code) addCopyButton(b, sx, sy);
}

// Chromium serialises a selection over absolutely-positioned spans WITHOUT line breaks, so a
// copied snippet would arrive as one long line. Build the clipboard text ourselves instead:
// newline per line, indentation kept, blank lines restored, line numbers excluded.
function selectedSliceOf(span, range) {
  const full = span.textContent;
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

document.addEventListener("copy", (e) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !el.layer.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const picked = [...el.layer.querySelectorAll(".ln:not(.gutter)")].filter((s) => range.intersectsNode(s));
  if (!picked.length) return;
  const out = [];
  picked.forEach((s, i) => {
    if (i > 0) {
      const prev = picked[i - 1];
      if (prev._block === s._block && s._block.code) {
        const c1 = (prev._line.y0 + prev._line.y1) / 2, c2 = (s._line.y0 + s._line.y1) / 2;
        const blanks = Math.round((c2 - c1) / s._block.pitch) - 1;
        for (let k = 0; k < Math.min(blanks, 3); k++) out.push("");
      }
    }
    out.push(selectedSliceOf(s, range));
  });
  e.clipboardData.setData("text/plain", out.join("\n"));
  e.preventDefault();
});

new ResizeObserver(() => layoutTextLayer()).observe(el.wrap);

// ---- rendering -------------------------------------------------------------
function show(idx) {
  idx = Math.max(0, Math.min(frames.length - 1, idx));
  viewIdx = idx;
  const f = frames[idx];
  if (!f) return;
  el.empty.hidden = true;
  el.wrap.hidden = false;
  if (el.img.dataset.seq !== String(f.seq)) {
    el.img.dataset.seq = String(f.seq);
    el.img.src = f.url;
    el.img.onload = layoutTextLayer;
  }
  layoutTextLayer();
  updateChrome();
}

function updateChrome() {
  const n = frames.length;
  el.slider.disabled = n < 1;
  el.slider.max = String(Math.max(0, n - 1));
  el.slider.value = String(Math.max(0, viewIdx));
  el.countLabel.textContent = `${n} frame${n === 1 ? "" : "s"}`;
  el.copyAll.disabled = n < 1;
  el.liveBtn.disabled = n < 1;
  const f = frames[viewIdx];
  if (f) {
    const behindMs = frames[n - 1].ts - f.ts;
    el.timeLabel.textContent = following ? fmtClock(f.ts) : `${fmtClock(f.ts)} (${fmtBehind(behindMs)})`;
  }
  if (following) {
    el.liveBtn.className = "isLive";
    el.liveText.textContent = "● Live";
    el.newBadge.hidden = true;
  } else {
    el.liveBtn.className = "behind";
    el.liveText.textContent = "Jump to live";
    el.newBadge.hidden = unseen === 0;
    el.newBadge.textContent = String(unseen);
  }
}

function goLive() {
  following = true;
  unseen = 0;
  if (frames.length) show(frames.length - 1);
}

el.slider.addEventListener("input", () => {
  const idx = Number(el.slider.value);
  following = idx >= frames.length - 1;
  if (following) unseen = 0;
  show(idx);
});
el.liveBtn.addEventListener("click", goLive);
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== "range") return;
  if (e.key === "ArrowLeft") { following = false; show(viewIdx - 1); e.preventDefault(); }
  else if (e.key === "ArrowRight") { show(viewIdx + 1); following = viewIdx >= frames.length - 1; if (following) unseen = 0; updateChrome(); e.preventDefault(); }
  else if (e.key === "End" || e.key === "l") { goLive(); }
  else if (e.key === "d") { document.body.classList.toggle("dbg"); toast("Debug outlines " + (document.body.classList.contains("dbg") ? "on (Shift+D copies frame data)" : "off")); }
  else if (e.key === "D") { debugDump(); }
});

el.copyAll.addEventListener("click", async () => {
  const f = frames[viewIdx];
  if (!f) return;
  const text = frameText(f);
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied all text from this frame");
  } catch {
    toast("Clipboard blocked — select the text instead");
  }
});

// ---- ingest ------------------------------------------------------------------
function ingest(msg) {
  decryptChain = decryptChain.then(async () => {
    try {
      await keyReady;
      const p = await decryptBlob(msg.blob);
      const bytes = b64ToBytes(p.jpeg);
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      frames.push({ seq: msg.seq, ts: msg.ts, url, lines: p.lines || [], w: p.w, h: p.h });
      if (frames.length > MAX_FRAMES) {
        const old = frames.shift();
        URL.revokeObjectURL(old.url);
        if (viewIdx > 0) viewIdx--;
      }
      if (following || viewIdx < 0) {
        show(frames.length - 1);
      } else {
        unseen++;
        updateChrome();
      }
    } catch (err) {
      decryptFailures++;
      if (decryptFailures >= 2 && frames.length === 0) {
        setConn("Can't decrypt", "bad");
        showEmpty("Couldn't decrypt this session", "The link's key doesn't match the presenter's. Ask for a fresh link.");
      }
      console.warn("frame failed", err);
    }
  });
}

// ---- websocket -------------------------------------------------------------------
let retry = 0;
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws/${sessionId}?role=viewer`);
  setConn(retry ? "Reconnecting…" : "Connecting…", "warn");

  ws.onopen = () => {
    retry = 0;
    setConn("Connected", "ok");
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "frame") {
      // On reconnect the relay replays history; skip frames we already hold.
      if (frames.length && msg.seq <= frames[frames.length - 1].seq) return;
      ingest(msg);
    } else if (msg.type === "hello") {
      setPresence(msg.presenter);
      if (msg.count === 0) showEmpty("Waiting for the presenter…", "Their screen will appear here with selectable text and clickable links.", true);
    } else if (msg.type === "presence") {
      setPresence(msg.presenter);
    }
  };
  ws.onclose = () => {
    setConn("Disconnected", "bad");
    retry++;
    setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(retry, 4)));
  };
  ws.onerror = () => ws.close();
}

function setPresence(online) {
  el.presPill.hidden = false;
  el.presPill.className = "pill " + (online ? "ok" : "warn");
  el.presText.textContent = online ? "Presenter live" : "Presenter offline";
}

connect();
