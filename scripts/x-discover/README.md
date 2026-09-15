# x-discover — CB発見者 運用 (正式承認 2026-08-30)

AI情報の発見・速報を担う X垢 (cb_discoverer) の素材収集〜投稿パイプライン。
設計の背景・ジャンル選定は [GENRES.md](./GENRES.md) と
business_notes `横断/2026-08-28-x_account_fleet_strategy.md` (正本) へ。
監視・異常時復旧・authorize手順などの**運用手順の正本は business_notes
`横断/2026-08-30-x-discover-operations.md`** (非公開)。

## 流れ (1日1サイクル)

```
09:17  collect.py   (cron) HN/GitHubから当日ジャンルの候補収集
       + LLM起草 (意図設計をpromptで強制) → polish (字単位批評→改稿収束・Q2)
       → persona gate 全件 (Q3) → queue (draft・gen/polish_version記録)
       + 版違い生存draftの再生成 (regen_stale — 生成物の版管理・limit 3/回)
21:07  post.py     (cron) 48h以内の最良1件を自動投稿 (承認flow撤廃・2026-09-04)
随時    review.py   (任意steering) rejectしたdraftのみ投稿対象外

【2026-09-04 訂正】レビュー・投稿判断の自動化(jinno決定)により承認flow(jinno 30秒/日)は撤廃。
post.py は未承認draftも自動投稿する(要記入プレースホルダー・問い形でないask・
単調warn付き・禁止語17語はfail-closedでskip/拒否)。
```

## 品質レベル定義と現在地 (2026-09-14)

各gateが**どの階層を担保するか**の定義。誤字脱字などのQ0は議論対象外 —
機械が落とす。人が見る・議論するのはQ2以上のみ。

| Level | 担保内容 | 担当gate | 記録先 |
|---|---|---|---|
| Q0 文字面 | 3行形式・字数・要記入プレースホルダー・問い形ask | 起草後discipline検査 + post.py fail-closed skip | log |
| Q1 規律 | 禁止語17語・固有名詞/数字の創作禁止・抜粋(実測)根拠・正式名称 | 同上 (`discipline_violation`/`banned_hits`) | log |
| Q2 意図 | 各1行の意図が1つに定まる・各字に意図と効率が埋まる | 起草promptの意図設計強制 + polish loop (字単位批評→改稿収束) | `polish_rounds` (queue行) |
| Q3 読者価値 | ペルソナが「未知の変化・自分ごと・試せる」と評するか | persona gate 全件 (collect/enrich両経路) | `persona_review` (queue行) |
| Q4 実効 | 実読者行動 (impressions/reply) で品質仮説を検証 | 計測のみ — 改善loop未接続 | post-log / metrics |

**現在地 (2026-09-14):** Q0〜Q3はgate実装済 (fail-closed)。Q2は本日実装で
収束の実績は翌朝cronから (`polish_rounds` を監視)。Q4はリーチ計測がほぼゼロ
(開設以来impressions 8) でデータ不足 — engagement→persona yaml還流は
データが溜まってから、現時点は計測継続のみ。

**手順の責務分離:** polishはQ2専任 (批評にQ0/Q1の指摘もQ3の価値判断も混ぜない)、
persona gateはQ3専任、post.pyの機械検査はQ0/Q1の最終防衛線。機械判定を
覆せるのはreview.py (人間steering) のみ。同一階層の二重検査を無くし、
判定基準のブレを防ぐ。

## 生成物の版管理 (2026-09-15)

思想の正本は connective-byte `SYSTEM_CONSTITUTION.md`「生成物の版管理」。
全生成機構の台帳と監査手順は [../ARTIFACTS.md](../ARTIFACTS.md)。
**生成物は作られたときのシステムversionを持ち、システム更新後は現行versionと
異なる生存生成物をすべて再生成する。**

- 版 = `pipeline_version()` (scripts/木のgit tree hash・scripts下が汚れていれば
  `+`。docs-only commitでは不変 — 生成codeとpromptの実体が変わったときだけ変わる)
- 記録先: queue行の `gen_version` (起草時・llm_draft) / `polish_version`
  (polish適用・enrich実測redraft・repolish再検査時に付与)
- 再生成の発火: ①collect朝loopの `regen_stale` (自動・limit 3/回・残りは翌朝 —
  生存draftは48h窓なので複数朝で全量カバー) ②`repolish.py` (手動・--limit 0で即時全件)
- 対象 = 48h窓内・未投稿・実文draftのうち現行version未満の行。窓外 (死人) は
  二度と投稿されないため再生成しない — 版管理の対象は**生存物のみ**
- 判定が曖昧な旧印 (`polish_rounds`のみの行) は旧システム産としてstale扱い —
  最初のregenで現行versionに揃う

- queue/state/log = `~/.local/share/cb-fleet/` (repo外・git管理外)
- 秘密 = `~/.local/share/cb-fleet/.env` のみ (LITELLM_API_KEY・X access鍵)
- LLM起草backend = `LLM_BACKENDS` env優先順 (`llm_backend.py`・2026-09-05〜) —
  `devin`=Devin CLI非対話 (`-p`・model=`DEVIN_MODEL` env)。管理wrapperが無いhostでは起動せず、
  Astra指定は呼出し側とlauncherのfail-closed guardでprovider起動前に拒否（exit 78、2026-09-15）。
  安全なモデル設定時のみ →
  `codex`=Codex CLI非対話 (`codex exec`・ChatGPTサブスク・公式自動化IF・実測14秒) →
  `litellm`=localhost:14000 proxy (`LITELLM_MODEL` env・上流全滅時のqwen退避経路)。
  失敗時はchainの次へ・最終fallbackは既存のplaceholder→翌朝refill
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
python3 repolish.py --dry         # 版違いdraft再生成のプレビュー
python3 repolish.py               # 適用 (stale行のみ・Q2収束+Q3再審査・fail-open)
python3 repolish.py --limit 0     # stale全件を即時再生成 (既定0=無制限)
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
