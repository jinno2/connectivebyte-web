// artifacts-ledger.test.js — 生成物台帳 (ARTIFACTS.md) の「現行 pipeline_version」
// を実測値と照合するガード。
//
// pipeline_version() の正本は scripts/x-discover/x_discover_rules.py — logicの
// 複製を作らず subprocess で呼ぶ。scripts下の.pyを変えるcommitで台帳の「現行」
// の更新漏れが出た実測 (6b1d078 batch後の放置 → 2026-10-03 a0a8df5 で同期) への
// 回帰防止。docs-only commitでは版は不変なので、一致が常態になる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ARTIFACTS.md 台帳の現行 pipeline_version が実測値と一致する", async () => {
  const ledger = await readFile(path.join(repoRoot, "ARTIFACTS.md"), "utf8");
  const recorded = ledger.match(/現行 = `([0-9a-f]{12})`/)?.[1];
  assert.ok(recorded, "ARTIFACTS.md に「現行 = `<hash>`」の記述が無い");

  const { stdout } = await execFileAsync("python3", ["-c",
    'import sys; sys.path.insert(0, "scripts/x-discover");' +
    "from x_discover_rules import pipeline_version; print(pipeline_version())",
  ], { cwd: repoRoot });
  const computed = stdout.trim();
  assert.match(computed, /^[0-9a-f]{12}$/,
    `実測値が版hashでない: ${computed} — scripts下.pyの未commit変更 (+接尾) があれば先にcommitすること`);
  assert.equal(computed, recorded,
    "台帳の「現行」が実測と乖離 — scripts/*.py を変えるcommitでは ARTIFACTS.md の現行版も同期すること");
});
