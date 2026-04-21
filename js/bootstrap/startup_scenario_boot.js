import { loadScenarioBundle } from "../core/scenario_resources.js";
import { applyScenarioBundleCommand } from "../core/scenario_dispatcher.js";

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

export function createStartupScenarioBootOwner({
  state,
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
    // main.js can stay focused on shell bootstrap and ready-state orchestration.
    setBootState?.("scenario-bundle");

    const scenarioBundleResult = await scenarioBundlePromise;
    if (!scenarioBundleResult?.ok) {
      throw scenarioBundleResult?.error || new Error("Default startup scenario bundle failed to load.");
    }

    let defaultScenarioBundle = scenarioBundleResult.bundle;
    let scenarioBundleSource = String(scenarioBundleResult.source || "legacy").trim() || "legacy";
    let startupRecoveryReason = "";

    if (!defaultScenarioBundle?.manifest) {
      throw new Error("Default scenario bundle did not include a manifest.");
    }

    finishBootMetric?.("scenario-bundle", {
      source: scenarioBundleResult.source || "legacy",
      requiresDetailTopology: false,
      expectedScenarioFeatureCount: Number(defaultScenarioBundle.manifest?.summary?.feature_count || 0),
      bundleLevel: defaultScenarioBundle?.bundleLevel || "bootstrap",
      resourceMetrics: buildScenarioBundleBootMetrics(defaultScenarioBundle),
    });

    setBootState?.("scenario-apply");
    startBootMetric?.("scenario-apply");
    state.scenarioApplyInFlight = true;
    if (typeof state.updateScenarioUIFn === "function") {
      state.updateScenarioUIFn();
    }

    try {
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
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
      await applyScenarioBundleCommand(defaultScenarioBundle, {
        renderMode: "none",
        suppressRender: true,
        markDirtyReason: "",
        showToastOnComplete: false,
        interactionLevel: startupInteractionMode === "readonly" ? "readonly-startup" : "full",
      });
    } finally {
      state.scenarioApplyInFlight = false;
      if (typeof state.updateScenarioUIFn === "function") {
        state.updateScenarioUIFn();
      }
    }

    warnOnStartupBundleIntegrity?.(defaultScenarioBundle, {
      source: scenarioBundleSource,
    });
    finishBootMetric?.("scenario-apply", {
      activeScenarioId: String(state.activeScenarioId || ""),
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
