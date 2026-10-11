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


function parseCssRules(css) {
  // @media等のネストを辿る簡易パーサ (コメント除去後、スタイル規則のみ集める)。
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1;
    let close = open;
    while (close < css.length - 1 && depth > 0) {
      close++;
      if (css[close] === "{") depth++;
      else if (css[close] === "}") depth--;
    }
    const body = css.slice(open + 1, close);
    if (prelude.startsWith("@")) {
      if (/^@(media|supports)\b/.test(prelude)) rules.push(...parseCssRules(body));
    } else if (prelude) {
      rules.push({ selectors: prelude.split(",").map((s) => s.replace(/\s+/g, " ").trim()), body });
    }
    i = close + 1;
  }
  return rules;
}

test("outline:none を付けた入力欄にはfocus-visibleの可視フォーカス規則が対で存在する", async () => {
  // L1点検 (2026-10-11): 枠なしinputにoutline:noneだけ付けると、キーボードで
  // 記入位置が分からなくなる。outline:noneを使う各セレクタについて
  // (1) 複合セレクタ全体が一致する :focus-visible 規則が存在する
  //     (最後の複合だけの部分一致では、無関係なformのinput規則で誤魔化せるため)
  // (2) その規則がoutline:none以外の可視outlineを宣言している
  // ことを機械検査する。
  const css = (await readFile(path.join(repoRoot, "styles.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = parseCssRules(css);
  const focusRules = rules.flatMap((r) =>
    r.selectors.filter((s) => s.includes(":focus-visible")).map((s) => ({ selector: s, body: r.body }))
  );
  const noneRules = rules.filter((r) => /outline:\s*none\b/.test(r.body));
  assert.ok(noneRules.length > 0, "outline:none の規則が見つからない (ガード対象が変化)");
  for (const rule of noneRules) {
    for (const selector of rule.selectors) {
      // 末尾の複合セレクタに :focus-visible を付した完全一致で探す (結合子は原形保持)
      const parts = selector.split(/([\s>+~]+)/);
      const last = parts.pop();
      const expected = [...parts, `${last}:focus-visible`].join("").replace(/\s+/g, " ").trim();
      const hit = focusRules.find((f) => f.selector === expected);
      assert.ok(hit, `outline:none の ${selector} に対応する ${expected} の可視フォーカス規則が無い`);
      const outlines = hit.body.split(";").map((d) => d.split(":"))
        .filter((p) => p.length === 2 && p[0].trim() === "outline").map((p) => p[1].trim());
      assert.ok(outlines.some((v) => v !== "none"),
        `${expected} は可視outline (none以外) を宣言していない`);
    }
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
