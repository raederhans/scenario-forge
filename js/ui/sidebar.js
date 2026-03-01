// Sidebar UI (Phase 13)
import { state, countryNames, countryPresets, PRESET_STORAGE_KEY, defaultCountryPalette } from "../core/state.js";
import { ColorManager } from "../core/color_manager.js";
import * as mapRenderer from "../core/map_renderer.js";
import { applyCountryColor, resetCountryColors } from "../core/logic.js";
import { FileManager } from "../core/file_manager.js";
import { LegendManager } from "../core/legend_manager.js";
import { t } from "./i18n.js";

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
  Object.keys(base || {}).forEach((code) => {
    merged[code] = (base[code] || []).map((preset) => ({
      name: preset.name,
      ids: Array.isArray(preset.ids) ? [...preset.ids] : [],
    }));
  });
  Object.keys(custom || {}).forEach((code) => {
    if (!merged[code]) merged[code] = [];
    const customEntries = Array.isArray(custom[code]) ? custom[code] : [];
    customEntries.forEach((entry) => {
      if (!entry || !entry.name) return;
      const idx = merged[code].findIndex((preset) => preset.name === entry.name);
      const ids = Array.isArray(entry.ids) ? [...entry.ids] : [];
      if (idx >= 0) {
        merged[code][idx] = { name: entry.name, ids };
      } else {
        merged[code].push({ name: entry.name, ids });
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
  if (!state.customPresets[code]) state.customPresets[code] = [];
  const idx = state.customPresets[code].findIndex((preset) => preset.name === name);
  const entry = { name, ids: [...ids] };
  if (idx >= 0) {
    state.customPresets[code][idx] = entry;
  } else {
    state.customPresets[code].push(entry);
  }
  saveCustomPresets();
  state.presetsState = mergePresets(countryPresets, state.customPresets);
}

function initPresetState() {
  state.customPresets = loadCustomPresets();
  state.presetsState = mergePresets(countryPresets, state.customPresets);
}

function getHierarchyGroupsForCode(code) {
  if (!code) return [];
  if (state.hierarchyGroupsByCode.size > 0) {
    return state.hierarchyGroupsByCode.get(code) || [];
  }
  if (!state.hierarchyData || !state.hierarchyData.groups) return [];
  const labels = state.hierarchyData.labels || {};
  const groups = [];
  Object.entries(state.hierarchyData.groups).forEach(([groupId, children]) => {
    if (!groupId.startsWith(`${code}_`)) return;
    const label = labels[groupId] || groupId.replace(`${code}_`, "").replace(/_/g, " ");
    groups.push({
      id: groupId,
      label,
      children: Array.isArray(children) ? children : [],
    });
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

function getCountryGroupingMeta(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode || !(state.countryGroupMetaByCode instanceof Map)) return null;
  return state.countryGroupMetaByCode.get(normalizedCode) || null;
}

function buildCountryColorTree(entries) {
  const tree = new Map();
  const continentOrder = new Map();
  const subregionOrder = new Map();
  const configuredContinents = Array.isArray(state.countryGroupsData?.continents)
    ? state.countryGroupsData.continents
    : [];

  configuredContinents.forEach((continent, continentIndex) => {
    const continentId = String(continent?.id || "").trim();
    if (!continentId) return;
    continentOrder.set(continentId, continentIndex);
    const subregions = Array.isArray(continent?.subregions) ? continent.subregions : [];
    subregions.forEach((subregion, subregionIndex) => {
      const subregionId = String(subregion?.id || "").trim();
      if (!subregionId) return;
      subregionOrder.set(`${continentId}::${subregionId}`, subregionIndex);
    });
  });

  entries.forEach((entry) => {
    const meta = getCountryGroupingMeta(entry.code);
    const continentId = meta?.continentId || "continent_other";
    const continentLabel = meta?.continentLabel || "Other";
    const subregionId = meta?.subregionId || "subregion_unclassified";
    const subregionLabel = meta?.subregionLabel || "Unclassified";

    if (!tree.has(continentId)) {
      tree.set(continentId, {
        id: continentId,
        label: continentLabel,
        displayLabel: t(continentLabel, "geo") || continentLabel,
        sortIndex: continentOrder.has(continentId) ? continentOrder.get(continentId) : Number.MAX_SAFE_INTEGER,
        subregions: new Map(),
      });
    }

    const continentNode = tree.get(continentId);
    const subregionKey = `${continentId}::${subregionId}`;
    if (!continentNode.subregions.has(subregionId)) {
      continentNode.subregions.set(subregionId, {
        id: subregionId,
        label: subregionLabel,
        displayLabel: t(subregionLabel, "geo") || subregionLabel,
        sortIndex: subregionOrder.has(subregionKey) ? subregionOrder.get(subregionKey) : Number.MAX_SAFE_INTEGER,
        countries: [],
      });
    }

    continentNode.subregions.get(subregionId).countries.push(entry);
  });

  return Array.from(tree.values())
    .map((continentNode) => ({
      ...continentNode,
      subregions: Array.from(continentNode.subregions.values())
        .map((subregionNode) => ({
          ...subregionNode,
          countries: [...subregionNode.countries].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        }))
        .sort((a, b) => {
          if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
          return a.displayLabel.localeCompare(b.displayLabel);
        }),
    }))
    .sort((a, b) => {
      if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
      return a.displayLabel.localeCompare(b.displayLabel);
    });
}

function applyHierarchyGroup(group, color, render) {
  if (!group || !group.children) return;
  const colorToApply = color || state.selectedColor;
  group.children.forEach((id) => {
    state.featureOverrides[id] = colorToApply;
  });
  mapRenderer.refreshColorState({ renderNow: false });
  if (render) render();
  addRecentColor(colorToApply);
}

function addRecentColor(color) {
  if (!color) return;
  state.recentColors = state.recentColors.filter((value) => value !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 5) {
    state.recentColors = state.recentColors.slice(0, 5);
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
}

function applyPreset(countryCode, presetIndex, color, render) {
  const presets = state.presetsState[countryCode];
  if (!presets || !presets[presetIndex]) {
    console.warn(`Preset not found: ${countryCode}[${presetIndex}]`);
    return;
  }

  const preset = presets[presetIndex];
  const colorToApply = color || state.selectedColor;

  preset.ids.forEach((id) => {
    state.featureOverrides[id] = colorToApply;
  });

  mapRenderer.refreshColorState({ renderNow: false });
  if (render) render();

  if (!state.recentColors.includes(colorToApply)) {
    state.recentColors.unshift(colorToApply);
    if (state.recentColors.length > 8) state.recentColors.pop();
    if (typeof state.updateRecentUI === "function") state.updateRecentUI();
  }

  console.log(`Applied preset "${preset.name}" with ${preset.ids.length} regions`);
}

function startPresetEdit(code, presetIndex, render) {
  const presets = state.presetsState[code] || [];
  const preset = presets[presetIndex];
  if (!preset) return;
  state.isEditingPreset = true;
  state.editingPresetRef = { code, presetIndex };
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
  } catch (error) {
    console.warn("Clipboard unavailable, logging IDs instead.", error);
    console.log(payload);
  }
}

function initSidebar({ render } = {}) {
  const list = document.getElementById("countryList");
  if (!list) return;
  const presetTree = document.getElementById("presetTree");
  const searchInput = document.getElementById("countrySearch");
  const resetBtn = document.getElementById("resetCountryColors");
  const sidebar = document.getElementById("rightSidebar");
  const sidebarStack = sidebar?.querySelector(".sidebar-sections, .space-y-5") || sidebar;

  let projectSection = document.getElementById("projectManagement");
  if (!projectSection && sidebarStack) {
    projectSection = document.createElement("div");
    projectSection.id = "projectManagement";
    projectSection.className = "card sidebar-tool-card";

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
    sidebarStack.appendChild(projectSection);
  }

  let legendSection = document.getElementById("legendEditor");
  if (!legendSection && sidebarStack) {
    legendSection = document.createElement("div");
    legendSection.id = "legendEditor";
    legendSection.className = "card sidebar-tool-card";

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
    list.className = "mt-3 space-y-2";

    legendSection.appendChild(title);
    legendSection.appendChild(hint);
    legendSection.appendChild(list);
    sidebarStack.appendChild(legendSection);
  }

  let debugViewSection = document.getElementById("debugViewControl");
  if (!debugViewSection && sidebarStack) {
    debugViewSection = document.createElement("div");
    debugViewSection.id = "debugViewControl";
    debugViewSection.className = "card sidebar-tool-card sidebar-tool-card-debug";

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
    sidebarStack.appendChild(debugViewSection);
  }

  const downloadProjectBtn = document.getElementById("downloadProjectBtn");
  const uploadProjectBtn = document.getElementById("uploadProjectBtn");
  const projectFileInput = document.getElementById("projectFileInput");
  const projectFileName = document.getElementById("projectFileName");
  const legendList = document.getElementById("legendEditorList");
  const debugModeSelect = document.getElementById("debug-mode-select");

  if (projectFileName && !projectFileName.textContent.trim()) {
    projectFileName.textContent = t("No file selected", "ui");
  }

  const expanded = new Set();
  const expandedContinents = new Set();
  const expandedSubregions = new Set();
  const getSearchTerm = () => (searchInput?.value || "").trim().toLowerCase();
  const matchesTerm = (value, term) => String(value || "").toLowerCase().includes(term);

  const appendCountryChildren = (parent, countryState) => {
    const { code, presets, hierarchyGroups } = countryState;

    if (hierarchyGroups.length > 0) {
      const child = document.createElement("div");
      child.className = "ml-2 space-y-2 pb-2";
      const header = document.createElement("div");
      header.className = "px-2 text-[10px] uppercase tracking-wide text-slate-400";
      header.textContent = t("--- Provinces/Regions ---", "ui");
      child.appendChild(header);
      hierarchyGroups.forEach((group) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-100";
        btn.textContent = t(group.label, "geo") || group.label;
        btn.addEventListener("click", () => {
          applyHierarchyGroup(group, state.selectedColor, render);
        });
        child.appendChild(btn);
      });
      parent.appendChild(child);
    }

    if (presets.length > 0) {
      const child = document.createElement("div");
      child.className = "ml-2 space-y-2 pb-2";
      const header = document.createElement("div");
      header.className = "px-2 text-[10px] uppercase tracking-wide text-slate-400";
      header.textContent = t("--- Presets ---", "ui");
      child.appendChild(header);
      presets.forEach((preset, presetIndex) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-100";
        btn.textContent = `Apply ${preset.name}`;
        btn.addEventListener("click", () => {
          applyPreset(code, presetIndex, state.selectedColor, render);
        });
        child.appendChild(btn);
      });
      parent.appendChild(child);
    }
  };

  const renderCountryRow = (parent, countryState) => {
    const { code, displayName, fallbackIndex, hasChildren, isOpen } = countryState;
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2";

    const label = document.createElement("div");
    label.className = "text-sm font-medium text-slate-700";
    label.textContent = `${displayName} (${code})`;

    const controls = document.createElement("div");
    controls.className = "flex items-center gap-2";

    if (hasChildren) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className =
        "rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-100";
      toggle.textContent = isOpen ? "v" : ">";
      toggle.addEventListener("click", () => {
        if (expanded.has(code)) {
          expanded.delete(code);
        } else {
          expanded.add(code);
        }
        renderList();
      });
      controls.appendChild(toggle);
    }

    const input = document.createElement("input");
    input.type = "color";
    const fallbackColor = ensureCountryPaletteColor(code, fallbackIndex);
    input.value = state.countryBaseColors[code] || state.countryPalette[code] || fallbackColor;
    input.className = "h-8 w-10 cursor-pointer rounded-md border border-slate-300 bg-white";
    input.addEventListener("change", (event) => {
      const value = event.target.value;
      state.countryPalette[code] = value;
      applyCountryColor(code, value, render);
    });
    controls.appendChild(input);

    row.appendChild(label);
    row.appendChild(controls);
    parent.appendChild(row);

    if (isOpen) {
      appendCountryChildren(parent, countryState);
    }
  };

  const renderFlatCountryList = (entries, term) => {
    entries.forEach(({ code, name, displayName }, entryIndex) => {
      const presets = state.presetsState[code] || [];
      const hierarchyGroups = getHierarchyGroupsForCode(code);
      const countryMatch =
        !term ||
        matchesTerm(name, term) ||
        matchesTerm(displayName, term) ||
        matchesTerm(code, term);
      const presetMatch = term
        ? presets.some((preset) => matchesTerm(preset.name, term))
        : false;
      const hierarchyMatch = term
        ? hierarchyGroups.some((group) => matchesTerm(group.label, term))
        : false;

      if (!countryMatch && !presetMatch && !hierarchyMatch) return;

      renderCountryRow(list, {
        code,
        displayName,
        fallbackIndex: entryIndex,
        presets,
        hierarchyGroups,
        hasChildren: presets.length > 0 || hierarchyGroups.length > 0,
        isOpen: expanded.has(code) || (term && (presetMatch || hierarchyMatch)),
      });
    });
  };

  const renderList = () => {
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    list.innerHTML = "";

    const hasCountryGrouping =
      Array.isArray(state.countryGroupsData?.continents) &&
      state.countryGroupsData.continents.length > 0;
    if (!hasCountryGrouping) {
      renderFlatCountryList(entries, term);
      return;
    }

    const groupedEntries = buildCountryColorTree(entries);

    const entryIndexByCode = new Map(entries.map((entry, entryIndex) => [entry.code, entryIndex]));
    const fragment = document.createDocumentFragment();

    groupedEntries.forEach((continent) => {
      const continentMatch = term
        ? matchesTerm(continent.label, term) || matchesTerm(continent.displayLabel, term)
        : false;
      const visibleSubregions = [];

      continent.subregions.forEach((subregion) => {
        const subregionMatch = term
          ? matchesTerm(subregion.label, term) || matchesTerm(subregion.displayLabel, term)
          : false;
        const forceVisible = !term || continentMatch || subregionMatch;
        const visibleCountries = [];

        subregion.countries.forEach(({ code, name, displayName }) => {
          const presets = state.presetsState[code] || [];
          const hierarchyGroups = getHierarchyGroupsForCode(code);
          const countryMatch =
            !term ||
            matchesTerm(name, term) ||
            matchesTerm(displayName, term) ||
            matchesTerm(code, term);
          const presetMatch = term
            ? presets.some((preset) => matchesTerm(preset.name, term))
            : false;
          const hierarchyMatch = term
            ? hierarchyGroups.some((group) => matchesTerm(group.label, term))
            : false;
          const hasOwnMatch = countryMatch || presetMatch || hierarchyMatch;

          if (!forceVisible && !hasOwnMatch) return;

          const hasChildren = presets.length > 0 || hierarchyGroups.length > 0;
          visibleCountries.push({
            code,
            name,
            displayName,
            presets,
            hierarchyGroups,
            hasChildren,
            fallbackIndex: entryIndexByCode.get(code) || 0,
            autoExpandCountry: presetMatch || hierarchyMatch,
            autoExpandPath: hasOwnMatch,
          });
        });

        if (!visibleCountries.length) return;
        visibleSubregions.push({
          ...subregion,
          subregionMatch,
          forceVisible,
          countries: visibleCountries,
          autoExpandPath:
            forceVisible || visibleCountries.some((countryState) => countryState.autoExpandPath),
        });
      });

      if (!visibleSubregions.length) return;

      const continentKey = `continent::${continent.id}`;
      const continentOpen = term
        ? continentMatch || visibleSubregions.some((subregion) => subregion.autoExpandPath)
        : expandedContinents.has(continentKey);

      const continentWrapper = document.createElement("div");
      continentWrapper.className = "space-y-2";

      const continentToggle = document.createElement("button");
      continentToggle.type = "button";
      continentToggle.className =
        "flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-left hover:bg-slate-200";
      continentToggle.addEventListener("click", () => {
        if (expandedContinents.has(continentKey)) {
          expandedContinents.delete(continentKey);
        } else {
          expandedContinents.add(continentKey);
        }
        renderList();
      });

      const continentTitle = document.createElement("div");
      continentTitle.className = "text-sm font-semibold text-slate-700";
      continentTitle.textContent = `${continent.displayLabel} (${continent.subregions.reduce((sum, item) => sum + item.countries.length, 0)})`;

      const continentChevron = document.createElement("span");
      continentChevron.className = "text-xs text-slate-500";
      continentChevron.textContent = continentOpen ? "v" : ">";

      continentToggle.appendChild(continentTitle);
      continentToggle.appendChild(continentChevron);
      continentWrapper.appendChild(continentToggle);

      if (continentOpen) {
        const continentChildren = document.createElement("div");
        continentChildren.className = "ml-2 space-y-2";

        visibleSubregions.forEach((subregion) => {
          const subregionKey = `subregion::${continent.id}::${subregion.id}`;
          const subregionOpen = term
            ? subregion.autoExpandPath
            : expandedSubregions.has(subregionKey);

          const subregionWrapper = document.createElement("div");
          subregionWrapper.className = "space-y-2";

          const subregionToggle = document.createElement("button");
          subregionToggle.type = "button";
          subregionToggle.className =
            "flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50";
          subregionToggle.addEventListener("click", () => {
            if (expandedSubregions.has(subregionKey)) {
              expandedSubregions.delete(subregionKey);
            } else {
              expandedSubregions.add(subregionKey);
            }
            renderList();
          });

          const subregionTitle = document.createElement("div");
          subregionTitle.className = "text-xs font-semibold uppercase tracking-wide text-slate-500";
          subregionTitle.textContent = `${subregion.displayLabel} (${subregion.countries.length})`;

          const subregionChevron = document.createElement("span");
          subregionChevron.className = "text-xs text-slate-500";
          subregionChevron.textContent = subregionOpen ? "v" : ">";

          subregionToggle.appendChild(subregionTitle);
          subregionToggle.appendChild(subregionChevron);
          subregionWrapper.appendChild(subregionToggle);

          if (subregionOpen) {
            const subregionChildren = document.createElement("div");
            subregionChildren.className = "ml-3 space-y-2";
            subregion.countries.forEach((countryState) => {
              const isOpen = expanded.has(countryState.code) || (term && countryState.autoExpandCountry);
              renderCountryRow(subregionChildren, {
                ...countryState,
                isOpen,
              });
            });
            subregionWrapper.appendChild(subregionChildren);
          }

          continentChildren.appendChild(subregionWrapper);
        });

        continentWrapper.appendChild(continentChildren);
      }

      fragment.appendChild(continentWrapper);
    });

    list.appendChild(fragment);
  };

  state.renderCountryListFn = renderList;

  const renderPresetTree = () => {
    if (!presetTree) return;
    const term = getSearchTerm();
    const entries = getDynamicCountryEntries();
    presetTree.innerHTML = "";

    entries.forEach(({ code, name, displayName }) => {
      const presets = state.presetsState[code] || [];
      if (!presets.length) return;

      const countryMatch =
        !term ||
        name.toLowerCase().includes(term) ||
        displayName.toLowerCase().includes(term) ||
        code.toLowerCase().includes(term);
      const presetMatch = term
        ? presets.some((preset) => preset.name.toLowerCase().includes(term))
        : false;

      if (!countryMatch && !presetMatch) return;
      if (presetMatch) {
        state.expandedPresetCountries.add(code);
      }

      const details = document.createElement("details");
      details.className = "group";
      details.open = state.expandedPresetCountries.has(code) || presetMatch;
      details.addEventListener("toggle", () => {
        if (details.open) {
          state.expandedPresetCountries.add(code);
        } else {
          state.expandedPresetCountries.delete(code);
        }
      });

      const summary = document.createElement("summary");
      summary.className =
        "cursor-pointer list-none flex items-center gap-2 rounded px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100";
      summary.innerHTML =
        '<svg class="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
      const label = document.createElement("span");
      label.textContent = `${displayName} (${code})`;
      summary.appendChild(label);
      details.appendChild(summary);

      const child = document.createElement("div");
      child.className = "ml-6 mt-1 space-y-1";
      presets.forEach((preset, index) => {
        const row = document.createElement("div");
        row.className =
          "flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100";

        const nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "flex-1 text-left";
        nameBtn.textContent = preset.name;
        nameBtn.addEventListener("click", () => {
          applyPreset(code, index, state.selectedColor, render);
        });

        const actions = document.createElement("div");
        actions.className = "flex items-center gap-2";

        const isEditingThis =
          state.isEditingPreset &&
          state.editingPresetRef &&
          state.editingPresetRef.code === code &&
          state.editingPresetRef.presetIndex === index;

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "text-[11px] text-slate-500 hover:text-slate-700";
        editBtn.textContent = isEditingThis ? t("Cancel", "ui") : t("Edit", "ui");
        editBtn.addEventListener("click", () => {
          if (isEditingThis) {
            stopPresetEdit(render);
          } else {
            startPresetEdit(code, index, render);
          }
        });

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "text-[11px] text-slate-500 hover:text-slate-700";
        saveBtn.textContent = t("Save", "ui");
        if (!isEditingThis) {
          saveBtn.classList.add("hidden");
        }
        saveBtn.addEventListener("click", () => {
          if (!isEditingThis) return;
          const ids = Array.from(state.editingPresetIds);
          const activePreset = state.presetsState[code]?.[index];
          if (activePreset) {
            activePreset.ids = ids;
            upsertCustomPreset(code, activePreset.name, ids);
          }
          stopPresetEdit(render);
        });

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "text-[11px] text-slate-500 hover:text-slate-700";
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

      details.appendChild(child);
      presetTree.appendChild(details);
    });
  };

  state.renderPresetTreeFn = renderPresetTree;

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
      row.className = "flex items-center gap-2";

      const swatch = document.createElement("span");
      swatch.className = "h-4 w-4 rounded border border-slate-300";
      swatch.style.backgroundColor = color;

      const input = document.createElement("input");
      input.type = "text";
      input.className =
        "flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700";
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
    resetBtn.addEventListener("click", () => {
      resetCountryColors();
      if (typeof state.renderCountryListFn === "function") {
        state.renderCountryListFn();
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
      FileManager.importProject(file, (data) => {
        state.countryBaseColors = data.countryBaseColors || {};
        state.featureOverrides = data.featureOverrides || {};
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
        mapRenderer.refreshColorState({ renderNow: false });
        if (render) render();
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

  globalThis.togglePresetRegion = (id) => togglePresetRegion(id, render);
}

export { initSidebar, initPresetState };
