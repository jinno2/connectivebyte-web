# TEST

## メタデータ

- 目的: 品質保証方法を定義する
- 上位文書: `IMPLEMENTATION.md`, `BEHAVIOR.md`
- 状態: 完了

## 戦略

- Unit: 5択導線、C表現、自己選択昇格の正常系・境界・不正値
- Integration: HTML参照先、イベント名、保存キーの静的検査
- E2E: 選択、同意、登録、CTAの手動確認
- Performance: 依存なし静的資産のサイズ確認

## 自動化

Node.js組込`node:test`を`npm test`およびGitHub Actionsで実行する。純粋関数の分岐を100%対象とする。
