import { normalizePoliticalDisplayMode } from "../../political_display_mode.js";

export function setPoliticalDisplayModeState(target, mode) {
  target.politicalDisplayMode = normalizePoliticalDisplayMode(mode);
  return target.politicalDisplayMode;
}
