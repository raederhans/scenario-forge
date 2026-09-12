import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { FileManager } from "../js/core/file_manager.js";
import {
  loadPublicSampleProjectIntoRuntime,
  writeSampleProjectState,
} from "../js/core/sample_project_import_workflow.js";
import {
  scheduleStartupSampleProjectDeeplink,
  tryScheduleStartupSampleProjectDeeplink,
} from "../js/bootstrap/startup_sample_project_deeplink.js";
import { registerRuntimeHook } from "../js/core/state/index.js";
import {
  loadPublicSampleProjectList,
  loadSampleProjectText,
  resolvePublicSampleProjectListFromManifest,
  resolveSampleProjectFromManifest,
  SampleProjectLoadError,
} from "../js/core/sample_project_registry.js";
import { createUiSurfaceUrlState } from "../js/ui/ui_surface_url_state.js";
import {
  collectSampleExportRecommendationIssues,
  resolveSampleExportRecommendationContext,
} from "../js/core/sample_export_recommendation.js";
import {
  resolveExportWorkbenchSampleContext,
} from "../js/ui/toolbar/export_workbench_controller.js";
import {
  createSampleProjectBannerController,
  createSampleProjectGuideCardController,
  resolveSampleProjectBannerView,
  resolveSampleProjectGuideContext,
} from "../js/ui/toolbar/sample_project_banner_controller.js";

const SAMPLE_RUNS_PATH = "landing/assets/sample-runs.json";
const PUBLIC_SCENARIO_IDS = [
  "blank_base",
  "modern_world",
  "hoi4_1936",
  "hoi4_1939",
  "tno_1962",
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

test("sample project state commit, refresh hook, and return value share one root object", () => {
  const targetState = {
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "previous-sample",
      scenarioId: "previous-scenario",
      title: "Previous sample",
    },
  };
  let hookState = null;
  registerRuntimeHook(targetState, "refreshSampleProjectBannerFn", (sampleState) => {
    hookState = sampleState;
  });

  try {
    const result = writeSampleProjectState(targetState, {
      status: "loading",
      sampleId: "next-sample",
    });

    assert.equal(result, targetState.sampleProjectDeeplink);
    assert.equal(hookState, targetState.sampleProjectDeeplink);
    assert.equal(result, hookState);
    assert.equal(result.previousSampleId, "previous-sample");
    assert.ok(Number(result.updatedAt) > 0);
  } finally {
    registerRuntimeHook(targetState, "refreshSampleProjectBannerFn", null);
  }
});

function resolveLandingUrl(url) {
  assert.match(url, /^\.\//, `sample URL must be relative: ${url}`);
  return `landing/${url.slice(2)}`;
}

function readLandingUrlJson(url) {
  return readJson(resolveLandingUrl(url));
}

function assertNoDeveloperPreviewId(value, context) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("hgo_1936"), false, `${context} must stay outside developer preview assets`);
}

function resolveMarkerPath(value, expression) {
  let current = value;
  for (const segment of expression.split(".")) {
    if (segment === "length") {
      assert.ok(
        typeof current === "string" || Array.isArray(current),
        `marker segment length requires an array or string for ${expression}`,
      );
      current = current.length;
      continue;
    }
    assert.ok(current && Object.hasOwn(current, segment), `marker segment missing: ${expression}`);
    current = current[segment];
  }
  return current;
}

function resolveEvidenceMarker(marker) {
  const [assetPath, expression] = marker.split(":");
  assert.ok(assetPath && expression, `invalid evidence marker: ${marker}`);
  const asset = readJson(assetPath);
  return expression
    .split("+")
    .map((part) => resolveMarkerPath(asset, part))
    .reduce((total, value) => total + Number(value), 0);
}

class SampleBannerTestClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) {
      this.values.add(name);
    } else {
      this.values.delete(name);
    }
  }

  contains(name) {
    return this.values.has(name);
  }
}

class SampleBannerTestElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new SampleBannerTestClassList();
    this.children = [];
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.textContent = "";
    this.type = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, handler) {
    this.listeners.set(name, handler);
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  click() {
    this.listeners.get("click")?.();
  }
}

async function importProjectPayload(payload) {
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
        onSuccess: (data) => successes.push(data),
        onError: (error) => errors.push(error),
      },
    );
    return { callbacks, errors, successes };
  } finally {
    globalThis.document = previousDocument;
    globalThis.FileReader = previousFileReader;
  }
}

function assertSampleProjectError(callback, expectedCode) {
  assert.throws(
    callback,
    (error) => error instanceof SampleProjectLoadError && error.code === expectedCode,
  );
}

function cloneWithSampleProject(manifest, projectPatch) {
  return {
    ...manifest,
    sample_projects: [
      ...manifest.sample_projects,
      {
        id: "unsafe-sample",
        title: "Unsafe sample",
        scenario_id: "blank_base",
        project_url: "./assets/sample-projects/blank-base-starter.project.json",
        ...projectPatch,
      },
    ],
  };
}

test("sample runs manifest exposes only public scenario project downloads", () => {
  const scenarioIndex = readJson("data/scenarios/index.json");
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const publicScenarioIds = new Set(scenarioIndex.public_baseline_ids);
  const sampleProjectScenarioIds = manifest.sample_projects.map((project) => project.scenario_id);
  const sampleProjectIds = manifest.sample_projects.map((project) => project.id);
  const sampleProjectUrls = manifest.sample_projects.map((project) => project.project_url);

  assert.deepEqual(scenarioIndex.public_baseline_ids, PUBLIC_SCENARIO_IDS);
  assert.deepEqual(manifest.public_scenario_ids, PUBLIC_SCENARIO_IDS);
  assert.deepEqual(manifest.developer_preview_exclusions, scenarioIndex.developer_preview_ids);
  assert.equal(manifest.sample_projects.length, PUBLIC_SCENARIO_IDS.length);
  assert.equal(new Set(sampleProjectIds).size, sampleProjectIds.length);
  assert.equal(new Set(sampleProjectUrls).size, sampleProjectUrls.length);
  assert.deepEqual(sampleProjectScenarioIds, PUBLIC_SCENARIO_IDS);
  assert.equal(manifest.project_schema_version, 22);
  assertNoDeveloperPreviewId(manifest.sample_projects, "sample project manifest");

  for (const project of manifest.sample_projects) {
    assert.ok(publicScenarioIds.has(project.scenario_id), `${project.id} must use a public scenario`);
    const projectPath = resolveLandingUrl(project.project_url);
    assert.ok(existsSync(new URL(`../${projectPath}`, import.meta.url)), `missing ${projectPath}`);
  }
});

test("public sample export recommendations are valid and stay public-only", () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);

  for (const project of manifest.sample_projects) {
    const issues = collectSampleExportRecommendationIssues(project.recommended_export);
    assert.deepEqual(issues, [], `${project.id} recommended export should match export workbench options`);
    assert.ok(project.recommended_export.label, `${project.id} recommended export label is required`);
  }

  const tnoProject = manifest.sample_projects.find((project) => project.id === "tno-1962-atlantropa-briefing");
  assert.equal(tnoProject.recommended_export.label, "2x PNG briefing map");
  assert.equal(tnoProject.recommended_export.target, "composite");
  assert.equal(tnoProject.recommended_export.format, "png");
  assert.equal(tnoProject.recommended_export.scale, "2");
  assertNoDeveloperPreviewId(manifest.sample_projects, "sample export recommendations");
});

test("sample project JSON files match current scenario baselines and import cleanly", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const publicScenarioIds = new Set(manifest.public_scenario_ids);

  for (const project of manifest.sample_projects) {
    const payload = readLandingUrlJson(project.project_url);
    const scenarioManifest = readJson(`data/scenarios/${project.scenario_id}/manifest.json`);

    assert.equal(payload.schemaVersion, manifest.project_schema_version, `${project.id} schema version drifted`);
    assert.equal(payload.scenario?.id, project.scenario_id, `${project.id} scenario id drifted`);
    assert.ok(publicScenarioIds.has(payload.scenario.id), `${project.id} must import a public scenario`);
    assert.equal(payload.scenario.version, scenarioManifest.version, `${project.id} scenario version drifted`);
    assert.equal(payload.scenario.baselineHash, scenarioManifest.baseline_hash, `${project.id} baseline hash drifted`);
    assertNoDeveloperPreviewId(payload, project.id);

    const result = await importProjectPayload(payload);
    assert.equal(result.errors.length, 0, `${project.id} import should not emit errors`);
    assert.equal(result.callbacks.length, 1, `${project.id} import callback count drifted`);
    assert.equal(result.successes.length, 1, `${project.id} import success count drifted`);
    assert.equal(result.callbacks[0].schemaVersion, manifest.project_schema_version, `${project.id} imported schema drifted`);
    assert.equal(result.callbacks[0].scenario?.id, project.scenario_id, `${project.id} imported scenario drifted`);
    assert.equal(
      result.callbacks[0].scenario?.baselineHash,
      scenarioManifest.baseline_hash,
      `${project.id} imported baseline hash drifted`,
    );
  }
});

test("sample project registry resolves only public checked-in project assets", () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);

  for (const project of manifest.sample_projects) {
    const resolved = resolveSampleProjectFromManifest(manifest, project.id);
    assert.equal(resolved.id, project.id);
    assert.equal(resolved.scenarioId, project.scenario_id);
    assert.equal(resolved.projectUrl, project.project_url);
    assert.match(resolved.fileName, /^[a-z0-9-]+\.project\.json$/);
    assert.equal(resolved.appProjectUrl, `../assets/sample-projects/${resolved.fileName}`);
  }

  assertSampleProjectError(
    () => resolveSampleProjectFromManifest(manifest, "missing-public-sample"),
    "unknown-sample-id",
  );
  assertSampleProjectError(
    () => resolveSampleProjectFromManifest(manifest, "hgo_1936"),
    "invalid-sample-id",
  );
  assertSampleProjectError(
    () => resolveSampleProjectFromManifest(
      cloneWithSampleProject(manifest, { id: "hgo-preview", scenario_id: "hgo_1936" }),
      "hgo-preview",
    ),
    "private-sample-scenario",
  );
  assertSampleProjectError(
    () => resolveSampleProjectFromManifest(
      cloneWithSampleProject(manifest, { project_url: "https://example.test/map.project.json" }),
      "unsafe-sample",
    ),
    "unsafe-project-url",
  );
  assertSampleProjectError(
    () => resolveSampleProjectFromManifest(
      cloneWithSampleProject(manifest, { project_url: "./assets/sample-projects/../hgo_1936.project.json" }),
      "unsafe-sample",
    ),
    "unsafe-project-file",
  );
  assertSampleProjectError(
    () => resolveSampleProjectFromManifest(
      cloneWithSampleProject(manifest, {
        recommended_export: {
          label: "Bad export",
          target: "movie",
          format: "gif",
          scale: "3",
          previewMode: "overview",
          layerOrder: ["background"],
          visibleLayers: ["background"],
          textLayers: ["render-labels"],
        },
      }),
      "unsafe-sample",
    ),
    "invalid-sample-recommendation",
  );
});

test("public sample list resolver keeps manifest validation separate from public display filtering", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const publicList = resolvePublicSampleProjectListFromManifest(manifest);

  assert.equal(publicList.length, 5);
  assert.deepEqual(publicList.map((entry) => entry.id), manifest.sample_projects.map((entry) => entry.id));
  assert.equal(publicList.find((entry) => entry.id === "modern-world-japan-corridor").scenarioId, "modern_world");
  assert.deepEqual(
    publicList.find((entry) => entry.id === "tno-1962-atlantropa-briefing").recipe,
    ["TNO political owners", "Atlantropa basins", "Coastline detail", "Mediterranean labels"],
  );
  assertNoDeveloperPreviewId(publicList, "public sample list");

  const manifestWithHiddenHgo = cloneWithSampleProject(manifest, {
    id: "hgo-preview-valid",
    scenario_id: "hgo_1936",
    project_url: "./assets/sample-projects/blank-base-starter.project.json",
  });
  const filteredList = resolvePublicSampleProjectListFromManifest(manifestWithHiddenHgo);
  assert.equal(filteredList.some((entry) => entry.id === "hgo-preview-valid"), false);

  assertSampleProjectError(
    () => resolvePublicSampleProjectListFromManifest(
      cloneWithSampleProject(manifest, {
        id: "hgo-preview-unsafe",
        scenario_id: "hgo_1936",
        project_url: "https://example.test/hgo.project.json",
      }),
    ),
    "unsafe-project-url",
  );

  const fetchCalls = [];
  const loadedList = await loadPublicSampleProjectList({
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return { ok: true, json: async () => manifest };
    },
  });
  assert.deepEqual(fetchCalls, ["../assets/sample-runs.json"]);
  assert.deepEqual(loadedList.map((entry) => entry.id), publicList.map((entry) => entry.id));
});

test("sample project loader fetches manifest before checked-in project JSON", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const project = manifest.sample_projects.find((entry) => entry.id === "tno-1962-atlantropa-briefing");
  const payloadText = JSON.stringify(readLandingUrlJson(project.project_url));
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url === "../assets/sample-runs.json") {
      return { ok: true, json: async () => manifest };
    }
    if (url === "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json") {
      return { ok: true, text: async () => payloadText };
    }
    return { ok: false };
  };

  const { sampleProject, text } = await loadSampleProjectText("tno-1962-atlantropa-briefing", { fetchImpl });
  assert.equal(sampleProject.id, "tno-1962-atlantropa-briefing");
  assert.equal(sampleProject.scenarioId, "tno_1962");
  assert.deepEqual(fetchCalls, [
    "../assets/sample-runs.json",
    "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
  ]);

  const callbacks = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => null,
  };
  try {
    const importResult = await FileManager.importProjectText(text, async (data) => {
      callbacks.push(data);
    });
    assert.equal(importResult, true);
    assert.equal(callbacks.length, 1);
    assert.equal(callbacks[0].scenario?.id, "tno_1962");
  } finally {
    globalThis.document = previousDocument;
  }

  const unknownFetchCalls = [];
  await assert.rejects(
    () => loadSampleProjectText("missing-public-sample", {
      fetchImpl: async (url) => {
        unknownFetchCalls.push(url);
        return { ok: true, json: async () => manifest };
      },
    }),
    (error) => error instanceof SampleProjectLoadError && error.code === "unknown-sample-id",
  );
  assert.deepEqual(unknownFetchCalls, ["../assets/sample-runs.json"]);

  const invalidFetchCalls = [];
  await assert.rejects(
    () => loadSampleProjectText("hgo_1936", {
      fetchImpl: async (url) => {
        invalidFetchCalls.push(url);
        return { ok: false };
      },
    }),
    (error) => error instanceof SampleProjectLoadError && error.code === "invalid-sample-id",
  );
  assert.deepEqual(invalidFetchCalls, []);
});

test("sample startup import failures record state without duplicate sample toast", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const scheduledTasks = [];
  const helperToasts = [];
  const targetState = { bootPhase: "ready", uiHydrationStatus: "ready" };
  const didSchedule = scheduleStartupSampleProjectDeeplink({
    targetState,
    postReadyScheduler: {
      scheduleTask: (key, callback, options) => {
        scheduledTasks.push({ key, callback, options });
      },
    },
    helpers: {
      search: "?sample=tno-1962-atlantropa-briefing&view=guide",
      fetchImpl: async (url) => {
        if (url === "../assets/sample-runs.json") {
          return { ok: true, json: async () => manifest };
        }
        if (url === "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json") {
          return { ok: true, text: async () => "{" };
        }
        return { ok: false };
      },
      showToast: (message, options) => {
        helperToasts.push({ message, options });
      },
      scheduleOptions: {
        allowChunkBacklog: false,
        idleQuietMs: 999,
        minIdleTimeRemainingMs: 999,
        retryDelayMs: 5,
      },
    },
  });

  assert.equal(didSchedule, true);
  assert.equal(scheduledTasks.length, 1);
  assert.equal(scheduledTasks[0].options.allowChunkBacklog, true);
  assert.equal(scheduledTasks[0].options.idleQuietMs, 0);
  assert.equal(scheduledTasks[0].options.minIdleTimeRemainingMs, 0);
  assert.equal(scheduledTasks[0].options.retryDelayMs, 5);
  assert.equal(targetState.sampleProjectDeeplink.status, "pending");

  await scheduledTasks[0].callback();

  assert.equal(helperToasts.length, 0);
  assert.equal(targetState.sampleProjectDeeplink.status, "error");
  assert.equal(targetState.sampleProjectDeeplink.sampleId, "tno-1962-atlantropa-briefing");
  assert.equal(targetState.sampleProjectDeeplink.scenarioId, "tno_1962");
  assert.equal(targetState.sampleProjectDeeplink.errorCode, "sample-project-import-failed");
});

test("sample startup deeplink stays fail-closed until both map and UI are ready", () => {
  const scheduledTasks = [];
  const targetState = { bootPhase: "ready", uiHydrationStatus: "pending" };
  const options = {
    targetState,
    postReadyScheduler: {
      scheduleTask: (...args) => scheduledTasks.push(args),
    },
    helpers: {
      search: "?sample=tno-1962-atlantropa-briefing",
    },
  };

  assert.equal(scheduleStartupSampleProjectDeeplink(options), false);
  targetState.uiHydrationStatus = "failed";
  assert.equal(scheduleStartupSampleProjectDeeplink(options), false);
  targetState.uiHydrationStatus = "ready";
  targetState.bootPhase = "error";
  assert.equal(scheduleStartupSampleProjectDeeplink(options), false);
  assert.deepEqual(scheduledTasks, []);
  assert.equal(targetState.sampleProjectDeeplink, undefined);
});

test("sample startup deeplink schedules exactly once whichever ready gate opens first", () => {
  for (const gateOrder of [
    ["uiHydrationStatus", "bootPhase"],
    ["bootPhase", "uiHydrationStatus"],
  ]) {
    const scheduledTasks = [];
    const targetState = { bootPhase: "warmup", uiHydrationStatus: "pending" };
    const options = {
      targetState,
      postReadyScheduler: {
        scheduleTask: (...args) => scheduledTasks.push(args),
      },
      helpers: {
        search: "?sample=tno-1962-atlantropa-briefing",
      },
    };

    targetState[gateOrder[0]] = "ready";
    assert.equal(tryScheduleStartupSampleProjectDeeplink(options), false);
    targetState[gateOrder[1]] = "ready";
    assert.equal(tryScheduleStartupSampleProjectDeeplink(options), true);
    assert.equal(tryScheduleStartupSampleProjectDeeplink(options), false);
    assert.equal(scheduledTasks.length, 1, `duplicate schedule for ${gateOrder.join("->")}`);
  }
});

test("shared sample import workflow preserves committed sample during failed switch", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const publicSampleProjects = resolvePublicSampleProjectListFromManifest(manifest);
  const tnoRecommendation = publicSampleProjects.find(
    (entry) => entry.id === "tno-1962-atlantropa-briefing",
  ).recommendedExport;
  const modernRecommendation = publicSampleProjects.find(
    (entry) => entry.id === "modern-world-japan-corridor",
  ).recommendedExport;
  const targetState = {
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
      title: "TNO 1962 Atlantropa briefing",
      recommendedExport: tnoRecommendation,
    },
  };
  const refreshSnapshots = [];
  // 这条测试锁住“切换失败仍保留上一个成功样例”的公共合同；Guide card 的 selectedSampleId 依赖 previousSampleId。
  registerRuntimeHook(targetState, "refreshSampleProjectBannerFn", (sampleState) => {
    refreshSnapshots.push({
      status: sampleState.status,
      sampleId: sampleState.sampleId,
      previousSampleId: sampleState.previousSampleId,
      errorCode: sampleState.errorCode,
    });
  });

  try {
    const result = await loadPublicSampleProjectIntoRuntime("modern-world-japan-corridor", {
      targetState,
      helpers: {
        fetchImpl: async (url) => {
          if (url === "../assets/sample-runs.json") {
            return { ok: true, json: async () => manifest };
          }
          if (url === "../assets/sample-projects/modern-world-japan-corridor.project.json") {
            return { ok: true, text: async () => "{" };
          }
          return { ok: false };
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(targetState.sampleProjectDeeplink.status, "error");
    assert.equal(targetState.sampleProjectDeeplink.sampleId, "modern-world-japan-corridor");
    assert.equal(targetState.sampleProjectDeeplink.previousSampleId, "tno-1962-atlantropa-briefing");
    assert.deepEqual(targetState.sampleProjectDeeplink.recommendedExport, modernRecommendation);
    assert.deepEqual(targetState.sampleProjectDeeplink.previousRecommendedExport, tnoRecommendation);
    assert.deepEqual(
      resolveExportWorkbenchSampleContext(targetState),
      {
        sampleId: "tno-1962-atlantropa-briefing",
        title: "Exporting sample: TNO 1962 Atlantropa briefing",
        recommendation: "Recommended: PNG · 2x · Composite image",
      },
    );
    assert.deepEqual(
      refreshSnapshots.map((snapshot) => snapshot.status),
      ["loading", "importing", "error"],
    );
  } finally {
    registerRuntimeHook(targetState, "refreshSampleProjectBannerFn", null);
  }
});

test("sample project banner view exposes success actions and public error messages", () => {
  const successView = resolveSampleProjectBannerView({
    status: "success",
    sampleId: "tno-1962-atlantropa-briefing",
    title: "TNO 1962 Atlantropa briefing",
    projectUrl: "./assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
    appProjectUrl: "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
    fileName: "tno-1962-atlantropa-briefing.project.json",
  });
  assert.equal(successView.tone, "success");
  assert.equal(successView.title, "Sample loaded: TNO 1962 Atlantropa briefing");
  assert.match(successView.body, /Edit this starter map/);
  assert.equal(successView.canOpenExport, true);
  assert.equal(successView.canDownloadOriginal, true);
  assert.equal(
    successView.downloadHref,
    "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
  );
  assert.equal(successView.downloadName, "tno-1962-atlantropa-briefing.project.json");

  const landingOnlyHrefView = resolveSampleProjectBannerView({
    status: "success",
    sampleId: "blank-base-starter",
    projectUrl: "./assets/sample-projects/blank-base-starter.project.json",
  });
  assert.equal(
    landingOnlyHrefView.downloadHref,
    "../assets/sample-projects/blank-base-starter.project.json",
  );

  const unknownSampleView = resolveSampleProjectBannerView({
    status: "error",
    sampleId: "missing-public-sample",
    errorCode: "unknown-sample-id",
    errorMessage: "Unknown sample project id: missing-public-sample",
  });
  assert.equal(unknownSampleView.tone, "error");
  assert.equal(unknownSampleView.title, "Sample unavailable");
  assert.equal(unknownSampleView.body, "This sample project is not in the public sample list.");
  assert.equal(unknownSampleView.canOpenExport, false);
  assert.equal(unknownSampleView.canDownloadOriginal, false);

  const invalidSampleView = resolveSampleProjectBannerView({
    status: "error",
    sampleId: "../bad",
    errorCode: "invalid-sample-id",
    errorMessage: "Sample project id is not valid.",
  });
  assert.equal(invalidSampleView.body, "This sample link is not valid.");
  assert.equal(resolveSampleProjectBannerView({ status: "loading", sampleId: "blank-base-starter" }), null);
});

test("sample guide helper view exposes loaded sample context and public error messages", () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const publicSampleProjects = resolvePublicSampleProjectListFromManifest(manifest);
  const successView = resolveSampleProjectGuideContext({
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      scenarioId: "tno_1962",
      title: "TNO 1962 Atlantropa briefing",
      projectUrl: "./assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
      appProjectUrl: "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
      fileName: "tno-1962-atlantropa-briefing.project.json",
    },
  }, {
    sampleProjects: publicSampleProjects,
  });
  assert.equal(successView.tone, "success");
  assert.equal(successView.status, "success");
  assert.equal(successView.sampleId, "tno-1962-atlantropa-briefing");
  assert.equal(successView.scenarioId, "tno_1962");
  assert.equal(successView.title, "Sample loaded: TNO 1962 Atlantropa briefing");
  assert.match(successView.body, /editable sample project/);
  assert.equal(successView.recommendedExportLabel, "Recommended export: 2x PNG briefing map");
  assert.equal(successView.openExportLabel, "Open export");
  assert.equal(successView.canOpenExport, true);
  assert.equal(successView.canDownloadOriginal, true);
  assert.equal(successView.canContinue, false);
  assert.equal(
    successView.downloadHref,
    "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
  );
  assert.equal(successView.downloadName, "tno-1962-atlantropa-briefing.project.json");
  assert.deepEqual(
    resolveSampleExportRecommendationContext({
      sampleProjectDeeplink: {
        status: "success",
        sampleId: "tno-1962-atlantropa-briefing",
        title: "TNO 1962 Atlantropa briefing",
      },
    }, {
      sampleProjects: publicSampleProjects,
    }),
    {
      sampleId: "tno-1962-atlantropa-briefing",
      sampleTitle: "TNO 1962 Atlantropa briefing",
      recommendationLabel: "2x PNG briefing map",
      recommendationSummary: "PNG · 2x · Composite image",
      recommendedExport: publicSampleProjects.find((project) => project.id === "tno-1962-atlantropa-briefing").recommendedExport,
    },
  );
  assert.deepEqual(
    resolveExportWorkbenchSampleContext({
      sampleProjectDeeplink: {
        status: "success",
        sampleId: "tno-1962-atlantropa-briefing",
        title: "TNO 1962 Atlantropa briefing",
        recommendedExport: publicSampleProjects.find((project) => project.id === "tno-1962-atlantropa-briefing").recommendedExport,
      },
    }),
    {
      sampleId: "tno-1962-atlantropa-briefing",
      title: "Exporting sample: TNO 1962 Atlantropa briefing",
      recommendation: "Recommended: PNG · 2x · Composite image",
    },
  );

  const errorView = resolveSampleProjectGuideContext({
    sampleProjectDeeplink: {
      status: "error",
      sampleId: "not-a-real-sample",
      errorCode: "unknown-sample-id",
      errorMessage: "Unknown sample project id: not-a-real-sample",
    },
  });
  assert.equal(errorView.tone, "error");
  assert.equal(errorView.title, "Sample unavailable");
  assert.equal(errorView.body, "This sample project is not in the public sample list.");
  assert.equal(errorView.recommendedExportLabel, "");
  assert.equal(errorView.canOpenExport, false);
  assert.equal(errorView.canDownloadOriginal, false);
  assert.equal(errorView.canContinue, true);
  assert.equal(errorView.continueLabel, "Continue with default guide");

  assert.equal(
    resolveSampleProjectGuideContext({
      sampleProjectDeeplink: { status: "pending", sampleId: "blank-base-starter" },
    }),
    null,
  );
});

test("sample project banner controller opens export and dismisses current message", () => {
  const sampleRuntime = {
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      title: "TNO 1962 Atlantropa briefing",
      appProjectUrl: "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
      fileName: "tno-1962-atlantropa-briefing.project.json",
    },
  };
  const root = new SampleBannerTestElement();
  const titleNode = new SampleBannerTestElement();
  const bodyNode = new SampleBannerTestElement();
  const openExportButton = new SampleBannerTestElement();
  const downloadOriginalLink = new SampleBannerTestElement();
  const dismissButton = new SampleBannerTestElement();
  const exportTriggers = [];
  const controller = createSampleProjectBannerController(sampleRuntime, {
    root,
    titleNode,
    bodyNode,
    openExportButton,
    downloadOriginalLink,
    dismissButton,
    openExportWorkbench: (trigger) => exportTriggers.push(trigger),
  });

  controller.bindEvents();
  const view = controller.render();

  assert.equal(view.status, "success");
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute("aria-hidden"), "false");
  assert.equal(titleNode.textContent, "Sample loaded: TNO 1962 Atlantropa briefing");
  assert.equal(
    downloadOriginalLink.getAttribute("href"),
    "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
  );

  openExportButton.click();
  assert.deepEqual(exportTriggers, [openExportButton]);

  dismissButton.click();
  assert.equal(root.hidden, true);
  assert.equal(root.classList.contains("hidden"), true);
  assert.equal(controller.render(), null);
});

test("sample guide card controller opens export and keeps error path usable", () => {
  const sampleRuntime = {
    sampleProjectDeeplink: {
      status: "success",
      sampleId: "tno-1962-atlantropa-briefing",
      title: "TNO 1962 Atlantropa briefing",
      appProjectUrl: "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
      fileName: "tno-1962-atlantropa-briefing.project.json",
      recommendedExport: {
        label: "2x PNG briefing map",
        target: "composite",
        format: "png",
        scale: "2",
        previewMode: "main",
        layerOrder: ["background", "context", "political", "effects", "labels"],
        visibleLayers: ["background", "context", "political", "effects", "labels"],
        textLayers: ["render-labels", "svg-annotations"],
      },
    },
  };
  const root = new SampleBannerTestElement();
  const titleNode = new SampleBannerTestElement();
  const bodyNode = new SampleBannerTestElement();
  const recommendationNode = new SampleBannerTestElement();
  const openExportButton = new SampleBannerTestElement();
  const downloadOriginalLink = new SampleBannerTestElement();
  const continueButton = new SampleBannerTestElement();
  const exportTriggers = [];
  const continueTriggers = [];
  const controller = createSampleProjectGuideCardController(sampleRuntime, {
    root,
    titleNode,
    bodyNode,
    recommendationNode,
    openExportButton,
    downloadOriginalLink,
    continueButton,
    openExportWorkbench: (trigger) => exportTriggers.push(trigger),
    continueWithDefaultGuide: (trigger) => continueTriggers.push(trigger),
  });

  controller.bindEvents();
  const successView = controller.render();

  assert.equal(successView.status, "success");
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute("role"), "status");
  assert.equal(root.dataset.sampleGuideStatus, "success");
  assert.equal(titleNode.textContent, "Sample loaded: TNO 1962 Atlantropa briefing");
  assert.match(bodyNode.textContent, /editable sample project/);
  assert.equal(recommendationNode.textContent, "Recommended export: 2x PNG briefing map");
  assert.equal(recommendationNode.hidden, false);
  assert.equal(openExportButton.hidden, false);
  assert.equal(continueButton.hidden, true);
  assert.equal(
    downloadOriginalLink.getAttribute("href"),
    "../assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
  );

  openExportButton.click();
  assert.deepEqual(exportTriggers, [openExportButton]);

  sampleRuntime.sampleProjectDeeplink = {
    status: "error",
    sampleId: "not-a-real-sample",
    errorCode: "unknown-sample-id",
  };
  const errorView = controller.render();

  assert.equal(errorView.status, "error");
  assert.equal(root.getAttribute("role"), "alert");
  assert.equal(root.dataset.sampleGuideTone, "error");
  assert.equal(titleNode.textContent, "Sample unavailable");
  assert.equal(bodyNode.textContent, "This sample project is not in the public sample list.");
  assert.equal(recommendationNode.textContent, "");
  assert.equal(recommendationNode.hidden, true);
  assert.equal(openExportButton.hidden, true);
  assert.equal(downloadOriginalLink.hidden, true);
  assert.equal(continueButton.hidden, false);

  continueButton.click();
  assert.deepEqual(continueTriggers, [continueButton]);
});

test("sample guide card renders public sample choices with selected and loading state", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => new SampleBannerTestElement(),
  };
  try {
    const sampleRuntime = {
      sampleProjectDeeplink: {
        status: "success",
        sampleId: "tno-1962-atlantropa-briefing",
        scenarioId: "tno_1962",
        title: "TNO 1962 Atlantropa briefing",
      },
    };
    const root = new SampleBannerTestElement();
    const titleNode = new SampleBannerTestElement();
    const bodyNode = new SampleBannerTestElement();
    const openExportButton = new SampleBannerTestElement();
    const downloadOriginalLink = new SampleBannerTestElement();
    const continueButton = new SampleBannerTestElement();
    const sampleListNode = new SampleBannerTestElement();
    const sampleListStatusNode = new SampleBannerTestElement();
    const choices = [];
    const controller = createSampleProjectGuideCardController(sampleRuntime, {
      root,
      titleNode,
      bodyNode,
      openExportButton,
      downloadOriginalLink,
      continueButton,
      sampleListNode,
      sampleListStatusNode,
      onSampleChoice: (sampleId) => choices.push(sampleId),
    });
    controller.setSampleProjects([
      { id: "tno-1962-atlantropa-briefing", title: "TNO 1962 Atlantropa briefing", scenarioId: "tno_1962" },
      { id: "modern-world-japan-corridor", title: "Modern World Japan corridor", scenarioId: "modern_world" },
    ]);

    assert.equal(sampleListNode.children.length, 2);
    assert.equal(sampleListNode.children[0].getAttribute("aria-current"), "true");
    assert.equal(sampleListNode.children[0].getAttribute("aria-pressed"), "true");
    assert.equal(sampleListNode.children[1].getAttribute("aria-current"), "false");
    assert.equal(sampleListNode.children[1].getAttribute("aria-pressed"), "false");
    sampleListNode.children[1].click();
    assert.deepEqual(choices, ["modern-world-japan-corridor"]);

    sampleRuntime.sampleProjectDeeplink = {
      status: "loading",
      sampleId: "modern-world-japan-corridor",
      previousSampleId: "tno-1962-atlantropa-briefing",
    };
    controller.setSwitcherState({ status: "loading", activeSampleId: "modern-world-japan-corridor" });
    assert.equal(sampleListNode.children[0].getAttribute("aria-current"), "true");
    assert.equal(sampleListNode.children[1].disabled, true);
    assert.equal(sampleListStatusNode.textContent, "Loading selected sample...");

    // pending 来自 startup deeplink 的 post-ready 队列；此时还没有 committed sample，列表继续保持禁用，避免二次点击覆盖排队任务。
    sampleRuntime.sampleProjectDeeplink = {
      status: "pending",
      sampleId: "tno-1962-atlantropa-briefing",
    };
    controller.setSwitcherState({ status: "idle" });
    assert.equal(sampleListNode.children[0].disabled, true);
    assert.equal(sampleListNode.children[1].disabled, true);
    sampleListNode.children[1].click();
    assert.deepEqual(choices, ["modern-world-japan-corridor"]);
    assert.equal(sampleListStatusNode.textContent, "Loading selected sample...");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("sample guide card keeps public sample list load errors visible without choices", () => {
  const sampleRuntime = {};
  const root = new SampleBannerTestElement();
  const titleNode = new SampleBannerTestElement();
  const bodyNode = new SampleBannerTestElement();
  const openExportButton = new SampleBannerTestElement();
  const downloadOriginalLink = new SampleBannerTestElement();
  const continueButton = new SampleBannerTestElement();
  const sampleListNode = new SampleBannerTestElement();
  const sampleListStatusNode = new SampleBannerTestElement();
  const controller = createSampleProjectGuideCardController(sampleRuntime, {
    root,
    titleNode,
    bodyNode,
    openExportButton,
    downloadOriginalLink,
    continueButton,
    sampleListNode,
    sampleListStatusNode,
  });

  const view = controller.setSwitcherState({
    status: "error",
    message: "The sample project list could not be loaded.",
  });

  assert.equal(view.status, "starter");
  assert.equal(view.tone, "error");
  assert.equal(root.hidden, false);
  assert.equal(root.getAttribute("role"), "alert");
  assert.equal(root.dataset.sampleGuideStatus, "starter");
  assert.equal(root.dataset.sampleGuideTone, "error");
  assert.equal(titleNode.textContent, "Load a starter sample");
  assert.equal(bodyNode.textContent, "The sample project list could not be loaded.");
  assert.equal(openExportButton.hidden, true);
  assert.equal(downloadOriginalLink.hidden, true);
  assert.equal(continueButton.hidden, true);
  assert.equal(sampleListNode.hidden, true);
  assert.equal(sampleListStatusNode.hidden, false);
  assert.equal(sampleListStatusNode.textContent, "The sample project list could not be loaded.");
});

test("sample URL helper updates sample only after caller reports success", () => {
  const previousLocation = globalThis.location;
  const previousHistory = globalThis.history;
  const replacedUrls = [];
  globalThis.location = {
    pathname: "/app/",
    search: "?sample=tno-1962-atlantropa-briefing&view=guide&guide_section=quick&foo=bar",
    hash: "#map",
  };
  globalThis.history = {
    state: { preserved: true },
    replaceState: (state, unused, url) => {
      replacedUrls.push({ state, unused, url });
      globalThis.location.search = url.includes("?") ? `?${url.split("?")[1].split("#")[0]}` : "";
    },
  };

  try {
    const urlState = createUiSurfaceUrlState({
      uiUrlStateKeys: {
        sample: "sample",
        legacySample: "sample_project",
        view: "view",
        guideSection: "guide_section",
        section: "section",
      },
    });
    assert.equal(replacedUrls.length, 0);
    urlState.syncSampleProjectUrlState("modern-world-japan-corridor");
    assert.equal(replacedUrls.length, 1);
    assert.equal(
      replacedUrls[0].url,
      "/app/?sample=modern-world-japan-corridor&view=guide&guide_section=quick&foo=bar#map",
    );
  } finally {
    globalThis.location = previousLocation;
    globalThis.history = previousHistory;
  }
});

test("sample startup state writes notify banner refresh hook for bad links", async () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const scheduledTasks = [];
  const refreshSnapshots = [];
  const helperToasts = [];
  const targetState = { bootPhase: "ready", uiHydrationStatus: "ready" };

  registerRuntimeHook(targetState, "refreshSampleProjectBannerFn", (sampleState) => {
    refreshSnapshots.push({
      status: sampleState.status,
      sampleId: sampleState.sampleId,
      errorCode: sampleState.errorCode,
    });
  });

  try {
    const didSchedule = scheduleStartupSampleProjectDeeplink({
      targetState,
      postReadyScheduler: {
        scheduleTask: (key, callback, options) => {
          scheduledTasks.push({ key, callback, options });
        },
      },
      helpers: {
        search: "?sample=missing-public-sample&view=guide",
        fetchImpl: async (url) => {
          if (url === "../assets/sample-runs.json") {
            return { ok: true, json: async () => manifest };
          }
          return { ok: false };
        },
        showToast: (message, options) => {
          helperToasts.push({ message, options });
        },
        ui: {
          t: (key) => ({
            "Sample unavailable": "示例不可用",
            "This sample project is not in the public sample list.": "这个示例项目不在公开示例列表中。",
          }[key] || key),
        },
      },
    });

    assert.equal(didSchedule, true);
    assert.equal(scheduledTasks.length, 1);
    assert.equal(scheduledTasks[0].options.allowChunkBacklog, true);
    assert.equal(refreshSnapshots[0].status, "pending");
    assert.equal(refreshSnapshots[0].sampleId, "missing-public-sample");

    await scheduledTasks[0].callback();

    assert.equal(targetState.sampleProjectDeeplink.status, "error");
    assert.equal(targetState.sampleProjectDeeplink.errorCode, "unknown-sample-id");
    assert.deepEqual(
      refreshSnapshots.map((snapshot) => snapshot.status),
      ["pending", "loading", "error"],
    );
    assert.equal(helperToasts.length, 1);
    assert.equal(helperToasts[0].message, "这个示例项目不在公开示例列表中。");
    assert.equal(helperToasts[0].options.title, "示例不可用");
  } finally {
    registerRuntimeHook(targetState, "refreshSampleProjectBannerFn", null);
  }
});

test("featured sample runs point at checked-in evidence and matching projects", () => {
  const manifest = readJson(SAMPLE_RUNS_PATH);
  const sampleProjects = new Map(manifest.sample_projects.map((project) => [project.id, project]));
  const runIds = manifest.featured_runs.map((run) => run.id);
  const runProjectUrls = manifest.featured_runs.map((run) => run.project_url);
  assert.equal(new Set(runIds).size, runIds.length);
  assert.equal(new Set(runProjectUrls).size, runProjectUrls.length);

  for (const run of manifest.featured_runs) {
    const sampleProject = sampleProjects.get(run.project_id);
    assert.ok(sampleProject, `${run.id} must reference a sample project`);
    assert.equal(run.project_url, sampleProject.project_url, `${run.id} project URL drifted`);
    assert.equal(run.scenario_id, sampleProject.scenario_id, `${run.id} scenario drifted`);
    assert.equal(run.demo_path, `./app/?sample=${sampleProject.id}&view=guide`, `${run.id} demo path drifted`);

    for (const url of [run.image_url, run.metadata_url, run.project_url]) {
      const assetPath = resolveLandingUrl(url);
      assert.ok(existsSync(new URL(`../${assetPath}`, import.meta.url)), `missing ${run.id} asset ${assetPath}`);
    }

    for (const marker of run.evidence_markers) {
      assert.ok(Number.isFinite(resolveEvidenceMarker(marker)), `${run.id} evidence marker must resolve: ${marker}`);
    }
  }
});
