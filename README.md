# Scrollback ⚡

> **Turn any screen video, live stream, or presentation into clean, selectable, searchable code.**

[![Live Demo](https://img.shields.io/badge/Live_Demo-scrollback1.vercel.app-14b8a6?style=for-the-badge&logo=vercel)](https://scrollback1.vercel.app/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.1.1-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

🌐 **Live Demo:** [https://scrollback1.vercel.app/](https://scrollback1.vercel.app/)

![Scrollback Developer Workbench](docs/screenshots/workbench-preview.png)

Viewers open a link in their browser and can highlight, copy code blocks with preserved indentation, click links, and scrub backwards through video history while the presentation continues — then jump back to live.

---

## ⚡ Key Highlights

- **📝 Clean Code View**: Toggle between the visual video canvas and a distraction-free dark code editor view with standard text selection and unified **1-Click `Copy code`**.
- **▥ Dual Viewport Layouts**: Switch instantly between **Side-by-Side View** (50/50 parallel video & code) and **Stacked View** (full-width stacked reader) depending on your screen size.
- **🔍 Timeline Scrubbing & ⌘F Search**: Scrub backward through past video history without interrupting playback, or press `⌘F` to search keywords, function names, and syntax across all frames.
- **🚀 Multi-Source Ingestion**:
  - **Live Chrome Tab / Window**: Capture coding streams or webinars at 60 FPS with adaptive change detection.
  - **YouTube Tutorials**: Paste any tutorial URL to stream video with synchronized code extraction.
  - **Video Files**: Drag-and-drop `.mp4` or `.webm` recordings for rapid offline scanning.
  - **Mac CLI (`capture-mac`)**: Native ScreenCaptureKit streaming with Apple Vision OCR and zero-knowledge encryption.
- **🔒 100% Private & Client-Side**: OCR runs entirely inside your browser via Tesseract.js (WebAssembly). No screen recordings or OCR text ever leave your machine.

| 📺 Side-by-Side YouTube Reader | 📝 Clean Code View (1-Click Copy) |
| :---: | :---: |
| ![YouTube Video & Code Reader](docs/screenshots/youtube-reader.png) | ![Clean Code Text View](docs/screenshots/code-view.png) |

---

## 🚧 Feature Roadmap

| Feature | Status | Description |
| :--- | :---: | :--- |
| **YouTube Playlist Batch Extractor** | 🟡 *In Progress* | Automatically queue, scan, and export code chapters across complete multi-video tutorial series. |
| **One-Click Full Tutorial Export** | 🟢 *Planned* | Download all detected unique snippets from a full video session into a clean `.md` or `.py` / `.ts` archive. |
| **Multi-Language Syntax Highlighting** | 🟢 *Live* | Automatic token detection for Python, TypeScript, JavaScript, Rust, Go, HTML, and Shell scripts. |
| **Encrypted Presenter Relay** | 🟢 *Live* | Zero-knowledge `AES-256-GCM` live screen sharing via WebSocket relay. |

---

## 🏗️ Architecture

```
                      ┌────────────────────────────────────────┐
                      │            Browser Client              │
                      │  Next.js 16 + React 19 + Tesseract.js  │
                      └──────────────────┬─────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
  [Share Chrome Tab]              [YouTube Stream]              [Local Video File]
  MediaStream API +               No-cookie embed +             HTML5 Video +
  Canvas change detection         tab share crop                Local WASM OCR
                                         ▲
                                         │ (WebSocket encrypted frames)
                      ┌──────────────────┴─────────────────────┐
                      │              Relay Server              │
                      │  Node.js (dev) / Cloudflare Workers DO │
                      │  - In-memory circular buffer           │
                      │  - Automatic idle session cleanup      │
                      │  - Zero-knowledge encrypted relay      │
                      └──────────────────▲─────────────────────┘
                                         │
                      ┌──────────────────┴─────────────────────┐
                      │           Mac Native CLI               │
                      │  ScreenCaptureKit + Apple Vision OCR   │
                      │  AES-256-GCM Zero-Knowledge Encryption │
                      └────────────────────────────────────────┘
```

---

## 🚀 Quickstart

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Web Studio (Browser App)
```bash
# Clone the repository
git clone https://github.com/dhvani7014/scrollback.git
cd scrollback/web

# Install dependencies and start development server
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to launch the Scrollback Studio.

### 2. Relay Server (Optional for Multi-user Presenter Streaming)
```bash
cd relay
npm install
npm run dev
```
Runs on `http://localhost:8787` with WebSocket endpoint `/ws/:sessionId`.

### 3. Mac Native Presenter CLI (macOS 13+)
```bash
cd capture-mac
./build.sh
./scrollback --relay http://localhost:8787
```
This prints a secure viewer link with an embedded decryption key in the `#fragment`:
```
Viewer link: http://localhost:8787/s/<session-id>#k=<encryption-key>
```
*Note: The encryption key exists only in the URL hash fragment and is never transmitted to the relay server.*

---

## 🧪 Testing

Scrollback includes comprehensive automated test suites covering unit logic, WebSocket relay protocols, session lifecycle, and browser OCR pipelines:

```bash
# 1. Run web unit tests
cd web && npm run test:unit

# 2. Run web production build validation
cd web && npm run build

# 3. Run relay protocol & security tests
node tools/relay_test.mjs http://localhost:8787

# 4. Run session memory & idle eviction lifecycle tests
node tools/session_lifecycle_test.mjs
```

---

## 🔒 Security & Privacy Model

- **Zero-Knowledge Architecture**: The Mac capture tool encrypts all screen frames using `AES-256-GCM` before sending them to the relay. The encryption key is appended only in the URL `#fragment`, ensuring neither the relay nor intermediate proxies can read the screen content.
- **Client-Side WASM OCR**: Browser tab sharing and video file processing execute completely inside client memory via WebAssembly. No video data or OCR text is sent to third-party APIs.
- **Presenter Token Enforcement**: Presenter WebSocket connections enforce cryptographic token checks (minimum 16 chars) to prevent unauthorized takeovers.
- **Automatic Resource Eviction**: Disconnected and idle relay sessions automatically clean up frame buffers after a 10-minute grace period to prevent memory leaks.

---

## 📚 Documentation

For in-depth guides, visit the documentation sections built into the web app:
- **Getting Started**: Quick tour of tab sharing, YouTube extraction, and Mac CLI.
- **Tools Reference**: Breakdown of OCR engines, change detection thresholds, and keyboard shortcuts (`⌘F`, `Arrow keys`).
- **Self-Hosting Guide**: Docker, Node.js systemd, and Cloudflare Workers deployment instructions.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
