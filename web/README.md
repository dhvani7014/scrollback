# Scrollback web

Paste a YouTube link, share a tab/call, or drop a recording; Scrollback reads the screen in the browser
(Tesseract.js) and gives you selectable text, copyable code, clickable links and a scroll-back timeline.

    npm install      # also copies the OCR engine into public/tesseract (postinstall)
    npm run dev      # http://localhost:3000
    npm run build && npm start
    npm run test:unit

Deploy: import the repo in Vercel, set Root Directory to `web`. No server code or env vars needed.
Use Chrome or Edge for tab sharing. The live "Present from your Mac" mode still uses the Cloudflare relay in `../relay`
(Vercel can't hold WebSockets).
