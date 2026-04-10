"""Build derived physical atlas semantics and terrain contours."""
from __future__ import annotations

import hashlib
import math
import os
import re
from pathlib import Path

import contourpy
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.enums import Resampling
from rasterio.features import shapes
from rasterio.transform import from_bounds
from shapely.geometry import LineString, shape

from map_builder import config as cfg
from map_builder.geo.topology import build_named_layer_topology
from map_builder.geo.utils import pick_column
from map_builder.io.fetch import fetch_or_cache_binary


EQUAL_AREA_CRS = "EPSG:6933"


def _slugify_fragment(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_") or "unknown"


def _stable_geometry_fragment(geometry) -> str:
    if geometry is None or geometry.is_empty:
        return "empty"
    digest = hashlib.sha1(geometry.wkb).hexdigest()
    return digest[:12]


def _finalize_semantic_components(
    gdf: gpd.GeoDataFrame,
    *,
    id_prefix: str,
) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )

    prepared = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    if prepared.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=gdf.crs or "EPSG:4326",
        )

    if hasattr(prepared.geometry, "make_valid"):
        prepared["geometry"] = prepared.geometry.make_valid()
    else:
        prepared["geometry"] = prepared.geometry.buffer(0)
    prepared = prepared[prepared.geometry.notna() & ~prepared.geometry.is_empty].copy()
    prepared = prepared.explode(index_parts=False, ignore_index=True)
    prepared = prepared[prepared.geometry.notna() & ~prepared.geometry.is_empty].copy()
    prepared = prepared[prepared.geometry.geom_type.isin({"Polygon", "MultiPolygon"})].copy()
    prepared["geometry"] = prepared.geometry.simplify(
        tolerance=float(cfg.PHYSICAL_SEMANTIC_SIMPLIFY_DEGREES),
        preserve_topology=True,
    )
    prepared = prepared[prepared.geometry.notna() & ~prepared.geometry.is_empty].copy()
    prepared = prepared[prepared.geometry.geom_type.isin({"Polygon", "MultiPolygon"})].copy()
    if prepared.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=gdf.crs or "EPSG:4326",
        )

    metric = prepared.to_crs(EQUAL_AREA_CRS)
    areas_sqkm = metric.geometry.area / 1_000_000.0
    min_area = float(cfg.PHYSICAL_SEMANTIC_COMPONENT_MIN_AREA_KM2)
    thresholds = prepared["atlas_class"].map(
        lambda atlas_class: max(
            min_area,
            float(cfg.PHYSICAL_RAINFOREST_MIN_AREA_KM2)
            if str(atlas_class or "").strip().lower() == "rainforest_tropical"
            else float(cfg.PHYSICAL_GRASSLAND_STEPPE_MIN_AREA_KM2)
            if str(atlas_class or "").strip().lower() == "grassland_steppe"
            else min_area,
        )
    )
    prepared = prepared.loc[(areas_sqkm >= thresholds).values].copy()
    if prepared.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=gdf.crs or "EPSG:4326",
        )

    prepared = prepared.sort_values(["atlas_layer", "atlas_class"], kind="stable").reset_index(drop=True)
    prepared["id"] = [
        f"{id_prefix}_{_slugify_fragment(atlas_class)}_{_stable_geometry_fragment(geometry)}"
        for atlas_class, geometry in zip(prepared["atlas_class"], prepared.geometry, strict=False)
    ]
    return prepared[["id", "atlas_class", "atlas_layer", "source", "geometry"]].copy()


def _resolve_raster_source(
    *,
    url: str,
    filename: str,
    min_size_bytes: int,
) -> str:
    mode = str(os.environ.get("MAPCREATOR_CONTEXT_SOURCE_MODE", "cache")).strip().lower()
    if mode == "vsicurl":
        return f"/vsicurl/{url}"
    return str(
        fetch_or_cache_binary(
            url,
            filename,
            min_size_bytes=min_size_bytes,
        )
    )


def _classify_relief_base(physical_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if physical_gdf is None or physical_gdf.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )

    feature_col = pick_column(physical_gdf, ["featurecla", "FEATURECLA", "feature_cla"])
    if not feature_col:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=physical_gdf.crs or "EPSG:4326",
        )

    base = physical_gdf[[feature_col, "geometry"]].copy()
    base["atlas_class"] = base[feature_col].map(cfg.PHYSICAL_RELIEF_BASE_TYPES)
    base = base[base["atlas_class"].notna()].copy()
    if base.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=physical_gdf.crs or "EPSG:4326",
        )

    base["atlas_layer"] = "relief_base"
    base["source"] = "natural_earth_physical"
    return _finalize_semantic_components(base, id_prefix="atlas_relief")


def _classify_natural_earth_overlay(physical_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if physical_gdf is None or physical_gdf.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )

    feature_col = pick_column(physical_gdf, ["featurecla", "FEATURECLA", "feature_cla"])
    if not feature_col:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=physical_gdf.crs or "EPSG:4326",
        )

    overlay = physical_gdf[[feature_col, "geometry"]].copy()
    overlay["atlas_class"] = overlay[feature_col].map(cfg.PHYSICAL_NATURAL_EARTH_OVERLAY_TYPES)
    overlay = overlay[overlay["atlas_class"].notna()].copy()
    if overlay.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs=physical_gdf.crs or "EPSG:4326",
        )

    overlay["atlas_layer"] = "semantic_overlay"
    overlay["source"] = "natural_earth_physical"
    return _finalize_semantic_components(overlay, id_prefix="atlas_semantic_ne")


def _load_discrete_landcover_array() -> tuple[np.ndarray, rasterio.Affine]:
    cell_size = float(cfg.PHYSICAL_SEMANTIC_CELL_SIZE_DEGREES)
    width = int(round(360.0 / cell_size))
    height = int(round(180.0 / cell_size))
    source = _resolve_raster_source(
        url=cfg.CGLS_LC100_2019_DISCRETE_URL,
        filename=cfg.CGLS_LC100_2019_DISCRETE_FILENAME,
        min_size_bytes=50_000_000,
    )

    with rasterio.open(source) as dataset:
        array = dataset.read(
            1,
            out_shape=(height, width),
            resampling=Resampling.mode,
        )
        transform = from_bounds(*dataset.bounds, width=width, height=height)

    return array.astype(np.int16, copy=False), transform


def _load_forest_type_array() -> tuple[np.ndarray, rasterio.Affine]:
    cell_size = float(cfg.PHYSICAL_SEMANTIC_CELL_SIZE_DEGREES)
    width = int(round(360.0 / cell_size))
    height = int(round(180.0 / cell_size))
    source = _resolve_raster_source(
        url=cfg.CGLS_LC100_2019_FOREST_TYPE_URL,
        filename=cfg.CGLS_LC100_2019_FOREST_TYPE_FILENAME,
        min_size_bytes=50_000_000,
    )

    with rasterio.open(source) as dataset:
        array = dataset.read(
            1,
            out_shape=(height, width),
            resampling=Resampling.mode,
        )
        transform = from_bounds(*dataset.bounds, width=width, height=height)

    return array.astype(np.int16, copy=False), transform


def _build_semantic_code_grid(discrete_landcover: np.ndarray, transform) -> np.ndarray:
    height, width = discrete_landcover.shape
    semantic_codes = np.zeros((height, width), dtype=np.uint8)

    forest_mask = np.isin(discrete_landcover, list(cfg.CGLS_FOREST_CLASS_CODES))
    rainforest_mask = np.isin(discrete_landcover, list(cfg.CGLS_RAINFOREST_CLASS_CODES))
    grassland_mask = np.isin(discrete_landcover, list(cfg.CGLS_GRASSLAND_STEPPE_CLASS_CODES))
    desert_mask = np.isin(discrete_landcover, list(cfg.CGLS_DESERT_CLASS_CODES))
    tundra_mask = np.isin(discrete_landcover, list(cfg.CGLS_TUNDRA_ICE_CLASS_CODES))

    row_indices = np.arange(height)
    lat_centers = transform.f + (row_indices + 0.5) * transform.e
    rainforest_band = np.abs(lat_centers) <= float(cfg.PHYSICAL_RAINFOREST_MAX_ABS_LAT)
    rainforest_mask &= rainforest_band[:, None]

    semantic_codes[forest_mask] = 1
    semantic_codes[grassland_mask] = 2
    semantic_codes[desert_mask] = 3
    semantic_codes[tundra_mask] = 4
    semantic_codes[rainforest_mask] = 5
    return semantic_codes


def _build_forest_semantic_code_grid(forest_type: np.ndarray, transform) -> np.ndarray:
    height, width = forest_type.shape
    semantic_codes = np.zeros((height, width), dtype=np.uint8)

    forest_mask = np.isin(forest_type, list(cfg.CGLS_FOREST_TYPE_CODES))
    rainforest_mask = np.isin(forest_type, list(cfg.CGLS_RAINFOREST_FOREST_TYPE_CODES))

    row_indices = np.arange(height)
    lat_centers = transform.f + (row_indices + 0.5) * transform.e
    rainforest_band = np.abs(lat_centers) <= float(cfg.PHYSICAL_RAINFOREST_MAX_ABS_LAT)
    rainforest_mask &= rainforest_band[:, None]

    semantic_codes[forest_mask] = 1
    semantic_codes[rainforest_mask] = 5
    return semantic_codes


def _polygonize_semantic_grid(code_grid: np.ndarray, transform) -> gpd.GeoDataFrame:
    class_map = {
        1: "forest_temperate",
        2: "grassland_steppe",
        3: "desert_bare",
        4: "tundra_ice",
        5: "rainforest_tropical",
    }
    records: list[dict] = []
    for geometry, value in shapes(code_grid, mask=code_grid > 0, transform=transform):
        code = int(value)
        atlas_class = class_map.get(code)
        if not atlas_class:
            continue
        records.append(
            {
                "atlas_class": atlas_class,
                "atlas_layer": "semantic_overlay",
                "source": "cgls_lc100_2019",
                "geometry": shape(geometry),
            }
        )

    if not records:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )

    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    return _finalize_semantic_components(gdf, id_prefix="atlas_semantic_lc100")


def build_physical_semantics(physical_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    relief = _classify_relief_base(physical_gdf)
    fallback_overlays = _classify_natural_earth_overlay(physical_gdf)
    skip_landcover = str(os.environ.get("MAPCREATOR_CONTEXT_SKIP_LANDCOVER", "")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    try:
        if skip_landcover:
            raise RuntimeError("MAPCREATOR_CONTEXT_SKIP_LANDCOVER enabled")
        discrete_landcover, transform = _load_discrete_landcover_array()
        semantic_codes = _build_semantic_code_grid(discrete_landcover, transform)
        forest_overlays = _polygonize_semantic_grid(semantic_codes, transform)
        if fallback_overlays.empty:
            overlays = forest_overlays
        elif forest_overlays.empty:
            overlays = fallback_overlays
        else:
            overlays = gpd.GeoDataFrame(
                pd.concat([forest_overlays, fallback_overlays], ignore_index=True),
                geometry="geometry",
                crs="EPSG:4326",
            )
    except Exception as exc:
        print(
            "[Physical Context] Landcover semantic overlay unavailable; "
            f"using Natural Earth semantic fallback: {exc}"
        )
        overlays = fallback_overlays
    if relief.empty and overlays.empty:
        return gpd.GeoDataFrame(
            columns=["id", "atlas_class", "atlas_layer", "source", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )
    return gpd.GeoDataFrame(
        pd.concat([relief, overlays], ignore_index=True),
        geometry="geometry",
        crs="EPSG:4326",
    )


def _load_contour_dem_array() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    step = float(cfg.CONTOUR_PROCESSING_STEP_DEGREES)
    width = int(round(360.0 / step))
    height = int(round(180.0 / step))
    source = _resolve_raster_source(
        url=cfg.ETOPO_2022_SURFACE_URL,
        filename=cfg.ETOPO_2022_SURFACE_FILENAME,
        min_size_bytes=50_000_000,
    )

    with rasterio.open(source) as dataset:
        dem = dataset.read(
            1,
            out_shape=(height, width),
            resampling=Resampling.bilinear,
        ).astype(np.float32, copy=False)
        bounds = dataset.bounds

    dem = np.where(np.isfinite(dem), dem, np.nan)
    dem = np.where(dem > 0, dem, np.nan)

    x = np.linspace(bounds.left + step / 2.0, bounds.right - step / 2.0, width)
    y = np.linspace(bounds.bottom + step / 2.0, bounds.top - step / 2.0, height)
    return np.flipud(dem), x, y


def _build_contour_gdf(
    dem: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    *,
    interval_m: int,
    exclude_major_interval_m: int | None,
    simplify_tolerance: float,
    id_prefix: str,
) -> gpd.GeoDataFrame:
    max_elevation = int(math.floor(float(np.nanmax(dem)) / interval_m) * interval_m)
    levels = np.arange(interval_m, max_elevation + interval_m, interval_m, dtype=np.int32)
    if exclude_major_interval_m:
        levels = levels[levels % int(exclude_major_interval_m) != 0]
    if levels.size == 0:
        return gpd.GeoDataFrame(
            columns=["id", "elevation_m", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )

    generator = contourpy.contour_generator(
        x=x,
        y=y,
        z=dem,
        name="serial",
    )

    records: list[dict] = []
    feature_index = 0
    for level in levels.tolist():
        for line in generator.lines(level):
            if len(line) < 2:
                continue
            geometry = LineString(line)
            if geometry.is_empty or not geometry.is_valid:
                continue
            if geometry.length < float(cfg.CONTOUR_MIN_LENGTH_DEGREES):
                continue
            geometry = geometry.simplify(simplify_tolerance, preserve_topology=False)
            if geometry.is_empty or geometry.length < float(cfg.CONTOUR_MIN_LENGTH_DEGREES):
                continue
            records.append(
                {
                    "id": f"{id_prefix}_{level}_{feature_index}",
                    "elevation_m": int(level),
                    "geometry": geometry,
                }
            )
            feature_index += 1

    if not records:
        return gpd.GeoDataFrame(
            columns=["id", "elevation_m", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )
    return gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")


def build_contour_layers() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    dem, x, y = _load_contour_dem_array()
    major = _build_contour_gdf(
        dem,
        x,
        y,
        interval_m=int(cfg.CONTOUR_MAJOR_INTERVAL_M),
        exclude_major_interval_m=None,
        simplify_tolerance=float(cfg.CONTOUR_MAJOR_SIMPLIFY_DEGREES),
        id_prefix="contour_major",
    )
    minor = _build_contour_gdf(
        dem,
        x,
        y,
        interval_m=int(cfg.CONTOUR_MINOR_INTERVAL_M),
        exclude_major_interval_m=int(cfg.CONTOUR_MAJOR_INTERVAL_M),
        simplify_tolerance=float(cfg.CONTOUR_MINOR_SIMPLIFY_DEGREES),
        id_prefix="contour_minor",
    )
    return major, minor


def _require_non_empty_contour_layers(
    contour_major: gpd.GeoDataFrame,
    contour_minor: gpd.GeoDataFrame,
) -> None:
    missing_layers: list[str] = []
    if contour_major is None or contour_major.empty:
        missing_layers.append("major")
    if contour_minor is None or contour_minor.empty:
        missing_layers.append("minor")
    if missing_layers:
        missing = ", ".join(missing_layers)
        raise RuntimeError(
            "[Physical Context] Contour generation produced empty contour layer(s): "
            f"{missing}. Refusing to write empty contour topology."
        )


def build_and_save_physical_context_layers(
    physical_gdf: gpd.GeoDataFrame,
    output_dir: Path,
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, gpd.GeoDataFrame]:
    semantics = build_physical_semantics(physical_gdf)
    contour_major, contour_minor = build_contour_layers()
    _require_non_empty_contour_layers(contour_major, contour_minor)

    build_named_layer_topology(
        semantics,
        output_dir / cfg.PHYSICAL_SEMANTICS_TOPO_FILENAME,
        object_name="physical_semantics",
    )
    build_named_layer_topology(
        contour_major,
        output_dir / cfg.PHYSICAL_CONTOUR_MAJOR_TOPO_FILENAME,
        object_name="contours",
    )
    build_named_layer_topology(
        contour_minor,
        output_dir / cfg.PHYSICAL_CONTOUR_MINOR_TOPO_FILENAME,
        object_name="contours",
    )

    return semantics, contour_major, contour_minor
