import { state as runtimeState } from "./state.js";
const state = runtimeState;

function updateDirtyIndicator() {
  const indicator = document.getElementById("appDirtyIndicator");
  if (!indicator) return;
  indicator.classList.toggle("hidden", !runtimeState.isDirty);
  indicator.setAttribute("aria-hidden", runtimeState.isDirty ? "false" : "true");
}

function markDirty(reason = "") {
  if (!runtimeState.isDirty) {
    runtimeState.isDirty = true;
  }
  runtimeState.dirtyRevision = Number(runtimeState.dirtyRevision || 0) + 1;
  if (reason) {
    runtimeState.lastDirtyReason = String(reason);
  }
  updateDirtyIndicator();
}

function clearDirty(reason = "") {
  runtimeState.isDirty = false;
  if (reason) {
    runtimeState.lastDirtyReason = String(reason);
  }
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

