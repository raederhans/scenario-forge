import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createThematicWgiOwner } from "../js/ui/toolbar/thematic_wgi_owner.js";
import { getThematicWgiFeatureInspection, normalizeThematicWgiStyle } from "../js/core/thematic_wgi_view_model.js";
import { THEMATIC_WGI_SCENARIO_IDS } from "../js/core/thematic_wgi_data.js";
import { THEMATIC_INDICATORS, getThematicIndicator } from "../js/core/thematic_indicator_catalog.js";
import { UI_COPY_CATALOG } from "../js/core/i18n_catalog.js";
import { ensureThematicWgiData } from "../js/core/thematic_wgi_runtime.js";
import { resetThematicWgiRuntimeState } from "../js/core/state/actions/thematic_wgi_actions.js";
import {
  callRuntimeHook, emitStateBusEvent, STATE_BUS_EVENTS,
  readRegisteredRuntimeHookSource, registerRuntimeHook,
} from "../js/core/state/index.js";

class TestElement {
  constructor() {
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.children = [];
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), handler]);
  }
  dispatch(type) {
    for (const handler of this.listeners.get(type) || []) handler({ target: this });
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) {
    this.children = children.flatMap((child) => child.fragment ? child.children : [child]);
  }
  setAttribute(key, value) { this[key] = value; }
}

const NODE_IDS = [
  "toggleThematicWgi", "thematicWgiStatus", "thematicWgiRetry",
  "thematicWgiLegend", "thematicWgiCoverage", "thematicWgiMetric", "thematicWgiReferenceNote",
];
const METRIC_IDS = THEMATIC_INDICATORS.map((metric) => metric.id);
const [GE, RL] = METRIC_IDS;
const HISTORICAL_SCENARIOS = ["hoi4_1936", "hoi4_1939", "tno_1962"];
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function createHarness(overrides = {}, options = {}) {
  const nodes = Object.fromEntries(NODE_IDS.map((id) => [id, new TestElement()]));
  const loads = [];
  const dirty = [];
  const refreshes = [];
  const legends = [];
  let persists = 0;
  const state = {
    activeScenarioId: "modern_world",
    styleConfig: {},
    strategicChoroplethMetric: "steel",
    featureColorOverrides: { country: "#abcdef" },
    persistViewSettingsFn: () => { persists += 1; },
    ...overrides,
  };
  const owner = createThematicWgiOwner({
    runtimeState: state,
    documentRef: {
      getElementById: (id) => nodes[id] || null,
      createElement: () => new TestElement(),
      createDocumentFragment: () => Object.assign(new TestElement(), { fragment: true }),
    },
    t: (key, namespace) => { assert.equal(namespace, "ui"); return options.translate?.(key, state) ?? key; },
    markDirty: (reason) => dirty.push(reason),
    refreshColorState: (value) => refreshes.push(value),
    showLegend: () => legends.push(true),
    ensureData: options.ensureData || ((target, request) => {
      const selection = normalizeThematicWgiStyle(target.styleConfig?.thematic);
      loads.push({ ...request, metricId: selection.metricId });
      target.thematicWgiRuntime = { ...target.thematicWgiRuntime, status: "loading" };
      request.onChange();
      return Promise.resolve().then(() => {
        target.thematicWgiRuntime = {
          ...target.thematicWgiRuntime,
          status: options.fail ? "failed" : "ready",
          data: options.fail ? null : { ...selection, supportedScenarios: THEMATIC_WGI_SCENARIO_IDS, ...options.payload },
          error: options.fail ? "Network unavailable" : "",
        };
        request.onChange();
      });
    }),
  });
  return { state, nodes, owner, loads, dirty, refreshes, legends, persists: () => persists };
}

test("WGI checkbox enables via state actions and preserves base paint", async () => {
  const h = createHarness();
  const basePaint = h.state.featureColorOverrides;
  h.owner.render();
  assert.equal(h.nodes.toggleThematicWgi.checked, false);
  assert.equal(h.nodes.toggleThematicWgi.disabled, false);
  h.nodes.toggleThematicWgi.checked = true;
  h.nodes.toggleThematicWgi.dispatch("change");
  assert.deepEqual(h.state.styleConfig.thematic, normalizeThematicWgiStyle({ enabled: true }));
  assert.equal(h.state.strategicChoroplethMetric, "");
  assert.equal(h.nodes.toggleThematicWgi.checked, true);
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Loading indicator data…");
  await flush();
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Indicator data loaded.");
  assert.equal(h.loads.length, 1);
  assert.equal(h.legends.length, 1);
  assert.equal(h.persists(), 1);
  assert.deepEqual(h.dirty, ["toggle-thematic-wgi"]);
  assert.ok(h.refreshes.every((request) => request.renderNow === true));
  assert.strictEqual(h.state.featureColorOverrides, basePaint);
  assert.deepEqual(basePaint, { country: "#abcdef" });
  assert.equal(h.nodes.thematicWgiReferenceNote.hidden, true);
  assert.equal(h.nodes.thematicWgiReferenceNote.textContent, "");
});

test("all supported historical scenarios enable and label their modern reference coverage", async () => {
  for (const activeScenarioId of HISTORICAL_SCENARIOS) {
    const h = createHarness({ activeScenarioId,
      landData: { features: [{ type: "Feature", id: "sample", properties: { ISO_A3: "FRA" } }] },
      scenarioBaselineOwnersByFeatureId: { sample: "GER" },
      scenarioCountriesByTag: { GER: { base_iso2: "DE" } },
    }, { payload: { byIsoA3: { DEU: { status: "value", value: 80 } } } });
    h.owner.render();
    assert.equal(h.nodes.toggleThematicWgi.disabled, false, activeScenarioId);
    assert.equal(h.nodes.thematicWgiReferenceNote.hidden, false);
    assert.equal(h.nodes.thematicWgiReferenceNote.textContent,
      "2024 reference mapping, not a measurement for the scenario year.");
    h.nodes.toggleThematicWgi.checked = true;
    h.nodes.toggleThematicWgi.dispatch("change");
    await flush();
    assert.equal(h.nodes.thematicWgiStatus.textContent, "Indicator data loaded.");
    assert.equal(h.nodes.thematicWgiLegend.hidden, false);
    assert.equal(h.nodes.thematicWgiCoverage.textContent,
      "Scenario countries mapped: 1 · Source missing: 0 · Unmatched: 0");
    assert.equal(h.loads.length, 1);
    assert.equal(h.persists(), 1);
    assert.deepEqual(h.dirty, ["toggle-thematic-wgi"]);
  }
});

test("historical saved selections restore without rewriting and support all metric switches", async () => {
  for (const activeScenarioId of HISTORICAL_SCENARIOS) {
    for (const metricId of METRIC_IDS) {
      const selection = normalizeThematicWgiStyle({ enabled: true, metricId });
      const h = createHarness({ activeScenarioId, styleConfig: { thematic: selection } });
      h.owner.render();
      await flush();
      h.owner.render();
      assert.strictEqual(h.state.styleConfig.thematic, selection);
      assert.equal(h.nodes.thematicWgiMetric.value, metricId);
      assert.equal(h.nodes.thematicWgiLegend.hidden, false);
      assert.equal(h.loads.length, 1);
      assert.equal(h.persists(), 0);
      assert.deepEqual(h.dirty, []);
      const nextMetric = METRIC_IDS[(METRIC_IDS.indexOf(metricId) + 1) % METRIC_IDS.length];
      h.nodes.thematicWgiMetric.value = nextMetric;
      h.nodes.thematicWgiMetric.dispatch("change");
      assert.equal(h.nodes.thematicWgiLegend.hidden, true);
      assert.equal(h.nodes.thematicWgiCoverage.hidden, true);
      await flush();
      assert.equal(h.state.thematicWgiRuntime.data.metricId, nextMetric);
      assert.equal(h.nodes.thematicWgiLegend.hidden, false);
      assert.equal(h.loads.length, 2);
      assert.equal(h.persists(), 1);
      assert.deepEqual(h.dirty, ["select-thematic-wgi-metric"]);
    }
  }
});

test("switching between modern and historical maps refreshes coverage copy without changing selection", async () => {
  const selection = normalizeThematicWgiStyle({ enabled: true, metricId: RL });
  const h = createHarness({ currentLanguage: "zh", styleConfig: { thematic: selection } }, {
    translate: (key, state) => UI_COPY_CATALOG[key]?.[state.currentLanguage] ?? key,
  });
  h.owner.render();
  await flush();
  for (const scenarioId of [...HISTORICAL_SCENARIOS, "modern_world"]) {
    h.state.activeScenarioId = scenarioId;
    h.owner.render();
    const historical = scenarioId !== "modern_world";
    assert.strictEqual(h.state.styleConfig.thematic, selection);
    assert.equal(h.nodes.thematicWgiLegend.hidden, false);
    assert.equal(h.nodes.thematicWgiReferenceNote.hidden, !historical);
    assert.equal(h.nodes.thematicWgiReferenceNote.textContent,
      historical ? "2024 参考映射，非剧本年代测量值。" : "");
    assert.equal(h.nodes.thematicWgiCoverage.textContent,
      `${historical ? "场景国家已匹配" : "已匹配"}: 0 · 来源缺失: 0 · 未匹配: 0`);
  }
  assert.equal(h.loads.length, 1);
  assert.equal(h.persists(), 0);
  assert.deepEqual(h.dirty, []);
});

test("WGI remains unavailable to enable on unsupported basemaps", () => {
  const h = createHarness({ activeScenarioId: "blank_base" });
  h.owner.render();
  assert.equal(h.nodes.toggleThematicWgi.disabled, true);
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Country indicators are not supported on the current basemap.");
  h.nodes.toggleThematicWgi.checked = true;
  h.nodes.toggleThematicWgi.dispatch("change");
  assert.equal(h.nodes.toggleThematicWgi.checked, false);
  assert.equal(h.state.styleConfig.thematic, undefined);
  assert.equal(h.state.strategicChoroplethMetric, "steel");
  assert.equal(h.loads.length, 0);
  assert.equal(h.nodes.thematicWgiReferenceNote.hidden, true);
});

test("saved enabled selection is suspended on unsupported basemaps and can be turned off", () => {
  const h = createHarness({
    activeScenarioId: "blank_base",
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) },
  });
  h.owner.render();
  assert.equal(h.nodes.toggleThematicWgi.checked, true);
  assert.equal(h.nodes.toggleThematicWgi.disabled, false);
  assert.equal(h.loads.length, 0);
  assert.equal(h.nodes.thematicWgiLegend.hidden, true);
  h.nodes.toggleThematicWgi.checked = false;
  h.nodes.toggleThematicWgi.dispatch("change");
  assert.equal(h.state.styleConfig.thematic.enabled, false);
  assert.equal(h.nodes.toggleThematicWgi.disabled, true);
});

test("restoring enabled Modern World selection loads once and renders score bins and coverage", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } });
  h.owner.render();
  h.owner.render();
  await flush();
  h.owner.render();
  assert.equal(h.loads.length, 1);
  assert.equal(h.nodes.toggleThematicWgi.checked, true);
  assert.deepEqual(h.dirty, []);
  assert.equal(h.nodes.thematicWgiLegend.hidden, false);
  const rows = h.nodes.thematicWgiLegend.children.filter((node) => node.className === "map-legend-row");
  assert.deepEqual(rows.map((row) => row.children[1].textContent), [
    "0–<20", "20–<40", "40–<60", "60–<80", "80–100", "Source missing", "Unmatched / not covered",
  ]);
  assert.equal(h.nodes.thematicWgiCoverage.textContent, "Mapped: 0 · Source missing: 0 · Unmatched: 0");
  assert.equal(h.nodes.thematicWgiRetry.hidden, true);
});

test("failed loading exposes explicit retry and does not automatically retry", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } }, { fail: true });
  h.owner.render();
  await flush();
  h.owner.render();
  assert.equal(h.loads.length, 1);
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Indicator data could not be loaded. Retry.");
  assert.equal(h.nodes.thematicWgiRetry.hidden, false);
  assert.equal(h.nodes.thematicWgiRetry.disabled, false);
  h.nodes.thematicWgiRetry.dispatch("click");
  assert.equal(h.loads.length, 2);
  assert.equal(h.loads[1].retry, true);
  assert.equal(h.nodes.thematicWgiRetry.hidden, true);
  await flush();
  assert.equal(h.nodes.thematicWgiRetry.hidden, false);
  assert.deepEqual(h.dirty, []);
});

test("unavailable stored version stays unchanged until explicit off then on", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, dataVersion: "old-version" }) } });
  h.owner.render();
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Saved indicator data version is unavailable.");
  assert.equal(h.loads.length, 0);
  assert.equal(h.state.styleConfig.thematic.dataVersion, "old-version");
  h.nodes.toggleThematicWgi.checked = false;
  h.nodes.toggleThematicWgi.dispatch("change");
  assert.equal(h.state.styleConfig.thematic.dataVersion, "old-version");
  h.nodes.toggleThematicWgi.checked = true;
  h.nodes.toggleThematicWgi.dispatch("change");
  await flush();
  assert.equal(h.state.styleConfig.thematic.dataVersion, normalizeThematicWgiStyle().dataVersion);
  assert.equal(h.loads.length, 1);
});

test("disabling clears visible legend and preserves other settings with one event binding", async () => {
  const h = createHarness({
    styleConfig: { ocean: { color: "#112233" }, thematic: normalizeThematicWgiStyle({ enabled: true }) },
  });
  h.owner.bindEvents();
  h.owner.bindEvents();
  h.owner.render();
  await flush();
  assert.equal(h.nodes.toggleThematicWgi.listeners.get("change").length, 1);
  h.nodes.toggleThematicWgi.checked = false;
  h.nodes.toggleThematicWgi.dispatch("change");
  assert.equal(h.state.styleConfig.thematic.enabled, false);
  assert.deepEqual(h.state.styleConfig.ocean, { color: "#112233" });
  assert.equal(h.nodes.thematicWgiLegend.hidden, true);
  assert.deepEqual(h.nodes.thematicWgiLegend.children, []);
  assert.equal(h.nodes.thematicWgiCoverage.hidden, true);
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Thematic layer is off.");
});

test("changing scenario hides legend and retry without losing enabled selection", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } });
  h.owner.render();
  await flush();
  h.state.activeScenarioId = "blank_base";
  h.owner.render();
  assert.equal(h.nodes.toggleThematicWgi.checked, true);
  assert.equal(h.nodes.thematicWgiLegend.hidden, true);
  assert.equal(h.nodes.thematicWgiCoverage.hidden, true);
  assert.equal(h.nodes.thematicWgiRetry.hidden, true);
  assert.equal(h.loads.length, 1);
});

test("real WGI runtime callbacks drive loading, failure, and successful retry", async () => {
  let attempts = 0;
  let pending;
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } }, {
    ensureData: (state, options) => {
      pending = ensureThematicWgiData(state, {
        ...options,
        loadData: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("Network unavailable");
          return normalizeThematicWgiStyle();
        },
      });
      return pending;
    },
  });
  h.owner.render();
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Loading indicator data…");
  assert.deepEqual(h.dirty, []);
  await pending;
  assert.equal(h.nodes.thematicWgiRetry.hidden, false);
  assert.equal(h.state.thematicWgiRuntime.status, "failed");
  assert.deepEqual(h.dirty, []);
  await h.owner.retry();
  assert.equal(attempts, 2);
  assert.equal(h.state.thematicWgiRuntime.status, "ready");
  assert.equal(h.nodes.thematicWgiLegend.hidden, false);
  assert.equal(h.nodes.thematicWgiRetry.hidden, true);
  assert.deepEqual(h.dirty, []);
  assert.equal(h.persists(), 0);
});

test("final country-index flush refreshes restored WGI coverage through the existing appearance hook", () => {
  const feature = (code) => ({ type: "Feature", id: code, properties: { ISO_A3: code } });
  const h = createHarness({
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) },
    thematicWgiRuntime: { status: "ready", data: { ...normalizeThematicWgiStyle(),
      byIsoA3: { AAA: { status: "value", value: 20 }, BBB: { status: "value", value: 40 } } } },
    landData: { features: [feature("AAA"), feature("ZZZ")] },
  });
  h.owner.render();
  assert.equal(h.nodes.thematicWgiCoverage.textContent, "Mapped: 1 · Source missing: 0 · Unmatched: 1");
  const rendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
  const flushStart = rendererSource.indexOf("function flushPendingIndexUiRefresh() {");
  const flushEnd = rendererSource.indexOf("\nfunction scheduleIndexUiRefresh(", flushStart);
  const toolbarSource = readFileSync(new URL("../js/ui/toolbar.js", import.meta.url), "utf8");
  const hookStart = toolbarSource.indexOf("  function renderSpecialZoneEditorUI() {");
  const hookEnd = toolbarSource.indexOf("  registerRuntimeHook(state, \"updateSpecialZoneEditorUIFn\"", hookStart);
  assert.ok(flushStart >= 0 && flushEnd > flushStart && hookStart >= 0 && hookEnd > hookStart);
  let appearanceRefreshes = 0;
  let countryRefreshes = 0;
  const context = vm.createContext({
    runtimeState: h.state,
    pendingIndexUiRefreshHandle: 1,
    pendingIndexUiRefreshState: { renderCountryList: true },
    recordUiRefreshMetric() {}, callRuntimeHook,
    toggleWaterRegions: null, toggleOpenOceanRegions: null,
    renderAppearanceStyleControlsUi: () => { appearanceRefreshes += 1; h.owner.render(); },
    specialZoneEditorController: { renderSpecialZoneEditorUI() {} },
    specialZonesWorkbenchController: { renderSpecialZonesWorkbenchUi() {} }, updateToolUI() {},
  });
  vm.runInContext(`${rendererSource.slice(flushStart, flushEnd)}
    ${toolbarSource.slice(hookStart, hookEnd)}
    this.flush = flushPendingIndexUiRefresh; this.refreshPanel = renderSpecialZoneEditorUI;`, context);
  const oldPanelHook = readRegisteredRuntimeHookSource(h.state, "updateSpecialZoneEditorUIFn");
  const oldCountryHook = readRegisteredRuntimeHookSource(h.state, "renderCountryListFn");
  registerRuntimeHook(h.state, "updateSpecialZoneEditorUIFn", context.refreshPanel);
  registerRuntimeHook(h.state, "renderCountryListFn", () => { countryRefreshes += 1; });
  try {
    h.state.landDataFull = { features: [feature("AAA"), feature("BBB"), feature("ZZZ")] };
    assert.equal(h.nodes.thematicWgiCoverage.textContent, "Mapped: 1 · Source missing: 0 · Unmatched: 1");
    context.flush();
    assert.equal(h.nodes.thematicWgiCoverage.textContent, "Mapped: 2 · Source missing: 0 · Unmatched: 1");
    assert.equal(appearanceRefreshes, 1);
    assert.equal(countryRefreshes, 1);
    assert.equal(context.pendingIndexUiRefreshHandle, null);
    assert.equal(context.pendingIndexUiRefreshState, null);
    assert.equal(h.loads.length, 0);
    assert.deepEqual(h.dirty, []);
    assert.deepEqual(h.refreshes, []);
    context.pendingIndexUiRefreshState = { renderWaterRegionList: true };
    context.flush();
    assert.equal(appearanceRefreshes, 1, "water-only updates do not refresh appearance");
    h.state.styleConfig.thematic.enabled = false;
    context.pendingIndexUiRefreshState = { renderCountryList: true };
    context.flush();
    assert.equal(appearanceRefreshes, 1, "disabled WGI does not add appearance work");
    assert.equal(countryRefreshes, 2);
  } finally {
    registerRuntimeHook(h.state, "updateSpecialZoneEditorUIFn", oldPanelHook);
    registerRuntimeHook(h.state, "renderCountryListFn", oldCountryHook);
  }
});

for (const outcome of ["applied", "rolled back"]) {
  test(`final scenario UI sync restores enabled WGI after ${outcome === "applied" ? "successful apply" : "rollback"}`, async () => {
    const sample = { type: "Feature", id: "sample", properties: { ISO_A2: "PL" } };
    const requests = [];
    let pending;
    const h = createHarness({
      activeScenarioId: "tno_1962",
      styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) },
      landData: { features: [sample] },
      scenarioBaselineOwnersByFeatureId: { sample: "WRS" },
      scenarioCountriesByTag: { WRS: { base_iso2: "RU" } },
      latestScenarioApplyRequestId: 1, currentScenarioApplyRequestId: null,
    }, {
      ensureData: (state, options) => {
        pending = ensureThematicWgiData(state, { ...options, loadData: async (request) => {
          requests.push(request);
          return { ...normalizeThematicWgiStyle({ metricId: request.metricId }),
            supportedScenarios: THEMATIC_WGI_SCENARIO_IDS,
            byIsoA3: { RUS: { status: "value", value: 80, joinKey: "RUS" },
              DEU: { status: "value", value: 40, joinKey: "DEU" } } };
        } });
        return pending;
      },
    });
    const syncSource = readFileSync(new URL("../js/core/scenario_ui_sync.js", import.meta.url), "utf8");
    const syncStart = syncSource.indexOf("export function syncScenarioUi() {");
    const syncEnd = syncSource.indexOf("\nexport function syncCountryUi(", syncStart);
    const toolbarSource = readFileSync(new URL("../js/ui/toolbar.js", import.meta.url), "utf8");
    const hookStart = toolbarSource.indexOf("  function renderSpecialZoneEditorUI() {");
    const hookEnd = toolbarSource.indexOf("  registerRuntimeHook(state, \"updateSpecialZoneEditorUIFn\"", hookStart);
    assert.ok(syncStart >= 0 && syncEnd > syncStart && hookStart >= 0 && hookEnd > hookStart);
    let appearanceRefreshes = 0;
    const context = vm.createContext({
      runtimeState: h.state, emitStateBusEvent, STATE_BUS_EVENTS,
      toggleWaterRegions: null, toggleOpenOceanRegions: null,
      renderAppearanceStyleControlsUi: () => { appearanceRefreshes += 1; h.owner.render(); },
      specialZoneEditorController: { renderSpecialZoneEditorUI() {} },
      specialZonesWorkbenchController: { renderSpecialZonesWorkbenchUi() {} }, updateToolUI() {},
    });
    vm.runInContext(`${syncSource.slice(syncStart, syncEnd).replace("export function", "function")}
      ${toolbarSource.slice(hookStart, hookEnd)}
      this.sync = syncScenarioUi; this.refreshPanel = renderSpecialZoneEditorUI;`, context);
    const oldHook = readRegisteredRuntimeHookSource(h.state, "updateSpecialZoneEditorUIFn");
    registerRuntimeHook(h.state, "updateSpecialZoneEditorUIFn", context.refreshPanel);
    try {
      h.owner.render();
      await pending;
      assert.equal(h.state.thematicWgiRuntime.status, "ready");
      assert.equal(getThematicWgiFeatureInspection(h.state, sample).joinKey, "RUS");
      assert.equal(h.nodes.thematicWgiLegend.hidden, false);

      h.state.scenarioApplyInFlight = true;
      h.state.latestScenarioApplyRequestId = h.state.currentScenarioApplyRequestId = 2;
      h.state.activeScenarioId = "hoi4_1939";
      h.state.scenarioBaselineOwnersByFeatureId = { sample: "GER" };
      h.state.scenarioCountriesByTag = { GER: { base_iso2: "DE" } };
      resetThematicWgiRuntimeState(h.state);
      h.owner.render();
      await pending;
      context.sync();
      assert.equal(requests.length, 1, "apply lock does not start a WGI load");
      assert.equal(appearanceRefreshes, 0, "locked UI sync does not add appearance work");
      assert.equal(h.state.thematicWgiRuntime.status, "idle");
      assert.equal(h.nodes.thematicWgiLegend.hidden, true);
      assert.equal(getThematicWgiFeatureInspection(h.state, sample), null);

      if (outcome === "rolled back") {
        h.state.activeScenarioId = "tno_1962";
        h.state.scenarioBaselineOwnersByFeatureId = { sample: "WRS" };
        h.state.scenarioCountriesByTag = { WRS: { base_iso2: "RU" } };
      }
      h.state.scenarioApplyInFlight = false;
      h.state.currentScenarioApplyRequestId = null;
      context.sync();
      await pending;
      assert.equal(appearanceRefreshes, 1);
      assert.equal(requests.length, 2, "final sync automatically starts the eligible request");
      assert.equal(requests[1].scenarioId, outcome === "applied" ? "hoi4_1939" : "tno_1962");
      assert.equal(h.state.thematicWgiRuntime.status, "ready");
      assert.equal(h.nodes.thematicWgiStatus.textContent, "Indicator data loaded.");
      assert.equal(h.nodes.thematicWgiLegend.hidden, false);
      assert.equal(h.nodes.thematicWgiCoverage.hidden, false);
      assert.equal(h.nodes.thematicWgiCoverage.textContent,
        "Scenario countries mapped: 1 · Source missing: 0 · Unmatched: 0");
      const observation = getThematicWgiFeatureInspection(h.state, sample);
      assert.equal(observation.joinKey, outcome === "applied" ? "DEU" : "RUS");
      assert.equal(observation.value, outcome === "applied" ? 40 : 80);
      assert.equal(observation.scenarioTag, outcome === "applied" ? "GER" : "WRS");
      assert.equal(h.persists(), 0);
      assert.deepEqual(h.dirty, []);

      h.state.styleConfig.thematic.enabled = false;
      context.sync();
      assert.equal(appearanceRefreshes, 1, "disabled WGI does not add appearance work");
      assert.equal(requests.length, 2);
    } finally {
      registerRuntimeHook(h.state, "updateSpecialZoneEditorUIFn", oldHook);
    }
  });
}

test("legend nodes are reused until shared legend content changes", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } });
  h.owner.render();
  await flush();
  const firstRow = h.nodes.thematicWgiLegend.children[0];
  h.owner.render();
  assert.strictEqual(h.nodes.thematicWgiLegend.children[0], firstRow);
  h.state.currentLanguage = "zh";
  h.owner.render();
  assert.notStrictEqual(h.nodes.thematicWgiLegend.children[0], firstRow);
  assert.equal(h.nodes.thematicWgiLegend.children[5].children[1].textContent, "来源缺失");
  assert.equal(h.nodes.thematicWgiLegend.children.length, 9);
});

test("metric select offers all official metrics with an accessible HTML label", () => {
  const h = createHarness();
  h.owner.render();
  assert.equal(h.nodes.thematicWgiMetric.value, GE);
  assert.deepEqual(h.nodes.thematicWgiMetric.children.map((option) => [option.value, option.textContent]),
    THEMATIC_INDICATORS.map((metric) => [metric.id, metric.labelEn]));
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<label for="thematicWgiMetric"[^>]*data-i18n="Indicator"/);
  assert.match(html, /<span data-i18n="Show thematic shading">Show thematic shading<\/span>/);
  assert.match(html, /<select id="thematicWgiMetric" class="select-input" aria-describedby="thematicWgiStatus"/);
  assert.match(html, /id="thematicWgiTitle" data-i18n="Country indicators"/);
  assert.match(html, /id="thematicWgiReferenceNote" class="city-points-advanced-hint" hidden/);
});

test("switching enabled metrics hides old data and loads the selected metric with one persisted dirty change", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } });
  h.owner.bindEvents();
  h.owner.render();
  await flush();
  h.nodes.thematicWgiMetric.value = GE;
  h.nodes.thematicWgiMetric.dispatch("change");
  assert.equal(h.loads.length, 1, "unchanged supported selection does not reload");
  for (const metricId of [...METRIC_IDS.filter((id) => id !== GE), GE]) {
    const descriptor = THEMATIC_INDICATORS.find((metric) => metric.id === metricId);
    const previousLoads = h.loads.length;
    h.nodes.thematicWgiMetric.value = metricId;
    h.nodes.thematicWgiMetric.dispatch("change");
    assert.equal(h.state.styleConfig.thematic.metricId, metricId);
    assert.equal(h.state.styleConfig.thematic.enabled, true);
    assert.equal(h.state.styleConfig.thematic.layerId, descriptor.layerId);
    assert.equal(h.state.styleConfig.thematic.dataVersion, descriptor.dataVersion);
    assert.equal(h.nodes.thematicWgiLegend.hidden, true);
    assert.equal(h.nodes.thematicWgiCoverage.hidden, true);
    assert.equal(h.loads.length, previousLoads + 1);
    assert.equal(h.loads.at(-1).metricId, metricId);
    await flush();
    assert.equal(h.state.thematicWgiRuntime.data.metricId, metricId);
    assert.equal(h.nodes.thematicWgiLegend.hidden, false);
  }
  assert.deepEqual(h.dirty, METRIC_IDS.map(() => "select-thematic-wgi-metric"));
  assert.equal(h.persists(), METRIC_IDS.length);
  assert.equal(h.nodes.thematicWgiMetric.listeners.get("change").length, 1);
  assert.equal(h.persists(), METRIC_IDS.length);
});

test("disabled metric change stays lazy and enabling preserves the selected indicator", async () => {
  const h = createHarness();
  h.owner.render();
  h.nodes.thematicWgiMetric.value = RL;
  h.nodes.thematicWgiMetric.dispatch("change");
  assert.equal(h.state.styleConfig.thematic.enabled, false);
  assert.equal(h.state.styleConfig.thematic.metricId, RL);
  assert.equal(h.loads.length, 0);
  h.nodes.toggleThematicWgi.checked = true;
  h.nodes.toggleThematicWgi.dispatch("change");
  await flush();
  assert.equal(h.state.styleConfig.thematic.metricId, RL);
  assert.equal(h.loads[0].metricId, RL);
  assert.equal(h.persists(), 2);
  assert.deepEqual(h.dirty, ["select-thematic-wgi-metric", "toggle-thematic-wgi"]);
});

test("UNDP and population indicators switch families, stay lazy while off, and restore their layer identity", async () => {
  const wgiLayerId = getThematicIndicator(GE).layerId;
  const otherMetrics = THEMATIC_INDICATORS.filter((metric) => metric.layerId !== wgiLayerId);
  assert.equal(otherMetrics.length, 10);
  for (const descriptor of otherMetrics) {
    const h = createHarness();
    h.owner.render();
    h.nodes.thematicWgiMetric.value = descriptor.id;
    h.nodes.thematicWgiMetric.dispatch("change");
    assert.equal(h.state.styleConfig.thematic.enabled, false);
    assert.equal(h.state.styleConfig.thematic.layerId, descriptor.layerId);
    assert.equal(h.state.styleConfig.thematic.dataVersion, descriptor.dataVersion);
    assert.equal(h.loads.length, 0);

    h.nodes.toggleThematicWgi.checked = true;
    h.nodes.toggleThematicWgi.dispatch("change");
    await flush();
    assert.equal(h.state.thematicWgiRuntime.data.metricId, descriptor.id);
    assert.equal(h.state.styleConfig.thematic.layerId, descriptor.layerId);
    assert.equal(h.state.styleConfig.thematic.dataVersion, descriptor.dataVersion);

    h.nodes.toggleThematicWgi.checked = false;
    h.nodes.toggleThematicWgi.dispatch("change");
    assert.equal(h.state.styleConfig.thematic.enabled, false);
    assert.equal(h.state.styleConfig.thematic.metricId, descriptor.id);
    assert.equal(h.state.styleConfig.thematic.layerId, descriptor.layerId);
    h.nodes.toggleThematicWgi.checked = true;
    h.nodes.toggleThematicWgi.dispatch("change");
    await flush();
    assert.equal(h.state.thematicWgiRuntime.data.metricId, descriptor.id);
    assert.equal(h.loads.length, 2);
  }
});

test("supported saved metrics restore without dirtying or rewriting the selection", async () => {
  for (const metricId of METRIC_IDS) {
    const selection = normalizeThematicWgiStyle({ enabled: true, metricId });
    const h = createHarness({ styleConfig: { thematic: selection } });
    h.owner.render();
    await flush();
    assert.strictEqual(h.state.styleConfig.thematic, selection);
    assert.equal(h.nodes.thematicWgiMetric.value, metricId);
    assert.equal(h.loads[0].metricId, metricId);
    assert.equal(h.persists(), 0);
    assert.deepEqual(h.dirty, []);
  }
});

test("unsupported basemap metric changes preserve selection and load when returning to Modern World", async () => {
  const h = createHarness({ activeScenarioId: "blank_base",
    styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } });
  h.owner.render();
  h.nodes.thematicWgiMetric.value = RL;
  h.nodes.thematicWgiMetric.dispatch("change");
  h.owner.render();
  assert.equal(h.state.styleConfig.thematic.metricId, RL);
  assert.equal(h.state.styleConfig.thematic.enabled, true);
  assert.equal(h.loads.length, 0);
  assert.equal(h.nodes.thematicWgiLegend.hidden, true);
  h.state.activeScenarioId = "modern_world";
  h.owner.render();
  await flush();
  assert.equal(h.loads.length, 1);
  assert.equal(h.loads[0].metricId, RL);
  assert.equal(h.persists(), 1);
});

test("unknown saved metric is visible and unchanged until an explicit supported choice", async () => {
  const selection = normalizeThematicWgiStyle({ enabled: true, metricId: "future-metric", dataVersion: "future-version" });
  const h = createHarness({ styleConfig: { thematic: selection } });
  h.owner.render();
  h.owner.render();
  assert.strictEqual(h.state.styleConfig.thematic, selection);
  assert.equal(h.nodes.thematicWgiMetric.value, "future-metric");
  assert.equal(h.nodes.thematicWgiMetric.children[0].disabled, true);
  assert.equal(h.nodes.thematicWgiMetric.children[0].textContent, "Unavailable saved metric");
  assert.equal(h.nodes.thematicWgiStatus.textContent, "Saved indicator is unavailable. Choose a supported indicator.");
  assert.equal(h.nodes.thematicWgiStatus.dataset.statusTone, "warning");
  assert.equal(h.nodes.thematicWgiLegend.hidden, true);
  assert.equal(h.loads.length, 0);
  assert.equal(h.persists(), 0);
  h.nodes.thematicWgiMetric.value = "another-unknown";
  h.nodes.thematicWgiMetric.dispatch("change");
  assert.strictEqual(h.state.styleConfig.thematic, selection);
  assert.equal(h.nodes.thematicWgiMetric.value, "future-metric");
  h.nodes.thematicWgiMetric.value = RL;
  h.nodes.thematicWgiMetric.dispatch("change");
  await flush();
  assert.deepEqual(h.state.styleConfig.thematic, normalizeThematicWgiStyle({ enabled: true, metricId: RL }));
  assert.equal(h.nodes.thematicWgiMetric.children.length, THEMATIC_INDICATORS.length);
  assert.equal(h.loads.length, 1);
  assert.equal(h.loads[0].metricId, RL);
  assert.deepEqual(h.dirty, ["select-thematic-wgi-metric"]);
  assert.equal(h.persists(), 1);
});

test("unknown saved metric recovers through explicit off then on", async () => {
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true, metricId: "unknown" }) } });
  h.owner.render();
  h.nodes.toggleThematicWgi.checked = false;
  h.nodes.toggleThematicWgi.dispatch("change");
  assert.equal(h.state.styleConfig.thematic.metricId, "unknown");
  assert.equal(h.loads.length, 0);
  h.nodes.toggleThematicWgi.checked = true;
  h.nodes.toggleThematicWgi.dispatch("change");
  await flush();
  assert.equal(h.state.styleConfig.thematic.metricId, GE);
  assert.equal(h.loads[0].metricId, GE);
});

test("real runtime ignores a pending GE result after selecting RL, and retry retains RL", async () => {
  const requests = [];
  let pending;
  const h = createHarness({ styleConfig: { thematic: normalizeThematicWgiStyle({ enabled: true }) } }, {
    ensureData: (state, options) => {
      pending = ensureThematicWgiData(state, { ...options, loadData: ({ metricId }) => new Promise((resolve, reject) => {
        requests.push({ metricId, resolve, reject });
      }) });
      return pending;
    },
  });
  h.owner.render();
  await flush();
  const gePending = pending;
  h.nodes.thematicWgiMetric.value = RL;
  h.nodes.thematicWgiMetric.dispatch("change");
  await flush();
  const rlPending = pending;
  assert.deepEqual(requests.map((request) => request.metricId), [GE, RL]);
  requests[0].resolve(normalizeThematicWgiStyle({ metricId: GE }));
  await gePending;
  assert.equal(h.state.thematicWgiRuntime.status, "loading");
  assert.equal(h.state.thematicWgiRuntime.data, null);
  assert.equal(h.nodes.thematicWgiLegend.hidden, true);
  requests[1].reject(new Error("Network unavailable"));
  await rlPending;
  assert.equal(h.nodes.thematicWgiRetry.hidden, false);
  const retried = h.owner.retry();
  await flush();
  assert.equal(requests[2].metricId, RL);
  requests[2].resolve(normalizeThematicWgiStyle({ metricId: RL }));
  await retried;
  assert.equal(h.state.thematicWgiRuntime.data.metricId, RL);
  assert.equal(h.nodes.thematicWgiLegend.hidden, false);
  assert.equal(h.persists(), 1);
  assert.deepEqual(h.dirty, ["select-thematic-wgi-metric"]);
});

test("unavailable RL version is preserved on render and explicit recovery retains RL", async () => {
  for (const recover of ["selector", "off-on"]) {
    const selection = normalizeThematicWgiStyle({ enabled: true, metricId: RL, dataVersion: "old-version" });
    const h = createHarness({ styleConfig: { thematic: selection } });
    h.owner.render();
    assert.strictEqual(h.state.styleConfig.thematic, selection);
    assert.equal(h.nodes.thematicWgiMetric.value, RL);
    assert.equal(h.nodes.thematicWgiStatus.textContent, "Saved indicator data version is unavailable.");
    assert.equal(h.loads.length, 0);
    if (recover === "selector") {
      h.nodes.thematicWgiMetric.dispatch("change");
    } else {
      h.nodes.toggleThematicWgi.checked = false;
      h.nodes.toggleThematicWgi.dispatch("change");
      assert.equal(h.state.styleConfig.thematic.dataVersion, "old-version");
      h.nodes.toggleThematicWgi.checked = true;
      h.nodes.toggleThematicWgi.dispatch("change");
    }
    await flush();
    assert.deepEqual(h.state.styleConfig.thematic, normalizeThematicWgiStyle({ enabled: true, metricId: RL }));
    assert.equal(h.loads[0].metricId, RL);
  }
});

test("WGI new strings agree across manual/catalog translations and option language refresh preserves selection", () => {
  const manual = JSON.parse(readFileSync(new URL("../data/i18n/manual_ui.json", import.meta.url), "utf8"));
  for (const key of ["Country indicators", "Indicator", "Show thematic shading",
    "Country indicators · Scenario reference", "UNDP human development · Scenario reference",
    "WDI population · Scenario reference",
    ...THEMATIC_INDICATORS.map((metric) => metric.labelEn), "Unavailable saved metric",
    "Saved indicator is unavailable. Choose a supported indicator.",
    "Country indicators are not supported on the current basemap.", "Scenario countries mapped", "Reference country",
    "2024 reference mapping, not a measurement for the scenario year.",
    "2023 reference mapping, not a measurement for the scenario year.",
    "Thematic layer is off.", "Saved indicator data version is unavailable.",
    "Indicator data is ready to load.", "Loading indicator data…", "Indicator data loaded.",
    "Indicator data could not be loaded. Retry."]) {
    assert.equal(UI_COPY_CATALOG[key].en, key);
    assert.equal(UI_COPY_CATALOG[key].zh, manual[key]);
  }
  const selection = normalizeThematicWgiStyle({ metricId: RL });
  const h = createHarness({ currentLanguage: "en", styleConfig: { thematic: selection } }, {
    translate: (key, state) => UI_COPY_CATALOG[key]?.[state.currentLanguage] ?? key,
  });
  h.owner.render();
  const firstOption = h.nodes.thematicWgiMetric.children[0];
  h.owner.render();
  assert.strictEqual(h.nodes.thematicWgiMetric.children[0], firstOption);
  h.state.currentLanguage = "zh";
  h.owner.render();
  assert.deepEqual(h.nodes.thematicWgiMetric.children.map((option) => option.textContent),
    THEMATIC_INDICATORS.map((metric) => metric.labelZh));
  assert.equal(h.nodes.thematicWgiMetric.value, RL);
  assert.strictEqual(h.state.styleConfig.thematic, selection);
  assert.equal(h.loads.length, 0);
  assert.equal(h.persists(), 0);
  assert.deepEqual(h.dirty, []);
});
