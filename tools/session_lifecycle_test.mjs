// Unit test for Session idle cleanup, memory eviction, and boundary checks
import { Session } from "../relay/src/session.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok) => {
  console.log((ok ? "PASS " : "FAIL ") + name);
  if (!ok) failed++;
};

// 1. Verify idle cleanup fires when session is abandoned
let idled = false;
const s = new Session({ idleTimeoutMs: 100 });
s.onIdle = () => { idled = true; };

// Connect presenter & viewer
const fakeConn = { send: () => {}, close: () => {} };
s.connectPresenter(fakeConn, "0123456789abcdef");
s.connectViewer(fakeConn);
s.onPresenterMessage(fakeConn, JSON.stringify({ type: "frame", blob: "test_blob" }));

check("session has 1 frame initially", s.frames.length === 1);
check("session is not idle while active", !idled);

// Disconnect presenter & viewer
s.disconnectPresenter(fakeConn);
s.disconnectViewer(fakeConn);

// Wait for idle timer to fire
await sleep(150);
check("session onIdle fired after disconnect", idled);
check("session frames wiped after destroy", s.frames.length === 0);

// 2. Verify idle timer is cancelled if someone reconnects in time
let idled2 = false;
const s2 = new Session({ idleTimeoutMs: 200 });
s2.onIdle = () => { idled2 = true; };

const pConn = { send: () => {}, close: () => {} };
s2.connectPresenter(pConn, "0123456789abcdef");
s2.disconnectPresenter(pConn);

// Reconnect before 200ms
await sleep(100);
s2.connectViewer({ send: () => {}, close: () => {} });
await sleep(150);
check("reconnecting viewer cancelled idle eviction", !idled2);

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
