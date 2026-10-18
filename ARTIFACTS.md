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
  **現行 = `e4d8a9a21222`** (.py限定・版定義節参照・2026-10-17再実測)
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
- ⑥t0007のapprove時⚠stale警告+検証用`OUTREACH_QUEUE_PATH`追加 (レビュー指摘
  2件・テストpin 1件) で版は `99f88ba074c1` → `a476ac13d71d`、続く文言統合
  refactor (`_stale_msg` helper) で `6b11a3f976cd` — いずれも生成系実装 (.py)
  の変更なので正当。docs-only commitでは版不変を継続実証
- ⑦2026-09-22の強化batch (6c03447/e13cb94/e98f4e9/c7ad45c — `outreach.py`/
  `post.py`/`twitter_text_regex.py` の公開・計測・X字数まわりのhardening) で
  版は `6b11a3f976cd` → `31c857f21c9c` (.py変更なので正当・台帳の「現行」は
  このbatch後も更新漏れになっていた — 2026-10-03に再実測して本節で同期)。
  生存行は翌朝collectの`regen_stale` (limit 3/回) が自動で現行版へ揃える
- ⑧robots.txt新設 (sitemap宣言行・Pages配信木へ追加) に伴い、`outreach.py`の
  `PUBLISH_ROOT_FILES` へ robots.txt を足した (記事公開の隔離ツリーをPages配信木と
  同等に保つ parity 修正・2026-10-11)。版は `31c857f21c9c` → `cefc4d2e5fb4`
  (.py変更なので正当)。生成系の起草・再検査logicには変更なし — 生存行の
  `polish_version`/`gen_version` 判定は不変
- ⑨存在しないパスの失敗表示をサイト体裁の日本語404ページへ揃える `404.html` 新設
  (Pages配信木へ追加・ローカルサーバーも404ステータス+同ページで応答) に伴い、
  `outreach.py`の`PUBLISH_ROOT_FILES`へ404.htmlを足した (⑧と同じ隔離ツリーparity
  修正・2026-10-11)。版は `cefc4d2e5fb4` → `7d1eae75949c` (.py変更なので正当)。
  生成系の起草・再検査logicには変更なし
- ⑩persona gate恒久テスト (`scripts/x-discover/test_persona_gate.py`) の
  hermetic化修正 — collect側`persona_lines`のpatch漏れ (姉妹repo無しhostで
  enrich系3testが赤) と`enrich.main`窓判定の実日付依存 (暦の経過だけで赤) を
  修正・本体生成系は無変更 (2026-10-12)。版は `7d1eae75949c` → `5a42158b803a`
  (.py変更なので正当 — テストfileも版対象)。生成系の起草・再検査logicには
  変更なし — 生存行の`polish_version`/`gen_version` 判定は不変
- ⑪同suiteのhermetic性を構造保証 — `GateTest.setUp`が`PERSONA_YAML`を
  実在しないpathへ向ける (per-test復元)。persona_linesのpatch漏れがあると
  実yaml読みが即FileNotFoundErrorで赤になる — 姉妹repoを持つhostでも
  ⑩と同種の回帰を検知できる (2026-10-12・test stage)。版は
  `5a42158b803a` → `d098ab53249c` (.py変更なので正当)。生成系logicは無変更
- ⑫LPのog:image新設 (絶対URL指定・`og-image-1200x630.png`) に伴い、配信木
  (deploy workflowのcp行・`test/publish-tree.test.js`のROOT_FILES) と
  `outreach.py`の`PUBLISH_ROOT_FILES`へ同PNGを足した (⑧⑨と同じ隔離ツリー
  parity修正・2026-10-12)。版は `d098ab53249c` → `b912a5a8d954` (.py変更なので
  正当)。生成系の起草・再検査logicには変更なし
- ⑬collect.py docstringとGENRES.mdの素材源記載に実装されなかったReddit
  (v0から一度も収集codeが存在せず) が残っていたのを実態 (HN/GitHubのみ) へ
  一致させた docs修正 (2026-10-12)。版は `d098ab53249c` → `f7a355559ee1`
  (⑫と同じbaseからの並行line遷移・.py変更なので正当 — docstringのみで
  生成系logicは無変更)。生存行の`polish_version`/`gen_version` 判定は不変
- ⑭⑬と同種の放置を構造防止する素材源docs↔実装整合guard
  (`test/x-discover-sources.test.js`) 新設 — GENRES.md素材源v0行とcollect.py
  docstring冒頭に列挙した素材源の収集関数 (collect_*) 実装をtest段階で保証。
  Reddit再記載で赤になることを実測確認 (2026-10-12・test stage)。版は不変
  (test/*.jsと本台帳は版対象外 — このcommitでも当時の現行 `f7a355559ee1` が
  動かないことが下の「以後」節の実証になる)
- ⑮`crm.py digest --inbox`が親repoのINBOX.md追記後すぐcommitする
  `commit_inbox()`追加 (caretaker sweep依存とpost_dispatch dirty検知の解消 —
  3378b04・2026-10-17)。版は `b912a5a8d954` → `e4d8a9a21222` (.py変更なので
  正当)。台帳「現行」の同期漏れを ⑦と同種の回帰防止ガード
  (`test/artifacts-ledger.test.js`) が検知 — 本節で同期。起草・再検査logicには
  変更なし
- merge統合注記: ⑫と⑬は同一base `d098ab53249c` から別branchで並行に版を動かした
  記録 — 統合後のtreeは双方の.py変更を同居させるため、上記「現行」表記は
  再実測での同期を要する (検知guard: `test/artifacts-ledger.test.js`)
- 以後、文書変更 (本台帳の更新・scripts下READMEの更新を含む) では版は不変 —
  scripts/下の.py (codeとpromptの実体) が変わったときだけ版が動く。本節の
  更新commitで版が変わらないことがそのまま実証になる
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
- ⑥t0007のapprove時⚠stale警告+検証用`OUTREACH_QUEUE_PATH`追加 (レビュー指摘
  2件・テストpin 1件) で版は `99f88ba074c1` → `a476ac13d71d`、続く文言統合
  refactor (`_stale_msg` helper) で `6b11a3f976cd` — いずれも生成系実装 (.py)
  の変更なので正当。docs-only commitでは版不変を継続実証
- ⑦2026-09-22の強化batch (6c03447/e13cb94/e98f4e9/c7ad45c — `outreach.py`/
  `post.py`/`twitter_text_regex.py` の公開・計測・X字数まわりのhardening) で
  版は `6b11a3f976cd` → `31c857f21c9c` (.py変更なので正当・台帳の「現行」は
  このbatch後も更新漏れになっていた — 2026-10-03に再実測して本節で同期)。
  生存行は翌朝collectの`regen_stale` (limit 3/回) が自動で現行版へ揃える
- ⑧robots.txt新設 (sitemap宣言行・Pages配信木へ追加) に伴い、`outreach.py`の
  `PUBLISH_ROOT_FILES` へ robots.txt を足した (記事公開の隔離ツリーをPages配信木と
  同等に保つ parity 修正・2026-10-11)。版は `31c857f21c9c` → `cefc4d2e5fb4`
  (.py変更なので正当)。生成系の起草・再検査logicには変更なし — 生存行の
  `polish_version`/`gen_version` 判定は不変
- ⑨存在しないパスの失敗表示をサイト体裁の日本語404ページへ揃える `404.html` 新設
  (Pages配信木へ追加・ローカルサーバーも404ステータス+同ページで応答) に伴い、
  `outreach.py`の`PUBLISH_ROOT_FILES`へ404.htmlを足した (⑧と同じ隔離ツリーparity
  修正・2026-10-11)。版は `cefc4d2e5fb4` → `7d1eae75949c` (.py変更なので正当)。
  生成系の起草・再検査logicには変更なし
- ⑩persona gate恒久テスト (`scripts/x-discover/test_persona_gate.py`) の
  hermetic化修正 — collect側`persona_lines`のpatch漏れ (姉妹repo無しhostで
  enrich系3testが赤) と`enrich.main`窓判定の実日付依存 (暦の経過だけで赤) を
  修正・本体生成系は無変更 (2026-10-12)。版は `7d1eae75949c` → `5a42158b803a`
  (.py変更なので正当 — テストfileも版対象)。生成系の起草・再検査logicには
  変更なし — 生存行の`polish_version`/`gen_version` 判定は不変
- ⑪同suiteのhermetic性を構造保証 — `GateTest.setUp`が`PERSONA_YAML`を
  実在しないpathへ向ける (per-test復元)。persona_linesのpatch漏れがあると
  実yaml読みが即FileNotFoundErrorで赤になる — 姉妹repoを持つhostでも
  ⑩と同種の回帰を検知できる (2026-10-12・test stage)。版は
  `5a42158b803a` → `d098ab53249c` (.py変更なので正当)。生成系logicは無変更
- ⑫collect.py docstringとGENRES.mdの素材源記載に実装されなかったReddit
  (v0から一度も収集codeが存在せず) が残っていたのを実態 (HN/GitHubのみ) へ
  一致させた docs修正 (2026-10-12)。版は `d098ab53249c` → `f7a355559ee1`
  (.py変更なので正当 — docstringのみで生成系logicは無変更)。生存行の
  `polish_version`/`gen_version` 判定は不変
- ⑬⑫と同種の放置を構造防止する素材源docs↔実装整合guard
  (`test/x-discover-sources.test.js`) 新設 — GENRES.md素材源v0行とcollect.py
  docstring冒頭に列挙した素材源の収集関数 (collect_*) 実装をtest段階で保証。
  Reddit再記載で赤になることを実測確認 (2026-10-12・test stage)。版は不変
  (test/*.jsと本台帳は版対象外 — このcommitでも現行 `f7a355559ee1` が
  動かないことが下の「以後」節の実証になる)
- ⑭LPのog:image新設 (絶対URL指定・`og-image-1200x630.png`) に伴い、配信木
  (deploy workflowのcp行・`test/publish-tree.test.js`のROOT_FILES) と
  `outreach.py`の`PUBLISH_ROOT_FILES`へ同PNGを足した (⑧⑨と同じ隔離ツリー
  parity修正・2026-10-12)。版は `d098ab53249c` → `b912a5a8d954` (.py変更なので
  正当)。生成系の起草・再検査logicには変更なし — ⑫⑬ (HEAD側) と共通base
  `d098ab53249c` からの並行分岐で実測した値
- ⑮`crm.py digest --inbox`が親repoのINBOX.md追記後すぐcommitする
  `commit_inbox()`追加 (caretaker sweep依存とpost_dispatch dirty検知の解消 —
  3378b04・2026-10-17)。版は `b912a5a8d954` → `e4d8a9a21222` (.py変更なので
  正当)。台帳「現行」の同期漏れを ⑦と同種の回帰防止ガード
  (`test/artifacts-ledger.test.js`) が検知 — 本節で同期。起草・再検査logicには
  変更なし
- ⑫⑬と⑭⑮は共通base `d098ab53249c` からの2分岐の並行進化で、本mergeで両側の
  .py変更が合流する — 合流後の現行版は両側変更を含む新たなhashになるため、
  merge commit時に再実測して冒頭の「現行」行を同期する (⑦の再実測と同種)
- 以後、文書変更 (本台帳の更新・scripts下READMEの更新を含む) では版は不変 —
  scripts/下の.py (codeとpromptの実体) が変わったときだけ版が動く。本節の
  更新commitで版が変わらないことがそのまま実証になる
