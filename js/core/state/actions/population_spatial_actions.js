import { normalizePopulationStyle } from "../../population_spatial_view_model.js";
import { setAppearanceStyleGroupState, patchAppearanceStyleGroupState } from "./appearance_actions.js";
import { resetThematicWgiRuntimeState } from "./thematic_wgi_actions.js";
import { commitUiVisibilityState } from "./ui_visibility_actions.js";

export function createDefaultPopulationRuntimeState() {
  return { status: "idle", data: null, error: "", revision: 0 };
}

export function setPopulationRuntimeState(target, { status, data = null, error = "" }) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[population_spatial_actions] target must be an object");
  }
  if (!["idle", "loading", "ready", "failed"].includes(status)) {
    throw new RangeError(`[population_spatial_actions] unknown status: ${status}`);
  }
  target.populationRuntime = {
    status, data, error: String(error || ""),
    revision: (Number(target.populationRuntime?.revision) || 0) + 1,
  };
  return target.populationRuntime;
}

export function resetPopulationRuntimeState(target) {
  return setPopulationRuntimeState(target, { status: "idle" });
}

export function setPopulationStyleState(target, raw) {
  const previous = normalizePopulationStyle(target?.styleConfig?.population);
  const next = normalizePopulationStyle(raw);
  const style = setAppearanceStyleGroupState(target, "population", next);
  if (next.enabled) {
    patchAppearanceStyleGroupState(target, "thematic", { enabled: false });
    resetThematicWgiRuntimeState(target);
    commitUiVisibilityState(target, { strategicChoroplethMetric: "" });
  }
  if (previous.enabled !== next.enabled || previous.dataVersion !== next.dataVersion) {
    resetPopulationRuntimeState(target);
  }
  return style;
}
