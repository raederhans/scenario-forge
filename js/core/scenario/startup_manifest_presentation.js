// 启动包内嵌的 manifest_subset 是打包时的副本；展示类字段以运行时已加载的
// manifest.json 为准，这样只改文案、配色或视角时不必重建启动包。
// 白名单之外的字段（几何、归属、分片、合同相关）一律保持启动包原值。
export const STARTUP_MANIFEST_PRESENTATION_FIELDS = Object.freeze([
  "style_defaults",
  "bookmark_name",
  "bookmark_description",
  "bookmark_date",
  "featured_tags",
  "opening_view",
]);

export function overlayStartupManifestPresentationFields(bundleManifest, liveManifest) {
  if (!bundleManifest || typeof bundleManifest !== "object") return bundleManifest;
  if (!liveManifest || typeof liveManifest !== "object" || Array.isArray(liveManifest)) return bundleManifest;
  const liveScenarioId = String(liveManifest.scenario_id || "").trim();
  const bundleScenarioId = String(bundleManifest.scenario_id || "").trim();
  if (liveScenarioId && bundleScenarioId && liveScenarioId !== bundleScenarioId) return bundleManifest;
  let overlaid = null;
  for (const field of STARTUP_MANIFEST_PRESENTATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(liveManifest, field)) continue;
    overlaid ||= { ...bundleManifest };
    overlaid[field] = structuredClone(liveManifest[field]);
  }
  return overlaid || bundleManifest;
}
