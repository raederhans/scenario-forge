import { state } from "./state.js";

function updateDirtyIndicator() {
  const indicator = document.getElementById("appDirtyIndicator");
  if (!indicator) return;
  indicator.classList.toggle("hidden", !state.isDirty);
  indicator.setAttribute("aria-hidden", state.isDirty ? "false" : "true");
}

function markDirty(reason = "") {
  if (!state.isDirty) {
    state.isDirty = true;
  }
  state.dirtyRevision = Number(state.dirtyRevision || 0) + 1;
  if (reason) {
    state.lastDirtyReason = String(reason);
  }
  updateDirtyIndicator();
}

function clearDirty(reason = "") {
  state.isDirty = false;
  if (reason) {
    state.lastDirtyReason = String(reason);
  }
  updateDirtyIndicator();
}

function handleBeforeUnload(event) {
  if (!state.isDirty) return;
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
