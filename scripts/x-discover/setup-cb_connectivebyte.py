#!/usr/bin/env python3
"""正統CB垢(cb_connectivebyte=@ConnectiveByte)onboard+プロフ設定 — 2026-09-04

jinno方針(09-04「自動化していいならやってほしい」): X規則上許容の範囲で
プロフ設定もAPI実施する(設計④の「API不使用」はjinno指示で訂正=credentialを
プロフ設定用途で付与。投稿のAPI化は09-06初回案件(CB-2026-003)時に契約変更)。

authorize.py(x-discover・discoverer用)と同一の2-phased PIN flow。
x-discover config(投稿pipeline)には触れない — この垢をdiscoverer投稿へ
混ぜないため(status変更・queue参照なし)。

  python3 setup-cb_connectivebyte.py --print-url   # phase1: 認証URL表示
  python3 setup-cb_connectivebyte.py --pin 1234567 # phase2: 交換+プロフ設定完走
  python3 setup-cb_connectivebyte.py --profile     # プロフ設定のみ再実行(XCB鍵必要)

access鍵は ~/.local/share/cb-fleet/.env へ XCB_ACCESS_* として追記(鍵は表示しない)。
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('cbpost', os.path.join(HERE, 'post.py'))
post = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(post)

PREFIX = 'XCB'
PENDING_FILE = os.path.join(post.STATE_DIR, '.authorize-pending-xcb.json')
AVATAR_PNG = os.path.join(HERE, 'avatar-cb_connectivebyte.png')

# プロフ正本=横断/2026-09-03-x_canonical_account_design.md §3+§5(jinno承認)
PROFILE = {
    'name': 'ConnectiveByte',
    'url': 'https://lab.connectivebyte.com',
    'description': 'lab/ConnectiveByteの公式記録。測定の記録・公開・訂正を機関として報告する(月次+臨時)',
}
SETTINGS = {'lang': 'ja', 'tz_candidates': ['Tokyo', 'Asia/Tokyo']}


def fingerprint(v: str) -> str:
    return f'{v[:4]}…{v[-4:]}'


def _consumer_header(url: str, env: dict) -> str:
    """request_token用: token無しの署名 (consumer鍵のみ・oauth_callback=oob)。"""
    nonce = post.hashlib.md5(f'{url}{dt.datetime.now().isoformat()}'.encode()).hexdigest()
    oauth = {
        'oauth_consumer_key': env['X_API_KEY'], 'oauth_nonce': nonce,
        'oauth_signature_method': 'HMAC-SHA1',
        'oauth_timestamp': str(int(dt.datetime.now().timestamp())),
        'oauth_version': '1.0', 'oauth_callback': 'oob',
    }
    enc = lambda v: urllib.parse.quote(str(v), safe='')  # noqa: E731
    pairs = '&'.join(f'{enc(k)}={enc(v)}' for k, v in sorted(oauth.items()))
    base = '&'.join(['POST', enc(url), enc(pairs)])
    key = f"{enc(env['X_API_SECRET'])}&".encode()
    sig = post.base64_b64(post.hmac.new(key, base.encode(), post.hashlib.sha1).digest())
    oauth['oauth_signature'] = sig
    return 'OAuth ' + ', '.join(f'{enc(k)}="{enc(v)}"' for k, v in sorted(oauth.items()))


def v1_post(url: str, params: dict, env: dict) -> tuple[int, dict]:
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=body, method='POST',
        headers={'Authorization': post.oauth_header('POST', url, params, env),
                 'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, json.load(r)


def save_access(at: dict) -> str:
    screen_name = at.get('screen_name', '?')
    existing = open(post.ENV_FILE).read() if os.path.exists(post.ENV_FILE) else ''
    with open(post.ENV_FILE, 'a', encoding='utf-8') as f:
        if existing and not existing.endswith('\n'):
            f.write('\n')
        f.write(f'# x-connectivebyte official ({screen_name}) added {dt.date.today().isoformat()}\n')
        f.write(f'{PREFIX}_ACCESS_TOKEN={at["oauth_token"]}\n')
        f.write(f'{PREFIX}_ACCESS_SECRET={at["oauth_token_secret"]}\n')
    return screen_name


def apply_profile(env: dict) -> int:
    st, d = v1_post('https://api.twitter.com/1.1/account/update_profile.json',
                    {**PROFILE, 'skip_status': 'true'}, env)
    print(f"update_profile: {st} (screen_name={d.get('screen_name')})")

    # settings: lang+tz (tzは候補順に試す・片方だけ成功でも続行)
    ok_tz = None
    for tz in SETTINGS['tz_candidates']:
        try:
            st2, d2 = v1_post('https://api.twitter.com/1.1/account/settings.json',
                              {'lang': SETTINGS['lang'], 'time_zone': tz}, env)
            print(f"settings({tz}): {st2} lang={d2.get('language')} tz={d2.get('time_zone', {}).get('tzinfo_name')}")
            ok_tz = tz
            break
        except urllib.error.HTTPError as e:
            print(f'settings({tz}): {e.code} — 次候補へ')
    if ok_tz is None:
        print('WARN: lang/tz設定失敗(手動設定残)')

    b64 = base64.b64encode(open(AVATAR_PNG, 'rb').read()).decode()
    st3, d3 = v1_post('https://api.twitter.com/1.1/account/update_profile_image.json',
                      {'image': b64, 'skip_status': 'true'}, env)
    print(f"update_profile_image: {st3} ({d3.get('profile_image_url_https', '')})")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--print-url', action='store_true')
    ap.add_argument('--pin', metavar='PIN')
    ap.add_argument('--profile', action='store_true',
                    help='XCB鍵でプロフ設定のみ実行(PIN後の再実行用)')
    args = ap.parse_args()

    env = post.load_env()
    if not env.get('X_API_KEY') or not env.get('X_API_SECRET'):
        print('X_API_KEY / X_API_SECRET が無い', file=sys.stderr)
        return 1

    if args.profile:
        penv = post.resolve_env(env, PREFIX)
        if not penv:
            print(f'{PREFIX}_ACCESS_* が未登録 (先に --pin)', file=sys.stderr)
            return 1
        return apply_profile(penv)

    if args.pin:
        try:
            rt = json.load(open(PENDING_FILE, encoding='utf-8'))
        except OSError:
            print('pending file が無い (先に --print-url)', file=sys.stderr)
            return 1
        # oauth_verifier はヘッダ送出が必要 (RFC 5849 §3.3.1・authorize.pyと同罠回避)
        url = 'https://api.twitter.com/oauth/access_token'
        extra = {'oauth_verifier': args.pin,
                 'oauth_token': rt['oauth_token']}
        hdr = post.oauth_header('POST', url, extra, {**env,
                 'X_ACCESS_TOKEN': rt['oauth_token'],
                 'X_ACCESS_SECRET': rt['oauth_token_secret']})
        enc = lambda v: urllib.parse.quote(str(v), safe='')  # noqa: E731
        hdr += ', ' + ', '.join(f'{enc(k)}="{enc(v)}"' for k, v in sorted(extra.items()))
        req = urllib.request.Request(url, data=b'', method='POST',
                                     headers={'Authorization': hdr})
        with urllib.request.urlopen(req, timeout=30) as r:
            at = dict(urllib.parse.parse_qsl(r.read().decode()))
        if 'oauth_token' not in at or 'oauth_token_secret' not in at:
            print(f'exchange failed: {at}', file=sys.stderr)
            return 1
        os.remove(PENDING_FILE)
        sn = save_access(at)
        print(f'OK: @{sn} — XCB_ACCESS_* 追記 (token {fingerprint(at["oauth_token"])})')
        return apply_profile(post.resolve_env(post.load_env(), PREFIX))

    # phase1: request token
    url = 'https://api.twitter.com/oauth/request_token'
    req = urllib.request.Request(url, data=b'', method='POST',
                                 headers={'Authorization': _consumer_header(url, env)})
    with urllib.request.urlopen(req, timeout=30) as r:
        rt = dict(urllib.parse.parse_qsl(r.read().decode()))
    with open(PENDING_FILE, 'w', encoding='utf-8') as f:
        json.dump({'oauth_token': rt['oauth_token'],
                   'oauth_token_secret': rt['oauth_token_secret']}, f)
    os.chmod(PENDING_FILE, 0o600)
    print('=== このURLをブラウザで開き @ConnectiveByte でログインして app を承認 ===')
    print(f"https://api.twitter.com/oauth/authorize?oauth_token={rt['oauth_token']}")
    print('(PINは15分以内に: python3 setup-cb_connectivebyte.py --pin <7桁>)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
