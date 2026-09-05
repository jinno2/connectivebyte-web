#!/usr/bin/env python3
"""t0007 日本展開パートナー — アウトリーチ自動化パイプライン (承認ゲート付き)。

流れ (各段階の成果物はキューに入り、jinnoのapproveでだけ次へ進む):

  投稿 (x-discover) → engagement計測 [自動cron]
                    → 検証 (browser・Claude workset・dossierへ追記)
                    → draft <target> [LLMが記事案+アウトリーチ文面を起草]
                    → show / approve / reject  [jinnoのチェック+承認]
                    → publish-article <id> [CBサイトへ公開・npm test→commit→push]
                    → 送信 (browser・Claude workset) → sent <id>  [記録]

キュー: ~/.local/share/cb-fleet/outreach-queue.jsonl (追記型)
計測:   ~/.local/share/cb-fleet/outreach-metrics.jsonl (追記型)

規律:
  - 外部送信・公開は approve (明示指示) 後のみ。draftは一切外に出ない
  - 提携前の言及は中立・事実ベースのみ (ステマ規制: 教会と国家の分離)
  - 記事トーン = 機関媒体 (法人名NG・個人トーンNG・誇張禁止語は⚠表示)
"""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
X_DISCOVER = os.path.join(os.path.dirname(HERE), 'x-discover')
sys.path.insert(0, X_DISCOVER)
sys.path.insert(0, HERE)

from post import load_env, oauth_header, resolve_env  # noqa: E402
from x_discover_rules import banned_hits  # noqa: E402

FLEET = os.path.expanduser('~/.local/share/cb-fleet')
QUEUE = os.path.join(FLEET, 'outreach-queue.jsonl')
METRICS = os.path.join(FLEET, 'outreach-metrics.jsonl')
DISCOVER_QUEUE = os.path.join(FLEET, 'discover-queue.jsonl')
REPO = os.path.dirname(os.path.dirname(HERE))


def load_env_file() -> None:
    """cron用: ~/.local/share/cb-fleet/.env を os.environ へ (既存env優先)。"""
    try:
        for line in open(os.path.join(FLEET, '.env')).read().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k, v)
    except OSError:
        pass

# dossier正本 (business_notes repo外参照なし・引数で解決)
DOSSIER = {
    'quetab': {
        'dossier': '/home/jinno/business_notes/t0007_日本展開/dossier/quetab.md',
        'url': 'https://quetab.com/games',
        'slug': 'quetab-ai-game-builder',
    },
}

LLM_URL = 'http://localhost:14000/v1/chat/completions'


def now_iso() -> str:
    return dt.datetime.now().isoformat(timespec='seconds')


def load_queue() -> list[dict]:
    if not os.path.exists(QUEUE):
        return []
    return [json.loads(l) for l in open(QUEUE).read().splitlines() if l.strip()]


def append_queue(entry: dict) -> None:
    os.makedirs(FLEET, exist_ok=True)
    with open(QUEUE, 'a') as f:
        f.write(json.dumps(entry, ensure_ascii=False) + '\n')


def update_queue(idx: int, **fields) -> None:
    rows = load_queue()
    rows[idx].update(fields)
    with open(QUEUE, 'w') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in rows)


def next_id() -> int:
    rows = load_queue()
    return (rows[-1]['id'] + 1) if rows else 1


# ---------------------------------------------------------------- 計測

def cmd_engagement(args) -> int:
    """discover-queue内の投稿済みtweetの公開指標を記録 (冪等: 1日1回)。"""
    env = load_env()
    aenv = resolve_env(env, 'CBD')
    if not aenv:
        print('CBD env not found (X投稿と同じ資格で読み取り)')
        return 1
    if not os.path.exists(DISCOVER_QUEUE):
        print('no discover queue')
        return 0
    today = dt.date.today().isoformat()
    done = set()
    if os.path.exists(METRICS):
        for l in open(METRICS).read().splitlines():
            if l.strip():
                m = json.loads(l)
                if m.get('date') == today:
                    done.add(m['tweet_id'])
    rows = [json.loads(l) for l in open(DISCOVER_QUEUE).read().splitlines() if l.strip()]
    # post.pyは投稿後もstatus='approved'のままposted_atだけ付ける (=投稿済みmarker)
    posted = [r for r in rows if r.get('tweet_id') and r.get('posted_at')]
    for r in posted:
        tid = r['tweet_id']
        if tid in done:
            continue
        # OAuth1はquery stringを署名paramsに入れる必要がある (urlに埋めたまま署名すると401)
        base = f'https://api.twitter.com/2/tweets/{tid}'
        q = {'tweet.fields': 'public_metrics'}
        url = f'{base}?{urllib.parse.urlencode(q)}'
        req = urllib.request.Request(url, headers={'Authorization': oauth_header('GET', base, q, aenv)})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            print(f'tweet {tid}: HTTP {e.code} (skip)')
            continue
        pm = data.get('data', {}).get('public_metrics', {})
        rec = {'date': today, 'tweet_id': tid, 'url': r.get('url'),
               'hook': (r.get('hook') or '')[:40], 'metrics': pm}
        with open(METRICS, 'a') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        print(f"{tid} likes={pm.get('like_count')} rts={pm.get('retweet_count')} "
              f"replies={pm.get('reply_count')} quotes={pm.get('quote_count')} imps={pm.get('impression_count')}")
    if not posted:
        print('no posted tweets yet')
    return 0


# ---------------------------------------------------------------- 起草 (LLM)

def llm(prompt: str, max_tokens: int = 8000) -> str | None:
    key = os.environ.get('LITELLM_API_KEY')
    if not key:
        return None
    body = json.dumps({'model': os.environ.get('LITELLM_MODEL', 'default'),
                       'max_tokens': max_tokens,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(LLM_URL, data=body,
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': f'Bearer {key}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode())
    return data['choices'][0]['message']['content'].strip()


def metrics_digest(target: str) -> str:
    if not os.path.exists(METRICS):
        return '(まだ計測なし)'
    rows = [json.loads(l) for l in open(METRICS).read().splitlines() if l.strip()]
    tgt = [m for m in rows if target.split('.')[0] in (m.get('url') or '')]
    if not tgt:
        return '(この対象の計測なし)'
    last = tgt[-1]
    return f"X投稿指標 ({last['date']}): {json.dumps(last['metrics'], ensure_ascii=False)}"


def cmd_draft(args) -> int:
    load_env_file()
    spec = DOSSIER.get(args.target)
    if not spec:
        print(f'unknown target: {args.target} (known: {", ".join(DOSSIER)})')
        return 1
    dossier = open(spec['dossier']).read()
    digest = metrics_digest(args.target)

    def artifact_status() -> str:
        """実在する成果物だけを列挙 (まだ無いものを『公開した』と書かせないため)。"""
        key = args.target.split('.')[0]
        lines = []
        if os.path.exists(DISCOVER_QUEUE):
            rq = [json.loads(l) for l in open(DISCOVER_QUEUE).read().splitlines() if l.strip()]
            mine = [r for r in rq if key in (r.get('url') or '')]
            posted = [r for r in mine if r.get('status') == 'posted' and r.get('tweet_id')]
            lines.append('X投稿: ' + (f"投稿済 tweet_id={posted[-1]['tweet_id']}" if posted else '未投稿'))
        arts = [r for r in load_queue()
                if r.get('target') == args.target and r['kind'] == 'article']
        pub = [r for r in arts if r['status'] == 'published']
        lines.append('日本語記事: ' + (f"公開済 {pub[-1]['published_url']}" if pub else '未公開'))
        return '\n'.join(lines)

    status = artifact_status()

    article_prompt = f"""あなたは日本の技術系機関メディアの編集者。以下のdossierと計測に基づき、
海外AIサービスの日本語レビュー記事を書く。制約:
- 機関媒体のトーン (法人名・個人名を出さない・個人的感想トーン禁止・「私」禁止)
- 事実ベースのみ。実測していない性能・品質の評価は書かない。未検証は未検証と明示
- 誇張禁止語 (おすすめ/推し/最高/画期的/必須/絶対/業界No.1/最強 等) 禁止
- 見出し + 本文 (800-1200字) + サービス基本情報 (URL・用途・料金が既知なら)
- Markdown形式。冒頭に <!-- pre-partnership neutral review --> を付ける (提携前の中立記事であることの内部標識)

--- dossier ---
{dossier}
--- X投稿指標 ---
{digest}
--- 成果物の現状 ---
{status}
"""
    outreach_prompt = f"""あなたは日本展開パートナー戦略 (t0007) の担当者。以下のdossier・計測・記事案に基づき、
海外AIサービスの創業者・担当者への初回アウトリーチ文面を英語で書く。制約:
- 事実のみ: 根拠として提示してよいのは『成果物の現状』に実在するものだけ。
  未投稿・未公開のものを投稿済・公開済と書いてはいけない (予定として言及するなら I will / we plan to)
- 提携提案は紹介・アフィリエイト級の低摩擦な形から。金銭条件はまだ書かない
  (提携がないので開示不要=ステマ規制対応)。内部用語 (段階a等) をそのまま使わない
- 短く (150語以下) ・具体的・押し付けない。返信しやすい問いで終える
- 差出人表記: ConnectiveByte (日本のAI紹介メディア・パートナー探索中)
- 件名行 (Subject:) + 本文。署名の個人名は [Name] プレースホルダのまま。
  署名URLは https://lab.connectivebyte.com 固定 (URLを自分で作らない)
- 出力は Subject行と手紙本文のみ。解説・設計メモ・箇条書きの説明・コードブロックを付けない

--- dossier ---
{dossier}
--- X投稿指標 ---
{digest}
--- 成果物の現状 ---
{status}
"""
    article = None
    if args.only != 'outreach':
        print(f'drafting article for {args.target} (LLM)...')
        article = llm(article_prompt)
        if not article:
            print('LLM unavailable (LITELLM_API_KEY)')
            return 1
        aid = next_id()
        append_queue({'id': aid, 'target': args.target, 'kind': 'article',
                      'status': 'draft', 'body': article, 'created_at': now_iso()})
        print(f'article draft -> id={aid}')
    else:
        # 記事キューの最新 (draft/approved) を素材に使う。無ければ生成のみ (キューに入れない)
        arts = [r for r in load_queue()
                if r['target'] == args.target and r['kind'] == 'article'
                and r['status'] in ('draft', 'approved', 'published')]
        article = arts[-1]['body'] if arts else llm(article_prompt)

    print(f'drafting outreach for {args.target} (LLM)...')
    draft = llm(outreach_prompt + f'\n--- 記事案 ---\n{article}')
    if not draft:
        print('LLM unavailable (LITELLM_API_KEY)')
        return 1
    oid = next_id()
    append_queue({'id': oid, 'target': args.target, 'kind': 'outreach',
                  'status': 'draft', 'body': draft, 'created_at': now_iso()})
    print(f'outreach draft -> id={oid}')
    print(f'check: python3 {os.path.abspath(__file__)} show')
    return 0


# ---------------------------------------------------------------- 承認

def cmd_show(args) -> int:
    rows = load_queue()
    if not rows:
        print('(キュー空 — draft <target> で起草)')
        return 0
    for r in rows:
        if args.id and r['id'] != args.id:
            continue
        if args.pending and r['status'] != 'draft':
            continue
        print(f"=== id={r['id']} [{r['kind']}/{r['status']}] target={r['target']} "
              f"({r.get('created_at', '')})")
        hits = banned_hits(r['body'], '', '')
        if hits:
            print(f'⚠ 誇張禁止語残存 (要修正確認): {"/".join(hits)}')
        if r['kind'] == 'outreach' and 'Subject:' not in r['body']:
            print('⚠ Subject行なし')
        print(r['body'])
        print()
    return 0


def cmd_decide(args) -> int:
    rows = load_queue()
    for i, r in enumerate(rows):
        if r['id'] == args.id:
            if r['status'] != 'draft':
                print(f"id={args.id} is {r['status']} (draft以外は変更不可)")
                return 1
            update_queue(i, status=args.action, decided_at=now_iso())
            print(f'id={args.id} -> {args.action}')
            return 0
    print(f'id={args.id} not found')
    return 1


# ---------------------------------------------------------------- 公開

ARTICLE_TMPL = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="robots" content="index,follow">
<style>
body{{font-family:sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#1a1a2e}}
h1{{font-size:1.5rem}} h2{{font-size:1.2rem;margin-top:2rem}}
footer{{margin-top:3rem;font-size:.85rem;opacity:.7}}
</style>
</head>
<body>
{body}
<footer>ConnectiveByte — 海外AIサービスの日本語圏紹介 (<a href="/">トップ</a>)</footer>
</body>
</html>
"""


def md_to_html(md: str) -> str:
    """最小Markdown→HTML (見出し・リンク・段落のみ。安全のため他はエスケープ)。"""
    import html as h
    import re
    md = '\n'.join(l for l in md.splitlines()
                   if not l.strip().startswith('```'))  # コードフェンス囲み除去
    lines = []
    in_para = []
    def flush():
        if in_para:
            lines.append('<p>' + ' '.join(in_para) + '</p>')
            in_para.clear()
    for raw in md.splitlines():
        s = raw.strip()
        if not s:
            flush()
            continue
        m = re.match(r'^(#{1,3})\s+(.*)', s)
        if m:
            flush()
            lvl = len(m.group(1))
            lines.append(f'<h{lvl}>{h.escape(m.group(2))}</h{lvl}>')
            continue
        if s.startswith('<!--'):
            continue
        if s.startswith(('-', '* ')):
            flush()
            lines.append(f'<p>• {h.escape(s.lstrip("-* "))}</p>')
            continue
        esc = h.escape(s)
        esc = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)',
                     r'<a href="\2" target="_blank" rel="noopener noreferrer">\1</a>', esc)
        in_para.append(esc)
    flush()
    return '\n'.join(lines)


def cmd_publish(args) -> int:
    rows = load_queue()
    for i, r in enumerate(rows):
        if r['id'] != args.id:
            continue
        if r['kind'] != 'article' or r['status'] != 'approved':
            print(f'id={args.id} は approved記事ではない (kind={r["kind"]} status={r["status"]})')
            return 1
        spec = DOSSIER[r['target']]
        first_h1 = next((l.lstrip('# ') for l in r['body'].splitlines()
                         if l.startswith('# ')), spec['slug'])
        out_dir = os.path.join(REPO, 'content', '18-blog', spec['slug'])
        os.makedirs(out_dir, exist_ok=True)
        page = ARTICLE_TMPL.format(title=first_h1, body=md_to_html(r['body']))
        out = os.path.join(out_dir, 'index.html')
        with open(out, 'w') as f:
            f.write(page)
        print(f'wrote {out} — publication guard走行...')
        tst = subprocess.run(['npm', 'test'], cwd=REPO, capture_output=True, text=True)
        if tst.returncode != 0:
            print('npm test FAIL — 公開中止 (手動確認すること):')
            print(tst.stdout[-2000:])
            os.remove(out)
            return 1
        rel = os.path.relpath(out, REPO)
        url = f'https://lab.connectivebyte.com/{rel}'
        git = subprocess.run(['git', 'add', rel], cwd=REPO)
        if git.returncode != 0:
            print('git add fail')
            return 1
        msg = f'blog: {spec["slug"]} レビュー記事公開 (t0007 outreach id={r["id"]})'
        for cmd in (['git', 'commit', '-m', msg], ['git', 'push']):
            c = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
            if c.returncode != 0:
                print(f'{" ".join(cmd)} fail:\n{c.stdout}{c.stderr}')
                return 1
        update_queue(i, status='published', published_url=url, published_at=now_iso())
        print(f'PUBLISHED: {url}')
        return 0
    print(f'id={args.id} not found')
    return 1


def cmd_sent(args) -> int:
    rows = load_queue()
    for i, r in enumerate(rows):
        if r['id'] == args.id:
            if r['kind'] != 'outreach' or r['status'] != 'approved':
                print(f'id={args.id} は approved文面ではない')
                return 1
            update_queue(i, status='sent', channel=args.channel, sent_at=now_iso())
            print(f'id={args.id} -> sent ({args.channel}) — dossierへ追記すること')
            return 0
    print(f'id={args.id} not found')
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('engagement').set_defaults(fn=cmd_engagement)
    d = sub.add_parser('draft')
    d.add_argument('target', choices=sorted(DOSSIER))
    d.add_argument('--only', choices=['article', 'outreach'], default='both',
                   help='片方だけ再起草 (reject後のやり直し等)')
    d.set_defaults(fn=cmd_draft)
    s = sub.add_parser('show')
    s.add_argument('id', nargs='?', type=int)
    s.add_argument('--pending', action='store_true')
    s.set_defaults(fn=cmd_show)
    a = sub.add_parser('approve')
    a.add_argument('id', type=int)
    a.set_defaults(fn=cmd_decide, action='approved')
    r = sub.add_parser('reject')
    r.add_argument('id', type=int)
    r.set_defaults(fn=cmd_decide, action='rejected')
    p = sub.add_parser('publish-article')
    p.add_argument('id', type=int)
    p.set_defaults(fn=cmd_publish)
    t = sub.add_parser('sent')
    t.add_argument('id', type=int)
    t.add_argument('--channel', default='contact-form')
    t.set_defaults(fn=cmd_sent)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == '__main__':
    sys.exit(main())
