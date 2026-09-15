# 自動化・運用の入口

この文書は発火・駆動・停止・連携を扱う。[長期計画](ORDER.md)の到達目標と、実際の登録・受入・公開状態を区別する。

## Driver（発火方式）

GitHub Actionsによるイベント駆動。開発確認はローカルCLI。運用中の外部サービスの設定や秘密はこの公開リポへ記載しない。

## Schedule（駆動間隔）

[CI](.github/workflows/ci.yml)はpush/PR。[Pages](.github/workflows/deploy_pages.yml)はmaster pushとworkflow_dispatch。正確な条件はworkflowを参照する。

### ローカルcrontab（実測 2026-09-15）

GitHub Actions以外に、ローカルcrontabで以下が毎日発火する。停止（Kill Switch）は`crontab -e`で該当行を削除する。

```
17 9 * * * cd /home/jinno/connectivebyte-web && /home/jinno/.local/share/mise/installs/python/3.13/bin/python3 scripts/x-discover/collect.py >> /home/jinno/.local/share/cb-fleet/collect.log 2>&1
7 21 * * * cd /home/jinno/connectivebyte-web && /home/jinno/.local/share/mise/installs/python/3.13/bin/python3 scripts/x-discover/post.py >> /home/jinno/.local/share/cb-fleet/post.log 2>&1
47 8 * * * cd /home/jinno/connectivebyte-web && /home/jinno/.local/share/mise/installs/python/3.13/bin/python3 scripts/t0007-outreach/outreach.py engagement >> /home/jinno/.local/share/cb-fleet/outreach.log 2>&1
53 8 * * * cd /home/jinno/connectivebyte-web && /home/jinno/.local/share/mise/installs/python/3.13/bin/python3 scripts/t0007-outreach/crm.py digest --inbox >> /home/jinno/.local/share/cb-fleet/crm-alerts.log 2>&1
```

## Entrypoint（実行コマンド）

`npm test`で公開ガードと動作を検査し、`npm run serve`で画面を確認する。Pages workflowは`_site/`に必要な配信物を組み立てる。

## Stall Policy（停止時の扱い）

テスト失敗・公開ガード検出・同意導線の不整合があれば原因を修正して再検証する。ガードの無効化や検出語の削除で通過させない。公開先への反映は成果物と公開後の画面で別途確認する。

## Coordination（エコシステム連携）

承認された公開用記事・資料を受け取り、診断・自己選択・登録へ接続する。受信した資産の存在を公開許可にしない。

## Kill Switch（緊急停止）

該当Actions runの取消しと以後の公開発火の停止を区別する。取消しだけで公開済みページは戻らない。公開済み内容の修正は既存の公開規約に従い、確認済み版へ反映する。

## Status（現在の稼働状態）

Pages jobは同じcheckoutの`npm test`と、組立後の`_site/`の公開検査が成功してからupload・deployへ進む。PDF検査ツールはPages内で導入し、通常CIとローカル環境でも必要。workflowの存在や成功を購読・配信・顧客成果の証明にしない。

## Notes（特記）

コミットする全文が公開対象。非公開の定義・運用情報・個人情報を記録しない。公開条件の正本は[AGENTS.md](AGENTS.md)。

_最終更新: 2026-09-15 ／ driver・workflow・委譲先変更時は本ファイルと入口の参照を更新すること。_
