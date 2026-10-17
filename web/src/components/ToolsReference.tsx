"use client";

interface ToolItem {
  id: "tab" | "yt" | "file" | "mac";
  name: string;
  badge: string;
  specs: string;
  desc: string;
  icon: string;
}

export default function ToolsReference({ onSelectTool }: { onSelectTool: (tool: "tab" | "yt" | "file" | "mac") => void }) {
  const captureEngines: ToolItem[] = [
    {
      id: "tab",
      name: "Chrome Tab Stream Capture",
      badge: "WebRTC ScreenCapture",
      specs: "60 FPS • Full Retina Resolution • Zero Latency",
      desc: "Streams any active Chrome tab (YouTube, Twitch, Zoom calls, PDFs, docs) natively using WebRTC getDisplayMedia with automated deduplication (Jaccard similarity threshold >= 0.85).",
      icon: "⎘",
    },
    {
      id: "yt",
      name: "YouTube Time-Sync Reader",
      badge: "IFrame API + Player Sync",
      specs: "Synchronized Video + Text • Rate 1x/1.5x/2x",
      desc: "Synchronizes the official YouTube player with an extracted code reader side-by-side. Supports jumping to code timestamps and playback speed modification.",
      icon: "▶",
    },
    {
      id: "file",
      name: "Offline Recording Processor",
      badge: "HTML5 Canvas Decoder",
      specs: "MP4 / WebM / MOV • Frame-by-Frame OCR",
      desc: "Decodes local video files directly in the browser using HTML5 Canvas and offscreen workers. Extracts presentation code sequentially with progress feedback.",
      icon: "📁",
    },
    {
      id: "mac",
      name: "Apple Silicon Vision Framework",
      badge: "Native ScreenCaptureKit",
      specs: "Apple Neural Engine • 50ms Latency • CLI",
      desc: "High-performance native Swift binary compiled for macOS. Taps into Apple Silicon's Neural Engine and Vision framework for sub-50ms OCR throughput.",
      icon: "⚡",
    },
  ];

  const algorithms = [
    {
      name: "Anti-Bleed Column Clustering",
      tag: "Union-Find Algorithm",
      desc: "Prevents text selection from bleeding across multiple columns. Uses strict horizontal overlap (xOverlap / minW >= 0.15) and rejects cross-column bridging lines.",
      icon: "▦",
    },
    {
      name: "Smart Indentation Synthesizer",
      tag: "Pitch & Character Width",
      desc: "Measures character width medians across lines to accurately reconstruct Python 4-space and JS 2-space indentation levels that match the original code.",
      icon: "⇥",
    },
    {
      name: "Automatic Line Gutter Filter",
      tag: "Regex & Spatial Collinearity",
      desc: "Detects sequential line numbers (1, 2, 3...) in code editors and isolates them from code text, ensuring copied code is clean and executable.",
      icon: "﹟",
    },
    {
      name: "Hyperlink & URL Activator",
      tag: "Pattern Engine",
      desc: "Scans OCR text for URLs, GitHub repos, and docs links, transforming flattened image text into clickable hyperlinks.",
      icon: "🔗",
    },
  ];

  return (
    <div className="doc-page">
      {/* Header */}
      <div className="doc-header">
        <div className="doc-badge">ARCHITECTURE &amp; ENGINES</div>
        <h1 className="doc-title">Tools &amp; Capabilities Reference</h1>
        <p className="doc-subtitle">
          Explore the capture adapters, layout analysis algorithms, and neural transcription pipelines powering Scrollback.
        </p>
      </div>

      {/* Section 1: Ingestion Engines */}
      <div className="doc-section-title">
        <span>CAPTURE ENGINES</span>
        <h2>Input Sources &amp; Video Ingestion</h2>
      </div>

      <div className="tool-cards-grid">
        {captureEngines.map((tool) => (
          <div key={tool.name} className="tool-ref-card" onClick={() => onSelectTool(tool.id)}>
            <div className="tool-card-top">
              <div className="tool-icon-pill">
                <span className="tool-card-icon">{tool.icon}</span>
                <span className="tool-badge">{tool.badge}</span>
              </div>
              <button
                type="button"
                className="tool-launch-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectTool(tool.id);
                }}
              >
                Launch →
              </button>
            </div>
            <h3>{tool.name}</h3>
            <div className="tool-specs-bar">{tool.specs}</div>
            <p>{tool.desc}</p>
          </div>
        ))}
      </div>

      {/* Section 2: Layout Algorithms */}
      <div className="doc-section-title">
        <span>LAYOUT INTELLIGENCE</span>
        <h2>Text &amp; Code Processing Algorithms</h2>
      </div>

      <div className="algo-cards-grid">
        {algorithms.map((algo) => (
          <div key={algo.name} className="algo-ref-card">
            <div className="algo-card-top">
              <span className="algo-icon">{algo.icon}</span>
              <span className="algo-tag">{algo.tag}</span>
            </div>
            <h3>{algo.name}</h3>
            <p>{algo.desc}</p>
          </div>
        ))}
      </div>

      {/* Section 3: Technical Specifications Table */}
      <div className="doc-section-title">
        <span>SYSTEM ARCHITECTURE</span>
        <h2>Technical Engine Specifications</h2>
      </div>

      <div className="specs-table-wrap">
        <table className="specs-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Engine / Technology</th>
              <th>Execution Environment</th>
              <th>Key Characteristic</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Web OCR Engine</strong></td>
              <td>Tesseract.js v7 + WebAssembly</td>
              <td>Browser Web Worker</td>
              <td>Offline, zero-server compute</td>
            </tr>
            <tr>
              <td><strong>macOS Native OCR</strong></td>
              <td>Apple Vision + ScreenCaptureKit</td>
              <td>Apple Silicon Neural Engine</td>
              <td>50ms latency, 60fps streaming</td>
            </tr>
            <tr>
              <td><strong>Line Clustering</strong></td>
              <td>Disjoint-Set Union-Find</td>
              <td>Browser Main Thread</td>
              <td>Strict horizontal column bounds</td>
            </tr>
            <tr>
              <td><strong>Indentation Estimation</strong></td>
              <td>Median Character Pitch</td>
              <td>Browser Main Thread</td>
              <td>Preserves Python 4-space indent</td>
            </tr>
            <tr>
              <td><strong>Duplicate Detection</strong></td>
              <td>Jaccard String Similarity (0.85)</td>
              <td>Worker / Pipeline</td>
              <td>Only emits new frames on change</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bottom CTA */}
      <div className="doc-cta-banner">
        <div>
          <h3>Ready to start using these tools?</h3>
          <p>Choose an input source in the studio and extract selectable code in seconds.</p>
        </div>
        <button type="button" className="btn-teal-action" onClick={() => onSelectTool("tab")}>
          Open Studio Workbench →
        </button>
      </div>
    </div>
  );
}
