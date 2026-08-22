import { getEligibleSegments, getInterestRoute, promoteBySelfSelection, shouldUseStrongCMessage } from "./logic.js";

const STORAGE_KEYS = Object.freeze([
  "anonymous_id",
  "declared_interest",
  "eligible_segments",
  "consent",
  "events"
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
  "outbound_cta_clicked"
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
  if (analytics) track("landing_viewed", { cta_id: "consent_accepted" });
  else localStorage.removeItem("events");
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
  const email = document.querySelector("#email");
  const explicitConsent = document.querySelector("#email-consent").checked;
  const status = document.querySelector("#newsletter-status");
  if (!email.checkValidity() || !explicitConsent) {
    status.textContent = "有効なメールアドレスと明示同意が必要です。";
    return;
  }
  const current = getConsent();
  writeJson("consent", { analytics: current.analytics, email: true, decided: true });
  track("newsletter_subscribed", { asset_id: "newsletter", cta_id: "newsletter_submit" });
  email.value = "";
  document.querySelector("#email-consent").checked = false;
  status.textContent = "登録操作を受け付けました。このMVPはメールアドレスを送信・保存しません。";
});

const restoredInterest = readJson("declared_interest", null);
if (getInterestRoute(restoredInterest)) renderRoute(restoredInterest, false);
initializeConsent();
initializeReadingEvents();
