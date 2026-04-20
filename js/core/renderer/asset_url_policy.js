export function createRendererAssetUrlPolicyOwner({
  state,
  constants = {},
} = {}) {
  const {
    globalBathymetryTopologyUrl = "data/global_bathymetry.topo.json",
  } = constants;

  const invalidBathymetryUrlWarnings = new Set();

  function warnInvalidBathymetryUrlOnce(label, rawValue) {
    const key = `${label}:${String(rawValue || "")}`;
    if (invalidBathymetryUrlWarnings.has(key)) {
      return;
    }
    invalidBathymetryUrlWarnings.add(key);
    console.warn(`[bathymetry] Ignored invalid ${label} URL: ${String(rawValue || "").trim()}`);
  }

  function normalizeBathymetryTopologyUrl(rawValue, label = "bathymetry") {
    const value = String(rawValue || "").trim();
    if (!value) return "";
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith("//") || value.startsWith("/")) {
      warnInvalidBathymetryUrlOnce(label, value);
      return "";
    }
    if (!value.startsWith("data/")) {
      warnInvalidBathymetryUrlOnce(label, value);
      return "";
    }
    return value;
  }

  function getScenarioBathymetryTopologyUrl() {
    return normalizeBathymetryTopologyUrl(
      state.activeScenarioManifest?.bathymetry_topology_url,
      "scenario bathymetry"
    );
  }

  function getDesiredBathymetryTopologyUrl(slot) {
    if (slot === "scenario") {
      return getScenarioBathymetryTopologyUrl();
    }
    return normalizeBathymetryTopologyUrl(globalBathymetryTopologyUrl, "global bathymetry");
  }

  function isDesiredBathymetryUrl(slot, url) {
    return getDesiredBathymetryTopologyUrl(slot) === String(url || "").trim();
  }

  function getRequestedBathymetryUrls() {
    return {
      globalUrl: getDesiredBathymetryTopologyUrl("global"),
      scenarioUrl: getDesiredBathymetryTopologyUrl("scenario"),
    };
  }

  return {
    getDesiredBathymetryTopologyUrl,
    getRequestedBathymetryUrls,
    getScenarioBathymetryTopologyUrl,
    isDesiredBathymetryUrl,
  };
}
