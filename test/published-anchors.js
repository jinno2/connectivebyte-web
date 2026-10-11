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

// plainリンク (フラグメント無しhref) の飛び先。ページは resolveFragmentTarget と
// 同正規化、資産参照 (.html 以外の拡張子) はサイトルート相対の実ファイルパスの
// まま返す。ルート絶対パス (/favicon.svg 等) はサイトルート基準で解決する。
export function resolvePlainTarget(base, href) {
  if (/^(https?:|mailto:|tel:|\/\/)/.test(href)) return null;
  const filePart = href.split(/[?#]/, 1)[0];
  if (filePart === "") return null;
  const joined = filePart.startsWith("/") ? filePart : path.posix.join(base, filePart);
  let target = path.posix.normalize(joined);
  if (target.startsWith("/")) target = target.slice(1);
  if (target.endsWith("/")) target = target.slice(0, -1);
  if (target === "." || target === "") target = "index.html";
  const ext = path.posix.extname(target);
  if (ext && ext !== ".html") return target;
  if (!target.endsWith(".html")) target += "/index.html";
  return target;
}
