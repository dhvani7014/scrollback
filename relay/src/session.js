export class Session {
  constructor() {
    this.presenter = null;
    this.viewers = new Set();
    this.history = [];
    this.maxHistory = 120;
    this.seq = 0;
  }

  connectPresenter(conn) {
    this.presenter = conn;
    return true;
  }

  disconnectPresenter(conn) {
    if (this.presenter === conn) this.presenter = null;
  }

  connectViewer(conn) {
    this.viewers.add(conn);
    for (const item of this.history) {
      try { conn.send(item); } catch {}
    }
  }

  disconnectViewer(conn) {
    this.viewers.delete(conn);
  }

  onPresenterMessage(conn, data) {
    this.seq++;
    this.history.push(data);
    if (this.history.length > this.maxHistory) this.history.shift();
    for (const v of this.viewers) {
      try { v.send(data); } catch {}
    }
  }
}
