"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import FrameView from "./FrameView";
import demo from "@/lib/demo-lines.json";
import { TesseractEngine } from "@/lib/ocr";
import { Reader } from "@/lib/pipeline";
import { readRecording, shareTab, type Progress } from "@/lib/sources";
import { frameText } from "@/lib/textlayer";
import type { Frame } from "@/lib/types";
import { parseYouTube, type YouTubeRef } from "@/lib/youtube";
import GettingStarted from "./GettingStarted";
import ToolsReference from "./ToolsReference";

type Kind = "recording" | "tab" | "youtube";
interface Session { id: number; kind: Kind; label: string; reader: Reader; stop: () => void; yt?: YouTubeRef; progress?: Progress; done?: boolean }
let nextSession = 1;

const demoFrame: Frame = { id: 0, ts: 0, w: demo.w, h: demo.h, url: "/demo/editor.jpg", lines: demo.lines };

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useToast(): [string, boolean, (m: string) => void] {
  const [msg, setMsg] = useState(""); const [on, setOn] = useState(false); const t = useRef<number>(0);
  const show = useCallback((m: string) => {
    setMsg(m); setOn(true); window.clearTimeout(t.current); t.current = window.setTimeout(() => setOn(false), 1800);
  }, []);
  return [msg, on, show];
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [toastMsg, toastOn, toast] = useToast();
  const [activePage, setActivePage] = useState<"studio" | "getting-started" | "tools">("studio");
  const [activeSource, setActiveSource] = useState<"tab" | "yt" | "file" | "mac">("tab");
  const end = useCallback(async (s: Session | null) => { if (!s) return; s.stop(); await s.reader.dispose(); }, []);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  useEffect(() => () => { void end(sessionRef.current); }, [end]);

  const begin = useCallback((s: Session) => {
    const old = sessionRef.current;
    if (old) void end(old);
    setSession(s);
  }, [end]);
  const leave = useCallback(() => {
    const old = sessionRef.current;
    if (old) void end(old);
    setSession(null);
  }, [end]);

  return (
    <>
      <div className="wrap">
        <header className="top">
          <div className="brand" onClick={() => { setActivePage("studio"); leave(); }} style={{ cursor: "pointer" }}>
            <svg className="brand-logo" width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#0d1424" stroke="rgba(45, 212, 191, 0.4)" strokeWidth="1.5" />
              <rect x="5" y="6" width="22" height="15" rx="3" stroke="url(#logo-g)" strokeWidth="1.8" />
              <path d="M11 25H21" stroke="url(#logo-g)" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M16 21V25" stroke="url(#logo-g)" strokeWidth="1.8" />
              <path d="M18.5 10.5L14 13.5L18.5 16.5V10.5Z" fill="url(#logo-g)" />
              <path d="M14 10.5L9.5 13.5L14 16.5V10.5Z" fill="url(#logo-g)" />
              <defs>
                <linearGradient id="logo-g" x1="5" y1="6" x2="27" y2="25" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#5eead4" />
                  <stop offset="1" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
            </svg>
            Scrollback
          </div>

          <nav className="header-nav">
            <button
              type="button"
              className={`nav-link ${activePage === "studio" && !session ? "active" : ""}`}
              onClick={() => { setActivePage("studio"); leave(); }}
            >
              Studio
            </button>
            <button
              type="button"
              className={`nav-link ${activePage === "getting-started" ? "active" : ""}`}
              onClick={() => { setActivePage("getting-started"); leave(); }}
            >
              Getting Started
            </button>
            <button
              type="button"
              className={`nav-link ${activePage === "tools" ? "active" : ""}`}
              onClick={() => { setActivePage("tools"); leave(); }}
            >
              Tools Reference
            </button>
          </nav>

          <div className="header-right">
            <a
              href="https://github.com/dhvani7014/scrollback"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link-gh"
            >
              GitHub ↗
            </a>
          </div>
        </header>

        {session ? (
          <ReaderView key={session.id} session={session} onLeave={leave} toast={toast} />
        ) : activePage === "getting-started" ? (
          <GettingStarted onLaunch={() => { setActivePage("studio"); }} />
        ) : activePage === "tools" ? (
          <ToolsReference onSelectTool={(tool) => { setActiveSource(tool); setActivePage("studio"); }} />
        ) : (
          <Home
            begin={begin}
            toast={toast}
            sourceMode={activeSource}
            setSourceMode={setActiveSource}
          />
        )}
      </div>
      <div className={"toast" + (toastOn ? " show" : "")} role="status">{toastMsg}</div>
    </>
  );
}

// ---------------------------------------------------------------- home
function Home({
  begin,
  toast,
  sourceMode,
  setSourceMode,
}: {
  begin: (s: Session) => void;
  toast: (m: string) => void;
  sourceMode: "tab" | "yt" | "file" | "mac";
  setSourceMode: (m: "tab" | "yt" | "file" | "mac") => void;
}) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState<{ [k: string]: string }>({});
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fail = (k: string, m: string) => setErr((e) => ({ ...e, [k]: m }));

  const makeReader = (latestOnly: boolean) => new Reader(new TesseractEngine(), { latestOnly, concurrency: latestOnly ? 1 : 2 });

  const startWithUrl = (url: string) => {
    const yt = parseYouTube(url);
    if (!yt) return fail("yt", "Please enter a valid YouTube link.");
    setErr({});
    const reader = makeReader(true);
    begin({
      id: nextSession++,
      kind: "youtube",
      label: `YouTube · ${yt.id}`,
      reader,
      stop: () => {},
      yt,
    });
  };

  const startYouTube = (e: React.FormEvent) => {
    e.preventDefault();
    startWithUrl(link);
  };

  const startTab = async () => {
    setErr({});
    const reader = makeReader(true);
    try {
      const stop = await shareTab(reader, { onEnded: () => reader.stop() });
      begin({ id: nextSession++, kind: "tab", label: "Shared tab", reader, stop });
    } catch (e) {
      void reader.dispose();
      const isCancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "InvalidStateError" || e.message.toLowerCase().includes("invalid state"));
      fail("tab", isCancelled ? "Sharing was cancelled — choose a tab and press Share." : (e as Error).message);
    }
  };

  const startFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) return fail("file", "Please select a valid video file (.mp4, .webm, .mov).");
    setErr({});
    const reader = makeReader(false);
    const ac = new AbortController();
    const s: Session = { id: nextSession++, kind: "recording", label: file.name, reader, stop: () => ac.abort() };
    begin(s);
    readRecording(file, reader, ac.signal, (p) => { s.progress = p; reader.notify(); })
      .then(() => { s.done = true; reader.notify(); })
      .catch((e: Error) => { reader.error = e.message; reader.notify(); });
  };

  const copyCliCmd = async () => {
    try {
      await navigator.clipboard.writeText("./capture-mac/scrollback --relay http://localhost:8787");
      toast("Copied CLI command to clipboard");
    } catch {
      toast("Failed to copy command");
    }
  };

  const startDemo = () => {
    const dummyReader = {
      frames: [demoFrame],
      latestOnly: true,
      concurrency: 1,
      inFlight: false,
      error: null,
      subscribe: () => () => { },
      notify: () => { },
      submit: () => { },
      idleBelow: async () => { },
      drain: async () => { },
      stop: () => { },
      dispose: async () => { },
    } as unknown as Reader;
    begin({
      id: nextSession++,
      kind: "tab",
      label: "Interactive Demo · Python Editor",
      reader: dummyReader,
      stop: () => { },
    });
  };

  return (
    <div className="bento-hub">
      {/* Top Bento Row: Hero Card (Left) + Source Dock Card (Right) */}
      <div className="bento-row bento-row-top">
        <div className="bento-card bento-hero">
          <div className="bento-badge">DEVELOPER WORKBENCH</div>
          <h1 className="bento-title">
            Turn screen video into <span className="teal-accent-text">selectable code</span>.
          </h1>
          <p className="bento-desc">
            Extract clean, indented code directly from screen shares, YouTube tutorials, and video files in real time.
          </p>

          <div className="bento-cta-wrap">
            <button type="button" className="btn-bento-demo" onClick={startDemo}>
              <span className="demo-sparkle">✨</span>
              <span>Try Interactive Demo</span>
              <span className="demo-tag">1-Click Preview →</span>
            </button>
          </div>

          {/* Interactive Code Preview Window */}
          <div className="hero-code-card">
            <div className="hero-code-bar">
              <div className="hero-code-dots">
                <span className="h-dot h-red" />
                <span className="h-dot h-yellow" />
                <span className="h-dot h-green" />
              </div>
              <span className="hero-code-title">detected_stream.py</span>
              <span className="hero-code-badge">OCR 60 FPS</span>
            </div>
            <div className="hero-code-body">
              <div className="h-code-row"><span className="h-ln">1</span><span className="h-kw">async def</span> <span className="h-fn">transcribe_screen</span>(stream: VideoStream):</div>
              <div className="h-code-row"><span className="h-ln">2</span>    <span className="h-cmt"># Pixel-aligned bounding boxes preserve indentation</span></div>
              <div className="h-code-row"><span className="h-ln">3</span>    blocks = <span className="h-kw">await</span> engine.detect_code_lines(stream)</div>
              <div className="h-code-row"><span className="h-ln">4</span>    <span className="h-kw">return</span> blocks.to_clipboard()</div>
            </div>
            <div className="hero-code-footer">
              <span className="hero-pill-info">✓ Indentation preserved</span>
              <span className="hero-pill-info">✓ Auto deduplication</span>
              <span className="hero-pill-info">✓ Single-click copy</span>
            </div>
          </div>
        </div>

        <div className="bento-card bento-dock-card">
          <div className="dock-tabs">
            <button
              type="button"
              className={`dock-tab ${sourceMode === "tab" ? "active" : ""}`}
              onClick={() => setSourceMode("tab")}
            >
              <span className="tab-icon">⎘</span>
              <span className="tab-title">Tab Share</span>
              <span className="tab-rec-tag">REC</span>
            </button>
            <button
              type="button"
              className={`dock-tab ${sourceMode === "yt" ? "active" : ""}`}
              onClick={() => setSourceMode("yt")}
            >
              <span className="tab-icon">▶</span>
              <span className="tab-title">YouTube</span>
            </button>
            <button
              type="button"
              className={`dock-tab ${sourceMode === "file" ? "active" : ""}`}
              onClick={() => setSourceMode("file")}
            >
              <span className="tab-icon">📁</span>
              <span className="tab-title">Video File</span>
            </button>
            <button
              type="button"
              className={`dock-tab ${sourceMode === "mac" ? "active" : ""}`}
              onClick={() => setSourceMode("mac")}
            >
              <span className="tab-icon">⚡</span>
              <span className="tab-title">macOS CLI</span>
            </button>
          </div>

          <div className="dock-content">
            {sourceMode === "tab" && (
              <div className="dock-panel">
                <div className="dock-main-action-row">
                  <div className="dock-text">
                    <strong>Capture any screen, window, or tab live</strong>
                    <span>Streams video in full resolution at 60 FPS. Code is transcribed frame-by-frame with zero lag.</span>
                  </div>
                  <button className="btn-teal-action" onClick={startTab}>
                    Start Tab Share →
                  </button>
                </div>

                <div className="dock-presets-grid">
                  <div className="dock-preset-item">
                    <span className="preset-icon">🎥</span>
                    <div>
                      <strong>Video Tutorials</strong>
                      <span>YouTube, Twitch &amp; Vimeo coding streams</span>
                    </div>
                  </div>
                  <div className="dock-preset-item">
                    <span className="preset-icon">👥</span>
                    <div>
                      <strong>Team Meetings</strong>
                      <span>Zoom, Google Meet &amp; Teams code reviews</span>
                    </div>
                  </div>
                  <div className="dock-preset-item">
                    <span className="preset-icon">📑</span>
                    <div>
                      <strong>Keynotes &amp; PDFs</strong>
                      <span>Locked presentation decks and slides</span>
                    </div>
                  </div>
                </div>

                <div className="dock-capabilities-row">
                  <div className="cap-item"><span className="cap-check">✓</span><span>Multi-monitor &amp; window picker</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Sub-frame jitter stabilization</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Zero background network traffic</span></div>
                </div>

                <div className="dock-specs-footer">
                  <span>● WebRTC 60 FPS</span>
                  <span>● Retina 1:1 Pixels</span>
                  <span>● Auto Deduplication</span>
                </div>
              </div>
            )}

            {sourceMode === "yt" && (
              <div className="dock-panel">
                <form onSubmit={startYouTube} className="dock-row">
                  <div className="dock-input-wrap">
                    <span className="input-prefix">https://</span>
                    <input
                      className="dock-input"
                      aria-label="YouTube link"
                      placeholder="youtube.com/watch?v=kqtD5dpn9C8 (or any coding tutorial)"
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
                    />
                    {link && (
                      <button type="button" className="btn-clear" onClick={() => setLink("")}>✕</button>
                    )}
                  </div>
                  <button className="btn-teal-action" type="submit">
                    Open Video →
                  </button>
                </form>

                <div className="dock-samples-wrap">
                  <span className="chips-label">Popular sample tutorials:</span>
                  <div className="sample-cards-row">
                    <button
                      type="button"
                      className="sample-card-item"
                      onClick={() => { setLink("https://www.youtube.com/watch?v=kqtD5dpn9C8"); void startWithUrl("https://www.youtube.com/watch?v=kqtD5dpn9C8"); }}
                    >
                      <span className="s-icon">🐍</span>
                      <div className="s-meta">
                        <strong>Python Masterclass</strong>
                        <span>Mosh Hamedani · 1:04:20 timestamp</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="sample-card-item"
                      onClick={() => { setLink("https://www.youtube.com/watch?v=SqcY0GlETPk"); void startWithUrl("https://www.youtube.com/watch?v=SqcY0GlETPk"); }}
                    >
                      <span className="s-icon">⚛️</span>
                      <div className="s-meta">
                        <strong>React &amp; Next.js</strong>
                        <span>Components, hooks &amp; state</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="sample-card-item"
                      onClick={() => { setLink("https://www.youtube.com/watch?v=BpPEoQ4j6CE"); void startWithUrl("https://www.youtube.com/watch?v=BpPEoQ4j6CE"); }}
                    >
                      <span className="s-icon">🦀</span>
                      <div className="s-meta">
                        <strong>Rust Crash Course</strong>
                        <span>Systems &amp; concurrency</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="dock-capabilities-row">
                  <div className="cap-item"><span className="cap-check">✓</span><span>Auto-seek video sync</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Interactive timestamp jump</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Full-resolution code OCR</span></div>
                </div>

                <div className="dock-specs-footer">
                  <span>● Synchronized Video &amp; Text</span>
                  <span>● Speed 1x / 1.5x / 2x</span>
                  <span>● Jump to Code Timestamp</span>
                </div>
              </div>
            )}

            {sourceMode === "file" && (
              <div className="dock-panel">
                <div
                  className={`dock-dropzone ${over ? "drag-over" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => { e.preventDefault(); setOver(false); startFile(e.dataTransfer.files[0]); }}
                >
                  <div className="dropzone-inner">
                    <span className="drop-art">⤓</span>
                    <div className="dropzone-text-block">
                      <strong>Drag and drop a screen recording here</strong>
                      <span className="drop-sub">Supported formats: .mp4, .webm, .mov (up to 4K)</span>
                    </div>
                    <button className="btn-browse-file" type="button" onClick={() => fileRef.current?.click()}>
                      📁 Browse Computer Files
                    </button>
                    <input ref={fileRef} type="file" accept="video/*" hidden aria-label="Video file" onChange={(e) => startFile(e.target.files?.[0])} />
                  </div>
                </div>

                <div className="dock-capabilities-row">
                  <div className="cap-item"><span className="cap-check">✓</span><span>Hardware MP4 / WebM / MOV decode</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Instant offline scrubbing</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Files stay on local device</span></div>
                </div>

                <div className="dock-specs-footer">
                  <span>● Frame-by-Frame Decoding</span>
                  <span>● Offline Timeline Scrubbing</span>
                  <span>● Zero Upload Required</span>
                </div>
              </div>
            )}

            {sourceMode === "mac" && (
              <div className="dock-panel">
                <div className="dock-row-spaced">
                  <div className="dock-text">
                    <strong>Apple Silicon Vision Framework</strong>
                    <span>Native Swift ScreenCaptureKit binary running directly on the Apple Neural Engine.</span>
                  </div>
                  <div className="cli-badge" onClick={copyCliCmd} title="Click to copy">
                    <code>./capture-mac/scrollback --relay http://localhost:8787</code>
                    <span className="copy-hint">Copy 📋</span>
                  </div>
                </div>

                <div className="cli-steps-box">
                  <div className="cli-step-row">
                    <span className="c-step-num">1</span>
                    <span>Start local relay server: <code>node relay/dev-server.mjs</code></span>
                  </div>
                  <div className="cli-step-row">
                    <span className="c-step-num">2</span>
                    <span>Run native capture binary with ScreenCaptureKit permissions</span>
                  </div>
                  <div className="cli-step-row">
                    <span className="c-step-num">3</span>
                    <span>Frames stream with 50ms latency directly into this browser reader</span>
                  </div>
                </div>

                <div className="dock-capabilities-row">
                  <div className="cap-item"><span className="cap-check">✓</span><span>Apple Silicon M-series optimized</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>ScreenCaptureKit frame pipeline</span></div>
                  <div className="cap-item"><span className="cap-check">✓</span><span>Pipes direct to editor / stdout</span></div>
                </div>

                <div className="dock-specs-footer">
                  <span>● Sub-50ms Latency</span>
                  <span>● Apple Neural Engine</span>
                  <span>● Native Retina Resolution</span>
                </div>
              </div>
            )}

            {err.yt && <p className="dock-error">{err.yt}</p>}
            {err.tab && <p className="dock-error">{err.tab}</p>}
            {err.file && <p className="dock-error">{err.file}</p>}
          </div>
        </div>
      </div>

      {/* Bottom Bento Row: 3 Modular Cards */}
      <div className="bento-row bento-row-bottom">
        <div className="bento-card bento-feat">
          <div className="bento-feat-header">
            <span className="bento-icon">🎯</span>
            <span className="bento-feat-tag">PRECISION</span>
          </div>
          <h3>Pixel-Aligned Selection</h3>
          <p>Text spans map directly over the video frame. Drag to select, highlight variables, or copy specific lines just like in your code editor.</p>
          <div className="feat-micro-visual feat-visual-selection">
            <div className="visual-code-line"><span className="v-tag">&lt;div</span> className=<span className="v-val">&quot;editor&quot;</span>&gt;</div>
            <div className="visual-code-line v-highlighted"><span className="v-sel">&nbsp; const [data, setData] = useState(); &nbsp;</span></div>
            <div className="visual-code-line">&lt;/div&gt;</div>
          </div>
        </div>

        <div className="bento-card bento-feat">
          <div className="bento-feat-header">
            <span className="bento-icon">📋</span>
            <span className="bento-feat-tag">1-CLICK</span>
          </div>
          <h3>Complete Indented Copy</h3>
          <p>A single &ldquo;Copy code&rdquo; button at the top grabs all lines with clean python/js indentation preserved. No fragmented snippets.</p>
          <div className="feat-micro-visual feat-visual-copy">
            <div className="visual-copy-header">
              <span className="v-file">script.py</span>
              <span className="v-btn-copy">✓ Copied 4 lines</span>
            </div>
            <div className="visual-code-line"><span className="v-kw">def</span> <span className="v-fn">main</span>():</div>
            <div className="visual-code-line">&nbsp;&nbsp;&nbsp;&nbsp;result = compute_values()</div>
          </div>
        </div>

        <div className="bento-card bento-feat">
          <div className="bento-feat-header">
            <span className="bento-icon">🔍</span>
            <span className="bento-feat-tag">HISTORY</span>
          </div>
          <h3>⌘F Search &amp; Timeline Scrub</h3>
          <p>Scrub backward in time to inspect earlier code without losing current video playback. Press ⌘F to instantly jump to matching syntax.</p>
          <div className="feat-micro-visual feat-visual-scrub">
            <div className="v-timeline-bar">
              <span className="v-time">00:12</span>
              <div className="v-track"><div className="v-thumb" style={{ left: "60%" }} /></div>
              <span className="v-time">02:45</span>
            </div>
            <div className="v-search-pill">
              <span>⌘F &quot;compute_values&quot;</span>
              <span className="v-match-count">1 of 3</span>
            </div>
          </div>
        </div>
      </div>

      {/* Clean, Understated Footer */}
      <footer className="bento-footer">
        <span>Engine: Tesseract.js (WASM) &nbsp;•&nbsp; License: MIT &nbsp;•&nbsp; Copyright © 2026 Dhvani Dave</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- reader
function ReaderView({ session, onLeave, toast }: { session: Session; onLeave: () => void; toast: (m: string) => void }) {
  const { reader } = session;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [viewId, setViewId] = useState<number | null>(null); // null = follow the newest frame
  const [ytErr, setYtErr] = useState("");
  const [sharing, setSharing] = useState(session.kind !== "youtube");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const stopShare = useRef<(() => void) | null>(null);
  useEffect(() => reader.subscribe(bump), [reader]);

  const frames = reader.frames;
  const idx = viewId === null ? frames.length - 1 : Math.max(0, frames.findIndex((f) => f.id === viewId));
  const frame = frames[idx];
  const following = viewId === null;
  const go = useCallback((i: number) => {
    const n = reader.frames.length; if (!n) return;
    const c = Math.max(0, Math.min(n - 1, i));
    setViewId(c === n - 1 ? null : reader.frames[c].id);
  }, [reader]);

  const matchingIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const res: number[] = [];
    frames.forEach((f, i) => {
      if (frameText(f).toLowerCase().includes(q)) {
        res.push(i);
      }
    });
    return res;
  }, [frames, searchQuery]);

  const matchIndexInList = matchingIndices.indexOf(idx);

  const nextMatch = () => {
    if (matchingIndices.length === 0) return;
    const next = matchingIndices.find((i) => i > idx);
    if (next !== undefined) go(next);
    else go(matchingIndices[0]);
  };

  const prevMatch = () => {
    if (matchingIndices.length === 0) return;
    const prev = [...matchingIndices].reverse().find((i) => i < idx);
    if (prev !== undefined) go(prev);
    else go(matchingIndices[matchingIndices.length - 1]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx]);

  const yt = session.yt;
  const ytCmd = (func: string, args: unknown[] = []) =>
    iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");

  const readEmbed = async () => {
    setYtErr("");
    try {
      const stop = await shareTab(reader, {
        preferCurrentTab: true,
        crop: (vw, vh) => {
          const el = iframe.current;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (!r || r.width <= 40 || r.height <= 40) return null;
          if (r.bottom <= 20 || r.top >= window.innerHeight - 20) return null;
          const kx = vw / window.innerWidth;
          const ky = vh / window.innerHeight;
          const x = Math.max(0, r.left * kx);
          const y = Math.max(0, r.top * ky);
          const w = Math.min(vw - x, r.width * kx);
          const h = Math.min(vh - y, r.height * ky);
          return w > 40 && h > 40 ? { x, y, w, h } : null;
        },
        onEnded: () => { setSharing(false); reader.stop(); },
      });
      stopShare.current = stop; session.stop = stop; setSharing(true);
      ytCmd("playVideo");
    } catch (e) {
      const isCancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "InvalidStateError" || e.message.toLowerCase().includes("invalid state"));
      setYtErr(isCancelled ? "Sharing was cancelled — choose “This tab” and press Share." : (e as Error).message);
    }
  };

  const [layoutMode, setLayoutMode] = useState<"single" | "split">("single");

  const status = reader.error ? reader.error
    : session.kind === "recording" ? (session.done ? "Finished" : `Reading ${session.progress?.done ?? 0}/${session.progress?.total ?? "…"}`)
      : sharing ? (reader.inFlight ? "Reading…" : "Watching") : "Stopped";

  const copyAll = async () => {
    if (!frame) return;
    try { await navigator.clipboard.writeText(frameText(frame)); toast("Copied all text on this screen"); }
    catch { toast("Clipboard blocked — select the text instead"); }
  };

  return (
    <div className={`reader ${yt ? "with-yt" : ""} ${yt && layoutMode === "single" ? "single-mode" : ""}`}>
      <div className="bar">
        <span className="title">{session.label}</span>
        <span className={"pill" + (sharing && session.kind !== "recording" ? " live" : "")} aria-live="polite">{status}</span>

        {/* Search across historical frames */}
        <div className="reader-search" title="Search code across all frames (⌘F)">
          <svg className="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search code (⌘F)..."
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setSearchQuery(val);
              const q = val.trim().toLowerCase();
              if (q) {
                const hit = frames.findIndex((f) => frameText(f).toLowerCase().includes(q));
                if (hit !== -1 && hit !== idx) go(hit);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) prevMatch();
                else nextMatch();
              } else if (e.key === "Escape") {
                setSearchQuery("");
                searchInputRef.current?.blur();
              }
            }}
          />
          {searchQuery && (
            <div className="search-controls">
              <span className="search-badge">
                {matchingIndices.length > 0
                  ? `${matchIndexInList !== -1 ? matchIndexInList + 1 : "–"}/${matchingIndices.length}`
                  : "0"}
              </span>
              <button type="button" className="btn-search-nav" onClick={prevMatch} title="Previous matching screen" disabled={matchingIndices.length <= 1}>↑</button>
              <button type="button" className="btn-search-nav" onClick={nextMatch} title="Next matching screen" disabled={matchingIndices.length <= 1}>↓</button>
              <button type="button" className="btn-search-nav btn-clear-search" onClick={() => setSearchQuery("")} title="Clear search">✕</button>
            </div>
          )}
        </div>

        {yt && (
          <>
            {!sharing ? (
              <button className="btn hi" onClick={readEmbed}>⚡ Start Reading Video</button>
            ) : (
              <>
                <button className="btn ghost" onClick={() => ytCmd("pauseVideo")} title="Pause video">⏸ Pause</button>
                <button className="btn ghost" onClick={() => ytCmd("playVideo")} title="Play video">▶ Play</button>
              </>
            )}
            <button className="btn ghost" onClick={() => setLayoutMode(layoutMode === "single" ? "split" : "single")}>
              {layoutMode === "single" ? "◫ Side-by-side" : "⬇ Stacked View"}
            </button>
          </>
        )}
        <button className="btn ghost" onClick={copyAll} disabled={!frame} id="copyAll">Copy all text</button>
        <button className="btn ghost" onClick={onLeave} id="leave">{sharing || session.kind === "recording" ? "Stop and close" : "Close"}</button>
      </div>

      <div className={yt ? "yt-layout" : "single-layout"}>
        {yt && (
          <div className="yt-pane">
            <div className="pane-header">
              <span className="pane-tag">📺 1. Original Video Player</span>
              <span className="pane-hint">Play or pause your tutorial here</span>
            </div>
            <div className="yt">
              <iframe
                ref={iframe} title="YouTube player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                src={`https://www.youtube-nocookie.com/embed/${yt.id}?enablejsapi=1&rel=0&playsinline=1&start=${yt.start}`} />
            </div>
            <div className="row yt-controls">
              {!sharing
                ? <button className="btn hi" onClick={readEmbed}>⚡ Start reading this video</button>
                : <span className="fine">Reading video. Pause on code for cleanest copy.</span>}
              {[1, 1.5, 2].map((r) => <button key={r} className="btn ghost" onClick={() => ytCmd("setPlaybackRate", [r])}>{r}×</button>)}
              <a className="fine" href={`https://www.youtube.com/watch?v=${yt.id}`} target="_blank" rel="noopener noreferrer">Embedding blocked? Open on YouTube & Share a tab.</a>
            </div>
            {ytErr && <p className="err">{ytErr}</p>}
          </div>
        )}

        <div className="stage">
          {yt && (
            <div className="pane-header">
              <span className="pane-tag">⚡ 2. Extracted Code Reader</span>
              <span className="pane-hint">Click &quot;Copy code&quot; or drag to select</span>
            </div>
          )}
          {frame
            ? <FrameView frame={frame} searchQuery={searchQuery} onToast={toast} />
            : (
              <div className="screen empty">
                {!sharing && yt ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                    <p style={{ margin: 0, fontSize: 16, color: "#fff", fontWeight: 650 }}>Ready to extract code from this video</p>
                    <button className="btn hi" onClick={readEmbed} style={{ fontSize: 14.5, padding: "10px 22px" }}>
                      ⚡ Start Reading Video
                    </button>
                    <span className="fine" style={{ maxWidth: 420 }}>Click above and choose &ldquo;This tab&rdquo; to begin scanning video frames for code.</span>
                  </div>
                ) : (
                  <div>
                    <div className="spinner" />
                    <span>{sharing || session.kind === "recording" ? "Reading the first screen… the OCR model loads once, then it's quick." : "No code frames captured yet."}</span>
                  </div>
                )}
              </div>
            )}
          <div className="timeline">
            <button className="btn ghost" onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label="Previous screen">Back</button>
            <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={Math.max(0, idx)} disabled={frames.length < 2}
              onChange={(e) => go(Number(e.target.value))} aria-label="Timeline" />
            <button className="btn ghost" onClick={() => go(idx + 1)} disabled={idx >= frames.length - 1} aria-label="Next screen">Next</button>
            <span className="t">{frame ? clock(frame.ts) : "0:00"} · {frames.length} screen{frames.length === 1 ? "" : "s"}</span>
            {!following && <button className="btn hi" onClick={() => setViewId(null)}>Jump to latest</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
