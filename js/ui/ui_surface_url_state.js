export function createUiSurfaceUrlState({
  uiUrlStateKeys,
} = {}) {
  const replaceUiUrlParams = (mutator) => {
    if (!globalThis.URLSearchParams || !globalThis.history?.replaceState || !globalThis.location) return;
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    mutator?.(params);
    const nextQuery = params.toString();
    const nextUrl = `${globalThis.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${globalThis.location.hash || ""}`;
    globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
  };

  const getScenarioGuideSectionFromUrl = () => {
    if (!globalThis.URLSearchParams || !globalThis.location) return "";
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    const view = String(params.get(uiUrlStateKeys.view) || "").trim().toLowerCase();
    if (view !== "guide") return "";
    const guideSectionValue = String(params.get(uiUrlStateKeys.guideSection) || "").trim().toLowerCase();
    if (guideSectionValue) return guideSectionValue;
    return String(params.get(uiUrlStateKeys.section) || "").trim().toLowerCase();
  };

  const syncScenarioGuideSectionUrlState = (section = "quick") => {
    replaceUiUrlParams((params) => {
      const view = String(params.get(uiUrlStateKeys.view) || "").trim().toLowerCase();
      if (view !== "guide") return;
      params.set(uiUrlStateKeys.guideSection, String(section || "").trim().toLowerCase() || "quick");
      params.delete(uiUrlStateKeys.section);
    });
  };

  const getSupportSurfaceViewFromUrl = () => {
    if (!globalThis.URLSearchParams || !globalThis.location) return "";
    const params = new globalThis.URLSearchParams(globalThis.location.search || "");
    const view = String(params.get(uiUrlStateKeys.view) || "").trim().toLowerCase();
    return ["guide", "reference", "export"].includes(view) ? view : "";
  };

  const syncSupportSurfaceUrlState = (view = "") => {
    replaceUiUrlParams((params) => {
      const normalizedView = String(view || "").trim().toLowerCase();
      if (["guide", "reference", "export"].includes(normalizedView)) {
        params.set(uiUrlStateKeys.view, normalizedView);
      } else if (["guide", "reference", "export"].includes(String(params.get(uiUrlStateKeys.view) || ""))) {
        params.delete(uiUrlStateKeys.view);
      }
    });
  };

  return {
    getScenarioGuideSectionFromUrl,
    getSupportSurfaceViewFromUrl,
    replaceUiUrlParams,
    syncScenarioGuideSectionUrlState,
    syncSupportSurfaceUrlState,
  };
}
