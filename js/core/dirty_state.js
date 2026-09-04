import { state as runtimeState } from "./state.js";
import { callRuntimeHook } from "./state/index.js";
import { clearDirtyState, markDirtyState } from "./state/actions/ui_dirty_actions.js";

function updateDirtyIndicator() {
  const indicator = document.getElementById("appDirtyIndicator");
  if (indicator) {
    indicator.classList.toggle("hidden", !runtimeState.isDirty);
    indicator.setAttribute("aria-hidden", runtimeState.isDirty ? "false" : "true");
  }
  callRuntimeHook(runtimeState, "updateProjectSaveStatusFn");
}

function markDirty(reason = "") {
  markDirtyState(runtimeState, reason);
  updateDirtyIndicator();
}

function clearDirty(reason = "") {
  clearDirtyState(runtimeState, reason);
  updateDirtyIndicator();
}

function handleBeforeUnload(event) {
  if (!runtimeState.isDirty) return;
  event.preventDefault();
  event.returnValue = "";
}

function bindBeforeUnload() {
  globalThis.removeEventListener("beforeunload", handleBeforeUnload);
  globalThis.addEventListener("beforeunload", handleBeforeUnload);
  updateDirtyIndicator();
}

export {
  bindBeforeUnload,
  clearDirty,
  markDirty,
  updateDirtyIndicator,
};

