#!/usr/bin/env python3
"""CB発見者 生成規律 — X運用基本計画§11 (投稿文の生成ルール) の機械化。

collect (起草prompt) / review (承認時警告表示) / post (投稿前fail-closed検査) の
3点から同じ規律を参照する。正本: business_notes/横断/X運用基本計画.md §11。

§11「自動生成しない」の語 + キュレーション文脈の断定誇張語 (秀逸/衝撃/革命等)。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import subprocess
import sys

# X運用基本計画§11「自動生成しない」+ 肯定評価の誇張語 (発見者take向け拡張)
BANNED_WORDS: tuple[str, ...] = (
    # §11 本文列挙
    'おすすめ', '推し', '最高', '画期的', '必須', '絶対', '業界No', 'No.1',
    '人間より正確', '完全自動', 'ミスゼロ', '必ず時間を削減',
    # 肯定評価語 (キュレーションtakeに出しがちな断定誇張)
    '秀逸', '衝撃', '激震', '革命', '最強',
)
# 注: 単字「神」は精神/神話等の誤検知のため入れない

# hook均一化検出: 末尾4字が直近投稿と同一なら警告 ( TweetSpamBot類似判定回避 )
OPENER_SUFFIX_LEN = 4


def banned_hits(*parts: str) -> list[str]:
    """投稿文各部に含まれる禁止語を返す (空=合格)。"""
    text = ' '.join(p or '' for p in parts)
    return [w for w in BANNED_WORDS if w in text]


def ask_is_interrogative(ask: str) -> bool:
    """askは読者への問いであること (基本計画のreply誘導CTA形)。"""
    return (ask or '').rstrip().endswith('？') or (ask or '').rstrip().endswith('?')


def hook_suffix(hook: str) -> str:
    """hook末尾語 (均一化検出用)。"""
    return (hook or '')[-OPENER_SUFFIX_LEN:]


def preview_key(url: str) -> str:
    """プレビュー素材のdir名 (capture-preview.py収集・post.py添付で共有)。
    host (www除外) + path。URL無し・簡易URLでも衝突しない短い一意key。"""
    import urllib.parse
    u = urllib.parse.urlsplit(url or '')
    k = (u.netloc.replace('www.', '') + u.path.rstrip('/')).strip('/')
    return k.replace('/', '_')[:80] or u.netloc or 'nohost'


def media_ok(d: dict) -> bool:
    """添付素材 (対象頁の実スクショ) を付けてよい対象か (2026-09-06 jinno方針)。

    ニュース記事頁のスクショは紹介素材として喜ばれるより無断転載/リークに
    見える → 製品そのものの頁 (github repo / Show HN の製品頁) のみ添付可。
    記事ネタ (techpolicy/economist等) はtext-only。collect (収集) と
    post (添付) の両方から参照 = 二重のguard。
    """
    if d.get('source') == 'github':
        return True
    return d.get('source') == 'hn' and bool(d.get('title', '').lower().startswith('show hn'))


def uniformity_warning(hook: str, recent_hooks: list[str]) -> str | None:
    """直近hookと末尾語が同一なら警告文を返す。"""
    sfx = hook_suffix(hook)
    if sfx and any(hook_suffix(h) == sfx for h in recent_hooks):
        return f'hook末尾「{sfx}」が直近投稿と同一 (均一化回避§11)'
    return None


# --- §11機械検査の共通実装 (collect/enrich から参照・2026-09-14統合) --------
# 起草側の保守的上限: post.py build_text (link_policy=none) + t.co 23字込みで
# 280字以内。post.py 本体は投稿時にURL込みの実寸を別途検査する (正本はそちら)。
MAX_TOTAL_CHARS = 280 - 23


def discipline_violation(hook: str, take: str, ask: str) -> str | None:
    """§11機械検査。違反なら理由文字列・正常ならNone (起草側の単一実装)。"""
    hits = banned_hits(hook, take, ask)
    if hits:
        return 'banned_word: ' + '/'.join(hits)
    if not ask_is_interrogative(ask):
        return 'ask_not_interrogative'
    text = f'{hook}\n{take}\n\n{ask}'
    if len(text) > MAX_TOTAL_CHARS:
        return f'too_long: {len(text)}>{MAX_TOTAL_CHARS}'
    return None


def post_window_age(row: dict, today: dt.date) -> int | None:
    """投稿対象の48h窓 (当日収集+前日残り) 内なら行令age、窓外ならNone。

    collect(refill/rereview/redraft)・post(pick_draft)・enrich の5経路から
    参照する単一実装。date欠損・null・非文字列・不正形式はすべて窓外扱い —
    例外種別を問わず耐えないと、手編集/jq事故の1行で毎朝のcron全体が
    トレースバック死する (TypeErrorは従来のexcept漏れ・実査で確認済み)。
    """
    try:
        age = (today - dt.date.fromisoformat(row['date'])).days
    except (KeyError, TypeError, ValueError):
        return None
    return age if 0 <= age <= 1 else None


def in_post_window(row: dict, today: dt.date) -> bool:
    """48h窓内かの述語版 (窓外skipのloopにそのまま嵌まる)。"""
    return post_window_age(row, today) is not None


# --- 生成物の版管理 (2026-09-15) -------------------------------------------
# 生成物は「作られたときのシステムversion」を持つ。システム (prompt/起草code)
# を更新したら、現行versionと異なる生存生成物はすべて現行versionで再生成する。
# 正本: connective-byte SYSTEM_CONSTITUTION.md「生成物の版管理」。

_PIPELINE_VERSION = ''


def pipeline_version() -> str:
    """生成系の実装version = scripts/木のgit tree hash短縮形。
    生成codeとpromptの実体が変わったときだけ変わる — repo全体のHEADや
    docs-only commitでは不変 (docs commitで全行がspuriously stale化した
    実測 2026-09-15 を受け、HEAD短hashからscripts/木へ対象を修正)。
    scripts下の作業treeが汚れていれば '+' 接尾で明す。git不在等は
    'unknown' — unknown同士は一致扱い (版管理不能環境でstale誤爆を避ける)。"""
    global _PIPELINE_VERSION
    if _PIPELINE_VERSION:
        return _PIPELINE_VERSION
    here = str(pathlib.Path(__file__).parent)
    try:
        tree = subprocess.run(['git', '-C', here, 'rev-parse', '--short=12',
                               'HEAD:scripts'],
                              capture_output=True, text=True, timeout=5)
        dirty = subprocess.run(['git', '-C', here, 'status', '--porcelain',
                                '--', ':(top)scripts'],
                               capture_output=True, text=True, timeout=5)
        v = (tree.stdout.strip() or 'unknown') + ('+' if dirty.stdout.strip() else '')
    except Exception:  # noqa: BLE001 — git不在/遅延も生成を止めない
        v = 'unknown'
    _PIPELINE_VERSION = v
    return v


# --- queue I/O の耐障害化 (collect/enrich/post 共通・2026-09-14) -------------
# 書込は全save経路でatomic (tmp+os.replace)。読込は破損行をskip — 中断された
# 書込や手編集の1行で朝collect・晩postが丸ごと死ぬのを防ぐ (実査済み欠陥)。

def read_jsonl(path: str | os.PathLike) -> list[dict]:
    """1行1JSONのqueueを読む。破損行・非dict行はstderrに警告してskip・
    file無しは空list。破損行は次の書戻し時に物理削除される (復元不可・仕様:
    復元が必要ならqueueを手動backupしてから再実行)。"""
    try:
        lines = pathlib.Path(path).read_text(encoding='utf-8').splitlines()
    except OSError:
        return []
    rows: list[dict] = []
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            print(f'[queue] 破損行をskip: {path}:{i}', file=sys.stderr)
            continue
        if not isinstance(row, dict):  # "文字列" や [配列] 行が下流でAttributeErrorするのを防ぐ
            print(f'[queue] 非dict行をskip: {path}:{i}', file=sys.stderr)
            continue
        rows.append(row)
    return rows


def write_jsonl_atomic(path: str | os.PathLike, rows: list[dict]) -> None:
    """queueをtmp+os.replaceで書き換える — 中断しても旧queueは無傷。"""
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + '.tmp')
    tmp.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows),
                   encoding='utf-8')
    os.replace(tmp, p)
