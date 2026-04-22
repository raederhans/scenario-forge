// Centralized app state (Phase 13 scaffold)

import {
  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,
} from "./state_defaults.js";
import {
  createDefaultStateCatalog,
} from "./state_catalog.js";
import {
  bindStateCompatSurface,
} from "./state/index.js";
import {
  createDefaultHistoryState,
} from "./state/history_state.js";
import {
  createDefaultDevState,
} from "./state/dev_state.js";
import {
  createDefaultStrategicOverlayState,
} from "./state/strategic_overlay_state.js";
import {
  createDefaultScenarioRuntimeState,
} from "./state/scenario_runtime_state.js";
import {
  createDefaultBorderCacheState,
} from "./state/border_cache_state.js";
import {
  createDefaultRendererInfrastructureState,
  createDefaultRendererTransientRuntimeState,
} from "./state/renderer_runtime_state.js";
import {
  createDefaultSpatialIndexState,
} from "./state/spatial_index_state.js";
import {
  createDefaultBootState,
} from "./state/boot_state.js";
import {
  createDefaultContentState,
} from "./state/content_state.js";
import {
  createDefaultColorState,
  createDefaultColorPresetState,
} from "./state/color_state.js";
import {
  createDefaultUiChromeState,
  createDefaultUiPresentationState,
  createDefaultUiState,
} from "./state/ui_state.js";

export * from "./state_defaults.js";
export * from "./state_catalog.js";
export * from "./state/index.js";

export const state = {
  ...createDefaultBootState(),
  ...createDefaultRendererInfrastructureState(),
  ...createDefaultContentState(),
  ...createDefaultScenarioRuntimeState(),
  ...createDefaultStateCatalog(),
  ...createDefaultColorState(),
  ...createDefaultDevState(),
  ...createDefaultUiState(),
  ...createDefaultStrategicOverlayState(),
  ...createDefaultBorderCacheState(),
  ...createDefaultUiPresentationState(),
  ...createDefaultHistoryState(),
  ...createDefaultColorPresetState(),
  ...createDefaultUiChromeState(),

  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,

  ...createDefaultSpatialIndexState(),
  ...createDefaultRendererTransientRuntimeState(),
};

bindStateCompatSurface(state);
