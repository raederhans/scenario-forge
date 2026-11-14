export function ensureHgoIdentitySettings(runtimeState) {
  if (!runtimeState.hgoIdentity || typeof runtimeState.hgoIdentity !== "object") {
    runtimeState.hgoIdentity = {};
  }
  runtimeState.hgoIdentity.enabled = runtimeState.hgoIdentity.enabled === true;
  runtimeState.hgoIdentity.nameMode = runtimeState.hgoIdentity.nameMode === "hgo" ? "hgo" : "scenario";
  runtimeState.hgoIdentity.showSuggestedAliases = runtimeState.hgoIdentity.showSuggestedAliases !== false;
  if (!runtimeState.hgoIdentity.variantSelections || typeof runtimeState.hgoIdentity.variantSelections !== "object") {
    runtimeState.hgoIdentity.variantSelections = {};
  }
  return runtimeState.hgoIdentity;
}
