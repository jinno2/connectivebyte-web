# AGENTS.md — このrepoで作業するときの運用ルール

## 前提: このrepositoryは **public**

- GitHub Pages (`lab.connectivebyte.com`) で配信されている。**ここにcommitしたものはすべて公開される**(履歴を含む)。
- 非公開情報を誤ってcommitした場合、commitを取り消すだけでは消えない。履歴ごとの抹消(force push)と、GitHub側に残った旧コミットの除去(Supportへの依頼)までが対応範囲になる。**混入させないことが唯一の安価な対策**。

## 絶対にcommitしないもの

1. **成熟度モデルの詳細な定義**(レベル名・定義文・移行条件・判定基準の原文)。
   - 正本は別管理の非公開資産。このrepoに置けるのは**一般論として自分の言葉で書き直した表現のみ**(現行: 4段階の`PHASES`、3問+詳細12問の診断質問)。
   - 公開中の質問文は「一般論版」として承認済み。定義側の用語・言い回しを持ち込まない。
2. 内部のrepo構造・path・運用手順の詳細。計測backendやインフラの操作手順(token・API直叩きの手順等)。
3. 個人情報。メールアドレスはPIIとして匿名eventsとは別経路・別tableで扱う(`FORBIDDEN_ATTRIBUTES`・`/subscribe` の設計参照)。

## 公開してよいか迷ったら

- 独自の理論名・用語・定義の言い回しを使っていないか? → 一般論の語で書き直す。
- 書き直せない(定義そのものが必要)なら、それは公開する内容ではない。
- **commit前に必ず `npm test`**。`test/publication-guard.test.js` が、詳細定義に由来する用語をgit管理ファイル全件からスキャンしてfailさせる。
- guardが検出したら表現を直す。**guardの語削除・無効化で解決しない**(人間承認が必須)。

## 変更フロー

- masterへの直接commit可。**commitしたら即push**(push前に消す運用はこのrepoではしない — publicなので滞留リスクが大きい)。
- 診断・newsletterの仕様変更は `logic.js`(判定) と `app.js`(UI/送信) が対。`server.js` は本番Workerの検証ロジックの写し — 片方だけ変えない。
- 計測・登録endpoint (`api.connectivebyte.com`) 自体の変更はこのrepoでは行わない。別管理のIaC経由のみ。

## scripts/x-discover (CB発見者パイプライン)

- 外部state (`~/.local/share/cb-fleet/`) を持つ運用code。queue/state/log/秘密は**repo外**。
- 監視・異常時復旧・authorize手順などの**運用手順の詳細はbusiness_notes (非公開) が正本**
  (このpublic repoに内部手順・path詳細を書かない — 上記「絶対にcommitしないもの」#2)。
- ここでの変更は `post.py --dry-run` / `collect.py --dry` で検証してからcommit。

## テスト

- `npm test`(node --test)。公開ガード・イベント同期・診断仕様・共有リンクを含む。
- 新しい公開ファイルを追加したら特に対処不要 — `git ls-files` ベースで自動的に走査対象になる。
