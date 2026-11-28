import { callRuntimeHook } from "../../core/state/index.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import { setThematicWgiStyleState } from "../../core/state/actions/thematic_wgi_actions.js";
import { setPopulationStyleState } from "../../core/state/actions/population_spatial_actions.js";
import { ensureThematicWgiData } from "../../core/thematic/thematic_wgi_runtime.js";
import { THEMATIC_INDICATORS, getThematicIndicator } from "../../core/thematic/thematic_indicator_catalog.js";
import {
  getThematicWgiLegend,
  getThematicWgiViewModel,
  normalizeThematicWgiStyle,
  isThematicWgiSelectionSupported,
} from "../../core/thematic/thematic_wgi_view_model.js";
import { SCENARIO_STATS_IDS, loadScenarioStatsDocument } from "../../core/thematic/thematic_scenario_stats_data.js";
import { LegendManager } from "../../core/legend_manager.js";
import { syncStyledSelect } from "../styled_selects.js";

const IDS = [
  "toggleThematicWgi", "thematicWgiStatus", "thematicWgiRetry",
  "thematicWgiLegend", "thematicWgiCoverage", "thematicWgiMetric", "thematicWgiReferenceNote",
];
const STATUS_COPY = {
  unsupported: "Country indicators are not supported on the current basemap.",
  "version-unavailable": "Saved indicator data version is unavailable.",
  "metric-unavailable": "Saved indicator is unavailable. Choose a supported indicator.",
  loading: "Loading indicator data…",
  failed: "Indicator data could not be loaded. Retry.",
};

export function createThematicWgiOwner({
  runtimeState,
  t = (key) => key,
  refreshColorState = () => {},
  markDirty = () => {},
  documentRef = globalThis.document,
  ensureData = ensureThematicWgiData,
  loadScenarioDocument = loadScenarioStatsDocument,
  getViewModel = getThematicWgiViewModel,
  getLegend = getThematicWgiLegend,
  showLegend = (state) => LegendManager.showControl(state),
} = {}) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, documentRef?.getElementById?.(id) || null]));
  let startingLoad = false;
  let bound = false;
  let legendSignature;
  let metricOptionsSignature;
  let scenarioOptionsKey;
  let scenarioMetrics;
  const text = (key) => t(key, "ui");
  const setText = (id, value) => { if (nodes[id]) nodes[id].textContent = value; };
  const refresh = () => {
    refreshColorState({ renderNow: true });
    render();
  };

  const load = (retry = false) => {
    const view = getViewModel(runtimeState);
    if (startingLoad || !view.enabled || !view.supported
      || (retry ? view.status !== "failed" : view.status !== "idle")) return Promise.resolve(null);
    startingLoad = true;
    let request;
    try {
      request = ensureData(runtimeState, {
        retry,
        onChange: refresh,
      });
    } finally {
      startingLoad = false;
    }
    // The runtime owns loading/failure state and stale request fences.
    return Promise.resolve(request).catch(() => { render(); return null; });
  };

  const renderLegend = (legend) => {
    const node = nodes.thematicWgiLegend;
    if (!node) return;
    node.hidden = !legend;
    const signature = JSON.stringify(legend);
    if (signature === legendSignature) return;
    legendSignature = signature;
    if (!legend) { node.replaceChildren(); return; }
    const fragment = documentRef.createDocumentFragment();
    const addText = (value, className) => {
      const paragraph = documentRef.createElement("p");
      paragraph.className = className;
      paragraph.textContent = value;
      fragment.appendChild(paragraph);
    };
    for (const entry of legend.entries) {
      const row = documentRef.createElement("div");
      row.className = "map-legend-row";
      const swatch = documentRef.createElement("span");
      swatch.className = "map-legend-swatch";
      swatch.style.backgroundColor = entry.color;
      swatch.setAttribute("aria-hidden", "true");
      const label = documentRef.createElement("span");
      label.textContent = entry.label;
      row.appendChild(swatch);
      row.appendChild(label);
      fragment.appendChild(row);
    }
    addText(legend.note, "hint");
    addText(legend.source, "hint");
    node.replaceChildren(fragment);
  };

  const render = () => {
    const view = getViewModel(runtimeState);
    const historical = SCENARIO_STATS_IDS.includes(runtimeState.activeScenarioId);
    const selected = getThematicIndicator(view.metricId);
    const metricSupported = selected && (historical || selected.family !== "scenario");
    const select = nodes.thematicWgiMetric;
    if (select) {
      const scenarioId = runtimeState.activeScenarioId;
      const baselineHash = runtimeState.scenarioBaselineHash;
      const key = historical ? JSON.stringify([scenarioId, baselineHash]) : "";
      if (key !== scenarioOptionsKey) {
        scenarioOptionsKey = key;
        scenarioMetrics = null;
        if (historical) loadScenarioDocument({ scenarioId, baselineHash }).then((doc) => {
          if (key === scenarioOptionsKey) {
            scenarioMetrics = doc.metrics;
            render();
          }
        }, () => {
          if (key === scenarioOptionsKey) scenarioOptionsKey = undefined;
        });
      }
      const data = runtimeState.thematicWgiRuntime?.data;
      const metrics = data?.metrics && data.supportedScenarios.includes(scenarioId)
        && (!baselineHash || data.baselineHash === baselineHash) ? data.metrics : scenarioMetrics;
      const options = THEMATIC_INDICATORS.filter((metric) => historical || metric.family !== "scenario").map((metric) => {
        const native = metric.family === "scenario";
        const disabled = native && (metrics ? metrics[metric.id]?.available !== true : metric.id !== view.metricId);
        const label = native && runtimeState.currentLanguage === "zh" ? metric.labelZh : text(metric.labelEn);
        const group = historical ? text(native ? "Scenario data (start)" : "Modern reference (2023/2024)") : "";
        return { value: metric.id, label: disabled ? `${label} (${text("Unavailable")})` : label, disabled, group };
      });
      if (!metricSupported) options.unshift({ value: view.metricId, label: text("Unavailable saved metric"), disabled: true });
      const signature = JSON.stringify(options);
      if (signature !== metricOptionsSignature) {
        metricOptionsSignature = signature;
        const children = [];
        const groups = new Map();
        for (const { value, label, disabled = false, group } of options) {
          const option = documentRef.createElement("option");
          option.value = value;
          option.textContent = label;
          option.disabled = disabled;
          if (group) {
            if (!groups.has(group)) {
              const node = documentRef.createElement("optgroup");
              node.label = group;
              groups.set(group, node);
              children.push(node);
            }
            groups.get(group).appendChild(option);
          } else children.push(option);
        }
        select.replaceChildren(...children);
      }
      select.value = view.metricId;
      syncStyledSelect(select);
    }
    if (nodes.toggleThematicWgi) {
      nodes.toggleThematicWgi.checked = view.enabled;
      // A suspended selection can still be turned off in another scenario.
      nodes.toggleThematicWgi.disabled = !view.supported && !view.enabled;
    }
    const status = view.supported && !metricSupported ? "metric-unavailable" : view.status;
    setText("thematicWgiStatus", STATUS_COPY[status] ? text(STATUS_COPY[status]) : "");
    if (nodes.thematicWgiStatus) {
      nodes.thematicWgiStatus.hidden = !STATUS_COPY[status];
      nodes.thematicWgiStatus.dataset.statusTone = status === "ready" ? "active"
        : ["failed", "version-unavailable", "metric-unavailable"].includes(status) ? "warning"
          : status === "loading" ? "pending" : "muted";
    }
    if (nodes.thematicWgiRetry) {
      nodes.thematicWgiRetry.hidden = view.status !== "failed";
      nodes.thematicWgiRetry.disabled = !view.enabled || !view.supported || view.status !== "failed";
      nodes.thematicWgiRetry.textContent = text("Retry");
    }
    const ready = view.status === "ready" && view.enabled && view.supported;
    setText("thematicWgiReferenceNote", view.referenceNote || "");
    if (nodes.thematicWgiReferenceNote) nodes.thematicWgiReferenceNote.hidden = !view.referenceNote;
    const coverage = view.coverage;
    const hasMissingCountries = ready && (coverage?.missing > 0 || coverage?.unmatched > 0);
    setText("thematicWgiCoverage", hasMissingCountries ? text("Some countries have no data.") : "");
    if (nodes.thematicWgiCoverage) nodes.thematicWgiCoverage.hidden = !hasMissingCountries;
    renderLegend(ready ? getLegend(runtimeState) : null);
    if (view.enabled && view.supported && view.status === "idle") void load();
    return view;
  };

  const bindEvents = () => {
    if (bound) return;
    bound = true;
    nodes.toggleThematicWgi?.addEventListener("change", (event) => {
      const enabled = !!event.target.checked;
      if (enabled && !getViewModel(runtimeState).supported) { render(); return; }
      const previous = normalizeThematicWgiStyle(runtimeState.styleConfig?.thematic, runtimeState.activeScenarioId);
      const metric = getThematicIndicator(previous.metricId);
      const selectable = metric && (metric.family !== "scenario" || SCENARIO_STATS_IDS.includes(runtimeState.activeScenarioId));
      const style = enabled ? normalizeThematicWgiStyle({ enabled, metricId: selectable ? metric.id : undefined }, runtimeState.activeScenarioId)
        : { ...previous, enabled: false };
      setThematicWgiStyleState(runtimeState, style);
      if (enabled) {
        if (runtimeState.styleConfig?.population?.enabled) setPopulationStyleState(runtimeState, { ...runtimeState.styleConfig.population, enabled: false });
        setAppearanceVisibilityState(runtimeState, "strategicChoroplethMetric", "");
        showLegend(runtimeState);
      }
      callRuntimeHook(runtimeState, "persistViewSettingsFn");
      markDirty("toggle-thematic-wgi");
      refresh();
    });
    nodes.thematicWgiMetric?.addEventListener("change", (event) => {
      const metricId = event.target.value;
      if (!getThematicIndicator(metricId)) { render(); return; }
      const previous = normalizeThematicWgiStyle(runtimeState.styleConfig?.thematic, runtimeState.activeScenarioId);
      if (previous.metricId === metricId && isThematicWgiSelectionSupported(previous)) return;
      const style = normalizeThematicWgiStyle({ enabled: previous.enabled, metricId });
      setThematicWgiStyleState(runtimeState, style);
      callRuntimeHook(runtimeState, "persistViewSettingsFn");
      markDirty("select-thematic-wgi-metric");
      refresh();
    });
    nodes.thematicWgiRetry?.addEventListener("click", () => { void load(true); });
  };
  bindEvents();
  return { render, bindEvents, retry: () => load(true) };
}
