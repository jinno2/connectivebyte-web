import { appendFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const root = process.cwd();
const types = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8"
});

const EVENT_TYPES = Object.freeze(new Set([
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
]));

const REQUIRED_FIELDS = Object.freeze([
  "source_id",
  "campaign_id",
  "asset_id",
  "segment",
  "channel",
  "cta_id",
  "occurred_at"
]);

const UTM_FIELDS = Object.freeze([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content"
]);

const FORBIDDEN_ATTRIBUTES = Object.freeze(new Set([
  "occupation",
  "profession",
  "job",
  "job_title",
  "income",
  "salary",
  "revenue",
  "annual_income",
  "ability",
  "skill_level",
  "aptitude",
  "personality",
  "character",
  "traits",
  "ai_proficiency",
  "ai_literacy",
  "ai_familiarity",
  "ai_skill",
  "external_history",
  "work_history",
  "career_history",
  "resume",
  "cv",
  "linkedin_url"
]));

const MAX_EVENTS_PER_WINDOW = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 256 * 1024;

// /api/subscribe — 本番 (api.connectivebyte.com/subscribe・Worker+D1) と同じ検証を
// ローカルでも通すための写し。dev serverは保存しない (202を返すだけ)。
const EMAIL_PATTERN = /^[^\s@,;:"'<>()[\]\\]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const ANONYMOUS_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function validateSubscription(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "invalid payload shape";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) return "invalid_email";
  if (payload.consent !== true) return "consent_required";
  if ("anonymous_id" in payload
    && !(typeof payload.anonymous_id === "string" && ANONYMOUS_ID_PATTERN.test(payload.anonymous_id))) {
    return "invalid_anonymous_id";
  }
  return null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function validateEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return "invalid event shape";
  }
  if (!isNonEmptyString(event.name) || !EVENT_TYPES.has(event.name)) {
    return "invalid event type";
  }
  for (const field of REQUIRED_FIELDS) {
    if (!isNonEmptyString(event[field])) return `missing or invalid field: ${field}`;
  }
  for (const field of UTM_FIELDS) {
    if (field in event && !(typeof event[field] === "string" && event[field].length <= 512)) {
      return `invalid utm field: ${field}`;
    }
  }
  for (const key of Object.keys(event)) {
    if (FORBIDDEN_ATTRIBUTES.has(key)) return `forbidden attribute: ${key}`;
  }
  if (Number.isNaN(Date.parse(event.occurred_at))) {
    return "invalid occurred_at";
  }
  return null;
}

export function createRequestHandler(options = {}) {
  const dataDir = options.dataDir ?? root;
  const eventsFile = join(dataDir, "events.jsonl");
  const rateBuckets = new Map();
  const limit = options.maxEventsPerWindow ?? MAX_EVENTS_PER_WINDOW;
  const windowMs = options.rateWindowMs ?? RATE_WINDOW_MS;

  function checkRateLimit(ip) {
    const now = Date.now();
    const bucket = rateBuckets.get(ip) ?? [];
    const fresh = bucket.filter((ts) => now - ts < windowMs);
    if (fresh.length >= limit) {
      rateBuckets.set(ip, fresh);
      return false;
    }
    fresh.push(now);
    rateBuckets.set(ip, fresh);
    return true;
  }

  function clientIp(request) {
    const raw = request.headers["x-forwarded-for"];
    if (typeof raw === "string" && raw.length > 0) {
      return raw.split(",")[0].trim();
    }
    return request.socket?.remoteAddress ?? "unknown";
  }

  function sendJson(response, status, payload, extraHeaders = {}) {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extraHeaders
    });
    response.end(body);
  }

  async function readBody(request) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      let aborted = false;
      request.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          request.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (aborted) return;
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw);
      });
      request.on("error", () => resolve(null));
    });
  }

  async function handleEvents(request, response) {
    const ip = clientIp(request);
    if (!checkRateLimit(ip)) {
      sendJson(response, 429, { error: "rate_limited" });
      return;
    }
    const raw = await readBody(request);
    if (raw === null) {
      sendJson(response, 413, { error: "body_too_large" });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      sendJson(response, 400, { error: "invalid_json" });
      return;
    }
    const events = Array.isArray(payload) ? payload : payload?.events;
    if (!Array.isArray(events) || events.length === 0) {
      sendJson(response, 400, { error: "events_required" });
      return;
    }
    if (events.length > 200) {
      sendJson(response, 400, { error: "too_many_events" });
      return;
    }
    for (const event of events) {
      const error = validateEvent(event);
      if (error) {
        sendJson(response, 400, { error });
        return;
      }
    }
    const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    try {
      await mkdir(dataDir, { recursive: true });
      await appendFile(eventsFile, lines, "utf8");
    } catch {
      sendJson(response, 500, { error: "storage_failed" });
      return;
    }
    sendJson(response, 202, { accepted: events.length });
  }

  return async function handleRequest(request, response) {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/events" && request.method === "POST") {
      const origin = request.headers.origin;
      if (typeof origin === "string" && origin.length > 0) {
        const requested = new URL(origin);
        const expectedHost = request.headers.host ?? "";
        if (requested.host !== expectedHost) {
          sendJson(response, 403, { error: "cross_origin_denied" });
          return;
        }
        response.setHeader("Access-Control-Allow-Origin", origin);
      }
      await handleEvents(request, response);
      return;
    }

    if (pathname === "/api/events" && request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
      });
      response.end();
      return;
    }

    if (pathname === "/api/subscribe" && request.method === "POST") {
      const origin = request.headers.origin;
      if (typeof origin === "string" && origin.length > 0) {
        const requested = new URL(origin);
        const expectedHost = request.headers.host ?? "";
        if (requested.host !== expectedHost) {
          sendJson(response, 403, { error: "cross_origin_denied" });
          return;
        }
        response.setHeader("Access-Control-Allow-Origin", origin);
      }
      const raw = await readBody(request);
      if (raw === null) {
        sendJson(response, 413, { error: "body_too_large" });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        sendJson(response, 400, { error: "invalid_json" });
        return;
      }
      const error = validateSubscription(payload);
      if (error) {
        sendJson(response, 400, { error });
        return;
      }
      sendJson(response, 202, { accepted: true });
      return;
    }

    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = normalize(join(root, relativePath));
    const containsHiddenPath = relativePath.split("/").some((part) => part.startsWith("."));
    const isProtectedData = relativePath === "events.jsonl" || relativePath.endsWith("/events.jsonl");
    if (!filePath.startsWith(`${root}/`) || containsHiddenPath || isProtectedData) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const file = await stat(filePath);
      if (!file.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "Content-Type": types[extname(filePath)] ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    }
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const handleRequest = createRequestHandler();
  createServer(handleRequest).listen(port, "127.0.0.1", () => {
    process.stdout.write(`ConnectiveByte LP: http://127.0.0.1:${port}\n`);
  });
}

export { createServer as createServerExport } from "node:http";
