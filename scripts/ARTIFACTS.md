# 生成物台帳 — 版管理の対象と証跡

思想の正本: connective-byte `SYSTEM_CONSTITUTION.md`「生成物の版管理」—
生成物は作られたときのシステムversionを記録し、システム更新後は現行versionと
異なる**生存**生成物をすべて再生成する。本fileはこのrepo内の全生成機構の台帳。

版 = `pipeline_version()` (`x_discover_rules.py`) = scripts/木のgit tree hash
短縮形 (scripts下が汚れていれば `+`、git不在は `unknown`)。生成codeとpromptの
実体が変わったときだけ変わる — docs-only commitでは不変 (repo全体のHEAD短hash
だった頃は、docs commitだけで全生存行がspuriously stale化する実害があった・
2026-09-15修正)。
対象 = pipelineが自動生成し提供され得るもの (LLM起草物とその直接レンダリング)。
手作りasset (brand logo等) はpipeline生成物でなくgit管理のみ。

## 生成機構と版管理の対応 (全機構)

| 機構 | 生成物 | 版の記録 | stale検知 | 再生成 |
|---|---|---|---|---|
| x-discover `collect.py llm_draft` (main/refill/redraft 全3経路) | queue行の hook/take/ask | `gen_version` | `repolish._eligible` | 朝cron `regen_stale` (limit 3/回) ・ `repolish.py --limit 0` |
| x-discover `polish_draft` (collect/enrich/repolish共用) | 字単位批評→改稿後の同3行 | `polish_version` | 同上 | 同上 |
| x-discover `enrich.py` (実測redraft) | 試用実測事実版の3行 | `polish_version` | 同上 | enrich再実行 / repolish |
| t0007-outreach `draft` | 記事案 / アウトリーチ文面 | `gen_version` | `show` が旧版に ⚠stale を表示 | 再 `draft <target>` → 既存approve gate |
| 投稿済みtweet (x-discover post.py) | 行に `posted_at`/`tweet_id` を記録 | 行の版fieldが生成時の証跡として残る | — (提供済=死人居) | 対象外 |
| 公開済み記事HTML (outreach publish-article) | 本文からHTMLを生成しgit commit | git履歴が版 | — (提供済) | 再publish |

死人居 (投稿済・窓外・rejected/blocked) は二度と提供されないため再生成対象外 —
版管理の対象は**生存物のみ** (憲法どおり)。

## 監査手順 (再現可能・LLM消費ゼロ)

discover queue全行を生存/死人/版stateに分類する (stale判定は `repolish._eligible`
そのものを呼ぶ — logicの複製を作らない):

```bash
cd scripts/x-discover && python3 - <<'EOF'
import datetime as dt
from collections import Counter
import repolish
rows = repolish.read_jsonl(repolish.QUEUE)
today = dt.date.today()
cats = Counter()
for r in rows:
    if r.get('posted_at'): cats['posted'] += 1
    elif r.get('status') not in ('draft', 'approved'): cats['dead:' + str(r.get('status'))] += 1
    elif repolish._is_placeholder(r): cats['placeholder'] += 1
    elif not repolish.in_post_window(r, today): cats['out_of_window'] += 1
    elif repolish._eligible(r, today, force=False): cats['STALE'] += 1
    else: cats['current'] += 1
print(dict(cats))
EOF
```

- 生存行は `current` か `STALE` のみ。`STALE` は翌朝collectが自動で現行版に揃える
- outreach queue: `python3 outreach.py show --pending` — 旧version行に ⚠stale 表示

## 実測 (2026-09-15・版管理実装commit時点)

- pipeline_version = `6ae371c` (x-discover版管理commit hash)
- discover-queue.jsonl 61行: posted 14 / out_of_window 43 / rejected 2 /
  **STALE 2** (行59・60 — 版印無しの生存行のみ) / current 0 / placeholder 0
- version印済み 0行 — 実装直後のため。翌朝09:17 collectが生存2行を再検査して
  現行版に揃え、以後の新規行は起草時に印を付ける (limit 3/回・生存2行は1朝で完遂)
- outreach-queue.jsonl 18行 (article/outreach×draft/approved/sent/published/rejected) —
  版印は新規draftから付与。旧行はshowで⚠stale表示・approve前に再起草を判断
