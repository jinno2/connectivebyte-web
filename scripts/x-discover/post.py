#!/usr/bin/env python3
"""CB発見者 poster — draftを1日1投稿 (site_meiro-a x-fleet-post.py pattern・stdlibのみ)

collect.py が溜めた queue (~/.local/share/cb-fleet/discover-queue.jsonl) のうち
48h寿命内の最良1件を投稿する。2026-09-04 レビュー・投稿判断の自動化(jinno決定)により
承認flowを撤廃: 未承認draft(status=draft)も自動投稿する。review.py は任意の
steering(却下・品質確認)であり、reject した draft は投稿対象外のまま。
污垢 (status=not_created) の間は何もしない = cronに入れても安全。

  python3 post.py --dry-run
  python3 post.py

流れ: collect (09:17 cron) → post (21:07 cron・自動判定)。review.py は任意 steering。
秘密は ~/.local/share/cb-fleet/.env のみ (repo外・git管理外)。
consumer鍵(X_API_KEY/SECRET)はapp共通・access鍵のみ垢別({PREFIX}_ACCESS_*)。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from x_discover_rules import ask_is_interrogative, uniformity_warning  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from x_discover_rules import banned_hits  # noqa: E402  (§11機械検査・兄弟module)
STATE_DIR = os.path.expanduser('~/.local/share/cb-fleet')
ENV_FILE = os.path.join(STATE_DIR, '.env')
QUEUE_FILE = os.path.join(STATE_DIR, 'discover-queue.jsonl')
STATE_FILE = os.path.join(STATE_DIR, 'x-post-state.json')
LOG_FILE = os.path.join(STATE_DIR, 'post-log.jsonl')
CONFIG_FILE = os.path.join(HERE, 'x-discover-config.json')

PRICE = {'url': 0.200, 'nourl': 0.015}  # 実測単価 (URL付き/抜き・credits換算)


def load_env() -> dict:
    env = {**os.environ}
    try:
        for line in open(ENV_FILE, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env.setdefault(k, v)
    except OSError:
        pass
    return env


def log(event: dict) -> None:
    event['ts'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    line = json.dumps(event, ensure_ascii=False)
    print(line)
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


def load_state() -> dict:
    try:
        return json.load(open(STATE_FILE, encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return {'month': None, 'spend_usd': 0.0, 'accounts': {}}


def save_state(state: dict) -> None:
    os.makedirs(STATE_DIR, exist_ok=True)
    json.dump(state, open(STATE_FILE, 'w', encoding='utf-8'), ensure_ascii=False)


def acct_state(state: dict, alias: str) -> dict:
    return state['accounts'].setdefault(
        alias, {'last_post': None, 'post_count': 0, 'consecutive_auth_fail': 0})


def load_config() -> dict:
    return json.load(open(CONFIG_FILE, encoding='utf-8'))


def save_config(config: dict) -> None:
    json.dump(config, open(CONFIG_FILE, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(CONFIG_FILE, 'a').write('\n')


def resolve_env(env: dict, prefix: str) -> dict | None:
    """consumer鍵はapp共通。access鍵のみ垢別({PREFIX}_ACCESS_*)。"""
    if not env.get('X_API_KEY') or not env.get('X_API_SECRET'):
        return None
    out = dict(env)
    for suffix in ('ACCESS_TOKEN', 'ACCESS_SECRET'):
        v = env.get(f'{prefix}_{suffix}')
        if not v:
            return None
        out[f'X_{suffix}'] = v
    return out


def classify_http_error(e: urllib.error.HTTPError) -> tuple[str, str]:
    try:
        detail = json.loads(e.read().decode('utf-8', 'replace')).get('detail', '')[:120]
    except Exception:
        detail = ''
    if e.code == 402:
        return 'credits_depleted', detail
    if e.code in (401, 403):
        return 'auth_or_suspended', detail
    if e.code == 429:
        return 'rate_limited', detail
    return f'http_{e.code}', detail


# --- X API OAuth 1.0a (x-daily-maze.py 実績coreの流用・stdlibのみ) ------------

def base64_b64(b: bytes) -> str:
    import base64
    return base64.b64encode(b).decode()


def oauth_header(method: str, url: str, params: dict, env: dict) -> str:
    ck, cs = env['X_API_KEY'], env['X_API_SECRET']
    tk, ts_ = env['X_ACCESS_TOKEN'], env['X_ACCESS_SECRET']
    nonce = hashlib.md5(f"{url}{dt.datetime.now().isoformat()}".encode()).hexdigest()
    oauth = {
        'oauth_consumer_key': ck, 'oauth_nonce': nonce,
        'oauth_signature_method': 'HMAC-SHA1', 'oauth_timestamp': str(int(dt.datetime.now().timestamp())),
        'oauth_token': tk, 'oauth_version': '1.0',
    }
    base_items = {**oauth, **params}
    enc = lambda v: urllib.parse.quote(str(v), safe='')  # noqa: E731
    pairs = '&'.join(f"{enc(k)}={enc(v)}" for k, v in sorted(base_items.items()))
    base = '&'.join([method.upper(), enc(url), enc(pairs)])
    key = f"{enc(cs)}&{enc(ts_)}".encode()
    # 署名は生base64→ヘッダ構築時のenc()で1回だけ (二重encodeは401・2026-08-27修正済み)
    sig = base64_b64(hmac.new(key, base.encode(), hashlib.sha1).digest())
    oauth['oauth_signature'] = sig
    return 'OAuth ' + ', '.join(f'{enc(k)}="{enc(v)}"' for k, v in sorted(oauth.items()))


def x_post_tweet(text: str, env: dict) -> dict:
    url = 'https://api.twitter.com/2/tweets'
    payload = {'text': text}
    hdr = oauth_header('POST', url, {}, env)
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                 headers={'Authorization': hdr, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# --- queue -------------------------------------------------------------------

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


PLACEHOLDER_MARK = '【'  # collect失敗時の要記入マーカー(LLM未生成=投稿不可)


def pick_draft(entries: list[dict], today: dt.date) -> dict | None:
    """未投稿・48h寿命内 (当日収集+前日残り) から当日優先・score降順1件。

    2026-09-04 承認flow撤廃: draft(未承認)も対象。reject/blocked は除外。
    品質skip(fail-closed): 要記入プレースホルダー/問い形でないask/単調warn付き。
    """
    elig = [d for d in entries
            if d.get('status') in ('draft', 'approved') and not d.get('posted_at')]
    hooks = [d.get('hook', '') for d in elig]
    cands = []
    for d in elig:
        try:
            age = (today - dt.date.fromisoformat(d['date'])).days
        except (KeyError, ValueError):
            continue
        if not 0 <= age <= 1:
            continue
        fields = (d.get('hook', ''), d.get('take', ''), d.get('ask', ''))
        if any(PLACEHOLDER_MARK in f for f in fields):
            continue  # LLM起草失敗(要記入)は人間執筆待ち=自動投稿しない
        if not ask_is_interrogative(d.get('ask', '')):
            continue
        others = [h for h, e in zip(hooks, elig) if e is not d]
        if uniformity_warning(d.get('hook', ''), others):
            continue
        cands.append((age, -(d.get('score') or 0), d))
    return min(cands)[2] if cands else None


def build_text(d: dict, include_url: bool = True) -> str:
    # 2026-09-05 jinno決定: URL行はimpressions回復まで外す (warmup.link_policy="none")。
    # 導線はプロフURL (lab.connectivebyte.com) で担保。復活はlink_policy="url"で即時。
    if include_url:
        return f"{d['hook']}\n{d['take']}\n\n{d['url']}\n\n{d['ask']}"
    return f"{d['hook']}\n{d['take']}\n\n{d['ask']}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    env = load_env()
    config = load_config()
    state = load_state()
    today = dt.date.today()
    month = today.strftime('%Y-%m')
    if state.get('month') != month:  # 月次リセット
        state = {'month': month, 'spend_usd': 0.0, 'accounts': state.get('accounts', {})}

    entries = load_queue()
    rc = 0
    include_url = config.get('warmup', {}).get('link_policy', 'url') == 'url'
    for acct in config['accounts']:
        alias, status = acct['alias'], acct['status']
        tier = acct.get('tier', 'url') if include_url else 'nourl'
        if status in ('not_created', 'banned'):
            log({'event': 'skip', 'account': alias, 'reason': status})
            continue
        a = acct_state(state, alias)
        if a.get('last_post') == today.isoformat():
            log({'event': 'skip', 'account': alias, 'reason': 'already posted today'})
            continue
        if status == 'warming':
            n = int(config.get('warmup', {}).get('post_every_n_days', 1))
            idx = [x['alias'] for x in config['accounts']].index(alias)
            if today.toordinal() % n != idx % n:
                log({'event': 'skip', 'account': alias, 'reason': 'warming not due today'})
                continue
        d = pick_draft(entries, today)
        if d is None:
            log({'event': 'skip', 'account': alias, 'reason': 'no eligible draft within 48h'})
            continue
        text = build_text(d, include_url)
        # §11機械検査 (fail-closed): 承認済みでも誇張語を含めば投稿拒否し
        # status=blocked で再選択対象外にする (毎晩の無駄retryを防ぐ)。
        hits = banned_hits(d.get('hook', ''), d.get('take', ''), d.get('ask', ''))
        if hits:
            log({'event': 'fail', 'account': alias, 'kind': 'banned_word',
                 'words': hits, 'url': d['url']})
            d['status'] = 'blocked'
            d['blocked_reason'] = 'banned_word: ' + '/'.join(hits)
            save_queue(entries)
            rc = 1
            continue
        if len(text) - (len(d['url']) if include_url else 0) + (23 if include_url else 0) > 280:
            log({'event': 'fail', 'account': alias, 'kind': 'too_long',
                 'length': len(text) - (len(d['url']) if include_url else 0)
                           + (23 if include_url else 0)})
            rc = 1
            continue

        print(f'=== {alias} ({status}/{tier}) ===')
        print(text)
        if args.dry_run:
            log({'event': 'dry_run', 'account': alias, 'tier': tier})
            continue
        aenv = resolve_env(env, acct.get('env_prefix', 'CBD'))
        if aenv is None:
            log({'event': 'skip', 'account': alias,
                 'reason': f'missing {acct.get("env_prefix", "CBD")}_ACCESS_* or X_API_* in .env'})
            continue
        price = PRICE[tier]
        cap = config.get('budget', {}).get('monthly_cap_usd')
        if cap is not None and state['spend_usd'] + price > cap:
            log({'event': 'skip', 'account': alias, 'reason': 'budget cap',
                 'spend_usd': state['spend_usd'], 'cap_usd': cap})
            continue

        try:
            resp = x_post_tweet(text, aenv)
        except urllib.error.HTTPError as e:
            kind, detail = classify_http_error(e)
            log({'event': 'fail', 'account': alias, 'kind': kind, 'detail': detail})
            if kind == 'auth_or_suspended':
                a['consecutive_auth_fail'] += 1
                if a['consecutive_auth_fail'] >= 3:
                    acct['status'] = 'banned'
                    save_config(config)
                    log({'event': 'account_marked', 'account': alias, 'to': 'banned'})
            rc = 1
            continue
        except urllib.error.URLError as e:
            log({'event': 'fail', 'account': alias, 'kind': 'network', 'detail': str(e)[:120]})
            rc = 1
            continue

        tweet_id = resp.get('data', {}).get('id')
        if d.get('status') == 'draft':
            d['status'] = 'approved'  # 2026-09-04 自動化: engine承認の記録
            d['approved_by'] = 'engine(2026-09-04承認flow撤廃)'
        a['last_post'] = today.isoformat()
        a['post_count'] += 1
        a['consecutive_auth_fail'] = 0
        state['spend_usd'] = round(state['spend_usd'] + price, 4)
        d['posted_at'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
        d['tweet_id'] = tweet_id
        save_queue(entries)
        log({'event': 'posted', 'account': alias, 'tier': tier, 'tweet_id': tweet_id,
             'price_usd': price, 'spend_usd': state['spend_usd'], 'url': d['url']})

    save_state(state)
    return rc


if __name__ == '__main__':
    sys.exit(main())
