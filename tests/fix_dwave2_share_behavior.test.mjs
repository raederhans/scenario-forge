import assert from "node:assert/strict";
import test from "node:test";
import { createStartupReadyHandoffOwner } from "../js/bootstrap/startup_ready_handoff.js";

test("post-ready hydration waits for a shared download and can start during the import dialog", async () => {
  const sharedProjectLink = { status: "loading" };
  const tasks = new Map();
  const noop = () => {};
  const hydrated = [];
  const owner = createStartupReadyHandoffOwner({
    runtimeState: { sharedProjectLink },
    postReadyScheduler: { scheduleTask(key, run, options) { tasks.set(key, { run, options }); } },
    effects: { commitUiHydrationState: noop, getStartupUiBootstrapPromise: noop },
    helpers: {
      buildInteractionInfrastructureAfterStartup: noop, checkpointBootMetric: noop,
      completeBootSequenceLogging: noop, ensureBaseCityDataReady: noop, ensureContextLayerDataReady: noop,
      ensureActiveScenarioBundleHydrated: async () => hydrated.push("scenario"),
      ensureFullLocalizationDataReady: async () => hydrated.push("localization"),
      reconcileDetailPromotionPoliticalPass: noop, requestMainRender: noop,
      scheduleDeferredDetailPromotion: noop, shouldFastTrackScenarioHydration: () => false,
    },
  });
  owner.schedulePostReadyHydration();
  for (const { options } of tasks.values()) assert.equal(options.canStart(), false);
  sharedProjectLink.status = "importing";
  for (const { run, options } of tasks.values()) {
    if (options.canStart()) await run({ waitFor: promise => promise });
  }
  assert.deepEqual(hydrated, ["localization", "scenario"]);
});
