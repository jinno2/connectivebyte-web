#!/usr/bin/env node
// 診断ラインLP(content/19-diagnosis-line-lp/)のカート設置スロットへご購入リンクを設置する。
//
// - 既定は dry-run: 該当スロットの before/after を表示するだけで file に書かない。
//   --write で初めて書き込む(このrepoは public + 即pushが配信なので・誤投入を防ぐ既定)。
// - 1 実行 = 1 スロット(--slot d1..d4)。URL は実行時引数のみ(値をrepo文書に書かない規律)。
// - 冪等: 同じ URL で再実行しても変化なし。異なる URL は更新(リンク差し替え)。
// - スロット内が「準備中」プレースホルダでも既存リンクでもない実測外の形なら
//   書き込まず停止する(推測で DOM を触らない)。
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_FILE = "content/19-diagnosis-line-lp/index.html";
const PLACEHOLDER_MARK = "ご購入リンクは準備中です";
const DEFAULT_LABEL = "ご購入はこちら(外部の決済ページへ)";

export function transformSlot(html, slot, url, label = DEFAULT_LABEL) {
  // slot: "d1".."d4"。slot id は文字通り組み立てる(任意 id を受け付けない)。
  if (!/^d[1-4]$/.test(slot)) {
    throw new Error(`slot は d1..d4 で指定してください: ${slot}`);
  }
  if (!/^https:\/\/\S+$/.test(url) || /[<>"']/.test(url)) {
    throw new Error(`url は https:// 開始・空白と引用符を含まない値のみ: ${url}`);
  }
  const divOpen = `<div class="cart-slot" id="cart-${slot}">`;
  const start = html.indexOf(divOpen);
  if (start === -1) {
    throw new Error(`スロットが見つかりません: ${divOpen}`);
  }
  const end = html.indexOf("</div>", start);
  if (end === -1) {
    throw new Error(`スロットの閉じが見つかりません: ${divOpen}`);
  }
  const innerEnd = end + "</div>".length;
  const inner = html.slice(start + divOpen.length, end);
  const isPlaceholder = inner.includes(PLACEHOLDER_MARK);
  const isLive = inner.includes("cart-link");
  if (!isPlaceholder && !isLive) {
    throw new Error(
      `スロット cart-${slot} が実測外の内容です(プレースホルダでも既存リンクでもない): ${inner}`,
    );
  }
  const newInner = `<p class="cart-live"><a class="cart-link" href="${url}" rel="noopener">${label}</a></p>`;
  if (inner === newInner) {
    return { html, changed: false, before: inner, after: inner };
  }
  return {
    html: html.slice(0, start + divOpen.length) + newInner + html.slice(end),
    changed: true,
    before: inner,
    after: newInner,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      slot: { type: "string" },
      url: { type: "string" },
      label: { type: "string" },
      file: { type: "string", default: DEFAULT_FILE },
      write: { type: "boolean", default: false },
    },
  });
  if (!values.slot || !values.url) {
    console.error("使い方: node scripts/set-cart-links.mjs --slot d2 --url https://… [--label 表示文] [--file path] [--write]");
    process.exit(1);
  }
  const html = readFileSync(values.file, "utf8");
  let result;
  try {
    result = transformSlot(html, values.slot, values.url, values.label);
  } catch (err) {
    console.error(`停止: ${err.message}`);
    process.exit(1);
  }
  console.log(`slot cart-${values.slot} (${values.file})`);
  console.log(`  before: ${result.before}`);
  if (!result.changed) {
    console.log("  変化なし(同一 URL で設定済み・冪等)");
    return;
  }
  console.log(`  after : ${result.after}`);
  if (values.write) {
    writeFileSync(values.file, result.html, "utf8");
    console.log("  書込完了(--write)");
  } else {
    console.log("  dry-run: file は未変更(--write で書込)");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
