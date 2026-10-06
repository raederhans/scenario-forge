import { loadThematicIndicatorData } from "./thematic_indicator_catalog.js";
import {
  isThematicWgiRequested,
  isThematicWgiSelectionSupported,
  normalizeThematicWgiStyle,
} from "./thematic_wgi_view_model.js";
import {
  resetThematicWgiRuntimeState,
  setThematicWgiRuntimeState,
} from "./state/actions/thematic_wgi_actions.js";

// The original WGI state key and entrypoint now serve both admitted families.
// Request ownership is transient and never becomes part of the saved project.
const requests = new WeakMap();

function captureSelection(state) {
  const value = normalizeThematicWgiStyle(state.styleConfig?.thematic);
  return {
    styleConfig: state.styleConfig,
    style: state.styleConfig?.thematic,
    value,
    scenarioId: state.activeScenarioId,
    key: JSON.stringify([
      value, state.activeScenarioId,
      state.latestScenarioApplyRequestId, state.currentScenarioApplyRequestId,
      state.activeScenarioChunks?.scenarioApplyEpoch,
      state.activeScenarioChunks?.scenarioApplyRequestId,
      state.renderTransactionDiagnostics?.scenarioApplyEpoch,
    ]),
  };
}

function matchesSelection(state, selection) {
  const current = captureSelection(state);
  return current.styleConfig === selection.styleConfig && current.style === selection.style
    && current.key === selection.key && !state.scenarioApplyInFlight;
}

export function ensureThematicWgiData(state, {
  onChange = () => {}, loadData = loadThematicIndicatorData, retry = false,
} = {}) {
  if (!state || typeof state !== "object") return Promise.resolve(null);
  const eligible = isThematicWgiRequested(state)
    && isThematicWgiSelectionSupported(state.styleConfig.thematic)
    && !state.scenarioApplyInFlight;
  let request = requests.get(state);
  if (!eligible || (request && !matchesSelection(state, request.selection))) {
    requests.delete(state);
    request = null;
    if (state.thematicWgiRuntime?.status && state.thematicWgiRuntime.status !== "idle") {
      resetThematicWgiRuntimeState(state);
      if (!eligible) onChange(state);
    }
  }
  if (!eligible) return Promise.resolve(null);
  const runtime = state.thematicWgiRuntime;
  if (request && runtime === request.runtime) {
    if (runtime.status === "loading") return request.promise;
    if (runtime.status === "ready") return Promise.resolve(runtime.data);
    if (runtime.status === "failed" && !retry) return Promise.resolve(null);
  }
  request = {
    selection: captureSelection(state),
    runtime: setThematicWgiRuntimeState(state, { status: "loading" }),
    promise: null,
  };
  requests.set(state, request);
  const ownsRequest = () => requests.get(state) === request
    && state.thematicWgiRuntime === request.runtime;
  const publish = (patch) => {
    if (!ownsRequest()) return false;
    if (!isThematicWgiRequested(state) || !matchesSelection(state, request.selection)) {
      requests.delete(state);
      resetThematicWgiRuntimeState(state);
      onChange(state);
      return false;
    }
    request.runtime = setThematicWgiRuntimeState(state, patch);
    onChange(state);
    return true;
  };
  request.promise = Promise.resolve().then(() => loadData({
    metricId: request.selection.value.metricId, scenarioId: request.selection.scenarioId,
  })).then((data) => {
    const selection = request.selection.value;
    if (!data || data.layerId !== selection.layerId || data.metricId !== selection.metricId
      || data.dataVersion !== selection.dataVersion
      || !(data.supportedScenarios || ["modern_world"]).includes(request.selection.scenarioId)) {
      throw new Error("Thematic data does not match the selected layer, metric or version.");
    }
    return data;
  }).then(
    (data) => publish({ status: "ready", data }) ? data : null,
    (error) => {
      publish({ status: "failed", error: error?.message || String(error) });
      return null;
    },
  );
  onChange(state);
  return request.promise;
}
