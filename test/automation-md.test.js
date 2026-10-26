// automation-md.test.js — AUTOMATION.md crontab節の実測・不在表明の整合ガード。
//
// b0a8f27 は、2026-09-15実測のcrontab毎日発火の主張を2026-10-12再実測 (不在)
// の事実へ置き換えた。運用文書が「日付修飾のない現行稼働主張」へ回帰しない
// こと、不在を宣言する節が現行手順として適用不能なKill Switchを残さない
// こと、実測日付とフッター最終更新の乖離 (stale footer) を機械検査する。
// 発火を移転・再開して本節を書き換えるときは、このテストも併せて更新すること。
// 4dd2ff2 は同じ再実測事実を scripts両README (t0007-outreach/x-discover) へも
// 反映した — 両READMEの不在表明と正本参照は本ファイル末尾の節で検査する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// crontab節 (### ローカルcrontab… から次の ## 見出しまで) を切り出す
function crontabSection(md) {
  const section = md.match(/^### ローカルcrontab[^\n]*\n[\s\S]*?(?=^## )/m)?.[0] ?? "";
  assert.ok(section.length > 0, "AUTOMATION.md に crontab節が無い (テストの前提が崩れた)");
  return section;
}

test("crontab節の見出しは実測日付・再実測日付・不在を表明する", async () => {
  const md = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  const heading = md.match(/^### ローカルcrontab（実測 (\d{4}-\d{2}-\d{2})・(\d{4}-\d{2}-\d{2})再実測で不在）$/m);
  assert.ok(heading,
    "見出しが「実測 <日付>・<日付>再実測で不在」形式でない — 日付・再実測結果を外した稼働主張へ回帰していないか");
  const [, measuredAt, reMeasuredAt] = heading;
  assert.ok(measuredAt < reMeasuredAt, "再実測日付が最初の実測日付より古い");
});

test("不在表明の節では、稼働主張は「時点では」+過去形でのみ書かれる", async () => {
  const md = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  const section = crontabSection(md);
  const heading = md.match(/^### ローカルcrontab（実測 (\d{4}-\d{2}-\d{2})・(\d{4}-\d{2}-\d{2})再実測で不在）$/m);
  assert.ok(heading, "見出し形式が変わっている — 前テストを参照");
  const [, measuredAt, reMeasuredAt] = heading;
  // 稼働記録: 最初の実測日付の「時点では」+過去形で導入される
  assert.match(section, new RegExp(`${measuredAt}時点では[^\\n]*毎日発火していた`),
    "fenced blockへの導入文は「<実測日付>時点では〜毎日発火していた」であること");
  // 再実測段落: 再実測日付で不在事実を述べる
  assert.match(section, new RegExp(`${reMeasuredAt}再実測`),
    "再実測日付が本文に現れること");
  assert.match(section, /確認できない|無い/, "再実測の不在事実が本文に現れること");
  // 回帰pin: 日付・時制修飾のない現在形の稼働主張 (b0a8f27 以前の文言)
  assert.doesNotMatch(section, /毎日発火する/,
    "無修飾の現在形稼働主張「毎日発火する」が混入 — 実測で確認できない主張を現行扱いで書かない");
});

test("不在のcrontab行に適用不能なKill Switch手順を現行文として残さない", async () => {
  const md = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  const section = crontabSection(md);
  const sentence = section.split("。").find((s) => s.includes("Kill Switch"));
  assert.ok(sentence, "crontab節にKill Switchの記述が無い (テストの前提が崩れた)");
  assert.match(sentence, /当時|だった/,
    `Kill Switch文が過去の方法として修飾されていない: 「${sentence.trim()}」 — 不在宣言した行への現行手続きは読み手を誤らせる`);
});

test("crontab節は移転・再開時の更新指示と、歴史記録としての両pipeline行を保つ", async () => {
  const md = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  const section = crontabSection(md);
  assert.match(section, /移転・再開時は本節を実態に合わせて更新/,
    "移転・再開時の更新指示が削れた — 実態と文書の乖離を検知する再実測の動機が失われる");
  const block = section.match(/```\n([\s\S]*?)```/)?.[1] ?? "";
  assert.match(block, /scripts\/x-discover\/collect\.py/, "歴史記録から x-discover 行が消えた");
  assert.match(block, /scripts\/t0007-outreach\/outreach\.py/, "歴史記録から t0007-outreach 行が消えた");
});

test("フッター最終更新は節内の全実測日付以降である (stale footer検知)", async () => {
  const md = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  const footer = md.match(/^_最終更新: (\d{4}-\d{2}-\d{2})/m);
  assert.ok(footer, "フッターの最終更新日付が無い");
  const section = crontabSection(md);
  const dates = [...section.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  assert.ok(dates.length > 0, "crontab節に実測日付が無い (テストの前提が崩れた)");
  const latest = dates.sort().at(-1);
  assert.ok(footer[1] >= latest,
    `最終更新 (${footer[1]}) が実測日付 (${latest}) より古い — 実測を書き換えたらフッターも更新すること`);
});

// ── scripts両READMEのcron発火記述 (4dd2ff2) ──
// 両READMEはAUTOMATION.mdと同じ回帰クラスを持つ: 日付修飾のない現行稼働主張への
// 回帰、正本参照の消失、正本側の再実測進行への未追従 (staleな不在主張)。

const scriptReadmes = ["scripts/t0007-outreach/README.md", "scripts/x-discover/README.md"];

test("scripts両READMEのcron発火記述は日付付き再実測の不在表明と正本参照を保つ", async () => {
  for (const rel of scriptReadmes) {
    const md = await readFile(path.join(repoRoot, rel), "utf8");
    assert.match(md, /(\d{4}-\d{2}-\d{2})再実測[^\n。]*不在/,
      `${rel}: 「<日付>再実測…不在」の表明が消えた — cron発火を日付修飾なしの現行扱いで書いていないか`);
    assert.match(md, /\]\(\.\.\/\.\.\/AUTOMATION\.md\)/,
      `${rel}: 発火の正本への参照 (../../AUTOMATION.md) が消えた`);
  }
});

test("scripts両READMEのAUTOMATION.md相対リンクは解決できる", async () => {
  for (const rel of scriptReadmes) {
    const md = await readFile(path.join(repoRoot, rel), "utf8");
    const links = [...md.matchAll(/\]\((\.\.\/\.\.\/AUTOMATION\.md)\)/g)];
    assert.ok(links.length > 0, `${rel}: ../../AUTOMATION.md への相対リンクが無い (前テストを参照)`);
    for (const [, href] of links) {
      await assert.doesNotReject(
        access(path.resolve(repoRoot, path.dirname(rel), href)),
        `${rel}: ${href} が解決できない — 参照先が消えたかREADMEの階層が変わった`);
    }
  }
});

test("scripts両READMEの再実測日付はAUTOMATION.md crontab節の最新日付に遅れない", async () => {
  const auto = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  const latest = [...crontabSection(auto).matchAll(/(\d{4}-\d{2}-\d{2})/g)]
    .map((m) => m[1]).sort().at(-1);
  for (const rel of scriptReadmes) {
    const md = await readFile(path.join(repoRoot, rel), "utf8");
    const readmeDate = md.match(/(\d{4}-\d{2}-\d{2})再実測/)?.[1];
    assert.ok(readmeDate, `${rel}: 再実測日付が無い (前テストを参照)`);
    assert.ok(readmeDate >= latest,
      `${rel}: 再実測日付 (${readmeDate}) が正本crontab節の最新日付 (${latest}) より古い — 正本側の再実測をREADMEの不在表明へ反映すること`);
  }
});
