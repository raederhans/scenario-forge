import { loadScenarioBundle } from "../core/scenario_resources.js";
import { applyScenarioBundleCommand } from "../core/scenario_dispatcher.js";
import { normalizeScenarioId } from "../core/scenario/shared.js";

function buildScenarioBundleBootMetrics(bundle) {
  return bundle?.loadDiagnostics?.optionalResources?.runtime_topology?.metrics
    ? {
      runtimeTopology: bundle.loadDiagnostics.optionalResources.runtime_topology.metrics,
      geoLocalePatch: bundle.loadDiagnostics.optionalResources.geo_locale_patch?.metrics || null,
      manifest: bundle.loadDiagnostics.requiredResources?.manifest || null,
    }
    : {
      geoLocalePatch: bundle?.loadDiagnostics?.optionalResources?.geo_locale_patch?.metrics || null,
      manifest: bundle?.loadDiagnostics?.requiredResources?.manifest || null,
    };
}

function cacheStartupScenarioBundle(runtimeState, bundle) {
  const scenarioId = normalizeScenarioId(bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id);
  if (!scenarioId) return;
  // startup bundle 先作为 warm cache 落到 runtime，后续用户打开同一 scenario 时复用同一份已校验对象。
  runtimeState.scenarioBundleCacheById = runtimeState.scenarioBundleCacheById
    && typeof runtimeState.scenarioBundleCacheById === "object"
    ? runtimeState.scenarioBundleCacheById
    : {};
  runtimeState.scenarioBundleCacheById[scenarioId] = bundle;
}

export function createStartupScenarioBootOwner({
  runtimeState,
  helpers = {},
} = {}) {
  const {
    finishBootMetric,
    setBootState,
    startBootMetric,
    warnOnStartupBundleIntegrity,
  } = helpers;

  async function runStartupScenarioBoot({
    d3Client,
    scenarioBundlePromise,
    startupInteractionMode = "full",
  } = {}) {
    // Keep startup bundle selection, apply, and recovery in one transaction so
    // main.js can stay focused on shell bootstrap and ready-runtimeState orchestration.
    setBootState?.("scenario-bundle");

    const scenarioBundleResult = await scenarioBundlePromise;
    if (!scenarioBundleResult?.ok) {
      throw scenarioBundleResult?.error || new Error("Default startup scenario bundle failed to load.");
    }

    if (scenarioBundleResult?.skipped && !scenarioBundleResult.bundle) {
      const scenarioBundleSource = String(scenarioBundleResult.source || "none").trim() || "none";
      finishBootMetric?.("scenario-bundle", {
        source: scenarioBundleSource,
        skipped: true,
        requiresDetailTopology: false,
        expectedScenarioFeatureCount: 0,
        bundleLevel: "none",
        resourceMetrics: {},
      });
      return {
        defaultScenarioBundle: null,
        scenarioBundleSource,
        startupRecoveryReason: "",
      };
    }

    let defaultScenarioBundle = scenarioBundleResult.bundle;
    let scenarioBundleSource = String(scenarioBundleResult.source || "legacy").trim() || "legacy";
    let startupRecoveryReason = "";
    // startup-bundle 已包含首屏所需切片时，把 chunk prewarm 推到 ready 后，缩短 boot 关键路径。
    let canDeferStartupChunkPrewarm = scenarioBundleSource === "startup-bundle"
      && defaultScenarioBundle?.loadDiagnostics?.startupBundle === true;

    if (!defaultScenarioBundle?.manifest) {
      throw new Error("Default scenario bundle did not include a manifest.");
    }
    cacheStartupScenarioBundle(runtimeState, defaultScenarioBundle);

    finishBootMetric?.("scenario-bundle", {
      source: scenarioBundleResult.source || "legacy",
      requiresDetailTopology: false,
      expectedScenarioFeatureCount: Number(defaultScenarioBundle.manifest?.summary?.feature_count || 0),
      bundleLevel: defaultScenarioBundle?.bundleLevel || "bootstrap",
      resourceMetrics: buildScenarioBundleBootMetrics(defaultScenarioBundle),
    });

    setBootState?.("scenario-apply");
    startBootMetric?.("scenario-apply");
    runtimeState.scenarioApplyInFlight = true;
    if (typeof runtimeState.updateScenarioUIFn === "function") {
      runtimeState.updateScenarioUIFn();
    }

    try {
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        deferChunkPrewarm: canDeferStartupChunkPrewarm,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    } catch (startupApplyError) {
      // Fallback trigger: source=startup-bundle 且首次 apply 抛错时，切换到 legacy-bootstrap-recovery 重新加载并重放 apply。
      if (scenarioBundleSource !== "startup-bundle") {
        throw startupApplyError;
      }
      startupRecoveryReason = String(startupApplyError?.message || "startup-bundle-apply-failed");
      const causeMessage = String(startupApplyError?.cause?.message || "").trim();
      if (causeMessage && causeMessage !== startupRecoveryReason) {
        startupRecoveryReason += ` Cause: ${causeMessage}`;
      }
      console.warn(
        `[boot] Startup bundle apply failed for "${defaultScenarioBundle.manifest?.scenario_id || ""}", falling back to legacy bootstrap bundle.`,
        startupApplyError
      );
      defaultScenarioBundle = await loadScenarioBundle(String(defaultScenarioBundle.manifest?.scenario_id || ""), {
        d3Client,
        bundleLevel: "bootstrap",
        forceReload: true,
      });
      scenarioBundleSource = "legacy-bootstrap-recovery";
      canDeferStartupChunkPrewarm = false;
      cacheStartupScenarioBundle(runtimeState, defaultScenarioBundle);
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    } finally {
      runtimeState.scenarioApplyInFlight = false;
      if (typeof runtimeState.updateScenarioUIFn === "function") {
        runtimeState.updateScenarioUIFn();
      }
    }

    warnOnStartupBundleIntegrity?.(defaultScenarioBundle, {
      source: scenarioBundleSource,
    });
    finishBootMetric?.("scenario-apply", {
      activeScenarioId: String(runtimeState.activeScenarioId || ""),
      source: scenarioBundleSource,
      startupRecoveryReason,
    });

    return {
      defaultScenarioBundle,
      scenarioBundleSource,
      startupRecoveryReason,
    };
  }

  return {
    runStartupScenarioBoot,
  };
}
