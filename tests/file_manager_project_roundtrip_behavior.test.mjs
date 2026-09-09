import test from "node:test";
import assert from "node:assert/strict";

import { FileManager } from "../js/core/file_manager.js";
import {
  getInteractionFunnelDebugState,
  importProjectThroughFunnel,
  resetInteractionFunnelDebugState,
  resolveImportedTransportCountryOverlayPackIds,
} from "../js/core/interaction_funnel.js";
import { prepareProjectImportFile } from "../js/core/project_package_io.js";
import {
  getTransportOverviewVisibilityField,
  listTransportOverviewCapabilityFamilyIds,
} from "../js/core/transport_capability_registry.js";
import { state, state as fixtureState } from "../js/core/state.js";
import {
  createIntensityFieldsState,
  sampleIntensityField,
} from "../js/core/intensity_field.js";
import {
  updateIntensityFieldChannel,
} from "../js/core/state/intensity_field_state.js";
import {
  createAppearancePresetFromRuntimeState,
  createDefaultAppearancePresetsState,
  upsertAppearancePreset,
} from "../js/core/state/appearance_preset_state.js";
import {
  readRegisteredRuntimeHookSource,
  registerRuntimeHook,
} from "../js/core/state/index.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "../vendor/fflate.browser.js";

test("import summary counts rejected entries while preserving valid unloaded regions and migration", async () => {
  // Isolate the module's migration-asset promise from other project-import cases.
  const { migrateFeatureScopedProjectDataToCurrentTopology: migrate } = await import("../js/core/sovereignty_manager.js?import-summary");
  const summaries = [];
  const original = {
    visualOverrides: { loaded: "#111111", unloaded: "#222222", forged: "#333333", legacy: "#444444" },
    sovereigntyByFeatureId: { unloaded: "GER", forged: "FRA" },
  };
  const result = await migrate(original, {
    validFeatureIds: new Set(["loaded", "unloaded", "successor"]),
    landData: { features: [{ id: "loaded" }] },
    fetchImpl: async () => ({ ok: true, json: async () => ({ legacy: ["successor"] }) }),
    onMigration: (summary) => summaries.push(summary),
  });
  assert.deepEqual(result.visualOverrides, { loaded: "#111111", unloaded: "#222222", successor: "#444444" });
  assert.deepEqual(result.sovereigntyByFeatureId, { unloaded: "GER" });
  assert.deepEqual(summaries, [{ migratedEntries: 1, ignoredEntries: 2 }]);
  assert.equal(original.visualOverrides.forged, "#333333");
  assert.equal(Object.hasOwn(result, "importSummary"), false, "summary must not alter the project file format");
  await migrate({ visualOverrides: { unloaded: "#222222", AQ_INVALID: "#333333" } }, {
    validFeatureIds: new Set(["unloaded"]), onMigration: (summary) => summaries.push(summary),
  });
  assert.deepEqual(summaries[1], { migratedEntries: 0, ignoredEntries: 1 });
});

async function exportProjectPayload(appState) {
  let capturedBlob = null;
  const previousDocument = globalThis.document;
  const previousUrl = globalThis.URL;
  const previousSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    body: {
      appendChild: () => {},
    },
    getElementById: () => null,
    createElement: () => ({
      click: () => {},
      remove: () => {},
      set download(_value) {},
      set href(_value) {},
    }),
  };
  globalThis.URL = {
    createObjectURL: (blob) => {
      capturedBlob = blob;
      return "blob:project-export";
    },
    revokeObjectURL: () => {},
  };
  globalThis.setTimeout = (callback) => {
    if (typeof callback === "function") callback();
    return 0;
  };

  try {
    await FileManager.exportProject(appState);
    assert.ok(capturedBlob, "exportProject should create a project blob");
    return JSON.parse(await capturedBlob.text());
  } finally {
    globalThis.document = previousDocument;
    globalThis.URL = previousUrl;
    globalThis.setTimeout = previousSetTimeout;
  }
}

async function exportProjectBlob(appState, options = {}) {
  let capturedBlob = null;
  const previousDocument = globalThis.document;
  const previousUrl = globalThis.URL;
  const previousSetTimeout = globalThis.setTimeout;

  globalThis.document = {
    body: {
      appendChild: () => {},
    },
    getElementById: () => null,
    createElement: () => ({
      click: () => {},
      remove: () => {},
      set download(_value) {},
      set href(_value) {},
    }),
  };
  globalThis.URL = {
    createObjectURL: (blob) => {
      capturedBlob = blob;
      return "blob:project-export";
    },
    revokeObjectURL: () => {},
  };
  globalThis.setTimeout = (callback) => {
    if (typeof callback === "function") callback();
    return 0;
  };

  try {
    await FileManager.exportProject(appState, options);
    assert.ok(capturedBlob, "exportProject should create a project blob");
    return capturedBlob;
  } finally {
    globalThis.document = previousDocument;
    globalThis.URL = previousUrl;
    globalThis.setTimeout = previousSetTimeout;
  }
}

async function importProjectPayload(payload, observerHooks = {}) {
  const previousDocument = globalThis.document;
  const previousFileReader = globalThis.FileReader;
  const callbacks = [];
  const successes = [];
  const errors = [];

  globalThis.document = {
    getElementById: () => null,
  };
  globalThis.FileReader = class {
    readAsText(file) {
      this.result = file.text;
      queueMicrotask(() => this.onload?.());
    }
  };

  try {
    await FileManager.importProject(
      {
        name: "map_project.json",
        text: JSON.stringify(payload),
      },
      async (data) => {
        callbacks.push(data);
      },
      {
        onSuccess: (data) => {
          successes.push(data);
          observerHooks.onSuccess?.(data);
        },
        onError: (error) => {
          errors.push(error);
          observerHooks.onError?.(error);
        },
      }
    );
    return { callbacks, successes, errors };
  } finally {
    globalThis.document = previousDocument;
    globalThis.FileReader = previousFileReader;
  }
}

async function importProjectTextPayload(payload, observerHooks = {}) {
  const previousDocument = globalThis.document;
  const callbacks = [];
  const successes = [];
  const errors = [];

  globalThis.document = {
    getElementById: () => null,
  };

  try {
    const imported = await FileManager.importProjectText(
      JSON.stringify(payload),
      async (data) => {
        callbacks.push(data);
      },
      {
        onSuccess: (data) => {
          successes.push(data);
          observerHooks.onSuccess?.(data);
        },
        onError: (error) => {
          errors.push(error);
          observerHooks.onError?.(error);
        },
      },
    );

    return { callbacks, errors, imported, successes };
  } finally {
    globalThis.document = previousDocument;
  }
}

function createTransportOverviewImportPayload(layerVisibility = {}) {
  return {
    schemaVersion: 21,
    annotationView: {},
    countryBaseColors: {},
    exportWorkbenchUi: {},
    featureOverrides: {},
    layerVisibility: {
      showCityPoints: false,
      showPhysical: false,
      showRivers: false,
      showSpecialZones: false,
      showTransport: true,
      showUrban: false,
      ...layerVisibility,
    },
    specialZoneLayers: {},
    styleConfig: {},
    transportWorkbenchUi: {},
    waterRegionOverrides: {},
  };
}

test("file and text project imports share normalized callback payloads", async () => {
  const legacyPayload = {
    schemaVersion: 1,
    colors: {
      legacyFeature: "#123456",
    },
    layerVisibility: {
      showWaterRegions: false,
    },
    styleConfig: {
      specialZones: {
        legacy: true,
      },
    },
  };

  const fileResult = await importProjectPayload(legacyPayload);
  const textResult = await importProjectTextPayload(legacyPayload);

  assert.equal(fileResult.errors.length, 0);
  assert.equal(textResult.errors.length, 0);
  assert.equal(textResult.imported, true);
  assert.equal(fileResult.callbacks.length, 1);
  assert.equal(textResult.callbacks.length, 1);

  const fileData = fileResult.callbacks[0];
  const textData = textResult.callbacks[0];
  for (const field of [
    "featureOverrides",
    "countryBaseColors",
    "visualOverrides",
    "waterRegionOverrides",
    "specialRegionOverrides",
    "specialZoneLayers",
    "styleConfig",
    "layerVisibility",
  ]) {
    assert.deepEqual(textData[field], fileData[field], `${field} should share import normalization`);
  }
});

async function importProjectThroughFunnelPayload(
  payload,
  { captureIntensityFields = false, captureExportBakeCacheClear = false } = {},
) {
  const previousDocument = globalThis.document;
  const previousFileReader = globalThis.FileReader;
  const previousEnsureContextLayerDataHook = readRegisteredRuntimeHookSource(state, "ensureContextLayerDataFn");
  const previousClearExportBakeCacheHook = readRegisteredRuntimeHookSource(fixtureState, "clearExportBakeCacheFn");
  const previousTransportVisibilityState = {
    showTransport: state.showTransport,
    showAirports: state.showAirports,
    showPorts: state.showPorts,
    showRail: state.showRail,
    showRoad: state.showRoad,
  };
  const previousIntensityFields = state.intensityFields;
  const requests = [];
  let importedIntensityFields = null;
  let exportBakeCacheClearCount = 0;

  globalThis.document = {
    getElementById: () => null,
  };
  globalThis.FileReader = class {
    readAsText(file) {
      this.result = file.text;
      queueMicrotask(() => this.onload?.());
    }
  };
  registerRuntimeHook(state, "ensureContextLayerDataFn", async (layerRequest, options) => {
    assert.equal(typeof options.isCurrent, "function");
    assert.equal(options.signal.aborted, false);
    requests.push({
      layerRequest: Array.isArray(layerRequest) ? [...layerRequest] : layerRequest,
      options: { reason: options.reason, renderNow: options.renderNow },
    });
  });
  registerRuntimeHook(fixtureState, "clearExportBakeCacheFn", () => {
    exportBakeCacheClearCount += 1;
  });

  try {
    const result = await importProjectThroughFunnel(
        {
          name: "map_project.json",
          text: JSON.stringify(payload),
        },
        {
          ui: {
            t: (value) => String(value || ""),
            showToast: () => {},
            showAppDialog: async () => false,
          },
          hooks: {
            refreshColorState: () => {},
            onProjectImportError: () => assert.fail("project import failed"),
          },
        }
      );
    assert.ok(result.status.startsWith("committed"));
    await result.completion;
    if (captureIntensityFields) {
      importedIntensityFields = state.intensityFields;
    }
    if (captureIntensityFields || captureExportBakeCacheClear) {
      return {
        requests,
        ...(captureIntensityFields ? { intensityFields: importedIntensityFields } : {}),
        ...(captureExportBakeCacheClear ? { exportBakeCacheClearCount } : {}),
      };
    }
    return requests;
  } finally {
    Object.assign(state, previousTransportVisibilityState);
    state.intensityFields = previousIntensityFields;
    registerRuntimeHook(state, "ensureContextLayerDataFn", previousEnsureContextLayerDataHook);
    registerRuntimeHook(fixtureState, "clearExportBakeCacheFn", previousClearExportBakeCacheHook);
    globalThis.document = previousDocument;
    globalThis.FileReader = previousFileReader;
  }
}

test("project import through funnel clears toolbar-owned export bake cache once", async () => {
  const result = await importProjectThroughFunnelPayload(
    createTransportOverviewImportPayload(),
    { captureExportBakeCacheClear: true },
  );

  assert.equal(result.exportBakeCacheClearCount, 1);
  assert.equal(Object.hasOwn(fixtureState, "clearExportBakeCacheFn"), false);
});

function getTransportOverviewVisibilityFields() {
  return listTransportOverviewCapabilityFamilyIds()
    .map((familyId) => getTransportOverviewVisibilityField(familyId))
    .filter(Boolean);
}

test("project payload builder returns export schema without triggering download", () => {
  const payload = FileManager.buildProjectPayload({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    legendLabels: { "#111111": "大日耳曼国" },
    legendConfig: { mode: "realm-area", continent: "asia", useModernMajorOrder: true },
    legendControl: { visible: false, collapsed: true, xRatio: 0.2, yRatio: 0.3, width: 260.4, height: 180.6, opacity: 0.5 },
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
  });

  assert.equal(payload.schemaVersion, 22);
  assert.equal(payload.scenario.id, "tno_1962");
  assert.equal(payload.scenario.version, 3);
  assert.equal(payload.exportHandoff.artifactKind, "project-json");
  assert.equal(payload.exportHandoff.scenario.id, "tno_1962");
  assert.equal(payload.exportHandoff.project.schemaVersion, 22);
  assert.equal(payload.exportHandoff.exportUi.target, "composite");
  assert.equal(payload.exportHandoff.files[0].path, "map_project.json");
  assert.equal(Object.hasOwn(payload.exportHandoff.files[0], "byteLength"), false);
  assert.equal(Object.hasOwn(payload.exportHandoff.files[0], "checksum"), false);
  getTransportOverviewVisibilityFields().forEach((field) => {
    assert.equal(Object.hasOwn(payload.layerVisibility, field), true, field);
  });
  assert.equal(payload.legendLabels["#111111"], "大日耳曼国");
  assert.deepEqual(payload.legendConfig, {
    mode: "realm-area",
    continent: "asia",
    useModernMajorOrder: true,
    maxItems: 15,
  });
  assert.deepEqual(payload.legendControl, {
    visible: false,
    collapsed: true,
    xRatio: 0.2,
    yRatio: 0.3,
    width: 260,
    height: 181,
    opacity: 0.5,
  });
  assert.equal(payload.layerVisibility.showStrategicResourceMarkers, false);
  assert.equal(payload.layerVisibility.strategicChoroplethMetric, "");
});

test("project payload builder keeps open ocean visible with interaction off by default", () => {
  const payload = FileManager.buildProjectPayload({
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
  });

  assert.equal(payload.layerVisibility.showWaterRegions, true);
  assert.equal(payload.layerVisibility.showOpenOceanRegions, true);
  assert.equal(payload.layerVisibility.allowOpenOceanSelect, false);
  assert.equal(payload.layerVisibility.allowOpenOceanPaint, false);
});

test("project export and import preserve unified intensity fields", async () => {
  let intensityFields = updateIntensityFieldChannel(createIntensityFieldsState(), "physicalAtlas", (channel) => {
    channel.enabled = true;
    channel.points = [{
      id: "alps-field",
      lon: 10,
      lat: 46,
      strength: 1.75,
      radiusDeg: 7,
      falloff: "smooth",
    }];
  });
  intensityFields = updateIntensityFieldChannel(intensityFields, "urbanGlow", (channel) => {
    channel.enabled = true;
    channel.points = [{
      id: "tokyo-glow",
      lon: 139.7,
      lat: 35.7,
      strength: 1.6,
      radiusDeg: 5,
      falloff: "smooth",
    }];
  });
  intensityFields = updateIntensityFieldChannel(intensityFields, "oceanDepth", (channel) => {
    channel.enabled = true;
    channel.points = [{
      id: "atlantic-depth",
      lon: -35,
      lat: 28,
      strength: 1.55,
      radiusDeg: 12,
      falloff: "smooth",
    }];
  });

  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
    intensityFields,
  });

  assert.equal(payload.intensityFields.channels.physicalAtlas.enabled, true);
  assert.equal(payload.intensityFields.channels.physicalAtlas.points[0].id, "alps-field");
  assert.equal(payload.intensityFields.channels.urbanGlow.enabled, true);
  assert.equal(payload.intensityFields.channels.urbanGlow.points[0].id, "tokyo-glow");
  assert.equal(payload.intensityFields.channels.oceanDepth.enabled, true);
  assert.equal(payload.intensityFields.channels.oceanDepth.points[0].id, "atlantic-depth");
  assert.equal(payload.intensityFields.channels.physicalAtlas.grid.base.encoding, "rle-u8-base64");
  assert.equal(Object.hasOwn(payload, "physicalIntensityField"), false);

  const result = await importProjectPayload(payload);
  assert.equal(result.successes.length, 1);
  assert.equal(result.successes[0].intensityFields.channels.physicalAtlas.enabled, true);
  assert.equal(result.successes[0].intensityFields.channels.urbanGlow.enabled, true);
  assert.equal(result.successes[0].intensityFields.channels.oceanDepth.enabled, true);
  assert.ok(sampleIntensityField(result.successes[0].intensityFields, "physicalAtlas", 10, 46) > 1.4);
  assert.ok(sampleIntensityField(result.successes[0].intensityFields, "urbanGlow", 139.7, 35.7) > 1.3);
  assert.ok(sampleIntensityField(result.successes[0].intensityFields, "oceanDepth", -35, 28) > 1.3);
});

test("project import defaults missing intensity fields to empty unified channels", async () => {
  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  });
  delete payload.intensityFields;

  const result = await importProjectPayload(payload);

  assert.equal(result.successes[0].intensityFields.channels.physicalAtlas.enabled, false);
  assert.equal(result.successes[0].intensityFields.channels.physicalAtlas.revision, 0);
  assert.deepEqual(result.successes[0].intensityFields.channels.physicalAtlas.points, []);
  assert.equal(result.successes[0].intensityFields.channels.urbanGlow.enabled, false);
  assert.equal(result.successes[0].intensityFields.channels.urbanGlow.revision, 0);
  assert.deepEqual(result.successes[0].intensityFields.channels.urbanGlow.points, []);
  assert.equal(result.successes[0].intensityFields.channels.oceanDepth.enabled, false);
  assert.equal(result.successes[0].intensityFields.channels.oceanDepth.revision, 0);
  assert.deepEqual(result.successes[0].intensityFields.channels.oceanDepth.points, []);
});

test("project export and import preserve appearance presets", async () => {
  const presetRuntime = {
    styleConfig: {
      ocean: {
        fillColor: "#102030",
      },
      urban: {
        mode: "manual",
        color: "#405060",
      },
    },
    showUrban: false,
    showPhysical: true,
    showRivers: false,
    intensityFields: updateIntensityFieldChannel(
      createIntensityFieldsState(),
      "urbanGlow",
      (channel) => {
        channel.enabled = true;
        channel.points = [{ id: "glow", lon: 139.7, lat: 35.7, strength: 1.6, radiusDeg: 6 }];
      },
    ),
  };
  const appearancePresets = upsertAppearancePreset(
    createDefaultAppearancePresetsState(),
    createAppearancePresetFromRuntimeState(presetRuntime, {
      id: "glow-preset",
      name: "Glow Preset",
      now: Date.UTC(2026, 5, 12),
    }),
  );

  const payload = await exportProjectPayload({
    annotationView: {},
    appearancePresets,
    exportWorkbenchUi: {},
    styleConfig: {},
  });

  assert.equal(payload.appearancePresets.byId["glow-preset"].name, "Glow Preset");
  assert.equal(payload.appearancePresets.byId["glow-preset"].snapshot.styleConfig.ocean.fillColor, "#102030");
  assert.equal(Object.hasOwn(payload.appearancePresets.byId["glow-preset"].snapshot, "referenceImageState"), false);

  const result = await importProjectPayload(payload);

  assert.equal(result.successes[0].appearancePresets.byId["glow-preset"].name, "Glow Preset");
  assert.equal(result.successes[0].appearancePresets.byId["glow-preset"].snapshot.layerVisibility.showUrban, false);
  assert.ok(sampleIntensityField(
    result.successes[0].appearancePresets.byId["glow-preset"].snapshot.intensityFields,
    "urbanGlow",
    139.7,
    35.7,
  ) > 1.3);
});

test("project import defaults missing appearance presets to an empty preset library", async () => {
  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  });
  delete payload.appearancePresets;

  const result = await importProjectPayload(payload);

  assert.deepEqual(result.successes[0].appearancePresets, {
    schemaVersion: 1,
    selectedPresetId: "",
    order: [],
    byId: {},
  });
});

test("project import migrates legacy physical intensity field points into physical atlas channel", async () => {
  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  });
  payload.physicalIntensityField = {
    enabled: true,
    revision: 7,
    points: [{
      id: "ridge-1",
      lon: 12.5,
      lat: 45.25,
      weight: 1.4,
      radiusKm: 900,
      falloff: "linear",
    }],
  };
  payload.intensityFields.channels.physicalAtlas.points = [];

  const result = await importProjectPayload(payload);
  const channel = result.successes[0].intensityFields.channels.physicalAtlas;

  assert.equal(channel.enabled, true);
  assert.equal(channel.points[0].id, "ridge-1");
  assert.equal(channel.points[0].strength, 1.49);
  assert.equal(Number(channel.points[0].radiusDeg.toFixed(3)), Number((900 / 111).toFixed(3)));
  assert.equal(channel.points[0].falloff, "linear");
});

test("project import restores missing open ocean flags as visible without interaction", async () => {
  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  });
  delete payload.layerVisibility.showOpenOceanRegions;
  delete payload.layerVisibility.allowOpenOceanSelect;
  delete payload.layerVisibility.allowOpenOceanPaint;

  const result = await importProjectPayload(payload);

  assert.equal(result.successes.length, 1);
  assert.equal(result.successes[0].layerVisibility.showOpenOceanRegions, true);
  assert.equal(result.successes[0].layerVisibility.allowOpenOceanSelect, false);
  assert.equal(result.successes[0].layerVisibility.allowOpenOceanPaint, false);
});

test("project export and import preserve strategic values view controls", async () => {
  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
    showStrategicResourceMarkers: true,
    strategicChoroplethMetric: "steel",
  });

  assert.equal(payload.layerVisibility.showStrategicResourceMarkers, true);
  assert.equal(payload.layerVisibility.strategicChoroplethMetric, "steel");

  const restored = await importProjectPayload(payload);
  assert.equal(restored.successes[0].layerVisibility.showStrategicResourceMarkers, true);
  assert.equal(restored.successes[0].layerVisibility.strategicChoroplethMetric, "steel");

  delete payload.layerVisibility.showStrategicResourceMarkers;
  delete payload.layerVisibility.strategicChoroplethMetric;
  const legacy = await importProjectPayload(payload);
  assert.equal(legacy.successes[0].layerVisibility.showStrategicResourceMarkers, false);
  assert.equal(legacy.successes[0].layerVisibility.strategicChoroplethMetric, "");
});

test("project import restores missing transport overview registry visibility as disabled", async () => {
  const payload = await exportProjectPayload({
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  });
  getTransportOverviewVisibilityFields().forEach((field) => {
    delete payload.layerVisibility[field];
  });

  const result = await importProjectPayload(payload);

  getTransportOverviewVisibilityFields().forEach((field) => {
    assert.equal(result.successes[0].layerVisibility[field], false, field);
  });
});

test("project import through funnel restores legacy physical intensity into unified runtime state", async () => {
  const result = await importProjectThroughFunnelPayload(
    {
      ...createTransportOverviewImportPayload(),
      physicalIntensityField: {
        enabled: true,
        revision: 3,
        points: [{ id: "peak", lon: 8, lat: 47, weight: 1, radiusKm: 650 }],
      },
    },
    { captureIntensityFields: true },
  );

  const channel = result.intensityFields.channels.physicalAtlas;
  assert.equal(channel.enabled, true);
  assert.equal(channel.points[0].id, "peak");
  assert.equal(channel.points[0].strength, 1.35);
});

test("required refresh failure preserves the committed import and blocks editing until retry", async () => {
  const previousDocument = globalThis.document;
  const previousFileReader = globalThis.FileReader;
  globalThis.document = {
    getElementById: () => null,
  };
  globalThis.FileReader = class {
    readAsText(file) {
      this.result = file.text;
      queueMicrotask(() => this.onload?.());
    }
  };

  let failRefresh = true;
  try {
    const result = await importProjectThroughFunnel(
        {
          name: "map_project.json",
          text: JSON.stringify(createTransportOverviewImportPayload()),
        },
        {
          ui: {
            t: (value) => String(value || ""),
            showToast: () => {},
            showAppDialog: async () => false,
          },
          hooks: {
            invalidateFrontlineOverlayState: () => {
              if (failRefresh) throw new Error("debug reset sentinel");
            },
            onProjectImportError: () => assert.fail("committed import must not become a failure"),
          },
        }
      );

    assert.equal(result.status, "committed-with-warnings");
    assert.ok(result.warnings.some(warning => warning.resource === "document-refresh" && /debug reset sentinel/.test(warning.message)));
    assert.equal(getInteractionFunnelDebugState().importPhase, "completion-blocked");
    assert.equal(state.startupReadonly, true);
    failRefresh = false;
    assert.equal(await result.retry("document-refresh"), true);
    assert.equal(state.startupReadonly, false);

    resetInteractionFunnelDebugState();

    assert.equal(getInteractionFunnelDebugState().importPhase, "idle");
    assert.equal(getInteractionFunnelDebugState().lastImportError, "");
  } finally {
    globalThis.document = previousDocument;
    globalThis.FileReader = previousFileReader;
  }
});

test("project zip download keeps editable project and manifest files", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });

  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.ok(entries["map_project.json"], "zip should include editable project JSON");
  assert.ok(entries["project/map_project.json"], "zip should include canonical project directory");
  assert.ok(entries["manifest.json"], "zip should include package manifest");
  assert.ok(entries["map_project_manifest.json"], "zip should include legacy project manifest pointer");
  assert.ok(entries["metadata/export_settings.json"], "recommended package should include export settings");
  assert.ok(entries["resources/project_resource_index.json"], "recommended package should include resource index");
  const projectPayload = JSON.parse(strFromU8(entries["map_project.json"]));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));

  assert.equal(projectPayload.schemaVersion, 22);
  assert.equal(manifest.artifactKind, "project-zip");
  assert.equal(manifest.packageKind, "editable-project-package");
  assert.equal(manifest.files[0].path, "map_project.json");
  assert.equal(manifest.files[0].role, "editable-project");
  assert.match(manifest.files[0].checksum, /^sha256_/);
  assert.equal(manifest.files.some((file) => file.path === "metadata/export_settings.json"), true);
});

test("project zip content preset controls optional package directories", async () => {
  const minimalBlob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip", packageContents: "minimal" });
  const minimalEntries = unzipSync(new Uint8Array(await minimalBlob.arrayBuffer()));
  assert.ok(minimalEntries["project/map_project.json"]);
  assert.equal(Boolean(minimalEntries["metadata/export_settings.json"]), false);
  assert.equal(Boolean(minimalEntries["diagnostics/package_report.json"]), false);

  const diagnosticBlob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip", packageContents: "diagnostic" });
  const diagnosticEntries = unzipSync(new Uint8Array(await diagnosticBlob.arrayBuffer()));
  assert.ok(diagnosticEntries["metadata/export_settings.json"]);
  assert.ok(diagnosticEntries["resources/project_resource_index.json"]);
  assert.ok(diagnosticEntries["diagnostics/package_report.json"]);
});

test("project package resource index only references included optional files", async () => {
  const recommendedBlob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip", packageContents: "recommended" });
  const entries = unzipSync(new Uint8Array(await recommendedBlob.arrayBuffer()));
  const resourceIndex = JSON.parse(strFromU8(entries["resources/project_resource_index.json"]));

  assert.equal(resourceIndex.resources.exportSettings, "metadata/export_settings.json");
  assert.equal(Object.hasOwn(resourceIndex.resources, "diagnostics"), false);
});

test("project package resource index follows actual editable project path", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, {
    format: "zip",
    packageContents: {
      includeProjectDirectory: false,
      includeExportSettings: false,
      includeResourceIndex: true,
      includeDiagnostics: false,
    },
  });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const resourceIndex = JSON.parse(strFromU8(entries["resources/project_resource_index.json"]));

  assert.equal(Boolean(entries["project/map_project.json"]), false);
  assert.equal(resourceIndex.resources.editableProject, "map_project.json");
});

test("project package import prepares editable project and preview", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: { target: "per-layer" },
    styleConfig: {},
  }, { format: "zip", packageContents: "diagnostic" });
  Object.defineProperty(blob, "name", { value: "map_project.zip" });

  const prepared = await prepareProjectImportFile(blob);
  assert.equal(prepared.file.name, "map_project.json");
  assert.equal(prepared.preview.packageKind, "editable-project-package");
  assert.equal(prepared.preview.scenario.id, "tno_1962");
  assert.equal(prepared.preview.summary.exportTarget, "per-layer");
  assert.match(await prepared.file.text(), /"schemaVersion": 22/);
});

test("project package import rejects manifest identity mismatch", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  manifest.scenario = { id: "other_scenario", version: 3, baselineHash: "baseline-1" };
  const tampered = new Blob([zipSync({
    ...entries,
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  })], { type: "application/zip" });
  Object.defineProperty(tampered, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(tampered),
    /Project package manifest does not match editable project/
  );
});

test("project package import rejects unparsable primary manifest", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const tampered = new Blob([zipSync({
    ...entries,
    "manifest.json": strToU8("{broken"),
  })], { type: "application/zip" });
  Object.defineProperty(tampered, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(tampered),
    /Project package manifest cannot be parsed/
  );
});

test("project package import rejects missing primary manifest pointer", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const entriesWithoutManifest = { ...entries };
  delete entriesWithoutManifest["manifest.json"];
  const tampered = new Blob([zipSync(entriesWithoutManifest)], { type: "application/zip" });
  Object.defineProperty(tampered, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(tampered),
    /Project ZIP is missing manifest\.json/
  );
});

test("project package import rejects strict manifest without project files", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  manifest.files = [];
  const tampered = new Blob([zipSync({
    ...entries,
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  })], { type: "application/zip" });
  Object.defineProperty(tampered, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(tampered),
    /Project package manifest does not list the editable project file/
  );
});

test("project package import rejects strict manifest without project checksum", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  manifest.files = manifest.files.map((file) => {
    if (file.path !== "project/map_project.json") return file;
    const entryWithoutChecksum = { ...file };
    delete entryWithoutChecksum.checksum;
    return entryWithoutChecksum;
  });
  const tampered = new Blob([zipSync({
    ...entries,
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
  })], { type: "application/zip" });
  Object.defineProperty(tampered, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(tampered),
    /Project package manifest must include editable project checksum/
  );
});

test("project package import rejects oversized zip before unzip", async () => {
  const oversizedFile = {
    name: "map_project.zip",
    size: 33 * 1024 * 1024,
    arrayBuffer: async () => new ArrayBuffer(0),
  };

  await assert.rejects(
    () => prepareProjectImportFile(oversizedFile),
    /Project ZIP is too large/
  );
});

test("project package import rejects too many zip entries", async () => {
  const entries = {
    "map_project.json": strToU8(JSON.stringify({ schemaVersion: 21 })),
  };
  for (let index = 0; index < 129; index += 1) {
    entries[`metadata/extra-${index}.json`] = strToU8("{}");
  }
  const blob = new Blob([zipSync(entries)], { type: "application/zip" });
  Object.defineProperty(blob, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(blob),
    /Project ZIP contains too many files/
  );
});

test("project package import rejects expanded zip beyond import budget", async () => {
  const entries = {
    "map_project.json": strToU8(JSON.stringify({ schemaVersion: 21 })),
    "metadata/oversized.bin": new Uint8Array((64 * 1024 * 1024) + 1),
  };
  const blob = new Blob([zipSync(entries)], { type: "application/zip" });
  Object.defineProperty(blob, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(blob),
    /Project ZIP expands beyond/
  );
});

test("project package import rejects project checksum mismatch", async () => {
  const blob = await exportProjectBlob({
    activeScenarioId: "tno_1962",
    activeScenarioManifest: { version: 3 },
    scenarioBaselineHash: "baseline-1",
    transportWorkbenchUi: {},
    exportWorkbenchUi: {},
    styleConfig: {},
  }, { format: "zip" });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const project = JSON.parse(strFromU8(entries["project/map_project.json"]));
  project.activePaletteId = "kaiserreich";
  const tamperedProjectBytes = strToU8(JSON.stringify(project, null, 2));
  const tampered = new Blob([zipSync({
    ...entries,
    "project/map_project.json": tamperedProjectBytes,
    "map_project.json": tamperedProjectBytes,
  })], { type: "application/zip" });
  Object.defineProperty(tampered, "name", { value: "map_project.zip" });

  await assert.rejects(
    () => prepareProjectImportFile(tampered),
    /Project package manifest does not match editable project/
  );
});

test("project save picker cancel keeps export dirty state unchanged", async () => {
  const previousShowSaveFilePicker = globalThis.showSaveFilePicker;
  const previousDirty = globalThis.__mapcreatorDirtyState;
  globalThis.showSaveFilePicker = async () => {
    const error = new Error("cancelled");
    error.name = "AbortError";
    throw error;
  };

  try {
    const result = await FileManager.exportProject({
      activeScenarioId: "tno_1962",
      activeScenarioManifest: { version: 3 },
      scenarioBaselineHash: "baseline-1",
      transportWorkbenchUi: {},
      exportWorkbenchUi: {},
      styleConfig: {},
    }, { destination: "picker" });
    assert.equal(result, false);
  } finally {
    globalThis.showSaveFilePicker = previousShowSaveFilePicker;
    globalThis.__mapcreatorDirtyState = previousDirty;
  }
});

test("project save picker receives json file type options by default", async () => {
  const previousShowSaveFilePicker = globalThis.showSaveFilePicker;
  const previousDocument = globalThis.document;
  const calls = [];
  const writes = [];

  globalThis.document = {
    getElementById: () => null,
  };
  globalThis.showSaveFilePicker = async (options) => {
    calls.push(options);
    return {
      createWritable: async () => ({
        write: async (blob) => {
          writes.push(blob);
        },
        close: async () => {},
      }),
    };
  };

  try {
    const result = await FileManager.exportProject({
      activeScenarioId: "tno_1962",
      activeScenarioManifest: { version: 3 },
      scenarioBaselineHash: "baseline-1",
      transportWorkbenchUi: {},
      exportWorkbenchUi: {},
      styleConfig: {},
    });

    assert.equal(result, true);
    assert.equal(calls[0].suggestedName, "map_project.json");
    assert.equal(calls[0].excludeAcceptAllOption, true);
    assert.deepEqual(calls[0].types[0].accept, { "application/json": [".json"] });
    assert.equal(writes[0].type, "application/json");
  } finally {
    globalThis.showSaveFilePicker = previousShowSaveFilePicker;
    globalThis.document = previousDocument;
  }
});

test("project zip save picker receives zip file type options", async () => {
  const previousShowSaveFilePicker = globalThis.showSaveFilePicker;
  const previousDocument = globalThis.document;
  const calls = [];

  globalThis.document = {
    getElementById: () => null,
  };
  globalThis.showSaveFilePicker = async (options) => {
    calls.push(options);
    return {
      createWritable: async () => ({
        write: async () => {},
        close: async () => {},
      }),
    };
  };

  try {
    const result = await FileManager.exportProject({
      activeScenarioId: "tno_1962",
      activeScenarioManifest: { version: 3 },
      scenarioBaselineHash: "baseline-1",
      transportWorkbenchUi: {},
      exportWorkbenchUi: {},
      styleConfig: {},
    }, { format: "zip" });

    assert.equal(result, true);
    assert.equal(calls[0].suggestedName, "map_project.zip");
    assert.equal(calls[0].excludeAcceptAllOption, true);
    assert.deepEqual(calls[0].types[0].accept, { "application/zip": [".zip"] });
  } finally {
    globalThis.showSaveFilePicker = previousShowSaveFilePicker;
    globalThis.document = previousDocument;
  }
});

test("project export preserves strategic overlay counters and legacy kind values", async () => {
  const payload = await exportProjectPayload({
    activePaletteId: "hoi4_vanilla",
    annotationView: {},
    exportWorkbenchUi: {},
    operationGraphics: [{
      id: "opg_front_1",
      kind: "front",
      label: "Front",
      points: [[10, 20], [30, 40]],
      stylePreset: "front",
      stroke: "#334455",
      width: 2,
      opacity: 0.8,
    }],
    operationalLines: [{
      id: "opl_axis_1",
      kind: "axis",
      label: "Axis",
      points: [[11, 21], [31, 41]],
      stylePreset: "axis",
      stroke: "#445566",
      width: 3,
      opacity: 0.75,
      attachedCounterIds: ["unit_1"],
    }],
    showSpecialZones: true,
    specialZoneMembershipBrushMode: "remove",
    specialZoneLayers: {
      layers: [{
        id: "layer-a",
        name: "Layer A",
        visible: true,
        legendVisible: false,
        style: { fill: "#112233", stroke: "#445566", pattern: "dots" },
        memberFeatureIds: ["z", "a"],
      }],
      activeLayerId: "layer-a",
    },
    styleConfig: {
      specialZones: { disputedFill: "#ffffff" },
      transportOverview: {
        activePackIdByFamily: { road: "germany_road" },
      },
      rivers: {
        opacity: 3,
        width: 0.01,
        outlineWidth: -3,
        dashStyle: "",
      },
    },
    transportWorkbenchUi: {
      activeFamily: "road",
      activePackId: "germany_road",
      activePackIdByFamily: { road: "germany_road", rail: "france_rail" },
    },
    transportCountryOverlayState: {
      activePackId: "france_rail",
      family: "rail",
      activePackIdByFamily: { road: "germany_road", rail: "france_rail" },
      status: "ready",
      collectionsByLayer: { railways: { type: "FeatureCollection", features: [] } },
    },
    unitCounters: [{
      id: "unit_1",
      renderer: "milstd",
      sidc: "130310001412110000000000000000",
      symbolCode: "130310001412110000000000000000",
      label: "I Corps",
      nationTag: "GER",
      nationSource: "manual",
      presetId: "inf",
      unitType: "INF",
      iconId: "infantry",
      echelon: "corps",
      subLabel: "Nord",
      strengthText: "Fresh",
      baseFillColor: "#e8decd",
      organizationPct: 84,
      equipmentPct: 73,
      statsPresetId: "regular",
      statsSource: "manual",
      size: "large",
      facing: 12,
      zIndex: 5,
      anchor: { lon: 181, lat: -91, featureId: "GER" },
      layoutAnchor: { kind: "attachment", key: "opl_axis_1", slotIndex: 2 },
      attachment: { kind: "operational-line", lineId: "opl_axis_1" },
    }],
  });

  assert.deepEqual(payload.operationGraphics, [{
    id: "opg_front_1",
    kind: "front",
    label: "Front",
    points: [[10, 20], [30, 40]],
    stylePreset: "front",
    stroke: "#334455",
    width: 2,
    opacity: 0.8,
  }]);
  assert.deepEqual(payload.operationalLines, [{
    id: "opl_axis_1",
    kind: "axis",
    label: "Axis",
    points: [[11, 21], [31, 41]],
    stylePreset: "axis",
    stroke: "#445566",
    width: 3,
    opacity: 0.75,
    attachedCounterIds: ["unit_1"],
  }]);
  assert.equal(payload.unitCounters[0].baseFillColor, "#e8decd");
  assert.equal(payload.unitCounters[0].organizationPct, 84);
  assert.equal(payload.unitCounters[0].equipmentPct, 73);
  assert.equal(payload.unitCounters[0].statsPresetId, "regular");
  assert.equal(payload.unitCounters[0].statsSource, "manual");
  assert.deepEqual(payload.unitCounters[0].anchor, { lon: 180, lat: -90, featureId: "GER" });
  assert.deepEqual(payload.unitCounters[0].attachment, { kind: "operational-line", lineId: "opl_axis_1" });
  assert.deepEqual(payload.unitCounters[0].layoutAnchor, { kind: "attachment", key: "opl_axis_1", slotIndex: 2 });
  assert.equal(payload.specialZoneMembershipBrushMode, "remove");
  assert.equal(payload.layerVisibility.showSpecialZones, true);
  assert.deepEqual(payload.specialZoneLayers.layers[0].memberFeatureIds, ["a", "z"]);
  assert.equal(payload.specialZoneLayers.layers[0].legendVisible, false);
  assert.equal(Object.hasOwn(payload.styleConfig, "specialZones"), false);
  assert.equal(payload.styleConfig.transportOverview.activePackIdByFamily.road, "germany_road");
  assert.deepEqual(payload.styleConfig.rivers, {
    color: "#3b82f6",
    opacity: 1,
    width: 0.2,
    outlineColor: "#e2efff",
    outlineWidth: 0,
    dashStyle: "solid",
  });
  assert.equal(payload.transportWorkbenchUi.activePackId, "germany_road");
  assert.equal(payload.transportWorkbenchUi.activePackIdByFamily.rail, "france_rail");
  assert.deepEqual(payload.transportCountryOverlayState, {
    activePackId: "germany_road",
    family: "road",
    activePackIdByFamily: { road: "germany_road", rail: "france_rail" },
  });
  assert.equal(payload.exportHandoff.artifactKind, "project-json");
  assert.equal(payload.exportHandoff.exportUi.target, "composite");
  assert.equal(Object.hasOwn(payload.exportHandoff.exportUi, "bakeCache"), false);
  assert.deepEqual(payload.manualSpecialZones, { type: "FeatureCollection", features: [] });
  assert.equal(Object.hasOwn(payload, "specialRegionOverrides"), false);
});

test("project import notifies observers after successful import", async () => {
  const payload = await exportProjectPayload({
    activePaletteId: "hoi4_vanilla",
    annotationView: {},
    exportWorkbenchUi: {},
    styleConfig: {
      transportOverview: {
        activePackIdByFamily: { road: "germany_road" },
      },
    },
    transportWorkbenchUi: {
      activeFamily: "road",
      activePackIdByFamily: { road: "germany_road" },
    },
  });

  const result = await importProjectPayload(payload);

  assert.equal(result.callbacks.length, 1);
  assert.equal(result.successes.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.successes[0].styleConfig.transportOverview.activePackIdByFamily.road, "germany_road");
  assert.equal(result.successes[0].exportHandoff.artifactKind, "project-json");
  assert.equal(result.successes[0].exportHandoff.exportUi.target, "composite");
});

test("project export and import preserve transport workbench point deltas", async () => {
  const payload = await exportProjectPayload({
    activePaletteId: "hoi4_vanilla",
    annotationView: {},
    exportWorkbenchUi: {},
    transportWorkbenchPointDeltas: {
      byFamily: {
        airport: {
          created: [{
            id: "airport_edit_1",
            name: "Project Airfield",
            lon: 139.77,
            lat: 35.68,
            packId: "usa_airport",
            properties: { status_category: "active" },
          }, {
            id: "bad_airport",
            name: "Bad",
            lon: "not-a-number",
            lat: 35,
          }],
          updated: [{
            id: "airport_source_1",
            name: "Edited Source Airport",
            lon: 139.76,
            lat: 35.67,
            packId: "usa_airport",
            properties: { status_category: "inactive" },
          }],
          deleted: ["airport_source_2"],
        },
        logistics_hubs: {
          created: [{
            id: "hub_edit_1",
            name: "Project Hub",
            lon: 9.99,
            lat: 53.55,
            packId: "germany_logistics_hubs",
            properties: { hub_type: "intermodal", operator_classification: "rail-road" },
          }],
          updated: [{
            id: "hub_source_1",
            name: "Edited Hub",
            lon: 10.01,
            lat: 53.56,
            packId: "germany_logistics_hubs",
            properties: { hub_type: "freight_terminal", operator_classification: "public" },
          }],
          deleted: ["hub_source_2"],
        },
      },
    },
    transportWorkbenchUi: {
      activeFamily: "airport",
      activePackIdByFamily: { airport: "usa_airport" },
    },
    legendControl: {
      visible: true,
      collapsed: true,
      xRatio: 0.77,
      yRatio: 0.12,
      width: 320,
      height: 220,
      opacity: 0.62,
    },
  });

  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.airport.created.length, 1);
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.airport.created[0].properties.source, "user_overlay");
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.airport.updated.length, 1);
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.airport.updated[0].properties.status_category, "inactive");
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.airport.updated[0].properties.source, undefined);
  assert.deepEqual(payload.transportWorkbenchPointDeltas.byFamily.airport.deleted, ["airport_source_2"]);
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.logistics_hubs.created[0].properties.hub_type, "intermodal");
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.logistics_hubs.updated[0].properties.hub_type, "freight_terminal");
  assert.equal(payload.transportWorkbenchPointDeltas.byFamily.logistics_hubs.updated[0].properties.source, undefined);

  const result = await importProjectPayload(payload);

  assert.equal(result.callbacks.length, 1);
  assert.equal(result.successes[0].transportWorkbenchPointDeltas.byFamily.airport.created[0].id, "airport_edit_1");
  const importedUpdate = result.successes[0].transportWorkbenchPointDeltas.byFamily.airport.updated[0];
  assert.equal(importedUpdate.id, "airport_source_1");
  assert.equal(importedUpdate.packId, "usa_airport");
  assert.equal(importedUpdate.properties.status_category, "inactive");
  assert.equal(importedUpdate.properties.source, undefined);
  assert.deepEqual(result.successes[0].transportWorkbenchPointDeltas.byFamily.airport.deleted, ["airport_source_2"]);
  assert.equal(result.successes[0].transportWorkbenchPointDeltas.byFamily.port.created.length, 0);
  assert.equal(result.successes[0].transportWorkbenchPointDeltas.byFamily.logistics_hubs.created[0].properties.operator_classification, "rail-road");
  assert.equal(result.successes[0].transportWorkbenchPointDeltas.byFamily.logistics_hubs.updated[0].properties.operator_classification, "public");
  assert.deepEqual(result.successes[0].transportWorkbenchPointDeltas.byFamily.logistics_hubs.deleted, ["hub_source_2"]);
  assert.deepEqual(result.successes[0].legendControl, {
    visible: true,
    collapsed: true,
    xRatio: 0.77,
    yRatio: 0.12,
    width: 320,
    height: 220,
    opacity: 0.62,
  });
});

test("project import overlay resolver preserves every main-map transport family", () => {
  const packIds = resolveImportedTransportCountryOverlayPackIds(
    {
      styleConfig: {
        transportOverview: {
          activePackIdByFamily: {
            port: "germany_port",
          },
        },
      },
    },
    {
      transportCountryOverlayState: {
        activePackId: "france_rail",
        activePackIdByFamily: {
          road: "germany_road",
          rail: "france_rail",
          airport: "usa_airport",
          port: "usa_port",
          mineral_resources: "germany_mineral_resources",
        },
      },
    }
  );

  assert.deepEqual(packIds, ["germany_road", "france_rail", "usa_airport", "usa_port", "germany_port"]);
});

test("project import through funnel restores visible transport overview layers from registry metadata", async () => {
  const requests = await importProjectThroughFunnelPayload(
    createTransportOverviewImportPayload({
      showAirports: true,
      showPorts: false,
      showRail: true,
      showRoad: true,
      showTransport: true,
    })
  );

  assert.deepEqual(requests, [
    {
      layerRequest: "roads",
      options: { reason: "project-import", renderNow: false },
    },
    {
      layerRequest: ["railways", "rail_stations_major"],
      options: { reason: "project-import", renderNow: false },
    },
    {
      layerRequest: "airports",
      options: { reason: "project-import", renderNow: false },
    },
  ]);
});

test("project import through funnel skips transport overview layer restores when master visibility is off", async () => {
  const requests = await importProjectThroughFunnelPayload(
    createTransportOverviewImportPayload({
      showAirports: true,
      showPorts: true,
      showRail: true,
      showRoad: true,
      showTransport: false,
    })
  );

  assert.deepEqual(requests, []);
});

test("project import success is not reclassified when status observer fails", async () => {
  const previousConsoleError = console.error;
  const consoleErrors = [];
  console.error = (...args) => {
    consoleErrors.push(args);
  };

  try {
    const payload = await exportProjectPayload({
      activePaletteId: "hoi4_vanilla",
      annotationView: {},
      exportWorkbenchUi: {},
      styleConfig: {
        transportOverview: {
          activePackIdByFamily: { road: "germany_road" },
        },
      },
    });

    const result = await importProjectPayload(payload, {
      onSuccess: () => {
        throw new Error("status render failed");
      },
    });

    assert.equal(result.callbacks.length, 1);
    assert.equal(result.successes.length, 1);
    assert.equal(result.errors.length, 0);
    assert.match(String(consoleErrors[0]?.[0] || ""), /success observer failed/);
  } finally {
    console.error = previousConsoleError;
  }
});


test("ZIP download serializes the editable project once", async () => {
  let serializations = 0;
  const payload = { schemaVersion: 22, toJSON() { serializations++; return { schemaVersion: 22 }; } };
  const { blob } = await FileManager.buildProjectDownloadPayload(payload, { format: "zip" });
  assert.equal(serializations, 1);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(entries["map_project.json"], entries["project/map_project.json"]);
});

test("ZIP parsed import skips FileReader while retaining preview, normalization and observers", async t => {
  const { blob } = await FileManager.buildProjectDownloadPayload({ schemaVersion: 22, visualOverrides: { A: "#123456" } }, { format: "zip" });
  Object.defineProperty(blob, "name", { value: "map_project.zip" });
  const projectText = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))["map_project.json"]);
  const oldReader = globalThis.FileReader, oldFile = globalThis.File, oldDocument = globalThis.document;
  const parse = JSON.parse;
  let projectParses = 0;
  globalThis.FileReader = class { constructor() { throw new Error("Unexpected FileReader"); } };
  globalThis.File = class { constructor() { throw new Error("Unexpected File materialization"); } };
  globalThis.document = { getElementById: () => null };
  JSON.parse = function(text, ...args) { if (text === projectText) projectParses++; return parse.call(this, text, ...args); };
  t.after(() => { globalThis.FileReader = oldReader; globalThis.File = oldFile; globalThis.document = oldDocument; JSON.parse = parse; });
  const prepared = await prepareProjectImportFile(blob, { materializeFile: false });
  assert.equal(prepared.file, null);
  assert.equal(prepared.preview.packageKind, "editable-project-package");
  assert.equal(prepared.projectPayload.schemaVersion, 22);
  assert.equal(projectParses, 1);
  projectParses = 0;
  const events = [];
  assert.equal(await FileManager.importProject(blob, async data => {
    assert.equal(data.visualOverrides.A, "#123456");
    events.push("callback");
  }, { onSuccess: () => events.push("success"), onError: () => events.push("error") }), true);
  assert.equal(projectParses, 1);
  assert.deepEqual(events, ["callback", "success"]);
  events.length = 0;
  const oldError = console.error;
  console.error = () => {};
  try {
    assert.equal(await FileManager.importProject(blob, () => { throw new Error("apply failed"); }, {
      onSuccess: () => events.push("success"), onError: error => events.push(error.message),
    }), false);
    assert.deepEqual(events, ["apply failed"]);
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    entries["project/map_project.json"] = strToU8('{"schemaVersion":22,"visualOverrides":{}}');
    const tampered = new Blob([zipSync(entries)], { type: "application/zip" });
    let callbackCount = 0;
    assert.equal(await FileManager.importProject(tampered, () => callbackCount++, {
      onError: error => events.push(error.message),
    }), false);
    assert.equal(callbackCount, 0);
    assert.equal(events.length, 2);
  } finally { console.error = oldError; }
});
