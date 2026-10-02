import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Execute the real owner with controlled resource and apply IO, following the
// startup data pipeline harness convention without importing browser globals.
const source = readFileSync(new URL("../js/bootstrap/startup_scenario_boot.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "")
  .replace("export function createStartupScenarioBootOwner", "function createStartupScenarioBootOwner");

function createHarness(startupError) {
  const events = [];
  const metrics = new Map();
  const warnings = [];
  const d3Client = { json() {} };
  const startupBundle = {
    manifest: { scenario_id: "tno_1962", summary: { feature_count: 1 } },
    loadDiagnostics: { startupBundle: true }, bundleLevel: "bootstrap",
  };
  const legacyBundle = { manifest: startupBundle.manifest, bundleLevel: "bootstrap" };
  const runtimeState = {
    activeScenarioId: "", scenarioApplyInFlight: false,
    updateScenarioUIFn() {
      events.push({ type: "ui", inFlight: runtimeState.scenarioApplyInFlight });
    },
  };
  const applyCalls = [];
  const loadCalls = [];
  const dependencies = {
    normalizeScenarioId: (value) => String(value || "").trim(),
    async loadScenarioBundle(scenarioId, options) {
      assert.equal(runtimeState.scenarioApplyInFlight, true);
      loadCalls.push({ scenarioId, options });
      events.push({ type: "reload" });
      return legacyBundle;
    },
    async applyScenarioBundleCommand(bundle, options) {
      assert.equal(runtimeState.scenarioApplyInFlight, true);
      assert.equal(runtimeState.scenarioBundleCacheById.tno_1962, bundle);
      applyCalls.push({ bundle, options });
      events.push({ type: "apply", bundle });
      if (bundle === startupBundle) throw startupError;
      assert.equal(bundle, legacyBundle);
      runtimeState.activeScenarioId = "tno_1962";
    },
    console: { warn: (...args) => warnings.push(args) },
  };
  const createOwner = new Function(
    ...Object.keys(dependencies), `${source}\nreturn createStartupScenarioBootOwner;`,
  )(...Object.values(dependencies));
  const owner = createOwner({
    runtimeState,
    helpers: {
      setBootState() {},
      startBootMetric() {},
      finishBootMetric(name, value) {
        if (name === "scenario-apply") assert.equal(runtimeState.scenarioApplyInFlight, false);
        metrics.set(name, value);
      },
    },
  });
  return { owner, runtimeState, metrics, events, warnings, d3Client, startupBundle, legacyBundle, applyCalls, loadCalls };
}

for (const { name, error, expectedReason } of [
  {
    name: "retains both the fatal wrapper and its direct health gate cause",
    error: Object.assign(new Error("Scenario state is inconsistent. Effective owner lookup failed for AD."), {
      cause: new Error('  [scenario] Startup hydration health gate failed for "tno_1962". reason=owner-feature-mismatch  '),
    }),
    expectedReason: 'Scenario state is inconsistent. Effective owner lookup failed for AD. Cause: [scenario] Startup hydration health gate failed for "tno_1962". reason=owner-feature-mismatch',
  },
  {
    name: "does not duplicate a direct cause matching the original message",
    error: Object.assign(new Error("Startup hydration health gate failed."), {
      cause: new Error("  Startup hydration health gate failed.  "),
    }),
    expectedReason: "Startup hydration health gate failed.",
  },
  {
    name: "preserves the original recovery reason when there is no cause",
    error: new Error("Startup bundle apply failed."),
    expectedReason: "Startup bundle apply failed.",
  },
]) {
  test(`startup legacy recovery ${name}`, async () => {
    const h = createHarness(error);
    const result = await h.owner.runStartupScenarioBoot({
      d3Client: h.d3Client,
      scenarioBundlePromise: Promise.resolve({ ok: true, source: "startup-bundle", bundle: h.startupBundle }),
      startupInteractionMode: "readonly",
    });

    assert.deepEqual(h.loadCalls, [{
      scenarioId: "tno_1962",
      options: { d3Client: h.d3Client, bundleLevel: "bootstrap", forceReload: true },
    }]);
    assert.equal(h.applyCalls.length, 2);
    assert.equal(h.applyCalls[0].bundle, h.startupBundle);
    assert.equal(h.applyCalls[1].bundle, h.legacyBundle);
    assert.equal(h.applyCalls[0].options.deferChunkPrewarm, true);
    assert.equal(h.applyCalls[1].options.deferChunkPrewarm, undefined);
    for (const call of h.applyCalls) {
      assert.equal(call.options.renderMode, "none");
      assert.equal(call.options.suppressRender, true);
      assert.equal(call.options.interactionLevel, "readonly-startup");
    }
    assert.deepEqual(h.events.map(({ type }) => type), ["ui", "apply", "reload", "apply", "ui"]);
    assert.deepEqual(h.events.filter(({ type }) => type === "ui").map(({ inFlight }) => inFlight), [true, false]);
    assert.equal(h.runtimeState.scenarioApplyInFlight, false);
    assert.equal(h.runtimeState.activeScenarioId, "tno_1962");
    assert.equal(h.runtimeState.scenarioBundleCacheById.tno_1962, h.legacyBundle);
    assert.equal(result.defaultScenarioBundle, h.legacyBundle);
    assert.equal(result.scenarioBundleSource, "legacy-bootstrap-recovery");
    assert.equal(result.startupRecoveryReason, expectedReason);
    assert.deepEqual(h.metrics.get("scenario-apply"), {
      activeScenarioId: "tno_1962", source: result.scenarioBundleSource, startupRecoveryReason: result.startupRecoveryReason,
    });
    assert.equal(h.warnings.length, 1);
    assert.equal(h.warnings[0][1], error);
  });
}
