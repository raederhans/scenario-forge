"""Shared geometry utilities for the map pipeline."""
from __future__ import annotations

from typing import Iterable

import geopandas as gpd
from shapely.geometry import Point, box
from shapely.ops import transform
from topojson import Topology

from map_builder import config as cfg


def ensure_crs(gdf: gpd.GeoDataFrame, epsg: int = 4326) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        gdf = gdf.set_crs(f"EPSG:{epsg}", allow_override=True)
    elif gdf.crs.to_epsg() != epsg:
        gdf = gdf.to_crs(f"EPSG:{epsg}")
    return gdf


def pick_column(df: gpd.GeoDataFrame, candidates: Iterable[str]) -> str | None:
    for col in candidates:
        if col in df.columns:
            return col
    return None


def round_geometries(gdf: gpd.GeoDataFrame, precision: int = 4) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf

    def _rounder(x, y, z=None):
        rx = round(x, precision)
        ry = round(y, precision)
        if z is None:
            return (rx, ry)
        return (rx, ry, round(z, precision))

    gdf = gdf.copy()
    gdf["geometry"] = gdf.geometry.apply(
        lambda geom: transform(_rounder, geom) if geom is not None else geom
    )
    return gdf


def build_named_topology(
    layers: Iterable[tuple[str, gpd.GeoDataFrame]],
) -> dict:
    layer_names: list[str] = []
    layer_gdfs: list[gpd.GeoDataFrame] = []
    for layer_name, layer_gdf in layers:
        layer_names.append(layer_name)
        layer_gdfs.append(layer_gdf)
    topology = Topology(
        layer_gdfs,
        object_name=layer_names,
        topology=True,
        prequantize=False,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    )
    return topology.to_dict()


def clip_to_map_bounds(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    minx, miny, maxx, maxy = cfg.GLOBAL_BOUNDS
    bbox_geom = box(minx, miny, maxx, maxy)
    try:
        gdf = gdf.to_crs("EPSG:4326")
        clipped = gpd.clip(gdf, bbox_geom)
        if clipped.empty:
            print(f"Map bounds clip produced empty result for {label}; keeping original.")
            return gdf
        return clipped
    except Exception:
        print(f"Map bounds clip failed for {label}, attempting to fix geometries...")
        try:
            if hasattr(gdf.geometry, "make_valid"):
                gdf = gdf.set_geometry(gdf.geometry.make_valid())
            else:
                gdf = gdf.set_geometry(gdf.geometry.buffer(0))
            clipped = gpd.clip(gdf, bbox_geom)
        except Exception as fix_exc:
            print(f"Map bounds clip skipped for {label}: {fix_exc}")
            return gdf
        if clipped.empty:
            print(f"Map bounds clip produced empty result for {label}; keeping original.")
            return gdf
        return clipped


def clip_to_europe_bounds(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    """Backward-compatible alias. Use clip_to_map_bounds for global pipeline."""
    return clip_to_map_bounds(gdf, label)


def smart_island_cull(
    gdf: gpd.GeoDataFrame,
    group_col: str,
    threshold_km2: float = cfg.MIN_VISIBLE_AREA_KM2,
) -> gpd.GeoDataFrame:
    if gdf.empty or "geometry" not in gdf.columns:
        return gdf

    exploded = gdf.explode(index_parts=False, ignore_index=True)
    if exploded.empty:
        return gdf

    exploded = exploded.copy()
    exploded["__row_id"] = exploded.index
    try:
        projected = exploded.to_crs(cfg.AREA_CRS)
        exploded["area_km2"] = projected.geometry.area / 1_000_000.0
    except Exception as exc:
        print(f"Smart cull area calc failed, keeping original: {exc}")
        return gdf

    vip_points = [Point(lon, lat) for _, (lon, lat) in cfg.VIP_POINTS]
    try:
        exploded_ll = exploded.to_crs("EPSG:4326")
        exploded["vip_keep"] = exploded_ll.geometry.apply(
            lambda geom: any(geom.intersects(pt) for pt in vip_points)
            if geom is not None
            else False
        )
    except Exception as exc:
        print(f"Smart cull VIP check failed, continuing without whitelist: {exc}")
        exploded["vip_keep"] = False

    if group_col in exploded.columns:
        exploded["largest_keep"] = (
            exploded.groupby(group_col)["area_km2"].transform("max")
            == exploded["area_km2"]
        )
    else:
        exploded["largest_keep"] = False

    exploded["keep"] = (
        exploded["largest_keep"]
        | exploded["vip_keep"]
        | (exploded["area_km2"] >= threshold_km2)
    )

    filtered = exploded.loc[exploded["keep"]].copy()
    if filtered.empty:
        print("Smart cull removed all geometries; keeping original.")
        return gdf

    helper_cols = ["__row_id", "area_km2", "vip_keep", "largest_keep", "keep"]
    filtered = filtered.drop(columns=[col for col in helper_cols if col in filtered.columns])

    if group_col in filtered.columns:
        aggfunc = {
            col: "first"
            for col in filtered.columns
            if col not in ("geometry", group_col)
        }
        dissolved = filtered.dissolve(by=group_col, aggfunc=aggfunc)
        dissolved = dissolved.reset_index()
        dissolved = dissolved.set_crs(gdf.crs)
        return dissolved

    return filtered.reset_index(drop=True)
