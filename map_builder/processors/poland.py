"""Poland replacement processor."""
from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd

from map_builder import config as cfg
from map_builder.io.fetch import fetch_or_load_geojson


def apply_poland_replacement(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "cntr_code" not in main_gdf.columns:
        print("[Poland] cntr_code missing; skipping Poland replacement.")
        return main_gdf

    base = main_gdf[main_gdf["cntr_code"].astype(str).str.upper() != "PL"].copy()

    print("Downloading Poland powiaty...")
    pl_gdf = fetch_or_load_geojson(
        cfg.PL_POWIATY_URL,
        cfg.PL_POWIATY_FILENAME,
        fallback_urls=cfg.PL_POWIATY_FALLBACK_URLS,
    )

    if pl_gdf.empty:
        print("Powiaty GeoDataFrame is empty.")
        raise SystemExit(1)

    print(f"   [Debug] Poland Columns: {pl_gdf.columns.tolist()}")
    if not pl_gdf.empty:
        sample = pl_gdf.iloc[0].drop(labels=["geometry"], errors="ignore").to_dict()
        print(f"   [Debug] First row sample: {json.dumps(sample, ensure_ascii=True)}")

    pl_gdf = pl_gdf.copy()
    try:
        pl_gdf["geometry"] = pl_gdf.geometry.make_valid()
    except Exception as exc:
        print(f"   [Poland] make_valid failed; continuing without: {exc}")

    if pl_gdf.crs is None:
        pl_gdf = pl_gdf.set_crs("EPSG:4326", allow_override=True)
    if pl_gdf.crs.to_epsg() != 4326:
        pl_gdf = pl_gdf.to_crs("EPSG:4326")

    # Guard against datasets with bogus CRS or empty/invalid geometries.
    pl_gdf = pl_gdf[~pl_gdf.is_empty].copy()
    pl_gdf = pl_gdf[pl_gdf.geometry.notna()].copy()
    pl_gdf = pl_gdf[pl_gdf.geometry.is_valid].copy()

    if "terc" not in pl_gdf.columns or "name" not in pl_gdf.columns:
        raise ValueError(
            "Poland counties dataset missing expected columns: terc/name. "
            f"Available: {pl_gdf.columns.tolist()}"
        )

    pl_gdf["id"] = "PL_POW_" + pl_gdf["terc"].astype(str)
    pl_gdf["name"] = pl_gdf["name"].astype(str)
    pl_gdf["cntr_code"] = "PL"
    # Drop oversized artifacts using projected area (km^2), not square degrees.
    pl_gdf["temp_area_km2"] = pl_gdf.to_crs(cfg.AREA_CRS).geometry.area / 1_000_000.0
    before_count = len(pl_gdf)
    pl_gdf = pl_gdf[pl_gdf["temp_area_km2"] < 25_000.0].copy()
    after_count = len(pl_gdf)
    print(f"   [Poland Clean] Removed {before_count - after_count} oversized artifact(s).")
    pl_gdf = pl_gdf.drop(columns=["temp_area_km2"])
    pl_gdf = pl_gdf[["id", "name", "cntr_code", "geometry"]].copy()
    pl_gdf["geometry"] = pl_gdf.geometry.simplify(
        tolerance=cfg.SIMPLIFY_NUTS3, preserve_topology=True
    )

    combined = pd.concat([base, pl_gdf], ignore_index=True)
    print(f"[Poland] Replacement: Loaded {len(pl_gdf)} counties (Goal: ~380).")
    return gpd.GeoDataFrame(combined, crs=main_gdf.crs)
