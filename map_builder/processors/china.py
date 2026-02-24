"""China replacement processor."""
from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd

from map_builder import config as cfg
from map_builder.geo.utils import clip_to_map_bounds
from map_builder.io.fetch import fetch_or_load_geojson


def apply_china_replacement(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "cntr_code" not in main_gdf.columns:
        print("[China] cntr_code missing; skipping China replacement.")
        return main_gdf

    base = main_gdf[main_gdf["cntr_code"].astype(str).str.upper() != "CN"].copy()

    print("Downloading China ADM2 (geoBoundaries)...")
    cn_gdf = fetch_or_load_geojson(
        cfg.CHINA_CITY_URL,
        cfg.CHINA_ADM2_FILENAME,
        fallback_urls=cfg.CHINA_CITY_FALLBACK_URLS,
    )

    if cn_gdf.empty:
        print("China city GeoDataFrame is empty.")
        raise SystemExit(1)

    print(f"   [Debug] China Columns: {cn_gdf.columns.tolist()}")
    if not cn_gdf.empty:
        sample = cn_gdf.iloc[0].drop(labels=["geometry"], errors="ignore").to_dict()
        print(f"   [Debug] First row sample: {json.dumps(sample, ensure_ascii=True)}")

    cn_gdf = cn_gdf.copy()
    try:
        cn_gdf["geometry"] = cn_gdf.geometry.make_valid()
    except Exception as exc:
        print(f"   [China] make_valid failed; continuing without: {exc}")

    if cn_gdf.crs is None:
        cn_gdf = cn_gdf.set_crs("EPSG:4326", allow_override=True)
    if cn_gdf.crs.to_epsg() != 4326:
        cn_gdf = cn_gdf.to_crs("EPSG:4326")

    id_candidates = [
        "shapeID",
        "shapeISO",
        "shape_id",
        "shape_iso",
        "ID",
        "id",
        "City_Adcode",
        "city_adcode",
        "ADCODE",
        "adcode",
    ]
    name_candidates = [
        "shapeName",
        "shape_name",
        "NAME",
        "name",
        "City_Name",
        "city_name",
    ]
    id_col = next((c for c in id_candidates if c in cn_gdf.columns), None)
    name_col = next((c for c in name_candidates if c in cn_gdf.columns), None)
    if not id_col or not name_col:
        raise ValueError(
            "China dataset missing expected columns. "
            f"Available: {cn_gdf.columns.tolist()}"
        )

    cn_gdf = cn_gdf[cn_gdf.geometry.notna() & ~cn_gdf.geometry.is_empty].copy()
    cn_gdf = clip_to_map_bounds(cn_gdf, "china city")

    # Drop oversized artifacts using projected area (km^2), not square degrees.
    cn_gdf["temp_area_km2"] = cn_gdf.to_crs(cfg.AREA_CRS).geometry.area / 1_000_000.0
    before_count = len(cn_gdf)
    cn_gdf = cn_gdf[cn_gdf["temp_area_km2"] < 600_000.0].copy()
    after_count = len(cn_gdf)
    print(f"   [China Clean] Dropped {before_count - after_count} oversized artifact(s).")
    cn_gdf = cn_gdf.drop(columns=["temp_area_km2"])

    try:
        cn_gdf["geometry"] = cn_gdf.geometry.make_valid()
    except Exception as exc:
        print(f"   [China] make_valid failed before simplify; continuing: {exc}")

    # Aggressive simplification for geoBoundaries (high-res) to avoid huge files.
    cn_gdf["geometry"] = cn_gdf.geometry.simplify(
        tolerance=cfg.SIMPLIFY_CHINA, preserve_topology=True
    )
    cn_gdf["id"] = "CN_CITY_" + cn_gdf[id_col].astype(str)
    cn_gdf["name"] = cn_gdf[name_col].astype(str)
    cn_gdf["name"] = cn_gdf["name"].str.replace("shi", "", regex=False).str.strip()
    cn_gdf["cntr_code"] = "CN"
    cn_gdf = cn_gdf[["id", "name", "cntr_code", "geometry"]].copy()

    combined = pd.concat([base, cn_gdf], ignore_index=True)
    print(f"[China] Replacement: Loaded {len(cn_gdf)} city regions.")
    return gpd.GeoDataFrame(combined, crs=main_gdf.crs)
