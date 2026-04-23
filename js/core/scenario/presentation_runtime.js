import {
  createScenarioDisplayRestoreRuntime,
} from "./presentation_display_restore.js";
import {
  normalizeScenarioPerformanceHints,
} from "./presentation_hint_helpers.js";
import {
  createScenarioOceanFillRestoreRuntime,
} from "./presentation_ocean_fill_restore.js";

function createScenarioPresentationRuntime({
  state,
  invalidateOceanBackgroundVisualState = null,
} = {}) {
  const displayRestoreRuntime = createScenarioDisplayRestoreRuntime({
    state,
  });
  const oceanFillRestoreRuntime = createScenarioOceanFillRestoreRuntime({
    state,
    invalidateOceanBackgroundVisualState,
  });

  return {
    ...displayRestoreRuntime,
    ...oceanFillRestoreRuntime,
    normalizeScenarioPerformanceHints,
  };
}

export {
  createScenarioPresentationRuntime,
  normalizeScenarioPerformanceHints,
};
