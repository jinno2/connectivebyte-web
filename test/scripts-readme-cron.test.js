// scripts-readme-cron.test.js — scripts配下READMEのcron発火記述と不在注記の整合ガード。
//
// 37d65e8 は、t0007-outreach・x-discover各READMEがcron行を現行運用として
// 提示していた状態を、正本AUTOMATION.mdのcrontab節 (2026-10-12再実測・不在)
// への参照注記で同期した。automation-md.test.js がAUTOMATION.md側を守るのに対し、
// このテストはscripts README側を守る: cron発火を提示しながら日付付き再実測
// 注記を持たない状態への回帰を機械検査する。発火を移転・再開してREADMEを
// 書き換えるときは、automation-md.test.js と併せてこのテストも更新すること。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(repoRoot, "scripts");

// cron発火の「提示」とみなす記述: crontab書式の行・(cron) マーカー・cron見出し
const PRESENTS_CRON = /\(cron\)|^## cron\s*$|^\d{1,2}\s+\d{1,2}\s+\*\s+\*\s+\*\s/m;
const ANNOTATION = /\d{4}-\d{2}-\d{2}再実測/;
const CANONICAL_LINK = /\]\(\.\.\/\.\.\/AUTOMATION\.md\)/;

async function scriptsReadmes() {
  const entries = await readdir(scriptsDir, { withFileTypes: true });
  const readmes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const readmePath = path.join(scriptsDir, entry.name, "README.md");
    try {
      await stat(readmePath);
      readmes.push({ dir: entry.name, readmePath });
    } catch {
      // READMEを持たないscriptディレクトリは対象外
    }
  }
  return readmes;
}

test("cron発火を提示するscripts READMEは、日付付き再実測の不在注記を持つ", async () => {
  const readmes = await scriptsReadmes();
  assert.ok(readmes.length > 0, "scripts配下にREADMEが無い (テストの前提が崩れた)");
  for (const { dir, readmePath } of readmes) {
    const md = await readFile(readmePath, "utf8");
    if (!PRESENTS_CRON.test(md)) continue;
    assert.match(md, ANNOTATION,
      `${dir}/README.md がcron発火を提示するのに日付付き再実測注記が無い — ` +
      `実測で確認できない発火を現行扱いで書いていないか (正本は AUTOMATION.md のcrontab節)`);
  }
});

test("再実測注記を持つscripts READMEは、正本AUTOMATION.mdのcrontab節へ解決するリンクを持つ", async () => {
  const automation = await readFile(path.join(repoRoot, "AUTOMATION.md"), "utf8");
  assert.match(automation, /^### ローカルcrontab/m,
    "AUTOMATION.md にcrontab節が無い — 注記の指す正本が失われている");
  const readmes = await scriptsReadmes();
  for (const { dir, readmePath } of readmes) {
    const md = await readFile(readmePath, "utf8");
    if (!ANNOTATION.test(md)) continue;
    assert.match(md, CANONICAL_LINK,
      `${dir}/README.md の再実測注記が正本 AUTOMATION.md への相対リンク (../../AUTOMATION.md) を持たない`);
  }
});
