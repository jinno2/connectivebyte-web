import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getEligibleSegments,
  getInterestRoute,
  promoteBySelfSelection,
  shouldUseStrongCMessage
} from "../logic.js";

const root = new URL("../", import.meta.url);

test("E/D/C/B/Aそれぞれに固有の導線を返す", () => {
  const interests = ["E", "D", "C", "B", "A"];
  const routes = interests.map(getInterestRoute);
  assert.ok(routes.every(Boolean));
  assert.deepEqual(routes.map((route) => route.target), [
    "comparison",
    "frontier",
    "organization",
    "newsletter",
    "purpose"
  ]);
  assert.equal(new Set(routes.map((route) => route.segment)).size, 5);
  assert.equal(getInterestRoute("F"), null);
  assert.equal(getInterestRoute(null), null);
});

test("強い表現はCの自己選択時だけ許可する", () => {
  assert.equal(shouldUseStrongCMessage("C"), true);
  for (const interest of ["E", "D", "B", "A", null, undefined]) {
    assert.equal(shouldUseStrongCMessage(interest), false);
  }
});

test("昇格は有効な自己選択でのみ行う", () => {
  assert.equal(promoteBySelfSelection(null, "E"), "E");
  assert.equal(promoteBySelfSelection("E", "C"), "C");
  assert.equal(promoteBySelfSelection("C", "A"), "A");
  assert.equal(promoteBySelfSelection("C", "D"), "C");
  assert.equal(promoteBySelfSelection("C", null), "C");
  assert.equal(promoteBySelfSelection("C", "behavior_inferred"), "C");
  assert.equal(promoteBySelfSelection(null, "behavior_inferred"), null);
});

test("対象セグメントは自己選択だけから重複なく生成する", () => {
  assert.deepEqual(getEligibleSegments(["E", "C", "E", "inferred"]), ["exploring", "mobilizing"]);
  assert.deepEqual(getEligibleSegments(null), []);
});

test("イベント仕様と保存キーを静的検証する", async () => {
  const app = await readFile(new URL("app.js", root), "utf8");
  const eventNames = [
    "landing_viewed",
    "interest_selected",
    "diagnostic_started",
    "diagnostic_completed",
    "comparison_template_viewed",
    "comparison_template_downloaded",
    "comparison_template_started",
    "comparison_template_completed",
    "level_table_read_100",
    "frontier_article_read_75",
    "org_pdf_downloaded",
    "newsletter_subscribed",
    "outbound_cta_clicked"
  ];
  const attributes = [
    "source_id",
    "campaign_id",
    "asset_id",
    "segment",
    "channel",
    "cta_id",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "occurred_at"
  ];
  for (const name of eventNames) assert.match(app, new RegExp(`"${name}"`));
  for (const attribute of attributes) assert.match(app, new RegExp(`${attribute}:`));
  const keyBlock = app.match(/const STORAGE_KEYS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  assert.deepEqual([...keyBlock.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]), [
    "anonymous_id",
    "declared_interest",
    "eligible_segments",
    "consent",
    "events"
  ]);
});

test("公開画面に未承認のレベル診断とレベル表を含めない", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.doesNotMatch(html, /レベル診断|レベル表/);
  assert.doesNotMatch(html, /職業|年収|AI習熟度|外部履歴/);
});
