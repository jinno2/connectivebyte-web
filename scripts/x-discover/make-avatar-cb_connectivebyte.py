#!/usr/bin/env python3
"""cb_connectivebyte (X正統CB垢) のavatar生成 — 再生成可能な形で残す

基準 (avatar-cb_discoverer.png と同一ブランド基準・横断/fleet strategy 2026-08-30):
  - 24px円形クロップで判別可能な**単一モチーフ**・文字は使わない
  - CB brand色 (ink #101c2c 背景 + lime #c8ff52) — lab.connectivebyte.comと同系
  - 発見者(紙飛行機=便り)と区別する機関モチーフ: **4本の系列バー** (equalizer型) =
    月次トラッカーに象徴される「記録の系列の保管」を1図で示す
  - 本垢は手動投稿(publishing=manual・API credentialなし)のため --upload は持たない

使い方:
  python3 make-avatar-cb_connectivebyte.py   # PNG生成のみ (avatar-cb_connectivebyte.png)
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PNG = os.path.join(HERE, 'avatar-cb_connectivebyte.png')

INK = (16, 28, 44)      # #101c2c
LIME = (200, 255, 82)   # #c8ff52

# Material equalizer 比例 (24px座標)。4バー=月次記録の系列
# x, y_top, height (baseline=18)
_BARS_24 = [(3, 10, 8), (9, 6, 12), (15, 12, 6), (21, 8, 10)]
SCALE = 400 / 24
BASE_Y = 18


def bar_rects() -> list[tuple[float, float, float, float]]:
    rects = []
    for x, y_top, h in _BARS_24:
        rects.append((x * SCALE, y_top * SCALE, (x + 3) * SCALE, (BASE_Y) * SCALE))
    return rects


def render(size: int = 400, ss: int = 4) -> Image.Image:
    """ss倍スーパーサンプリング→縮小でアンチエイリアス。円形クロップを想定し中心0.72倍。"""
    big = size * ss
    img = Image.new('RGB', (big, big), INK)
    d = ImageDraw.Draw(img)
    c, k = 200.0, 0.72
    for x0, y0, x1, y1 in bar_rects():
        # 中心縮小を適用してから ss 倍
        pts = [(c + k * (x - c), c + k * (y - c)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        d.polygon([(x * ss, y * ss) for x, y in pts], fill=LIME)
    return img.resize((size, size), Image.LANCZOS)


def main() -> int:
    render().save(OUT_PNG, optimize=True)
    print(f'OK: {OUT_PNG} ({os.path.getsize(OUT_PNG)} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
