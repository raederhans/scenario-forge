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
import tempfile
import time
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


def require_packages(packages: Iterable[str]) -> None:
    missing = []
    for name in packages:
        if find_spec(name) is None:
            missing.append(name)
    if not missing:
        return
    missing_list = ", ".join(sorted(missing))
    raise SystemExit(
        "Missing required Python packages. Install them before running init_map_data.py: "
        f"{missing_list}"
    )


def _peek_requested_mode(argv: list[str]) -> str:
    for index, arg in enumerate(argv):
        if arg == "--mode" and index + 1 < len(argv):
            return str(argv[index + 1]).strip().lower()
        if arg.startswith("--mode="):
            return str(arg.split("=", 1)[1]).strip().lower()
    return "all"


def _read_json_strict_light(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_json_optional_light(path: Path | None, *, default: object = None) -> object:
    if path is None or not path.exists():
        return default
    try:
        return _read_json_strict_light(path)
    except (OSError, ValueError, json.JSONDecodeError):
        return default


def _write_json_atomic_light(
    path: Path,
    payload: object,
    *,
    ensure_ascii: bool = False,
    indent: int | None = 2,
    separators: tuple[str, str] | None = None,
    allow_nan: bool = True,
    trailing_newline: bool = False,
) -> None:
    text = json.dumps(
        payload,
        ensure_ascii=ensure_ascii,
        indent=indent,
        separators=separators,
        allow_nan=allow_nan,
    )
    if trailing_newline:
        text += "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
        temp_path.replace(path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


REQUESTED_MODE = _peek_requested_mode(sys.argv[1:])

if REQUESTED_MODE != "palettes":
    require_packages([
        "contourpy",
        "geopandas",
        "matplotlib",
        "mapclassify",
        "rasterio",
        "requests",
        "shapely",
        "topojson",
    ])

    import geopandas as gpd
    import pandas as pd
    import requests
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
else:  # pragma: no cover - palettes mode does not touch GIS stack
    gpd = None
    pd = None
    requests = None
    Polygon = None
    box = None
    unary_union = None

from map_builder import build_orchestrator, config as cfg
from map_builder.contracts import DATA_ARTIFACT_SPECS_BY_PATH

if REQUESTED_MODE != "palettes":
    from map_builder.cities import (
        assign_stable_urban_area_ids,
        build_city_aliases_payload,
        build_world_cities,
        emit_default_scenario_city_assets,
    )
    from map_builder.geo.local_canonicalization import (
        LOCAL_CANONICAL_COUNTRY_CODES,
        collect_topology_country_metrics,
    )
    from map_builder.geo.topology import build_topology, _repair_geometry, _extract_country_code_from_id
    from map_builder.geo.utils import (
        clip_to_map_bounds,
        pick_column,
        smart_island_cull,
    )
    from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_geojson
    from map_builder.io.readers import (
        load_physical,
        load_rivers,
        load_urban,
        read_json_optional,
        read_json_strict,
    )
    from map_builder.io.writers import write_json_atomic
    from map_builder.processors.admin1 import build_extension_admin1, extract_country_code
    from map_builder.processors.china import apply_china_replacement
    from map_builder.processors.detail_shell_coverage import (
        DEFAULT_SHELL_COVERAGE_SPECS,
        SHELL_COVERAGE_MIN_AREA_KM2,
        collect_shell_coverage_gaps,
    )
    from map_builder.processors.denmark_border_detail import apply_denmark_border_detail
    from map_builder.processors.france import apply_holistic_replacements
    from map_builder.processors.north_america import apply_north_america_replacement
    from map_builder.processors.physical_context import build_and_save_physical_context_layers
    from map_builder.processors.poland import apply_poland_replacement
    from map_builder.processors.russia_ukraine import apply_russia_ukraine_replacement
    from map_builder.processors.south_asia import apply_south_asia_replacement
    from map_builder.processors.special_zones import build_special_zones
    from map_builder.outputs.save import save_outputs
    from tools import generate_hierarchy, geo_key_normalizer, translate_manager
else:  # pragma: no cover - palettes mode avoids GIS/runtime build imports
    assign_stable_urban_area_ids = None
    build_city_aliases_payload = None
    build_world_cities = None
    emit_default_scenario_city_assets = None
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
    DEFAULT_SHELL_COVERAGE_SPECS = {}
    SHELL_COVERAGE_MIN_AREA_KM2 = 1.0
    collect_shell_coverage_gaps = None
    apply_denmark_border_detail = None
    apply_holistic_replacements = None
    apply_north_america_replacement = None
    build_and_save_physical_context_layers = None
    apply_poland_replacement = None
    apply_russia_ukraine_replacement = None
    apply_south_asia_replacement = None
    build_special_zones = None
    save_outputs = None
    generate_hierarchy = None
    geo_key_normalizer = None
    translate_manager = None
    read_json_optional = _read_json_optional_light
    read_json_strict = _read_json_strict_light
    write_json_atomic = _write_json_atomic_light
    LOCAL_CANONICAL_COUNTRY_CODES = ()
    collect_topology_country_metrics = None

PROJECT_ROOT = Path(__file__).resolve().parent
D3_VENDOR_PATH = PROJECT_ROOT / 'vendor' / 'd3.v7.min.js'
TOPOJSON_VENDOR_PATH = PROJECT_ROOT / 'vendor' / 'topojson-client.min.js'
BUILD_STAGE_CACHE_FILENAME = ".build_stage_cache.json"
MODERN_CITY_LIGHTS_ASSET_PATH = PROJECT_ROOT / "js" / "core" / "city_lights_modern_asset.js"
HISTORICAL_1930_CITY_LIGHTS_ASSET_PATH = PROJECT_ROOT / "js" / "core" / "city_lights_historical_1930_asset.js"

GLOBAL_OCEAN_MIN_BBOX_WIDTH = 220.0
GLOBAL_OCEAN_MIN_BBOX_HEIGHT = 90.0
ALLOWED_SENTINEL_FEATURE_IDS = {
    "GAZ+00?",
    "WEB+00?",
    "RUS+99?",
    "CO_ADM1_COL+99?",
    "VE_ADM1_VEN+99?",
}
DETAIL_OVERLAY_WARN_THRESHOLD = 0.90
ALLOWED_DETAIL_OVERLAY_SUPPORT_TIERS = {
    "GB": {"nuts1_basic"},
    "GR": {"adm1_basic"},
}

MAJOR_MARINE_WATER_NAMES = {
    "Arctic Ocean",
    "SOUTHERN OCEAN",
    "North Atlantic Ocean",
    "South Atlantic Ocean",
    "North Pacific Ocean",
    "South Pacific Ocean",
    "INDIAN OCEAN",
    "Black Sea",
    "Philippine Sea",
    "Tasman Sea",
    "Bay of Bengal",
    "South China Sea",
    "Arabian Sea",
    "Beaufort Sea",
    "Caribbean Sea",
    "Gulf of Mexico",
    "Labrador Sea",
    "Hudson Bay",
    "Caspian Sea",
    "Baffin Bay",
    "Gulf of Alaska",
    "Red Sea",
    "Ross Sea",
    "Weddell Sea",
    "Persian Gulf",
    "Celebes Sea",
    "Sulu Sea",
    "Norwegian Sea",
    "Greenland Sea",
    "Banda Sea",
    "Bay of Biscay",
    "Mozambique Channel",
    "Gulf of Guinea",
    "Scotia Sea",
    "Baltic Sea",
    "Barents Sea",
    "North Sea",
    "Irish Sea",
    "Java Sea",
    "Andaman Sea",
    "Yellow Sea",
    "East China Sea",
    "Sea of Okhotsk",
    "Gulf of Aden",
    "Gulf of Oman",
    "Great Australian Bight",
    "Gulf of Carpentaria",
    "Sea of Azov",
    "Sea of Marmara",
    "Salish Sea",
}

MEDITERRANEAN_COMPONENT_NAMES = {
    "Mediterranean Sea",
    "Alboran Sea",
    "Tyrrhenian Sea",
    "Ligurian Sea",
    "Adriatic Sea",
    "Ionian Sea",
    "Aegean Sea",
    "Gulf of Sidra",
    "Strait of Gibraltar",
    "Dardanelles",
    "Sea of Marmara",
    "Gulf of Suez",
}

SEEDED_LAKE_REGION_SPECS = [
    {
        "id": "lake_superior",
        "name": "Lake Superior",
        "label": "Superior",
        "match_names": ["Lake Superior"],
        "water_type": "lake",
        "region_group": "great_lakes",
    },
    {
        "id": "lake_michigan",
        "name": "Lake Michigan",
        "label": "Michigan",
        "match_names": ["Lake Michigan"],
        "water_type": "lake",
        "region_group": "great_lakes",
    },
    {
        "id": "lake_huron",
        "name": "Lake Huron",
        "label": "Huron",
        "match_names": ["Lake Huron"],
        "water_type": "lake",
        "region_group": "great_lakes",
    },
    {
        "id": "lake_erie",
        "name": "Lake Erie",
        "label": "Erie",
        "match_names": ["Lake Erie"],
        "water_type": "lake",
        "region_group": "great_lakes",
    },
    {
        "id": "lake_ontario",
        "name": "Lake Ontario",
        "label": "Ontario",
        "match_names": ["Lake Ontario"],
        "water_type": "lake",
        "region_group": "great_lakes",
    },
    {
        "id": "lake_baikal",
        "name": "Lake Baikal",
        "label": "Baikal",
        "match_names": ["Lake Baikal"],
        "water_type": "lake",
        "region_group": "eurasia_lakes",
    },
    {
        "id": "caspian_sea",
        "name": "Caspian Sea",
        "label": "Caspian",
        "match_names": ["Caspian Sea"],
        "water_type": "inland_sea",
        "region_group": "eurasia_lakes",
        "source_layer": "marine",
    },
    {
        "id": "aral_sea",
        "name": "Aral Sea",
        "label": "Aral Sea",
        "match_names": ["North Aral Sea", "South Aral Sea"],
        "water_type": "inland_sea",
        "region_group": "eurasia_lakes",
    },
    {
        "id": "lake_victoria",
        "name": "Lake Victoria",
        "label": "Victoria",
        "match_names": ["Lake Victoria"],
        "water_type": "lake",
        "region_group": "african_great_lakes",
    },
    {
        "id": "lake_tanganyika",
        "name": "Lake Tanganyika",
        "label": "Tanganyika",
        "match_names": ["Lake Tanganyika"],
        "water_type": "lake",
        "region_group": "african_great_lakes",
    },
    {
        "id": "lake_malawi_nyasa",
        "name": "Lake Malawi / Nyasa",
        "label": "Malawi / Nyasa",
        "match_names": ["Lake Malawi"],
        "water_type": "lake",
        "region_group": "african_great_lakes",
    },
    {
        "id": "lake_ladoga",
        "name": "Lake Ladoga",
        "label": "Ladoga",
        "match_names": ["Lake Ladoga"],
        "water_type": "lake",
        "region_group": "eurasia_lakes",
    },
    {
        "id": "lake_onega",
        "name": "Lake Onega",
        "label": "Onega",
        "match_names": ["Lake Onega"],
        "water_type": "lake",
        "region_group": "eurasia_lakes",
    },
    {
        "id": "lake_balkhash",
        "name": "Lake Balkhash",
        "label": "Balkhash",
        "match_names": ["Lake Balkhash"],
        "water_type": "lake",
        "region_group": "eurasia_lakes",
    },
    {
        "id": "lake_titicaca",
        "name": "Lake Titicaca",
        "label": "Titicaca",
        "match_names": ["Lago Titicaca", "Lake Titicaca"],
        "water_type": "lake",
        "region_group": "andes_lakes",
    },
]

MEDITERRANEAN_REGION_SPECS = [
    {
        "id": "med_gibraltar",
        "name": "Gibraltar Chokepoint",
        "label": "Gibraltar",
        "water_type": "strait",
        "bbox": (-6.25, 35.0, -4.75, 36.4),
        "is_chokepoint": True,
    },
    {
        "id": "med_bosporus_dardanelles",
        "name": "Bosporus-Dardanelles Chokepoint",
        "label": "Bosporus-Dardanelles",
        "water_type": "chokepoint",
        "bbox": (25.4, 39.7, 30.4, 41.5),
        "is_chokepoint": True,
    },
    {
        "id": "med_suez_approach",
        "name": "Suez Approach",
        "label": "Suez",
        "water_type": "chokepoint",
        "bbox": (29.6, 30.2, 34.9, 32.8),
        "is_chokepoint": True,
    },
    {
        "id": "med_adriatic",
        "name": "Adriatic Basin",
        "label": "Adriatic",
        "water_type": "sea",
        "bbox": (12.0, 39.0, 20.7, 45.9),
        "is_chokepoint": False,
    },
    {
        "id": "med_aegean",
        "name": "Aegean Sea",
        "label": "Aegean",
        "water_type": "sea",
        "bbox": (22.0, 34.5, 28.8, 41.4),
        "is_chokepoint": False,
    },
    {
        "id": "med_ionian",
        "name": "Ionian Sea",
        "label": "Ionian",
        "water_type": "sea",
        "bbox": (13.5, 34.0, 22.4, 40.4),
        "is_chokepoint": False,
    },
    {
        "id": "med_tyrr_lig",
        "name": "Tyrrhenian-Ligurian Sea",
        "label": "Tyrrhenian-Ligurian",
        "water_type": "sea",
        "bbox": (6.0, 37.4, 16.6, 45.6),
        "is_chokepoint": False,
    },
    {
        "id": "med_levantine",
        "name": "Levantine Basin",
        "label": "Levantine",
        "water_type": "sea",
        "bbox": (25.0, 30.4, 37.6, 36.9),
        "is_chokepoint": False,
    },
    {
        "id": "med_central_corridor",
        "name": "Central Mediterranean Corridor",
        "label": "Central Mediterranean",
        "water_type": "sea",
        "bbox": (8.0, 32.4, 18.1, 39.6),
        "is_chokepoint": False,
    },
]

ANTARCTIC_POLAR_CRS = "EPSG:3031"
ANTARCTIC_PARTITION_SCHEME = "claim_meridians_v1"
ANTARCTIC_VALIDATION_TOLERANCE_KM2 = 5.0
ANTARCTIC_POLE_CAP_RADIUS_M = 1_000.0
ANTARCTIC_SECTOR_SPECS = [
    {
        "id": "AQ_QML",
        "name": "20W-45E Sector",
        "sector_start_lon": -20.0,
        "sector_end_lon": 45.0,
        "claimants": ["NO"],
    },
    {
        "id": "AQ_AAT_WEST",
        "name": "45E-136E Sector",
        "sector_start_lon": 45.0,
        "sector_end_lon": 136.0,
        "claimants": ["AU"],
    },
    {
        "id": "AQ_ADELIE",
        "name": "136E-142E Sector",
        "sector_start_lon": 136.0,
        "sector_end_lon": 142.0,
        "claimants": ["FR"],
    },
    {
        "id": "AQ_AAT_EAST",
        "name": "142E-160E Sector",
        "sector_start_lon": 142.0,
        "sector_end_lon": 160.0,
        "claimants": ["AU"],
    },
    {
        "id": "AQ_ROSS",
        "name": "160E-150W Sector",
        "sector_start_lon": 160.0,
        "sector_end_lon": -150.0,
        "claimants": ["NZ"],
    },
    {
        "id": "AQ_MARIE_BYRD",
        "name": "150W-90W Sector",
        "sector_start_lon": -150.0,
        "sector_end_lon": -90.0,
        "claimants": [],
        "claim_status": "unclaimed",
    },
    {
        "id": "AQ_PEN_WEST",
        "name": "Peninsula 90W-80W Sector",
        "sector_start_lon": -90.0,
        "sector_end_lon": -80.0,
        "claimants": ["CL"],
    },
    {
        "id": "AQ_PEN_OVERLAP_WEST",
        "name": "Peninsula 80W-74W Overlap Sector",
        "sector_start_lon": -80.0,
        "sector_end_lon": -74.0,
        "claimants": ["GB", "CL"],
    },
    {
        "id": "AQ_PEN_OVERLAP_CORE",
        "name": "Peninsula 74W-53W Overlap Sector",
        "sector_start_lon": -74.0,
        "sector_end_lon": -53.0,
        "claimants": ["GB", "AR", "CL"],
    },
    {
        "id": "AQ_PEN_OVERLAP_EAST",
        "name": "Peninsula 53W-25W Overlap Sector",
        "sector_start_lon": -53.0,
        "sector_end_lon": -25.0,
        "claimants": ["GB", "AR"],
    },
    {
        "id": "AQ_PEN_EAST",
        "name": "Peninsula 25W-20W Sector",
        "sector_start_lon": -25.0,
        "sector_end_lon": -20.0,
        "claimants": ["GB"],
    },
]


def _normalize_antarctic_claim_status(claimants: list[str]) -> str:
    if not claimants:
        return "unclaimed"
    if len(claimants) > 1:
        return "overlapping_claims"
    return "claimed"


def _to_unwrapped_east_longitude(lon: float) -> float:
    east_lon = float(lon)
    if east_lon < 0:
        east_lon += 360.0
    return east_lon


def _compute_antarctic_sector_radius(projected_geom) -> float:
    minx, miny, maxx, maxy = projected_geom.bounds
    return max(4_500_000.0, max(abs(minx), abs(miny), abs(maxx), abs(maxy)) * 1.2)


def _build_antarctic_sector_wedge(
    sector_start_lon: float,
    sector_end_lon: float,
    radius_m: float,
) -> Polygon:
    start_east = _to_unwrapped_east_longitude(sector_start_lon)
    end_east = _to_unwrapped_east_longitude(sector_end_lon)
    if end_east <= start_east:
        end_east += 360.0

    start_angle = math.radians(90.0 - start_east)
    end_angle = math.radians(90.0 - end_east)
    step_count = max(16, int(abs(end_angle - start_angle) / math.radians(1.0)))
    inner_radius_m = max(1.0, float(ANTARCTIC_POLE_CAP_RADIUS_M))
    points: list[tuple[float, float]] = []
    for step_index in range(step_count + 1):
        angle = start_angle + ((end_angle - start_angle) * step_index / step_count)
        points.append((radius_m * math.cos(angle), radius_m * math.sin(angle)))
    # Avoid an exact South Pole apex in WGS84 output. A tiny inner polar arc keeps
    # the sector partition valid while preventing every sector from collapsing to
    # the same 0° / -90° vertex after reprojection.
    for step_index in range(step_count, -1, -1):
        angle = start_angle + ((end_angle - start_angle) * step_index / step_count)
        points.append((inner_radius_m * math.cos(angle), inner_radius_m * math.sin(angle)))
    return Polygon(points)


def _validate_antarctic_sector_partition(
    antarctica_proj,
    sector_geoms_proj: list,
) -> None:
    if not sector_geoms_proj:
        raise SystemExit("[Antarctica] Sectorization failed: no sector geometries were produced.")

    union_geom = _repair_geometry(unary_union(sector_geoms_proj))
    if union_geom is None or union_geom.is_empty:
        raise SystemExit("[Antarctica] Sectorization failed: union geometry is empty.")

    missing_geom = _repair_geometry(antarctica_proj.difference(union_geom))
    extra_geom = _repair_geometry(union_geom.difference(antarctica_proj))
    missing_area_km2 = 0.0 if missing_geom is None or missing_geom.is_empty else missing_geom.area / 1_000_000.0
    extra_area_km2 = 0.0 if extra_geom is None or extra_geom.is_empty else extra_geom.area / 1_000_000.0
    if (
        missing_area_km2 > ANTARCTIC_VALIDATION_TOLERANCE_KM2
        or extra_area_km2 > ANTARCTIC_VALIDATION_TOLERANCE_KM2
    ):
        raise SystemExit(
            "[Antarctica] Sectorization coverage check failed: "
            f"missing={missing_area_km2:.3f} km^2, extra={extra_area_km2:.3f} km^2"
        )
    print(
        "[Antarctica] Sector coverage validated: "
        f"missing={missing_area_km2:.3f} km^2, extra={extra_area_km2:.3f} km^2."
    )


def build_antarctic_sectors(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty or "cntr_code" not in gdf.columns or "geometry" not in gdf.columns:
        return gdf

    normalized_codes = gdf["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    aq_rows = gdf.loc[normalized_codes == "AQ"].copy()
    if aq_rows.empty:
        return gdf

    antarctica_ll = aq_rows.to_crs("EPSG:4326").copy()
    antarctica_geom_ll = _repair_geometry(unary_union(antarctica_ll.geometry.tolist()))
    if antarctica_geom_ll is None or antarctica_geom_ll.is_empty:
        print("[Antarctica] AQ geometry is empty after union; keeping original feature.")
        return gdf

    antarctica_proj = gpd.GeoSeries([antarctica_geom_ll], crs="EPSG:4326").to_crs(ANTARCTIC_POLAR_CRS).iloc[0]
    radius_m = _compute_antarctic_sector_radius(antarctica_proj)
    sector_records: list[dict] = []
    sector_geoms_proj: list = []
    base_row = aq_rows.iloc[0].to_dict()

    for spec in ANTARCTIC_SECTOR_SPECS:
        wedge = _build_antarctic_sector_wedge(
            sector_start_lon=float(spec["sector_start_lon"]),
            sector_end_lon=float(spec["sector_end_lon"]),
            radius_m=radius_m,
        )
        sector_geom_proj = _repair_geometry(antarctica_proj.intersection(wedge))
        if sector_geom_proj is None or sector_geom_proj.is_empty:
            raise SystemExit(f"[Antarctica] Sector {spec['id']} produced empty geometry.")
        sector_geoms_proj.append(sector_geom_proj)
        sector_geom_ll = gpd.GeoSeries([sector_geom_proj], crs=ANTARCTIC_POLAR_CRS).to_crs("EPSG:4326").iloc[0]
        claimants = list(spec.get("claimants", []))
        record = dict(base_row)
        record.update(
            {
                "id": str(spec["id"]).strip(),
                "name": f"Antarctica / {str(spec['name']).strip()}",
                "cntr_code": "AQ",
                "detail_tier": "antarctic_sector",
                "claim_status": str(spec.get("claim_status") or _normalize_antarctic_claim_status(claimants)),
                "claimants": claimants,
                "partition_scheme": ANTARCTIC_PARTITION_SCHEME,
                "sector_start_lon": float(spec["sector_start_lon"]),
                "sector_end_lon": float(spec["sector_end_lon"]),
                "geometry": sector_geom_ll,
            }
        )
        sector_records.append(record)

    _validate_antarctic_sector_partition(antarctica_proj, sector_geoms_proj)

    sector_gdf = gpd.GeoDataFrame(sector_records, geometry="geometry", crs="EPSG:4326")
    sector_gdf["geometry"] = sector_gdf.geometry.apply(_repair_geometry)
    sector_gdf = sector_gdf[sector_gdf.geometry.notna() & ~sector_gdf.geometry.is_empty].copy()
    if len(sector_gdf) != len(ANTARCTIC_SECTOR_SPECS):
        raise SystemExit(
            "[Antarctica] Sectorization output count mismatch: "
            f"expected {len(ANTARCTIC_SECTOR_SPECS)}, got {len(sector_gdf)}"
        )

    base = gdf.loc[normalized_codes != "AQ"].copy()
    combined = pd.concat([base, sector_gdf], ignore_index=True)
    combined = gpd.GeoDataFrame(combined, geometry="geometry", crs="EPSG:4326")
    print(
        "[Antarctica] Replaced AQ shell with "
        f"{len(sector_gdf)} claim-informed sectors ({ANTARCTIC_PARTITION_SCHEME})."
    )
    return combined

try:
    import resource
except Exception:  # pragma: no cover - unavailable on some platforms
    resource = None


def _get_peak_memory_mb() -> float | None:
    if resource is None:
        return None
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:
        return None
    if sys.platform == "darwin":
        return round(float(usage) / (1024 * 1024), 2)
    return round(float(usage) / 1024, 2)


def _record_stage_timing(timings: dict[str, dict], stage_name: str, start_time: float, **extra: object) -> None:
    payload = {
        "wall_time_sec": round(time.perf_counter() - start_time, 3),
        "peak_memory_mb": _get_peak_memory_mb(),
    }
    payload.update(extra)
    timings[stage_name] = payload


def _write_timings_json(path: Path | None, timings: dict[str, dict]) -> None:
    if path is None:
        return
    write_json_atomic(path, timings, ensure_ascii=False, indent=2)


def _candidate_topology_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}.candidate{path.suffix}")


def _previous_topology_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}.previous{path.suffix}")


def _summarize_country_gate_metrics(
    stage_label: str,
    metrics: dict[str, dict[str, float | int]] | None,
) -> None:
    if not metrics:
        print(f"[{stage_label}] No country gate metrics available.")
        return
    for country_code in LOCAL_CANONICAL_COUNTRY_CODES:
        row = metrics.get(country_code, {})
        print(
            f"[{stage_label}] {country_code}: "
            f"features={int(row.get('feature_count', 0) or 0)}, "
            f"gaps={int(row.get('fragment_count', 0) or 0)}, "
            f"total_area_km2={float(row.get('total_area_km2', 0.0) or 0.0):.3f}, "
            f"max_fragment_area_km2={float(row.get('max_fragment_area_km2', 0.0) or 0.0):.3f}, "
            f"arc_shared_ratio={float(row.get('shared_arc_ratio', 0.0) or 0.0):.4f}"
        )


def _validate_candidate_topology_contract(candidate_path: Path, *, label: str) -> list[str]:
    problems: list[str] = []
    if not candidate_path.exists():
        return [f"{label}: candidate output missing ({candidate_path})"]

    ids, duplicates, missing_names, illegal_ids = _extract_political_topology_ids(candidate_path)
    if duplicates:
        problems.append(f"{label}: duplicate ids={len(duplicates)}")
    if illegal_ids:
        problems.append(f"{label}: illegal sentinel ids={len(illegal_ids)}")
    if missing_names:
        problems.append(f"{label}: missing names={len(missing_names)}")

    summary = _topology_summary(candidate_path)
    if summary.get("political_geometries", 0) and not summary.get("has_computed_neighbors", False):
        problems.append(f"{label}: missing computed_neighbors")
    if int(summary.get("world_bounds_geometries", 0) or 0) > 0:
        problems.append(f"{label}: world-bounds geometries={summary['world_bounds_geometries']}")
    if not ids:
        problems.append(f"{label}: zero political ids")
    return problems


def _collect_country_gate_metrics(
    topology_path: Path,
    *,
    primary_topology_path: Path,
) -> dict[str, dict[str, float | int]] | None:
    if collect_topology_country_metrics is None or not topology_path.exists() or not primary_topology_path.exists():
        return None
    primary_shell = _load_political_gdf_from_topology(primary_topology_path)
    allowed_area = _load_topology_object_gdf_from_topology(primary_topology_path, "land")
    return collect_topology_country_metrics(
        topology_path,
        shell_gdf=primary_shell,
        allowed_area_gdf=allowed_area,
        target_country_codes=LOCAL_CANONICAL_COUNTRY_CODES,
    )


def _evaluate_country_gate_metrics(
    baseline_metrics: dict[str, dict[str, float | int]] | None,
    candidate_metrics: dict[str, dict[str, float | int]] | None,
) -> list[str]:
    if not candidate_metrics:
        return ["candidate country metrics unavailable"]

    problems: list[str] = []
    baseline_metrics = baseline_metrics or {}
    for country_code in LOCAL_CANONICAL_COUNTRY_CODES:
        candidate = candidate_metrics.get(country_code, {})
        baseline = baseline_metrics.get(country_code, {})

        candidate_feature_count = int(candidate.get("feature_count", 0) or 0)
        candidate_fragment_count = int(candidate.get("fragment_count", 0) or 0)
        candidate_total_area = float(candidate.get("total_area_km2", 0.0) or 0.0)
        candidate_max_area = float(candidate.get("max_fragment_area_km2", 0.0) or 0.0)
        candidate_shared_ratio = float(candidate.get("shared_arc_ratio", 0.0) or 0.0)

        baseline_feature_count = int(baseline.get("feature_count", 0) or 0)
        baseline_fragment_count = int(baseline.get("fragment_count", 0) or 0)
        baseline_total_area = float(baseline.get("total_area_km2", 0.0) or 0.0)
        baseline_max_area = float(baseline.get("max_fragment_area_km2", 0.0) or 0.0)
        baseline_shared_ratio = float(baseline.get("shared_arc_ratio", 0.0) or 0.0)

        if baseline and candidate_feature_count < baseline_feature_count:
            problems.append(
                f"{country_code}: feature_count regressed {baseline_feature_count}->{candidate_feature_count}"
            )
        if baseline and candidate_total_area > baseline_total_area + 0.25:
            problems.append(
                f"{country_code}: total_area_km2 regressed {baseline_total_area:.3f}->{candidate_total_area:.3f}"
            )
        if baseline and candidate_max_area > baseline_max_area + 0.25:
            problems.append(
                f"{country_code}: max_fragment_area_km2 regressed {baseline_max_area:.3f}->{candidate_max_area:.3f}"
            )
        if (
            baseline
            and candidate_fragment_count > baseline_fragment_count
            and candidate_total_area >= baseline_total_area - 0.25
        ):
            problems.append(
                f"{country_code}: fragment_count regressed {baseline_fragment_count}->{candidate_fragment_count}"
            )
        if baseline and candidate_shared_ratio + 0.01 < baseline_shared_ratio:
            problems.append(
                f"{country_code}: shared_arc_ratio regressed {baseline_shared_ratio:.4f}->{candidate_shared_ratio:.4f}"
            )

        if country_code in {"DE", "GB", "CZ"} and candidate_total_area > SHELL_COVERAGE_MIN_AREA_KM2 + 1e-6:
            problems.append(
                f"{country_code}: total_area_km2 target missed ({candidate_total_area:.3f} > {SHELL_COVERAGE_MIN_AREA_KM2:.3f})"
            )
        if (
            country_code in {"RU", "UA"}
            and baseline_total_area > SHELL_COVERAGE_MIN_AREA_KM2
            and candidate_total_area > baseline_total_area / 10.0
        ):
            problems.append(
                f"{country_code}: order-of-magnitude reduction target missed "
                f"({baseline_total_area:.3f}->{candidate_total_area:.3f})"
            )

    return problems


def _promote_candidate_topology_if_safe(
    *,
    stage_label: str,
    primary_topology_path: Path,
    candidate_path: Path,
    output_path: Path,
    detail_topology_path: Path | None = None,
    override_path: Path | None = None,
) -> None:
    if collect_topology_country_metrics is None:
        shutil.copy2(candidate_path, output_path)
        return

    contract_problems = _validate_candidate_topology_contract(candidate_path, label=stage_label)
    if contract_problems:
        raise SystemExit(f"{stage_label}: candidate contract failed: {'; '.join(contract_problems)}")

    if detail_topology_path is not None:
        try:
            from tools.build_runtime_political_topology import _compose_political_features, _load_topology

            override_collection = _read_json(override_path) if override_path is not None and override_path.exists() else None
            expected_runtime = _compose_political_features(
                primary_topology=_load_topology(primary_topology_path),
                detail_topology=_load_topology(detail_topology_path) if detail_topology_path.exists() else None,
                override_collection=override_collection,
                canonicalize_countries=LOCAL_CANONICAL_COUNTRY_CODES,
            )
            expected_ids = {
                str(feature_id).strip()
                for feature_id in expected_runtime.get("id", [])
                if str(feature_id).strip()
            }
            candidate_ids, _duplicates, _missing_names, _illegal_ids = _extract_political_topology_ids(candidate_path)
            missing_runtime_ids = expected_ids - candidate_ids
            extra_runtime_ids = candidate_ids - expected_ids
            unexpected_extra_ids = {
                feature_id
                for feature_id in extra_runtime_ids
                if not _is_managed_shell_coverage_id(feature_id)
            }
            if missing_runtime_ids or unexpected_extra_ids:
                raise SystemExit(
                    f"{stage_label}: runtime political ids drift: "
                    f"expected={len(expected_ids)}, actual={len(candidate_ids)}, "
                    f"missing={len(missing_runtime_ids)}, extra={len(extra_runtime_ids)}, "
                    f"unexpected_extra={len(unexpected_extra_ids)}"
                )
        except Exception as exc:
            raise SystemExit(f"{stage_label}: runtime political validation failed: {exc}") from exc

    candidate_metrics = _collect_country_gate_metrics(
        candidate_path,
        primary_topology_path=primary_topology_path,
    )
    _summarize_country_gate_metrics(f"{stage_label} candidate", candidate_metrics)

    baseline_metrics = None
    if output_path.exists():
        baseline_metrics = _collect_country_gate_metrics(
            output_path,
            primary_topology_path=primary_topology_path,
        )
        _summarize_country_gate_metrics(f"{stage_label} baseline", baseline_metrics)

    gate_problems = _evaluate_country_gate_metrics(baseline_metrics, candidate_metrics)
    if gate_problems:
        raise SystemExit(f"{stage_label}: candidate gate failed: {'; '.join(gate_problems)}")

    if output_path.exists():
        shutil.copy2(output_path, _previous_topology_path(output_path))
    shutil.copy2(candidate_path, output_path)
    print(f"[{stage_label}] Promoted candidate -> {output_path.name}")


def _read_optional_json(path: Path | None) -> dict | None:
    payload = read_json_optional(path, default=None)
    return payload if isinstance(payload, dict) else None


def _describe_path_state(path: Path) -> dict[str, object]:
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
        }
    stat = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "size": int(stat.st_size),
        "mtime_ns": int(stat.st_mtime_ns),
    }


def _load_build_stage_cache(output_dir: Path) -> dict[str, dict]:
    cache_path = output_dir / BUILD_STAGE_CACHE_FILENAME
    payload = read_json_optional(cache_path, default={})
    return payload if isinstance(payload, dict) else {}


def _write_build_stage_cache(output_dir: Path, cache_payload: dict[str, dict]) -> None:
    cache_path = output_dir / BUILD_STAGE_CACHE_FILENAME
    write_json_atomic(cache_path, cache_payload, ensure_ascii=False, indent=2)


def _compute_stage_signature(
    *,
    stage_name: str,
    inputs: Iterable[Path] = (),
    extra: dict[str, object] | None = None,
) -> str:
    payload = {
        "stage": stage_name,
        "inputs": [_describe_path_state(Path(path)) for path in inputs],
        "extra": extra or {},
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _should_skip_stage(
    *,
    cache_payload: dict[str, dict],
    stage_name: str,
    signature: str,
    outputs: Iterable[Path],
) -> bool:
    record = cache_payload.get(stage_name)
    output_paths = [Path(path) for path in outputs]
    if not output_paths or any(not path.exists() for path in output_paths):
        return False
    return isinstance(record, dict) and record.get("signature") == signature


def _update_stage_cache(
    *,
    cache_payload: dict[str, dict],
    stage_name: str,
    signature: str,
    outputs: Iterable[Path],
) -> None:
    cache_payload[stage_name] = {
        "signature": signature,
        "outputs": [_describe_path_state(Path(path)) for path in outputs],
        "updated_at": datetime.now(timezone.utc).isoformat(),
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


def _clean_water_text(value: object) -> str:
    if value is None:
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text.casefold()


def _resolve_feature_name(row: pd.Series) -> str:
    for column in ("name_en", "NAME_EN", "name", "NAME"):
        if column not in row.index:
            continue
        value = str(row[column] or "").strip()
        if value:
            return value
    return ""


def _infer_water_type(name: str) -> str:
    normalized = _clean_water_text(name)
    if "ocean" in normalized:
        return "ocean"
    if "sea" in normalized:
        return "sea"
    if "gulf" in normalized:
        return "gulf"
    if "bay" in normalized:
        return "bay"
    if "strait" in normalized:
        return "strait"
    if "channel" in normalized:
        return "channel"
    if "bight" in normalized:
        return "bight"
    return "marine_region"


def _slugify_water_id(prefix: str, name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", _clean_water_text(name)).strip("_")
    return f"{prefix}_{slug or 'region'}"


def _select_named_water_features(
    gdf: gpd.GeoDataFrame,
    names: Iterable[str],
) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty:
        return gpd.GeoDataFrame(columns=getattr(gdf, "columns", []), crs="EPSG:4326")
    normalized_targets = {_clean_water_text(name) for name in names if _clean_water_text(name)}
    if not normalized_targets:
        return gdf.iloc[0:0].copy()
    name_columns = [column for column in ("name_en", "NAME_EN", "name", "NAME") if column in gdf.columns]
    if not name_columns:
        return gdf.iloc[0:0].copy()
    mask = pd.Series(False, index=gdf.index)
    for column in name_columns:
        mask = mask | gdf[column].fillna("").astype(str).map(_clean_water_text).isin(normalized_targets)
    return gdf.loc[mask].copy()


def _union_named_water_geometries(
    gdf: gpd.GeoDataFrame,
    match_names: Iterable[str],
):
    selected = _select_named_water_features(gdf, match_names)
    if selected.empty:
        return None
    selected = selected[selected.geometry.notna() & ~selected.geometry.is_empty].copy()
    if selected.empty:
        return None
    selected["geometry"] = selected.geometry.apply(_repair_geometry)
    selected = selected[selected.geometry.notna() & ~selected.geometry.is_empty].copy()
    if selected.empty:
        return None
    geom = unary_union(selected.geometry.tolist())
    geom = _repair_geometry(geom)
    if geom is None or geom.is_empty:
        return None
    return geom


def _build_water_region_records_gdf(records: list[dict]) -> gpd.GeoDataFrame:
    columns = [
        "id",
        "name",
        "label",
        "water_type",
        "region_group",
        "parent_id",
        "neighbors",
        "is_chokepoint",
        "interactive",
        "source_standard",
        "geometry",
    ]
    if not records:
        return gpd.GeoDataFrame(columns=columns, geometry="geometry", crs="EPSG:4326")

    frame = pd.DataFrame.from_records(records)
    for column in columns:
        if column not in frame.columns:
            if column == "geometry":
                frame[column] = None
            elif column in {"is_chokepoint", "interactive"}:
                frame[column] = False
            else:
                frame[column] = ""
    gdf = gpd.GeoDataFrame(frame[columns], geometry="geometry", crs="EPSG:4326")
    gdf["geometry"] = gdf.geometry.apply(_repair_geometry)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    if gdf.empty:
        return gpd.GeoDataFrame(columns=columns, geometry="geometry", crs="EPSG:4326")
    gdf["id"] = gdf["id"].fillna("").astype(str).str.strip()
    gdf = gdf[gdf["id"] != ""].copy()
    gdf["name"] = gdf["name"].fillna("").astype(str).str.strip()
    gdf["label"] = gdf["label"].fillna(gdf["name"]).astype(str).str.strip()
    gdf["water_type"] = gdf["water_type"].fillna("marine_region").astype(str).str.strip()
    gdf["region_group"] = gdf["region_group"].fillna("").astype(str).str.strip()
    gdf["parent_id"] = gdf["parent_id"].fillna("").astype(str).str.strip()
    gdf["neighbors"] = gdf["neighbors"].fillna("").astype(str).str.strip()
    gdf["is_chokepoint"] = gdf["is_chokepoint"].fillna(False).astype(bool)
    gdf["interactive"] = gdf["interactive"].fillna(True).astype(bool)
    gdf["source_standard"] = gdf["source_standard"].fillna("natural_earth").astype(str).str.strip()
    gdf = gdf.sort_values(["region_group", "name", "id"], kind="stable").reset_index(drop=True)
    return gdf


def _compute_water_region_neighbors(water_regions: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if water_regions is None or water_regions.empty:
        return water_regions
    indexed = list(water_regions[["id", "geometry"]].itertuples(index=False, name=None))
    neighbors_by_id: dict[str, set[str]] = {feature_id: set() for feature_id, _ in indexed}
    sindex = water_regions.sindex
    for left_index, (left_id, left_geom) in enumerate(indexed):
        if left_geom is None or left_geom.is_empty:
            continue
        try:
            candidate_indexes = list(sindex.query(left_geom, predicate="intersects"))
        except TypeError:
            candidate_indexes = list(sindex.intersection(left_geom.bounds))
        for right_index in candidate_indexes:
            right_index = int(right_index)
            if right_index <= left_index:
                continue
            right_id, right_geom = indexed[right_index]
            if right_geom is None or right_geom.is_empty:
                continue
            if not (left_geom.touches(right_geom) or left_geom.intersects(right_geom)):
                continue
            neighbors_by_id[left_id].add(right_id)
            neighbors_by_id[right_id].add(left_id)
    out = water_regions.copy()
    out["neighbors"] = out["id"].map(
        lambda feature_id: ",".join(sorted(neighbors_by_id.get(feature_id, set())))
    )
    return out


def _build_mediterranean_water_regions(marine_polys: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    base_geom = _union_named_water_geometries(marine_polys, MEDITERRANEAN_COMPONENT_NAMES)
    if base_geom is None or base_geom.is_empty:
        return _build_water_region_records_gdf([])

    records: list[dict] = []
    remaining_geom = base_geom
    for spec in MEDITERRANEAN_REGION_SPECS:
        candidate_geom = remaining_geom.intersection(box(*spec["bbox"]))
        candidate_geom = _repair_geometry(candidate_geom)
        if candidate_geom is None or candidate_geom.is_empty:
            continue
        remaining_geom = _repair_geometry(remaining_geom.difference(candidate_geom)) or remaining_geom
        records.append(
            {
                "id": spec["id"],
                "name": spec["name"],
                "label": spec["label"],
                "water_type": spec["water_type"],
                "region_group": "mediterranean",
                "parent_id": "mediterranean_basin",
                "neighbors": "",
                "is_chokepoint": bool(spec["is_chokepoint"]),
                "interactive": True,
                "source_standard": "natural_earth+v1_bbox_partition",
                "geometry": candidate_geom,
            }
        )

    remaining_geom = _repair_geometry(remaining_geom)
    if remaining_geom is not None and not remaining_geom.is_empty:
        records.append(
            {
                "id": "med_open_basin",
                "name": "Mediterranean Open Basin",
                "label": "Mediterranean",
                "water_type": "sea",
                "region_group": "mediterranean",
                "parent_id": "mediterranean_basin",
                "neighbors": "",
                "is_chokepoint": False,
                "interactive": True,
                "source_standard": "natural_earth+v1_bbox_partition",
                "geometry": remaining_geom,
            }
        )

    return _build_water_region_records_gdf(records)


def build_water_regions(
    marine_polys: gpd.GeoDataFrame,
    lakes: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    records: list[dict] = []
    mediterranean_targets = {_clean_water_text(name) for name in MEDITERRANEAN_COMPONENT_NAMES}
    inland_marine_targets = {
        _clean_water_text(name)
        for spec in SEEDED_LAKE_REGION_SPECS
        if str(spec.get("source_layer", "lakes")).strip().lower() == "marine"
        for name in spec.get("match_names", [])
    }
    excluded_marine_targets = mediterranean_targets | inland_marine_targets

    selected_marine = _select_named_water_features(marine_polys, MAJOR_MARINE_WATER_NAMES)
    seen_ids: set[str] = set()
    for row in selected_marine.itertuples(index=False):
        row_series = pd.Series(row._asdict())
        name = _resolve_feature_name(row_series)
        if not name:
            continue
        normalized_name = _clean_water_text(name)
        if normalized_name in excluded_marine_targets:
            continue
        geometry = _repair_geometry(getattr(row, "geometry", None))
        if geometry is None or geometry.is_empty:
            continue
        feature_id = _slugify_water_id("marine", name)
        if feature_id in seen_ids:
            continue
        seen_ids.add(feature_id)
        water_type = _infer_water_type(name)
        is_open_ocean = water_type == "ocean"
        records.append(
            {
                "id": feature_id,
                "name": name,
                "label": name,
                "water_type": water_type,
                "region_group": "ocean_macro" if is_open_ocean else "marine_macro",
                "parent_id": "",
                "neighbors": "",
                "is_chokepoint": False,
                "interactive": not is_open_ocean,
                "source_standard": "natural_earth",
                "geometry": geometry,
            }
        )

    for spec in SEEDED_LAKE_REGION_SPECS:
        source_layer = str(spec.get("source_layer", "lakes")).strip().lower()
        source_gdf = marine_polys if source_layer == "marine" else lakes
        geometry = _union_named_water_geometries(source_gdf, spec["match_names"])
        if geometry is None or geometry.is_empty:
            print(f"[Water Regions] WARNING: could not resolve {spec['name']} from {source_layer}.")
            continue
        records.append(
            {
                "id": spec["id"],
                "name": spec["name"],
                "label": spec["label"],
                "water_type": spec["water_type"],
                "region_group": spec["region_group"],
                "parent_id": "",
                "neighbors": "",
                "is_chokepoint": False,
                "interactive": True,
                "source_standard": f"natural_earth_{source_layer}",
                "geometry": geometry,
            }
        )

    mediterranean_regions = _build_mediterranean_water_regions(marine_polys)
    water_regions = _build_water_region_records_gdf(records)
    if mediterranean_regions is not None and not mediterranean_regions.empty:
        water_regions = gpd.GeoDataFrame(
            pd.concat([water_regions, mediterranean_regions], ignore_index=True),
            geometry="geometry",
            crs="EPSG:4326",
        )
        water_regions = _build_water_region_records_gdf(water_regions.to_dict("records"))
    water_regions = _compute_water_region_neighbors(water_regions)
    print(f"[Water Regions] Built {len(water_regions)} named water regions.")
    return water_regions


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

    aggfunc = {
        column: "first"
        for column in filtered.columns
        if column not in {"geometry", "id"}
    }
    dissolved = filtered.dissolve(by="id", aggfunc=aggfunc)
    dissolved = dissolved.reset_index()
    if dissolved.crs is None and gdf.crs is not None:
        dissolved = dissolved.set_crs(gdf.crs, allow_override=True)
    dissolved["geometry"] = dissolved.geometry.simplify(
        tolerance=tolerance, preserve_topology=True
    )
    missing_cols = sorted(
        {column for column in gdf.columns if column != "geometry"} - set(dissolved.columns)
    )
    if missing_cols:
        raise ValueError(f"Despeckle dropped required columns: {missing_cols}")
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


def build_ru_city_detail_topology(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
) -> None:
    stage_name = "ru_city_detail_topology"
    stage_start = time.perf_counter()
    source_topology = output_dir / "europe_topology.json.bak"
    if not source_topology.exists():
        print(
            "[RU City Detail] Skipped: source detail topology not found at "
            f"{source_topology}."
        )
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, reason="missing-source")
        return

    patch_script = script_dir / "tools" / "patch_ru_city_detail.py"
    if not patch_script.exists():
        print(f"[RU City Detail] Skipped: patch script missing at {patch_script}.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, reason="missing-script")
        return

    ru_adm2_path = output_dir / cfg.RUS_ADM2_FILENAME
    if not ru_adm2_path.exists():
        print("[RU City Detail] Downloading Russia ADM2 (geoBoundaries)...")
        fetch_or_load_geojson(
            cfg.RUS_ADM2_URL,
            cfg.RUS_ADM2_FILENAME,
            fallback_urls=cfg.RUS_ADM2_FALLBACK_URLS,
        )

    output_path = output_dir / "europe_topology.highres.json"
    signature = _compute_stage_signature(
        stage_name=stage_name,
        inputs=[
            Path(__file__),
            patch_script,
            source_topology,
            ru_adm2_path,
            PROJECT_ROOT / "map_builder" / "config.py",
        ],
        extra={"output": str(output_path)},
    )
    if build_stage_cache is not None and _should_skip_stage(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=[output_path],
    ):
        print("[RU City Detail] Skipped: cache hit.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return

    child_timings_path = timings_root / f"{stage_name}.json" if timings_root is not None else None
    cmd = [
        sys.executable,
        str(patch_script),
        "--source-topology",
        str(source_topology),
        "--output-topology",
        str(output_path),
        "--ru-adm2",
        str(ru_adm2_path),
    ]
    if child_timings_path is not None:
        child_timings_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--timings-json", str(child_timings_path)])
    print("[RU City Detail] Building patched detail topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[RU City Detail] Failed to patch detail topology: {exc}")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, failed=True)
        return
    if build_stage_cache is not None:
        _update_stage_cache(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=[output_path],
        )
    if stage_timings is not None:
        _record_stage_timing(
            stage_timings,
            stage_name,
            stage_start,
            skipped=False,
            child_timings=_read_optional_json(child_timings_path),
        )


def build_na_detail_topology(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
) -> None:
    stage_name = "detail_topology"
    stage_start = time.perf_counter()
    primary_topology = output_dir / "europe_topology.json"
    source_topology = output_dir / "europe_topology.highres.json"
    if not source_topology.exists():
        source_topology = output_dir / "europe_topology.json.bak"
    if not source_topology.exists():
        print("[Detail Bundle] Skipped: no source detail topology found.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, reason="missing-source")
        return

    patch_script = script_dir / "tools" / "build_na_detail_topology.py"
    if not patch_script.exists():
        print(f"[Detail Bundle] Skipped: patch script missing at {patch_script}.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, reason="missing-script")
        return

    output_path = output_dir / "europe_topology.na_v2.json"
    candidate_path = _candidate_topology_path(output_path)
    signature = _compute_stage_signature(
        stage_name=stage_name,
        inputs=[
            Path(__file__),
            patch_script,
            source_topology,
            PROJECT_ROOT / "map_builder" / "config.py",
            PROJECT_ROOT / "map_builder" / "geo" / "local_canonicalization.py",
            PROJECT_ROOT / "map_builder" / "processors" / "detail_shell_coverage.py",
            PROJECT_ROOT / "map_builder" / "processors" / "russia_ukraine.py",
        ],
        extra={"output": str(output_path)},
    )
    if build_stage_cache is not None and _should_skip_stage(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=[output_path],
    ):
        print("[Detail Bundle] Skipped: cache hit.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return

    child_timings_path = timings_root / f"{stage_name}.json" if timings_root is not None else None
    cmd = [
        sys.executable,
        str(patch_script),
        "--source-topology",
        str(source_topology),
        "--output-topology",
        str(candidate_path),
    ]
    if child_timings_path is not None:
        child_timings_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--timings-json", str(child_timings_path)])
    print("[Detail Bundle] Building enriched detail topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[Detail Bundle] Failed to build enriched detail topology: {exc}")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, failed=True)
        return
    try:
        if primary_topology.exists():
            _promote_candidate_topology_if_safe(
                stage_label="Detail Bundle",
                primary_topology_path=primary_topology,
                candidate_path=candidate_path,
                output_path=output_path,
            )
        elif candidate_path.exists():
            shutil.copy2(candidate_path, output_path)
            print("[Detail Bundle] Promoted candidate without baseline comparison.")
    except BaseException:
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, failed=True, gate_failed=True)
        raise
    if build_stage_cache is not None:
        _update_stage_cache(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=[output_path],
        )
    if stage_timings is not None:
        _record_stage_timing(
            stage_timings,
            stage_name,
            stage_start,
            skipped=False,
            child_timings=_read_optional_json(child_timings_path),
        )


def build_runtime_political_topology(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
) -> None:
    stage_name = "runtime_political_topology"
    stage_start = time.perf_counter()
    primary_topology = output_dir / "europe_topology.json"
    detail_topology = output_dir / "europe_topology.na_v2.json"
    runtime_script = script_dir / "tools" / "build_runtime_political_topology.py"

    if not primary_topology.exists():
        print("[Runtime Political] Skipped: primary topology not found.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, reason="missing-primary")
        return
    if not runtime_script.exists():
        print(f"[Runtime Political] Skipped: script missing at {runtime_script}.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, reason="missing-script")
        return

    output_path = output_dir / "europe_topology.runtime_political_v1.json"
    candidate_path = _candidate_topology_path(output_path)
    ru_overrides_path = output_dir / "ru_city_overrides.geojson"
    signature = _compute_stage_signature(
        stage_name=stage_name,
        inputs=[
            Path(__file__),
            runtime_script,
            primary_topology,
            detail_topology,
            ru_overrides_path,
            PROJECT_ROOT / "map_builder" / "config.py",
            PROJECT_ROOT / "map_builder" / "geo" / "local_canonicalization.py",
            PROJECT_ROOT / "map_builder" / "processors" / "detail_shell_coverage.py",
        ],
        extra={"output": str(output_path)},
    )
    if build_stage_cache is not None and _should_skip_stage(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=[output_path],
    ):
        print("[Runtime Political] Skipped: cache hit.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return

    child_timings_path = timings_root / f"{stage_name}.json" if timings_root is not None else None
    cmd = [
        sys.executable,
        str(runtime_script),
        "--primary-topology",
        str(primary_topology),
        "--detail-topology",
        str(detail_topology),
        "--ru-overrides",
        str(ru_overrides_path),
        "--output-topology",
        str(candidate_path),
    ]
    if child_timings_path is not None:
        child_timings_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--timings-json", str(child_timings_path)])
    print("[Runtime Political] Building unified runtime political topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[Runtime Political] Failed to build unified runtime topology: {exc}")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, failed=True)
        return
    try:
        _promote_candidate_topology_if_safe(
            stage_label="Runtime Political",
            primary_topology_path=primary_topology,
            candidate_path=candidate_path,
            output_path=output_path,
            detail_topology_path=detail_topology,
            override_path=ru_overrides_path,
        )
    except BaseException:
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, failed=True, gate_failed=True)
        raise
    if build_stage_cache is not None:
        _update_stage_cache(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=[output_path],
        )
    if stage_timings is not None:
        _record_stage_timing(
            stage_timings,
            stage_name,
            stage_start,
            skipped=False,
            child_timings=_read_optional_json(child_timings_path),
        )


def run_hierarchy_locale_stage(
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
) -> dict[str, object] | None:
    stage_name = "hierarchy_locales"
    stage_start = time.perf_counter()
    topology_path = output_dir / "europe_topology.na_v2.json"
    runtime_topology_path = output_dir / "europe_topology.runtime_political_v1.json"
    baseline_locales_path = PROJECT_ROOT / "data" / "i18n" / "locales_baseline.json"
    translation_audit_path = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "translation_source_audit.json"
    translation_review_queue_path = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "translation_review_queue.json"
    outputs = [
        output_dir / "hierarchy.json",
        output_dir / "geo_aliases.json",
        output_dir / "locales.json",
        translation_audit_path,
        translation_review_queue_path,
    ]
    signature = _compute_stage_signature(
        stage_name=stage_name,
        inputs=[
            Path(__file__),
            PROJECT_ROOT / "tools" / "generate_hierarchy.py",
            PROJECT_ROOT / "tools" / "geo_key_normalizer.py",
            PROJECT_ROOT / "tools" / "translate_manager.py",
            PROJECT_ROOT / "data" / "i18n" / "manual_ui.json",
            PROJECT_ROOT / "data" / "i18n" / "manual_geo_overrides.json",
            PROJECT_ROOT / "data" / "i18n" / "europe_geo_seeds.json",
            baseline_locales_path,
            topology_path,
            runtime_topology_path,
        ],
        extra={"scenario_root": str(output_dir / "scenarios")},
    )
    if build_stage_cache is not None and _should_skip_stage(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=outputs,
    ):
        print("[INFO] Hierarchy/locales stage skipped: cache hit.")
        if stage_timings is not None:
            _record_stage_timing(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return None

    print("[INFO] Generating Hierarchy Data....")
    generate_hierarchy.main()

    print("[INFO] Normalizing GEO keys....")
    run_geo_alias_normalization(output_dir)

    print("[INFO] Syncing Translations....")
    translation_result = translate_manager.sync_translations(
        topology_path=topology_path,
        output_path=output_dir / "locales.json",
        geo_aliases_path=output_dir / "geo_aliases.json",
        hierarchy_path=output_dir / "hierarchy.json",
        runtime_topology_path=runtime_topology_path,
        scenarios_root=output_dir / "scenarios",
        baseline_locales_path=baseline_locales_path,
        audit_report_path=translation_audit_path,
        review_queue_path=translation_review_queue_path,
        machine_translate=False,
        network_mode="off",
    )
    if build_stage_cache is not None:
        _update_stage_cache(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=outputs,
        )
    if stage_timings is not None:
        _record_stage_timing(stage_timings, stage_name, stage_start, skipped=False)
    return translation_result


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
    parser.add_argument(
        "--timings-json",
        type=Path,
        default=None,
        help="Optional path to write per-stage wall time and peak memory stats as JSON.",
    )
    return parser.parse_args()


def _read_json(path: Path) -> dict:
    payload = read_json_strict(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, found {type(payload).__name__}.")
    return payload


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


def _normalize_detail_overlap_country_code(raw_code: object, feature_id: object = None) -> str:
    candidate = re.sub(r"[^A-Z]", "", str(raw_code or "").strip().upper())
    if not candidate:
        candidate = _extract_country_code_from_id(feature_id)
    if not candidate:
        return ""
    return cfg.COUNTRY_CODE_ALIASES.get(candidate, candidate)


def _is_allowed_detail_overlay_support_overlap(
    country_code: object,
    earlier_tier: object,
    later_tier: object,
) -> bool:
    code = str(country_code or "").strip().upper()
    allowed_tiers = ALLOWED_DETAIL_OVERLAY_SUPPORT_TIERS.get(code)
    if not allowed_tiers:
        return False
    earlier = str(earlier_tier or "").strip()
    later = str(later_tier or "").strip()
    return not earlier and later in allowed_tiers



def _scan_detail_overlay_overlap_risks(
    detail_path: Path,
    overlap_threshold: float = DETAIL_OVERLAY_WARN_THRESHOLD,
) -> list[dict[str, object]]:
    if gpd is None or unary_union is None or not detail_path.exists():
        return []

    try:
        from topojson.utils import serialize_as_geojson
    except Exception as exc:
        print(f"[Validate] detail overlap scan skipped: {exc}")
        return []

    topo_payload = _read_json(detail_path)
    if not isinstance(topo_payload, dict):
        return []

    try:
        feature_collection = serialize_as_geojson(topo_payload, objectname="political")
    except Exception as exc:
        print(f"[Validate] detail overlap scan skipped for {detail_path.name}: {exc}")
        return []

    raw_features = feature_collection.get("features", []) if isinstance(feature_collection, dict) else []
    if not isinstance(raw_features, list) or not raw_features:
        return []

    enriched_features: list[dict[str, object]] = []
    for draw_index, feature in enumerate(raw_features):
        if not isinstance(feature, dict):
            continue
        props = dict(feature.get("properties", {}) or {})
        feature_id = str(props.get("id") or feature.get("id") or "").strip()
        country_code = _normalize_detail_overlap_country_code(
            props.get("cntr_code")
            or props.get("CNTR_CODE")
            or props.get("iso_a2")
            or props.get("ISO_A2")
            or props.get("adm0_a2")
            or props.get("ADM0_A2"),
            feature_id=feature_id,
        )
        props["__draw_index"] = draw_index
        props["__canonical_country"] = country_code
        props["__detail_tier"] = str(props.get("detail_tier") or "").strip()
        enriched_features.append(
            {
                "type": "Feature",
                "id": feature.get("id"),
                "properties": props,
                "geometry": feature.get("geometry"),
            }
        )

    if not enriched_features:
        return []

    try:
        gdf = gpd.GeoDataFrame.from_features(enriched_features, crs="EPSG:4326")
    except Exception as exc:
        print(f"[Validate] detail overlap scan skipped for {detail_path.name}: {exc}")
        return []

    if gdf.empty or "geometry" not in gdf.columns:
        return []

    gdf = gdf[gdf["__canonical_country"].astype(str).str.len() > 0].copy()
    if gdf.empty:
        return []

    gdf["geometry"] = gdf.geometry.apply(_repair_geometry)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    if gdf.empty:
        return []

    try:
        gdf = gdf.to_crs("EPSG:6933")
    except Exception:
        pass

    risks: list[dict[str, object]] = []
    for country_code, country_df in gdf.groupby("__canonical_country", sort=True):
        tiers: list[dict[str, object]] = []
        for detail_tier, tier_df in country_df.groupby("__detail_tier", sort=False, dropna=False):
            if tier_df.empty:
                continue
            geometries = [
                _repair_geometry(geom)
                for geom in tier_df.geometry.tolist()
                if geom is not None and not geom.is_empty
            ]
            geometries = [geom for geom in geometries if geom is not None and not geom.is_empty]
            if not geometries:
                continue
            merged_geom = _repair_geometry(unary_union(geometries))
            if merged_geom is None or merged_geom.is_empty:
                continue
            area = float(getattr(merged_geom, "area", 0.0) or 0.0)
            if area <= 0:
                continue
            tiers.append(
                {
                    "country_code": str(country_code).strip(),
                    "detail_tier": str(detail_tier or "").strip(),
                    "feature_count": int(len(tier_df)),
                    "min_draw_index": int(tier_df["__draw_index"].min()),
                    "max_draw_index": int(tier_df["__draw_index"].max()),
                    "geometry": merged_geom,
                    "area": area,
                }
            )

        tiers.sort(key=lambda item: (item["min_draw_index"], item["max_draw_index"], item["detail_tier"]))
        for earlier_index, earlier in enumerate(tiers):
            for later in tiers[earlier_index + 1 :]:
                if int(later["min_draw_index"]) <= int(earlier["max_draw_index"]):
                    continue
                intersection = _repair_geometry(earlier["geometry"].intersection(later["geometry"]))
                if intersection is None or intersection.is_empty:
                    continue
                intersection_area = float(getattr(intersection, "area", 0.0) or 0.0)
                if intersection_area <= 0:
                    continue
                share_earlier = intersection_area / max(float(earlier["area"]), 1e-9)
                share_later = intersection_area / max(float(later["area"]), 1e-9)
                if max(share_earlier, share_later) < overlap_threshold:
                    continue
                if _is_allowed_detail_overlay_support_overlap(
                    country_code,
                    earlier["detail_tier"],
                    later["detail_tier"],
                ):
                    continue
                risks.append(
                    {
                        "country_code": str(country_code).strip(),
                        "earlier_tier": str(earlier["detail_tier"] or "").strip(),
                        "later_tier": str(later["detail_tier"] or "").strip(),
                        "earlier_feature_count": int(earlier["feature_count"]),
                        "later_feature_count": int(later["feature_count"]),
                        "earlier_draw_range": (
                            int(earlier["min_draw_index"]),
                            int(earlier["max_draw_index"]),
                        ),
                        "later_draw_range": (
                            int(later["min_draw_index"]),
                            int(later["max_draw_index"]),
                        ),
                        "share_earlier": float(share_earlier),
                        "share_later": float(share_later),
                    }
                )

    return risks


def _load_topology_object_gdf_from_topology(path: Path, object_name: str) -> gpd.GeoDataFrame:
    if gpd is None or not path.exists():
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")

    from topojson.utils import serialize_as_geojson

    topo_payload = _read_json(path)
    feature_collection = serialize_as_geojson(topo_payload, objectname=object_name)
    raw_features = feature_collection.get("features", []) if isinstance(feature_collection, dict) else []
    if not isinstance(raw_features, list) or not raw_features:
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")

    gdf = gpd.GeoDataFrame.from_features(raw_features, crs="EPSG:4326")
    if gdf.empty:
        return gdf
    if "id" not in gdf.columns:
        gdf["id"] = ""
    if "cntr_code" not in gdf.columns:
        gdf["cntr_code"] = ""
    gdf["id"] = gdf["id"].fillna("").astype(str).str.strip()
    gdf["cntr_code"] = gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    gdf["geometry"] = gdf.geometry.apply(_repair_geometry)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    if not gdf.empty and hasattr(gdf.geometry, "is_valid"):
        gdf = gdf[gdf.geometry.is_valid].copy()
    return gdf


def _load_political_gdf_from_topology(path: Path) -> gpd.GeoDataFrame:
    return _load_topology_object_gdf_from_topology(path, "political")


def _validate_shell_coverage(
    *,
    primary_path: Path,
    target_path: Path,
    target_label: str,
    problems: list[str],
    strict: bool,
) -> None:
    if collect_shell_coverage_gaps is None or not primary_path.exists() or not target_path.exists():
        return

    shell_gdf = _load_political_gdf_from_topology(primary_path)
    target_gdf = _load_political_gdf_from_topology(target_path)
    allowed_area_gdf = _load_topology_object_gdf_from_topology(primary_path, "land")
    if shell_gdf.empty or target_gdf.empty:
        return

    gaps = collect_shell_coverage_gaps(
        target_gdf,
        shell_gdf,
        DEFAULT_SHELL_COVERAGE_SPECS,
        exclude_managed_fragments=False,
        allowed_area_gdf=allowed_area_gdf,
        min_area_km2=SHELL_COVERAGE_MIN_AREA_KM2,
    )
    if not gaps:
        print(
            f"[Validate] {target_label}: managed shell coverage OK "
            f"(threshold={SHELL_COVERAGE_MIN_AREA_KM2:.1f} km^2)"
        )
        return

    for gap in gaps:
        message = (
            f"{target_label}: shell coverage gaps for {gap['country_code']} "
            f"fragments={gap['fragment_count']}, total_area_km2={gap['total_area_km2']:.1f}, "
            f"max_fragment_area_km2={gap['max_fragment_area_km2']:.1f}, "
            f"samples={gap['sample_centroids']}"
        )
        print(f"[Validate] {message}")
        if strict:
            problems.append(message)


def _is_managed_shell_coverage_id(feature_id: object) -> bool:
    text = str(feature_id or "").strip()
    if not text:
        return False
    for spec in DEFAULT_SHELL_COVERAGE_SPECS.values():
        prefix = f"{spec.id_prefix}_"
        if text.startswith(prefix):
            return True
    return False


def _collect_nested_string_lists(node: object, key: str) -> set[str]:
    values: set[str] = set()
    if isinstance(node, dict):
        for node_key, node_value in node.items():
            if node_key == key and isinstance(node_value, list):
                values.update(str(item).strip() for item in node_value if str(item).strip())
            else:
                values.update(_collect_nested_string_lists(node_value, key))
    elif isinstance(node, list):
        for item in node:
            values.update(_collect_nested_string_lists(item, key))
    return values


def _validate_releasable_catalog(
    *,
    output_dir: Path,
    runtime_ids: set[str],
    hierarchy_path: Path,
    problems: list[str],
    strict: bool,
) -> None:
    catalog_path = output_dir / "releasables" / "hoi4_vanilla.internal.phase1.catalog.json"
    if not catalog_path.exists():
        return

    payload = _read_json(catalog_path)
    summary = payload.get("summary", {}) if isinstance(payload, dict) else {}
    validation_error_count = int(summary.get("validation_error_count", 0) or 0)
    feature_ids = _collect_nested_string_lists(payload, "feature_ids")
    missing_feature_ids = sorted(feature_ids - runtime_ids)
    hierarchy_payload = _read_json(hierarchy_path) if hierarchy_path.exists() else {}
    hierarchy_groups = hierarchy_payload.get("groups", {}) if isinstance(hierarchy_payload, dict) else {}
    group_ids = _collect_nested_string_lists(payload, "group_ids")
    missing_group_ids = sorted(group_ids - set(hierarchy_groups.keys()))

    print(
        f"[Validate] releasable catalog: entries={summary.get('entry_count')}, "
        f"validation_errors={validation_error_count}, "
        f"missing_feature_ids={len(missing_feature_ids)}, missing_group_ids={len(missing_group_ids)}"
    )
    if strict and validation_error_count > 0:
        problems.append(f"releasable catalog: validation_error_count={validation_error_count}")
    if strict and missing_feature_ids:
        problems.append(f"releasable catalog: missing runtime feature ids={len(missing_feature_ids)}")
    if strict and missing_group_ids:
        problems.append(f"releasable catalog: missing hierarchy groups={len(missing_group_ids)}")


def _run_validation_command(
    cmd: list[str],
    *,
    label: str,
    problems: list[str],
    strict: bool,
) -> None:
    try:
        completed = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
    except Exception as exc:
        problems.append(f"{label}: unable to run validation ({exc})")
        return

    stdout = str(completed.stdout or "").strip()
    stderr = str(completed.stderr or "").strip()
    if stdout:
        print(stdout)
    if stderr:
        print(stderr)
    if strict and completed.returncode != 0:
        problems.append(f"{label}: exit_code={completed.returncode}")


def _validate_dependent_hoi4_assets(
    *,
    output_dir: Path,
    runtime_ids: set[str],
    hierarchy_path: Path,
    problems: list[str],
    strict: bool,
) -> None:
    scenarios_root = output_dir / "scenarios"
    if scenarios_root.exists():
        for scenario_dir in sorted(path for path in scenarios_root.iterdir() if path.is_dir() and path.name.startswith("hoi4_")):
            report_dir = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "scenarios" / scenario_dir.name
            _run_validation_command(
                [
                    sys.executable,
                    str(PROJECT_ROOT / "tools" / "check_hoi4_scenario_bundle.py"),
                    "--scenario-dir",
                    str(scenario_dir),
                    "--report-dir",
                    str(report_dir),
                ],
                label=f"scenario bundle check ({scenario_dir.name})",
                problems=problems,
                strict=strict,
            )

    _validate_releasable_catalog(
        output_dir=output_dir,
        runtime_ids=runtime_ids,
        hierarchy_path=hierarchy_path,
        problems=problems,
        strict=strict,
    )

    with tempfile.TemporaryDirectory(prefix="mapcreator-rk-validate-") as tmp_dir:
        temp_root = Path(tmp_dir)
        _run_validation_command(
            [
                sys.executable,
                str(PROJECT_ROOT / "tools" / "rebuild_reichskommissariat_reference_masks.py"),
                "--check-only",
                "--reports-dir",
                str(temp_root / "reference-masks"),
            ],
            label="reichskommissariat reference mask check",
            problems=problems,
            strict=strict,
        )
        _run_validation_command(
            [
                sys.executable,
                str(PROJECT_ROOT / "tools" / "materialize_hoi4_reichskommissariat_boundaries.py"),
                "--check-only",
                "--report-json",
                str(temp_root / "rk-boundaries.audit.json"),
                "--report-md",
                str(temp_root / "rk-boundaries.audit.md"),
            ],
            label="reichskommissariat boundary materialization check",
            problems=problems,
            strict=strict,
        )


def write_data_manifest(output_dir: Path) -> Path:
    def resolve_manifest_path(file_name: str) -> Path:
        if file_name.startswith("js/"):
            return PROJECT_ROOT / file_name
        return output_dir / file_name

    def parse_generated_js_object_export(path: Path, export_name: str) -> dict[str, object]:
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            return {}
        match = re.search(
            rf"export const {re.escape(export_name)} = Object\.freeze\(\{{(.*?)\}}\);",
            text,
            flags=re.DOTALL,
        )
        if not match:
            return {}
        body = match.group(1)
        payload: dict[str, object] = {}
        for raw_line in body.splitlines():
            line = raw_line.strip().rstrip(",")
            if not line or ":" not in line:
                continue
            key, raw_value = line.split(":", 1)
            key = key.strip()
            raw_value = raw_value.strip()
            if raw_value.startswith('"'):
                payload[key] = json.loads(raw_value)
                continue
            lowered = raw_value.lower()
            if lowered == "true":
                payload[key] = True
                continue
            if lowered == "false":
                payload[key] = False
                continue
            if re.fullmatch(r"-?\d+", raw_value):
                payload[key] = int(raw_value)
                continue
            if re.fullmatch(r"-?\d+\.\d+", raw_value):
                payload[key] = float(raw_value)
        return payload

    def parse_generated_js_number_export(path: Path, export_name: str) -> int | float | None:
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            return None
        match = re.search(rf"export const {re.escape(export_name)} = ([0-9.]+);", text)
        if not match:
            return None
        raw_value = match.group(1)
        return float(raw_value) if "." in raw_value else int(raw_value)

    outputs: dict[str, dict] = {}
    for file_name, artifact_spec in DATA_ARTIFACT_SPECS_BY_PATH.items():
        path = resolve_manifest_path(file_name)
        if not path.exists():
            continue
        item: dict[str, object] = {
            "role": artifact_spec.role,
            "artifact_class": artifact_spec.artifact_class,
            "owner": artifact_spec.owner,
            "description": artifact_spec.description,
            "size_bytes": path.stat().st_size,
            "sha256": _sha256_file(path),
        }
        should_inspect = path.suffix in {".json", ".geojson"} or file_name in {
            "js/core/city_lights_modern_asset.js",
            "js/core/city_lights_historical_1930_asset.js",
        }
        if should_inspect:
            try:
                if "topology" in file_name or file_name.endswith(".topo.json"):
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
                elif file_name == "city_aliases.json":
                    payload = _read_json(path)
                    item.update(
                        {
                            "type": "city_aliases",
                            "entry_count": int(payload.get("entry_count", 0)),
                            "alias_count": int(payload.get("alias_count", 0)),
                            "ambiguous_alias_count": int(payload.get("ambiguous_alias_count", 0)),
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
                elif file_name == "world_cities.geojson":
                    payload = _read_json(path)
                    features = payload.get("features", []) if isinstance(payload, dict) else []
                    capital_count = 0
                    attached_feature_count = 0
                    attached_urban_count = 0
                    for feature in features if isinstance(features, list) else []:
                        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
                        if not isinstance(props, dict):
                            continue
                        if str(props.get("capital_kind") or "").strip() == "country_capital":
                            capital_count += 1
                        if str(props.get("political_feature_id") or "").strip():
                            attached_feature_count += 1
                        if str(props.get("urban_area_id") or "").strip():
                            attached_urban_count += 1
                    item.update(
                        {
                            "type": "world_cities",
                            "feature_count": len(features) if isinstance(features, list) else 0,
                            "country_capital_count": capital_count,
                            "attached_feature_count": attached_feature_count,
                            "attached_urban_count": attached_urban_count,
                        }
                    )
                elif file_name == "js/core/city_lights_modern_asset.js":
                    stats = parse_generated_js_object_export(path, "MODERN_CITY_LIGHTS_STATS")
                    grid_width = parse_generated_js_number_export(path, "MODERN_CITY_LIGHTS_GRID_WIDTH")
                    grid_height = parse_generated_js_number_export(path, "MODERN_CITY_LIGHTS_GRID_HEIGHT")
                    item.update(
                        {
                            "type": "modern_city_lights_asset",
                            "grid_width": grid_width,
                            "grid_height": grid_height,
                            "stats": stats,
                        }
                    )
                elif file_name == "js/core/city_lights_historical_1930_asset.js":
                    stats = parse_generated_js_object_export(path, "HISTORICAL_1930_CITY_LIGHTS_STATS")
                    item.update(
                        {
                            "type": "historical_1930_city_lights_asset",
                            "stats": stats,
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
    write_json_atomic(manifest_path, manifest, ensure_ascii=False, indent=2)
    print(f"[Manifest] Wrote {manifest_path}")
    return manifest_path


def build_city_lights_assets(output_dir: Path) -> None:
    world_cities_path = output_dir / cfg.WORLD_CITIES_FILENAME
    if not world_cities_path.exists():
        raise SystemExit(f"World cities dataset missing; cannot build city lights assets: {world_cities_path}")

    print("[City Lights] Rebuilding modern night-lights asset")
    subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "build_city_lights_modern_asset.py"),
            "--output",
            str(MODERN_CITY_LIGHTS_ASSET_PATH),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )

    print("[City Lights] Rebuilding 1930s electrification proxy asset")
    subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "build_city_lights_historical_1930_asset.py"),
            "--source-file",
            str(world_cities_path),
            "--output",
            str(HISTORICAL_1930_CITY_LIGHTS_ASSET_PATH),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )


def validate_build_outputs(
    output_dir: Path,
    strict: bool = False,
    include_dependent_asset_checks: bool = False,
) -> None:
    problems: list[str] = []

    primary_path = output_dir / "europe_topology.json"
    detail_path = output_dir / "europe_topology.na_v2.json"
    runtime_path = output_dir / "europe_topology.runtime_political_v1.json"
    hierarchy_path = output_dir / "hierarchy.json"
    aliases_path = output_dir / "geo_aliases.json"
    world_cities_path = output_dir / cfg.WORLD_CITIES_FILENAME
    city_aliases_path = output_dir / cfg.CITY_ALIASES_FILENAME
    runtime_ids: set[str] = set()
    if include_dependent_asset_checks:
        for asset_path in [MODERN_CITY_LIGHTS_ASSET_PATH, HISTORICAL_1930_CITY_LIGHTS_ASSET_PATH]:
            if not asset_path.exists():
                problems.append(f"Missing city lights asset: {asset_path.relative_to(PROJECT_ROOT)}")

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
        if topology_path == runtime_path:
            runtime_ids = set(ids)

        if topology_path == detail_path:
            for risk in _scan_detail_overlay_overlap_risks(detail_path):
                earlier_tier = risk["earlier_tier"] or "<leaf>"
                later_tier = risk["later_tier"] or "<leaf>"
                print(
                    "[Validate] detail overlap risk: "
                    f"country={risk['country_code']}, "
                    f"earlier_tier={earlier_tier}, later_tier={later_tier}, "
                    f"earlier_features={risk['earlier_feature_count']}, "
                    f"later_features={risk['later_feature_count']}, "
                    f"overlap_vs_earlier={risk['share_earlier']:.3f}, "
                    f"overlap_vs_later={risk['share_later']:.3f}, "
                    f"earlier_draw={risk['earlier_draw_range']}, "
                    f"later_draw={risk['later_draw_range']}"
                )
                if strict:
                    problems.append(
                        f"{detail_path.name}: high-overlap tiers "
                        f"{risk['country_code']} {earlier_tier}->{later_tier}"
                    )
            _validate_shell_coverage(
                primary_path=primary_path,
                target_path=detail_path,
                target_label=detail_path.name,
                problems=problems,
                strict=strict,
            )
        elif topology_path == runtime_path:
            _validate_shell_coverage(
                primary_path=primary_path,
                target_path=runtime_path,
                target_label=runtime_path.name,
                problems=problems,
                strict=strict,
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

    if city_aliases_path.exists():
        city_aliases_payload = _read_json(city_aliases_path)
        conflict_count = int(city_aliases_payload.get("conflict_count", 0))
        print(f"[Validate] city_aliases.json: conflicts={conflict_count}")
        if strict and conflict_count > 0:
            problems.append(f"city_aliases.json: conflicts={conflict_count}")

    if world_cities_path.exists():
        world_cities_payload = _read_json(world_cities_path)
        features = world_cities_payload.get("features", []) if isinstance(world_cities_payload, dict) else []
        city_ids: list[str] = []
        missing_feature_links = 0
        for feature in features if isinstance(features, list) else []:
            props = feature.get("properties", {}) if isinstance(feature, dict) else {}
            if not isinstance(props, dict):
                continue
            city_id = str(props.get("id") or "").strip()
            if city_id:
                city_ids.append(city_id)
            if not str(props.get("political_feature_id") or "").strip():
                missing_feature_links += 1
        duplicate_count = len(city_ids) - len(set(city_ids))
        print(
            f"[Validate] world_cities.geojson: features={len(features) if isinstance(features, list) else 0}, "
            f"duplicates={duplicate_count}, missing_feature_links={missing_feature_links}"
        )
        if strict and duplicate_count > 0:
            problems.append(f"world_cities.geojson: duplicate ids={duplicate_count}")

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
            missing_runtime_ids = expected_ids - runtime_ids
            extra_runtime_ids = runtime_ids - expected_ids
            unexpected_extra_ids = {
                feature_id
                for feature_id in extra_runtime_ids
                if not _is_managed_shell_coverage_id(feature_id)
            }
            if missing_runtime_ids or unexpected_extra_ids:
                problems.append(
                    "runtime political ids drift: "
                    f"expected={len(expected_ids)}, actual={len(runtime_ids)}, "
                    f"missing={len(missing_runtime_ids)}, extra={len(extra_runtime_ids)}, "
                    f"unexpected_extra={len(unexpected_extra_ids)}"
                )
            elif extra_runtime_ids:
                print(
                    "[Validate] runtime political ids drift accepted: "
                    f"managed_shell_residuals={len(extra_runtime_ids)}"
                )
        except Exception as exc:
            problems.append(f"runtime political validation failed: {exc}")

    if strict and include_dependent_asset_checks and runtime_ids:
        _validate_dependent_hoi4_assets(
            output_dir=output_dir,
            runtime_ids=runtime_ids,
            hierarchy_path=hierarchy_path,
            problems=problems,
            strict=strict,
        )

    if problems:
        for problem in problems:
            print(f"[Validate] WARNING: {problem}")
        if strict:
            raise SystemExit("Strict validation failed. See warnings above.")


def run_geo_alias_normalization(output_dir: Path) -> None:
    topology_path = geo_key_normalizer.resolve_default_topology(Path(__file__).resolve().parent)
    payload = geo_key_normalizer.normalize_geokeys(topology_path)
    output_path = output_dir / "geo_aliases.json"
    write_json_atomic(output_path, payload, ensure_ascii=False, indent=2)
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


def _build_cross_platform_source_candidates(windows_path: str) -> list[Path]:
    normalized = Path(windows_path)
    candidates = [normalized]
    raw_text = str(normalized)
    if len(raw_text) >= 3 and raw_text[1:3] == ":\\":
        drive = raw_text[0].lower()
        suffix = raw_text[2:].replace("\\", "/")
        candidates.append(Path(f"/mnt/{drive}{suffix}"))
    return candidates


def _resolve_palette_job_source_root(windows_path: str) -> tuple[Path | None, list[Path]]:
    candidates = _build_cross_platform_source_candidates(windows_path)
    return _resolve_palette_source_root(candidates), candidates


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

    vanilla_root, vanilla_candidates = _resolve_palette_job_source_root(
        r"C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV"
    )
    palette_jobs = [
        {
            "palette_id": "hoi4_vanilla",
            "display_name": "HOI4 Vanilla",
            "source_variant": "vanilla",
            "manual_map": PROJECT_ROOT / "data/palette-maps/hoi4_vanilla.manual.json",
            "source_root": vanilla_root,
            "source_root_candidates": vanilla_candidates,
            "source_workshop_id": "",
        },
        {
            "palette_id": "kaiserreich",
            "display_name": "Kaiserreich",
            "source_variant": "kaiserreich",
            "manual_map": PROJECT_ROOT / "data/palette-maps/kaiserreich.manual.json",
            "source_root": _resolve_palette_job_source_root(
                r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\1521695605"
            )[0],
            "source_root_candidates": _build_cross_platform_source_candidates(
                r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\1521695605"
            ),
            "source_workshop_id": "1521695605",
        },
        {
            "palette_id": "tno",
            "display_name": "The New Order",
            "source_variant": "tno",
            "manual_map": PROJECT_ROOT / "data/palette-maps/tno.manual.json",
            "source_root": _resolve_palette_job_source_root(
                r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\2438003901"
            )[0],
            "source_root_candidates": _build_cross_platform_source_candidates(
                r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\2438003901"
            ),
            "source_workshop_id": "2438003901",
        },
        {
            "palette_id": "red_flood",
            "display_name": "Red Flood",
            "source_variant": "red_flood",
            "manual_map": PROJECT_ROOT / "data/palette-maps/red_flood.manual.json",
            "source_root": _resolve_palette_job_source_root(
                r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\2815832636"
            )[0],
            "source_root_candidates": _build_cross_platform_source_candidates(
                r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\2815832636"
            ),
            "source_workshop_id": "2815832636",
        },
    ]

    for job in palette_jobs:
        source_root = job["source_root"]
        if source_root is None or not source_root.exists():
            tried_paths = ", ".join(str(path) for path in job["source_root_candidates"])
            message = (
                f"[Palette] Source root missing for {job['palette_id']}. "
                f"Tried: {tried_paths}. "
                "Install or sync the mod into one of those directories."
            )
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


def rebuild_derived_hoi4_assets(output_dir: Path, strict: bool = False) -> bool:
    try:
        from scenario_builder.hoi4.parser import discover_hoi4_source_root
    except Exception as exc:
        message = f"[HOI4 Assets] Unable to import scenario builder: {exc}"
        if strict:
            raise SystemExit(message)
        print(message)
        return False

    try:
        source_root = discover_hoi4_source_root(None)
    except Exception as exc:
        message = f"[HOI4 Assets] Unable to locate HOI4 source root: {exc}"
        if strict:
            raise SystemExit(message)
        print(message)
        return False

    scenario_jobs = [
        {
            "scenario_id": "hoi4_1936",
            "display_name": "HOI4 1936",
            "bookmark_file": "common/bookmarks/the_gathering_storm.txt",
            "manual_rules": ["data/scenario-rules/hoi4_1936.manual.json"],
            "controller_rules": [],
            "scenario_output_dir": "data/scenarios/hoi4_1936",
            "report_dir": ".runtime/reports/generated/scenarios/hoi4_1936",
        },
        {
            "scenario_id": "hoi4_1939",
            "display_name": "HOI4 1939",
            "bookmark_file": "common/bookmarks/blitzkrieg.txt",
            "as_of_date": "1939.8.14.12",
            "manual_rules": [
                "data/scenario-rules/hoi4_1936.manual.json",
                "data/scenario-rules/hoi4_1939.manual.json",
            ],
            "controller_rules": ["data/scenario-rules/hoi4_1939.controller.manual.json"],
            "scenario_output_dir": "data/scenarios/hoi4_1939",
            "report_dir": ".runtime/reports/generated/scenarios/hoi4_1939",
        },
    ]

    for job in scenario_jobs:
        cmd = [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "build_hoi4_scenario.py"),
            "--scenario-id",
            str(job["scenario_id"]),
            "--display-name",
            str(job["display_name"]),
            "--source-root",
            str(source_root),
            "--bookmark-file",
            str(job["bookmark_file"]),
            "--manual-rules",
            ",".join(job["manual_rules"]),
            "--scenario-output-dir",
            str(PROJECT_ROOT / str(job["scenario_output_dir"])),
            "--report-dir",
            str(PROJECT_ROOT / str(job["report_dir"])),
        ]
        if job.get("as_of_date"):
            cmd.extend(["--as-of-date", str(job["as_of_date"])])
        if job.get("controller_rules"):
            cmd.extend(["--controller-rules", ",".join(job["controller_rules"])])
        print(f"[HOI4 Assets] Rebuilding scenario bundle: {job['scenario_id']}")
        subprocess.run(cmd, cwd=PROJECT_ROOT, check=True)

    print("[HOI4 Assets] Rebuilding releasable catalog")
    subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "build_hoi4_releasable_catalog.py"),
            "--source-root",
            str(source_root),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )

    print("[HOI4 Assets] Rebuilding Reichskommissariat reference masks")
    subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "rebuild_reichskommissariat_reference_masks.py"),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )
    subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "materialize_hoi4_reichskommissariat_boundaries.py"),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )

    print("[HOI4 Assets] Patching tno_1962 bundle")
    subprocess.run(
        [
            sys.executable,
            str(PROJECT_ROOT / "tools" / "patch_tno_1962_bundle.py"),
        ],
        cwd=PROJECT_ROOT,
        check=True,
    )
    return True


def run_optional_machine_translation(
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
) -> None:
    build_mt_mode = str(os.environ.get("MAPCREATOR_BUILD_MT", "off")).strip().lower()
    if build_mt_mode not in {"auto", "on"}:
        return
    print(f"[INFO] Running optional machine translation pass (mode={build_mt_mode})....")
    machine_translation_start = time.perf_counter()
    baseline_locales_path = PROJECT_ROOT / "data" / "i18n" / "locales_baseline.json"
    translation_audit_path = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "translation_source_audit.machine_translation.json"
    translation_review_queue_path = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "translation_review_queue.machine_translation.json"
    translation_result = translate_manager.sync_translations(
        topology_path=output_dir / "europe_topology.na_v2.json",
        output_path=output_dir / "locales.json",
        geo_aliases_path=output_dir / "geo_aliases.json",
        hierarchy_path=output_dir / "hierarchy.json",
        runtime_topology_path=output_dir / "europe_topology.runtime_political_v1.json",
        scenarios_root=output_dir / "scenarios",
        baseline_locales_path=baseline_locales_path,
        audit_report_path=translation_audit_path,
        review_queue_path=translation_review_queue_path,
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
    if stage_timings is not None:
        _record_stage_timing(
            stage_timings,
            "machine_translation",
            machine_translation_start,
            mode=build_mt_mode,
            mt_requests=translation_result.get("mt_requests"),
        )


def build_primary_topology_bundle(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
) -> dict[str, object]:
    del script_dir, build_stage_cache, timings_root
    borders = fetch_ne_zip(cfg.BORDERS_URL, "borders")
    borders = clip_to_map_bounds(borders, "borders")
    primary_pipeline_start = time.perf_counter()

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
    filtered = build_antarctic_sectors(filtered)
    validate_political_schema(filtered, "Political Filter")

    rivers_clipped = load_rivers()
    border_lines = build_border_lines()
    ocean = fetch_ne_zip(cfg.OCEAN_URL, "ocean")
    ocean = clip_to_map_bounds(ocean, "ocean")
    marine_polys = fetch_ne_zip(cfg.MARINE_POLYS_URL, "marine polygons")
    marine_polys = clip_to_map_bounds(marine_polys, "marine polygons")
    lakes = fetch_ne_zip(cfg.LAKES_URL, "lakes")
    lakes = clip_to_map_bounds(lakes, "lakes")
    land_bg = fetch_ne_zip(cfg.LAND_BG_URL, "land")
    land_bg = clip_to_map_bounds(land_bg, "land background")
    ocean = ensure_ocean_coverage(
        ocean,
        land_bg,
        target_bounds=getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS),
        stage_label="initial",
    )

    # Keep raw ocean geometry until political bounds are finalized to avoid early bbox clipping artifacts.
    ocean_clipped = ocean.copy()
    ocean_clipped["geometry"] = ocean_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    # Keep raw land background geometry until political bounds are finalized.
    land_bg_clipped = land_bg.copy()
    land_bg_clipped["geometry"] = land_bg_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    water_regions = build_water_regions(marine_polys, lakes)
    water_regions["geometry"] = water_regions.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    urban_clipped = load_urban()
    urban_clipped = urban_clipped.copy()
    urban_clipped["geometry"] = urban_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_URBAN, preserve_topology=True
    )
    physical_filtered = load_physical()
    if physical_filtered.empty:
        print("Physical regions filter returned empty dataset, keeping all clipped features.")
        physical_filtered = fetch_ne_zip(cfg.PHYSICAL_URL, "physical")
        physical_filtered = clip_to_map_bounds(physical_filtered, "physical")
    physical_filtered = physical_filtered.copy()
    physical_filtered["geometry"] = physical_filtered.geometry.simplify(
        tolerance=cfg.SIMPLIFY_PHYSICAL, preserve_topology=True
    )
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

    nuts_hybrid = filtered.copy()
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
        hybrid = apply_denmark_border_detail(hybrid)
        hybrid = apply_russia_ukraine_replacement(hybrid)
        hybrid = apply_poland_replacement(hybrid)
        hybrid = apply_china_replacement(hybrid)
        hybrid = apply_south_asia_replacement(hybrid, land_bg_clipped)
        hybrid = apply_north_america_replacement(hybrid)

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
            china_gdf = hybrid[hybrid["cntr_code"].astype(str).str.upper() == "CN"].copy()
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
        final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[missing_mask, "id"].apply(
            extract_country_code
        )
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
        final_hybrid["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    )
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    if getattr(cfg, "ENABLE_SUBDIVISION_ENRICHMENT", False):
        final_hybrid = apply_config_subdivisions(final_hybrid)

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
            water_regions = clip_to_bounds(water_regions, hybrid_bounds, "water regions")
    except Exception as exc:
        print(f"Background layer clip-to-political-bounds skipped: {exc}")

    ocean_clipped = ensure_ocean_coverage(
        ocean_clipped,
        land_bg_clipped,
        target_bounds=getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS),
        stage_label="pre-topology",
    )

    filtered_group_col = "id" if "id" in filtered.columns else "NUTS_ID"
    filtered = cull_small_geometries(filtered, "land", group_col=filtered_group_col)
    ocean_clipped = cull_small_geometries(ocean_clipped, "ocean")
    land_bg_clipped = cull_small_geometries(land_bg_clipped, "land background")
    water_regions = cull_small_geometries(water_regions, "water regions", group_col="id")
    urban_clipped = cull_small_geometries(urban_clipped, "urban")
    physical_filtered = cull_small_geometries(physical_filtered, "physical")
    hybrid = cull_small_geometries(hybrid, "hybrid", group_col="id")
    final_hybrid = cull_small_geometries(final_hybrid, "political", group_col="id")
    special_zones = cull_small_geometries(special_zones, "special zones", group_col="id")
    urban_clipped = assign_stable_urban_area_ids(urban_clipped)

    target_bounds = getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS)
    log_layer_coverage("political", final_hybrid, target_bounds)
    log_layer_coverage("ocean", ocean_clipped, target_bounds)
    log_layer_coverage("land", land_bg_clipped, target_bounds)
    log_layer_coverage("water_regions", water_regions, target_bounds)
    log_layer_coverage("urban", urban_clipped, target_bounds)
    log_layer_coverage("physical", physical_filtered, target_bounds)
    log_layer_coverage("rivers", rivers_clipped, target_bounds)
    log_layer_coverage("special_zones", special_zones, target_bounds)

    print("[INFO] Building derived physical atlas semantics and contour assets....")
    physical_semantics, contour_major, contour_minor = build_and_save_physical_context_layers(
        physical_filtered,
        output_dir,
    )
    log_layer_coverage("physical_semantics", physical_semantics, target_bounds)
    log_layer_coverage("contours_major", contour_major, target_bounds)
    log_layer_coverage("contours_minor", contour_minor, target_bounds)

    if "id" in final_hybrid.columns:
        final_hybrid["id"] = final_hybrid["id"].fillna("").astype(str).str.strip()
        empty_id_mask = final_hybrid["id"] == ""
        if empty_id_mask.any():
            for idx in final_hybrid.index[empty_id_mask]:
                cc = str(final_hybrid.loc[idx, "cntr_code"] or "UNK").upper()
                final_hybrid.loc[idx, "id"] = f"{cc}_{idx}"
            print(f"[ID Fix] Filled {empty_id_mask.sum()} empty IDs")
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

    world_cities_start = time.perf_counter()
    print("[INFO] Building global city assets....")
    world_cities = build_world_cities(
        political=final_hybrid,
        urban=urban_clipped,
    )
    city_aliases = build_city_aliases_payload(world_cities)
    if stage_timings is not None:
        _record_stage_timing(
            stage_timings,
            "world_cities",
            world_cities_start,
            city_count=len(world_cities),
            alias_count=city_aliases.get("alias_count"),
        )

    save_outputs(
        filtered,
        rivers_clipped,
        border_lines,
        ocean_clipped,
        water_regions,
        land_bg_clipped,
        urban_clipped,
        physical_filtered,
        hybrid,
        final_hybrid,
        world_cities,
        city_aliases,
        output_dir,
    )

    city_lights_assets_start = time.perf_counter()
    build_city_lights_assets(output_dir)
    if stage_timings is not None:
        _record_stage_timing(stage_timings, "city_lights_assets", city_lights_assets_start)

    topology_path = output_dir / "europe_topology.json"
    build_topology(
        political=final_hybrid,
        ocean=ocean_clipped,
        land=land_bg_clipped,
        urban=urban_clipped,
        physical=physical_filtered,
        rivers=rivers_clipped,
        special_zones=special_zones,
        water_regions=water_regions,
        output_path=topology_path,
        quantization=cfg.TOPOLOGY_QUANTIZATION,
    )
    if stage_timings is not None:
        _record_stage_timing(stage_timings, "primary_topology_bundle", primary_pipeline_start)
    return {
        "final_hybrid": final_hybrid,
        "world_cities": world_cities,
        "missing_cntr_code_count": int(final_hybrid["cntr_code"].isnull().sum()),
    }


def _legacy_main_impl() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    output_dir = script_dir / "data"
    build_stage_cache = _load_build_stage_cache(output_dir)
    stage_timings: dict[str, dict] = {}
    timings_root = (
        args.timings_json.parent / f"{args.timings_json.stem}.stages"
        if args.timings_json is not None
        else None
    )
    main_start = time.perf_counter()

    def finalize_build() -> None:
        _record_stage_timing(stage_timings, "total", main_start, mode=args.mode)
        _write_build_stage_cache(output_dir, build_stage_cache)
        _write_timings_json(args.timings_json, stage_timings)

    if args.mode == "detail":
        build_ru_city_detail_topology(
            script_dir,
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
            timings_root=timings_root,
        )
        build_na_detail_topology(
            script_dir,
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
            timings_root=timings_root,
        )
        build_runtime_political_topology(
            script_dir,
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
            timings_root=timings_root,
        )
        manifest_start = time.perf_counter()
        write_data_manifest(output_dir)
        _record_stage_timing(stage_timings, "manifest", manifest_start)
        validation_start = time.perf_counter()
        validate_build_outputs(output_dir, strict=args.strict)
        _record_stage_timing(stage_timings, "validation", validation_start)
        print("Done.")
        finalize_build()
        return

    if args.mode == "i18n":
        translation_result = run_hierarchy_locale_stage(
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
        )
        if translation_result:
            print(
                "[INFO] Translation sync result: "
                f"geo_missing_like={translation_result['geo_missing_like']}, "
                f"todo_markers={translation_result['geo_literal_todo_markers']}, "
                f"mt_requests={translation_result['mt_requests']}"
            )
        manifest_start = time.perf_counter()
        write_data_manifest(output_dir)
        _record_stage_timing(stage_timings, "manifest", manifest_start)
        validation_start = time.perf_counter()
        validate_build_outputs(output_dir, strict=args.strict)
        _record_stage_timing(stage_timings, "validation", validation_start)
        print("Done.")
        finalize_build()
        return

    if args.mode == "palettes":
        print("[INFO] Rebuilding palette assets....")
        palette_start = time.perf_counter()
        run_palette_imports(output_dir, strict=args.strict)
        _record_stage_timing(stage_timings, "palette_assets", palette_start)
        manifest_start = time.perf_counter()
        write_data_manifest(output_dir)
        _record_stage_timing(stage_timings, "manifest", manifest_start)
        validation_start = time.perf_counter()
        validate_build_outputs(output_dir, strict=args.strict)
        _record_stage_timing(stage_timings, "validation", validation_start)
        print("Done.")
        finalize_build()
        return

    borders = fetch_ne_zip(cfg.BORDERS_URL, "borders")
    borders = clip_to_map_bounds(borders, "borders")
    primary_pipeline_start = time.perf_counter()

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
    filtered = build_antarctic_sectors(filtered)
    validate_political_schema(filtered, "Political Filter")

    rivers_clipped = load_rivers()
    border_lines = build_border_lines()
    ocean = fetch_ne_zip(cfg.OCEAN_URL, "ocean")
    ocean = clip_to_map_bounds(ocean, "ocean")
    marine_polys = fetch_ne_zip(cfg.MARINE_POLYS_URL, "marine polygons")
    marine_polys = clip_to_map_bounds(marine_polys, "marine polygons")
    lakes = fetch_ne_zip(cfg.LAKES_URL, "lakes")
    lakes = clip_to_map_bounds(lakes, "lakes")
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
    water_regions = build_water_regions(marine_polys, lakes)
    water_regions["geometry"] = water_regions.geometry.simplify(
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
    nuts_hybrid = filtered.copy()

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
        hybrid = apply_denmark_border_detail(hybrid)
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
            water_regions = clip_to_bounds(water_regions, hybrid_bounds, "water regions")
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
    water_regions = cull_small_geometries(water_regions, "water regions", group_col="id")
    urban_clipped = cull_small_geometries(urban_clipped, "urban")
    physical_filtered = cull_small_geometries(physical_filtered, "physical")
    hybrid = cull_small_geometries(hybrid, "hybrid", group_col="id")
    final_hybrid = cull_small_geometries(final_hybrid, "political", group_col="id")
    special_zones = cull_small_geometries(special_zones, "special zones", group_col="id")
    urban_clipped = assign_stable_urban_area_ids(urban_clipped)

    target_bounds = getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS)
    log_layer_coverage("political", final_hybrid, target_bounds)
    log_layer_coverage("ocean", ocean_clipped, target_bounds)
    log_layer_coverage("land", land_bg_clipped, target_bounds)
    log_layer_coverage("water_regions", water_regions, target_bounds)
    log_layer_coverage("urban", urban_clipped, target_bounds)
    log_layer_coverage("physical", physical_filtered, target_bounds)
    log_layer_coverage("rivers", rivers_clipped, target_bounds)
    log_layer_coverage("special_zones", special_zones, target_bounds)

    print("[INFO] Building derived physical atlas semantics and contour assets....")
    physical_semantics, contour_major, contour_minor = build_and_save_physical_context_layers(
        physical_filtered,
        output_dir,
    )
    log_layer_coverage("physical_semantics", physical_semantics, target_bounds)
    log_layer_coverage("contours_major", contour_major, target_bounds)
    log_layer_coverage("contours_minor", contour_minor, target_bounds)

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

    world_cities_start = time.perf_counter()
    print("[INFO] Building global city assets....")
    world_cities = build_world_cities(
        political=final_hybrid,
        urban=urban_clipped,
    )
    city_aliases = build_city_aliases_payload(world_cities)
    _record_stage_timing(
        stage_timings,
        "world_cities",
        world_cities_start,
        city_count=len(world_cities),
        alias_count=city_aliases.get("alias_count"),
    )

    save_outputs(
        filtered,
        rivers_clipped,
        border_lines,
        ocean_clipped,
        water_regions,
        land_bg_clipped,
        urban_clipped,
        physical_filtered,
        hybrid,
        final_hybrid,
        world_cities,
        city_aliases,
        output_dir,
    )

    city_lights_assets_start = time.perf_counter()
    build_city_lights_assets(output_dir)
    _record_stage_timing(stage_timings, "city_lights_assets", city_lights_assets_start)

    topology_path = output_dir / "europe_topology.json"
    build_topology(
        political=final_hybrid,
        ocean=ocean_clipped,
        land=land_bg_clipped,
        urban=urban_clipped,
        physical=physical_filtered,
        rivers=rivers_clipped,
        special_zones=special_zones,
        water_regions=water_regions,
        output_path=topology_path,
        quantization=cfg.TOPOLOGY_QUANTIZATION,
    )
    _record_stage_timing(stage_timings, "primary_topology_bundle", primary_pipeline_start)
    if args.mode == "primary":
        manifest_start = time.perf_counter()
        write_data_manifest(output_dir)
        _record_stage_timing(stage_timings, "manifest", manifest_start)
        validation_start = time.perf_counter()
        validate_build_outputs(
            output_dir,
            strict=args.strict,
            include_dependent_asset_checks=True,
        )
        _record_stage_timing(stage_timings, "validation", validation_start)
        print(f"Features with missing CNTR_CODE: {final_hybrid['cntr_code'].isnull().sum()}")
        print("Done.")
        finalize_build()
        return

    build_ru_city_detail_topology(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )
    build_na_detail_topology(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )
    build_runtime_political_topology(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )

    translation_result = run_hierarchy_locale_stage(
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
    )
    if translation_result:
        print(
            "[INFO] Translation sync result: "
            f"geo_missing_like={translation_result['geo_missing_like']}, "
            f"todo_markers={translation_result['geo_literal_todo_markers']}, "
            f"mt_requests={translation_result['mt_requests']}"
        )

    build_mt_mode = str(os.environ.get("MAPCREATOR_BUILD_MT", "off")).strip().lower()
    if build_mt_mode in {"auto", "on"}:
        print(f"[INFO] Running optional machine translation pass (mode={build_mt_mode})....")
        machine_translation_start = time.perf_counter()
        baseline_locales_path = PROJECT_ROOT / "data" / "i18n" / "locales_baseline.json"
        translation_audit_path = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "translation_source_audit.machine_translation.json"
        translation_review_queue_path = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "translation_review_queue.machine_translation.json"
        translation_result = translate_manager.sync_translations(
            topology_path=output_dir / "europe_topology.na_v2.json",
            output_path=output_dir / "locales.json",
            geo_aliases_path=output_dir / "geo_aliases.json",
            hierarchy_path=output_dir / "hierarchy.json",
            runtime_topology_path=output_dir / "europe_topology.runtime_political_v1.json",
            scenarios_root=output_dir / "scenarios",
            baseline_locales_path=baseline_locales_path,
            audit_report_path=translation_audit_path,
            review_queue_path=translation_review_queue_path,
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
        _record_stage_timing(
            stage_timings,
            "machine_translation",
            machine_translation_start,
            mode=build_mt_mode,
            mt_requests=translation_result.get("mt_requests"),
        )

    derived_assets_start = time.perf_counter()
    rebuild_derived_hoi4_assets(output_dir, strict=args.strict)
    _record_stage_timing(stage_timings, "derived_hoi4_assets", derived_assets_start)

    scenario_city_assets_start = time.perf_counter()
    emit_default_scenario_city_assets(output_dir, world_cities)
    _record_stage_timing(stage_timings, "scenario_city_assets", scenario_city_assets_start)

    manifest_start = time.perf_counter()
    write_data_manifest(output_dir)
    _record_stage_timing(stage_timings, "manifest", manifest_start)
    validation_start = time.perf_counter()
    validate_build_outputs(
        output_dir,
        strict=args.strict,
        include_dependent_asset_checks=True,
    )
    _record_stage_timing(stage_timings, "validation", validation_start)
    print(f"Features with missing CNTR_CODE: {final_hybrid['cntr_code'].isnull().sum()}")
    print("Done.")
    finalize_build()


def main() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    output_dir = script_dir / "data"
    build_orchestrator.run(args, script_dir, output_dir, stage_ops=sys.modules[__name__])


if __name__ == "__main__":
    main()
