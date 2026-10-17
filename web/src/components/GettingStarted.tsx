"use client";

export default function GettingStarted({ onLaunch }: { onLaunch: () => void }) {
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText("./capture-mac/scrollback --relay http://localhost:8787");
    } catch {
      // ignore
    }
  };

  return (
    <div className="doc-page">
      {/* Doc Header */}
      <div className="doc-header">
        <div className="doc-badge">GUIDE &amp; WALKTHROUGH</div>
        <h1 className="doc-title">Getting Started with Scrollback</h1>
        <p className="doc-subtitle">
          Turn any video tutorial, live conference presentation, Zoom meeting, or screen recording into real-time selectable, copyable code.
        </p>
      </div>

      {/* 3-Step Visual Bento Guide */}
      <div className="doc-section-title">
        <span>CORE WORKFLOW</span>
        <h2>Three Simple Steps to Live Code</h2>
      </div>

      <div className="doc-bento-grid">
        <div className="doc-bento-card">
          <div className="doc-step-num">01</div>
          <div className="doc-card-icon">⎘</div>
          <h3>Select Your Input Source</h3>
          <p>
            Choose how you want to feed video into Scrollback. Share any active Chrome tab (YouTube, Zoom, Twitch, or PDF), paste a YouTube URL, or drag &amp; drop an .mp4 screen recording.
          </p>
          <div className="doc-card-mini-box">
            <div className="mini-source-chip active">⎘ Chrome Tab</div>
            <div className="mini-source-chip">▶ YouTube</div>
            <div className="mini-source-chip">📁 Video File</div>
          </div>
        </div>

        <div className="doc-bento-card">
          <div className="doc-step-num">02</div>
          <div className="doc-card-icon">⚡</div>
          <h3>Local Neural OCR Processing</h3>
          <p>
            Scrollback continuously samples frames, automatically filtering out duplicates. It detects code layout, character pitch, and separates line gutters from source syntax.
          </p>
          <div className="doc-card-mini-box">
            <div className="mini-ocr-row">
              <span className="ocr-pill">WASM Tesseract</span>
              <span className="ocr-arr">→</span>
              <span className="ocr-pill">Pitch Clustering</span>
              <span className="ocr-arr">→</span>
              <span className="ocr-pill">Gutter Stripped</span>
            </div>
          </div>
        </div>

        <div className="doc-bento-card">
          <div className="doc-step-num">03</div>
          <div className="doc-card-icon">📋</div>
          <h3>Copy, Select &amp; Scrub History</h3>
          <p>
            Click &ldquo;Copy code&rdquo; to grab the entire indented source file in one click, highlight arbitrary lines with your cursor, or use the bottom scrubber to rewind to earlier frames.
          </p>
          <div className="doc-card-mini-box">
            <div className="mini-code-action">
              <span className="action-tag">✓ One-Click Copy</span>
              <span className="action-tag">⌘F Instant Search</span>
            </div>
          </div>
        </div>
      </div>

      {/* Popular Scenarios */}
      <div className="doc-section-title">
        <span>USE CASES</span>
        <h2>Popular Developer Scenarios</h2>
      </div>

      <div className="doc-workflows-grid">
        <div className="doc-workflow-card">
          <div className="wf-icon-box">🐍</div>
          <div>
            <h4>YouTube &amp; Twitch Coding Tutorials</h4>
            <p>
              Watch 2-hour long coding deep dives at 1.5× speed without constantly pausing to manually retype complex boilerplate or functions. Scrollback extracts exact indented blocks with verified whitespace.
            </p>
          </div>
        </div>

        <div className="doc-workflow-card">
          <div className="wf-icon-box">💼</div>
          <div>
            <h4>Live Meetings &amp; Architecture Reviews</h4>
            <p>
              Sitting in a Zoom, Google Meet, or Teams technical review? Share the call tab and copy architecture snippets, database schemas, and terminal logs while the presenter continues speaking.
            </p>
          </div>
        </div>

        <div className="doc-workflow-card">
          <div className="wf-icon-box">📄</div>
          <div>
            <h4>Locked PDFs &amp; Presentation Slides</h4>
            <p>
              Encountered slides or documentation where text cannot be highlighted? Drop the file or screen share into Scrollback to instantly overlay a pixel-aligned selectable text layer.
            </p>
          </div>
        </div>

        <div className="doc-workflow-card">
          <div className="wf-icon-box">⚡</div>
          <div>
            <h4>macOS Native Neural Engine (50ms)</h4>
            <p>
              For broadcasters and high-frame-rate streams, run the native macOS Swift binary. It leverages Apple Silicon ScreenCaptureKit and the Vision Framework directly on the Neural Engine.
            </p>
          </div>
        </div>
      </div>

      {/* macOS CLI Setup */}
      <div className="doc-terminal-section">
        <div className="terminal-header">
          <div className="term-dots">
            <span className="term-dot red" />
            <span className="term-dot yellow" />
            <span className="term-dot green" />
          </div>
          <span className="term-title">macOS ScreenCaptureKit Binary</span>
          <button type="button" className="term-copy-btn" onClick={copyCmd}>
            Copy Command 📋
          </button>
        </div>
        <div className="term-body">
          <code>./capture-mac/scrollback --relay http://localhost:8787</code>
        </div>
        <p className="term-hint">
          Connects directly to the local WebSocket relay server with 50ms OCR latency running on hardware cores.
        </p>
      </div>

      {/* Keyboard Shortcuts Cheatsheet */}
      <div className="doc-section-title">
        <span>SHORTCUTS</span>
        <h2>Keyboard &amp; Navigation Controls</h2>
      </div>

      <div className="shortcuts-table">
        <div className="sc-row sc-head">
          <span>Action</span>
          <span>Shortcut / Trigger</span>
          <span>Description</span>
        </div>
        <div className="sc-row">
          <span className="sc-name">Search Code</span>
          <span className="sc-key"><kbd>⌘</kbd> + <kbd>F</kbd> / <kbd>Ctrl</kbd> + <kbd>F</kbd></span>
          <span className="sc-desc">Instantly focus search bar and jump to matching text lines</span>
        </div>
        <div className="sc-row">
          <span className="sc-name">Copy Complete Code</span>
          <span className="sc-key"><kbd>Click &ldquo;Copy code&rdquo;</kbd></span>
          <span className="sc-desc">Copies the entire source code file with preserved indentation</span>
        </div>
        <div className="sc-row">
          <span className="sc-name">Timeline Scrub</span>
          <span className="sc-key"><kbd>←</kbd> / <kbd>→</kbd> Arrow Keys</span>
          <span className="sc-desc">Step backward or forward through captured video screens</span>
        </div>
        <div className="sc-row">
          <span className="sc-name">Jump to Live</span>
          <span className="sc-key"><kbd>Click &ldquo;Jump to latest&rdquo;</kbd></span>
          <span className="sc-desc">Resume following newest incoming video frames</span>
        </div>
      </div>

      {/* Call to action */}
      <div className="doc-cta-banner">
        <div>
          <h3>Ready to turn screen pixels into code?</h3>
          <p>Launch the studio workbench to share your tab or paste a video link.</p>
        </div>
        <button type="button" className="btn-teal-action" onClick={onLaunch}>
          Open Studio &amp; Start Reading →
        </button>
      </div>
    </div>
  );
}
