export class Session {
  constructor() {
    this.presenter = null;
    this.viewers = new Set();
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
  }

  disconnectViewer(conn) {
    this.viewers.delete(conn);
  }

  onPresenterMessage(conn, data) {
    for (const v of this.viewers) {
      try { v.send(data); } catch {}
    }
  }
}
