// share.js — 成果物共有ループ (X運用基本計画 v1) の純関数モジュール。
// DOM非依存 (canvas描画は app.js 側)。段階の表示は logic.js の公開用PHASESのみを使う。
import { PHASES } from "./logic.js";

export const MAX_POST_LENGTH = 280;
export const URL_WEIGHTED_LENGTH = 23; // X上のURLは t.co 展開で23字扱い
const UNICODE_TLDS = [
  "みんな", "ポイント", "ファッション", "セール", "ストア", "コム", "クラウド",
  "通販", "购物", "网站", "网址", "在线", "公司", "网络", "中国", "中國", "香港", "台湾",
  "台灣", "日本", "한국", "ไทย", "рф", "сайт", "онлайн", "москва", "ком", "рус"
].sort((a, b) => b.length - a.length);
const DOMAIN_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const DOMAIN_TLD = `(?:[A-Za-z]{2,63}|${UNICODE_TLDS.join("|")})`;
const URL_PATTERN = new RegExp(
  `(?<![A-Za-z0-9@＠$#＃_.\\/-])(?:https?:\\/\\/)?(?:${DOMAIN_LABEL}\\.)+${DOMAIN_TLD}(?::\\d{1,5})?(?:[/?#][A-Za-z0-9!$&'()*+,;=%#/?[\\]@_~:\\-\\u00c0-\\u02af\\u0400-\\u052f]*)?`,
  "giu"
);
const URL_TRAILING_PUNCTUATION = /[.,!?;:、。！？，．；：]+$/u;
const NEXT_ACTION_MAX = 40;
const NEXT_ACTION_MAX_WEIGHT = 80;

function isEmojiCodePoint(codePoint) {
  return (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf);
}

function isVariationOrModifier(codePoint) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    (codePoint >= 0x1d167 && codePoint <= 0x1d169) ||
    (codePoint >= 0x20e3 && codePoint <= 0x20e3);
}

function isWeightedOne(codePoint) {
  return codePoint <= 0x10ff ||
    (codePoint >= 0x2000 && codePoint <= 0x200d) ||
    (codePoint >= 0x2032 && codePoint <= 0x2037) ||
    (codePoint >= 0x2042 && codePoint <= 0x2047);
}

function graphemes(text) {
  const points = Array.from(String(text ?? ""), (char) => char.codePointAt(0));
  const result = [];
  for (let i = 0; i < points.length;) {
    const cluster = [points[i++]];
    if (cluster[0] >= 0x1f1e6 && cluster[0] <= 0x1f1ff &&
        points[i] >= 0x1f1e6 && points[i] <= 0x1f1ff) cluster.push(points[i++]);
    while (i < points.length && isVariationOrModifier(points[i])) cluster.push(points[i++]);
    while (points[i] === 0x200d && i + 1 < points.length) {
      cluster.push(points[i++], points[i++]);
      while (i < points.length && isVariationOrModifier(points[i])) cluster.push(points[i++]);
    }
    result.push(cluster);
  }
  return result;
}

function graphemeWeight(cluster) {
  if (cluster.some(isEmojiCodePoint) || cluster.includes(0x20e3)) return 2;
  return cluster.reduce((total, codePoint) => total + (isWeightedOne(codePoint) ? 1 : 2), 0);
}

function textWeight(text) {
  return graphemes(String(text ?? "").normalize("NFC"))
    .reduce((total, cluster) => total + graphemeWeight(cluster), 0);
}

function urlRanges(text) {
  const ranges = [];
  for (const match of String(text ?? "").matchAll(URL_PATTERN)) {
    const raw = match[0];
    let trimmed = raw.replace(URL_TRAILING_PUNCTUATION, "");
    while (trimmed.endsWith(")") &&
           (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)) {
      trimmed = trimmed.slice(0, -1);
    }
    if (trimmed) ranges.push({ start: match.index, end: match.index + trimmed.length });
  }
  return ranges;
}

// twitter-text v3: max 280, scale 100, URL=23, ASCII-like ranges=1,
// default Unicode=2, and emoji grapheme clusters=2.
export function weightedLength(text) {
  const value = String(text ?? "").normalize("NFC");
  let total = 0;
  let cursor = 0;
  for (const range of urlRanges(value)) {
    total += textWeight(value.slice(cursor, range.start)) + URL_WEIGHTED_LENGTH;
    cursor = range.end;
  }
  return total + textWeight(value.slice(cursor));
}

function truncateWeighted(text, maxWeight) {
  const value = String(text ?? "");
  if (weightedLength(value) <= maxWeight) return value;
  const ellipsis = "…";
  let output = "";
  let cursor = 0;
  for (const range of urlRanges(value)) {
    for (const cluster of graphemes(value.slice(cursor, range.start).normalize("NFC"))) {
      const next = output + String.fromCodePoint(...cluster);
      if (weightedLength(next + ellipsis) > maxWeight) return output + ellipsis;
      output = next;
    }
    const url = value.slice(range.start, range.end);
    if (weightedLength(output + url + ellipsis) > maxWeight) return output + ellipsis;
    output += url;
    cursor = range.end;
  }
  for (const cluster of graphemes(value.slice(cursor).normalize("NFC"))) {
    const next = output + String.fromCodePoint(...cluster);
    if (weightedLength(next + ellipsis) > maxWeight) break;
    output = next;
  }
  return output + ellipsis;
}

function fitBeforeUrl(prefix, url) {
  const suffix = `\n${url}`;
  const budget = Math.max(0, MAX_POST_LENGTH - weightedLength(suffix));
  return `${truncateWeighted(prefix, budget)}${suffix}`;
}

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
    return { text: fitBeforeUrl((ctx.freeText ?? "").trim(), url), template: templateId };
  }
  const label = ctx.phaseLabel || phaseLabel(ctx.phase);
  const rawNext = ctx.nextHint ?? nextHintFor(ctx.phase);
  const lines = [
    `AI活用の現在地を診断したら「${label}」でした。`,
    "あなたの現在地はどこですか?",
    url
  ];
  if (rawNext) lines.splice(1, 0, `次の一手は「${truncateWeighted(rawNext, NEXT_ACTION_MAX_WEIGHT)}」。`);
  return { text: fitBeforeUrl(lines.slice(0, -1).join("\n"), url), template: templateId };
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
  lines.push({ kind: "meta", text: `${ctx.total ?? 3}問中${ctx.yesCount ?? 0}問が該当・ ConnectiveByte` });
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
    `該当: ${ctx.total ?? 3}問中${ctx.yesCount ?? 0}問`,
    "",
    "次のアクション:"
  ];
  const actions = ctx.nextHints ?? (ctx.nextHint ? [ctx.nextHint] : []);
  for (const action of actions) lines.push(`- ${action}`);
  lines.push("", "このファイルには個人情報は含まれません。");
  return lines.join("\n");
}
