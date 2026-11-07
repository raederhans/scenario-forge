// Layer-based Special Zones workbench controller.
// 这个控制器只管理 special zone layer UI；toolbar.js 继续负责弹层、焦点和跨面板仲裁。

import {
  SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES,
  SPECIAL_ZONE_PRESETS,
  captureScenarioLayerSaveRequestState,
  createLayerFromPreset,
  createSpecialZonePatternPreviewStyle,
  getSpecialZoneLayerDisplayName,
  getSpecialZoneValidFeatureIds,
  getSpecialZoneStoryPreviewSteps,
  mutateSpecialZoneLayersState,
  normalizeSpecialZoneLayersState,
  parseSpecialZoneMemberImportText,
  resolveSpecialZoneTopologyFingerprint,
  serializeSpecialZoneLayersState,
} from "../../core/special_zone_layers.js";
import {
  activateSpecialZoneMembershipToolState,
  exitSpecialZoneMembershipToolState,
  registerSpecialZonesWorkbenchRuntimeHooks,
  commitSpecialZoneLayersState,
  setSpecialZoneMembershipBrushModeState,
  setSpecialZonesVisibilityState,
} from "../../core/state/actions/special_zone_actions.js";
import { getMapDataBoundary } from "../../core/map_data_boundary.js";
import { callRuntimeHook } from "../../core/state/index.js";
import { createLatestRequestQueue } from "./latest_request_queue.js";

function createButton(label, className = "secondary-btn") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function createLabel(text, control) {
  const label = document.createElement("label");
  label.className = "special-zone-workbench-field";
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, control);
  return label;
}

function createField(text, control) {
  const field = document.createElement("div");
  field.className = "special-zone-workbench-field";
  const span = document.createElement("span");
  span.textContent = text;
  field.append(span, control);
  return field;
}

const MEMBER_TOOL_IDS = new Set(["single", "multi", "brush"]);
const MEMBER_BRUSH_MODES = new Set(["add", "remove"]);
const MEMBER_LIST_INLINE_LIMIT = 12;
const MEMBER_LIST_INLINE_RENDER_COUNT = 12;
const MEMBER_DRAWER_RENDER_LIMIT = 80;
const SPECIAL_ZONE_PATTERN_LABELS = Object.freeze({
  fineHatch: "Fine hatch",
  dashHatch: "Dashed hatch",
  bandStripes: "Band stripes",
  dotGrid: "Staggered dots",
  fineHorizontal: "Fine horizontal",
  openGrid: "Open grid",
  solid: "Solid",
  diagonalHatch: "Diagonal hatch",
  crossHatch: "Cross hatch",
  horizontalLines: "Horizontal lines",
  wavyLines: "Wavy lines",
  dots: "Dots",
  denseDots: "Dense dots",
  concentric: "Concentric rings",
  chevrons: "Chevrons",
  outlineOnly: "Outline only",
});

function getPatternLabel(patternId) {
  return SPECIAL_ZONE_PATTERN_LABELS[patternId] || patternId;
}

function featureIdFromDevSelectionEntry(entry) {
  return String(entry?.featureId || entry?.id || entry || "").trim();
}

function createSpecialZonesWorkbenchController({
  runtimeState,
  container = null,
  markDirty,
  render,
  updateToolUI,
  captureHistoryState,
  pushHistoryEntry,
  ensureActiveScenarioOptionalLayerLoaded,
  showToast,
  t,
} = {}) {
  let root = null;
  let statusNode = null;
  let layerListNode = null;
  let presetListNode = null;
  let propertyNode = null;
  let actionsNode = null;
  let currentTargetActionsNode = null;
  let memberDrawerNode = null;
  let overlayToggleNode = null;
  let memberImportInputNode = null;
  let lastDiagnosticsToastKey = "";
  let loadedScenarioLayerAssetId = "";
  let loadedScenarioLayerRequestId = 0;
  let failedScenarioLayerAssetId = "";
  let failedScenarioLayerRequestId = 0;
  let scenarioLayerLoadPromise = null;
  let scenarioLayerLoadScenarioId = "";
  let scenarioLayerLoadRequestId = 0;
  let saveRequestSequence = 0;
  let creatingLayer = false;

  const translate = (value) => (typeof t === "function" ? t(value, "ui") : value);

  const normalizeState = (options = {}) => {
    return commitSpecialZoneLayersState(
      runtimeState,
      runtimeState.specialZoneLayers,
      {
        defaultSource: runtimeState.activeScenarioId ? "scenario" : "project",
        topologyFingerprint: resolveSpecialZoneTopologyFingerprint(runtimeState),
        ...options,
      },
      { markDirty: false },
    );
  };

  const activeLayer = () => {
    const state = normalizeState();
    return state.layers.find((layer) => layer.id === state.activeLayerId) || state.layers[0] || null;
  };

  const createScenarioLayerLoadContext = () => ({
    scenarioId: String(runtimeState.activeScenarioId || "").trim(),
    scenarioApplyRequestId: Math.max(0, Number(runtimeState.currentScenarioApplyRequestId || 0)),
    declaresLayerAsset: activeScenarioDeclaresLayerAsset(),
  });

  const isScenarioLayerLoadContextCurrent = (context = {}) => {
    const scenarioId = String(context.scenarioId || "").trim();
    if (!scenarioId) return false;
    if (String(runtimeState.activeScenarioId || "").trim() !== scenarioId) return false;
    const expectedRequestId = Math.max(0, Number(context.scenarioApplyRequestId || 0));
    const currentRequestId = Math.max(0, Number(runtimeState.currentScenarioApplyRequestId || 0));
    return currentRequestId === expectedRequestId;
  };

  const isScenarioLayerCacheLoadedForContext = (context = {}) => {
    const scenarioId = String(context.scenarioId || "").trim();
    const scenarioApplyRequestId = Math.max(0, Number(context.scenarioApplyRequestId || 0));
    return !!scenarioId
      && loadedScenarioLayerAssetId === scenarioId
      && loadedScenarioLayerRequestId === scenarioApplyRequestId;
  };

  const isSameScenarioLayerSaveContext = (left = {}, right = {}) => (
    String(left.scenarioId || "").trim() === String(right.scenarioId || "").trim()
    && Math.max(0, Number(left.scenarioApplyRequestId || 0))
      === Math.max(0, Number(right.scenarioApplyRequestId || 0))
  );

  const isScenarioLayerSaveJobCurrent = (job) => (
    job?.saveRequestId === saveRequestSequence
    && isScenarioLayerLoadContextCurrent(job?.loadContext)
  );

  const settleScenarioLayerSaveWaiter = (waiter) => {
    waiter.saveButton.classList.remove("is-loading");
    waiter.saveButton.removeAttribute("aria-busy");
    waiter.syncButtonState();
  };

  const executeScenarioLayerSaveJob = async (job) => {
    try {
      if (!isScenarioLayerLoadContextCurrent(job.loadContext)) return;
      let stateToSave = job.requestedState;
      if (!isScenarioLayerCacheLoadedForContext(job.loadContext)) {
        await loadScenarioSpecialZoneLayers(job.loadContext);
        if (
          !isScenarioLayerLoadContextCurrent(job.loadContext)
          || !isScenarioLayerCacheLoadedForContext(job.loadContext)
        ) {
          throw new Error("Scenario special zone layer asset load unavailable.");
        }
        // 首次保存可能发生在 optional asset 载入前；已有本地 layer 时保存点击时的本地意图。
        if (!job.requestedState.layers.length) {
          stateToSave = serializeSpecialZoneLayersState(runtimeState.specialZoneLayers, {
            defaultSource: runtimeState.activeScenarioId ? "scenario" : "project",
            topologyFingerprint: String(
              runtimeState.scenarioBaselineHash
              || runtimeState.activeScenarioManifest?.source?.runtime_topology_sha256
              || "",
            ).trim(),
          });
        }
      }
      const response = await fetch("/__dev/scenario/special-zone-layers/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId: job.scenarioId,
          specialZoneLayers: stateToSave,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (!isScenarioLayerSaveJobCurrent(job)) return;
      if (!result?.ok) throw new Error(result?.error || "Scenario special zone save failed.");
      commitSpecialZoneLayersState(runtimeState, result.specialZoneLayers || normalizeState(), {
        defaultSource: "scenario",
        topologyFingerprint: resolveSpecialZoneTopologyFingerprint(runtimeState),
      });
      render?.();
      if (statusNode) statusNode.textContent = translate("Scenario special zone layers saved.");
      showToast?.(translate("Scenario special zone layers saved."), { title: translate("Special zones saved"), tone: "success" });
    } catch (error) {
      if (!isScenarioLayerSaveJobCurrent(job)) return;
      console.warn("[special-zone-layers] Scenario save unavailable.", error);
      if (statusNode) statusNode.textContent = translate("Scenario special zone layer save failed.");
      showToast?.(translate("Scenario layer asset save is available only in the local dev server."), { title: translate("Read-only scenario asset"), tone: "warning" });
    }
  };

  const scenarioLayerSaveQueue = createLatestRequestQueue({
    isSameRequest: (left, right) => (
      isSameScenarioLayerSaveContext(left.loadContext, right.loadContext)
    ),
    execute: executeScenarioLayerSaveJob,
    settle: settleScenarioLayerSaveWaiter,
  });

  const isScenarioLayerCacheFailedForContext = (context = {}) => {
    const scenarioId = String(context.scenarioId || "").trim();
    const scenarioApplyRequestId = Math.max(0, Number(context.scenarioApplyRequestId || 0));
    return !!scenarioId
      && failedScenarioLayerAssetId === scenarioId
      && failedScenarioLayerRequestId === scenarioApplyRequestId;
  };

  const getDevSelectionFeatureIds = () => {
    const ordered = Array.isArray(runtimeState.devSelectionOrder) ? runtimeState.devSelectionOrder : [];
    const indexed = runtimeState.devSelectionFeatureIds instanceof Set ? Array.from(runtimeState.devSelectionFeatureIds) : [];
    const featureIds = new Set();
    for (const entry of [...ordered, ...indexed]) {
      const featureId = featureIdFromDevSelectionEntry(entry);
      if (featureId) featureIds.add(featureId);
    }
    return Array.from(featureIds).sort((a, b) => a.localeCompare(b));
  };

  const getMemberTool = () => {
    const tool = String(runtimeState.specialZoneMembershipTool || "multi").trim();
    return MEMBER_TOOL_IDS.has(tool) ? tool : "multi";
  };

  const getMemberBrushMode = () => {
    const mode = String(runtimeState.specialZoneMembershipBrushMode || "add").trim();
    return MEMBER_BRUSH_MODES.has(mode) ? mode : "add";
  };

  const getValidFeatureIds = () => getSpecialZoneValidFeatureIds(runtimeState);

  const filterValidFeatureIds = (featureIds = []) => {
    const validFeatureIds = getValidFeatureIds();
    const ids = parseSpecialZoneMemberImportText((Array.isArray(featureIds) ? featureIds : [featureIds]).join("\n"));
    if (!validFeatureIds) return ids;
    return ids.filter((featureId) => validFeatureIds.has(featureId));
  };

  const activeScenarioDeclaresLayerAsset = () => {
    return !!String(runtimeState.activeScenarioManifest?.special_zone_layers_url || "").trim();
  };

  const setLoadFailedSpecialZoneLayersState = (scenarioId) => {
    const topologyFingerprint = resolveSpecialZoneTopologyFingerprint(runtimeState);
    commitSpecialZoneLayersState(runtimeState, {
      version: 1,
      layers: [],
      activeLayerId: "",
      topologyFingerprint,
      diagnostics: [
        {
          code: SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES.LOAD_FAILED,
          scenarioId,
        },
      ],
    }, {
      defaultSource: "scenario",
      topologyFingerprint,
    });
  };

  const applyPatternPreviewStyle = (node, style = {}) => {
    if (!node) return;
    const preview = createSpecialZonePatternPreviewStyle(style);
    node.style.backgroundColor = preview.backgroundColor;
    node.style.backgroundImage = preview.backgroundImage;
    node.style.backgroundSize = preview.backgroundSize;
    node.style.borderColor = preview.borderColor;
    node.style.opacity = preview.opacity;
  };

  const activateMembershipTool = (tool = getMemberTool()) => {
    const normalizedTool = MEMBER_TOOL_IDS.has(tool) ? tool : "multi";
    activateSpecialZoneMembershipToolState(runtimeState, normalizedTool);
    updateToolUI?.();
    renderSpecialZonesWorkbenchUi();
  };

  const applyLayerStylePatch = (layer, patch, label = "special-zone-layer-style") => {
    if (!layer) return;
    updateState({
      action: "updateLayer",
      layerId: layer.id,
      patch: {
        style: {
          ...patch,
          revision: Number(layer.style?.revision || 1) + 1,
        },
      },
    }, label);
  };

  const updateState = (mutation, label = "special-zone-layers") => {
    const before = typeof captureHistoryState === "function"
      ? captureHistoryState({ strategicOverlay: true })
      : null;
    const nextState = mutateSpecialZoneLayersState(normalizeState({
      validFeatureIds: getValidFeatureIds(),
    }), mutation);
    commitSpecialZoneLayersState(runtimeState, nextState, {
      defaultSource: runtimeState.activeScenarioId ? "scenario" : "project",
      topologyFingerprint: resolveSpecialZoneTopologyFingerprint(runtimeState),
      validFeatureIds: getValidFeatureIds(),
    });
    if (mutation?.action === "addLayer") {
      setSpecialZonesVisibilityState(runtimeState, true);
    }
    markDirty?.(label);
    if (typeof pushHistoryEntry === "function") {
      pushHistoryEntry({
        kind: label,
        before,
        after: typeof captureHistoryState === "function" ? captureHistoryState({ strategicOverlay: true }) : null,
      });
    }
    render?.();
    updateToolUI?.();
    renderSpecialZonesWorkbenchUi();
  };

  const ensureRoot = () => {
    if (!container) return null;
    root = container.querySelector("[data-special-zone-layers-workbench]");
    if (root) return root;
    root = document.createElement("section");
    root.dataset.specialZoneLayersWorkbench = "true";
    root.className = "special-zone-layers-workbench";
    root.setAttribute("aria-label", translate("Special zone layers workbench"));

    const header = document.createElement("div");
    header.className = "special-zone-workbench-header";
    const title = document.createElement("h3");
    title.dataset.specialZoneWorkbenchTitle = "true";
    title.textContent = translate("Special Zones");
    const overlayToggleLabel = document.createElement("label");
    overlayToggleLabel.className = "special-zone-overlay-toggle";
    overlayToggleNode = document.createElement("input");
    overlayToggleNode.type = "checkbox";
    overlayToggleNode.dataset.specialZoneOverlayToggle = "true";
    overlayToggleNode.checked = !!runtimeState.showSpecialZones;
    const overlayToggleText = document.createElement("span");
    overlayToggleText.textContent = translate("Show special zones overlay");
    overlayToggleLabel.append(overlayToggleNode, overlayToggleText);
    overlayToggleNode.addEventListener("change", async () => {
      setSpecialZonesVisibilityState(runtimeState, Boolean(overlayToggleNode.checked));
      markDirty?.("toggle-special-zones");
      if (runtimeState.showSpecialZones) {
        await loadScenarioSpecialZoneLayers();
      }
      render?.();
      renderSpecialZonesWorkbenchUi();
    });
    statusNode = document.createElement("p");
    statusNode.id = "specialZoneWorkbenchStatus";
    statusNode.className = "special-zone-workbench-status visually-hidden";
    statusNode.setAttribute("role", "status");
    statusNode.setAttribute("aria-live", "polite");
    statusNode.setAttribute("aria-atomic", "true");
    header.append(title, overlayToggleLabel, statusNode);
    const layout = document.createElement("div");
    layout.className = "special-zone-workbench-grid";
    layerListNode = document.createElement("div");
    presetListNode = document.createElement("div");
    propertyNode = document.createElement("div");
    actionsNode = document.createElement("div");
    [presetListNode, layerListNode, propertyNode, actionsNode].forEach((node) => {
      node.className = "special-zone-workbench-card";
      layout.appendChild(node);
    });
    propertyNode.classList.add("special-zone-style-card");
    root.append(header, layout);
    container.prepend(root);
    return root;
  };

  const categoryName = (category) => translate(SPECIAL_ZONE_PRESETS.find((preset) => preset.id === category)?.name || "Custom Zone");

  const createCategorySelect = (value, onChange) => {
    const select = document.createElement("select");
    select.className = "special-zone-category-select";
    select.setAttribute("aria-label", translate("Category"));
    SPECIAL_ZONE_PRESETS.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = translate(preset.name);
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  };

  const renderLayerRows = (node, layers, activeId) => {
    layers.forEach((layer) => {
      const row = document.createElement("div");
      row.className = "special-zone-layer-row";
      row.dataset.layerId = layer.id;
      if (layer.id === activeId) row.classList.add("is-active");
      const visibility = createButton(layer.visible ? "◉" : "○", "secondary-btn special-zone-visibility");
      visibility.setAttribute("aria-label", translate(layer.visible ? "Hide" : "Show"));
      visibility.setAttribute("aria-pressed", String(layer.visible));
      visibility.addEventListener("click", () => updateState({ action: "updateLayer", layerId: layer.id, patch: { visible: !layer.visible } }, "special-zone-layer-visible"));
      const select = createButton("", "secondary-btn special-zone-layer-select");
      select.setAttribute("aria-pressed", String(layer.id === activeId));
      const preview = document.createElement("span");
      preview.className = "special-zone-pattern-choice-preview";
      applyPatternPreviewStyle(preview, layer.style);
      const label = document.createElement("span");
      label.textContent = `${getSpecialZoneLayerDisplayName(layer, runtimeState.currentLanguage)} · ${categoryName(layer.category)} · ${translate("{count} parcels").replace("{count}", layer.memberFeatureIds.length)}`;
      select.append(preview, label);
      select.addEventListener("click", () => updateState({ action: "setActiveLayer", layerId: layer.id }, "special-zone-active-layer"));
      row.append(visibility, select);
      node.appendChild(row);
    });
  };

  const renderLayerList = (state) => {
    layerListNode.replaceChildren();
    const header = document.createElement("div");
    header.className = "special-zone-workbench-section-title";
    const title = document.createElement("h4");
    title.textContent = translate("My regions");
    const add = createButton(translate("New region"));
    add.addEventListener("click", () => { creatingLayer = true; renderSpecialZonesWorkbenchUi(); });
    header.append(title, add);
    layerListNode.appendChild(header);
    renderLayerRows(layerListNode, state.layers.filter((layer) => layer.source === "project"), state.activeLayerId);
    if (!creatingLayer) return;
    const form = document.createElement("div");
    form.className = "special-zone-create-form";
    const name = document.createElement("input");
    name.type = "text";
    name.value = categoryName("demilitarized");
    const preview = document.createElement("span");
    preview.className = "special-zone-pattern-choice-preview";
    applyPatternPreviewStyle(preview, SPECIAL_ZONE_PRESETS[0].style);
    const category = createCategorySelect("demilitarized", (value) => {
      name.value = categoryName(value);
      applyPatternPreviewStyle(preview, SPECIAL_ZONE_PRESETS.find((preset) => preset.id === value).style);
    });
    const create = createButton(translate("Create"));
    create.addEventListener("click", async () => {
      if (runtimeState.activeScenarioId) {
        const context = createScenarioLayerLoadContext();
        await loadScenarioSpecialZoneLayers(context);
        if (!isScenarioLayerLoadContextCurrent(context)) return;
      }
      creatingLayer = false;
      updateState({ action: "addLayer", layer: createLayerFromPreset(category.value, { name: name.value, source: "project" }) }, "special-zone-layer-add");
      activateMembershipTool("brush");
    });
    form.append(createLabel(translate("Category"), category), preview, createLabel(translate("Name"), name), create);
    layerListNode.appendChild(form);
  };

  const renderPresetList = (state) => {
    presetListNode.replaceChildren();
    const title = document.createElement("h4");
    title.textContent = translate("Preset regions");
    presetListNode.appendChild(title);
    const layers = state.layers.filter((layer) => layer.source === "scenario");
    renderLayerRows(presetListNode, layers, state.activeLayerId);
    if (!layers.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = translate("This scenario has no preset regions.");
      presetListNode.appendChild(empty);
    }
  };

  const renderProperties = (layer) => {
    if (!propertyNode) return;
    propertyNode.replaceChildren();
    const title = document.createElement("h4");
    title.textContent = translate("Current layer style");
    propertyNode.appendChild(title);
    if (!layer) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = translate("Select a layer to edit its style.");
      propertyNode.appendChild(empty);
      return;
    }
    const stylePreview = document.createElement("div");
    stylePreview.className = "special-zone-current-style-preview";
    applyPatternPreviewStyle(stylePreview, layer.style);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = getSpecialZoneLayerDisplayName(layer, runtimeState.currentLanguage);
    nameInput.addEventListener("change", () => updateState({ action: "updateLayer", layerId: layer.id, patch: { name: nameInput.value, nameZh: "" } }, "special-zone-layer-name"));

    const category = createCategorySelect(layer.category, (value) => {
      const preset = SPECIAL_ZONE_PRESETS.find((entry) => entry.id === value);
      updateState({ action: "updateLayer", layerId: layer.id, patch: { presetId: value, category: value, style: { ...preset.style, revision: layer.style.revision + 1 } } }, "special-zone-layer-category");
    });
    const fillInput = document.createElement("input");
    fillInput.type = "color";
    fillInput.value = layer.style.fill;
    fillInput.addEventListener("input", () => applyLayerStylePatch(layer, { fill: fillInput.value }));

    const strokeInput = document.createElement("input");
    strokeInput.type = "color";
    strokeInput.value = layer.style.stroke;
    strokeInput.addEventListener("input", () => applyLayerStylePatch(layer, { stroke: strokeInput.value }));

    const opacityInput = document.createElement("input");
    opacityInput.type = "range";
    opacityInput.min = "0";
    opacityInput.max = "100";
    opacityInput.value = String(Math.round(layer.style.fillOpacity * 100));
    opacityInput.addEventListener("input", () => applyLayerStylePatch(layer, { fillOpacity: Number(opacityInput.value) / 100 }));

    const patternGrid = document.createElement("div");
    patternGrid.className = "special-zone-pattern-choice-grid";
    patternGrid.setAttribute("role", "radiogroup");
    patternGrid.setAttribute("aria-label", translate("Pattern"));
    ["fineHatch", "dashHatch", "bandStripes", "dotGrid", "fineHorizontal", "openGrid", "solid", "outlineOnly"].forEach((patternId) => {
      const label = translate(getPatternLabel(patternId));
      const button = createButton("", "secondary-btn special-zone-pattern-choice");
      button.dataset.patternId = patternId;
      button.title = label;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(layer.style.pattern === patternId));
      button.setAttribute("aria-pressed", String(layer.style.pattern === patternId));
      const preview = document.createElement("span");
      preview.className = "special-zone-pattern-choice-preview";
      applyPatternPreviewStyle(preview, { ...layer.style, pattern: patternId });
      const name = document.createElement("span");
      name.className = "special-zone-pattern-choice-name";
      name.textContent = label;
      button.append(preview, name);
      button.addEventListener("click", () => applyLayerStylePatch(layer, { pattern: patternId }));
      patternGrid.appendChild(button);
    });

    const strokeWidth = document.createElement("input");
    strokeWidth.type = "number";
    strokeWidth.min = "0.4";
    strokeWidth.max = "8";
    strokeWidth.step = "0.1";
    strokeWidth.value = String(layer.style.strokeWidth);
    strokeWidth.addEventListener("change", () => applyLayerStylePatch(layer, { strokeWidth: Number(strokeWidth.value) }));

    propertyNode.append(
      stylePreview,
      createLabel(translate("Name"), nameInput),
      createLabel(translate("Category"), category),
      createLabel(translate("Fill"), fillInput),
      createLabel(translate("Stroke"), strokeInput),
      createLabel(translate("Opacity"), opacityInput),
      createField(translate("Pattern"), patternGrid),
      createLabel(translate("Stroke width"), strokeWidth)
    );
  };

  const getSelectedCountryIds = () => {
    const reference = getMapDataBoundary(runtimeState).reference;
    const code = runtimeState.selectedInspectorCountryCode;
    return runtimeState.activeScenarioId ? reference.getScenarioGroupFeatureIds(code) : reference.getGeographicCountryFeatureIds(code);
  };

  const getSelectedGroupIds = () => runtimeState.inspectorHighlightGroupMode
    ? Array.from(runtimeState.inspectorHighlightFeatureIds || []) : [];

  const renderCurrentTargetActions = (layer) => {
    if (!currentTargetActionsNode) return;
    currentTargetActionsNode.replaceChildren();
    const country = createButton(translate("Add selected country"));
    country.disabled = !layer || !runtimeState.selectedInspectorCountryCode;
    country.addEventListener("click", () => updateState({ action: "addMembers", layerId: layer.id, featureIds: getSelectedCountryIds() }, "special-zone-members-add-country"));
    const group = createButton(translate("Add selected group"));
    group.disabled = !layer || !getSelectedGroupIds().length;
    group.addEventListener("click", () => updateState({ action: "addMembers", layerId: layer.id, featureIds: getSelectedGroupIds() }, "special-zone-members-add-group"));
    currentTargetActionsNode.append(country, group);
  };

  const closeMemberDrawer = () => {
    if (!memberDrawerNode) return;
    if (typeof memberDrawerNode.close === "function" && memberDrawerNode.open) {
      memberDrawerNode.close();
    } else {
      memberDrawerNode.hidden = true;
    }
  };

  const renderMemberDrawerRows = (layer, searchTerm = "") => {
    if (!memberDrawerNode || !layer) return;
    const list = memberDrawerNode.querySelector("[data-special-zone-member-drawer-list]");
    if (!list) return;
    list.replaceChildren();
    const query = String(searchTerm || "").trim().toLowerCase();
    const filtered = layer.memberFeatureIds.filter((featureId) => (
      !query || String(featureId).toLowerCase().includes(query)
    ));
    filtered.slice(0, MEMBER_DRAWER_RENDER_LIMIT).forEach((featureId) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "special-zone-member-drawer-row";
      row.textContent = featureId;
      row.addEventListener("click", () => {
        updateState({
          action: "removeMembers",
          layerId: layer.id,
          featureIds: [featureId],
        }, "special-zone-members-remove");
        const search = memberDrawerNode?.querySelector(".special-zone-member-drawer-search");
        renderMemberDrawerRows(activeLayer(), search?.value || "");
      });
      list.appendChild(row);
    });
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = translate("No matching members.");
      list.appendChild(empty);
    } else if (filtered.length > MEMBER_DRAWER_RENDER_LIMIT) {
      const capped = document.createElement("p");
      capped.className = "muted";
      capped.textContent = translate("Showing first 80 matching members.");
      list.appendChild(capped);
    }
  };

  const openMemberDrawer = (layer) => {
    if (!container || !layer) return;
    if (!memberDrawerNode) {
      memberDrawerNode = document.createElement("dialog");
      memberDrawerNode.className = "special-zone-member-drawer";
      const header = document.createElement("div");
      header.className = "special-zone-member-drawer-header";
      const title = document.createElement("h4");
      title.textContent = translate("All member ids");
      const closeBtn = createButton(translate("Close"));
      closeBtn.addEventListener("click", closeMemberDrawer);
      header.append(title, closeBtn);
      const search = document.createElement("input");
      search.type = "search";
      search.className = "input special-zone-member-drawer-search";
      search.placeholder = translate("Search feature id or country code");
      search.addEventListener("input", () => renderMemberDrawerRows(activeLayer(), search.value));
      const list = document.createElement("div");
      list.dataset.specialZoneMemberDrawerList = "true";
      list.className = "special-zone-member-drawer-list";
      memberDrawerNode.append(header, search, list);
      container.appendChild(memberDrawerNode);
    }
    const search = memberDrawerNode.querySelector(".special-zone-member-drawer-search");
    if (search) search.value = "";
    renderMemberDrawerRows(layer);
    if (typeof memberDrawerNode.showModal === "function") {
      memberDrawerNode.showModal();
    } else {
      memberDrawerNode.hidden = false;
    }
    search?.focus?.();
  };

  const renderActions = (state, layer) => {
    if (!actionsNode) return;
    actionsNode.replaceChildren();
    currentTargetActionsNode = null;
    actionsNode.dataset.role = "members";
    const header = document.createElement("div");
    header.className = "special-zone-members-header";
    const title = document.createElement("h4");
    title.textContent = translate("Members");
    const edit = createButton(translate("Edit members on map"));
    edit.className = "secondary-btn special-zone-member-edit";
    edit.disabled = !layer;
    edit.setAttribute("aria-pressed", String(runtimeState.currentTool === "special-zone-membership"));
    edit.addEventListener("click", () => {
      if (runtimeState.currentTool === "special-zone-membership") {
        exitSpecialZoneMembershipToolState(runtimeState);
        updateToolUI?.();
        renderSpecialZonesWorkbenchUi();
      } else activateMembershipTool("brush");
    });
    header.append(title, edit);
    actionsNode.appendChild(header);

    if (!layer) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = translate("Select or create a layer before editing members.");
      actionsNode.appendChild(empty);
      return;
    }

    const summary = document.createElement("p");
    summary.className = "special-zone-member-summary";
    summary.textContent = translate("{count} parcels").replace("{count}", layer.memberFeatureIds.length);
    actionsNode.appendChild(summary);

    if (runtimeState.currentTool === "special-zone-membership") {
      const brushModeRow = document.createElement("div");
      brushModeRow.className = "special-zone-member-brush-row";
      [
        ["add", translate("Add")],
        ["remove", translate("Remove")],
      ].forEach(([mode, label]) => {
        const modeBtn = createButton(label, "secondary-btn special-zone-preset-tab");
        modeBtn.setAttribute("aria-pressed", String(getMemberBrushMode() === mode));
        modeBtn.addEventListener("click", () => {
          setSpecialZoneMembershipBrushModeState(runtimeState, mode);
          activateMembershipTool("brush");
        });
        brushModeRow.appendChild(modeBtn);
      });
      const hint = document.createElement("p");
      hint.textContent = translate("Click parcels to add or remove; press Esc to finish.");
      actionsNode.append(brushModeRow, hint);
    }

    currentTargetActionsNode = document.createElement("div");
    currentTargetActionsNode.className = "special-zone-member-current-target-row";
    renderCurrentTargetActions(layer);

    const addSelectionBtn = createButton(translate("Add dev selection"));
    addSelectionBtn.disabled = !layer || !getDevSelectionFeatureIds().length;
    addSelectionBtn.addEventListener("click", () => updateState({ action: "addMembers", layerId: layer.id, featureIds: getDevSelectionFeatureIds() }, "special-zone-members-add-selection"));

    const replaceSelectionBtn = createButton(translate("Replace with dev selection"));
    replaceSelectionBtn.disabled = addSelectionBtn.disabled;
    replaceSelectionBtn.addEventListener("click", () => updateState({ action: "replaceMembers", layerId: layer.id, featureIds: getDevSelectionFeatureIds() }, "special-zone-members-replace-selection"));

    const copySourceLayers = state.layers.filter((entry) => entry.id !== layer?.id);
    const copySelect = document.createElement("select");
    copySelect.className = "select-input special-zone-member-copy-select";
    copySelect.setAttribute("aria-label", translate("Layer to copy members from"));
    copySelect.title = translate("Layer to copy members from");
    const copyPlaceholder = document.createElement("option");
    copyPlaceholder.value = "";
    copyPlaceholder.textContent = copySourceLayers.length
      ? translate("Select source layer")
      : translate("No layers to copy from");
    copyPlaceholder.disabled = copySourceLayers.length > 0;
    copyPlaceholder.selected = true;
    copySelect.appendChild(copyPlaceholder);
    copySourceLayers.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${entry.name} (${entry.memberFeatureIds.length})`;
      copySelect.appendChild(option);
    });
    copySelect.disabled = !copySourceLayers.length;

    const copyBtn = createButton(translate("Copy members from layer"));
    copyBtn.disabled = !layer || !copySourceLayers.length || !copySelect.value;
    copySelect.addEventListener("change", () => {
      copyBtn.disabled = !layer || !copySelect.value;
    });
    copyBtn.addEventListener("click", () => {
      const source = state.layers.find((entry) => entry.id === copySelect.value);
      if (!source) return;
      updateState({ action: "replaceMembers", layerId: layer.id, featureIds: source?.memberFeatureIds || [] }, "special-zone-members-copy");
    });

    const clearBtn = createButton(translate("Clear members"));
    clearBtn.disabled = !layer || !layer.memberFeatureIds.length;
    clearBtn.addEventListener("click", () => updateState({ action: "replaceMembers", layerId: layer.id, featureIds: [] }, "special-zone-members-clear"));

    const batchImport = document.createElement("details");
    batchImport.className = "special-zone-member-batch";
    const batchSummary = document.createElement("summary");
    batchSummary.textContent = translate("Batch import / set operations");
    const batchBody = document.createElement("div");
    batchBody.className = "special-zone-member-batch-body";
    memberImportInputNode = document.createElement("textarea");
    memberImportInputNode.className = "input special-zone-member-import-input";
    memberImportInputNode.rows = 3;
    memberImportInputNode.placeholder = translate("Paste feature ids separated by commas, spaces, or new lines");
    const batchActions = document.createElement("div");
    batchActions.className = "special-zone-member-batch-actions";
    const importAddBtn = createButton(translate("Add imported ids"));
    importAddBtn.addEventListener("click", () => {
      const ids = filterValidFeatureIds(parseSpecialZoneMemberImportText(memberImportInputNode.value));
      updateState({ action: "addMembers", layerId: layer.id, featureIds: ids }, "special-zone-members-batch-add");
    });
    const importReplaceBtn = createButton(translate("Replace with imported ids"));
    importReplaceBtn.addEventListener("click", () => {
      const ids = filterValidFeatureIds(parseSpecialZoneMemberImportText(memberImportInputNode.value));
      updateState({ action: "replaceMembers", layerId: layer.id, featureIds: ids }, "special-zone-members-batch-replace");
    });
    batchActions.append(importAddBtn, importReplaceBtn);
    const setOperationRow = document.createElement("div");
    setOperationRow.className = "special-zone-member-set-row";
    const setSourceSelect = document.createElement("select");
    setSourceSelect.className = "select-input special-zone-member-set-select";
    state.layers.filter((entry) => entry.id !== layer?.id).forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.name;
      setSourceSelect.appendChild(option);
    });
    const applySetOperation = (operation, label) => {
      if (!setSourceSelect.value) return;
      updateState({
        action: "applyMemberSetOperation",
        layerId: layer.id,
        sourceLayerId: setSourceSelect.value,
        operation,
      }, label);
    };
    const unionBtn = createButton(translate("Union with layer"));
    unionBtn.disabled = !setSourceSelect.options.length;
    unionBtn.addEventListener("click", () => applySetOperation("union", "special-zone-members-union"));
    const subtractBtn = createButton(translate("Subtract layer"));
    subtractBtn.disabled = unionBtn.disabled;
    subtractBtn.addEventListener("click", () => applySetOperation("subtract", "special-zone-members-subtract"));
    const intersectBtn = createButton(translate("Intersect layer"));
    intersectBtn.disabled = unionBtn.disabled;
    intersectBtn.addEventListener("click", () => applySetOperation("intersect", "special-zone-members-intersect"));
    setOperationRow.append(setSourceSelect, unionBtn, subtractBtn, intersectBtn);
    batchBody.append(memberImportInputNode, batchActions, setOperationRow);
    batchImport.append(batchSummary, batchBody);

    const memberList = document.createElement("div");
    memberList.className = "special-zone-member-list";
    const memberSummary = document.createElement("span");
    memberSummary.textContent = translate("Members");
    const ids = document.createElement("div");
    ids.className = "special-zone-member-id-list";
    if (layer.memberFeatureIds.length) {
      const inlineIds = layer.memberFeatureIds.length > MEMBER_LIST_INLINE_LIMIT
        ? layer.memberFeatureIds.slice(0, MEMBER_LIST_INLINE_RENDER_COUNT)
        : layer.memberFeatureIds;
      inlineIds.forEach((featureId) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "special-zone-member-chip";
        chip.textContent = runtimeState.landIndex?.get(featureId)?.properties?.name || featureId;
        chip.title = translate("Remove member");
        chip.addEventListener("click", () => updateState({ action: "removeMembers", layerId: layer.id, featureIds: [featureId] }, "special-zone-members-remove"));
        ids.appendChild(chip);
      });
      if (layer.memberFeatureIds.length > MEMBER_LIST_INLINE_LIMIT) {
        const overflow = createButton(
          `${translate("View all")} (${layer.memberFeatureIds.length})`,
          "secondary-btn special-zone-member-overflow-btn"
        );
        overflow.addEventListener("click", () => openMemberDrawer(layer));
        ids.appendChild(overflow);
      }
    } else {
      const emptyMembers = document.createElement("span");
      emptyMembers.className = "muted";
      emptyMembers.textContent = translate("No members yet.");
      ids.appendChild(emptyMembers);
    }
    memberList.append(memberSummary, ids);

    const layerActions = document.createElement("div");
    layerActions.className = "special-zone-layer-actions-row";
    const duplicateBtn = createButton(translate("Duplicate layer"));
    duplicateBtn.disabled = !layer;
    duplicateBtn.addEventListener("click", () => updateState({ action: "duplicateLayer", layerId: layer.id }, "special-zone-layer-duplicate"));

    const deleteBtn = createButton(translate("Delete layer"), "danger-btn");
    deleteBtn.disabled = !layer;
    deleteBtn.addEventListener("click", () => updateState({ action: "deleteLayer", layerId: layer.id }, "special-zone-layer-delete"));

    const saveBtn = createButton(translate("Save scenario layer asset"));
    const syncScenarioSaveButtonState = () => {
      const disabledReason = runtimeState.activeScenarioId
        ? ""
        : translate("Scenario asset save needs an active scenario.");
      saveBtn.disabled = !!disabledReason;
      saveBtn.title = disabledReason;
      if (disabledReason) {
        saveBtn.removeAttribute("aria-describedby");
        saveBtn.setAttribute("aria-label", `${translate("Save scenario layer asset")}: ${disabledReason}`);
      } else {
        saveBtn.removeAttribute("aria-describedby");
        saveBtn.setAttribute("aria-label", translate("Save scenario layer asset"));
      }
    };
    syncScenarioSaveButtonState();
    saveBtn.addEventListener("click", async () => {
      const saveRequestId = saveRequestSequence + 1;
      const request = captureScenarioLayerSaveRequestState(
        runtimeState,
        saveRequestId,
      );
      if (!request.scenarioId) return;
      saveRequestSequence = saveRequestId;
      saveBtn.disabled = true;
      saveBtn.classList.add("is-loading");
      saveBtn.setAttribute("aria-busy", "true");
      if (statusNode) statusNode.textContent = translate("Saving scenario special zone layers…");
      await scenarioLayerSaveQueue.enqueue(request, {
        saveButton: saveBtn,
        syncButtonState: syncScenarioSaveButtonState,
      });
    });

    const memberActions = document.createElement("div");
    memberActions.className = "special-zone-member-actions-row";
    memberActions.append(currentTargetActionsNode, clearBtn);
    const legend = document.createElement("input");
    legend.type = "checkbox";
    legend.checked = layer.legendVisible;
    legend.addEventListener("change", () => updateState({ action: "updateLayer", layerId: layer.id, patch: { legendVisible: legend.checked } }, "special-zone-layer-legend"));
    propertyNode.appendChild(createLabel(translate("Show in legend"), legend));
    const index = state.layers.findIndex((entry) => entry.id === layer.id);
    [[-1, "Move up"], [1, "Move down"]].forEach(([delta, label]) => {
      const button = createButton(translate(label));
      button.disabled = index + delta < 0 || index + delta >= state.layers.length;
      button.addEventListener("click", () => {
        const order = state.layers.map((entry) => entry.id);
        [order[index], order[index + delta]] = [order[index + delta], order[index]];
        updateState({ action: "reorderLayers", layerIds: order }, "special-zone-layer-reorder");
      });
      layerActions.appendChild(button);
    });
    layerActions.append(duplicateBtn, deleteBtn);
    propertyNode.appendChild(layerActions);
    const storyPreview = document.createElement("details");
    storyPreview.className = "special-zone-story-preview";
    const storySummary = document.createElement("summary");
    storySummary.textContent = translate("Story preview");
    const storyList = document.createElement("div");
    storyList.className = "special-zone-story-preview-list";
    getSpecialZoneStoryPreviewSteps(state).slice(0, 12).forEach((step, index) => {
      const row = document.createElement("div");
      row.className = "special-zone-story-preview-row";
      row.textContent = `${index + 1}. ${step.title} · ${step.layerIds.length} ${translate("layers")}`;
      storyList.appendChild(row);
    });
    if (!storyList.children.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = translate("Create visible layers to preview a story sequence.");
      storyList.appendChild(empty);
    }
    storyPreview.append(storySummary, storyList);
    const advanced = document.createElement("details");
    advanced.className = "special-zone-advanced";
    const advancedTitle = document.createElement("summary");
    advancedTitle.textContent = translate("Advanced");
    advanced.append(advancedTitle, batchImport, copySelect, copyBtn, addSelectionBtn, replaceSelectionBtn, storyPreview, saveBtn);
    actionsNode.append(memberActions, memberList, advanced);
  };

  const renderSpecialZonesWorkbenchCurrentTargetUi = () => {
    if (!currentTargetActionsNode) return;
    renderCurrentTargetActions(activeLayer());
  };

  const renderSpecialZonesWorkbenchUi = () => {
    if (!ensureRoot()) return;
    // 面板可能在界面语言就绪前创建，标题和开关文字每次渲染时按当前语言刷新。
    const titleNode = root.querySelector("[data-special-zone-workbench-title]");
    if (titleNode) titleNode.textContent = translate("Special Zones");
    const toggleTextNode = overlayToggleNode?.nextElementSibling;
    if (toggleTextNode) toggleTextNode.textContent = translate("Show special zones overlay");
    const state = normalizeState();
    const layer = activeLayer();
    if (overlayToggleNode) {
      overlayToggleNode.checked = !!runtimeState.showSpecialZones;
    }
    const scenarioId = String(runtimeState.activeScenarioId || "").trim();
    const loadContext = createScenarioLayerLoadContext();
    if (
      scenarioId
      && !isScenarioLayerCacheLoadedForContext(loadContext)
      && !isScenarioLayerCacheFailedForContext(loadContext)
    ) {
      void loadScenarioSpecialZoneLayers(loadContext);
    }
    renderLayerList(state);
    const hasActiveLayer = !!layer;
    root.dataset.emptyState = String(!hasActiveLayer);
    renderPresetList(state);
    [propertyNode, actionsNode].forEach((node) => {
      node.hidden = !hasActiveLayer;
      node.style.display = hasActiveLayer ? "" : "none";
      if (!hasActiveLayer) node.replaceChildren();
    });
    registerSpecialZonesWorkbenchRuntimeHooks(runtimeState, {
      renderWorkbench: renderSpecialZonesWorkbenchUi,
      renderCurrentTarget: renderSpecialZonesWorkbenchCurrentTargetUi,
    });
    if (hasActiveLayer) {
      renderProperties(layer);
      renderActions(state, layer);
    } else {
      currentTargetActionsNode = null;
    }
    callRuntimeHook(runtimeState, "renderScenarioAuditPanelFn");
  };

  const bindSpecialZonesWorkbenchEvents = () => {
    ensureRoot();
    registerSpecialZonesWorkbenchRuntimeHooks(runtimeState, {
      renderWorkbench: renderSpecialZonesWorkbenchUi,
      renderCurrentTarget: renderSpecialZonesWorkbenchCurrentTargetUi,
    });
  };

  const focusSpecialZonesWorkbench = () => {
    if (!ensureRoot()) return;
    const activeRow = root.querySelector(".special-zone-layer-row.is-active button");
    const newLayerButton = layerListNode?.querySelector(".special-zone-workbench-section-title button");
    (activeRow || newLayerButton || root).focus?.();
  };

  const loadScenarioSpecialZoneLayers = async (context = createScenarioLayerLoadContext()) => {
    const loadContext = context && typeof context === "object" ? context : createScenarioLayerLoadContext();
    const scenarioId = String(loadContext.scenarioId || "").trim();
    const scenarioApplyRequestId = Math.max(0, Number(loadContext.scenarioApplyRequestId || 0));
    if (!scenarioId) {
      loadedScenarioLayerAssetId = "";
      loadedScenarioLayerRequestId = 0;
      failedScenarioLayerAssetId = "";
      failedScenarioLayerRequestId = 0;
      scenarioLayerLoadPromise = null;
      scenarioLayerLoadScenarioId = "";
      scenarioLayerLoadRequestId = 0;
      return null;
    }
    if (isScenarioLayerCacheLoadedForContext(loadContext)) return runtimeState.specialZoneLayers;
    if (typeof ensureActiveScenarioOptionalLayerLoaded !== "function") return null;
    if (
      scenarioLayerLoadPromise &&
      scenarioLayerLoadScenarioId === scenarioId &&
      scenarioLayerLoadRequestId === scenarioApplyRequestId
    ) {
      return scenarioLayerLoadPromise;
    }
    scenarioLayerLoadScenarioId = scenarioId;
    scenarioLayerLoadRequestId = scenarioApplyRequestId;
    scenarioLayerLoadPromise = (async () => {
      const loadOptions = { renderNow: false };
      if (scenarioApplyRequestId > 0) {
        loadOptions.scenarioApplyRequestId = scenarioApplyRequestId;
      }
      const result = await ensureActiveScenarioOptionalLayerLoaded("specialZoneLayers", loadOptions);
      if (!isScenarioLayerLoadContextCurrent(loadContext)) {
        return null;
      }
      if (!result && loadContext.declaresLayerAsset) {
        failedScenarioLayerAssetId = scenarioId;
        failedScenarioLayerRequestId = scenarioApplyRequestId;
        setLoadFailedSpecialZoneLayersState(scenarioId);
        if (statusNode) statusNode.textContent = translate("Scenario special zone layer load failed.");
        showToast?.(translate("Scenario special zone layer asset could not be loaded. Retry from the workbench."), {
          title: translate("Special zone layer load failed"),
          tone: "warning",
        });
        render?.();
        renderSpecialZonesWorkbenchUi();
        return null;
      }
      loadedScenarioLayerAssetId = scenarioId;
      loadedScenarioLayerRequestId = scenarioApplyRequestId;
      failedScenarioLayerAssetId = "";
      failedScenarioLayerRequestId = 0;
      commitSpecialZoneLayersState(
        runtimeState,
        runtimeState.specialZoneLayers,
        {
          defaultSource: "scenario",
          topologyFingerprint: resolveSpecialZoneTopologyFingerprint(runtimeState),
        },
        { markDirty: false },
      );
      const diagnostics = Array.isArray(runtimeState.specialZoneLayers?.diagnostics)
        ? runtimeState.specialZoneLayers.diagnostics
        : [];
      const mismatchDiagnostics = diagnostics.filter((entry) => entry?.code === "topology_fingerprint_mismatch");
      const diagnosticsKey = `${scenarioId}:${mismatchDiagnostics.map((entry) => `${entry.expected || ""}/${entry.actual || ""}`).join("|")}`;
      if (mismatchDiagnostics.length && diagnosticsKey !== lastDiagnosticsToastKey) {
        lastDiagnosticsToastKey = diagnosticsKey;
        showToast?.(translate("Special zone topology fingerprint mismatch is listed in the right-side project diagnostics."), {
          title: translate("Special zone topology mismatch"),
          tone: "warning",
        });
      }
      renderSpecialZonesWorkbenchUi();
      return result;
    })();
    try {
      return await scenarioLayerLoadPromise;
    } finally {
      if (
        scenarioLayerLoadScenarioId === scenarioId
        && scenarioLayerLoadRequestId === scenarioApplyRequestId
      ) {
        scenarioLayerLoadPromise = null;
        scenarioLayerLoadScenarioId = "";
        scenarioLayerLoadRequestId = 0;
      }
    }
  };

  return {
    bindSpecialZonesWorkbenchEvents,
    focusSpecialZonesWorkbench,
    loadScenarioSpecialZoneLayers,
    renderSpecialZonesWorkbenchUi,
    renderSpecialZonesWorkbenchCurrentTargetUi,
  };
}

export { createSpecialZonesWorkbenchController };
