// site-files.test.js — サイト静的資産 (favicon・sitemap) の公開整合ガード。
//
// sitemap.xml は「インデックス許可ページのみ」を掲載する規律を機械検査する。
// noindex の承認資産配信ページ (content/01-17系) を誤掲載すると、
// noindex と sitemap の矛盾 (検索エンジンへの混線) になる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("配信ページの本文bytesと承認metadataのhashが一致する", async () => {
  for (const asset of ["01-canonical", "02-entry-read", "15-diagnostic-lp", "17-org-pdf"]) {
    const dir = path.join(repoRoot, "content", asset);
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    const metadata = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8"));
    const body = html.match(/<pre id="asset-body">\n([\s\S]*?)<\/pre>/);
    assert.ok(body, `${asset}: 本文がない`);
    assert.equal(metadata.asset_id, asset);
    const hash = createHash("sha256").update(body[1], "utf8").digest("hex");
    assert.equal(hash, metadata.content_hash, `${asset}: 本文と承認版が不一致`);
    assert.ok(html.includes(`content_hash=${hash} -->`), `${asset}: 表示用metadataが不一致`);
  }
});

test("deploy workflow は favicon.svg と sitemap.xml を配信木に含める", async () => {
  // 19a0caf で設置した2資産がpublish tree外でlive 404になった実測への回帰防止。
  const yml = await readFile(path.join(repoRoot, ".github/workflows/deploy_pages.yml"), "utf8");
  const cpLine = yml.split("\n").find((l) => l.includes("cp index.html"));
  assert.ok(cpLine, "publish treeのcp行が見つからない");
  for (const file of ["favicon.svg", "sitemap.xml", "robots.txt", "app.js", "logic.js", "share.js", "twitter-text-regex.js", "404.html"]) {
    assert.ok(cpLine.includes(file), `配信木に ${file} が無い: ${cpLine.trim()}`);
  }
});

test("robots.txt はsitemap.xmlと同一hostのSitemap行を宣言し、Disallowでnoindexを無効化しない", async () => {
  // sitemap の標準発見経路は /robots.txt。sitemap.xml だけ置いても
  // 検索エンジンは規約上たどらないため、宣言行の一致を機械検査する。
  // noindex は meta robots が正本で、これはクロール前提 — Disallow を足すと
  // meta が読めず noindex が無効化されうるので、規約上 Disallow は書かない。
  const [robots, sitemap] = await Promise.all([
    readFile(path.join(repoRoot, "robots.txt"), "utf8"),
    readFile(path.join(repoRoot, "sitemap.xml"), "utf8")
  ]);
  const host = new URL(sitemap.match(/<loc>([^<]+)<\/loc>/)[1]).host;
  const hostPattern = host.replace(/[.]/g, "\\.");
  assert.match(robots, new RegExp(`^Sitemap: https://${hostPattern}/sitemap\\.xml$`, "m"),
    `Sitemap行がsitemap.xmlのhost (${host}) と不一致`);
  assert.doesNotMatch(robots, /^\s*Disallow:/m,
    "Disallow は noindex を無効化しうる — meta robots運用の範囲で対応すること");
});

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

test("LP はOG基本metaを備え、title/descriptionの公開文字列と一致する", async () => {
  // シェアループの着地点 (?r=/utm付きURL) であるLPだけがOG規約から漏れていた。
  // og:url は共有URLのcard canonical化に使う。新規主張はしない (既存文字列の再掲)。
  const [html, sitemap] = await Promise.all([
    readFile(path.join(repoRoot, "index.html"), "utf8"),
    readFile(path.join(repoRoot, "sitemap.xml"), "utf8")
  ]);
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  const description = html.match(/<meta name="description" content="([^"]*)">/)[1];
  const meta = (prop) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)">`))?.[1];
  assert.equal(meta("og:title"), title);
  assert.equal(meta("og:description"), description);
  assert.equal(meta("og:type"), "website");
  const siteUrl = new URL(sitemap.match(/<loc>([^<]+)<\/loc>/)[1]);
  assert.equal(meta("og:url"), `${siteUrl.origin}/`);
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

  // 逆方向: content配下の index,follow ページでsitemap未掲載があれば検出。
  // 18-blog/<slug>/ のような2階層も対象にする (記事追加時の掲載漏れがここで起きる)。
  // 対象はgit追跡済みfileのみ — 未追跡の作業中page (隔離publish tree fixture等) は
  // 公開対象でないため sitemap 規律の外。
  const tracked = execFileSync("git", ["ls-files", "-z", "content"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter((f) => f.endsWith("/index.html"));
  assert.ok(tracked.length > 0, "content配下に追跡済みindex.htmlが無い (テストの前提が崩れた)");
  for (const relPage of tracked) {
    const html = await readFile(path.join(repoRoot, relPage), "utf8");
    const relDir = path.posix.dirname(relPage);
    const indexed = !/<meta name="robots" content="noindex">/.test(html);
    const listed = locs.some((u) => u.includes(`/${relDir}/`));
    if (indexed && !listed) {
      assert.fail(`index,follow のページがsitemap未掲載: ${relDir}/ — sitemap.xml を更新すること`);
    }
  }
});

test("tracker page は live-stats で GET /stats を読む (少数非表示・local dev parity)", async () => {
  // 2026-09-09 導線×計測設計: 計測をコンテンツにする面の常時表示。LP result view
  // と同一規律 (total<5で非表示) と lab本番/local dev のendpoint切替を機械検査する。
  const page = await readFile(path.join(repoRoot, "content/01-tracker-page/index.html"), "utf8");
  assert.match(page, /id="live-interest-stats"/);
  assert.match(page, /https:\/\/api\.connectivebyte\.com\/stats/);
  assert.match(page, /"\/api\/stats"/);
  assert.match(page, /total < 5/);
  assert.match(page, /hidden/);
});

test("LP #apply 申込formは /apply endpoint・同意checkbox・PII分離文言を備える", async () => {
  // 2026-09-10 導線×計測設計 残課題#1 (F5根本): 申込受付の窓口。form検証は
  // server.test.js /api/apply が担う — ここは静的資産の必須部品を機械検査する。
  const lp = await readFile(path.join(repoRoot, "index.html"), "utf8");
  assert.match(lp, /<section class="apply" id="apply">/);
  assert.match(lp, /id="apply-form"/);
  assert.match(lp, /id="apply-email" name="email" type="email"[^>]*required/);
  assert.match(lp, /id="apply-note" name="note" maxlength="1000"/);
  assert.match(lp, /id="apply-consent" type="checkbox" required/);
  // 組織カードから申込への導線
  assert.match(lp, /href="#apply">実施支援の申込へ/);
  const app = await readFile(path.join(repoRoot, "app.js"), "utf8");
  assert.match(app, /https:\/\/api\.connectivebyte\.com\/apply/);
  assert.match(app, /"\/api\/apply"/);
  assert.match(app, /"apply_submitted"/);
  const logic = await readFile(path.join(repoRoot, "logic.js"), "utf8");
  assert.match(logic, /"apply_submitted"/);
  // 法人名 (事業化層) はLPに出さない
  assert.equal(lp.includes("東京AIソリューションズ"), false);
});

test("17-org-pdf 完成PDF artifactは存在しLP・原稿page両面から配線される", async () => {
  // 2026-09-10 残課題#4 (r4 F8): 記入式様式の完成PDF不在を閉じる。生成源は
  // scripts/build-org-pdf.mjs・commit対象は生成済みPDF。app.js内組み立てPDF
  // (英字placeholder) は廃止済みであることも検査する。
  const pdfPath = path.join(repoRoot, "content/17-org-pdf/organization-guide.pdf");
  const pdf = await readFile(pdfPath);
  assert.ok(pdf.length >= 5000, `PDFが小さすぎる (${pdf.length} bytes)`);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "PDF magic不在");
  // LP組織カード: button → app.js → 静的PDF (組み立てpdfContent廃止)
  const lp = await readFile(path.join(repoRoot, "index.html"), "utf8");
  assert.match(lp, /data-action="download-org"/);
  assert.match(lp, /部門別・AI活用診断/);
  const app = await readFile(path.join(repoRoot, "app.js"), "utf8");
  assert.match(app, /content\/17-org-pdf\/organization-guide\.pdf/);
  assert.equal(app.includes("function pdfContent"), false);
  // 原稿page自身もPDFを配る (申込CTAの上に資産download)
  const page = await readFile(path.join(repoRoot, "content/17-org-pdf/index.html"), "utf8");
  assert.match(page, /href="organization-guide\.pdf" download=/);
});


test("LPの検証レポートカードから、公開中の全検証レポート記事へ到達できる", async () => {
  // VERIFICATION NOTEカードのリンクを「最新1本へ差し替える」運用で旧記事が
  // 孤立した実測がある (quetab: カード新設時の飛び先だったがozbrain公開時の
  // 差し替えでサイト内導線から到達不能化)。sitemap掲載 (=index許可の公開頁)
  // のうちタイトルで検証レポートと自認する記事は、LPから到達できることを
  // 機械検査する。測定方法系など別カテゴリの記事は対象外 (誤った約束をしない)。
  const [lp, sitemap] = await Promise.all([
    readFile(path.join(repoRoot, "index.html"), "utf8"),
    readFile(path.join(repoRoot, "sitemap.xml"), "utf8")
  ]);
  const blogPaths = [...sitemap.matchAll(/<loc>https:\/\/lab\.connectivebyte\.com(\/content\/18-blog\/[^<]+\/)<\/loc>/g)]
    .map((m) => m[1]);
  assert.ok(blogPaths.length > 0, "sitemapに18-blog記事が無い");
  // 判定はVERIFICATION NOTEカード内部に限定する (カード外の他導線では
  // 「カードから到達できる」という約束を検査したことにならない)。
  const card = lp.match(/<article[^>]*id="verification-note"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.ok(card.length > 0, "LPにVERIFICATION NOTEカード (id=verification-note) が無い");
  let reports = 0;
  for (const locPath of blogPaths) {
    const html = await readFile(path.join(repoRoot, locPath, "index.html"), "utf8");
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    if (!title.includes("検証レポート")) continue;
    reports += 1;
    // hrefは / 有無・index.html 有無・絶対URLを同一目的地として許容する
    assert.match(card, new RegExp(`href="[^"]*${locPath.slice(1)}(index\\.html)?"`),
      `VERIFICATION NOTEカードから検証レポート記事へ到達できない: ${locPath} — カードへリンクを追加すること`);
  }
  assert.ok(reports > 0, "検証レポートと自認する記事が無い (テストの前提が崩れた)");
});

test("sitemap掲載の18-blog記事はサイト内どこかから到達できる (孤児記事の検知)", async () => {
  // 検証レポートカードの到達性テストはタイトル自認 (検証レポート) の記事に限定
  // しており、測定方法系など別カテゴリは対象外だった。sitemap掲載 (=index許可の
  // 公開頁) なのにサイト内どこからもリンクされない孤児記事は検索流入しか経路が
  // なく、L2 (内容と導線の整合) から漏れる。カテゴリを問わず、18-blog掲載記事は
  // 記事自身以外の追跡済みページから少なくとも1本リンクされることを機械検査する
  // (og:url・canonical など自己参照は到達とはみなさない)。
  const sitemap = await readFile(path.join(repoRoot, "sitemap.xml"), "utf8");
  const blogPaths = [...sitemap.matchAll(/<loc>https:\/\/lab\.connectivebyte\.com(\/content\/18-blog\/[^<]+\/)<\/loc>/g)]
    .map((m) => m[1]);
  assert.ok(blogPaths.length > 0, "sitemapに18-blog記事が無い");
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter((f) => f.endsWith(".html"));
  assert.ok(tracked.length > 0, "追跡済みhtmlが無い (テストの前提が崩れた)");
  const inbound = new Map(blogPaths.map((p) => [p, 0]));
  for (const rel of tracked) {
    const html = await readFile(path.join(repoRoot, rel), "utf8");
    const base = `https://lab.connectivebyte.com/${path.posix.dirname(rel) === "." ? "" : `${path.posix.dirname(rel)}/`}`;
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const raw = m[1];
      if (/^https?:\/\//.test(raw) && !raw.includes("lab.connectivebyte.com")) continue;
      let target;
      try {
        target = new URL(raw, base).pathname;
      } catch {
        continue;
      }
      if (target.endsWith("/index.html")) target = target.slice(0, -"index.html".length);
      if (inbound.has(target) && rel !== path.posix.join(target.slice(1), "index.html")) {
        inbound.set(target, inbound.get(target) + 1);
      }
    }
  }
  for (const [locPath, count] of inbound) {
    assert.ok(count > 0, `孤児記事 (サイト内リンク0本): ${locPath} — 導線のあるページへリンクを追加すること`);
  }
});

test("Pages は同じjobでテストと配信木検査に合格してから公開する", async () => {
  const workflow = await readFile(path.join(repoRoot, ".github/workflows/deploy_pages.yml"), "utf8");
  const steps = ["run: npm test", "name: Prepare publish tree", "PUBLICATION_ROOT: _site",
    "run: node --test test/publication-guard.test.js", "uses: actions/upload-pages-artifact@", "uses: actions/deploy-pages@"];
  let previous = -1;
  for (const step of steps) {
    const position = workflow.indexOf(step);
    assert.ok(position > previous, `${step} が欠落、または公開ゲートの順序が不正`);
    previous = position;
  }
  assert.doesNotMatch(workflow, /continue-on-error:|if:\s*\$?\{?\{?\s*always\(/);
});
