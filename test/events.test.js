import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EVENT_TYPES } from "../logic.js";

const appSource = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
const serverSource = readFileSync(fileURLToPath(new URL("../server.js", import.meta.url)), "utf8");

function extractEventSet(source, label) {
  const match = new RegExp(`const ${label} = (?:Object\\.freeze\\()?new Set\\(\\[(.*?)\\]\\)`, "s").exec(source);
  assert.ok(match, `${label} block not found`);
  return new Set([...match[1].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]));
}

test("app.js EVENT_NAMES and logic.js EVENT_TYPES stay in sync", () => {
  const names = extractEventSet(appSource, "EVENT_NAMES");
  assert.deepEqual([...names].sort(), [...EVENT_TYPES].sort());
});

test("server.js EVENT_TYPES copy accepts every client event", () => {
  const serverTypes = extractEventSet(serverSource, "EVENT_TYPES");
  for (const name of EVENT_TYPES) {
    assert.ok(serverTypes.has(name), `server.js rejects ${name}`);
  }
});

test("share-loop events use the plan §19 canonical names", () => {
  for (const name of [
    "shared_result_viewed",
    "shared_result_trial_started",
    "share_template_selected",
    "share_draft_generated",
    "x_intent_opened",
    "result_card_created",
    "feedback_submitted"
  ]) {
    assert.ok(EVENT_TYPES.has(name), `missing ${name}`);
  }
});

test("feedback options are exactly the three plan §7 choices", () => {
  const ids = [...readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8")
    .matchAll(/name="feedback-answer" value="([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["achieved", "partial", "not_achieved"]);
});

test("production host sends events to the api Worker, others stay same-origin", () => {
  const source = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  // lab (GH Pages・静的) だけ絶対URL。それ以外は server.js 相対PATHのまま。
  assert.match(source, /location\.hostname === "lab\.connectivebyte\.com"\s*\n\s*\?\s*"https:\/\/api\.connectivebyte\.com\/events"\s*\n\s*:\s*"\/api\/events"/);
});

test("newsletter subscribe posts to the Worker /subscribe (email=PII, not the events stream)", () => {
  const source = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  assert.match(source, /"https:\/\/api\.connectivebyte\.com\/subscribe"/);
  assert.match(source, /"\/api\/subscribe"/);
  // 登録が202でのみ成立すること (失敗時にconsent/フラグを書かない)
  assert.match(source, /response\.status !== 202/);
});

test("server.js mirrors the production /subscribe validation", async () => {
  const { Readable } = await import("node:stream");
  const { createRequestHandler } = await import("../server.js");
  const handler = createRequestHandler({ dataDir: "/tmp/cb-sub-test" });
  const cases = [
    [{ email: "a@example.com", consent: true }, 202],
    [{ email: "A@Example.COM ", consent: true }, 202],
    [{ email: "nope", consent: true }, 400],
    [{ email: "a@example.com" }, 400],
    [{ email: "a@example.com", consent: true, anonymous_id: "zz-01_x" }, 202],
    [{ email: "a@example.com", consent: true, anonymous_id: "不正なid" }, 400],
    ["not-json", 400]
  ];
  for (const [body, expected] of cases) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const request = Readable.from([Buffer.from(raw)]);
    request.method = "POST";
    request.url = "/api/subscribe";
    request.headers = { host: "localhost" };
    let status = 0;
    let responseBody = "";
    const response = {
      setHeader: () => {},
      writeHead: (code) => { status = code; },
      end: (payload) => { responseBody = String(payload ?? ""); }
    };
    await handler(request, response);
    assert.equal(status, expected, `${raw} → ${status}`);
    if (expected === 202) assert.match(responseBody, /"accepted":true/);
  }
});

test("consent grant re-emits shared_result_viewed dropped before consent", () => {
  // 初回visitorが共有URL (?r=P{n}) で来ると track() は同意前にdropする。
  // 同意時に補発しないと成長loopの核心指標 (shared_result_viewed) が
  // 初回visitor分だけ永遠に欠ける → saveConsent 内の補発をpinする。
  const source = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  assert.match(source, /sharedResultPhaseThisView = phase;/);
  assert.match(
    source,
    /if \(sharedResultPhaseThisView !== null && !document\.querySelector\("#shared-result"\)\?\.hidden\) \{\s*\n\s*track\("shared_result_viewed", \{ asset_id: "shared_result", cta_id: `r_P\$\{sharedResultPhaseThisView\}` \}\);/
  );
});

test("article pages measure article_viewed (slug=asset_id, consent-gated, LP unaffected)", () => {
  const source = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  // 18-blog パスからslugを取り asset_id へ。LPは従来どおり landing_viewed。
  assert.match(
    source,
    /const articleSlug = location\.pathname\.match\(\/content.{1,4}18-blog.{1,4}\(\[\^\/\]\+\).{1,4}\$\/\)/,
    "18-blog slug extraction missing"
  );
  assert.match(
    source,
    /if \(consent\.analytics\) track\(campaign\.articlePage \? "article_viewed" : "landing_viewed"\);/
  );
  // 同意UI (#consent-panel/#analytics-consent) はLPにしか無いため null 安全であること
  assert.match(source, /if \(consentCheckbox\) consentCheckbox\.checked = consent\.analytics;/);
  assert.match(source, /if \(consentPanel\) consentPanel\.hidden = consent\.decided;/);
  // 記事ページに無いLP専用要素は import 時に例外を出さない
  assert.match(source, /if \(document\.querySelector\("#newsletter-form"\)\) \{/);
  assert.match(source, /if \(document\.querySelector\("#share-free-text"\)\) \{/);
  assert.match(source, /const frontier = document\.querySelector\("#frontier"\);\s*\n\s*if \(frontier\) observer\.observe\(frontier\);/);

  // 公開記事 (現行テンプレ両方) が app.js を読み込むこと (計測の入口)
  const article = readFileSync(fileURLToPath(new URL("../content/18-blog/quetab-ai-game-builder/index.html", import.meta.url)), "utf8");
  const outreachPy = fileURLToPath(new URL("../scripts/t0007-outreach/outreach.py", import.meta.url));
  const template = execFileSync("python3", ["-c", [
    "import importlib.util, sys",
    `spec = importlib.util.spec_from_file_location("outreach", ${JSON.stringify(outreachPy)})`,
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "sys.stdout.write(m.ARTICLE_TMPL.format(title='T', slug='s', description='D', updated='2026-01-01', body='B'))"
  ].join("\n")], { encoding: "utf8" });
  for (const [label, page] of [["quetab article", article], ["ARTICLE_TMPL", template]]) {
    assert.match(page, /<script type="module" src="(\.\.\/){3}app\.js"><\/script>/, label);
  }
});
