import { commitRendererDprStageState } from '../state/actions/renderer_phase_actions.js';

// DPR limits and stage transitions share live profile/state inputs.
export function createPixelRatioPolicy({ runtimeState, nowMs, getDevicePixelRatio }) {
  function getMaxDprForProfile(renderProfile) {
    const profile = String(renderProfile || "auto").trim().toLowerCase();
    const deviceDpr = Math.max(1, Number(getDevicePixelRatio()) || 1);
    const baseMaxDpr = profile === "full"
      ? deviceDpr
      : profile === "balanced"
        ? 1.5
        : 1.25;
    const stage = String(runtimeState.dprStage || "idle").toLowerCase();
    if (stage === "interactive") {
      const scale = Math.min(1, Math.max(0.5, Number(runtimeState.dprInteractiveScale) || 0.72));
      return Math.max(1, baseMaxDpr * scale);
    }
    return baseMaxDpr;
  }

  function updateDprStage(nextStage = "idle", { force = false } = {}) {
    const normalizedStage = String(nextStage || "idle").toLowerCase() === "interactive"
      ? "interactive"
      : "idle";
    if (!force && runtimeState.dprStage === normalizedStage) {
      return false;
    }
    commitRendererDprStageState(runtimeState, {
      stage: normalizedStage,
      switchedAt: nowMs(),
    });
    return true;
  }
  return Object.freeze({ getMaxDprForProfile, updateDprStage });
}
