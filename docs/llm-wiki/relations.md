# Repository relations
Repository: connectivebyte-web

## tas_launchops
- Status: confirmed
- Relationship: escalation parent — contracts 組織レジストリが定める本repoの親（エスカレーション経路の上位）
- Responsibility: 本repoは公開サイトの本文・配信物とその公開規約を所有する。リポ階層の所管と直属エスカレーションの判定は contracts 側が正本
- Canonical sources: contracts:registry/organization/repositories/connectivebyte-web.yaml (spec.parent)
- Change rule: contracts の spec.parent が変わったときは本memoを更新し、docs/llm-wiki/log.md に検証付きで記録する（既存ルール: contracts registry/principles/escalation-chain.yaml）
- Evidence: contracts:registry/organization/repositories/connectivebyte-web.yaml sha256:6c0e8b7904b7357e6a919e77c7d8eceea2019beefa1db2633cda79da7f6c019c
- Observation: spec.parent = tas_launchops。jinno確定 2026-09-26（一括レビュー表 output/repo-parent-review-2026-09-26.md を現状案で承認・当時の contracts commit ecbc226）。2026-10-12 再確認（現行ファイル・contracts commit 35f25bb）
