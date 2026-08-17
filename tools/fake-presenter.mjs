// Fake presenter: streams pre-rendered fixture frames, encrypted exactly like the real capture tool.
//   node tools/fake-presenter.mjs [relayBase] [intervalMs]
//   e.g. node tools/fake-presenter.mjs http://localhost:8787 1500
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../relay/package.json"));
const WebSocket = require("ws");

const base = process.argv[2] || "http://localhost:8787";
const interval = Number(process.argv[3] || 1500);
// FIXTURES=fixtures_editor.json node tools/fake-presenter.mjs ...   (file lives in tools/)
const fixtures = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), process.env.FIXTURES || "fixtures.json"),
    "utf8"
  )
);

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sessionId = process.env.SESSION || b64url(crypto.randomBytes(9));
const presenterToken = process.env.PTOKEN || b64url(crypto.randomBytes(16));
const key = process.env.KEY ? Buffer.from(process.env.KEY, "base64url") : crypto.randomBytes(32);

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64");
}

const wsBase = base.replace(/^http/, "ws");
const ws = new WebSocket(`${wsBase}/ws/${sessionId}?role=presenter&pt=${presenterToken}`);
console.log(`\nViewer link:\n  ${base}/s/${sessionId}#k=${b64url(key)}\n`);

ws.on("open", () => {
  let i = 0;
  const tick = () => {
    if (i >= fixtures.length) return console.log("done (keeping connection open, Ctrl+C to quit)");
    ws.send(JSON.stringify({ type: "frame", blob: encrypt(fixtures[i]) }));
    console.log(`sent frame ${i + 1}/${fixtures.length}`);
    i++;
    setTimeout(tick, interval);
  };
  tick();
});
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "viewers") console.log(`viewers: ${m.count}`);
});
ws.on("close", (c, r) => console.log("closed", c, r.toString()));
ws.on("error", (e) => console.error("error", e.message));
