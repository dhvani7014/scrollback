"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Frame, PxLine } from "@/lib/types";
import { blockText, buildBlocks, installCopyHandler } from "@/lib/textlayer";

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]}]+[^\s<>"'`)\]}.,;:!?]/gi;

function fillContent(node: HTMLElement, text: string) {
  node.textContent = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) node.append(document.createTextNode(text.slice(last, at)));
    const href = /^www\./i.test(m[0]) ? "https://" + m[0] : m[0];
    let safe: string | null = null;
    try { const u = new URL(href); if (u.protocol === "http:" || u.protocol === "https:") safe = u.href; } catch { /* not a URL */ }
    if (safe) {
      const a = document.createElement("a");
      a.href = safe; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = safe; a.textContent = m[0];
      node.append(a);
    } else node.append(document.createTextNode(m[0]));
    last = at + m[0].length;
  }
  if (last < text.length) node.append(document.createTextNode(text.slice(last)));
}

export default function FrameView({ frame, onToast, children }: { frame: Frame; onToast: (m: string) => void; children?: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const toastRef = useRef(onToast);
  toastRef.current = onToast;

  useEffect(() => (layer.current ? installCopyHandler(layer.current) : undefined), []);

  const layout = () => {
    const host = wrap.current, el = layer.current;
    if (!host || !el) return;
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    const sx = W / (frame.w || 1280), sy = H / (frame.h || 720);
    el.textContent = "";
    const frag = document.createDocumentFragment();
    const spans: [HTMLElement, number][] = [];
    const blocks = buildBlocks(frame);
    for (const b of blocks) for (const l of b.lines) {
      const s = document.createElement("span") as HTMLElement & { _line?: PxLine; _block?: typeof b };
      s.className = "ln" + (b.gutter ? " gutter" : "");
      fillContent(s, " ".repeat(l.ind) + l.t);
      const indPx = l.ind * b.charW, hgt = (l.y1 - l.y0) * sy;
      s.style.left = (l.x0 - indPx) * sx + "px";
      s.style.top = l.y0 * sy + "px";
      s.style.fontSize = Math.max(6, hgt * 0.82) + "px";
      s.style.height = hgt + "px";
      s._line = l; s._block = b;
      frag.append(s);
      spans.push([s, (l.x1 - l.x0 + indPx) * sx]);
    }
    el.append(frag);
    for (const [s, target] of spans) {
      const natural = s.scrollWidth || s.getBoundingClientRect().width;
      if (natural > 0 && target > 0) s.style.transform = `scaleX(${(target / natural).toFixed(4)})`;
    }
    for (const b of blocks) if (b.code) {
      const btn = document.createElement("button");
      btn.className = "copyblk"; btn.type = "button"; btn.textContent = "Copy code";
      btn.title = `Copy these ${b.lines.length} lines, with indentation`;
      btn.style.top = Math.max(2, b.y0 * sy - 30) + "px";
      btn.style.left = Math.max(2, b.x0 * sx) + "px";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(blockText(b)); toastRef.current(`Copied ${b.lines.length} lines`); }
        catch { toastRef.current("Clipboard blocked — select the text instead"); }
      });
      el.append(btn);
    }
  };

  useLayoutEffect(() => { layout(); }, [frame]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ro = new ResizeObserver(() => layout());
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }); // re-bind each render so layout() closes over the current frame

  return (
    <div className="screen" ref={wrap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={frame.url} alt="" onLoad={layout} draggable={false} />
      <div className="layer" id="textLayer" ref={layer} />
      {children}
    </div>
  );
}
