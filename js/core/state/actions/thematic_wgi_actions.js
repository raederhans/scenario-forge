import { normalizeThematicWgiStyle } from "../../thematic_wgi_view_model.js";
import { setAppearanceStyleGroupState, patchAppearanceStyleGroupState } from "./appearance_actions.js";

export function createDefaultThematicWgiRuntimeState() {
  return { status: "idle", data: null, error: "", revision: 0 };
}

export function setThematicWgiRuntimeState(target, { status, data = null, error = "" }) {
  if (!target || typeof target !== "object") throw new TypeError("[thematic_wgi_actions] target must be an object");
  if (!["idle", "loading", "ready", "failed"].includes(status)) {
    throw new RangeError(`[thematic_wgi_actions] unknown status: ${status}`);
  }
  target.thematicWgiRuntime = {
    status,
    data,
    error: String(error || ""),
    revision: (Number(target.thematicWgiRuntime?.revision) || 0) + 1,
  };
  return target.thematicWgiRuntime;
}

export function resetThematicWgiRuntimeState(target) {
  return setThematicWgiRuntimeState(target, { status: "idle" });
}

export function setThematicWgiStyleState(target, raw) {
  const style = setAppearanceStyleGroupState(target, "thematic", normalizeThematicWgiStyle(raw));
  if (style.enabled && target.styleConfig?.population?.enabled) patchAppearanceStyleGroupState(target, "population", { enabled: false });
  resetThematicWgiRuntimeState(target);
  return style;
}
