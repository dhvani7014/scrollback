#!/usr/bin/env python3
"""Regression test for the 'dragging over code selects the whole screen' bug.
Frame = code editor + line-number gutter + sidebar + title (see make-fixture-editor.py).
Run from the repo root with a relay running:  python3 tools/e2e_editor_test.py
"""
import os, re, subprocess, sys
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELAY = os.environ.get("RELAY", "http://localhost:8787").rstrip("/")
OUT = os.environ.get("SHOTS", "/tmp")

EXPECTED_CODE = """while True:
    user_input: str = input('You: ')

    if user_input == 'hello':
        print('Bot: Hello!')
    elif user_input == 'how are you?':
        print('Bot: Good, how about you?')
    elif user_input == 'bye':
        print('Bot: Goodbye!')
    else:
        print('Bot: Sorry, I did not understand that.')"""

FIX = os.environ.get("FIX", "fixtures_editor.json")
env = dict(os.environ, FIXTURES=FIX)
print("fixture:", FIX)
presenter = subprocess.Popen(["node", "tools/fake-presenter.mjs", RELAY, "300"], cwd=ROOT, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
link = None
for _ in range(40):
    m = re.search(re.escape(RELAY) + r"/s/\S+", presenter.stdout.readline())
    if m:
        link = m.group(0); break
assert link, "no link from presenter"

fails = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (f"\n       {detail}" if (detail and not cond) else ""))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1400, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(link)
    page.wait_for_selector("#textLayer .ln", timeout=15000)

    spans = page.eval_on_selector_all("#textLayer .ln", "els => els.map(e => ({t: e.textContent, g: e.classList.contains('gutter')}))")
    texts = [s["t"] for s in spans]

    # 1. DOM order: all code lines contiguous, sidebar never interleaved
    code_idx = [i for i, t in enumerate(texts) if "user_input" in t or "print('Bot" in t or t.strip() in ("while True:", "else:")]
    between = texts[min(code_idx):max(code_idx) + 1]
    check("code lines are contiguous in DOM order (nothing interleaved)",
          not any(w in " ".join(between) for w in ("F-String", "NeetCode", "Google", "Indently")), str(between))

    # 2. gutter numbers are marked unselectable
    flagged = [s["t"] for s in spans if s["g"]]
    stray = [s["t"] for s in spans if not s["g"] and re.fullmatch(r"[0-9IlOo|]{1,4}", s["t"].strip())]
    check("all 12 line numbers flagged as gutter (even misread ones), none left selectable",
          len(flagged) == 12 and not stray, f"flagged={flagged} stray={stray}")

    # 3. indentation restored in the DOM text
    lines_with_indent = {t for t in texts if t.startswith("    ")}
    check("indentation restored (4 / 8 spaces)",
          "    user_input: str = input('You: ')" in texts and "        print('Bot: Hello!')" in texts, str([t for t in texts if 'print' in t][:3]))

    # 4. exactly one Copy-code button, for the code block only
    btns = page.locator("#textLayer .copyblk")
    check("exactly one 'Copy code' button", btns.count() == 1, str(btns.count()))

    # 5. drag-select from first to last code line
    first = page.locator("#textLayer .ln", has_text="while True:").bounding_box()
    last = page.locator("#textLayer .ln", has_text="did not understand").bounding_box()
    page.mouse.move(first["x"] + 2, first["y"] + first["height"] / 2)
    page.mouse.down()
    page.mouse.move(last["x"] + last["width"] - 2, last["y"] + last["height"] / 2, steps=12)
    page.mouse.up()
    page.screenshot(path=f"{OUT}/editor_selection.png")
    page.keyboard.press("Control+c")   # the real copy path users take
    sel = page.evaluate("navigator.clipboard.readText()")
    check("drag selection has no sidebar text", not any(w in sel for w in ("F-String", "NeetCode", "Indently", "Google")), repr(sel[:200]))
    check("drag selection has no line numbers", not re.search(r"(^|\n)\s*\d{1,2}\s*(\n|$)", sel), repr(sel[:200]))
    check("drag selection contains the whole snippet", "while True:" in sel and "did not understand that.')" in sel)
    check("drag selection keeps newlines, indentation and the blank line", sel == EXPECTED_CODE, repr(sel))

    # partial selection: from the middle of line 2 to the middle of line 5
    # (clear the old selection first, or the mouse-down would start dragging the selected text)
    page.evaluate("window.getSelection().removeAllRanges()")
    l2 = page.locator("#textLayer .ln", has_text="user_input: str").bounding_box()
    l5 = page.locator("#textLayer .ln", has_text="Bot: Hello").bounding_box()
    page.mouse.move(l2["x"] + l2["width"] * 0.55, l2["y"] + l2["height"] / 2)
    page.mouse.down()
    page.mouse.move(l5["x"] + l5["width"] * 0.6, l5["y"] + l5["height"] / 2, steps=10)
    page.mouse.up()
    page.keyboard.press("Control+c")
    part = page.evaluate("navigator.clipboard.readText()")
    pl = part.split("\n")
    check("partial drag: starts mid-line, keeps blank line and indentation, ends mid-line",
          len(pl) == 4 and pl[0].endswith("input('You: ')") and not pl[0].startswith("user_input")
          and pl[1] == "" and pl[2] == "    if user_input == 'hello':"
          and pl[3].startswith("        print('Bo") and not pl[3].endswith("Hello!')"), repr(part))

    # 6. Copy code button gives the exact source, blank line included
    btns.first.click()
    clip = page.evaluate("navigator.clipboard.readText()")
    check("'Copy code' copies exact source (indent + blank line)", clip == EXPECTED_CODE, repr(clip))

    # 7. Copy all text excludes the gutter, separates blocks
    page.click("#copyAll")
    allt = page.evaluate("navigator.clipboard.readText()")
    check("Copy all excludes line numbers", not re.search(r"(^|\n)\d{1,2}(\n|$)", allt), repr(allt[:120]))
    check("Copy all includes code block verbatim", EXPECTED_CODE in allt)
    check("Copy all includes sidebar + title", "Every F-String Trick" in allt and "Learn Python in Only 30 Minutes" in allt)

    check("no uncaught page errors", not errs, str(errs))
    b.close()

presenter.terminate()
print("\nRESULT:", "ALL PASSED" if not fails else f"FAILED: {fails}")
sys.exit(1 if fails else 0)

# Playwright editor regression coverage
