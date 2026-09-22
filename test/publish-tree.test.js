import { test } from "node:test";
import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_FILES = [
  "index.html", "styles.css", "app.js", "logic.js", "share.js",
  "twitter-text-regex.js", "favicon.svg", "sitemap.xml"
];
const MODULE_SCRIPT = /<script\b([^>]*)>/gi;
const ATTRIBUTE = /([\w:-]+)\s*=\s*["']([^"']+)["']/gi;
const IMPORT = /\b(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g;

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function relativeTarget(root, from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(from), specifier.split(/[?#]/, 1)[0]);
  assert.ok(target === root || target.startsWith(`${root}${path.sep}`),
    `配信ツリー外の相対参照: ${path.relative(root, from)} -> ${specifier}`);
  return target;
}

async function htmlFiles(root) {
  const result = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".html")) result.push(file);
    }
  }
  await walk(root);
  return result;
}

async function assertPublishTree(root) {
  for (const file of ROOT_FILES) {
    assert.ok(await exists(path.join(root, file)), `公開ツリーに ${file} がない`);
  }

  const queue = [];
  for (const html of await htmlFiles(root)) {
    const source = await readFile(html, "utf8");
    for (const match of source.matchAll(MODULE_SCRIPT)) {
      const attrs = Object.fromEntries([...match[1].matchAll(ATTRIBUTE)]
        .map(([, key, value]) => [key.toLowerCase(), value]));
      if (attrs.type?.toLowerCase() !== "module" || !attrs.src) continue;
      const target = relativeTarget(root, html, attrs.src);
      if (target) queue.push(target);
    }
  }

  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(await exists(file), `相対module参照先が公開ツリーにない: ${path.relative(root, file)}`);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(IMPORT)) {
      const target = relativeTarget(root, file, match[1]);
      if (target) queue.push(target);
    }
  }
}

async function buildPublishFixture(root) {
  for (const file of ROOT_FILES) {
    await cp(path.join(repoRoot, file), path.join(root, file));
  }
  await cp(path.join(repoRoot, "content"), path.join(root, "content"), { recursive: true });
}

test("実際の公開ツリーでHTMLからの相対JavaScript依存閉包を検査する", async () => {
  const configuredRoot = process.env.PUBLICATION_ROOT;
  if (configuredRoot) {
    await assertPublishTree(path.resolve(configuredRoot));
    return;
  }

  const root = await mkdtemp(path.join(tmpdir(), "cb-publish-tree-"));
  try {
    await buildPublishFixture(root);
    await assertPublishTree(root);

    // 必須moduleの欠落を意図的に作り、検査が成功を誤認しないことを確認する。
    await rm(path.join(root, "twitter-text-regex.js"));
    await assert.rejects(() => assertPublishTree(root), /twitter-text-regex\.js/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
