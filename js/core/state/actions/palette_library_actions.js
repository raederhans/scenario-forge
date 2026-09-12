import { setSelectedColorState } from "./appearance_selection_actions.js";
import {
  applyPaletteFeatureColorState as applyFeatureColorState,
  applyPaletteOwnerColorState as applyOwnerColorState,
} from "./scenario_activation_actions.js";
import { selectPaletteVisualPaintModeState } from "./scenario_presentation_actions.js";

export function selectPalettePaintColorState(target, color) {
  setSelectedColorState(target, color);
  selectPaletteVisualPaintModeState(target);
}

export function applyPaletteFeatureColorState(target, featureIds, color) {
  applyFeatureColorState(target, featureIds, color);
}

export function applyPaletteOwnerColorState(target, ownerCode, color) {
  applyOwnerColorState(target, ownerCode, color);
}
