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
test("raster is eligible only after safe startup and for supported political scenarios", () => {
  const base = { requested: true, exporting: false, debugMode: "PROD", ready: true, firstVisible: true,
    readonly: false, unlocking: false, riverPartitions: false, scenarioId: "hoi4_1939" };
  for (const scenarioId of ["hoi4_1936", "hoi4_1939", "tno_1962", "modern_world"]) assert.equal(getPoliticalIdRasterEligibility({ ...base, scenarioId }), "eligible");
  for (const [patch, reason] of [[{ requested: false }, "off"], [{ scenarioId: "blank_base" }, "unsupported-scenario"],
    [{ ready: false }, "startup"], [{ firstVisible: false }, "startup"], [{ readonly: true }, "startup"],
    [{ unlocking: true }, "startup"], [{ exporting: true }, "export"], [{ riverPartitions: true }, "river-partitions"], [{ debugMode: "DEBUG" }, "debug-mode"]]) {
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
test("policy preserves explicit vector, raster and legacy hybrid preferences", () => {
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

test("automatic policy selects persistent raster only for supported, capable devices", () => {
  const defaults = { search: "", storage: policyStore({}), capable: true, deviceMemory: 4 };
  for (const scenarioId of ["hoi4_1936", "hoi4_1939", "tno_1962", "modern_world"]) {
    const policy = readPoliticalRenderPolicy({ ...defaults, scenarioId });
    assert.equal(policy.mode, "auto");
    assert.equal(policy.effectiveMode, "raster");
    assert.equal(policy.persistent, true);
    assert.equal(policy.preferenceSource, "default");
  }
  for (const patch of [{ scenarioId: "blank_base" }, { scenarioId: "do" },
    { scenarioId: "hoi4_1939", capable: false }, { scenarioId: "hoi4_1939", deviceMemory: 2 }]) {
    assert.equal(readPoliticalRenderPolicy({ ...defaults, ...patch }).effectiveMode, "vector");
  }
  assert.equal(readPoliticalRenderPolicy({ ...defaults, scenarioId: "modern_world", deviceMemory: undefined }).persistent, true);
  assert.equal(readPoliticalRenderPolicy({ ...defaults, scenarioId: "hoi4_1939",
    storage: policyStore({ "scenario-forge-political-render-mode": "vector" }) }).requested, false);
  assert.equal(readPoliticalRenderPolicy({ ...defaults, scenarioId: "hoi4_1939",
    storage: { getItem() { throw new Error("storage blocked"); } } }).persistent, true);
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
  const s = { renderPhase: "idle", zoomTransform: { x:0,y:0,k:1 } };
  const d = { effectiveMode:"raster", actualBackend:"raster", displayState:"accelerated", sourceCoverage:"complete-display-v1", view:{x:0,y:0,k:1} };
  assert.equal(residentFrameReady(s,d),true);
  for (const patch of [{actualBackend:"vector"},{displayState:"precise"},{sourceCoverage:"fine"},{pending:1},{refinementPending:true},{view:{x:1,y:0,k:1}}]) {
    assert.equal(residentFrameReady(s,{...d,...patch}),false);
  }
});


test("paired native and hybrid baselines wait for their real completed political producer", async () => {
  const { residentFrameReady } = await import("../tools/verify_political_raster_resident.mjs");
  const s = { renderPhase:"idle", zoomTransform:{x:0,y:0,k:1},
    renderPerfMetrics:{drawPoliticalBackgroundFillsPass:{progressive:true,deferredFullCacheReady:false}} };
  assert.equal(residentFrameReady(s,{effectiveMode:"vector"}),false);
  s.renderPerfMetrics.drawPoliticalBackgroundFillsPass.deferredFullCacheReady=true;
  assert.equal(residentFrameReady(s,{effectiveMode:"vector"}),true);
  assert.equal(residentFrameReady(s,{effectiveMode:"hybrid",displayState:"accelerated"}),false);
  assert.equal(residentFrameReady(s,{effectiveMode:"hybrid",displayState:"precise"}),true);
});
