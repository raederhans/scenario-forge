import { callRuntimeHook } from "../core/state/index.js";
import { state as runtimeState } from "../core/state.js";
import { setUiShellDebugTerritorySeededState } from "../core/state/actions/boot_actions.js";
import { normalizeCountryCode, rebuildPresetState } from "../core/releasable_manager.js";

const UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID = "ui_shell_territory_preview";
const UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE = "GER";

const previewCountryNames = Object.freeze({
  GER: "Germany",
  FRA: "France",
  ITA: "Italy",
  BAV: "Bavaria",
  AUS: "Austria",
  BRI: "Brittany",
  SIC: "Sicily",
});

const previewCountryColors = Object.freeze({
  GER: "#5b6f91",
  FRA: "#4f6ea8",
  ITA: "#6d8c54",
  BAV: "#7a9bc2",
  AUS: "#9d6b5c",
  BRI: "#8c6fa8",
  SIC: "#c18f55",
});

const makePreset = (name, ids, extra = {}) => ({
  name,
  ids,
  ...extra,
});

const makeVariant = (id, label, ids) => ({
  id,
  label,
  description: `${label} preview boundary`,
  preset_source: {
    type: "feature_ids",
    feature_ids: ids,
  },
});

// UI shell 调试种子只模拟 inspector/preset 需要的最小 runtime 合同；新增字段前先确认真实启动路径也消费同名字段。
const previewCountries = Object.freeze({
  GER: {
    code: "GER",
    tag: "GER",
    display_name: "Germany",
    display_name_en: "Germany",
    feature_count: 42,
    controller_feature_count: 42,
    color_hex: previewCountryColors.GER,
    base_iso2: "DE",
    lookup_iso2: "DE",
    preset_lookup_code: "GER",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "central-europe",
    subregion_label: "Central Europe",
    inspector_group_id: "ui-shell-europe-major",
    inspector_group_label: "Europe Preview",
    inspector_group_anchor_id: "GER",
    featured: true,
    catalog_order: 10,
    regional_presets: [
      makePreset("Rhineland Industrial Belt", ["ui-shell-ger-rhine-1", "ui-shell-ger-rhine-2", "ui-shell-ger-rhine-3"]),
      makePreset("Prussian Core", ["ui-shell-ger-prussia-1", "ui-shell-ger-prussia-2", "ui-shell-ger-prussia-3", "ui-shell-ger-prussia-4"]),
      makePreset("Bavarian South", ["ui-shell-ger-bavaria-1", "ui-shell-ger-bavaria-2"]),
    ],
  },
  FRA: {
    code: "FRA",
    tag: "FRA",
    display_name: "France",
    display_name_en: "France",
    feature_count: 36,
    controller_feature_count: 36,
    color_hex: previewCountryColors.FRA,
    base_iso2: "FR",
    lookup_iso2: "FR",
    preset_lookup_code: "FRA",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "western-europe",
    subregion_label: "Western Europe",
    inspector_group_id: "ui-shell-europe-major",
    inspector_group_label: "Europe Preview",
    inspector_group_anchor_id: "GER",
    catalog_order: 20,
    regional_presets: [
      makePreset("Ile-de-France Basin", ["ui-shell-fra-paris-1", "ui-shell-fra-paris-2"]),
      makePreset("Atlantic Coast", ["ui-shell-fra-atlantic-1", "ui-shell-fra-atlantic-2", "ui-shell-fra-atlantic-3"]),
      makePreset("Occitan South", ["ui-shell-fra-occitan-1", "ui-shell-fra-occitan-2"]),
    ],
  },
  ITA: {
    code: "ITA",
    tag: "ITA",
    display_name: "Italy",
    display_name_en: "Italy",
    feature_count: 28,
    controller_feature_count: 28,
    color_hex: previewCountryColors.ITA,
    base_iso2: "IT",
    lookup_iso2: "IT",
    preset_lookup_code: "ITA",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "southern-europe",
    subregion_label: "Southern Europe",
    inspector_group_id: "ui-shell-europe-major",
    inspector_group_label: "Europe Preview",
    inspector_group_anchor_id: "GER",
    catalog_order: 30,
    regional_presets: [
      makePreset("Northern Italy", ["ui-shell-ita-north-1", "ui-shell-ita-north-2", "ui-shell-ita-north-3"]),
      makePreset("Mezzogiorno", ["ui-shell-ita-south-1", "ui-shell-ita-south-2"]),
      makePreset("Sicilian Islands", ["ui-shell-ita-sicily-1", "ui-shell-ita-sicily-2"]),
    ],
  },
  BAV: {
    code: "BAV",
    tag: "BAV",
    display_name: "Bavaria",
    display_name_en: "Bavaria",
    entry_kind: "scenario_subject",
    subject_kind: "client_state",
    scenario_only: true,
    feature_count: 8,
    color_hex: previewCountryColors.BAV,
    parent_owner_tag: "GER",
    parent_owner_tags: ["GER"],
    lookup_iso2: "DE",
    preset_lookup_code: "BAV",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "central-europe",
    subregion_label: "Central Europe",
    hidden_from_country_list: true,
    catalog_order: 100,
    regional_presets: [
      makePreset("Bavarian Core", ["ui-shell-bav-core-1", "ui-shell-bav-core-2"]),
      makePreset("Alpine Corridor", ["ui-shell-bav-alps-1", "ui-shell-bav-alps-2"]),
    ],
  },
  AUS: {
    code: "AUS",
    tag: "AUS",
    display_name: "Austria",
    display_name_en: "Austria",
    entry_kind: "releasable",
    releasable: true,
    scenario_only: true,
    feature_count: 9,
    resolved_feature_count_hint: 9,
    color_hex: previewCountryColors.AUS,
    parent_owner_tag: "GER",
    parent_owner_tags: ["GER"],
    lookup_iso2: "AT",
    release_lookup_iso2: "AT",
    preset_lookup_code: "AUS",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "central-europe",
    subregion_label: "Central Europe",
    hidden_from_country_list: true,
    catalog_order: 110,
    regional_presets: [
      makePreset("Austrian Core Territory", ["ui-shell-aus-core-1", "ui-shell-aus-core-2", "ui-shell-aus-core-3"], {
        preset_kind: "releasable_core",
        parent_owner_tag: "GER",
      }),
      makePreset("Tyrol Preview", ["ui-shell-aus-tyrol-1", "ui-shell-aus-tyrol-2"]),
    ],
    default_boundary_variant_id: "core",
    boundary_variants: [
      makeVariant("core", "Austrian core", ["ui-shell-aus-core-1", "ui-shell-aus-core-2", "ui-shell-aus-core-3"]),
      makeVariant("alpine", "Alpine extension", ["ui-shell-aus-alpine-1", "ui-shell-aus-alpine-2"]),
    ],
  },
  BRI: {
    code: "BRI",
    tag: "BRI",
    display_name: "Brittany",
    display_name_en: "Brittany",
    entry_kind: "releasable",
    releasable: true,
    scenario_only: true,
    feature_count: 5,
    resolved_feature_count_hint: 5,
    color_hex: previewCountryColors.BRI,
    parent_owner_tag: "FRA",
    parent_owner_tags: ["FRA"],
    lookup_iso2: "FR",
    release_lookup_iso2: "FR",
    preset_lookup_code: "BRI",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "western-europe",
    subregion_label: "Western Europe",
    hidden_from_country_list: true,
    catalog_order: 120,
    regional_presets: [
      makePreset("Brittany Core Territory", ["ui-shell-bri-core-1", "ui-shell-bri-core-2"], {
        preset_kind: "releasable_core",
        parent_owner_tag: "FRA",
      }),
      makePreset("Armorican Coast", ["ui-shell-bri-coast-1", "ui-shell-bri-coast-2"]),
    ],
  },
  SIC: {
    code: "SIC",
    tag: "SIC",
    display_name: "Sicily",
    display_name_en: "Sicily",
    entry_kind: "releasable",
    releasable: true,
    scenario_only: true,
    feature_count: 6,
    resolved_feature_count_hint: 6,
    color_hex: previewCountryColors.SIC,
    parent_owner_tag: "ITA",
    parent_owner_tags: ["ITA"],
    lookup_iso2: "IT",
    release_lookup_iso2: "IT",
    preset_lookup_code: "SIC",
    continent_id: "europe",
    continent_label: "Europe",
    subregion_id: "southern-europe",
    subregion_label: "Southern Europe",
    hidden_from_country_list: true,
    catalog_order: 130,
    regional_presets: [
      makePreset("Sicilian Core Territory", ["ui-shell-sic-core-1", "ui-shell-sic-core-2"], {
        preset_kind: "releasable_core",
        parent_owner_tag: "ITA",
      }),
      makePreset("Island Chain Preview", ["ui-shell-sic-island-1", "ui-shell-sic-island-2"]),
    ],
  },
});

const hierarchyGroups = Object.freeze({
  GER: [
    { id: "GER_major_regions", label: "German Major Regions", children: ["ui-shell-ger-rhine-1", "ui-shell-ger-prussia-1", "ui-shell-ger-bavaria-1"] },
    { id: "GER_southern_border", label: "Southern Border States", children: ["ui-shell-ger-bavaria-1", "ui-shell-ger-bavaria-2"] },
  ],
  FRA: [
    { id: "FRA_metropole", label: "French Metropole", children: ["ui-shell-fra-paris-1", "ui-shell-fra-atlantic-1", "ui-shell-fra-occitan-1"] },
  ],
  ITA: [
    { id: "ITA_peninsula", label: "Italian Peninsula", children: ["ui-shell-ita-north-1", "ui-shell-ita-south-1"] },
    { id: "ITA_islands", label: "Italian Islands", children: ["ui-shell-ita-sicily-1", "ui-shell-ita-sicily-2"] },
  ],
});

function clonePreviewValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPreviewReleasableIndex(countries) {
  const index = {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  };

  // 这里复用 releasable_manager 的 tag 归一化规则，让调试种子和真实 scenario releasable 保持同一套父子索引语义。
  Object.entries(countries).forEach(([rawCode, entry]) => {
    const code = normalizeCountryCode(rawCode);
    if (!code || !entry?.releasable) return;
    const parentTags = Array.isArray(entry.parent_owner_tags)
      ? entry.parent_owner_tags.map((value) => normalizeCountryCode(value)).filter(Boolean)
      : [];
    const parentOwnerTag = normalizeCountryCode(entry.parent_owner_tag) || parentTags[0] || "";
    index.byTag[code] = {
      ...clonePreviewValue(entry),
      tag: code,
      parent_owner_tag: parentOwnerTag,
      parent_owner_tags: parentTags.length ? parentTags : (parentOwnerTag ? [parentOwnerTag] : []),
    };
    index.byTag[code].parent_owner_tags.forEach((parentTag) => {
      if (!index.childTagsByParent[parentTag]) {
        index.childTagsByParent[parentTag] = [];
      }
      if (!index.childTagsByParent[parentTag].includes(code)) {
        index.childTagsByParent[parentTag].push(code);
      }
    });
  });

  return index;
}

function applyPreviewHierarchy(state) {
  // Inspector 同时读取 legacy 对象和 Map 结构；调试种子需要两边一起补水，避免只验证其中一条 UI 路径。
  state.hierarchyData = {
    labels: Object.fromEntries(
      Object.values(hierarchyGroups)
        .flat()
        .map((group) => [group.id, group.label])
    ),
    groups: Object.fromEntries(
      Object.values(hierarchyGroups)
        .flat()
        .map((group) => [group.id, [...group.children]])
    ),
  };
  state.hierarchyGroupsByCode = new Map(
    Object.entries(hierarchyGroups).map(([code, groups]) => [
      code,
      groups.map((group) => ({
        id: group.id,
        label: group.label,
        children: [...group.children],
      })),
    ])
  );
  state.countryGroupMetaByCode = new Map([
    ["GER", { continentId: "europe", continentLabel: "Europe", subregionId: "central-europe", subregionLabel: "Central Europe" }],
    ["DE", { continentId: "europe", continentLabel: "Europe", subregionId: "central-europe", subregionLabel: "Central Europe" }],
    ["FRA", { continentId: "europe", continentLabel: "Europe", subregionId: "western-europe", subregionLabel: "Western Europe" }],
    ["FR", { continentId: "europe", continentLabel: "Europe", subregionId: "western-europe", subregionLabel: "Western Europe" }],
    ["ITA", { continentId: "europe", continentLabel: "Europe", subregionId: "southern-europe", subregionLabel: "Southern Europe" }],
    ["IT", { continentId: "europe", continentLabel: "Europe", subregionId: "southern-europe", subregionLabel: "Southern Europe" }],
  ]);
}

function ensureUiShellInspectorDisclosureState(state) {
  if (!state.ui || typeof state.ui !== "object") {
    state.ui = {};
  }
  state.ui.rightSidebarTab = "inspector";
  state.ui.scenarioVisualAdjustmentsOpen = true;
  state.selectedInspectorCountryCode = UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE;
  state.inspectorHighlightCountryCode = UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE;
  state.activeSovereignCode = UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE;
  if (state.expandedInspectorContinents instanceof Set) {
    state.expandedInspectorContinents.add("ui-shell-europe-major");
  }
  if (state.expandedInspectorReleaseParents instanceof Set) {
    state.expandedInspectorReleaseParents.add("GER");
  }
}

function applyUiShellDebugTerritorySeed(state = runtimeState) {
  if (!state || typeof state !== "object") {
    return { seeded: false, selectedCountryCode: "" };
  }
  if (state.uiShellDebugTerritorySeeded) {
    return {
      seeded: false,
      selectedCountryCode: UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE,
      scenarioId: UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID,
    };
  }

  const countries = clonePreviewValue(previewCountries);
  // 该 scenario id 是 UI shell 专用的稳定哨兵，测试用它确认这里没有触发真实 scenario bundle 下载。
  state.activeScenarioId = UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID;
  state.scenarioCountriesByTag = countries;
  state.scenarioReleasableIndex = buildPreviewReleasableIndex(countries);
  state.countryNames = {
    ...(state.countryNames || {}),
    ...previewCountryNames,
  };
  state.countryPalette = {
    ...(state.countryPalette || {}),
    ...previewCountryColors,
  };
  applyPreviewHierarchy(state);
  ensureUiShellInspectorDisclosureState(state);
  setUiShellDebugTerritorySeededState(state, true);
  rebuildPresetState();

  return {
    seeded: true,
    selectedCountryCode: UI_SHELL_TERRITORY_PREVIEW_SELECTED_CODE,
    scenarioId: UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID,
    countryCount: Object.keys(countries).length,
  };
}

function revealUiShellDebugTerritoryPanels(documentRef = globalThis.document, state = runtimeState) {
  if (!state?.uiShellDebugTerritorySeeded || !documentRef) return;
  documentRef.body?.classList.add("app-ui-shell-territory-preview");
  // 先走真实 tab click，再直接展开关键 details，覆盖正常 sidebar 事件链和无事件环境两种测试入口。
  const inspectorTabButton = documentRef.querySelector("[data-inspector-tab=\"inspector\"]");
  if (typeof inspectorTabButton?.click === "function") {
    inspectorTabButton.click();
  }
  const countryInspectorSection = documentRef.getElementById("countryInspectorSection");
  const selectedCountryActionsSection = documentRef.getElementById("selectedCountryActionsSection");
  if (countryInspectorSection) {
    countryInspectorSection.open = true;
  }
  if (selectedCountryActionsSection) {
    selectedCountryActionsSection.classList.remove("hidden");
    selectedCountryActionsSection.setAttribute("aria-hidden", "false");
    selectedCountryActionsSection.open = true;
  }
  callRuntimeHook(state, "renderCountryListFn");
  callRuntimeHook(state, "renderPresetTreeFn");
}

export {
  UI_SHELL_TERRITORY_PREVIEW_SCENARIO_ID,
  applyUiShellDebugTerritorySeed,
  revealUiShellDebugTerritoryPanels,
};
