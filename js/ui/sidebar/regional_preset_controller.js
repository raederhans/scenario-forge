// Regional preset selection, presentation and application validation share one owner.
// Mutations remain in the sidebar's existing visual paint transactions.
export function createRegionalPresetController(runtimeState, {
  t,
  normalizeCountryCode,
  normalizePresetName,
  resolveScenarioLookupCode,
  getScenarioCountryMeta,
  resolveFeatureIdsFromPresetSource,
  filterToVisibleFeatureIds,
  applyVisualOverridesToFeatureIds,
  showToast,
  render,
  appendActionSection,
  setScenarioVisualAdjustmentsOpen,
}) {
  function getStoredPresetReference(presetLookupCode, presetIndex) {
    const preset = runtimeState.presetsState?.[presetLookupCode]?.[presetIndex];
    if (!preset) return null;
    const ids = [];
    if (Array.isArray(preset.ids)) {
      for (const id of preset.ids) ids.push(String(id || ""));
    }
    return { presetLookupCode, presetIndex, preset: { name: String(preset.name || ""), ids } };
  }

  function applyPresetWithMode(countryCode, presetIndex, options = {}) {
    const presetLookupCode = resolveScenarioLookupCode(countryCode);
    const presetRef = getStoredPresetReference(presetLookupCode, presetIndex);
    return applyPresetReference(presetRef, {
      ...options, countryCode, presetLookupCode, presetIndex,
    });
  }

  function applyPresetReference(
    presetRef,
    {
      color,
      render,
      countryCode = presetRef?.presetLookupCode,
      presetLookupCode = presetRef?.presetLookupCode,
      presetIndex = presetRef?.presetIndex,
      visualHistoryKind = "preset-apply-color",
      visualDirtyReason = "preset-apply-color",
    } = {}
  ) {
    if (!presetRef?.preset) {
      console.warn(`Preset not found: ${presetLookupCode}[${presetIndex}]`);
      return {
        applied: false,
        changed: 0,
        matchedCount: 0,
        requestedCount: 0,
        missingCount: 0,
        reason: "missing-preset",
      };
    }
    const preset = presetRef.preset;
    const requestedFeatureIds = [];
    if (Array.isArray(preset.ids)) {
      for (const id of preset.ids) requestedFeatureIds.push(String(id || "").trim());
    }
    const {
      requestedIds,
      matchedIds: targetIds,
      missingIds,
    } = filterToVisibleFeatureIds(requestedFeatureIds);
    if (!requestedIds.length) {
      return {
        applied: false,
        changed: 0,
        matchedCount: 0,
        requestedCount: 0,
        missingCount: 0,
        reason: "empty-preset",
      };
    }
    if (!targetIds.length) {
      showToast(
        t("Current map does not include this preset's detail features. Load detail topology and try again.", "ui"),
        {
          title: t("Preset not applied", "ui"),
          tone: "warning",
          duration: 4200,
        }
      );
      console.warn("[scenario] Preset apply skipped because no visible feature ids matched.", {
        countryCode,
        presetLookupCode,
        presetName: String(preset.name || ""),
        requestedCount: requestedIds.length,
        missingCount: missingIds.length,
      });
      return {
        applied: false,
        changed: 0,
        matchedCount: 0,
        requestedCount: requestedIds.length,
        missingCount: missingIds.length,
        reason: "no-visible-features",
      };
    }

    const result = applyVisualOverridesToFeatureIds(targetIds, color || String(runtimeState.selectedColor || ""), {
      render,
      historyKind: visualHistoryKind,
      dirtyReason: visualDirtyReason,
    });
    return {
      ...result,
      matchedCount: targetIds.length,
      requestedCount: requestedIds.length,
      missingCount: missingIds.length,
    };
  }

  function getPresetSourceLookup(scenarioMeta, countryState, { union = false } = {}) {
    return {
      tag: (union ? scenarioMeta?.code : scenarioMeta?.tag) || countryState?.code || "",
      release_lookup_iso2:
        scenarioMeta?.release_lookup_iso2
        || scenarioMeta?.releaseLookupIso2
        || scenarioMeta?.lookup_iso2
        || scenarioMeta?.lookupIso2
        || scenarioMeta?.base_iso2
        || scenarioMeta?.baseIso2
        || "",
      lookup_iso2:
        scenarioMeta?.lookup_iso2
        || scenarioMeta?.lookupIso2
        || scenarioMeta?.release_lookup_iso2
        || scenarioMeta?.releaseLookupIso2
        || scenarioMeta?.base_iso2
        || scenarioMeta?.baseIso2
        || "",
      base_iso2:
        scenarioMeta?.base_iso2
        || scenarioMeta?.baseIso2
        || (union ? scenarioMeta?.lookup_iso2 || scenarioMeta?.lookupIso2 : "")
        || "",
    };
  }

  const getPrimaryReleasablePresetRef = (countryState, { warnOnMissing = true } = {}) => {
    const presetLookupCode = countryState?.presetLookupCode || countryState?.code;
    const presets = Array.isArray(runtimeState.presetsState?.[presetLookupCode]) ? runtimeState.presetsState[presetLookupCode] : [];
    for (let presetIndex = 0; presetIndex < presets.length; presetIndex += 1) {
      if (String(presets[presetIndex]?.preset_kind || "").trim() === "releasable_core") {
        return getStoredPresetReference(presetLookupCode, presetIndex);
      }
    }

    const scenarioMeta = getScenarioCountryMeta(countryState?.code) || countryState || {};
    const boundaryVariants = Array.isArray(scenarioMeta?.boundary_variants)
      ? scenarioMeta.boundary_variants
      : Array.isArray(countryState?.boundaryVariants)
        ? countryState.boundaryVariants
        : [];
    if (!boundaryVariants.length) {
      if (warnOnMissing) {
        console.warn("[scenario] Missing releasable core preset for selected country.", {
          code: countryState?.code || "",
          presetLookupCode,
        });
      }
      return null;
    }

    const selectedVariantId = String(
      scenarioMeta?.selected_boundary_variant_id
      || countryState?.selectedBoundaryVariantId
      || scenarioMeta?.default_boundary_variant_id
      || countryState?.defaultBoundaryVariantId
      || ""
    ).trim().toLowerCase();
    const selectedVariant = boundaryVariants.find(
      (variant) => String(variant?.id || "").trim().toLowerCase() === selectedVariantId
    ) || boundaryVariants[0];
    const presetSourceLookup = getPresetSourceLookup(scenarioMeta, countryState);
    const featureIds = resolveFeatureIdsFromPresetSource(selectedVariant?.preset_source, presetSourceLookup);
    if (!featureIds.length) {
      if (warnOnMissing) {
        console.warn("[scenario] Boundary variant exists but resolved zero feature ids.", {
          code: countryState?.code || "",
          presetLookupCode,
          variantId: selectedVariant?.id || "",
        });
      }
      return null;
    }
    const ids = [];
    for (const id of featureIds) ids.push(String(id || ""));
    return {
      presetLookupCode,
      presetIndex: -1,
      preset: {
        name: t("Core Territory", "ui"),
        ids,
        generated: true,
        locked: true,
        preset_kind: "releasable_core",
        releasable_tag: countryState?.code || "",
        boundary_variant_id: String(selectedVariant?.id || "").trim(),
      },
    };
  };

  function prepareScenarioCoreApplication(countryState, { variantId = "" } = {}) {
    const scenarioMeta = getScenarioCountryMeta(countryState?.code) || countryState || {};
    const requestedVariantId = String(variantId || "").trim().toLowerCase();
    let presetRef;
    const failure = (reason, requestedCount = 0, missingCount = 0) => ({
      applied: false, reason, requestedCount, matchedCount: 0, missingCount,
      presetRef: presetRef || null, assignments: {},
    });
    if (requestedVariantId) {
      const variants = Array.isArray(scenarioMeta?.boundary_variants)
        ? scenarioMeta.boundary_variants
        : Array.isArray(countryState?.boundaryVariants) ? countryState.boundaryVariants : [];
      const variant = variants.find((entry) => String(entry?.id || "").trim().toLowerCase() === requestedVariantId);
      if (!variant) return failure("missing-variant");
      const ids = [];
      for (const id of resolveFeatureIdsFromPresetSource(
        variant.preset_source, getPresetSourceLookup(scenarioMeta, countryState)
      )) ids.push(String(id || ""));
      presetRef = {
        presetLookupCode: String(countryState?.presetLookupCode || countryState?.code || ""),
        presetIndex: -1,
        preset: {
          name: String(t("Core Territory", "ui")), ids,
          generated: true, locked: true, preset_kind: "releasable_core",
          releasable_tag: String(countryState?.code || ""),
          boundary_variant_id: String(variant.id || "").trim(),
        },
      };
    } else {
      presetRef = getPrimaryReleasablePresetRef(countryState);
    }
    if (!presetRef) return failure("missing-preset");
    const { requestedIds, matchedIds: targetIds, missingIds } = filterToVisibleFeatureIds(presetRef.preset.ids);
    if (!requestedIds.length) return failure("empty-preset");
    if (!targetIds.length) return failure("no-visible-features", requestedIds.length, missingIds.length);

    const unionIds = new Set(targetIds.map((id) => String(id || "").trim()).filter(Boolean));
    const variants = Array.isArray(scenarioMeta?.boundary_variants)
      ? scenarioMeta.boundary_variants
      : Array.isArray(scenarioMeta?.boundaryVariants) ? scenarioMeta.boundaryVariants : [];
    const lookup = getPresetSourceLookup(scenarioMeta, countryState, { union: true });
    for (const variant of variants) {
      for (const id of resolveFeatureIdsFromPresetSource(variant?.preset_source, lookup)) {
        const featureId = String(id || "").trim();
        if (featureId) unionIds.add(featureId);
      }
    }
    const { matchedIds: variantUnionIds } = filterToVisibleFeatureIds(Array.from(unionIds));
    const targets = new Set(targetIds.map((id) => String(id || "").trim()).filter(Boolean));
    const assignments = {};
    for (const id of variantUnionIds) {
      const featureId = String(id || "").trim();
      if (!featureId) continue;
      if (targets.has(featureId)) {
        assignments[featureId] = {
          ownerCode: String(countryState.code), controllerCode: String(countryState.code),
        };
      } else {
        const baselineOwnerCode = normalizeCountryCode(
          String(runtimeState.scenarioBaselineOwnersByFeatureId?.[featureId]
            || runtimeState.runtimeCanonicalCountryByFeatureId?.[featureId]
            || "")
        );
        if (baselineOwnerCode) assignments[featureId] = { ownerCode: baselineOwnerCode };
      }
    }
    return {
      applied: true, reason: "", requestedCount: requestedIds.length,
      matchedCount: targetIds.length, missingCount: missingIds.length, presetRef, assignments,
    };
  }

  const hasScenarioCoreTerritoryActions = (countryState) => {
    if (!countryState) return false;
    if (countryState.releasable) return true;
    if (Array.isArray(countryState?.boundaryVariants) && countryState.boundaryVariants.length > 1) {
      return true;
    }
    return !!getPrimaryReleasablePresetRef(countryState, { warnOnMissing: false });
  };

  function renderRegionalPresets(container, countryState, { mode = "auto" } = {}) {
    const presetLookupCode = countryState?.presetLookupCode || countryState?.code;
    const presets = Array.isArray(runtimeState.presetsState?.[presetLookupCode])
      ? runtimeState.presetsState[presetLookupCode] : [];
    const disabledNames = Array.isArray(countryState?.disabledRegionalPresetNames)
      ? countryState.disabledRegionalPresetNames : [];
    const consumedNames = [];
    const consumed = runtimeState.scenarioReleasableIndex?.consumedPresetNamesByParentLookup?.[presetLookupCode];
    if (runtimeState.activeScenarioId && Array.isArray(consumed)) {
      for (const name of consumed) consumedNames.push(String(name));
    }
    const entries = [];
    for (let presetIndex = 0; presetIndex < presets.length; presetIndex += 1) {
      if (!(presetIndex in presets)) continue;
      const name = String(presets[presetIndex].name || "");
      const normalizedName = normalizePresetName(name);
      if (runtimeState.activeScenarioId && (
        consumedNames.includes(normalizedName) || disabledNames.includes(normalizedName)
      )) continue;
      entries.push({ preset: { name }, presetIndex });
    }
    if (!entries.length) return;

    const visual = mode === "visual";
    const section = visual
      ? appendActionSection(container, t("Regional Presets (Visual Color)", "ui"))
      : appendActionSection(container, t("Regional Presets", "ui"), {
        collapsible: true,
        defaultOpen: false,
        rememberKey: "territories-presets:regional-presets",
      });
    for (const { preset, presetIndex } of entries) {
      const normalizedName = normalizePresetName(preset?.name);
      const baselineDisabled = !!normalizedName && disabledNames.includes(normalizedName);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inspector-item-btn";
      button.textContent = preset.name;
      button.disabled = baselineDisabled;
      if (baselineDisabled) {
        button.title = String(countryState.disabledRegionalPresetReason
          || t("Already applied in scenario baseline", "ui")).trim();
      }
      button.addEventListener("click", () => {
        const options = { color: String(runtimeState.selectedColor || ""), render };
        if (visual) {
          options.visualHistoryKind = "scenario-preset-apply-visual";
          options.visualDirtyReason = "scenario-preset-apply-visual";
        }
        applyPresetWithMode(presetLookupCode, presetIndex, options);
        if (visual) setScenarioVisualAdjustmentsOpen(true);
      });
      section.appendChild(button);
    }
  }

  return {
    getPrimaryReleasablePresetRef,
    prepareScenarioCoreApplication,
    hasScenarioCoreTerritoryActions,
    applyPresetWithMode,
    applyPresetReference,
    renderRegionalPresets,
  };
}
