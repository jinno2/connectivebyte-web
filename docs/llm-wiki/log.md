# GoalDev Log

永続的決定と完了記録を追記する。各エントリに日付と検証を必ず付ける
（原則: contracts `llm-wiki-discipline` の log-is-append-with-correction）。

## 2026-09-26 — llm-wiki スキャフォールド

contracts の llm-wiki-discipline 原則に基づき `docs/llm-wiki/` を新設した。

- **Verification**: 原則 `registry/principles/llm-wiki-discipline.yaml`（contracts リポ commit 3ab5768）。

## 2026-09-26 — 親の確定（jinno確定）

relations.md の親草案を確定版へ訂正した（親: tas_launchops）。

**Verification**: contracts registry `registry/organization/repositories/connectivebyte-web.yaml` の spec.parent と一致することを確認（contracts commit ecbc226、validate/lint 0 errors 済み）。

## 2026-10-12 — relations.md に機械可読 Evidence を追加

親関係（tas_launchops）の証跡を memo 契約の Evidence 行（sha256）に整形し、
contracts 現行 HEAD で再検証した。関係の主張自体に変更はない。

**Verification**: contracts `registry/organization/repositories/connectivebyte-web.yaml`（HEAD 01134ce）の spec.parent = tas_launchops を実ファイルで再確認し、sha256 を Evidence 行へ記録。
