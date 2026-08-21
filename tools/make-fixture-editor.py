#!/usr/bin/env python3
"""Fixture mimicking a YouTube coding tutorial: code editor + separate line-number gutter +
a sidebar of video titles + a title under the player. Line boxes are emitted the way Apple Vision
reports them: one box per visual line, gutter numbers as their own boxes, leading spaces stripped.
Output: tools/fixtures_editor.json
"""
import base64, io, json, os
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANS_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

CODE = [
    "while True:",
    "    user_input: str = input('You: ')",
    "",
    "    if user_input == 'hello':",
    "        print('Bot: Hello!')",
    "    elif user_input == 'how are you?':",
    "        print('Bot: Good, how about you?')",
    "    elif user_input == 'bye':",
    "        print('Bot: Goodbye!')",
    "    else:",
    "        print('Bot: Sorry, I did not understand that.')",
    "",
]

SIDEBAR = [  # (text lines, top y) one entry per video card; thumbnails sit between them
    (["Every F-String Trick", "In Python Explained", "Indently", "118k views  1 yr ago"], 70),
    (["How to solve a", "Google coding", "interview ...", "Life at Google", "1.8m views  1 yr ago"], 245),
    (["Maybe some", "people should", "just give up", "NeetCodeIO", "431k views  10 mo ago"], 420),
]
TITLE = "Learn Python in Only 30 Minutes (Beginner Tutorial)"


def box(d, xy, text, font):
    b = d.textbbox(xy, text, font=font)
    return {"t": text, "x": round(b[0] / W, 5), "y": round(b[1] / H, 5),
            "w": round((b[2] - b[0]) / W, 5), "h": round((b[3] - b[1]) / H, 5)}


def render(noisy=False):
    img = Image.new("RGB", (W, H), (24, 24, 27))
    d = ImageDraw.Draw(img)
    mono = ImageFont.truetype(MONO, 25)
    gut = ImageFont.truetype(MONO, 22)
    cw = d.textlength("M", font=mono)
    lines = []
    d.rectangle([0, 0, 840, 520], fill=(30, 31, 34))          # editor pane
    x0, y0, pitch = 120, 60, 36
    for i, row in enumerate(CODE):
        y = y0 + i * pitch
        num = str(i + 1)
        # noisy variant: numbers right-aligned (like real editors) and a couple misread by OCR
        gx = (96 - d.textlength(num, font=gut)) if noisy else 46
        d.text((gx, y + 2), num, fill=(96, 100, 110), font=gut)
        ocr_text = {"1": "l", "11": "I1"}.get(num, num) if noisy else num
        lines.append(box(d, (gx, y + 2), ocr_text, gut))       # gutter number = its own box
        if row.strip():
            indent = len(row) - len(row.lstrip(" "))
            d.text((x0 + indent * cw, y), row.strip(), fill=(190, 200, 190), font=mono)
            lines.append(box(d, (x0 + indent * cw, y), row.strip(), mono))
    # sidebar
    small = ImageFont.truetype(SANS_B, 17)
    meta = ImageFont.truetype(SANS, 14)
    for texts, top in SIDEBAR:
        d.rectangle([880, top - 5, 1060, top + 120], fill=(60, 70, 90))   # fake thumbnail
        for j, t in enumerate(texts):
            f = small if j < 3 else meta
            xy = (1085, top + j * 24)
            d.text(xy, t, fill=(230, 235, 245), font=f)
            lines.append(box(d, xy, t, f))
    # title under the player
    tf = ImageFont.truetype(SANS_B, 21)
    d.text((12, 570), TITLE, fill=(240, 240, 245), font=tf)
    lines.append(box(d, (12, 570), TITLE, tf))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return {"w": W, "h": H, "jpeg": base64.b64encode(buf.getvalue()).decode(), "lines": lines}


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for name, noisy in (("fixtures_editor.json", False), ("fixtures_editor_noisy.json", True)):
        json.dump([render(noisy)], open(os.path.join(here, name), "w"))
        print("wrote", name)
