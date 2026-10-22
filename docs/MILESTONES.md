# 実行用マイルストーン

長期の目的と段階の正本は[ORDER.md](../ORDER.md)。本書は既存の MS-001〜MS-004 を保った実行用の分解と状態台帳であり、長期計画を複製しない。受入証拠を確認してから状態を更新する。

## MS-001: 基本体験の安定

Outcome: 主要な選択から案内先までを、キーボードと狭い画面で確認でき、処理失敗を成功と誤認させない。
Acceptance: 代表する選択肢一つをキーボード操作と狭い画面で案内先まで確認して記録し、`node --test test/app-behavior.test.js test/server.test.js` が合格する。
Evidence: `npm test` 174件合格 (2026-10-22)。画面確認記録は pending。
Status: in_progress
Dependency: なし。
Next: 約30分で選択肢一つの操作・表示・遷移を記録し、該当2テストを実行する。差異があれば一箇所だけ直して再検証する。

## MS-002: 内容と導線の整合

Outcome: 公開内容が読者に約束することと次の行動が一致し、内部リンクと提供範囲を誤解させない。
Acceptance: 公開対象の各ページと導線の確認記録を残し、`node --test test/site-files.test.js` が合格する。
Evidence: pending。
Status: planned
Dependency: MS-001 の基本体験確認。
Next: MS-001 の出口後、公開ページ一つずつで案内文・遷移先・提供範囲を照合する。

## MS-003: 同意を尊重した改善

Outcome: 購読・解除と匿名の利用状況を分け、同意なしの取得や属性推定をせずに結果を説明できる。
Acceptance: 同意・拒否・撤回の各状態を確認し、`node --test test/events.test.js test/server.test.js` が合格する。実登録の成功とは区別して記録する。
Evidence: pending。
Status: planned
Dependency: MS-001 の基本体験確認。
Next: 同意状態ごとに保存・送信・表示のふるまいを確認し、拒否・撤回後に送信されないことを検証する。

## MS-004: 継続的な品質改善

Outcome: 一度に一つの改善仮説を、同じ操作条件の前後記録で評価し、次の判断に使える。
Acceptance: 変更前後の操作条件・観察結果・制約を記録し、関連する `node --test test/logic.test.js test/app-behavior.test.js` が合格する。読者成果や効率向上は独立した証拠なしに主張しない。
Evidence: pending。
Status: planned
Dependency: MS-001〜MS-003 の受入証拠。
Next: 先行3項目の出口後、検証可能な改善仮説を一つ選び、前後比較の条件と出口を先に定める。
