// Coordinates core-territory application; target planning and state transactions stay separate.
export function createScenarioTerritoryController({
  t,
  getPrimaryReleasablePresetRef,
  applyPresetReference,
  getCountryState,
  getResolvedCountryColor,
  showToast,
  render,
  renderList,
}) {
  function rejectApplication(result) {
    if (result?.reason !== "no-visible-features") {
      showToast(t("Core territory was not applied.", "ui"), {
        title: t("Apply failed", "ui"), tone: "warning", duration: 3200,
      });
    }
    renderList();
    return false;
  }

  function applyScenarioReleasableCoreTerritory(countryState, {
    source = "scenario-actions",
  } = {}) {
    const presetRef = getPrimaryReleasablePresetRef(countryState);
    if (!presetRef) {
      console.warn("[scenario] Missing releasable core preset.", { source, code: countryState?.code || "" });
      return false;
    }
    const color = getResolvedCountryColor(getCountryState(countryState.code) || countryState);
    const result = applyPresetReference(presetRef, {
      color, render,
      visualHistoryKind: "scenario-core-apply-visual",
      visualDirtyReason: "scenario-core-apply-visual",
    });
    if (!result?.applied) return rejectApplication(result);
    showToast(`${t("Applied", "ui")} ${result.matchedCount}/${result.requestedCount} ${t("features", "ui")}`, {
      title: t("Visual color applied", "ui"), tone: "success", duration: 2800,
    });
    renderList();
    return true;
  }

  return { applyScenarioReleasableCoreTerritory };
}
