#!/usr/bin/env python3
"""E2E for the Next.js app. Usage: WEB=http://localhost:3100 VIDEO=/path/tut.webm python3 tools/web_e2e_test.py"""
import os, re, sys
from playwright.sync_api import sync_playwright
WEB = os.environ.get("WEB", "http://localhost:3100"); VIDEO = os.environ["VIDEO"]; OUT = os.environ.get("SHOTS", "/tmp")
DEMO_CODE = """while True:
    user_input: str = input('You: ')

    if user_input == 'hello':
        print('Bot: Hello!')
    elif user_input == 'how are you?':
        print('Bot: Good, how about you?')
    elif user_input == 'bye':
        print('Bot: Goodbye!')
    else:
        print('Bot: Sorry, I did not understand that.')"""
fails = []
def check(n, c, d=""):
    print(("PASS " if c else "FAIL ") + n + (f"\n       {d}" if d and not c else ""))
    if not c: fails.append(n)

MOCK = """
(() => {
  const mk = (srcs) => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const x = c.getContext('2d'); let i = 0; const imgs = [];
    srcs.forEach(s => { const im = new Image(); im.src = s; imgs.push(im); });
    const draw = () => { const im = imgs[Math.floor(performance.now() / 6000) % imgs.length]; if (im.complete && im.naturalWidth) x.drawImage(im, 0, 0, 1280, 720); else { x.fillStyle='#14171F'; x.fillRect(0,0,1280,720);} requestAnimationFrame(draw); };
    draw(); return c.captureStream(10);
  };
  navigator.mediaDevices.getDisplayMedia = async () => mk(window.__SLIDES || []);
})();
"""

def drag_select(page, first_text, last_text):
    a = page.locator(".layer .ln", has_text=first_text).first.bounding_box()
    b = page.locator(".layer .ln", has_text=last_text).first.bounding_box()
    page.evaluate("window.getSelection().removeAllRanges(); navigator.clipboard.writeText('')")
    page.mouse.move(a["x"] + 2, a["y"] + a["height"] / 2); page.mouse.down()
    page.mouse.move(b["x"] + b["width"] - 2, b["y"] + b["height"] / 2, steps=12); page.mouse.up()
    page.keyboard.press("Control+c")
    return page.evaluate("navigator.clipboard.readText()")

with sync_playwright() as p:
    br = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--auto-select-desktop-capture-source=Entire screen"])
    ctx = br.new_context(viewport={"width": 1400, "height": 1000}, permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page(); errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" and "youtube" not in m.text.lower() and "Failed to load resource" not in m.text else None)

    # 1. landing + demo selection
    page.goto(WEB); page.wait_for_selector(".demo .layer .ln", timeout=15000)
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/web_home.png")
    sel = drag_select(page, "while True:", "did not understand")
    check("demo: drag selection = exact code (no sidebar/line numbers)", sel == DEMO_CODE, repr(sel[:160]))

    # 2. youtube link validation + embed
    page.fill("input[aria-label='YouTube link']", "https://vimeo.com/1"); page.click("text=Read video")
    check("bad link shows an error", page.locator(".err").first.is_visible())
    page.fill("input[aria-label='YouTube link']", "https://youtu.be/dQw4w9WgXcQ?t=30"); page.click("text=Read video")
    page.wait_for_selector("iframe[title='YouTube player']")
    src = page.get_attribute("iframe[title='YouTube player']", "src")
    check("youtube: embed url built with start time", "embed/dQw4w9WgXcQ" in src and "start=30" in src, src)
    check("youtube: start-reading button present", page.locator("text=Start reading this video").is_visible())
    page.click("#leave"); page.wait_for_selector(".hero")

    # 3. recording upload
    page.set_input_files("input[aria-label='Video file']", VIDEO)
    page.wait_for_selector(".layer .ln", timeout=120000)
    page.wait_for_function("document.querySelector('.pill')?.textContent.includes('Finished')", timeout=180000)
    n_screens = page.evaluate("document.querySelector('.timeline .t').textContent")
    print("   timeline:", n_screens)
    check("recording: two distinct screens found", re.search(r"\b2 screens\b", n_screens) is not None, n_screens)
    page.click("button[aria-label='Previous screen']")
    page.wait_for_timeout(300)
    texts1 = page.eval_on_selector_all(".layer .ln", "els => els.map(e => ({t: e.textContent, g: e.classList.contains('gutter')}))")
    print("   screen1 lines:", [t["t"] for t in texts1][:40])
    joined1 = " ".join(t["t"] for t in texts1)
    check("screen 1 text read: key tokens present", all(k in joined1 for k in ("user_input", "print", "elif")), joined1[:200])
    check("screen 1: line numbers flagged as gutter (>=3; OCR drops single digits)", sum(1 for t in texts1 if t["g"]) >= 3, str([t["t"] for t in texts1 if t["g"]]))
    page.screenshot(path=f"{OUT}/web_reader1.png")
    sel1 = drag_select(page, "while", "understand") if page.locator(".layer .ln", has_text="understand").count() else ""
    print("   OCR drag-copy screen 1:\n" + "\n".join("   | " + l for l in sel1.split("\n")))
    want = [l.strip() for l in DEMO_CODE.split("\n") if l.strip()]
    got = [l.strip() for l in sel1.split("\n")]
    ok_lines = sum(1 for l in want if l in got)
    print(f"   exact code lines (ignoring indent): {ok_lines}/{len(want)}")
    check("screen 1: at least 6/10 code lines copy exactly (Tesseract on synthetic H.264-free frame)", ok_lines >= 6)
    check("screen 1: copy keeps relative indentation (nested print deeper than if)", any(l.startswith("        print") for l in sel1.split("\n")) and any(l.startswith("    if") for l in sel1.split("\n")), repr(sel1[:200]))
    check("screen 1: copy excludes sidebar", not any(w in sel1 for w in ("F-String", "NeetCode")), sel1[:100])
    page.click("button:has-text('Jump to latest')")
    page.wait_for_timeout(300)
    joined2 = page.eval_on_selector_all(".layer .ln", "els => els.map(e => e.textContent).join(' ')")
    check("screen 2 text read (fib)", "fib" in joined2 and "range" in joined2, joined2[:200])
    check("screen 2: URL is a clickable link", page.locator(".layer a[href^='https://docs.python.org']").count() == 1, joined2[:300])
    page.click("#leave"); page.wait_for_selector(".hero")

    # 4. tab share (mocked getDisplayMedia -> canvas stream cycling two slides)
    import base64
    s = [ "data:image/png;base64," + base64.b64encode(open(os.environ["VIDEO"].replace("tut.webm", f), "rb").read()).decode() for f in ("s1.png", "s2.png")]
    page.add_init_script(f"window.__SLIDES = {s!r};" + MOCK)
    page.reload(); page.wait_for_selector(".hero")
    page.click("text=Share a tab")
    page.wait_for_selector(".layer .ln", timeout=120000)
    page.wait_for_function("(document.querySelector('.timeline .t')?.textContent.match(/(\\d+) screen/)||[0,0])[1] >= 2", timeout=120000)
    check("tab share: both slides read live", True)
    check("tab share: status pill live", "live" in (page.get_attribute(".pill", "class") or ""))
    page.click("#leave"); page.wait_for_selector(".hero")
    check("no page errors", not errs, str(errs[:5]))
    br.close()
print("\nRESULT:", "ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
