#!/usr/bin/env python3
"""How well does OCR read code from a *compressed video* of a coding tutorial?

Pipeline per config: render an editor frame -> encode as H.264 at a YouTube-like quality ->
decode a later (P) frame -> upscale to a Retina-sized player -> OCR -> compare to ground truth.

Uses Tesseract as a stand-in for Apple Vision (Vision is usually better on screen text, so
treat results as a pessimistic floor). Needs: ffmpeg, tesseract, Pillow, pytesseract.
"""
import difflib, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
import pytesseract

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
CODE = '''import httpx
from fastapi import FastAPI, HTTPException

app = FastAPI()
BASE_URL = "https://api.example.com/v1/users"

# install: pip install fastapi uvicorn httpx
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{BASE_URL}/{user_id}")
    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="not found")
    data = resp.json()
    return {"id": data["id"], "name": data["name"].strip()}

# run it with: uvicorn main:app --reload --port 8000
for i in range(10):
    print(i, i % 2 == 0, [x for x in range(i)])'''.split("\n")

KEYWORDS = {"import", "from", "async", "def", "with", "as", "await", "if", "raise", "return", "for", "in", "print"}


def render(w, h, font_px):
    img = Image.new("RGB", (w, h), (30, 30, 30))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, font_px)
    gutter = int(font_px * 3.2)
    line_h = int(font_px * 1.55)
    y = int(h * 0.08)
    char_w = d.textlength("M", font=font)
    for i, line in enumerate(CODE, 1):
        d.text((gutter - char_w * 2.6, y), f"{i:>2}", fill=(110, 118, 129), font=font)
        x = gutter
        if line.lstrip().startswith("#"):
            d.text((x, y), line, fill=(106, 153, 85), font=font)
        else:
            for tok in re.findall(r"\s+|\w+|\"[^\"]*\"|.", line):
                col = (212, 212, 212)
                if tok in KEYWORDS: col = (86, 156, 214)
                elif tok.startswith('"'): col = (206, 145, 120)
                elif tok.isdigit(): col = (181, 206, 168)
                d.text((x, y), tok, fill=col, font=font)
                x += d.textlength(tok, font=font)
        y += line_h
    return img


def through_video(img, crf, out_w, out_h, tmp):
    src = os.path.join(tmp, "src.png")
    img.save(src)
    mp4 = os.path.join(tmp, "v.mp4")
    # 24 identical frames -> later frames are P-frames, like a static slide in a real video
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "24", "-i", src,
                    "-t", "1", "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
                    "-pix_fmt", "yuv420p", mp4], check=True)
    out = os.path.join(tmp, "frame.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vf",
                    f"select=eq(n\\,20),scale={out_w}:{out_h}:flags=bicubic", "-frames:v", "1", out], check=True)
    return Image.open(out).convert("L")


def ocr_lines(gray):
    inv = Image.eval(gray, lambda p: 255 - p)  # dark theme -> dark text on light for Tesseract
    txt = pytesseract.image_to_string(inv, config="--psm 6 -c preserve_interword_spaces=1")
    return [re.sub(r"^\s*\d{1,2}\s{1,}", "", l).strip() for l in txt.split("\n") if l.strip()]


def norm(s): return re.sub(r"\s+", "", s)


def score(found):
    truth = [l.strip() for l in CODE if l.strip()]
    found_n = [norm(f) for f in found]
    exact, ratios = 0, []
    for t in truth:
        tn = norm(t)
        best = max((difflib.SequenceMatcher(None, tn, f).ratio() for f in found_n), default=0)
        ratios.append(best)
        exact += best == 1.0
    crit = {"url": 'BASE_URL="https://api.example.com/v1/users"', "pip": "#install:pipinstallfastapiuvicornhttpx",
            "run": "#runitwith:uvicornmain:app--reload--port8000"}
    crit_ok = {k: any(difflib.SequenceMatcher(None, v, f).ratio() == 1.0 for f in found_n) for k, v in crit.items()}
    return exact / len(truth), sum(ratios) / len(ratios), crit_ok


def main():
    # (label, source width, height, crf)  -- what YouTube typically serves at each quality
    tiers = [("1080p", 1920, 1080, 23), ("720p", 1280, 720, 28), ("480p", 854, 480, 32), ("360p", 640, 360, 34)]
    sizes = [("small font (1.9% of height)", 0.019), ("medium font (2.6%)", 0.026), ("large font (3.5%)", 0.035)]
    print(f"{'quality':7} {'font':28} {'exact lines':>11} {'char sim':>9}   url  pip  run")
    with tempfile.TemporaryDirectory() as tmp:
        for tname, w, h, crf in tiers:
            for sname, frac in sizes:
                px = max(6, round(h * frac))
                img = render(w, h, px)
                gray = through_video(img, crf, 2560, 1440, tmp)   # shown on a Retina-sized player
                exact, sim, crit = score(ocr_lines(gray))
                mark = lambda b: "ok " if b else "BAD"
                print(f"{tname:7} {sname:28} {exact:>10.0%} {sim:>9.1%}   {mark(crit['url'])}  {mark(crit['pip'])}  {mark(crit['run'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Verified against synthetic noisy OCR fixtures
