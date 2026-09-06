#!/usr/bin/env python3
"""CB発見者 — 試用レポート反映 (tool-trial-automation連携・2026-09-06)。

x-discoverのdraft (hook/take/ask) を、サンドボックス試用レポートの実測事実に
根拠を置く案へ再起草する。trial runner (~/tool-trial-automation) はqueueを
読むだけ・trial系fieldの書き手は本scriptが唯一 (分離の正本はorder.md)。

  python3 enrich.py                       # 対象を自動選択 (trial_status未done)
  python3 enrich.py <preview_key> ...      # 指定keyのみ
  python3 enrich.py --dry                 # 書き込まずstdout
  python3 enrich.py --force               # trial_status=doneも再起草

対象: media_ok (製品頁) && trials/<preview_key>/report.json が success|partial
      && 行のtrial_status != done。冪等: 2回目の実行でqueue byteは不変。
fail-open: LLM失敗・規律違反・report無しは旧3行を維持 (post.pyは影響なし)。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys

from llm_backend import llm_text
from x_discover_rules import (BANNED_WORDS, ask_is_interrogative, banned_hits,
                              media_ok, preview_key)

STATE_DIR = pathlib.Path.home() / '.local/share/cb-fleet'
QUEUE = STATE_DIR / 'discover-queue.jsonl'
TRIALS_DIR = pathlib.Path(os.environ.get(
    'TRIAL_STATE_DIR', str(STATE_DIR / 'trials')))

# post.py build_text (link_policy=none) + t.co 23字込みで280字超えない上限
MAX_TOTAL_CHARS = 280 - 23


def load_env_file() -> None:
    """cron用: ~/.local/share/cb-fleet/.env を os.environ へ (既存env優先)。"""
    try:
        for line in (STATE_DIR / '.env').read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k, v)
    except OSError:
        pass


def facts_digest(rep: dict) -> str:
    """report.json → 起草prompt用の事実digest (tool-trial-automation
    trialFactsDigestと同一意味・15行cap)。秘密は含まれない。"""
    lines: list[str] = []
    tool = rep.get('tool') or {}
    lines.append(f"対象: {rep.get('title', '')} ({tool.get('repo_full_name') or rep.get('url', '')})")
    lang = f"/{tool['language']}" if tool.get('language') else ''
    lines.append(f"status={rep.get('status', '')} 種別={rep.get('project_type', '')}{lang}")
    setup = rep.get('setup') or {}
    blockers = setup.get('blockers') or []
    b = f" (blockers: {', '.join(map(str, blockers))})" if blockers else ''
    lines.append(f"導入: {setup.get('path', '')} {setup.get('duration_s', '')}s{b}")
    launch = rep.get('launch') or {}
    if rep.get('project_type') == 'web_app' and launch.get('url'):
        startup = f"{launch['startup_s']}s " if launch.get('startup_s') is not None else ''
        lines.append(f"起動: {launch.get('result', '')} {startup}{launch['url']}")
    if rep.get('requires_credentials'):
        lines.append('クレジッシャル要求: あり (login/APIキー必須で未実施操作あり)')
    verdict = rep.get('verdict') or {}
    for f in verdict.get('facts_ja') or []:
        lines.append(f'事実: {f}')
    for f in verdict.get('friction_ja') or []:
        lines.append(f'摩擦: {f}')
    ver = rep.get('verification') or {}
    v = '決定的検証pass' if ver.get('verified') else '検証未pass'
    lines.append(f"検証: {v} ({len(ver.get('checks') or [])}項目)")
    inter = rep.get('interaction') or {}
    if inter.get('mode') == 'browser':
        ev = rep.get('evidence') or {}
        extra = '+動画' if ev.get('video') else ''
        lines.append(f"操作: {len(inter.get('steps') or [])}step "
                     f"{len(ev.get('shots') or [])}ショット{extra}")
    return '\n'.join(lines[:15])


def enrich_prompt(row: dict, digest: str, recent_hooks: list[str]) -> str:
    """再起草prompt — collect.py llm_promptと同一規律 (§11)・excerptを実測事実へ差換え。"""
    lines = ['あなたはAI情報発掘メディアの起草者。対象ツールをサンドボックスで'
             '実際に試用した自動レポートがある。X投稿1件分の日本語案のみを出力する。']
    lines += [
        '形式 (3要素をそれぞれ1行、区切りなし、余計な説明禁止):',
        '1行目: 発見の一句 (40字以内・断定調・書き出しの型を固定しない)',
        '2行目: 自説1-2文 (なぜ重要か・独自の視点・80字以内・個人体験を語らない)',
        '3行目: 読者への問い1つ (replyを誘う・30字以内・「？」で終える)',
        '禁止語 (誇張・代入肯定・X運用基本計画§11): ' + '/'.join(BANNED_WORDS),
        '賞賛の形容詞で始めず、事実と含意を分けて書く (評価は根拠の後に限る)。',
        '制約: 題名・URL・レポートに無い固有名詞・製品名を作らない。',
        'サービス・記事の公式名称 (題名・URLの固有名) は1行目か2行目に必ず1回'
        'そのまま正式名称で含める (X検索流入のため・2026-09-05)。',
        '数字の独自推計もしない。',
    ]
    if recent_hooks:
        lines.append('直近の投稿の一句 (書き出し・語尾がこれらと重複しないこと):')
        lines += [f'・{h}' for h in recent_hooks]
    lines += [
        f"ジャンル: {row.get('genre_jp', '')}", f"題名: {row.get('title', '')}",
        f"URL: {row.get('url', '')}",
        'URLは出力に含めない (投稿システムが別途付与する)。',
        f'実測レポート (サンドボックス試用の機械記録): {digest}',
        '自説はこの実測事実にのみ根拠を置く。レポートから読み取れないことは書かない。',
        '試用で判明した具体 (摩擦・所要時間・検証結果) を1つは自説に含めること。',
    ]
    return '\n'.join(lines)


def call_llm(prompt: str) -> dict | None:
    """3行応答を {hook,take,ask} へ (collect.py llm_draft.callと同一構造)。"""
    for _ in range(3):  # 間欠失敗対策
        text = llm_text(prompt)
        if not text:
            continue
        got = [l.strip() for l in text.splitlines() if l.strip()]
        if len(got) >= 3:
            return {'hook': got[0], 'take': got[1], 'ask': got[2]}
        print(f'      [llm] short/empty reply (len={len(text)})')
    return None


def discipline_violation(draft: dict) -> str | None:
    """§11機械検査 (post.pyと同一条件+総字数)。違反なら理由を返す。"""
    hits = banned_hits(draft['hook'], draft['take'], draft['ask'])
    if hits:
        return 'banned_word: ' + '/'.join(hits)
    if not ask_is_interrogative(draft['ask']):
        return 'ask_not_interrogative'
    text = f"{draft['hook']}\n{draft['take']}\n\n{draft['ask']}"
    if len(text) > MAX_TOTAL_CHARS:
        return f'too_long: {len(text)}>{MAX_TOTAL_CHARS}'
    return None


def load_queue() -> list[dict]:
    return [json.loads(l) for l in QUEUE.read_text().splitlines() if l.strip()]


def save_queue(rows: list[dict]) -> None:
    QUEUE.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('keys', nargs='*', help='preview_key (無ければ対象を自動選択)')
    ap.add_argument('--dry', action='store_true', help='キューに書き込まない')
    ap.add_argument('--force', action='store_true', help='trial_status=doneも再起草')
    args = ap.parse_args()

    load_env_file()
    try:
        rows = load_queue()
    except OSError as e:
        print(f'queue unreadable: {e}', file=sys.stderr)
        return 1
    before = ''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows)
    recent = [r['hook'] for r in rows if r.get('hook')][-6:]

    changed = 0
    for row in rows:
        key = preview_key(row.get('url', ''))
        if args.keys and key not in args.keys:
            continue
        if not media_ok(row):
            continue
        if row.get('trial_status') == 'done' and not args.force:
            continue
        report_path = TRIALS_DIR / key / 'report.json'
        if not report_path.exists():
            if args.keys:
                print(f'  [enrich] {key}: report無し (skip)')
            continue
        try:
            rep = json.loads(report_path.read_text())
        except (OSError, json.JSONDecodeError) as e:
            print(f'  [enrich] {key}: report破損 ({e}) — 旧3行維持')
            continue

        if rep.get('status') not in ('success', 'partial'):
            # fail/unsafe/blocked → trio不変・statusのみmirror (fail-open)
            row['trial_status'] = rep.get('status', 'fail')
            print(f"  [enrich] {key}: report status={rep.get('status')} — trio不変")
            changed += 1
            continue

        digest = facts_digest(rep)
        draft = call_llm(enrich_prompt(row, digest, recent))
        if draft is None:
            print(f'  [enrich] {key}: LLM失敗 — 旧3行維持 (翌朝retry)')
            continue
        violation = discipline_violation(draft)
        if violation:
            row['trial_enrich_status'] = 'discipline_violation'
            row['trial_enrich_violation'] = violation
            print(f'  [enrich] {key}: 規律違反 ({violation}) — 旧3行維持')
            continue
        if 'trial_original' not in row:
            row['trial_original'] = {k: row.get(k, '') for k in ('hook', 'take', 'ask')}
        row.update(draft)
        row['trial_status'] = 'done'
        row['trial_report'] = (rep.get('verdict') or {}).get('summary_ja', '')
        row['trial_report_md'] = str((TRIALS_DIR / key / 'report.md').resolve())
        row['trial_enriched_at'] = dt.datetime.now().astimezone().isoformat(timespec='seconds')
        row.pop('trial_enrich_status', None)
        row.pop('trial_enrich_violation', None)
        changed += 1
        print(f'  [enrich] {key}: take差し替え')
        print(f"      hook: {row['hook']}")
        print(f"      take: {row['take']}")

    after = ''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows)
    if changed and not args.dry and after != before:
        save_queue(rows)
        print(f'enriched: {changed} rows -> {QUEUE}')
    elif changed:
        print(f'enriched (dry): {changed} rows')
    else:
        print('no eligible rows (queue unchanged)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
