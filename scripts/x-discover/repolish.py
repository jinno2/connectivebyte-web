#!/usr/bin/env python3
"""CB発見者 — 既存draftのpolish一括適用 (品質レベル適用・2026-09-14)。

polish導入前に起草された既存案を現行基準 (Q2意図: 字単位批評→改稿収束) で
見直す。対象 = 投稿対象になり得る行 (pick_draftと同一の生存条件: 48h窓内・
未投稿・status=draft/approved・実文draft)。改稿はQ3 persona gateを再通過 —
落ちたら旧案維持 (fail-open・post.pyは影響なし)。

  python3 repolish.py                 # 対象行をpolishして書込
  python3 repolish.py --dry           # 書込せず結果表示
  python3 repolish.py --force         # polish済み行も再polish
  python3 repolish.py --limit 2       # 1実行の最大行数 (分割適用)

既定でpolish_roundsを持たない行のみ処理 (冪等 — 2回目の実行は新規LLM呼出なし)。
polish_rounds=0は「批評が即収束」と「LLM全滅 (fail-open)」を区別しない —
全滅行の再検査は--forceで明示する。

書込は最後に1回だけ・直前にqueue再読込してcron競合を検出 (変化あれば中断)。
退避 (discover-queue.pre-repolish.jsonl) は一生に1回・最初の書込直前のみ —
2回目以降の--force実行にはsnapshotは無い。実行はcron時刻帯 (09:17/21:07の
前後) を外すこと (ループが数分〜数十分掛かるため)。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys

from collect import (llm_prompt, persona_review_draft, polish_draft)  # noqa: E402
from enrich import call_llm, load_env_file  # noqa: E402
from x_discover_rules import (in_post_window, preview_key, read_jsonl,  # noqa: E402
                              write_jsonl_atomic)

STATE_DIR = pathlib.Path.home() / '.local/share/cb-fleet'
# DISCOVER_QUEUE_PATH上書きは検証用 (collect.pyと同一の既定path・env上書き優先)
QUEUE = pathlib.Path(os.environ.get(
    'DISCOVER_QUEUE_PATH', str(STATE_DIR / 'discover-queue.jsonl')))


def _is_placeholder(row: dict) -> bool:
    hook = row.get('hook', '')
    return not hook or '要起草' in hook or '要記入' in hook


def _eligible(row: dict, today: dt.date, force: bool) -> bool:
    """投稿対象になり得る行のみ — post.py pick_draftの生存条件の鏡。
    窓外・投稿済み (posted_at)・blocked (persona落ちの永久死滅) は
    改善価値のない死人として対象外。"""
    if row.get('posted_at'):
        return False
    if row.get('status') not in ('draft', 'approved'):
        return False
    if _is_placeholder(row):
        return False
    if not in_post_window(row, today):
        return False
    return force or 'polish_rounds' not in row


def _dump(rows: list[dict]) -> str:
    return ''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows)


def main(today: dt.date | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dry', action='store_true', help='キューに書き込まない')
    ap.add_argument('--force', action='store_true', help='polish済み行も再polish')
    ap.add_argument('--limit', type=int, default=0, help='1実行の最大行数 (0=無制限)')
    args = ap.parse_args()

    load_env_file()
    if not QUEUE.exists():
        print(f'queue not found: {QUEUE}', file=sys.stderr)
        return 1
    rows = read_jsonl(QUEUE)
    original = [dict(r) for r in rows]  # 競合検出と退避用の改稿前snapshot
    today = today or dt.date.today()
    # 書き出し重複回避のrecent_hooksはcollectと同一 (直近6件)
    recent = [r['hook'] for r in rows if r.get('hook')][-6:]

    changed = 0
    for row in rows:
        if args.limit and changed >= args.limit:
            break
        if not _eligible(row, today, args.force):
            continue
        key = preview_key(row.get('url', ''))
        try:
            prompt = llm_prompt({'title': row.get('title', ''), 'url': row.get('url', '')},
                                row.get('genre_jp', ''), recent)
            draft = {k: row.get(k, '') for k in ('hook', 'take', 'ask')}
            polished, rounds = polish_draft(draft, prompt, call_llm,
                                            row.get('genre_jp', ''),
                                            row.get('title', ''))
            if rounds == 0:
                # 批評が即収束 (or LLM全滅fail-open) — 現案維持・検査済み印のみ
                row['polish_rounds'] = 0
                changed += 1
                print(f'  [repolish] {key}: 収束 (改稿なし)')
                continue
            verdict = persona_review_draft(polished['hook'], polished['take'],
                                           polished['ask'], row.get('title', ''),
                                           row.get('genre_jp', ''))
        except (OSError, ValueError) as e:
            # persona yaml不在/壊れ — 旧案維持で次の行へ (無persona差し替え禁止)
            print(f'  [repolish] {key}: persona gate ({e}) — 旧3行維持')
            continue
        if verdict is None or verdict.get('verdict') != 'pass':
            why = '審査不能' if verdict is None else f'persona ng ({verdict.get("reason", "")})'
            print(f'  [repolish] {key}: {why} — 旧3行維持')
            continue
        row.update(polished)
        row['polish_rounds'] = rounds
        row['persona_review'] = {'verdict': 'pass', 'reason': verdict.get('reason', ''),
                                 'reviewed_at': dt.datetime.now().astimezone()
                                 .isoformat(timespec='seconds')}
        changed += 1
        print(f'  [repolish] {key}: r{rounds}改稿採用 (persona pass)')
        print(f"      hook: {row['hook']}")

    if changed and not args.dry:
        # ループ中にcronが書いた場合、stale snapshotの書込はposted_at/statusを
        # 消す (再投稿・行消失) — 再読込して変化あれば中断する。
        if _dump(read_jsonl(QUEUE)) != _dump(original):
            print('queueが実行中に更新された (cron競合の恐れ) — 書込を中断'
                  ' (--dryで内容確認・時間を置いて再実行)', file=sys.stderr)
            return 1
        backup = QUEUE.parent / 'discover-queue.pre-repolish.jsonl'
        if not backup.exists():
            backup.write_text(_dump(original), encoding='utf-8')
        write_jsonl_atomic(QUEUE, rows)
        print(f'repolished: {changed} rows -> {QUEUE}')
    elif changed:
        print(f'repolished (dry): {changed} rows')
    else:
        print('no eligible rows (queue unchanged)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
