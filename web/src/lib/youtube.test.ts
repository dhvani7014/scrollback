import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTube } from "./youtube.ts";

const ID = "dQw4w9WgXcQ";
test("watch url", () => assert.deepEqual(parseYouTube(`https://www.youtube.com/watch?v=${ID}`), { id: ID, start: 0 }));
test("watch url with extra params and t", () =>
  assert.deepEqual(parseYouTube(`https://youtube.com/watch?feature=share&v=${ID}&t=90s`), { id: ID, start: 90 }));
test("t= seconds / h-m-s", () => {
  assert.equal(parseYouTube(`https://youtu.be/${ID}?t=75`)?.start, 75);
  assert.equal(parseYouTube(`https://youtu.be/${ID}?t=1h2m3s`)?.start, 3723);
  assert.equal(parseYouTube(`https://youtu.be/${ID}?t=2m`)?.start, 120);
});
test("short, embed, shorts, live, mobile, no scheme", () => {
  for (const u of [`youtu.be/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}?si=abc`, `https://m.youtube.com/watch?v=${ID}`, `www.youtube.com/watch?v=${ID}`])
    assert.equal(parseYouTube(u)?.id, ID, u);
});
test("rejects non-youtube and malformed ids", () => {
  for (const u of ["", "hello", "https://vimeo.com/123456", `https://evil.com/watch?v=${ID}`,
    "https://youtube.com/watch?v=short", "https://youtube.com/watch", `javascript:alert(1)//youtube.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`])
    assert.equal(parseYouTube(u), null, u);
});
