// blog-anchors.test.js — 記事内アンカー到達ガード。
// 目次・skip-link等のページ内リンク (href="#x") が同一ページの実在する
// id に飛ぶことを機械検査する。quetab記事で目次がid未付与のsectionを
// 指しクリックしても移動しない欠損が実測されたため、全公開記事を走査する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blogRoot = path.join(repoRoot, "content", "18-blog");

test("公開記事のページ内アンカー (href=\"#x\") は同一ページの実在idに到達する", async () => {
  const slugs = (await readdir(blogRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(slugs.length > 0, "18-blog配下に記事が無い");

  for (const slug of slugs) {
    const html = await readFile(path.join(blogRoot, slug, "index.html"), "utf8");
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      const target = m[1];
      assert.ok(ids.has(target), `${slug}: href="#${target}" の飛び先idが存在しない`);
    }
  }
});
