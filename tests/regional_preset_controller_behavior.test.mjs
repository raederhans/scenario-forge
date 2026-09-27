import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createRegionalPresetController } from "../js/ui/sidebar/regional_preset_controller.js";
import { createScenarioTerritoryController } from "../js/ui/sidebar/scenario_territory_controller.js";
import { discoverStateWriterBindingsForSource } from "../tools/build_state_writer_policy.mjs";
import {
  STATE_TARGET_PURE_READER_CONTRACT,
  inspectStateTargetPureReaderFunctionSource,
} from "../tools/state_action_delegation_contract.mjs";

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toLowerCase();
    this.children = [];
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.type = "";
    this.title = "";
    this.disabled = false;
    this.parentNode = null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  click() {
    for (const handler of this.listeners.get("click") || []) {
      handler({ target: this, currentTarget: this });
    }
  }
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function createHarness({
  presets = [],
  lookupCode = "AA",
  visibleIds = [],
  runtime = {},
  scenarioMetaByCode = {},
  resolvePresetSource = (presetSource) => presetSource?.ids || [],
} = {}) {
  const calls = {
    sections: [],
    ownership: [],
    visual: [],
    toasts: [],
    disclosures: [],
    scenarioMeta: [],
    presetSources: [],
  };
  const runtimeState = {
    presetsState: { [lookupCode]: presets },
    selectedColor: "#112233",
    activeSovereignCode: "OWNER",
    activeScenarioId: "",
    paintMode: "visual",
    scenarioReleasableIndex: {},
    ...runtime,
  };
  const visible = new Set(visibleIds);
  const render = () => {};
  const controller = createRegionalPresetController(runtimeState, {
    t: (value) => `t:${value}`,
    normalizeCountryCode: normalizeCode,
    normalizePresetName: normalizeName,
    resolveScenarioLookupCode: (countryCode) => countryCode === "ALIAS" ? lookupCode : countryCode,
    normalizeActionMode: (mode = "auto") => {
      if (mode === "ownership" || mode === "visual") return mode;
      return runtimeState.paintMode === "sovereignty" ? "ownership" : "visual";
    },
    filterToVisibleFeatureIds: (ids) => {
      const requestedIds = Array.from(new Set((ids || [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)));
      return {
        requestedIds,
        matchedIds: requestedIds.filter((id) => visible.has(id)),
        missingIds: requestedIds.filter((id) => !visible.has(id)),
      };
    },
    applyOwnershipToFeatureIds: (ids, ownerCode, options) => {
      calls.ownership.push({ ids: [...ids], ownerCode, options });
      return { applied: true, changed: ids.length, reason: "ownership-applied" };
    },
    applyVisualOverridesToFeatureIds: (ids, color, options) => {
      calls.visual.push({ ids: [...ids], color, options });
      return { applied: true, changed: ids.length, reason: "visual-applied" };
    },
    showToast: (message, options) => calls.toasts.push({ message, options }),
    render,
    appendActionSection: (container, title, options) => {
      const section = new FakeElement("div");
      calls.sections.push({ container, title, options, section });
      container.appendChild(section);
      return section;
    },
    setScenarioVisualAdjustmentsOpen: (open) => calls.disclosures.push(open),
    getScenarioCountryMeta: (code) => {
      calls.scenarioMeta.push(code);
      return scenarioMetaByCode[code] || null;
    },
    resolveFeatureIdsFromPresetSource: (presetSource, lookupEntry) => {
      calls.presetSources.push({ presetSource, lookupEntry });
      return resolvePresetSource(presetSource, lookupEntry);
    },
  });
  return { controller, runtimeState, calls, render, visible };
}

function createTerritoryControllerForRegionalHarness(controller, calls) {
  calls.hooks = [];
  calls.companions = [];
  calls.shells = [];
  return createScenarioTerritoryController({
    t: (value) => value,
    prepareScenarioCoreApplication: controller.prepareScenarioCoreApplication,
    getPrimaryReleasablePresetRef: controller.getPrimaryReleasablePresetRef,
    applyPresetReference: controller.applyPresetReference,
    getCountryState: () => null,
    getResolvedCountryColor: () => "#445566",
    blockLockedScenarioInteraction: () => false,
    applyScenarioOwnerControllerAssignments: () => ({
      applied: true, changed: 1, matchedCount: 1,
    }),
    activateCoreOwner: (...args) => calls.hooks.push(args),
    setReleasableBoundaryVariant: () => true,
    applyScenarioAutoCompanionActions: (...args) => calls.companions.push(args),
    refreshScenarioShellOverlays: (...args) => calls.shells.push(args),
    showToast: () => {},
    render: () => {},
    renderList: () => {},
  });
}

function withMutedWarnings(run) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    return { value: run(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

globalThis.document = {
  createElement: (tagName) => new FakeElement(tagName),
};

test("missing, empty, and no-visible presets fail without invoking either mutation owner", () => {
  const { controller, calls } = createHarness({
    presets: [
      { name: "Empty", ids: [] },
      { name: "Unavailable", ids: ["missing-a", "missing-b"] },
    ],
  });

  const missing = withMutedWarnings(() => controller.applyPresetWithMode("AA", 9)).value;
  const empty = controller.applyPresetWithMode("AA", 0);
  const noVisible = withMutedWarnings(() => controller.applyPresetWithMode("AA", 1)).value;

  assert.deepEqual(missing, {
    applied: false,
    changed: 0,
    matchedCount: 0,
    requestedCount: 0,
    missingCount: 0,
    reason: "missing-preset",
  });
  assert.deepEqual(empty, {
    applied: false,
    changed: 0,
    matchedCount: 0,
    requestedCount: 0,
    missingCount: 0,
    reason: "empty-preset",
  });
  assert.deepEqual(noVisible, {
    applied: false,
    changed: 0,
    matchedCount: 0,
    requestedCount: 2,
    missingCount: 2,
    reason: "no-visible-features",
  });
  assert.equal(calls.ownership.length, 0);
  assert.equal(calls.visual.length, 0);
  assert.equal(calls.toasts.length, 1);
  assert.deepEqual(calls.toasts[0], {
    message: "t:Current map does not include this preset's detail features. Load detail topology and try again.",
    options: {
      title: "t:Preset not applied",
      tone: "warning",
      duration: 4200,
    },
  });
});

test("preset apply stays visual even when obsolete ownership options are supplied", () => {
  const { controller, calls, render } = createHarness({
    presets: [{ name: "North", ids: ["a", "missing", "b"] }], visibleIds: ["a", "b"],
    runtime: { activeSovereignCode: "", paintMode: "sovereignty" },
  });
  const result = controller.applyPresetWithMode("ALIAS", 0, { mode: "ownership", ownerCode: "EXPLICIT", render });
  assert.deepEqual(result, { applied: true, changed: 2, reason: "visual-applied", matchedCount: 2, requestedCount: 3, missingCount: 1 });
  assert.deepEqual(calls.ownership, []);
  assert.deepEqual(calls.visual, [{ ids: ["a", "b"], color: "#112233", options: { render, historyKind: "preset-apply-color", dirtyReason: "preset-apply-color" } }]);
});

test("core visual apply uses direct color/history options and preserves match counts", () => {
  const { controller, calls, render } = createHarness({
    presets: [{ name: "South", ids: ["shown", "absent"] }],
    visibleIds: ["shown"],
  });

  const result = controller.applyPresetWithMode("AA", 0, {
    mode: "visual",
    color: "#abcdef",
    render,
    visualHistoryKind: "custom-visual-history",
    visualDirtyReason: "custom-visual-dirty",
  });

  assert.equal(result.matchedCount, 1);
  assert.equal(result.requestedCount, 2);
  assert.equal(result.missingCount, 1);
  assert.deepEqual(calls.visual, [{
    ids: ["shown"],
    color: "#abcdef",
    options: {
      render,
      historyKind: "custom-visual-history",
      dirtyReason: "custom-visual-dirty",
    },
  }]);
});

test("ordinary rendering keeps baseline-disabled presets visible and permits paint without an active owner", () => {
  const { controller, calls } = createHarness({
    presets: [
      { name: "Baseline", ids: ["a"] },
      { name: "Editable", ids: ["b"] },
    ],
    runtime: {
      paintMode: "sovereignty",
      activeSovereignCode: "",
    },
  });
  const container = new FakeElement("div");

  controller.renderRegionalPresets(container, {
    code: "AA",
    disabledRegionalPresetNames: ["baseline"],
    disabledRegionalPresetReason: "Scenario already owns this preset",
  });

  assert.equal(calls.sections.length, 1);
  assert.deepEqual(
    { title: calls.sections[0].title, options: calls.sections[0].options },
    {
      title: "t:Regional Presets",
      options: {
        collapsible: true,
        defaultOpen: false,
        rememberKey: "territories-presets:regional-presets",
      },
    }
  );
  const [baseline, editable] = calls.sections[0].section.children;
  assert.equal(baseline.textContent, "Baseline");
  assert.equal(baseline.disabled, true);
  assert.equal(baseline.title, "Scenario already owns this preset");
  assert.equal(editable.textContent, "Editable");
  assert.equal(editable.disabled, false);
});

test("ordinary preset clicks resolve color and action state at click time", () => {
  const { controller, runtimeState, calls, render } = createHarness({
    presets: [{ name: "Mutable", ids: ["a"] }],
    visibleIds: ["a"],
    runtime: { activeSovereignCode: "", paintMode: "visual", selectedColor: "#old" },
  });
  const container = new FakeElement("div");
  controller.renderRegionalPresets(container, { code: "AA" });
  const button = calls.sections[0].section.children[0];
  assert.equal(button.disabled, false);

  runtimeState.selectedColor = "#new";
  button.click();
  assert.deepEqual(calls.visual[0], {
    ids: ["a"],
    color: "#new",
    options: {
      render,
      historyKind: "preset-apply-color",
      dirtyReason: "preset-apply-color",
    },
  });

  runtimeState.paintMode = "sovereignty";
  runtimeState.activeSovereignCode = "CLICK_OWNER";
  button.click();
  assert.deepEqual(calls.ownership, []);
  assert.deepEqual(calls.visual[1], calls.visual[0]);
});

test("scenario presets filter consumed/disabled names while retaining source indexes", () => {
  const presets = [
    { name: "Consumed", ids: ["consumed-id"] },
    { name: "First Visible", ids: ["first-id"] },
    { name: "Disabled", ids: ["disabled-id"] },
    { name: "Second Visible", ids: ["second-id"] },
  ];
  const { controller, calls, render } = createHarness({
    presets,
    visibleIds: ["first-id", "second-id"],
    runtime: {
      activeScenarioId: "scenario-1",
      activeSovereignCode: "",
      scenarioReleasableIndex: {
        consumedPresetNamesByParentLookup: { AA: ["consumed"] },
      },
    },
  });
  const container = new FakeElement("div");

  controller.renderRegionalPresets(container, {
    code: "SCENARIO_OWNER",
    presetLookupCode: "AA",
    disabledRegionalPresetNames: ["disabled"],
  }, { mode: "ownership" });

  const buttons = calls.sections[0].section.children;
  assert.deepEqual(buttons.map((button) => button.textContent), ["First Visible", "Second Visible"]);
  assert.equal(buttons.every((button) => button.disabled === false), true);
  buttons[1].click();
  assert.deepEqual(calls.ownership, []);
  assert.deepEqual(calls.visual, [{
    ids: ["second-id"], color: "#112233",
    options: { render, historyKind: "preset-apply-color", dirtyReason: "preset-apply-color" },
  }]);
});

test("scenario visual clicks use the current color/history and reopen disclosure after failure", () => {
  const { controller, runtimeState, calls, visible, render } = createHarness({
    presets: [{ name: "Visual", ids: ["feature"] }],
    visibleIds: ["feature"],
    runtime: { activeScenarioId: "scenario-1", selectedColor: "#old" },
  });
  const container = new FakeElement("div");
  controller.renderRegionalPresets(container, { code: "AA" }, { mode: "visual" });
  assert.equal(calls.sections[0].title, "t:Regional Presets (Visual Color)");
  assert.equal(calls.sections[0].options, undefined);
  const button = calls.sections[0].section.children[0];

  runtimeState.selectedColor = "#click-time";
  button.click();
  assert.deepEqual(calls.visual[0], {
    ids: ["feature"],
    color: "#click-time",
    options: {
      render,
      historyKind: "scenario-preset-apply-visual",
      dirtyReason: "scenario-preset-apply-visual",
    },
  });
  assert.deepEqual(calls.disclosures, [true]);

  visible.clear();
  const failed = withMutedWarnings(() => button.click());
  assert.equal(failed.warnings.length, 1);
  assert.equal(calls.visual.length, 1);
  assert.deepEqual(calls.disclosures, [true, true]);
});

test("rendering skips the section when no presets survive scenario filtering", () => {
  const { controller, calls } = createHarness({
    presets: [{ name: "Consumed", ids: ["a"] }],
    runtime: {
      activeScenarioId: "scenario-1",
      scenarioReleasableIndex: {
        consumedPresetNamesByParentLookup: { AA: ["consumed"] },
      },
    },
  });
  const container = new FakeElement("div");

  controller.renderRegionalPresets(container, { code: "AA" });

  assert.equal(calls.sections.length, 0);
  assert.equal(container.children.length, 0);
});

test("primary core reference prefers a materialized releasable preset and preserves its sparse index", () => {
  const presets = [];
  const sourcePreset = {
    name: "Materialized Core",
    ids: ["core-a", "core-b"],
    preset_kind: "releasable_core",
  };
  presets[4] = sourcePreset;
  const { controller, calls } = createHarness({
    presets,
    scenarioMetaByCode: {
      CORE: {
        boundary_variants: [{ id: "fallback", preset_source: { ids: ["fallback"] } }],
      },
    },
  });

  const ref = controller.getPrimaryReleasablePresetRef({ code: "CORE", presetLookupCode: "AA" });

  assert.equal(ref.presetLookupCode, "AA");
  assert.equal(ref.presetIndex, 4);
  assert.deepEqual(ref.preset, {
    name: "Materialized Core",
    ids: ["core-a", "core-b"],
  });
  assert.notEqual(ref.preset, sourcePreset);
  assert.notEqual(ref.preset.ids, sourcePreset.ids);
  ref.preset.ids.push("caller-only");
  assert.deepEqual(sourcePreset.ids, ["core-a", "core-b"]);
  assert.deepEqual(calls.scenarioMeta, []);
  assert.deepEqual(calls.presetSources, []);
});

test("generated core references resolve selected and default boundary variants without materializing runtime presets", () => {
  const selectedMeta = {
    tag: "CORE",
    release_lookup_iso2: "AA",
    selected_boundary_variant_id: "selected",
    default_boundary_variant_id: "default",
    boundary_variants: [
      { id: "default", preset_source: { ids: ["default-id"] } },
      { id: "selected", preset_source: { ids: ["selected-id"] } },
    ],
  };
  const selectedHarness = createHarness({
    scenarioMetaByCode: { CORE: selectedMeta },
  });
  const selected = selectedHarness.controller.getPrimaryReleasablePresetRef({
    code: "CORE",
    presetLookupCode: "AA",
  });

  assert.equal(selected.presetIndex, -1);
  assert.equal(selected.preset.boundary_variant_id, "selected");
  assert.deepEqual(selected.preset.ids, ["selected-id"]);
  assert.notEqual(selected.preset.ids, selectedMeta.boundary_variants[1].preset_source.ids);
  selected.preset.ids.push("caller-only");
  assert.deepEqual(selectedMeta.boundary_variants[1].preset_source.ids, ["selected-id"]);
  assert.deepEqual(selectedHarness.runtimeState.presetsState.AA, []);
  assert.deepEqual(selectedHarness.calls.presetSources, [{
    presetSource: selectedMeta.boundary_variants[1].preset_source,
    lookupEntry: {
      tag: "CORE",
      release_lookup_iso2: "AA",
      lookup_iso2: "AA",
      base_iso2: "",
    },
  }]);

  const defaultMeta = {
    tag: "CORE",
    default_boundary_variant_id: "default",
    boundary_variants: [
      { id: "first", preset_source: { ids: ["first-id"] } },
      { id: "default", preset_source: { ids: ["default-id"] } },
    ],
  };
  const defaultHarness = createHarness({ scenarioMetaByCode: { CORE: defaultMeta } });
  const defaultRef = defaultHarness.controller.getPrimaryReleasablePresetRef({
    code: "CORE",
    presetLookupCode: "AA",
  });
  assert.equal(defaultRef.preset.boundary_variant_id, "default");
  assert.deepEqual(defaultRef.preset.ids, ["default-id"]);
});

test("generated core lookup fails closed when the chosen boundary source resolves no ids", () => {
  const { controller, calls } = createHarness({
    scenarioMetaByCode: {
      CORE: {
        boundary_variants: [{ id: "empty", preset_source: { ids: [] } }],
      },
    },
  });

  const result = withMutedWarnings(() => controller.getPrimaryReleasablePresetRef({
    code: "CORE",
    presetLookupCode: "AA",
  })).value;

  assert.equal(result, null);
  assert.equal(controller.hasScenarioCoreTerritoryActions({
    code: "CORE",
    presetLookupCode: "AA",
  }), false);
  assert.equal(calls.visual.length, 0);
  assert.equal(calls.ownership.length, 0);
});

test("direct preset references apply generated ids with partial visibility and preserve caller snapshots", () => {
  const { controller, calls, render } = createHarness({
    visibleIds: ["shown"],
  });
  const ids = ["shown", "absent"];
  const ref = {
    presetLookupCode: "AA",
    presetIndex: -1,
    preset: { name: "Generated Core", ids },
  };

  const result = controller.applyPresetReference(ref, {
    mode: "visual",
    color: "#abcdef",
    render,
    visualHistoryKind: "scenario-core-apply-visual",
    visualDirtyReason: "scenario-core-apply-visual",
  });

  assert.deepEqual(result, {
    applied: true,
    changed: 1,
    reason: "visual-applied",
    matchedCount: 1,
    requestedCount: 2,
    missingCount: 1,
  });
  assert.deepEqual(ids, ["shown", "absent"]);
  assert.deepEqual(calls.visual, [{
    ids: ["shown"],
    color: "#abcdef",
    options: {
      render,
      historyKind: "scenario-core-apply-visual",
      dirtyReason: "scenario-core-apply-visual",
    },
  }]);
  assert.equal(calls.ownership.length, 0);
});

test("territory controller visual apply consumes the generated regional reference without ownership side effects", () => {
  const { controller, calls } = createHarness({
    visibleIds: ["core-a"],
    scenarioMetaByCode: {
      CORE: {
        tag: "CORE",
        release_lookup_iso2: "AA",
        selected_boundary_variant_id: "generated",
        boundary_variants: [{ id: "generated", preset_source: { ids: ["core-a"] } }],
      },
    },
  });
  const territoryController = createTerritoryControllerForRegionalHarness(controller, calls);

  const applied = territoryController.applyScenarioReleasableCoreTerritory(
    { code: "CORE", presetLookupCode: "AA" },
    { source: "test", actionMode: "visual" },
  );

  assert.equal(applied, true);
  assert.deepEqual(calls.visual, [{
    ids: ["core-a"],
    color: "#445566",
    options: {
      render: calls.visual[0]?.options?.render,
      historyKind: "scenario-core-apply-visual",
      dirtyReason: "scenario-core-apply-visual",
    },
  }]);
  assert.equal(typeof calls.visual[0]?.options?.render, "function");
  assert.equal(calls.ownership.length, 0);
  assert.deepEqual(calls.hooks, []);
  assert.deepEqual(calls.companions, []);
  assert.deepEqual(calls.shells, []);
});

test("controller remains a registered pure reader and fails closed on source drift or state writes", async () => {
  const modulePath = "js/ui/sidebar/regional_preset_controller.js";
  const source = fs.readFileSync(modulePath, "utf8");
  const contractEntry = STATE_TARGET_PURE_READER_CONTRACT.find((entry) => (
    entry.modulePath === modulePath
    && entry.functionName === "createRegionalPresetController"
  ));
  assert.ok(contractEntry);
  assert.deepEqual(contractEntry.acceptedEscapes, []);
  assert.deepEqual(contractEntry.conservativeFindings, []);

  const strictDiscovery = await discoverStateWriterBindingsForSource(
    modulePath,
    source,
    "production",
    { scanAllParameters: true, includeInventories: true },
  );
  assert.deepEqual(
    strictDiscovery.bindingInventories.flatMap(({ findings }) => findings),
    [],
  );
  assert.deepEqual(
    inspectStateTargetPureReaderFunctionSource(source, contractEntry).violations,
    [],
  );

  const returnStart = source.lastIndexOf("  return {");
  const returnEnd = source.indexOf("  };", returnStart);
  assert.notEqual(returnStart, -1);
  assert.notEqual(returnEnd, -1);
  const returnStatement = source.slice(returnStart, returnEnd + "  };".length);
  const mutated = source.replace(
    returnStatement,
    `  runtimeState.selectedColor = "bad";\n${returnStatement}`,
  );
  assert.notEqual(mutated, source);
  assert.ok(
    inspectStateTargetPureReaderFunctionSource(mutated, contractEntry).violations.some(
      ({ code }) => code === "state-target-pure-reader-source-drift",
    ),
  );
  await assert.rejects(
    () => discoverStateWriterBindingsForSource(
      modulePath,
      mutated,
      "production",
      { scanAllParameters: true, includeInventories: true },
    ),
    (error) => error?.code === "state-target-pure-reader-contract-violation",
  );

  const rawDiscovery = await discoverStateWriterBindingsForSource(
    modulePath,
    mutated,
    "production",
    {
      scanAllParameters: true,
      includeInventories: true,
      enforceCurrentContracts: false,
    },
  );
  assert.ok(
    rawDiscovery.bindingInventories.flatMap(({ findings }) => findings).length > 0,
  );

  const escaped = source.replace(returnStatement, "  return runtimeState;");
  assert.notEqual(escaped, source);
  await assert.rejects(
    () => discoverStateWriterBindingsForSource(
      modulePath,
      escaped,
      "production",
      { scanAllParameters: true, includeInventories: true },
    ),
    (error) => error?.code === "state-target-pure-reader-contract-violation"
      && error.violations.some(
        ({ code }) => code === "state-target-pure-reader-conservative-finding-unregistered",
      ),
  );
});
