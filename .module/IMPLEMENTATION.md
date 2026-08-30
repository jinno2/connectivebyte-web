# IMPLEMENTATION

## メタデータ

- 目的: 実装仕様を定義する
- 上位文書: `MODULE_STRUCTURE.md`, `BEHAVIOR.md`
- 状態: 完了

## 方針

`getInterestRoute`、`shouldUseStrongCMessage`、`promoteBySelfSelection`を副作用のない関数として実装する。状態層は保存キーを固定し、イベント属性を共通生成する。入力値は許可リストで検証する。メールアドレスは登録endpoint経由でのみ送信し、匿名イベントには混ぜない。

## 制約

- 外部ライブラリ、CDN、外部フォントを使用しない
- コメントを追加しない
- 職業、年収、能力、性格、AI習熟度、外部履歴を取得・推定しない
- 未承認のレベル診断、レベル表を公開しない

## 性能

初期表示資産を小さく保ち、主要操作を同期的に完了する。
