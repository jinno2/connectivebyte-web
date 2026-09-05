#!/usr/bin/env python3
"""製品プレビュー収集 — 発見物の画面をPNG+3パネルGIFで取得 (2026-09-05, 09-06 3枚方式)。

X投稿添付用の素材作り (2026-09-05 jinno決定: 製品画面・GIF全投稿方針)。
枚数=3枚×1.25秒 (3.75s loop): X公式制約 (15MB/350枚以内) に枚数の好み規定は無いが
GIFはX側でMP4自動変換ループ再生 → エンゲージ定番は2-6秒 (Tenor sweet spot 2-4s)。
3枚なら数百KBで常に5MB simple upload内に収まり、パネル3枚=「何を/中身/証拠」と読める。

playwright chromium (実UA) で top/mid/lower の3位置をscreenshot → ffmpeg palette GIF。
出力: ~/.local/share/cb-fleet/previews/<preview_key>/{capture.png,preview.gif,meta.json}
短い頁 (scroll出来ない) はGIF無しPNGのみ — post.pyはPNGへfallbackする。

使い方: python3 capture-preview.py <url> [<url>...]   # 冪等 (meta.json status=okでskip)
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

from x_discover_rules import preview_key

STATE_DIR = pathlib.Path('~/.local/share/cb-fleet/previews').expanduser()
VIEWPORT = {'width': 1280, 'height': 800}
GIF_W = 640          # X GIF制約 1280x1080以内・timeline視認性
PANEL_FPS = 0.8      # 1枚あたり1.25秒 (3枚=3.75s loop)
SCROLL_STEP = 900    # パネル間のscroll量 (px)
DWELL_MS = 1300      # scroll後の描画・lazy load待ち
# HeadlessChrome UAでCSS/heroを落とすサイトが実在 (maxh3実測) — 実UAで上書き
UA_OVERRIDE = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
               '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


def write_meta(out: pathlib.Path, meta: dict) -> dict:
    meta['captured_at'] = dt.datetime.now().isoformat(timespec='seconds')
    (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False))
    return meta


def capture(url: str) -> dict:
    out = STATE_DIR / preview_key(url)
    meta_p = out / 'meta.json'
    if meta_p.exists():
        try:
            if json.loads(meta_p.read_text()).get('status') == 'ok':
                return {'url': url, 'status': 'cached', 'dir': str(out)}
        except ValueError:
            pass
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td)
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport=VIEWPORT, user_agent=UA_OVERRIDE)
            page = ctx.new_page()
            try:
                page.goto(url, timeout=45000, wait_until='domcontentloaded')
                try:  # 'load'はhero動画等で永久に来ない事がある→networkidle+settleで着地待ち
                    page.wait_for_load_state('networkidle', timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(4000)
                page.screenshot(path=str(out / 'capture.png'))  # panel 1 = above-fold
                (out / 'capture.png').replace(tmp / 'f0.png')
                # panel 2/3: scroll位置が底で動かなくなったら打ち切り (短い頁)
                last_y = 0
                for i in (1, 2):
                    # mouse.wheelはfocus/位置に左右される→scrollByで決定論的に (実測: 枚数が2/3で揺れた)
                    page.evaluate(f'window.scrollBy(0, {SCROLL_STEP})')
                    page.wait_for_timeout(DWELL_MS)
                    y = page.evaluate('window.scrollY')
                    if y == last_y:
                        break
                    last_y = y
                    page.screenshot(path=str(tmp / f'f{i}.png'))
            except Exception as e:  # noqa: BLE001 — 記録して次へ
                ctx.close()
                browser.close()
                return write_meta(out, {'url': url, 'status': 'fail',
                                        'error': str(e)[:200]})
            ctx.close()
            browser.close()
        frames = sorted(tmp.glob('f*.png'))
        (tmp / 'f0.png').replace(out / 'capture.png')  # above-fold PNGは残す
        if len(frames) < 2:
            return write_meta(out, {'url': url, 'status': 'ok', 'frames': len(frames),
                                    'png': str(out / 'capture.png'),
                                    'note': 'page too short for gif (png only)'})
        # GIF最終フレームはdelayが0に潰れる (ffmpeg gif muxer実測: 3枚→2.5s)
        # → 最後のパネルを複製して全パネルが1.25s以上表示されるようにする
        import shutil
        shutil.copy2(frames[-1], tmp / f'f{len(frames)}.png')
        frames = sorted(tmp.glob('f*.png'))
        subprocess.run([  # palette最適化3パネルGIF
            'ffmpeg', '-y', '-v', 'error',
            '-framerate', str(PANEL_FPS), '-i', str(tmp / 'f%d.png'),
            '-vf', f'scale={GIF_W}:-1:flags=lanczos,split[s0][s1];'
                   '[s0]palettegen[p];[s1][p]paletteuse',
            str(out / 'preview.gif')], check=True)
    return write_meta(out, {'url': url, 'status': 'ok', 'frames': len(frames),
                            'png': str(out / 'capture.png'),
                            'gif': str(out / 'preview.gif'),
                            'gif_bytes': (out / 'preview.gif').stat().st_size})


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
