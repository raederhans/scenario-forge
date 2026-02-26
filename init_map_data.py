"""Initialize and prepare NUTS-3 map data for Map Creator."""
from __future__ import annotations

import math
import sys
import subprocess
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


ensure_packages(["geopandas", "matplotlib", "mapclassify", "requests", "shapely", "topojson"])

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import box

from map_builder import config as cfg
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
from map_builder.processors.poland import apply_poland_replacement
from map_builder.processors.russia_ukraine import apply_russia_ukraine_replacement
from map_builder.processors.south_asia import apply_south_asia_replacement
from map_builder.processors.special_zones import build_special_zones
from map_builder.outputs.save import save_outputs
from tools import generate_hierarchy, geo_key_normalizer, translate_manager

GLOBAL_OCEAN_MIN_BBOX_WIDTH = 220.0
GLOBAL_OCEAN_MIN_BBOX_HEIGHT = 90.0


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


def main() -> None:
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
        hybrid = apply_south_asia_replacement(hybrid, land_bg_clipped)

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

    script_dir = Path(__file__).resolve().parent
    output_dir = script_dir / "data"
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
    build_ru_city_detail_topology(script_dir, output_dir)

    print("[INFO] Generating Hierarchy Data....")
    generate_hierarchy.main()

    print("[INFO] Normalizing GEO keys....")
    geo_key_normalizer.main()

    print("[INFO] Syncing Translations....")
    translate_manager.main()

    print(f"Features with missing CNTR_CODE: {final_hybrid['cntr_code'].isnull().sum()}")
    print("Done.")


if __name__ == "__main__":
    main()
