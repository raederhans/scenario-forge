import { PRESET_STORAGE_KEY, state as runtimeState } from "./state.js";
import { rebuildPresetState } from "./releasable_manager.js";
const state = runtimeState;

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Unable to load custom presets:", error);
    return {};
  }
}

function initPresetState() {
  runtimeState.customPresets = loadCustomPresets();
  rebuildPresetState();
}

export { initPresetState };

