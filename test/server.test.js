import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import test from "node:test";
import { createRequestHandler } from "../server.js";

function validEvent(overrides = {}) {
  return {
    name: "landing_viewed",
    anonymous_id: "anon-1",
    source_id: "direct",
    campaign_id: "organic",
    asset_id: "landing_page",
    segment: "exploring",
    channel: "web",
    cta_id: "none",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    utm_content: "",
    occurred_at: new Date().toISOString(),
    ...overrides
  };
}

async function startServer(options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "cb-events-"));
  const handler = createRequestHandler({ dataDir, ...options });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const stop = () => new Promise((resolve) => server.close(resolve));
  const cleanup = async () => { await stop(); await rm(dataDir, { recursive: true, force: true }); };
  return { base, dataDir, stop, cleanup };
}

async function post(base, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: payload
  });
}

test("POST /api/events は有効なイベントバッチを受け付け202を返す", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, [validEvent(), validEvent({ name: "interest_selected" })]);
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.accepted, 2);
    const file = await readFile(join(ctx.dataDir, "events.jsonl"), "utf8");
    const lines = file.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).name, "landing_viewed");
    assert.equal(JSON.parse(lines[1]).name, "interest_selected");
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/events はeventsプロパティのバッチ形式も受け付ける", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, { events: [validEvent()] });
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.accepted, 1);
  } finally {
    await ctx.cleanup();
  }
});

test("禁止属性を含むイベントは400で拒否する", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, [validEvent({ occupation: "engineer" })]);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /forbidden attribute/);
    const res2 = await post(ctx.base, [validEvent({ ai_proficiency: "high", annual_income: 100 })]);
    assert.equal(res2.status, 400);
  } finally {
    await ctx.cleanup();
  }
});

test("不正なイベント型は400で拒否する", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, [validEvent({ name: "totally_made_up_event" })]);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "invalid event type");
  } finally {
    await ctx.cleanup();
  }
});

test("必須フィールド欠落は400で拒否する", async () => {
  const ctx = await startServer();
  try {
    const missing = validEvent();
    delete missing.source_id;
    const res = await post(ctx.base, [missing]);
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /missing or invalid field: source_id/);
    const noSegment = validEvent();
    delete noSegment.segment;
    const res2 = await post(ctx.base, [noSegment]);
    assert.equal(res2.status, 400);
  } finally {
    await ctx.cleanup();
  }
});

test("空配列・非配列は400で拒否する", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, []);
    assert.equal(res.status, 400);
    const res2 = await post(ctx.base, { events: "not-an-array" });
    assert.equal(res2.status, 400);
    const res3 = await post(ctx.base, {});
    assert.equal(res3.status, 400);
  } finally {
    await ctx.cleanup();
  }
});

test("不正JSONは400で拒否する", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, "{not valid json");
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, "invalid_json");
  } finally {
    await ctx.cleanup();
  }
});

test("同一IPで1分間30件を超えると429を返す", async () => {
  const ctx = await startServer();
  try {
    for (let i = 0; i < 30; i += 1) {
      const res = await post(ctx.base, [validEvent()]);
      assert.equal(res.status, 202);
    }
    const over = await post(ctx.base, [validEvent()]);
    assert.equal(over.status, 429);
    const json = await over.json();
    assert.equal(json.error, "rate_limited");
  } finally {
    await ctx.cleanup();
  }
});

test("events.jsonlへ1行1イベントで追記される", async () => {
  const ctx = await startServer();
  try {
    await post(ctx.base, [validEvent({ cta_id: "a" })]);
    await post(ctx.base, [validEvent({ cta_id: "b" }), validEvent({ cta_id: "c" })]);
    const file = await readFile(join(ctx.dataDir, "events.jsonl"), "utf8");
    const lines = file.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).cta_id, "a");
    assert.equal(JSON.parse(lines[1]).cta_id, "b");
    assert.equal(JSON.parse(lines[2]).cta_id, "c");
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  } finally {
    await ctx.cleanup();
  }
});

test("静的ファイル配信は維持される", async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/index.html`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /ConnectiveByte/);
    const res404 = await fetch(`${ctx.base}/does-not-exist.xyz`);
    assert.equal(res404.status, 404);
  } finally {
    await ctx.cleanup();
  }
});

test("events.jsonl は静的配信から保護され403になる", async () => {
  const ctx = await startServer();
  try {
    await post(ctx.base, [validEvent()]);
    const res = await fetch(`${ctx.base}/events.jsonl`);
    assert.equal(res.status, 403);
  } finally {
    await ctx.cleanup();
  }
});

test("POST /api/subscribe は有効な登録に202・不正入力に400を返す", async () => {
  const ctx = await startServer();
  try {
    const postSub = (body) => fetch(`${ctx.base}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
    const ok = await postSub({ email: "user@example.com", consent: true });
    assert.equal(ok.status, 202);
    assert.equal((await ok.json()).accepted, true);
    const withId = await postSub({ email: "user2@example.com", consent: true, anonymous_id: "abc-123_X" });
    assert.equal(withId.status, 202);
    for (const bad of [
      { email: "nope", consent: true },
      { email: "user@example.com" },
      { email: "user@example.com", consent: "yes" },
      { email: "user@example.com", consent: true, anonymous_id: "不正" },
      "not-json"
    ]) {
      const res = await postSub(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/events は静的扱いで404になる", async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/events`);
    assert.equal(res.status, 404);
  } finally {
    await ctx.cleanup();
  }
});

test("クロスオリジンからのPOSTは403で拒否する", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, [validEvent()], { Origin: "https://evil.example.com" });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, "cross_origin_denied");
  } finally {
    await ctx.cleanup();
  }
});

test("manual_collaboration_candidate型を受け付ける", async () => {
  const ctx = await startServer();
  try {
    const res = await post(ctx.base, [validEvent({ name: "manual_collaboration_candidate" })]);
    assert.equal(res.status, 202);
  } finally {
    await ctx.cleanup();
  }
});
