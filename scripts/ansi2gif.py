#!/usr/bin/env python3
"""Render tmux ANSI text captures to an animated GIF (pure PIL, no ttyd/ffmpeg).

Input: a frames directory with ordered *.txt files captured via
  `tmux capture-pane -e -p` and a manifest file `frames.dir/durations.txt`
  mapping frame index -> hold time in centiseconds.

Output: docs/demo.gif — a real recording of the live tktop TUI.
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FG0 = (205, 214, 244)
BG0 = (17, 17, 27)
CELL_W, CELL_H = 9, 18
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 14)

SGR_RE = re.compile(r"\x1b\[([0-9;?]*)([A-Za-z])")


def x256(n: int) -> tuple[int, int, int]:
    if n < 16:
        base = [
            (30, 30, 46), (205, 49, 49), (166, 227, 161), (250, 179, 135),
            (137, 180, 250), (245, 194, 231), (148, 226, 213), (17, 17, 27),
            (88, 91, 112), (243, 139, 168), (166, 227, 161), (235, 160, 172),
            (137, 180, 250), (180, 190, 254), (203, 166, 247), (24, 24, 37),
        ]
        return base[n]
    if n < 232:
        rgb = []
        for k in (0, 1, 2):
            v = ((n - 16) // (6 ** (2 - k))) % 6
            rgb.append(0 if v == 0 else 95 + 40 * (v - 1))
        return tuple(rgb)
    g = 8 + (n - 232) * 10
    return (g, g, g)


def parse_ansi(text: str, cols: int, rows: int):
    grid = [[(" ", FG0, BG0) for _ in range(cols)] for _ in range(rows)]
    y = x = 0
    fg, bg = FG0, BG0
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "\x1b":
            m = SGR_RE.match(text, i)
            if m:
                params, cmd = m.group(1), m.group(2)
                i = m.end()
                if cmd == "m":
                    ps = [int(p) for p in params.split(";") if p not in ("", "?")]
                    j = 0
                    while j < len(ps):
                        p = ps[j]
                        if p == 0:
                            fg, bg = FG0, BG0
                        elif p == 38 or p == 48:
                            color = None
                            if j + 1 < len(ps):
                                if ps[j + 1] == 5:
                                    color = x256(ps[j + 2]) if j + 2 < len(ps) else None
                                    j += 2
                                elif ps[j + 1] == 2:
                                    color = tuple(ps[j + 2 : j + 5])
                                    j += 4
                            if color:
                                if p == 38:
                                    fg = color
                                else:
                                    bg = color
                        elif p == 39:
                            fg = FG0
                        elif p == 49:
                            bg = BG0
                        j += 1
                elif cmd == "H":
                    parts = params.split(";")
                    y = int(parts[0]) - 1 if parts[0] else 0
                    x = int(parts[1]) - 1 if len(parts) > 1 and parts[1] else 0
                elif cmd == "J":
                    if params in ("", "0", "2"):
                        for yy in range(rows):
                            for xx in range(cols):
                                grid[yy][xx] = (" ", FG0, BG0)
                continue
        if c == "\n":
            y += 1
            x = 0
        elif c == "\r":
            x = 0
        elif c == "\x08":
            x = max(0, x - 1)
        else:
            if 0 <= y < rows:
                if 0 <= x < cols:
                    grid[y][x] = (c, fg, bg)
                x += 1
        i += 1
    return grid


def render(grid, cols, rows) -> Image.Image:
    img = Image.new("RGB", (cols * CELL_W, rows * CELL_H), BG0)
    d = ImageDraw.Draw(img)
    for yy in range(rows):
        py = yy * CELL_H
        for xx in range(cols):
            ch, fg, bg = grid[yy][xx]
            px = xx * CELL_W
            if bg != BG0:
                d.rectangle([px, py, px + CELL_W - 1, py + CELL_H - 1], fill=bg)
            if ch != " ":
                d.text((px + 1, py + 2), ch, font=FONT, fill=fg)
        del py
    return img


def main():
    frames_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])
    cols, rows = int(sys.argv[3]), int(sys.argv[4])
    texts = sorted(frames_dir.glob("frame-*.txt"), key=lambda p: int(p.stem.split("-")[1]))
    durations = {}
    dfile = frames_dir / "durations.txt"
    if dfile.exists():
        for line in dfile.read_text().splitlines():
            if line.strip():
                idx, cs = line.split()
                durations[int(idx)] = int(cs)
    imgs = []
    durs = []
    for k, p in enumerate(texts):
        grid = parse_ansi(p.read_text(), cols, rows)
        imgs.append(render(grid, cols, rows))
        durs.append(durations.get(k + 1, 100))
    # PNG frames are heavy; go to palette mode for compact GIF
    pal = []
    if imgs:
        base = imgs[0].convert("P", palette=Image.ADAPTIVE, colors=255)
        pal = base
        pal_frames = []
        for im in imgs:
            p2 = im.convert("RGB").quantize(palette=base, dither=Image.FLOYDSTEINBERG)
            pal_frames.append(p2)
        pal_frames[0].save(
            out,
            save_all=True,
            append_images=pal_frames[1:],
            duration=durs,
            loop=0,
            optimize=True,
            disposal=2,
        )
    print(f"gif: {out} frames={len(imgs)} size={out.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
