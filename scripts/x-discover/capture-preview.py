#!/usr/bin/env python3
"""製品プレビュー収集 — PNG + 3パネルGIF + スクロールMP4 (2026-09-06)

X投稿添付用の素材作り (2026-09-05 jinno決定: 製品画面・全投稿添付、
2026-09-06: XはGIFをMP4自動変換する → 最初から動画も可・頁特性で選ぶ)。

形式の使い分け (2026-09-06 jinno方針):
  - 静的頁 = 特徴的な複数画面のピックアップ → 3パネルGIF (各1.25s=3.75s loop)
  - 動的頁 = 一連の画面遷移が見どころ → スクロールMP4 (H.264直接upload)
判定は機械: 各停止位置で0.7s間隔の2枚をshotし平均pixel差=motion。
motion最大値 ≥ 閾値ならMP4推奨、未満はGIF (scroll出来ない短い頁はPNG)。
post.pyは meta.json recommended に従い、欠落/超過時はgif→pngでfallback。

GIF 3枚×1.25秒の根拠: X公式に枚数の好み規定は無い (15MB/350枚上限) が
定番は2-6秒loop (Tenor sweet spot 2-4s)。3枚なら数百KBで常にsimple upload内。

playwright chromium (実UA) で top/中/下 をscreenshot・同一sessionで録画 → ffmpeg。
出力: ~/.local/share/cb-fleet/previews/<preview_key>/
      {capture.png, preview.gif, preview.mp4, meta.json}

使い方: python3 capture-preview.py <url> [<url>...]   # 冪等 (meta.json status=okでskip)
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

from x_discover_rules import preview_key

STATE_DIR = pathlib.Path('~/.local/share/cb-fleet/previews').expanduser()
VIEWPORT = {'width': 1280, 'height': 800}
GIF_W = 640          # X GIF制約 1280x1080以内・timeline視認性
PANEL_FPS = 0.8      # 1枚あたり1.25秒 (3枚=3.75s loop)
SCROLL_STEP = 900    # パネル間のscroll量 (px)
DWELL_MS = 1300      # scroll後の描画・lazy load待ち
MOTION_GAP_MS = 700  # motion判定用2枚shotの間隔
MOTION_THRESHOLD = 3.0  # 超えたら「動きが内容」=MP4 (0-255の平均差)
VIDEO_MAX_S = 12     # 録画が長い時は末尾側この長さへtrim (scroll tour部を残す)
TRIM_OVER_S = 14     # この長さを超えたらtrim (遅い頁はtop静止が長い)
# HeadlessChrome UAでCSS/heroを落とすサイトが実存 (maxh3実測) — 実UAで上書き
UA_OVERRIDE = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
               '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')


def write_meta(out: pathlib.Path, meta: dict) -> dict:
    meta['captured_at'] = dt.datetime.now().isoformat(timespec='seconds')
    (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False))
    return meta


def motion_score(a: pathlib.Path, b: pathlib.Path) -> float:
    """同一位置の2shotの平均pixel差 (0-255)。大きい=その位置で動いている。"""
    ia = Image.open(a).convert('L').resize((320, 200))
    ib = Image.open(b).convert('L').resize((320, 200))
    return ImageStat.Stat(ImageChops.difference(ia, ib)).mean[0]


def shot_pair(page, tmp: pathlib.Path, stop: int) -> float:
    """停止位置で2枚 (a→gap→b) を撮る。panel=b。戻り値=motion score。"""
    page.screenshot(path=str(tmp / f'm{stop}a.png'))
    page.wait_for_timeout(MOTION_GAP_MS)
    page.screenshot(path=str(tmp / f'p{stop}.png'))
    return motion_score(tmp / f'm{stop}a.png', tmp / f'p{stop}.png')


def smooth_scroll(page) -> None:
    """動画向けなめらかscroll (6分割×90ms)。停止位置はSCROLL_STEP刻み。"""
    step = SCROLL_STEP // 6
    for _ in range(6):
        page.evaluate(f'window.scrollBy(0, {step})')
        page.wait_for_timeout(90)


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
            # 録画はpage単位 → panel取得と同一sessionでMP4も取る (再訪問が要らない)
            ctx = browser.new_context(
                viewport=VIEWPORT, user_agent=UA_OVERRIDE,
                record_video_dir=str(tmp),
                record_video_size={'width': VIEWPORT['width'],
                                   'height': VIEWPORT['height']})
            page = ctx.new_page()
            vid = page.video
            motions: list[float] = []
            try:
                page.goto(url, timeout=45000, wait_until='domcontentloaded')
                try:  # 'load'はhero動画等で永久に来ない事がある→networkidle+settleで着地待ち
                    page.wait_for_load_state('networkidle', timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(4000)
                motions.append(shot_pair(page, tmp, 0))  # panel 0 = above-fold
                # panel 1/2: scroll位置が底で動かなくなったら打ち切り (短い頁)
                last_y = 0
                for i in (1, 2):
                    # mouse.wheelはfocus/位置に左右される→scrollByで決定論的に
                    smooth_scroll(page)
                    page.wait_for_timeout(600)
                    y = page.evaluate('window.scrollY')
                    if y == last_y:
                        break
                    last_y = y
                    motions.append(shot_pair(page, tmp, i))
            except Exception as e:  # noqa: BLE001 — 記録して次へ
                ctx.close()
                browser.close()
                return write_meta(out, {'url': url, 'status': 'fail',
                                        'error': str(e)[:200]})
            ctx.close()  # closeで録画fileが確定する
            browser.close()
            vpath = None
            try:
                if vid is not None and vid.path():
                    vpath = pathlib.Path(vid.path())
            except Exception:
                vpath = None

        # --- panels → above-fold PNG + 3パネルGIF --------------------------------
        panels = sorted(tmp.glob('p*.png'))
        shutil.copy2(panels[0], out / 'capture.png')
        if len(panels) >= 2:
            # GIF最終フレームはdelayが0に潰れる (ffmpeg gif muxer実測: 3枚→2.5s)
            # → 最後のパネルを複製して全パネルが1.25s以上表示されるようにする
            shutil.copy2(panels[-1], tmp / f'p{len(panels)}.png')
            subprocess.run([  # palette最適化3パネルGIF
                'ffmpeg', '-y', '-v', 'error',
                '-framerate', str(PANEL_FPS), '-i', str(tmp / 'p%d.png'),
                '-vf', f'scale={GIF_W}:-1:flags=lanczos,split[s0][s1];'
                       '[s0]palettegen[p];[s1][p]paletteuse',
                str(out / 'preview.gif')], check=True)

        # --- 録画 → H.264 MP4 (X仕様: yuv420p・faststart・無音可) -----------------
        if vpath is not None and vpath.exists() and vpath.stat().st_size > 50_000:
            dur = 0.0
            pr = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                                 'format=duration', '-of', 'csv=p=0', str(vpath)],
                                capture_output=True, text=True)
            try:
                dur = float(pr.stdout.strip())
            except ValueError:
                pass
            cmd = ['ffmpeg', '-y', '-v', 'error']
            if dur > TRIM_OVER_S:  # 遅い頁はtop静止が長い→末尾 (tour部) を残す
                cmd += ['-ss', f'{max(0.0, dur - VIDEO_MAX_S):.2f}']
            cmd += ['-i', str(vpath), '-c:v', 'libx264', '-profile:v', 'high',
                    '-pix_fmt', 'yuv420p', '-crf', '23', '-an',
                    '-movflags', '+faststart', str(out / 'preview.mp4')]
            subprocess.run(cmd, check=True)

        # --- 形式推奨 (post.pyが従う・手動steeringもmeta書き換えで可能) -----------
        motion = max(motions) if motions else 0.0
        mp4 = out / 'preview.mp4'
        mp4_ok = mp4.exists() and 50_000 < mp4.stat().st_size <= 15 * 1024 * 1024
        if mp4_ok and motion >= MOTION_THRESHOLD:
            rec = 'mp4'
        elif len(panels) >= 2:
            rec = 'gif'
        elif (out / 'capture.png').exists():
            rec = 'png'
        else:
            rec = 'none'
        meta = {'url': url, 'status': 'ok', 'frames': len(panels),
                'motion': round(motion, 2), 'recommended': rec,
                'png': str(out / 'capture.png')}
        if (out / 'preview.gif').exists():
            meta['gif'] = str(out / 'preview.gif')
            meta['gif_bytes'] = (out / 'preview.gif').stat().st_size
        if mp4_ok:
            meta['mp4'] = str(mp4)
            meta['mp4_bytes'] = mp4.stat().st_size
        return write_meta(out, meta)


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
