import { callRuntimeHook } from "../state/index.js";
import { LegendManager, createRevisionedLegendColorReader } from "../legend_manager.js";
import { createDeferredPanelRender } from "../deferred_panel_render.js";
import { getPoliticalDisplayLegend } from "../political_display_mode.js";
import { getThematicWgiLegend } from "../thematic_wgi_view_model.js";
import { getPopulationLegend } from "../population_spatial_view_model.js";
import { createLegendControlOwner } from "./legend_control_owner.js";

export function createLegendRuntime({ state, runtimeState, getMapContainer, clamp }) {
  let legendControlOwner = null;
  let deferredLegendRender = null;

  function getLegendControlOwner() {
    if (legendControlOwner) return legendControlOwner;
    const readLegendColors = createRevisionedLegendColorReader();
    legendControlOwner = createLegendControlOwner({
      getMapContainer,
      getViewportSize: () => ({ width: Number(runtimeState.width), height: Number(runtimeState.height) }),
      getLanguage: () => String(runtimeState.currentLanguage || state.currentLanguage || ""),
      getLegendModel: (uniqueColors, labels) => ({
        colors: Array.isArray(uniqueColors) ? uniqueColors : readLegendColors(state),
        specialZoneLegendLayers: LegendManager.getSpecialZoneLayers(runtimeState),
        thematicLegend: getPopulationLegend(runtimeState) || getThematicWgiLegend(runtimeState) || getPoliticalDisplayLegend(runtimeState),
        labelMap: labels || LegendManager.getLabels(state),
      }),
      getControlState: () => LegendManager.getControlState(state),
      getControlLimits: () => LegendManager.getControlLimits(),
      updateControlState: (patch) => LegendManager.updateControlState(state, patch),
      toggleControlCollapsed: () => LegendManager.toggleControlCollapsed(state),
      hideControl: () => LegendManager.hideControl(state),
      clamp,
    });
    return legendControlOwner;
  }

  function ensureLegendControlElement() {
    return getLegendControlOwner().ensureLegendControlElement();
  }

  function renderLegend(uniqueColors = null, labels = null) {
    return getLegendControlOwner().renderLegend(uniqueColors, labels);
  }

  // Both legends rescan every painted color after a color change, and the map legend
  // reads its own layout to place itself. Idle render passes refresh them after paint,
  // so a paint click's frame does not pay for it.
  function requestLegendRender() {
    deferredLegendRender ||= createDeferredPanelRender({
      render: () => {
        renderLegend();
        callRuntimeHook(runtimeState, "updateLegendUI");
      },
    });
    deferredLegendRender.request();
  }

  return { ensureLegendControlElement, renderLegend, requestLegendRender };
}
