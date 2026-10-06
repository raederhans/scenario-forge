import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import { setThematicWgiStyleState } from "../../core/state/actions/thematic_wgi_actions.js";
import { setPopulationStyleState } from "../../core/state/actions/population_spatial_actions.js";
import { ensureThematicWgiData } from "../../core/thematic_wgi_runtime.js";
import { THEMATIC_INDICATORS, getThematicIndicator } from "../../core/thematic_indicator_catalog.js";
import {
  getThematicWgiLegend,
  getThematicWgiViewModel,
  normalizeThematicWgiStyle,
  isThematicWgiSelectionSupported,
} from "../../core/thematic_wgi_view_model.js";
import { LegendManager } from "../../core/legend_manager.js";
import { syncStyledSelect } from "../styled_selects.js";

const IDS = [
  "toggleThematicWgi", "thematicWgiStatus", "thematicWgiRetry",
  "thematicWgiLegend", "thematicWgiCoverage", "thematicWgiMetric", "thematicWgiReferenceNote",
];
const STATUS_COPY = {
  off: "Thematic layer is off.",
  unsupported: "Country indicators are not supported on the current basemap.",
  "version-unavailable": "Saved indicator data version is unavailable.",
  "metric-unavailable": "Saved indicator is unavailable. Choose a supported indicator.",
  idle: "Indicator data is ready to load.",
  loading: "Loading indicator data…",
  ready: "Indicator data loaded.",
  failed: "Indicator data could not be loaded. Retry.",
};

export function createThematicWgiOwner({
  runtimeState,
  t = (key) => key,
  refreshColorState = () => {},
  markDirty = () => {},
  documentRef = globalThis.document,
  ensureData = ensureThematicWgiData,
  getViewModel = getThematicWgiViewModel,
  getLegend = getThematicWgiLegend,
  showLegend = (state) => LegendManager.showControl(state),
} = {}) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, documentRef?.getElementById?.(id) || null]));
  let startingLoad = false;
  let bound = false;
  let legendSignature;
  let metricOptionsSignature;
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
    const metricSupported = !!getThematicIndicator(view.metricId);
    const select = nodes.thematicWgiMetric;
    if (select) {
      const options = THEMATIC_INDICATORS.map((metric) => ({ value: metric.id, label: text(metric.labelEn) }));
      if (!metricSupported) options.unshift({ value: view.metricId, label: text("Unavailable saved metric"), disabled: true });
      const signature = JSON.stringify(options);
      if (signature !== metricOptionsSignature) {
        metricOptionsSignature = signature;
        select.replaceChildren(...options.map(({ value, label, disabled = false }) => {
          const option = documentRef.createElement("option");
          option.value = value;
          option.textContent = label;
          option.disabled = disabled;
          return option;
        }));
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
    setText("thematicWgiStatus", text(STATUS_COPY[status] || STATUS_COPY.off));
    if (nodes.thematicWgiStatus) {
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
    setText("thematicWgiCoverage", ready && coverage
      ? `${text(view.historicalReference ? "Scenario countries mapped" : "Mapped")}: ${coverage.matched} · ${text("Source missing")}: ${coverage.missing} · ${text("Unmatched")}: ${coverage.unmatched}`
      : "");
    if (nodes.thematicWgiCoverage) nodes.thematicWgiCoverage.hidden = !ready;
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
      const previous = normalizeThematicWgiStyle(runtimeState.styleConfig?.thematic);
      const style = enabled ? normalizeThematicWgiStyle({ enabled: true,
        metricId: getThematicIndicator(previous.metricId) ? previous.metricId : undefined })
        : { ...previous, enabled: false };
      setThematicWgiStyleState(runtimeState, style);
      if (enabled) {
        if (runtimeState.styleConfig?.population?.enabled) setPopulationStyleState(runtimeState, { ...runtimeState.styleConfig.population, enabled: false });
        setAppearanceVisibilityState(runtimeState, "strategicChoroplethMetric", "");
        showLegend(runtimeState);
      }
      runtimeState.persistViewSettingsFn?.();
      markDirty("toggle-thematic-wgi");
      refresh();
    });
    nodes.thematicWgiMetric?.addEventListener("change", (event) => {
      const metricId = event.target.value;
      if (!getThematicIndicator(metricId)) { render(); return; }
      const previous = normalizeThematicWgiStyle(runtimeState.styleConfig?.thematic);
      if (previous.metricId === metricId && isThematicWgiSelectionSupported(previous)) return;
      const style = normalizeThematicWgiStyle({ enabled: previous.enabled, metricId });
      setThematicWgiStyleState(runtimeState, style);
      runtimeState.persistViewSettingsFn?.();
      markDirty("select-thematic-wgi-metric");
      refresh();
    });
    nodes.thematicWgiRetry?.addEventListener("click", () => { void load(true); });
  };
  bindEvents();
  return { render, bindEvents, retry: () => load(true) };
}
