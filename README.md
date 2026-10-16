# Scrollback

A live, scrollable, **selectable** copy of a presenter's screen. Viewers open a link and can
copy text and code, click URLs, and scroll back through what was shown while the presenter
keeps going — then tap **Jump to live**.

```
 your Mac                         relay                          viewers
┌──────────────────┐  encrypted  ┌───────────────────┐  encrypted ┌───────────────────┐
│ capture-mac      │ ──────────▶ │ Node (dev) or     │ ─────────▶ │ viewer/ (static)  │
│ ScreenCaptureKit │   frames    │ Cloudflare Durable│   frames   │ decrypts, draws   │
│ + Vision OCR     │             │ Object, 1/session │            │ image + text layer│
└──────────────────┘             └───────────────────┘            └───────────────────┘
        key lives only in the viewer link's #fragment — the relay never sees it
```

## Tested Status Matrix

| Piece | Status |
|---|---|
| `viewer/` (decrypt, text overlay, links, selection, scrollback, jump-to-live) | **Tested** in headless Chromium, 16 checks (`tools/e2e_test.py`) |
| `relay/` Node dev server | **Tested** (relay protocol + end-to-end) |
| `relay/` Cloudflare Durable Object | **Tested** locally with `wrangler dev` (same suites). Not yet deployed to a real account |
| `capture-mac/Scrollback.swift` | **Written but NOT compiled or run** — it needs a Mac. See below |

## Run it (on your Mac)

You need Node 18+ and Xcode Command Line Tools (`xcode-select --install`).

```bash
# 1. relay + viewer
cd relay && npm install && npm run dev          # http://localhost:8787

# 2. capture tool (new terminal)
cd capture-mac && ./build.sh
./scrollback --list                             # see displays / windows
./scrollback --relay http://localhost:8787      # prints your viewer link
```

First run, macOS asks for **Screen Recording** permission for your terminal app
(System Settings → Privacy & Security → Screen & System Audio Recording). Enable it, then re-run.

Open the printed link in another browser tab, or on your phone (use your laptop's LAN IP instead
of `localhost` in `--relay`). Type in a terminal or switch slides: text on the viewer is selectable.

Useful flags: `--window "Terminal"` (one window only), `--fps 3`, `--display 1`, `--jpeg-width 1200`.

### Try the viewer with no Mac at all

```bash
cd relay && npm install && npm run dev
python3 tools/make-fixtures.py          # needs Pillow; fixtures.json is already included
node tools/fake-presenter.mjs http://localhost:8787 1200   # prints a viewer link
```

### Run the tests

```bash
cd relay && npm run dev &                       # relay on :8787
node tools/relay_test.mjs http://localhost:8787
pip install playwright && playwright install chromium
python3 tools/e2e_test.py                       # RELAY=http://host:port to target another relay
```

## Deploy the relay (free Cloudflare tier is enough)

```bash
cd relay && npx wrangler login && npm run cf:deploy
./scrollback --relay https://scrollback.<your-subdomain>.workers.dev
```

The Worker also serves the viewer, so one deploy gives you everything.

## If `capture-mac` doesn't compile

It was written without a Mac toolchain, so expect at most small API-signature fixes. Paste the
compiler error to Claude and it will be a one-line change. The likeliest spots are the
ScreenCaptureKit sample-buffer attachment cast in `Capturer.stream(_:didOutputSampleBuffer:of:)`
and the optional tuple binding for `jpegData(...)`.

## How it works

- **Capture → text.** Frames come from ScreenCaptureKit; Vision OCR returns one box per text
  line. A 20×12 tile grid over a shrunken grey copy of the screen detects what changed, and only
  the changed band of rows is re-OCR'd (full re-OCR on the first frame, every 10 s, or when most
  of the screen changed). Frames are sent only when text changed or ≥3 tiles changed, so a
  blinking cursor sends nothing.
- **Encryption.** Each frame is JSON `{w,h,jpeg,lines}` sealed with AES-256-GCM
  (`nonce‖ciphertext‖tag`). The key is random per run and sits in the link's `#fragment`.
  The relay stores and forwards opaque blobs. It can see timing and sizes, not content.
- **Relay.** One session = one Durable Object (or one in-memory object in dev). It keeps the
  last 600 frames / 40 MB for late joiners and scrollback. The first presenter to connect claims
  the session with a secret token; anyone else gets `4403`.
- **Viewer.** Draws the JPEG and lays transparent, stretched text spans on top (like a PDF text
  layer), so selection boxes line up with the pixels. URLs in the text become real `<a>` links
  (http/https only).

## Known limits / next steps

1. **OCR only.** Text is recognised from pixels, so look-alike characters (`l`/`1`, `O`/`0`) can
   be wrong. Exact text via the macOS Accessibility API and the planned Chrome / VS Code
   extensions would fix this and is the highest-value next step.
2. **Not Tauri yet.** The capture tool is a standalone Swift CLI. A Tauri shell (start/stop button,
   QR code, tray icon) can wrap it later.
3. **macOS only.** Windows needs a separate capture tool (Graphics Capture + Windows.Media.Ocr).
4. **Bandwidth.** Whole-frame JPEGs; ~100–400 KB each on busy screens. Tile-delta frames would cut
   this a lot.
5. **Anyone with the full link can view.** There's no accounts or revocation yet; stop the capture
   tool to end a session.
