/** GENRES.md「他リポ連携」節と x-discover 実装の整合性ガード。
 *
 * docs 53f7bb1 で修正した不一致 (Reddit を素材源と記載・起草 backend の旧 litellm
 * 単体記述) の回帰防止。主張値は collect.py / llm_backend.py から抽出して比較し、
 * 実装を変えたときにこのガードがdocs更新を促す。
 * Reddit を実装する場合は GENRES.md の「未実装」記述と本ガードを同時に更新する。 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const xDiscoverDir = path.join(repoRoot, "scripts", "x-discover");
const genresMd = readFileSync(path.join(xDiscoverDir, "GENRES.md"), "utf8");
const collectPy = readFileSync(path.join(xDiscoverDir, "collect.py"), "utf8");
const llmBackendPy = readFileSync(path.join(xDiscoverDir, "llm_backend.py"), "utf8");

// collect.py の収集源実装 (collect_hn / collect_github のみのはず)
const collectors = [...collectPy.matchAll(/^def (collect_\w+)\(/gm)].map((m) => m[1]);

// 「他リポ連携」節を抽出し、折り返し行を連結した箇条書きに組み直す
function collaborationBullets() {
  const start = genresMd.indexOf("## 他リポ連携");
  if (start === -1) return null;
  const rest = genresMd.slice(start);
  const next = rest.indexOf("\n## ", 1);
  const section = next === -1 ? rest : rest.slice(0, next);
  const bullets = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("- ")) bullets.push(line.slice(2));
    else if (bullets.length > 0 && /^\s+\S/.test(line)) {
      bullets[bullets.length - 1] += ` ${line.trim()}`;
    }
  }
  return bullets;
}

test("素材源: collect.py の収集源はHN・GitHubのみでReddit収集は存在しない", () => {
  assert.ok(collectors.includes("collect_hn"), `collect_hnがない: ${collectors}`);
  assert.ok(collectors.includes("collect_github"), `collect_githubがない: ${collectors}`);
  assert.equal(
    collectors.includes("collect_reddit"),
    false,
    "collect_reddit が実装された — GENRES.mdの未実装記述と本ガードを同時に更新",
  );
});

test("素材源: GENRES.md の素材源 v0 は実装された収集源のみを列挙する", () => {
  const bullet = sourcesClaim(bullets());
  const claim = bullet.match(/^素材源 v0 = ([^。]*)。/);
  assert.ok(claim, `素材源 v0 の文がない: ${bullet}`);
  const display = { hn: "HN", github: "GitHub" };
  for (const collector of collectors) {
    const name = display[collector.replace("collect_", "")];
    if (name) {
      assert.ok(claim[1].includes(name), `${collector} (${name}) が素材源に記載されていない`);
    }
  }
  assert.doesNotMatch(claim[1], /Reddit/, `未実装のRedditが素材源に混入: ${claim[1]}`);
});

test("素材源: GENRES.md のReddit言及にはすべて未実装注記が付く", () => {
  const flat = bullets().join(" ");
  for (const m of flat.matchAll(/Reddit/g)) {
    const context = flat.slice(m.index, m.index + 80);
    assert.ok(context.includes("未実装"), `未実装注記がないReddit言及: ${context}`);
  }
});

test("起草: llm_backend.py のbackend chainと既定値", () => {
  const backends = llmBackendPy.match(/_BACKENDS = \{([^}]*)\}/);
  assert.ok(backends, "_BACKENDS 定義がない");
  const keys = [...backends[1].matchAll(/'(\w+)':/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ["codex", "devin", "litellm"]);

  const fallback = llmBackendPy.match(
    /os\.environ\.get\('LLM_BACKENDS',\s*os\.environ\.get\('LLM_BACKEND',\s*'([^']+)'\)/,
  );
  assert.ok(fallback, "LLM_BACKENDS/LLM_BACKEND の既定chainが見つからない");
  assert.equal(fallback[1], "litellm");
  assert.ok(llmBackendPy.includes("LITELLM_API_KEY"), "litellmのkey環境変数が実装にない");
});

test("起草: GENRES.md の起草記述は llm_backend.py の実装と一致する", () => {
  const bullet = bullets().find((b) => b.startsWith("起草 ="));
  assert.ok(bullet, "起草 = の行がない");

  const backends = llmBackendPy.match(/_BACKENDS = \{([^}]*)\}/);
  const keys = [...backends[1].matchAll(/'(\w+)':/g)].map((m) => m[1]);
  const fallback = llmBackendPy.match(
    /os\.environ\.get\('LLM_BACKENDS',\s*os\.environ\.get\('LLM_BACKEND',\s*'([^']+)'\)/,
  );
  const since = llmBackendPy.match(/\((\d{4}-\d{2}-\d{2})〜/);

  assert.ok(bullet.includes("LLM_BACKENDS"), "LLM_BACKENDS envへの言及がない");
  assert.ok(bullet.includes("llm_backend.py"), "llm_backend.pyへの言及がない");
  for (const key of keys) {
    assert.ok(bullet.includes(key), `backend ${key} への言及がない`);
  }
  assert.ok(bullet.includes(`既定は${fallback[1]}`), `既定backend (${fallback[1]}) の記述がない`);
  assert.ok(bullet.includes(`${since[1]}〜`), `llm_backend.py導入日 (${since[1]}〜) の記述がない`);
  assert.ok(bullet.includes("LITELLM_API_KEY"), "litellmのkey環境変数の規律記述がない");
});

function bullets() {
  const b = collaborationBullets();
  assert.ok(b, "GENRES.mdに「## 他リポ連携」節がない");
  assert.ok(b.length > 0, "他リポ連携節が空");
  return b;
}

function sourcesClaim(bs) {
  const bullet = bs.find((b) => b.startsWith("素材源 v0 ="));
  assert.ok(bullet, "素材源 v0 = の行がない");
  return bullet;
}
