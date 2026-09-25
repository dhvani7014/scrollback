# Scrollback

A live, scrollable, selectable copy of a presenter's screen. Viewers open a link and can copy text and code, click URLs, and scroll back through what was shown while the presenter keeps going — then tap Jump to live.

```
 your Mac                         relay                          viewers
┌──────────────────┐  encrypted  ┌───────────────────┐  encrypted ┌───────────────────┐
│ capture-mac      │ ──────────▶ │ Node (dev) or     │ ─────────▶ │ viewer/ (static)  │
│ ScreenCaptureKit │   frames    │ Cloudflare Durable│   frames   │ decrypts, draws   │
│ + Vision OCR     │             │ Object, 1/session │            │ image + text layer│
└──────────────────┘             └───────────────────┘            └───────────────────┘
```

## Relay Protocol
- Role: presenter or viewer
- Framing: JSON envelopes over WebSocket

## Run it (on your Mac)
```bash
cd relay && npm install && npm run dev
```

```bash
cd capture-mac && ./build.sh
./scrollback --relay http://localhost:8787
```
- Playwright E2E browser tests passing for code editor fixtures.

## Web Application
Interactive Next.js presentation player in `web/`.

## macOS Permissions
Screen Recording permission is required for CLI capture.

## Cloudflare Worker
Deploy relay to edge via `npm run cf:deploy`.
- Noisy editor fixture tests passing.

- ScreenCaptureKit stream configuration verified on macOS Sonoma.
- High-performance swiftc binary build configuration.
- Configurable --fps and --jpeg-width flags.
