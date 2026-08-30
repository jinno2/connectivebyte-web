import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("consent grant re-emits shared_result_viewed dropped before consent", () => {
  // 初回visitorが共有URL (?r=L{n}) で来ると track() は同意前にdropする。
  // 同意時に補発しないと成長loopの核心指標 (shared_result_viewed) が
  // 初回visitor分だけ永遠に欠ける → saveConsent 内の補発をpinする。
  const source = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  assert.match(source, /sharedResultLevelThisView = level;/);
  assert.match(
    source,
    /if \(sharedResultLevelThisView !== null && !document\.querySelector\("#shared-result"\)\?\.hidden\) \{\s*\n\s*track\("shared_result_viewed", \{ asset_id: "shared_result", cta_id: `r_L\$\{sharedResultLevelThisView\}` \}\);/
  );
});
