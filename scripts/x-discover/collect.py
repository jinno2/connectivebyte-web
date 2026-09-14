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
import re
import subprocess
import sys
import urllib.request

from llm_backend import llm_text
from x_discover_rules import (BANNED_WORDS, ask_is_interrogative,
                              banned_hits, discipline_violation, in_post_window,
                              read_jsonl, write_jsonl_atomic)

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


def persona_lines() -> list[str]:
    """media persona (publishing-engine/personas/x-discoverer.yaml) をprompt行へ変換。

    媒体=x-discoverer (cb_discoverer 垢・発掘メディア) に対応する配備は
    x-discoverer.yaml (PER-JP-0010・CB-B2探索期「短い実演」)。x-fleet.yaml
    (PER-JP-0008 CB-B1) はP4事業媒体の別面 — 誤接続を2026-09-14修正。
    全媒体ペルソナレビュー必須(2026-09-14) — persona yaml未接続の起草は禁止。
    yaml不在/壊れ=例外→llm_draftがNone→draftは【要起草】→post.pyがskip (fail-closed)。
    """
    path = os.environ.get(
        'PERSONA_YAML',
        str(pathlib.Path.home() / 'connectivebyte-publishing-engine/personas/x-discoverer.yaml'))
    text = pathlib.Path(path).read_text(encoding='utf-8')
    out = []
    for key in ('three_seconds', 'read_through', 'action'):
        m = re.search(rf'^  {key}: (.+)$', text, re.M)
        if not m:
            raise ValueError(f'persona yaml missing key: {key} ({path})')
        out.append(f'{key}: {m.group(1).strip()}')
    return ['読者ペルソナ (CB-B2探索期・タイムラインで3秒「未知の変化として自分の関心に関係があるか」を判定):'] + out


def persona_review_draft(hook: str, take: str, ask: str,
                         title: str = '', genre_jp: str = '') -> dict | None:
    """投稿前ペルソナ全件チェック (LLM審査・2026-09-14)。

    「X投稿は投稿前に全件ペルソナチェック」の機構部品。起草とは別の1呼出で、
    x-discoverer personaの3段階 (3秒/読了/行動) をなり切り判定させる。
    戻り値: {'verdict': 'pass'|'ng', 'reason': str} / 審査不能時は None
    (LLM全滅・応答不備・yaml不在)。Noneをpassに替えない — 呼び出し側は
    unreviewedとして記録し、post.pyが投稿を拒む (fail-closed)。
    """
    if os.environ.get('LLM_BACKEND') != 'codex' and not os.environ.get('LITELLM_API_KEY'):
        return None
    try:
        persona = persona_lines()
    except (OSError, ValueError):
        return None
    prompt = '\n'.join([
        'あなたはX投稿の投稿前審査者。次の読者ペルソナになり切り、投稿案を判定する。',
        *persona,
        '判定はペルソナの3段階に忠実に: ①3秒 (タイムラインで止まるか) ②読了 '
        '(何の観測か一文でつかめるか・未定義語に依存しないか) ③行動 '
        '(追跡リストに入れる/正本を見に行く/様子を見る、のどれかが決まるか)',
        'ngにするのはこの種の欠陥だけ: 未定義語に依存して単体でつかえない / '
        '自説が素材・題名と繋がらない / 題名やURLに無い固有名詞の創作 / '
        '一般論の繰り返しで観測そのものが伝わらない。',
        '文章の好みや「特に驚かない」はng理由にしない (それはこの媒体のbarではない)。',
    ])
    if title:
        prompt += f'\n題名: {title}'
    if genre_jp:
        prompt += f'\nジャンル: {genre_jp}'
    prompt += '\n投稿案:\n' + '\n'.join([hook, take, '', ask]) + '\n' + '\n'.join([
        '出力形式 (2行のみ・他は書かない):', 'verdict: pass', 'reason: 40字以内の根拠',
    ])
    try:
        text = llm_text(prompt)
    except Exception as e:  # noqa: BLE001 — backend例外も審査不能扱い (unreviewed)
        print(f'      [persona] review LLM error: {e.__class__.__name__}')
        return None
    if not text:
        return None
    verdict = reason = None
    for line in text.splitlines():
        line = line.strip()
        m = re.match(r'^verdict:\s*(pass|ng)\s*$', line)
        if m:
            verdict = m.group(1)
        m = re.match(r'^reason:\s*(.+)$', line)
        if m and reason is None:
            reason = m.group(1).strip()[:120]
    if verdict not in ('pass', 'ng'):
        return None
    return {'verdict': verdict, 'reason': reason or ''}


def attach_persona_review(draft: dict, title: str = '', genre_jp: str = '') -> dict:
    """draftへ persona_review を付与 (審査不能は unreviewed — 無印投稿禁止)。"""
    verdict = persona_review_draft(draft.get('hook', ''), draft.get('take', ''),
                                   draft.get('ask', ''), title, genre_jp)
    if verdict is None:
        return {'verdict': 'unreviewed', 'reason': '審査LLM失敗 (翌朝collectが再審査)'}
    return verdict


def llm_prompt(item: dict, genre_jp: str, recent_hooks: list[str], excerpt: str = '') -> str:
    """起草prompt — X運用基本計画§11 (生成ルール) 準拠 + media persona (必須)。"""
    lines = ['あなたはAI情報発掘メディアの起草者。X投稿1件分の日本語案のみを出力する。']
    lines += persona_lines()
    lines += [
        '自説はこの読者の「自分でも試せるか」に答えること (単なる驚きの報告は不可)。',
    ]
    lines += [
        '形式 (3要素をそれぞれ1行、区切りなし、余計な説明禁止):',
        '1行目: 発見の一句 (40字以内・断定調・書き出しの型を固定しない)',
        '2行目: 自説1-2文 (なぜ重要か・独自の視点・80字以内・個人体験を語らない)',
        '3行目: 読者への問い1つ (replyを誘う・30字以内・「？」で終える)',
        '禁止語 (誇張・代入肯定・X運用基本計画§11): ' + '/'.join(BANNED_WORDS),
        '賞賛の形容詞で始めず、事実と含意を分けて書く (評価は根拠の後に限る)。',
        '制約: 題名・URL・抜粋に無い固有名詞・製品名を作らない。',
        'サービス・記事の公式名称 (題名・URLの固有名) は1行目か2行目に必ず1回'
        'そのまま正式名称で含める (X検索流入のため・2026-09-05)。',
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
              excerpt: str = '', note: str = '') -> dict | None:
    """LLMで一句+自説+問いを起草 (backend=LLM_BACKEND env)。

    litellm: proxy localhost:14000経由・modelはLITELLM_MODEL env。
      2026-09-05〜上流zai glm-5.2が401(key無効)・minimaxが402(quota枯渇)のため
      qwen3.8-max-preview-direct退避運用 → 同日さらにcodex backendを追加。
    codex:   Codex CLI非対話モード (codex exec・ChatGPTサブスク・公式自動化IF)。
      2026-09-05〜LLM_BACKEND=codex で運用(.env)・1呼出〜15秒。
    起草結果が§11機械検査 (禁止語/問い形) に落ちたら1回だけ再試行する。
    """
    if os.environ.get('LLM_BACKEND') != 'codex' and not os.environ.get('LITELLM_API_KEY'):
        return None
    try:
        prompt = llm_prompt(item, genre_jp, recent_hooks, excerpt)
    except (OSError, ValueError) as e:
        print(f'      [llm] persona gate: {e}')
        return None
    if note:
        prompt += '\n' + note
    def call(p: str) -> dict | None:
        text = llm_text(p)
        if not text:
            return None
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        if len(lines) < 3:
            print(f'      [llm] short/empty reply (len={len(text)})')
            return None
        return {'hook': lines[0], 'take': lines[1], 'ask': lines[2]}

    # 間欠失敗 (空応答・proxy一時障害) 対策: 最大3回
    draft = None
    for _ in range(3):
        draft = call(prompt)
        if draft is not None:
            break
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
    rows = read_jsonl(QUEUE)
    return [r['hook'] for r in rows if r.get('hook')][-limit:]


def refill_placeholders(dry: bool = False, limit: int = 3,
                        today: dt.date | None = None) -> int:
    """queue内の未起草draft (【要起草】) を再起草して置き換える。

    LLM失敗でappendされたdraftは誰も再処理せず滞留し承認draftが枯渇する
    (2026-09-03時点で9件滞留が実測) — 毎回のcollectで回収する。冪等:
    起草できた行だけ置換・できなければ残して翌朝再試行 (ただし48h窓を過ぎて
    agingした行は対象外 — 二度と投稿されないため)。
    limit/回で実行時間をboundedに (残りは翌朝へ)。
    対象はrereview/redraftと同一の48h窓 (当日+前日) — 窓外の滞留行は
    post.py pick_draftでも投稿対象外なのでlimitを浪費させない (2026-09-14)。
    """
    if limit <= 0 or not QUEUE.exists():
        return 0
    today = today or dt.date.today()
    rows = read_jsonl(QUEUE)
    hooks = recent_hooks()
    n = 0
    for r in rows:
        if n >= limit:
            break
        if r.get('status') != 'draft' or r.get('hook') != '【要起草】':
            continue
        if not in_post_window(r, today):
            continue
        item = {'title': r.get('title', ''), 'url': r.get('url', ''),
                'source': r.get('source', ''), 'score': r.get('score', 0)}
        got = llm_draft(item, r.get('genre_jp', ''), hooks, fetch_excerpt(item['url']))
        if got:
            r.update(got)
            r['persona_review'] = attach_persona_review(r, item['title'], r.get('genre_jp', ''))
            n += 1
            print(f'  [refill] {item["title"][:60]}')
            print(f'      hook: {r["hook"]}')
            print(f"      persona: {r['persona_review']['verdict']}")
    if n and not dry:
        write_jsonl_atomic(QUEUE, rows)
        print(f'refilled: {n} rows -> {QUEUE}')
    return n


def rereview_unreviewed(dry: bool = False, limit: int = 3, today: dt.date | None = None) -> int:
    """persona_review無し/unreviewedの実文draftを再審査する (自己修復・2026-09-14)。

    審査LLM失敗で unreviewed のまま残ったdraftは post.py が永遠に投稿しない
    (fail-closedの帰結) — 毎朝のcollectで回収する。approved行も対象 (判定付与
    のみ)。refillと同一のbounded limit・冪等 (pass/ngが付いた行は触らない)。
    審査対象はpost.py pick_draftと同一の48h窓 (当日+前日) に限定 —
    古い行は二度と投稿されず、limitを浪費して新鮮行の審査を餓死させるため。
    """
    if limit <= 0 or not QUEUE.exists():
        return 0
    today = today or dt.date.today()
    rows = read_jsonl(QUEUE)
    n = 0
    for r in rows:
        if n >= limit:
            break
        # approvedも対象 (post.py gateはverdict必須 — 人間承認行が無審査で
        # 永久skipされるのを防ぐ。textは書換えない = 承認と矛盾しない)。
        if r.get('status') not in ('draft', 'approved'):
            continue
        if (r.get('persona_review') or {}).get('verdict') in ('pass', 'ng'):
            continue
        if r.get('hook', '').startswith('【') or r.get('ask', '').startswith('【'):
            continue  # 未起草はrefillの担当 (審査前に本文が要る)
        if not in_post_window(r, today):
            continue
        verdict = persona_review_draft(r.get('hook', ''), r.get('take', ''),
                                       r.get('ask', ''), r.get('title', ''),
                                       r.get('genre_jp', ''))
        if verdict is None:
            continue  # 翌朝retry
        r['persona_review'] = verdict
        n += 1
        print(f'  [rereview] {r.get("title", "")[:60]} -> {verdict["verdict"]}')
    if n and not dry:
        write_jsonl_atomic(QUEUE, rows)
        print(f'rereviewed: {n} rows -> {QUEUE}')
    return n


def redraft_persona_ng(dry: bool = False, limit: int = 2, today: dt.date | None = None) -> int:
    """persona ng draftの再起草 — 審査loopの閉鎖 (2026-09-14)。

    ng理由をfeedbackに1回だけ書き直し→再審査。passだけqueueを差し替え
    (ngが続いた行は触らない — barを下げない)。refill/rereviewと同じ48h窓・
    bounded limit。limit×2呼出 (起草+審査) で実行時間をboundedに。
    """
    if limit <= 0 or not QUEUE.exists():
        return 0
    today = today or dt.date.today()
    rows = read_jsonl(QUEUE)
    hooks = recent_hooks()
    n = 0
    attempts = 0
    for r in rows:
        if attempts >= limit:
            break
        if r.get('status') != 'draft':
            continue
        pr = r.get('persona_review') or {}
        if pr.get('verdict') != 'ng':
            continue
        if not in_post_window(r, today):
            continue
        item = {'title': r.get('title', ''), 'url': r.get('url', ''),
                'source': r.get('source', ''), 'score': r.get('score', 0)}
        note = (f'前案はペルソナ審査でng ({pr.get("reason", "")})。'
                '読者が「追跡リストに加える/正本を見に行く」と判断できる具体'
                ' (何の観測か・条件・限界) を自説に含めて書き直す。')
        attempts += 1
        got = llm_draft(item, r.get('genre_jp', ''), hooks,
                        fetch_excerpt(item['url']), note=note)
        if not got:
            continue
        # 機械検査を先 (無料) — 違反案に審査LLMを消費しない (enrichと同一順)
        violation = discipline_violation(got.get('hook', ''), got.get('take', ''),
                                         got.get('ask', ''))
        if violation:
            print(f'  [redraft] {item["title"][:50]} -> §11違反 ({violation}) — 維持')
            continue
        verdict = attach_persona_review(got, item['title'], r.get('genre_jp', ''))
        if verdict.get('verdict') != 'pass':
            print(f'  [redraft] {item["title"][:50]} -> 仍ng (維持)')
            continue
        r.update(got)
        r['persona_review'] = verdict
        n += 1
        print(f'  [redraft] {item["title"][:50]} -> pass')
        print(f'      hook: {r["hook"]}')
    if n and not dry:
        write_jsonl_atomic(QUEUE, rows)
        print(f'redrafted: {n} rows -> {QUEUE}')
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true', help='キューに書き込まない')
    ap.add_argument('--no-llm', action='store_true', help='LLM起草をスキップ')
    ap.add_argument('--refill-limit', type=int, default=3,
                    help='未起草再起草/未審査再審査の上限/回 (0=無効・既定3)')
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
        refill_placeholders(dry=args.dry, limit=args.refill_limit)
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
            if got:
                # 投稿前ペルソナ全件チェック (pass以外はpost.pyが投稿しない)
                draft['persona_review'] = attach_persona_review(
                    draft, item['title'][:200], GENRES[item['genre']]['jp'])
                print(f"      persona: {draft['persona_review']['verdict']}"
                      + (f" ({draft['persona_review'].get('reason', '')})"
                         if draft['persona_review'].get('reason') else ''))
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
        # 製品プレビュー収集 (GIF添付素材・2026-09-05)。best-effort —
        # 失敗/未収集でもcollectは成功 (投稿はtext-onlyで続く)。
        # 2026-09-06: 実スクショは製品頁 (github/Show HN) のみ。記事頁は
        # 無断転載/リークに見えるため収集しない (x_discover_rules.media_ok)。
        try:
            from x_discover_rules import media_ok
            targets = [i['url'] for i in picked if media_ok(i)]
            if targets:
                subprocess.run(
                    [sys.executable,
                     os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  'capture-preview.py'),
                     *targets],
                    timeout=600, check=False)
        except Exception as e:  # noqa: BLE001 — 収集失敗は投稿に影響させない
            print(f'  [capture] skipped: {e}', file=sys.stderr)

    # 未起草プレースホルダの回収 (LLM間欠失敗の滞留対策・2026-09-03)
    refill_placeholders(dry=args.dry, limit=args.refill_limit)
    # persona未審査draftの再審査 (投稿前全件チェックの自己修復・2026-09-14)
    rereview_unreviewed(dry=args.dry, limit=args.refill_limit)
    # persona ngの再起草 (審査loopの閉鎖 — barは下げず書き直しで通す・2026-09-14)
    # --refill-limit 0=無効はredraftにも適用 (help文言どおり)
    if args.refill_limit > 0:
        redraft_persona_ng(dry=args.dry, limit=2)
    return 0


if __name__ == '__main__':
    sys.exit(main())
