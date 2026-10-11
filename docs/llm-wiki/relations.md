# Repository relations
Repository: connectivebyte-web

## 階層関係（エスカレーション経路）

- 親: tas_launchops（jinno確定 2026-09-26）
- 根拠: 公開サイト本文でありコンテンツ配信に直接属す
- 出典: contracts registry `registry/organization/repositories/connectivebyte-web.yaml` の spec.parent（contracts commit ecbc226）。2026-09-26 の一括レビュー表output/repo-parent-review-2026-09-26.md（ローカル output ディレクトリ）を jinno が現状案で承認。
- Evidence: contracts:registry/organization/repositories/connectivebyte-web.yaml sha256:6c0e8b7904b7357e6a919e77c7d8eceea2019beefa1db2633cda79da7f6c019c
- Evidence: connectivebyte-web:SYSTEM_CONSTITUTION.md sha256:71e78c776a221ab555dc9627eb439107469bfe3df7b4a7bf9bea42b69d750ac8
- Observation: 再検証 2026-10-12（contracts HEAD 01134ce）— spec.parent は tas_launchops で不変。出典の ecbc226 は決定時点の provenance。
- Observation: SYSTEM_CONSTITUTION.md は公開サイトの不変条件と ORDER/AGENTS/AUTOMATION の役割分担を定め、公開サイト本文である根拠。

