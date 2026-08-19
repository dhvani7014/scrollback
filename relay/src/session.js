// Transport-agnostic session logic, shared by the Node dev server and the
// Cloudflare Durable Object. The relay only ever sees opaque encrypted blobs:
// the AES key lives in the viewer URL fragment and never reaches the server.
//
// A "conn" is any object with { send(string), close(code, reason) }.

export class Session {
  constructor({ maxBytes = 40 * 1024 * 1024, maxFrames = 600 } = {}) {
    this.maxBytes = maxBytes;
    this.maxFrames = maxFrames;
    this.frames = []; // { seq, ts, blob }
    this.bytes = 0;
    this.seq = 0;
    this.viewers = new Set();
    this.presenter = null;
    this.token = null; // set by the first presenter, required afterwards
  }

  // ---- viewers -------------------------------------------------------------
  connectViewer(conn) {
    this.viewers.add(conn);
    conn.send(
      JSON.stringify({
        type: "hello",
        live: this.seq,
        count: this.frames.length,
        presenter: !!this.presenter,
      })
    );
    for (const f of this.frames) {
      conn.send(JSON.stringify({ type: "frame", history: true, ...f }));
    }
    conn.send(JSON.stringify({ type: "history-end" }));
    this._broadcastViewerCount();
  }

  disconnectViewer(conn) {
    this.viewers.delete(conn);
    this._broadcastViewerCount();
  }

  // ---- presenter -----------------------------------------------------------
  // Returns true if accepted. The first presenter claims the session token.
  connectPresenter(conn, token) {
    if (!token || token.length < 16) {
      conn.close(4400, "presenter token required (min 16 chars)");
      return false;
    }
    if (this.token && this.token !== token) {
      conn.close(4403, "bad presenter token");
      return false;
    }
    this.token = token;
    if (this.presenter && this.presenter !== conn) {
      try {
        this.presenter.close(4409, "replaced by newer presenter connection");
      } catch {}
    }
    this.presenter = conn;
    this._broadcast({ type: "presence", presenter: true });
    return true;
  }

  disconnectPresenter(conn) {
    if (this.presenter === conn) {
      this.presenter = null;
      this._broadcast({ type: "presence", presenter: false });
    }
  }

  onPresenterMessage(conn, raw) {
    if (conn !== this.presenter) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "ping") return conn.send(JSON.stringify({ type: "pong" }));
    if (msg.type !== "frame" || typeof msg.blob !== "string") return;

    const frame = { seq: ++this.seq, ts: Date.now(), blob: msg.blob };
    this.frames.push(frame);
    this.bytes += frame.blob.length;
    while (
      this.frames.length > this.maxFrames ||
      (this.bytes > this.maxBytes && this.frames.length > 1)
    ) {
      this.bytes -= this.frames.shift().blob.length;
    }
    this._broadcast({ type: "frame", ...frame });
  }

  // ---- internals -----------------------------------------------------------
  _broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const v of this.viewers) {
      try {
        v.send(s);
      } catch {
        this.viewers.delete(v);
      }
    }
  }

  _broadcastViewerCount() {
    const n = this.viewers.size;
    if (this.presenter) {
      try {
        this.presenter.send(JSON.stringify({ type: "viewers", count: n }));
      } catch {}
    }
  }
}
