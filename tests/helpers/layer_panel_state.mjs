import { createDefaultContentState } from "../../js/core/state/content_state.js";
import { createDefaultStyleConfig, createDefaultUiState } from "../../js/core/state/ui_state.js";

export function createState(overrides = {}) {
  return {
    ...createDefaultContentState(),
    ...createDefaultUiState(),
    styleConfig: createDefaultStyleConfig(),
    renderPerfMetrics: {},
    zoomTransform: { k: 4 },
    ...overrides,
  };
}
