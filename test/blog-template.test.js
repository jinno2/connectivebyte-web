// blog-template.test.js — 18-blog公開テンプレ (scripts/t0007-outreach/outreach.py) の構造検証。
//
// 記事は content/18-blog/<slug>/index.html としてpublishされ、本店LPと同じ
// design token (content/18-blog/article.css) を読む。テンプレが野良HTMLへ
// 戻る (inline style・本店header無し等) のを防ぐのが目的。
// python実装の検証は、nodeからpython3へテンプレート変数を渡して出力を検査する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outreachPy = path.join(repoRoot, "scripts", "t0007-outreach", "outreach.py");

test("18-blog公開テンプレは本店design (article.css・site-header・OG/canonical) を保つ", () => {
  const script = `
import importlib.util
spec = importlib.util.spec_from_file_location("outreach", ${JSON.stringify(outreachPy)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
body = m.md_to_html("# タイトル\\n\\n本文。\\n")
page = m.ARTICLE_TMPL.format(title="T", slug="slug-x", description="D", updated="2026-09-05", body=body)
print(page)
`;
  const page = execFileSync("python3", ["-c", script], { encoding: "utf8" });

  // 本店design system: 共通css読み込み・skip-link・header/footer言語
  assert.match(page, /<link rel="stylesheet" href="\.\.\/article\.css">/);
  assert.match(page, /class="skip-link"/);
  assert.match(page, /class="site-header"/);
  assert.match(page, /class="brand"[^>]*>Connective<span>Byte<\/span>/);
  assert.match(page, /class="article"/);

  // metadata完備 (品質基準9)
  assert.match(page, /<meta name="description" content="D">/);
  assert.match(page, /<meta property="og:type" content="article">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/lab\.connectivebyte\.com\/content\/18-blog\/slug-x\/">/);

  // 相対リンク (プロジェクトPagesのベースパスに依存しない) + 絶対pathリンクの混入禁止
  assert.doesNotMatch(page, /href="\/(?!favicon\.svg)/);
  assert.match(page, /href="\/\/#diagnostic|href="\.\.\/\.\.\/#diagnostic"/);

  // テンプレ変数の取り残しがないこと
  assert.doesNotMatch(page, /\{(title|slug|description|updated|body)\}/);
});
