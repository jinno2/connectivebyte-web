"""LLM呼び出しbackendの切替 (2026-09-05〜・devin / codex / litellm proxy)。

LLM_BACKENDS env (~/.local/share/cb-fleet/.env・カンマ区切り優先順):
  devin    — Devin CLI非対話モード (devin -p)。modelはDEVIN_MODEL env
             (2026-09-05〜gpt-6-astra-medium・jinno指示「devin優先+Astra試用」)。
             枠はDevinプランquota (実測9秒/呼出)。t0006のclaude -p箱と同構造。
  codex    — Codex CLI非対話モード (codex exec)。ChatGPTサブスク範囲内・
             公式CLIの公式自動化インターフェース=key抽出ではない
             (z.ai Coding Plan系の規約問題と構造が違う)。
             1呼出〜15秒・--ephemeral・read-only sandbox・出力は-o file。
  litellm  — localhost:14000 proxy経由。modelはLITELLM_MODEL env
             (上流全滅時のqwen退避経路・最終fallback)。

旧LLM_BACKEND env (単一) も可。chain先頭から試し、失敗したら次へ (logに残す)。
全backend失敗時はNone (呼出側の既存fallback: placeholder→翌朝refillへ)。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import urllib.request

LITELLM_URL = 'http://localhost:14000/v1/chat/completions'


def _litellm(prompt: str, timeout: int, max_tokens: int) -> str | None:
    key = os.environ.get('LITELLM_API_KEY')
    if not key:
        return None
    body = json.dumps({'model': os.environ.get('LITELLM_MODEL', 'default'),
                       'max_tokens': max_tokens,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(LITELLM_URL, data=body,
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode())
    except Exception as e:  # 安定稼働: 失敗理由をlogに残す (握り潰さない)
        print(f'      [llm] request fail: {type(e).__name__}: {str(e)[:120]}')
        return None
    msg = data['choices'][0]['message']
    # proxy経由でcontent空+reasoning_contentのみの応答が間欠発生 → 両方見る
    return (msg.get('content') or msg.get('reasoning_content') or '').strip() or None


def _devin(prompt: str, timeout: int) -> str | None:
    """devin -p (headless)。戻り値=応答text or None。modelはDEVIN_MODEL env。"""
    bin_ = shutil.which('devin') or '/home/jinno/.local/bin/devin'  # cron PATH外対策
    if not os.path.exists(bin_):
        print(f'      [llm] devin not found: {bin_}')
        return None
    cmd = [bin_, '-p', prompt,
           '--respect-workspace-trust', 'false']  # print modeはuntrusted dirで失敗するため
    if os.environ.get('DEVIN_MODEL'):
        cmd += ['--model', os.environ['DEVIN_MODEL']]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=max(timeout, 180),
                           cwd='/tmp')  # repo外で実行=workspace文脈を汚さない
        text = p.stdout.strip()
    except subprocess.TimeoutExpired:
        print(f'      [llm] devin timeout (>={max(timeout, 180)}s)')
        return None
    except Exception as e:
        print(f'      [llm] devin fail: {type(e).__name__}: {str(e)[:120]}')
        return None
    if p.returncode != 0 or not text:
        print(f'      [llm] devin rc={p.returncode}: {(p.stderr or p.stdout or "")[:120]}')
        return None
    return text


def _codex(prompt: str, timeout: int) -> str | None:
    """codex exec (headless)。戻り値=最終メッセージ全文 or None。"""
    bin_ = shutil.which('codex') or '/home/jinno/.local/bin/codex'  # cron PATH外対策
    if not os.path.exists(bin_):
        print(f'      [llm] codex not found: {bin_}')
        return None
    fd, out = tempfile.mkstemp(suffix='.txt')
    os.close(fd)
    cmd = [bin_, 'exec', '--skip-git-repo-check', '--ephemeral',
           '-s', 'read-only', '-C', '/tmp', '-o', out]
    if os.environ.get('CODEX_MODEL'):
        cmd += ['-m', os.environ['CODEX_MODEL']]
    cmd.append(prompt)
    try:
        p = subprocess.run(cmd, capture_output=True, text=True,
                           timeout=max(timeout, 180))
        text = open(out).read().strip()
    except subprocess.TimeoutExpired:
        print(f'      [llm] codex timeout (>={max(timeout, 180)}s)')
        return None
    except Exception as e:
        print(f'      [llm] codex fail: {type(e).__name__}: {str(e)[:120]}')
        return None
    finally:
        try:
            os.unlink(out)
        except OSError:
            pass
    if p.returncode != 0 or not text:
        print(f'      [llm] codex rc={p.returncode}: {(p.stderr or p.stdout or "")[:120]}')
        return None
    return text


_BACKENDS = {'devin': _devin, 'codex': _codex, 'litellm': _litellm}


def llm_text(prompt: str, timeout: int = 120, max_tokens: int = 2500) -> str | None:
    """promptを送り生成textを返す。backend=LLM_BACKENDS env優先順 (既定=litellm)。
    先頭から試して失敗なら次へ (どのbackendが担当したかはlog行で判別可)。"""
    chain = [b.strip() for b in os.environ.get('LLM_BACKENDS',
                                                os.environ.get('LLM_BACKEND', 'litellm')).split(',')]
    for name in chain:
        fn = _BACKENDS.get(name)
        if not fn:
            print(f'      [llm] unknown backend: {name}')
            continue
        text = fn(prompt, timeout) if name != 'litellm' else fn(prompt, timeout, max_tokens)
        if text:
            return text
    return None
