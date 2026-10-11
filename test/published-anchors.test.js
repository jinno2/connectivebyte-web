// published-anchors.test.js — 公開ページのアンカー到達ガード。
// deploy workflowが配信するHTML (トップ + content全体) について、
// ページ内リンク (href="#x") と他ページへのフラグメント付きリンク
// (href="path#x") が実在するidに飛ぶことを機械検査する。
// quetab記事で目次がid未付与のsectionを指しクリックしても移動しない
// 欠損が実測されたため、ブログ専用だった走査を全公開ページへ拡張した。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// deploy_pages.yml の Prepare publish tree と同じ配信対象 (HTMLのみ)
async function publishedHtmlFiles() {
  const files = [path.join(repoRoot, "index.html")];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".html")) files.push(p);
    }
  }
  await walk(path.join(repoRoot, "content"));
  return files;
}

function idSet(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

test("公開ページのページ内アンカー (href=\"#x\") は同一ページの実在idに到達する", async () => {
  const files = await publishedHtmlFiles();
  assert.ok(files.length > 1, "公開HTMLが無い");

  for (const file of files) {
    const html = await readFile(file, "utf8");
    const rel = path.relative(repoRoot, file);
    const ids = idSet(html);
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(ids.has(m[1]), `${rel}: href="#${m[1]}" の飛び先idが存在しない`);
    }
  }
});

test("公開ページから他ページへのフラグメント付きリンク (href=\"path#x\") は飛び先ページの実在idに到達する", async () => {
  const files = await publishedHtmlFiles();
  const pages = new Map();
  for (const file of files) {
    pages.set(path.relative(repoRoot, file).split(path.sep).join("/"), await readFile(file, "utf8"));
  }

  for (const [rel, html] of pages) {
    const base = path.posix.dirname(rel);
    for (const m of html.matchAll(/href="([^"#][^"#]*)#([^"]+)"/g)) {
      const [, href, frag] = m;
      if (/^(https?:|mailto:|\/\/)/.test(href)) continue;
      const filePart = href.split("?", 1)[0];
      let target = path.posix.normalize(path.posix.join(base, filePart));
      if (target.endsWith("/")) target = target.slice(0, -1);
      if (target === "." || target === "") target = "index.html";
      else if (!target.endsWith(".html")) target += "/index.html";
      assert.ok(pages.has(target), `${rel}: href="${href}#${frag}" の飛び先ページ (${target}) が配信対象に存在しない`);
      assert.ok(
        idSet(pages.get(target)).has(frag),
        `${rel}: href="${href}#${frag}" の飛び先idが ${target} に存在しない`,
      );
    }
  }
});
