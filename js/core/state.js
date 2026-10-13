// Centralized app state (Phase 13 scaffold)

import {
  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,
  detailOverlaySupportTiers,
} from "./state_defaults.js";
import {
  createDefaultStateCatalog,
} from "./state_catalog.js";
import {
  bindStateCompatSurface,
} from "./state/runtime_hooks.js";
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
  createDefaultIntensityFieldToolState,
  createDefaultRendererTransientRuntimeState,
} from "./state/renderer_runtime_state.js";
import {
  createDefaultSpatialIndexState,
} from "./state/spatial_index_state.js";
import {
  createDefaultIntensityFieldsState,
} from "./state/intensity_field_state.js";
import {
  createDefaultAppearancePresetsState,
} from "./state/appearance_preset_state.js";
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
export * from "./intensity_field.js";
export * from "./state/intensity_field_state.js";
export * from "./state/appearance_preset_state.js";

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
  intensityFieldTool: createDefaultIntensityFieldToolState(),
  intensityFields: createDefaultIntensityFieldsState(),
  appearancePresets: createDefaultAppearancePresetsState(),

  countryPalette,
  defaultCountryPalette,
  legacyDefaultCountryPalette,
  countryNames,
  countryPresets,
  detailOverlaySupportTiers,

  ...createDefaultSpatialIndexState(),
  ...createDefaultRendererTransientRuntimeState(),
};

bindStateCompatSurface(state);
