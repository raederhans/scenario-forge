"""Denmark local border-detail refinement for North Schleswig."""
from __future__ import annotations

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from map_builder import config as cfg
from map_builder.geo.utils import ensure_crs
from map_builder.io.fetch import fetch_or_load_geojson


TARGET_FEATURE_ID = "DK032"
HISTORICAL_FEATURE_ID = "DK_HIST_NORTH_SCHLESWIG"
REMAINDER_FEATURE_ID = "DK_SJY_REMAINDER"
HISTORICAL_NAMES = {
    "Aabenraa",
    "Haderslev",
    "Sønderborg",
    "Tønder",
}
MAX_DRIFT_KM2 = 0.5
MAX_OVERLAP_KM2 = 0.05


def _make_valid_geom(geom):
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


def _sanitize_polygon_layer(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    clean = ensure_crs(gdf.copy())
    clean["geometry"] = clean.geometry.apply(_make_valid_geom)
    clean = clean[clean.geometry.notna() & ~clean.geometry.is_empty].copy()
    clean = clean[clean.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    return clean


def _feature_area_km2(geom) -> float:
    if geom is None or geom.is_empty:
        return 0.0
    projected = gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4326").to_crs(cfg.AREA_CRS)
    return float(projected.geometry.area.iloc[0] / 1_000_000.0)


def _sym_diff_area_km2(left, right) -> float:
    left = _make_valid_geom(left)
    right = _make_valid_geom(right)
    if left is None or right is None:
        return 0.0
    return _feature_area_km2(_make_valid_geom(left.symmetric_difference(right)))


def _load_denmark_adm2() -> gpd.GeoDataFrame:
    source = fetch_or_load_geojson(
        cfg.DNK_ADM2_URL,
        cfg.DNK_ADM2_FILENAME,
        fallback_urls=cfg.DNK_ADM2_FALLBACK_URLS,
    )
    source = _sanitize_polygon_layer(source)
    required = {"shapeID", "shapeName"}
    if not required.issubset(set(source.columns)):
        raise SystemExit(
            "[Denmark] ADM2 source missing required columns "
            f"{sorted(required)}. Available={source.columns.tolist()}"
        )
    source["shapeID"] = source["shapeID"].fillna("").astype(str).str.strip()
    source["shapeName"] = source["shapeName"].fillna("").astype(str).str.strip()
    source = source[(source["shapeID"] != "") & (source["shapeName"] != "")].copy()
    if source.empty:
        raise SystemExit("[Denmark] ADM2 source is empty after normalization.")
    return source


def _build_feature_row(
    template_row: pd.Series,
    *,
    feature_id: str,
    name: str,
    detail_tier: str,
    geometry,
    admin1_group: str,
) -> dict[str, object]:
    row = template_row.to_dict()
    row["id"] = feature_id
    row["name"] = name
    row["cntr_code"] = "DK"
    row["admin1_group"] = admin1_group
    row["adm1_name"] = admin1_group
    row["detail_tier"] = detail_tier
    row["geometry"] = geometry
    return row


def apply_denmark_border_detail(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "id" not in main_gdf.columns or "cntr_code" not in main_gdf.columns:
        print("[Denmark] id/cntr_code missing; skipping border-detail refinement.")
        return main_gdf

    normalized = ensure_crs(main_gdf.copy())
    normalized["id"] = normalized["id"].fillna("").astype(str).str.strip()
    normalized["cntr_code"] = normalized["cntr_code"].fillna("").astype(str).str.upper().str.strip()

    shell_rows = normalized[normalized["id"] == TARGET_FEATURE_ID].copy()
    if shell_rows.empty:
        raise SystemExit(f"[Denmark] Target feature {TARGET_FEATURE_ID} not found.")
    if len(shell_rows) != 1:
        raise SystemExit(
            f"[Denmark] Expected exactly one {TARGET_FEATURE_ID} shell, found {len(shell_rows)}."
        )

    shell_row = shell_rows.iloc[0]
    shell_geom = _make_valid_geom(shell_row.geometry)
    if shell_geom is None or shell_geom.is_empty:
        raise SystemExit(f"[Denmark] Target feature {TARGET_FEATURE_ID} has empty geometry.")

    source = _load_denmark_adm2()
    historical = source[source["shapeName"].isin(HISTORICAL_NAMES)].copy()
    missing_names = HISTORICAL_NAMES - set(historical["shapeName"].tolist())
    if missing_names:
        raise SystemExit(
            "[Denmark] ADM2 source missing North Schleswig municipalities: "
            + ", ".join(sorted(missing_names))
        )

    historical["geometry"] = historical.geometry.apply(
        lambda geom: _make_valid_geom(geom.intersection(shell_geom))
        if geom is not None and not geom.is_empty
        else None
    )
    historical = _sanitize_polygon_layer(historical)
    if historical.empty:
        raise SystemExit("[Denmark] North Schleswig clip produced no geometry.")

    historical_geom = _make_valid_geom(unary_union(historical.geometry.tolist()))
    historical_geom = _make_valid_geom(historical_geom.intersection(shell_geom))
    remainder_geom = _make_valid_geom(shell_geom.difference(historical_geom))
    if historical_geom is None or historical_geom.is_empty:
        raise SystemExit("[Denmark] Historical North Schleswig geometry is empty.")
    if remainder_geom is None or remainder_geom.is_empty:
        raise SystemExit("[Denmark] South Jutland remainder geometry is empty.")

    overlap_km2 = _feature_area_km2(_make_valid_geom(historical_geom.intersection(remainder_geom)))
    if overlap_km2 > MAX_OVERLAP_KM2:
        raise SystemExit(
            f"[Denmark] Split overlap too large: {overlap_km2:.3f} km^2 "
            f"(limit={MAX_OVERLAP_KM2:.3f})."
        )

    combined_geom = _make_valid_geom(unary_union([historical_geom, remainder_geom]))
    drift_km2 = _sym_diff_area_km2(shell_geom, combined_geom)
    if drift_km2 > MAX_DRIFT_KM2:
        raise SystemExit(
            f"[Denmark] Split coverage drift too large: {drift_km2:.3f} km^2 "
            f"(limit={MAX_DRIFT_KM2:.3f})."
        )

    admin1_group = str(shell_row.get("admin1_group", "")).strip() or str(shell_row.get("name", "")).strip()
    new_rows = [
        _build_feature_row(
            shell_row,
            feature_id=HISTORICAL_FEATURE_ID,
            name="North Schleswig",
            detail_tier="adm2_historical_target",
            geometry=historical_geom,
            admin1_group=admin1_group,
        ),
        _build_feature_row(
            shell_row,
            feature_id=REMAINDER_FEATURE_ID,
            name="South Jutland (Remainder)",
            detail_tier="adm2_partial_remainder",
            geometry=remainder_geom,
            admin1_group=admin1_group,
        ),
    ]
    refinement = _sanitize_polygon_layer(gpd.GeoDataFrame(new_rows, crs=normalized.crs))
    if len(refinement) != 2:
        raise SystemExit(
            "[Denmark] Border-detail refinement lost features after sanitation: "
            f"expected=2 actual={len(refinement)}."
        )

    base = normalized[normalized["id"] != TARGET_FEATURE_ID].copy()
    combined = gpd.GeoDataFrame(
        pd.concat([base, refinement], ignore_index=True),
        crs=normalized.crs or "EPSG:4326",
    )
    print(
        "[Denmark] Border-detail refinement complete: "
        f"replaced={TARGET_FEATURE_ID}, features={len(refinement)}, drift_km2={drift_km2:.3f}."
    )
    return combined
