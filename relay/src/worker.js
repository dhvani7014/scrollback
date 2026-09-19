// Cloudflare Worker entry: one Durable Object per session id.
// Deploy with `npx wrangler deploy`; this also serves ../viewer as static assets.
import { Session } from "./session.js";

export class SessionDO {
  constructor(state, env) {
    this.session = new Session();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const conn = { send: (s) => server.send(s), close: (c, r) => server.close(c, r) };
    const session = this.session;

    if (url.searchParams.get("role") === "presenter") {
      if (session.connectPresenter(conn, url.searchParams.get("pt"))) {
        server.addEventListener("message", (e) => session.onPresenterMessage(conn, e.data));
        server.addEventListener("close", () => session.disconnectPresenter(conn));
      }
    } else {
      session.connectViewer(conn);
      server.addEventListener("close", () => session.disconnectViewer(conn));
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{8,64})$/);
    if (m) {
      const id = env.SESSIONS.idFromName(m[1]);
      return env.SESSIONS.get(id).fetch(request);
    }
    // /s/<id> viewer links resolve to the static viewer page. Fetch "/" (not "/index.html",
    // which the assets binding redirects) so the browser keeps the /s/<id> URL.
    if (url.pathname.startsWith("/s/")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), request));
    }
    return env.ASSETS.fetch(request);
  },
};

// Memory bounds and presence broadcast verified
