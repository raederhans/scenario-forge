// Sidebar UI (Phase 13)
import { state, countryNames, countryPresets, PRESET_STORAGE_KEY, defaultCountryPalette } from "../core/state.js";
import { ColorManager } from "../core/color_manager.js";
import * as mapRenderer from "../core/map_renderer.js";
import { applyCountryColor, resetCountryColors } from "../core/logic.js";
import { FileManager } from "../core/file_manager.js";
import { captureHistoryState, clearHistory, pushHistoryEntry } from "../core/history_manager.js";
import { LegendManager } from "../core/legend_manager.js";
import {
  applyScenarioById,
  clearActiveScenario,
  loadScenarioAuditPayload,
  validateImportedScenarioBaseline,
} from "../core/scenario_manager.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
import {
  setFeatureOwnerCodes,
  ensureSovereigntyState,
  migrateFeatureScopedProjectDataToCurrentTopology,
} from "../core/sovereignty_manager.js";
import { markDirty } from "../core/dirty_state.js";

const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};

function normalizeCountryCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function extractCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return normalizeCountryCode(prefix);
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return normalizeCountryCode(alphaPrefix ? alphaPrefix[0] : "");
}

function getCountryCodeFromProps(props = {}, fallbackId = "") {
  return normalizeCountryCode(
    props.cntr_code ||
      props.CNTR_CODE ||
      props.iso_a2 ||
      props.ISO_A2 ||
      props.iso_a2_eh ||
      props.ISO_A2_EH ||
      props.adm0_a2 ||
      props.ADM0_A2 ||
      extractCountryCodeFromId(props.id || props.NUTS_ID || fallbackId)
  );
}

function getCountryNameFromProps(props = {}) {
  const candidate =
    props.name_en ||
    props.name ||
    props.NAME_EN ||
    props.NAME ||
    props.admin ||
    props.ADMIN ||
    "";
  return String(candidate || "").trim();
}

function collectCountryNameByCode() {
  const nameByCode = new Map();

  const primaryGeometries = state.topologyPrimary?.objects?.political?.geometries;
  if (Array.isArray(primaryGeometries)) {
    primaryGeometries.forEach((geometry) => {
      const props = geometry?.properties || {};
      const code = getCountryCodeFromProps(props, geometry?.id);
      if (!code || nameByCode.has(code)) return;
      const name = getCountryNameFromProps(props);
      if (name) {
        nameByCode.set(code, name);
      }
    });
  }

  if (Array.isArray(state.landData?.features)) {
    state.landData.features.forEach((feature) => {
      const props = feature?.properties || {};
      const code = getCountryCodeFromProps(props, feature?.id);
      if (!code || nameByCode.has(code)) return;
      const name = getCountryNameFromProps(props);
      if (name) {
        nameByCode.set(code, name);
      }
    });
  }

  return nameByCode;
}

function getDynamicCountryEntries() {
  if (state.activeScenarioId && state.scenarioCountriesByTag && typeof state.scenarioCountriesByTag === "object") {
    const scenarioEntries = Object.entries(state.scenarioCountriesByTag)
      .map(([rawCode, scenarioCountry]) => {
        const code = normalizeCountryCode(rawCode);
        if (!code) return null;
        const name = String(scenarioCountry?.display_name || state.countryNames?.[code] || code).trim() || code;
        const displayName = t(name, "geo") || name || code;
        return {
          code,
          name,
          displayName,
          featureCount: Number(scenarioCountry?.feature_count || 0),
          quality: String(scenarioCountry?.quality || "").trim(),
          baseIso2: String(scenarioCountry?.base_iso2 || "").trim().toUpperCase(),
          scenarioOnly: !!scenarioCountry?.scenario_only,
          continentId: String(scenarioCountry?.continent_id || "").trim(),
          continentLabel: String(scenarioCountry?.continent_label || "").trim(),
          subregionId: String(scenarioCountry?.subregion_id || "").trim(),
          subregionLabel: String(scenarioCountry?.subregion_label || "").trim(),
          syntheticOwner: !!scenarioCountry?.synthetic_owner,
        };
      })
      .filter(Boolean);
    return scenarioEntries.sort((a, b) => {
      if (!!a.scenarioOnly !== !!b.scenarioOnly) return a.scenarioOnly ? -1 : 1;
      if ((b.featureCount || 0) !== (a.featureCount || 0)) return (b.featureCount || 0) - (a.featureCount || 0);
      return a.displayName.localeCompare(b.displayName);
    });
  }

  const codes = new Set();

  if (state.countryToFeatureIds instanceof Map && state.countryToFeatureIds.size > 0) {
    state.countryToFeatureIds.forEach((_ids, rawCode) => {
      const code = normalizeCountryCode(rawCode);
      if (code) codes.add(code);
    });
  } else if (Array.isArray(state.landData?.features)) {
    state.landData.features.forEach((feature) => {
      const code = getCountryCodeFromProps(feature?.properties || {}, feature?.id);
      if (code) codes.add(code);
    });
  }

  if (!codes.size) {
    Object.keys(countryNames || {}).forEach((rawCode) => {
      const code = normalizeCountryCode(rawCode);
      if (code) codes.add(code);
    });
  }

  const nameByCode = collectCountryNameByCode();
  return Array.from(codes)
    .map((code) => {
      const name = nameByCode.get(code) || state.countryNames?.[code] || countryNames[code] || code;
      const displayName = t(name, "geo") || code;
      return { code, name, displayName };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function ensureCountryPaletteColor(code, fallbackIndex = 0) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return "#cccccc";

  const existing = state.countryPalette?.[normalizedCode] || defaultCountryPalette[normalizedCode];
  if (existing) {
    state.countryPalette[normalizedCode] = existing;
    return existing;
  }

  const generated =
    ColorManager.getPoliticalFallbackColor(normalizedCode, fallbackIndex) || "#cccccc";
  state.countryPalette[normalizedCode] = generated;
  return generated;
}

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Unable to load custom presets:", error);
    return {};
  }
}

function mergePresets(base, custom) {
  const merged = {};
  const mergeEntriesForCode = (rawCode, entries = []) => {
    const code = normalizeCountryCode(rawCode);
    if (!code) return;
    if (!merged[code]) merged[code] = [];
    (Array.isArray(entries) ? entries : []).forEach((preset) => {
      if (!preset || !preset.name) return;
      const idx = merged[code].findIndex((entry) => entry.name === preset.name);
      const normalizedPreset = {
        name: preset.name,
        ids: Array.isArray(preset.ids) ? [...preset.ids] : [],
      };
      if (idx >= 0) {
        merged[code][idx] = normalizedPreset;
      } else {
        merged[code].push(normalizedPreset);
      }
    });
  };

  Object.keys(base || {}).forEach((code) => {
    mergeEntriesForCode(code, base[code]);
  });
  Object.keys(custom || {}).forEach((code) => {
    const normalizedCode = normalizeCountryCode(code);
    if (!normalizedCode) return;
    if (!merged[normalizedCode]) merged[normalizedCode] = [];
    const customEntries = Array.isArray(custom[code]) ? custom[code] : [];
    customEntries.forEach((entry) => {
      if (!entry || !entry.name) return;
      const idx = merged[normalizedCode].findIndex((preset) => preset.name === entry.name);
      const ids = Array.isArray(entry.ids) ? [...entry.ids] : [];
      if (idx >= 0) {
        merged[normalizedCode][idx] = { name: entry.name, ids };
      } else {
        merged[normalizedCode].push({ name: entry.name, ids });
      }
    });
  });
  return merged;
}

function saveCustomPresets() {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.customPresets));
  } catch (error) {
    console.warn("Unable to save custom presets:", error);
  }
}

function upsertCustomPreset(code, name, ids) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return;
  if (!state.customPresets[normalizedCode]) state.customPresets[normalizedCode] = [];
  const idx = state.customPresets[normalizedCode].findIndex((preset) => preset.name === name);
  const entry = { name, ids: [...ids] };
  if (idx >= 0) {
    state.customPresets[normalizedCode][idx] = entry;
  } else {
    state.customPresets[normalizedCode].push(entry);
  }
  saveCustomPresets();
  state.presetsState = mergePresets(countryPresets, state.customPresets);
}

function initPresetState() {
  state.customPresets = loadCustomPresets();
  state.presetsState = mergePresets(countryPresets, state.customPresets);
}

function getScenarioCountryMeta(entryOrCode) {
  const rawCode = typeof entryOrCode === "object" && entryOrCode
    ? entryOrCode.code
    : entryOrCode;
  const normalizedCode = normalizeCountryCode(rawCode);
  if (!normalizedCode || !state.activeScenarioId) return null;
  const entry = state.scenarioCountriesByTag?.[normalizedCode];
  if (!entry || typeof entry !== "object") return null;
  return entry;
}

function resolveScenarioLookupCode(entryOrCode) {
  const fallbackCode = normalizeCountryCode(
    typeof entryOrCode === "object" && entryOrCode
      ? entryOrCode.code
      : entryOrCode
  );
  if (!state.activeScenarioId) {
    return fallbackCode;
  }

  const scenarioMeta = getScenarioCountryMeta(entryOrCode);
  const entry = typeof entryOrCode === "object" && entryOrCode ? entryOrCode : null;
  const candidates = [
    scenarioMeta?.lookup_iso2,
    scenarioMeta?.lookupIso2,
    entry?.lookup_iso2,
    entry?.lookupIso2,
    scenarioMeta?.base_iso2,
    scenarioMeta?.baseIso2,
    entry?.base_iso2,
    entry?.baseIso2,
    fallbackCode,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCountryCode(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return fallbackCode;
}

function resolveInspectorDataCode(entryOrCode) {
  return resolveScenarioLookupCode(entryOrCode);
}

function resolveCountryGroupingCode(entryOrCode) {
  return resolveScenarioLookupCode(entryOrCode);
}

function getHierarchyGroupsForCode(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return [];
  if (state.hierarchyGroupsByCode.size > 0) {
    return state.hierarchyGroupsByCode.get(normalizedCode) || [];
  }
  if (!state.hierarchyData || !state.hierarchyData.groups) return [];
  const labels = state.hierarchyData.labels || {};
  const groups = [];
  Object.entries(state.hierarchyData.groups).forEach(([groupId, children]) => {
    if (!groupId.startsWith(`${normalizedCode}_`)) return;
    const label = labels[groupId] || groupId.replace(`${normalizedCode}_`, "").replace(/_/g, " ");
    groups.push({
      id: groupId,
      label,
      children: Array.isArray(children) ? children : [],
    });
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function getCountryGroupingMeta(entryOrCode) {
  const normalizedCode = resolveCountryGroupingCode(entryOrCode);
  if (!normalizedCode || !(state.countryGroupMetaByCode instanceof Map)) return null;
  return state.countryGroupMetaByCode.get(normalizedCode) || null;
}

function getPriorityCountryOrderMap() {
  const priorityByContinent = state.countryGroupsData?.priority_by_continent || {};
  const priorityOrderMap = new Map();

  Object.entries(priorityByContinent).forEach(([continentId, rawCodes]) => {
    const continentOrder = new Map();
    (Array.isArray(rawCodes) ? rawCodes : []).forEach((rawCode, index) => {
      const code = normalizeCountryCode(rawCode);
      if (code && !continentOrder.has(code)) {
        continentOrder.set(code, index);
      }
    });
    priorityOrderMap.set(continentId, continentOrder);
  });

  return priorityOrderMap;
}

function getCountryPriorityRank(countryState, priorityOrderMap = getPriorityCountryOrderMap()) {
  const priorityCode = normalizeCountryCode(
    countryState?.groupingCode || countryState?.lookupIso2 || countryState?.code
  );
  if (!countryState?.continentId || !priorityCode) return Number.MAX_SAFE_INTEGER;
  const continentOrder = priorityOrderMap.get(countryState.continentId);
  if (!continentOrder || !continentOrder.has(priorityCode)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return continentOrder.get(priorityCode);
}

function sortCountriesWithinContinent(entries, priorityOrderMap = getPriorityCountryOrderMap()) {
  return [...entries].sort((a, b) => {
    const priorityDelta =
      getCountryPriorityRank(a, priorityOrderMap) - getCountryPriorityRank(b, priorityOrderMap);
    if (priorityDelta !== 0) return priorityDelta;
    return a.displayName.localeCompare(b.displayName);
  });
}

function buildCountryColorTree(entries) {
  const tree = new Map();
  const continentOrder = new Map();
  const configuredContinents = Array.isArray(state.countryGroupsData?.continents)
    ? state.countryGroupsData.continents
    : [];
  const priorityOrderMap = getPriorityCountryOrderMap();

  configuredContinents.forEach((continent, continentIndex) => {
    const continentId = String(continent?.id || "").trim();
    if (!continentId) return;
    continentOrder.set(continentId, continentIndex);
  });

  entries.forEach((entry) => {
    const meta = getCountryGroupingMeta(entry.code);
    const continentId = meta?.continentId || "continent_other";
    const continentLabel = meta?.continentLabel || "Other";

    if (!tree.has(continentId)) {
      tree.set(continentId, {
        id: continentId,
        label: continentLabel,
        displayLabel: t(continentLabel, "geo") || continentLabel,
        sortIndex: continentOrder.has(continentId) ? continentOrder.get(continentId) : Number.MAX_SAFE_INTEGER,
        countries: [],
      });
    }

    tree.get(continentId).countries.push(entry);
  });

  return Array.from(tree.values())
    .map((continentNode) => ({
      ...continentNode,
      countries: sortCountriesWithinContinent(continentNode.countries, priorityOrderMap),
    }))
    .sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      return a.displayLabel.localeCompare(b.displayLabel);
    });
}

function getDefaultExpandedContinentId(groupedEntries = []) {
  const selectedCode = normalizeCountryCode(state.selectedInspectorCountryCode);
  const selectedContinentId = getCountryGroupingMeta(selectedCode)?.continentId;
  if (selectedContinentId) return selectedContinentId;

  const activeCode = normalizeCountryCode(state.activeSovereignCode);
  const activeContinentId = getCountryGroupingMeta(activeCode)?.continentId;
  if (activeContinentId) return activeContinentId;

  const europeNode = groupedEntries.find((entry) => entry.id === "continent_europe");
  if (europeNode) return europeNode.id;

  return groupedEntries[0]?.id || "";
}

function ensureInitialInspectorExpansion(groupedEntries = []) {
  if (state.inspectorExpansionInitialized || !groupedEntries.length) return;
  if (!(state.expandedInspectorContinents instanceof Set)) {
    state.expandedInspectorContinents = new Set();
  }

  if (state.expandedInspectorContinents.size > 0) {
    state.inspectorExpansionInitialized = true;
    return;
  }

  const defaultContinentId = getDefaultExpandedContinentId(groupedEntries);
  if (defaultContinentId) {
    state.expandedInspectorContinents.add(`continent::${defaultContinentId}`);
  }
  state.inspectorExpansionInitialized = true;
}

function applyHierarchyGroup(group, color, render) {
  if (!group || !group.children) return;
  const targetIds = Array.isArray(group.children)
    ? Array.from(new Set(group.children.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  if (!targetIds.length) return;
  if (String(state.paintMode || "visual") === "sovereignty") {
    if (!state.activeSovereignCode) return;
    const before = captureHistoryState({
      sovereigntyFeatureIds: targetIds,
    });
    const changed = setFeatureOwnerCodes(targetIds, state.activeSovereignCode);
    mapRenderer.refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
    if (changed) {
      mapRenderer.scheduleDynamicBorderRecompute("sidebar-hierarchy-batch", 90);
      pushHistoryEntry({
        kind: "hierarchy-apply-sovereignty",
        before,
        after: captureHistoryState({
          sovereigntyFeatureIds: targetIds,
        }),
        meta: {
          affectsSovereignty: true,
        },
      });
    }
    if (render) render();
    return;
  }
  const colorToApply = color || state.selectedColor;
  const before = captureHistoryState({
    featureIds: targetIds,
  });
  targetIds.forEach((id) => {
    state.visualOverrides[id] = colorToApply;
    state.featureOverrides[id] = colorToApply;
  });
  mapRenderer.refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
  if (render) render();
  addRecentColor(colorToApply);
  markDirty("hierarchy-apply-color");
  pushHistoryEntry({
    kind: "hierarchy-apply-color",
    before,
    after: captureHistoryState({
      featureIds: targetIds,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });
}

function addRecentColor(color) {
  if (!color) return;
  state.recentColors = state.recentColors.filter((value) => value !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 10) {
    state.recentColors = state.recentColors.slice(0, 10);
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
}

function applyPreset(countryCode, presetIndex, color, render) {
  const presetLookupCode = resolveScenarioLookupCode(countryCode);
  const presets = state.presetsState[presetLookupCode];
  if (!presets || !presets[presetIndex]) {
    console.warn(`Preset not found: ${presetLookupCode}[${presetIndex}]`);
    return;
  }

  const preset = presets[presetIndex];
  const colorToApply = color || state.selectedColor;
  const targetIds = Array.isArray(preset.ids)
    ? Array.from(new Set(preset.ids.map((id) => String(id || "").trim()).filter(Boolean)))
    : [];
  if (!targetIds.length) return;

  if (String(state.paintMode || "visual") === "sovereignty") {
    if (!state.activeSovereignCode) return;
    const before = captureHistoryState({
      sovereigntyFeatureIds: targetIds,
    });
    const changed = setFeatureOwnerCodes(targetIds, state.activeSovereignCode);
    mapRenderer.refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
    if (changed) {
      mapRenderer.scheduleDynamicBorderRecompute("sidebar-preset-batch", 90);
      markDirty("preset-apply-sovereignty");
      pushHistoryEntry({
        kind: "preset-apply-sovereignty",
        before,
        after: captureHistoryState({
          sovereigntyFeatureIds: targetIds,
        }),
        meta: {
          affectsSovereignty: true,
        },
      });
    }
    if (render) render();
    return;
  }

  const before = captureHistoryState({
    featureIds: targetIds,
  });
  targetIds.forEach((id) => {
    state.visualOverrides[id] = colorToApply;
    state.featureOverrides[id] = colorToApply;
  });

  mapRenderer.refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
  if (render) render();
  markDirty("preset-apply-color");

  if (!state.recentColors.includes(colorToApply)) {
    state.recentColors.unshift(colorToApply);
    if (state.recentColors.length > 10) state.recentColors.pop();
    if (typeof state.updateRecentUI === "function") state.updateRecentUI();
  }

  pushHistoryEntry({
    kind: "preset-apply-color",
    before,
    after: captureHistoryState({
      featureIds: targetIds,
    }),
    meta: {
      affectsSovereignty: false,
    },
  });

  console.log(`Applied preset "${preset.name}" with ${preset.ids.length} regions`);
}

function startPresetEdit(code, presetIndex, render) {
  const presetLookupCode = resolveScenarioLookupCode(code);
  const presets = state.presetsState[presetLookupCode] || [];
  const preset = presets[presetIndex];
  if (!preset) return;
  state.isEditingPreset = true;
  state.editingPresetRef = { code: presetLookupCode, presetIndex };
  state.editingPresetIds = new Set(preset.ids || []);
  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
  if (render) render();
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
}

function stopPresetEdit(render) {
  state.isEditingPreset = false;
  state.editingPresetRef = null;
  state.editingPresetIds = new Set();
  if (typeof state.updateToolUIFn === "function") {
    state.updateToolUIFn();
  }
  if (render) render();
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
}

function togglePresetRegion(id, render) {
  if (!state.isEditingPreset || !id) return;
  if (state.editingPresetIds.has(id)) {
    state.editingPresetIds.delete(id);
  } else {
    state.editingPresetIds.add(id);
  }
  if (render) render();
}

async function copyPresetIds(ids) {
  const payload = JSON.stringify(ids || [], null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    console.log("Preset IDs copied to clipboard.");
    showToast(t("Preset IDs copied to clipboard.", "ui"), {
      title: t("Copied", "ui"),
      tone: "success",
    });
  } catch (error) {
    console.warn("Clipboard unavailable, logging IDs instead.", error);
    console.log(payload);
    showToast(t("Clipboard unavailable. Preset IDs were logged to the console.", "ui"), {
      title: t("Clipboard unavailable", "ui"),
      tone: "warning",
      duration: 4200,
    });
  }
}

function initSidebar({ render } = {}) {
  const list = document.getElementById("countryList");
  if (!list) return;
  const presetTree = document.getElementById("presetTree");
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetCountryColors");
  const sidebar = document.getElementById("rightSidebar");
  const projectLegendStack = document.getElementById("projectLegendStack");
  const diagnosticStack = document.getElementById("diagnosticStack");

  let projectSection = document.getElementById("projectManagement");
  if (!projectSection && projectLegendStack) {
    projectSection = document.createElement("div");
    projectSection.id = "projectManagement";
    projectSection.className = "inspector-tool-card";

    const title = document.createElement("div");
    title.id = "lblProjectManagement";
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Project Management", "ui");

    const hint = document.createElement("p");
    hint.id = "lblProjectHint";
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Save or load your map state as a project file.", "ui");

    const actions = document.createElement("div");
    actions.className = "mt-3 flex flex-col gap-2";

    const downloadBtn = document.createElement("button");
    downloadBtn.id = "downloadProjectBtn";
    downloadBtn.type = "button";
    downloadBtn.className = "btn-primary";
    downloadBtn.textContent = t("Download Project", "ui");

    const uploadBtn = document.createElement("button");
    uploadBtn.id = "uploadProjectBtn";
    uploadBtn.type = "button";
    uploadBtn.className = "btn-secondary";
    uploadBtn.textContent = t("Load Project", "ui");

    const fileInput = document.createElement("input");
    fileInput.id = "projectFileInput";
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.className = "hidden";

    const fileMeta = document.createElement("div");
    fileMeta.id = "projectFileMeta";
    fileMeta.className = "project-file-meta";

    const fileMetaLabel = document.createElement("span");
    fileMetaLabel.id = "lblProjectFile";
    fileMetaLabel.className = "section-header";
    fileMetaLabel.textContent = t("Selected File", "ui");

    const fileName = document.createElement("span");
    fileName.id = "projectFileName";
    fileName.className = "project-file-name";
    fileName.textContent = t("No file selected", "ui");

    fileMeta.appendChild(fileMetaLabel);
    fileMeta.appendChild(fileName);

    actions.appendChild(downloadBtn);
    actions.appendChild(uploadBtn);
    actions.appendChild(fileMeta);
    actions.appendChild(fileInput);

    projectSection.appendChild(title);
    projectSection.appendChild(hint);
    projectSection.appendChild(actions);
    projectLegendStack.appendChild(projectSection);
  }

  let legendSection = document.getElementById("legendEditor");
  if (!legendSection && projectLegendStack) {
    legendSection = document.createElement("div");
    legendSection.id = "legendEditor";
    legendSection.className = "inspector-tool-card";

    const title = document.createElement("div");
    title.id = "lblLegendEditor";
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Legend Editor", "ui");

    const hint = document.createElement("p");
    hint.id = "lblLegendHint";
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Paint regions to generate a legend.", "ui");

    const list = document.createElement("div");
    list.id = "legendEditorList";
    list.className = "mt-3";

    legendSection.appendChild(title);
    legendSection.appendChild(hint);
    legendSection.appendChild(list);
    projectLegendStack.appendChild(legendSection);
  }

  let scenarioAuditSection = document.getElementById("scenarioAuditPanel");
  if (!scenarioAuditSection && diagnosticStack) {
    scenarioAuditSection = document.createElement("div");
    scenarioAuditSection.id = "scenarioAuditPanel";
    scenarioAuditSection.className = "inspector-tool-card";
    diagnosticStack.appendChild(scenarioAuditSection);
  }

  let debugViewSection = document.getElementById("debugViewControl");
  if (!debugViewSection && diagnosticStack) {
    debugViewSection = document.createElement("div");
    debugViewSection.id = "debugViewControl";
    debugViewSection.className = "inspector-tool-card sidebar-tool-card-debug";

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Debug Mode", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t("Use diagnostics to inspect geometry and artifact behavior.", "ui");

    const group = document.createElement("div");
    group.className = "control-group mt-3";

    const label = document.createElement("label");
    label.setAttribute("for", "debug-mode-select");
    label.textContent = t("View", "ui");

    const select = document.createElement("select");
    select.id = "debug-mode-select";
    select.className = "select-input debug-select";

    [
      ["PROD", "Normal View"],
      ["GEOMETRY", "1. Geometry Check (Pink/Green)"],
      ["ARTIFACTS", "2. Artifact Hunter (Red Giants)"],
      ["ISLANDS", "3. Island Detector (Orange)"],
      ["ID_HASH", "4. ID Stability"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.id = `debugOption${value}`;
      option.textContent = t(label, "ui");
      select.appendChild(option);
    });

    group.appendChild(label);
    group.appendChild(select);
    debugViewSection.appendChild(title);
    debugViewSection.appendChild(hint);
    debugViewSection.appendChild(group);
    diagnosticStack.appendChild(debugViewSection);
  }

  const downloadProjectBtn = document.getElementById("downloadProjectBtn");
  const uploadProjectBtn = document.getElementById("uploadProjectBtn");
  const projectFileInput = document.getElementById("projectFileInput");
  const projectFileName = document.getElementById("projectFileName");
  const legendList = document.getElementById("legendEditorList");
  const debugModeSelect = document.getElementById("debug-mode-select");
  const countryInspectorEmpty = document.getElementById("countryInspectorEmpty");
  const countryInspectorSelected = document.getElementById("countryInspectorSelected");
  const countryInspectorTitle = document.getElementById("countryInspectorTitle");
  const countryInspectorMeta = document.getElementById("countryInspectorMeta");
  const countryInspectorSwatch = document.getElementById("countryInspectorSwatch");
  const countryInspectorSetActive = document.getElementById("countryInspectorSetActive");
  const countryInspectorColorInput = document.getElementById("countryInspectorColorInput");
  const countryInspectorGroups = document.getElementById("countryInspectorGroups");
  const countryInspectorPresets = document.getElementById("countryInspectorPresets");

  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }

  if (!(state.expandedInspectorContinents instanceof Set)) {
    state.expandedInspectorContinents = new Set();
  }
  if (typeof state.selectedInspectorCountryCode !== "string") {
    state.selectedInspectorCountryCode = "";
  }
  if (typeof state.inspectorExpansionInitialized !== "boolean") {
    state.inspectorExpansionInitialized = false;
  }

  let latestCountryStatesByCode = new Map();
  const getSearchTerm = () => (searchInput?.value || "").trim().toLowerCase();
  const matchesTerm = (value, term) => String(value || "").toLowerCase().includes(term);

  const createCountryInspectorState = (entry, fallbackIndex = 0) => {
    const scenarioMeta = getScenarioCountryMeta(entry.code) || entry || {};
    const lookupIso2 = resolveScenarioLookupCode(entry);
    const inspectorDataCode = resolveInspectorDataCode(entry);
    const presetLookupCode = resolveScenarioLookupCode(entry);
    const groupLookupCode = resolveCountryGroupingCode(entry);
    const groupingMeta = getCountryGroupingMeta(entry) || {};
    const continentLabel =
      String(scenarioMeta.continent_label || scenarioMeta.continentLabel || groupingMeta.continentLabel || "Other");
    const subregionLabel =
      String(scenarioMeta.subregion_label || scenarioMeta.subregionLabel || groupingMeta.subregionLabel || "Unclassified");
    return {
      ...entry,
      fallbackIndex,
      lookupIso2,
      inspectorDataCode,
      presetLookupCode,
      groupingCode: groupLookupCode,
      presets: state.presetsState[presetLookupCode] || [],
      hierarchyGroups: getHierarchyGroupsForCode(groupLookupCode),
      continentId:
        String(scenarioMeta.continent_id || scenarioMeta.continentId || groupingMeta.continentId || "continent_other"),
      continentLabel,
      continentDisplayLabel: t(continentLabel, "geo") || continentLabel,
      subregionId:
        String(scenarioMeta.subregion_id || scenarioMeta.subregionId || groupingMeta.subregionId || "subregion_unclassified"),
      subregionLabel,
      subregionDisplayLabel: t(subregionLabel, "geo") || subregionLabel,
      quality: String(scenarioMeta.quality || entry.quality || "").trim(),
      featureCount: Number(scenarioMeta.feature_count || entry.featureCount || 0),
      baseIso2: String(scenarioMeta.base_iso2 || entry.baseIso2 || "").trim().toUpperCase(),
      scenarioOnly: !!(scenarioMeta.scenario_only ?? entry.scenarioOnly),
      syntheticOwner: !!(scenarioMeta.synthetic_owner ?? entry.syntheticOwner),
    };
  };

  const getResolvedCountryColor = (countryState) => {
    if (!countryState?.code) return "#cccccc";
    const fallbackColor = ensureCountryPaletteColor(countryState.code, countryState.fallbackIndex || 0);
    return (
      state.sovereignBaseColors?.[countryState.code] ||
      state.countryBaseColors?.[countryState.code] ||
      state.countryPalette?.[countryState.code] ||
      fallbackColor
    );
  };

  const createEmptyNote = (text) => {
    const note = document.createElement("div");
    note.className = "inspector-empty-note";
    note.textContent = text;
    return note;
  };

  const createInspectorActionButton = (label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inspector-item-btn";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };

  const resolveAuditNumber = (...values) => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return 0;
  };

  const getScenarioAuditSummary = (auditPayload) => (
    auditPayload?.summary && typeof auditPayload.summary === "object" ? auditPayload.summary : {}
  );

  const getScenarioAuditBlockerCount = (summary = {}) => {
    const flattened = Number(summary.blocker_count);
    if (Number.isFinite(flattened)) {
      return flattened;
    }
    return (
      Number(summary.geometry_blocker_count || 0)
      + Number(summary.topology_blocker_count || 0)
      + Number(summary.scenario_rule_blocker_count || 0)
    );
  };

  const createAuditValueRow = (label, value) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-3";

    const left = document.createElement("span");
    left.className = "inspector-mini-label";
    left.textContent = label;

    const right = document.createElement("span");
    right.className = "country-row-title";
    right.textContent = String(value);

    row.appendChild(left);
    row.appendChild(right);
    return row;
  };

  const createAuditList = (items = [], renderItem) => {
    const list = document.createElement("div");
    list.className = "mt-2 flex flex-col gap-2";
    if (!items.length) {
      list.appendChild(createEmptyNote(t("None", "ui")));
      return list;
    }
    items.forEach((item, index) => {
      const node = renderItem(item, index);
      if (node) {
        list.appendChild(node);
      }
    });
    return list;
  };

  const renderScenarioAuditSummary = (auditPayload, manifestSummary = {}) => {
    const summary = getScenarioAuditSummary(auditPayload);
    const container = document.createElement("div");
    container.className = "mt-3 flex flex-col gap-2";
    container.appendChild(createAuditValueRow(
      t("Owners", "ui"),
      resolveAuditNumber(summary.owner_count, manifestSummary.owner_count)
    ));
    container.appendChild(createAuditValueRow(
      t("Features", "ui"),
      resolveAuditNumber(summary.feature_count, manifestSummary.feature_count)
    ));
    container.appendChild(createAuditValueRow(
      t("Approximate", "ui"),
      resolveAuditNumber(
        summary.approximate_count,
        summary.quality_counts?.approx_existing_geometry,
        manifestSummary.approximate_count,
        manifestSummary.quality_counts?.approx_existing_geometry
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Manual-reviewed", "ui"),
      resolveAuditNumber(
        summary.manual_reviewed_feature_count,
        summary.quality_counts?.manual_reviewed,
        manifestSummary.manual_reviewed_feature_count,
        manifestSummary.quality_counts?.manual_reviewed
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Synthetic", "ui"),
      resolveAuditNumber(
        summary.synthetic_count,
        summary.synthetic_owner_feature_count,
        manifestSummary.synthetic_count,
        manifestSummary.synthetic_owner_feature_count
      )
    ));
    container.appendChild(createAuditValueRow(
      t("Blockers", "ui"),
      getScenarioAuditBlockerCount(Object.keys(summary).length ? summary : manifestSummary)
    ));
    container.appendChild(createAuditValueRow(
      t("Critical checks", "ui"),
      resolveAuditNumber(
        summary.critical_region_check_count,
        summary.manual_reviewed_region_count,
        manifestSummary.critical_region_check_count,
        manifestSummary.manual_reviewed_region_count
      )
    ));
    return container;
  };

  const renderScenarioCriticalChecks = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Critical checks", "ui");
    section.appendChild(title);

    const criticalRegions = Array.isArray(auditPayload?.critical_regions)
      ? auditPayload.critical_regions
      : [];
    const regionChecks = auditPayload?.region_checks && typeof auditPayload.region_checks === "object"
      ? auditPayload.region_checks
      : {};

    const items = criticalRegions.length
      ? criticalRegions.map((item) => ({
        regionId: String(item?.region_id || "").trim(),
        status: String(item?.status || regionChecks?.[item?.region_id]?.status || "unknown").trim(),
        notes: String(regionChecks?.[item?.region_id]?.notes || "").trim(),
      }))
      : Object.entries(regionChecks).map(([regionId, payload]) => ({
        regionId: String(regionId || "").trim(),
        status: String(payload?.status || "unknown").trim(),
        notes: String(payload?.notes || "").trim(),
      }));

    section.appendChild(createAuditList(items, ({ regionId, status, notes }) => {
      if (notes) {
        const details = document.createElement("details");
        details.className = "inspector-preset-details";

        const summary = document.createElement("summary");
        summary.className = "inspector-accordion-btn";
        summary.textContent = `${regionId} · ${status}`;

        const body = document.createElement("div");
        body.className = "preset-country-body";
        body.textContent = notes;

        details.appendChild(summary);
        details.appendChild(body);
        return details;
      }

      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-3";
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "body-text",
        textContent: regionId,
      }));
      row.appendChild(Object.assign(document.createElement("span"), {
        className: "inspector-mini-label",
        textContent: status,
      }));
      return row;
    }));

    return section;
  };

  const renderScenarioAuditBlockers = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4 flex flex-col gap-4";

    const topologyWrapper = document.createElement("div");
    const topologyTitle = document.createElement("div");
    topologyTitle.className = "section-header-block";
    topologyTitle.textContent = t("Topology blockers", "ui");
    topologyWrapper.appendChild(topologyTitle);
    topologyWrapper.appendChild(createAuditList(
      Array.isArray(auditPayload?.topology_blockers) ? auditPayload.topology_blockers : [],
      (item) => {
        const row = document.createElement("div");
        row.className = "flex flex-col gap-1";
        row.appendChild(Object.assign(document.createElement("span"), {
          className: "body-text",
          textContent: String(item?.blocker_id || item?.id || "unknown"),
        }));
        if (item?.notes) {
          row.appendChild(Object.assign(document.createElement("span"), {
            className: "inspector-mini-label",
            textContent: String(item.notes),
          }));
        }
        return row;
      }
    ));

    const ruleWrapper = document.createElement("div");
    const ruleTitle = document.createElement("div");
    ruleTitle.className = "section-header-block";
    ruleTitle.textContent = t("Scenario rule blockers", "ui");
    ruleWrapper.appendChild(ruleTitle);
    ruleWrapper.appendChild(createAuditList(
      Array.isArray(auditPayload?.scenario_rule_blockers) ? auditPayload.scenario_rule_blockers : [],
      (item) => {
        const row = document.createElement("div");
        row.className = "flex flex-col gap-1";
        row.appendChild(Object.assign(document.createElement("span"), {
          className: "body-text",
          textContent: String(item?.rule_id || item?.blocker_id || "unknown"),
        }));
        if (item?.notes) {
          row.appendChild(Object.assign(document.createElement("span"), {
            className: "inspector-mini-label",
            textContent: String(item.notes),
          }));
        }
        return row;
      }
    ));

    section.appendChild(topologyWrapper);
    section.appendChild(ruleWrapper);
    return section;
  };

  const renderScenarioAuditTopologySummary = (auditPayload) => {
    const section = document.createElement("div");
    section.className = "mt-4";

    const title = document.createElement("div");
    title.className = "section-header-block";
    title.textContent = t("Topology Summary", "ui");
    section.appendChild(title);

    const belarusHybrid = auditPayload?.topology_summaries?.belarus_hybrid || {};
    const rows = [
      [t("Total features", "ui"), belarusHybrid.total_feature_count],
      [t("Border rayons kept", "ui"), belarusHybrid.border_rayons_kept],
      [t("Historical composites built", "ui"), belarusHybrid.historical_composites_built],
      [t("Interior groups built", "ui"), belarusHybrid.interior_groups_built],
    ].filter(([, value]) => Number.isFinite(Number(value)));

    if (!rows.length) {
      section.appendChild(createEmptyNote(t("None", "ui")));
      return section;
    }

    const subtitle = document.createElement("div");
    subtitle.className = "inspector-mini-label mt-2";
    subtitle.textContent = t("Belarus hybrid", "ui");
    section.appendChild(subtitle);

    const list = document.createElement("div");
    list.className = "mt-2 flex flex-col gap-2";
    rows.forEach(([label, value]) => {
      list.appendChild(createAuditValueRow(label, value));
    });
    section.appendChild(list);
    return section;
  };

  const renderScenarioAuditPanel = () => {
    if (!scenarioAuditSection) return;

    const activeScenarioId = String(state.activeScenarioId || "").trim();
    const auditUi = state.scenarioAuditUi || {};
    const activeAuditLoaded =
      !!activeScenarioId &&
      auditUi.loadedForScenarioId === activeScenarioId &&
      state.scenarioAudit &&
      typeof state.scenarioAudit === "object";
    const manifestSummary =
      state.activeScenarioManifest?.summary && typeof state.activeScenarioManifest.summary === "object"
        ? state.activeScenarioManifest.summary
        : {};

    scenarioAuditSection.replaceChildren();

    const title = document.createElement("div");
    title.className = "section-header sidebar-tool-title";
    title.textContent = t("Scenario Audit", "ui");

    const hint = document.createElement("p");
    hint.className = "sidebar-tool-hint";
    hint.textContent = t(
      "Inspect critical checks, blockers, and source quality for the active scenario.",
      "ui"
    );

    scenarioAuditSection.appendChild(title);
    scenarioAuditSection.appendChild(hint);

    if (!activeScenarioId) {
      scenarioAuditSection.appendChild(createEmptyNote(t("No scenario active", "ui")));
      return;
    }

    const actions = document.createElement("div");
    actions.className = "mt-3 flex flex-col gap-2";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = activeAuditLoaded ? "btn-secondary" : "btn-primary";
    loadButton.disabled = !!auditUi.loading;
    loadButton.textContent = t(activeAuditLoaded ? "Reload Audit" : "Load Audit Details", "ui");
    loadButton.addEventListener("click", async () => {
      try {
        await loadScenarioAuditPayload(activeScenarioId, {
          forceReload: activeAuditLoaded,
        });
      } catch (error) {
        console.error("Failed to load scenario audit:", error);
      }
    });
    actions.appendChild(loadButton);

    if (!activeAuditLoaded) {
      if (auditUi.loading) {
        scenarioAuditSection.appendChild(createEmptyNote(t("Loading audit details…", "ui")));
      } else if (auditUi.errorMessage) {
        const errorNote = createEmptyNote(t("Unable to load audit details", "ui"));
        scenarioAuditSection.appendChild(errorNote);

        const detail = document.createElement("div");
        detail.className = "inspector-mini-label mt-2";
        detail.textContent = auditUi.errorMessage;
        scenarioAuditSection.appendChild(detail);
      }
      scenarioAuditSection.appendChild(actions);
      return;
    }

    if (auditUi.loading) {
      scenarioAuditSection.appendChild(createEmptyNote(t("Loading audit details…", "ui")));
    } else if (auditUi.errorMessage) {
      const errorDetail = document.createElement("div");
      errorDetail.className = "inspector-mini-label mt-3";
      errorDetail.textContent = `${t("Unable to load audit details", "ui")}: ${auditUi.errorMessage}`;
      scenarioAuditSection.appendChild(errorDetail);
    }

    scenarioAuditSection.appendChild(renderScenarioAuditSummary(state.scenarioAudit, manifestSummary));
    scenarioAuditSection.appendChild(renderScenarioCriticalChecks(state.scenarioAudit));
    scenarioAuditSection.appendChild(renderScenarioAuditBlockers(state.scenarioAudit));
    scenarioAuditSection.appendChild(renderScenarioAuditTopologySummary(state.scenarioAudit));
    scenarioAuditSection.appendChild(actions);
  };

  const ensureSelectedInspectorCountry = () => {
    const normalized = normalizeCountryCode(state.selectedInspectorCountryCode);
    if (!normalized) {
      state.selectedInspectorCountryCode = "";
      state.inspectorHighlightCountryCode = "";
      return "";
    }
    if (!latestCountryStatesByCode.has(normalized)) {
      state.selectedInspectorCountryCode = "";
      state.inspectorHighlightCountryCode = "";
      return "";
    }
    state.selectedInspectorCountryCode = normalized;
    return normalized;
  };

  const selectInspectorCountry = (code) => {
    const normalized = normalizeCountryCode(code);
    if (!normalized) return;
    const countryState = latestCountryStatesByCode.get(normalized);
    if (countryState?.continentId) {
      state.expandedInspectorContinents.add(`continent::${countryState.continentId}`);
    }
    state.selectedInspectorCountryCode = normalized;
    state.inspectorHighlightCountryCode = normalized;
    if (typeof state.renderNowFn === "function") {
      state.renderNowFn();
    }
    renderList();
  };

  const getCountrySearchRank = (countryState, term, upperTerm) => {
    const code = String(countryState.code || "").toUpperCase();
    const name = String(countryState.name || "").toLowerCase();
    const displayName = String(countryState.displayName || "").toLowerCase();
    const subregion = String(countryState.subregionDisplayLabel || "").toLowerCase();
    const continent = String(countryState.continentDisplayLabel || "").toLowerCase();
    const countryMatch =
      code.includes(upperTerm) ||
      matchesTerm(name, term) ||
      matchesTerm(displayName, term) ||
      matchesTerm(subregion, term) ||
      matchesTerm(continent, term);

    if (!countryMatch) {
      return null;
    }
    if (code === upperTerm) return 0;
    if (displayName === term || name === term) return 1;
    if (displayName.startsWith(term) || name.startsWith(term)) return 2;
    if (code.startsWith(upperTerm)) return 3;
    if (subregion.startsWith(term) || continent.startsWith(term)) return 4;
    return 5;
  };

  const renderCountrySelectRow = (parent, countryState) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "country-select-row";
    const isSelected = state.selectedInspectorCountryCode === countryState.code;
    row.classList.toggle("is-selected", isSelected);
    row.setAttribute("aria-pressed", String(isSelected));
    row.addEventListener("click", () => {
      selectInspectorCountry(countryState.code);
    });

    const main = document.createElement("div");
    main.className = "country-select-main";

    const title = document.createElement("div");
    title.className = "country-select-title";
    title.textContent = `${countryState.displayName} (${countryState.code})`;

    const meta = document.createElement("div");
    meta.className = "country-select-meta";
    meta.textContent = countryState.subregionDisplayLabel;

    const side = document.createElement("div");
    side.className = "country-select-side";

    if (state.activeSovereignCode === countryState.code) {
      const badge = document.createElement("span");
      badge.className = "country-active-badge";
      badge.textContent = t("Active", "ui");
      side.appendChild(badge);
    }

    if (countryState.scenarioOnly) {
      const badge = document.createElement("span");
      badge.className = "country-scenario-badge";
      badge.textContent = t("Scenario", "ui");
      side.appendChild(badge);
    }

    const swatch = document.createElement("span");
    swatch.className = "country-select-swatch";
    swatch.style.backgroundColor = getResolvedCountryColor(countryState);
    side.appendChild(swatch);

    main.appendChild(title);
    main.appendChild(meta);
    row.appendChild(main);
    row.appendChild(side);
    parent.appendChild(row);
  };

  const renderCountryInspectorDetail = () => {
    if (!countryInspectorEmpty || !countryInspectorSelected) return;

    const selectedCode = ensureSelectedInspectorCountry();
    const countryState = selectedCode ? latestCountryStatesByCode.get(selectedCode) : null;
    const isEmpty = !countryState;

    countryInspectorEmpty.classList.toggle("hidden", !isEmpty);
    countryInspectorSelected.classList.toggle("hidden", isEmpty);

    if (!countryState) {
      if (countryInspectorColorInput) {
        countryInspectorColorInput.disabled = true;
      }
      if (countryInspectorSetActive) {
        countryInspectorSetActive.disabled = true;
        countryInspectorSetActive.classList.remove("is-active");
      }
      return;
    }

    const resolvedColor = getResolvedCountryColor(countryState);
    if (countryInspectorTitle) {
      countryInspectorTitle.textContent = `${countryState.displayName} (${countryState.code})`;
    }
    if (countryInspectorMeta) {
      const metaBits = [countryState.subregionDisplayLabel, countryState.continentDisplayLabel];
      if (state.activeScenarioId) {
        if (countryState.baseIso2) {
          metaBits.push(`${t("Base ISO", "ui")}: ${countryState.baseIso2}`);
        }
        if (countryState.quality) {
          metaBits.push(countryState.quality);
        }
        if (countryState.featureCount) {
          metaBits.push(`${countryState.featureCount} ${t("features", "ui")}`);
        }
      }
      countryInspectorMeta.textContent = metaBits.filter(Boolean).join(" · ");
    }
    if (countryInspectorSwatch) {
      countryInspectorSwatch.style.backgroundColor = resolvedColor;
    }
    if (countryInspectorColorInput) {
      countryInspectorColorInput.disabled = false;
      countryInspectorColorInput.value = resolvedColor;
    }
    if (countryInspectorSetActive) {
      const isActive = state.activeSovereignCode === countryState.code;
      countryInspectorSetActive.disabled = isActive;
      countryInspectorSetActive.classList.toggle("is-active", isActive);
      countryInspectorSetActive.textContent = isActive ? t("Active", "ui") : t("Set Active", "ui");
      countryInspectorSetActive.setAttribute("aria-pressed", String(isActive));
    }

    if (countryInspectorGroups) {
      countryInspectorGroups.replaceChildren();
      if (countryState.hierarchyGroups.length > 0) {
        countryState.hierarchyGroups.forEach((group) => {
          const button = createInspectorActionButton(
            t(group.label, "geo") || group.label,
            () => applyHierarchyGroup(group, state.selectedColor, render)
          );
          countryInspectorGroups.appendChild(button);
        });
      } else {
        countryInspectorGroups.appendChild(createEmptyNote(t("No country groups", "ui")));
      }
    }

    if (countryInspectorPresets) {
      countryInspectorPresets.replaceChildren();
      if (countryState.presets.length > 0) {
        countryState.presets.forEach((preset, presetIndex) => {
          const button = createInspectorActionButton(preset.name, () => {
            applyPreset(countryState.presetLookupCode || countryState.code, presetIndex, state.selectedColor, render);
          });
          countryInspectorPresets.appendChild(button);
        });
      } else {
        countryInspectorPresets.appendChild(createEmptyNote(t("No country presets", "ui")));
      }
    }
  };

  const renderCountrySearchResults = (countryStates, term, priorityOrderMap) => {
    const upperTerm = String(term || "").trim().toUpperCase();
    const matches = countryStates
      .map((countryState) => ({
        ...countryState,
        searchRank: getCountrySearchRank(countryState, term, upperTerm),
      }))
      .filter((countryState) => countryState.searchRank !== null)
      .sort((a, b) => {
        if (a.searchRank !== b.searchRank) return a.searchRank - b.searchRank;
        const priorityDelta =
          getCountryPriorityRank(a, priorityOrderMap) - getCountryPriorityRank(b, priorityOrderMap);
        if (priorityDelta !== 0) return priorityDelta;
        return a.displayName.localeCompare(b.displayName);
      });

    if (!matches.length) {
      list.appendChild(createEmptyNote(t("No matching countries", "ui")));
      return;
    }

    matches.forEach((countryState) => {
      renderCountrySelectRow(list, countryState);
    });
  };

  const renderGroupedCountryExplorer = (countryStates) => {
    const hasCountryGrouping =
      Array.isArray(state.countryGroupsData?.continents) &&
      state.countryGroupsData.continents.length > 0;

    if (!hasCountryGrouping) {
      countryStates.forEach((countryState) => {
        renderCountrySelectRow(list, countryState);
      });
      return;
    }

    const groupedEntries = buildCountryColorTree(countryStates);
    ensureInitialInspectorExpansion(groupedEntries);
    const fragment = document.createDocumentFragment();

    groupedEntries.forEach((continent) => {
      const countries = continent.countries
        .map((entry) => latestCountryStatesByCode.get(entry.code))
        .filter(Boolean);

      if (!countries.length) return;

      const continentKey = `continent::${continent.id}`;
      const isOpen = state.expandedInspectorContinents.has(continentKey);

      const group = document.createElement("div");
      group.className = "country-explorer-group";

      const header = document.createElement("button");
      header.type = "button";
      header.className = "inspector-accordion-btn country-explorer-header";
      header.setAttribute("aria-expanded", String(isOpen));
      header.addEventListener("click", () => {
        if (state.expandedInspectorContinents.has(continentKey)) {
          state.expandedInspectorContinents.delete(continentKey);
        } else {
          state.expandedInspectorContinents.add(continentKey);
        }
        renderList();
      });

      const heading = document.createElement("div");
      heading.className = "country-explorer-heading";

      const title = document.createElement("div");
      title.className = "country-row-title";
      title.textContent = `${continent.displayLabel} (${countries.length})`;

      const chevron = document.createElement("span");
      chevron.className = "inspector-mini-label";
      chevron.textContent = isOpen ? "v" : ">";

      heading.appendChild(title);
      header.appendChild(heading);
      header.appendChild(chevron);
      group.appendChild(header);

      if (isOpen) {
        const groupList = document.createElement("div");
        groupList.className = "country-explorer-list";
        countries.forEach((countryState) => {
          renderCountrySelectRow(groupList, countryState);
        });
        group.appendChild(groupList);
      }

      fragment.appendChild(group);
    });

    list.appendChild(fragment);
  };

  const renderList = () => {
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    const countryStates = entries.map((entry, entryIndex) => createCountryInspectorState(entry, entryIndex));
    const priorityOrderMap = getPriorityCountryOrderMap();
    latestCountryStatesByCode = new Map(countryStates.map((countryState) => [countryState.code, countryState]));
    ensureSelectedInspectorCountry();
    list.replaceChildren();

    if (!countryStates.length) {
      list.appendChild(createEmptyNote(t("No countries available", "ui")));
      renderCountryInspectorDetail();
      return;
    }

    if (term) {
      renderCountrySearchResults(countryStates, term, priorityOrderMap);
    } else {
      renderGroupedCountryExplorer(countryStates);
    }

    renderCountryInspectorDetail();
  };

  if (countryInspectorSetActive && !countryInspectorSetActive.dataset.bound) {
    countryInspectorSetActive.addEventListener("click", () => {
      const selectedCode = ensureSelectedInspectorCountry();
      if (!selectedCode || state.activeSovereignCode === selectedCode) return;
      state.activeSovereignCode = selectedCode;
      markDirty("set-active-sovereign");
      if (typeof state.updateActiveSovereignUIFn === "function") {
        state.updateActiveSovereignUIFn();
      }
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      renderList();
    });
    countryInspectorSetActive.dataset.bound = "true";
  }

  if (countryInspectorColorInput && !countryInspectorColorInput.dataset.bound) {
    countryInspectorColorInput.addEventListener("change", (event) => {
      const selectedCode = ensureSelectedInspectorCountry();
      if (!selectedCode) return;
      const value = event.target.value;
      state.countryPalette[selectedCode] = value;
      applyCountryColor(selectedCode, value);
      markDirty("country-color-change");
      renderList();
    });
    countryInspectorColorInput.dataset.bound = "true";
  }

  state.renderCountryListFn = renderList;

  const renderPresetTree = () => {
    if (!presetTree) return;
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    presetTree.innerHTML = "";
    let renderedCount = 0;

    entries.forEach((entry) => {
      const { code, name, displayName } = entry;
      const presetLookupCode = resolveScenarioLookupCode(entry);
      const presets = state.presetsState[presetLookupCode] || [];
      if (!presets.length) return;

      const countryMatch =
        !term ||
        name.toLowerCase().includes(term) ||
        displayName.toLowerCase().includes(term) ||
        code.toLowerCase().includes(term);

      if (!countryMatch) return;

      const expansionKey = state.activeScenarioId ? `${code}::${presetLookupCode}` : presetLookupCode;
      const details = document.createElement("details");
      details.className = "inspector-preset-details";
      details.open = state.expandedPresetCountries.has(expansionKey);
      details.addEventListener("toggle", () => {
        if (details.open) {
          state.expandedPresetCountries.add(expansionKey);
        } else {
          state.expandedPresetCountries.delete(expansionKey);
        }
      });

      const summary = document.createElement("summary");
      summary.className = "inspector-accordion-btn";
      const chevron = document.createElement("span");
      chevron.className = "inspector-mini-label";
      chevron.textContent = details.open ? "v" : ">";
      const label = document.createElement("span");
      label.textContent = `${displayName} (${code})`;
      summary.appendChild(chevron);
      summary.appendChild(label);
      details.appendChild(summary);

      const child = document.createElement("div");
      child.className = "preset-country-body";
      presets.forEach((preset, index) => {
        const row = document.createElement("div");
        row.className = "preset-row";

        const nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "inspector-item-btn";
        nameBtn.textContent = preset.name;
        nameBtn.addEventListener("click", () => {
          applyPreset(presetLookupCode, index, state.selectedColor, render);
        });

        const actions = document.createElement("div");
        actions.className = "country-row-actions";

        const isEditingThis =
          state.isEditingPreset &&
          state.editingPresetRef &&
          state.editingPresetRef.code === presetLookupCode &&
          state.editingPresetRef.presetIndex === index;

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "preset-action-btn";
        editBtn.textContent = isEditingThis ? t("Cancel", "ui") : t("Edit", "ui");
        editBtn.addEventListener("click", () => {
          if (isEditingThis) {
            stopPresetEdit(render);
          } else {
            startPresetEdit(presetLookupCode, index, render);
          }
        });

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "preset-action-btn";
        saveBtn.textContent = t("Save", "ui");
        if (!isEditingThis) {
          saveBtn.classList.add("hidden");
        }
        saveBtn.addEventListener("click", () => {
          if (!isEditingThis) return;
          const ids = Array.from(state.editingPresetIds);
          const activePreset = state.presetsState[presetLookupCode]?.[index];
          if (activePreset) {
            activePreset.ids = ids;
            upsertCustomPreset(presetLookupCode, activePreset.name, ids);
          }
          stopPresetEdit(render);
        });

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "preset-action-btn";
        copyBtn.textContent = t("Copy", "ui");
        copyBtn.addEventListener("click", () => {
          const ids = isEditingThis ? Array.from(state.editingPresetIds) : preset.ids;
          copyPresetIds(ids || []);
        });

        actions.appendChild(editBtn);
        actions.appendChild(saveBtn);
        actions.appendChild(copyBtn);

        row.appendChild(nameBtn);
        row.appendChild(actions);
        child.appendChild(row);
      });

      details.addEventListener("toggle", () => {
        chevron.textContent = details.open ? "v" : ">";
      });
      details.appendChild(child);
      presetTree.appendChild(details);
      renderedCount += 1;
    });

    if (renderedCount === 0) {
      const empty = document.createElement("div");
      empty.id = "presetTreeEmptyState";
      empty.className = "legend-empty-state";
      empty.textContent = t("No presets available.", "ui");
      presetTree.appendChild(empty);
    }
  };

  state.renderPresetTreeFn = renderPresetTree;
  state.renderScenarioAuditPanelFn = renderScenarioAuditPanel;

  let lastLegendKey = null;
  const refreshLegendEditor = () => {
    if (!legendList) return;
    const colors = LegendManager.getUniqueColors(state);
    const key = colors.join("|");
    if (key === lastLegendKey && legendList.dataset.ready === "true") return;
    lastLegendKey = key;
    legendList.dataset.ready = "true";
    legendList.innerHTML = "";

    if (!colors.length) {
      const empty = document.createElement("div");
      empty.className = "legend-empty-state";
      empty.textContent = t("Paint regions to generate a legend.", "ui");
      legendList.appendChild(empty);
      return;
    }

    colors.forEach((color, index) => {
      const row = document.createElement("div");
      row.className = "legend-row";

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = color;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "legend-input";
      input.placeholder = `Category ${index + 1}`;
      input.value = LegendManager.getLabel(color);
      input.addEventListener("input", (event) => {
        LegendManager.setLabel(color, event.target.value);
        mapRenderer.renderLegend(colors, LegendManager.getLabels());
      });

      row.appendChild(swatch);
      row.appendChild(input);
      legendList.appendChild(row);
    });
  };

  state.updateLegendUI = refreshLegendEditor;

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.addEventListener("input", () => {
      if (typeof state.renderCountryListFn === "function") {
        state.renderCountryListFn();
      }
      if (typeof state.renderPresetTreeFn === "function") {
        state.renderPresetTreeFn();
      }
    });
    searchInput.dataset.bound = "true";
  }

  if (resetBtn && !resetBtn.dataset.bound) {
    let resetConfirmTimer = null;
    resetBtn.addEventListener("click", () => {
      if (resetBtn.dataset.confirmState === "reset-country-colors") {
        resetBtn.dataset.confirmState = "";
        resetBtn.classList.remove("is-danger-confirm");
        resetBtn.textContent = t("Reset Country Colors", "ui");
        if (resetConfirmTimer) globalThis.clearTimeout(resetConfirmTimer);
      } else {
        resetBtn.dataset.confirmState = "reset-country-colors";
        resetBtn.classList.add("is-danger-confirm");
        resetBtn.textContent = t("Confirm Reset", "ui");
        resetConfirmTimer = globalThis.setTimeout(() => {
          resetBtn.dataset.confirmState = "";
          resetBtn.classList.remove("is-danger-confirm");
          resetBtn.textContent = t("Reset Country Colors", "ui");
        }, 3000);
        return;
      }
      resetCountryColors();
      markDirty("reset-country-colors");
      if (typeof state.renderCountryListFn === "function") {
        state.renderCountryListFn();
      }
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
    });
    resetBtn.dataset.bound = "true";
  }

  if (downloadProjectBtn && !downloadProjectBtn.dataset.bound) {
    downloadProjectBtn.addEventListener("click", () => {
      FileManager.exportProject(state);
    });
    downloadProjectBtn.dataset.bound = "true";
  }

  if (uploadProjectBtn && projectFileInput && !uploadProjectBtn.dataset.bound) {
    uploadProjectBtn.addEventListener("click", () => {
      if (state.isDirty) {
        const shouldContinue = globalThis.confirm(
          t("You have unsaved changes. Loading a project will replace the current map.", "ui")
        );
        if (!shouldContinue) return;
      }
      projectFileInput.click();
    });
    uploadProjectBtn.dataset.bound = "true";
  }

  if (projectFileInput && !projectFileInput.dataset.bound) {
    projectFileInput.addEventListener("change", () => {
      const file = projectFileInput.files?.[0];
      if (!file) {
        if (projectFileName) {
          projectFileName.textContent = t("No file selected", "ui");
        }
        return;
      }
      if (projectFileName) {
        projectFileName.textContent = file.name;
      }
      FileManager.importProject(file, async (data) => {
        clearHistory();
        if (data.scenario?.id) {
          const validation = await validateImportedScenarioBaseline(data.scenario);
          if (!validation.ok) {
            const shouldContinue = validation.reason === "baseline_mismatch"
              ? globalThis.confirm(
                `${validation.message}\n\nContinue loading this project anyway?`
              )
              : false;
            if (!shouldContinue) {
              const error = new Error("Project import cancelled.");
              error.code = "IMPORT_ABORTED";
              error.toastTitle = t("Import cancelled", "ui");
              error.toastTone = validation.reason === "baseline_mismatch" ? "warning" : "error";
              error.userMessage = validation.reason === "missing_scenario"
                ? validation.message
                : t(
                  "Project import cancelled because the saved scenario baseline does not match the current assets.",
                  "ui"
                );
              throw error;
            }
          }
          await applyScenarioById(data.scenario.id, {
            renderNow: false,
            markDirtyReason: "",
            showToastOnComplete: false,
          });
        } else if (state.activeScenarioId) {
          clearActiveScenario({
            renderNow: false,
            markDirtyReason: "",
            showToastOnComplete: false,
          });
        }
        data = await migrateFeatureScopedProjectDataToCurrentTopology(data, state.landData);
        state.sovereignBaseColors = data.sovereignBaseColors || data.countryBaseColors || {};
        state.countryBaseColors = { ...state.sovereignBaseColors };
        state.visualOverrides = data.visualOverrides || data.featureOverrides || {};
        state.featureOverrides = { ...state.visualOverrides };
        state.sovereigntyByFeatureId = data.sovereigntyByFeatureId || {};
        state.sovereigntyInitialized = false;
        state.paintMode = data.paintMode || "visual";
        state.activeSovereignCode = data.activeSovereignCode || "";
        state.selectedInspectorCountryCode = data.activeSovereignCode || state.selectedInspectorCountryCode || "";
        state.inspectorHighlightCountryCode = state.selectedInspectorCountryCode;
        state.inspectorExpansionInitialized = false;
        if (state.expandedInspectorContinents instanceof Set) {
          state.expandedInspectorContinents.clear();
        }
        state.dynamicBordersDirty = !!data.dynamicBordersDirty;
        state.dynamicBordersDirtyReason = data.dynamicBordersDirtyReason || "";
        ensureSovereigntyState({ force: true });
        state.specialZones = data.specialZones || {};
        state.manualSpecialZones =
          data.manualSpecialZones && data.manualSpecialZones.type === "FeatureCollection"
            ? data.manualSpecialZones
            : { type: "FeatureCollection", features: [] };
        const supportedCountries = Array.isArray(state.parentBorderSupportedCountries)
          ? state.parentBorderSupportedCountries
          : [];
        const importedParentEnabled =
          data.parentBorderEnabledByCountry && typeof data.parentBorderEnabledByCountry === "object"
            ? data.parentBorderEnabledByCountry
            : {};
        const normalizedParentEnabled = {};
        supportedCountries.forEach((countryCode) => {
          normalizedParentEnabled[countryCode] = !!importedParentEnabled[countryCode];
        });
        state.parentBorderEnabledByCountry = normalizedParentEnabled;
        if (
          data.styleConfig?.parentBorders &&
          typeof data.styleConfig.parentBorders === "object"
        ) {
          state.styleConfig.parentBorders = {
            ...(state.styleConfig.parentBorders || {}),
            ...data.styleConfig.parentBorders,
          };
        }
        if (data.styleConfig?.ocean && typeof data.styleConfig.ocean === "object") {
          state.styleConfig.ocean = {
            ...(state.styleConfig.ocean || {}),
            ...data.styleConfig.ocean,
          };
        }
        if (data.styleConfig?.urban && typeof data.styleConfig.urban === "object") {
          state.styleConfig.urban = {
            ...(state.styleConfig.urban || {}),
            ...data.styleConfig.urban,
          };
        }
        if (data.styleConfig?.physical && typeof data.styleConfig.physical === "object") {
          state.styleConfig.physical = {
            ...(state.styleConfig.physical || {}),
            ...data.styleConfig.physical,
          };
        }
        if (data.styleConfig?.rivers && typeof data.styleConfig.rivers === "object") {
          state.styleConfig.rivers = {
            ...(state.styleConfig.rivers || {}),
            ...data.styleConfig.rivers,
          };
        }
        if (data.styleConfig?.specialZones && typeof data.styleConfig.specialZones === "object") {
          state.styleConfig.specialZones = {
            ...(state.styleConfig.specialZones || {}),
            ...data.styleConfig.specialZones,
          };
        }
        if (data.styleConfig?.texture && typeof data.styleConfig.texture === "object") {
          state.styleConfig.texture = {
            ...(state.styleConfig.texture || {}),
            ...data.styleConfig.texture,
            paper: {
              ...(state.styleConfig.texture?.paper || {}),
              ...(data.styleConfig.texture.paper || {}),
            },
            graticule: {
              ...(state.styleConfig.texture?.graticule || {}),
              ...(data.styleConfig.texture.graticule || {}),
            },
            draftGrid: {
              ...(state.styleConfig.texture?.draftGrid || {}),
              ...(data.styleConfig.texture.draftGrid || {}),
            },
          };
        }
        if (data.layerVisibility && typeof data.layerVisibility === "object") {
          state.showUrban = !!data.layerVisibility.showUrban;
          state.showPhysical = !!data.layerVisibility.showPhysical;
          state.showRivers = !!data.layerVisibility.showRivers;
          state.showSpecialZones =
            data.layerVisibility.showSpecialZones === undefined
              ? true
              : !!data.layerVisibility.showSpecialZones;
        }
        if (typeof state.updateParentBorderCountryListFn === "function") {
          state.updateParentBorderCountryListFn();
        }
        if (typeof state.updateSpecialZoneEditorUIFn === "function") {
          state.updateSpecialZoneEditorUIFn();
        }
        if (typeof state.updateActiveSovereignUIFn === "function") {
          state.updateActiveSovereignUIFn();
        }
        if (typeof state.updatePaintModeUIFn === "function") {
          state.updatePaintModeUIFn();
        }
        if (typeof state.updateDynamicBorderStatusUIFn === "function") {
          state.updateDynamicBorderStatusUIFn();
        }
        if (typeof state.updateToolbarInputsFn === "function") {
          state.updateToolbarInputsFn();
        }
        mapRenderer.refreshColorState({ renderNow: false });
        if (render) render();
        if (typeof state.renderCountryListFn === "function") {
          state.renderCountryListFn();
        }
        if (typeof state.renderPresetTreeFn === "function") {
          state.renderPresetTreeFn();
        }
        if (typeof state.updateLegendUI === "function") {
          state.updateLegendUI();
        }
        if (typeof state.renderScenarioAuditPanelFn === "function") {
          state.renderScenarioAuditPanelFn();
        }
      });
      projectFileInput.value = "";
    });
    projectFileInput.dataset.bound = "true";
  }

  if (debugModeSelect && !debugModeSelect.dataset.bound) {
    debugModeSelect.value = String(state.debugMode || "PROD").toUpperCase();
    debugModeSelect.addEventListener("change", (event) => {
      mapRenderer.setDebugMode(event.target.value);
    });
    debugModeSelect.dataset.bound = "true";
  }

  renderList();
  renderPresetTree();
  refreshLegendEditor();
  renderScenarioAuditPanel();

  globalThis.togglePresetRegion = (id) => togglePresetRegion(id, render);
}

export { initSidebar, initPresetState };
