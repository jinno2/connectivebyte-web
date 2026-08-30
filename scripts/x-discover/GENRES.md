# CB発見者 — ジャンル選定と週間カレンダー (2026-08-30確定)

設計原則: 事業直結だけでなく開発者圏・一般圏を程よく混ぜる。
OON検索は投稿ごとの意味で走るため、一般圏の投稿は広いプールからフォロワーを集め、
core投稿のIn-Network到達圏 (P(action)の分母) を広げる。_account=AI情報で一貫。

## ジャンル (8種・4層)

| 層 | ジャンル | 狙い |
|---|---|---|
| core (事業直結・43%) | `core_model` LLM新モデル・ベンチ・価格 | 床/天井理論の素材・B2B聴衆 |
| | `core_agent` エージェント・業務自動化 | CB事業領域そのもの・RFP/自動化 |
| | `core_org` 組織導入・事例・ROI | 診断LP・組織診断の導線 |
| dev (開発者圏・29%) | `dev_tool` OSS・開発ツール | 技術者フォロワー・拡散しやすい |
| | `dev_sec` セキュリティ・情報流出 | copy link 20.0の最適対象・要注意運用 |
| broad (一般圏・14%) | `broad_creative` 生成AIアート・デモ・一般 | viral reach・フォロワー基盤 |
| bridge (橋渡し・14%) | `bridge_game` ゲーム×AI | meiro聴衆との接点候補 |
| | `broad_career` 仕事・キャリア×AI | 迷路×就職tie-up・人事聴衆 |

## 週間カレンダー (投稿1/日・21:07枠 cron)

| 曜日 | ジャンル |
|---|---|
| 月 | core_model |
| 火 | dev_tool |
| 水 | core_agent |
| 木 | dev_sec |
| 金 | core_org |
| 土 | broad_creative |
| 日 | bridge_game / broad_career (週交互) |

大速報 (breaking) はカレンダー優先を上書きしてよい (48h寿命=鮮度が武器)。

## リスク規律

- 流出物そのものは扱わない。報道・解説・公式告知へのリンク+自説のみ (report -234回避)
- 毎投稿固有の自説文 (TweetSpamBot/重複spam回避)
- 他垢への宣伝reply禁止 (spam high-recall=フォロワー0垢は全域配信ゼロ)
- 投稿はブランドトーン規約準拠 (断定・簡潔・個人トーンNG)

## 生成規律 (X運用基本計画§11準拠・2026-08-30機械化)

- 誇張・代入肯定の禁止語 (おすすめ/最高/画期的/必須/絶対/業界No.1/完全自動/
  ミスゼロ/必ず時間を削減できる/秀逸/衝撃/革命 等) — 正本リストは
  `x_discover_rules.py`。3点で同じ規律を参照する:
  collect (起草prompt内蔵+違反時1回再試行) / review (承認画面に⚠警告) /
  post (投稿前fail-closed検査→違反はblocked化・投稿しない)
- hookの書き出し・語尾を固定しない (「〜を見付けた」体の全投稿統一=均一化。
  起草promptに直近6件のhookを渡して重複回避)
- askは読者への問い (「？」終わり・reply誘導)
- 投稿URLは素材元記事のみ。CB導線はbio経由 (reach層設計・計画§5の逆導線は
  core_org金曜など文脈が自然な時に本文言及で橋渡し)

## 他リポ連携

- 素材源 v0 = HN (Algolia・keyless) + GitHub search (keyless) + Reddit (best-effort)
- 以降 = defuddle providers (GITHUB_TOKEN/QIITA_TOKEN規律・docs/providers.md)・RSS
- 起草 = litellm proxy (LITELLM_API_KEY環境変数のみ・keyは指紋以外記録しない)
- 投稿 = site_meiro-a/scripts/x-fleet-post.pyのパターン流用 (CB垢作成後にconfig+state+cron)
- 台帳 = business_notes/横断/2026-08-28-x_account_fleet_strategy.md 追記
