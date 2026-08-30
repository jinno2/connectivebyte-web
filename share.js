// share.js — 成果物共有ループ (X運用基本計画 v1) の純関数モジュール。
// DOM非依存 (canvas描画は app.js 側)。段階の表示は logic.js の公開用PHASESのみを使う。
import { PHASES } from "./logic.js";

export const MAX_POST_LENGTH = 280;
export const URL_WEIGHTED_LENGTH = 23; // X上のURLは t.co 展開で23字扱い
const FREE_TEXT_MAX = MAX_POST_LENGTH - URL_WEIGHTED_LENGTH - 1; // 改行1字分
const NEXT_ACTION_MAX = 40;

// 共有可能URL: ?r=P{n} + UTM (campaign解析は既存の utm_* 読み取りに乗る)
export function shareUrlFor(baseUrl, phase) {
  const url = new URL(baseUrl);
  url.searchParams.set("r", `P${phase}`);
  url.searchParams.set("utm_source", "shared");
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", "diag_v1");
  return url.toString();
}

// ?r= の検証付きparse。不正なら phase: null (成果ページを表示しない)
export function parseShareParams(search) {
  const params = new URLSearchParams(search);
  const raw = params.get("r");
  if (!raw) return { phase: null };
  const match = /^P([1-4])$/.exec(raw);
  if (!match) return { phase: null };
  const phase = Number(match[1]);
  return PHASES[phase - 1] ? { phase } : { phase: null };
}

export function phaseLabel(phase) {
  return PHASES[phase - 1]?.label ?? "";
}

export function nextHintFor(phase) {
  const hints = PHASES[phase - 1]?.next_hints;
  return hints && hints.length > 0 ? hints[0] : "";
}

export function truncateJa(text, max) {
  const chars = Array.from(String(text ?? ""));
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max).join("")}…`;
}

// 投稿テンプレート (計画§9)。診断の共有は「成果」と「自由入力」の2種。
// 検証/良かった点・改善点の2種は製品タスク成果向けで v2 以降。
export const SHARE_TEMPLATES = Object.freeze(["result", "free"]);

export function buildShareText(templateId, ctx) {
  const url = ctx.url;
  if (!SHARE_TEMPLATES.includes(templateId)) return null;
  if (templateId === "free") {
    // 切詰め時に「…」が1字加算されるため上限から1字引いておく
    const free = truncateJa((ctx.freeText ?? "").trim(), FREE_TEXT_MAX - 1);
    return { text: `${free}\n${url}`, template: templateId };
  }
  const label = ctx.phaseLabel || phaseLabel(ctx.phase);
  const rawNext = ctx.nextHint ?? nextHintFor(ctx.phase);
  const lines = [
    `AI活用の現在地を診断したら「${label}」でした。`,
    "あなたの現在地はどこですか?",
    url
  ];
  if (rawNext) lines.splice(1, 0, `次の一手は「${truncateJa(rawNext, NEXT_ACTION_MAX)}」。`);
  return { text: lines.join("\n"), template: templateId };
}

// X Web Intent — ユーザー自身が確認して投稿する形式 (API不要・計画§10)
export function buildIntentUrl(text) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

// 成果カードの行構成 (計画§12)。個人情報は構成上含まない (入力欄がないため)。
export function cardLines(ctx) {
  const label = ctx.phaseLabel || phaseLabel(ctx.phase);
  const rawNext = ctx.nextHint ?? nextHintFor(ctx.phase);
  const lines = [
    { kind: "title", text: "AI活用 現在地の診断" },
    { kind: "level", text: label }
  ];
  if (rawNext) lines.push({ kind: "next", text: `次の一手:${truncateJa(rawNext, NEXT_ACTION_MAX)}` });
  lines.push({ kind: "meta", text: `12問中${ctx.yesCount ?? 0}問が該当・ ConnectiveByte` });
  return lines;
}

// §7 フィードバックの3択 (肯定・否定で差を付けない。回答者全員が対象)
export const FEEDBACK_OPTIONS = Object.freeze([
  Object.freeze({ id: "achieved", label: "達成できた" }),
  Object.freeze({ id: "partial", label: "一部達成できた" }),
  Object.freeze({ id: "not_achieved", label: "達成できなかった" })
]);

export function feedbackLabel(id) {
  const option = FEEDBACK_OPTIONS.find((entry) => entry.id === id);
  return option ? option.label : "";
}

// 「成果を保存」のテキスト成果物 (§7 達成branch)。日時は呼び出し側から渡す。
export function resultText(ctx, isoDate) {
  const label = ctx.phaseLabel || phaseLabel(ctx.phase);
  const lines = [
    "ConnectiveByte AI活用 現在地の診断結果",
    `診断日時: ${isoDate}`,
    `現在地: ${label}`,
    `該当: 12問中${ctx.yesCount ?? 0}問`,
    "",
    "次のアクション:"
  ];
  const actions = ctx.nextHints ?? (ctx.nextHint ? [ctx.nextHint] : []);
  for (const action of actions) lines.push(`- ${action}`);
  lines.push("", "このファイルには個人情報は含まれません。");
  return lines.join("\n");
}
