#!/usr/bin/env python3
"""CB発見者 — 版違いdraftの再生成 (生成物の版管理・2026-09-15)。

生成物は「作られたときのシステムversion」(gen_version/polish_version =
pipeline git短hash) を持つ。現行versionと異なる生存draft (48h窓内・未投稿・
status=draft/approved・実文) はstaleとして現行基準 (Q2意図: 字単位批評→
改稿収束) で再生成する。改稿はQ3 persona gateを再通過 — 落ちたら旧案維持
(fail-open・post.pyは影響なし)。

  python3 repolish.py                 # stale行を現行versionで再生成
  python3 repolish.py --dry           # 書込せず結果表示
  python3 repolish.py --force         # 現行versionの行も強制再polish
  python3 repolish.py --limit 2       # 1実行の最大行数 (0=無制限)

collectの朝loopも同一判定で再生成する (regen_stale — 既定limit 3/回・
残りは翌朝。システム更新後の自動追い付き)。polish_rounds=0は「批評が
即収束」と「LLM全滅 (fail-open)」を区別しない — 全滅行の再検査は--force。

書込は最後に1回だけ・直前にqueue再読込してcron競合を検出 (変化あれば中断)。
退避 (discover-queue.pre-repolish.jsonl) は一生に1回・最初の書込直前のみ。
実行はcron時刻帯 (09:17/21:07の前後) を外すこと (ループが数分〜数十分掛かる)。
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
from x_discover_rules import (in_post_window, pipeline_version, preview_key,  # noqa: E402
                              read_jsonl, write_jsonl_atomic)

STATE_DIR = pathlib.Path.home() / '.local/share/cb-fleet'
# DISCOVER_QUEUE_PATH上書きは検証用 (collect.pyと同一の既定path・env上書き優先)
QUEUE = pathlib.Path(os.environ.get(
    'DISCOVER_QUEUE_PATH', str(STATE_DIR / 'discover-queue.jsonl')))


def _is_placeholder(row: dict) -> bool:
    hook = row.get('hook', '')
    return not hook or '要起草' in hook or '要記入' in hook


def _eligible(row: dict, today: dt.date, force: bool) -> bool:
    """再生成対象 = post.py pick_draftの生存条件を満たすstale行。
    窓外・投稿済み (posted_at)・blocked (persona落ちの永久死滅) は
    改善価値のない死人として対象外。版判定: 現行versionで起草 (gen_version)
    または再検査/改稿 (polish_version) 済みの行は現行 — それ以外
    (無印・旧version・旧polish_roundsのみの行) はstale。"""
    if row.get('posted_at'):
        return False
    if row.get('status') not in ('draft', 'approved'):
        return False
    if _is_placeholder(row):
        return False
    if not in_post_window(row, today):
        return False
    if force:
        return True
    if row.get('polish_version') == pipeline_version():
        return False
    if 'polish_version' not in row and row.get('gen_version') == pipeline_version():
        return False
    return True


def _dump(rows: list[dict]) -> str:
    return ''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows)


def _apply(limit: int, force: bool, dry: bool,
           today: dt.date | None) -> int:
    """再生成loop本体 (main/sweep共用)。戻り値=処理行数、異常時は-1
    (mainはexit codeへ、sweepは再生成行数へ写像)。"""
    load_env_file()
    if not QUEUE.exists():
        print(f'queue not found: {QUEUE}', file=sys.stderr)
        return -1
    rows = read_jsonl(QUEUE)
    original = [dict(r) for r in rows]  # 競合検出と退避用の改稿前snapshot
    today = today or dt.date.today()
    # 書き出し重複回避のrecent_hooksはcollectと同一 (直近6件)
    recent = [r['hook'] for r in rows if r.get('hook')][-6:]

    changed = 0
    for row in rows:
        if limit and changed >= limit:
            break
        if not _eligible(row, today, force):
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
                # 批評が即収束 (or LLM全滅fail-open) — 現案維持。
                # 収束なら現行versionの検査済みとして印 (全滅は--forceで区別)
                row['polish_rounds'] = 0
                row['polish_version'] = pipeline_version()
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
        row['polish_version'] = pipeline_version()
        row['persona_review'] = {'verdict': 'pass', 'reason': verdict.get('reason', ''),
                                 'reviewed_at': dt.datetime.now().astimezone()
                                 .isoformat(timespec='seconds')}
        changed += 1
        print(f'  [repolish] {key}: r{rounds}改稿採用 (persona pass)')
        print(f"      hook: {row['hook']}")

    if changed and not dry:
        # ループ中にcronが書いた場合、stale snapshotの書込はposted_at/statusを
        # 消す (再投稿・行消失) — 再読込して変化あれば中断する。
        if _dump(read_jsonl(QUEUE)) != _dump(original):
            print('queueが実行中に更新された (cron競合の恐れ) — 書込を中断'
                  ' (--dryで内容確認・時間を置いて再実行)', file=sys.stderr)
            return -1
        backup = QUEUE.parent / 'discover-queue.pre-repolish.jsonl'
        if not backup.exists():
            backup.write_text(_dump(original), encoding='utf-8')
        write_jsonl_atomic(QUEUE, rows)
        print(f'repolished: {changed} rows -> {QUEUE}')
    elif changed:
        print(f'repolished (dry): {changed} rows')
    else:
        print('no eligible rows (queue unchanged)')
    return changed


def sweep(limit: int = 3, today: dt.date | None = None) -> int:
    """stale行の再生成1回分 — collect朝loop (regen_stale) から呼ぶ。"""
    return max(_apply(limit=limit, force=False, dry=False, today=today), 0)


def main(today: dt.date | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dry', action='store_true', help='キューに書き込まない')
    ap.add_argument('--force', action='store_true', help='現行versionの行も強制再polish')
    ap.add_argument('--limit', type=int, default=0, help='1実行の最大行数 (0=無制限)')
    args = ap.parse_args()
    return 0 if _apply(limit=args.limit, force=args.force,
                       dry=args.dry, today=today) >= 0 else 1


if __name__ == '__main__':
    sys.exit(main())
