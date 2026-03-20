import { state } from "../core/state.js";
import * as mapRenderer from "../core/map_renderer.js";
import { recalculateScenarioOwnerControllerDiffCount, syncScenarioLocalizationState } from "../core/scenario_manager.js";
import { getFeatureOwnerCode } from "../core/sovereignty_manager.js";
import {
  applyOwnerControllerAssignmentsToFeatureIds,
  applyOwnerToFeatureIds,
  buildScenarioOwnershipSavePayload,
  filterEditableOwnershipFeatureIds,
  resetOwnersToScenarioBaselineForFeatureIds,
  summarizeOwnershipForFeatureIds,
} from "../core/scenario_ownership_editor.js";
import { buildScenarioReleasableIndex, rebuildPresetState } from "../core/releasable_manager.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  getScenarioDistrictCountryRecord,
  normalizeGeoCountryCode,
  normalizeScenarioDistrictGroupsPayload,
  resolveFeatureGeoCountryCode,
} from "../core/scenario_districts.js";
import { buildTooltipModel, t } from "./i18n.js";
import { showToast } from "./toast.js";

const DEV_WORKSPACE_STORAGE_KEY = "mapcreator_dev_workspace_expanded";
const TAG_CREATOR_RECENT_COLORS_STORAGE_KEY = "mapcreator_scenario_tag_recent_colors";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const TAG_CREATOR_FALLBACK_SWATCHES = [
  "#5D7CBA",
  "#B25D4E",
  "#6A9F58",
  "#C49B3B",
  "#7A64B3",
  "#3E8C8C",
  "#A64D79",
  "#C96B2C",
  "#4F6D7A",
  "#A23E48",
  "#708238",
  "#8E6C88",
];
const DEFAULT_TAG_CREATOR_COLOR = TAG_CREATOR_FALLBACK_SWATCHES[0];

function ui(key) {
  return t(key, "ui");
}

function localizeSelectionSummary(count) {
  return state.currentLanguage === "zh"
    ? `${count} 个地块已选。`
    : `${count} features selected.`;
}

function isLocalHost() {
  const host = String(globalThis.location?.hostname || "").trim().toLowerCase();
  return LOCAL_HOSTS.has(host);
}

function readStoredExpanded() {
  try {
    return localStorage.getItem(DEV_WORKSPACE_STORAGE_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function writeStoredExpanded(nextValue) {
  try {
    localStorage.setItem(DEV_WORKSPACE_STORAGE_KEY, nextValue ? "1" : "0");
  } catch (_error) {
    // Ignore storage failures in dev-only UI state.
  }
}

function resolveFeatureFromHit(hit) {
  if (!hit?.id) return null;
  if (hit.targetType === "special") return state.specialRegionsById?.get(hit.id) || null;
  if (hit.targetType === "water") return state.waterRegionsById?.get(hit.id) || null;
  return state.landIndex?.get(hit.id) || null;
}

function resolveFeatureName(feature, fallbackId = "") {
  const model = buildTooltipModel(feature);
  return String(model.regionName || model.lines?.[0] || fallbackId || "").trim();
}

function resolveNeighborCount(featureId) {
  const index = state.runtimeFeatureIndexById?.get(featureId);
  if (!Number.isInteger(index)) return "";
  const neighbors = state.runtimeNeighborGraph?.[index];
  return Array.isArray(neighbors) ? String(neighbors.filter((value) => Number.isInteger(value)).length) : "";
}

function sanitizeSelectionState() {
  const rawIds = Array.isArray(state.devSelectionOrder)
    ? state.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const nextIds = [];
  const seen = new Set();
  rawIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    const feature = state.landIndex?.get(id);
    if (!feature) return;
    seen.add(id);
    nextIds.push(id);
  });
  const changed = rawIds.length !== nextIds.length || rawIds.some((id, index) => id !== nextIds[index]);
  if (changed) {
    state.devSelectionOrder = nextIds;
    state.devSelectionFeatureIds = new Set(nextIds);
    state.devClipboardFallbackText = "";
    state.devSelectionOverlayDirty = true;
  } else if (!(state.devSelectionFeatureIds instanceof Set)) {
    state.devSelectionFeatureIds = new Set(nextIds);
  }
  return nextIds;
}

function resolveSelectionEntries() {
  return sanitizeSelectionState()
    .map((featureId, index) => {
      const feature = state.landIndex?.get(featureId);
      if (!feature) return null;
      return {
        id: featureId,
        index,
        name: resolveFeatureName(feature, featureId) || featureId,
      };
    })
    .filter(Boolean);
}

function sortSelectionEntries(entries = []) {
  const nextEntries = [...entries];
  if (state.devSelectionSortMode === "name") {
    nextEntries.sort((a, b) => {
      const nameDelta = a.name.localeCompare(b.name);
      if (nameDelta !== 0) return nameDelta;
      return a.id.localeCompare(b.id);
    });
  }
  return nextEntries;
}

function buildClipboardText(format = "names_with_ids") {
  const entries = sortSelectionEntries(resolveSelectionEntries());
  if (!entries.length) return "";
  if (format === "names") {
    return entries.map((entry) => entry.name).join("\n");
  }
  if (format === "ids") {
    return entries.map((entry) => entry.id).join("\n");
  }
  return entries.map((entry) => `${entry.name} | ${entry.id}`).join("\n");
}

function normalizeOwnerInput(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeScenarioTagInput(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeScenarioNameInput(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeScenarioColorInput(value) {
  const text = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!text) return "";
  return text.startsWith("#") ? text : `#${text}`;
}

function sanitizeScenarioColorList(values = [], limit = 10) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeScenarioColorInput(value))
      .filter((color) => /^#[0-9A-F]{6}$/.test(color))
  )).slice(0, limit);
}

function readStoredTagCreatorRecentColors() {
  try {
    return sanitizeScenarioColorList(JSON.parse(localStorage.getItem(TAG_CREATOR_RECENT_COLORS_STORAGE_KEY) || "[]"));
  } catch (_error) {
    return [];
  }
}

function writeStoredTagCreatorRecentColors(colors = []) {
  try {
    localStorage.setItem(
      TAG_CREATOR_RECENT_COLORS_STORAGE_KEY,
      JSON.stringify(sanitizeScenarioColorList(colors))
    );
  } catch (_error) {
    // Ignore storage failures in dev-only UI state.
  }
}

function ensureTagCreatorState() {
  const current = state.devScenarioTagCreator || {};
  const needsRecentLoad = !current.recentColorsLoaded;
  const nextRecentColors = needsRecentLoad
    ? readStoredTagCreatorRecentColors()
    : sanitizeScenarioColorList(current.recentColors);
  const nextState = {
    duplicateTag: false,
    tagLengthHint: "",
    isColorPopoverOpen: false,
    recentColors: [],
    recentColorsLoaded: false,
    ...current,
    colorHex: normalizeScenarioColorInput(current.colorHex) || DEFAULT_TAG_CREATOR_COLOR,
    recentColors: nextRecentColors,
    recentColorsLoaded: true,
  };
  if (
    current.colorHex !== nextState.colorHex
    || current.recentColorsLoaded !== nextState.recentColorsLoaded
    || current.isColorPopoverOpen !== nextState.isColorPopoverOpen
    || current.duplicateTag !== nextState.duplicateTag
    || current.tagLengthHint !== nextState.tagLengthHint
    || JSON.stringify(current.recentColors || []) !== JSON.stringify(nextState.recentColors)
  ) {
    state.devScenarioTagCreator = nextState;
  }
  return state.devScenarioTagCreator || nextState;
}

function pushRecentTagColor(colorHex) {
  const normalizedColor = normalizeScenarioColorInput(colorHex);
  if (!/^#[0-9A-F]{6}$/.test(normalizedColor)) return;
  const creatorState = ensureTagCreatorState();
  const priorColors = sanitizeScenarioColorList(creatorState.recentColors);
  const nextRecentColors = [
    normalizedColor,
    ...priorColors.filter((value) => normalizeScenarioColorInput(value) !== normalizedColor),
  ].slice(0, 10);
  state.devScenarioTagCreator = {
    ...creatorState,
    recentColors: nextRecentColors,
  };
  writeStoredTagCreatorRecentColors(nextRecentColors);
}

function buildTagCreatorPaletteRows() {
  const paletteSwatches = Array.isArray(state.paletteQuickSwatches)
    ? state.paletteQuickSwatches.map((entry) => normalizeScenarioColorInput(entry?.color)).filter(Boolean)
    : [];
  const paletteColors = Array.from(new Set([...paletteSwatches, ...TAG_CREATOR_FALLBACK_SWATCHES]))
    .filter((color) => /^#[0-9A-F]{6}$/.test(color))
    .slice(0, 18);
  const recentColors = sanitizeScenarioColorList(ensureTagCreatorState().recentColors);
  return {
    paletteColors,
    recentColors,
  };
}

function deriveTagCreatorUiState(tagValue = "") {
  const normalizedTag = normalizeScenarioTagInput(tagValue);
  const hasValidLength = /^[A-Z]{2,4}$/.test(normalizedTag);
  const duplicateTag = !!(normalizedTag && state.scenarioCountriesByTag?.[normalizedTag]);
  return {
    normalizedTag,
    duplicateTag,
    tagLengthHint: hasValidLength && normalizedTag.length !== 3
      ? ui("Three-letter tags are recommended.")
      : "",
  };
}

function syncTagCreatorDerivedState() {
  const creatorState = ensureTagCreatorState();
  const derived = deriveTagCreatorUiState(creatorState.tag);
  if (
    creatorState.duplicateTag !== derived.duplicateTag
    || creatorState.tagLengthHint !== derived.tagLengthHint
  ) {
    state.devScenarioTagCreator = {
      ...creatorState,
      duplicateTag: derived.duplicateTag,
      tagLengthHint: derived.tagLengthHint,
    };
  }
  return {
    ...(state.devScenarioTagCreator || creatorState),
    ...derived,
  };
}

function resetTagCreatorForm({ preserveStatus = false } = {}) {
  const creatorState = ensureTagCreatorState();
  state.devScenarioTagCreator = {
    ...creatorState,
    tag: "",
    nameEn: "",
    nameZh: "",
    colorHex: DEFAULT_TAG_CREATOR_COLOR,
    parentOwnerTag: "",
    duplicateTag: false,
    tagLengthHint: "",
    isColorPopoverOpen: false,
    isSaving: false,
    ...(preserveStatus
      ? {}
      : {
        lastSavedAt: "",
        lastSavedPath: "",
        lastSaveMessage: "",
        lastSaveTone: "",
      }),
  };
}

function resolveOwnershipTargetIds() {
  const selectedIds = filterEditableOwnershipFeatureIds(sanitizeSelectionState()).matchedIds;
  if (selectedIds.length > 0) {
    return selectedIds;
  }
  const selectedId = state.devSelectedHit?.targetType === "land"
    ? String(state.devSelectedHit.id || "").trim()
    : "";
  return filterEditableOwnershipFeatureIds(selectedId ? [selectedId] : []).matchedIds;
}

function resolveOwnershipEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const summary = summarizeOwnershipForFeatureIds(targetIds);
  const singleFeatureId = targetIds.length === 1 ? targetIds[0] : "";
  const singleFeature = singleFeatureId ? state.landIndex?.get(singleFeatureId) || null : null;
  const currentOwnerCode = singleFeatureId ? normalizeOwnerInput(getFeatureOwnerCode(singleFeatureId)) : "";
  const currentControllerCode = singleFeatureId
    ? normalizeOwnerInput(state.scenarioControllersByFeatureId?.[singleFeatureId] || currentOwnerCode)
    : "";
  return {
    targetIds,
    selectionCount: targetIds.length,
    singleFeatureId,
    singleFeature,
    currentOwnerCode,
    currentControllerCode,
    ownerCodes: summary.ownerCodes,
    isMixedOwner: summary.isMixed,
  };
}

function buildOwnershipMetaRows(model) {
  if (!model.selectionCount) return [];
  if (model.singleFeatureId) {
    return [
      ["ID", model.singleFeatureId],
      [ui("Name"), resolveFeatureName(model.singleFeature, model.singleFeatureId)],
      [ui("Owner"), model.currentOwnerCode],
      [ui("Controller"), model.currentControllerCode],
    ].filter(([, value]) => String(value || "").trim());
  }
  return [
    [ui("Selected"), String(model.selectionCount)],
    [
      ui("Owner"),
      model.isMixedOwner
        ? `${ui("Mixed")} (${model.ownerCodes.join(", ")})`
        : (model.ownerCodes[0] || ui("Unknown")),
    ],
  ];
}

function resolveOwnershipEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit and save political ownership.");
  }
  if (!model.selectionCount) {
    return ui("Select one or more land features to edit political ownership.");
  }
  if (model.singleFeatureId) {
    return ui("Apply a new owner tag to the selected feature or reset it to the active scenario baseline.");
  }
  return ui("Apply one owner tag across the current selection or reset those features to the active scenario baseline.");
}

function resolveTagCreatorTargetIds() {
  return resolveOwnershipTargetIds();
}

function resolveTagCreatorModel() {
  const targetIds = resolveTagCreatorTargetIds();
  const ownershipModel = resolveOwnershipEditorModel();
  const singleFeatureId = targetIds.length === 1 ? targetIds[0] : "";
  const singleFeature = singleFeatureId ? state.landIndex?.get(singleFeatureId) || null : null;
  return {
    targetIds,
    selectionCount: targetIds.length,
    singleFeatureId,
    singleFeature,
    ownerCodes: ownershipModel.ownerCodes,
    isMixedOwner: ownershipModel.isMixedOwner,
    currentOwnerCode: ownershipModel.currentOwnerCode,
    currentControllerCode: ownershipModel.currentControllerCode,
  };
}

function buildTagCreatorMetaRows(model) {
  return buildOwnershipMetaRows(model);
}

function resolveTagCreatorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to create and assign a new tag.");
  }
  if (!model.selectionCount) {
    return ui("Select one or more land features to create a new scenario tag.");
  }
  return ui("Create a new scenario tag, optionally set a parent owner, and assign the current selection immediately.");
}

function validateTagCreatorInput({ tag = "", nameEn = "", nameZh = "", colorHex = "", parentOwnerTag = "" } = {}, targetIds = []) {
  const tagUiState = deriveTagCreatorUiState(tag);
  const normalizedTag = tagUiState.normalizedTag;
  const normalizedNameEn = normalizeScenarioNameInput(nameEn);
  const normalizedNameZh = normalizeScenarioNameInput(nameZh);
  const normalizedColorHex = normalizeScenarioColorInput(colorHex);
  const normalizedParentOwnerTag = normalizeScenarioTagInput(parentOwnerTag);
  const activeScenario = String(state.activeScenarioId || "").trim();

  if (!activeScenario) {
    return { ok: false, message: ui("Activate a scenario to create a new tag.") };
  }
  if (!targetIds.length) {
    return { ok: false, message: ui("Select one or more land features before creating a tag.") };
  }
  if (!/^[A-Z]{2,4}$/.test(normalizedTag)) {
    return {
      ok: false,
      code: "invalid-tag",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("Tag must be 2-4 uppercase letters."),
    };
  }
  if (tagUiState.duplicateTag) {
    return {
      ok: false,
      code: "duplicate-tag",
      duplicateTag: true,
      tagLengthHint: "",
      message: ui("That tag already exists in the active scenario."),
    };
  }
  if (!normalizedNameEn) {
    return {
      ok: false,
      code: "missing-name-en",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("English name is required."),
    };
  }
  if (!normalizedNameZh) {
    return {
      ok: false,
      code: "missing-name-zh",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("Chinese name is required."),
    };
  }
  if (!/^#[0-9A-F]{6}$/.test(normalizedColorHex)) {
    return {
      ok: false,
      code: "invalid-color",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("Color must be a hex value like #5D7CBA."),
    };
  }
  if (normalizedParentOwnerTag && !/^[A-Z]{2,4}$/.test(normalizedParentOwnerTag)) {
    return {
      ok: false,
      code: "invalid-parent-tag",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("Parent owner tag must be 2-4 uppercase letters."),
    };
  }
  if (normalizedParentOwnerTag && normalizedParentOwnerTag === normalizedTag) {
    return {
      ok: false,
      code: "matching-parent-tag",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("Parent owner tag cannot match the new tag."),
    };
  }
  if (normalizedParentOwnerTag && !state.scenarioCountriesByTag?.[normalizedParentOwnerTag]) {
    return {
      ok: false,
      code: "missing-parent-tag",
      duplicateTag: false,
      tagLengthHint: tagUiState.tagLengthHint,
      message: ui("Parent owner tag does not exist in the active scenario."),
    };
  }
  return {
    ok: true,
    code: "",
    duplicateTag: false,
    tagLengthHint: tagUiState.tagLengthHint,
    message: "",
    values: {
      tag: normalizedTag,
      nameEn: normalizedNameEn,
      nameZh: normalizedNameZh,
      colorHex: normalizedColorHex,
      parentOwnerTag: normalizedParentOwnerTag,
    },
  };
}

function buildScenarioTagCreatorPayload() {
  const targetIds = resolveTagCreatorTargetIds();
  const editorState = state.devScenarioTagCreator || {};
  const validation = validateTagCreatorInput(editorState, targetIds);
  if (!validation.ok) {
    return {
      ok: false,
      validation,
      targetIds,
      payload: null,
    };
  }
  return {
    ok: true,
    validation,
    targetIds,
    payload: {
      scenarioId: String(state.activeScenarioId || "").trim(),
      featureIds: [...targetIds],
      ...validation.values,
    },
  };
}

function createScenarioCountryEntryFromTagCreator({ tag, nameEn, nameZh, colorHex, parentOwnerTag }, targetIds = []) {
  const featureCount = Array.isArray(targetIds) ? targetIds.length : 0;
  const entry = {
    tag,
    display_name: nameEn,
    display_name_en: nameEn,
    display_name_zh: nameZh,
    color_hex: colorHex,
    feature_count: featureCount,
    controller_feature_count: featureCount,
    scenario_only: true,
    featured: false,
    synthetic_owner: false,
    source: "manual_rule",
    source_type: "scenario_extension",
    quality: "manual_reviewed",
    entry_kind: "scenario_subject",
    subject_kind: "created_tag",
  };
  if (parentOwnerTag) {
    entry.parent_owner_tag = parentOwnerTag;
    entry.parent_owner_tags = [parentOwnerTag];
  } else {
    entry.parent_owner_tag = "";
    entry.parent_owner_tags = [];
  }
  return entry;
}

function applyScenarioTagCreatorSuccess(response, payload, targetIds = []) {
  const normalizedTag = String(payload?.tag || "").trim().toUpperCase();
  if (!normalizedTag) return;
  const normalizedNameEn = normalizeScenarioNameInput(payload?.nameEn);
  const normalizedNameZh = normalizeScenarioNameInput(payload?.nameZh);
  const normalizedColorHex = normalizeScenarioColorInput(payload?.colorHex);
  pushRecentTagColor(normalizedColorHex);
  const createdEntry = createScenarioCountryEntryFromTagCreator(
    {
      tag: normalizedTag,
      nameEn: normalizedNameEn,
      nameZh: normalizedNameZh,
      colorHex: normalizedColorHex,
      parentOwnerTag: normalizeScenarioTagInput(payload?.parentOwnerTag),
    },
    targetIds
  );
  const responseCountry = response?.countryEntry && typeof response.countryEntry === "object"
    ? response.countryEntry
    : (response?.country && typeof response.country === "object"
      ? response.country
      : (response?.scenarioCountry && typeof response.scenarioCountry === "object" ? response.scenarioCountry : null));
  const nextCountryEntry = responseCountry ? { ...createdEntry, ...responseCountry, tag: normalizedTag } : createdEntry;
  state.scenarioCountriesByTag = {
    ...(state.scenarioCountriesByTag || {}),
    [normalizedTag]: nextCountryEntry,
  };
  state.scenarioFixedOwnerColors = {
    ...(state.scenarioFixedOwnerColors || {}),
    [normalizedTag]: normalizedColorHex,
  };
  state.sovereignBaseColors = {
    ...(state.sovereignBaseColors || {}),
    [normalizedTag]: normalizedColorHex,
  };
  state.countryBaseColors = {
    ...(state.countryBaseColors || {}),
    [normalizedTag]: normalizedColorHex,
  };
  applyOwnerControllerAssignmentsToFeatureIds(
    targetIds.reduce((accumulator, featureId) => {
      const id = String(featureId || "").trim();
      if (!id) return accumulator;
      accumulator[id] = {
        ownerCode: normalizedTag,
        controllerCode: normalizedTag,
      };
      return accumulator;
    }, {}),
    {
      historyKind: "dev-workspace-tag-create",
      dirtyReason: "dev-workspace-tag-create",
      recomputeReason: "dev-workspace-tag-create",
      render: false,
    }
  );
  const nextBaselineOwners = { ...(state.scenarioBaselineOwnersByFeatureId || {}) };
  const nextBaselineControllers = { ...(state.scenarioBaselineControllersByFeatureId || {}) };
  targetIds.forEach((featureId) => {
    const id = String(featureId || "").trim();
    if (!id) return;
    nextBaselineOwners[id] = normalizedTag;
    nextBaselineControllers[id] = normalizedTag;
  });
  state.scenarioBaselineOwnersByFeatureId = nextBaselineOwners;
  state.scenarioBaselineControllersByFeatureId = nextBaselineControllers;
  if (response?.catalogPath) {
    state.activeScenarioManifest = {
      ...(state.activeScenarioManifest || {}),
      releasable_catalog_url: String(response.catalogPath || ""),
    };
  }
  if (response?.releasableEntry && typeof response.releasableEntry === "object") {
    const priorCatalog = state.releasableCatalog && typeof state.releasableCatalog === "object"
      ? state.releasableCatalog
      : { version: 1, entries: [] };
    const priorEntries = Array.isArray(priorCatalog.entries) ? priorCatalog.entries : [];
    const nextEntries = [
      ...priorEntries.filter((entry) => String(entry?.tag || "").trim().toUpperCase() !== normalizedTag),
      response.releasableEntry,
    ];
    state.releasableCatalog = {
      ...priorCatalog,
      scenario_ids: [String(state.activeScenarioId || "").trim()],
      entries: nextEntries,
    };
    state.scenarioReleasableIndex = buildScenarioReleasableIndex(state.activeScenarioId, {
      excludeTags: Object.keys(state.scenarioCountriesByTag || {}),
    });
    rebuildPresetState();
  }
  state.activeSovereignCode = normalizedTag;
  state.devScenarioEditor = {
    ...(state.devScenarioEditor || {}),
    targetOwnerCode: normalizedTag,
  };
  state.selectedInspectorCountryCode = normalizedTag;
  state.inspectorHighlightCountryCode = normalizedTag;
  recalculateScenarioOwnerControllerDiffCount();
  mapRenderer.refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
  mapRenderer.scheduleDynamicBorderRecompute("dev-workspace-tag-create", 90);
  if (typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
}

function updateDistrictEditorState(nextPartial = {}) {
  const current = state.devScenarioDistrictEditor || {};
  state.devScenarioDistrictEditor = {
    countryMode: "auto",
    manualCountryCode: "",
    inferredCountryCode: "",
    ...current,
    ...nextPartial,
  };
}

function clearDistrictEditorForm({ preserveStatus = false } = {}) {
  const current = state.devScenarioDistrictEditor || {};
  updateDistrictEditorState({
    ...current,
    countryCode: "",
    countryMode: "auto",
    manualCountryCode: "",
    inferredCountryCode: "",
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
    loadedScenarioId: "",
    loadedCountryCode: "",
    draftCountry: null,
    isSaving: false,
    ...(preserveStatus
      ? {}
      : {
        lastSavedAt: "",
        lastSavedPath: "",
        lastSaveMessage: "",
        lastSaveTone: "",
      }),
  });
}

function setDistrictDraftCountry(countryCode = "", draftCountry = null, nextOverrides = {}) {
  const normalizedCountryCode = normalizeGeoCountryCode(countryCode);
  const nextDraftCountry = cloneDistrictCountryRecord(normalizedCountryCode, draftCountry);
  const districtIds = Object.keys(nextDraftCountry.districts || {});
  const requestedDistrictId = normalizeScenarioDistrictId(
    nextOverrides.selectedDistrictId ?? state.devScenarioDistrictEditor?.selectedDistrictId
  );
  const selectedDistrictId = districtIds.includes(requestedDistrictId)
    ? requestedDistrictId
    : (requestedDistrictId === "" ? "" : (districtIds[0] || ""));
  const selectedDistrict = selectedDistrictId ? nextDraftCountry.districts?.[selectedDistrictId] || null : null;
  updateDistrictEditorState({
    countryCode: normalizedCountryCode,
    loadedScenarioId: String(state.activeScenarioId || ""),
    loadedCountryCode: normalizedCountryCode,
    draftCountry: nextDraftCountry,
    selectedDistrictId,
    nameEn: normalizeScenarioNameInput(nextOverrides.nameEn ?? selectedDistrict?.name_en ?? ""),
    nameZh: normalizeScenarioNameInput(nextOverrides.nameZh ?? selectedDistrict?.name_zh ?? ""),
    ...nextOverrides,
  });
}

function syncScenarioDistrictState(countryCode = "", countryPayload = null) {
  const normalizedCountryCode = normalizeGeoCountryCode(countryCode);
  const nextPayload = normalizeScenarioDistrictGroupsPayload(
    {
      ...(state.scenarioDistrictGroupsData || {}),
      scenario_id: String(state.activeScenarioId || ""),
      countries: {
        ...((state.scenarioDistrictGroupsData && state.scenarioDistrictGroupsData.countries) || {}),
        [normalizedCountryCode]: countryPayload,
      },
    },
    state.activeScenarioId
  );
  state.scenarioDistrictGroupsData = nextPayload;
  state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(nextPayload);
}

function normalizeScenarioDistrictId(value) {
  return String(value || "").trim().replace(/\s+/g, "_");
}

function cloneDistrictCountryRecord(countryCode = "", record = null) {
  const normalizedCountryCode = normalizeGeoCountryCode(countryCode);
  const districts = {};
  const sourceDistricts = record?.districts && typeof record.districts === "object" ? record.districts : {};
  Object.entries(sourceDistricts).forEach(([districtId, rawDistrict]) => {
    const normalizedDistrictId = normalizeScenarioDistrictId(rawDistrict?.id || rawDistrict?.district_id || districtId);
    if (!normalizedDistrictId) return;
    districts[normalizedDistrictId] = {
      id: normalizedDistrictId,
      name_en: normalizeScenarioNameInput(rawDistrict?.name_en || rawDistrict?.nameEn || ""),
      name_zh: normalizeScenarioNameInput(rawDistrict?.name_zh || rawDistrict?.nameZh || ""),
      feature_ids: Array.from(new Set(
        (Array.isArray(rawDistrict?.feature_ids) ? rawDistrict.feature_ids : [])
          .map((featureId) => String(featureId || "").trim())
          .filter(Boolean)
      )).sort((left, right) => left.localeCompare(right)),
    };
  });
  return {
    country_code: normalizedCountryCode,
    districts,
  };
}

function resolveSelectionGeoCountryCodes(targetIds = []) {
  return Array.from(new Set(
    (Array.isArray(targetIds) ? targetIds : [])
      .map((featureId) => state.landIndex?.get(featureId))
      .filter(Boolean)
      .map((feature) => resolveFeatureGeoCountryCode(feature))
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
}

function ensureDistrictDraftForCountry(countryCode = "") {
  const normalizedCountryCode = normalizeGeoCountryCode(countryCode);
  const priorState = state.devScenarioDistrictEditor || {};
  if (!normalizedCountryCode || !state.activeScenarioId) {
    return {
      ...priorState,
      draftCountry: null,
    };
  }
  const needsReload =
    String(priorState.loadedScenarioId || "") !== String(state.activeScenarioId || "")
    || normalizeGeoCountryCode(priorState.loadedCountryCode) !== normalizedCountryCode
    || !priorState.draftCountry;
  if (!needsReload) {
    return priorState;
  }
  const savedCountry = cloneDistrictCountryRecord(
    normalizedCountryCode,
    getScenarioDistrictCountryRecord(state.scenarioDistrictGroupsData, normalizedCountryCode)
  );
  const districtIds = Object.keys(savedCountry.districts);
  const normalizedSelectedDistrictId = normalizeScenarioDistrictId(priorState.selectedDistrictId);
  const nextSelectedDistrictId = districtIds.includes(normalizedSelectedDistrictId)
    ? normalizedSelectedDistrictId
    : (normalizedSelectedDistrictId === "" ? "" : (districtIds[0] || ""));
  const selectedDistrict = nextSelectedDistrictId ? savedCountry.districts[nextSelectedDistrictId] || null : null;
  const nextState = {
    ...priorState,
    countryCode: normalizedCountryCode,
    loadedScenarioId: String(state.activeScenarioId || ""),
    loadedCountryCode: normalizedCountryCode,
    draftCountry: savedCountry,
    selectedDistrictId: nextSelectedDistrictId,
    nameEn: normalizeScenarioNameInput(selectedDistrict?.name_en || ""),
    nameZh: normalizeScenarioNameInput(selectedDistrict?.name_zh || ""),
  };
  state.devScenarioDistrictEditor = nextState;
  return nextState;
}

function resetDistrictEditorForm({ clearStatus = true } = {}) {
  updateDistrictEditorState({
    countryCode: "",
    countryMode: "auto",
    manualCountryCode: "",
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
    draftCountry: null,
    loadedCountryCode: "",
    loadedScenarioId: String(state.activeScenarioId || ""),
    ...(clearStatus
      ? {
        lastSaveMessage: "",
        lastSaveTone: "",
      }
      : {}),
  });
}

function resolveDistrictEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const selectionGeoCountryCodes = resolveSelectionGeoCountryCodes(targetIds);
  const inferredCountryCode = selectionGeoCountryCodes.length === 1 ? selectionGeoCountryCodes[0] : "";
  const editorBaseState = state.devScenarioDistrictEditor || {};
  const manualCountryCode = normalizeGeoCountryCode(editorBaseState.manualCountryCode);
  const isManualMode = editorBaseState.countryMode === "manual" && !!manualCountryCode;
  const countryMode = isManualMode ? "manual" : "auto";
  const countryCode = countryMode === "manual" ? manualCountryCode : inferredCountryCode;
  if (
    editorBaseState.inferredCountryCode !== inferredCountryCode
    || editorBaseState.countryMode !== countryMode
    || editorBaseState.countryCode !== countryCode
  ) {
    updateDistrictEditorState({
      inferredCountryCode,
      countryMode,
      countryCode,
    });
  }
  const editorState = ensureDistrictDraftForCountry(countryCode);
  const draftCountry = editorState?.draftCountry
    ? cloneDistrictCountryRecord(countryCode, editorState.draftCountry)
    : cloneDistrictCountryRecord(countryCode, null);
  const districtEntries = Object.values(draftCountry?.districts || {}).sort((left, right) => {
    const leftName = normalizeScenarioNameInput(left?.name_en || left?.name_zh || left?.id || "");
    const rightName = normalizeScenarioNameInput(right?.name_en || right?.name_zh || right?.id || "");
    return leftName.localeCompare(rightName) || String(left?.id || "").localeCompare(String(right?.id || ""));
  });
  const selectedDistrictId = normalizeScenarioDistrictId(editorState?.selectedDistrictId);
  const selectedDistrict = selectedDistrictId ? draftCountry?.districts?.[selectedDistrictId] || null : null;
  return {
    targetIds,
    selectionCount: targetIds.length,
    selectionGeoCountryCodes,
    countryMode,
    manualCountryCode,
    inferredCountryCode,
    countryCode,
    draftCountry,
    districtEntries,
    selectedDistrictId,
    selectedDistrict,
    canInferCountry: selectionGeoCountryCodes.length === 1,
    canUseSelectionCountry: !!inferredCountryCode,
    hasEffectiveCountry: !!countryCode,
    isAutoMode: countryMode === "auto",
  };
}

function buildDistrictMetaRows(model) {
  const rows = [];
  rows.push([ui("Mode"), model.isAutoMode ? ui("Auto") : ui("Manual")]);
  if (model.countryCode) {
    rows.push([ui("Geo Country"), model.countryCode]);
  }
  if (model.selectionGeoCountryCodes.length > 1) {
    rows.push([ui("Selection Countries"), model.selectionGeoCountryCodes.join(", ")]);
  }
  if (model.selectionCount) {
    rows.push([ui("Selected"), String(model.selectionCount)]);
  }
  if (model.selectedDistrict) {
    rows.push([ui("District"), model.selectedDistrict.name_en || model.selectedDistrict.name_zh || model.selectedDistrict.id]);
    rows.push([ui("Feature Count"), String((model.selectedDistrict.feature_ids || []).length)]);
  } else if (model.districtEntries.length) {
    rows.push([ui("District Count"), String(model.districtEntries.length)]);
  }
  return rows.filter(([, value]) => String(value || "").trim());
}

function resolveDistrictEditorHint(model) {
  if (!state.activeScenarioId) {
    return ui("Activate a scenario to edit district groups.");
  }
  if (!model.countryCode && model.isAutoMode) {
    return ui("Select land features from one geo country or type a country code manually to edit districts.");
  }
  if (!model.countryCode && !model.isAutoMode) {
    return ui("Type a geo country code manually or switch back to the current selection country.");
  }
  if (model.selectionGeoCountryCodes.length > 1) {
    return ui("The current selection spans multiple geo countries. District assignment only uses features from the selected country code.");
  }
  if (!model.isAutoMode) {
    return ui("Manual geo country override is active. District assignment only uses features that match the typed country code.");
  }
  return ui("Create or update a district, assign the current selection, then save the full country payload.");
}

function buildDistrictSavePayload(model) {
  const districts = Object.values(model?.draftCountry?.districts || {}).map((district) => ({
    districtId: normalizeScenarioDistrictId(district?.id),
    nameEn: normalizeScenarioNameInput(district?.name_en),
    nameZh: normalizeScenarioNameInput(district?.name_zh),
    featureIds: Array.from(new Set(
      (Array.isArray(district?.feature_ids) ? district.feature_ids : [])
        .map((featureId) => String(featureId || "").trim())
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right)),
  }));
  return {
    scenarioId: String(state.activeScenarioId || "").trim(),
    countryCode: normalizeGeoCountryCode(model?.countryCode),
    districts,
  };
}

function selectDistrictDraft(districtId = "") {
  const editorState = state.devScenarioDistrictEditor || {};
  const draftCountry = cloneDistrictCountryRecord(editorState.countryCode, editorState.draftCountry);
  const normalizedDistrictId = normalizeScenarioDistrictId(districtId);
  const selectedDistrict = normalizedDistrictId ? draftCountry.districts?.[normalizedDistrictId] || null : null;
  updateDistrictEditorState({
    draftCountry,
    selectedDistrictId: normalizedDistrictId,
    nameEn: normalizeScenarioNameInput(selectedDistrict?.name_en || ""),
    nameZh: normalizeScenarioNameInput(selectedDistrict?.name_zh || ""),
  });
}

function upsertDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  const nameEn = normalizeScenarioNameInput(state.devScenarioDistrictEditor?.nameEn);
  const nameZh = normalizeScenarioNameInput(state.devScenarioDistrictEditor?.nameZh);
  if (!model.countryCode || !districtId || !nameEn || !nameZh) {
    return {
      ok: false,
      message: ui("Country code, district id, English name, and Chinese name are required."),
    };
  }
  const nextDraftCountry = cloneDistrictCountryRecord(model.countryCode, model.draftCountry);
  const duplicateDistrict = Object.values(nextDraftCountry.districts || {}).find((district) => {
    if (!district || String(district.id || "") === districtId) return false;
    return String(district.name_en || "").trim().toLowerCase() === nameEn.toLowerCase()
      || String(district.name_zh || "").trim().toLowerCase() === nameZh.toLowerCase();
  });
  if (duplicateDistrict) {
    return {
      ok: false,
      message: ui("District names must be unique within the selected country."),
    };
  }
  const priorDistrict = nextDraftCountry.districts?.[districtId] || null;
  nextDraftCountry.districts[districtId] = {
    id: districtId,
    name_en: nameEn,
    name_zh: nameZh,
    feature_ids: Array.isArray(priorDistrict?.feature_ids) ? [...priorDistrict.feature_ids] : [],
  };
  setDistrictDraftCountry(model.countryCode, nextDraftCountry, {
    selectedDistrictId: districtId,
    nameEn,
    nameZh,
  });
  updateDistrictEditorState({
    lastSaveMessage: priorDistrict ? ui("District draft updated.") : ui("District draft created."),
    lastSaveTone: "info",
  });
  return { ok: true };
}

function assignSelectionToDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  if (!model.countryCode || !districtId) {
    return {
      ok: false,
      message: ui("Select a country and district before assigning features."),
    };
  }
  const selectionIds = model.targetIds.filter((featureId) => {
    const feature = state.landIndex?.get(featureId) || null;
    return feature && resolveFeatureGeoCountryCode(feature) === model.countryCode;
  });
  if (!selectionIds.length) {
    return {
      ok: false,
      message: ui("Select one or more land features from the chosen geo country."),
    };
  }
  const nextDraftCountry = cloneDistrictCountryRecord(model.countryCode, model.draftCountry);
  const district = nextDraftCountry.districts?.[districtId];
  if (!district) {
    return {
      ok: false,
      message: ui("Create the district before assigning features."),
    };
  }
  Object.values(nextDraftCountry.districts || {}).forEach((entry) => {
    entry.feature_ids = (Array.isArray(entry.feature_ids) ? entry.feature_ids : []).filter(
      (featureId) => !selectionIds.includes(featureId)
    );
  });
  district.feature_ids = Array.from(new Set([
    ...(Array.isArray(district.feature_ids) ? district.feature_ids : []),
    ...selectionIds,
  ])).sort((left, right) => left.localeCompare(right));
  setDistrictDraftCountry(model.countryCode, nextDraftCountry, {
    selectedDistrictId: districtId,
  });
  updateDistrictEditorState({
    lastSaveMessage: ui("Selection assigned to the district draft."),
    lastSaveTone: "info",
  });
  return { ok: true, count: selectionIds.length };
}

function removeSelectionFromDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  if (!model.countryCode || !districtId) {
    return {
      ok: false,
      message: ui("Select a country and district before removing features."),
    };
  }
  const selectionIds = model.targetIds.filter((featureId) => {
    const feature = state.landIndex?.get(featureId) || null;
    return feature && resolveFeatureGeoCountryCode(feature) === model.countryCode;
  });
  if (!selectionIds.length) {
    return {
      ok: false,
      message: ui("Select one or more land features from the chosen geo country."),
    };
  }
  const nextDraftCountry = cloneDistrictCountryRecord(model.countryCode, model.draftCountry);
  const district = nextDraftCountry.districts?.[districtId];
  if (!district) {
    return {
      ok: false,
      message: ui("Select a district before removing features."),
    };
  }
  const beforeCount = Array.isArray(district.feature_ids) ? district.feature_ids.length : 0;
  district.feature_ids = (Array.isArray(district.feature_ids) ? district.feature_ids : []).filter(
    (featureId) => !selectionIds.includes(featureId)
  );
  const removedCount = Math.max(beforeCount - district.feature_ids.length, 0);
  setDistrictDraftCountry(model.countryCode, nextDraftCountry, {
    selectedDistrictId: districtId,
  });
  updateDistrictEditorState({
    lastSaveMessage: removedCount > 0
      ? ui("Selection removed from the district draft.")
      : ui("Selected features were not assigned to the current district draft."),
    lastSaveTone: removedCount > 0 ? "info" : "warning",
  });
  return { ok: removedCount > 0, count: removedCount };
}

function deleteDistrictDraft(model) {
  const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
  if (!model.countryCode || !districtId) {
    return {
      ok: false,
      message: ui("Select a district before deleting it."),
    };
  }
  const nextDraftCountry = cloneDistrictCountryRecord(model.countryCode, model.draftCountry);
  const district = nextDraftCountry.districts?.[districtId];
  if (!district) {
    return {
      ok: false,
      message: ui("Select a district before deleting it."),
    };
  }
  if (Array.isArray(district.feature_ids) && district.feature_ids.length > 0) {
    return {
      ok: false,
      message: ui("Remove all assigned features before deleting a district."),
    };
  }
  delete nextDraftCountry.districts[districtId];
  setDistrictDraftCountry(model.countryCode, nextDraftCountry, {
    selectedDistrictId: "",
    nameEn: "",
    nameZh: "",
  });
  updateDistrictEditorState({
    lastSaveMessage: ui("District draft deleted."),
    lastSaveTone: "info",
  });
  return { ok: true };
}

function normalizeLocaleInput(value) {
  return String(value || "").trim();
}

function getScenarioGeoLocaleEntry(featureId) {
  const normalizedFeatureId = String(featureId || "").trim();
  const baseEntry = normalizedFeatureId
    ? (state.baseGeoLocales?.[normalizedFeatureId] && typeof state.baseGeoLocales[normalizedFeatureId] === "object"
      ? state.baseGeoLocales[normalizedFeatureId]
      : null)
    : null;
  const patchEntry = normalizedFeatureId
    ? (state.scenarioGeoLocalePatchData?.geo?.[normalizedFeatureId]
      && typeof state.scenarioGeoLocalePatchData.geo[normalizedFeatureId] === "object"
      ? state.scenarioGeoLocalePatchData.geo[normalizedFeatureId]
      : null)
    : null;
  return {
    baseEntry,
    patchEntry,
    mergedEntry: {
      en: normalizeLocaleInput(patchEntry?.en || baseEntry?.en || ""),
      zh: normalizeLocaleInput(patchEntry?.zh || baseEntry?.zh || ""),
    },
  };
}

function resolveLocaleEditorModel() {
  const targetIds = resolveOwnershipTargetIds();
  const featureId = targetIds.length === 1 ? String(targetIds[0] || "").trim() : "";
  const feature = featureId ? state.landIndex?.get(featureId) || null : null;
  const localeEntry = getScenarioGeoLocaleEntry(featureId);
  return {
    featureId,
    feature,
    selectionCount: targetIds.length,
    hasScenario: !!String(state.activeScenarioId || "").trim(),
    hasGeoLocalePatch: !!String(state.activeScenarioManifest?.geo_locale_patch_url || "").trim(),
    ...localeEntry,
  };
}

function buildLocaleMetaRows(model) {
  if (!model.featureId || !model.feature) return [];
  const rows = [
    ["ID", model.featureId],
    [ui("Name"), resolveFeatureName(model.feature, model.featureId)],
    [ui("Current EN"), model.mergedEntry.en],
    [ui("Current ZH"), model.mergedEntry.zh],
  ];
  return rows.filter(([, value]) => String(value || "").trim());
}

function resolveLocaleEditorHint(model) {
  if (!model.hasScenario) {
    return ui("Activate a scenario to edit localized geo names.");
  }
  if (!model.hasGeoLocalePatch) {
    return ui("The active scenario does not declare a geo locale patch target.");
  }
  if (model.selectionCount !== 1 || !model.featureId) {
    return ui("Select exactly one land feature to edit localized geo names.");
  }
  return ui("Edit EN and ZH for the selected feature, then save to rebuild the active scenario locale patch.");
}

function resolveInspectorRows() {
  const hit = state.devSelectedHit?.id ? state.devSelectedHit : state.devHoverHit;
  if (!hit?.id) {
    return {
      title: "No active feature",
      hint: ui("Hover a region or click one to inspect live debug metadata."),
      rows: [],
    };
  }

  const feature = resolveFeatureFromHit(hit);
  const tooltipModel = buildTooltipModel(feature);
  const detailTier = String(feature?.properties?.detail_tier || "").trim();
  const parentGroup =
    hit.targetType === "land" ? String(state.parentGroupByFeatureId?.get(hit.id) || "").trim() : "";
  const source = String(
    feature?.properties?.__source
      || (hit.targetType === "special" ? "scenario" : hit.targetType === "water" ? "context" : "primary")
  ).trim();
  const ownerCode = hit.targetType === "land"
    ? String(getFeatureOwnerCode(hit.id) || tooltipModel.countryCode || hit.countryCode || "").trim().toUpperCase()
    : "";
  const controllerCode = hit.targetType === "land"
    ? String(state.scenarioControllersByFeatureId?.[hit.id] || "").trim().toUpperCase()
    : "";

  const rows = [
    [ui("Target"), String(hit.targetType || "land")],
    [ui("Name"), resolveFeatureName(feature, hit.id)],
    ["ID", String(hit.id || "")],
    [ui("Country"), tooltipModel.countryCode ? `${tooltipModel.countryDisplayName || ""} (${tooltipModel.countryCode})` : ""],
    [ui("Parent Group"), parentGroup],
    [ui("Detail Tier"), detailTier],
    [ui("Owner"), ownerCode],
    [ui("Controller"), controllerCode],
    [ui("Scenario View"), String(state.scenarioViewMode || "ownership")],
    [ui("Hit Source"), String(hit.hitSource || "spatial")],
    [ui("Snap"), hit.viaSnap ? ui("Snap hit") : hit.strict ? ui("Strict hit") : ui("No")],
    [ui("Source Topology"), source],
    [ui("Neighbors"), resolveNeighborCount(hit.id)],
  ].filter(([, value]) => String(value || "").trim());

  return {
    title: resolveFeatureName(feature, hit.id),
    hint: tooltipModel.countryDisplayName || tooltipModel.countryCode || "",
    rows,
  };
}

function resolveRenderRows() {
  const renderPerf = state.renderPerfMetrics || {};
  const cache = state.renderPassCache || {};
  const frame = cache.lastFrame || {};
  const timings = frame.timings || {};
  return [
    [ui("Render Profile"), String(state.renderProfile || "auto")],
    [ui("Bundle Mode"), String(state.topologyBundleMode || "single")],
    [ui("Detail Deferred"), state.detailDeferred ? ui("Yes") : ui("No")],
    [ui("Detail Source"), String(state.detailSourceRequested || "")],
    [ui("Phase"), String(state.renderPhase || "idle")],
    [ui("Last Frame"), Number.isFinite(Number(frame.totalMs)) ? `${Number(frame.totalMs).toFixed(1)}ms` : ""],
    [ui("Last Action"), String(cache.lastAction || "")],
    [ui("Action Time"), Number.isFinite(Number(cache.lastActionDurationMs)) ? `${Number(cache.lastActionDurationMs).toFixed(1)}ms` : ""],
    ["setMapData", Number.isFinite(Number(renderPerf.setMapData?.durationMs)) ? `${Number(renderPerf.setMapData.durationMs).toFixed(1)}ms` : ""],
    [ui("Spatial Index"), Number.isFinite(Number(renderPerf.buildSpatialIndex?.durationMs)) ? `${Number(renderPerf.buildSpatialIndex.durationMs).toFixed(1)}ms` : ""],
    [ui("Static Meshes"), Number.isFinite(Number(renderPerf.rebuildStaticMeshes?.durationMs)) ? `${Number(renderPerf.rebuildStaticMeshes.durationMs).toFixed(1)}ms` : ""],
    [ui("Hit Canvas"), Number.isFinite(Number(renderPerf.buildHitCanvas?.durationMs)) ? `${Number(renderPerf.buildHitCanvas.durationMs).toFixed(1)}ms` : ""],
    [ui("Dynamic Borders"), Number.isFinite(Number(renderPerf.rebuildDynamicBorders?.durationMs)) ? `${Number(renderPerf.rebuildDynamicBorders.durationMs).toFixed(1)}ms` : ""],
    [ui("Border Reason"), String(state.dynamicBordersDirtyReason || "")],
    [ui("Political Pass"), Number.isFinite(Number(timings.political)) ? `${Number(timings.political).toFixed(1)}ms` : ""],
    [ui("Borders Pass"), Number.isFinite(Number(timings.borders)) ? `${Number(timings.borders).toFixed(1)}ms` : ""],
  ].filter(([, value]) => String(value || "").trim());
}

function resolveRuntimeRows() {
  const runtimeMeta = state.devRuntimeMeta;
  if (!runtimeMeta || typeof runtimeMeta !== "object") {
    return {
      title: "Runtime metadata unavailable",
      hint: isLocalHost()
        ? (state.devRuntimeMetaError || ui("Runtime metadata not available yet."))
        : ui("Runtime metadata is only available on the local dev server."),
      rows: [],
    };
  }
  return {
    title: String(runtimeMeta.url || "Local runtime"),
    hint: String(runtimeMeta.open_path || "/"),
    rows: [
      ["URL", String(runtimeMeta.url || "")],
      [ui("Port"), String(runtimeMeta.port || "")],
      ["PID", String(runtimeMeta.pid || "")],
      [ui("Started"), String(runtimeMeta.started_at || "")],
      [ui("Open Path"), String(runtimeMeta.open_path || "")],
      ["CWD", String(runtimeMeta.cwd || "")],
      [ui("Render Profile"), String(runtimeMeta.render_profile_default || "")],
      [ui("Topology Variant"), String(runtimeMeta.topology_variant || "")],
    ].filter(([, value]) => String(value || "").trim()),
  };
}

function renderMetaRows(container, rows) {
  if (!container) return;
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "dev-workspace-empty";
    empty.textContent = ui("No data yet.");
    container.appendChild(empty);
    return;
  }
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "dev-workspace-meta-row";

    const labelEl = document.createElement("div");
    labelEl.className = "dev-workspace-meta-label";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.className = "dev-workspace-meta-value";
    valueEl.textContent = String(value || "");

    row.append(labelEl, valueEl);
    container.appendChild(row);
  });
}

async function loadRuntimeMeta() {
  if (!isLocalHost()) {
    state.devRuntimeMeta = null;
    state.devRuntimeMetaError = ui("Runtime metadata is only available on localhost.");
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  try {
    const url = new URL("/.runtime/dev/active_server.json", globalThis.location?.origin || globalThis.location?.href);
    url.searchParams.set("ts", String(Date.now()));
    const response = await fetch(url.href, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    state.devRuntimeMeta = await response.json();
    state.devRuntimeMetaError = "";
  } catch (error) {
    state.devRuntimeMeta = null;
    state.devRuntimeMetaError = String(error?.message || ui("Unable to fetch runtime metadata."));
  }
  state.updateDevWorkspaceUIFn?.();
}

function createDevWorkspacePanelLegacy(bottomDock) {
  let section = document.getElementById("devWorkspacePanel");
  if (section || !bottomDock) return section;

  section = document.createElement("section");
  section.id = "devWorkspacePanel";
  section.className = "dev-workspace-dock is-hidden";
  section.innerHTML = `
    <div class="dev-workspace-header">
      <div class="dev-workspace-title-row">
        <div>
          <div class="section-header sidebar-tool-title">Dev Workspace</div>
          <p id="devWorkspaceIntro" class="dev-workspace-note">Development tools take over the center dock while enabled.</p>
        </div>
      </div>
    </div>
    <div class="dev-workspace-grid">
      <div class="dev-workspace-panel">
        <div id="devFeatureInspectorLabel" class="dev-workspace-panel-title">Feature Inspector</div>
        <div id="devFeatureInspectorTitle" class="section-header-block">No active feature</div>
        <p id="devFeatureInspectorHint" class="dev-workspace-note">Hover a region or click one to inspect live debug metadata.</p>
        <div id="devFeatureInspectorMeta" class="dev-workspace-meta"></div>
      </div>
      <div id="devScenarioTagCreatorPanel" class="dev-workspace-panel dev-workspace-panel-wide hidden">
        <div id="devScenarioTagCreatorLabel" class="dev-workspace-panel-title">Scenario Tag Creator</div>
        <div id="devScenarioTagCreatorTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioTagCreatorHint" class="dev-workspace-note">Select one or more land features to create and assign a new scenario tag.</p>
        <div id="devScenarioTagCreatorMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioTagLabel" class="dev-workspace-note" for="devScenarioTagInput">Tag</label>
        <input
          id="devScenarioTagInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="4"
          placeholder="ABC"
        />
        <div id="devScenarioTagInlineStatus" class="dev-workspace-note"></div>
        <label id="devScenarioTagNameEnLabel" class="dev-workspace-note" for="devScenarioTagNameEnInput">English Name</label>
        <input
          id="devScenarioTagNameEnInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="New Country"
        />
        <label id="devScenarioTagNameZhLabel" class="dev-workspace-note" for="devScenarioTagNameZhInput">Chinese Name</label>
        <input
          id="devScenarioTagNameZhInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="新国家"
        />
        <label id="devScenarioTagColorLabel" class="dev-workspace-note" for="devScenarioTagColorInput">Color Hex</label>
        <input
          id="devScenarioTagColorInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="7"
          placeholder="#5D7CBA"
        />
        <label id="devScenarioTagParentLabel" class="dev-workspace-note" for="devScenarioTagParentInput">Parent Owner Tag</label>
        <input
          id="devScenarioTagParentInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="4"
          placeholder="GER"
        />
        <div class="dev-workspace-actions">
          <button id="devScenarioCreateTagBtn" type="button" class="btn-primary">Create Tag</button>
          <button id="devScenarioClearTagBtn" type="button" class="btn-secondary">Clear</button>
        </div>
        <div id="devScenarioTagCreatorStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioDistrictPanel" class="dev-workspace-panel hidden">
        <div id="devScenarioDistrictLabel" class="dev-workspace-panel-title">Scenario District Editor</div>
        <div id="devScenarioDistrictTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioDistrictHint" class="dev-workspace-note">Choose a geo country code or select land features from one country to edit districts.</p>
        <div id="devScenarioDistrictMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioDistrictCountryLabel" class="dev-workspace-note" for="devScenarioDistrictCountryInput">Geo Country</label>
        <input
          id="devScenarioDistrictCountryInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="3"
          placeholder="DE"
        />
        <div id="devScenarioDistrictCountryModeNote" class="dev-workspace-note"></div>
        <label id="devScenarioDistrictSelectLabel" class="dev-workspace-note" for="devScenarioDistrictSelect">District</label>
        <select id="devScenarioDistrictSelect" class="select-input dev-workspace-select">
          <option value="">Select district</option>
        </select>
        <label id="devScenarioDistrictIdLabel" class="dev-workspace-note" for="devScenarioDistrictIdInput">District ID</label>
        <input
          id="devScenarioDistrictIdInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="64"
          placeholder="berlin"
        />
        <label id="devScenarioDistrictNameEnLabel" class="dev-workspace-note" for="devScenarioDistrictNameEnInput">English Name</label>
        <input
          id="devScenarioDistrictNameEnInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Berlin"
        />
        <label id="devScenarioDistrictNameZhLabel" class="dev-workspace-note" for="devScenarioDistrictNameZhInput">Chinese Name</label>
        <input
          id="devScenarioDistrictNameZhInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Berlin"
        />
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUseSelectionBtn" type="button" class="btn-secondary">Use Selection Country</button>
          <button id="devScenarioDistrictClearBtn" type="button" class="btn-secondary">Clear</button>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUpsertBtn" type="button" class="btn-secondary">Upsert District</button>
          <button id="devScenarioDistrictAssignBtn" type="button" class="btn-secondary">Assign Selection</button>
          <button id="devScenarioDistrictRemoveBtn" type="button" class="btn-secondary">Remove Selection</button>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictDeleteBtn" type="button" class="btn-secondary">Delete Empty District</button>
          <button id="devScenarioDistrictSaveBtn" type="button" class="btn-primary">Save Districts File</button>
        </div>
        <div id="devScenarioDistrictStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioLocalePanel" class="dev-workspace-panel hidden">
        <div id="devScenarioLocaleLabel" class="dev-workspace-panel-title">Scenario Locale Editor</div>
        <div id="devScenarioLocaleTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioLocaleHint" class="dev-workspace-note">Select exactly one land feature to edit localized geo names.</p>
        <div id="devScenarioLocaleMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioLocaleEnLabel" class="dev-workspace-note" for="devScenarioLocaleEnInput">Localized EN</label>
        <input
          id="devScenarioLocaleEnInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="Badghis"
        />
        <label id="devScenarioLocaleZhLabel" class="dev-workspace-note" for="devScenarioLocaleZhInput">Localized ZH</label>
        <textarea
          id="devScenarioLocaleZhInput"
          class="input dev-workspace-input dev-workspace-textarea"
          rows="2"
          spellcheck="false"
          placeholder="巴德吉斯"
        ></textarea>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveLocaleBtn" type="button" class="btn-secondary">Save Localized Names</button>
        </div>
        <div id="devScenarioLocaleStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioOwnershipPanel" class="dev-workspace-panel hidden">
        <div id="devScenarioOwnershipLabel" class="dev-workspace-panel-title">Scenario Ownership Editor</div>
        <div id="devScenarioOwnershipTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioOwnershipHint" class="dev-workspace-note">Select one or more land features to edit political ownership.</p>
        <div id="devScenarioOwnershipMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioOwnerInputLabel" class="dev-workspace-note" for="devScenarioOwnerInput">Target Owner Tag</label>
        <input
          id="devScenarioOwnerInput"
          class="input dev-workspace-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="8"
          placeholder="GER"
        />
        <div class="dev-workspace-actions">
          <button id="devScenarioApplyOwnerBtn" type="button" class="btn-primary">Apply to Selection</button>
          <button id="devScenarioResetOwnerBtn" type="button" class="btn-secondary">Reset Selection</button>
          <button id="devScenarioSaveOwnersBtn" type="button" class="btn-secondary">Save Owners File</button>
        </div>
        <div id="devScenarioOwnershipStatus" class="dev-workspace-note"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devRenderStatusLabel" class="dev-workspace-panel-title">Render Status</div>
        <div id="devRenderStatusMeta" class="dev-workspace-meta"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devPaintMacrosLabel" class="dev-workspace-panel-title">Paint Macros</div>
        <p id="devPaintMacrosHint" class="dev-workspace-note">These actions reuse the current tool mode and selected color or owner.</p>
        <div class="dev-workspace-actions">
          <button id="devMacroCountryBtn" type="button" class="btn-secondary">Fill Country</button>
          <button id="devMacroParentBtn" type="button" class="btn-secondary">Fill Parent Group</button>
          <button id="devMacroOwnerBtn" type="button" class="btn-secondary">Fill Owner Scope</button>
          <button id="devMacroSelectionBtn" type="button" class="btn-secondary">Fill Multi-Selection</button>
        </div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devSelectionClipboardLabel" class="dev-workspace-panel-title">Selection Clipboard</div>
        <div class="dev-workspace-actions">
          <button id="devSelectionAddHoveredBtn" type="button" class="btn-secondary">Add Hovered</button>
          <button id="devSelectionToggleSelectedBtn" type="button" class="btn-secondary">Toggle Selected</button>
          <button id="devSelectionRemoveLastBtn" type="button" class="btn-secondary">Remove Last</button>
          <button id="devSelectionClearBtn" type="button" class="btn-secondary">Clear Selection</button>
        </div>
        <div class="dev-workspace-actions">
          <label id="devSelectionSortLabel" class="dev-workspace-note" for="devSelectionSortMode">Sort</label>
          <select id="devSelectionSortMode" class="select-input dev-workspace-select">
            <option value="selection">Selection Order</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div class="dev-workspace-actions">
          <button id="devCopyNamesBtn" type="button" class="btn-primary">Copy Names</button>
          <button id="devCopyNamesIdsBtn" type="button" class="btn-primary">Copy Names + ID</button>
          <button id="devCopyIdsBtn" type="button" class="btn-primary">Copy ID</button>
        </div>
        <div id="devSelectionSummary" class="dev-workspace-note">0 features selected.</div>
        <textarea id="devSelectionPreview" class="dev-selection-preview" readonly aria-label="Development selection preview"></textarea>
      </div>
      <div class="dev-workspace-panel">
        <div id="devLocalRuntimeLabel" class="dev-workspace-panel-title">Local Runtime</div>
        <div id="devRuntimeTitle" class="section-header-block">Runtime metadata unavailable</div>
        <p id="devRuntimeHint" class="dev-workspace-note"></p>
        <div id="devRuntimeMeta" class="dev-workspace-meta"></div>
      </div>
    </div>
  `;

  const workspaceGrid = section.querySelector(".dev-workspace-grid");
  const featureInspectorPanel = section.querySelector("#devFeatureInspectorTitle")?.closest(".dev-workspace-panel");
  const tagCreatorPanel = section.querySelector("#devScenarioTagCreatorPanel");
  const tagColorLabel = section.querySelector("#devScenarioTagColorLabel");
  const tagColorInput = section.querySelector("#devScenarioTagColorInput");
  const tagParentLabel = section.querySelector("#devScenarioTagParentLabel");
  if (workspaceGrid && featureInspectorPanel) {
    workspaceGrid.appendChild(featureInspectorPanel);
  }
  if (tagCreatorPanel) {
    tagCreatorPanel.classList.add("dev-workspace-panel-wide");
  }
  if (tagColorLabel && tagColorInput && tagParentLabel) {
    const colorField = document.createElement("div");
    colorField.className = "dev-workspace-form-field dev-workspace-form-field--span-2";
    colorField.innerHTML = `
      <div class="dev-workspace-inline-row">
        <label id="devScenarioTagColorPaletteLabel" class="dev-workspace-note" for="devScenarioTagPalette">Color Palette</label>
        <div class="dev-workspace-color-anchor">
          <button id="devScenarioTagColorPreview" type="button" class="dev-workspace-color-preview dev-workspace-color-trigger" aria-haspopup="dialog" aria-expanded="false">#5D7CBA</button>
          <div id="devScenarioTagColorPopover" class="dev-workspace-color-popover hidden" role="dialog" aria-label="Custom tag color">
            <button id="devScenarioTagCustomColorBtn" type="button" class="btn-secondary">Custom...</button>
          </div>
        </div>
      </div>
      <div id="devScenarioTagPalette" class="dev-workspace-swatch-grid" role="listbox" aria-label="Scenario tag color palette"></div>
      <div id="devScenarioTagRecentWrap" class="dev-workspace-form-field hidden">
        <label id="devScenarioTagRecentLabel" class="dev-workspace-note" for="devScenarioTagRecentColors">Recent Colors</label>
        <div id="devScenarioTagRecentColors" class="dev-workspace-swatch-row" role="listbox" aria-label="Recent scenario tag colors"></div>
      </div>
    `;
    tagColorLabel.remove();
    tagColorInput.type = "color";
    tagColorInput.className = "dev-workspace-native-color-input";
    tagColorInput.setAttribute("aria-hidden", "true");
    tagColorInput.tabIndex = -1;
    tagCreatorPanel.insertBefore(colorField, tagParentLabel);
  }

  const headerRow = bottomDock.querySelector(".dock-header-row");
  bottomDock.insertBefore(section, headerRow?.nextSibling || bottomDock.firstChild || null);
  return section;
}

function createDevWorkspacePanel(bottomDock) {
  let section = document.getElementById("devWorkspacePanel");
  if (section || !bottomDock) return section;

  section = document.createElement("section");
  section.id = "devWorkspacePanel";
  section.className = "dev-workspace-dock is-hidden";
  section.innerHTML = `
    <div class="dev-workspace-header">
      <div class="dev-workspace-title-row">
        <div>
          <div class="section-header sidebar-tool-title">Dev Workspace</div>
          <p id="devWorkspaceIntro" class="dev-workspace-note">Development tools take over the center dock while enabled.</p>
        </div>
      </div>
    </div>
    <div class="dev-workspace-grid">
      <div id="devScenarioTagCreatorPanel" class="dev-workspace-panel dev-workspace-panel-wide hidden">
        <div id="devScenarioTagCreatorLabel" class="dev-workspace-panel-title">Scenario Tag Creator</div>
        <div id="devScenarioTagCreatorTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioTagCreatorHint" class="dev-workspace-note">Select one or more land features to create and assign a new scenario tag.</p>
        <div id="devScenarioTagCreatorMeta" class="dev-workspace-meta"></div>
        <div class="dev-workspace-form-grid">
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagLabel" class="dev-workspace-note" for="devScenarioTagInput">Tag</label>
            <input id="devScenarioTagInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="ABC" />
            <div id="devScenarioTagFieldStatus" class="dev-workspace-field-status"></div>
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagParentLabel" class="dev-workspace-note" for="devScenarioTagParentInput">Parent Owner Tag</label>
            <input id="devScenarioTagParentInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="4" placeholder="GER" />
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagNameEnLabel" class="dev-workspace-note" for="devScenarioTagNameEnInput">English Name</label>
            <input id="devScenarioTagNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" placeholder="New Country" />
          </div>
          <div class="dev-workspace-form-field">
            <label id="devScenarioTagNameZhLabel" class="dev-workspace-note" for="devScenarioTagNameZhInput">Chinese Name</label>
            <input id="devScenarioTagNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" placeholder="New Country" />
          </div>
          <div class="dev-workspace-form-field dev-workspace-form-field-span-2">
            <div class="dev-workspace-inline-row">
              <label id="devScenarioTagColorPaletteLabel" class="dev-workspace-note" for="devScenarioTagColorPreviewBtn">Color Palette</label>
              <button id="devScenarioTagColorPreviewBtn" type="button" class="dev-workspace-color-preview-button">
                <span id="devScenarioTagColorPreview" class="dev-workspace-color-preview">#5D7CBA</span>
              </button>
            </div>
            <div id="devScenarioTagPalette" class="dev-workspace-swatch-grid" role="listbox" aria-label="Scenario tag color palette"></div>
            <div id="devScenarioTagRecentWrap" class="dev-workspace-form-field hidden">
              <label id="devScenarioTagRecentLabel" class="dev-workspace-note" for="devScenarioTagRecentColors">Recent Colors</label>
              <div id="devScenarioTagRecentColors" class="dev-workspace-swatch-row" role="listbox" aria-label="Recent scenario tag colors"></div>
            </div>
            <div id="devScenarioTagColorPopoverAnchor" class="dev-workspace-color-popover-anchor">
              <div id="devScenarioTagColorPopover" class="dev-workspace-color-popover hidden" role="dialog" aria-modal="false">
                <div id="devScenarioTagColorPopoverLabel" class="dev-workspace-note">Custom Color</div>
                <div class="dev-workspace-actions">
                  <button id="devScenarioTagColorCustomBtn" type="button" class="btn-secondary">Custom...</button>
                </div>
              </div>
            </div>
            <input id="devScenarioTagColorInput" class="dev-workspace-native-color-input" type="color" value="#5d7cba" tabindex="-1" aria-hidden="true" />
          </div>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioClearTagBtn" type="button" class="btn-secondary">Clear</button>
          <button id="devScenarioCreateTagBtn" type="button" class="btn-primary">Create Tag</button>
        </div>
        <div id="devScenarioTagCreatorStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioDistrictPanel" class="dev-workspace-panel hidden">
        <div id="devScenarioDistrictLabel" class="dev-workspace-panel-title">Scenario District Editor</div>
        <div id="devScenarioDistrictTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioDistrictHint" class="dev-workspace-note">Choose a geo country code or select land features from one country to edit districts.</p>
        <div id="devScenarioDistrictMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioDistrictCountryLabel" class="dev-workspace-note" for="devScenarioDistrictCountryInput">Geo Country</label>
        <input id="devScenarioDistrictCountryInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="3" placeholder="DE" />
        <div id="devScenarioDistrictCountryModeNote" class="dev-workspace-note"></div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUseSelectionBtn" type="button" class="btn-secondary">Use Selection Country</button>
          <button id="devScenarioDistrictClearBtn" type="button" class="btn-secondary">Clear</button>
        </div>
        <label id="devScenarioDistrictSelectLabel" class="dev-workspace-note" for="devScenarioDistrictSelect">District</label>
        <select id="devScenarioDistrictSelect" class="select-input dev-workspace-select">
          <option value="">Select district</option>
        </select>
        <label id="devScenarioDistrictIdLabel" class="dev-workspace-note" for="devScenarioDistrictIdInput">District ID</label>
        <input id="devScenarioDistrictIdInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="64" placeholder="berlin" />
        <label id="devScenarioDistrictNameEnLabel" class="dev-workspace-note" for="devScenarioDistrictNameEnInput">English Name</label>
        <input id="devScenarioDistrictNameEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" placeholder="Berlin" />
        <label id="devScenarioDistrictNameZhLabel" class="dev-workspace-note" for="devScenarioDistrictNameZhInput">Chinese Name</label>
        <input id="devScenarioDistrictNameZhInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" placeholder="Berlin" />
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictUpsertBtn" type="button" class="btn-secondary">Upsert District</button>
          <button id="devScenarioDistrictAssignBtn" type="button" class="btn-secondary">Assign Selection</button>
          <button id="devScenarioDistrictRemoveBtn" type="button" class="btn-secondary">Remove Selection</button>
        </div>
        <div class="dev-workspace-actions">
          <button id="devScenarioDistrictDeleteBtn" type="button" class="btn-secondary">Delete Empty District</button>
          <button id="devScenarioDistrictSaveBtn" type="button" class="btn-primary">Save Districts File</button>
        </div>
        <div id="devScenarioDistrictStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioLocalePanel" class="dev-workspace-panel hidden">
        <div id="devScenarioLocaleLabel" class="dev-workspace-panel-title">Scenario Locale Editor</div>
        <div id="devScenarioLocaleTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioLocaleHint" class="dev-workspace-note">Select exactly one land feature to edit localized geo names.</p>
        <div id="devScenarioLocaleMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioLocaleEnLabel" class="dev-workspace-note" for="devScenarioLocaleEnInput">Localized EN</label>
        <input id="devScenarioLocaleEnInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" placeholder="Badghis" />
        <label id="devScenarioLocaleZhLabel" class="dev-workspace-note" for="devScenarioLocaleZhInput">Localized ZH</label>
        <textarea id="devScenarioLocaleZhInput" class="input dev-workspace-input dev-workspace-textarea" rows="2" spellcheck="false" placeholder="Localized name"></textarea>
        <div class="dev-workspace-actions">
          <button id="devScenarioSaveLocaleBtn" type="button" class="btn-secondary">Save Localized Names</button>
        </div>
        <div id="devScenarioLocaleStatus" class="dev-workspace-note"></div>
      </div>
      <div id="devScenarioOwnershipPanel" class="dev-workspace-panel hidden">
        <div id="devScenarioOwnershipLabel" class="dev-workspace-panel-title">Scenario Ownership Editor</div>
        <div id="devScenarioOwnershipTitle" class="section-header-block">No active scenario</div>
        <p id="devScenarioOwnershipHint" class="dev-workspace-note">Select one or more land features to edit political ownership.</p>
        <div id="devScenarioOwnershipMeta" class="dev-workspace-meta"></div>
        <label id="devScenarioOwnerInputLabel" class="dev-workspace-note" for="devScenarioOwnerInput">Target Owner Tag</label>
        <input id="devScenarioOwnerInput" class="input dev-workspace-input" type="text" autocomplete="off" spellcheck="false" maxlength="8" placeholder="GER" />
        <div class="dev-workspace-actions">
          <button id="devScenarioApplyOwnerBtn" type="button" class="btn-primary">Apply to Selection</button>
          <button id="devScenarioResetOwnerBtn" type="button" class="btn-secondary">Reset Selection</button>
          <button id="devScenarioSaveOwnersBtn" type="button" class="btn-secondary">Save Owners File</button>
        </div>
        <div id="devScenarioOwnershipStatus" class="dev-workspace-note"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devRenderStatusLabel" class="dev-workspace-panel-title">Render Status</div>
        <div id="devRenderStatusMeta" class="dev-workspace-meta"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devPaintMacrosLabel" class="dev-workspace-panel-title">Paint Macros</div>
        <p id="devPaintMacrosHint" class="dev-workspace-note">These actions reuse the current tool mode and selected color or owner.</p>
        <div class="dev-workspace-actions">
          <button id="devMacroCountryBtn" type="button" class="btn-secondary">Fill Country</button>
          <button id="devMacroParentBtn" type="button" class="btn-secondary">Fill Parent Group</button>
          <button id="devMacroOwnerBtn" type="button" class="btn-secondary">Fill Owner Scope</button>
          <button id="devMacroSelectionBtn" type="button" class="btn-secondary">Fill Multi-Selection</button>
        </div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devSelectionClipboardLabel" class="dev-workspace-panel-title">Selection Clipboard</div>
        <div class="dev-workspace-actions">
          <button id="devSelectionAddHoveredBtn" type="button" class="btn-secondary">Add Hovered</button>
          <button id="devSelectionToggleSelectedBtn" type="button" class="btn-secondary">Toggle Selected</button>
          <button id="devSelectionRemoveLastBtn" type="button" class="btn-secondary">Remove Last</button>
          <button id="devSelectionClearBtn" type="button" class="btn-secondary">Clear Selection</button>
        </div>
        <div class="dev-workspace-actions">
          <label id="devSelectionSortLabel" class="dev-workspace-note" for="devSelectionSortMode">Sort</label>
          <select id="devSelectionSortMode" class="select-input dev-workspace-select">
            <option value="selection">Selection Order</option>
            <option value="name">Name</option>
          </select>
        </div>
        <div class="dev-workspace-actions">
          <button id="devCopyNamesBtn" type="button" class="btn-primary">Copy Names</button>
          <button id="devCopyNamesIdsBtn" type="button" class="btn-primary">Copy Names + ID</button>
          <button id="devCopyIdsBtn" type="button" class="btn-primary">Copy ID</button>
        </div>
        <div id="devSelectionSummary" class="dev-workspace-note">0 features selected.</div>
        <textarea id="devSelectionPreview" class="dev-selection-preview" readonly aria-label="Development selection preview"></textarea>
      </div>
      <div class="dev-workspace-panel">
        <div id="devLocalRuntimeLabel" class="dev-workspace-panel-title">Local Runtime</div>
        <div id="devRuntimeTitle" class="section-header-block">Runtime metadata unavailable</div>
        <p id="devRuntimeHint" class="dev-workspace-note"></p>
        <div id="devRuntimeMeta" class="dev-workspace-meta"></div>
      </div>
      <div class="dev-workspace-panel">
        <div id="devFeatureInspectorLabel" class="dev-workspace-panel-title">Feature Inspector</div>
        <div id="devFeatureInspectorTitle" class="section-header-block">No active feature</div>
        <p id="devFeatureInspectorHint" class="dev-workspace-note">Hover a region or click one to inspect live debug metadata.</p>
        <div id="devFeatureInspectorMeta" class="dev-workspace-meta"></div>
      </div>
    </div>
  `;

  const headerRow = bottomDock.querySelector(".dock-header-row");
  bottomDock.insertBefore(section, headerRow?.nextSibling || bottomDock.firstChild || null);
  return section;
}

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

function updateToggleButton(toggleBtn) {
  if (!toggleBtn) return;
  const expanded = !!state.ui.devWorkspaceExpanded;
  toggleBtn.classList.toggle("is-active", expanded);
  toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-pressed", expanded ? "true" : "false");
  toggleBtn.setAttribute("aria-label", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.setAttribute("title", expanded ? ui("Hide development workspace") : ui("Show development workspace"));
  toggleBtn.textContent = ui("Dev");
}

function syncDockState(bottomDock, expanded) {
  if (!bottomDock) return;
  bottomDock.classList.toggle("dev-workspace-mode", expanded);
  if (!expanded) return;

  state.ui.dockCollapsed = false;
  bottomDock.classList.remove("is-collapsed");
  const dockCollapseBtn = document.getElementById("dockCollapseBtn");
  if (dockCollapseBtn) {
    dockCollapseBtn.textContent = t("Collapse", "ui");
    dockCollapseBtn.setAttribute("aria-pressed", "false");
  }
}

function setExpandedState(nextValue, { bottomDock, panel, toggleBtn, persist = true } = {}) {
  const expanded = !!nextValue;
  state.ui.devWorkspaceExpanded = expanded;
  state.devSelectionModeEnabled = expanded;
  panel?.classList.toggle("is-hidden", !expanded);
  syncDockState(bottomDock, expanded);
  updateToggleButton(toggleBtn);
  if (persist) {
    writeStoredExpanded(expanded);
  }
  state.updateDevWorkspaceUIFn?.();
}

function copySelectionToClipboard(format, previewEl) {
  const text = buildClipboardText(format);
  state.devClipboardPreviewFormat = format;
  if (!text) {
    showToast("No selected regions to copy.", {
      title: ui("Selection Clipboard"),
      tone: "warning",
    });
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  state.devClipboardFallbackText = text;
  if (!globalThis.navigator?.clipboard?.writeText) {
    previewEl?.focus();
    previewEl?.select();
    showToast(ui("Clipboard API unavailable. The preview text is selected for manual copy."), {
      title: ui("Selection Clipboard"),
      tone: "warning",
      duration: 4200,
    });
    state.updateDevWorkspaceUIFn?.();
    return;
  }

  globalThis.navigator.clipboard.writeText(text)
    .then(() => {
      showToast(
        state.currentLanguage === "zh"
          ? `已复制 ${sortSelectionEntries(resolveSelectionEntries()).length} 条地块记录到剪贴板。`
          : `Copied ${sortSelectionEntries(resolveSelectionEntries()).length} region entries to the clipboard.`,
        {
        title: ui("Selection copied"),
        tone: "success",
      });
      state.updateDevWorkspaceUIFn?.();
    })
    .catch(() => {
      previewEl?.focus();
      previewEl?.select();
      showToast(ui("Clipboard write failed. The preview text is selected for manual copy."), {
        title: ui("Selection Clipboard"),
        tone: "warning",
        duration: 4200,
      });
      state.updateDevWorkspaceUIFn?.();
    });
}

function initDevWorkspace() {
  const bottomDock = document.getElementById("bottomDock");
  const toggleBtn = document.getElementById("devWorkspaceToggleBtn");
  if (!bottomDock || !toggleBtn) return;

  const panel = createDevWorkspacePanel(bottomDock);
  if (!panel) return;

  const featureInspectorTitle = panel.querySelector("#devFeatureInspectorTitle");
  const featureInspectorHint = panel.querySelector("#devFeatureInspectorHint");
  const featureInspectorMeta = panel.querySelector("#devFeatureInspectorMeta");
  const scenarioTagCreatorPanel = panel.querySelector("#devScenarioTagCreatorPanel");
  const scenarioTagCreatorTitle = panel.querySelector("#devScenarioTagCreatorTitle");
  const scenarioTagCreatorHint = panel.querySelector("#devScenarioTagCreatorHint");
  const scenarioTagCreatorMeta = panel.querySelector("#devScenarioTagCreatorMeta");
  const scenarioTagInput = panel.querySelector("#devScenarioTagInput");
  const scenarioTagFieldStatus = panel.querySelector("#devScenarioTagFieldStatus");
  const scenarioTagNameEnInput = panel.querySelector("#devScenarioTagNameEnInput");
  const scenarioTagNameZhInput = panel.querySelector("#devScenarioTagNameZhInput");
  const scenarioTagColorInput = panel.querySelector("#devScenarioTagColorInput");
  const scenarioTagColorPreviewBtn = panel.querySelector("#devScenarioTagColorPreviewBtn");
  const scenarioTagColorPreview = panel.querySelector("#devScenarioTagColorPreview");
  const scenarioTagColorPopover = panel.querySelector("#devScenarioTagColorPopover");
  const scenarioTagColorCustomBtn = panel.querySelector("#devScenarioTagColorCustomBtn");
  const scenarioTagPalette = panel.querySelector("#devScenarioTagPalette");
  const scenarioTagRecentWrap = panel.querySelector("#devScenarioTagRecentWrap");
  const scenarioTagRecentColors = panel.querySelector("#devScenarioTagRecentColors");
  const scenarioTagParentInput = panel.querySelector("#devScenarioTagParentInput");
  const scenarioClearTagBtn = panel.querySelector("#devScenarioClearTagBtn");
  const scenarioTagCreatorStatus = panel.querySelector("#devScenarioTagCreatorStatus");
  const scenarioDistrictPanel = panel.querySelector("#devScenarioDistrictPanel");
  const scenarioDistrictTitle = panel.querySelector("#devScenarioDistrictTitle");
  const scenarioDistrictHint = panel.querySelector("#devScenarioDistrictHint");
  const scenarioDistrictMeta = panel.querySelector("#devScenarioDistrictMeta");
  const scenarioDistrictCountryInput = panel.querySelector("#devScenarioDistrictCountryInput");
  const scenarioDistrictCountryModeNote = panel.querySelector("#devScenarioDistrictCountryModeNote");
  const scenarioDistrictUseSelectionBtn = panel.querySelector("#devScenarioDistrictUseSelectionBtn");
  const scenarioDistrictClearBtn = panel.querySelector("#devScenarioDistrictClearBtn");
  const scenarioDistrictSelect = panel.querySelector("#devScenarioDistrictSelect");
  const scenarioDistrictIdInput = panel.querySelector("#devScenarioDistrictIdInput");
  const scenarioDistrictNameEnInput = panel.querySelector("#devScenarioDistrictNameEnInput");
  const scenarioDistrictNameZhInput = panel.querySelector("#devScenarioDistrictNameZhInput");
  const scenarioDistrictStatus = panel.querySelector("#devScenarioDistrictStatus");
  const scenarioLocalePanel = panel.querySelector("#devScenarioLocalePanel");
  const scenarioLocaleTitle = panel.querySelector("#devScenarioLocaleTitle");
  const scenarioLocaleHint = panel.querySelector("#devScenarioLocaleHint");
  const scenarioLocaleMeta = panel.querySelector("#devScenarioLocaleMeta");
  const scenarioLocaleEnInput = panel.querySelector("#devScenarioLocaleEnInput");
  const scenarioLocaleZhInput = panel.querySelector("#devScenarioLocaleZhInput");
  const scenarioLocaleStatus = panel.querySelector("#devScenarioLocaleStatus");
  const scenarioOwnershipPanel = panel.querySelector("#devScenarioOwnershipPanel");
  const scenarioOwnershipTitle = panel.querySelector("#devScenarioOwnershipTitle");
  const scenarioOwnershipHint = panel.querySelector("#devScenarioOwnershipHint");
  const scenarioOwnershipMeta = panel.querySelector("#devScenarioOwnershipMeta");
  const scenarioOwnerInput = panel.querySelector("#devScenarioOwnerInput");
  const scenarioOwnershipStatus = panel.querySelector("#devScenarioOwnershipStatus");
  const renderStatusMeta = panel.querySelector("#devRenderStatusMeta");
  const runtimeTitle = panel.querySelector("#devRuntimeTitle");
  const runtimeHint = panel.querySelector("#devRuntimeHint");
  const runtimeMeta = panel.querySelector("#devRuntimeMeta");
  const selectionSummary = panel.querySelector("#devSelectionSummary");
  const selectionPreview = panel.querySelector("#devSelectionPreview");
  const selectionSortMode = panel.querySelector("#devSelectionSortMode");

  const setPanelText = (selector, text) => {
    const element = panel.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  };

  const renderWorkspace = () => {
    setPanelText("#devWorkspaceIntro", ui("Development tools take over the center dock while enabled."));
    setPanelText("#devFeatureInspectorLabel", ui("Feature Inspector"));
    setPanelText("#devScenarioTagCreatorLabel", ui("Scenario Tag Creator"));
    setPanelText("#devScenarioTagLabel", ui("Tag"));
    setPanelText("#devScenarioTagNameEnLabel", ui("English Name"));
    setPanelText("#devScenarioTagNameZhLabel", ui("Chinese Name"));
    setPanelText("#devScenarioTagColorPaletteLabel", ui("Color Palette"));
    setPanelText("#devScenarioTagColorPopoverLabel", ui("Custom Color"));
    setPanelText("#devScenarioTagRecentLabel", ui("Recent Colors"));
    setPanelText("#devScenarioTagParentLabel", ui("Parent Owner Tag"));
    setPanelText("#devScenarioTagColorCustomBtn", ui("Custom..."));
    setPanelText("#devScenarioClearTagBtn", ui("Clear"));
    setPanelText("#devScenarioCreateTagBtn", ui("Create Tag"));
    setPanelText("#devScenarioDistrictLabel", ui("Scenario District Editor"));
    setPanelText("#devScenarioDistrictCountryLabel", ui("Geo Country"));
    setPanelText("#devScenarioDistrictUseSelectionBtn", ui("Use Selection Country"));
    setPanelText("#devScenarioDistrictClearBtn", ui("Clear"));
    setPanelText("#devScenarioDistrictSelectLabel", ui("District"));
    setPanelText("#devScenarioDistrictIdLabel", ui("District ID"));
    setPanelText("#devScenarioDistrictNameEnLabel", ui("English Name"));
    setPanelText("#devScenarioDistrictNameZhLabel", ui("Chinese Name"));
    setPanelText("#devScenarioLocaleLabel", ui("Scenario Locale Editor"));
    setPanelText("#devScenarioLocaleEnLabel", ui("Localized EN"));
    setPanelText("#devScenarioLocaleZhLabel", ui("Localized ZH"));
    setPanelText("#devScenarioOwnershipLabel", ui("Scenario Ownership Editor"));
    setPanelText("#devScenarioOwnerInputLabel", ui("Target Owner Tag"));
    setPanelText("#devRenderStatusLabel", ui("Render Status"));
    setPanelText("#devPaintMacrosLabel", ui("Paint Macros"));
    setPanelText("#devPaintMacrosHint", ui("These actions reuse the current tool mode and selected color or owner."));
    setPanelText("#devSelectionClipboardLabel", ui("Selection Clipboard"));
    setPanelText("#devSelectionSortLabel", ui("Sort"));
    setPanelText("#devLocalRuntimeLabel", ui("Local Runtime"));

    setPanelText("#devSelectionAddHoveredBtn", ui("Add Hovered"));
    setPanelText("#devSelectionToggleSelectedBtn", ui("Toggle Selected"));
    setPanelText("#devSelectionRemoveLastBtn", ui("Remove Last"));
    setPanelText("#devSelectionClearBtn", ui("Clear Selection"));
    setPanelText("#devMacroCountryBtn", ui("Fill Country"));
    setPanelText("#devMacroParentBtn", ui("Fill Parent Group"));
    setPanelText("#devMacroOwnerBtn", ui("Fill Owner Scope"));
    setPanelText("#devMacroSelectionBtn", ui("Fill Multi-Selection"));
    setPanelText("#devCopyNamesBtn", ui("Copy Names"));
    setPanelText("#devCopyNamesIdsBtn", ui("Copy Names + ID"));
    setPanelText("#devCopyIdsBtn", ui("Copy ID"));
    selectionPreview?.setAttribute("aria-label", ui("Development selection preview"));
    if (selectionSortMode?.options?.[0]) selectionSortMode.options[0].textContent = ui("Selection Order");
    if (selectionSortMode?.options?.[1]) selectionSortMode.options[1].textContent = ui("Name");

    const inspector = resolveInspectorRows();
    if (featureInspectorTitle) {
      featureInspectorTitle.textContent = inspector.title;
    }
    if (featureInspectorHint) {
      featureInspectorHint.textContent = inspector.hint || ui("Hover a region or click one to inspect live debug metadata.");
    }
    renderMetaRows(featureInspectorMeta, inspector.rows);

    const hasActiveScenario = !!String(state.activeScenarioId || "").trim();
    const tagCreatorModel = resolveTagCreatorModel();
    const tagCreatorState = syncTagCreatorDerivedState();
    const tagCreatorValidation = validateTagCreatorInput(tagCreatorState, tagCreatorModel.targetIds);
    scenarioTagCreatorPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioTagCreatorTitle) {
      scenarioTagCreatorTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioTagCreatorHint) {
      scenarioTagCreatorHint.textContent = resolveTagCreatorHint(tagCreatorModel);
    }
    renderMetaRows(scenarioTagCreatorMeta, buildTagCreatorMetaRows(tagCreatorModel));
    if (scenarioTagInput && scenarioTagInput.value !== normalizeScenarioTagInput(tagCreatorState.tag)) {
      scenarioTagInput.value = normalizeScenarioTagInput(tagCreatorState.tag);
    }
    if (scenarioTagFieldStatus) {
      const normalizedTag = normalizeScenarioTagInput(tagCreatorState.tag);
      const isFormatError = !tagCreatorValidation.ok && tagCreatorValidation.code === "invalid-tag" && !!normalizedTag;
      const tagFieldMessage = tagCreatorState.duplicateTag
        ? ui("Tag already exists in the active scenario.")
        : (isFormatError ? tagCreatorValidation.message : (tagCreatorState.tagLengthHint || ""));
      scenarioTagFieldStatus.textContent = tagFieldMessage;
      scenarioTagFieldStatus.className = `dev-workspace-field-status${
        tagCreatorState.duplicateTag || isFormatError ? " is-error" : (tagCreatorState.tagLengthHint ? " is-warning" : "")
      }`;
    }
    if (scenarioTagNameEnInput && scenarioTagNameEnInput.value !== normalizeScenarioNameInput(tagCreatorState.nameEn)) {
      scenarioTagNameEnInput.value = normalizeScenarioNameInput(tagCreatorState.nameEn);
    }
    if (scenarioTagNameZhInput && scenarioTagNameZhInput.value !== normalizeScenarioNameInput(tagCreatorState.nameZh)) {
      scenarioTagNameZhInput.value = normalizeScenarioNameInput(tagCreatorState.nameZh);
    }
    if (scenarioTagColorInput && scenarioTagColorInput.value !== normalizeScenarioColorInput(tagCreatorState.colorHex).toLowerCase()) {
      scenarioTagColorInput.value = normalizeScenarioColorInput(tagCreatorState.colorHex).toLowerCase();
    }
    const tagPaletteRows = buildTagCreatorPaletteRows();
    const effectiveTagColor = normalizeScenarioColorInput(tagCreatorState.colorHex) || DEFAULT_TAG_CREATOR_COLOR;
    if (scenarioTagColorPreview) {
      scenarioTagColorPreview.textContent = effectiveTagColor;
      scenarioTagColorPreview.style.setProperty("--dev-tag-color", effectiveTagColor);
    }
    if (scenarioTagColorPreviewBtn) {
      scenarioTagColorPreviewBtn.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
      scenarioTagColorPreviewBtn.setAttribute("aria-expanded", tagCreatorState.isColorPopoverOpen ? "true" : "false");
    }
    if (scenarioTagColorPopover) {
      scenarioTagColorPopover.classList.toggle("hidden", !tagCreatorState.isColorPopoverOpen);
    }
    if (scenarioTagPalette) {
      const paletteMarkup = tagPaletteRows.paletteColors.map((color) => `
        <button
          type="button"
          class="color-swatch${color === effectiveTagColor ? " is-selected" : ""}"
          data-dev-tag-color="${color}"
          title="${color}"
          aria-label="${ui("Color Palette")}: ${color}"
          aria-pressed="${color === effectiveTagColor ? "true" : "false"}"
          style="background-color:${color};"
        ></button>
      `).join("");
      if (scenarioTagPalette.innerHTML !== paletteMarkup) {
        scenarioTagPalette.innerHTML = paletteMarkup;
      }
      scenarioTagPalette.classList.toggle("is-disabled", !hasActiveScenario || !!tagCreatorState.isSaving);
    }
    if (scenarioTagRecentWrap && scenarioTagRecentColors) {
      scenarioTagRecentWrap.classList.toggle("hidden", tagPaletteRows.recentColors.length === 0);
      const recentMarkup = tagPaletteRows.recentColors.map((color) => `
        <button
          type="button"
          class="color-swatch${color === effectiveTagColor ? " is-selected" : ""}"
          data-dev-tag-color="${color}"
          title="${color}"
          aria-label="${ui("Recent Colors")}: ${color}"
          aria-pressed="${color === effectiveTagColor ? "true" : "false"}"
          style="background-color:${color};"
        ></button>
      `).join("");
      if (scenarioTagRecentColors.innerHTML !== recentMarkup) {
        scenarioTagRecentColors.innerHTML = recentMarkup;
      }
      scenarioTagRecentColors.classList.toggle("is-disabled", !hasActiveScenario || !!tagCreatorState.isSaving);
    }
    if (scenarioTagParentInput && scenarioTagParentInput.value !== normalizeScenarioTagInput(tagCreatorState.parentOwnerTag)) {
      scenarioTagParentInput.value = normalizeScenarioTagInput(tagCreatorState.parentOwnerTag);
    }
    const canCreateTag = hasActiveScenario && tagCreatorModel.selectionCount > 0 && tagCreatorValidation.ok && !tagCreatorState.isSaving;
    const canClearTagForm = !!(
      normalizeScenarioTagInput(tagCreatorState.tag)
      || normalizeScenarioNameInput(tagCreatorState.nameEn)
      || normalizeScenarioNameInput(tagCreatorState.nameZh)
      || normalizeScenarioTagInput(tagCreatorState.parentOwnerTag)
      || normalizeScenarioColorInput(tagCreatorState.colorHex) !== DEFAULT_TAG_CREATOR_COLOR
      || tagCreatorState.isColorPopoverOpen
      || tagCreatorState.lastSaveMessage
    );
    if (scenarioTagInput) {
      scenarioTagInput.placeholder = "ABC";
      scenarioTagInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
      scenarioTagInput.classList.toggle(
        "is-invalid",
        tagCreatorState.duplicateTag
          || (!tagCreatorValidation.ok && tagCreatorValidation.code === "invalid-tag" && !!normalizeScenarioTagInput(tagCreatorState.tag))
      );
    }
    if (scenarioTagNameEnInput) {
      scenarioTagNameEnInput.placeholder = "New Country";
      scenarioTagNameEnInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagNameZhInput) {
      scenarioTagNameZhInput.placeholder = "新国家";
      scenarioTagNameZhInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagParentInput) {
      scenarioTagParentInput.placeholder = normalizeOwnerInput(state.activeSovereignCode) || "GER";
      scenarioTagParentInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagNameZhInput) {
      scenarioTagNameZhInput.placeholder = "New Country";
    }
    if (scenarioClearTagBtn) {
      scenarioClearTagBtn.disabled = !hasActiveScenario || !!tagCreatorState.isSaving || !canClearTagForm;
    }
    const createTagBtn = panel.querySelector("#devScenarioCreateTagBtn");
    if (createTagBtn) {
      createTagBtn.textContent = tagCreatorState.isSaving ? ui("Creating...") : ui("Create Tag");
      createTagBtn.disabled = !canCreateTag;
    }
    if (scenarioTagCreatorStatus) {
      const tagStatusBits = [];
      if (tagCreatorState.lastSaveMessage) {
        tagStatusBits.push(tagCreatorState.lastSaveMessage);
      } else if (
        !tagCreatorValidation.ok
        && tagCreatorValidation.code !== "invalid-tag"
        && tagCreatorValidation.code !== "duplicate-tag"
        && (normalizeScenarioTagInput(tagCreatorState.tag) || normalizeScenarioNameInput(tagCreatorState.nameEn) || normalizeScenarioNameInput(tagCreatorState.nameZh) || normalizeScenarioColorInput(tagCreatorState.colorHex) || normalizeScenarioTagInput(tagCreatorState.parentOwnerTag))
      ) {
        tagStatusBits.push(tagCreatorValidation.message);
      } else if (tagCreatorState.lastSavedAt) {
        tagStatusBits.push(`${ui("Last Saved")}: ${tagCreatorState.lastSavedAt}`);
      }
      scenarioTagCreatorStatus.textContent = tagStatusBits.join(" | ");
    }

    const districtModel = resolveDistrictEditorModel();
    const districtState = state.devScenarioDistrictEditor || {};
    scenarioDistrictPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioDistrictTitle) {
      scenarioDistrictTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioDistrictHint) {
      scenarioDistrictHint.textContent = resolveDistrictEditorHint(districtModel);
    }
    renderMetaRows(scenarioDistrictMeta, buildDistrictMetaRows(districtModel));
    const renderedDistrictCountryValue = districtModel.isAutoMode
      ? districtModel.inferredCountryCode
      : districtModel.manualCountryCode;
    if (scenarioDistrictCountryInput && scenarioDistrictCountryInput.value !== renderedDistrictCountryValue) {
      scenarioDistrictCountryInput.value = renderedDistrictCountryValue;
    }
    if (scenarioDistrictCountryInput) {
      scenarioDistrictCountryInput.placeholder = districtModel.isAutoMode
        ? (districtModel.inferredCountryCode || ui("Auto from selection"))
        : "DE";
      scenarioDistrictCountryInput.disabled = !hasActiveScenario || !!districtState.isSaving;
    }
    if (scenarioDistrictCountryModeNote) {
      scenarioDistrictCountryModeNote.textContent = districtModel.isAutoMode
        ? (districtModel.inferredCountryCode
          ? `${ui("Auto")}: ${districtModel.inferredCountryCode}`
          : ui("Auto from selection"))
        : `${ui("Manual")}: ${districtModel.manualCountryCode || ui("Type a geo country code.")}`;
    }
    if (scenarioDistrictUseSelectionBtn) {
      scenarioDistrictUseSelectionBtn.disabled = !hasActiveScenario || !!districtState.isSaving || !districtModel.canUseSelectionCountry;
    }
    if (scenarioDistrictClearBtn) {
      scenarioDistrictClearBtn.disabled = !hasActiveScenario || !!districtState.isSaving || !(
        districtModel.manualCountryCode
        || districtModel.selectedDistrictId
        || normalizeScenarioNameInput(districtState.nameEn)
        || normalizeScenarioNameInput(districtState.nameZh)
      );
    }
    if (scenarioDistrictSelect) {
      const nextOptions = [
        `<option value="">${ui("Select district")}</option>`,
        ...districtModel.districtEntries.map((district) => {
          const label = district.name_en || district.name_zh || district.id;
          return `<option value="${district.id}">${label}</option>`;
        }),
      ].join("");
      if (scenarioDistrictSelect.innerHTML !== nextOptions) {
        scenarioDistrictSelect.innerHTML = nextOptions;
      }
      const selectedDistrictId = districtModel.selectedDistrictId || "";
      if (scenarioDistrictSelect.value !== selectedDistrictId) {
        scenarioDistrictSelect.value = selectedDistrictId;
      }
      scenarioDistrictSelect.disabled = !hasActiveScenario || !districtModel.hasEffectiveCountry || !!districtState.isSaving;
    }
    if (scenarioDistrictIdInput && scenarioDistrictIdInput.value !== districtModel.selectedDistrictId) {
      scenarioDistrictIdInput.value = districtModel.selectedDistrictId;
    }
    if (scenarioDistrictIdInput) {
      scenarioDistrictIdInput.placeholder = "berlin";
      scenarioDistrictIdInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveCountry || !!districtState.isSaving;
    }
    const districtNameEn = normalizeScenarioNameInput(districtState.nameEn ?? districtModel.selectedDistrict?.name_en ?? "");
    const districtNameZh = normalizeScenarioNameInput(districtState.nameZh ?? districtModel.selectedDistrict?.name_zh ?? "");
    if (scenarioDistrictNameEnInput && scenarioDistrictNameEnInput.value !== districtNameEn) {
      scenarioDistrictNameEnInput.value = districtNameEn;
    }
    if (scenarioDistrictNameZhInput && scenarioDistrictNameZhInput.value !== districtNameZh) {
      scenarioDistrictNameZhInput.value = districtNameZh;
    }
    if (scenarioDistrictNameEnInput) {
      scenarioDistrictNameEnInput.placeholder = districtModel.selectedDistrict?.name_en || "Berlin";
      scenarioDistrictNameEnInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveCountry || !!districtState.isSaving;
    }
    if (scenarioDistrictNameZhInput) {
      scenarioDistrictNameZhInput.placeholder = districtModel.selectedDistrict?.name_zh || "Berlin";
      scenarioDistrictNameZhInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveCountry || !!districtState.isSaving;
    }
    const selectedDistrictFeatureIds = new Set(districtModel.selectedDistrict?.feature_ids || []);
    const matchingSelectionIds = districtModel.targetIds.filter((featureId) => {
      const feature = state.landIndex?.get(featureId);
      return feature && resolveFeatureGeoCountryCode(feature) === districtModel.countryCode;
    });
    const removableSelectionIds = matchingSelectionIds.filter((featureId) => selectedDistrictFeatureIds.has(featureId));
    const districtIdValue = normalizeScenarioDistrictId(scenarioDistrictIdInput?.value || districtState.selectedDistrictId);
    const canUpsertDistrict = hasActiveScenario
      && !!districtModel.countryCode
      && !!districtIdValue
      && !!districtNameEn
      && !!districtNameZh
      && !districtState.isSaving;
    const canAssignDistrict = hasActiveScenario
      && !!districtModel.countryCode
      && !!districtModel.selectedDistrictId
      && matchingSelectionIds.length > 0
      && !districtState.isSaving;
    const canRemoveDistrictSelection = hasActiveScenario
      && !!districtModel.countryCode
      && !!districtModel.selectedDistrictId
      && removableSelectionIds.length > 0
      && !districtState.isSaving;
    const canDeleteDistrict = hasActiveScenario
      && !!districtModel.countryCode
      && !!districtModel.selectedDistrictId
      && (districtModel.selectedDistrict?.feature_ids || []).length === 0
      && !districtState.isSaving;
    const canSaveDistricts = hasActiveScenario && !!districtModel.countryCode && !districtState.isSaving;
    const districtUpsertBtn = panel.querySelector("#devScenarioDistrictUpsertBtn");
    const districtAssignBtn = panel.querySelector("#devScenarioDistrictAssignBtn");
    const districtRemoveBtn = panel.querySelector("#devScenarioDistrictRemoveBtn");
    const districtDeleteBtn = panel.querySelector("#devScenarioDistrictDeleteBtn");
    const districtSaveBtn = panel.querySelector("#devScenarioDistrictSaveBtn");
    if (districtUpsertBtn) {
      districtUpsertBtn.textContent = ui("Upsert District");
      districtUpsertBtn.disabled = !canUpsertDistrict;
    }
    if (districtAssignBtn) {
      districtAssignBtn.textContent = ui("Assign Selection");
      districtAssignBtn.disabled = !canAssignDistrict;
    }
    if (districtRemoveBtn) {
      districtRemoveBtn.textContent = ui("Remove Selection");
      districtRemoveBtn.disabled = !canRemoveDistrictSelection;
    }
    if (districtDeleteBtn) {
      districtDeleteBtn.textContent = ui("Delete Empty District");
      districtDeleteBtn.disabled = !canDeleteDistrict;
    }
    if (districtSaveBtn) {
      districtSaveBtn.textContent = districtState.isSaving ? ui("Saving...") : ui("Save Districts File");
      districtSaveBtn.disabled = !canSaveDistricts;
    }
    if (scenarioDistrictStatus) {
      const districtStatusBits = [];
      if (districtState.lastSaveMessage) {
        districtStatusBits.push(districtState.lastSaveMessage);
      } else if (districtState.lastSavedAt) {
        districtStatusBits.push(`${ui("Last Saved")}: ${districtState.lastSavedAt}`);
      }
      scenarioDistrictStatus.textContent = districtStatusBits.join(" | ");
    }

    const localeModel = resolveLocaleEditorModel();
    const priorLocaleEditorState = state.devLocaleEditor || {};
    const localeFeatureChanged = String(priorLocaleEditorState.featureId || "") !== String(localeModel.featureId || "");
    const localeEditorState = localeFeatureChanged
      ? {
        ...priorLocaleEditorState,
        featureId: localeModel.featureId,
        en: localeModel.mergedEntry.en,
        zh: localeModel.mergedEntry.zh,
      }
      : priorLocaleEditorState;
    if (localeFeatureChanged) {
      state.devLocaleEditor = localeEditorState;
    }
    scenarioLocalePanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioLocaleTitle) {
      scenarioLocaleTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioLocaleHint) {
      scenarioLocaleHint.textContent = resolveLocaleEditorHint(localeModel);
    }
    renderMetaRows(scenarioLocaleMeta, buildLocaleMetaRows(localeModel));
    if (scenarioLocaleEnInput && scenarioLocaleEnInput.value !== normalizeLocaleInput(localeEditorState.en)) {
      scenarioLocaleEnInput.value = normalizeLocaleInput(localeEditorState.en);
    }
    if (scenarioLocaleZhInput && scenarioLocaleZhInput.value !== normalizeLocaleInput(localeEditorState.zh)) {
      scenarioLocaleZhInput.value = normalizeLocaleInput(localeEditorState.zh);
    }
    const canEditLocale = hasActiveScenario && localeModel.selectionCount === 1 && !!localeModel.featureId && !localeEditorState.isSaving;
    if (scenarioLocaleEnInput) {
      scenarioLocaleEnInput.disabled = !canEditLocale;
      scenarioLocaleEnInput.placeholder = localeModel.baseEntry?.en || resolveFeatureName(localeModel.feature, localeModel.featureId) || "Badghis";
    }
    if (scenarioLocaleZhInput) {
      scenarioLocaleZhInput.disabled = !canEditLocale;
      scenarioLocaleZhInput.placeholder = localeModel.baseEntry?.zh || "";
    }
    const saveLocaleBtn = panel.querySelector("#devScenarioSaveLocaleBtn");
    if (saveLocaleBtn) {
      saveLocaleBtn.textContent = localeEditorState.isSaving ? ui("Saving...") : ui("Save Localized Names");
      saveLocaleBtn.disabled = !(hasActiveScenario && localeModel.hasGeoLocalePatch && localeModel.selectionCount === 1 && !!localeModel.featureId) || !!localeEditorState.isSaving;
    }
    if (scenarioLocaleStatus) {
      const localeStatusBits = [];
      if (localeEditorState.lastSaveMessage) {
        localeStatusBits.push(localeEditorState.lastSaveMessage);
      } else if (localeEditorState.lastSavedAt) {
        localeStatusBits.push(`${ui("Last Saved")}: ${localeEditorState.lastSavedAt}`);
      }
      scenarioLocaleStatus.textContent = localeStatusBits.join(" | ");
    }

    const ownershipModel = resolveOwnershipEditorModel();
    const editorState = state.devScenarioEditor || {};
    const requestedOwnerCode = normalizeOwnerInput(editorState.targetOwnerCode);
    const fallbackOwnerCode = normalizeOwnerInput(state.activeSovereignCode);
    const effectiveOwnerCode = requestedOwnerCode || fallbackOwnerCode;
    scenarioOwnershipPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioOwnershipTitle) {
      scenarioOwnershipTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioOwnershipHint) {
      scenarioOwnershipHint.textContent = resolveOwnershipEditorHint(ownershipModel);
    }
    renderMetaRows(scenarioOwnershipMeta, buildOwnershipMetaRows(ownershipModel));
    if (scenarioOwnerInput && scenarioOwnerInput.value !== requestedOwnerCode) {
      scenarioOwnerInput.value = requestedOwnerCode;
    }
    if (scenarioOwnerInput) {
      scenarioOwnerInput.placeholder = fallbackOwnerCode || "GER";
      scenarioOwnerInput.disabled = !hasActiveScenario || !!editorState.isSaving;
    }
    const statusBits = [];
    if (fallbackOwnerCode && !requestedOwnerCode) {
      statusBits.push(`${ui("Active Owner")}: ${fallbackOwnerCode}`);
    }
    if (editorState.lastSaveMessage) {
      statusBits.push(editorState.lastSaveMessage);
    } else if (editorState.lastSavedAt) {
      statusBits.push(`${ui("Last Saved")}: ${editorState.lastSavedAt}`);
    }
    if (scenarioOwnershipStatus) {
      scenarioOwnershipStatus.textContent = statusBits.join(" | ");
    }
    const canApplyOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !!effectiveOwnerCode && !editorState.isSaving;
    const canResetOwner = hasActiveScenario && ownershipModel.selectionCount > 0 && !editorState.isSaving;
    const canSaveOwners = hasActiveScenario && !editorState.isSaving;
    const applyOwnerBtn = panel.querySelector("#devScenarioApplyOwnerBtn");
    const resetOwnerBtn = panel.querySelector("#devScenarioResetOwnerBtn");
    const saveOwnersBtn = panel.querySelector("#devScenarioSaveOwnersBtn");
    if (applyOwnerBtn) {
      applyOwnerBtn.textContent = ui("Apply to Selection");
      applyOwnerBtn.disabled = !canApplyOwner;
    }
    if (resetOwnerBtn) {
      resetOwnerBtn.textContent = ui("Reset Selection");
      resetOwnerBtn.disabled = !canResetOwner;
    }
    if (saveOwnersBtn) {
      saveOwnersBtn.textContent = editorState.isSaving ? ui("Saving...") : ui("Save Owners File");
      saveOwnersBtn.disabled = !canSaveOwners;
    }

    renderMetaRows(renderStatusMeta, resolveRenderRows());

    const runtime = resolveRuntimeRows();
    runtimeTitle.textContent = runtime.title;
    runtimeHint.textContent = runtime.hint;
    renderMetaRows(runtimeMeta, runtime.rows);

    if (selectionSortMode && selectionSortMode.value !== state.devSelectionSortMode) {
      selectionSortMode.value = state.devSelectionSortMode;
    }

    const entries = sortSelectionEntries(resolveSelectionEntries());
    const entryCount = entries.length;
    selectionSummary.textContent = localizeSelectionSummary(entryCount);
    selectionPreview.value = buildClipboardText(state.devClipboardPreviewFormat || "names_with_ids")
      || state.devClipboardFallbackText
      || "";

    [
      panel.querySelector("#devCopyNamesBtn"),
      panel.querySelector("#devCopyNamesIdsBtn"),
      panel.querySelector("#devCopyIdsBtn"),
      panel.querySelector("#devSelectionRemoveLastBtn"),
      panel.querySelector("#devSelectionClearBtn"),
      panel.querySelector("#devMacroSelectionBtn"),
    ].forEach((button) => {
      if (button) {
        button.disabled = entryCount === 0;
      }
    });
  };

  state.updateDevWorkspaceUIFn = renderWorkspace;

  bindButtonAction(toggleBtn, () => {
    const next = !state.ui.devWorkspaceExpanded;
    setExpandedState(next, { bottomDock, panel, toggleBtn });
    if (next) {
      loadRuntimeMeta();
      panel.scrollTop = 0;
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });

  bindButtonAction(panel.querySelector("#devSelectionAddHoveredBtn"), () => {
    const hoveredId = state.devHoverHit?.targetType === "land" ? state.devHoverHit.id : state.hoveredId;
    mapRenderer.addFeatureToDevSelection(hoveredId);
  });
  bindButtonAction(panel.querySelector("#devSelectionToggleSelectedBtn"), () => {
    const selectedId = state.devSelectedHit?.targetType === "land" ? state.devSelectedHit.id : "";
    mapRenderer.toggleFeatureInDevSelection(selectedId);
  });
  bindButtonAction(panel.querySelector("#devSelectionRemoveLastBtn"), () => {
    mapRenderer.removeLastDevSelection();
  });
  bindButtonAction(panel.querySelector("#devSelectionClearBtn"), () => {
    mapRenderer.clearDevSelection();
  });

  bindButtonAction(panel.querySelector("#devMacroCountryBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentCountry();
  });
  bindButtonAction(panel.querySelector("#devMacroParentBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentParentGroup();
  });
  bindButtonAction(panel.querySelector("#devMacroOwnerBtn"), () => {
    mapRenderer.applyDevMacroFillCurrentOwnerScope();
  });
  bindButtonAction(panel.querySelector("#devMacroSelectionBtn"), () => {
    mapRenderer.applyDevSelectionFill();
  });

  bindButtonAction(panel.querySelector("#devScenarioCreateTagBtn"), async () => {
    const built = buildScenarioTagCreatorPayload();
    if (!built.ok || !built.payload) {
      showToast(built.validation?.message || ui("Select one or more land features before creating a tag."), {
        title: ui("Scenario Tag Creator"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const creatorState = state.devScenarioTagCreator || {};
    state.devScenarioTagCreator = {
      ...creatorState,
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/tag/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(built.payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      const responseReleasableCatalog = result?.releasableCatalog || result?.releasable_catalog || null;
      if (responseReleasableCatalog) {
        state.releasableCatalog = responseReleasableCatalog;
        state.scenarioReleasableIndex = buildScenarioReleasableIndex(state.activeScenarioId, {
          excludeTags: Object.keys(state.scenarioCountriesByTag || {}),
        });
        rebuildPresetState();
      }
      applyScenarioTagCreatorSuccess(result, built.payload, built.targetIds);
      resetTagCreatorForm({ preserveStatus: true });
      state.devScenarioTagCreator = {
        ...(state.devScenarioTagCreator || {}),
        isSaving: false,
        lastSavedAt: String(result.savedAt || ""),
        lastSavedPath: String(result.filePath || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || built.payload.tag || "")}`,
        lastSaveTone: "success",
      };
      showToast(ui("Scenario tag created."), {
        title: ui("Scenario Tag Creator"),
        tone: "success",
      });
    } catch (error) {
      state.devScenarioTagCreator = {
        ...(state.devScenarioTagCreator || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to create tag.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to create tag.")), {
        title: ui("Scenario Tag Creator"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(scenarioClearTagBtn, () => {
    resetTagCreatorForm();
    renderWorkspace();
  });

  bindButtonAction(scenarioDistrictUseSelectionBtn, () => {
    const model = resolveDistrictEditorModel();
    if (!model.canUseSelectionCountry) {
      showToast(ui("Select land features from exactly one geo country first."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    resetDistrictEditorForm();
    updateDistrictEditorState({
      inferredCountryCode: model.inferredCountryCode,
      countryCode: model.inferredCountryCode,
    });
    renderWorkspace();
  });

  bindButtonAction(scenarioDistrictClearBtn, () => {
    resetDistrictEditorForm();
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictUpsertBtn"), () => {
    const model = resolveDistrictEditorModel();
    if (!state.activeScenarioId || !model.countryCode) {
      showToast(ui("Choose a geo country code before editing districts."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const result = upsertDistrictDraft(model);
    if (!result.ok) {
      showToast(result.message || ui("Unable to update the district draft."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(state.devScenarioDistrictEditor?.lastSaveMessage || ui("District draft updated."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictAssignBtn"), () => {
    const model = resolveDistrictEditorModel();
    const result = assignSelectionToDistrictDraft(model);
    if (!result.ok) {
      showToast(result.message || ui("Unable to assign the current selection."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(ui("Assigned selection to district."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictRemoveBtn"), () => {
    const model = resolveDistrictEditorModel();
    const result = removeSelectionFromDistrictDraft(model);
    if (!result.ok) {
      showToast(
        state.devScenarioDistrictEditor?.lastSaveMessage || result.message || ui("Unable to remove the current selection."),
        {
          title: ui("Scenario District Editor"),
          tone: result.count === 0 ? "info" : "warning",
        }
      );
      renderWorkspace();
      return;
    }
    showToast(ui("Removed selection from district."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictDeleteBtn"), () => {
    const model = resolveDistrictEditorModel();
    const result = deleteDistrictDraft(model);
    if (!result.ok) {
      showToast(result.message || ui("Unable to delete the district draft."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(ui("District removed from draft."), {
      title: ui("Scenario District Editor"),
      tone: "success",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioDistrictSaveBtn"), async () => {
    const model = resolveDistrictEditorModel();
    if (!state.activeScenarioId || !model.countryCode) {
      showToast(ui("Choose a geo country code before saving districts."), {
        title: ui("Scenario District Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const draftCountry = cloneDistrictCountryRecord(model.countryCode, model.draftCountry);
    updateDistrictEditorState({
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    });
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/districts/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildDistrictSavePayload({
          ...model,
          draftCountry,
        })),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      if (result?.country && typeof result.country === "object") {
        syncScenarioDistrictState(model.countryCode, result.country);
        setDistrictDraftCountry(model.countryCode, result.country, {
          lastSavedAt: String(result.savedAt || ""),
          lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
          lastSaveTone: "success",
          isSaving: false,
        });
      } else {
        updateDistrictEditorState({
          isSaving: false,
          lastSavedAt: String(result.savedAt || ""),
          lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
          lastSaveTone: "success",
        });
      }
      state.activeScenarioManifest = {
        ...(state.activeScenarioManifest || {}),
        district_groups_url: String(result.filePath || state.activeScenarioManifest?.district_groups_url || ""),
      };
      mapRenderer.rebuildStaticMeshes();
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      showToast(ui("Scenario districts file saved."), {
        title: ui("Scenario District Editor"),
        tone: "success",
      });
    } catch (error) {
      updateDistrictEditorState({
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save districts file.")),
        lastSaveTone: "critical",
      });
      showToast(String(error?.message || ui("Unable to save districts file.")), {
        title: ui("Scenario District Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveLocaleBtn"), async () => {
    const localeModel = resolveLocaleEditorModel();
    if (!state.activeScenarioId || !localeModel.featureId) {
      showToast(ui("Select exactly one land feature before saving localized names."), {
        title: ui("Scenario Locale Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const geoLocalePatchUrl = String(state.activeScenarioManifest?.geo_locale_patch_url || "").trim();
    if (!geoLocalePatchUrl) {
      showToast(ui("The active scenario does not declare a geo locale patch target."), {
        title: ui("Scenario Locale Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const localeEditorState = state.devLocaleEditor || {};
    state.devLocaleEditor = {
      ...localeEditorState,
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/geo-locale/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: state.activeScenarioId,
          featureId: localeModel.featureId,
          en: normalizeLocaleInput(state.devLocaleEditor?.en),
          zh: normalizeLocaleInput(state.devLocaleEditor?.zh),
          mode: "manual_override",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      const patchUrl = new URL(geoLocalePatchUrl, globalThis.location?.origin || globalThis.location?.href);
      patchUrl.searchParams.set("_t", String(Date.now()));
      const patchResponse = await fetch(patchUrl.href, { cache: "no-store" });
      if (!patchResponse.ok) {
        throw new Error(`Unable to reload geo locale patch (HTTP ${patchResponse.status}).`);
      }
      const patchPayload = await patchResponse.json();
      syncScenarioLocalizationState({
        cityOverridesPayload: state.scenarioCityOverridesData,
        geoLocalePatchPayload: patchPayload,
      });
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        isSaving: false,
        featureId: localeModel.featureId,
        en: normalizeLocaleInput(state.devLocaleEditor?.en),
        zh: normalizeLocaleInput(state.devLocaleEditor?.zh),
        lastSavedAt: String(result.savedAt || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      };
      if (typeof state.renderNowFn === "function") {
        state.renderNowFn();
      }
      showToast(ui("Scenario localized names saved."), {
        title: ui("Scenario Locale Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save localized names.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save localized names.")), {
        title: ui("Scenario Locale Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioApplyOwnerBtn"), () => {
    const targetIds = resolveOwnershipTargetIds();
    const requestedOwnerCode = normalizeOwnerInput(state.devScenarioEditor?.targetOwnerCode);
    const ownerCode = requestedOwnerCode || normalizeOwnerInput(state.activeSovereignCode);
    const result = applyOwnerToFeatureIds(targetIds, ownerCode, {
      historyKind: "dev-workspace-ownership-apply",
      dirtyReason: "dev-workspace-ownership-apply",
      recomputeReason: "dev-workspace-ownership-apply",
    });
    if (!result.applied) {
      const message = result.reason === "missing-owner"
        ? ui("Enter a target owner tag or choose an active owner first.")
        : ui("Select one or more land features before applying ownership.");
      showToast(message, {
        title: ui("Scenario Ownership Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    const changedLabel = result.changed === 1 ? ui("feature") : ui("features");
    showToast(`${ui("Applied ownership to")} ${result.changed} ${changedLabel}.`, {
      title: ui("Scenario Ownership Editor"),
      tone: result.changed > 0 ? "success" : "info",
    });
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioResetOwnerBtn"), () => {
    const result = resetOwnersToScenarioBaselineForFeatureIds(resolveOwnershipTargetIds(), {
      historyKind: "dev-workspace-ownership-reset",
      dirtyReason: "dev-workspace-ownership-reset",
      recomputeReason: "dev-workspace-ownership-reset",
    });
    if (!result.applied) {
      showToast(ui("Select one or more land features with scenario ownership before resetting."), {
        title: ui("Scenario Ownership Editor"),
        tone: "warning",
      });
      renderWorkspace();
      return;
    }
    showToast(
      result.changed > 0
        ? `${ui("Reset ownership for")} ${result.changed} ${result.changed === 1 ? ui("feature") : ui("features")}.`
        : ui("Selected features already match the active scenario baseline."),
      {
        title: ui("Scenario Ownership Editor"),
        tone: result.changed > 0 ? "success" : "info",
      }
    );
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devScenarioSaveOwnersBtn"), async () => {
    if (!state.activeScenarioId || state.devScenarioEditor?.isSaving) return;
    const payload = buildScenarioOwnershipSavePayload();
    state.devScenarioEditor = {
      ...(state.devScenarioEditor || {}),
      isSaving: true,
      lastSaveMessage: "",
      lastSaveTone: "",
    };
    renderWorkspace();
    try {
      const response = await fetch("/__dev/scenario/ownership/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: payload.scenarioId,
          baselineHash: payload.baselineHash,
          owners: payload.owners,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(String(result?.message || `HTTP ${response.status}`));
      }
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        isSaving: false,
        lastSavedAt: String(result.savedAt || ""),
        lastSavedPath: String(result.filePath || ""),
        lastSaveMessage: `${ui("Saved")}: ${String(result.filePath || "")}`,
        lastSaveTone: "success",
      };
      showToast(ui("Scenario ownership file saved."), {
        title: ui("Scenario Ownership Editor"),
        tone: "success",
      });
    } catch (error) {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        isSaving: false,
        lastSaveMessage: String(error?.message || ui("Unable to save ownership file.")),
        lastSaveTone: "critical",
      };
      showToast(String(error?.message || ui("Unable to save ownership file.")), {
        title: ui("Scenario Ownership Editor"),
        tone: "critical",
        duration: 4200,
      });
    }
    renderWorkspace();
  });

  bindButtonAction(panel.querySelector("#devCopyNamesBtn"), () => {
    copySelectionToClipboard("names", selectionPreview);
  });
  bindButtonAction(panel.querySelector("#devCopyNamesIdsBtn"), () => {
    copySelectionToClipboard("names_with_ids", selectionPreview);
  });
  bindButtonAction(panel.querySelector("#devCopyIdsBtn"), () => {
    copySelectionToClipboard("ids", selectionPreview);
  });

  if (selectionSortMode && selectionSortMode.dataset.bound !== "true") {
    selectionSortMode.addEventListener("change", (event) => {
      state.devSelectionSortMode = String(event.target.value || "selection") === "name" ? "name" : "selection";
      renderWorkspace();
    });
    selectionSortMode.dataset.bound = "true";
  }

  if (scenarioOwnerInput && scenarioOwnerInput.dataset.bound !== "true") {
    scenarioOwnerInput.addEventListener("input", (event) => {
      state.devScenarioEditor = {
        ...(state.devScenarioEditor || {}),
        targetOwnerCode: normalizeOwnerInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioOwnerInput.dataset.bound = "true";
  }

  if (scenarioTagInput && scenarioTagInput.dataset.bound !== "true") {
    scenarioTagInput.addEventListener("input", (event) => {
      const creatorState = ensureTagCreatorState();
      const nextTag = normalizeScenarioTagInput(event.target.value);
      const derived = deriveTagCreatorUiState(nextTag);
      state.devScenarioTagCreator = {
        ...creatorState,
        tag: nextTag,
        duplicateTag: derived.duplicateTag,
        tagLengthHint: derived.tagLengthHint,
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioTagInput.dataset.bound = "true";
  }

  if (scenarioTagNameEnInput && scenarioTagNameEnInput.dataset.bound !== "true") {
    scenarioTagNameEnInput.addEventListener("input", (event) => {
      state.devScenarioTagCreator = {
        ...(state.devScenarioTagCreator || {}),
        nameEn: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioTagNameEnInput.dataset.bound = "true";
  }

  if (scenarioTagNameZhInput && scenarioTagNameZhInput.dataset.bound !== "true") {
    scenarioTagNameZhInput.addEventListener("input", (event) => {
      state.devScenarioTagCreator = {
        ...(state.devScenarioTagCreator || {}),
        nameZh: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioTagNameZhInput.dataset.bound = "true";
  }

  if (scenarioTagColorInput && scenarioTagColorInput.dataset.bound !== "true") {
    scenarioTagColorInput.addEventListener("input", (event) => {
      const nextColor = normalizeScenarioColorInput(event.target.value);
      state.devScenarioTagCreator = {
        ...ensureTagCreatorState(),
        colorHex: nextColor || DEFAULT_TAG_CREATOR_COLOR,
        isColorPopoverOpen: false,
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      pushRecentTagColor(nextColor);
      renderWorkspace();
    });
    scenarioTagColorInput.dataset.bound = "true";
  }

  if (scenarioTagColorPreviewBtn && scenarioTagColorPreviewBtn.dataset.bound !== "true") {
    scenarioTagColorPreviewBtn.addEventListener("click", () => {
      state.devScenarioTagCreator = {
        ...ensureTagCreatorState(),
        isColorPopoverOpen: !ensureTagCreatorState().isColorPopoverOpen,
      };
      renderWorkspace();
    });
    scenarioTagColorPreviewBtn.dataset.bound = "true";
  }

  if (scenarioTagColorCustomBtn && scenarioTagColorCustomBtn.dataset.bound !== "true") {
    scenarioTagColorCustomBtn.addEventListener("click", () => {
      if (!scenarioTagColorInput) return;
      scenarioTagColorInput.focus({ preventScroll: true });
      if (typeof scenarioTagColorInput.showPicker === "function") {
        scenarioTagColorInput.showPicker();
      } else {
        scenarioTagColorInput.click();
      }
    });
    scenarioTagColorCustomBtn.dataset.bound = "true";
  }

  if (panel && panel.dataset.tagPopoverBound !== "true") {
    document.addEventListener("click", (event) => {
      const creatorState = state.devScenarioTagCreator || {};
      if (!creatorState.isColorPopoverOpen) return;
      const target = event.target;
      if (
        scenarioTagColorPreviewBtn?.contains(target)
        || scenarioTagColorPopover?.contains(target)
      ) {
        return;
      }
      state.devScenarioTagCreator = {
        ...ensureTagCreatorState(),
        isColorPopoverOpen: false,
      };
      renderWorkspace();
    });
    panel.dataset.tagPopoverBound = "true";
  }

  const bindTagColorSwatchContainer = (container) => {
    if (!container || container.dataset.bound === "true") return;
    container.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-dev-tag-color]");
      if (!button) return;
      const nextColor = normalizeScenarioColorInput(button.dataset.devTagColor);
      if (!nextColor) return;
      state.devScenarioTagCreator = {
        ...ensureTagCreatorState(),
        colorHex: nextColor,
        isColorPopoverOpen: false,
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      pushRecentTagColor(nextColor);
      renderWorkspace();
    });
    container.dataset.bound = "true";
  };
  bindTagColorSwatchContainer(scenarioTagPalette);
  bindTagColorSwatchContainer(scenarioTagRecentColors);

  if (scenarioTagParentInput && scenarioTagParentInput.dataset.bound !== "true") {
    scenarioTagParentInput.addEventListener("input", (event) => {
      state.devScenarioTagCreator = {
        ...ensureTagCreatorState(),
        parentOwnerTag: normalizeScenarioTagInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
    });
    scenarioTagParentInput.dataset.bound = "true";
  }

  if (scenarioDistrictCountryInput && scenarioDistrictCountryInput.dataset.bound !== "true") {
    scenarioDistrictCountryInput.addEventListener("input", (event) => {
      const nextCountryCode = normalizeGeoCountryCode(event.target.value);
      updateDistrictEditorState({
        countryMode: nextCountryCode ? "manual" : "auto",
        manualCountryCode: nextCountryCode,
        countryCode: nextCountryCode,
        selectedDistrictId: "",
        nameEn: "",
        nameZh: "",
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictCountryInput.dataset.bound = "true";
  }

  if (scenarioDistrictSelect && scenarioDistrictSelect.dataset.bound !== "true") {
    scenarioDistrictSelect.addEventListener("change", (event) => {
      const districtId = normalizeScenarioDistrictId(event.target.value);
      selectDistrictDraft(districtId);
      updateDistrictEditorState({
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictSelect.dataset.bound = "true";
  }

  if (scenarioDistrictIdInput && scenarioDistrictIdInput.dataset.bound !== "true") {
    scenarioDistrictIdInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        selectedDistrictId: normalizeScenarioDistrictId(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictIdInput.dataset.bound = "true";
  }

  if (scenarioDistrictNameEnInput && scenarioDistrictNameEnInput.dataset.bound !== "true") {
    scenarioDistrictNameEnInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        nameEn: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictNameEnInput.dataset.bound = "true";
  }

  if (scenarioDistrictNameZhInput && scenarioDistrictNameZhInput.dataset.bound !== "true") {
    scenarioDistrictNameZhInput.addEventListener("input", (event) => {
      updateDistrictEditorState({
        nameZh: normalizeScenarioNameInput(event.target.value),
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
    });
    scenarioDistrictNameZhInput.dataset.bound = "true";
  }

  if (scenarioLocaleEnInput && scenarioLocaleEnInput.dataset.bound !== "true") {
    scenarioLocaleEnInput.addEventListener("input", (event) => {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        en: normalizeLocaleInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioLocaleEnInput.dataset.bound = "true";
  }

  if (scenarioLocaleZhInput && scenarioLocaleZhInput.dataset.bound !== "true") {
    scenarioLocaleZhInput.addEventListener("input", (event) => {
      state.devLocaleEditor = {
        ...(state.devLocaleEditor || {}),
        zh: normalizeLocaleInput(event.target.value),
      };
      renderWorkspace();
    });
    scenarioLocaleZhInput.dataset.bound = "true";
  }

  const initialExpanded = readStoredExpanded();
  setExpandedState(initialExpanded, {
    bottomDock,
    panel,
    toggleBtn,
    persist: false,
  });
  renderWorkspace();
  loadRuntimeMeta();
}

export { initDevWorkspace };
