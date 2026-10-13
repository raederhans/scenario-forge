import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
import { simple } from "acorn-walk";
import { waitRasterAppReady, waitRasterView } from "../tools/political_id_raster_app_session.mjs";
import { assertRasterCacheRevisit } from "../tools/verify_political_id_raster_integration.mjs";

const sessionSource = readFileSync(new URL("../tools/political_id_raster_app_session.mjs", import.meta.url), "utf8");
const integrationSource = readFileSync(new URL("../tools/verify_political_id_raster_integration.mjs", import.meta.url), "utf8");

// Execute the real function bodies with in-memory page/timer dependencies.
// No browser, source rewrite, network, or timeout-based sleep is involved.
function loadFunctions(source, names, scope) {
  const declarations = new Map();
  simple(parse(source, { ecmaVersion: "latest", sourceType: "module" }), {
    FunctionDeclaration(node) {
      if (names.includes(node.id?.name)) {
        assert.equal(declarations.has(node.id.name), false, `unique function ${node.id.name}`);
        declarations.set(node.id.name, source.slice(node.start, node.end));
      }
    },
  });
  assert.equal(declarations.size, names.length);
  return Function(...Object.keys(scope), `"use strict";\n${[...declarations.values()].join("\n")}\nreturn { ${names.join(", ")} };`)(...Object.values(scope));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const readyState = () => ({ bootPhase: "ready", startupReadonly: false,
  startupReadonlyUnlockInFlight: false, scenarioApplyInFlight: false });
const runPredicate = (fn, argument, state, diagnostics = {}) => vm.runInNewContext(`(${fn.toString()})(argument)`, {
  argument, window: { __rasterTask: { state, renderer: { getPoliticalIdRasterDiagnostics: () => diagnostics } } },
});

test("raster startup readiness retains every boot/unlock guard and the original wait parameters", async () => {
  let calls = 0;
  await waitRasterAppReady({ async waitForFunction(predicate, argument, options) {
    calls++;
    assert.equal(argument, null);
    assert.deepEqual(options, { timeout: 60000 });
    assert.equal(runPredicate(predicate, argument, readyState()), true);
    for (const blocked of [{ bootPhase: "loading" }, { startupReadonly: true },
      { startupReadonlyUnlockInFlight: true }, { scenarioApplyInFlight: true }]) {
      assert.equal(runPredicate(predicate, argument, { ...readyState(), ...blocked }), false);
    }
  } });
  assert.equal(calls, 1);
});

function coldStartupHarness() {
  const calls = [], entered = deferred(), ready = deferred();
  const page = {
    async addInitScript() {}, on() {},
    async goto(url, options) { calls.push(["goto", new URL(url).searchParams.get("default_scenario"), options.timeout]); },
    async evaluate() { calls.push(["imports"]); },
    async waitForFunction(predicate, argument, options) {
      calls.push(["app-ready", argument, options.timeout]);
      assert.equal(runPredicate(predicate, argument, readyState()), true);
      entered.resolve();
      await ready.promise;
    },
  };
  const browser = { async newContext() { return { async newPage() { return page; }, on() {} }; },
    async close() { calls.push(["close"]); } };
  const { openRasterApp } = loadFunctions(sessionSource, ["openRasterApp"], {
    URL, chromium: { async launch() { return browser; } }, waitRasterAppReady,
  });
  return { calls, page, browser, entered, ready,
    open: () => openRasterApp("http://localhost:4173/app/", { scenarioId: "tno_1962" }) };
}

test("cold startup awaits the shared readiness barrier before returning its session", async () => {
  const h = coldStartupHarness();
  let returned = false;
  const result = h.open().then(value => { returned = true; return value; });
  await h.entered.promise;
  assert.equal(returned, false);
  assert.deepEqual(h.calls, [["goto", "tno_1962", 60000], ["imports"], ["app-ready", null, 60000]]);
  h.ready.resolve();
  assert.equal((await result).page, h.page);
  assert.equal(h.calls.some(([name]) => name === "close"), false);
});

test("cold startup propagates readiness rejection and closes its browser", async () => {
  const h = coldStartupHarness(), failure = new Error("startup remained locked");
  const result = h.open();
  await h.entered.promise;
  h.ready.reject(failure);
  await assert.rejects(result, error => error === failure);
  assert.deepEqual(h.calls.at(-1), ["close"]);
});

function cacheHarness({ blockReady = false } = {}) {
  const calls = [], entered = deferred(), ready = deferred();
  const scenarioId = "tno_1962", view = { x: 0, y: 0, k: 1, dpr: 2 };
  const state = { ...readyState(), activeScenarioId: scenarioId, zoomTransform: view };
  const diagnostics = { selected: true, pending: 0, commits: 1, failed: "", assetError: "", assetHits: 1,
    view, cpuBytes: 1, assets: { pendingReads: 0, pendingWrites: 0, memoryBytes: 1, memoryMaxBytes: 2, indexedDBHits: 1 } };
  const report = { views: [] };
  let evaluateIndex = 0, waitIndex = 0;
  const page = {
    url: () => "http://localhost:4173/app/?default_scenario=tno_1962",
    async goto(url, options) {
      assert.equal(new URL(url).searchParams.get("political_id_raster"), "1");
      assert.equal(options.waitUntil, "domcontentloaded");
      calls.push("goto"); evaluateIndex = 0; waitIndex = 0;
    },
    async evaluate() {
      const name = ["imports", "diagnostics", "storage"][evaluateIndex++];
      assert.ok(name); calls.push(name);
      if (name === "diagnostics") return diagnostics;
      if (name === "storage") return { entries: 1, bytes: 1 };
    },
    async waitForFunction(predicate, argument, options) {
      const name = ["app-ready", "raster-ready", "assets-idle"][waitIndex++];
      assert.ok(name); calls.push(name);
      assert.equal(argument, name === "raster-ready" ? scenarioId : null);
      assert.equal(options.timeout, name === "assets-idle" ? 30000 : 60000);
      assert.equal(runPredicate(predicate, argument, state, diagnostics), true);
      if (name === "app-ready") { entered.resolve(); if (blockReady) await ready.promise; }
    },
  };
  const functions = loadFunctions(integrationSource,
    ["readNormalStartupCache", "warmNormalStartupCache", "verifyCacheRevisit"], {
      URL, page, scenarioId, waitRasterAppReady, waitRasterView, report, assert, assertRasterCacheRevisit,
      session: { errors: [] }, async settled(actualPage, precise) {
        assert.equal(actualPage, page); assert.equal(precise, true); calls.push("settled");
      },
    });
  return { ...functions, calls, report, entered, ready };
}

const cacheOrder = ["goto", "imports", "app-ready", "raster-ready", "settled", "assets-idle", "diagnostics", "storage"];

test("normal cache warm and revisit both await boot before the unchanged raster and cache gates", async () => {
  const h = cacheHarness({ blockReady: true });
  const warm = h.warmNormalStartupCache();
  await h.entered.promise;
  assert.deepEqual(h.calls, cacheOrder.slice(0, 3));
  assert.equal(h.report.cacheWarm, undefined);
  h.ready.resolve();
  await warm;
  assert.deepEqual(h.calls, cacheOrder);
  await h.verifyCacheRevisit();
  assert.deepEqual(h.calls, [...cacheOrder, ...cacheOrder]);
  assert.equal(h.report.revisit.diagnostics.assets.indexedDBHits, 1);
});

test("cache readiness rejection stops raster, settlement and storage checks without admitting a baseline", async () => {
  const h = cacheHarness({ blockReady: true }), failure = new Error("boot readiness timeout");
  const warm = h.warmNormalStartupCache();
  await h.entered.promise;
  h.ready.reject(failure);
  await assert.rejects(warm, error => error === failure);
  assert.deepEqual(h.calls, cacheOrder.slice(0, 3));
  assert.equal(h.report.cacheWarm, undefined);
});

test("the complete cache reload still has the existing 120-second browser watchdog", async () => {
  const action = deferred(), timers = [], cleared = [], closed = [];
  const report = { completedStages: [], timings: {} };
  const { runPhase } = loadFunctions(integrationSource, ["runPhase"], {
    performance: { now: () => 0 }, console: { log() {} }, report, scenarioId: "tno_1962", dpr: 2,
    session: { browser: { async close() { closed.push(true); } } },
    setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; },
    clearTimeout(id) { cleared.push(id); },
  });
  const phase = runPhase("cache-warm", () => action.promise);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 120000);
  timers[0].callback();
  assert.equal(closed.length, 1);
  action.resolve();
  await phase;
  assert.deepEqual(cleared, [1]);
  assert.deepEqual(report.completedStages, ["cache-warm"]);
});
