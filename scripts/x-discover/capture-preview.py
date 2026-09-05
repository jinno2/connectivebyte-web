#!/usr/bin/env python3
"""製品プレビュー収集 — 発見物の画面をPNG+GIFで取得 (2026-09-05)。

X投稿添付用の素材作り (2026-09-05 jinno決定: 製品画面・GIF全投稿方針)。
playwright chromium headlessで top画面を緩くスクロール録画→480幅GIF + above-fold PNG。
出力: ~/.local/share/cb-fleet/previews/<host+path>/{capture.png,preview.gif,meta.json}

使い方: python3 capture-preview.py <url> [<url>...]   # 冪等 (既存dirはskip)
post.pyへの添付は未実装 — 当面はdry収集 (投稿本文は現形)。
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import subprocess
import sys
import tempfile
import urllib.parse

from playwright.sync_api import sync_playwright

STATE_DIR = pathlib.Path('~/.local/share/cb-fleet/previews').expanduser()
VIEWPORT = {'width': 1280, 'height': 800}
GIF_W = 480
SCROLL_SECONDS = 6
# HeadlessChrome UAでCSS/heroを落とすサイトが実在 (maxh3実測) — 実UAで上書き
UA_OVERRIDE = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
               '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


def key_for(url: str) -> str:
    u = urllib.parse.urlsplit(url)
    k = (u.netloc.replace('www.', '') + u.path.rstrip('/')).strip('/')
    return k.replace('/', '_')[:80] or u.netloc


def capture(url: str) -> dict:
    out = STATE_DIR / key_for(url)
    if (out / 'preview.gif').exists():
        return {'url': url, 'status': 'cached', 'dir': str(out)}
    out.mkdir(parents=True, exist_ok=True)
    video = None
    with tempfile.TemporaryDirectory() as td:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(
                viewport=VIEWPORT, user_agent=UA_OVERRIDE,
                record_video_dir=td,
                record_video_size={'width': 640, 'height': 400})
            page = ctx.new_page()
            try:
                page.goto(url, timeout=45000, wait_until='domcontentloaded')
                try:  # 'load'はhero動画等で永久に来ない事がある→networkidle+settleで着地を待つ
                    page.wait_for_load_state('networkidle', timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(4000)
                page.screenshot(path=str(out / 'capture.png'))
                for _ in range(SCROLL_SECONDS):  # 緩スクロール録画 (UI動きも拾う)
                    page.mouse.wheel(0, 480)
                    page.wait_for_timeout(900)
                video = page.video
            except Exception as e:  # noqa: BLE001 — 記録して次へ
                meta = {'url': url, 'status': 'fail', 'error': str(e)[:200],
                        'captured_at': dt.datetime.now().isoformat(timespec='seconds')}
                (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False))
                return meta
            finally:
                try:
                    page.close()  # videoのsave_asはpage close後が必須
                except Exception:
                    pass
                if video is not None:
                    video.save_as(str(out / 'raw.mp4'))
                ctx.close()
                browser.close()
        subprocess.run([  # palette最適化GIF (X制限15MB以内に収まる濃度)
            'ffmpeg', '-y', '-v', 'error', '-i', str(out / 'raw.mp4'),
            '-vf', f'fps=8,scale={GIF_W}:-1:flags=lanczos,split[s0][s1];'
                   '[s0]palettegen[p];[s1][p]paletteuse',
            str(out / 'preview.gif')], check=True)
        (out / 'raw.mp4').unlink()
    meta = {'url': url, 'status': 'ok',
            'png': str(out / 'capture.png'), 'gif': str(out / 'preview.gif'),
            'gif_bytes': (out / 'preview.gif').stat().st_size,
            'captured_at': dt.datetime.now().isoformat(timespec='seconds')}
    (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False))
    return meta


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    for url in sys.argv[1:]:
        m = capture(url)
        print(json.dumps(m, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
