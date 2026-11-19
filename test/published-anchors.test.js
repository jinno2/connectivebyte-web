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
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { idSet, pageLinkCandidates, resolveFragmentTarget, resolvePlainTarget } from "./published-anchors.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// deploy_pages.yml の cp 行と同じ配信ルートファイル（下の同期テストが一致を検査する）
const ROOT_FILES = new Set([
  "index.html", "styles.css", "app.js", "logic.js", "share.js",
  "twitter-text-regex.js", "favicon.svg", "sitemap.xml", "robots.txt",
]);

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
    for (const [href, target] of pageLinkCandidates(html, path.posix.dirname(rel))) {
      assert.ok(pages.has(target), `${rel}: href="${href}" の飛び先ページ (${target}) が配信対象に存在しない`);
    }
  }
});

test("フラグメント無しリンク検査はscript/style内・アセット・外部を除外し、壊れたページ間リンクのみ検出対象に上げる", () => {
  const pages = new Set(["index.html", "content/index.html"]);
  const doc = [
    "<!doctype html><html><head>",
    '<link rel="stylesheet" href="styles.css">',
    '<style>a::before { content: "href=\\"style-fake.html\\"" }</style>',
    '<script>el.innerHTML = "<a href=\'js-fake.html\'>" + label + "</a>";</script>',
    "</head><body>",
    '<a href="content/">entry</a>',
    '<a href="content#top">fragment</a>',
    '<a href="logo.svg">asset</a>',
    '<a href="https://example.com/">external</a>',
    '<a href="missing.html">broken</a>',
    "</body></html>",
  ].join("");
  const candidates = pageLinkCandidates(doc, "");
  assert.deepEqual(candidates, [
    ["content/", "content/index.html"],
    ["missing.html", "missing.html"],
  ]);
  assert.ok(
    candidates.some(([, target]) => !pages.has(target)),
    "壊れたリンクの飛び先は配信対象集合に無いはず (ガードがfailする状態)",
  );
  assert.deepEqual(pageLinkCandidates('<a href="../../">up</a>', "content/18-blog/x"), [
    ["../../", "content/index.html"],
  ]);
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

test("plainリンク飛び先の解決規則は外部スキームを除外し、ルート絶対パスと資産拡張子を実パスへ解決する", () => {
  const base = "content/18-blog/quetab-ai-game-builder";
  assert.equal(resolvePlainTarget(base, "https://example.com/p.html"), null);
  assert.equal(resolvePlainTarget(base, "mailto:hello@example.com"), null);
  assert.equal(resolvePlainTarget(base, "tel:+810000000000"), null);
  assert.equal(resolvePlainTarget(base, "//cdn.example.com/x.png"), null);
  assert.equal(resolvePlainTarget(base, "#section"), null);
  assert.equal(resolvePlainTarget(base, "/favicon.svg"), "favicon.svg");
  assert.equal(resolvePlainTarget(".", "styles.css"), "styles.css");
  assert.equal(resolvePlainTarget("content/18-blog/ozbrain-ja-knowledge", "../article.css"), "content/18-blog/article.css");
  assert.equal(resolvePlainTarget("content/17-org-pdf", "organization-guide.pdf"), "content/17-org-pdf/organization-guide.pdf");
  assert.equal(
    resolvePlainTarget(base, "../../15-diagnostic-lp/?utm_source=blog"),
    "content/15-diagnostic-lp/index.html",
  );
  assert.equal(resolvePlainTarget(base, "../../"), "content/index.html");
  assert.equal(resolvePlainTarget("content/01-canonical", "../.."), "index.html");
  assert.equal(resolvePlainTarget(base, "sub/page.html"), "content/18-blog/quetab-ai-game-builder/sub/page.html");
});

test("ROOT_FILESはdeploy_pages.ymlのcp行と同調し、全ファイルがリポジトリに実在する", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github/workflows/deploy_pages.yml"), "utf8");
  const cpLine = workflow.match(/^\s*cp (?!-r)(.+) _site\/\s*$/m);
  assert.ok(cpLine, "deploy_pages.yml のルートファイルcp行が見つからない");
  assert.deepEqual(
    new Set(cpLine[1].trim().split(/\s+/)),
    ROOT_FILES,
    "ROOT_FILESはdeploy_pages.ymlのcp行と一致しない（インベントリが配信設定から乖離している）",
  );
  for (const name of ROOT_FILES) {
    await assert.doesNotReject(stat(path.join(repoRoot, name)), `ルートファイル ${name} がリポジトリに存在しない`);
  }
});

test("公開ページのplainリンク (href=\"path\") は飛び先ページまたは配信資産として存在する", async () => {
  const publishedFiles = new Set(ROOT_FILES);
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else publishedFiles.add(path.relative(repoRoot, p).split(path.sep).join("/"));
    }
  }
  await walk(path.join(repoRoot, "content"));

  const files = await publishedHtmlFiles();
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    // inline script内の文字列テンプレート (href="' + x + '") は実リンクでないため除外
    const html = (await readFile(file, "utf8")).replace(/<script[\s\S]*?<\/script>/gi, "");
    const base = path.posix.dirname(rel);
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (href.includes("#")) continue; // フラグメント付きは既存のアンカーテストが担当
      const target = resolvePlainTarget(base, href);
      if (target === null) continue;
      assert.ok(
        publishedFiles.has(target),
        `${rel}: href="${href}" の飛び先 (${target}) が配信対象に存在しない`,
      );
    }
  }
});
