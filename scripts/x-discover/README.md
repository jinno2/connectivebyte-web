# x-discover — CB発見者 運用 (正式承認 2026-08-30)

AI情報の発見・速報を担う X垢 (cb_discoverer) の素材収集〜投稿パイプライン。
設計の背景・ジャンル選定は [GENRES.md](./GENRES.md) と
business_notes `横断/2026-08-28-x_account_fleet_strategy.md` (正本) へ。

## 流れ (1日1サイクル)

```
09:17  collect.py   (cron) HN/GitHubから当日ジャンルの候補収集 + LLM起草 → queue (draft)
随時    review.py   (jinno 30秒/日) draft確認 → approve/reject
21:07  post.py     (cron) 承認済み48h以内の最良1件を投稿 (垢未作成ならskip)
```

- queue/state/log = `~/.local/share/cb-fleet/` (repo外・git管理外)
- 秘密 = `~/.local/share/cb-fleet/.env` のみ (LITELLM_API_KEY・X access鍵)
- 投稿形 = hook / take / URL / ask の4行 — copy link 20.0 最重量actionへの最適化

## コマンド

```bash
python3 collect.py --dry          # 収集プレビュー (キュー書込なし)
python3 review.py                 # 未承認draft一覧 (推奨=★)
python3 review.py approve 12      # 承認 (番号=行位置・翌日も有効)
python3 post.py --dry-run         # 投稿プレビュー (表示のみ)
python3 review.py --all           # 全queue簡易履歴
```

## CB垢作成後の有効化 (残るjinno作業はここだけ)

1. X垢を作成 (bio = AI情報発見・プロフに lab.connectivebyte.com)
2. app共通鍵を準備: site_meiro-a/.env の `X_API_KEY` / `X_API_SECRET` の値を
   `~/.local/share/cb-fleet/.env` へコピー (app共通・承認画面はmeiroと同一app)
3. `python3 authorize.py --account cb_discoverer`
   → 表示URLをブラウザで開き「新垢」でログイン → app承認 → 7桁PINを入力
   → access鍵が .env へ追記され config が `warming` に自動反映
4. 翌日から 21:07 cron が承認済みdraftを投稿開始 (config `status` を `active` に
   すればそのまま毎日。banned判定は401/403×3連続で自動)

## 恒久運用の境界

- 画像添付はv0では無し (CLIP埋め込み強化は将来課題 — GENRES.md 参照)
- ハッシュタグ無し (copy linkされやすい無装飾形を優先)
- 予算backstop = config `budget.monthly_cap_usd` ($10/mo = URL付き31投稿分超えでskip)

## プロファイル管理 (実測 2026-08-30)

- bio / profile url は投稿用OAuth鍵のまま **v1.1 `account/update_profile.json`** で更新可 (200実測)。
  v2 `PATCH /2/users/me` は405で不可。form paramsは署名に込み (`post.oauth_header` のparams引数)。
- アイコンは v1.1 `account/update_profile_image.json` (base64) で更新可 — 画像の選定・用意が必要
- 2FAのみWeb UI手動 (パスワード+認証アプリ設定はAPI不可)
