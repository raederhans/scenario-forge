import { patchAppearanceStyleGroupState } from "../../core/state/actions/appearance_actions.js";
import { setAppearanceVisibilityState } from "../../core/state/actions/appearance_visibility_actions.js";
import { isStrategicChoroplethMetric } from "../../core/renderer/strategic_choropleth.js";
import {
  STRATEGIC_CHOROPLETH_METRIC_IDS,
  STRATEGIC_METRIC_NAMES,
  STRATEGIC_RESOURCE_IDS,
  getStrategicBucketInspection,
  getStrategicValuesColorStops,
  getStrategicValuesViewModel,
  normalizeStrategicValuesStyle,
} from "../../core/strategic_values_view_model.js";

const IDS = [
  "strategicValuesStatus", "strategicValuesSource", "toggleStrategicResourceMarkers",
  "strategicChoroplethMetric", "strategicValuesLoad", "strategicValuesLegend",
  "strategicValuesLegendRamp", "strategicValuesLegendMin", "strategicValuesLegendMax",
  "strategicValuesLegendNote", "strategicValuesCoverage", "strategicValuesInspect",
  "strategicValuesInspectValue", "strategicValuesOpacity", "strategicValuesOpacityValue",
  "strategicValuesPalette", "strategicResourceFilter",
  "strategicValuesSearch",
];

export function createStrategicValuesOwner({
  runtimeState, t = (value) => value, renderDirty = () => {},
  ensureActiveScenarioOptionalLayerLoaded = null, documentRef = globalThis.document,
} = {}) {
  const nodes = Object.fromEntries(IDS.map((id) => [id, documentRef?.getElementById?.(id) || null]));
  let requestId = 0;
  let localRequest = null;
  let localError = null;
  const zh = () => runtimeState.currentLanguage === "zh";
  const say = (en, cn) => zh() ? cn : en;
  const metricName = (id) => STRATEGIC_METRIC_NAMES[id]?.[zh() ? 1 : 0] || id;
  const setText = (id, value) => { if (nodes[id]) nodes[id].textContent = value; };
  const persist = () => runtimeState.persistViewSettingsFn?.();

  const renderOptions = (node, entries) => {
    if (!node) return;
    const existing = Array.from(node.options || []);
    const same = existing.length === entries.length && existing.every((option, i) => option.value === entries[i][0]);
    if (same) {
      existing.forEach((option, i) => {
        if (option.textContent !== entries[i][1]) option.textContent = entries[i][1];
      });
      return;
    }
    const fragment = documentRef.createDocumentFragment();
    entries.forEach(([value, label]) => {
      const option = documentRef.createElement("option");
      option.value = value;
      option.textContent = label;
      fragment.appendChild(option);
    });
    node.replaceChildren(fragment);
  };

  const load = async (reason) => {
    if (typeof ensureActiveScenarioOptionalLayerLoaded !== "function") return;
    const scenarioId = String(runtimeState.activeScenarioId || "");
    const thisRequest = ++requestId;
    localRequest = { scenarioId, id: thisRequest };
    localError = null;
    render();
    try {
      const result = await ensureActiveScenarioOptionalLayerLoaded("strategicvalues", {
        reason, renderNow: true, forceReload: reason === "toolbar-strategic-retry",
      });
      if (thisRequest !== requestId || scenarioId !== String(runtimeState.activeScenarioId || "")) return;
      const bundle = runtimeState.scenarioBundleCacheById?.[scenarioId];
      const chunkScheduled = Array.isArray(bundle?.chunkRegistry?.byLayer?.strategicvalues)
        && bundle.chunkRegistry.byLayer.strategicvalues.length > 0;
      if (!result && !chunkScheduled && !getStrategicValuesViewModel(runtimeState).payload) {
        localError = { scenarioId, error: new Error("Strategic values were not returned.") };
      }
    } catch (error) {
      if (thisRequest !== requestId || scenarioId !== String(runtimeState.activeScenarioId || "")) return;
      localError = { scenarioId, error: error || new Error("Strategic values could not be loaded.") };
    } finally {
      if (thisRequest === requestId && scenarioId === String(runtimeState.activeScenarioId || "")) {
        localRequest = null;
        if (getStrategicValuesViewModel(runtimeState).payload) renderDirty("strategic-values-loaded");
        render();
      }
    }
  };

  const render = () => {
    const view = getStrategicValuesViewModel(runtimeState);
    if (localRequest && localRequest.scenarioId !== view.scenarioId) {
      requestId += 1;
      localRequest = null;
    }
    const status = view.status === "ready" ? "ready"
      : localRequest?.scenarioId === view.scenarioId ? "loading"
      : localError?.scenarioId === view.scenarioId && localRequest === null ? "failed" : view.status;
    const unsupported = status === "unsupported";
    const controls = nodes.strategicChoroplethMetric?.parentElement;
    if (controls) {
      controls.hidden = unsupported;
      controls.style.display = unsupported ? "none" : "";
    }
    const style = normalizeStrategicValuesStyle(runtimeState.styleConfig?.strategicValues);
    const metric = view.metricId;
    renderOptions(nodes.strategicChoroplethMetric, [
      ["", say("None", "无")],
      ...STRATEGIC_CHOROPLETH_METRIC_IDS.map((id) => [id, metricName(id)]),
    ]);
    if (nodes.strategicChoroplethMetric) nodes.strategicChoroplethMetric.value = metric;
    renderOptions(nodes.strategicValuesPalette, [
      ["auto", say("Automatic", "自动")], ["blue", say("Blue", "蓝色")],
      ["green", say("Green", "绿色")], ["rose", say("Rose", "玫红")],
    ]);
    if (nodes.strategicValuesPalette) nodes.strategicValuesPalette.value = style.palette;
    renderOptions(nodes.strategicResourceFilter, [
      ["all", say("All resources", "全部资源")],
      ...STRATEGIC_RESOURCE_IDS.map((id) => [id, metricName(id)]),
    ]);
    if (nodes.strategicResourceFilter) nodes.strategicResourceFilter.value = style.resourceFilter;
    if (nodes.toggleStrategicResourceMarkers) {
      nodes.toggleStrategicResourceMarkers.checked = !!runtimeState.showStrategicResourceMarkers;
      nodes.toggleStrategicResourceMarkers.disabled = (status === "unsupported" || status === "loading")
        && !runtimeState.showStrategicResourceMarkers;
    }
    if (nodes.strategicChoroplethMetric) {
      nodes.strategicChoroplethMetric.disabled = (status === "unsupported" || status === "loading") && !metric;
    }
    for (const id of ["strategicValuesOpacity", "strategicValuesPalette", "strategicResourceFilter"]) {
      if (nodes[id]) nodes[id].disabled = status === "unsupported" || status === "loading";
    }
    if (nodes.strategicValuesOpacity) nodes.strategicValuesOpacity.value = String(Math.round(style.opacity * 100));
    setText("strategicValuesOpacityValue", `${Math.round(style.opacity * 100)}%`);
    const statusCopy = {
      unsupported: say("Strategic mapping is not connected for this scenario yet.", "此剧本尚未接入战略数值映射。"),
      "not-loaded": say("Strategic values are available to load.", "可加载战略数值。"),
      loading: say("Loading strategic values…", "正在加载战略数值…"),
      failed: say("Strategic values could not be loaded. Retry.", "战略数值加载失败，请重试。"),
      ready: view.bucketIds.length === 0
        ? say("Loaded, but there are no strategic regions.", "已加载，但没有战略区域。")
        : view.mappedBucketIds.length === 0
          ? say("Loaded, but no regions are mapped to the map.", "已加载，但没有区域映射到地图。")
          : metric && view.valuedBucketIds.length === 0
            ? say("Loaded; mapped regions have no values for this metric.", "已加载；已映射区域没有该指标数值。")
          : view.allZero && metric
            ? say("Loaded; all mapped values for this metric are zero.", "已加载；该指标的映射区域数值均为零。")
            : say("Strategic values ready.", "战略数值已就绪。"),
    };
    setText("strategicValuesStatus", statusCopy[status]);
    const source = view.scenarioName || view.scenarioId;
    setText("strategicValuesSource", unsupported
      ? ""
      : `${say("HOI4 game values", "HOI4 游戏数值")}${source ? ` · ${source}` : ""}${view.asOf ? ` · ${view.asOf}` : ""}`);
    if (nodes.strategicValuesLoad) {
      nodes.strategicValuesLoad.hidden = status === "ready" || status === "unsupported";
      nodes.strategicValuesLoad.disabled = status === "loading";
      nodes.strategicValuesLoad.textContent = status === "failed" ? say("Retry load", "重试加载")
        : status === "loading" ? say("Loading…", "加载中…") : say("Load values", "加载数值");
    }
    const coverage = view.coverage;
    setText("strategicValuesCoverage", status === "ready"
      ? say(`Mapped regions: ${coverage.mapped}/${coverage.total}${metric ? ` · ${coverage.valued} with ${metricName(metric)} values` : ""}`,
        `已映射区域：${coverage.mapped}/${coverage.total}${metric ? ` · ${coverage.valued} 个有${metricName(metric)}数值` : ""}`)
      : "");
    if (nodes.strategicValuesLegend) nodes.strategicValuesLegend.hidden = status !== "ready" || !metric;
    if (view.domain && metric) {
      const [low, high] = getStrategicValuesColorStops(style.palette, view.metric.family);
      if (nodes.strategicValuesLegendRamp) nodes.strategicValuesLegendRamp.style.background = `linear-gradient(to right, ${low}, ${high})`;
      setText("strategicValuesLegendMin", Number(view.domain.min).toLocaleString());
      setText("strategicValuesLegendMax", Number(view.domain.max).toLocaleString());
      setText("strategicValuesLegendNote", say(
        `Colour saturates at ${Number(view.domain.max).toLocaleString()}; unmapped areas use their usual map colour.`,
        `颜色在 ${Number(view.domain.max).toLocaleString()} 达到上限；未映射区域保留原地图颜色。`,
      ));
    }
    const previous = nodes.strategicValuesInspect?.value || "";
    const query = String(nodes.strategicValuesSearch?.value || "").trim().toLowerCase();
    const matchingBuckets = view.mappedBucketIds.filter((id) => {
      const bucket = view.payload.buckets[id];
      return !query || `${id} ${bucket.owner_tag || ""} ${bucket.state_id ?? ""}`.toLowerCase().includes(query);
    });
    renderOptions(nodes.strategicValuesInspect, [
      ["", say("Choose a region", "选择区域")],
      ...matchingBuckets.map((id) => {
        const bucket = view.payload.buckets[id];
        return [id, `${id} · ${bucket.owner_tag || "—"} · ${bucket.state_id ?? "—"}`];
      }),
    ]);
    if (nodes.strategicValuesInspect) nodes.strategicValuesInspect.value = matchingBuckets.includes(previous) ? previous : "";
    if (nodes.strategicValuesInspect) nodes.strategicValuesInspect.disabled = status !== "ready" || view.mappedBucketIds.length === 0;
    const inspected = getStrategicBucketInspection(view, nodes.strategicValuesInspect?.value);
    setText("strategicValuesInspectValue", inspected
      ? `${inspected.id} · ${say("state", "地区")} ${inspected.stateId || "—"} · ${say("owner", "归属")} ${inspected.owner || "—"} · ${metric ? `${metricName(metric)}: ${inspected.hasValue ? inspected.value.toLocaleString() : say("No value", "无数值")}` : say("Select a metric", "选择指标")}`
      : status === "ready" ? say("Choose a mapped region to inspect its value.", "选择已映射区域以查看数值。") : "");
  };

  const bind = (id, event, callback) => {
    const node = nodes[id];
    if (!node || node.dataset.strategicValuesBound === "true") return;
    node.addEventListener(event, callback);
    node.dataset.strategicValuesBound = "true";
  };
  const changeStyle = (patch, reason) => {
    patchAppearanceStyleGroupState(runtimeState, "strategicValues", patch);
    persist();
    renderDirty(reason);
    render();
  };
  const bindEvents = () => {
    bind("toggleStrategicResourceMarkers", "change", (event) => {
      setAppearanceVisibilityState(runtimeState, "showStrategicResourceMarkers", !!event.target.checked);
      if (runtimeState.showStrategicResourceMarkers) void load("toolbar-strategic-markers");
      persist(); renderDirty("toggle-strategic-resource-markers"); render();
    });
    bind("strategicChoroplethMetric", "change", (event) => {
      const metric = String(event.target.value || "");
      setAppearanceVisibilityState(runtimeState, "strategicChoroplethMetric", isStrategicChoroplethMetric(metric) ? metric : "");
      if (runtimeState.strategicChoroplethMetric) void load("toolbar-strategic-choropleth");
      persist(); renderDirty("strategic-choropleth-metric"); render();
    });
    bind("strategicValuesLoad", "click", () => { void load("toolbar-strategic-retry"); });
    bind("strategicValuesInspect", "change", render);
    bind("strategicValuesSearch", "input", render);
    bind("strategicValuesOpacity", "input", (event) => changeStyle({ opacity: Number(event.target.value) / 100 }, "strategic-values-opacity"));
    bind("strategicValuesPalette", "change", (event) => changeStyle({ palette: event.target.value }, "strategic-values-palette"));
    bind("strategicResourceFilter", "change", (event) => changeStyle({ resourceFilter: event.target.value }, "strategic-resource-filter"));
    render();
  };
  return { bindEvents, render };
}
