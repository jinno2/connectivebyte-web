# t0007-outreach — 日本展開パートナー・アウトリーチ自動化 (承認ゲート付き)

quetab等の提携候補に対する **計測→起草→承認→公開→送信** パイプライン。
jinnoの作業は `show` で見て `approve` / `reject` するだけ。

## 状態遷移

```
draft ─approve─▶ approved ─publish-article─▶ published   (kind=article・CBサイト公開)
             └─reject──▶ rejected
approved (kind=outreach) ─browser送信 (Claude workset)─▶ sent --channel=...
```

外部に出るのは approve 後のみ (明示指示ゲート)。draft はローカルキュー止まり。

## コマンド

| コマンド | 誰が | 動作 |
|---|---|---|
| `engagement` | cron毎朝 | discover-queueの投稿済みtweetの公開指標を outreach-metrics.jsonl へ追記 (1日1回冪等) |
| `draft quetab` | 随時 (LLM) | dossier + 計測を素材に記事案とアウトリーチ文面 (英語) を起草 → キューへ |
| `show [--pending] [id]` | jinno | キューの一覧と本文表示 (⚠禁止語/Subject欠落チェック付き) |
| `approve <id>` / `reject <id>` | jinno | 承認・棄却 (draftのみ) |
| `publish-article <id>` | approve後 | `content/18-blog/<slug>/index.html` 生成 → **npm test (publication guard)** → git add/commit/push → URL記録 |
| `sent <id> --channel=...` | 送信後 | 文面送信済みとして記録 (browser送信はClaude worksetが実施) |

## 対象追加

`outreach.py` の `DOSSIER` に `{target: {dossier: パス, url, slug}}` を追加。
dossier (business_notes t0007_日本展開/dossier/) が唯一の素材正本 — 検証結果は
dossierへ追記してから `draft` を走らせる。

## 規律 (x-discover と共通)

- LLM key は環境変数 `LITELLM_API_KEY` のみ (repoに書かない)
- X資格 = x-discover と同じ CBD_* env (読み取りは public_metrics のみ)
- 提携前の言及は中立・事実ベース (ステマ規制: 教会と国家の分離)
- 誇張禁止語 (X運用基本計画§11) は記事にも⚠表示 — 機械拒否はせずjinno判断

## cron

```
47 8 * * * cd /home/jinno/connectivebyte-web && python3 scripts/t0007-outreach/outreach.py engagement >> ~/.local/share/cb-fleet/outreach.log 2>&1
```
