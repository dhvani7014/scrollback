"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import FrameView from "./FrameView";
import demo from "@/lib/demo-lines.json";
import { TesseractEngine } from "@/lib/ocr";
import { Reader } from "@/lib/pipeline";
import { readRecording, shareTab, type Progress } from "@/lib/sources";
import { frameText } from "@/lib/textlayer";
import type { Frame } from "@/lib/types";
import { parseYouTube, type YouTubeRef } from "@/lib/youtube";

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
          <div className="brand"><i /> Scrollback</div>
          <small>Your video never leaves this browser</small>
        </header>
        {session ? <ReaderView key={session.id} session={session} onLeave={leave} toast={toast} />
          : <Home begin={begin} toast={toast} />}
      </div>
      <div className={"toast" + (toastOn ? " show" : "")} role="status">{toastMsg}</div>
    </>
  );
}

// ---------------------------------------------------------------- home
function Home({ begin, toast }: { begin: (s: Session) => void; toast: (m: string) => void }) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState<{ [k: string]: string }>({});
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fail = (k: string, m: string) => setErr((e) => ({ ...e, [k]: m }));

  const makeReader = (latestOnly: boolean) => new Reader(new TesseractEngine(), { latestOnly, concurrency: latestOnly ? 1 : 2 });

  const startYouTube = (e: React.FormEvent) => {
    e.preventDefault();
    const yt = parseYouTube(link);
    if (!yt) return fail("yt", "That doesn't look like a YouTube link.");
    setErr({});
    const reader = makeReader(true);
    begin({ id: nextSession++, kind: "youtube", label: `YouTube · ${yt.id}`, reader, stop: () => {}, yt });
  };

  const startTab = async () => {
    setErr({});
    const reader = makeReader(true);
    try {
      const stop = await shareTab(reader, { onEnded: () => reader.stop() });
      begin({ id: nextSession++, kind: "tab", label: "Shared tab", reader, stop });
    } catch (e) {
      void reader.dispose();
      fail("tab", e instanceof DOMException && e.name === "NotAllowedError" ? "Sharing was cancelled — choose a tab and press Share." : (e as Error).message);
    }
  };

  const startFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) return fail("file", "That isn't a video file.");
    setErr({});
    const reader = makeReader(false);
    const ac = new AbortController();
    const s: Session = { id: nextSession++, kind: "recording", label: file.name, reader, stop: () => ac.abort() };
    begin(s);
    readRecording(file, reader, ac.signal, (p) => { s.progress = p; reader.notify(); })
      .then(() => { s.done = true; reader.notify(); })
      .catch((e: Error) => { reader.error = e.message; reader.notify(); });
  };

  return (
    <>
      <section className="hero">
        <div>
          <h1>Copy the code from <mark>any video</mark> or screen share.</h1>
          <p>Paste a YouTube link, share a call, or drop a recording. Scrollback reads the screen, so the text becomes selectable, links become clickable, and you can scroll back to what you missed.</p>
          <p className="fine">Works in Chrome and Edge on a computer. Reading happens in your browser.</p>
        </div>
        <div className="demo" aria-label="Sample frame with selectable code">
          <FrameView frame={demoFrame} onToast={toast}>
            <div className="sweep" aria-hidden />
            <div className="demo-note">Try selecting the code</div>
          </FrameView>
        </div>
      </section>

      <section className="sources">
        <form className="card" onSubmit={startYouTube}>
          <h2>A YouTube video</h2>
          <p>Paste the link. The video plays here and Scrollback reads it as it plays; you&apos;ll pick &ldquo;This tab&rdquo; once so the browser can see it.</p>
          <div className="row">
            <input className="in" aria-label="YouTube link" placeholder="youtube.com/watch?v=…" value={link} onChange={(e) => setLink(e.target.value)} />
            <button className="btn hi" type="submit">Read video</button>
          </div>
          {err.yt && <p className="err">{err.yt}</p>}
        </form>

        <div className="card">
          <h2>A call or another tab</h2>
          <p>Meet, Zoom, Teams or a YouTube tab you already have open: share that tab and Scrollback reads it live. Join the call as usual, then pick its tab.</p>
          <div className="row"><button className="btn" onClick={startTab}>Share a tab</button></div>
          {err.tab && <p className="err">{err.tab}</p>}
        </div>

        <div
          className={"card"} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); startFile(e.dataTransfer.files[0]); }}>
          <h2>A recording</h2>
          <p>Screen recordings, lecture captures, downloaded videos. The file is read here and never uploaded.</p>
          <div className={"drop" + (over ? " over" : "")}>
            Drop a video file, or{" "}
            <button className="btn ghost" type="button" onClick={() => fileRef.current?.click()}>choose one</button>
            <input ref={fileRef} type="file" accept="video/*" hidden aria-label="Video file" onChange={(e) => startFile(e.target.files?.[0])} />
          </div>
          {err.file && <p className="err">{err.file}</p>}
        </div>

        <div className="card">
          <h2>Present live from your Mac</h2>
          <p>Teaching or presenting? Run the Mac app and send viewers a link; they see an exact, selectable copy of your screen as you talk.</p>
          <pre className="cmd">cd capture-mac &amp;&amp; ./build.sh{"\n"}./scrollback --relay https://your-relay.example</pre>
        </div>
      </section>
      <p className="foot">Text is read with OCR, so a character can occasionally be wrong — check code before you run it.</p>
    </>
  );
}

// ---------------------------------------------------------------- reader
function ReaderView({ session, onLeave, toast }: { session: Session; onLeave: () => void; toast: (m: string) => void }) {
  const { reader } = session;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [viewId, setViewId] = useState<number | null>(null); // null = follow the newest frame
  const [ytErr, setYtErr] = useState("");
  const [sharing, setSharing] = useState(session.kind !== "youtube");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      setYtErr(e instanceof DOMException && e.name === "NotAllowedError" ? "Sharing was cancelled — choose “This tab” and press Share." : (e as Error).message);
    }
  };

  const status = reader.error ? reader.error
    : session.kind === "recording" ? (session.done ? "Finished" : `Reading ${session.progress?.done ?? 0}/${session.progress?.total ?? "…"}`)
    : sharing ? (reader.inFlight ? "Reading…" : "Watching") : "Stopped";

  const copyAll = async () => {
    if (!frame) return;
    try { await navigator.clipboard.writeText(frameText(frame)); toast("Copied all text on this screen"); }
    catch { toast("Clipboard blocked — select the text instead"); }
  };

  return (
    <div className={`reader ${yt ? "with-yt" : ""}`}>
      <div className="bar">
        <span className="title">{session.label}</span>
        <span className={"pill" + (sharing && session.kind !== "recording" ? " live" : "")} aria-live="polite">{status}</span>
        <button className="btn ghost" onClick={copyAll} disabled={!frame} id="copyAll">Copy all text</button>
        <button className="btn ghost" onClick={onLeave} id="leave">{sharing || session.kind === "recording" ? "Stop and close" : "Close"}</button>
      </div>

      <div className={yt ? "yt-layout" : "single-layout"}>
        {yt && (
          <div className="yt-pane">
            <div className="yt">
              <iframe
                ref={iframe} title="YouTube player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                src={`https://www.youtube-nocookie.com/embed/${yt.id}?enablejsapi=1&rel=0&playsinline=1&start=${yt.start}`} />
            </div>
            <div className="row yt-controls">
              {!sharing
                ? <button className="btn hi" onClick={readEmbed}>Start reading this video</button>
                : <span className="fine">Reading video above. Pause on code for cleanest copy.</span>}
              {[1, 1.5, 2].map((r) => <button key={r} className="btn ghost" onClick={() => ytCmd("setPlaybackRate", [r])}>{r}×</button>)}
              <a className="fine" href={`https://www.youtube.com/watch?v=${yt.id}`} target="_blank" rel="noopener noreferrer">Embedding blocked? Open on YouTube & Share a tab.</a>
            </div>
            {ytErr && <p className="err">{ytErr}</p>}
          </div>
        )}

        <div className="stage">
          {frame
            ? <FrameView frame={frame} onToast={toast} />
            : <div className="screen empty"><div><div className="spinner" />{sharing || session.kind === "recording" ? "Reading the first screen… the OCR model loads once, then it's quick." : "Nothing read yet."}</div></div>}
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
