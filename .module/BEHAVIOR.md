# BEHAVIOR

## メタデータ

- 目的: 期待動作を定義する
- 上位文書: `MODULE_STRUCTURE.md`, `ARCHITECTURE.md`
- 状態: 完了

## シナリオ

### 初回選択

Given 未選択の訪問者、When E/D/C/B/Aを選ぶ、Then 自己申告値に対応する導線を1件表示する。

### Cの表現

Given Cを自己選択した訪問者、When 結果を表示する、Then 強い表現を表示する。Given C以外、When 結果を表示する、Then 強い表現を表示しない。

### 昇格

Given 自己選択履歴、When より進んだ選択を本人が行う、Then 対象セグメントを昇格する。Given 行動イベントのみ、When 再判定する、Then 昇格しない。

### 同意

Given analytics未同意、When 操作する、Then 行動イベントを保存しない。Given email明示同意、When メール登録する、Then 登録endpointへ送信し匿名IDに登録イベントを関連付ける。
