import {
  buildDiagnosticCompletedEvent,
  buildEventBatch,
  DETAILED_QUESTIONS,
  DIAGNOSTIC_QUESTIONS,
  getEligibleSegments,
  getInterestRoute,
  promoteBySelfSelection,
  run_diagnosis,
  shouldUseStrongCMessage
} from "./logic.js";
import * as share from "./share.js";

const STORAGE_KEYS = Object.freeze([
  "anonymous_id",
  "declared_interest",
  "eligible_segments",
  "consent",
  "events",
  "diagnosis_result",
  "feedback_notes",
  "newsletter_registered"
]);

const EVENT_NAMES = new Set([
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
  "manual_collaboration_candidate",
  "shared_result_viewed",
  "shared_result_trial_started",
  "share_template_selected",
  "share_draft_generated",
  "x_intent_opened",
  "result_card_created",
  "feedback_submitted"
]);

const campaign = (() => {
  const params = new URLSearchParams(window.location.search);
  return Object.freeze({
    source_id: params.get("source_id") ?? "direct",
    campaign_id: params.get("campaign_id") ?? "organic",
    asset_id: params.get("asset_id") ?? "landing_page",
    channel: params.get("channel") ?? "web",
    utm_source: params.get("utm_source") ?? "",
    utm_medium: params.get("utm_medium") ?? "",
    utm_campaign: params.get("utm_campaign") ?? "",
    utm_term: params.get("utm_term") ?? "",
    utm_content: params.get("utm_content") ?? ""
  });
})();

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function writeJson(key, value) {
  if (!STORAGE_KEYS.includes(key)) throw new Error("Unsupported storage key");
  localStorage.setItem(key, JSON.stringify(value));
}

function getConsent() {
  const value = readJson("consent", null);
  return value && typeof value.analytics === "boolean" && typeof value.email === "boolean"
    ? value
    : { analytics: false, email: false, decided: false };
}

function anonymousId() {
  const existing = readJson("anonymous_id", "");
  if (typeof existing === "string" && existing) return existing;
  const generated = crypto.randomUUID();
  writeJson("anonymous_id", generated);
  return generated;
}

function currentSegment() {
  return getInterestRoute(readJson("declared_interest", null))?.segment ?? "unselected";
}

function track(name, details = {}) {
  if (!EVENT_NAMES.has(name) || !getConsent().analytics) return;
  const event = {
    name,
    anonymous_id: anonymousId(),
    source_id: campaign.source_id,
    campaign_id: campaign.campaign_id,
    asset_id: details.asset_id ?? campaign.asset_id,
    segment: currentSegment(),
    channel: campaign.channel,
    cta_id: details.cta_id ?? "none",
    utm_source: campaign.utm_source,
    utm_medium: campaign.utm_medium,
    utm_campaign: campaign.utm_campaign,
    utm_term: campaign.utm_term,
    utm_content: campaign.utm_content,
    occurred_at: new Date().toISOString()
  };
  const events = readJson("events", []);
  writeJson("events", [...(Array.isArray(events) ? events : []), event].slice(-100));
  scheduleFlush();
}

// 本番 (lab.connectivebyte.com, GH Pages) は静的のため /api/events が無い →
// 計測backend Worker (api.connectivebyte.com/events・saas-infra terraform管理) へ。
// それ以外 (localhost・server.js) は従来どおり同一originの相対PATH。
const EVENTS_ENDPOINT = typeof location !== "undefined" && location.hostname === "lab.connectivebyte.com"
  ? "https://api.connectivebyte.com/events"
  : "/api/events";

// ニュースレター登録 (メールアドレス=PII) の送信先。/events と同じbackend Worker
// の別endpoint (saas-infra管理。subscribers表へ保存・匿名eventsとは分離)。
const SUBSCRIBE_ENDPOINT = typeof location !== "undefined" && location.hostname === "lab.connectivebyte.com"
  ? "https://api.connectivebyte.com/subscribe"
  : "/api/subscribe";
let flushInFlight = false;
let flushScheduled = false;

export function send_events(events) {
  const batch = buildEventBatch(events);
  if (batch.length === 0) return Promise.resolve({ accepted: 0, skipped: true });
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.resolve({ accepted: 0, offline: true });
  }
  return fetch(EVENTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true
  }).then(async (response) => {
    if (response.status >= 200 && response.status < 300) {
      return { accepted: batch.length, status: response.status };
    }
    const error = new Error(`events_rejected_${response.status}`);
    error.status = response.status;
    throw error;
  });
}

function scheduleFlush() {
  if (flushScheduled || flushInFlight) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    flushEvents().catch(() => {});
  });
}

async function flushEvents() {
  if (flushInFlight) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const events = readJson("events", []);
  if (!Array.isArray(events) || events.length === 0) return;
  flushInFlight = true;
  try {
    const result = await send_events(events);
    if (result && typeof result.accepted === "number" && result.accepted > 0) {
      const remaining = readJson("events", []);
      const next = Array.isArray(remaining) ? remaining.slice(result.accepted) : [];
      writeJson("events", next);
    }
  } catch {
  } finally {
    flushInFlight = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { flushEvents().catch(() => {}); });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) flushEvents().catch(() => {});
  });
}

function renderRoute(interest, focus = true) {
  const route = getInterestRoute(interest);
  if (!route) return;
  document.querySelectorAll("[data-interest]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.interest === interest));
  });
  const result = document.querySelector("#route-result");
  result.hidden = false;
  result.classList.toggle("is-strong", shouldUseStrongCMessage(interest));
  document.querySelector("#result-eyebrow").textContent = route.eyebrow;
  document.querySelector("#result-title").textContent = route.title;
  document.querySelector("#result-body").textContent = route.body;
  const link = document.querySelector("#result-link");
  link.textContent = route.cta;
  link.href = `#${route.target}`;
  link.dataset.ctaId = `route_${interest.toLowerCase()}`;
  link.dataset.track = "outbound_cta_clicked";
  if (focus) result.focus({ preventScroll: true });
  showDiagnosticStep(interest);
}

// 詳細版 (12問) はメルアド登録者のみ。登録成否で切り替わるため、renders毎に
// 現在のmodeとlistのmodeが一致するか見て、変わっていたら全組み替え (checkedも
// クリア — Q*とD*でid体系が異なるため持ち越しは起きない)。
function isDetailedUnlocked() {
  const registered = readJson("newsletter_registered", null);
  return Boolean(registered && typeof registered === "object" && registered.email_registered === true);
}

function activeQuestions() {
  return isDetailedUnlocked() ? DETAILED_QUESTIONS : DIAGNOSTIC_QUESTIONS;
}

function questionSetHeading() {
  return isDetailedUnlocked()
    ? "診断ステップ：詳細版（12問）— 最近の行動について、それぞれ一番近い答えを選んでください"
    : "診断ステップ：最近の行動について、それぞれ一番近い答えを選んでください";
}

function renderDiagnosticQuestions() {
  const list = document.querySelector("#diagnostic-questions");
  if (!list) return;
  const variant = isDetailedUnlocked() ? "detailed" : "basic";
  if (list.childElementCount > 0 && list.dataset.variant === variant) return;
  list.dataset.variant = variant;
  list.innerHTML = "";
  const options = [
    { value: "はい", text: "はい" },
    { value: "トライ中（取り組み中）", text: "トライ中" },
    { value: "いいえ", text: "いいえ／わからない" }
  ];
  activeQuestions().forEach((question) => {
    const item = document.createElement("li");
    item.className = "diagnostic-question";
    const text = document.createElement("p");
    text.className = "question-text";
    text.textContent = question.label;
    item.append(text);
    const group = document.createElement("div");
    group.className = "question-options";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", question.label);
    options.forEach((option) => {
      const label = document.createElement("label");
      label.className = "check";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = question.id;
      radio.value = option.value;
      radio.dataset.questionId = question.id;
      label.append(radio, document.createTextNode(` ${option.text}`));
      group.append(label);
    });
    item.append(group);
    list.append(item);
  });
}

// 登録完了直後の切り替え — 診断stepが表示済みのときだけ効かせる (未表示なら
// 次に表示されるタイミングで詳細版になる)。
function refreshDiagnosticQuestions() {
  const step = document.querySelector("#diagnostic-step");
  if (!step || step.hidden) return;
  const heading = document.querySelector("#diagnostic-step-title");
  if (heading) heading.textContent = questionSetHeading();
  renderDiagnosticQuestions();
}

function showDiagnosticStep(interest) {
  const step = document.querySelector("#diagnostic-step");
  if (!step) return;
  step.hidden = false;
  renderDiagnosticQuestions();
  const heading = document.querySelector("#diagnostic-step-title");
  if (heading && interest) heading.textContent = questionSetHeading();
}

function submitDiagnosis() {
  const declared = readJson("declared_interest", null);
  const questions = activeQuestions();
  const checked = document.querySelectorAll("#diagnostic-questions input[type=radio]:checked");
  const behaviors = Array.from(checked).map((radio) => ({
    id: radio.dataset.questionId,
    answer: radio.value
  }));
  const result = run_diagnosis(declared, behaviors, questions);
  const completed = buildDiagnosticCompletedEvent(declared, behaviors, questions);
  track("diagnostic_completed", { asset_id: completed.asset_id, cta_id: completed.cta_id });
  const output = document.querySelector("#diagnostic-output");
  if (output) {
    output.hidden = false;
    const levelEl = document.querySelector("#diagnostic-level");
    if (levelEl) levelEl.textContent = result.current_phase_label;
    const actionsEl = document.querySelector("#diagnostic-actions");
    if (actionsEl) actionsEl.innerHTML = "";
    if (actionsEl) result.next_hints.forEach((action) => {
      const li = document.createElement("li");
      li.textContent = action;
      actionsEl.append(li);
    });
  }
  const link = document.querySelector("#diagnostic-comparison-link");
  if (link) link.hidden = false;
  writeJson("diagnosis_result", { current_phase: result.current_phase, phase_label: result.current_phase_label, next_hints: [...result.next_hints] });
  renderDashboard();
  renderFeedbackBlock();
  renderShareBlock({
    phase: result.current_phase,
    phaseLabel: result.current_phase_label,
    nextHint: result.next_hints[0] ?? "",
    nextHints: [...result.next_hints],
    yesCount: result.yes_count,
    total: questions.length
  });
}

// --- share loop (X運用基本計画 v1) -------------------------------------------------

let shareState = null;

// §7 フィードバック: 成果表示直後に1問。branchは追加UIの出し分けのみ (共有・カードは常時利用可)
function renderFeedbackBlock() {
  const block = document.querySelector("#feedback-block");
  if (!block) return;
  document.querySelector("#feedback-branch").hidden = true;
  document.querySelector("#feedback-branch").innerHTML = "";
  block.hidden = false;
}

function submitFeedback() {
  const checked = document.querySelector("input[name=feedback-answer]:checked");
  const branch = document.querySelector("#feedback-branch");
  if (!checked || !branch) return;
  track("feedback_submitted", { asset_id: "feedback_block", cta_id: `answer_${checked.value}` });
  branch.innerHTML = "";
  if (checked.value === "achieved") {
    const save = document.createElement("button");
    save.className = "button button-secondary";
    save.type = "button";
    save.dataset.action = "save-result";
    save.textContent = "結果をテキストで保存する";
    const note = document.createElement("p");
    note.className = "privacy-note";
    note.textContent = "保存したファイルに個人情報は含まれません。";
    branch.append(save, note);
  } else {
    const label = document.createElement("label");
    label.htmlFor = "feedback-note";
    label.textContent = checked.value === "partial" ? "修正が必要だった箇所・改善要望(任意)" : "改善要望・エラー報告(任意)";
    const area = document.createElement("textarea");
    area.id = "feedback-note";
    area.rows = 3;
    area.placeholder = "個人情報は書かないでください";
    const save = document.createElement("button");
    save.className = "plain-button";
    save.type = "button";
    save.dataset.action = "save-feedback-note";
    save.textContent = "端末に保存する";
    const status = document.createElement("p");
    status.className = "privacy-note";
    status.dataset.role = "feedback-status";
    status.textContent = "回答はこの端末にのみ保存されます。";
    branch.append(label, area, save, status);
  }
  branch.hidden = false;
}

function saveFeedbackNote() {
  const area = document.querySelector("#feedback-note");
  const answer = document.querySelector("input[name=feedback-answer]:checked")?.value ?? "";
  const status = document.querySelector("[data-role=feedback-status]");
  const text = (area?.value ?? "").trim();
  if (!text) {
    if (status) status.textContent = "未入力のため保存しませんでした。";
    return;
  }
  const notes = readJson("feedback_notes", []);
  notes.push({ answer, text, ts: new Date().toISOString() });
  writeJson("feedback_notes", notes.slice(-50));
  area.value = "";
  if (status) status.textContent = "この端末に保存しました。個人情報は送信していません。";
}

function saveResultText() {
  if (!shareState) return;
  const text = share.resultText(shareState, new Date().toISOString());
  download("connectivebyte-result.txt", "text/plain;charset=utf-8", text);
}

function shareBaseUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function currentShareTemplate() {
  const checked = document.querySelector("input[name=share-template]:checked");
  return checked ? checked.value : "result";
}

function regenerateShareDraft(options = {}) {
  if (!shareState) return;
  shareState.template = currentShareTemplate();
  const draft = share.buildShareText(shareState.template, {
    phase: shareState.phase,
    phaseLabel: shareState.phaseLabel,
    nextHint: shareState.nextHint,
    freeText: document.querySelector("#share-free-text").value,
    url: shareState.url
  });
  document.querySelector("#share-preview").value = draft ? draft.text : "";
  if (options.announce) track("share_draft_generated", { asset_id: "share_block", cta_id: `template_${shareState.template}` });
}

function renderShareBlock(result) {
  const block = document.querySelector("#share-block");
  if (!block) return;
  shareState = {
    ...result,
    url: share.shareUrlFor(shareBaseUrl(), result.phase),
    template: "result"
  };
  document.querySelector("#share-url-input").value = shareState.url;
  regenerateShareDraft({ announce: true });
  renderResultCard();
  block.hidden = false;
}

function renderResultCard() {
  if (!shareState) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#f4f1e9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#c8ff52";
  ctx.fillRect(0, 0, canvas.width, 12);
  ctx.textBaseline = "top";
  const styles = {
    title: { font: "600 44px sans-serif", color: "#566273", y: 90 },
    level: { font: "700 96px sans-serif", color: "#101c2c", y: 170 },
    next: { font: "500 44px sans-serif", color: "#101c2c", y: 340 },
    meta: { font: "400 34px sans-serif", color: "#566273", y: 470 }
  };
  for (const line of share.cardLines(shareState)) {
    const spec = styles[line.kind];
    if (!spec) continue;
    ctx.font = spec.font;
    ctx.fillStyle = spec.color;
    ctx.fillText(line.text, 80, spec.y);
  }
  ctx.fillStyle = "#43d9d0";
  ctx.fillRect(80, 560, 120, 8);
  const img = document.querySelector("#share-card-img");
  img.src = canvas.toDataURL("image/png");
  img.hidden = false;
  shareState.cardCanvas = canvas;
}

// 今回のpageviewで共有結果 (?r=P{n}) を表示したか。初回visitorは同意前に
// initializeSharedResult が走るため track() が同意前dropする — 同意時に
// shared_result_viewed を補発するための状態 (成長loopの核心指標)。
let sharedResultPhaseThisView = null;

function initializeSharedResult() {
  const { phase } = share.parseShareParams(window.location.search);
  if (phase === null) return;
  const section = document.querySelector("#shared-result");
  if (!section) return;
  document.querySelector("#shared-level").textContent = share.phaseLabel(phase);
  const next = share.nextHintFor(phase);
  const nextEl = document.querySelector("#shared-next");
  if (next) nextEl.textContent = `次の一手:${share.truncateJa(next, 60)}`;
  else nextEl.hidden = true;
  section.hidden = false;
  sharedResultPhaseThisView = phase;
  track("shared_result_viewed", { asset_id: "shared_result", cta_id: `r_P${phase}` });
}

function trialSameCondition() {
  const section = document.querySelector("#shared-result");
  if (section) section.hidden = true;
  window.history.replaceState(null, "", window.location.pathname);
  document.querySelector("#diagnostic").scrollIntoView({ behavior: "smooth" });
  track("shared_result_trial_started", { asset_id: "shared_result", cta_id: "trial_same_condition" });
}

function renderDashboard() {
  const panel = document.querySelector("#dashboard");
  if (!panel) return;
  const declared = readJson("declared_interest", null);
  const route = getInterestRoute(declared);
  const segments = readJson("eligible_segments", []);
  const events = readJson("events", []);
  const eventList = Array.isArray(events) ? events : [];
  const segmentEl = document.querySelector("#dash-segment");
  if (segmentEl) segmentEl.textContent = route ? route.segment : "未選択";
  const interestEl = document.querySelector("#dash-interest");
  if (interestEl) interestEl.textContent = declared ?? "未選択";
  const eligibleEl = document.querySelector("#dash-eligible");
  if (eligibleEl) eligibleEl.textContent = Array.isArray(segments) && segments.length > 0 ? segments.join("、") : "なし";
  const names = new Set(eventList.map((event) => event?.name).filter(Boolean));
  const diagEl = document.querySelector("#dash-diagnostic");
  if (diagEl) diagEl.textContent = names.has("diagnostic_completed") ? "完了" : names.has("diagnostic_started") ? "開始済み" : "未実施";
  const compEl = document.querySelector("#dash-comparison");
  if (compEl) {
    const state = names.has("comparison_template_completed")
      ? "完了"
      : names.has("comparison_template_started")
        ? "作成中"
        : names.has("comparison_template_viewed")
          ? "閲覧済み"
          : "未利用";
    compEl.textContent = state;
  }
  const materialsEl = document.querySelector("#dash-materials");
  if (materialsEl) {
    const materials = [];
    if (names.has("frontier_article_read_75")) materials.push("フロンティア記事");
    if (names.has("org_pdf_downloaded")) materials.push("組織向けガイド");
    if (names.has("comparison_template_downloaded")) materials.push("比較テンプレート");
    materialsEl.textContent = materials.length > 0 ? materials.join("、") : "なし";
  }
  const eventCountEl = document.querySelector("#dash-event-count");
  if (eventCountEl) eventCountEl.textContent = String(eventList.length);
  const levelResultEl = document.querySelector("#dash-level-result");
  if (levelResultEl) {
    const stored = readJson("diagnosis_result", null);
    if (stored && typeof stored.current_phase === "number") {
      levelResultEl.hidden = false;
      const levelEl = document.querySelector("#dash-level");
      if (levelEl) levelEl.textContent = stored.phase_label ?? "";
      const actionsEl = document.querySelector("#dash-level-actions");
      if (actionsEl) {
        actionsEl.innerHTML = "";
        (Array.isArray(stored.next_hints) ? stored.next_hints : []).forEach((action) => {
          const li = document.createElement("li");
          li.textContent = action;
          actionsEl.append(li);
        });
      }
    } else {
      levelResultEl.hidden = true;
    }
  }
}

let diagnosticStarted = false;

function selectInterest(interest) {
  if (!diagnosticStarted) {
    diagnosticStarted = true;
    track("diagnostic_started", { asset_id: "interest_selector", cta_id: "interest_direct" });
  }
  const previous = readJson("declared_interest", null);
  const promoted = promoteBySelfSelection(previous, interest);
  writeJson("declared_interest", promoted);
  const segments = readJson("eligible_segments", []);
  const selectedSegment = getEligibleSegments([interest])[0];
  const eligibleSegments = Array.isArray(segments) ? segments.filter((value) => typeof value === "string") : [];
  writeJson("eligible_segments", [...new Set([...eligibleSegments, selectedSegment])]);
  renderRoute(interest);
  track("interest_selected", { asset_id: "interest_selector", cta_id: `interest_${interest.toLowerCase()}` });
  track("diagnostic_completed", { asset_id: "interest_selector", cta_id: `interest_${interest.toLowerCase()}` });
}

function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pdfContent() {
  const stream = "BT /F1 18 Tf 64 760 Td (ConnectiveByte Organization Dialogue Guide) Tj 0 -45 Td /F1 11 Tf (1. Purpose: What outcome matters?) Tj 0 -28 Td (2. Disconnect: What is getting in the way?) Tj 0 -28 Td (3. Experiment: What can we try first?) Tj ET";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"
  ];
  let documentBody = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(documentBody).length);
    documentBody += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(documentBody).length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n");
  return `${documentBody}xref\n0 6\n0000000000 65535 f \n${entries}\ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;
}

function saveConsent(analytics) {
  const current = getConsent();
  writeJson("consent", { analytics, email: current.email, decided: true });
  document.querySelector("#consent-panel").hidden = true;
  if (analytics) {
    track("landing_viewed", { cta_id: "consent_accepted" });
    // 同意前に表示済みの共有結果 (?r=) のviewをここで補発。
    // trial_same_condition で共有sectionが閉じた後は補発しない (viewでなかったため)。
    if (sharedResultPhaseThisView !== null && !document.querySelector("#shared-result")?.hidden) {
      track("shared_result_viewed", { asset_id: "shared_result", cta_id: `r_P${sharedResultPhaseThisView}` });
    }
  } else {
    localStorage.removeItem("events");
  }
}

function initializeConsent() {
  const consent = getConsent();
  document.querySelector("#analytics-consent").checked = consent.analytics;
  document.querySelector("#consent-panel").hidden = consent.decided;
  if (consent.analytics) track("landing_viewed");
}

function initializeReadingEvents() {
  const observed = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.75 && !observed.has(entry.target.id)) {
        observed.add(entry.target.id);
        if (entry.target.id === "frontier") {
          track("frontier_article_read_75", { asset_id: "frontier_article", cta_id: "article_scroll" });
        }
      }
    });
  }, { threshold: [0.75] });
  observer.observe(document.querySelector("#frontier"));
}

document.addEventListener("click", (event) => {
  const interestButton = event.target.closest("[data-interest]");
  if (interestButton) selectInterest(interestButton.dataset.interest);

  const tracked = event.target.closest("[data-track]");
  if (tracked) {
    if (tracked.dataset.track === "diagnostic_started") diagnosticStarted = true;
    track(tracked.dataset.track, {
      asset_id: tracked.closest("[data-asset-id]")?.dataset.assetId ?? "landing_page",
      cta_id: tracked.dataset.ctaId ?? "unspecified"
    });
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "open-comparison") {
    const workflow = document.querySelector("#comparison-workflow");
    workflow.hidden = false;
    document.querySelector("#comparison-theme").focus();
    track("comparison_template_viewed", { asset_id: "comparison_template", cta_id: "comparison_open" });
  }
  if (action === "complete-comparison") {
    const theme = document.querySelector("#comparison-theme").value.trim();
    const next = document.querySelector("#comparison-next").value.trim();
    if (!theme || !next) {
      document.querySelector("#comparison-status").textContent = "2つの項目を入力してください。入力内容は保存されません。";
      return;
    }
    track("comparison_template_completed", { asset_id: "comparison_template", cta_id: "comparison_complete" });
    download("connectivebyte-comparison.csv", "text/csv;charset=utf-8", `theme,next_step\n"${theme.replaceAll('"', '""')}","${next.replaceAll('"', '""')}"\n`);
    track("comparison_template_downloaded", { asset_id: "comparison_template", cta_id: "comparison_download" });
    document.querySelector("#comparison-status").textContent = "ダウンロードしました。入力内容は端末に保存していません。";
  }
  if (action === "download-org") {
    download("connectivebyte-organization-guide.pdf", "application/pdf", pdfContent());
    track("org_pdf_downloaded", { asset_id: "organization_brief", cta_id: "org_pdf_download" });
  }
  if (action === "save-consent") saveConsent(document.querySelector("#analytics-consent").checked);
  if (action === "reject-analytics") saveConsent(false);
  if (action === "show-consent") document.querySelector("#consent-panel").hidden = false;
  if (action === "submit-diagnosis") submitDiagnosis();
  if (action === "copy-share-url") {
    const input = document.querySelector("#share-url-input");
    input.select();
    const done = () => {
      const button = event.target.closest("[data-action]");
      const label = button.textContent;
      button.textContent = "コピーしました";
      setTimeout(() => { button.textContent = label; }, 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(input.value).then(done).catch(() => { document.execCommand("copy"); done(); });
    } else {
      document.execCommand("copy");
      done();
    }
  }
  if (action === "open-share-intent") {
    if (!shareState) return;
    track("x_intent_opened", { asset_id: "share_block", cta_id: `template_${shareState.template}` });
    window.open(share.buildIntentUrl(document.querySelector("#share-preview").value), "_blank", "noopener");
  }
  if (action === "download-share-card") {
    if (!shareState?.cardCanvas) return;
    // §19 result_card_created: カードは自動生成されるため、ユーザーが取得した時に発火
    track("result_card_created", { asset_id: "share_block", cta_id: "result_card" });
    shareState.cardCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "connectivebyte-result.png";
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }
  if (action === "trial-same-condition") trialSameCondition();
  if (action === "submit-feedback") submitFeedback();
  if (action === "save-feedback-note") saveFeedbackNote();
  if (action === "save-result") saveResultText();
  if (action === "refresh-dashboard") renderDashboard();
  if (action === "open-comparison" || action === "complete-comparison" || action === "download-org") {
    setTimeout(renderDashboard, 0);
  }
});

const comparisonWorkflow = document.querySelector("#comparison-workflow");
comparisonWorkflow.querySelectorAll("input").forEach((input) => {
  input.addEventListener("input", () => {
    if (!comparisonWorkflow.dataset.started) {
      comparisonWorkflow.dataset.started = "true";
      track("comparison_template_started", { asset_id: "comparison_template", cta_id: "comparison_input" });
    }
  });
});

document.querySelector("#newsletter-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const emailInput = document.querySelector("#email");
  const explicitConsent = document.querySelector("#email-consent").checked;
  const status = document.querySelector("#newsletter-status");
  if (!emailInput.checkValidity() || !explicitConsent) {
    status.textContent = "有効なメールアドレスと明示同意が必要です。";
    return;
  }
  const payload = { email: emailInput.value.trim(), consent: true };
  // anonymous_idは匿名計測に同意済みのvisitorのみ関連付ける
  // (未同意なら新規生成しない — subscribe自体は明示同意があるため送れる)。
  if (getConsent().analytics) payload.anonymous_id = anonymousId();
  status.textContent = "登録を送信しています…";
  fetch(SUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then((response) => {
    if (response.status !== 202) throw new Error(`subscribe_rejected_${response.status}`);
    const current = getConsent();
    writeJson("consent", { analytics: current.analytics, email: true, decided: true });
    track("newsletter_subscribed", { asset_id: "newsletter", cta_id: "newsletter_submit" });
    writeJson("newsletter_registered", { email_registered: true, at: new Date().toISOString() });
    emailInput.value = "";
    document.querySelector("#email-consent").checked = false;
    status.textContent = "登録を受け付けました。診断が詳細版（12問）に切り替わります。";
    refreshDiagnosticQuestions();
  }).catch(() => {
    status.textContent = "登録できませんでした。通信状況を確認して、もう一度お試しください。";
  });
});

const restoredInterest = readJson("declared_interest", null);
if (getInterestRoute(restoredInterest)) renderRoute(restoredInterest, false);
document.querySelectorAll("input[name=share-template]").forEach((radio) => {
  radio.addEventListener("change", () => {
    document.querySelector("#share-free-text").hidden = currentShareTemplate() !== "free";
    if (radio.checked) {
      track("share_template_selected", { asset_id: "share_block", cta_id: `template_${radio.value}` });
      regenerateShareDraft({ announce: true });
    }
  });
});
document.querySelector("#share-free-text").addEventListener("input", () => regenerateShareDraft());
initializeSharedResult();
initializeConsent();
initializeReadingEvents();
renderDashboard();
