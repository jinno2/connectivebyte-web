// ci-config.test.js — テストgateのCI基盤に関する回帰ガード。
//
// owner原則 ci-runner-selection: github-hosted ランナーでのCI実行は禁止
// （Pages platform-managed 配信 workflow のみ例外）。Woodpecker 移行で
// gate が消えない・例外の外に github-hosted gate が復活しないことを
// 機械検査する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Woodpecker gateがnpm testをlinux/amd64 self-hostedで実行する", async () => {
  const yml = await readFile(path.join(repoRoot, ".woodpecker.yml"), "utf8");
  assert.match(yml, /labels:\s*\n\s*platform:\s*linux\/amd64/, "self-hosted ラベルが無い");
  assert.match(yml, /image:\s*woodpeckerci\/plugin-git/, "fleet標準cloneが無い");
  assert.match(yml, /depth:\s*0/, "full depth cloneで無い");
  const commands = yml.match(/commands:\s*\n((?:\s+-\s+.*\n?)+)/);
  assert.ok(commands, "stepsのcommandsが無い");
  assert.match(commands[1], /npm test/, "gateがnpm testを実行しない");
  assert.match(commands[1], /poppler-utils/, "PDF検査tools (poppler-utils) が無い");
  assert.match(commands[1], /qpdf/, "PDF検査tools (qpdf) が無い");
});

test("Woodpecker gateはPRとmaster pushで発火する", async () => {
  const yml = await readFile(path.join(repoRoot, ".woodpecker.yml"), "utf8");
  assert.match(yml, /event:\s*\[pull_request/, "PR gateが無い");
  assert.match(yml, /event:\s*push\s*\n\s*branch:\s*master/, "master push gateが無い");
});

test("Woodpeckerのimageにlatestタグを使わない", async () => {
  // supply-chain-pinning: 可変latestはしない。メジャー固定 (node:22 等) から始める。
  const yml = await readFile(path.join(repoRoot, ".woodpecker.yml"), "utf8");
  const images = [...yml.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(images.length > 0, "image行が見つからない");
  for (const image of images) {
    assert.ok(!image.endsWith(":latest"), `latestタグのimage: ${image}`);
  }
});

test("github-hosted workflowはPages配信の例外の外に存在しない", async () => {
  await assert.rejects(
    access(path.join(repoRoot, ".github/workflows/ci.yml")),
    { code: "ENOENT" },
    "github-hostedのCI gate (ci.yml) が復活している",
  );
  const workflows = (await readdir(path.join(repoRoot, ".github/workflows"))).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  for (const workflow of workflows) {
    assert.equal(workflow, "deploy_pages.yml", `Pages例外の外のworkflow: ${workflow}`);
    const yml = await readFile(path.join(repoRoot, ".github/workflows", workflow), "utf8");
    assert.match(yml, /runs-on:\s*ubuntu-latest/, "Pages配信workflowの形が変わっている");
    assert.match(yml, /npm test/, "master pushの公開ゲート (npm test) が無い");
  }
});
