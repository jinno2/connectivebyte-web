#!/usr/bin/env python3
"""CB発見者 承認flow — queue内draftの確認・承認 (jinno 30秒/日)

collect.py が毎朝溜めた draft (status=draft) を新しい方から表示し、
approve したものだけが post.py の投稿対象になる。

  python3 review.py                # 未承認draftを表示 (推奨=★本日 最高score)
  python3 review.py approve 12     # 番号12を承認
  python3 review.py reject 12      # 番号12を却下
  python3 review.py --all          # posted/rejected含む全queueを簡易表示

番号 = queue内の行位置。既存行はcollectで動かないため、翌朝以降も同じ番号が有効
(表示順は新しい方だが、番号は行位置そのもの)。
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys

STATE_DIR = os.path.expanduser('~/.local/share/cb-fleet')
QUEUE_FILE = os.path.join(STATE_DIR, 'discover-queue.jsonl')


def load_queue() -> list[dict]:
    try:
        return [json.loads(l) for l in open(QUEUE_FILE, encoding='utf-8') if l.strip()]
    except OSError:
        return []


def save_queue(entries: list[dict]) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(QUEUE_FILE, 'w', encoding='utf-8') as f:
        for d in entries:
            f.write(json.dumps(d, ensure_ascii=False) + '\n')


def draft_rows(entries: list[dict]) -> list[tuple[int, dict]]:
    """未承認 (draft) を (行index, dict) で新しい方から返す。"""
    rows = [(i, d) for i, d in enumerate(entries) if d.get('status') == 'draft']
    rows.sort(key=lambda t: (t[1].get('date', ''), t[1].get('score') or 0), reverse=True)
    return rows


def show(entries: list[dict]) -> None:
    rows = draft_rows(entries)
    if not rows:
        counts: dict[str, int] = {}
        for d in entries:
            counts[d.get('status', '?')] = counts.get(d.get('status', '?'), 0) + 1
        print(f'未承認draftなし (queue {len(entries)}件: {counts or "空"})')
        return
    today = dt.date.today().isoformat()
    best_today = max((d for _, d in rows if d.get('date') >= today),
                     key=lambda d: d.get('score') or 0, default=None)
    print(f'未承認 {len(rows)}件 (新しい方から表示。推奨=★本日 最高score):\n')
    for i, d in rows:
        mark = '★ ' if d is best_today else '  '
        print(f'{mark}[{i}] {d.get("date")} {d.get("genre")} score={d.get("score")} ({d.get("source")})')
        print(f'      hook: {d.get("hook")}')
        print(f'      take: {d.get("take")}')
        print(f'      ask : {d.get("ask")}')
        print(f'      url : {d.get("url")}\n')
    print('→ review.py approve <番号> / reject <番号>')


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'show'
    entries = load_queue()

    if cmd == 'show':
        show(entries)
        return 0
    if cmd == '--all':
        for i, d in enumerate(entries):
            extra = f' → {d.get("tweet_id")}' if d.get('tweet_id') else ''
            print(f'[{i}] {d.get("date")} {d.get("status", "?"):9} {d.get("genre")} {d.get("hook", "")[:44]}{extra}')
        return 0
    if cmd in ('approve', 'reject') and len(sys.argv) > 2 and sys.argv[2].isdigit():
        i = int(sys.argv[2])
        if not (0 <= i < len(entries)) or entries[i].get('status') != 'draft':
            print(f'[{i}] は未承認draftではない (review.py show で番号確認)', file=sys.stderr)
            return 1
        entries[i]['status'] = 'approved' if cmd == 'approve' else 'rejected'
        entries[i]['reviewed_at'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
        save_queue(entries)
        print(f'{cmd}d [{i}]: {entries[i]["hook"]}')
        return 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
