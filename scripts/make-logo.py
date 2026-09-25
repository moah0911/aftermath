#!/usr/bin/env python3
"""Aftermath brand generator — ASCII banner + PNG logo/social/icon.

Usage:  python3 scripts/make-logo.py [--out assets]

Outputs (all regenerated deterministically, stdlib + pillow only):
  assets/aftermath.txt  hand-drawn block-letter banner (also printed to stdout)
  assets/logo.png       1200x630 README hero / social preview
  assets/icon.png       512x512 mark

Design: near-black base, off-white type, one signal-green accent (green =
tests back to green). The reclaim arrow (U+21A9) is the whole story.
Fonts resolve via fontconfig (fc-match) with a stack of fallbacks so CI
never silently renders tofu.
"""
import os
import subprocess
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("aftermath: pillow is required (pip install pillow)")

BG = (11, 14, 17)        # near-black
INK = (237, 240, 243)    # off-white
GREEN = (61, 255, 124)   # signal green
MUTED = (139, 152, 165)  # tagline gray

GLYPHS = {
    "A": [" ██ ", "█  █", "████", "█  █", "█  █"],
    "F": ["████", "█   ", "███ ", "█   ", "█   "],
    "T": ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    "E": ["████", "█   ", "███ ", "█   ", "████"],
    "R": ["███ ", "█  █", "███ ", "█ █ ", "█  █"],
    "M": ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
    "H": ["█  █", "█  █", "████", "█  █", "█  █"],
    " ": ["  ", "  ", "  ", "  ", "  "],
}

WORD = "AFTERMATH"
TAGLINE = "stop \u00b7 revert \u00b7 recover"


def banner_lines():
    rows = [""] * 5
    for ch in WORD:
        g = GLYPHS[ch]
        for i in range(5):
            rows[i] += g[i] + " "
    width = max(len(r) for r in rows)
    rows = [r.ljust(width) for r in rows]
    pad = max(0, (width - len(TAGLINE)) // 2)
    return rows + ["", " " * pad + TAGLINE]


def resolve_font(patterns):
    """First font file matching any fontconfig pattern; None if all miss."""
    for pat in patterns:
        try:
            out = subprocess.run(
                ["fc-match", "--format=%{file}", pat],
                capture_output=True, text=True, timeout=10,
            )
            path = out.stdout.strip()
            if out.returncode == 0 and path and os.path.exists(path):
                return path
        except (FileNotFoundError, subprocess.SubprocessError):
            break  # no fontconfig at all — fall through to bundled guesses
    guesses = [
        "/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-Bold.otf",
        "/usr/share/fonts/source-foundry-hack-fonts/Hack-Regular.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSansMono.ttf",
    ]
    for path in guesses:
        if os.path.exists(path) and any(k in path.lower() for k in ("montserrat", "hack", "dejavu")):
            return path
    return None


def track_text(draw, xy, text, font, fill, tracking):
    """Draw text with manual letter tracking; returns width drawn."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x - tracking - xy[0]


def make_hero(path):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    mark_path = resolve_font(["Symbola", "Noto Sans Symbols", "DejaVu Sans"])
    disp_path = resolve_font(["Montserrat:bold", "Montserrat", "DejaVu Sans.Bold"])
    mono_path = resolve_font(["Hack", "DejaVu Sans Mono", "Liberation Mono"])
    if not disp_path:
        sys.exit("aftermath: no display font found (need Montserrat or DejaVu Sans Bold)")

    mark = ImageFont.truetype(mark_path, 200) if mark_path else None
    disp = ImageFont.truetype(disp_path, 148)
    mono = ImageFont.truetype(mono_path, 44) if mono_path else ImageFont.load_default()

    # Reclaim arrow, top-left as the mark.
    if mark:
        d.text((90, 60), "\u21a9", font=mark, fill=GREEN)

    # Wordmark, letterspaced.
    track_text(d, (90, 280), WORD, disp, INK, tracking=10)

    # Green rule + tagline.
    d.rectangle([92, 470, 320, 478], fill=GREEN)
    d.text((92, 500), TAGLINE, font=mono, fill=MUTED)

    img.save(path)


def make_icon(path):
    S = 512
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)
    mark_path = resolve_font(["Symbola", "Noto Sans Symbols", "DejaVu Sans"])
    if not mark_path:
        sys.exit("aftermath: no symbol font found for the icon mark")
    mark = ImageFont.truetype(mark_path, 300)
    glyph = "\u21a9"
    w = d.textlength(glyph, font=mark)
    bbox = d.textbbox((0, 0), glyph, font=mark)
    h = bbox[3] - bbox[1]
    d.text(((S - w) / 2, (S - h) / 2 - bbox[1]), glyph, font=mark, fill=GREEN)
    img.save(path)


def main():
    out = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--out" else "assets"
    if len(sys.argv) > 1 and sys.argv[1] not in ("--out",):
        sys.exit("usage: python3 scripts/make-logo.py [--out DIR]")
    os.makedirs(out, exist_ok=True)

    lines = banner_lines()
    text = "\n".join(lines) + "\n"
    with open(os.path.join(out, "aftermath.txt"), "w", encoding="utf-8") as f:
        f.write(text)
    print(text)

    make_hero(os.path.join(out, "logo.png"))
    make_icon(os.path.join(out, "icon.png"))
    print(f"aftermath: wrote {out}/aftermath.txt, {out}/logo.png, {out}/icon.png")


if __name__ == "__main__":
    main()
