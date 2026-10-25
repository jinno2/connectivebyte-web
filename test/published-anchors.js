// 公開アンカー検査の共通処理。resolveFragmentTarget は外部スキーム (https:/mailto://)
// を null で除外し、クエリ文字列を除いたうえでディレクトリURLを index.html へ正規化する。
import path from "node:path";

export function idSet(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

// href はフラグメント (#...) を除いた飛び先。実在しない配信対象は null。
export function resolveFragmentTarget(base, href) {
  if (/^(https?:|mailto:|\/\/)/.test(href)) return null;
  const filePart = href.split("?", 1)[0];
  let target = path.posix.normalize(path.posix.join(base, filePart));
  if (target.endsWith("/")) target = target.slice(0, -1);
  if (target === "." || target === "") target = "index.html";
  else if (!target.endsWith(".html")) target += "/index.html";
  return target;
}

// フラグメント無しページ間リンク (href="path") の検査候補を [href, 飛び先] で返す。
// script/style内の実行時生成href、フラグメント付き、アセット拡張子、外部スキームは除外する。
export function pageLinkCandidates(doc, base) {
  const body = doc
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const found = [];
  for (const m of body.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (href.includes("#")) continue; // フラグメント付きはアンカーテストが検査する
    if (/\.(css|js|png|svg|xml|txt|pdf|webmanifest|ico)$/i.test(href.split("?")[0])) continue;
    const target = resolveFragmentTarget(base, href);
    if (target === null) continue; // 外部スキーム
    found.push([href, target]);
  }
  return found;
}
