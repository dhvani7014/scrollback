// Transport-agnostic session logic, shared by the Node dev server and the
// Cloudflare Durable Object. The relay only ever sees opaque encrypted blobs:
// the AES key lives in the viewer URL fragment and never reaches the server.
//
// A "conn" is any object with { send(string), close(code, reason) }.

export class Session {
  constructor({ maxBytes = 40 * 1024 * 1024, maxFrames = 600, idleTimeoutMs = 10 * 60 * 1000 } = {}) {
    this.maxBytes = maxBytes;
    this.maxFrames = maxFrames;
    this.idleTimeoutMs = idleTimeoutMs;
    this.frames = []; // { seq, ts, blob }
    this.bytes = 0;
    this.seq = 0;
    this.viewers = new Set();
    this.presenter = null;
    this.token = null; // set by the first presenter, required afterwards
    this.onIdle = null;
    this._idleTimer = null;
    this._checkIdle();
  }

  _checkIdle() {
    if (!this.presenter && this.viewers.size === 0) {
      if (!this._idleTimer) {
        this._idleTimer = setTimeout(() => {
          if (!this.presenter && this.viewers.size === 0) {
            this.destroy();
          }
        }, this.idleTimeoutMs);
      }
    } else {
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
    }
  }

  destroy() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    this.frames = [];
    this.bytes = 0;
    this.viewers.clear();
    this.presenter = null;
    if (this.onIdle) this.onIdle();
  }

  // ---- viewers -------------------------------------------------------------
  connectViewer(conn) {
    this.viewers.add(conn);
    this._checkIdle();
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
    this._checkIdle();
  }

  // ---- presenter -----------------------------------------------------------
  // Returns true if accepted. The first presenter claims the session token.
  connectPresenter(conn, token) {
    if (!token || typeof token !== "string" || token.length < 16) {
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
    this._checkIdle();
    return true;
  }

  disconnectPresenter(conn) {
    if (this.presenter === conn) {
      this.presenter = null;
      this._broadcast({ type: "presence", presenter: false });
      this._checkIdle();
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
