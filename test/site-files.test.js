// site-files.test.js — サイト静的資産 (favicon・sitemap) の公開整合ガード。
//
// sitemap.xml は「インデックス許可ページのみ」を掲載する規律を機械検査する。
// noindex の承認資産配信ページ (content/01-17系) を誤掲載すると、
// noindex と sitemap の矛盾 (検索エンジンへの混線) になる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("favicon.svg は本店brand色 (ink背景・lime/cyan円環) で存在する", async () => {
  const svg = await readFile(path.join(repoRoot, "favicon.svg"), "utf8");
  assert.match(svg, /#101c2c/); // --ink
  assert.match(svg, /#c8ff52/); // --lime
  assert.match(svg, /<svg/);
  // LP と 18-blog テンプレート群から参照されていること
  const lp = await readFile(path.join(repoRoot, "index.html"), "utf8");
  assert.match(lp, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  const article = await readFile(path.join(repoRoot, "content/18-blog/quetab-ai-game-builder/index.html"), "utf8");
  assert.match(article, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
});

test("sitemap.xml はインデックス許可ページのみを掲載する (noindex資産を含まない)", async () => {
  const sitemap = await readFile(path.join(repoRoot, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0, "sitemap が空");
  assert.ok(locs.some((u) => u === "https://lab.connectivebyte.com/"), "LPが未掲載");

  // 掲載URLのpathは実在する公開ファイルに解決すること (リンク切れ=床の埃)
  for (const loc of locs) {
    const url = new URL(loc);
    assert.equal(url.host, "lab.connectivebyte.com", `想定外のhost: ${loc}`);
    const rel = url.pathname === "/" ? "index.html" : path.join(url.pathname.slice(1), "index.html");
    const html = await readFile(path.join(repoRoot, rel), "utf8");
    assert.doesNotMatch(html, /<meta name="robots" content="noindex">/, `noindex頁がsitemap掲載: ${loc}`);
  }

  // 逆方向: content配下の index,follow ページでsitemap未掲載があれば検出
  const contentDir = path.join(repoRoot, "content");
  const dirs = await readdir(contentDir, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const htmlPath = path.join(contentDir, d.name, "index.html");
    let html;
    try {
      html = await readFile(htmlPath, "utf8");
    } catch {
      continue;
    }
    const indexed = !/<meta name="robots" content="noindex">/.test(html);
    const listed = locs.some((u) => u.includes(`/content/${d.name}/`));
    if (indexed && !listed) {
      assert.fail(`index,follow のページがsitemap未掲載: content/${d.name}/ — sitemap.xml を更新すること`);
    }
  }
});
