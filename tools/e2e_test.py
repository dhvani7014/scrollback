#!/usr/bin/env python3
"""End-to-end check: fake presenter -> relay -> viewer in headless Chromium.
Requires: relay running on :8787, `pip install playwright` + chromium.
Run from the repo root:  python3 tools/e2e_test.py
"""
import re, subprocess, sys, time, os
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("SHOTS", "/tmp")
RELAY = os.environ.get("RELAY", "http://localhost:8787").rstrip("/")

presenter = subprocess.Popen(
    ["node", "tools/fake-presenter.mjs", RELAY, "500"],
    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
link = None
for _ in range(40):
    line = presenter.stdout.readline()
    m = re.search(r"(" + re.escape(RELAY) + r"/s/\S+)", line)
    if m:
        link = m.group(1)
        break
assert link, "presenter did not print a viewer link"
print("link:", link)

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not cond:
        fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1400, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(link)

    # wait for all 8 frames (~4s) to arrive and decrypt
    page.wait_for_function("document.getElementById('countLabel').textContent.startsWith('8 ')", timeout=15000)
    check("decrypts and receives 8 frames", True)
    check("shows Live state", "Live" in page.inner_text("#liveBtn"))
    check("empty-state panel is hidden once frames arrive", not page.is_visible("#empty"))
    check("frame image is visible and loaded", page.evaluate("document.getElementById('frameImg').naturalWidth") == 1280)

    texts = page.eval_on_selector_all("#textLayer .ln", "els => els.map(e => e.textContent)")
    check("text layer has 8 lines", len(texts) == 8, str(len(texts)))
    check("pip command is exact text", any(t.startswith("$ pip install fastapi uvicorn[standard]") for t in texts))

    links = page.eval_on_selector_all("#textLayer a", "els => els.map(a => a.href)")
    check("URLs became clickable anchors", len(links) == 3, str(links))
    check("anchors are http(s) only", all(l.startswith(("http://", "https://")) for l in links))

    # selection: triple-click the pip line and read the selection text
    box = page.locator("#textLayer .ln", has_text="pip install").bounding_box()
    page.mouse.click(box["x"] + 40, box["y"] + box["height"] / 2, click_count=3)
    sel = page.evaluate("window.getSelection().toString()").strip()
    check("triple-click selects the whole line", sel.startswith("$ pip install fastapi"), sel[:60])

    # copy-all button
    page.click("#copyAll")
    clip = page.evaluate("navigator.clipboard.readText()")
    check("Copy all text copies every line", clip.count("\n") == 7 and "uvicorn main:app" in clip)

    page.screenshot(path=f"{OUT}/viewer_live.png")

    # scrollback: go back three frames, presenter keeps going
    page.keyboard.press("ArrowLeft"); page.keyboard.press("ArrowLeft"); page.keyboard.press("ArrowLeft")
    n_lines = page.eval_on_selector_all("#textLayer .ln", "els => els.length")
    check("scrubbing back shows an earlier frame (5 lines)", n_lines == 5, str(n_lines))
    check("button switches to Jump to live", "Jump to live" in page.inner_text("#liveBtn"))
    page.screenshot(path=f"{OUT}/viewer_scrolled_back.png")

    page.click("#liveBtn")
    n_lines = page.eval_on_selector_all("#textLayer .ln", "els => els.length")
    check("jump to live returns to newest frame (8 lines)", n_lines == 8, str(n_lines))

    # wrong key must fail cleanly
    bad = ctx.new_page()
    bad.goto(re.sub(r"#k=.*", "#k=" + "A" * 43, link))
    bad.wait_for_function("document.getElementById('connText').textContent === \"Can't decrypt\"", timeout=10000)
    check("wrong key shows decrypt error, no frames", "0 frames" in bad.inner_text("#countLabel"))

    # missing key
    nokey = ctx.new_page()
    nokey.goto(link.split("#")[0])
    check("missing key shows incomplete-link message", "incomplete" in nokey.inner_text("#emptyTitle").lower())

    check("no uncaught page errors on main viewer", not errors, str(errors))
    b.close()

presenter.terminate()
print("\nRESULT:", "ALL PASSED" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)
