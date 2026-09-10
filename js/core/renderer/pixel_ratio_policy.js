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
    // Gestures replay the committed frame. Changing backing-store density here
    // destroys the exact pass caches twice per drag and defeats that reuse.
    // Keep density tied to device/profile; the camera changes only presentation.
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
