"""LLM呼び出しbackendの切替 (2026-09-05〜・litellm proxy / codex exec)。

LLM_BACKEND env (~/.local/share/cb-fleet/.env):
  'litellm' (既定) — localhost:14000 proxy経由。modelはLITELLM_MODEL env
                     (2026-09-05〜qwen3.8-max-preview-direct退避運用)
  'codex'          — Codex CLIの非対話モード (codex exec)。ChatGPTサブスク範囲内・
                     公式CLIの公式自動化インターフェース=key抽出ではない
                     (z.ai Coding Plan系の規約問題と構造が違う)。
                     1呼出〜15秒・--ephemeral(セッション不残)・read-only sandbox・
                     出力は-o file (最終メッセージのみ)。上限=5時間窓+週次 (量は少容量)。

どちらも失敗時はNoneを返す (呼出側の既存fallback: placeholder→翌朝refillへ)。
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


def llm_text(prompt: str, timeout: int = 120, max_tokens: int = 2500) -> str | None:
    """promptを送り生成textを返す。backendはLLM_BACKEND env (既定=litellm)。"""
    if os.environ.get('LLM_BACKEND') == 'codex':
        return _codex(prompt, timeout)
    return _litellm(prompt, timeout, max_tokens)
