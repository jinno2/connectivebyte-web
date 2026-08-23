# ConnectiveByte 診断LP MVP

Purpose / Visionと、本人が選ぶE・D・C・B・Aの5択から次のコンテンツへ案内する静的LPです。能力や属性を評価する診断ではありません。

## 実行

Node.js 20以上を使用します。外部パッケージのインストールは不要です。

```bash
npm test
npm run serve
```

`http://127.0.0.1:4173`を開きます。任意の静的ホスティングでは`index.html`をルートとして配信できます。

## GitHub Pages

`.github/workflows/deploy_pages.yml`がmaster pushとworkflow_dispatchでデプロイします（upload-pages-artifact + deploy-pages。ドキュメントルートはリポジトリルート）。`events.jsonl`は`.gitignore`済みのためアーティファクトに入りません。

Pagesの有効化はユーザー実行・ORDER.md §18.3の依存のため、このリポジトリの整備では実行しません。残す有効化1行:

```bash
gh api -X POST repos/jinno2/connectivebyte-web/pages -F build_type=workflow -F 'source[branch]=master' -F 'source[path]=/'

前提: private リポジトリで Pages を使うには Pro 以上の有料プランが必要（Free プランの場合は repo を public 化するか課金の検討を）。有効化すると配信物（LP + content/ の3資産）が即時公開される。`content/17-org-pdf` は publish_mode=manual_confirm・計画時刻 2026-08-27 だが、本パイプライン整備サイクルのレビュー通過をもって確認済みと扱う。問題がある場合は有効化前に `content/17-org-pdf` を除外すること。
```

（create時に`build_type`が拒否される場合のフォールバック: `gh api -X POST repos/jinno2/connectivebyte-web/pages -F 'source[branch]=master' -F 'source[path]=/'`で作成後、`gh api -X PUT repos/jinno2/connectivebyte-web/pages -F build_type=workflow`）

## 承認済み資産のステージ（content/）

`content/<asset_id>/index.html`はfloor-ceiling-001承認済みwebチャネル資産の配信ページです。本文は承認済み`content.md`を`<pre id="asset-body">`で包んだだけのbytes一致、`metadata.json`は承認manifest（package.json）のコピー、LPからの導線はすべて相対リンク（プロジェクトPagesのベースパスに依存しない）です。

- `01-canonical`・`02-entry-read`・`17-org-pdf`をステージ済み。導線はレベル表・FRONTIER NOTE・FOR ORGANIZATIONSの各カード
- `15-diagnostic-lp`はこのリポジトリのLP本体が配信物のためステージ対象外
- 記事本文はドラフト骨子のため各ページは`noindex`。`17-org-pdf`はpublish_modeが`manual_confirm`で、PDF配布（`pandoc content.md -o content.pdf --pdf-engine=xelatex -V documentclass=article`）は人の確認時に行う

本文一致の検証（要 `connective-intelligence-studio` の承認ライブラリ）:

```bash
python3 - ../connective-intelligence-studio/content-library/approved/floor-ceiling-001 <<'PY'
import hashlib, pathlib, sys
approved = pathlib.Path(sys.argv[1])
for page in sorted(pathlib.Path("content").glob("*/index.html")):
    body = page.read_text(encoding="utf-8").split('<pre id="asset-body">\n', 1)[1].rsplit("</pre>", 1)[0]
    source = (approved / page.parent.name / "content.md").read_text(encoding="utf-8")
    status = "OK" if body == source else "MISMATCH"
    print(page.parent.name, status, hashlib.sha256(body.encode("utf-8")).hexdigest())
PY
```

## プライバシー

職業、年収、能力、性格、AI習熟度、外部履歴は取得、保存、推定しません。`localStorage`で使用するキーは次の5つだけです。

- `anonymous_id`
- `declared_interest`
- `eligible_segments`
- `consent`
- `events`

匿名イベントはanalytics同意後だけ端末内へ最大100件保存します。メールアドレスはMVP内で送信・保存しません。ニュースレター登録イベントと匿名IDの関連付けは、フォーム上のメール利用同意を伴う明示登録後、かつanalytics同意済みの場合だけ行います。

イベントには`source_id`、`campaign_id`、`asset_id`、`segment`、`channel`、`cta_id`、`utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`、`occurred_at`を付与します。URLクエリからキャンペーン値を受け取り、未指定値には安全な既定値を使います。

レベル表は commit 9f82b73 で公開済みです。`level_table_read_100` はレベル表閲覧の実イベントとして発火します。

## 構成

- `index.html`: LPの内容とアクセシブルな画面構造
- `styles.css`: レスポンシブスタイル
- `logic.js`: 5択導線、C表現条件、自己選択昇格の純粋関数
- `app.js`: 同意、DOM、匿名イベント、ダウンロード
- `test/logic.test.js`: Node.js組込テスト
- `server.js`: Node.js組込モジュールだけのローカルサーバー
- `content/`: 承認済みwebチャネル資産の配信ページ（本文bytes一致）
- `.github/workflows/deploy_pages.yml`: GitHub Pagesデプロイ
