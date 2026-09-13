"""France replacement processor."""
from __future__ import annotations

import geopandas as gpd
import pandas as pd

from map_builder import config as cfg
from map_builder.io.fetch import fetch_or_load_geojson


def _source_arrondissement_layer() -> gpd.GeoDataFrame:
    """Load the fixed France source in WGS84 without lossy simplification."""
    fr_gdf = fetch_or_load_geojson(
        cfg.FR_ARR_URL,
        cfg.FR_ARR_FILENAME,
        fallback_urls=cfg.FR_ARR_FALLBACK_URLS,
    )
    if fr_gdf.empty:
        raise SystemExit(1)
    if fr_gdf.crs is None:
        fr_gdf = fr_gdf.set_crs("EPSG:4326", allow_override=True)
    elif fr_gdf.crs.to_epsg() != 4326:
        fr_gdf = fr_gdf.to_crs("EPSG:4326")
    if "code" not in fr_gdf.columns or "nom" not in fr_gdf.columns:
        raise SystemExit("Arrondissements dataset missing expected columns: code/nom.")
    source = fr_gdf.copy()
    source["id"] = "FR_ARR_" + source["code"].astype(str)
    source["name"] = source["nom"].astype(str)
    source["cntr_code"] = "FR"
    return source


def restore_matching_source_geometry(
    existing: gpd.GeoDataFrame,
    source: gpd.GeoDataFrame,
    *,
    allow_master_restore: bool = False,
) -> gpd.GeoDataFrame:
    """Replace geometry for existing FR_ARR IDs while preserving rows and fields.

    This is an explicitly authorized, pre-scenario master operation. Source-only
    features are never injected. A scenario-clipped layer must not opt in:
    preserving IDs alone does not preserve its historical cuts.
    """
    if not allow_master_restore:
        return existing
    if existing.empty:
        return existing
    if "id" not in existing.columns:
        raise ValueError("France master restore requires an id column.")
    if source.empty:
        raise ValueError("France master restore source is empty.")
    if "id" not in source.columns and "code" in source.columns:
        source = source.copy()
        source["id"] = "FR_ARR_" + source["code"].astype(str)
    if "id" not in source.columns:
        raise ValueError("France master restore source has no id/code column.")
    if existing.crs is None or source.crs is None or existing.crs != source.crs:
        raise ValueError(f"France master restore CRS mismatch: existing={existing.crs}, source={source.crs}.")
    if source["id"].duplicated().any():
        raise ValueError("France master restore source contains duplicate IDs.")
    out = existing.copy()
    ids = out["id"].fillna("").astype(str)
    fr_indices = out.index[ids.str.startswith("FR_ARR_")]
    fr_ids = ids.loc[fr_indices]
    if fr_ids.duplicated().any():
        raise ValueError("France master restore input contains duplicate FR_ARR IDs.")
    source_by_id = source.set_index("id")
    missing = sorted(set(fr_ids) - set(source_by_id.index))
    if missing:
        raise ValueError(f"France master restore source is missing IDs: {missing[:5]}")
    bad_source = source[~source.geometry.notna() | source.geometry.is_empty | ~source.geometry.is_valid]
    if not bad_source.empty:
        raise ValueError("France master restore source contains empty or invalid geometries.")
    for index in fr_indices:
        feature_id = str(out.at[index, "id"])
        source_geometry = source_by_id.at[feature_id, "geometry"]
        out.at[index, "geometry"] = source_geometry
    return gpd.GeoDataFrame(out, geometry="geometry", crs=existing.crs or "EPSG:4326")


def apply_france_master_precision(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Restore FR_ARR geometry only when the caller supplies an uncut master layer."""
    if main_gdf.empty or "id" not in main_gdf.columns:
        return main_gdf
    ids = main_gdf["id"].fillna("").astype(str)
    if not ids.str.startswith("FR_ARR_").any():
        return main_gdf
    source = _source_arrondissement_layer()
    return restore_matching_source_geometry(main_gdf, source, allow_master_restore=True)


def apply_holistic_replacements(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "cntr_code" not in main_gdf.columns:
        print("[Holistic] cntr_code missing; skipping France replacement.")
        return main_gdf

    existing_fr = main_gdf[main_gdf["cntr_code"].astype(str).str.upper() == "FR"].copy()
    matching_mode = "id" in existing_fr.columns and existing_fr["id"].astype(str).str.startswith("FR_ARR_").any()
    if matching_mode:
        print("[Holistic] Existing FR_ARR geometries detected; preserving them without master authorization.")
        return main_gdf

    base = main_gdf[main_gdf["cntr_code"].astype(str).str.upper() != "FR"].copy()
    print(f"  [Holistic] Features after removing FR: {len(base)}")

    fr_gdf = _source_arrondissement_layer()
    fr_gdf = fr_gdf[["id", "name", "cntr_code", "geometry"]].copy()

    combined = pd.concat([base, fr_gdf], ignore_index=True)
    return gpd.GeoDataFrame(combined, crs=main_gdf.crs)
