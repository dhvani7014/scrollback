// Relay protocol checks: history replay for late viewers, presenter-token hijack protection.
//   node tools/relay_test.mjs [relayBase]      e.g. http://localhost:8787
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../relay/package.json"));
const WebSocket = require("ws");
const base = (process.argv[2] || "http://127.0.0.1:8787").replace(/^http/, "ws");
const id = "test" + Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? `  [${extra}]` : ""));
  if (!ok) failed++;
};
const open = (url) => new Promise((res, rej) => { const w = new WebSocket(url); w.on("open", () => res(w)); w.on("error", rej); });

const TOKEN = "a".repeat(24);
const pres = await open(`${base}/ws/${id}?role=presenter&pt=${TOKEN}`);
for (let i = 1; i <= 5; i++) pres.send(JSON.stringify({ type: "frame", blob: "blob" + i }));
await sleep(300);

// late viewer receives all 5 frames as history, in order, then history-end
const got = [];
const viewer = await open(`${base}/ws/${id}?role=viewer`);
viewer.on("message", (d) => got.push(JSON.parse(d.toString())));
await sleep(400);
const frames = got.filter((m) => m.type === "frame");
check("late viewer gets hello", got[0]?.type === "hello" && got[0].count === 5 && got[0].presenter === true);
check("late viewer gets 5 history frames in order", frames.map((f) => f.blob).join() === "blob1,blob2,blob3,blob4,blob5");
check("sequence numbers are 1..5", frames.map((f) => f.seq).join() === "1,2,3,4,5");
check("history-end marker sent", got.some((m) => m.type === "history-end"));

// live frame reaches the connected viewer
pres.send(JSON.stringify({ type: "frame", blob: "blob6" }));
await sleep(200);
check("live frame is broadcast", got.some((m) => m.type === "frame" && m.blob === "blob6" && !m.history));

// hijack attempt with the wrong token must be refused and must not inject frames
let closeCode = null;
const evil = await open(`${base}/ws/${id}?role=presenter&pt=${"b".repeat(24)}`);
evil.on("close", (c) => (closeCode = c));
evil.send(JSON.stringify({ type: "frame", blob: "EVIL" }));
await sleep(400);
check("wrong presenter token is closed with 4403", closeCode === 4403, String(closeCode));
check("no hijacked frame reached viewers", !got.some((m) => m.blob === "EVIL"));

// a viewer cannot publish frames
viewer.send(JSON.stringify({ type: "frame", blob: "VIEWERSPAM" }));
await sleep(300);
check("viewer messages are ignored", !got.some((m) => m.blob === "VIEWERSPAM"));

// short token rejected
let shortCode = null;
const weak = await open(`${base}/ws/${id}x?role=presenter&pt=short`);
weak.on("close", (c) => (shortCode = c));
await sleep(300);
check("short presenter token rejected (4400)", shortCode === 4400, String(shortCode));

// presenter leaves -> viewers told
pres.close();
await sleep(300);
check("presence=false broadcast on presenter leave", got.some((m) => m.type === "presence" && m.presenter === false));

console.log(failed ? `\nFAILED: ${failed}` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
