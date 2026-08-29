#!/usr/bin/env python3
"""CB発見者 authorizer — 新垢のOAuth 1.0a PINフロー (x-fleet-authorize.py pattern)

垢作成後の onboard をこの1コマンドに集約:
  1. request_token 発行 (oauth_callback=oob)
  2. 認証URLを表示 → jinno がブラウザで「投稿用の新垢」にログインし app を承認 → 7桁PIN
  3. access_token 交換 → ~/.local/share/cb-fleet/.env に {PREFIX}_ACCESS_* を追記 (鍵は表示しない)
  4. config の status を not_created → warming に自動反映 (翌日から投稿開始)

前提: app共通の X_API_KEY / X_API_SECRET を ~/.local/share/cb-fleet/.env に配置済み
(site_meiro-a/.env の同名値をコピー — 承認画面に出るappはmeiroと同一)。

使い方:
  python3 authorize.py --account cb_discoverer
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

_spec = importlib.util.spec_from_file_location('cbpost', os.path.join(HERE, 'post.py'))
post = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(post)


def _consumer_header(url: str, params: dict, env: dict) -> str:
    """request_token用: token無しの署名 (consumer鍵のみ・oauth_callback込み)。"""
    nonce = post.hashlib.md5(f'{url}{dt.datetime.now().isoformat()}'.encode()).hexdigest()
    oauth = {
        'oauth_consumer_key': env['X_API_KEY'], 'oauth_nonce': nonce,
        'oauth_signature_method': 'HMAC-SHA1',
        'oauth_timestamp': str(int(dt.datetime.now().timestamp())),
        'oauth_version': '1.0', 'oauth_callback': 'oob',
    }
    enc = lambda v: urllib.parse.quote(str(v), safe='')  # noqa: E731
    base_items = {**oauth, **params}
    pairs = '&'.join(f'{enc(k)}={enc(v)}' for k, v in sorted(base_items.items()))
    base = '&'.join(['POST', enc(url), enc(pairs)])
    key = f"{enc(env['X_API_SECRET'])}&".encode()
    sig = post.base64_b64(post.hmac.new(key, base.encode(), post.hashlib.sha1).digest())
    oauth['oauth_signature'] = sig
    return 'OAuth ' + ', '.join(f'{enc(k)}="{enc(v)}"' for k, v in sorted(oauth.items()))


def oauth_post(url: str, extra: dict, env: dict, consumer_only: bool = False) -> dict:
    """OAuth 1.0a エンドポイント (request/access token) の呼び出し。応答 = urlencoded。"""
    if consumer_only:
        hdr = _consumer_header(url, extra, env)
    else:
        # post.oauth_header は署名計算に extra を含めるがヘッダには出さない。
        # oauth_verifier はヘッダ送出が必要 (RFC 5849 §3.3.1) — 未追記だと正しいPINでも401
        # (2026-08-29 meiro側で実測修正済みの同じ罠)。
        hdr = post.oauth_header('POST', url, extra, env)
        if extra:
            enc = lambda v: urllib.parse.quote(str(v), safe='')  # noqa: E731
            hdr += ', ' + ', '.join(f'{enc(k)}="{enc(v)}"' for k, v in sorted(extra.items()))
    req = urllib.request.Request(url, data=b'', method='POST', headers={'Authorization': hdr})
    with urllib.request.urlopen(req, timeout=30) as r:
        return dict(urllib.parse.parse_qsl(r.read().decode()))


def fingerprint(v: str) -> str:
    return f'{v[:4]}…{v[-4:]}'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--account', default='cb_discoverer')
    args = ap.parse_args()

    config = post.load_config()
    env = post.load_env()
    if not env.get('X_API_KEY') or not env.get('X_API_SECRET'):
        print('X_API_KEY / X_API_SECRET が ~/.local/share/cb-fleet/.env に無い '
              '(site_meiro-a/.env からapp共通値をコピー)', file=sys.stderr)
        return 1
    acct = next((a for a in config['accounts'] if a['alias'] == args.account), None)
    if acct is None:
        print(f'unknown alias: {args.account}', file=sys.stderr)
        return 1
    prefix = acct.get('env_prefix', 'CBD')

    rt = oauth_post('https://api.twitter.com/oauth/request_token', {}, env, consumer_only=True)
    print('=== このURLをブラウザで開き、「投稿用の新垢」でログインして app を承認 ===')
    print(f"https://api.twitter.com/oauth/authorize?oauth_token={rt['oauth_token']}")
    print('(既に別垢でログイン中なら先にログアウト)')
    pin = input('7桁のPIN: ').strip()
    at = oauth_post('https://api.twitter.com/oauth/access_token',
                    {'oauth_verifier': pin},
                    {**env, 'X_ACCESS_TOKEN': rt['oauth_token'],
                     'X_ACCESS_SECRET': rt['oauth_token_secret']})
    if 'oauth_token' not in at or 'oauth_token_secret' not in at:
        print(f'exchange failed: {at}', file=sys.stderr)
        return 1
    screen_name = at.get('screen_name', '?')

    existing = open(post.ENV_FILE).read() if os.path.exists(post.ENV_FILE) else ''
    with open(post.ENV_FILE, 'a', encoding='utf-8') as f:
        if existing and not existing.endswith('\n'):
            f.write('\n')
        f.write(f'# x-discover {acct["alias"]} ({screen_name}) added {dt.date.today().isoformat()}\n')
        f.write(f'{prefix}_ACCESS_TOKEN={at["oauth_token"]}\n')
        f.write(f'{prefix}_ACCESS_SECRET={at["oauth_token_secret"]}\n')

    acct['status'] = 'warming'
    post.save_config(config)
    post.log({'event': 'account_authorized', 'account': acct['alias'],
              'screen_name': screen_name, 'token_fp': fingerprint(at['oauth_token']),
              'to': 'warming'})
    print(f'OK: {acct["alias"]} (@{screen_name}) — .env追記 + warming開始 '
          f'(token {fingerprint(at["oauth_token"])})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
