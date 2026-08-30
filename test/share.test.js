import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POST_LENGTH,
  URL_WEIGHTED_LENGTH,
  SHARE_TEMPLATES,
  shareUrlFor,
  parseShareParams,
  phaseLabel,
  nextHintFor,
  truncateJa,
  buildShareText,
  buildIntentUrl,
  cardLines,
  FEEDBACK_OPTIONS,
  feedbackLabel,
  resultText
} from "../share.js";
import { PHASES } from "../logic.js";

function weightedLength(text, url) {
  return text.length - url.length + URL_WEIGHTED_LENGTH;
}

test("shareUrlFor → parseShareParams round trip for every phase", () => {
  PHASES.forEach((def, index) => {
    const phase = index + 1;
    const url = shareUrlFor("https://lab.connectivebyte.com/", phase);
    assert.match(url, /\/\?r=P[1-4]&utm_source=shared&utm_medium=social&utm_campaign=diag_v1$/);
    assert.equal(parseShareParams(new URL(url).search).phase, phase);
  });
});

test("parseShareParams rejects malformed r", () => {
  assert.equal(parseShareParams("").phase, null);
  assert.equal(parseShareParams("?r=").phase, null);
  assert.equal(parseShareParams("?r=abc").phase, null);
  assert.equal(parseShareParams("?r=P").phase, null);
  assert.equal(parseShareParams("?r=P0").phase, null);
  assert.equal(parseShareParams("?r=P5").phase, null);
  assert.equal(parseShareParams("?r=L4").phase, null);
  assert.equal(parseShareParams("?r=p3").phase, null);
});

test("parseShareParams ignores unrelated params", () => {
  assert.equal(parseShareParams("?utm_source=x&r=P2&foo=bar").phase, 2);
});

test("phaseLabel / nextHintFor resolve from PHASES", () => {
  assert.equal(phaseLabel(1), PHASES[0].label);
  assert.equal(phaseLabel(4), PHASES[3].label);
  assert.equal(nextHintFor(2), PHASES[1].next_hints[0]);
  assert.equal(phaseLabel(99), "");
});

test("truncateJa counts code points and appends ellipsis", () => {
  assert.equal(truncateJa("あいう", 5), "あいう");
  assert.equal(truncateJa("あいうえお", 3), "あいう…");
  assert.equal(truncateJa(null, 3), "");
});

test("result template fits 280 weighted chars for every phase", () => {
  const url = shareUrlFor("https://lab.connectivebyte.com/", 4);
  PHASES.forEach((def, index) => {
    const phase = index + 1;
    const draft = buildShareText("result", {
      phase,
      phaseLabel: def.label,
      nextHint: def.next_hints[0],
      url
    });
    assert.ok(draft, `draft missing for P${phase}`);
    assert.ok(draft.text.includes(def.label));
    assert.ok(draft.text.includes(url));
    assert.ok(weightedLength(draft.text, url) <= MAX_POST_LENGTH,
      `P${phase} over cap: ${weightedLength(draft.text, url)}`);
  });
});

test("result template truncates long next hints", () => {
  const url = "https://lab.connectivebyte.com/";
  const longHint = "次の一手としてとても長い文章を指定した場合には末尾が省略されること".repeat(3);
  const draft = buildShareText("result", { phase: 2, nextHint: longHint, url });
  assert.ok(!draft.text.includes(longHint));
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
  const intent = buildIntentUrl("診断結果 P2\nhttps://lab.connectivebyte.com/?r=P2");
  assert.ok(intent.startsWith("https://twitter.com/intent/tweet?text="));
  assert.equal(decodeURIComponent(intent.split("text=")[1]), "診断結果 P2\nhttps://lab.connectivebyte.com/?r=P2");
});

test("cardLines carries phase info and no personal fields", () => {
  const lines = cardLines({ phase: 2, phaseLabel: PHASES[1].label, nextHint: PHASES[1].next_hints[0], yesCount: 2 });
  const text = lines.map((line) => line.text).join("\n");
  assert.ok(text.includes(PHASES[1].label));
  assert.ok(text.includes("3問中2問"));
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

test("resultText renders the full next-hint list with no personal fields", () => {
  const text = resultText({
    phase: 2,
    phaseLabel: PHASES[1].label,
    nextHints: [...PHASES[1].next_hints],
    yesCount: 2
  }, "2026-08-30T00:00:00.000Z");
  assert.ok(text.includes(PHASES[1].label));
  assert.ok(text.includes("3問中2問"));
  assert.ok(text.includes(`- ${PHASES[1].next_hints[0]}`));
  assert.ok(text.includes("個人情報は含まれません"));
  for (const banned of ["occupation", "email", "氏名", "会社名"]) {
    assert.ok(!text.toLowerCase().includes(banned.toLowerCase()));
  }
});

test("resultText renders without bullets when no hints are given", () => {
  const text = resultText({ phase: 4, phaseLabel: PHASES[3].label, nextHints: [] }, "x");
  assert.ok(!text.includes("\n- "));
  assert.ok(text.includes(PHASES[3].label));
});
