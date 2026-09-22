import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let importCounter = 0;

class FakeStorage {
  constructor(initial = {}, mode = {}) {
    this.values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
    this.mode = mode;
  }
  getItem(key) {
    if (this.mode.get) throw new Error("get denied");
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.mode.set) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    this.values.set(key, String(value));
  }
  removeItem(key) {
    if (this.mode.remove) throw new Error("remove denied");
    this.values.delete(key);
  }
}

function element(dataset = {}) {
  return {
    dataset,
    hidden: false,
    textContent: "",
    value: "",
    innerHTML: "",
    classList: { toggle() {} },
    focus() {},
    addEventListener() {},
    append() {},
    appendChild() {},
    replaceChildren() {}
  };
}

function setup({ path = "/", search = "", storage, elements = {}, fetchImpl } = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const map = new Map(Object.entries(elements));
  const document = {
    querySelector(selector) { return map.get(selector) ?? null; },
    querySelectorAll() { return []; },
    createElement() { return element(); },
    createTextNode(text) { return { textContent: text }; },
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    execCommand() {},
    body: { appendChild() {}, removeChild() {} }
  };
  const window = {
    location: { pathname: path, search, origin: "https://lab.connectivebyte.com" },
    addEventListener(type, callback) { windowListeners.set(type, callback); },
    history: { replaceState() {} },
    open() {}
  };
  const fetchCalls = [];
  globalThis.window = window;
  globalThis.location = window.location;
  globalThis.document = document;
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true, clipboard: null }, configurable: true, writable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage, configurable: true, writable: true
  });
  globalThis.fetch = fetchImpl ?? (async () => ({ status: 202, async json() { return {}; } }));
  Object.defineProperty(globalThis, "crypto", {
    value: { randomUUID: () => `test-id-${++importCounter}` }, configurable: true, writable: true
  });
  globalThis.IntersectionObserver = class { observe() {} };
  return { document, window, windowListeners, documentListeners, fetchCalls };
}

async function loadApp(label) {
  return import(`../app.js?behavior=${label}-${++importCounter}`);
}

function event(name, index = 0) {
  return { name, index, occurred_at: `2026-09-22T00:00:${String(index).padStart(2, "0")}Z` };
}

test("実記事は末尾/とindex.htmlの両方で保存済みE/D/C/B/Aや保存なしでも初期化する", async () => {
  const article = readFileSync(fileURLToPath(new URL("../content/18-blog/quetab-ai-game-builder/index.html", import.meta.url)), "utf8");
  assert.match(article, /<script type="module" src="\.\.\/\.\.\/\.\.\/app\.js"><\/script>/);
  const paths = [
    "/content/18-blog/quetab-ai-game-builder/",
    "/content/18-blog/quetab-ai-game-builder/index.html"
  ];
  for (const interest of [null, "E", "D", "C", "B", "A"]) {
    for (const path of paths) {
      const storage = new FakeStorage(interest ? { declared_interest: interest } : {});
      const calls = [];
      setup({
        path,
        storage,
        fetchImpl: async (_url, options) => {
          calls.push(JSON.parse(options.body));
          return { status: 202 };
        }
      });
      await assert.doesNotReject(loadApp(`article-${path.endsWith("index.html") ? "index" : "slash"}-${interest ?? "none"}`));
      assert.equal(calls.length, 1, `${path} article_viewed count for ${interest ?? "none"}`);
      assert.equal(calls[0][0].name, "article_viewed");
    }
  }
});

test("送信中に追加されたイベントは成功後に自動drainし、100件切捨てた送信済み分を誤削除しない", async () => {
  const storage = new FakeStorage();
  let resolveFirst;
  let calls = 0;
  const responses = [];
  setup({
    storage,
    fetchImpl: (_url, options) => {
      calls += 1;
      responses.push(JSON.parse(options.body));
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve({ status: 202 });
    }
  });
  const app = await loadApp("drain");
  app.writeJson("consent", { analytics: true, email: false, decided: true });
  app.writeJson("events", [event("landing_viewed", 1)]);
  const first = app.flushEvents();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  app.track("interest_selected", { asset_id: "test" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "追加中は同時POSTしない");
  resolveFirst({ status: 202 });
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, "成功後に追加分を自動送信");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.readJson("events", []), []);

  // Same-content entries get private in-memory ids; only the snapshot entry is removed.
  let resolveCap;
  calls = 0;
  responses.length = 0;
  setup({
    storage: new FakeStorage(),
    fetchImpl: (_url, options) => {
      calls += 1;
      responses.push(JSON.parse(options.body));
      if (calls === 1) return new Promise((resolve) => { resolveCap = resolve; });
      return Promise.resolve({ status: 202 });
    }
  });
  const capApp = await loadApp("cap");
  capApp.writeJson("consent", { analytics: true, email: false, decided: true });
  const firstEvent = event("landing_viewed", 9);
  capApp.writeJson("events", [firstEvent]);
  const capFlush = capApp.flushEvents();
  await new Promise((resolve) => setImmediate(resolve));
  const duplicate = event("landing_viewed", 9);
  capApp.writeJson("events", [...capApp.readJson("events", []), ...Array.from({ length: 100 }, (_, i) => event("landing_viewed", i + 10))].slice(-100));
  capApp.writeJson("events", [...capApp.readJson("events", []), duplicate].slice(-100));
  resolveCap({ status: 202 });
  await capFlush;
  assert.equal(capApp.readJson("events", []).length, 100, "上限切捨て以外の待機100件を保持");

  let resolveCleared;
  const clearedStorage = new FakeStorage();
  setup({
    storage: clearedStorage,
    fetchImpl: () => new Promise((resolve) => { resolveCleared = resolve; })
  });
  const clearedApp = await loadApp("cleared-late-response");
  clearedApp.writeJson("consent", { analytics: true, email: false, decided: true });
  clearedApp.writeJson("events", [event("landing_viewed", 55)]);
  const clearedFlush = clearedApp.flushEvents();
  await new Promise((resolve) => setImmediate(resolve));
  clearedApp.removeJson("events");
  resolveCleared({ status: 202 });
  await clearedFlush;
  assert.deepEqual(clearedApp.readJson("events", []), [], "消去後の遅い応答でイベントを復活させない");
});

test("失敗・offline・同意撤回は無限再送せず、撤回後の待機イベントを送らない", async () => {
  const storage = new FakeStorage();
  let calls = 0;
  setup({ storage, fetchImpl: async () => { calls += 1; throw new Error("network"); } });
  const app = await loadApp("failure");
  app.writeJson("consent", { analytics: true, email: false, decided: true });
  app.writeJson("events", [event("landing_viewed")]);
  await app.flushEvents();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1, "失敗をtight loopしない");

  navigator.onLine = false;
  app.writeJson("events", [event("landing_viewed", 2)]);
  await app.flushEvents();
  assert.equal(calls, 1, "offline中は送信しない");

  let resolveRevoke;
  const revokeStorage = new FakeStorage();
  const revokeElements = { "#consent-panel": element() };
  const revokeContext = setup({
    storage: revokeStorage,
    elements: revokeElements,
    fetchImpl: () => new Promise((resolve) => { resolveRevoke = resolve; })
  });
  const revokeApp = await loadApp("consent-revoke");
  revokeApp.writeJson("consent", { analytics: true, email: false, decided: true });
  revokeApp.writeJson("events", [event("landing_viewed", 3)]);
  const revokeFlush = revokeApp.flushEvents();
  await new Promise((resolve) => setImmediate(resolve));
  revokeContext.documentListeners.get("click")({
    target: { closest(selector) {
      return selector === "[data-action]" ? { dataset: { action: "reject-analytics" } } : null;
    } }
  });
  resolveRevoke({ status: 202 });
  await revokeFlush;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "同意撤回後に待機分を再送しない");
  assert.deepEqual(revokeApp.readJson("events", []), []);
});

test("送信成功後もdiagnosis_resultと利用者進捗をダッシュボードに保持する", async () => {
  const storage = new FakeStorage();
  setup({ storage, fetchImpl: async () => ({ status: 202 }) });
  const ids = ["#dashboard", "#dash-diagnostic", "#dash-comparison", "#dash-materials", "#dash-event-count"];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  setup({ storage, elements, fetchImpl: async () => ({ status: 202 }) });
  const app = await loadApp("dashboard");
  app.writeJson("consent", { analytics: true, email: false, decided: true });
  app.writeJson("diagnosis_result", { current_phase: 2, phase_label: "P2", next_hints: [] });
  app.track("diagnostic_completed");
  app.track("comparison_template_completed");
  app.track("org_pdf_downloaded");
  await new Promise((resolve) => setImmediate(resolve));
  app.writeJson("events", []);
  app.renderDashboard();
  assert.equal(elements["#dash-diagnostic"].textContent, "完了");
  assert.equal(elements["#dash-comparison"].textContent, "完了");
  assert.equal(elements["#dash-materials"].textContent, "組織向けガイド");
});

test("Storage拒否・QuotaExceeded・不正JSONでも同意を捏造せず基本操作が落ちない", async () => {
  const denied = new FakeStorage({ consent: { analytics: true, email: false, decided: true } }, { get: true, set: true, remove: true });
  setup({ storage: denied });
  const app = await loadApp("storage-denied");
  assert.doesNotThrow(() => {
    app.writeJson("declared_interest", "E");
    assert.equal(app.readJson("declared_interest", null), "E");
    app.track("interest_selected");
    app.removeJson("events");
  });
  assert.equal(app.readJson("consent", null), null, "Storage読取失敗を同意とみなさない");

  const malformedStorage = new FakeStorage({}, { get: false, set: true, remove: true });
  malformedStorage.values.set("declared_interest", "{");
  setup({ storage: malformedStorage });
  const malformed = await loadApp("storage-malformed");
  assert.doesNotThrow(() => malformed.readJson("declared_interest", "fallback"));
  assert.equal(malformed.readJson("declared_interest", "fallback"), "fallback");
  assert.doesNotThrow(() => malformed.writeJson("feedback_notes", [{ text: "kept in memory" }]));
  assert.deepEqual(malformed.readJson("feedback_notes", []), [{ text: "kept in memory" }]);

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("storage getter denied"); }
  });
  const getterDenied = await loadApp("storage-getter-denied");
  assert.doesNotThrow(() => {
    getterDenied.writeJson("declared_interest", "D");
    getterDenied.track("interest_selected");
  });
  assert.equal(getterDenied.readJson("consent", null), null);
});

test("既存Storage値が書込み拒否後のページ内consentと関心選択を上書きしない", async () => {
  const storage = new FakeStorage({
    consent: { analytics: true, email: false, decided: true },
    declared_interest: "E",
    events: [event("landing_viewed", 8)]
  }, { set: true });
  const elements = { "#consent-panel": element() };
  const calls = [];
  setup({
    storage,
    elements,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { status: 202 };
    }
  });
  const app = await loadApp("storage-existing-write-denied");
  const callsBeforeRevoke = calls.length;
  assert.equal(app.readJson("consent", null).analytics, true);
  assert.equal(app.writeJson("consent", { analytics: false, email: false, decided: true }), false);
  assert.equal(app.saveConsent(false), false, "永続化失敗を保存成功と扱わない");
  assert.equal(elements["#consent-panel"].hidden, true);
  assert.equal(app.readJson("consent", null).analytics, false);
  app.track("interest_selected", { asset_id: "interest_selector" });
  assert.equal(calls.length, callsBeforeRevoke, "撤回後の新規イベントを送信しない");
  assert.deepEqual(app.readJson("events", []), [], "撤回後に旧イベントを復活させない");

  app.writeJson("declared_interest", "C");
  assert.equal(app.readJson("declared_interest", null), "C", "ページ内の最新選択を維持");
  app.writeJson("diagnosis_result", { current_phase: 3, phase_label: "P3", next_hints: ["最新"] });
  assert.equal(app.readJson("diagnosis_result", null).current_phase, 3, "診断結果の最新値を維持");
  app.track("diagnostic_completed");
  assert.equal(app.readJson("progress", {}).diagnostic_completed, true, "進捗の最新値を維持");
  assert.equal(storage.values.has("consent"), false, "拒否後は旧永続consentを削除する");

  const removalDeniedStorage = new FakeStorage({
    consent: { analytics: true, email: false, decided: true },
    events: [event("landing_viewed", 9)]
  }, { set: true, remove: true });
  setup({ storage: removalDeniedStorage, elements: { "#consent-panel": element() } });
  const removalDenied = await loadApp("storage-existing-remove-denied");
  assert.equal(removalDenied.saveConsent(false), false, "削除拒否を保存成功と扱わない");
  assert.equal(removalDenied.readJson("consent", null).analytics, false);
  assert.equal(removalDeniedStorage.values.has("consent"), true, "削除拒否では旧永続値が残ることを区別");
});
