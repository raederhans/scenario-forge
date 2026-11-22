import { state } from "./state.js";
import { callRuntimeHook } from "./state/index.js";

let resolvePick = null;
state.mapPointPicker = { active: false, purpose: "" };

export function isMapPointPickActive(state) {
  return !!state.mapPointPicker?.active;
}

export function completeMapPointPick(point) {
  if (!resolvePick) return false;
  const resolve = resolvePick;
  resolvePick = null;
  state.mapPointPicker = { active: false, purpose: "" };
  resolve(point);
  callRuntimeHook(state, "syncMapPointPickModeFn");
  return true;
}

export function cancelMapPointPick() {
  return completeMapPointPick(null);
}

export function startMapPointPick({ purpose }) {
  cancelMapPointPick();
  return new Promise(resolve => {
    resolvePick = resolve;
    state.mapPointPicker = { active: true, purpose };
    callRuntimeHook(state, "syncMapPointPickModeFn");
  });
}
