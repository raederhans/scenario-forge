import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runOptionalStartupTask } from "../js/bootstrap/startup_lazy_module_loader.js";
import { replaceSampleProjectDeeplinkState } from "../js/core/state/actions/boot_actions.js";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(...segments) {
  return readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

test("startup sample callbacks mark terminal state and ordinary startup does not load the module", async () => {
  const mainSource = readRepoFile("js", "main.js");
  const source = mainSource.slice(mainSource.indexOf("async function tryScheduleStartupSampleProjectDeeplink()"),
    mainSource.indexOf("function getStartupReadyHandoffOwner()"));
  const createAttempt = new Function("dependencies", `
    const { startupSampleProjectId, state, startupSampleProjectDeeplinkModuleLoader,
      runOptionalStartupTask, replaceSampleProjectDeeplinkState, callRuntimeHook, console,
      getStartupReadyHandoffOwner, postReadyScheduler, t } = dependencies;
    ${source}
    return tryScheduleStartupSampleProjectDeeplink;
  `);
  for (const sampleId of [null, "unknown-public-sample"]) {
    const state = {};
    let loadCount = 0;
    const bannerStates = [];
    const settledStates = [];
    const attempt = createAttempt({ startupSampleProjectId: sampleId, state,
      startupSampleProjectDeeplinkModuleLoader: { loadModuleOnce: async () => {
        loadCount += 1;
        throw new Error("module load failed");
      } }, runOptionalStartupTask, replaceSampleProjectDeeplinkState,
      getStartupReadyHandoffOwner: () => ({ markStartupSampleSettled() {
        settledStates.push(state.sampleProjectDeeplink);
      } }),
      callRuntimeHook: (_state, hook, snapshot) => {
        assert.equal(hook, "refreshSampleProjectBannerFn");
        bannerStates.push(snapshot);
      }, console: { warn() {} },
    });
    assert.equal(await attempt(), false);
    assert.equal(loadCount, sampleId ? 1 : 0);
    if (sampleId) {
      assert.equal(state.sampleProjectDeeplink.status, "error");
      assert.equal(state.sampleProjectDeeplink.sampleId, sampleId);
      assert.equal(state.sampleProjectDeeplink.errorMessage, "module load failed");
      assert.deepEqual(bannerStates, [state.sampleProjectDeeplink]);
      assert.deepEqual(settledStates, [state.sampleProjectDeeplink], "module failure marks settlement after publishing error");
    } else {
      assert.deepEqual(bannerStates, []);
      assert.deepEqual(settledStates, []);
      assert.equal(state.sampleProjectDeeplink, undefined);
    }
  }
  const state = {};
  const settledStates = [];
  const attempt = createAttempt({ startupSampleProjectId: "sample", state, postReadyScheduler: {}, t: (key) => key,
    startupSampleProjectDeeplinkModuleLoader: { loadModuleOnce: async () => ({
      tryScheduleStartupSampleProjectDeeplink: ({ helpers }) => {
        state.sampleProjectDeeplink = { sampleId: "sample", status: "success" };
        helpers.onSettled();
        return true;
      },
    }) }, runOptionalStartupTask, replaceSampleProjectDeeplinkState,
    getStartupReadyHandoffOwner: () => ({ markStartupSampleSettled() {
      settledStates.push(state.sampleProjectDeeplink);
    } }),
    callRuntimeHook() {}, console: { warn() {} },
  });
  assert.equal(await attempt(), true);
  assert.deepEqual(settledStates, [state.sampleProjectDeeplink], "import callback marks the initial terminal state");
});

test("main imports and creates the startup ready handoff owner", () => {
  const mainSource = readRepoFile("js", "main.js");

  assert.ok(mainSource.includes('from "./bootstrap/startup_ready_handoff.js";'));
  assert.ok(mainSource.includes("createStartupReadyHandoffOwner({"));
  assert.ok(mainSource.includes("function getStartupReadyHandoffOwner()"));
  assert.ok(mainSource.includes('getStartupReadyHandoffOwner().scheduleReadyPostBootWork(renderDispatcher, "ready-state")'));
  assert.ok(mainSource.includes('getStartupReadyHandoffOwner().reset("bootstrap")'));
});

test("main no longer owns ready handoff policy implementation", () => {
  const mainSource = readRepoFile("js", "main.js");
  const forbiddenMainTokens = [
    "function scheduleReadyPostBootWork(",
    "function flushPendingScenarioChunkRefreshAfterReady(",
    "function startDeferredFullInteractionInfrastructureBuild(",
    "function schedulePostReadyHydration(",
    "function schedulePostReadyDeferredContextWarmup(",
    "function schedulePostReadyVisualWarmup(",
    "function schedulePostReadyCityWarmup(",
    "let postReadyContextWarmupScheduled",
    "let postReadyHydrationScheduled",
  ];

  for (const token of forbiddenMainTokens) {
    assert.equal(mainSource.includes(token), false, `main.js still contains ${token}`);
  }
});

test("startup ready handoff owner owns all post-ready task keys", () => {
  const ownerSource = readRepoFile("js", "bootstrap", "startup_ready_handoff.js");
  const taskKeys = [
    "post-ready-localization-hydration",
    "post-ready-scenario-hydration",
    "post-ready-detail-promotion-political-reconcile",
    "post-ready-full-interaction-infra",
    "post-ready-visual-warmup",
    "post-ready-context-warmup",
    "post-ready-contour-warmup",
  ];

  for (const taskKey of taskKeys) {
    assert.ok(ownerSource.includes(taskKey), `missing task key ${taskKey}`);
  }
  assert.equal(ownerSource.includes("schedulePostReadyCityWarmup"), false);
});

test("startup ready handoff owner receives hydration mutation as an explicit effect", () => {
  const ownerSource = readRepoFile("js", "bootstrap", "startup_ready_handoff.js");
  const mainSource = readRepoFile("js", "main.js");
  const coreStateImports = [...ownerSource.matchAll(
    /from\s+["']([^"']*core\/state(?:\.js|\/[^"']+))["']/g,
  )].map((match) => match[1]);

  assert.deepEqual(coreStateImports, [
    "../core/state/actions/scenario_chunk_runtime_actions.js",
  ]);
  assert.ok(ownerSource.includes("patchScenarioChunkLoadState(targetRuntime,"));
  assert.ok(ownerSource.includes("commitUiHydrationState({"));
  assert.equal(ownerSource.includes("setUiHydrationState(targetRuntime,"), false);
  assert.ok(mainSource.includes("effects: {"));
  assert.ok(mainSource.includes("commitUiHydrationState: (patch) => setUiHydrationState(runtimeState, patch)"));
  assert.equal(/from\s+["'][^"']*map_renderer\/public\.js["']/.test(ownerSource), false);
  assert.equal(/from\s+["'][^"']*startup_data_pipeline\.js["']/.test(ownerSource), false);
  assert.ok(ownerSource.includes("runtimeState,"));
  assert.ok(ownerSource.includes("postReadyScheduler,"));
  assert.ok(ownerSource.includes("effects = {},"));
  assert.ok(ownerSource.includes("helpers = {},"));
  assert.ok(ownerSource.includes("return Object.freeze({"));
});

test("package exposes the startup ready handoff node test script", () => {
  const packageSource = readRepoFile("package.json");

  assert.ok(packageSource.includes('"test:node:startup-ready-handoff": "node --test tests/startup_ready_handoff_behavior.test.mjs tests/main_startup_ready_handoff_boundary.test.mjs"'));
});
