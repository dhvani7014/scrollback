#!/usr/bin/env python3
"""Generate fake 'screen' frames (terminal-style) plus the exact text-line boxes,
so the viewer can be tested without a real screen capture.
Output: tools/fixtures.json  -> [{ w, h, jpeg (base64), lines: [{t,x,y,w,h}] }, ...]
"""
import base64, io, json, os
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
SIZE = 26
LINE_H = 40
PAD_X, PAD_Y = 40, 90

SCRIPT = [
    "$ mkdir demo && cd demo",
    "$ python3 -m venv .venv && source .venv/bin/activate",
    "$ pip install fastapi uvicorn[standard] sqlalchemy psycopg2-binary",
    "# docs: https://fastapi.tiangolo.com/tutorial/first-steps/",
    "$ uvicorn main:app --reload --port 8000",
    "INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)",
    "INFO:     Started reloader process [48211] using WatchFiles",
    "# next: open http://localhost:8000/docs to try the API",
]


def render(n_lines: int):
    img = Image.new("RGB", (W, H), (22, 27, 38))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 52], fill=(36, 43, 58))
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([18 + i * 28, 17, 34 + i * 28, 33], fill=c)
    font = ImageFont.truetype(FONT, SIZE)
    d.text((W // 2 - 90, 14), "demo — zsh — 120x30", fill=(160, 170, 190), font=ImageFont.truetype(FONT, 18))
    lines = []
    for i, text in enumerate(SCRIPT[:n_lines]):
        y = PAD_Y + i * LINE_H
        colour = (120, 200, 255) if text.startswith("$") else (150, 160, 175)
        if text.startswith("INFO"):
            colour = (130, 220, 150)
        d.text((PAD_X, y), text, fill=colour, font=font)
        bbox = d.textbbox((PAD_X, y), text, font=font)
        lines.append({
            "t": text,
            "x": round(bbox[0] / W, 5),
            "y": round(bbox[1] / H, 5),
            "w": round((bbox[2] - bbox[0]) / W, 5),
            "h": round((bbox[3] - bbox[1]) / H, 5),
        })
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=78)
    return {"w": W, "h": H, "jpeg": base64.b64encode(buf.getvalue()).decode(), "lines": lines}


if __name__ == "__main__":
    frames = [render(n) for n in range(1, len(SCRIPT) + 1)]
    out = os.path.join(os.path.dirname(__file__), "fixtures.json")
    with open(out, "w") as f:
        json.dump(frames, f)
    print(f"wrote {len(frames)} frames -> {out}")
