# GoalDev Log

永続的決定と完了記録を追記する。各エントリに日付と検証を必ず付ける
（原則: contracts `llm-wiki-discipline` の log-is-append-with-correction）。

## 2026-09-26 — llm-wiki スキャフォールド

contracts の llm-wiki-discipline 原則に基づき `docs/llm-wiki/` を新設した。

- **Verification**: 原則 `registry/principles/llm-wiki-discipline.yaml`（contracts リポ commit 3ab5768）。

## 2026-09-26 — 親の確定（jinno確定）

relations.md の親草案を確定版へ訂正した（親: tas_launchops）。

**Verification**: contracts registry `registry/organization/repositories/connectivebyte-web.yaml` の spec.parent と一致することを確認（contracts commit ecbc226、validate/lint 0 errors 済み）。

## 2026-10-22 — 計画と実行マイルストーン整備

既存の ORDER.md を長期計画の正本として補強し、MS-001〜MS-004 のIDを維持した実行用台帳を追加。README・憲法・wikiから正本と実行状態へリンクし、REPO_METADATA.json を原本のGit blobへ同期した。

- **Verification**: `npm test` 174 pass / 0 fail。計画構造検証は実施。

## 2026-11-02 — 自動merge腐敗の診断と修復 (PR #39 red CI / merge 32bd82e)

inbox `auto_merge_blocked`「PR #39: CI checks failed and stale-base refresh is impossible」を原因調査した。

- **PR #39 red CI の根因**: sweep の `refresh_branch_onto_base` 機械mergeが master 側の .py 変更（`scripts/t0007-outreach/crm.py` 新規・`outreach.py` 変更）を PR 枝へ持ち込み、`ARTIFACTS.md` の「現行 pipeline_version」行を再実測同期しなかった（台帳自身がmerge時同期を定める）。記録 `e4d8a9a21222` ≠ 実測 `7c6f75bde905` で `test/artifacts-ledger.test.js` が失敗し、`outreach-publish` の公開guardが隔離publish treeで全 `npm test`（台帳guard込み）を走らせるため `publish-article` testも連鎖失敗。「refresh impossible」は正当挙動 — 枝は既に base tip 81b6e3e を含み再refreshはno-op。PR枝の治癒には枝へのpushが必要で本runの権限外。
- **merge 32bd82e (codex/fix-r1-r3 × master) の腐敗**: codex側hunkがmarkdown fence付きで貼り込まれ `app.js`/`share.js` の実文を文字列化、`test/share.test.js`（本文二重化）・`test/app-behavior.test.js`・`test/x-discover-post.test.js` が構文破壊、`LOOP.md`/`PURPOSE.md` が文書複製（幻のrepo名 connectivebyte-web-r1-r3）、`ORDER.md`/`docs/MILESTONES.md`/`REPO_METADATA.json` が旧側誤解決。HEADで `npm test` 4件失敗（136 tests）。
- **修復**: 差分10 fileをすべて origin/master (81b6e3e) の正本へ復元。masterがcodex側変更（test追加・source fix）の検証済み厳密上位集合であることをgrep確認済み（master CI green）。
- **教訓**: .py を変える機械mergeは台帳「現行」行の再実測を挟まないと `artifacts-ledger` guardで確実に検出される。自動merge成果物はfence/重複パターンで検査できる。
- **Verification**: 修復後 `npm test` 全合格（本commit時点の実行結果はrun報告参照）。PR #39 側は未修復（権限外）— 台帳「現行」を `7c6f75bde905` へ同期し重複block除去、またはPR再上陸が必要。
