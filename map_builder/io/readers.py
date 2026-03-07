"""File readers and helpers for map pipeline."""
from __future__ import annotations

import geopandas as gpd

from map_builder import config as cfg
from map_builder.geo.utils import clip_to_map_bounds, pick_column
from map_builder.io.fetch import fetch_ne_zip


def load_natural_earth_admin0(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Normalize an admin0 layer for ISO A2 lookups (CRS WGS84)."""
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def load_rivers() -> gpd.GeoDataFrame:
    gdf = fetch_ne_zip(cfg.RIVERS_URL, "rivers")
    return clip_to_map_bounds(gdf, "rivers")


def load_urban() -> gpd.GeoDataFrame:
    gdf = fetch_ne_zip(cfg.URBAN_URL, "urban")
    return clip_to_map_bounds(gdf, "urban")


def load_physical() -> gpd.GeoDataFrame:
    gdf = fetch_ne_zip(cfg.PHYSICAL_URL, "physical")
    feature_col = pick_column(gdf, ["featurecla", "FEATURECLA", "feature_cla"])
    if feature_col:
        keep_types = set(cfg.PHYSICAL_CONTEXT_FEATURE_TYPES)
        gdf = gdf[gdf[feature_col].isin(keep_types)].copy()
        if feature_col != "featurecla":
            gdf = gdf.rename(columns={feature_col: "featurecla"})
    else:
        print("[Physical] featurecla missing; keeping all features.")
    return clip_to_map_bounds(gdf, "physical")
