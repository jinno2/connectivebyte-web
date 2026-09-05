# x-discover — CB発見者 運用 (正式承認 2026-08-30)

AI情報の発見・速報を担う X垢 (cb_discoverer) の素材収集〜投稿パイプライン。
設計の背景・ジャンル選定は [GENRES.md](./GENRES.md) と
business_notes `横断/2026-08-28-x_account_fleet_strategy.md` (正本) へ。
監視・異常時復旧・authorize手順などの**運用手順の正本は business_notes
`横断/2026-08-30-x-discover-operations.md`** (非公開)。

## 流れ (1日1サイクル)

```
09:17  collect.py   (cron) HN/GitHubから当日ジャンルの候補収集 + LLM起草 → queue (draft)
21:07  post.py     (cron) 48h以内の最良1件を自動投稿 (承認flow撤廃・2026-09-04)
随時    review.py   (任意steering) rejectしたdraftのみ投稿対象外

【2026-09-04 訂正】レビュー・投稿判断の自動化(jinno決定)により承認flow(jinno 30秒/日)は撤廃。
post.py は未承認draftも自動投稿する(要記入プレースホルダー・問い形でないask・
単調warn付き・禁止語17語はfail-closedでskip/拒否)。
```

- queue/state/log = `~/.local/share/cb-fleet/` (repo外・git管理外)
- 秘密 = `~/.local/share/cb-fleet/.env` のみ (LITELLM_API_KEY・X access鍵)
- LLM起草backend = `LLM_BACKEND` env (`llm_backend.py`で切替) — `codex`=Codex CLI非対話モード
  (2026-09-05〜・ChatGPTサブスク・公式自動化IF) / `litellm`(既定)=localhost:14000 proxy・
  `LITELLM_MODEL` env (2026-09-05の上流全滅時はqwen3.8-max-preview-direct退避)
- 投稿形 = hook / take / URL / ask の4行 — copy link 20.0 最重量actionへの最適化
- 選定 = score=(points+2×comments)÷経過時間 (HN議論速度) + 曜日ジャンルカレンダー。
  起草は**本文抜粋を取得して根拠付け** (2026-08-30〜・fetch失敗は題名のみ)。
  `review.py` に P/C/経過時間 を表示 — 「なぜこれが選ばれたか」を30秒reviewで確認可

## コマンド

```bash
python3 collect.py --dry          # 収集プレビュー (キュー書込なし)
python3 post.py --dry-run         # 投稿プレビュー (表示のみ)
python3 review.py                 # draft一覧 (任意steering・推奨=★)
python3 review.py reject 12       # 却下 (番号=行位置・翌日も有効)
python3 review.py --all           # 全queue簡易履歴
```

## CB垢作成後の有効化 (残るjinno作業はここだけ)

1. X垢を作成 (bio = AI情報発見・プロフに lab.connectivebyte.com)
2. app共通鍵を準備: site_meiro-a/.env の `X_API_KEY` / `X_API_SECRET` の値を
   `~/.local/share/cb-fleet/.env` へコピー (app共通・承認画面はmeiroと同一app)
3. `python3 authorize.py --account cb_discoverer`
   → 表示URLをブラウザで開き「新垢」でログイン → app承認 → 7桁PINを入力
   → access鍵が .env へ追記され config が `warming` に自動反映
4. 翌日から 21:07 cron がdraftを自動投稿 (config `status` を `active` に
   すればそのまま毎日。banned判定は401/403×3連続で自動)

## 恒久運用の境界

- 画像添付はv0では無し (CLIP埋め込み強化は将来課題 — GENRES.md 参照)
- ハッシュタグ無し (copy linkされやすい無装飾形を優先)
- 予算backstop = config `budget.monthly_cap_usd` ($10/mo = URL付き31投稿分超えでskip)

## プロファイル管理 (実測 2026-08-30)

- bio / profile url は投稿用OAuth鍵のまま **v1.1 `account/update_profile.json`** で更新可 (200実測)。
  v2 `PATCH /2/users/me` は405で不可。form paramsは署名に込み (`post.oauth_header` のparams引数)。
- アイコンは v1.1 `account/update_profile_image.json` (base64) で更新可 — 画像の選定・用意が必要
- 言語/タイムゾーンは v1.1 `account/settings.json` (`lang` / `time_zone`) で更新可
  (@ailabpost は 08-30 に `lang=ja`・`time_zone=Asia/Tokyo` 適用・200実測)
- 2FAのみWeb UI手動 (パスワード+認証アプリ設定はAPI不可)
