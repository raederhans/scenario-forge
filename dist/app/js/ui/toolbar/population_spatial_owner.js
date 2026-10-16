import { setPopulationStyleState } from "../../core/state/actions/population_spatial_actions.js";
import { ensurePopulationData, ensurePopulationHeatmapData, getPopulationHeatmapSnapshot } from "../../core/population_spatial_runtime.js";
import { getPopulationViewModel, getPopulationLegend, getPopulationCountrySummary,
  sumPopulationFeatures, normalizePopulationStyle } from "../../core/population_spatial_view_model.js";
import { getMapDataBoundary } from "../../core/map_data_boundary.js";
import { LegendManager } from "../../core/legend_manager.js";
import { syncStyledSelect } from "../styled_selects.js";

const IDS = ["togglePopulation", "populationMode", "populationOpacity", "populationOpacityValue",
  "populationStatus", "populationRetry", "populationReferenceNote", "populationLegend", "populationSummaryScope",
  "populationSummary", "populationSummarizeSelection", "populationExportStats", "populationSourceNote"];
const STATUS_COPY = { off: "Population layer is off.", unsupported: "Population is unavailable on this basemap.",
  idle: "Population data is ready to load.", loading: "Loading population data…", ready: "Population data loaded.",
  failed: "Population data could not be loaded. Retry.", "version-unavailable": "Saved population data version is unavailable." };

export function buildPopulationStatsCsv(state) {
  const data = state.populationRuntime?.data;
  if (getPopulationViewModel(state).status !== "ready" || !data) throw new Error("Population data is not ready");
  const reference = getMapDataBoundary(state).reference;
  const fields = ["feature_id", "scenario_group", "population", "land_area_km2", "density", "coverage_fraction", "overlap_fraction",
    "status", "source_epoch", "source_resolution_m", "data_version", "geometry_version"];
  const escape = (value) => {
    const raw = String(value ?? "");
    const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\ufeff" + [fields.join(","), ...Object.values(data.byFeatureId).map((row) => [
    row.feature_id, reference.getScenarioGroupCode(row.feature_id), row.population, row.land_area_km2,
    row.density, row.coverage_fraction, row.overlap_fraction, row.status, data.year, data.source?.resolution_m,
    data.dataVersion, data.geometryVersion,
  ].map(escape).join(","))].join("\r\n");
}

export function createPopulationSpatialOwner({ runtimeState, t = (key) => key, markDirty = () => {},
  refreshColorState = () => {}, documentRef = globalThis.document, ensureData = ensurePopulationData,
  downloadCsv = (contents, filename) => {
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const link = documentRef.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, showLegend = (state) => LegendManager.showControl(state),
} = {}) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, documentRef?.getElementById(id)]));
  const text = (key) => t(key, "ui");
  const setText = (id, value) => { if (nodes[id]) nodes[id].textContent = value; };
  let loading = false;
  let loadingHeatmap = false;
  let legendSignature = "";
  let groupSignature = "";
  const refresh = () => { refreshColorState({ renderNow: true }); render(); };
  const load = (retry = false) => {
    const view = getPopulationViewModel(runtimeState);
    if (loading || !view.enabled || !view.supported || !(retry ? view.status === "failed" : view.status === "idle")) return;
    loading = true;
    try { void Promise.resolve(ensureData(runtimeState, { retry, onChange: refresh })).catch(() => render()); }
    finally { loading = false; }
  };
  const format = (value, digits = 0) => Number.isFinite(value)
    ? value.toLocaleString(runtimeState.currentLanguage === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: digits }) : "—";
  const render = () => {
    const view = getPopulationViewModel(runtimeState);
    const ready = view.status === "ready";
    const heatmap = getPopulationHeatmapSnapshot(runtimeState);
    const needsHeatmap = ready && view.mode === "heatmap";
    if (nodes.togglePopulation) { nodes.togglePopulation.checked = view.enabled; nodes.togglePopulation.disabled = !view.supported && !view.enabled; }
    if (nodes.populationMode) { nodes.populationMode.value = view.mode; syncStyledSelect(nodes.populationMode); }
    if (nodes.populationOpacity) nodes.populationOpacity.value = String(Math.round(view.opacity * 100));
    setText("populationOpacityValue", `${Math.round(view.opacity * 100)}%`);
    setText("populationStatus", text(needsHeatmap && (heatmap.status === "failed" || heatmap.refinementStatus === "failed")
      ? "Population heatmap could not be loaded. Retry."
      : needsHeatmap && heatmap.status !== "ready" ? "Loading population heatmap…"
        : needsHeatmap && heatmap.refinementStatus === "loading" ? "Showing overview; refining this view…"
          : STATUS_COPY[view.status] || STATUS_COPY.off));
    if (nodes.populationStatus) { nodes.populationStatus.title = view.error; nodes.populationStatus.dataset.statusTone = ready ? "active" : view.status === "failed" ? "warning" : "muted"; }
    if (nodes.populationRetry) nodes.populationRetry.hidden = view.status !== "failed" && !(needsHeatmap && (heatmap.status === "failed" || heatmap.refinementStatus === "failed"));
    setText("populationReferenceNote", view.referenceNote);
    if (nodes.populationReferenceNote) nodes.populationReferenceNote.hidden = !view.referenceNote || !view.enabled;
    setText("populationSourceNote", text("GHSL 2020 · 1 km source grid. Land area excludes mapped lakes; small parcels are area-weighted estimates."));
    const legend = ready ? getPopulationLegend(runtimeState) : null;
    if (nodes.populationLegend) {
      nodes.populationLegend.hidden = !legend;
      const signature = JSON.stringify(legend);
      if (signature !== legendSignature) {
        legendSignature = signature;
        nodes.populationLegend.replaceChildren(...(legend?.entries || []).map((entry) => {
          const row = documentRef.createElement("div"); row.className = "map-legend-row";
          const swatch = documentRef.createElement("span"); swatch.className = "map-legend-swatch";
          swatch.style.backgroundColor = entry.color; swatch.setAttribute("aria-hidden", "true");
          const label = documentRef.createElement("span"); label.textContent = entry.label;
          row.appendChild(swatch); row.appendChild(label); return row;
        }));
      }
    }
    const selector = nodes.populationSummaryScope;
    if (selector) {
      const groups = [...new Set(Object.values(getMapDataBoundary(runtimeState).reference.getScenarioAssignments()))].filter(Boolean).sort();
      const signature = JSON.stringify([runtimeState.activeScenarioId, runtimeState.currentLanguage, groups]);
      if (signature !== groupSignature) {
        groupSignature = signature;
        const previous = selector.value;
        const choices = [["__scenario__", text("All mapped parcels")], ["__selection__", text("Selected parcels")], ...groups.map((code) => {
          const country = runtimeState.scenarioCountriesByTag?.[code];
          const name = runtimeState.currentLanguage === "zh" ? country?.display_name_zh || country?.display_name
            : country?.display_name_en || country?.display_name;
          return [code, name ? `${name} (${code})` : code];
        })];
        selector.replaceChildren(...choices.map(([value, label]) => { const option = documentRef.createElement("option"); option.value = value; option.textContent = label; return option; }));
        selector.value = choices.some(([value]) => value === previous) ? previous : "__scenario__";
      }
      selector.disabled = !ready;
      syncStyledSelect(selector);
    }
    let summary = null;
    if (ready) {
      const scope = selector?.value || "__scenario__";
      const selected = runtimeState.devSelectionOrder?.length ? runtimeState.devSelectionOrder
        : runtimeState.devSelectionFeatureIds?.size ? runtimeState.devSelectionFeatureIds
          : runtimeState.devSelectedHit?.targetType === "land" ? [runtimeState.devSelectedHit.id] : [];
      summary = scope === "__scenario__" ? sumPopulationFeatures(runtimeState, Object.keys(runtimeState.populationRuntime.data.byFeatureId))
        : scope === "__selection__" ? sumPopulationFeatures(runtimeState, selected) : getPopulationCountrySummary(runtimeState, scope);
    }
    setText("populationSummary", summary ? [
      `${text(summary.complete ? "Estimated population" : "Known population (incomplete)")}: ${format(summary.population)}`,
      `${text("Population density")}: ${format(summary.density, 1)} ${text("persons/km²")}`,
      `${text("Mapped parcels")}: ${summary.counts.observed + summary.counts.partial}/${summary.counts.features}`,
      `${text("Population coverage")}: ${format(summary.coverageFraction === null ? null : summary.coverageFraction * 100, 1)}%`,
    ].join(" · ") : "");
    for (const id of ["populationExportStats", "populationSummarizeSelection"]) if (nodes[id]) nodes[id].disabled = !ready;
    if (view.status === "idle" && view.enabled && view.supported) load();
    if (needsHeatmap && heatmap.status === "idle" && !loadingHeatmap) {
      loadingHeatmap = true;
      void ensurePopulationHeatmapData(runtimeState, { onChange: refresh }).finally(() => { loadingHeatmap = false; render(); });
    }
    return view;
  };
  const update = (patch) => {
    setPopulationStyleState(runtimeState, { ...normalizePopulationStyle(runtimeState.styleConfig?.population), ...patch });
    runtimeState.persistViewSettingsFn?.(); markDirty("population-style"); refresh();
  };
  nodes.togglePopulation?.addEventListener("change", (event) => {
    update({ enabled: event.target.checked, ...(event.target.checked ? { dataVersion: normalizePopulationStyle().dataVersion } : {}) });
    if (event.target.checked) showLegend(runtimeState);
  });
  nodes.populationMode?.addEventListener("change", (event) => update({ mode: event.target.value }));
  nodes.populationOpacity?.addEventListener("input", (event) => update({ opacity: Number(event.target.value) / 100 }));
  nodes.populationRetry?.addEventListener("click", () => {
    if (getPopulationViewModel(runtimeState).status === "failed") load(true);
    else void ensurePopulationHeatmapData(runtimeState, { retry: true,
      detailTileIds: getPopulationHeatmapSnapshot(runtimeState).requestedDetailTileIds || [], onChange: refresh });
  });
  nodes.populationSummaryScope?.addEventListener("change", render);
  nodes.populationSummarizeSelection?.addEventListener("click", () => { if (nodes.populationSummaryScope) nodes.populationSummaryScope.value = "__selection__"; render(); });
  nodes.populationExportStats?.addEventListener("click", () => downloadCsv(buildPopulationStatsCsv(runtimeState), `population-2020-${runtimeState.activeScenarioId}.csv`));
  return { render, retry: () => load(true) };
}
