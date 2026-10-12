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
    // Pages本番と同じく、404応答の本文はルートの404.html (日本語のサイト体裁)。
    assert.equal(res404.headers.get("content-type"), "text/html; charset=utf-8");
    const body404 = await res404.text();
    assert.match(body404, /<html lang="ja">/);
    assert.match(body404, /お探しのページ/);
    assert.match(body404, /href="\/"/);
  } finally {
    await ctx.cleanup();
  }
});

test("ネストした存在しないパスも404.htmlをサイト体裁で応答する", async () => {
  // 404.htmlはアセット参照を絶対パス (/styles.css等) で書いているため、
  // どの深さのURLで応答してもリンクが壊れない。Pages本番と同じ挙動を
  // 深いパスとindex.htmlを持たないディレクトリURLの両方で機械検査する。
  const ctx = await startServer();
  try {
    for (const path of ["/deep/nested/missing", "/missing-dir/"]) {
      const res = await fetch(`${ctx.base}${path}`);
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8", path);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/, path);
      const body = await res.text();
      assert.match(body, /<html lang="ja">/, path);
      assert.match(body, /お探しのページ/, path);
      assert.match(body, /href="\/styles\.css"/, path);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("404.htmlが無い環境では平文のNot foundへフォールバックする", async () => {
  const bareRoot = await mkdtemp(join(tmpdir(), "cb-root-"));
  const ctx = await startServer({ root: bareRoot });
  try {
    const res = await fetch(`${ctx.base}/missing`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await res.text(), "Not found");
  } finally {
    await ctx.cleanup();
    await rm(bareRoot, { recursive: true, force: true });
  }
});

test("ディレクトリURLはPages配信と同じ挙動をする (スラッシュ無しは301・付きはindex.html)", async () => {
  // sitemap.xmlはディレクトリ形式のURLを掲載する。Pages本番はスラッシュ無しの
  // ディレクトリURLをスラッシュ付きへ301リダイレクトし、付きのURLでindex.htmlを
  // 応答する。スラッシュ無しのままindex.htmlを返すと ../article.css 等の
  // 相対リンクの基準がずれて壊れるため、301動作ごと本番parityとして機械検査する。
  const ctx = await startServer();
  try {
    const slashed = await fetch(`${ctx.base}/content/18-blog/quetab-ai-game-builder/`);
    assert.equal(slashed.status, 200);
    assert.equal(slashed.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await slashed.text(), /quetab\.com\/games 検証レポート/);

    const bare = await fetch(`${ctx.base}/content/02-entry-read`, { redirect: "manual" });
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get("location"), "/content/02-entry-read/");
    const followed = await fetch(`${ctx.base}/content/02-entry-read`);
    assert.equal(followed.status, 200);
    assert.match(await followed.text(), /上がってくる床は、乗れば足場になる/);

    const bareWithQuery = await fetch(`${ctx.base}/content/02-entry-read?utm_source=x`, { redirect: "manual" });
    assert.equal(bareWithQuery.status, 301);
    assert.equal(bareWithQuery.headers.get("location"), "/content/02-entry-read/?utm_source=x");

    const noIndex = await fetch(`${ctx.base}/content/18-blog/`);
    assert.equal(noIndex.status, 404);
    const bareNoIndex = await fetch(`${ctx.base}/content/18-blog`, { redirect: "manual" });
    assert.equal(bareNoIndex.status, 301);
  } finally {
    await ctx.cleanup();
  }
});

test("robots.txt はtext/plainで配信されSitemap行を含む (Pages配信とのparity)", async () => {
  // server.jsのMIME mapに .txt が無いとローカル配信がoctet-streamになり
  // Pages本番と食い違う。発見経路の中身も一緒に機械検査する。
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/robots.txt`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await res.text(), /^Sitemap: https:\/\/lab\.connectivebyte\.com\/sitemap\.xml$/m);
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

test("POST /api/apply は有効な申込に202・不正入力に400を返す (保存はしない)", async () => {
  const ctx = await startServer();
  try {
    const postApply = (body) => fetch(`${ctx.base}/api/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
    const ok = await postApply({ email: "org@example.com", consent: true });
    assert.equal(ok.status, 202);
    assert.equal((await ok.json()).accepted, true);
    const full = await postApply({
      email: "org2@example.com", consent: true, interest: "C",
      note: "カスタマーサポート部門。まず話を聞きたい", anonymous_id: "anon-9"
    });
    assert.equal(full.status, 202);
    for (const bad of [
      { email: "nope", consent: true },
      { email: "org@example.com" },
      { email: "org@example.com", consent: false },
      { email: "org@example.com", consent: true, interest: "X" },
      { email: "org@example.com", consent: true, note: "x".repeat(1001) },
      "not-json"
    ]) {
      const res = await postApply(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    // dev serverはPIIを書き込まない — events.jsonlに申込が残らない
    const eventsRaw = await readFile(join(ctx.dataDir, "events.jsonl"), "utf8").catch(() => "");
    assert.equal(eventsRaw.includes("org@example.com"), false);
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

test("クロスオリジンからの /api/subscribe・/api/apply へのPOSTも403で拒否する", async () => {
  const ctx = await startServer();
  try {
    for (const path of ["/api/subscribe", "/api/apply"]) {
      const res = await fetch(`${ctx.base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example.com" },
        body: JSON.stringify({ email: "org@example.com", consent: true })
      });
      assert.equal(res.status, 403, path);
      assert.equal((await res.json()).error, "cross_origin_denied", path);
    }
  } finally {
    await ctx.cleanup();
  }
});

test("同一Originの /api/apply へのPOSTは許可され Access-Control-Allow-Origin が設定される", async () => {
  const ctx = await startServer();
  try {
    const origin = new URL(ctx.base).origin;
    const res = await fetch(`${ctx.base}/api/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email: "org@example.com", consent: true })
    });
    assert.equal(res.status, 202);
    assert.equal((await res.json()).accepted, true);
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
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

test("19-diagnosis-line-lp の匿名イベントはLP実装と同じpayload形状で202・未知のd1_lp_*は400", async () => {
  const ctx = await startServer();
  try {
    // LP inline script (content/19-diagnosis-line-lp) が本番 events backend へ直接送る
    // payloadと同じ形。REQUIRED_FIELDS に無い session_id/referrer_host を含むまま
    // 受理されることで型許可と必須/禁止属性の契約を機能面から固定する。
    const lpEvent = (name, cta_id) => ({
      name,
      source_id: "d1_lp",
      campaign_id: "static",
      asset_id: "19-diagnosis-line-lp",
      segment: "unselected",
      channel: "web",
      cta_id,
      occurred_at: new Date().toISOString(),
      session_id: "ses-001",
      referrer_host: "(none)"
    });
    const ok = await post(ctx.base, {
      events: [lpEvent("d1_lp_viewed", "none"), lpEvent("d1_lp_cart_click", "cart-d1")]
    });
    assert.equal(ok.status, 202);
    assert.equal((await ok.json()).accepted, 2);

    const bad = await post(ctx.base, { events: [lpEvent("d1_lp_bogus", "none")] });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid event type");
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/stats は interest_selected をE/D/C/B/A別の閉じた形で集計する", async () => {
  const ctx = await startServer();
  try {
    const events = [
      validEvent({ name: "interest_selected", cta_id: "interest_e" }),
      validEvent({ name: "interest_selected", cta_id: "interest_e" }),
      validEvent({ name: "interest_selected", cta_id: "interest_b" }),
      // 集計対象外: 別イベント名・不正cta_id
      validEvent({ name: "diagnostic_completed", cta_id: "interest_e" }),
      validEvent({ name: "interest_selected", cta_id: "none" })
    ];
    const accepted = await post(ctx.base, events);
    assert.equal(accepted.status, 202);
    const res = await fetch(`${ctx.base}/api/stats`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { total: 3, counts: { E: 2, D: 0, C: 0, B: 1, A: 0 } });
  } finally {
    await ctx.cleanup();
  }
});

test("GET /api/stats は events.jsonl が無いときも全ゼロで応答する", async () => {
  const ctx = await startServer();
  try {
    const res = await fetch(`${ctx.base}/api/stats`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { total: 0, counts: { E: 0, D: 0, C: 0, B: 0, A: 0 } });
  } finally {
    await ctx.cleanup();
  }
});
