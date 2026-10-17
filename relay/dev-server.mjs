// Local dev relay: serves the viewer and relays encrypted frames over WebSocket.
//   node dev-server.mjs            (default port 8787)
//   PORT=9000 node dev-server.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Session } from "./src/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_DIR = path.resolve(__dirname, "../viewer");
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let p = url.pathname === "/" || url.pathname.startsWith("/s/") ? "/index.html" : url.pathname;
  const file = path.normalize(path.join(VIEWER_DIR, p));
  if (!file.startsWith(VIEWER_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
});

const sessions = new Map();
const getSession = (id) => {
  if (!sessions.has(id)) {
    const s = new Session();
    s.onIdle = () => {
      sessions.delete(id);
    };
    sessions.set(id, s);
  }
  return sessions.get(id);
};

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  const m = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{8,64})$/);
  if (!m) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const session = getSession(m[1]);
    const conn = { send: (s) => ws.send(s), close: (c, r) => ws.close(c, r) };
    const role = url.searchParams.get("role");
    if (role === "presenter") {
      if (!session.connectPresenter(conn, url.searchParams.get("pt"))) return;
      ws.on("message", (d) => session.onPresenterMessage(conn, d.toString()));
      ws.on("close", () => session.disconnectPresenter(conn));
    } else {
      session.connectViewer(conn);
      ws.on("close", () => session.disconnectViewer(conn));
    }
    ws.on("error", () => {});
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Scrollback relay + viewer on http://localhost:${PORT}`);
});
