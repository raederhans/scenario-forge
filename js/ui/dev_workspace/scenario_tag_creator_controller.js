import { state as runtimeState } from "../../core/state.js";
import {
  clearDevSelection,
  refreshResolvedColorsForFeatures,
  scheduleDynamicBorderRecompute,
} from "../../core/map_renderer/public.js";
import { recalculateScenarioOwnerControllerDiffCount } from "../../core/scenario_owner_metrics.js";
import { getFeatureOwnerCode } from "../../core/sovereignty_manager.js";
import { applyOwnerControllerAssignmentsToFeatureIds } from "../../core/scenario_ownership_editor.js";
import { buildScenarioReleasableIndex, rebuildPresetState } from "../../core/releasable_manager.js";
import { t } from "../i18n.js";
import { showToast } from "../toast.js";
import {
  normalizeScenarioTagInput,
  normalizeScenarioNameInput,
  normalizeScenarioColorInput,
  sanitizeScenarioColorList,
} from "./dev_workspace_normalizers.js";
const state = runtimeState;

const TAG_CREATOR_RECENT_COLORS_STORAGE_KEY = "mapcreator_scenario_tag_recent_colors";
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

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

/**
 * Scenario Tag Creator owner.
 * 这个 controller 只负责 tag creator 面板自己的 state、render 和事件绑定。
 * dev_workspace.js 继续保留宿主 renderWorkspace facade 和其他子编辑器编排。
 */
export function createScenarioTagCreatorController({
  panel,
  renderWorkspace,
  renderMetaRows,
  syncSelectOptions,
  normalizeOwnerInput,
  resolveFeatureName,
  sanitizeSelectionState,
  resolveOwnershipTargetIds,
  resolveOwnershipEditorModel,
  buildOwnershipMetaRows,
  flushDevWorkspaceRender,
  upsertScenarioCountryRuntimeEntry,
  syncActiveScenarioBundleAssignments,
  syncActiveScenarioManifestUrl,
  upsertRuntimeReleasableCatalogEntry,
}) {
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
  const scenarioTagGroupSelect = panel.querySelector("#devScenarioTagGroupSelect");
  const scenarioTagGroupIdInput = panel.querySelector("#devScenarioTagGroupIdInput");
  const scenarioTagGroupLabelInput = panel.querySelector("#devScenarioTagGroupLabelInput");
  const scenarioTagGroupAnchorSelect = panel.querySelector("#devScenarioTagGroupAnchorSelect");
  const scenarioTagColorSampleBtn = panel.querySelector("#devScenarioTagColorSampleBtn");
  const scenarioClearTagSelectionBtn = panel.querySelector("#devScenarioClearTagSelectionBtn");
  const scenarioClearTagBtn = panel.querySelector("#devScenarioClearTagBtn");
  const scenarioTagCreatorStatus = panel.querySelector("#devScenarioTagCreatorStatus");
  const createTagBtn = panel.querySelector("#devScenarioCreateTagBtn");

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
      // Ignore storage failures in dev-only UI runtimeState.
    }
  }

  const ensureTagCreatorState = () => {
    const current = runtimeState.devScenarioTagCreator || {};
    const needsRecentLoad = !current.recentColorsLoaded;
    const nextRecentColors = needsRecentLoad
      ? readStoredTagCreatorRecentColors()
      : sanitizeScenarioColorList(current.recentColors);
    const nextState = {
      duplicateTag: false,
      tagLengthHint: "",
      isColorPopoverOpen: false,
      selectedInspectorGroupId: "",
      inspectorGroupId: "",
      inspectorGroupLabel: "",
      inspectorGroupAnchorId: "",
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
      || current.selectedInspectorGroupId !== nextState.selectedInspectorGroupId
      || current.inspectorGroupId !== nextState.inspectorGroupId
      || current.inspectorGroupLabel !== nextState.inspectorGroupLabel
      || current.inspectorGroupAnchorId !== nextState.inspectorGroupAnchorId
      || JSON.stringify(current.recentColors || []) !== JSON.stringify(nextState.recentColors)
    ) {
      runtimeState.devScenarioTagCreator = nextState;
    }
    return runtimeState.devScenarioTagCreator || nextState;
  };

  const pushRecentTagColor = (colorHex) => {
    const normalizedColor = normalizeScenarioColorInput(colorHex);
    if (!/^#[0-9A-F]{6}$/.test(normalizedColor)) return;
    const creatorState = ensureTagCreatorState();
    const priorColors = sanitizeScenarioColorList(creatorState.recentColors);
    const nextRecentColors = [
      normalizedColor,
      ...priorColors.filter((value) => normalizeScenarioColorInput(value) !== normalizedColor),
    ].slice(0, 10);
    runtimeState.devScenarioTagCreator = {
      ...creatorState,
      recentColors: nextRecentColors,
    };
    writeStoredTagCreatorRecentColors(nextRecentColors);
  };

  const buildTagCreatorPaletteRows = () => {
    const paletteSwatches = Array.isArray(runtimeState.paletteQuickSwatches)
      ? runtimeState.paletteQuickSwatches.map((entry) => normalizeScenarioColorInput(entry?.color)).filter(Boolean)
      : [];
    const paletteColors = Array.from(new Set([...paletteSwatches, ...TAG_CREATOR_FALLBACK_SWATCHES]))
      .filter((color) => /^#[0-9A-F]{6}$/.test(color))
      .slice(0, 18);
    const recentColors = sanitizeScenarioColorList(ensureTagCreatorState().recentColors);
    return {
      paletteColors,
      recentColors,
    };
  };

  const deriveTagCreatorUiState = (tagValue = "") => {
    const normalizedTag = normalizeScenarioTagInput(tagValue);
    const hasValidLength = /^[A-Z]{2,4}$/.test(normalizedTag);
    const duplicateTag = !!(normalizedTag && runtimeState.scenarioCountriesByTag?.[normalizedTag]);
    return {
      normalizedTag,
      duplicateTag,
      tagLengthHint: hasValidLength && normalizedTag.length !== 3
        ? ui("Three-letter tags are recommended.")
        : "",
    };
  };

  const syncTagCreatorDerivedState = () => {
    const creatorState = ensureTagCreatorState();
    const derived = deriveTagCreatorUiState(creatorState.tag);
    if (
      creatorState.duplicateTag !== derived.duplicateTag
      || creatorState.tagLengthHint !== derived.tagLengthHint
    ) {
      runtimeState.devScenarioTagCreator = {
        ...creatorState,
        duplicateTag: derived.duplicateTag,
        tagLengthHint: derived.tagLengthHint,
      };
    }
    return {
      ...(runtimeState.devScenarioTagCreator || creatorState),
      ...derived,
    };
  };

  const resetTagCreatorForm = ({ preserveStatus = false } = {}) => {
    const creatorState = ensureTagCreatorState();
    runtimeState.devScenarioTagCreator = {
      ...creatorState,
      tag: "",
      nameEn: "",
      nameZh: "",
      colorHex: DEFAULT_TAG_CREATOR_COLOR,
      parentOwnerTag: "",
      selectedInspectorGroupId: "",
      inspectorGroupId: "",
      inspectorGroupLabel: "",
      inspectorGroupAnchorId: "",
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
  };

  const resolveTagCreatorModel = () => {
    const targetIds = resolveOwnershipTargetIds();
    const ownershipModel = resolveOwnershipEditorModel();
    const singleFeatureId = targetIds.length === 1 ? targetIds[0] : "";
    const singleFeature = singleFeatureId ? runtimeState.landIndex?.get(singleFeatureId) || null : null;
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
  };

  const resolveTagCreatorHint = (model) => {
    if (!runtimeState.activeScenarioId) {
      return ui("Activate a scenario to create and assign a new tag.");
    }
    if (!model.selectionCount) {
      return ui("Select one or more land features to create a new scenario tag.");
    }
    return ui("Create a new scenario tag, optionally set a parent owner, and assign the current selection immediately.");
  };

  const normalizeScenarioInspectorGroupIdInput = (value) => {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 64);
  };

  const collectScenarioInspectorAnchorOptions = () => {
    const anchors = new Map();
    Object.values(runtimeState.scenarioCountriesByTag || {}).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const anchorId = String(entry.continent_id || "").trim();
      const anchorLabel = String(entry.continent_label || "").trim() || anchorId;
      if (!anchorId || anchors.has(anchorId)) return;
      anchors.set(anchorId, {
        id: anchorId,
        label: anchorLabel,
      });
    });
    return Array.from(anchors.values()).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  };

  const collectScenarioInspectorGroupOptions = () => {
    const groups = new Map();
    collectScenarioInspectorAnchorOptions().forEach((anchor) => {
      groups.set(anchor.id, {
        id: anchor.id,
        label: anchor.label,
        anchorId: anchor.id,
        isAnchor: true,
      });
    });
    Object.values(runtimeState.scenarioCountriesByTag || {}).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const id = String(entry.inspector_group_id || "").trim();
      if (!id || groups.has(id)) return;
      groups.set(id, {
        id,
        label: String(entry.inspector_group_label || id).trim() || id,
        anchorId: String(entry.inspector_group_anchor_id || entry.continent_id || "").trim(),
        isAnchor: false,
      });
    });
    return Array.from(groups.values()).sort((a, b) => {
      if (!!a.isAnchor !== !!b.isAnchor) return a.isAnchor ? -1 : 1;
      return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
  };

  const resolveTagCreatorInspectorGroupSelection = (input = {}) => {
    const selectedGroupId = String(input.selectedInspectorGroupId || "").trim();
    const draftGroupId = normalizeScenarioInspectorGroupIdInput(input.inspectorGroupId);
    const draftGroupLabel = normalizeScenarioNameInput(input.inspectorGroupLabel);
    const draftGroupAnchorId = String(input.inspectorGroupAnchorId || "").trim();
    const hasDraftValues = !!(draftGroupId || draftGroupLabel || draftGroupAnchorId);
    if (hasDraftValues) {
      if (!draftGroupId) {
        return { ok: false, message: ui("New inspector group id is required.") };
      }
      if (!/^[a-z0-9_-]+$/i.test(draftGroupId)) {
        return { ok: false, message: ui("Inspector group id must use letters, numbers, underscore, or hyphen.") };
      }
      if (!draftGroupLabel) {
        return { ok: false, message: ui("New inspector group label is required.") };
      }
      if (!draftGroupAnchorId) {
        return { ok: false, message: ui("Anchor region is required for a new inspector group.") };
      }
      return {
        ok: true,
        values: {
          inspectorGroupId: draftGroupId,
          inspectorGroupLabel: draftGroupLabel,
          inspectorGroupAnchorId: draftGroupAnchorId,
        },
      };
    }
    if (!selectedGroupId) {
      return {
        ok: true,
        values: {
          inspectorGroupId: "",
          inspectorGroupLabel: "",
          inspectorGroupAnchorId: "",
        },
      };
    }
    const selectedGroup = collectScenarioInspectorGroupOptions().find((entry) => entry.id === selectedGroupId) || null;
    if (!selectedGroup) {
      return { ok: false, message: ui("Selected inspector group could not be resolved.") };
    }
    return {
      ok: true,
      values: {
        inspectorGroupId: selectedGroup.id,
        inspectorGroupLabel: selectedGroup.label,
        inspectorGroupAnchorId: selectedGroup.anchorId,
      },
    };
  };

  const validateTagCreatorInput = ({
    tag = "",
    nameEn = "",
    nameZh = "",
    colorHex = "",
    parentOwnerTag = "",
    selectedInspectorGroupId = "",
    inspectorGroupId = "",
    inspectorGroupLabel = "",
    inspectorGroupAnchorId = "",
  } = {}, targetIds = []) => {
    const tagUiState = deriveTagCreatorUiState(tag);
    const normalizedTag = tagUiState.normalizedTag;
    const normalizedNameEn = normalizeScenarioNameInput(nameEn);
    const normalizedNameZh = normalizeScenarioNameInput(nameZh);
    const normalizedColorHex = normalizeScenarioColorInput(colorHex);
    const normalizedParentOwnerTag = normalizeScenarioTagInput(parentOwnerTag);
    const activeScenario = String(runtimeState.activeScenarioId || "").trim();

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
    if (normalizedParentOwnerTag && !runtimeState.scenarioCountriesByTag?.[normalizedParentOwnerTag]) {
      return {
        ok: false,
        code: "missing-parent-tag",
        duplicateTag: false,
        tagLengthHint: tagUiState.tagLengthHint,
        message: ui("Parent owner tag does not exist in the active scenario."),
      };
    }
    const inspectorGroup = resolveTagCreatorInspectorGroupSelection({
      selectedInspectorGroupId,
      inspectorGroupId,
      inspectorGroupLabel,
      inspectorGroupAnchorId,
    });
    if (!inspectorGroup.ok) {
      return {
        ok: false,
        code: "invalid-inspector-group",
        duplicateTag: false,
        tagLengthHint: tagUiState.tagLengthHint,
        message: inspectorGroup.message || ui("Inspector group settings are incomplete."),
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
        ...inspectorGroup.values,
      },
    };
  };

  const buildScenarioTagCreatorPayload = () => {
    const targetIds = resolveOwnershipTargetIds();
    const editorState = runtimeState.devScenarioTagCreator || {};
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
        scenarioId: String(runtimeState.activeScenarioId || "").trim(),
        featureIds: [...targetIds],
        ...validation.values,
      },
    };
  };

  const createScenarioCountryEntryFromTagCreator = ({
    tag,
    nameEn,
    nameZh,
    colorHex,
    parentOwnerTag,
    inspectorGroupId,
    inspectorGroupLabel,
    inspectorGroupAnchorId,
  }, targetIds = []) => {
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
    if (inspectorGroupId) {
      entry.inspector_group_id = inspectorGroupId;
      entry.inspector_group_label = inspectorGroupLabel || inspectorGroupId;
      entry.inspector_group_anchor_id = inspectorGroupAnchorId || "";
    }
    return entry;
  };

  const applyScenarioTagCreatorSuccess = (response, payload, targetIds = []) => {
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
        inspectorGroupId: String(payload?.inspectorGroupId || "").trim(),
        inspectorGroupLabel: normalizeScenarioNameInput(payload?.inspectorGroupLabel),
        inspectorGroupAnchorId: String(payload?.inspectorGroupAnchorId || "").trim(),
      },
      targetIds
    );
    const responseCountry = response?.countryEntry && typeof response.countryEntry === "object"
      ? response.countryEntry
      : (response?.country && typeof response.country === "object"
        ? response.country
        : (response?.scenarioCountry && typeof response.scenarioCountry === "object" ? response.scenarioCountry : null));
    const nextCountryEntry = responseCountry ? { ...createdEntry, ...responseCountry, tag: normalizedTag } : createdEntry;
    upsertScenarioCountryRuntimeEntry(normalizedTag, nextCountryEntry);
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
    const nextBaselineOwners = { ...(runtimeState.scenarioBaselineOwnersByFeatureId || {}) };
    const nextBaselineControllers = { ...(runtimeState.scenarioBaselineControllersByFeatureId || {}) };
    targetIds.forEach((featureId) => {
      const id = String(featureId || "").trim();
      if (!id) return;
      nextBaselineOwners[id] = normalizedTag;
      nextBaselineControllers[id] = normalizedTag;
    });
    runtimeState.scenarioBaselineOwnersByFeatureId = nextBaselineOwners;
    runtimeState.scenarioBaselineControllersByFeatureId = nextBaselineControllers;
    syncActiveScenarioBundleAssignments(targetIds, normalizedTag);
    if (response?.catalogPath) {
      syncActiveScenarioManifestUrl("releasable_catalog_url", response.catalogPath);
    }
    if (response?.releasableEntry && typeof response.releasableEntry === "object") {
      upsertRuntimeReleasableCatalogEntry(response.releasableEntry);
    }
    runtimeState.activeSovereignCode = normalizedTag;
    runtimeState.devScenarioEditor = {
      ...(runtimeState.devScenarioEditor || {}),
      targetOwnerCode: normalizedTag,
    };
    runtimeState.selectedInspectorCountryCode = normalizedTag;
    runtimeState.inspectorHighlightCountryCode = normalizedTag;
    recalculateScenarioOwnerControllerDiffCount();
    refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
    scheduleDynamicBorderRecompute("dev-workspace-tag-create", 90);
    flushDevWorkspaceRender("dev-workspace-tag-create");
    if (typeof runtimeState.updateScenarioUIFn === "function") {
      runtimeState.updateScenarioUIFn();
    }
  };

  const resolveCurrentSampleFeatureContext = () => {
    const selectedFeatureId = runtimeState.devSelectedHit?.targetType === "land"
      ? String(runtimeState.devSelectedHit.id || "").trim()
      : "";
    if (selectedFeatureId && runtimeState.landIndex?.has(selectedFeatureId)) {
      return {
        featureId: selectedFeatureId,
        feature: runtimeState.landIndex.get(selectedFeatureId) || null,
        source: "selected",
      };
    }
    const selectionIds = sanitizeSelectionState();
    const recentFeatureId = selectionIds.length ? selectionIds[selectionIds.length - 1] : "";
    if (recentFeatureId && runtimeState.landIndex?.has(recentFeatureId)) {
      return {
        featureId: recentFeatureId,
        feature: runtimeState.landIndex.get(recentFeatureId) || null,
        source: "selection",
      };
    }
    const hoveredFeatureId = runtimeState.devHoverHit?.targetType === "land"
      ? String(runtimeState.devHoverHit.id || "").trim()
      : (runtimeState.hoveredId && runtimeState.landIndex?.has(runtimeState.hoveredId) ? String(runtimeState.hoveredId || "").trim() : "");
    if (hoveredFeatureId && runtimeState.landIndex?.has(hoveredFeatureId)) {
      return {
        featureId: hoveredFeatureId,
        feature: runtimeState.landIndex.get(hoveredFeatureId) || null,
        source: "hovered",
      };
    }
    return {
      featureId: "",
      feature: null,
      source: "",
    };
  };

  const sampleScenarioTagColorFromContext = () => {
    const context = resolveCurrentSampleFeatureContext();
    if (!context.featureId) {
      return { ok: false, message: ui("Select or hover a land feature before sampling a color.") };
    }
    const ownerCode = normalizeScenarioTagInput(getFeatureOwnerCode(context.featureId));
    const candidateColors = [
      normalizeScenarioColorInput(runtimeState.colors?.[context.featureId]),
      normalizeScenarioColorInput(runtimeState.sovereignBaseColors?.[ownerCode]),
      normalizeScenarioColorInput(runtimeState.countryBaseColors?.[ownerCode]),
    ];
    const colorHex = candidateColors.find((value) => /^#[0-9A-F]{6}$/.test(value)) || "";
    if (!colorHex) {
      return { ok: false, message: ui("Unable to resolve a color from the current feature.") };
    }
    return {
      ok: true,
      colorHex,
      featureId: context.featureId,
      featureName: resolveFeatureName(context.feature, context.featureId),
      source: context.source,
    };
  };

  const clearScenarioTagCreatorSelectionTarget = () => {
    clearDevSelection();
    runtimeState.devSelectedHit = null;
    flushDevWorkspaceRender("dev-workspace-tag-clear-target");
  };

  const render = ({ hasActiveScenario }) => {
    const tagCreatorModel = resolveTagCreatorModel();
    const tagCreatorState = syncTagCreatorDerivedState();
    const tagCreatorValidation = validateTagCreatorInput(tagCreatorState, tagCreatorModel.targetIds);

    scenarioTagCreatorPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioTagCreatorTitle) {
      scenarioTagCreatorTitle.textContent = hasActiveScenario
        ? String(runtimeState.activeScenarioManifest?.display_name || runtimeState.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioTagCreatorHint) {
      scenarioTagCreatorHint.textContent = resolveTagCreatorHint(tagCreatorModel);
    }
    renderMetaRows(scenarioTagCreatorMeta, buildOwnershipMetaRows(tagCreatorModel));

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

    const inspectorGroups = collectScenarioInspectorGroupOptions();
    const inspectorAnchors = collectScenarioInspectorAnchorOptions();
    if (scenarioTagGroupSelect) {
      syncSelectOptions(
        scenarioTagGroupSelect,
        inspectorGroups.map((group) => ({ value: group.id, label: group.label })),
        { placeholderLabel: ui("No Inspector Group") }
      );
      const selectedGroupId = String(tagCreatorState.selectedInspectorGroupId || "").trim();
      if (scenarioTagGroupSelect.value !== selectedGroupId) {
        scenarioTagGroupSelect.value = selectedGroupId;
      }
      scenarioTagGroupSelect.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagGroupIdInput && scenarioTagGroupIdInput.value !== normalizeScenarioInspectorGroupIdInput(tagCreatorState.inspectorGroupId)) {
      scenarioTagGroupIdInput.value = normalizeScenarioInspectorGroupIdInput(tagCreatorState.inspectorGroupId);
    }
    if (scenarioTagGroupLabelInput && scenarioTagGroupLabelInput.value !== normalizeScenarioNameInput(tagCreatorState.inspectorGroupLabel)) {
      scenarioTagGroupLabelInput.value = normalizeScenarioNameInput(tagCreatorState.inspectorGroupLabel);
    }
    if (scenarioTagGroupAnchorSelect) {
      syncSelectOptions(
        scenarioTagGroupAnchorSelect,
        inspectorAnchors.map((anchor) => ({ value: anchor.id, label: anchor.label })),
        { placeholderLabel: ui("Select anchor region") }
      );
      const selectedAnchorId = String(tagCreatorState.inspectorGroupAnchorId || "").trim();
      if (scenarioTagGroupAnchorSelect.value !== selectedAnchorId) {
        scenarioTagGroupAnchorSelect.value = selectedAnchorId;
      }
      scenarioTagGroupAnchorSelect.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }

    const canCreateTag = hasActiveScenario && tagCreatorModel.selectionCount > 0 && tagCreatorValidation.ok && !tagCreatorState.isSaving;
    const canClearTagForm = !!(
      normalizeScenarioTagInput(tagCreatorState.tag)
      || normalizeScenarioNameInput(tagCreatorState.nameEn)
      || normalizeScenarioNameInput(tagCreatorState.nameZh)
      || normalizeScenarioTagInput(tagCreatorState.parentOwnerTag)
      || normalizeScenarioTagInput(tagCreatorState.selectedInspectorGroupId)
      || normalizeScenarioInspectorGroupIdInput(tagCreatorState.inspectorGroupId)
      || normalizeScenarioNameInput(tagCreatorState.inspectorGroupLabel)
      || String(tagCreatorState.inspectorGroupAnchorId || "").trim()
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
      scenarioTagNameEnInput.placeholder = ui("New Country");
      scenarioTagNameEnInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagNameZhInput) {
      scenarioTagNameZhInput.placeholder = ui("New Country");
      scenarioTagNameZhInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagParentInput) {
      scenarioTagParentInput.placeholder = normalizeOwnerInput(runtimeState.activeSovereignCode) || "GER";
      scenarioTagParentInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagGroupIdInput) {
      scenarioTagGroupIdInput.placeholder = "scenario_group_europe";
      scenarioTagGroupIdInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagGroupLabelInput) {
      scenarioTagGroupLabelInput.placeholder = ui("Europe");
      scenarioTagGroupLabelInput.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioTagColorSampleBtn) {
      scenarioTagColorSampleBtn.disabled = !hasActiveScenario || !!tagCreatorState.isSaving;
    }
    if (scenarioClearTagSelectionBtn) {
      scenarioClearTagSelectionBtn.disabled = !hasActiveScenario || !!tagCreatorState.isSaving || tagCreatorModel.selectionCount === 0;
    }
    if (scenarioClearTagBtn) {
      scenarioClearTagBtn.disabled = !hasActiveScenario || !!tagCreatorState.isSaving || !canClearTagForm;
    }
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
        && (
          normalizeScenarioTagInput(tagCreatorState.tag)
          || normalizeScenarioNameInput(tagCreatorState.nameEn)
          || normalizeScenarioNameInput(tagCreatorState.nameZh)
          || normalizeScenarioColorInput(tagCreatorState.colorHex)
          || normalizeScenarioTagInput(tagCreatorState.parentOwnerTag)
          || normalizeScenarioTagInput(tagCreatorState.selectedInspectorGroupId)
          || normalizeScenarioInspectorGroupIdInput(tagCreatorState.inspectorGroupId)
          || normalizeScenarioNameInput(tagCreatorState.inspectorGroupLabel)
          || String(tagCreatorState.inspectorGroupAnchorId || "").trim()
        )
      ) {
        tagStatusBits.push(tagCreatorValidation.message);
      } else if (tagCreatorState.lastSavedAt) {
        tagStatusBits.push(`${ui("Last Saved")}: ${tagCreatorState.lastSavedAt}`);
      }
      scenarioTagCreatorStatus.textContent = tagStatusBits.join(" | ");
    }
  };

  const bindTagColorSwatchContainer = (container) => {
    if (!container || container.dataset.bound === "true") return;
    container.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-dev-tag-color]");
      if (!button) return;
      const nextColor = normalizeScenarioColorInput(button.dataset.devTagColor);
      if (!nextColor) return;
      runtimeState.devScenarioTagCreator = {
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

  const bindEvents = () => {
    bindButtonAction(createTagBtn, async () => {
      const built = buildScenarioTagCreatorPayload();
      if (!built.ok || !built.payload) {
        showToast(built.validation?.message || ui("Select one or more land features before creating a tag."), {
          title: ui("Scenario Tag Creator"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      const creatorState = runtimeState.devScenarioTagCreator || {};
      runtimeState.devScenarioTagCreator = {
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
          runtimeState.releasableCatalog = responseReleasableCatalog;
          runtimeState.scenarioReleasableIndex = buildScenarioReleasableIndex(runtimeState.activeScenarioId, {
            excludeTags: Object.keys(runtimeState.scenarioCountriesByTag || {}),
          });
          rebuildPresetState();
        }
        applyScenarioTagCreatorSuccess(result, built.payload, built.targetIds);
        resetTagCreatorForm({ preserveStatus: true });
        runtimeState.devScenarioTagCreator = {
          ...(runtimeState.devScenarioTagCreator || {}),
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
        runtimeState.devScenarioTagCreator = {
          ...(runtimeState.devScenarioTagCreator || {}),
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

    bindButtonAction(scenarioClearTagSelectionBtn, () => {
      clearScenarioTagCreatorSelectionTarget();
      showToast(ui("Tag creator selection cleared."), {
        title: ui("Scenario Tag Creator"),
        tone: "info",
      });
      renderWorkspace();
    });

    if (scenarioTagInput && scenarioTagInput.dataset.bound !== "true") {
      scenarioTagInput.addEventListener("input", (event) => {
        const creatorState = ensureTagCreatorState();
        const nextTag = normalizeScenarioTagInput(event.target.value);
        const derived = deriveTagCreatorUiState(nextTag);
        runtimeState.devScenarioTagCreator = {
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
        runtimeState.devScenarioTagCreator = {
          ...(runtimeState.devScenarioTagCreator || {}),
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
        runtimeState.devScenarioTagCreator = {
          ...(runtimeState.devScenarioTagCreator || {}),
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
        runtimeState.devScenarioTagCreator = {
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
        runtimeState.devScenarioTagCreator = {
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

    if (scenarioTagColorSampleBtn && scenarioTagColorSampleBtn.dataset.bound !== "true") {
      scenarioTagColorSampleBtn.addEventListener("click", () => {
        const sampled = sampleScenarioTagColorFromContext();
        if (!sampled.ok) {
          showToast(sampled.message || ui("Unable to sample a color."), {
            title: ui("Scenario Tag Creator"),
            tone: "warning",
          });
          renderWorkspace();
          return;
        }
        runtimeState.devScenarioTagCreator = {
          ...ensureTagCreatorState(),
          colorHex: sampled.colorHex,
          isColorPopoverOpen: false,
          lastSaveMessage: `${ui("Sampled")}: ${sampled.featureName || sampled.featureId}`,
          lastSaveTone: "info",
        };
        pushRecentTagColor(sampled.colorHex);
        showToast(`${ui("Sampled color from")} ${sampled.featureName || sampled.featureId}.`, {
          title: ui("Scenario Tag Creator"),
          tone: "success",
        });
        renderWorkspace();
      });
      scenarioTagColorSampleBtn.dataset.bound = "true";
    }

    if (typeof runtimeState.devWorkspaceTagPopoverDismissHandler === "function") {
      document.removeEventListener("click", runtimeState.devWorkspaceTagPopoverDismissHandler);
    }
    runtimeState.devWorkspaceTagPopoverDismissHandler = (event) => {
      const creatorState = runtimeState.devScenarioTagCreator || {};
      if (!creatorState.isColorPopoverOpen) return;
      const target = event.target;
      if (
        scenarioTagColorPreviewBtn?.contains(target)
        || scenarioTagColorPopover?.contains(target)
      ) {
        return;
      }
      runtimeState.devScenarioTagCreator = {
        ...ensureTagCreatorState(),
        isColorPopoverOpen: false,
      };
      renderWorkspace();
    };
    document.addEventListener("click", runtimeState.devWorkspaceTagPopoverDismissHandler);

    bindTagColorSwatchContainer(scenarioTagPalette);
    bindTagColorSwatchContainer(scenarioTagRecentColors);

    if (scenarioTagParentInput && scenarioTagParentInput.dataset.bound !== "true") {
      scenarioTagParentInput.addEventListener("input", (event) => {
        runtimeState.devScenarioTagCreator = {
          ...ensureTagCreatorState(),
          parentOwnerTag: normalizeScenarioTagInput(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioTagParentInput.dataset.bound = "true";
    }

    if (scenarioTagGroupSelect && scenarioTagGroupSelect.dataset.bound !== "true") {
      scenarioTagGroupSelect.addEventListener("change", (event) => {
        runtimeState.devScenarioTagCreator = {
          ...ensureTagCreatorState(),
          selectedInspectorGroupId: String(event.target.value || "").trim(),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioTagGroupSelect.dataset.bound = "true";
    }

    if (scenarioTagGroupIdInput && scenarioTagGroupIdInput.dataset.bound !== "true") {
      scenarioTagGroupIdInput.addEventListener("input", (event) => {
        runtimeState.devScenarioTagCreator = {
          ...ensureTagCreatorState(),
          inspectorGroupId: normalizeScenarioInspectorGroupIdInput(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioTagGroupIdInput.dataset.bound = "true";
    }

    if (scenarioTagGroupLabelInput && scenarioTagGroupLabelInput.dataset.bound !== "true") {
      scenarioTagGroupLabelInput.addEventListener("input", (event) => {
        runtimeState.devScenarioTagCreator = {
          ...ensureTagCreatorState(),
          inspectorGroupLabel: normalizeScenarioNameInput(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioTagGroupLabelInput.dataset.bound = "true";
    }

    if (scenarioTagGroupAnchorSelect && scenarioTagGroupAnchorSelect.dataset.bound !== "true") {
      scenarioTagGroupAnchorSelect.addEventListener("change", (event) => {
        runtimeState.devScenarioTagCreator = {
          ...ensureTagCreatorState(),
          inspectorGroupAnchorId: String(event.target.value || "").trim(),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioTagGroupAnchorSelect.dataset.bound = "true";
    }
  };

  return {
    bindEvents,
    clearScenarioTagCreatorSelectionTarget,
    render,
  };
}


