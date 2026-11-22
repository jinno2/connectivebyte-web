# Repository relations
Repository: connectivebyte-web

## 階層関係（エスカレーション経路）

- 親: `tas_launchops`（Status: confirmed）
- Relationship: contracts 組織レジストリが定める本repoの親（エスカレーション経路の上位）
- Responsibility: 本repoは公開サイトの本文・配信物とその公開規約を所有する。リポ階層の所管と直属エスカレーションの判定は contracts 側が正本
- 根拠: 公開サイト本文であり、コンテンツ配信に直接属する
- Canonical source: contracts registry `registry/organization/repositories/connectivebyte-web.yaml` の `spec.parent`
- 出典: 2026-09-26 の一括レビュー表 `output/repo-parent-review-2026-09-26.md`（ローカル output ディレクトリ）を jinno が現状案で承認。当時の contracts commit は `ecbc226`
- Change rule: contracts の `spec.parent` が変わったときは本memoを更新し、`docs/llm-wiki/log.md` に検証付きで記録する（既存ルール: contracts `registry/principles/escalation-chain.yaml`）
- Evidence: contracts:registry/organization/repositories/connectivebyte-web.yaml sha256:6c0e8b7904b7357e6a919e77c7d8eceea2019beefa1db2633cda79da7f6c019c
- Evidence: connectivebyte-web:SYSTEM_CONSTITUTION.md sha256:71e78c776a221ab555dc9627eb439107469bfe3df7b4a7bf9bea42b69d750ac8
- Observation: `spec.parent = tas_launchops`。2026-10-12 の再確認でも不変。記録上の再確認時点は contracts HEAD `01134ce` とされ、別記録では現行ファイルを contracts commit `35f25bb` で再確認したとされる。`ecbc226` は決定時点の provenance。
- Observation: SYSTEM_CONSTITUTION.md は公開サイトの不変条件と ORDER/AGENTS/AUTOMATION の役割分担を定めており、本repoが公開サイト本文を所有する根拠。
