import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POST_LENGTH,
  URL_WEIGHTED_LENGTH,
  SHARE_TEMPLATES,
  shareUrlFor,
  parseShareParams,
  levelName,
  nextActionFor,
  truncateJa,
  buildShareText,
  buildIntentUrl,
  cardLines,
  FEEDBACK_OPTIONS,
  feedbackLabel,
  resultText
} from "../share.js";
import { LEVELS } from "../logic.js";

function weightedLength(text, url) {
  return text.length - url.length + URL_WEIGHTED_LENGTH;
}

test("shareUrlFor → parseShareParams round trip for every level", () => {
  for (const def of LEVELS) {
    const url = shareUrlFor("https://lab.connectivebyte.com/", def.level);
    assert.match(url, /\/\?r=L\d+&utm_source=shared&utm_medium=social&utm_campaign=diag_v1$/);
    assert.equal(parseShareParams(new URL(url).search).level, def.level);
  }
});

test("parseShareParams rejects malformed r", () => {
  assert.equal(parseShareParams("").level, null);
  assert.equal(parseShareParams("?r=").level, null);
  assert.equal(parseShareParams("?r=abc").level, null);
  assert.equal(parseShareParams("?r=L").level, null);
  assert.equal(parseShareParams("?r=L12").level, null);
  assert.equal(parseShareParams("?r=L-1").level, null);
  assert.equal(parseShareParams("?r=l3").level, null);
});

test("parseShareParams ignores unrelated params", () => {
  assert.equal(parseShareParams("?utm_source=x&r=L4&foo=bar").level, 4);
});

test("levelName / nextActionFor resolve from LEVELS", () => {
  assert.equal(levelName(0), LEVELS[0].name_ja);
  assert.equal(levelName(11), LEVELS[11].name_ja);
  assert.equal(nextActionFor(3), LEVELS[3].exit_conditions[0]);
  assert.equal(levelName(99), "");
});

test("truncateJa counts code points and appends ellipsis", () => {
  assert.equal(truncateJa("あいう", 5), "あいう");
  assert.equal(truncateJa("あいうえお", 3), "あいう…");
  assert.equal(truncateJa(null, 3), "");
});

test("result template fits 280 weighted chars for every level", () => {
  const url = shareUrlFor("https://lab.connectivebyte.com/", 4);
  for (const def of LEVELS) {
    const draft = buildShareText("result", {
      level: def.level,
      levelName: def.name_ja,
      nextAction: def.exit_conditions[0],
      url
    });
    assert.ok(draft, `draft missing for L${def.level}`);
    assert.ok(draft.text.includes(`L${def.level}`));
    assert.ok(draft.text.includes(def.name_ja));
    assert.ok(draft.text.includes(url));
    assert.ok(weightedLength(draft.text, url) <= MAX_POST_LENGTH,
      `L${def.level} over cap: ${weightedLength(draft.text, url)}`);
  }
});

test("result template truncates long next actions", () => {
  const url = "https://lab.connectivebyte.com/";
  const longAction = LEVELS[5].exit_conditions[0];
  const draft = buildShareText("result", { level: 5, nextAction: longAction, url });
  assert.ok(!draft.text.includes(longAction));
  assert.ok(draft.text.includes("…"));
});

test("free template uses user text plus url and caps length", () => {
  const url = "https://lab.connectivebyte.com/";
  const short = buildShareText("free", { freeText: "診断が分かりやすかった", url });
  assert.equal(short.text, "診断が分かりやすかった\nhttps://lab.connectivebyte.com/");
  const long = buildShareText("free", { freeText: "あ".repeat(400), url });
  assert.ok(weightedLength(long.text, url) <= MAX_POST_LENGTH);
  assert.ok(long.text.endsWith(url));
});

test("unknown template returns null", () => {
  assert.equal(buildShareText("promo", { url: "https://x.jp/" }), null);
  assert.deepEqual(SHARE_TEMPLATES, ["result", "free"]);
});

test("buildIntentUrl encodes text into the web intent", () => {
  const intent = buildIntentUrl("診断結果 L4\nhttps://lab.connectivebyte.com/?r=L4");
  assert.ok(intent.startsWith("https://twitter.com/intent/tweet?text="));
  assert.equal(decodeURIComponent(intent.split("text=")[1]), "診断結果 L4\nhttps://lab.connectivebyte.com/?r=L4");
});

test("cardLines carries level info and no personal fields", () => {
  const lines = cardLines({ level: 4, levelName: LEVELS[4].name_ja, nextAction: LEVELS[4].exit_conditions[0], yesCount: 5 });
  const text = lines.map((line) => line.text).join("\n");
  assert.match(text, /L4/);
  assert.ok(text.includes(LEVELS[4].name_ja));
  assert.ok(text.includes("12問中5問"));
  const serialized = JSON.stringify(lines).toLowerCase();
  for (const banned of ["name", "email", "mail", "address", "phone", "tel", "company", "ip"]) {
    assert.ok(!serialized.includes(`"${banned}`), `card must not carry ${banned}`);
  }
});

test("FEEDBACK_OPTIONS carries the three §7 choices without ranking", () => {
  assert.deepEqual(FEEDBACK_OPTIONS.map((o) => o.id), ["achieved", "partial", "not_achieved"]);
  assert.deepEqual(FEEDBACK_OPTIONS.map((o) => o.label), ["達成できた", "一部達成できた", "達成できなかった"]);
  assert.equal(feedbackLabel("achieved"), "達成できた");
  assert.equal(feedbackLabel("nope"), "");
});

test("resultText renders the full next-action list with no personal fields", () => {
  const text = resultText({
    level: 4,
    levelName: LEVELS[4].name_ja,
    nextActions: [...LEVELS[4].exit_conditions],
    yesCount: 5
  }, "2026-08-30T00:00:00.000Z");
  assert.ok(text.includes("L4 [redacted]"));
  assert.ok(text.includes("12問中5問"));
  assert.ok(text.includes(`- ${LEVELS[4].exit_conditions[0]}`));
  assert.ok(text.includes("個人情報は含まれません"));
  for (const banned of ["occupation", "email", "氏名", "会社名"]) {
    assert.ok(!text.toLowerCase().includes(banned.toLowerCase()));
  }
});

test("resultText notes absent next actions at the top level", () => {
  const text = resultText({ level: 11, levelName: LEVELS[11].name_ja, nextActions: [] }, "x");
  assert.ok(text.includes("最上位のため次の一手の定義なし"));
});
