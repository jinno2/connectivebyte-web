#!/usr/bin/env python3
"""CB発見者 — 素材収集・起草キュー (v0・keyless).

毎日1回動かす前提: 当日のカレンダージャンル (GENRES.md) で HN / GitHub / Reddit から
候補を集め、スコア順にキュー (draft) へ追記する。投稿はしない (承認は別工程)。

  python3 collect.py                # 収集+起草 (LITELLM_API_KEYあれば自説も生成)
  python3 collect.py --no-llm       # LLM起草なし (プレースホルダ)
  python3 collect.py --dry          # キュー書き込まずstdoutのみ

state: ~/.local/share/cb-fleet/discover-state.json  (seen URL重複排除)
queue: ~/.local/share/cb-fleet/discover-queue.jsonl (1行1draft)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import urllib.request

from x_discover_rules import BANNED_WORDS, ask_is_interrogative, banned_hits

STATE_DIR = pathlib.Path.home() / '.local/share/cb-fleet'
STATE = STATE_DIR / 'discover-state.json'
QUEUE = STATE_DIR / 'discover-queue.jsonl'

UA = {'User-Agent': 'cb-x-discover/0.1 (curation research)'}

# GENRES.md のジャンル定義。first-match分類 (上ほど優先)。
GENRES: dict[str, dict] = {
    'core_model': {'jp': 'LLM新モデル・ベンチ・価格', 'kw': [
        'llm', 'gpt', 'claude', 'gemini', 'llama', 'qwen', 'deepseek', 'mistral',
        'benchmark', 'model release', 'inference cost', 'tokenizer', 'context window',
        'open weights', 'frontier model', 'model pricing']},
    'core_agent': {'jp': 'エージェント・業務自動化', 'kw': [
        'agent', 'agentic', 'automation', 'workflow', 'mcp', 'orchestration',
        'browser use', 'rpa', 'copilot', 'function calling', 'tool use']},
    'core_org': {'jp': '組織導入・事例', 'kw': [
        'enterprise', 'adoption', 'deployment', 'roi', 'case study', 'productivity',
        'organization', 'workplace', 'employees', 'rollout']},
    'dev_sec': {'jp': 'セキュリティ・情報流出', 'kw': [
        'breach', 'leak', 'leaked', 'vulnerability', 'cve', 'exploit', 'exfiltrat',
        'prompt injection', 'security', 'ransomware', 'phishing', 'backdoor']},
    'dev_tool': {'jp': 'OSS・開発ツール', 'kw': [
        'open source', 'framework', 'library', 'cli', 'developer tool', 'sdk',
        'rust', 'typescript', 'self-host', 'terminal', 'editor', 'lsp']},
    'broad_creative': {'jp': '生成AIアート・一般', 'kw': [
        'image generation', 'video generation', 'diffusion', 'sora', 'music',
        'art', 'creative', 'voice cloning', 'avatar', 'meme']},
    'bridge_game': {'jp': 'ゲーム×AI', 'kw': [
        'game', 'gaming', 'npc', 'procedural generation', 'minecraft', 'unity',
        'gameplay', 'roguelike']},
    'broad_career': {'jp': '仕事・キャリア×AI', 'kw': [
        'job', 'jobs', 'career', 'hiring', 'employment', 'resume', 'recruiting',
        'layoff', 'skills', 'labor market']},
}

# 曜日→ジャンル (月始まり)。日曜はgame/career週交互。
CALENDAR = {0: 'core_model', 1: 'dev_tool', 2: 'core_agent', 3: 'dev_sec',
            4: 'core_org', 5: 'broad_creative'}


def calendar_genre(today: dt.date) -> str:
    if today.weekday() != 6:
        return CALENDAR[today.weekday()]
    iso = today.isocalendar()
    return 'bridge_game' if iso[1] % 2 else 'broad_career'


def http_json(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


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


def collect_hn(queries: list[str]) -> list[dict]:
    """HN Algolia: フロントページ + ジャンルクエリ (created within 48h)。"""
    items: dict[str, dict] = {}
    urls = ['https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50']
    epoch = int(dt.datetime.now(dt.timezone.utc).timestamp()) - 48 * 3600
    for q in queries:
        from urllib.parse import quote
        urls.append('https://hn.algolia.com/api/v1/search_by_date?query='
                    f'{quote(q)}&tags=story&numericFilters=created_at_i%3E{epoch}'
                    '&hitsPerPage=15')
    for u in urls:
        try:
            data = http_json(u)
        except Exception as e:  # best-effort
            print(f'  hn source skipped: {e}', file=sys.stderr)
            continue
        for h in data.get('hits', []):
            url = h.get('url') or f'https://news.ycombinator.com/item?id={h.get("objectID")}'
            if url in items:
                continue
            created = dt.datetime.fromtimestamp(h.get('created_at_i', 0), dt.timezone.utc)
            age_h = max((dt.datetime.now(dt.timezone.utc) - created).total_seconds() / 3600, 1)
            score = (h.get('points', 0) + 2 * h.get('num_comments', 0)) / age_h
            items[url] = {'title': h.get('title') or '', 'url': url,
                          'source': 'hn', 'score': round(score, 2),
                          'points': h.get('points', 0), 'comments': h.get('num_comments', 0),
                          'created': created.isoformat()}
    return list(items.values())


def collect_github(queries: list[str]) -> list[dict]:
    """GitHub repo search: 直近7日作成・star順 (keyless・1クエリ/秒未満)。"""
    import time
    out = []
    since = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    for q in queries:
        from urllib.parse import quote
        u = ('https://api.github.com/search/repositories?q='
             f'{quote(q)}+created:>{since}&sort=stars&order=desc&per_page=10')
        try:
            data = http_json(u)
        except Exception as e:
            print(f'  github source skipped: {q}: {e}', file=sys.stderr)
            continue
        for r in data.get('items', []):
            stars = r.get('stargazers_count', 0)
            if stars < 100:
                continue
            out.append({'title': f'{r.get("full_name","")} — {r.get("description") or ""}'.strip(),
                        'url': r.get('html_url', ''), 'source': 'github',
                        'score': float(stars), 'points': stars, 'comments': 0,
                        'created': r.get('created_at', '')})
        time.sleep(1.2)
    return out


AI_KW = ('ai ', ' ai', 'llm', 'gpt', 'claude', 'gemini', 'model', 'agent', 'neural',
         'machine learning', 'openai', 'anthropic', 'diffusion', 'robot', 'llama',
         'deepseek', 'qwen', 'chatbot', 'copilot')
GH_JUNK = ('trainer', 'booster', 'cheat', 'crack', 'aimbot', 'mod-menu', 'unlocker')


def is_ai_related(text: str) -> bool:
    t = f' {text.lower()} '
    return any(k in t for k in AI_KW)


def classify(title: str, desc: str) -> str | None:
    text = f'{title} {desc}'.lower()
    for g, spec in GENRES.items():
        if any(k in text for k in spec['kw']):
            return g
    return None


def fetch_excerpt(url: str, limit: int = 1600) -> str:
    """URL本文の抜粋 (best-effort・起草の根拠付け用)。失敗/重い/非テキストは空。"""
    import re
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=8) as r:
            ctype = r.headers.get_content_type()
            if r.status != 200 or not ctype.startswith(('text/', 'application/json')):
                return ''
            raw = r.read(300_000).decode('utf-8', 'ignore')
    except Exception:
        return ''
    raw = re.sub(r'(?is)<(script|style|nav|header|footer|svg)[^>]*>.*?</\1>', ' ', raw)
    text = re.sub(r'(?s)<[^>]+>', ' ', raw)
    return re.sub(r'\s+', ' ', text).strip()[:limit]


def llm_prompt(item: dict, genre_jp: str, recent_hooks: list[str], excerpt: str = '') -> str:
    """起草prompt — X運用基本計画§11 (生成ルール) 準拠。"""
    lines = ['あなたはAI情報発掘メディアの起草者。X投稿1件分の日本語案のみを出力する。']
    lines += [
        '形式 (3要素をそれぞれ1行、区切りなし、余計な説明禁止):',
        '1行目: 発見の一句 (40字以内・断定調・書き出しの型を固定しない)',
        '2行目: 自説1-2文 (なぜ重要か・独自の視点・80字以内・個人体験を語らない)',
        '3行目: 読者への問い1つ (replyを誘う・30字以内・「？」で終える)',
        '禁止語 (誇張・代入肯定・X運用基本計画§11): ' + '/'.join(BANNED_WORDS),
        '賞賛の形容詞で始めず、事実と含意を分けて書く (評価は根拠の後に限る)。',
        '制約: 題名に無い固有名詞・製品名を作らない (一般形で書く)。'
        '数字の独自推計もしない。',
    ]
    if recent_hooks:
        lines.append('直近の投稿の一句 (書き出し・語尾がこれらと重複しないこと):')
        lines += [f'・{h}' for h in recent_hooks]
    lines += [
        f'ジャンル: {genre_jp}', f'題名: {item["title"]}', f'URL: {item["url"]}',
        'URLは出力に含めない (投稿システムが別途付与する)。',
    ]
    if excerpt:
        lines += [
            f'本文抜粋 (実際に取得したページ内容): {excerpt}',
            '自説はこの抜粋の内容に根拠を置く。抜粋から読み取れないことは書かない。',
        ]
    return '\n'.join(lines)


def llm_draft(item: dict, genre_jp: str, recent_hooks: list[str],
              excerpt: str = '') -> dict | None:
    """litellm proxy経由で一句+自説+問いを起草。keyは環境変数のみ。

    起草結果が§11機械検査 (禁止語/問い形) に落ちたら1回だけ再試行する。
    """
    key = os.environ.get('LITELLM_API_KEY')
    if not key:
        return None
    prompt = llm_prompt(item, genre_jp, recent_hooks, excerpt)
    def call(p: str) -> dict | None:
        body = json.dumps({'model': 'default', 'max_tokens': 2500,
                           'messages': [{'role': 'user', 'content': p}]}).encode()
        req = urllib.request.Request(
            'http://localhost:14000/v1/chat/completions', data=body,
            headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
        text = data['choices'][0]['message']['content'].strip()
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if len(lines) < 3:
            return None
        return {'hook': lines[0], 'take': lines[1], 'ask': lines[2]}

    draft = call(prompt)
    if draft is None:
        return None
    hits = banned_hits(draft['hook'], draft['take'], draft['ask'])
    if hits or not ask_is_interrogative(draft['ask']):
        note = f'前案は規律違反 (禁止語: {"/".join(hits) or "なし"}・問い形不備)。書き直す。'
        retry = call(prompt + '\n' + note)
        if retry is not None:
            draft = retry
    return draft


def recent_hooks(limit: int = 6) -> list[str]:
    """キュー末尾のhook一覧 (均一化回避のため起草promptへ渡す)。"""
    try:
        rows = [json.loads(l) for l in QUEUE.read_text().splitlines() if l.strip()]
    except OSError:
        return []
    return [r['hook'] for r in rows if r.get('hook')][-limit:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true', help='キューに書き込まない')
    ap.add_argument('--no-llm', action='store_true', help='LLM起草をスキップ')
    args = ap.parse_args()

    load_env_file()
    today = dt.date.today()
    genre = calendar_genre(today)
    spec = GENRES[genre]
    print(f'today={today} genre={genre} ({spec["jp"]})')

    hn = collect_hn([spec['kw'][0], spec['kw'][1] if len(spec['kw']) > 1 else spec['jp']])
    gh_kw = [' '.join(spec['kw'][:2]), 'ai ' + spec['kw'][0]]
    gh = collect_github(gh_kw)

    seen: set[str] = set()
    if STATE.exists():
        seen = set(json.loads(STATE.read_text()).get('seen', []))
    cands = [c for c in hn + gh
             if c['url'] and c['url'] not in seen
             and is_ai_related(c['title'])
             and not (c['source'] == 'github'
                      and any(j in c['title'].lower() for j in GH_JUNK))]
    for c in cands:
        c['genre'] = classify(c['title'], '') or genre
    cal = [c for c in cands if c['genre'] == genre]
    pool = cal if cal else cands
    pool.sort(key=lambda c: (c['source'] == 'hn', c['score']), reverse=True)
    picked = pool[:3]
    print(f'candidates={len(cands)} calendar-matched={len(cal)} picked={len(picked)}')
    if not picked:
        print('no candidates today (all seen or empty sources)')
        return 0

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    hooks = recent_hooks()
    drafts = []
    for item in picked:
        draft = {
            'date': today.isoformat(),
            'genre': item['genre'],
            'genre_jp': GENRES[item['genre']]['jp'],
            'title': item['title'][:200],
            'url': item['url'],
            'source': item['source'],
            'score': item['score'],
            'points': item.get('points'),
            'comments': item.get('comments'),
            'created': item.get('created'),
            'status': 'draft',
        }
        if args.no_llm:
            draft.update({'hook': '【要起草】', 'take': '【自説: 要記入】', 'ask': '【問い: 要記入】'})
        else:
            got = llm_draft(item, GENRES[item['genre']]['jp'], hooks,
                            fetch_excerpt(item['url']))
            draft.update(got or {'hook': '【要起草】', 'take': '【LLM失敗: 要記入】', 'ask': '【問い: 要記入】'})
        drafts.append(draft)
        seen.add(item['url'])
        print(f'  [{item["genre"]}] {item["score"]:>8.2f} {item["title"][:70]}')
        print(f'      hook: {draft["hook"]}')
        print(f'      take: {draft["take"]}')
        hits = banned_hits(draft['hook'], draft['take'], draft['ask'])
        if hits:
            print(f'      ⚠ 禁止語残存 (review/postで検出): {"/".join(hits)}')

    if not args.dry:
        with QUEUE.open('a') as f:
            for d in drafts:
                f.write(json.dumps(d, ensure_ascii=False) + '\n')
        STATE.write_text(json.dumps({'seen': sorted(seen)}, ensure_ascii=False))
        print(f'queue appended: {len(drafts)} -> {QUEUE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
