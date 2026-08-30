# ARCHITECTURE

## メタデータ

- 目的: LPの技術構造を定義する
- 上位文書: `MODULE_GOALS.md`
- 状態: 完了

## 設計

静的HTML、CSS、vanilla JavaScript ES modulesのみを採用する。表示、純粋な導線判定、ブラウザ状態管理を分離する。保存先はlocalStorageに限定し、許可されたキーのみを扱う。メール登録は明示同意の上で登録endpointへ送信し、メールアドレスは匿名イベントとは別の保存先で管理する。

## コンポーネント

- `index.html`: セマンティックな画面
- `styles.css`: レスポンシブ表示
- `logic.js`: 純粋関数
- `app.js`: DOM、同意、保存、計測

## 技術選択

追加依存がなく、監査可能性、配信容易性、長期保守性、実装の単純性を優先する。
