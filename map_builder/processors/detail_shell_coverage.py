"""Shared shell coverage repair helpers for managed detail countries."""
from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from map_builder import config as cfg


@dataclass(frozen=True)
class ManagedShellCoverageSpec:
    country_code: str
    id_prefix: str
    name_prefix: str
    source_label: str = "detail"


SHELL_COVERAGE_MIN_AREA_KM2 = 1.0


DEFAULT_SHELL_COVERAGE_SPECS: dict[str, ManagedShellCoverageSpec] = {
    "RU": ManagedShellCoverageSpec(
        country_code="RU",
        id_prefix="RU_ARCTIC_FB",
        name_prefix="Russia Shell Fallback",
        source_label="detail",
    ),
    "DE": ManagedShellCoverageSpec(
        country_code="DE",
        id_prefix="DE_SHELL_FB",
        name_prefix="Germany Shell Fallback",
        source_label="detail",
    ),
    "GB": ManagedShellCoverageSpec(
        country_code="GB",
        id_prefix="GB_SHELL_FB",
        name_prefix="United Kingdom Shell Fallback",
        source_label="detail",
    ),
    "CZ": ManagedShellCoverageSpec(
        country_code="CZ",
        id_prefix="CZ_SHELL_FB",
        name_prefix="Czech Republic Shell Fallback",
        source_label="detail",
    ),
}


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _make_valid(geom):
    if geom is None or geom.is_empty:
        return None
    try:
        if hasattr(geom, "make_valid"):
            geom = geom.make_valid()
        else:
            geom = geom.buffer(0)
    except Exception:
        try:
            geom = geom.buffer(0)
        except Exception:
            return None
    if geom is None or geom.is_empty:
        return None
    return geom


def _prepare_country_layer(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty:
        return _empty_gdf()
    out = _ensure_epsg4326(gdf.copy())
    if "cntr_code" not in out.columns:
        out["cntr_code"] = ""
    if "id" not in out.columns:
        out["id"] = ""
    out["cntr_code"] = out["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    out["id"] = out["id"].fillna("").astype(str).str.strip()
    out["geometry"] = out.geometry.apply(_make_valid)
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    if out.empty:
        return _empty_gdf()
    out = out[out.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if out.empty:
        return _empty_gdf()
    return out


def _explode_gap_geometry(geometry) -> gpd.GeoDataFrame:
    if geometry is None or geometry.is_empty:
        return _empty_gdf()
    fragments = gpd.GeoDataFrame(geometry=[geometry], crs="EPSG:4326")
    fragments = fragments.explode(index_parts=False, ignore_index=True)
    fragments["geometry"] = fragments.geometry.apply(_make_valid)
    fragments = fragments[fragments.geometry.notna() & ~fragments.geometry.is_empty].copy()
    if fragments.empty:
        return _empty_gdf()
    fragments = fragments[fragments.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if fragments.empty:
        return _empty_gdf()
    projected = fragments.to_crs(cfg.AREA_CRS)
    fragments["area_km2"] = projected.geometry.area / 1_000_000.0
    fragments["rep_lon"] = fragments.geometry.representative_point().x
    fragments["rep_lat"] = fragments.geometry.representative_point().y
    return fragments


def _strip_managed_fragments(
    gdf: gpd.GeoDataFrame,
    spec: ManagedShellCoverageSpec,
) -> gpd.GeoDataFrame:
    if gdf.empty or "id" not in gdf.columns:
        return gdf
    prefix = f"{spec.id_prefix}_"
    return gdf[~gdf["id"].astype(str).str.startswith(prefix)].copy()


def _iter_specs(
    coverage_specs: dict[str, ManagedShellCoverageSpec] | None = None,
) -> list[ManagedShellCoverageSpec]:
    specs = coverage_specs or DEFAULT_SHELL_COVERAGE_SPECS
    return [
        spec
        for spec in specs.values()
        if isinstance(spec, ManagedShellCoverageSpec) and str(spec.country_code).strip()
    ]


def _resolve_allowed_area_geometry(
    allowed_area_gdf: gpd.GeoDataFrame | None,
    country_code: str,
):
    if allowed_area_gdf is None:
        return None
    allowed = _prepare_country_layer(allowed_area_gdf)
    if allowed.empty:
        return None
    if "cntr_code" in allowed.columns:
        country_allowed = allowed[allowed["cntr_code"] == country_code].copy()
        if not country_allowed.empty:
            allowed = country_allowed
    allowed_union = _make_valid(unary_union(allowed.geometry.tolist()))
    if allowed_union is None or allowed_union.is_empty:
        return None
    return allowed_union


def collect_shell_coverage_gaps(
    detail_gdf: gpd.GeoDataFrame,
    shell_gdf: gpd.GeoDataFrame,
    coverage_specs: dict[str, ManagedShellCoverageSpec] | None = None,
    *,
    exclude_managed_fragments: bool = False,
    allowed_area_gdf: gpd.GeoDataFrame | None = None,
    min_area_km2: float | None = None,
) -> list[dict[str, object]]:
    detail = _prepare_country_layer(detail_gdf)
    shell = _prepare_country_layer(shell_gdf)
    results: list[dict[str, object]] = []
    area_threshold = (
        SHELL_COVERAGE_MIN_AREA_KM2
        if min_area_km2 is None
        else float(min_area_km2)
    )

    for spec in _iter_specs(coverage_specs):
        country_code = str(spec.country_code).strip().upper()
        managed_detail = detail[detail["cntr_code"] == country_code].copy()
        if exclude_managed_fragments:
            managed_detail = _strip_managed_fragments(managed_detail, spec)
        managed_shell = shell[shell["cntr_code"] == country_code].copy()
        if managed_shell.empty:
            continue

        shell_union = _make_valid(unary_union(managed_shell.geometry.tolist()))
        detail_union = (
            _make_valid(unary_union(managed_detail.geometry.tolist()))
            if not managed_detail.empty
            else None
        )
        if shell_union is None or shell_union.is_empty:
            continue
        missing = shell_union if detail_union is None else _make_valid(shell_union.difference(detail_union))
        allowed_area = _resolve_allowed_area_geometry(allowed_area_gdf, country_code)
        if allowed_area is not None:
            missing = _make_valid(missing.intersection(allowed_area)) if missing is not None else None
        fragments = _explode_gap_geometry(missing)
        if fragments.empty:
            continue
        fragments = fragments[fragments["area_km2"] >= area_threshold].copy()
        if fragments.empty:
            continue
        fragments = fragments.sort_values(
            by=["rep_lon", "rep_lat", "area_km2"],
            ascending=[True, True, False],
            kind="mergesort",
        ).reset_index(drop=True)
        total_area = float(fragments["area_km2"].sum())
        max_area = float(fragments["area_km2"].max())
        samples = [
            (round(float(row.rep_lon), 3), round(float(row.rep_lat), 3))
            for row in fragments.head(5).itertuples(index=False)
        ]
        results.append(
            {
                "country_code": country_code,
                "spec": spec,
                "fragments": fragments,
                "fragment_count": int(len(fragments)),
                "total_area_km2": total_area,
                "max_fragment_area_km2": max_area,
                "sample_centroids": samples,
            }
        )
    return results


def repair_shell_coverage(
    detail_gdf: gpd.GeoDataFrame,
    shell_gdf: gpd.GeoDataFrame,
    coverage_specs: dict[str, ManagedShellCoverageSpec] | None = None,
    *,
    allowed_area_gdf: gpd.GeoDataFrame | None = None,
    log_prefix: str = "[Coverage]",
) -> gpd.GeoDataFrame:
    base = _prepare_country_layer(detail_gdf)
    if base.empty:
        return detail_gdf

    result = base.copy()
    managed_specs = _iter_specs(coverage_specs)
    if not managed_specs:
        return detail_gdf

    added_fragments = 0
    for spec in managed_specs:
        result = _strip_managed_fragments(result, spec)
        gaps = collect_shell_coverage_gaps(
            result,
            shell_gdf,
            {spec.country_code: spec},
            exclude_managed_fragments=False,
            allowed_area_gdf=allowed_area_gdf,
        )
        if not gaps:
            continue
        gap = gaps[0]
        fragments = gap["fragments"].copy()
        fragments["id"] = [
            f"{spec.id_prefix}_{index:03d}"
            for index in range(1, len(fragments) + 1)
        ]
        fragments["name"] = [
            f"{spec.name_prefix} {index}"
            for index in range(1, len(fragments) + 1)
        ]
        fragments["cntr_code"] = str(spec.country_code).strip().upper()
        if "admin1_group" in result.columns:
            fragments["admin1_group"] = ""
        if "detail_tier" in result.columns:
            fragments["detail_tier"] = ""
        if "__source" in result.columns:
            fragments["__source"] = spec.source_label
        keep_cols = [col for col in result.columns if col in fragments.columns or col == "geometry"]
        if "geometry" not in keep_cols:
            keep_cols.append("geometry")
        for col in keep_cols:
            if col not in fragments.columns and col != "geometry":
                fragments[col] = ""
        fragments = fragments[keep_cols].copy()
        result = gpd.GeoDataFrame(pd.concat([result, fragments], ignore_index=True), crs="EPSG:4326")
        added_fragments += len(fragments)
        print(
            f"{log_prefix} Restored {len(fragments)} {spec.country_code} shell fallback fragment(s); "
            f"total_area_km2={gap['total_area_km2']:.1f}; samples={gap['sample_centroids']}"
        )

    result["id"] = result["id"].fillna("").astype(str).str.strip()
    result = result[result["id"] != ""].copy()
    result = result.drop_duplicates(subset=["id"], keep="last").reset_index(drop=True)
    return result


def append_shell_coverage_gap_fragments(
    detail_gdf: gpd.GeoDataFrame,
    shell_gdf: gpd.GeoDataFrame,
    coverage_specs: dict[str, ManagedShellCoverageSpec] | None = None,
    *,
    gap_source_gdf: gpd.GeoDataFrame | None = None,
    allowed_area_gdf: gpd.GeoDataFrame | None = None,
    log_prefix: str = "[Coverage]",
) -> gpd.GeoDataFrame:
    result = _prepare_country_layer(detail_gdf)
    if result.empty:
        return detail_gdf
    gap_source = _prepare_country_layer(gap_source_gdf) if gap_source_gdf is not None else result.copy()

    managed_specs = _iter_specs(coverage_specs)
    if not managed_specs:
        return detail_gdf

    for spec in managed_specs:
        gaps = collect_shell_coverage_gaps(
            gap_source,
            shell_gdf,
            {spec.country_code: spec},
            exclude_managed_fragments=False,
            allowed_area_gdf=allowed_area_gdf,
        )
        if not gaps:
            continue

        gap = gaps[0]
        fragments = gap["fragments"].copy()
        prefix = f"{spec.id_prefix}_"
        existing_ids = result["id"].fillna("").astype(str).tolist() if "id" in result.columns else []
        next_suffix = 1
        for existing_id in existing_ids:
            if not existing_id.startswith(prefix):
                continue
            try:
                next_suffix = max(next_suffix, int(existing_id[len(prefix):]) + 1)
            except ValueError:
                continue

        fragments["id"] = [
            f"{spec.id_prefix}_{index:03d}"
            for index in range(next_suffix, next_suffix + len(fragments))
        ]
        fragments["name"] = [
            f"{spec.name_prefix} {index}"
            for index in range(next_suffix, next_suffix + len(fragments))
        ]
        fragments["cntr_code"] = str(spec.country_code).strip().upper()
        if "admin1_group" in result.columns:
            fragments["admin1_group"] = ""
        if "detail_tier" in result.columns:
            fragments["detail_tier"] = ""
        if "__source" in result.columns:
            fragments["__source"] = spec.source_label
        keep_cols = [col for col in result.columns if col in fragments.columns or col == "geometry"]
        if "geometry" not in keep_cols:
            keep_cols.append("geometry")
        for col in keep_cols:
            if col not in fragments.columns and col != "geometry":
                fragments[col] = ""
        fragments = fragments[keep_cols].copy()
        result = gpd.GeoDataFrame(pd.concat([result, fragments], ignore_index=True), crs="EPSG:4326")
        print(
            f"{log_prefix} Added {len(fragments)} residual {spec.country_code} shell fragment(s); "
            f"total_area_km2={gap['total_area_km2']:.1f}; samples={gap['sample_centroids']}"
        )

    result["id"] = result["id"].fillna("").astype(str).str.strip()
    result = result[result["id"] != ""].copy()
    result = result.drop_duplicates(subset=["id"], keep="last").reset_index(drop=True)
    return result
