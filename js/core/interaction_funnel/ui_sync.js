import { rebuildPresetState } from "../releasable_manager.js";
import { requestRender } from "../render_boundary.js";
import { state } from "../state.js";
import {
  STATE_BUS_EVENTS,
  callRuntimeHook,
  emitStateBusEvent,
} from "../state/index.js";

export function syncProjectImportUiState({ scenarioImportAudit, hooks }) {
  state.scenarioImportAudit = state.activeScenarioId
    ? cloneImportedProjectValue(scenarioImportAudit)
    : null;
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_PARENT_BORDER_COUNTRY_LIST);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SPECIAL_ZONE_EDITOR_UI);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_STRATEGIC_OVERLAY_UI);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_WATER_INTERACTION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_SPECIAL_REGION);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_ACTIVE_SOVEREIGN_UI);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_PAINT_MODE);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DYNAMIC_BORDER_STATUS);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TOOLBAR_INPUTS);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_RECENT_UI);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_SCENARIO_CONTEXT_BAR);
  callRuntimeHook(state, "persistViewSettingsFn");
  rebuildPresetState();
  hooks.refreshColorState?.({ renderNow: false });
  requestRender("project-import");
  emitStateBusEvent(STATE_BUS_EVENTS.RENDER_COUNTRY_LIST);
  emitStateBusEvent(STATE_BUS_EVENTS.REFRESH_COUNTRY_INSPECTOR_DETAIL);
  emitStateBusEvent(STATE_BUS_EVENTS.RENDER_WATER_REGION_LIST);
  emitStateBusEvent(STATE_BUS_EVENTS.RENDER_SPECIAL_REGION_LIST);
  emitStateBusEvent(STATE_BUS_EVENTS.RENDER_PRESET_TREE);
  emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_LEGEND_UI);
  emitStateBusEvent(STATE_BUS_EVENTS.RENDER_SCENARIO_AUDIT_PANEL);
}

function cloneImportedProjectValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
