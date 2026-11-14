import { getPopulationFeatureInspection, getPopulationReferenceNote } from "./population_spatial_view_model.js";

export function getPopulationTooltipLines(state, feature) {
  const row = getPopulationFeatureInspection(state, feature);
  if (!row) return [];
  const zh = state.currentLanguage === "zh";
  const format = (value, digits = 0) => typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(zh ? "zh-CN" : "en-US", { maximumFractionDigits: digits }) : "—";
  const status = {
    ok: zh ? "栅格估计" : "Gridded estimate",
    partial_coverage: zh ? "部分覆盖，数值仅含已覆盖区域" : "Partial coverage; values include covered area only",
    no_data: zh ? "缺少人口数据" : "Population data unavailable",
    invalid_geometry: zh ? "几何无法统计" : "Invalid statistics geometry",
    overlapping_geometry: zh ? "重叠地块，未重复计数" : "Overlapping geometry; excluded from counts",
    unestimated_scenario_land: zh ? "架空陆地，人口未估计" : "Scenario land; population unestimated",
    water_not_applicable: zh ? "水面，不适用" : "Water; not applicable",
    missing: zh ? "地块未匹配" : "Unmatched parcel",
  }[row.status] || row.status;
  return [
    `${zh ? "人口" : "Population"} · ${row.year}: ${format(row.population)}`,
    ...(row.population === null ? [] : [
      `${zh ? "人口密度" : "Density"}: ${format(row.density, 1)} ${zh ? "人／km²" : "persons/km²"}`,
      `${zh ? "建模陆地面积" : "Modelled land area"}: ${format(row.land_area_km2, 2)} km²`,
      `${zh ? "数据覆盖" : "Data coverage"}: ${format(row.coverage_fraction === null ? null : row.coverage_fraction * 100, 1)}%`,
    ]), status, "GHSL GHS-POP R2023A · 2020 · 1 km", getPopulationReferenceNote(state),
  ].filter(Boolean);
}
