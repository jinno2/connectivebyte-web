# MODULE_STRUCTURE

## メタデータ

- 目的: 物理構造を定義する
- 上位文書: `ARCHITECTURE.md`
- 状態: 完了

## 構造

```text
.
├── .github/workflows/ci.yml
├── .module/*.md
├── test/logic.test.js
├── app.js
├── logic.js
├── index.html
├── styles.css
├── package.json
└── README.md
```

## データフロー

利用者操作 → 純粋関数による判定 → DOM更新 → 同意済み匿名イベント保存。
