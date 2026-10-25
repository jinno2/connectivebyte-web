import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { transformSlot } from "../scripts/set-cart-links.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LP = path.join(repoRoot, "content/19-diagnosis-line-lp/index.html");
const SETTER = path.join(repoRoot, "scripts/set-cart-links.mjs");

const PLACEHOLDER = (slot) =>
  `    <!-- カート設置スロット: infocart の商品登録完了後にご購入リンクを設置します -->\n` +
  `    <div class="cart-slot" id="cart-${slot}"><p>ご購入リンクは準備中です(商品登録完了後に設置します)</p></div>\n`;
const URL = "https://cart.example/item/81669";

function fixture() {
  return ["d1", "d2", "d3", "d4"].map(PLACEHOLDER).join("");
}

test("transformSlot: プレースホルダを購入リンクへ置換し他スロットは不変", () => {
  const out = transformSlot(fixture(), "d2", URL);
  assert.equal(out.changed, true);
  assert.match(out.html, new RegExp(`<div class="cart-slot" id="cart-d2"><p class="cart-live"><a class="cart-link" href="${URL}" rel="noopener">`));
  assert.ok(!out.html.includes(`id="cart-d2"><p>ご購入リンクは準備中です`), "d2 のプレースホルダが残っている");
  // 他スロットは原文まま
  for (const slot of ["d1", "d3", "d4"]) {
    assert.ok(out.html.includes(`id="cart-${slot}"><p>ご購入リンクは準備中です`), `cart-${slot} が変わっている`);
  }
});

test("transformSlot: 同一 URL の再実行は冪等(変化なし)", () => {
  const once = transformSlot(fixture(), "d2", URL);
  const twice = transformSlot(once.html, "d2", URL);
  assert.equal(twice.changed, false);
  assert.equal(twice.html, once.html);
});

test("transformSlot: 異なる URL はリンクを差し替え", () => {
  const once = transformSlot(fixture(), "d2", URL);
  const updated = transformSlot(once.html, "d2", "https://cart.example/item/99999");
  assert.equal(updated.changed, true);
  assert.ok(updated.html.includes("item/99999"));
  assert.ok(!updated.html.includes(URL));
});

test("transformSlot: slot id・URL の検証は書込前に拒否", () => {
  assert.throws(() => transformSlot(fixture(), "d9", URL), /d1\.\.d4/);
  assert.throws(() => transformSlot(fixture(), 'd2" onload="x', URL), /d1\.\.d4/);
  assert.throws(() => transformSlot(fixture(), "d2", "http://insecure.example/"), /https:\/\/ 開始/);
  assert.throws(() => transformSlot(fixture(), "d2", 'https://x/" onmouseover="alert(1)'), /引用符/);
});

test("transformSlot: 実測外のスロット内容は停止(推測で触らない)", () => {
  const alien = `    <div class="cart-slot" id="cart-d2"><p>何か別のもの</p></div>\n`;
  assert.throws(() => transformSlot(alien, "d2", URL), /実測外/);
});

test("live LP: 4 スロットが存在し・設置済みスロットにプレースホルダ残置はない(半適用検出)", async () => {
  const html = await readFile(LP, "utf8");
  for (const slot of ["d1", "d2", "d3", "d4"]) {
    const start = html.indexOf(`<div class="cart-slot" id="cart-${slot}">`);
    assert.ok(start !== -1, `cart-${slot} スロットがない`);
    const inner = html.slice(start, html.indexOf("</div>", start));
    if (inner.includes("cart-link")) {
      assert.ok(!inner.includes("準備中"), `cart-${slot} はリンク設置済みなのにプレースホルダが残存(半適用)`);
    }
  }
  // 設置済み状態の様式(.cart-slot a.cart-link)は先行追加済み = 設置はリンク投入のみで完結する
  assert.ok(html.includes(".cart-slot a.cart-link{"), "cart-link の CSS がない");
});

test("CLI: 既定 dry-run は file 不変・--write で書込", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cart-slot-"));
  const target = path.join(dir, "index.html");
  await copyFile(LP, target);
  const before = await readFile(target, "utf8");
  const common = ["--file", target, "--slot", "d3", "--url", URL];
  const dry = execFileSync("node", [SETTER, ...common], { encoding: "utf8" });
  assert.match(dry, /dry-run/);
  assert.equal(await readFile(target, "utf8"), before, "dry-run で file が変わっている");
  const wet = execFileSync("node", [SETTER, ...common, "--write"], { encoding: "utf8" });
  assert.match(wet, /書込完了/);
  const after = await readFile(target, "utf8");
  assert.ok(after.includes(`id="cart-d3"><p class="cart-live">`));
  assert.ok(after.includes(`id="cart-d2"><p>ご購入リンクは準備中です`), "d2 に影響している");
  await rm(dir, { recursive: true, force: true });
});
