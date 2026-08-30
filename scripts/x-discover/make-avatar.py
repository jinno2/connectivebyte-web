#!/usr/bin/env python3
"""cb_discoverer (@ailabpost) のavatar生成・設定 — 再生成可能な形で残す

基準 (OK基準たたき台・横断/fleet strategy 追記2026-08-30):
  - 24px円形クロップで判別可能な**単一モチーフ**・文字は使わない (小サイズで崩れる)
  - CB brand色 (ink #101c2c 背景 + lime #c8ff52) — lab.connectivebyte.comと同系
  - meiro資産との共用なし・垢役割 (発見を届ける便) を1図で示す
  - 設定は v1.1 account/update_profile_image.json (base64) — Web UI不要

使い方:
  python3 make-avatar.py            # PNG生成のみ (scripts/x-discover/avatar-cb_discoverer.png)
  python3 make-avatar.py --upload   # 生成してXへ設定
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import os
import urllib.error
import urllib.request

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_PNG = os.path.join(HERE, 'avatar-cb_discoverer.png')

INK = (16, 28, 44)      # #101c2c
LIME = (200, 255, 82)   # #c8ff52

# 紙飛行機 (send glyph・Material send比例) 24px座標を400pxへ展開し中心0.78倍 (円形クロップ内)
_SEND_24 = [(2, 21), (23, 12), (2, 3), (2, 10), (17, 12), (2, 14)]
SCALE = 400 / 24


def plane_points() -> list[tuple[float, float]]:
    pts = [(x * SCALE, y * SCALE) for x, y in _SEND_24]
    c, k = 200.0, 0.78
    return [(c + k * (x - c), c + k * (y - c)) for x, y in pts]


def render(size: int = 400, ss: int = 4) -> Image.Image:
    """ss倍スーパーサンプリング→縮小でアンチエイリアス。"""
    big = size * ss
    img = Image.new('RGB', (big, big), INK)
    d = ImageDraw.Draw(img)
    d.polygon([(x * ss, y * ss) for x, y in plane_points()], fill=LIME)
    return img.resize((size, size), Image.LANCZOS)


def upload(png_path: str) -> dict:
    spec = importlib.util.spec_from_file_location('post', os.path.join(HERE, 'post.py'))
    post = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(post)
    env = post.resolve_env(post.load_env(), 'CBD')
    b64 = base64.b64encode(open(png_path, 'rb').read()).decode()
    url = 'https://api.twitter.com/1.1/account/update_profile_image.json'
    params = {'image': b64, 'skip_status': 'true'}
    body = __import__('urllib.parse', fromlist=['urlencode']).urlencode(params).encode()
    req = urllib.request.Request(url, data=body, method='POST',
        headers={'Authorization': post.oauth_header('POST', url, params, env),
                 'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return {'status': r.status, 'screen_name': d.get('screen_name'),
            'image': d.get('profile_image_url_https', '')}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--upload', action='store_true', help='生成後にXへ設定 (v1.1 API)')
    args = ap.parse_args()
    render().save(OUT_PNG, optimize=True)
    print(f'OK: {OUT_PNG} ({os.path.getsize(OUT_PNG)} bytes)')
    if args.upload:
        print(json.dumps(upload(OUT_PNG), ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
