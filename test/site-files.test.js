// site-files.test.js — サイト静的資産 (favicon・sitemap) の公開整合ガード。
//
// sitemap.xml は「インデックス許可ページのみ」を掲載する規律を機械検査する。
// noindex の承認資産配信ページ (content/01-17系) を誤掲載すると、
// noindex と sitemap の矛盾 (検索エンジンへの混線) になる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("配信ページの本文bytesと承認metadataのhashが一致する", async () => {
  // 対象は固定listではなく「metadata.jsonを持つ配信ページ」を content/ から自動
  // 発見する。02-history・01-tracker-page が旧固定listから漏れ、表示用
  // content_hash commentの陳腐化が検出されない実績があった — 以後の配信ページ
  // 追加も自動で対象化され、本文・承認metadata・表示commentの3者一致を強制する。
  const contentDir = path.join(repoRoot, "content");
  const assets = readdirSync(contentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(contentDir, entry.name, "metadata.json")))
    .map((entry) => entry.name);
  assert.ok(assets.length >= 4, `配信ページの発見が過少 (${assets.length}件) — テストの前提が崩れた`);
  for (const asset of assets) {
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

test("app.js が querySelector で参照する全 id は index.html の実DOMに存在する (モックと実物の配線乖離の検知)", async () => {
  // level_table_read_100 のIntersectionObserverは実HTMLのidを検索する。実DOMに
  // idが無いとモックDOMにidを注入するテストだけ通って本番で発火しないため、
  // app.js 内の全 #id 参照を抽出し index.html 側の実在を検査する (属性順・
  // クォート形式に依存しない)。app.js が動的生成する id (.id = "...") は
  // 実HTMLに無いのが正常なため除外する。
  const [app, lp] = await Promise.all([
    readFile(path.join(repoRoot, "app.js"), "utf8"),
    readFile(path.join(repoRoot, "index.html"), "utf8")
  ]);
  const queriedIds = new Set();
  for (const [, selector] of app.matchAll(/querySelector(?:All)?\(\s*["']([^"']*[#][^"']*)["']\s*\)/g)) {
    for (const [, id] of selector.matchAll(/#([\w-]+)/g)) queriedIds.add(id);
  }
  const dynamicIds = new Set([...app.matchAll(/\.id\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1]));
  const htmlIds = new Set([...lp.matchAll(/\bid\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1]));
  // 抽出regexの腐敗 (0件一致で無意味にpassする偽陰性) のガード。実在は55id。
  assert.ok(queriedIds.size >= 50, `app.js のid参照の抽出が過少: ${queriedIds.size}件`);
  const missing = [...queriedIds].filter((id) => !dynamicIds.has(id) && !htmlIds.has(id));
  assert.deepEqual(missing, [], `app.js が参照するidが index.html の実DOMに無い: ${missing.join(", ")}`);
});

// 1頁分のHTMLから「inline scriptが参照するidのうち、静的DOMに存在しないもの」を
// 突き出す (次testの走査本体。実頁の検査と合成fixtureによる規則の単位検査を同じ
// 規則に乗せるため関数に切った — inboundTarget と同じ構成)。
// 規則: 参照はinline script本文の getElementById/#id (src付き外部script本文は
// 対象外)。DOM側のidはinline script本文を除いて数え (script内の view.id = "..." を
// 実DOMのidと誤認しない)、空白 (または文頭) に続く id 属性のみを数える —
// data-id 等 "id" を含む属性名に部分一致すると静的id欠落の偽陰性になる。
// script後段のid移転 (02-history: pre.removeAttribute→view.id) でも先頭lookupは
// 静的DOMを探すため、最初の.id付与が最初の参照より前のidのみ動的idとして静的
// 実在要求から除外する (生成後に参照するid・app.jsのfeedback-note型は対象外) —
// 実行順を静的近似した規則。
function inlineScriptIdAudit(html) {
  // src付き外部scriptは対象外。頁内の全inline script本文を連結して抽出する
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).join("\n");
  const refs = new Map(); // id -> 最初の参照位置
  for (const m of scripts.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)) {
    if (!refs.has(m[1])) refs.set(m[1], m.index);
  }
  // selectorは引用符の種類を問わず本文全体を取り、属性selector [..] 内の # は
  // id参照ではないため除いてから数える (引用符混在で抽出自体が落ちないように)
  for (const m of scripts.matchAll(/querySelector(?:All)?\(\s*(["'])(.*?)\1\s*\)/g)) {
    for (const idm of m[2].replace(/\[[^\]]*\]/g, "").matchAll(/#([\w-]+)/g)) {
      if (!refs.has(idm[1])) refs.set(idm[1], m.index);
    }
  }
  const dynamicIds = new Map(); // id -> 最初の .id 付与位置
  for (const m of scripts.matchAll(/\.id\s*=\s*["']([\w-]+)["']/g)) {
    if (!dynamicIds.has(m[1])) dynamicIds.set(m[1], m.index);
  }
  const htmlNoScript = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g, "");
  const htmlIds = new Set([...htmlNoScript.matchAll(/(?:^|\s)id\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1]));
  const missing = [...refs].filter(([id, refPos]) =>
    !htmlIds.has(id) && !(dynamicIds.get(id) !== undefined && dynamicIds.get(id) < refPos))
    .map(([id]) => id);
  return { hasRefs: refs.size > 0, missing };
}

test("各頁のinline scriptが参照するidはその頁の実DOMに存在する", async () => {
  // level_table_read_100 未発火事故 (4d1dcae) と同じ失敗modeの頁内版: 各頁の
  // inline scriptは自身のDOMへ getElementById/#id で配線し、idが無くても例外ではなく
  // 沈黙の早期returnに落ちる (asset-bodyのrich render等)。上のapp.js↔index.html
  // ガードはLPのみのため、追跡済み全HTMLのinline script参照へ同一規律を拡張する
  // (02-history の asset-body は hash検査の対象list外で、id欠落しても既存testが
  // 緑のまま沈黙劣化する)。将来の頁追加も自動で対象化。
  // 抽出本体は inlineScriptIdAudit (直上) — 規則の単位検査は下の2testが担う。
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter((f) => f.endsWith(".html"));
  assert.ok(tracked.length > 0, "追跡済みhtmlが無い (テストの前提が崩れた)");
  const pagesWithRefs = new Set();
  for (const rel of tracked) {
    const html = await readFile(path.join(repoRoot, rel), "utf8");
    const { hasRefs, missing } = inlineScriptIdAudit(html);
    if (hasRefs) pagesWithRefs.add(rel);
    assert.deepEqual(missing, [], `${rel}: inline scriptが参照するidが頁DOMに無い: ${missing.join(", ")}`);
  }
  // 抽出regexの腐敗 (0件一致で無意味にpassする偽陰性) のガード。このガードを
  // 生んだ実2頁 (02-history: hash検査対象外のasset-body沈黙劣化, 01-tracker-page:
  // 第2のinline送信側) が常に抽出対象にいることを頁名で固定する。頁数の下限だと
  // 頁削除・縮退時に「抽出が過少」という誤解を招くため、対象頁で示す。
  for (const known of ["content/01-tracker-page/index.html", "content/02-history/index.html"]) {
    assert.ok(pagesWithRefs.has(known),
      `${known} からid参照が抽出できなくなった — 抽出regexの腐敗、または頁の削除・改名 (ガード対象を見直すこと)`);
  }
});

test("inline id監査の規則: 静的欠落・data-id偽装・後段id移転を検出する", () => {
  // 実装stageの検証で実証された偽陰性 (data-id="..." が \bid= に部分一致し、静的
  // id欠落を見逃す) を含む規則を合成fixtureで固定する。実頁のmutation検証と
  // 同一の失敗modeをここで再現する。
  const page = (dom, script) => `<html><body>${dom}<script>${script}</script></body></html>`;
  // 参照idが頁DOMに無い → 検出
  assert.deepEqual(inlineScriptIdAudit(page("", 'document.getElementById("box");')).missing, ["box"]);
  // data-id は id を満たさない (属性名部分一致による偽陰性の回帰固定)
  assert.deepEqual(
    inlineScriptIdAudit(page('<div data-id="box"></div>', 'document.getElementById("box");')).missing,
    ["box"]);
  // 静的に在れば検出しない
  assert.deepEqual(inlineScriptIdAudit(page('<div id="box"></div>', 'document.getElementById("box");')).missing, []);
  // 後段id移転 (02-history型): 先頭lookupが最初の.id付与より前なら静的idを要求
  assert.deepEqual(inlineScriptIdAudit(page(
    "", 'var pre = document.getElementById("asset-body"); pre.removeAttribute("id"); view.id = "asset-body";'
  )).missing, ["asset-body"]);
});

test("inline id監査の規則: 前段動的id・外部script本文・属性selector内の#は要求しない", () => {
  const page = (dom, script) => `<html><body>${dom}<script>${script}</script></body></html>`;
  // .id付与が最初の参照より前のidは動的id — 静的実在を要求しない
  assert.deepEqual(inlineScriptIdAudit(page("", 'el.id = "gen"; document.getElementById("gen");')).missing, []);
  // src付きscriptの本文は参照抽出の対象外 (その頁のinline scriptだけが本ガードの対象)
  const external = `<html><body><script src="x.js">document.getElementById("nope");</script></body></html>`;
  assert.deepEqual(inlineScriptIdAudit(external), { hasRefs: false, missing: [] });
  // 属性selector [data-h="#x"] 内の # はid参照ではなく、同selector中の実id参照は数える
  const mixed = page("", `document.querySelector('[data-h="#x"] #real');`);
  assert.deepEqual(inlineScriptIdAudit(mixed).missing, ["real"]);
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

// hrefを「サイト内到達」の対象pathへ正規化する。到達とみなさないものは null:
// 外部サイトへの絶対URL、解決不能なhref、そしてリンク元ページ自身への自己参照
// (og:url・canonical・自分の記事内の自己リンクは導線ではない)。
function inboundTarget(raw, pageRel, siteHost) {
  if (/^https?:\/\//.test(raw) && !raw.includes(siteHost)) return null;
  const dir = path.posix.dirname(pageRel);
  const base = `https://${siteHost}/${dir === "." ? "" : `${dir}/`}`;
  let pathname;
  try {
    pathname = new URL(raw, base).pathname;
  } catch {
    return null;
  }
  const target = pathname.endsWith("/index.html") ? pathname.slice(0, -"index.html".length) : pathname;
  if (pageRel === path.posix.join(target.slice(1), "index.html")) return null;
  return target;
}

test("sitemap掲載の18-blog記事はサイト内どこかから到達できる (孤児記事の検知)", async () => {
  // 検証レポートカードの到達性テストはタイトル自認 (検証レポート) の記事に限定
  // しており、測定方法系など別カテゴリは対象外だった。sitemap掲載 (=index許可の
  // 公開頁) なのにサイト内どこからもリンクされない孤児記事は検索流入しか経路が
  // なく、L2 (内容と導線の整合) から漏れる。カテゴリを問わず、18-blog掲載記事は
  // 記事自身以外の追跡済みページから少なくとも1本リンクされることを機械検査する
  // (og:url・canonical など自己参照は到達とはみなさない)。
  // hostはsitemapの <loc> から導出する (ドメイン移行時にテストだけ壊れない)。
  const sitemap = await readFile(path.join(repoRoot, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]));
  const siteHost = locs[0]?.host ?? "";
  const blogPaths = locs.filter((u) => /^\/content\/18-blog\/.+\/$/.test(u.pathname)).map((u) => u.pathname);
  assert.ok(blogPaths.length > 0, "sitemapに18-blog記事が無い");
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter((f) => f.endsWith(".html"));
  assert.ok(tracked.length > 0, "追跡済みhtmlが無い (テストの前提が崩れた)");
  const inbound = new Map(blogPaths.map((p) => [p, 0]));
  for (const rel of tracked) {
    const html = await readFile(path.join(repoRoot, rel), "utf8");
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const target = inboundTarget(m[1], rel, siteHost);
      if (target !== null && inbound.has(target)) {
        inbound.set(target, inbound.get(target) + 1);
      }
    }
  }
  for (const [locPath, count] of inbound) {
    assert.ok(count > 0, `孤児記事 (サイト内リンク0本): ${locPath} — 導線のあるページへリンクを追加すること`);
  }
});

test("孤児検知のリンク解決: 外部URL・自己参照・不正なhrefは到達とみなさない", () => {
  const host = "lab.connectivebyte.com";
  const article = "content/18-blog/ozbrain-ja-knowledge/index.html";
  assert.equal(inboundTarget("https://example.com/content/18-blog/x/", article, host), null,
    "他hostへの絶対URLは到達ではない");
  assert.equal(inboundTarget("https://api.connectivebyte.com/stats", article, host), null,
    "同一ドメインの別subdomainは到達ではない");
  assert.equal(inboundTarget("index.html", article, host), null, "自分自身へのリンクは到達ではない");
  assert.equal(inboundTarget("#apply", article, host), null, "同一ページ内アンカーは到達ではない");
  assert.equal(inboundTarget("https://lab.connectivebyte.com/content/18-blog/ozbrain-ja-knowledge/", article, host), null,
    "絶対URLでも自分自身なら到達ではない");
});

test("孤児検知のリンク解決: 相対・絶対・index.html付きは同一目的地に正規化される", () => {
  const host = "lab.connectivebyte.com";
  const article = "content/18-blog/ozbrain-ja-knowledge/index.html";
  const lp = "index.html";
  assert.equal(inboundTarget("content/18-blog/cap-scan/index.html", lp, host), "/content/18-blog/cap-scan/");
  assert.equal(inboundTarget("/content/18-blog/cap-scan/index.html", lp, host), "/content/18-blog/cap-scan/");
  assert.equal(inboundTarget("https://lab.connectivebyte.com/content/18-blog/cap-scan/", lp, host), "/content/18-blog/cap-scan/");
  // 記事本文からの相対リンク (../) は記事位置基準で解決する
  assert.equal(inboundTarget("../cap-scan/", article, host), "/content/18-blog/cap-scan/");
});

test("全配信ページの相対リンク (href/src) は解決先の実在資産へ向かう (リンク切れの機械検査)", async () => {
  // 孤児検知はsitemap記事へのinbound到達のみを見るため、張った側のリンク先が
  // 実在するか (typo・改名・削除済みpathへのリンク) は別問題になる。L2「誤った
  // 約束やリンク切れを減らす」の直接ガードとして、git追跡の全HTMLが張る href/src
  // を各ページ位置から解決し、site内実在 (repo root基準) へ向かうことを検査する。
  // 外部URL・アンカー・scheme付き (mailto/data:) と inline script が組み立てる
  // 式断片 (引用符・連結を含む値) は対象外。
  //
  // 実在判定はworktreeの実在 (existsSync) ではなくgit追跡path集合との文字列照合で
  // 行う。公開treeは追跡対象から構成されるため追跡外ローカル文件 (build成果物等)
  // へのリンクを実在扱いで通す面がなくなり、さらに大小文字違いのpathがhost FSの
  // 大小文字非依存 (macOS等) で偽陽性になる面も排除される (GitHub Pagesは大小文字
  // 区別で404になる)。末尾"/"付きのtargetはdir宛て、付きなしはfile許容のdirとして
  // 追跡dir集合 (追跡fileの祖先) と照合する。
  const lsFiles = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0").filter(Boolean);
  const tracked = lsFiles.filter((f) => f.endsWith(".html"));
  assert.ok(tracked.length >= 10, `追跡済みhtmlが過少 (${tracked.length}件) — テストの前提が崩れた`);
  const trackedPaths = new Set(lsFiles);
  const trackedDirs = new Set(["."]);
  for (const f of lsFiles) {
    for (let d = path.posix.dirname(f); d !== "."; d = path.posix.dirname(d)) trackedDirs.add(d);
  }
  const broken = [];
  const straySkips = [];
  let checked = 0;
  for (const rel of tracked) {
    const html = await readFile(path.join(repoRoot, rel), "utf8");
    // 単一引用符属性にも対応 — 引用符styleの変更で検査対象が静かに消える偽陰性を防ぐ
    for (const [, dq, sq] of html.matchAll(/(?:href|src)=(?:"([^"]+)"|'([^']+)')/g)) {
      const ref = dq ?? sq;
      if (/^(?:https?:)?\/\//.test(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("#")) continue;
      if (ref.includes("'") || ref.includes(" + ")) {
        // inline JSの式断片はskipするが、既知のtemplate形状 (' + ident + ') 以外の
        // skipは検査の穴として即fail — skip判定の腐敗が静かにpassを作るのを防ぐ
        if (!/^' \+ [A-Za-z_$][\w$]* \+ '$/.test(ref)) straySkips.push(`${rel}: ${ref}`);
        continue;
      }
      const target = ref.split("#")[0].split("?")[0];
      if (!target) continue;
      const wantsDir = target.endsWith("/");
      const base = target.replace(/\/+$/, "") || ".";
      checked += 1;
      const resolved = path.posix.normalize(
        base.startsWith("/") ? base.slice(1) : path.posix.join(path.posix.dirname(rel), base)
      );
      const reachable = wantsDir
        ? trackedDirs.has(resolved)
        : trackedPaths.has(resolved) || trackedDirs.has(resolved);
      if (!reachable) broken.push(`${rel}: ${ref} → ${resolved}`);
    }
  }
  assert.deepEqual(straySkips, [], `skip判定の想定外逸脱 (${straySkips.length}件) — inline JS断片以外が静かに検査から漏れている:\n${straySkips.join("\n")}`);
  // 抽出regexの腐敗 (0件一致で無意味にpassする偽陰性) の下限ガード。実在は103本。
  assert.ok(checked >= 80, `検査対象リンクが過少 (${checked}本) — 抽出の前提が崩れた`);
  assert.deepEqual(broken, [], `リンク切れ (${broken.length}本):\n${broken.join("\n")}`);
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
