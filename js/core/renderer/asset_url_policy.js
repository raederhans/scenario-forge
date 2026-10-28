export function createRendererAssetUrlPolicyOwner({ state } = {}) {
  function getScenarioBathymetryTextureUrl() {
    const value = String(state.activeScenarioManifest?.bathymetry_texture_url || "").trim();
    if (!value) return "";
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith("//") || value.startsWith("/")) {
      return "";
    }
    if (!value.startsWith("data/")) return "";
    return value;
  }

  return { getScenarioBathymetryTextureUrl };
}
