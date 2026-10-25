import test from "node:test";
import assert from "node:assert/strict";
import { readPoliticalIdRasterPreference, readPoliticalRenderPolicy, writePoliticalRenderMode, writePoliticalIdRasterPreference, getPoliticalIdRasterEligibility } from "../js/core/renderer/political_id_raster_trial.js";

test("URL overrides the saved experiment without requiring storage access", () => {
  const broken = { getItem() { throw new Error("blocked"); } };
  assert.equal(readPoliticalIdRasterPreference({ search: "?political_id_raster=1", storage: broken }), true);
  assert.equal(readPoliticalIdRasterPreference({ search: "?political_id_raster=0", storage: { getItem: () => "1" } }), false);
  assert.equal(readPoliticalIdRasterPreference({ search: "", storage: broken }), false);
  assert.equal(readPoliticalIdRasterPreference({ search: "", storage: { getItem: () => "1" } }), true);
});
test("the raster is eligible once a frame is visible and only for the three supported scenarios", () => {
  const base = { requested: true, exporting: false, debugMode: "PROD", firstVisible: true,
    riverPartitions: false, scenarioId: "hoi4_1939" };
  for (const scenarioId of ["hoi4_1936", "hoi4_1939", "tno_1962"]) assert.equal(getPoliticalIdRasterEligibility({ ...base, scenarioId }), "eligible");
  for (const [patch, reason] of [[{ requested: false }, "off"], [{ scenarioId: "modern_world" }, "unsupported-scenario"],
    [{ firstVisible: false }, "startup"], [{ exporting: true }, "export"], [{ riverPartitions: true }, "river-partitions"], [{ debugMode: "DEBUG" }, "debug-mode"]]) {
    assert.equal(getPoliticalIdRasterEligibility({ ...base, ...patch }), reason);
  }
});


test("trial control persists changes and exposes translatable live status", async () => {
  const { bindPoliticalRasterTrialControl } = await import("../js/ui/toolbar/political_raster_trial_control.js");
  const target = new EventTarget();
  const original = globalThis.addEventListener;
  globalThis.addEventListener = target.addEventListener.bind(target);
  const toggle = new EventTarget(); toggle.dataset = {}; toggle.checked = false;
  const status = { dataset: {}, textContent: "" };
  let info = { requested: false, displayState: "off", reason: "off" };
  const changes = [];
  try {
    const options = { document: { getElementById: id => id === "politicalRasterTrial" ? toggle : id === "politicalRasterTrialStatus" ? status : null },
      getDiagnostics: () => info, t: value => value,
      setEnabled: value => { changes.push(value); info = { requested: value, displayState: "preparing" }; } };
    bindPoliticalRasterTrialControl(options);
    bindPoliticalRasterTrialControl(options);
    assert.equal(status.dataset.state, "off");
    toggle.checked = true; toggle.dispatchEvent(new Event("change"));
    assert.deepEqual(changes, [true]);
    assert.equal(status.dataset.i18n, "Preparing accelerated display");
    info = { requested: true, displayState: "precise" };
    target.dispatchEvent(new Event("political-id-raster-status"));
    assert.equal(status.textContent, "Precise display restored");
    assert.equal(toggle.checked, true);
  } finally { globalThis.addEventListener = original; }
});

const policyStore = values => ({ getItem: key => values[key] ?? null });
test("resident policy is explicit and defaults remain native with preserved legacy hybrid semantics", () => {
  const read = (search = "", values = {}) => readPoliticalRenderPolicy({ search, storage: policyStore(values) });
  assert.equal(read().effectiveMode, "vector");
  assert.equal(read().mode, "auto");
  assert.equal(read().automaticRasterEnabled, false);
  assert.equal(read("?political_render_mode=raster").persistent, true);
  assert.equal(read("?political_id_raster=1").effectiveMode, "hybrid");
  assert.equal(read("?political_render_mode=vector&political_id_raster=1").requested, false);
  assert.equal(read("?political_id_raster=0", { "scenario-forge-political-render-mode": "raster" }).requested, false);
  assert.equal(read("", { "scenario-forge-political-id-raster": "0" }).mode, "vector");
  assert.equal(read("", { "scenario-forge-political-id-raster": "1" }).mode, "hybrid");
  assert.equal(read("", { "scenario-forge-political-render-mode": "raster" }).persistent, true);
  const invalid = read("?political_render_mode=typo");
  assert.equal(invalid.valid, false); assert.equal(invalid.requested, false);
  const broken = { getItem() { throw Error("blocked"); } };
  assert.equal(readPoliticalRenderPolicy({ search: "?political_render_mode=raster", storage: broken }).persistent, true);
  assert.equal(readPoliticalRenderPolicy({ search: "", storage: broken }).requested, false);
});

test("TNO auto selects resident raster while other scenario auto policies remain vector", () => {
  const read = (scenarioId, search = "", values = {}) => readPoliticalRenderPolicy({ scenarioId, search, storage: policyStore(values) });
  const tno = read("tno_1962");
  assert.equal(tno.mode, "auto"); assert.equal(tno.preferenceSource, "default");
  assert.equal(tno.effectiveMode, "raster"); assert.equal(tno.requested, true);
  assert.equal(tno.persistent, true); assert.equal(tno.automaticRasterEnabled, true);
  for (const scenarioId of ["", "hoi4_1936", "hoi4_1939", "modern_world", "unknown_scenario"]) {
    const policy = read(scenarioId);
    assert.equal(policy.mode, "auto", scenarioId); assert.equal(policy.effectiveMode, "vector", scenarioId);
    assert.equal(policy.requested, false, scenarioId); assert.equal(policy.persistent, false, scenarioId);
    assert.equal(policy.automaticRasterEnabled, false, scenarioId);
  }
  assert.equal(read("tno_1962", "?political_render_mode=auto").effectiveMode, "raster");
  assert.equal(read("tno_1962", "", { "scenario-forge-political-render-mode": "auto" }).effectiveMode, "raster");
  assert.equal(read("hoi4_1939", "?political_render_mode=auto").effectiveMode, "vector");
});

test("explicit vector and legacy off override TNO automatic raster admission", () => {
  const read = (search, values = {}) => readPoliticalRenderPolicy({ scenarioId: "tno_1962", search, storage: policyStore(values) });
  for (const policy of [
    read("?political_render_mode=vector"),
    read("?political_render_mode=vector&political_id_raster=1", { "scenario-forge-political-render-mode": "raster" }),
    read("", { "scenario-forge-political-render-mode": "vector" }),
    read("?political_id_raster=0", { "scenario-forge-political-render-mode": "raster" }),
    read("", { "scenario-forge-political-id-raster": "0" }),
  ]) {
    assert.equal(policy.mode, "vector"); assert.equal(policy.effectiveMode, "vector");
    assert.equal(policy.requested, false); assert.equal(policy.persistent, false);
  }
  const blockedStorage = { getItem() { throw Error("blocked"); } };
  assert.equal(readPoliticalRenderPolicy({ scenarioId: "tno_1962", search: "?political_render_mode=vector", storage: blockedStorage }).effectiveMode, "vector");
});

test("explicit mode writes and legacy toggles cannot leave a conflicting URL preference", t => {
  const originals = Object.fromEntries(["localStorage", "location", "history"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map(); let href = "https://example.test/app/?political_id_raster=0&sample=keep";
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { get href() { return href; } } });
  Object.defineProperty(globalThis, "history", { configurable: true, value: { state: {}, replaceState: (_,__,url) => { href = String(url); } } });
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
  } });
  assert.throws(() => writePoliticalRenderMode("unsafe"), /Unknown/);
  writePoliticalRenderMode("raster");
  assert.equal(new URL(href).searchParams.get("political_render_mode"), "raster");
  assert.equal(new URL(href).searchParams.has("political_id_raster"), false);
  assert.equal(new URL(href).searchParams.get("sample"), "keep");
  writePoliticalIdRasterPreference(false);
  assert.equal(new URL(href).searchParams.has("political_render_mode"), false);
  assert.equal(values.has("scenario-forge-political-render-mode"), false);
  assert.equal(new URL(href).searchParams.get("political_id_raster"), "0");
});

test("resident readiness requires complete raster output and does not accept a native-refined substitute", async () => {
  const { residentFrameReady } = await import("../tools/verify_political_raster_resident.mjs");
  const s = { renderPhase: "idle", zoomTransform: { x:0,y:0,k:1 }, styleConfig: { countryLabels: { enabled: false } } };
  const d = { effectiveMode:"raster", actualBackend:"raster", displayState:"accelerated", sourceCoverage:"complete-display-v1", view:{x:0,y:0,k:1} };
  assert.equal(residentFrameReady(s,d),true);
  for (const patch of [{actualBackend:"vector"},{displayState:"precise"},{sourceCoverage:"fine"},{pending:1},{refinementPending:true},{view:{x:1,y:0,k:1}}]) {
    assert.equal(residentFrameReady(s,{...d,...patch}),false);
  }
});

test("direct resident readiness rejects staged candidates, retained publications and overview feedback", async () => {
  const { residentFrameReady } = await import("../tools/verify_political_raster_resident.mjs");
  const s = { renderPhase: "idle", zoomTransform: { x: 0, y: 0, k: 1 }, styleConfig: { countryLabels: { enabled: false } } };
  const d = { effectiveMode: "raster", actualBackend: "raster", displayState: "accelerated",
    sourceCoverage: "complete-display-v1", view: { ...s.zoomTransform }, directPresentation: true,
    stagedPending: false, publishedFrame: { state: "published" },
    scene: { active: true, presentationState: "published", usingOverview: false } };
  assert.equal(residentFrameReady(s, d), true);
  for (const patch of [{ stagedPending: true }, { publishedFrame: { state: "retained" } }, { publishedFrame: null },
    { scene: { ...d.scene, usingOverview: true } }, { scene: { ...d.scene, presentationState: "retained" } },
    { scene: { ...d.scene, active: false } }, { scene: null }]) {
    assert.equal(residentFrameReady(s, { ...d, ...patch }), false, JSON.stringify(patch));
  }
  assert.equal(residentFrameReady(s, { ...d, directPresentation: false, stagedPending: true,
    publishedFrame: null, scene: null }), true, "non-direct producers keep their existing completion gates");
});


test("paired native and hybrid baselines wait for their real completed political producer", async () => {
  const { residentFrameReady } = await import("../tools/verify_political_raster_resident.mjs");
  const s = { renderPhase:"idle", zoomTransform:{x:0,y:0,k:1}, styleConfig: { countryLabels: { enabled: false } },
    renderPerfMetrics:{drawPoliticalBackgroundFillsPass:{progressive:true,deferredFullCacheReady:false}} };
  assert.equal(residentFrameReady(s,{effectiveMode:"vector"}),false);
  s.renderPerfMetrics.drawPoliticalBackgroundFillsPass.deferredFullCacheReady=true;
  assert.equal(residentFrameReady(s,{effectiveMode:"vector"}),true);
  assert.equal(residentFrameReady(s,{effectiveMode:"hybrid",displayState:"accelerated"}),false);
  assert.equal(residentFrameReady(s,{effectiveMode:"hybrid",displayState:"precise"}),true);
});

test("the saved policy is read once and refreshed by local writes, other tabs and a replaced store", async t => {
  const originals = Object.fromEntries(["localStorage", "location", "history", "addEventListener"]
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const listeners = [];
  Object.defineProperty(globalThis, "addEventListener", { configurable: true, value: (type, listener) => listeners.push({ type, listener }) });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "", href: "https://example.test/app/" } });
  Object.defineProperty(globalThis, "history", { configurable: true, value: { state: {}, replaceState() {} } });
  const createStore = values => {
    const store = { reads: 0, getItem: key => { store.reads++; return values.get(key) ?? null; },
      setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
    return store;
  };
  const values = new Map([["scenario-forge-political-render-mode", "vector"]]);
  let store = createStore(values);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => store });
  const policy = await import(`../js/core/renderer/political_id_raster_trial.js?fresh=${Date.now()}`);
  const mode = () => policy.readPoliticalRenderPolicy({ scenarioId: "tno_1962" }).effectiveMode;

  assert.equal(mode(), "vector");
  assert.equal(mode(), "vector");
  assert.equal(store.reads, 1, "repeated reads reuse the saved preference");

  policy.writePoliticalRenderMode("hybrid");
  assert.equal(mode(), "hybrid", "a local write refreshes the next read");

  values.set("scenario-forge-political-render-mode", "vector");
  const storage = listeners.filter(entry => entry.type === "storage");
  assert.equal(storage.length, 1);
  storage[0].listener({ key: "unrelated" });
  assert.equal(mode(), "hybrid", "unrelated keys keep the cached preference");
  storage[0].listener({ key: "scenario-forge-political-render-mode" });
  assert.equal(mode(), "vector", "another tab's write refreshes the next read");

  store = createStore(new Map([["scenario-forge-political-id-raster", "1"]]));
  assert.equal(mode(), "hybrid", "a replaced store is read afresh");
  assert.equal(policy.readPoliticalRenderPolicy({ scenarioId: "tno_1962", storage: policyStore({}) }).effectiveMode, "raster",
    "an explicit store bypasses the cache");
});
