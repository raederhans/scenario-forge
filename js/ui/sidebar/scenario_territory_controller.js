import { state } from "../../core/state.js";
import {
  resolveCatalogEntryForTag, resolvePresetFeatureIds, resolveBoundaryVariantFeatureIds,
  resolveCompanionActionFeatureIds, setReleasableBoundaryVariant,
} from "../../core/releasable_manager.js";
import { applyVisualPaintBatches } from "./visual_paint_batch.js";

export function selectScenarioBoundaryVariant(tag, variantId, redraw) {
  const result = setReleasableBoundaryVariant(tag, variantId);
  redraw();
  return result;
}

export function createScenarioTerritoryController({
  t, getCountryState, getResolvedCountryColor, showToast, render, renderList,
}) {
  function rejectApplication(result) {
    if (result.reason === "no-visible-features") {
      showToast(t("Current map does not include this preset's detail features. Load detail topology and try again.", "ui"), {
        title: t("Preset not applied", "ui"), tone: "warning", duration: 4200,
      });
    } else {
      showToast(t("Core territory was not applied.", "ui"), {
        title: t("Apply failed", "ui"), tone: "warning", duration: 3200,
      });
    }
    renderList();
    return false;
  }

  function applyScenarioReleasableCoreTerritory(countryState, {
    companionActionIds,
    filterToVisibleFeatureIds,
  } = {}) {
    const entry = resolveCatalogEntryForTag(countryState.code);
    if (!entry) return false;
    const color = getResolvedCountryColor(getCountryState(countryState.code) || countryState);
    const ids = resolvePresetFeatureIds(entry);
    const { matchedIds } = filterToVisibleFeatureIds(ids);
    if (!matchedIds.length) return rejectApplication({ reason: "no-visible-features" });
    const selectedIds = new Set(ids);
    const clearIds = [...new Set((entry.boundary_variants || []).flatMap(
      (variant) => resolveBoundaryVariantFeatureIds(entry, variant.id)
    ))].filter((id) => !selectedIds.has(id)
      && state.visualOverrides?.[id]?.toLowerCase() === color.toLowerCase());
    const batches = [{ ids: clearIds, color: null }, { ids: matchedIds, color }];
    let companionCount = 0;
    for (const action of entry.companion_actions || []) {
      if (action.hidden_in_ui) continue;
      const selected = companionActionIds === undefined
        ? action.auto_apply_on_core_territory : companionActionIds.includes(action.id);
      const target = getCountryState(action.target_owner_tag);
      if (!selected || !target) continue;
      batches.push({ ids: resolveCompanionActionFeatureIds(action, entry), color: getResolvedCountryColor(target) });
      companionCount += 1;
    }
    const result = applyVisualPaintBatches(batches, {
      filterToVisibleFeatureIds, render, matchedCount: matchedIds.length,
      historyKind: "scenario-core-apply-visual", dirtyReason: "scenario-core-apply-visual",
    });
    if (!result.applied || !result.matchedCount) return rejectApplication(result);
    showToast(`${t("Applied", "ui")} ${result.changed} ${t("features", "ui")} · ${companionCount} ${t("companion actions", "ui")}`, {
      title: t("Visual color applied", "ui"), tone: "success", duration: 2800,
    });
    renderList();
    return result.applied;
  }

  return { applyScenarioReleasableCoreTerritory };
}
