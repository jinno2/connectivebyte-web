# ConnectiveByte 診断LP MVP

Purpose / Visionと、本人が選ぶE・D・C・B・Aの5択から次のコンテンツへ案内する静的LPです。能力や属性を評価する診断ではありません。

## 実行

Node.js 20以上を使用します。外部パッケージのインストールは不要です。

```bash
npm test
npm run serve
```

`http://127.0.0.1:4173`を開きます。任意の静的ホスティングでは`index.html`をルートとして配信できます。

## プライバシー

職業、年収、能力、性格、AI習熟度、外部履歴は取得、保存、推定しません。`localStorage`で使用するキーは次の5つだけです。

- `anonymous_id`
- `declared_interest`
- `eligible_segments`
- `consent`
- `events`

匿名イベントはanalytics同意後だけ端末内へ最大100件保存します。メールアドレスはMVP内で送信・保存しません。ニュースレター登録イベントと匿名IDの関連付けは、フォーム上のメール利用同意を伴う明示登録後、かつanalytics同意済みの場合だけ行います。

イベントには`source_id`、`campaign_id`、`asset_id`、`segment`、`channel`、`cta_id`、`utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`、`occurred_at`を付与します。URLクエリからキャンペーン値を受け取り、未指定値には安全な既定値を使います。

フレームワーク定義の承認前であるため、レベル診断とレベル表は公開していません。`level_table_read_100`は将来互換のイベント名として仕様にのみ予約されています。

## 構成

- `index.html`: LPの内容とアクセシブルな画面構造
- `styles.css`: レスポンシブスタイル
- `logic.js`: 5択導線、C表現条件、自己選択昇格の純粋関数
- `app.js`: 同意、DOM、匿名イベント、ダウンロード
- `test/logic.test.js`: Node.js組込テスト
- `server.js`: Node.js組込モジュールだけのローカルサーバー
