import { state as runtimeState } from "./state.js";
import { commitChange } from "./state/changes.js";
import { clearDirtyState, markDirtyState } from "./state/actions/ui_dirty_actions.js";

function updateDirtyIndicator() {
  commitChange({ domains: ["dirty"], reason: "dirty-indicator" });
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

