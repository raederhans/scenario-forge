import { state } from "../../core/state.js";
import * as mapRenderer from "../../core/map_renderer.js";
import { syncScenarioLocalizationState } from "../../core/scenario_localization_state.js";
import { getFeatureOwnerCode } from "../../core/sovereignty_manager.js";
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
 * Scenario text editors owner.
 * 这里统一接管 country / capital / locale 三块编辑器的局部 render 和事件绑定。
 * dev_workspace.js 继续保留宿主 facade、共享 country option helper 和整体编排。
 */
export function createScenarioTextEditorsController({
  panel,
  renderWorkspace,
  renderMetaRows,
  syncSelectOptions,
  normalizeScenarioTagInput,
  normalizeScenarioNameInput,
  resolveFeatureName,
  resolveOwnershipTargetIds,
  collectScenarioCountryOptions,
  resolvePreferredScenarioTagCode,
  resolveSingleSelectionScenarioTag,
  upsertScenarioCountryRuntimeEntry,
  upsertRuntimeReleasableCatalogEntry,
  syncActiveScenarioManifestUrl,
  syncRuntimeScenarioCityOverrides,
  getScenarioGeoLocaleEntry,
  flushDevWorkspaceRender,
}) {
  const scenarioCountryPanel = panel.querySelector("#devScenarioCountryPanel");
  const scenarioCountryTitle = panel.querySelector("#devScenarioCountryTitle");
  const scenarioCountryHint = panel.querySelector("#devScenarioCountryHint");
  const scenarioCountryMeta = panel.querySelector("#devScenarioCountryMeta");
  const scenarioCountrySelect = panel.querySelector("#devScenarioCountrySelect");
  const scenarioCountryNameEnInput = panel.querySelector("#devScenarioCountryNameEnInput");
  const scenarioCountryNameZhInput = panel.querySelector("#devScenarioCountryNameZhInput");
  const scenarioCountryStatus = panel.querySelector("#devScenarioCountryStatus");
  const saveCountryBtn = panel.querySelector("#devScenarioSaveCountryBtn");

  const scenarioCapitalPanel = panel.querySelector("#devScenarioCapitalPanel");
  const scenarioCapitalTitle = panel.querySelector("#devScenarioCapitalTitle");
  const scenarioCapitalHint = panel.querySelector("#devScenarioCapitalHint");
  const scenarioCapitalMeta = panel.querySelector("#devScenarioCapitalMeta");
  const scenarioCapitalSearchInput = panel.querySelector("#devScenarioCapitalSearchInput");
  const scenarioCapitalSearchResults = panel.querySelector("#devScenarioCapitalSearchResults");
  const scenarioCapitalSelect = panel.querySelector("#devScenarioCapitalSelect");
  const scenarioCapitalCandidate = panel.querySelector("#devScenarioCapitalCandidate");
  const scenarioCapitalStatus = panel.querySelector("#devScenarioCapitalStatus");
  const saveCapitalBtn = panel.querySelector("#devScenarioSaveCapitalBtn");

  const scenarioLocalePanel = panel.querySelector("#devScenarioLocalePanel");
  const scenarioLocaleTitle = panel.querySelector("#devScenarioLocaleTitle");
  const scenarioLocaleHint = panel.querySelector("#devScenarioLocaleHint");
  const scenarioLocaleMeta = panel.querySelector("#devScenarioLocaleMeta");
  const scenarioLocaleEnInput = panel.querySelector("#devScenarioLocaleEnInput");
  const scenarioLocaleZhInput = panel.querySelector("#devScenarioLocaleZhInput");
  const scenarioLocaleStatus = panel.querySelector("#devScenarioLocaleStatus");
  const saveLocaleBtn = panel.querySelector("#devScenarioSaveLocaleBtn");

  const normalizeLocaleInput = (value) => String(value || "").trim();

  const resolveCountryEditorModel = () => {
    const options = collectScenarioCountryOptions({ includeReleasable: true });
    const availableTags = new Set(options.map((entry) => entry.tag));
    const explicitTag = normalizeScenarioTagInput(state.devScenarioCountryEditor?.tag);
    const selectionTag = resolveSingleSelectionScenarioTag(availableTags);
    const fallbackTag = options.some((entry) => entry.tag === explicitTag)
      ? explicitTag
      : resolvePreferredScenarioTagCode(explicitTag);
    const tag = selectionTag || fallbackTag;
    const option = options.find((entry) => entry.tag === tag) || null;
    const entry = option?.entry || null;
    return {
      tag,
      option,
      entry,
      options,
      defaultNameEn: normalizeScenarioNameInput(entry?.display_name_en || entry?.display_name || ""),
      defaultNameZh: normalizeScenarioNameInput(entry?.display_name_zh),
    };
  };

  const buildCountryEditorMetaRows = (model) => {
    return [
      [ui("Tag"), model.tag],
      [ui("Name"), model.option?.displayName || ""],
      [ui("Feature Count"), String(Number(model.entry?.feature_count || 0) || 0)],
      [ui("Kind"), model.option?.releasable ? ui("Releasable") : ui("Scenario Country")],
      [ui("Parent"), normalizeScenarioTagInput(model.entry?.parent_owner_tag)],
    ].filter(([, value]) => String(value || "").trim());
  };

  const resolveCountryEditorHint = (model) => {
    if (!state.activeScenarioId) {
      return ui("Activate a scenario to edit country names.");
    }
    if (!model.tag) {
      return ui("Choose a scenario country tag to edit country names.");
    }
    return ui("Edit EN and CH for the selected country tag, then save the scenario country record.");
  };

  const resolveCapitalCandidateForFeature = (featureId, tag) => {
    const normalizedFeatureId = String(featureId || "").trim();
    const normalizedTag = normalizeScenarioTagInput(tag);
    if (!normalizedFeatureId || !normalizedTag) return null;
    const cityCollection = mapRenderer.getEffectiveCityCollection();
    const candidates = Array.isArray(cityCollection?.features)
      ? cityCollection.features.filter((feature) => String(feature?.properties?.__city_host_feature_id || "").trim() === normalizedFeatureId)
      : [];
    if (!candidates.length) return null;
    const priorHint = state.scenarioCityOverridesData?.capital_city_hints?.[normalizedTag] || null;
    const scoreCandidate = (feature) => {
      const props = feature?.properties || {};
      const cityId = String(props.__city_id || feature?.id || "").trim();
      const population = Math.max(0, Number(props.__city_population || 0));
      const label = String(
        props.label_en
        || props.name_en
        || props.label
        || props.name
        || cityId
      ).trim();
      return (
        (cityId && cityId === String(priorHint?.city_id || "").trim() ? 9_000_000_000_000 : 0)
        + (props.__city_is_country_capital ? 6_000_000_000_000 : 0)
        + (props.__city_is_capital ? 3_000_000_000_000 : 0)
        + population
        - (label ? label.charCodeAt(0) / 10_000 : 0)
      );
    };
    const sortedCandidates = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    const feature = sortedCandidates[0];
    const props = feature?.properties || {};
    return {
      feature,
      cityId: String(props.__city_id || feature?.id || "").trim(),
      stableKey: String(props.__city_stable_key || props.stable_key || `id::${String(props.__city_id || feature?.id || "").trim()}`).trim(),
      cityName: String(props.label_en || props.name_en || props.label || props.name || feature?.id || "").trim(),
      nameAscii: String(props.name_en || props.label_en || props.label || props.name || "").trim(),
      countryCode: String(props.__city_country_code || props.country_code || "").trim().toUpperCase(),
      capitalKind: String(props.__city_capital_kind || props.__city_capital_type || "").trim(),
      population: Math.max(0, Number(props.__city_population || 0)) || 0,
      urbanMatchId: String(props.__city_urban_match_id || "").trim(),
      baseTier: String(props.__city_base_tier || "").trim(),
      lon: Array.isArray(feature?.geometry?.coordinates) ? Number(feature.geometry.coordinates[0]) : null,
      lat: Array.isArray(feature?.geometry?.coordinates) ? Number(feature.geometry.coordinates[1]) : null,
      capitalStateId: priorHint?.capital_state_id ?? state.scenarioCountriesByTag?.[normalizedTag]?.capital_state_id ?? null,
    };
  };

  const resolveCapitalEditorModel = () => {
    const options = collectScenarioCountryOptions({ includeReleasable: true });
    const explicitTag = normalizeScenarioTagInput(state.devScenarioCapitalEditor?.tag);
    const tag = options.some((entry) => entry.tag === explicitTag)
      ? explicitTag
      : resolvePreferredScenarioTagCode(explicitTag);
    const option = options.find((entry) => entry.tag === tag) || null;
    const entry = option?.entry || null;
    const targetIds = resolveOwnershipTargetIds();
    const featureId = targetIds.length === 1 ? targetIds[0] : "";
    const feature = featureId ? state.landIndex?.get(featureId) || null : null;
    const ownerCode = featureId ? normalizeScenarioTagInput(getFeatureOwnerCode(featureId)) : "";
    const ownerMatches = !!(featureId && tag && ownerCode === tag);
    const candidate = ownerMatches ? resolveCapitalCandidateForFeature(featureId, tag) : null;
    return {
      tag,
      option,
      entry,
      options,
      targetIds,
      selectionCount: targetIds.length,
      featureId,
      feature,
      ownerCode,
      ownerMatches,
      candidate,
    };
  };

  const buildCapitalEditorSearchMatches = (query, options = []) => {
    const normalizedQuery = normalizeScenarioNameInput(query);
    const queryLower = normalizedQuery.toLowerCase();
    const tagQuery = normalizeScenarioTagInput(query);
    if (!normalizedQuery) {
      return [];
    }
    return options
      .map((entry) => {
        const displayName = normalizeScenarioNameInput(entry?.displayName || "");
        const nameEn = normalizeScenarioNameInput(entry?.nameEn || displayName);
        const nameZh = normalizeScenarioNameInput(entry?.nameZh);
        const tag = normalizeScenarioTagInput(entry?.tag);
        const tagLower = tag.toLowerCase();
        const displayLower = displayName.toLowerCase();
        const nameEnLower = nameEn.toLowerCase();
        const nameZhLower = nameZh.toLowerCase();
        let score = 0;
        if (tagQuery && tag === tagQuery) {
          score = 500;
        } else if (tagQuery && tag.startsWith(tagQuery)) {
          score = 400;
        } else if (
          (displayLower && displayLower.startsWith(queryLower))
          || (nameEnLower && nameEnLower.startsWith(queryLower))
          || (nameZhLower && nameZhLower.startsWith(queryLower))
        ) {
          score = 300;
        } else if (tagQuery && tagLower.includes(tagQuery.toLowerCase())) {
          score = 200;
        } else if (
          (displayLower && displayLower.includes(queryLower))
          || (nameEnLower && nameEnLower.includes(queryLower))
          || (nameZhLower && nameZhLower.includes(queryLower))
        ) {
          score = 100;
        }
        if (!score) return null;
        return {
          ...entry,
          score,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (
        b.score - a.score
        || a.displayName.localeCompare(b.displayName)
        || a.tag.localeCompare(b.tag)
      ))
      .slice(0, 8);
  };

  const buildCapitalEditorMetaRows = (model) => {
    return [
      [ui("Tag"), model.tag],
      [ui("Feature"), model.featureId ? resolveFeatureName(model.feature, model.featureId) : ""],
      [ui("Owner"), model.ownerCode],
      [ui("Candidate"), model.candidate?.cityName || ""],
      [ui("Current Capital State"), String(model.entry?.capital_state_id ?? "")],
    ].filter(([, value]) => String(value || "").trim());
  };

  const resolveCapitalEditorHint = (model) => {
    if (!state.activeScenarioId) {
      return ui("Activate a scenario to edit capitals.");
    }
    if (model.selectionCount !== 1) {
      return ui("Select exactly one land feature to assign a capital.");
    }
    if (!model.tag) {
      return ui("Choose a country tag before assigning a capital.");
    }
    if (!model.ownerMatches) {
      return ui("The selected feature must be owned by the chosen country tag.");
    }
    if (!model.candidate?.cityId) {
      return ui("No city candidate was found on the selected feature.");
    }
    return ui("Save to move the selected country's capital to the chosen feature's best city candidate.");
  };

  const buildScenarioCountrySavePayload = () => {
    const model = resolveCountryEditorModel();
    const editorState = state.devScenarioCountryEditor || {};
    const nameEn = normalizeScenarioNameInput(editorState.nameEn);
    const nameZh = normalizeScenarioNameInput(editorState.nameZh);
    if (!state.activeScenarioId) {
      return { ok: false, message: ui("Activate a scenario to edit country names.") };
    }
    if (!model.tag) {
      return { ok: false, message: ui("Choose a scenario country tag first.") };
    }
    if (!nameEn || !nameZh) {
      return { ok: false, message: ui("Both English and Chinese country names are required.") };
    }
    return {
      ok: true,
      payload: {
        scenarioId: String(state.activeScenarioId || "").trim(),
        tag: model.tag,
        nameEn,
        nameZh,
      },
    };
  };

  const buildScenarioCapitalSavePayload = () => {
    const model = resolveCapitalEditorModel();
    if (!state.activeScenarioId) {
      return { ok: false, message: ui("Activate a scenario to edit capitals.") };
    }
    if (model.selectionCount !== 1 || !model.featureId) {
      return { ok: false, message: ui("Select exactly one land feature before saving a capital.") };
    }
    if (!model.tag) {
      return { ok: false, message: ui("Choose a scenario country tag before saving a capital.") };
    }
    if (!model.ownerMatches) {
      return { ok: false, message: ui("The selected feature is not owned by the chosen country tag.") };
    }
    if (!model.candidate?.cityId) {
      return { ok: false, message: ui("No city candidate was found for the selected feature.") };
    }
    return {
      ok: true,
      payload: {
        scenarioId: String(state.activeScenarioId || "").trim(),
        tag: model.tag,
        featureId: model.featureId,
        cityId: model.candidate.cityId,
        capitalStateId: model.candidate.capitalStateId,
        cityName: model.candidate.cityName,
        stableKey: model.candidate.stableKey,
        countryCode: model.candidate.countryCode,
        lookupIso2: String(model.entry?.lookup_iso2 || model.entry?.release_lookup_iso2 || model.tag || "").trim().toUpperCase(),
        baseIso2: String(model.entry?.base_iso2 || model.tag || "").trim().toUpperCase(),
        capitalKind: model.candidate.capitalKind,
        population: model.candidate.population,
        lon: model.candidate.lon,
        lat: model.candidate.lat,
        urbanMatchId: model.candidate.urbanMatchId,
        baseTier: model.candidate.baseTier,
        nameAscii: model.candidate.nameAscii,
      },
    };
  };

  const applyScenarioCountrySaveSuccess = (response, payload) => {
    const normalizedTag = normalizeScenarioTagInput(payload?.tag);
    if (!normalizedTag) return;
    const nextEntry = upsertScenarioCountryRuntimeEntry(normalizedTag, response?.countryEntry || {
      tag: normalizedTag,
      display_name: payload.nameEn,
      display_name_en: payload.nameEn,
      display_name_zh: payload.nameZh,
    });
    if (response?.catalogEntry && typeof response.catalogEntry === "object") {
      upsertRuntimeReleasableCatalogEntry(response.catalogEntry);
    }
    if (response?.catalogPath) {
      syncActiveScenarioManifestUrl("releasable_catalog_url", response.catalogPath);
    }
    state.devScenarioCountryEditor = {
      ...(state.devScenarioCountryEditor || {}),
      tag: normalizedTag,
      nameEn: normalizeScenarioNameInput(nextEntry?.display_name_en || payload.nameEn),
      nameZh: normalizeScenarioNameInput(nextEntry?.display_name_zh || payload.nameZh),
      lastSavedAt: String(response?.savedAt || ""),
      lastSavedPath: String(response?.filePath || response?.catalogPath || ""),
      lastSaveMessage: `${ui("Saved")}: ${String(response?.filePath || response?.catalogPath || normalizedTag)}`,
      lastSaveTone: "success",
    };
  };

  const applyScenarioCapitalSaveSuccess = (response, payload) => {
    const normalizedTag = normalizeScenarioTagInput(payload?.tag);
    if (!normalizedTag) return;
    const nextEntry = upsertScenarioCountryRuntimeEntry(normalizedTag, response?.countryEntry || {
      tag: normalizedTag,
      capital_state_id: payload.capitalStateId ?? null,
    });
    if (response?.catalogEntry && typeof response.catalogEntry === "object") {
      upsertRuntimeReleasableCatalogEntry(response.catalogEntry);
    }
    if (response?.catalogPath) {
      syncActiveScenarioManifestUrl("releasable_catalog_url", response.catalogPath);
    }
    const priorOverrides = state.scenarioCityOverridesData && typeof state.scenarioCityOverridesData === "object"
      ? state.scenarioCityOverridesData
      : {
        version: 1,
        scenario_id: String(state.activeScenarioId || "").trim(),
        generated_at: "",
        cities: {},
        capitals_by_tag: {},
        capital_city_hints: {},
      };
    const nextOverrides = {
      ...priorOverrides,
      scenario_id: String(state.activeScenarioId || "").trim(),
      generated_at: String(response?.savedAt || priorOverrides.generated_at || ""),
      capitals_by_tag: {
        ...(priorOverrides.capitals_by_tag || {}),
        [normalizedTag]: String(response?.cityOverrideEntry?.city_id || payload.cityId || "").trim(),
      },
      capital_city_hints: {
        ...(priorOverrides.capital_city_hints || {}),
        [normalizedTag]: response?.cityOverrideEntry || {
          tag: normalizedTag,
          city_id: String(payload.cityId || "").trim(),
          host_feature_id: String(payload.featureId || "").trim(),
          capital_state_id: payload.capitalStateId ?? nextEntry?.capital_state_id ?? null,
        },
      },
    };
    syncRuntimeScenarioCityOverrides(nextOverrides);
    if (response?.cityOverridesPath) {
      syncActiveScenarioManifestUrl("city_overrides_url", response.cityOverridesPath);
    }
    state.devScenarioCapitalEditor = {
      ...(state.devScenarioCapitalEditor || {}),
      tag: normalizedTag,
      lastSavedAt: String(response?.savedAt || ""),
      lastSavedPath: String(response?.cityOverridesPath || response?.filePath || ""),
      lastSaveMessage: `${ui("Saved")}: ${String(response?.cityOverridesPath || response?.filePath || normalizedTag)}`,
      lastSaveTone: "success",
    };
  };

  const renderCapitalEditorSearchResults = (container, matches = [], query = "") => {
    if (!container) return;
    container.replaceChildren();
    if (!matches.length) {
      if (normalizeScenarioNameInput(query)) {
        const empty = document.createElement("div");
        empty.className = "dev-workspace-empty";
        empty.textContent = ui("No matching countries.");
        container.appendChild(empty);
      }
      return;
    }
    matches.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary";
      button.dataset.devCapitalSearchTag = entry.tag;
      button.style.display = "flex";
      button.style.width = "100%";
      button.style.justifyContent = "space-between";
      button.style.alignItems = "center";
      button.style.marginBottom = "0.35rem";

      const label = document.createElement("span");
      label.textContent = `${entry.tag} | ${entry.displayName || entry.nameEn || entry.nameZh || entry.tag}`;

      const meta = document.createElement("span");
      meta.textContent = entry.releasable ? ui("Releasable") : ui("Scenario Country");

      button.append(label, meta);
      container.appendChild(button);
    });
  };

  const selectScenarioCapitalEditorTag = (tag, { clearSearch = false } = {}) => {
    state.devScenarioCapitalEditor = {
      ...(state.devScenarioCapitalEditor || {}),
      tag: normalizeScenarioTagInput(tag),
      searchQuery: clearSearch ? "" : normalizeScenarioNameInput(state.devScenarioCapitalEditor?.searchQuery),
      lastSaveMessage: "",
      lastSaveTone: "",
    };
  };

  const resolveLocaleEditorModel = () => {
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
  };

  const buildLocaleMetaRows = (model) => {
    if (!model.featureId || !model.feature) return [];
    const rows = [
      ["ID", model.featureId],
      [ui("Name"), resolveFeatureName(model.feature, model.featureId)],
      [ui("Current EN"), model.mergedEntry.en],
      [ui("Current ZH"), model.mergedEntry.zh],
    ];
    return rows.filter(([, value]) => String(value || "").trim());
  };

  const resolveLocaleEditorHint = (model) => {
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
  };

  const render = ({ hasActiveScenario }) => {
    const priorCountryEditorState = state.devScenarioCountryEditor || {};
    const countryModel = resolveCountryEditorModel();
    const currentCountryTag = normalizeScenarioTagInput(priorCountryEditorState.tag);
    const hasValidCountryTag = !!currentCountryTag && countryModel.options.some((entry) => entry.tag === currentCountryTag);
    const needsCountryPrefill = !!countryModel.tag && (!hasValidCountryTag || currentCountryTag !== countryModel.tag);
    const countryEditorState = needsCountryPrefill
      ? {
        ...priorCountryEditorState,
        tag: countryModel.tag,
        nameEn: countryModel.defaultNameEn,
        nameZh: countryModel.defaultNameZh,
      }
      : priorCountryEditorState;
    if (needsCountryPrefill) {
      state.devScenarioCountryEditor = countryEditorState;
    }
    scenarioCountryPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioCountryTitle) {
      scenarioCountryTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioCountryHint) {
      scenarioCountryHint.textContent = resolveCountryEditorHint(countryModel);
    }
    renderMetaRows(scenarioCountryMeta, buildCountryEditorMetaRows(countryModel));
    if (scenarioCountrySelect) {
      syncSelectOptions(
        scenarioCountrySelect,
        countryModel.options.map((entry) => ({ value: entry.tag, label: entry.label })),
        { placeholderLabel: ui("Select country") }
      );
      if (scenarioCountrySelect.value !== (countryEditorState.tag || "")) {
        scenarioCountrySelect.value = countryEditorState.tag || "";
      }
      scenarioCountrySelect.disabled = !hasActiveScenario || !!countryEditorState.isSaving;
    }
    if (scenarioCountryNameEnInput && scenarioCountryNameEnInput.value !== normalizeScenarioNameInput(countryEditorState.nameEn)) {
      scenarioCountryNameEnInput.value = normalizeScenarioNameInput(countryEditorState.nameEn);
    }
    if (scenarioCountryNameZhInput && scenarioCountryNameZhInput.value !== normalizeScenarioNameInput(countryEditorState.nameZh)) {
      scenarioCountryNameZhInput.value = normalizeScenarioNameInput(countryEditorState.nameZh);
    }
    if (scenarioCountryNameEnInput) {
      scenarioCountryNameEnInput.disabled = !hasActiveScenario || !!countryEditorState.isSaving || !countryModel.tag;
      scenarioCountryNameEnInput.placeholder = countryModel.defaultNameEn || ui("New Country");
    }
    if (scenarioCountryNameZhInput) {
      scenarioCountryNameZhInput.disabled = !hasActiveScenario || !!countryEditorState.isSaving || !countryModel.tag;
      scenarioCountryNameZhInput.placeholder = countryModel.defaultNameZh || ui("New Country");
    }
    const canSaveCountry = hasActiveScenario
      && !!countryModel.tag
      && !!normalizeScenarioNameInput(countryEditorState.nameEn)
      && !!normalizeScenarioNameInput(countryEditorState.nameZh)
      && !countryEditorState.isSaving;
    if (saveCountryBtn) {
      saveCountryBtn.textContent = countryEditorState.isSaving ? ui("Saving...") : ui("Save Country Names");
      saveCountryBtn.disabled = !canSaveCountry;
    }
    if (scenarioCountryStatus) {
      const countryStatusBits = [];
      if (countryEditorState.lastSaveMessage) {
        countryStatusBits.push(countryEditorState.lastSaveMessage);
      } else if (countryEditorState.lastSavedAt) {
        countryStatusBits.push(`${ui("Last Saved")}: ${countryEditorState.lastSavedAt}`);
      }
      scenarioCountryStatus.textContent = countryStatusBits.join(" | ");
    }

    const priorCapitalEditorState = state.devScenarioCapitalEditor || {};
    const capitalModel = resolveCapitalEditorModel();
    const capitalSearchQuery = normalizeScenarioNameInput(priorCapitalEditorState.searchQuery);
    const capitalSearchMatches = buildCapitalEditorSearchMatches(capitalSearchQuery, capitalModel.options);
    const currentCapitalTag = normalizeScenarioTagInput(priorCapitalEditorState.tag);
    const hasValidCapitalTag = !!currentCapitalTag && capitalModel.options.some((entry) => entry.tag === currentCapitalTag);
    const needsCapitalPrefill = !hasValidCapitalTag && !!capitalModel.tag;
    const capitalEditorState = needsCapitalPrefill
      ? {
        ...priorCapitalEditorState,
        tag: capitalModel.tag,
        searchQuery: capitalSearchQuery,
      }
      : priorCapitalEditorState;
    if (needsCapitalPrefill) {
      state.devScenarioCapitalEditor = capitalEditorState;
    }
    scenarioCapitalPanel?.classList.toggle("hidden", !hasActiveScenario);
    if (scenarioCapitalTitle) {
      scenarioCapitalTitle.textContent = hasActiveScenario
        ? String(state.activeScenarioManifest?.display_name || state.activeScenarioId || "")
        : ui("No active scenario");
    }
    if (scenarioCapitalHint) {
      scenarioCapitalHint.textContent = resolveCapitalEditorHint(capitalModel);
    }
    renderMetaRows(scenarioCapitalMeta, buildCapitalEditorMetaRows(capitalModel));
    if (scenarioCapitalSearchInput) {
      if (scenarioCapitalSearchInput.value !== capitalSearchQuery) {
        scenarioCapitalSearchInput.value = capitalSearchQuery;
      }
      scenarioCapitalSearchInput.disabled = !hasActiveScenario || !!capitalEditorState.isSaving;
      scenarioCapitalSearchInput.placeholder = ui("Search country");
    }
    renderCapitalEditorSearchResults(scenarioCapitalSearchResults, capitalSearchMatches, capitalSearchQuery);
    if (scenarioCapitalSelect) {
      syncSelectOptions(
        scenarioCapitalSelect,
        capitalModel.options.map((entry) => ({ value: entry.tag, label: entry.label })),
        { placeholderLabel: ui("Select country") }
      );
      if (scenarioCapitalSelect.value !== (capitalEditorState.tag || "")) {
        scenarioCapitalSelect.value = capitalEditorState.tag || "";
      }
      scenarioCapitalSelect.disabled = !hasActiveScenario || !!capitalEditorState.isSaving;
    }
    if (scenarioCapitalCandidate) {
      scenarioCapitalCandidate.textContent = capitalModel.candidate?.cityId
        ? `${ui("Candidate")}: ${capitalModel.candidate.cityName || capitalModel.candidate.cityId} (${capitalModel.candidate.cityId})`
        : ui("No capital city candidate resolved for the current selection.");
    }
    const canSaveCapital = hasActiveScenario
      && capitalModel.selectionCount === 1
      && !!capitalModel.tag
      && capitalModel.ownerMatches
      && !!capitalModel.candidate?.cityId
      && !capitalEditorState.isSaving;
    if (saveCapitalBtn) {
      saveCapitalBtn.textContent = capitalEditorState.isSaving ? ui("Saving...") : ui("Save Capital");
      saveCapitalBtn.disabled = !canSaveCapital;
    }
    if (scenarioCapitalStatus) {
      const capitalStatusBits = [];
      if (capitalEditorState.lastSaveMessage) {
        capitalStatusBits.push(capitalEditorState.lastSaveMessage);
      } else if (capitalEditorState.lastSavedAt) {
        capitalStatusBits.push(`${ui("Last Saved")}: ${capitalEditorState.lastSavedAt}`);
      }
      scenarioCapitalStatus.textContent = capitalStatusBits.join(" | ");
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
  };

  const bindEvents = () => {
    bindButtonAction(saveCountryBtn, async () => {
      const built = buildScenarioCountrySavePayload();
      if (!built.ok || !built.payload) {
        showToast(built.message || ui("Choose a country tag and fill both names before saving."), {
          title: ui("Country Name Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      state.devScenarioCountryEditor = {
        ...(state.devScenarioCountryEditor || {}),
        isSaving: true,
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
      try {
        const response = await fetch("/__dev/scenario/country/save", {
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
        applyScenarioCountrySaveSuccess(result, built.payload);
        flushDevWorkspaceRender("dev-workspace-country-save");
        if (typeof state.updateScenarioUIFn === "function") {
          state.updateScenarioUIFn();
        }
        showToast(ui("Country names saved."), {
          title: ui("Country Name Editor"),
          tone: "success",
        });
      } catch (error) {
        state.devScenarioCountryEditor = {
          ...(state.devScenarioCountryEditor || {}),
          isSaving: false,
          lastSaveMessage: String(error?.message || ui("Unable to save country names.")),
          lastSaveTone: "critical",
        };
        showToast(String(error?.message || ui("Unable to save country names.")), {
          title: ui("Country Name Editor"),
          tone: "critical",
          duration: 4200,
        });
      }
      state.devScenarioCountryEditor = {
        ...(state.devScenarioCountryEditor || {}),
        isSaving: false,
      };
      renderWorkspace();
    });

    bindButtonAction(saveCapitalBtn, async () => {
      const built = buildScenarioCapitalSavePayload();
      if (!built.ok || !built.payload) {
        showToast(built.message || ui("Select one feature and a matching country tag before saving a capital."), {
          title: ui("Capital Editor"),
          tone: "warning",
        });
        renderWorkspace();
        return;
      }
      state.devScenarioCapitalEditor = {
        ...(state.devScenarioCapitalEditor || {}),
        isSaving: true,
        lastSaveMessage: "",
        lastSaveTone: "",
      };
      renderWorkspace();
      try {
        const response = await fetch("/__dev/scenario/capital/save", {
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
        applyScenarioCapitalSaveSuccess(result, built.payload);
        flushDevWorkspaceRender("dev-workspace-capital-save");
        if (typeof state.updateScenarioUIFn === "function") {
          state.updateScenarioUIFn();
        }
        showToast(ui("Scenario capital saved."), {
          title: ui("Capital Editor"),
          tone: "success",
        });
      } catch (error) {
        state.devScenarioCapitalEditor = {
          ...(state.devScenarioCapitalEditor || {}),
          isSaving: false,
          lastSaveMessage: String(error?.message || ui("Unable to save capital.")),
          lastSaveTone: "critical",
        };
        showToast(String(error?.message || ui("Unable to save capital.")), {
          title: ui("Capital Editor"),
          tone: "critical",
          duration: 4200,
        });
      }
      state.devScenarioCapitalEditor = {
        ...(state.devScenarioCapitalEditor || {}),
        isSaving: false,
      };
      renderWorkspace();
    });

    bindButtonAction(saveLocaleBtn, async () => {
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
        flushDevWorkspaceRender("dev-workspace-locale-save");
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

    if (scenarioCountrySelect && scenarioCountrySelect.dataset.bound !== "true") {
      scenarioCountrySelect.addEventListener("change", (event) => {
        const tag = normalizeScenarioTagInput(event.target.value);
        const entry = state.scenarioCountriesByTag?.[tag] || {};
        state.devScenarioCountryEditor = {
          ...(state.devScenarioCountryEditor || {}),
          tag,
          nameEn: normalizeScenarioNameInput(entry.display_name_en || entry.display_name || ""),
          nameZh: normalizeScenarioNameInput(entry.display_name_zh),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioCountrySelect.dataset.bound = "true";
    }

    if (scenarioCountryNameEnInput && scenarioCountryNameEnInput.dataset.bound !== "true") {
      scenarioCountryNameEnInput.addEventListener("input", (event) => {
        state.devScenarioCountryEditor = {
          ...(state.devScenarioCountryEditor || {}),
          nameEn: normalizeScenarioNameInput(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioCountryNameEnInput.dataset.bound = "true";
    }

    if (scenarioCountryNameZhInput && scenarioCountryNameZhInput.dataset.bound !== "true") {
      scenarioCountryNameZhInput.addEventListener("input", (event) => {
        state.devScenarioCountryEditor = {
          ...(state.devScenarioCountryEditor || {}),
          nameZh: normalizeScenarioNameInput(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioCountryNameZhInput.dataset.bound = "true";
    }

    if (scenarioCapitalSelect && scenarioCapitalSelect.dataset.bound !== "true") {
      scenarioCapitalSelect.addEventListener("change", (event) => {
        selectScenarioCapitalEditorTag(event.target.value, { clearSearch: true });
        renderWorkspace();
      });
      scenarioCapitalSelect.dataset.bound = "true";
    }

    if (scenarioCapitalSearchInput && scenarioCapitalSearchInput.dataset.bound !== "true") {
      scenarioCapitalSearchInput.addEventListener("input", (event) => {
        state.devScenarioCapitalEditor = {
          ...(state.devScenarioCapitalEditor || {}),
          searchQuery: normalizeScenarioNameInput(event.target.value),
          lastSaveMessage: "",
          lastSaveTone: "",
        };
        renderWorkspace();
      });
      scenarioCapitalSearchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const matches = buildCapitalEditorSearchMatches(
          normalizeScenarioNameInput(event.target.value),
          collectScenarioCountryOptions({ includeReleasable: true })
        );
        if (!matches.length) return;
        event.preventDefault();
        selectScenarioCapitalEditorTag(matches[0].tag, { clearSearch: true });
        renderWorkspace();
      });
      scenarioCapitalSearchInput.dataset.bound = "true";
    }

    if (scenarioCapitalSearchResults && scenarioCapitalSearchResults.dataset.bound !== "true") {
      scenarioCapitalSearchResults.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-dev-capital-search-tag]");
        if (!button) return;
        const tag = normalizeScenarioTagInput(button.dataset.devCapitalSearchTag);
        if (!tag) return;
        selectScenarioCapitalEditorTag(tag, { clearSearch: true });
        renderWorkspace();
      });
      scenarioCapitalSearchResults.dataset.bound = "true";
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
  };

  return {
    bindEvents,
    render,
  };
}
