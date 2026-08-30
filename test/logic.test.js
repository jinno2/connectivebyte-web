import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDiagnosticCompletedEvent,
  buildEventBatch,
  DIAGNOSTIC_QUESTIONS,
  filterForbiddenAttributes,
  FORBIDDEN_ATTRIBUTES,
  getEligibleSegments,
  getInterestRoute,
  PHASES,
  promoteBySelfSelection,
  run_diagnosis,
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
    "outbound_cta_clicked",
    "manual_collaboration_candidate"
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
    "events",
    "diagnosis_result",
    "feedback_notes"
  ]);
});

test("公開画面にレベル定義を含まず一般論の案内を含む", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /AI活用の成熟度/);
  assert.match(html, /詳細な段階の定義は現在非公開/);
  assert.doesNotMatch(html, /知能接続|CIL Framework|L1[01]|フロンティア未認知|自己進化システム/);
  assert.doesNotMatch(html, /職業|年収|AI習熟度|外部履歴/);
  assert.doesNotMatch(html, /優劣|ランキング|順位|比較判定/);
});

test("診断はreadyを返しcurrent_phaseを数値で返す", () => {
  const result = run_diagnosis("C", [
    { id: "Q0", answer: true },
    { id: "Q1", answer: true },
    { id: "Q2", answer: false }
  ]);
  assert.equal(result.ready, true);
  assert.equal(typeof result.current_phase, "number");
  assert.equal(Number.isFinite(result.current_phase), true);
  assert.ok(Array.isArray(result.next_hints));
  assert.ok(result.next_hints.length > 0);
});

test("全質問trueでP4を返す", () => {
  const behaviors = DIAGNOSTIC_QUESTIONS.map((q) => ({ id: q.id, answer: true }));
  const result = run_diagnosis("A", behaviors);
  assert.equal(result.current_phase, 4);
  assert.equal(result.current_phase_label, PHASES[3].label);
  assert.ok(result.next_hints.length > 0);
});

test("全質問falseでP1を返す", () => {
  const behaviors = DIAGNOSTIC_QUESTIONS.map((q) => ({ id: q.id, answer: false }));
  const result = run_diagnosis(null, behaviors);
  assert.equal(result.current_phase, 1);
  assert.equal(result.current_phase_label, PHASES[0].label);
  assert.ok(result.next_hints.length > 0);
});

test("はい・トライ中は該当と数え、わからないは非該当と数える", () => {
  const trying = DIAGNOSTIC_QUESTIONS.map((q) => ({
    id: q.id,
    answer: ["Q0", "Q1", "Q2", "Q3"].includes(q.id) ? "トライ中（取り組み中）" : "いいえ"
  }));
  assert.equal(run_diagnosis("D", trying).current_phase, 2);
  const uncertain = DIAGNOSTIC_QUESTIONS.map((q) => ({
    id: q.id,
    answer: ["Q0", "Q1", "Q2", "Q3"].includes(q.id) ? "わからない" : "いいえ"
  }));
  const result = run_diagnosis("D", uncertain);
  assert.equal(result.current_phase, 1);
  assert.equal(result.yes_count, 0);
  assert.equal(result.answered, 12);
});

test("Q2までtrueでP1を返しnext_hintsはP1のもの", () => {
  const behaviors = DIAGNOSTIC_QUESTIONS.map((q) => ({ id: q.id, answer: ["Q0", "Q1", "Q2"].includes(q.id) }));
  const result = run_diagnosis("E", behaviors);
  assert.equal(result.current_phase, 1);
  assert.equal(result.current_phase_label, PHASES[0].label);
  assert.deepEqual(result.next_hints, [...PHASES[0].next_hints]);
});

test("診断結果に優劣比較を含まない", () => {
  const behaviors = DIAGNOSTIC_QUESTIONS.map((q) => ({ id: q.id, answer: true }));
  const result = run_diagnosis("C", behaviors);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /優劣|上位|下位|ランキング|順位|勝者|敗者|優れる|劣る/);
});

test("診断結果に禁止属性を含まない", () => {
  const behaviors = DIAGNOSTIC_QUESTIONS.map((q) => ({ id: q.id, answer: true }));
  const result = run_diagnosis("C", behaviors);
  const serialized = JSON.stringify(result);
  for (const forbidden of FORBIDDEN_ATTRIBUTES) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }
});

test("診断は質問リストを公開し12問の行動チェックリストを返す", () => {
  assert.ok(Array.isArray(DIAGNOSTIC_QUESTIONS));
  assert.equal(DIAGNOSTIC_QUESTIONS.length, 12);
  assert.deepEqual(DIAGNOSTIC_QUESTIONS.map((q) => q.id), ["Q0","Q1","Q2","Q3","Q4","Q5","Q6","Q7","Q8","Q9","Q10","Q11"]);
  assert.deepEqual(DIAGNOSTIC_QUESTIONS.map((q) => q.phase), [1,1,1,2,2,2,3,3,3,4,4,4]);
  const result = run_diagnosis(null, []);
  assert.equal(result.questions, DIAGNOSTIC_QUESTIONS);
  assert.equal(result.answered, 0);
  assert.equal(result.yes_count, 0);
});

test("診断完了イベントがdiagnostic_completedとして発火される", () => {
  const event = buildDiagnosticCompletedEvent("D", [
    { id: "Q0", answer: true },
    { id: "Q1", answer: false }
  ]);
  assert.equal(event.name, "diagnostic_completed");
  assert.equal(event.asset_id, "diagnostic_flow");
  assert.equal(event.cta_id, "diagnostic_submit");
  assert.equal(event.diagnostic_answered, 2);
  assert.equal(event.diagnostic_yes, 1);
  assert.equal(event.diagnostic_ready, true);
});

test("禁止属性を含むイベントから当該属性をフィルタする", () => {
  const event = {
    name: "interest_selected",
    source_id: "direct",
    occupation: "engineer",
    annual_income: 5000000,
    ai_proficiency: "high",
    external_history: "something"
  };
  const cleaned = filterForbiddenAttributes(event);
  assert.equal(cleaned.occupation, undefined);
  assert.equal(cleaned.annual_income, undefined);
  assert.equal(cleaned.ai_proficiency, undefined);
  assert.equal(cleaned.external_history, undefined);
  assert.equal(cleaned.name, "interest_selected");
  assert.equal(cleaned.source_id, "direct");
  assert.equal(filterForbiddenAttributes(null), null);
  assert.equal(filterForbiddenAttributes([]), null);
});

test("イベント送信バッチは禁止属性を除去し不正型を除外する", () => {
  const events = [
    { name: "landing_viewed", source_id: "direct", occupation: "engineer" },
    { name: "not_a_real_event_type", source_id: "direct" },
    { name: "interest_selected", source_id: "direct" },
    null,
    "bad"
  ];
  const batch = buildEventBatch(events);
  assert.equal(batch.length, 2);
  assert.deepEqual(batch.map((event) => event.name), ["landing_viewed", "interest_selected"]);
  for (const event of batch) {
    for (const forbidden of FORBIDDEN_ATTRIBUTES) {
      assert.equal(event[forbidden], undefined);
    }
  }
  assert.deepEqual(buildEventBatch(null), []);
  assert.deepEqual(buildEventBatch([]), []);
});
