import { state } from "../../core/state.js";
import { rebuildStaticMeshes } from "../../core/map_renderer/public.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  getScenarioDistrictTagRecord,
  normalizeScenarioDistrictGroupsPayload,
  normalizeScenarioDistrictTag,
} from "../../core/scenario_districts.js";
import { t } from "../i18n.js";
import { showToast } from "../toast.js";

function ui(key) {
  return t(key, "ui");
}

function bindButtonAction(button, action) {
  if (!button || button.dataset.bound === "true") return;
  button.addEventListener("click", action);
  button.dataset.bound = "true";
}

/**
 * Scenario district editor owner.
 * 这里统一接管 district editor 的局部 state、render、保存链、模板链和事件绑定。
 * dev_workspace.js 继续保留宿主 panel、category 显隐和整个 workspace 的 facade。
 */
export function createDistrictEditorController({
  panel,
  renderWorkspace,
  renderMetaRows,
  syncSelectOptions,
  normalizeScenarioNameInput,
  resolveOwnershipTargetIds,
  flushDevWorkspaceRender,
}) {
  const scenarioDistrictTitle = panel.querySelector("#devScenarioDistrictTitle");
  const scenarioDistrictHint = panel.querySelector("#devScenarioDistrictHint");
  const scenarioDistrictMeta = panel.querySelector("#devScenarioDistrictMeta");
  const scenarioDistrictTagInput = panel.querySelector("#devScenarioDistrictTagInput");
  const scenarioDistrictTagModeNote = panel.querySelector("#devScenarioDistrictTagModeNote");
  const scenarioDistrictUseSelectionBtn = panel.querySelector("#devScenarioDistrictUseSelectionBtn");
  const scenarioDistrictClearBtn = panel.querySelector("#devScenarioDistrictClearBtn");
  const scenarioDistrictSelect = panel.querySelector("#devScenarioDistrictSelect");
  const scenarioDistrictIdInput = panel.querySelector("#devScenarioDistrictIdInput");
  const scenarioDistrictNameEnInput = panel.querySelector("#devScenarioDistrictNameEnInput");
  const scenarioDistrictNameZhInput = panel.querySelector("#devScenarioDistrictNameZhInput");
  const scenarioDistrictTemplateTagInput = panel.querySelector("#devScenarioDistrictTemplateTagInput");
  const scenarioDistrictPromoteBtn = panel.querySelector("#devScenarioDistrictPromoteBtn");
  const scenarioDistrictApplyTemplateBtn = panel.querySelector("#devScenarioDistrictApplyTemplateBtn");
  const scenarioDistrictStatus = panel.querySelector("#devScenarioDistrictStatus");
  const districtUpsertBtn = panel.querySelector("#devScenarioDistrictUpsertBtn");
  const districtAssignBtn = panel.querySelector("#devScenarioDistrictAssignBtn");
  const districtRemoveBtn = panel.querySelector("#devScenarioDistrictRemoveBtn");
  const districtDeleteBtn = panel.querySelector("#devScenarioDistrictDeleteBtn");
  const districtSaveBtn = panel.querySelector("#devScenarioDistrictSaveBtn");

  const updateDistrictEditorState = (nextPartial = {}) => {
    const current = state.devScenarioDistrictEditor || {};
    state.devScenarioDistrictEditor = {
      tagMode: "auto",
      manualTag: "",
      inferredTag: "",
      templateTag: "",
      ...current,
      ...nextPartial,
    };
  };

  const normalizeScenarioDistrictId = (value) => {
    return String(value || "").trim().replace(/\s+/g, "_");
  };

  const cloneDistrictTagRecord = (tag = "", record = null) => {
    const normalizedTag = normalizeScenarioDistrictTag(tag);
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
      tag: normalizedTag,
      districts,
    };
  };

  const setDistrictDraftTag = (tag = "", draftTag = null, nextOverrides = {}) => {
    const normalizedTag = normalizeScenarioDistrictTag(tag);
    const nextDraftTag = cloneDistrictTagRecord(normalizedTag, draftTag);
    const districtIds = Object.keys(nextDraftTag.districts || {});
    const requestedDistrictId = normalizeScenarioDistrictId(
      nextOverrides.selectedDistrictId ?? state.devScenarioDistrictEditor?.selectedDistrictId
    );
    const selectedDistrictId = districtIds.includes(requestedDistrictId)
      ? requestedDistrictId
      : (requestedDistrictId === "" ? "" : (districtIds[0] || ""));
    const selectedDistrict = selectedDistrictId ? nextDraftTag.districts?.[selectedDistrictId] || null : null;
    updateDistrictEditorState({
      tag: normalizedTag,
      loadedScenarioId: String(state.activeScenarioId || ""),
      loadedTag: normalizedTag,
      draftTag: nextDraftTag,
      selectedDistrictId,
      nameEn: normalizeScenarioNameInput(nextOverrides.nameEn ?? selectedDistrict?.name_en ?? ""),
      nameZh: normalizeScenarioNameInput(nextOverrides.nameZh ?? selectedDistrict?.name_zh ?? ""),
      templateTag: normalizeScenarioDistrictTag(nextOverrides.templateTag ?? state.devScenarioDistrictEditor?.templateTag ?? normalizedTag),
      ...nextOverrides,
    });
  };

  const syncScenarioDistrictState = (tag = "", tagPayload = null) => {
    const normalizedTag = normalizeScenarioDistrictTag(tag);
    const nextPayload = normalizeScenarioDistrictGroupsPayload(
      {
        ...(state.scenarioDistrictGroupsData || {}),
        scenario_id: String(state.activeScenarioId || ""),
        tags: {
          ...((state.scenarioDistrictGroupsData && state.scenarioDistrictGroupsData.tags) || {}),
          [normalizedTag]: tagPayload,
        },
      },
      state.activeScenarioId
    );
    state.scenarioDistrictGroupsData = nextPayload;
    state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(nextPayload);
  };

  const resolveSelectionScenarioTags = (targetIds = []) => {
    return Array.from(new Set(
      (Array.isArray(targetIds) ? targetIds : [])
        .map((featureId) => normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]))
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right));
  };

  const ensureDistrictDraftForTag = (tag = "") => {
    const normalizedTag = normalizeScenarioDistrictTag(tag);
    const priorState = state.devScenarioDistrictEditor || {};
    if (!normalizedTag || !state.activeScenarioId) {
      return {
        ...priorState,
        draftTag: null,
      };
    }
    const needsReload =
      String(priorState.loadedScenarioId || "") !== String(state.activeScenarioId || "")
      || normalizeScenarioDistrictTag(priorState.loadedTag) !== normalizedTag
      || !priorState.draftTag;
    if (!needsReload) {
      return priorState;
    }
    const savedTag = cloneDistrictTagRecord(
      normalizedTag,
      getScenarioDistrictTagRecord(state.scenarioDistrictGroupsData, normalizedTag)
    );
    const districtIds = Object.keys(savedTag.districts);
    const normalizedSelectedDistrictId = normalizeScenarioDistrictId(priorState.selectedDistrictId);
    const nextSelectedDistrictId = districtIds.includes(normalizedSelectedDistrictId)
      ? normalizedSelectedDistrictId
      : (normalizedSelectedDistrictId === "" ? "" : (districtIds[0] || ""));
    const selectedDistrict = nextSelectedDistrictId ? savedTag.districts[nextSelectedDistrictId] || null : null;
    const nextState = {
      ...priorState,
      tag: normalizedTag,
      loadedScenarioId: String(state.activeScenarioId || ""),
      loadedTag: normalizedTag,
      draftTag: savedTag,
      selectedDistrictId: nextSelectedDistrictId,
      nameEn: normalizeScenarioNameInput(selectedDistrict?.name_en || ""),
      nameZh: normalizeScenarioNameInput(selectedDistrict?.name_zh || ""),
      templateTag: normalizeScenarioDistrictTag(priorState.templateTag) || normalizedTag,
    };
    state.devScenarioDistrictEditor = nextState;
    return nextState;
  };

  const resetDistrictEditorForm = ({ clearStatus = true } = {}) => {
    updateDistrictEditorState({
      tag: "",
      tagMode: "auto",
      manualTag: "",
      inferredTag: "",
      templateTag: "",
      selectedDistrictId: "",
      nameEn: "",
      nameZh: "",
      draftTag: null,
      loadedTag: "",
      loadedScenarioId: String(state.activeScenarioId || ""),
      ...(clearStatus
        ? {
          lastSaveMessage: "",
          lastSaveTone: "",
        }
        : {}),
    });
  };

  const resolveDistrictEditorModel = () => {
    const targetIds = resolveOwnershipTargetIds();
    const selectionTags = resolveSelectionScenarioTags(targetIds);
    const inferredTag = selectionTags.length === 1 ? selectionTags[0] : "";
    const editorBaseState = state.devScenarioDistrictEditor || {};
    const manualTag = normalizeScenarioDistrictTag(editorBaseState.manualTag);
    const isManualMode = editorBaseState.tagMode === "manual" && !!manualTag;
    const tagMode = isManualMode ? "manual" : "auto";
    const tag = tagMode === "manual" ? manualTag : inferredTag;
    const normalizedDistrictPayload = normalizeScenarioDistrictGroupsPayload(state.scenarioDistrictGroupsData, state.activeScenarioId);
    const legacyCountryCodes = Object.keys(normalizedDistrictPayload.legacy_countries || {});
    if (
      editorBaseState.inferredTag !== inferredTag
      || editorBaseState.tagMode !== tagMode
      || editorBaseState.tag !== tag
    ) {
      updateDistrictEditorState({
        inferredTag,
        tagMode,
        tag,
      });
    }
    const editorState = ensureDistrictDraftForTag(tag);
    const draftTag = editorState?.draftTag
      ? cloneDistrictTagRecord(tag, editorState.draftTag)
      : cloneDistrictTagRecord(tag, null);
    const districtEntries = Object.values(draftTag?.districts || {}).sort((left, right) => {
      const leftName = normalizeScenarioNameInput(left?.name_en || left?.name_zh || left?.id || "");
      const rightName = normalizeScenarioNameInput(right?.name_en || right?.name_zh || right?.id || "");
      return leftName.localeCompare(rightName) || String(left?.id || "").localeCompare(String(right?.id || ""));
    });
    const selectedDistrictId = normalizeScenarioDistrictId(editorState?.selectedDistrictId);
    const selectedDistrict = selectedDistrictId ? draftTag?.districts?.[selectedDistrictId] || null : null;
    return {
      targetIds,
      selectionCount: targetIds.length,
      selectionTags,
      tagMode,
      manualTag,
      inferredTag,
      tag,
      draftTag,
      districtEntries,
      selectedDistrictId,
      selectedDistrict,
      canInferTag: selectionTags.length === 1,
      canUseSelectionTag: !!inferredTag,
      hasEffectiveTag: !!tag,
      isAutoMode: tagMode === "auto",
      hasLegacyGeoCountryData: normalizedDistrictPayload.has_legacy_geo_countries,
      legacyCountryCodes,
      effectiveTemplateTag: normalizeScenarioDistrictTag(editorState?.templateTag) || tag,
    };
  };

  const buildDistrictMetaRows = (model) => {
    const rows = [];
    rows.push([ui("Mode"), model.isAutoMode ? ui("Auto") : ui("Manual")]);
    if (model.tag) {
      rows.push([ui("Scenario Tag"), model.tag]);
    }
    if (model.selectionTags.length > 1) {
      rows.push([ui("Selection Tags"), model.selectionTags.join(", ")]);
    }
    if (model.selectionCount) {
      rows.push([ui("Selected"), String(model.selectionCount)]);
    }
    if (model.hasLegacyGeoCountryData) {
      rows.push([ui("Legacy"), model.legacyCountryCodes.join(", ") || ui("Detected")]);
    }
    if (model.selectedDistrict) {
      rows.push([ui("District"), model.selectedDistrict.name_en || model.selectedDistrict.name_zh || model.selectedDistrict.id]);
      rows.push([ui("Feature Count"), String((model.selectedDistrict.feature_ids || []).length)]);
    } else if (model.districtEntries.length) {
      rows.push([ui("District Count"), String(model.districtEntries.length)]);
    }
    return rows.filter(([, value]) => String(value || "").trim());
  };

  const resolveDistrictEditorHint = (model) => {
    if (!state.activeScenarioId) {
      return ui("Activate a scenario to edit district groups.");
    }
    if (model.hasLegacyGeoCountryData) {
      return ui("Legacy geo-country districts detected. Migrate them before editing scenario-tag districts.");
    }
    if (!model.tag && model.isAutoMode) {
      return ui("Select land features owned by one scenario tag or type a tag manually to edit districts.");
    }
    if (!model.tag && !model.isAutoMode) {
      return ui("Type a scenario tag manually or switch back to the current selection tag.");
    }
    if (model.selectionTags.length > 1) {
      return ui("The current selection spans multiple scenario tags. District assignment only uses features owned by the active tag.");
    }
    if (!model.isAutoMode) {
      return ui("Manual scenario tag override is active. District assignment only uses features owned by the typed tag.");
    }
    return ui("Create or update a district, assign the current selection, then save the full scenario-tag payload.");
  };

  const buildDistrictSavePayload = (model) => {
    const districts = Object.values(model?.draftTag?.districts || {}).map((district) => ({
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
      tag: normalizeScenarioDistrictTag(model?.tag),
      districts,
    };
  };

  const selectDistrictDraft = (districtId = "") => {
    const editorState = state.devScenarioDistrictEditor || {};
    const draftTag = cloneDistrictTagRecord(editorState.tag, editorState.draftTag);
    const normalizedDistrictId = normalizeScenarioDistrictId(districtId);
    const selectedDistrict = normalizedDistrictId ? draftTag.districts?.[normalizedDistrictId] || null : null;
    updateDistrictEditorState({
      draftTag,
      selectedDistrictId: normalizedDistrictId,
      nameEn: normalizeScenarioNameInput(selectedDistrict?.name_en || ""),
      nameZh: normalizeScenarioNameInput(selectedDistrict?.name_zh || ""),
    });
  };

  const upsertDistrictDraft = (model) => {
    const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
    const nameEn = normalizeScenarioNameInput(state.devScenarioDistrictEditor?.nameEn);
    const nameZh = normalizeScenarioNameInput(state.devScenarioDistrictEditor?.nameZh);
    if (!model.tag || !districtId || !nameEn || !nameZh) {
      return {
        ok: false,
        message: ui("Scenario tag, district id, English name, and Chinese name are required."),
      };
    }
    const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
    const duplicateDistrict = Object.values(nextDraftTag.districts || {}).find((district) => {
      if (!district || String(district.id || "") === districtId) return false;
      return String(district.name_en || "").trim().toLowerCase() === nameEn.toLowerCase()
        || String(district.name_zh || "").trim().toLowerCase() === nameZh.toLowerCase();
    });
    if (duplicateDistrict) {
      return {
        ok: false,
        message: ui("District names must be unique within the selected scenario tag."),
      };
    }
    const priorDistrict = nextDraftTag.districts?.[districtId] || null;
    nextDraftTag.districts[districtId] = {
      id: districtId,
      name_en: nameEn,
      name_zh: nameZh,
      feature_ids: Array.isArray(priorDistrict?.feature_ids) ? [...priorDistrict.feature_ids] : [],
    };
    setDistrictDraftTag(model.tag, nextDraftTag, {
      selectedDistrictId: districtId,
      nameEn,
      nameZh,
    });
    updateDistrictEditorState({
      lastSaveMessage: priorDistrict ? ui("District draft updated.") : ui("District draft created."),
      lastSaveTone: "info",
    });
    return { ok: true };
  };

  const assignSelectionToDistrictDraft = (model) => {
    const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
    if (!model.tag || !districtId) {
      return {
        ok: false,
        message: ui("Select a scenario tag and district before assigning features."),
      };
    }
    const selectionIds = model.targetIds.filter((featureId) => {
      return normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]) === model.tag;
    });
    if (!selectionIds.length) {
      return {
        ok: false,
        message: ui("Select one or more land features owned by the chosen scenario tag."),
      };
    }
    const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
    const district = nextDraftTag.districts?.[districtId];
    if (!district) {
      return {
        ok: false,
        message: ui("Create the district before assigning features."),
      };
    }
    Object.values(nextDraftTag.districts || {}).forEach((entry) => {
      entry.feature_ids = (Array.isArray(entry.feature_ids) ? entry.feature_ids : []).filter(
        (featureId) => !selectionIds.includes(featureId)
      );
    });
    district.feature_ids = Array.from(new Set([
      ...(Array.isArray(district.feature_ids) ? district.feature_ids : []),
      ...selectionIds,
    ])).sort((left, right) => left.localeCompare(right));
    setDistrictDraftTag(model.tag, nextDraftTag, {
      selectedDistrictId: districtId,
    });
    updateDistrictEditorState({
      lastSaveMessage: ui("Selection assigned to the district draft."),
      lastSaveTone: "info",
    });
    return { ok: true, count: selectionIds.length };
  };

  const removeSelectionFromDistrictDraft = (model) => {
    const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
    if (!model.tag || !districtId) {
      return {
        ok: false,
        message: ui("Select a scenario tag and district before removing features."),
      };
    }
    const selectionIds = model.targetIds.filter((featureId) => {
      return normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]) === model.tag;
    });
    if (!selectionIds.length) {
      return {
        ok: false,
        message: ui("Select one or more land features owned by the chosen scenario tag."),
      };
    }
    const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
    const district = nextDraftTag.districts?.[districtId];
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
    setDistrictDraftTag(model.tag, nextDraftTag, {
      selectedDistrictId: districtId,
    });
    updateDistrictEditorState({
      lastSaveMessage: removedCount > 0
        ? ui("Selection removed from the district draft.")
        : ui("Selected features were not assigned to the current district draft."),
      lastSaveTone: "info",
    });
    return { ok: true, changed: removedCount > 0, count: removedCount };
  };

  const deleteDistrictDraft = (model) => {
    const districtId = normalizeScenarioDistrictId(state.devScenarioDistrictEditor?.selectedDistrictId);
    if (!model.tag || !districtId) {
      return {
        ok: false,
        message: ui("Select a district before deleting it."),
      };
    }
    const nextDraftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
    const district = nextDraftTag.districts?.[districtId];
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
    delete nextDraftTag.districts[districtId];
    setDistrictDraftTag(model.tag, nextDraftTag, {
      selectedDistrictId: "",
      nameEn: "",
      nameZh: "",
    });
    updateDistrictEditorState({
      lastSaveMessage: ui("District draft deleted."),
      lastSaveTone: "info",
    });
    return { ok: true };
  };

  const buildDistrictTemplatePayload = (model, templateTag = "") => {
    return {
      scenarioId: String(state.activeScenarioId || "").trim(),
      tag: normalizeScenarioDistrictTag(model?.tag),
      templateTag: normalizeScenarioDistrictTag(templateTag),
      districts: Object.values(model?.draftTag?.districts || {}).map((district) => ({
        districtId: normalizeScenarioDistrictId(district?.id),
        nameEn: normalizeScenarioNameInput(district?.name_en),
        nameZh: normalizeScenarioNameInput(district?.name_zh),
        featureIds: Array.from(new Set(
          (Array.isArray(district?.feature_ids) ? district.feature_ids : [])
            .map((featureId) => String(featureId || "").trim())
            .filter(Boolean)
        )).sort((left, right) => left.localeCompare(right)),
      })),
    };
  };

  const render = ({ hasActiveScenario }) => {
    const districtModel = resolveDistrictEditorModel();
    const districtState = state.devScenarioDistrictEditor || {};

    if (scenarioDistrictTitle) {
      scenarioDistrictTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioDistrictHint) {
      scenarioDistrictHint.textContent = resolveDistrictEditorHint(districtModel);
    }
    renderMetaRows(scenarioDistrictMeta, buildDistrictMetaRows(districtModel));

    const renderedDistrictTagValue = districtModel.isAutoMode
      ? districtModel.inferredTag
      : districtModel.manualTag;
    if (scenarioDistrictTagInput && scenarioDistrictTagInput.value !== renderedDistrictTagValue) {
      scenarioDistrictTagInput.value = renderedDistrictTagValue;
    }
    if (scenarioDistrictTagInput) {
      scenarioDistrictTagInput.placeholder = districtModel.isAutoMode
        ? (districtModel.inferredTag || ui("Auto from selection"))
        : "FRA";
      scenarioDistrictTagInput.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateApplying;
    }
    if (scenarioDistrictTagModeNote) {
      scenarioDistrictTagModeNote.textContent = districtModel.isAutoMode
        ? (districtModel.inferredTag
          ? `${ui("Auto")}: ${districtModel.inferredTag}`
          : ui("Auto from selection"))
        : `${ui("Manual")}: ${districtModel.manualTag || ui("Type a scenario tag.")}`;
    }
    if (scenarioDistrictUseSelectionBtn) {
      scenarioDistrictUseSelectionBtn.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateApplying || !districtModel.canUseSelectionTag;
    }
    if (scenarioDistrictClearBtn) {
      scenarioDistrictClearBtn.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateApplying || !(
        districtModel.manualTag
        || districtModel.selectedDistrictId
        || normalizeScenarioNameInput(districtState.nameEn)
        || normalizeScenarioNameInput(districtState.nameZh)
        || normalizeScenarioDistrictTag(districtState.templateTag)
      );
    }
    if (scenarioDistrictSelect) {
      syncSelectOptions(
        scenarioDistrictSelect,
        districtModel.districtEntries.map((district) => ({
          value: district.id,
          label: district.name_en || district.name_zh || district.id,
        })),
        { placeholderLabel: ui("Select district") }
      );
      const selectedDistrictId = districtModel.selectedDistrictId || "";
      if (scenarioDistrictSelect.value !== selectedDistrictId) {
        scenarioDistrictSelect.value = selectedDistrictId;
      }
      scenarioDistrictSelect.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    if (scenarioDistrictIdInput && scenarioDistrictIdInput.value !== districtModel.selectedDistrictId) {
      scenarioDistrictIdInput.value = districtModel.selectedDistrictId;
    }
    if (scenarioDistrictIdInput) {
      scenarioDistrictIdInput.placeholder = "berlin";
      scenarioDistrictIdInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
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
      scenarioDistrictNameEnInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    if (scenarioDistrictNameZhInput) {
      scenarioDistrictNameZhInput.placeholder = districtModel.selectedDistrict?.name_zh || "Berlin";
      scenarioDistrictNameZhInput.disabled = !hasActiveScenario || !districtModel.hasEffectiveTag || !!districtState.isSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }
    if (scenarioDistrictTemplateTagInput) {
      const renderedTemplateTag = districtModel.effectiveTemplateTag || districtModel.tag || "";
      if (scenarioDistrictTemplateTagInput.value !== renderedTemplateTag) {
        scenarioDistrictTemplateTagInput.value = renderedTemplateTag;
      }
      scenarioDistrictTemplateTagInput.placeholder = districtModel.tag || "FRA";
      scenarioDistrictTemplateTagInput.disabled = !hasActiveScenario || !!districtState.isSaving || !!districtState.isTemplateSaving || !!districtState.isTemplateApplying || districtModel.hasLegacyGeoCountryData;
    }

    const matchingSelectionIds = districtModel.targetIds.filter((featureId) => {
      return normalizeScenarioDistrictTag(state.sovereigntyByFeatureId?.[featureId]) === districtModel.tag;
    });
    const districtIdValue = normalizeScenarioDistrictId(scenarioDistrictIdInput?.value || districtState.selectedDistrictId);
    const canUpsertDistrict = hasActiveScenario
      && !!districtModel.tag
      && !!districtIdValue
      && !!districtNameEn
      && !!districtNameZh
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canAssignDistrict = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.selectedDistrictId
      && matchingSelectionIds.length > 0
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canRemoveDistrictSelection = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.selectedDistrictId
      && matchingSelectionIds.length > 0
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canDeleteDistrict = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.selectedDistrictId
      && (districtModel.selectedDistrict?.feature_ids || []).length === 0
      && !districtState.isSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canSaveDistricts = hasActiveScenario && !!districtModel.tag && !districtState.isSaving && !districtState.isTemplateApplying && !districtModel.hasLegacyGeoCountryData;
    const canPromoteTemplate = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.effectiveTemplateTag
      && !districtState.isSaving
      && !districtState.isTemplateSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;
    const canApplyTemplate = hasActiveScenario
      && !!districtModel.tag
      && !!districtModel.effectiveTemplateTag
      && !districtState.isSaving
      && !districtState.isTemplateSaving
      && !districtState.isTemplateApplying
      && !districtModel.hasLegacyGeoCountryData;

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
    if (scenarioDistrictPromoteBtn) {
      scenarioDistrictPromoteBtn.textContent = districtState.isTemplateSaving ? ui("Saving...") : ui("Promote To Shared Template");
      scenarioDistrictPromoteBtn.disabled = !canPromoteTemplate;
    }
    if (scenarioDistrictApplyTemplateBtn) {
      scenarioDistrictApplyTemplateBtn.textContent = districtState.isTemplateApplying ? ui("Applying...") : ui("Apply Shared Template");
      scenarioDistrictApplyTemplateBtn.disabled = !canApplyTemplate;
    }
    if (scenarioDistrictStatus) {
      const districtStatusBits = [];
      if (districtState.lastSaveMessage) {
        districtStatusBits.push(districtState.lastSaveMessage);
      } else if (districtModel.hasLegacyGeoCountryData) {
        districtStatusBits.push(ui("Legacy geo-country districts detected."));
      } else if (districtState.lastSavedAt) {
        districtStatusBits.push(`${ui("Last Saved")}: ${districtState.lastSavedAt}`);
      }
      scenarioDistrictStatus.textContent = districtStatusBits.join(" | ");
    }
  };

  const bindEvents = () => {
    bindButtonAction(scenarioDistrictUseSelectionBtn, () => {
      const model = resolveDistrictEditorModel();
      if (!model.canUseSelectionTag) {
        showToast(ui("Select land features owned by exactly one scenario tag first."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      resetDistrictEditorForm();
      updateDistrictEditorState({
        inferredTag: model.inferredTag,
        tag: model.inferredTag,
        templateTag: model.inferredTag,
      });
      renderWorkspace();
    });

    bindButtonAction(scenarioDistrictClearBtn, () => {
      resetDistrictEditorForm();
      renderWorkspace();
    });

    bindButtonAction(districtUpsertBtn, () => {
      const model = resolveDistrictEditorModel();
      if (model.hasLegacyGeoCountryData) {
        showToast(ui("Legacy geo-country districts detected. Migrate them before editing scenario-tag districts."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      if (!state.activeScenarioId || !model.tag) {
        showToast(ui("Choose a scenario tag before editing districts."), {
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

    bindButtonAction(districtAssignBtn, () => {
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

    bindButtonAction(districtRemoveBtn, () => {
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
      showToast(result.changed === false
        ? (
          state.devScenarioDistrictEditor?.lastSaveMessage
          || ui("Selected features were not assigned to the current district draft.")
        )
        : ui("Removed selection from district."), {
        title: ui("Scenario District Editor"),
        tone: result.changed === false ? "info" : "success",
      });
      renderWorkspace();
    });

    bindButtonAction(districtDeleteBtn, () => {
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

    bindButtonAction(districtSaveBtn, async () => {
      const model = resolveDistrictEditorModel();
      if (model.hasLegacyGeoCountryData) {
        showToast(ui("Legacy geo-country districts detected. Migrate them before saving scenario-tag districts."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      if (!state.activeScenarioId || !model.tag) {
        showToast(ui("Choose a scenario tag before saving districts."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      const draftTag = cloneDistrictTagRecord(model.tag, model.draftTag);
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
            draftTag,
          })),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.ok) {
          throw new Error(String(result?.message || `HTTP ${response.status}`));
        }
        if (result?.tagRecord && typeof result.tagRecord === "object") {
          syncScenarioDistrictState(model.tag, result.tagRecord);
          setDistrictDraftTag(model.tag, result.tagRecord, {
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
          district_groups_url: String(result.districtGroupsUrl || state.activeScenarioManifest?.district_groups_url || ""),
        };
        rebuildStaticMeshes();
        flushDevWorkspaceRender("dev-workspace-district-save");
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

    bindButtonAction(scenarioDistrictPromoteBtn, async () => {
      const model = resolveDistrictEditorModel();
      const templateTag = normalizeScenarioDistrictTag(state.devScenarioDistrictEditor?.templateTag) || model.tag;
      if (model.hasLegacyGeoCountryData) {
        showToast(ui("Legacy geo-country districts detected. Migrate them before promoting shared templates."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      if (!state.activeScenarioId || !model.tag || !templateTag) {
        showToast(ui("Choose a scenario tag and template tag before promoting a shared template."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      updateDistrictEditorState({
        isTemplateSaving: true,
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
      try {
        const response = await fetch("/__dev/scenario/district-templates/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildDistrictTemplatePayload(model, templateTag)),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.ok) {
          throw new Error(String(result?.message || `HTTP ${response.status}`));
        }
        updateDistrictEditorState({
          isTemplateSaving: false,
          templateTag,
          lastSavedAt: String(result.savedAt || ""),
          lastSavedPath: String(result.filePath || ""),
          lastSaveMessage: `${ui("Shared template saved")}: ${String(result.filePath || "")}`,
          lastSaveTone: "success",
        });
        showToast(ui("Shared district template saved."), {
          title: ui("Scenario District Editor"),
          tone: "success",
        });
      } catch (error) {
        updateDistrictEditorState({
          isTemplateSaving: false,
          lastSaveMessage: String(error?.message || ui("Unable to save shared district template.")),
          lastSaveTone: "critical",
        });
        showToast(String(error?.message || ui("Unable to save shared district template.")), {
          title: ui("Scenario District Editor"),
          tone: "critical",
          duration: 4200,
        });
      }
      renderWorkspace();
    });

    bindButtonAction(scenarioDistrictApplyTemplateBtn, async () => {
      const model = resolveDistrictEditorModel();
      const templateTag = normalizeScenarioDistrictTag(state.devScenarioDistrictEditor?.templateTag) || model.tag;
      if (model.hasLegacyGeoCountryData) {
        showToast(ui("Legacy geo-country districts detected. Migrate them before applying shared templates."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      if (!state.activeScenarioId || !model.tag || !templateTag) {
        showToast(ui("Choose a scenario tag and template tag before applying a shared template."), {
          title: ui("Scenario District Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      updateDistrictEditorState({
        isTemplateApplying: true,
        lastSaveMessage: "",
        lastSaveTone: "",
      });
      renderWorkspace();
      try {
        const response = await fetch("/__dev/scenario/district-templates/apply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            scenarioId: String(state.activeScenarioId || "").trim(),
            tag: model.tag,
            templateTag,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.ok) {
          throw new Error(String(result?.message || `HTTP ${response.status}`));
        }
        if (result?.tagRecord && typeof result.tagRecord === "object") {
          syncScenarioDistrictState(model.tag, result.tagRecord);
          setDistrictDraftTag(model.tag, result.tagRecord, {
            templateTag,
            isTemplateApplying: false,
            lastSavedAt: String(result.savedAt || ""),
            lastSavedPath: String(result.filePath || ""),
            lastSaveMessage: `${ui("Applied shared template")}: ${templateTag}`,
            lastSaveTone: "success",
          });
        } else {
          updateDistrictEditorState({
            isTemplateApplying: false,
            templateTag,
            lastSavedAt: String(result.savedAt || ""),
            lastSavedPath: String(result.filePath || ""),
            lastSaveMessage: `${ui("Applied shared template")}: ${templateTag}`,
            lastSaveTone: "success",
          });
        }
        showToast(ui("Shared district template applied."), {
          title: ui("Scenario District Editor"),
          tone: "success",
        });
      } catch (error) {
        updateDistrictEditorState({
          isTemplateApplying: false,
          lastSaveMessage: String(error?.message || ui("Unable to apply shared district template.")),
          lastSaveTone: "critical",
        });
        showToast(String(error?.message || ui("Unable to apply shared district template.")), {
          title: ui("Scenario District Editor"),
          tone: "critical",
          duration: 4200,
        });
      }
      renderWorkspace();
    });

    if (scenarioDistrictTagInput && scenarioDistrictTagInput.dataset.bound !== "true") {
      scenarioDistrictTagInput.addEventListener("input", (event) => {
        const nextTag = normalizeScenarioDistrictTag(event.target.value);
        updateDistrictEditorState({
          tagMode: nextTag ? "manual" : "auto",
          manualTag: nextTag,
          tag: nextTag,
          selectedDistrictId: "",
          nameEn: "",
          nameZh: "",
          lastSaveMessage: "",
          lastSaveTone: "",
        });
        renderWorkspace();
      });
      scenarioDistrictTagInput.dataset.bound = "true";
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

    if (scenarioDistrictTemplateTagInput && scenarioDistrictTemplateTagInput.dataset.bound !== "true") {
      scenarioDistrictTemplateTagInput.addEventListener("input", (event) => {
        updateDistrictEditorState({
          templateTag: normalizeScenarioDistrictTag(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        });
        renderWorkspace();
      });
      scenarioDistrictTemplateTagInput.dataset.bound = "true";
    }
  };

  return {
    render,
    bindEvents,
  };
}

