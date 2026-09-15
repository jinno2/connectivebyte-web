# 生成物台帳 — 版管理の対象と証跡

思想の正本: connective-byte `SYSTEM_CONSTITUTION.md`「生成物の版管理」—
生成物は作られたときのシステムversionを記録し、システム更新後は現行versionと
異なる**生存**生成物をすべて再生成する。本fileはこのrepo内の全生成機構の台帳。

版 = `pipeline_version()` (`x_discover_rules.py`) = scripts下のtracked .py
(code+埋込みpromptの実体) のcontent hash短縮形 (.pyに未commit変更があれば
`+`、git不在は `unknown`)。生成codeとpromptの実体が変わったときだけ変わる —
docs-only commitでは不変。対象の絞りは実測で3段階 (HEAD短hash→scripts/木
tree hash→.py限定): tree hashまで絞ってもscripts下READMEのdocs commitで
版が動いて全生存行がspuriously stale化する実害があった (2026-09-15)。
README/GENRES/画像/x-discover-config.json は選定・投稿policyのパラメータや
媒体で起草textの生成系でないため対象外。
対象 = pipelineが自動生成し提供され得るもの (LLM起草物とその直接レンダリング)。
手作りasset (brand logo等) はpipeline生成物でなくgit管理のみ。

## 生成機構と版管理の対応 (全機構)

| 機構 | 生成物 | 版の記録 | stale検知 | 再生成 |
|---|---|---|---|---|
| x-discover `collect.py llm_draft` (main/refill/redraft 全3経路) | queue行の hook/take/ask | `gen_version` | `repolish._eligible` | 朝cron `regen_stale` (limit 3/回) ・ `repolish.py --limit 0` |
| x-discover `polish_draft` (collect/enrich/repolish共用) | 字単位批評→改稿後の同3行 | `polish_version` | 同上 | 同上 |
| x-discover `enrich.py` (実測redraft) | 試用実測事実版の3行 | `polish_version` | 同上 | enrich再実行 / repolish |
| t0007-outreach `draft` | 記事案 / アウトリーチ文面 | `gen_version` | `show`/`approve` が旧版に ⚠stale を表示 | 再 `draft <target>` → 既存approve gate |
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

## 実測 (2026-09-15・版管理の初回full cycle完了時点)

- pipeline_version = `c82e1c4c96fa` (初回cycle時点・当時はscripts/木tree hash) —
  **現行 = `99f88ba074c1`** (.py限定・版定義節参照)
- 監査: posted 14 / out_of_window 43 / rejected 2 / **current 5** /
  STALE 0 / placeholder 0 — 版印は生存5行すべて `c82e1c4c96fa` で単一versionに収束
- 初回cycleの証跡: ①09:17 cronが新規3件を版印付きで起草+stale 2行を自動再生成
  (`regen_stale`初運転) ②別セッションのdocs-only commit (d185f87) で全生存行が
  spuriously stale化する実害を検出 → 版対象をscripts/木tree hashへ修正 (6b1d078)
  ③台帳自身がscripts/木内にあったため台帳更新でも版が変転 → repo rootへ移動
  (9979ad9) ④`repolish.py`で生存5行を再検査 — 全件r8収束・persona pass
- 生存行の`gen_version`が旧形式 (dfdddbc) でも`polish_version`が現行ならcurrent
  扱い — 「最新の再検査が現行システム」が版管理の判定意味
- ⑤文書のscope修正commit (版対象を.py限定・README/t0007文書の同期と同一commit)
  で版が `c82e1c4c96fa` → `99f88ba074c1` へ一度だけ移動 — これは生成系実装の
  変更なので正当な版移動。生存5行は翌朝cronの`regen_stale` (limit 3/回) で
  順次現行版へ揃う
- 以後、文書変更 (本台帳の更新・scripts下READMEの更新を含む) では版は不変 —
  scripts/下の.py (codeとpromptの実体) が変わったときだけ版が動く。本節の
  更新commitで版が変わらないことがそのまま実証になる
