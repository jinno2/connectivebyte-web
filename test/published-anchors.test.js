// published-anchors.test.js — 公開ページのアンカー到達ガード。
// deploy workflowが配信するHTML (トップ + 404 + content全体) について、
// ページ内リンク (href="#x") と他ページへのフラグメント付きリンク
// (href="path#x") が実在するidに飛ぶことを機械検査する。
// quetab記事で目次がid未付与のsectionを指しクリックしても移動しない
// 欠損が実測されたため、ブログ専用だった走査を全公開ページへ拡張した。
// フラグメント無しのページ間リンク (href="path") も配信対象ページへ
// 到達することを検査し、リンク切れを機械検出する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { idSet, resolveFragmentTarget } from "./published-anchors.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// deploy_pages.yml の Prepare publish tree と同じ配信対象 (HTMLのみ)
async function publishedHtmlFiles() {
  const files = [path.join(repoRoot, "index.html"), path.join(repoRoot, "404.html")];
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
      const target = resolveFragmentTarget(base, href);
      if (target === null) continue;
      assert.ok(pages.has(target), `${rel}: href="${href}#${frag}" の飛び先ページ (${target}) が配信対象に存在しない`);
      assert.ok(
        idSet(pages.get(target)).has(frag),
        `${rel}: href="${href}#${frag}" の飛び先idが ${target} に存在しない`,
      );
    }
  }
});

test("公開ページのフラグメント無しページ間リンク (href=\"path\") は配信対象の実在ページに到達する", async () => {
  const files = await publishedHtmlFiles();
  const pages = new Set(files.map((f) => path.relative(repoRoot, f).split(path.sep).join("/")));

  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const html = await readFile(file, "utf8");
    // script/style内のJSテンプレート (例: ' + href + ') は実行時生成の値なので除外
    const doc = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "");
    const base = path.posix.dirname(rel);
    for (const m of doc.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (href.includes("#")) continue; // フラグメント付きは上の2テストが検査する
      if (/\.(css|js|png|svg|xml|txt|pdf|webmanifest|ico)$/i.test(href.split("?")[0])) continue;
      const target = resolveFragmentTarget(base, href);
      if (target === null) continue; // 外部スキーム
      assert.ok(pages.has(target), `${rel}: href="${href}" の飛び先ページ (${target}) が配信対象に存在しない`);
    }
  }
});

test("フラグメント飛び先の解決規則は外部スキームを除外し、クエリ除去・ディレクトリURLをindex.htmlへ正規化する", () => {
  const base = "content/18-blog/quetab-ai-game-builder";
  assert.equal(resolveFragmentTarget(base, "https://example.com/p.html"), null);
  assert.equal(resolveFragmentTarget(base, "mailto:hello@example.com"), null);
  assert.equal(resolveFragmentTarget(base, "//cdn.example.com/p.html"), null);
  assert.equal(
    resolveFragmentTarget(base, "../../?utm_source=content_page&utm_campaign=x"),
    "content/index.html",
  );
  assert.equal(resolveFragmentTarget(base, "../../"), "content/index.html");
  assert.equal(resolveFragmentTarget(base, ".."), "content/18-blog/index.html");
  assert.equal(resolveFragmentTarget(base, "."), "content/18-blog/quetab-ai-game-builder/index.html");
  assert.equal(resolveFragmentTarget(base, "./"), "content/18-blog/quetab-ai-game-builder/index.html");
  assert.equal(resolveFragmentTarget(base, "sub/page.html"), "content/18-blog/quetab-ai-game-builder/sub/page.html");
  assert.equal(resolveFragmentTarget("", "other/index.html"), "other/index.html");
  assert.equal(resolveFragmentTarget(".", "/"), "index.html");
  assert.equal(resolveFragmentTarget("content/01-canonical", "../../"), "index.html");
});
