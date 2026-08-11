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
