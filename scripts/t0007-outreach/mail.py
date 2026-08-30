#!/usr/bin/env python3
"""受信メール読み出しクライアント — cb-email-inbox (2026-08-30 メール完全自動化)。

connectivebyte.com の受信は CF Email Routing → cb-email-inbox worker が
生MIMEをD1へ保存 → gmail転送。このscriptは保存済みメールを
inbox.connectivebyte.com (Bearer・tokenはcb-fleet .env) から読む。

使い方 (サインアップ認証コード受け取りの定型):
  mail.py list [--to quetab@connectivebyte.com] [--limit 20]
  mail.py show <id>                     # MIME解析した本文まで表示
  mail.py wait --to quetab@connectivebyte.com [--from-substr quetab] \
               [--timeout 300] [--pattern '\\d{6}'] [--after-id N]
      # 新着を最大timeout秒ポーリングし、認証コード候補を抽出してJSONで出す。
      # --pattern 未指定なら件名+本文から数値4-8桁を最長一致で抽出。

規律: token・メール内容をlogに残す場合も転送先gmail以外のPIIは扱わない
      (受信箱は30日でworker側自動削除)。
"""
import argparse
import base64
import email
import email.policy
import json
import re
import sys
import time
import urllib.error
import urllib.request

FLEET_ENV = None


def load_env_file():
    """cb-fleet .env から CB_INBOX_TOKEN / CB_INBOX_URL を読む (実値は返さず設定)。"""
    global FLEET_ENV
    if FLEET_ENV is not None:
        return FLEET_ENV
    import os
    path = os.path.expanduser('~/.local/share/cb-fleet/.env')
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    FLEET_ENV = env
    return env


def api(path):
    env = load_env_file()
    token = env.get('CB_INBOX_TOKEN')
    url = env.get('CB_INBOX_URL', 'https://inbox.connectivebyte.com').rstrip('/') + path
    if not token:
        print('CB_INBOX_TOKEN not set in ~/.local/share/cb-fleet/.env', file=sys.stderr)
        sys.exit(2)
    req = urllib.request.Request(url, headers={
        'Authorization': f'Bearer {token}',
        'User-Agent': 'cb-fleet-mail-client/1.0',  # 既定UAはCF bot判定で403になる (実測)
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def parse_message(detail):
    """raw_b64 → (件名デコード済, text本文, html本文)。失敗しても空文字で返す。"""
    if not detail.get('raw_b64'):
        return detail.get('subject') or '', '', ''
    raw = base64.b64decode(detail['raw_b64'])
    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        return detail.get('subject') or '', '', ''
    subject = str(msg.get('subject') or '')
    text_body, html_body = '', ''
    try:
        body = msg.get_body(preferencelist=('plain',))
        if body is not None:
            text_body = body.get_content()
    except Exception:
        pass
    try:
        body = msg.get_body(preferencelist=('html',))
        if body is not None:
            html_body = body.get_content()
    except Exception:
        pass
    return subject, text_body, html_body


def strip_html(html):
    html = re.sub(r'<style.*?</style>|<script.*?</script>', ' ', html, flags=re.S | re.I)
    html = re.sub(r'<[^>]+>', ' ', html)
    return re.sub(r'\s+', ' ', html)


CODE_RE = re.compile(r'\b\d{4,8}\b')
# 桁数が多いもの・前後が単語境界のものを優先 (西暦/時刻と誤認しにくい候補順)
NOISE_RE = re.compile(r'^(19|20)\d{2}$')  # 西暦らしき4桁は除外


def extract_code(text):
    """件名+本文から認証コード候補を抽出。無ければ空リスト。"""
    candidates = CODE_RE.findall(text)
    seen, ordered = set(), []
    for c in sorted(candidates, key=len, reverse=True):
        if c not in seen and not NOISE_RE.match(c):
            seen.add(c)
            ordered.append(c)
    return ordered


def cmd_list(args):
    q = f'?limit={args.limit}' + (f'&to={args.to}' if args.to else '')
    data = api('/inbox' + q)
    for m in data.get('messages', []):
        print(f"{m['id']:>4}  {m['received_at'][:19]}  {m['from_addr'][:36]:<36}  {m['subject'][:50]}")
    if not data.get('messages'):
        print('(no messages)')


def cmd_show(args):
    detail = api(f'/inbox/{args.id}')
    subject, text_body, html_body = parse_message(detail)
    print(f"id:         {detail['id']}")
    print(f"received:   {detail['received_at']}")
    print(f"from:       {detail['from_addr']}")
    print(f"to:         {detail['to_addr']}")
    print(f"subject:    {subject}")
    print(f"raw_size:   {detail['raw_size']} (truncated={detail['truncated']})")
    if text_body:
        print('--- text ---')
        print(text_body.rstrip())
    elif html_body:
        print('--- html (stripped) ---')
        print(strip_html(html_body).strip())
    else:
        print('(no decodable body — truncated or empty)')


def cmd_wait(args):
    pattern = re.compile(args.pattern) if args.pattern else None
    deadline = time.time() + args.timeout
    seen_max = args.after_id
    if seen_max is None:
        # 既存の最大id以降だけを対象にする (二重検出防止)
        try:
            seen_max = max((m['id'] for m in api(f'/inbox?limit=1').get('messages', [])), default=0)
        except urllib.error.URLError:
            seen_max = 0
    while time.time() < deadline:
        try:
            data = api('/inbox?limit=50' + (f'&to={args.to}' if args.to else ''))
        except urllib.error.URLError as e:
            print(f'poll error: {e}', file=sys.stderr)
            time.sleep(args.poll)
            continue
        fresh = [m for m in data.get('messages', []) if m['id'] > seen_max]
        for m in sorted(fresh, key=lambda x: x['id']):
            detail = api(f"/inbox/{m['id']}")
            subject, text_body, html_body = parse_message(detail)
            body = text_body or strip_html(html_body or '')
            haystack = f'{subject}\n{body}'
            if args.from_substr and args.from_substr.lower() not in m['from_addr'].lower():
                continue
            if pattern:
                match = pattern.search(haystack)
                if not match:
                    continue
                code = match.group(1) if match.groups() else match.group(0)
            else:
                codes = extract_code(haystack)
                if not codes:
                    continue
                code = codes[0]
            print(json.dumps({
                'id': m['id'], 'code': code,
                'from': m['from_addr'], 'subject': subject,
                'received_at': m['received_at'],
            }, ensure_ascii=False))
            return 0
        time.sleep(args.poll)
    print(json.dumps({'error': 'timeout', 'timeout_s': args.timeout}, ensure_ascii=False))
    return 1


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    pl = sub.add_parser('list')
    pl.add_argument('--to')
    pl.add_argument('--limit', type=int, default=20)
    ps = sub.add_parser('show')
    ps.add_argument('id')
    pw = sub.add_parser('wait')
    pw.add_argument('--to', default='quetab@connectivebyte.com')
    pw.add_argument('--from-substr', dest='from_substr')
    pw.add_argument('--timeout', type=int, default=300)
    pw.add_argument('--poll', type=float, default=10.0)
    pw.add_argument('--pattern')
    pw.add_argument('--after-id', dest='after_id', type=int)
    args = p.parse_args()
    if args.cmd == 'list':
        cmd_list(args)
    elif args.cmd == 'show':
        cmd_show(args)
    else:
        sys.exit(cmd_wait(args))


if __name__ == '__main__':
    main()
