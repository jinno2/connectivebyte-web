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

function setup({ path = "/", search = "", storage, elements = {}, selectors = {}, fetchImpl } = {}) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const map = new Map(Object.entries(elements));
  const document = {
    querySelector(selector) { return map.get(selector) ?? null; },
    querySelectorAll(selector) { return selectors[selector] ?? []; },
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
  assert.deepEqual(removalDenied.readJson("events", []), [], "削除失敗でもページ内の旧イベントを復活させない");
  assert.equal(removalDeniedStorage.values.has("consent"), true, "削除拒否では旧永続値が残ることを区別");
});

test("レベル表の全表示で宣言済みlevel_table_read_100を一度だけ送る", async () => {
  const storage = new FakeStorage();
  const calls = [];
  setup({
    storage,
    elements: { "#level-table": Object.assign(element(), { id: "level-table" }) },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { status: 202 };
    }
  });
  const observers = [];
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
  };
  try {
    const app = await loadApp("level-table-read");
    app.writeJson("consent", { analytics: true, email: false, decided: true });
    const tableObserver = observers.find((observer) => observer.targets.some((target) => target.id === "level-table"));
    assert.ok(tableObserver, "level-tableが監視対象になっている");
    const entry = { isIntersecting: true, intersectionRatio: 1, target: tableObserver.targets[0] };
    tableObserver.callback([entry]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].name, "level_table_read_100");
    assert.equal(calls[0][0].asset_id, "level_table");

    tableObserver.callback([entry]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, "同一pageviewで再発火しない");
  } finally {
    globalThis.IntersectionObserver = previousObserver;
  }
});

test("レベル表が部分的にしか見えていない間はlevel_table_read_100を送らない", async () => {
  const storage = new FakeStorage();
  const calls = [];
  setup({
    storage,
    elements: { "#level-table": Object.assign(element(), { id: "level-table" }) },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { status: 202 };
    }
  });
  const observers = [];
  const previousObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
  };
  try {
    const app = await loadApp("level-table-partial");
    app.writeJson("consent", { analytics: true, email: false, decided: true });
    const tableObserver = observers.find((observer) => observer.targets.some((target) => target.id === "level-table"));
    assert.ok(tableObserver, "level-tableが監視対象になっている");
    // viewportより高いテーブルではintersectionRatioが1に届かないため、部分表示は未達として扱う。
    const partial = { isIntersecting: true, intersectionRatio: 0.6, target: tableObserver.targets[0] };
    tableObserver.callback([partial]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0, "部分表示では送信しない");

    tableObserver.callback([partial, { isIntersecting: true, intersectionRatio: 1, target: tableObserver.targets[0] }]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, "部分表示を経由した後も全表示で一度だけ送る");
    assert.equal(calls[0][0].name, "level_table_read_100");
    assert.equal(calls[0][0].cta_id, "level_table_scroll");
  } finally {
    globalThis.IntersectionObserver = previousObserver;
  }
});

test("同意拒否はconsent保存失敗でも待機イベントを破棄し、復旧後に旧イベントを送らない", async () => {
  const storage = new FakeStorage({
    consent: { analytics: true, email: false, decided: true },
    events: [{ name: "landing_viewed", cta_id: "probe_1" }]
  }, { set: true });
  const calls = [];
  const context = setup({
    storage,
    elements: { "#consent-panel": element() },
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { status: 202 };
    }
  });
  navigator.onLine = false;
  const app = await loadApp("consent-reject-clears-queue");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(app.saveConsent(false), false, "consent書込み失敗を成功扱いしない");
  assert.deepEqual(app.readJson("events", []), [], "拒否時は待機キューをページ内でも破棄");
  assert.equal(storage.values.has("events"), false, "removeItem成功時は永続キューも破棄");
  app.track("interest_selected", { cta_id: "after_reject" });
  navigator.onLine = true;
  context.windowListeners.get("online")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0, "拒否中の操作・online復帰で送信しない");

  storage.mode.set = false;
  app.saveConsent(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.flat().every((event) => event.cta_id !== "probe_1"), "再同意後に拒否前のイベントを送らない");
});

test("未回答のまま診断を完了しない — 結果表示・保存・送信せず状態表示する", async () => {
  const storage = new FakeStorage();
  const elements = {
    "#diagnostic-output": element(),
    "#diagnostic-level": element(),
    "#diagnostic-status": element()
  };
  elements["#diagnostic-output"].hidden = true;
  const { documentListeners } = setup({ storage, elements });
  const app = await loadApp("diagnosis-incomplete");
  const clickTarget = {
    closest: (selector) => selector === "[data-action]"
      ? { dataset: { action: "submit-diagnosis" } }
      : null
  };
  documentListeners.get("click")({ target: clickTarget });
  assert.equal(elements["#diagnostic-output"].hidden, true, "未回答では結果を表示しない");
  assert.equal(app.readJson("diagnosis_result", null), null, "未回答では判定を保存しない");
  assert.equal(app.readJson("progress", {}).diagnostic_completed, undefined, "未回答では完了進捗を記録しない");
  assert.match(elements["#diagnostic-status"].textContent, /未回答/);
});

test("一部のみ回答の診断も完了させず、結果を出さず状態表示する", async () => {
  const storage = new FakeStorage();
  const elements = {
    "#diagnostic-output": element(),
    "#diagnostic-level": element(),
    "#diagnostic-status": element()
  };
  elements["#diagnostic-output"].hidden = true;
  const radios = [{ dataset: { questionId: "Q0" }, value: "はい" }];
  const { documentListeners } = setup({
    storage,
    elements,
    selectors: { "#diagnostic-questions input[type=radio]:checked": radios }
  });
  const app = await loadApp("diagnosis-partial");
  const clickTarget = {
    closest: (selector) => selector === "[data-action]"
      ? { dataset: { action: "submit-diagnosis" } }
      : null
  };
  documentListeners.get("click")({ target: clickTarget });
  assert.equal(elements["#diagnostic-output"].hidden, true, "一部回答でも結果を表示しない");
  assert.equal(app.readJson("diagnosis_result", null), null, "一部回答では判定を保存しない");
  assert.equal(app.readJson("progress", {}).diagnostic_completed, undefined, "一部回答では完了進捗を記録しない");
  assert.match(elements["#diagnostic-status"].textContent, /未回答/, "未回答が残っていることを状態表示する");
});

test("全問回答済みの診断は従来どおり完了し、状態表示は空に戻る", async () => {
  const storage = new FakeStorage();
  const elements = {
    "#diagnostic-output": element(),
    "#diagnostic-level": element(),
    "#diagnostic-actions": element(),
    "#diagnostic-comparison-link": element(),
    "#diagnostic-status": element()
  };
  const radios = [
    { dataset: { questionId: "Q0" }, value: "はい" },
    { dataset: { questionId: "Q1" }, value: "いいえ／わからない" },
    { dataset: { questionId: "Q2" }, value: "いいえ／わからない" }
  ];
  const { documentListeners } = setup({
    storage,
    elements,
    selectors: { "#diagnostic-questions input[type=radio]:checked": radios }
  });
  const app = await loadApp("diagnosis-complete");
  const clickTarget = {
    closest: (selector) => selector === "[data-action]"
      ? { dataset: { action: "submit-diagnosis" } }
      : null
  };
  documentListeners.get("click")({ target: clickTarget });
  assert.equal(elements["#diagnostic-output"].hidden, false, "結果を表示する");
  assert.equal(elements["#diagnostic-level"].textContent, "AIで試す・扱う段階");
  assert.equal(elements["#diagnostic-comparison-link"].hidden, false);
  assert.equal(elements["#diagnostic-status"].textContent, "", "完了時は状態表示を空にする");
  assert.equal(app.readJson("diagnosis_result", null)?.current_phase, 2);
});

test("比較テンプレートへのアンカーCTAは着地時にworkflowを開き、カードボタンと同じ挙動になる", async () => {
  const storage = new FakeStorage({ consent: { analytics: true, email: true, decided: true } });
  const focusCalls = [];
  const workflow = element();
  workflow.querySelectorAll = () => [];
  const theme = element();
  theme.focus = () => focusCalls.push("theme");
  const elements = {
    "#comparison-workflow": workflow,
    "#comparison-theme": theme
  };
  const calls = [];
  const { documentListeners } = setup({
    storage,
    elements,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { status: 202 };
    }
  });
  await loadApp("comparison-anchor-cta");
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const trackedNames = () => calls.flat().map((batched) => batched.name);

  const anchorTarget = {
    closest: (selector) => selector === 'a[href="#comparison"]' ? { dataset: {} } : null
  };
  documentListeners.get("click")({ target: anchorTarget });
  await flush();
  assert.equal(workflow.hidden, false, "アンカーCTAの着地でworkflowを開く");
  assert.deepEqual(focusCalls, ["theme"], "テーマ入力欄へフォーカスする");
  assert.ok(trackedNames().includes("comparison_template_viewed"), "開いたことをカードボタンと同じイベントで計測する");

  const actionTarget = {
    closest: (selector) => selector === "[data-action]"
      ? { dataset: { action: "open-comparison" } }
      : null
  };
  documentListeners.get("click")({ target: actionTarget });
  await flush();
  assert.equal(workflow.hidden, false, "カード内ボタンでもworkflowを開く");
  assert.deepEqual(focusCalls, ["theme", "theme"], "ボタン経由でもテーマ入力欄へフォーカスする");
});
