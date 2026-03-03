"""Initialize and prepare NUTS-3 map data for Map Creator."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import subprocess
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


try:
    from importlib import util as importlib_util
except Exception:  # pragma: no cover - fallback if importlib is shadowed
    import pkgutil

    def find_spec(name: str):
        return pkgutil.find_loader(name)
else:

    def find_spec(name: str):
        return importlib_util.find_spec(name)


def ensure_packages(packages: Iterable[str]) -> None:
    missing = []
    for name in packages:
        if find_spec(name) is None:
            missing.append(name)
    if not missing:
        return

    print(f"Installing missing packages: {', '.join(missing)}")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing])
    except subprocess.CalledProcessError as exc:
        print("Failed to install required packages.")
        raise SystemExit(exc.returncode) from exc


def _peek_requested_mode(argv: list[str]) -> str:
    for index, arg in enumerate(argv):
        if arg == "--mode" and index + 1 < len(argv):
            return str(argv[index + 1]).strip().lower()
        if arg.startswith("--mode="):
            return str(arg.split("=", 1)[1]).strip().lower()
    return "all"


REQUESTED_MODE = _peek_requested_mode(sys.argv[1:])

if REQUESTED_MODE != "palettes":
    ensure_packages(["geopandas", "matplotlib", "mapclassify", "requests", "shapely", "topojson"])

    import geopandas as gpd
    import pandas as pd
    import requests
    from shapely.geometry import box
else:  # pragma: no cover - palettes mode does not touch GIS stack
    gpd = None
    pd = None
    requests = None
    box = None

from map_builder import config as cfg

if REQUESTED_MODE != "palettes":
    from map_builder.geo.topology import build_topology
    from map_builder.geo.utils import (
        clip_to_map_bounds,
        pick_column,
        smart_island_cull,
    )
    from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_geojson
    from map_builder.io.readers import load_physical, load_rivers, load_urban
    from map_builder.processors.admin1 import build_extension_admin1, extract_country_code
    from map_builder.processors.china import apply_china_replacement
    from map_builder.processors.france import apply_holistic_replacements
    from map_builder.processors.north_america import apply_north_america_replacement
    from map_builder.processors.poland import apply_poland_replacement
    from map_builder.processors.russia_ukraine import apply_russia_ukraine_replacement
    from map_builder.processors.south_asia import apply_south_asia_replacement
    from map_builder.processors.special_zones import build_special_zones
    from map_builder.outputs.save import save_outputs
    from tools import generate_hierarchy, geo_key_normalizer, translate_manager
else:  # pragma: no cover - palettes mode avoids GIS/runtime build imports
    build_topology = None
    clip_to_map_bounds = None
    pick_column = None
    smart_island_cull = None
    fetch_ne_zip = None
    fetch_or_load_geojson = None
    load_physical = None
    load_rivers = None
    load_urban = None
    build_extension_admin1 = None
    extract_country_code = None
    apply_china_replacement = None
    apply_holistic_replacements = None
    apply_north_america_replacement = None
    apply_poland_replacement = None
    apply_russia_ukraine_replacement = None
    apply_south_asia_replacement = None
    build_special_zones = None
    save_outputs = None
    generate_hierarchy = None
    geo_key_normalizer = None
    translate_manager = None

PROJECT_ROOT = Path(__file__).resolve().parent
D3_VENDOR_PATH = PROJECT_ROOT / 'vendor' / 'd3.v7.min.js'
TOPOJSON_VENDOR_PATH = PROJECT_ROOT / 'vendor' / 'topojson-client.min.js'

GLOBAL_OCEAN_MIN_BBOX_WIDTH = 220.0
GLOBAL_OCEAN_MIN_BBOX_HEIGHT = 90.0
ALLOWED_SENTINEL_FEATURE_IDS = {
    "GAZ+00?",
    "WEB+00?",
    "RUS+99?",
    "CO_ADM1_COL+99?",
    "VE_ADM1_VEN+99?",
}


def cull_small_geometries(
    gdf: gpd.GeoDataFrame,
    label: str,
    group_col: str | None = None,
    threshold_km2: float = cfg.MIN_VISIBLE_AREA_KM2,
) -> gpd.GeoDataFrame:
    """Cull tiny polygon fragments using a consistent global area threshold."""
    if gdf is None or gdf.empty or "geometry" not in gdf.columns:
        return gdf

    geom_types = set(gdf.geometry.geom_type.dropna().unique())
    has_polygonal = any(
        ("Polygon" in geom_type) or (geom_type == "GeometryCollection")
        for geom_type in geom_types
    )
    if not has_polygonal:
        return gdf

    before = len(gdf)
    cull_group = group_col if group_col and group_col in gdf.columns else "__missing_group__"
    culled = smart_island_cull(
        gdf,
        group_col=cull_group,
        threshold_km2=threshold_km2,
    )
    removed = before - len(culled)
    if removed > 0:
        print(
            f"[Cull] {label}: removed {removed} geometries below {threshold_km2:.1f} km^2 threshold."
        )
    return culled


def _bounds_to_tuple(bounds: Iterable[float]) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = bounds
    return (float(minx), float(miny), float(maxx), float(maxy))


def _compute_bbox_metrics(
    gdf: gpd.GeoDataFrame,
    target_bounds: Iterable[float],
) -> tuple[float, float, float]:
    if gdf is None or gdf.empty:
        return 0.0, 0.0, 0.0
    try:
        gdf = gdf.to_crs("EPSG:4326")
        minx, miny, maxx, maxy = map(float, gdf.total_bounds)
    except Exception:
        return 0.0, 0.0, 0.0

    width = max(0.0, maxx - minx)
    height = max(0.0, maxy - miny)
    tminx, tminy, tmaxx, tmaxy = _bounds_to_tuple(target_bounds)
    full_area = max((tmaxx - tminx) * (tmaxy - tminy), 1e-9)
    ratio = min(1.0, max(0.0, (width * height) / full_area))
    return width, height, ratio


def _build_ocean_fallback_from_land(
    land_gdf: gpd.GeoDataFrame,
    target_bounds: Iterable[float],
) -> gpd.GeoDataFrame:
    tminx, tminy, tmaxx, tmaxy = _bounds_to_tuple(target_bounds)
    world_box = box(tminx, tminy, tmaxx, tmaxy)

    land_ll = land_gdf.to_crs("EPSG:4326").copy()
    land_ll = land_ll[land_ll.geometry.notna() & ~land_ll.geometry.is_empty].copy()
    if land_ll.empty:
        return gpd.GeoDataFrame(geometry=[world_box], crs="EPSG:4326")

    try:
        land_union = land_ll.geometry.unary_union
        ocean_geom = world_box.difference(land_union)
    except Exception as exc:
        print(f"[Ocean Coverage] Land-difference fallback failed; using world bbox ocean: {exc}")
        ocean_geom = world_box

    fallback = gpd.GeoDataFrame(geometry=[ocean_geom], crs="EPSG:4326")
    fallback = fallback.explode(index_parts=False, ignore_index=True)
    fallback = fallback[fallback.geometry.notna() & ~fallback.geometry.is_empty].copy()
    fallback = fallback[fallback.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if fallback.empty:
        fallback = gpd.GeoDataFrame(geometry=[world_box], crs="EPSG:4326")
    return fallback


def ensure_ocean_coverage(
    ocean_gdf: gpd.GeoDataFrame,
    land_bg_gdf: gpd.GeoDataFrame,
    target_bounds: Iterable[float] | None = None,
    stage_label: str = "unknown",
) -> gpd.GeoDataFrame:
    bounds = target_bounds or getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS)
    bminx, bminy, bmaxx, bmaxy = _bounds_to_tuple(bounds)
    bounds_width = max(0.0, bmaxx - bminx)
    bounds_height = max(0.0, bmaxy - bminy)
    global_like = bounds_width >= 340 and bounds_height >= 150

    min_width = GLOBAL_OCEAN_MIN_BBOX_WIDTH if global_like else bounds_width * (220.0 / 360.0)
    min_height = GLOBAL_OCEAN_MIN_BBOX_HEIGHT if global_like else bounds_height * 0.5

    width, height, ratio = _compute_bbox_metrics(ocean_gdf, bounds)
    print(
        f"[Ocean Coverage:{stage_label}] bbox width={width:.2f}°, height={height:.2f}°, "
        f"coverage={ratio:.3f}, threshold width>={min_width:.2f}°, height>={min_height:.2f}°"
    )

    if width >= min_width and height >= min_height:
        return ocean_gdf

    print(
        f"[Ocean Coverage:{stage_label}] Ocean layer under-covered; "
        "forcing world_bbox - land_union fallback."
    )
    fallback = _build_ocean_fallback_from_land(land_bg_gdf, bounds)
    f_width, f_height, f_ratio = _compute_bbox_metrics(fallback, bounds)
    print(
        f"[Ocean Coverage:{stage_label}] Fallback bbox width={f_width:.2f}°, "
        f"height={f_height:.2f}°, coverage={f_ratio:.3f}"
    )
    return fallback


def log_layer_coverage(layer_name: str, gdf: gpd.GeoDataFrame, bounds: Iterable[float]) -> None:
    width, height, ratio = _compute_bbox_metrics(gdf, bounds)
    count = 0 if gdf is None else len(gdf)
    print(
        f"[Layer Coverage] {layer_name}: features={count}, "
        f"bbox width={width:.2f}°, height={height:.2f}°, ratio={ratio:.4f}"
    )
    if count > 0 and ratio < 0.02:
        print(
            f"[Layer Coverage] WARNING {layer_name} coverage appears low (ratio={ratio:.4f}); "
            "fallback source may be required at runtime."
        )


def fetch_geojson(url: str) -> dict:
    print("Downloading GeoJSON...")
    try:
        response = requests.get(url, timeout=(10, 60))
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"Download failed: {exc}")
        raise SystemExit(1) from exc
    try:
        return response.json()
    except ValueError as exc:
        print("Failed to decode GeoJSON response.")
        raise SystemExit(1) from exc




def build_geodataframe(data: dict) -> gpd.GeoDataFrame:
    print("Parsing GeoJSON into GeoDataFrame...")
    gdf = gpd.GeoDataFrame.from_features(data.get("features", []))
    if gdf.empty:
        print("GeoDataFrame is empty. Check the downloaded data.")
        raise SystemExit(1)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def filter_countries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("Filtering global political features...")
    filtered = gdf.copy()
    iso_candidates = [
        "iso_a2",
        "ISO_A2",
        "iso_a2_eh",
        "ISO_A2_EH",
        "adm0_a2",
        "ADM0_A2",
        "iso_3166_1_",
        "ISO_3166_1_",
    ]
    iso_cols = [col for col in iso_candidates if col in filtered.columns]
    name_col = pick_column(filtered, ["ADMIN", "admin", "NAME", "name", "NAME_EN", "name_en"])

    if not iso_cols:
        print("Country filter failed: missing ISO A2 column.")
        raise SystemExit(1)

    # Resolve ISO per row: fallback across available A2 columns
    # (e.g. France has ISO_A2=-99 but ISO_A2_EH=FR in Natural Earth).
    iso_values = filtered[iso_cols].copy()
    for col in iso_cols:
        normalized = iso_values[col].fillna("").astype(str).str.upper().str.strip()
        normalized = normalized.where(normalized.str.match(r"^[A-Z]{2}$"), "")
        iso_values[col] = normalized.where(normalized != "-99", "")
    filtered["cntr_code"] = (
        iso_values.replace("", pd.NA).bfill(axis=1).iloc[:, 0].fillna("")
    )
    filtered = filtered[filtered["cntr_code"] != ""].copy()

    target_codes = set(getattr(cfg, "COUNTRIES", set()) or set())
    if target_codes:
        filtered = filtered[filtered["cntr_code"].isin(target_codes)].copy()

    blacklist = set(getattr(cfg, "MICRO_ISLAND_BLACKLIST", set()) or set())
    if blacklist:
        filtered = filtered[~filtered["cntr_code"].isin(blacklist)].copy()

    if name_col:
        filtered["name"] = filtered[name_col].fillna("").astype(str).str.strip()
    else:
        filtered["name"] = filtered["cntr_code"]
    filtered.loc[filtered["name"] == "", "name"] = filtered.loc[filtered["name"] == "", "cntr_code"]

    filtered["id"] = filtered["cntr_code"].astype(str)
    dup_ordinals = filtered.groupby("id").cumcount()
    dup_mask = dup_ordinals > 0
    if dup_mask.any():
        filtered.loc[dup_mask, "id"] = (
            filtered.loc[dup_mask, "id"] + "__" + dup_ordinals.loc[dup_mask].astype(str)
        )

    filtered = filtered[["id", "name", "cntr_code", "geometry"]].copy()
    filtered = filtered[filtered.geometry.notna() & ~filtered.geometry.is_empty].copy()

    if filtered.empty:
        print("Filtered GeoDataFrame is empty. Check configured countries and blacklist.")
        raise SystemExit(1)
    return gpd.GeoDataFrame(filtered, crs="EPSG:4326")


def validate_political_schema(gdf: gpd.GeoDataFrame, label: str = "Political Filter") -> None:
    if gdf is None or gdf.empty:
        raise SystemExit(f"{label}: dataset is empty.")
    if "id" not in gdf.columns or "cntr_code" not in gdf.columns:
        raise SystemExit(f"{label}: required columns 'id'/'cntr_code' are missing.")

    ids = gdf["id"].fillna("").astype(str).str.strip()
    codes = gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    empty_id_count = int((ids == "").sum())
    empty_code_count = int((codes == "").sum())
    duplicate_id_count = int(ids.duplicated().sum())
    unique_country_count = int(codes[codes != ""].nunique())
    deduped_id_count = int(ids.str.contains("__", regex=False).sum())

    print(
        f"[{label}] rows={len(gdf)}, countries={unique_country_count}, "
        f"deduped_ids={deduped_id_count}, duplicate_ids={duplicate_id_count}, "
        f"empty_id={empty_id_count}, empty_cntr_code={empty_code_count}"
    )

    if empty_id_count > 0:
        raise SystemExit(f"{label}: found empty id values.")
    if empty_code_count > 0:
        raise SystemExit(f"{label}: found empty cntr_code values.")
    if duplicate_id_count > 0:
        raise SystemExit(f"{label}: found duplicate id values.")


def build_border_lines() -> gpd.GeoDataFrame:
    border_lines = fetch_ne_zip(cfg.BORDER_LINES_URL, "border_lines")
    border_lines = clip_to_map_bounds(border_lines, "border lines")
    border_lines = border_lines.copy()
    border_lines["geometry"] = border_lines.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BORDER_LINES, preserve_topology=True
    )
    return border_lines


def despeckle_hybrid(
    gdf: gpd.GeoDataFrame,
    area_km2: float = cfg.MIN_VISIBLE_AREA_KM2,
    tolerance: float = cfg.SIMPLIFY_NUTS3,
) -> gpd.GeoDataFrame:
    if gdf.empty or "id" not in gdf.columns:
        return gdf

    exploded = gdf.explode(index_parts=False, ignore_index=True)
    if exploded.empty:
        return gdf

    try:
        proj = exploded.to_crs(cfg.AREA_CRS)
        areas = proj.geometry.area / 1_000_000.0
        keep = areas >= area_km2
        filtered = exploded.loc[keep].copy()
        dropped = int((~keep).sum())
        kept = int(keep.sum())
        total = int(len(keep))
        print(
            f"Despeckle: dropped {dropped} polygons < {area_km2:.0f} km^2 "
            f"(kept {kept} of {total})."
        )
    except Exception as exc:
        print(f"Despeckle failed, keeping original hybrid: {exc}")
        return gdf

    if filtered.empty:
        print("Despeckle removed all geometries, keeping original hybrid.")
        return gdf

    dissolved = filtered.dissolve(by="id", aggfunc={"name": "first", "cntr_code": "first"})
    dissolved = dissolved.reset_index()
    dissolved = dissolved.set_crs(gdf.crs)
    dissolved["geometry"] = dissolved.geometry.simplify(
        tolerance=tolerance, preserve_topology=True
    )
    return dissolved


def clip_to_land_bounds(gdf: gpd.GeoDataFrame, land: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    print(f"Reprojecting and clipping {label}...")
    gdf = gdf.to_crs("EPSG:4326")
    minx, miny, maxx, maxy = land.total_bounds
    bbox_geom = box(minx, miny, maxx, maxy)
    try:
        clipped = gpd.clip(gdf, bbox_geom)
    except Exception as exc:
        print(f"Clip failed for {label}, attempting to fix geometries...")
        try:
            if hasattr(gdf.geometry, "make_valid"):
                gdf = gdf.set_geometry(gdf.geometry.make_valid())
            else:
                gdf = gdf.set_geometry(gdf.geometry.buffer(0))
            clipped = gpd.clip(gdf, bbox_geom)
        except Exception as fix_exc:
            print(f"Failed to clip {label}: {fix_exc}")
            raise SystemExit(1) from fix_exc

    if clipped.empty:
        print(f"Clipped {label} dataset is empty. Check bounds or CRS.")
        raise SystemExit(1)
    return clipped


def clip_to_bounds(gdf: gpd.GeoDataFrame, bounds: Iterable[float], label: str) -> gpd.GeoDataFrame:
    print(f"Reprojecting and clipping {label} to hybrid bounds...")
    gdf = gdf.to_crs("EPSG:4326")
    minx, miny, maxx, maxy = bounds
    bbox_geom = box(minx, miny, maxx, maxy)
    try:
        clipped = gpd.clip(gdf, bbox_geom)
    except Exception as exc:
        print(f"Clip failed for {label}, attempting to fix geometries...")
        try:
            if hasattr(gdf.geometry, "make_valid"):
                gdf = gdf.set_geometry(gdf.geometry.make_valid())
            else:
                gdf = gdf.set_geometry(gdf.geometry.buffer(0))
            clipped = gpd.clip(gdf, bbox_geom)
        except Exception as fix_exc:
            print(f"Failed to clip {label}: {fix_exc}")
            raise SystemExit(1) from fix_exc

    if clipped.empty:
        print(f"Clipped {label} dataset is empty. Check bounds or CRS.")
        raise SystemExit(1)
    return clipped


def clip_borders(gdf: gpd.GeoDataFrame, land: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("Clipping national borders to land bounds...")
    return clip_to_land_bounds(gdf, land, "borders")


def build_ru_city_detail_topology(script_dir: Path, output_dir: Path) -> None:
    source_topology = output_dir / "europe_topology.json.bak"
    if not source_topology.exists():
        print(
            "[RU City Detail] Skipped: source detail topology not found at "
            f"{source_topology}."
        )
        return

    patch_script = script_dir / "tools" / "patch_ru_city_detail.py"
    if not patch_script.exists():
        print(f"[RU City Detail] Skipped: patch script missing at {patch_script}.")
        return

    cmd = [
        sys.executable,
        str(patch_script),
        "--source-topology",
        str(source_topology),
        "--output-topology",
        str(output_dir / "europe_topology.highres.json"),
        "--ru-adm2",
        str(output_dir / cfg.RUS_ADM2_FILENAME),
    ]
    print("[RU City Detail] Building patched detail topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[RU City Detail] Failed to patch detail topology: {exc}")


def build_na_detail_topology(script_dir: Path, output_dir: Path) -> None:
    source_topology = output_dir / "europe_topology.highres.json"
    if not source_topology.exists():
        source_topology = output_dir / "europe_topology.json.bak"
    if not source_topology.exists():
        print("[Detail Bundle] Skipped: no source detail topology found.")
        return

    patch_script = script_dir / "tools" / "build_na_detail_topology.py"
    if not patch_script.exists():
        print(f"[Detail Bundle] Skipped: patch script missing at {patch_script}.")
        return

    cmd = [
        sys.executable,
        str(patch_script),
        "--source-topology",
        str(source_topology),
        "--output-topology",
        str(output_dir / "europe_topology.na_v2.json"),
    ]
    print("[Detail Bundle] Building enriched detail topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[Detail Bundle] Failed to build enriched detail topology: {exc}")


def build_runtime_political_topology(script_dir: Path, output_dir: Path) -> None:
    primary_topology = output_dir / "europe_topology.json"
    detail_topology = output_dir / "europe_topology.na_v2.json"
    runtime_script = script_dir / "tools" / "build_runtime_political_topology.py"

    if not primary_topology.exists():
        print("[Runtime Political] Skipped: primary topology not found.")
        return
    if not runtime_script.exists():
        print(f"[Runtime Political] Skipped: script missing at {runtime_script}.")
        return

    cmd = [
        sys.executable,
        str(runtime_script),
        "--primary-topology",
        str(primary_topology),
        "--detail-topology",
        str(detail_topology),
        "--ru-overrides",
        str(output_dir / "ru_city_overrides.geojson"),
        "--output-topology",
        str(output_dir / "europe_topology.runtime_political_v1.json"),
    ]
    print("[Runtime Political] Building unified runtime political topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[Runtime Political] Failed to build unified runtime topology: {exc}")


def build_balkan_fallback(
    existing: gpd.GeoDataFrame, admin0: gpd.GeoDataFrame | None = None
) -> gpd.GeoDataFrame:
    if admin0 is None:
        admin0 = fetch_ne_zip(cfg.BORDERS_URL, "admin0_balkan")
    admin0 = admin0.to_crs("EPSG:4326")
    admin0 = clip_to_map_bounds(admin0, "balkan fallback")

    iso_col = pick_column(
        admin0,
        ["iso_a2", "ISO_A2", "adm0_a2", "ADM0_A2", "iso_3166_1_", "ISO_3166_1_"],
    )
    name_col = pick_column(admin0, ["ADMIN", "admin", "NAME", "name", "NAME_EN", "name_en"])
    if not iso_col and not name_col:
        print("Admin0 dataset missing ISO/name columns; Balkan fallback skipped.")
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    existing_codes = set()
    if existing is not None and "cntr_code" in existing.columns:
        existing_codes = set(
            existing["cntr_code"]
            .dropna()
            .astype(str)
            .str.upper()
            .unique()
        )

    wanted = {"BA", "XK"}
    missing = wanted - existing_codes
    if not missing:
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    balkan = admin0[admin0[iso_col].isin(missing)].copy() if iso_col else admin0.iloc[0:0].copy()
    if name_col:
        if "XK" in missing:
            kosovo_mask = admin0[name_col].str.contains("Kosovo", case=False, na=False)
            balkan = pd.concat([balkan, admin0[kosovo_mask]], ignore_index=True)
        if "BA" in missing:
            bosnia_mask = admin0[name_col].str.contains("Bosnia", case=False, na=False)
            balkan = pd.concat([balkan, admin0[bosnia_mask]], ignore_index=True)
    if balkan.empty:
        print("Balkan fallback found no matching admin0 features.")
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    def resolve_balkan_code(row: pd.Series) -> str:
        if iso_col:
            raw = str(row.get(iso_col, "")).upper()
            if len(raw) == 2 and raw.isalpha() and raw != "-99":
                return raw
        if name_col:
            name_val = str(row.get(name_col, "")).lower()
            if "kosovo" in name_val:
                return "XK"
            if "bosnia" in name_val:
                return "BA"
        return ""

    balkan["cntr_code"] = balkan.apply(resolve_balkan_code, axis=1)
    balkan = balkan[balkan["cntr_code"].isin(missing)].copy()
    if balkan.empty:
        print("Balkan fallback found no usable BA/XK features.")
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    if name_col:
        balkan["name"] = balkan[name_col].astype(str)
    else:
        balkan["name"] = balkan["cntr_code"]
    balkan["id"] = balkan["cntr_code"].astype(str) + "_" + balkan["name"].astype(str)
    balkan = balkan[["id", "name", "cntr_code", "geometry"]].copy()
    balkan["geometry"] = balkan.geometry.simplify(
        tolerance=cfg.SIMPLIFY_ADMIN1, preserve_topology=True
    )
    return balkan


def load_subdivision_admin1_context(subdivision_codes: set[str]) -> gpd.GeoDataFrame:
    if not subdivision_codes:
        return gpd.GeoDataFrame(
            columns=["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"],
            crs="EPSG:4326",
        )

    admin1 = fetch_ne_zip(cfg.ADMIN1_URL, "admin1_subdivisions")
    admin1 = admin1.to_crs("EPSG:4326")
    admin1 = clip_to_map_bounds(admin1, "admin1 subdivisions")

    iso_col = pick_column(admin1, ["iso_a2", "adm0_a2", "iso_3166_1_", "ISO_A2", "ADM0_A2"])
    name_col = pick_column(admin1, ["name", "name_en", "gn_name", "NAME", "NAME_EN"])
    name_local_col = pick_column(admin1, ["name_ja", "NAME_JA", "name_local", "NAME_LOCAL"])
    geonunit_col = pick_column(admin1, ["geonunit", "GEONUNIT", "geounit", "GEOUNIT"])

    if not iso_col or not name_col:
        print("[Subdivisions] Admin1 context missing ISO/name columns; enrichment skipped.")
        return gpd.GeoDataFrame(
            columns=["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"],
            crs="EPSG:4326",
        )

    admin1 = admin1.copy()
    admin1["__iso"] = admin1[iso_col].fillna("").astype(str).str.upper().str.strip()
    if "GB" in subdivision_codes:
        wanted = set(subdivision_codes) | {"UK"}
    else:
        wanted = set(subdivision_codes)
    admin1 = admin1[admin1["__iso"].isin(wanted)].copy()
    if admin1.empty:
        print("[Subdivisions] No Admin1 rows matched configured subdivision countries.")
        return gpd.GeoDataFrame(
            columns=["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"],
            crs="EPSG:4326",
        )

    admin1["__admin1_name"] = admin1[name_col].fillna("").astype(str).str.strip()
    admin1 = admin1[admin1["__admin1_name"] != ""].copy()
    admin1["__iso"] = admin1["__iso"].replace({"UK": "GB"})

    admin1["__name_local"] = None
    if name_local_col and name_local_col in admin1.columns:
        admin1["__name_local"] = admin1[name_local_col].fillna("").astype(str).str.strip()
        admin1.loc[admin1["__name_local"] == "", "__name_local"] = None

    admin1["__constituent_country"] = None
    if geonunit_col and geonunit_col in admin1.columns:
        admin1["__constituent_country"] = admin1[geonunit_col].fillna("").astype(str).str.strip()
        admin1.loc[admin1["__constituent_country"] == "", "__constituent_country"] = None

    admin1 = admin1[["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"]].copy()
    return gpd.GeoDataFrame(admin1, crs="EPSG:4326")


def apply_config_subdivisions(hybrid: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if hybrid is None or hybrid.empty or "cntr_code" not in hybrid.columns:
        return hybrid

    configured = {
        str(code).upper().strip()
        for code in getattr(cfg, "SUBDIVISIONS", set())
        if str(code).strip()
    }
    if not configured:
        return hybrid

    # These countries already have dedicated replacement processors later in the pipeline.
    protected = {"CN", "RU", "IN", "PL", "FR"}
    subdivision_codes = configured - protected
    if not subdivision_codes:
        return hybrid

    context = load_subdivision_admin1_context(subdivision_codes)
    if context.empty:
        print("[Subdivisions] No Admin1 context features were built.")
        return hybrid

    enriched = hybrid.copy()
    if "admin1_group" not in enriched.columns:
        enriched["admin1_group"] = None
    if "name_local" not in enriched.columns:
        enriched["name_local"] = None
    if "constituent_country" not in enriched.columns:
        enriched["constituent_country"] = None

    country_codes = enriched["cntr_code"].fillna("").astype(str).str.upper().str.strip()

    for iso in sorted(subdivision_codes):
        iso_codes = {"GB", "UK"} if iso == "GB" else {iso}
        detail_mask = country_codes.isin(iso_codes)
        if not detail_mask.any():
            print(f"[Subdivisions] Enrich {iso} skipped: no matching detailed geometries.")
            continue

        iso_context = context[context["__iso"].isin({"GB"} if iso == "GB" else {iso})].copy()
        if iso_context.empty:
            print(f"[Subdivisions] Enrich {iso} skipped: no Admin1 context geometries found.")
            continue

        targets = enriched.loc[detail_mask].copy().to_crs("EPSG:4326")
        targets["geometry"] = targets.geometry.representative_point()
        iso_context = iso_context.to_crs("EPSG:4326")
        try:
            joined = gpd.sjoin(
                targets,
                iso_context,
                how="left",
                predicate="within",
            )
        except Exception as exc:
            print(f"[Subdivisions] Enrich {iso} spatial join failed: {exc}")
            continue

        group_source_col = "__constituent_country" if iso == "GB" else "__admin1_name"
        group_series = joined[group_source_col].groupby(level=0).first()

        missing_groups = group_series.fillna("").astype(str).str.strip().eq("")
        if missing_groups.any():
            try:
                nearest = gpd.sjoin_nearest(
                    targets.loc[missing_groups].copy(),
                    iso_context,
                    how="left",
                    distance_col="distance",
                )
                nearest_groups = nearest[group_source_col].groupby(level=0).first()
                group_series.loc[nearest_groups.index] = nearest_groups
            except Exception as exc:
                print(f"[Subdivisions] Enrich {iso} nearest join fallback failed: {exc}")

        group_series = group_series.fillna("").astype(str).str.strip()
        group_series = group_series[group_series != ""]
        if group_series.empty:
            print(f"[Subdivisions] Enrich {iso} produced no admin1_group assignments.")
            continue

        enriched.loc[group_series.index, "admin1_group"] = group_series

        if iso == "JP":
            local_series = joined["__name_local"].groupby(level=0).first()
            local_series = local_series.fillna("").astype(str).str.strip()
            local_series = local_series[local_series != ""]
            if not local_series.empty:
                enriched.loc[local_series.index, "name_local"] = local_series

        if iso == "GB":
            const_series = joined["__constituent_country"].groupby(level=0).first()
            const_series = const_series.fillna("").astype(str).str.strip()
            const_series = const_series[const_series != ""]
            if not const_series.empty:
                enriched.loc[const_series.index, "constituent_country"] = const_series

        print(
            f"[Subdivisions] Enriched {iso}: mapped {len(group_series)} detailed geometries to admin1_group."
        )

    return enriched


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Map Creator data artifacts.")
    parser.add_argument(
        "--mode",
        choices=["all", "primary", "detail", "i18n", "palettes"],
        default="all",
        help="Build scope. all=full pipeline, primary=coarse topology, detail=detail/runtime artifacts, i18n=hierarchy/aliases/locales, palettes=palette assets only.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail when validation detects contract drift or schema issues.",
    )
    return parser.parse_args()


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract_world_bounds_feature_ids(path: Path, normalize_geometry: bool = False) -> list[str]:
    node_path = shutil.which('node')
    if not node_path or not D3_VENDOR_PATH.exists() or not TOPOJSON_VENDOR_PATH.exists() or not path.exists():
        return []

    script = f"""
const fs = require('fs');
const vm = require('vm');
const normalizeGeometry = {json.dumps(True)} if False else {json.dumps(False)};
const context = {{ console }};
context.global = context;
context.globalThis = context;
context.window = context;
context.self = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync({json.dumps(str(D3_VENDOR_PATH))}, 'utf8'), context, {{ filename: 'd3.v7.min.js' }});
vm.runInContext(fs.readFileSync({json.dumps(str(TOPOJSON_VENDOR_PATH))}, 'utf8'), context, {{ filename: 'topojson-client.min.js' }});
const data = JSON.parse(fs.readFileSync({json.dumps(str(path))}, 'utf8'));
const object = data?.objects?.political;
const features = object ? context.topojson.feature(data, object).features : [];
function getRingOrientationAccumulator(ring) {{
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let total = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {{
    const start = ring[index];
    const end = ring[index + 1];
    if (!Array.isArray(start) || !Array.isArray(end)) continue;
    total += (Number(end[0]) - Number(start[0])) * (Number(end[1]) + Number(start[1]));
  }}
  return total;
}}
function orientRingCoordinates(ring, clockwise) {{
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const signed = getRingOrientationAccumulator(ring);
  const isClockwise = signed > 0;
  if (clockwise === isClockwise) return ring;
  return [...ring].reverse();
}}
function rewindGeometryRings(geometry) {{
  if (!geometry || !geometry.type || !geometry.coordinates) return null;
  if (geometry.type === 'Polygon') {{
    return {{
      ...geometry,
      coordinates: geometry.coordinates.map((ring, index) => orientRingCoordinates(ring, index === 0)),
    }};
  }}
  if (geometry.type === 'MultiPolygon') {{
    return {{
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map((ring, index) => orientRingCoordinates(ring, index === 0))
          : polygon
      ),
    }};
  }}
  return null;
}}
function normalizeFeatureGeometry(feature) {{
  if (!normalizeGeometry || !feature?.geometry) return feature;
  let area = null;
  try {{
    area = context.d3.geoArea(feature);
  }} catch (_error) {{
    return feature;
  }}
  if (!Number.isFinite(area) || area <= Math.PI * 2) return feature;
  const rewoundGeometry = rewindGeometryRings(feature.geometry);
  if (!rewoundGeometry) return feature;
  const rewoundFeature = {{ ...feature, geometry: rewoundGeometry }};
  try {{
    const rewoundArea = context.d3.geoArea(rewoundFeature);
    if (Number.isFinite(rewoundArea) && rewoundArea < area) return rewoundFeature;
  }} catch (_error) {{}}
  return feature;
}}
const bad = [];
for (const rawFeature of features) {{
  const feature = normalizeFeatureGeometry(rawFeature);
  const props = feature?.properties || {{}};
  const id = String(props.id || feature.id || '').trim();
  if (!id) continue;
  try {{
    const area = Number(context.d3.geoArea(feature));
    const bounds = context.d3.geoBounds(feature);
    const isWorld = Array.isArray(bounds)
      && bounds.length === 2
      && Array.isArray(bounds[0])
      && Array.isArray(bounds[1])
      && Math.abs(Number(bounds[0][0]) + 180) < 1e-9
      && Math.abs(Number(bounds[0][1]) + 90) < 1e-9
      && Math.abs(Number(bounds[1][0]) - 180) < 1e-9
      && Math.abs(Number(bounds[1][1]) - 90) < 1e-9;
    if (isWorld || area > Math.PI * 2) bad.push(id);
  }} catch (_error) {{}}
}}
process.stdout.write(JSON.stringify(bad));
""".replace("const normalizeGeometry = true if False else false;", f"const normalizeGeometry = {str(normalize_geometry).lower()};")

    try:
        completed = subprocess.run(
            [node_path, '-e', script],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return []
    if completed.returncode != 0:
        return []
    try:
        payload = json.loads(completed.stdout.strip() or '[]')
    except json.JSONDecodeError:
        return []
    return [str(item).strip() for item in payload if str(item).strip()]


def _topology_summary(path: Path) -> dict:
    data = _read_json(path)
    objects = data.get("objects", {}) if isinstance(data, dict) else {}
    political = objects.get("political", {}) if isinstance(objects, dict) else {}
    geometries = political.get("geometries", []) if isinstance(political, dict) else []
    arcs = data.get("arcs", []) if isinstance(data, dict) else []
    raw_world_bounds_ids = _extract_world_bounds_feature_ids(path, normalize_geometry=False)
    normalized_world_bounds_ids = _extract_world_bounds_feature_ids(path, normalize_geometry=True)
    return {
        "type": "topology",
        "object_names": sorted(objects.keys()) if isinstance(objects, dict) else [],
        "political_geometries": len(geometries) if isinstance(geometries, list) else 0,
        "has_computed_neighbors": bool(political.get("computed_neighbors")) if isinstance(political, dict) else False,
        "arc_count": len(arcs) if isinstance(arcs, list) else 0,
        "arc_point_count": sum(len(arc) for arc in arcs if isinstance(arc, list)),
        "world_bounds_geometries": len(normalized_world_bounds_ids),
        "raw_world_bounds_geometries": len(raw_world_bounds_ids),
    }


def _extract_political_topology_ids(path: Path) -> tuple[set[str], list[str], list[str], list[str]]:
    data = _read_json(path)
    geometries = data.get("objects", {}).get("political", {}).get("geometries", [])
    ids: list[str] = []
    missing_names: list[str] = []
    illegal_ids: list[str] = []
    for geom in geometries if isinstance(geometries, list) else []:
        props = geom.get("properties", {}) or {}
        feature_id = str(props.get("id") or geom.get("id") or "").strip()
        if feature_id:
            ids.append(feature_id)
            if re.search(r"[?+]", feature_id) and feature_id not in ALLOWED_SENTINEL_FEATURE_IDS:
                illegal_ids.append(feature_id)
        name = str(props.get("name") or "").strip()
        if not name and feature_id:
            missing_names.append(feature_id)
    seen: set[str] = set()
    duplicates: list[str] = []
    for feature_id in ids:
        if feature_id in seen:
            duplicates.append(feature_id)
        else:
            seen.add(feature_id)
    return set(ids), duplicates, missing_names, illegal_ids


def _collect_hierarchy_child_ids(path: Path) -> set[str]:
    data = _read_json(path)
    groups = data.get("groups", {}) if isinstance(data, dict) else {}
    child_ids: set[str] = set()
    if isinstance(groups, dict):
        for children in groups.values():
            if not isinstance(children, list):
                continue
            for child_id in children:
                text = str(child_id or "").strip()
                if text:
                    child_ids.add(text)
    return child_ids


def write_data_manifest(output_dir: Path) -> Path:
    roles = {
        "europe_topology.json": "primary_topology",
        "europe_topology.na_v1.json": "detail_topology_na_v1",
        "europe_topology.na_v2.json": "detail_topology_na_v2",
        "europe_topology.runtime_political_v1.json": "runtime_political_topology",
        "hierarchy.json": "hierarchy",
        "geo_aliases.json": "geo_aliases",
        "locales.json": "locales",
        "palettes/index.json": "palette_registry",
        "palettes/hoi4_vanilla.palette.json": "palette_pack",
        "palettes/kaiserreich.palette.json": "palette_pack",
        "palettes/tno.palette.json": "palette_pack",
        "palettes/red_flood.palette.json": "palette_pack",
        "palette-maps/hoi4_vanilla.map.json": "palette_map",
        "palette-maps/kaiserreich.map.json": "palette_map",
        "palette-maps/tno.map.json": "palette_map",
        "palette-maps/red_flood.map.json": "palette_map",
        "palette-maps/hoi4_vanilla.audit.json": "palette_audit",
        "palette-maps/kaiserreich.audit.json": "palette_audit",
        "palette-maps/tno.audit.json": "palette_audit",
        "palette-maps/red_flood.audit.json": "palette_audit",
    }
    outputs: dict[str, dict] = {}
    for file_name, role in roles.items():
        path = output_dir / file_name
        if not path.exists():
            continue
        item: dict[str, object] = {
            "role": role,
            "size_bytes": path.stat().st_size,
            "sha256": _sha256_file(path),
        }
        if path.suffix == ".json":
            try:
                if "topology" in file_name:
                    item.update(_topology_summary(path))
                elif file_name == "hierarchy.json":
                    payload = _read_json(path)
                    groups = payload.get("groups", {}) if isinstance(payload, dict) else {}
                    item.update(
                        {
                            "type": "hierarchy",
                            "group_count": len(groups) if isinstance(groups, dict) else 0,
                            "child_count": len(_collect_hierarchy_child_ids(path)),
                        }
                    )
                elif file_name == "geo_aliases.json":
                    payload = _read_json(path)
                    item.update(
                        {
                            "type": "geo_aliases",
                            "entry_count": int(payload.get("entry_count", 0)),
                            "alias_count": int(payload.get("alias_count", 0)),
                            "conflict_count": int(payload.get("conflict_count", 0)),
                        }
                    )
                elif file_name == "locales.json":
                    payload = _read_json(path)
                    geo_entries = payload.get("geo", {}) if isinstance(payload, dict) else {}
                    ui_entries = payload.get("ui", {}) if isinstance(payload, dict) else {}
                    item.update(
                        {
                            "type": "locales",
                            "geo_entry_count": len(geo_entries) if isinstance(geo_entries, dict) else 0,
                            "ui_entry_count": len(ui_entries) if isinstance(ui_entries, dict) else 0,
                        }
                    )
                elif file_name.endswith("palettes/index.json"):
                    payload = _read_json(path)
                    palettes = payload.get("palettes", []) if isinstance(payload, dict) else []
                    item.update(
                        {
                            "type": "palette_registry",
                            "default_palette_id": payload.get("default_palette_id") if isinstance(payload, dict) else "",
                            "palette_count": len(palettes) if isinstance(palettes, list) else 0,
                        }
                    )
                elif file_name.endswith(".palette.json"):
                    payload = _read_json(path)
                    entries = payload.get("entries", {}) if isinstance(payload, dict) else {}
                    item.update(
                        {
                            "type": "palette_pack",
                            "palette_id": payload.get("palette_id") if isinstance(payload, dict) else "",
                            "entry_count": len(entries) if isinstance(entries, dict) else 0,
                            "quick_tag_count": len(payload.get("quick_tags", [])) if isinstance(payload, dict) else 0,
                        }
                    )
                elif file_name.endswith(".map.json"):
                    payload = _read_json(path)
                    mapped = payload.get("mapped", {}) if isinstance(payload, dict) else {}
                    unmapped = payload.get("unmapped", {}) if isinstance(payload, dict) else {}
                    item.update(
                        {
                            "type": "palette_map",
                            "palette_id": payload.get("palette_id") if isinstance(payload, dict) else "",
                            "mapped_count": len(mapped) if isinstance(mapped, dict) else 0,
                            "unmapped_count": len(unmapped) if isinstance(unmapped, dict) else 0,
                        }
                    )
                elif file_name.endswith(".audit.json"):
                    payload = _read_json(path)
                    summary = payload.get("summary", {}) if isinstance(payload, dict) else {}
                    item.update(
                        {
                            "type": "palette_audit",
                            "palette_id": payload.get("palette_id") if isinstance(payload, dict) else "",
                            "entry_count": int(summary.get("total_entries", 0)),
                            "mapped_count": int(summary.get("mapped_count", 0)),
                            "unmapped_count": int(summary.get("unmapped_count", 0)),
                        }
                    )
            except Exception as exc:
                item["inspection_error"] = str(exc)
        outputs[file_name] = item

    manifest = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "outputs": outputs,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[Manifest] Wrote {manifest_path}")
    return manifest_path


def validate_build_outputs(output_dir: Path, strict: bool = False) -> None:
    problems: list[str] = []

    primary_path = output_dir / "europe_topology.json"
    detail_path = output_dir / "europe_topology.na_v2.json"
    runtime_path = output_dir / "europe_topology.runtime_political_v1.json"
    hierarchy_path = output_dir / "hierarchy.json"
    aliases_path = output_dir / "geo_aliases.json"

    for topology_path in [primary_path, detail_path, runtime_path]:
        if not topology_path.exists():
            continue
        ids, duplicates, missing_names, illegal_ids = _extract_political_topology_ids(topology_path)
        if duplicates:
            problems.append(f"{topology_path.name}: duplicate ids={len(duplicates)}")
        if strict and missing_names:
            problems.append(f"{topology_path.name}: missing names={len(missing_names)}")
        if strict and illegal_ids:
            problems.append(f"{topology_path.name}: illegal sentinel ids={len(illegal_ids)}")

        summary = _topology_summary(topology_path)
        world_bounds_count = int(summary.get("world_bounds_geometries", 0))
        raw_world_bounds_count = int(summary.get("raw_world_bounds_geometries", 0))
        if strict and summary["political_geometries"] > 0 and not summary["has_computed_neighbors"]:
            problems.append(f"{topology_path.name}: missing computed_neighbors")
        if strict and world_bounds_count > 0:
            problems.append(f"{topology_path.name}: world-bounds geometries={world_bounds_count}")

        print(
            f"[Validate] {topology_path.name}: ids={len(ids)}, "
            f"duplicates={len(duplicates)}, missing_names={len(missing_names)}, "
            f"illegal_ids={len(illegal_ids)}, world_bounds={world_bounds_count}, "
            f"raw_world_bounds={raw_world_bounds_count}"
        )

    if hierarchy_path.exists():
        hierarchy_child_ids = _collect_hierarchy_child_ids(hierarchy_path)
        reference_topology_path = runtime_path if runtime_path.exists() else detail_path if detail_path.exists() else primary_path
        if reference_topology_path.exists():
            reference_ids, _duplicates, _missing_names, _illegal_ids = _extract_political_topology_ids(reference_topology_path)
            missing_children = sorted(hierarchy_child_ids - reference_ids)
            if missing_children:
                problems.append(
                    f"hierarchy.json: child ids missing from {reference_topology_path.name}={len(missing_children)}"
                )
            print(
                f"[Validate] hierarchy.json: children={len(hierarchy_child_ids)}, "
                f"missing_from_{reference_topology_path.name}={len(missing_children)}"
            )

    if aliases_path.exists():
        aliases_payload = _read_json(aliases_path)
        conflict_count = int(aliases_payload.get("conflict_count", 0))
        print(f"[Validate] geo_aliases.json: conflicts={conflict_count}")
        if strict and conflict_count > 0:
            problems.append(f"geo_aliases.json: conflicts={conflict_count}")

    if strict and primary_path.exists() and detail_path.exists() and runtime_path.exists():
        try:
            from tools.build_runtime_political_topology import _compose_political_features, _load_topology

            override_path = output_dir / "ru_city_overrides.geojson"
            override_collection = _read_json(override_path) if override_path.exists() else None
            expected_runtime = _compose_political_features(
                primary_topology=_load_topology(primary_path),
                detail_topology=_load_topology(detail_path) if detail_path.exists() else None,
                override_collection=override_collection,
            )
            expected_ids = {
                str(feature_id).strip()
                for feature_id in expected_runtime.get("id", [])
                if str(feature_id).strip()
            }
            runtime_ids, _duplicates, _missing_names, _illegal_ids = _extract_political_topology_ids(runtime_path)
            if expected_ids != runtime_ids:
                problems.append(
                    "runtime political ids drift: "
                    f"expected={len(expected_ids)}, actual={len(runtime_ids)}, "
                    f"missing={len(expected_ids - runtime_ids)}, extra={len(runtime_ids - expected_ids)}"
                )
        except Exception as exc:
            problems.append(f"runtime political validation failed: {exc}")

    if problems:
        for problem in problems:
            print(f"[Validate] WARNING: {problem}")
        if strict:
            raise SystemExit("Strict validation failed. See warnings above.")


def run_geo_alias_normalization(output_dir: Path) -> None:
    topology_path = geo_key_normalizer.resolve_default_topology(Path(__file__).resolve().parent)
    payload = geo_key_normalizer.normalize_geokeys(topology_path)
    output_path = output_dir / "geo_aliases.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"OK: geo aliases generated. entries={payload['entry_count']}, "
        f"aliases={payload['alias_count']}, conflicts={payload['conflict_count']}"
    )
    print(f"Saved geo aliases to: {output_path}")


def _resolve_palette_source_root(candidates: list[Path]) -> Path | None:
    for candidate in candidates:
        if (candidate / "common/country_tags/00_countries.txt").exists():
            return candidate
    return None


def run_palette_imports(output_dir: Path, strict: bool = False) -> None:
    importer = PROJECT_ROOT / "tools" / "import_country_palette.py"
    primary_topology = output_dir / "europe_topology.json"
    runtime_topology = output_dir / "europe_topology.runtime_political_v1.json"
    if not importer.exists():
        raise SystemExit(f"Palette importer missing: {importer}")
    if not primary_topology.exists():
        raise SystemExit(f"Primary topology required for palette import: {primary_topology}")
    if not runtime_topology.exists():
        raise SystemExit(f"Runtime topology required for palette import: {runtime_topology}")

    vanilla_root = _resolve_palette_source_root([
        Path(r"/mnt/c/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV"),
        Path(r"C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV"),
    ])
    palette_jobs = [
        {
            "palette_id": "hoi4_vanilla",
            "display_name": "HOI4 Vanilla",
            "source_variant": "vanilla",
            "manual_map": PROJECT_ROOT / "data/palette-maps/hoi4_vanilla.manual.json",
            "source_root": vanilla_root,
            "source_workshop_id": "",
        },
        {
            "palette_id": "kaiserreich",
            "display_name": "Kaiserreich",
            "source_variant": "kaiserreich",
            "manual_map": PROJECT_ROOT / "data/palette-maps/kaiserreich.manual.json",
            "source_root": Path(r"/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/1521695605"),
            "source_workshop_id": "1521695605",
        },
        {
            "palette_id": "tno",
            "display_name": "The New Order",
            "source_variant": "tno",
            "manual_map": PROJECT_ROOT / "data/palette-maps/tno.manual.json",
            "source_root": Path(r"/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901"),
            "source_workshop_id": "2438003901",
        },
        {
            "palette_id": "red_flood",
            "display_name": "Red Flood",
            "source_variant": "red_flood",
            "manual_map": PROJECT_ROOT / "data/palette-maps/red_flood.manual.json",
            "source_root": Path(r"/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/2815832636"),
            "source_workshop_id": "2815832636",
        },
    ]

    for job in palette_jobs:
        source_root = job["source_root"]
        if source_root is None or not source_root.exists():
            message = f"[Palette] Source root missing for {job['palette_id']}: {source_root}"
            if strict:
                raise SystemExit(message)
            print(f"{message}. Skipping.")
            continue
        cmd = [
            sys.executable,
            str(importer),
            "--source-root",
            str(source_root),
            "--palette-id",
            str(job["palette_id"]),
            "--display-name",
            str(job["display_name"]),
            "--source-variant",
            str(job["source_variant"]),
            "--manual-map",
            str(job["manual_map"]),
            "--output-dir",
            str(output_dir),
            "--primary-topology",
            str(primary_topology),
            "--runtime-topology",
            str(runtime_topology),
            "--registry-mode",
            "merge",
        ]
        if job["source_workshop_id"]:
            cmd.extend(["--source-workshop-id", str(job["source_workshop_id"])])
        subprocess.run(cmd, cwd=PROJECT_ROOT, check=True)


def main() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    output_dir = script_dir / "data"

    if args.mode == "detail":
        build_ru_city_detail_topology(script_dir, output_dir)
        build_na_detail_topology(script_dir, output_dir)
        build_runtime_political_topology(script_dir, output_dir)
        write_data_manifest(output_dir)
        validate_build_outputs(output_dir, strict=args.strict)
        print("Done.")
        return

    if args.mode == "i18n":
        print("[INFO] Generating Hierarchy Data....")
        generate_hierarchy.main()

        print("[INFO] Normalizing GEO keys....")
        run_geo_alias_normalization(output_dir)

        print("[INFO] Syncing Translations....")
        translation_result = translate_manager.sync_translations(
            topology_path=output_dir / "europe_topology.na_v2.json",
            output_path=output_dir / "locales.json",
            geo_aliases_path=output_dir / "geo_aliases.json",
            hierarchy_path=output_dir / "hierarchy.json",
            machine_translate=False,
            network_mode="off",
        )
        print(
            "[INFO] Translation sync result: "
            f"geo_missing_like={translation_result['geo_missing_like']}, "
            f"todo_markers={translation_result['geo_literal_todo_markers']}, "
            f"mt_requests={translation_result['mt_requests']}"
        )
        write_data_manifest(output_dir)
        validate_build_outputs(output_dir, strict=args.strict)
        print("Done.")
        return

    if args.mode == "palettes":
        print("[INFO] Rebuilding palette assets....")
        run_palette_imports(output_dir, strict=args.strict)
        write_data_manifest(output_dir)
        validate_build_outputs(output_dir, strict=args.strict)
        print("Done.")
        return

    borders = fetch_ne_zip(cfg.BORDERS_URL, "borders")
    borders = clip_to_map_bounds(borders, "borders")

    if getattr(cfg, "GLOBAL_SKELETON_MODE", False):
        filtered = filter_countries(borders)
        filtered = filtered.copy()
        filtered["geometry"] = filtered.geometry.simplify(
            tolerance=cfg.SIMPLIFY_BORDERS, preserve_topology=True
        )
    else:
        data = fetch_geojson(cfg.URL)
        gdf = build_geodataframe(data)
        gdf = clip_to_map_bounds(gdf, "nuts")
        filtered = filter_countries(gdf)
        filtered = filtered.copy()
        filtered["geometry"] = filtered.geometry.simplify(
            tolerance=cfg.SIMPLIFY_NUTS3, preserve_topology=True
        )
    validate_political_schema(filtered, "Political Filter")

    rivers_clipped = load_rivers()
    border_lines = build_border_lines()
    ocean = fetch_ne_zip(cfg.OCEAN_URL, "ocean")
    ocean = clip_to_map_bounds(ocean, "ocean")
    land_bg = fetch_ne_zip(cfg.LAND_BG_URL, "land")
    land_bg = clip_to_map_bounds(land_bg, "land background")
    ocean = ensure_ocean_coverage(
        ocean,
        land_bg,
        target_bounds=getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS),
        stage_label="initial",
    )

    # Keep raw ocean geometry until political bounds are finalized to avoid
    # early bbox clipping artifacts.
    ocean_clipped = ocean.copy()
    ocean_clipped["geometry"] = ocean_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    # Keep raw land background geometry until political bounds are finalized.
    land_bg_clipped = land_bg.copy()
    land_bg_clipped["geometry"] = land_bg_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    urban_clipped = load_urban()
    # Aggressively simplify urban geometry to reduce render cost
    urban_clipped = urban_clipped.copy()
    urban_clipped["geometry"] = urban_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_URBAN, preserve_topology=True
    )
    physical_filtered = load_physical()
    if physical_filtered.empty:
        print("Physical regions filter returned empty dataset, keeping all clipped features.")
        physical_filtered = fetch_ne_zip(cfg.PHYSICAL_URL, "physical")
        physical_filtered = clip_to_map_bounds(physical_filtered, "physical")
    # Simplify physical regions to reduce vertex count
    physical_filtered = physical_filtered.copy()
    physical_filtered["geometry"] = physical_filtered.geometry.simplify(
        tolerance=cfg.SIMPLIFY_PHYSICAL, preserve_topology=True
    )
    # Preserve key metadata for styling/labels
    keep_cols = [
        "name",
        "name_en",
        "NAME",
        "NAME_EN",
        "featurecla",
        "FEATURECLA",
        "geometry",
    ]
    physical_filtered = physical_filtered[[col for col in keep_cols if col in physical_filtered.columns]]

    # Build hybrid interactive layer.
    nuts_hybrid = filtered[["id", "name", "cntr_code", "geometry"]].copy()

    special_zones = gpd.GeoDataFrame(
        columns=["id", "name", "type", "label", "claimants", "cntr_code", "geometry"],
        crs="EPSG:4326",
    )
    hybrid = nuts_hybrid.copy()

    if not getattr(cfg, "GLOBAL_SKELETON_MODE", False):
        extension_hybrid = build_extension_admin1(filtered)
        hybrid = gpd.GeoDataFrame(
            pd.concat([nuts_hybrid, extension_hybrid], ignore_index=True),
            crs="EPSG:4326",
        )
        balkan_fallback = build_balkan_fallback(hybrid, admin0=borders)
        if not balkan_fallback.empty:
            hybrid = gpd.GeoDataFrame(
                pd.concat([hybrid, balkan_fallback], ignore_index=True),
                crs="EPSG:4326",
            )
        hybrid = apply_holistic_replacements(hybrid)
        hybrid = apply_russia_ukraine_replacement(hybrid)
        hybrid = apply_poland_replacement(hybrid)
        hybrid = apply_china_replacement(hybrid)
        hybrid = apply_south_asia_replacement(hybrid, land_bg_clipped)
        hybrid = apply_north_america_replacement(hybrid)

    # Build special zones for both skeleton and enriched pipelines.
    try:
        print("Downloading India ADM2 (raw) for special zones...")
        india_raw = fetch_or_load_geojson(
            cfg.IND_ADM2_URL,
            cfg.IND_ADM2_FILENAME,
            fallback_urls=cfg.IND_ADM2_FALLBACK_URLS,
        )
        if india_raw.empty:
            print("[Special Zones] India ADM2 GeoDataFrame is empty; skipping disputed zone.")
        else:
            if india_raw.crs is None:
                india_raw = india_raw.set_crs("EPSG:4326", allow_override=True)
            if india_raw.crs.to_epsg() != 4326:
                india_raw = india_raw.to_crs("EPSG:4326")
            china_gdf = hybrid[
                hybrid["cntr_code"].astype(str).str.upper() == "CN"
            ].copy()
            special_zones = build_special_zones(china_gdf, india_raw)
            if special_zones.empty:
                print("[Special Zones] No special zones were generated.")
            else:
                print(f"[Special Zones] Generated {len(special_zones)} special zones.")
    except Exception as exc:
        print(f"[Special Zones] Failed to build special zones; continuing without: {exc}")

    final_hybrid = hybrid.copy()

    final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("").astype(str).str.strip()
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    missing_mask = final_hybrid["cntr_code"].isna()
    if missing_mask.any() and "id" in final_hybrid.columns:
        final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[
            missing_mask, "id"
        ].apply(extract_country_code)
    final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("").astype(str).str.strip()
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None

    missing_mask = final_hybrid["cntr_code"].isna()
    if missing_mask.any():
        borders_ll = borders.to_crs("EPSG:4326")
        code_col = pick_column(
            borders_ll,
            ["iso_a2", "ISO_A2", "adm0_a2", "ADM0_A2", "iso_3166_1_", "ISO_3166_1_"],
        )
        if not code_col:
            print("Borders dataset missing ISO A2 column; spatial join skipped.")
        else:
            try:
                missing = final_hybrid.loc[missing_mask].copy().to_crs("EPSG:4326")
                missing["geometry"] = missing.geometry.representative_point()
                joined = gpd.sjoin(
                    missing,
                    borders_ll[[code_col, "geometry"]],
                    how="left",
                    predicate="within",
                )
                filled = joined[code_col]
                filled = filled.where(~filled.isin(["-99", "", None]))
                filled = filled.groupby(level=0).first()
                final_hybrid.loc[filled.index, "cntr_code"] = filled
            except Exception as exc:
                print(f"Spatial join failed: {exc}")

    final_hybrid["cntr_code"] = (
        final_hybrid["cntr_code"]
        .fillna("")
        .astype(str)
        .str.strip()
        .str.upper()
    )
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    if getattr(cfg, "ENABLE_SUBDIVISION_ENRICHMENT", False):
        final_hybrid = apply_config_subdivisions(final_hybrid)

    # Re-clip background layers to the final political extent.
    try:
        hybrid_bounds = final_hybrid.to_crs("EPSG:4326").total_bounds
        if (
            len(hybrid_bounds) == 4
            and all(math.isfinite(v) for v in hybrid_bounds)
            and hybrid_bounds[2] > hybrid_bounds[0]
            and hybrid_bounds[3] > hybrid_bounds[1]
        ):
            ocean_clipped = clip_to_bounds(ocean_clipped, hybrid_bounds, "ocean")
            land_bg_clipped = clip_to_bounds(land_bg_clipped, hybrid_bounds, "land background")
    except Exception as exc:
        print(f"Background layer clip-to-political-bounds skipped: {exc}")

    ocean_clipped = ensure_ocean_coverage(
        ocean_clipped,
        land_bg_clipped,
        target_bounds=getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS),
        stage_label="pre-topology",
    )

    # Global polygon culling pass to reduce payload while preserving VIP geometries.
    filtered_group_col = "id" if "id" in filtered.columns else "NUTS_ID"
    filtered = cull_small_geometries(filtered, "land", group_col=filtered_group_col)
    ocean_clipped = cull_small_geometries(ocean_clipped, "ocean")
    land_bg_clipped = cull_small_geometries(land_bg_clipped, "land background")
    urban_clipped = cull_small_geometries(urban_clipped, "urban")
    physical_filtered = cull_small_geometries(physical_filtered, "physical")
    hybrid = cull_small_geometries(hybrid, "hybrid", group_col="id")
    final_hybrid = cull_small_geometries(final_hybrid, "political", group_col="id")
    special_zones = cull_small_geometries(special_zones, "special zones", group_col="id")

    target_bounds = getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS)
    log_layer_coverage("political", final_hybrid, target_bounds)
    log_layer_coverage("ocean", ocean_clipped, target_bounds)
    log_layer_coverage("land", land_bg_clipped, target_bounds)
    log_layer_coverage("urban", urban_clipped, target_bounds)
    log_layer_coverage("physical", physical_filtered, target_bounds)
    log_layer_coverage("rivers", rivers_clipped, target_bounds)
    log_layer_coverage("special_zones", special_zones, target_bounds)

    # ── Validate and stabilize feature IDs ──────────────────────
    if "id" in final_hybrid.columns:
        final_hybrid["id"] = final_hybrid["id"].fillna("").astype(str).str.strip()
        # Fill empty IDs with cntr_code + index
        empty_id_mask = final_hybrid["id"] == ""
        if empty_id_mask.any():
            for idx in final_hybrid.index[empty_id_mask]:
                cc = str(final_hybrid.loc[idx, "cntr_code"] or "UNK").upper()
                final_hybrid.loc[idx, "id"] = f"{cc}_{idx}"
            print(f"[ID Fix] Filled {empty_id_mask.sum()} empty IDs")
        # Deduplicate: append suffix to duplicate IDs
        seen: dict[str, int] = {}
        dup_count = 0
        for idx in final_hybrid.index:
            fid = final_hybrid.loc[idx, "id"]
            if fid in seen:
                seen[fid] += 1
                final_hybrid.loc[idx, "id"] = f"{fid}__d{seen[fid]}"
                dup_count += 1
            else:
                seen[fid] = 0
        if dup_count:
            print(f"[ID Fix] De-duplicated {dup_count} IDs")
        print(f"[ID Validation] {len(final_hybrid)} features, {final_hybrid['id'].nunique()} unique IDs")
    else:
        print("[ID Validation] WARNING: 'id' column missing from final_hybrid!")

    save_outputs(
        filtered,
        rivers_clipped,
        border_lines,
        ocean_clipped,
        land_bg_clipped,
        urban_clipped,
        physical_filtered,
        hybrid,
        final_hybrid,
        output_dir,
    )

    topology_path = output_dir / "europe_topology.json"
    build_topology(
        political=final_hybrid,
        ocean=ocean_clipped,
        land=land_bg_clipped,
        urban=urban_clipped,
        physical=physical_filtered,
        rivers=rivers_clipped,
        special_zones=special_zones,
        output_path=topology_path,
        quantization=cfg.TOPOLOGY_QUANTIZATION,
    )
    if args.mode == "primary":
        write_data_manifest(output_dir)
        validate_build_outputs(output_dir, strict=args.strict)
        print(f"Features with missing CNTR_CODE: {final_hybrid['cntr_code'].isnull().sum()}")
        print("Done.")
        return

    build_ru_city_detail_topology(script_dir, output_dir)
    build_na_detail_topology(script_dir, output_dir)
    build_runtime_political_topology(script_dir, output_dir)

    print("[INFO] Generating Hierarchy Data....")
    generate_hierarchy.main()

    print("[INFO] Normalizing GEO keys....")
    run_geo_alias_normalization(output_dir)

    print("[INFO] Syncing Translations....")
    translation_result = translate_manager.sync_translations(
        topology_path=output_dir / "europe_topology.na_v2.json",
        output_path=output_dir / "locales.json",
        geo_aliases_path=output_dir / "geo_aliases.json",
        hierarchy_path=output_dir / "hierarchy.json",
        machine_translate=False,
        network_mode="off",
    )
    print(
        "[INFO] Translation sync result: "
        f"geo_missing_like={translation_result['geo_missing_like']}, "
        f"todo_markers={translation_result['geo_literal_todo_markers']}, "
        f"mt_requests={translation_result['mt_requests']}"
    )

    build_mt_mode = str(os.environ.get("MAPCREATOR_BUILD_MT", "off")).strip().lower()
    if build_mt_mode in {"auto", "on"}:
        print(f"[INFO] Running optional machine translation pass (mode={build_mt_mode})....")
        translation_result = translate_manager.sync_translations(
            topology_path=output_dir / "europe_topology.na_v2.json",
            output_path=output_dir / "locales.json",
            geo_aliases_path=output_dir / "geo_aliases.json",
            hierarchy_path=output_dir / "hierarchy.json",
            machine_translate=True,
            translator_delay_seconds=0.05,
            max_machine_translations=2500,
            auto_country_codes="visible-missing",
            network_mode=build_mt_mode,
        )
        print(
            "[INFO] Optional translation result: "
            f"geo_missing_like={translation_result['geo_missing_like']}, "
            f"todo_markers={translation_result['geo_literal_todo_markers']}, "
            f"mt_requests={translation_result['mt_requests']}"
        )

    write_data_manifest(output_dir)
    validate_build_outputs(output_dir, strict=args.strict)
    print(f"Features with missing CNTR_CODE: {final_hybrid['cntr_code'].isnull().sum()}")
    print("Done.")


if __name__ == "__main__":
    main()
