import test from "node:test";
import assert from "node:assert/strict";

import { FileManager } from "../js/core/file_manager.js";
import { getInteractionFunnelDebugState, importProjectThroughFunnel, resetInteractionFunnelDebugState } from "../js/core/interaction_funnel.js";
import { prepareProjectImportFile } from "../js/core/project_package_io.js";
import { state } from "../js/core/state.js";
import {
  readRegisteredRuntimeHookSource,
  registerRuntimeHook,
} from "../js/core/state/index.js";
import { unzipSync, zipSync, strFromU8, strToU8 } from "../vendor/fflate.browser.js";

test("operation label settings and manual curvature survive save and import with sparse defaults", async () => {
  const points = [[0, 0], [1, 1], [2, 0]];
  const entries = [
    { id: "custom", kind: "encirclement", points, labelSize: 14.5, labelOnPath: true },
    { id: "defaults", points, labelSize: 9, labelOnPath: false },
    { id: "legacy", points },
  ];
  const payload = await exportProjectPayload({
    projectName: "Atlas: North", projectFileStem: "old", annotationView: { showMapLabels: false },
    styleConfig: {}, operationalLines: entries, operationGraphics: entries,
    mapLabels: [42, 0].map((curve, i) => ({ id: String(i), lon: 0, lat: 0, text: "Arc", curve })),
  });
  const imported = (await importProjectPayload(payload)).successes[0];
  assert.equal(payload.projectName, "Atlas: North");
  assert.equal(Object.hasOwn(payload, "projectFileStem"), false);
  assert.equal(imported.annotationView.showMapLabels, false);
  for (const project of [payload, imported]) {
    assert.equal(project.mapLabels[0].curve, 42);
    assert.equal(Object.hasOwn(project.mapLabels[1], "curve"), false);
    for (const collection of [project.operationalLines, project.operationGraphics]) {
      assert.equal(collection[0].labelSize, 14.5);
      assert.equal(collection[0].labelOnPath, true);
      for (const entry of collection.slice(1)) {
        assert.equal(Object.hasOwn(entry, "labelSize"), false);
        assert.equal(Object.hasOwn(entry, "labelOnPath"), false);
      }
    }
  }
});

async function exportProjectPayload(appState) {
  const blob = await exportProjectBlob(appState);
  return JSON.parse(await blob.text());
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

async function importProjectPayload(payload) {
  const previousDocument = globalThis.document;
  const previousFileReader = globalThis.FileReader;
  const successes = [];

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
      async () => {},
      { onSuccess: data => successes.push(data) }
    );
    return { successes };
  } finally {
    globalThis.document = previousDocument;
    globalThis.FileReader = previousFileReader;
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

  const previousClearExportBakeCache = readRegisteredRuntimeHookSource(state, "clearExportBakeCacheFn");
  let failRefresh = true;
  registerRuntimeHook(state, "clearExportBakeCacheFn", () => {
    if (failRefresh) throw new Error("debug reset sentinel");
  });
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
    registerRuntimeHook(state, "clearExportBakeCacheFn", previousClearExportBakeCache);
    globalThis.document = previousDocument;
    globalThis.FileReader = previousFileReader;
  }
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
