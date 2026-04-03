from __future__ import annotations

import argparse
import ast
import copy
import csv
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter, deque
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import threading

import geopandas as gpd
import numpy as np
import requests
from shapely import make_valid
from rasterio import features as raster_features
from rasterio.transform import Affine
from shapely import affinity
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import snap, unary_union
from shapely.validation import explain_validity
from topojson import Topology
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.geo.topology import compute_neighbor_graph
from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.scenario_locks import scenario_build_lock
from map_builder import scenario_bundle_platform
from map_builder.contracts import (
    SCENARIO_CHECKPOINT_BATHYMETRY_FILENAME as CONTRACT_CHECKPOINT_BATHYMETRY_FILENAME,
    SCENARIO_CHECKPOINT_CONTEXT_LAND_MASK_FILENAME as CONTRACT_CHECKPOINT_CONTEXT_LAND_MASK_FILENAME,
    SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME as CONTRACT_CHECKPOINT_GEO_LOCALE_EN_FILENAME,
    SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME as CONTRACT_CHECKPOINT_GEO_LOCALE_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME as CONTRACT_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME as CONTRACT_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
    SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME as CONTRACT_CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
    SCENARIO_CHECKPOINT_LAND_MASK_FILENAME as CONTRACT_CHECKPOINT_LAND_MASK_FILENAME,
    SCENARIO_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME as CONTRACT_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME,
    SCENARIO_CHECKPOINT_POLITICAL_FILENAME as CONTRACT_CHECKPOINT_POLITICAL_FILENAME,
    SCENARIO_CHECKPOINT_RELIEF_FILENAME as CONTRACT_CHECKPOINT_RELIEF_FILENAME,
    SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME as CONTRACT_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
    SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME as CONTRACT_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
    SCENARIO_CHECKPOINT_STAGE_METADATA_FILENAME as CONTRACT_CHECKPOINT_STAGE_METADATA_FILENAME,
    SCENARIO_CHECKPOINT_WATER_FILENAME as CONTRACT_CHECKPOINT_WATER_FILENAME,
    SCENARIO_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME as CONTRACT_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME,
    SCENARIO_CHECKPOINT_WATER_SEED_FILENAME as CONTRACT_CHECKPOINT_WATER_SEED_FILENAME,
    SCENARIO_PUBLISH_FILENAMES_BY_SCOPE as CONTRACT_PUBLISH_FILENAMES_BY_SCOPE,
    SCENARIO_PUBLISH_SCOPE_ALL as CONTRACT_PUBLISH_SCOPE_ALL,
    SCENARIO_PUBLISH_SCOPE_POLAR_RUNTIME as CONTRACT_PUBLISH_SCOPE_POLAR_RUNTIME,
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA as CONTRACT_PUBLISH_SCOPE_SCENARIO_DATA,
    resolve_scenario_publish_filenames,
)
from scenario_builder.hoi4.audit import read_bmp24
from tools.build_tno_1962_geo_locale_patch import build_patch as build_tno_geo_locale_patch
from tools.build_startup_bootstrap_assets import build_bootstrap_runtime_topology, build_startup_bootstrap_assets
from tools.build_startup_bundle import build_startup_bundles
from tools.check_scenario_contracts import validate_publish_bundle_dir
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets


SCENARIO_ID = "tno_1962"
SCENARIO_DIR = ROOT / f"data/scenarios/{SCENARIO_ID}"
RUNTIME_POLITICAL_PATH = ROOT / "data/europe_topology.runtime_political_v1.json"
FEATURE_MIGRATION_PATH = ROOT / "data/feature-migrations/by_hybrid_v1.json"
REICHSKOMMISSARIAT_ACTIONS_PATH = ROOT / "data/releasables/hoi4_reichskommissariat_boundaries.internal.json"
RELEASABLE_SOURCE_PATH = ROOT / "data/releasables/tno_1962.internal.phase1.source.json"
RELEASABLE_CATALOG_PATH = ROOT / "data/releasables/tno_1962.internal.phase1.catalog.json"
HIERARCHY_PATH = ROOT / "data/hierarchy.json"
TNO_PALETTE_PATH = ROOT / "data/palettes/tno.palette.json"
WATER_REGIONS_PATH = ROOT / "data/water_regions.geojson"
DEFAULT_STARTUP_TOPOLOGY_URL = "data/europe_topology.runtime_political_v1.json"
DEFAULT_CHECKPOINT_DIR = ROOT / ".runtime" / "tmp" / "tno_1962_bundle"
CHECKPOINT_BUILD_LOCK_FILENAME = ".build.lock"
STAGE_ALL = "all"
STAGE_COUNTRIES = "countries"
STAGE_RUNTIME_TOPOLOGY = "runtime_topology"
STAGE_GEO_LOCALE = "geo_locale"
STAGE_STARTUP_ASSETS = "startup_assets"
STAGE_WRITE_BUNDLE = "write_bundle"
STAGE_CHUNK_ASSETS = "chunk_assets"
PUBLISH_SCOPE_POLAR_RUNTIME = CONTRACT_PUBLISH_SCOPE_POLAR_RUNTIME
PUBLISH_SCOPE_SCENARIO_DATA = CONTRACT_PUBLISH_SCOPE_SCENARIO_DATA
PUBLISH_SCOPE_ALL = CONTRACT_PUBLISH_SCOPE_ALL
STAGE_CHOICES = [
    STAGE_ALL,
    STAGE_COUNTRIES,
    STAGE_RUNTIME_TOPOLOGY,
    STAGE_GEO_LOCALE,
    STAGE_STARTUP_ASSETS,
    STAGE_WRITE_BUNDLE,
    STAGE_CHUNK_ASSETS,
]
PUBLISH_SCOPE_CHOICES = [
    PUBLISH_SCOPE_POLAR_RUNTIME,
    PUBLISH_SCOPE_SCENARIO_DATA,
    PUBLISH_SCOPE_ALL,
]
MANUAL_SYNC_POLICY_BACKUP_CONTINUE = "backup-continue"
MANUAL_SYNC_POLICY_WARN_CONTINUE = "warn-continue"
MANUAL_SYNC_POLICY_STRICT_BLOCK = "strict-block"
MANUAL_SYNC_POLICY_CHOICES = [
    MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    MANUAL_SYNC_POLICY_WARN_CONTINUE,
    MANUAL_SYNC_POLICY_STRICT_BLOCK,
]
REGIONAL_RULE_PACKS: list[tuple[str, Path]] = [
    ("africa", ROOT / "data/scenario-rules/tno_1962.africa_ownership.manual.json"),
    ("east_asia", ROOT / "data/scenario-rules/tno_1962.east_asia_ownership.manual.json"),
    ("south_asia", ROOT / "data/scenario-rules/tno_1962.south_asia_ownership.manual.json"),
    ("russia", ROOT / "data/scenario-rules/tno_1962.russia_ownership.manual.json"),
    ("decolonization", ROOT / "data/scenario-rules/tno_1962.decolonization.manual.json"),
]
MODERN_WORLD_COUNTRIES_PATH = ROOT / "data/scenarios/modern_world/countries.json"
MANUAL_OVERRIDE_FILENAME = "scenario_manual_overrides.json"
MANUAL_SYNC_REPORT_DIR = ROOT / ".runtime" / "reports" / "generated" / "manual-sync"
MANUAL_SYNC_BACKUP_ROOT = ROOT / ".runtime" / "backups" / "scenario-rebuild"
STARTUP_BUNDLE_REPORT_PATH = ROOT / ".runtime" / "reports" / "generated" / "startup_bundle_report.json"
_CHECKPOINT_BUILD_LOCK_GUARD = threading.RLock()
_CHECKPOINT_BUILD_LOCK_DEPTHS: dict[str, int] = {}


@contextmanager
def _checkpoint_build_lock(checkpoint_dir: Path, *, stage: str = STAGE_ALL) -> object:
    checkpoint_dir = checkpoint_dir.resolve()
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    lock_path = checkpoint_dir / CHECKPOINT_BUILD_LOCK_FILENAME
    lock_key = str(checkpoint_dir)
    with _CHECKPOINT_BUILD_LOCK_GUARD:
        depth = _CHECKPOINT_BUILD_LOCK_DEPTHS.get(lock_key, 0)
        if depth > 0:
            _CHECKPOINT_BUILD_LOCK_DEPTHS[lock_key] = depth + 1
            acquired_here = False
        else:
            lock_payload = {
                "pid": os.getpid(),
                "stage": stage,
                "cwd": str(ROOT),
                "checkpoint_dir": str(checkpoint_dir),
                "acquired_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                with lock_path.open("x", encoding="utf-8", newline="\n") as handle:
                    json.dump(lock_payload, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
            except FileExistsError as exc:
                existing_lock = None
                existing_pid: int | None = None
                if lock_path.exists():
                    try:
                        existing_lock = load_json(lock_path)
                    except Exception:
                        existing_lock = lock_path.read_text(encoding="utf-8", errors="ignore").strip() or None
                if isinstance(existing_lock, dict):
                    try:
                        existing_pid = int(existing_lock.get("pid"))
                    except (TypeError, ValueError):
                        existing_pid = None
                if existing_pid is not None and existing_pid > 0 and not _pid_is_alive(existing_pid):
                    lock_path.unlink(missing_ok=True)
                    try:
                        with lock_path.open("x", encoding="utf-8", newline="\n") as handle:
                            json.dump(lock_payload, handle, ensure_ascii=False, indent=2)
                            handle.write("\n")
                    except FileExistsError as retry_exc:
                        holder_after_retry = None
                        if lock_path.exists():
                            try:
                                holder_after_retry = load_json(lock_path)
                            except Exception:
                                holder_after_retry = lock_path.read_text(encoding="utf-8", errors="ignore").strip() or None
                        raise RuntimeError(
                            "another build is in progress for checkpoint "
                            f"{checkpoint_dir} (lock: {lock_path}, holder: {holder_after_retry!r})"
                        ) from retry_exc
                else:
                    raise RuntimeError(
                        "another build is in progress for checkpoint "
                        f"{checkpoint_dir} (lock: {lock_path}, holder: {existing_lock!r})"
                    ) from exc
            _CHECKPOINT_BUILD_LOCK_DEPTHS[lock_key] = 1
            acquired_here = True
    try:
        yield
    finally:
        with _CHECKPOINT_BUILD_LOCK_GUARD:
            depth = _CHECKPOINT_BUILD_LOCK_DEPTHS.get(lock_key, 0)
            if depth <= 1:
                _CHECKPOINT_BUILD_LOCK_DEPTHS.pop(lock_key, None)
                if acquired_here:
                    lock_path.unlink(missing_ok=True)
            else:
                _CHECKPOINT_BUILD_LOCK_DEPTHS[lock_key] = depth - 1


@contextmanager
def _scenario_build_session_lock(scenario_dir: Path) -> object:
    with scenario_build_lock(
        root=ROOT,
        scenario_id=SCENARIO_ID,
        scenario_dir=scenario_dir,
        holder="patch_tno_1962_bundle",
    ):
        yield
RUNTIME_ACTIVE_SERVER_METADATA_PATH = ROOT / ".runtime" / "dev" / "active_server.json"
HGO_ROOT = ROOT / "historic geographic overhaul"
TNO_ROOT_CANDIDATES = [
    Path("C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901"),
    Path("/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901"),
    Path("C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/3583339918"),
    Path("/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/3583339918"),
]
TNO_ROOT_ENV_VAR = "SCENARIO_FORGE_TNO_ROOT"
HGO_ROOT_ENV_VAR = "SCENARIO_FORGE_HGO_ROOT"
_CLI_TNO_ROOT_OVERRIDE: Path | None = None
_CLI_HGO_ROOT_OVERRIDE: Path | None = None
TNO_ATLANTIC_OPEN_OCEAN_IDS = (
    "tno_northwest_atlantic_ocean",
    "tno_northeast_atlantic_ocean",
    "tno_west_central_atlantic_ocean",
    "tno_east_central_atlantic_ocean",
    "tno_southwest_atlantic_ocean",
    "tno_southeast_atlantic_ocean",
)
TNO_PACIFIC_OPEN_OCEAN_IDS = (
    "tno_northwest_pacific_ocean",
    "tno_northeast_pacific_ocean",
    "tno_west_central_pacific_ocean",
    "tno_east_central_pacific_ocean",
    "tno_southwest_pacific_ocean",
    "tno_southeast_pacific_ocean",
)
TNO_INDIAN_OPEN_OCEAN_IDS = (
    "tno_western_indian_ocean",
    "tno_eastern_indian_ocean",
    "tno_southern_indian_ocean",
)
TNO_ARCTIC_OPEN_OCEAN_IDS = (
    "tno_western_arctic_ocean",
    "tno_eastern_arctic_ocean",
)
TNO_SOUTHERN_OPEN_OCEAN_IDS = (
    "tno_south_atlantic_antarctic_ocean",
    "tno_south_indian_antarctic_ocean",
    "tno_south_pacific_antarctic_ocean",
)
TNO_OPEN_OCEAN_SPLIT_SPECS = (
    {
        "source_id": "marine_atlantic_ocean",
        "source_ids": (
            "marine_atlantic_ocean",
            "marine_greenland_sea",
            "marine_norwegian_sea",
            "marine_labrador_sea",
            "marine_baffin_bay",
            "marine_bay_of_biscay",
            "marine_north_sea",
            "marine_irish_sea",
            "marine_caribbean_sea",
            "marine_gulf_of_mexico",
            "marine_gulf_of_guinea",
        ),
        "children": (
            {
                "id": TNO_ATLANTIC_OPEN_OCEAN_IDS[0],
                "name": "Northwest Atlantic Ocean",
                "bbox": (-180.0, 20.0, -40.0, 90.0),
                "supplement_bboxes": ((-70.0, 20.0, -40.0, 55.0),),
                "component_min_area": 0.05,
            },
            {
                "id": TNO_ATLANTIC_OPEN_OCEAN_IDS[1],
                "name": "Northeast Atlantic Ocean",
                "bbox": (-40.0, 20.0, 180.0, 90.0),
                "supplement_bboxes": ((-40.0, 20.0, 20.0, 50.0),),
                "component_min_area": 0.05,
            },
            {
                "id": TNO_ATLANTIC_OPEN_OCEAN_IDS[2],
                "name": "West Central Atlantic Ocean",
                "bbox": (-100.0, 0.0, -20.0, 20.0),
                "supplement_bboxes": ((-80.0, 0.0, -20.0, 20.0),),
                "component_min_area": 0.05,
            },
            {
                "id": TNO_ATLANTIC_OPEN_OCEAN_IDS[3],
                "name": "East Central Atlantic Ocean",
                "bbox": (-20.0, 0.0, 20.0, 20.0),
                "supplement_bboxes": ((-20.0, 0.0, 20.0, 20.0),),
                "component_min_area": 0.05,
            },
            {
                "id": TNO_ATLANTIC_OPEN_OCEAN_IDS[4],
                "name": "Southwest Atlantic Ocean",
                "bbox": (-180.0, -90.0, -20.0, 0.0),
            },
            {
                "id": TNO_ATLANTIC_OPEN_OCEAN_IDS[5],
                "name": "Southeast Atlantic Ocean",
                "bbox": (-20.0, -90.0, 180.0, 0.0),
            },
        ),
    },
    {
        "source_id": "marine_pacific_ocean",
        "source_ids": (
            "marine_pacific_ocean",
            "marine_sea_of_okhotsk",
            "marine_east_china_sea",
            "marine_yellow_sea",
            "marine_south_china_sea",
            "marine_philippine_sea",
            "marine_sulu_sea",
            "marine_celebes_sea",
            "marine_gulf_of_alaska",
            "marine_tasman_sea",
        ),
        "children": (
            {
                "id": TNO_PACIFIC_OPEN_OCEAN_IDS[0],
                "name": "Northwest Pacific Ocean",
                "bbox": (100.0, 20.0, 180.0, 90.0),
                "supplement_bboxes": ((130.0, 20.0, 180.0, 50.0),),
                "component_min_area": 0.05,
            },
            {
                "id": TNO_PACIFIC_OPEN_OCEAN_IDS[1],
                "name": "Northeast Pacific Ocean",
                "bbox": (-180.0, 20.0, -100.0, 90.0),
                "supplement_bboxes": ((-170.0, 20.0, -120.0, 60.0),),
                "component_min_area": 0.05,
            },
            {
                "id": TNO_PACIFIC_OPEN_OCEAN_IDS[2],
                "name": "West Central Pacific Ocean",
                "bboxes": ((110.0, -20.0, 180.0, 20.0), (-180.0, -20.0, -150.0, 20.0)),
            },
            {
                "id": TNO_PACIFIC_OPEN_OCEAN_IDS[3],
                "name": "East Central Pacific Ocean",
                "bbox": (-150.0, -20.0, -80.0, 20.0),
            },
            {
                "id": TNO_PACIFIC_OPEN_OCEAN_IDS[4],
                "name": "Southwest Pacific Ocean",
                "bboxes": ((120.0, -90.0, 180.0, -20.0), (-180.0, -90.0, -160.0, -20.0)),
            },
            {
                "id": TNO_PACIFIC_OPEN_OCEAN_IDS[5],
                "name": "Southeast Pacific Ocean",
                "bbox": (-160.0, -90.0, -70.0, -20.0),
            },
        ),
    },
    {
        "source_id": "marine_indian_ocean",
        "source_ids": (
            "marine_indian_ocean",
            "marine_arabian_sea",
            "marine_bay_of_bengal",
            "marine_red_sea",
            "marine_gulf_of_aden",
            "marine_gulf_of_oman",
            "marine_persian_gulf",
            "marine_mozambique_channel",
            "marine_andaman_sea",
            "marine_great_australian_bight",
        ),
        "children": (
            {
                "id": TNO_INDIAN_OPEN_OCEAN_IDS[0],
                "name": "Western Indian Ocean",
                "bbox": (20.0, -20.0, 80.0, 30.0),
            },
            {
                "id": TNO_INDIAN_OPEN_OCEAN_IDS[1],
                "name": "Eastern Indian Ocean",
                "bbox": (80.0, -20.0, 180.0, 30.0),
            },
            {
                "id": TNO_INDIAN_OPEN_OCEAN_IDS[2],
                "name": "Southern Indian Ocean",
                "bbox": (20.0, -90.0, 180.0, -20.0),
            },
        ),
    },
    {
        "source_id": "marine_arctic_ocean",
        "children": (
            {
                "id": TNO_ARCTIC_OPEN_OCEAN_IDS[0],
                "name": "Western Arctic Ocean",
                "bbox": (-180.0, 60.0, 0.0, 90.0),
            },
            {
                "id": TNO_ARCTIC_OPEN_OCEAN_IDS[1],
                "name": "Eastern Arctic Ocean",
                "bbox": (0.0, 60.0, 180.0, 90.0),
            },
        ),
    },
    {
        "source_id": "marine_southern_ocean",
        "children": (
            {
                "id": TNO_SOUTHERN_OPEN_OCEAN_IDS[0],
                "name": "South Atlantic Antarctic Ocean",
                "bbox": (-70.0, -90.0, 20.0, -45.0),
            },
            {
                "id": TNO_SOUTHERN_OPEN_OCEAN_IDS[1],
                "name": "South Indian Antarctic Ocean",
                "bbox": (20.0, -90.0, 147.0, -45.0),
            },
            {
                "id": TNO_SOUTHERN_OPEN_OCEAN_IDS[2],
                "name": "South Pacific Antarctic Ocean",
                "bboxes": ((147.0, -90.0, 180.0, -45.0), (-180.0, -90.0, -70.0, -45.0)),
            },
        ),
    },
)
MARINE_REGIONS_WFS_URL = "https://geo.vliz.be/geoserver/MarineRegions/ows"
MARINE_REGIONS_REQUEST_TIMEOUT_SECONDS = 60
MARINE_REGIONS_SOURCES_URL = "https://marineregions.org/sources.php"
MARINE_REGIONS_LICENSE_URL = "https://www.marineregions.org/disclaimer.php"
MARINE_REGIONS_SEAVOX_DETAILS_URL = "https://www.marineregions.org/gazetteer.php?id=23622&p=details"
MARINE_REGIONS_NAMED_WATER_SNAPSHOT_FILENAME = "derived/marine_regions_named_waters.snapshot.geojson"
TNO_WATER_REGIONS_PROVENANCE_FILENAME = "water_regions.provenance.json"
TNO_WATER_SUBTRACT_BUFFER_DEGREES = 0.0005
MARINE_REGIONS_DATASET_META = {
    "seavox_v19": {
        "dataset_name": "Marine Regions SeaVoX SeaArea v19",
        "source_url": MARINE_REGIONS_SEAVOX_DETAILS_URL,
        "license_url": MARINE_REGIONS_LICENSE_URL,
        "layer": "MarineRegions:seavox_v19",
    },
    "iho": {
        "dataset_name": "Marine Regions IHO Sea Areas",
        "source_url": MARINE_REGIONS_SOURCES_URL,
        "license_url": MARINE_REGIONS_LICENSE_URL,
        "layer": "MarineRegions:iho",
    },
}
MARINE_REGIONS_SOURCE_RECORD_ID_FIELDS_BY_LAYER = {
    "seavox_v19": ("mrgid_sr", "mrgid_l4", "mrgid_l3", "mrgid_l2", "mrgid_l1", "mrgid_r"),
    "iho": ("mrgid",),
}
TNO_NAMED_MARGINAL_WATER_SPECS = (
    {
        "id": "tno_english_channel",
        "name": "English Channel",
        "water_type": "chokepoint",
        "region_group": "marine_macro",
        "is_chokepoint": True,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l3='23649'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": ("marine_north_sea",),
        "subtract_named_ids": ("tno_strait_of_dover",),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_gulf_of_st_lawrence",
        "name": "Gulf of St. Lawrence",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_sr='24048'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": ("marine_labrador_sea",),
        "clip_open_ocean_ids": ("tno_northwest_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_bering_sea",
        "name": "Bering Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l3='23651'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": (),
        "clip_open_ocean_ids": (
            "tno_northwest_pacific_ocean",
            "tno_northeast_pacific_ocean",
        ),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_sea_of_japan",
        "name": "Sea of Japan",
        "label": "Sea of Japan",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "iho",
        "source_query": "mrgid=4307",
        "source_standard": "marine_regions_iho_v3",
        "subtract_base_ids": ("marine_yellow_sea", "marine_east_china_sea", "marine_sea_of_okhotsk"),
        "clip_open_ocean_ids": ("tno_northwest_pacific_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_coral_sea",
        "name": "Coral Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l3='23650'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": ("marine_tasman_sea",),
        "clip_open_ocean_ids": ("tno_southwest_pacific_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_celtic_sea",
        "name": "Celtic Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l3='23729'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": (),
        "subtract_named_ids": ("tno_english_channel",),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_bristol_channel",
        "name": "Bristol Channel",
        "water_type": "channel",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l3='23728'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": (),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_north_channel",
        "name": "North Channel",
        "water_type": "channel",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l4='23739'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": ("marine_irish_sea",),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_strait_of_dover",
        "name": "Strait of Dover",
        "water_type": "strait",
        "region_group": "marine_macro",
        "is_chokepoint": True,
        "source_layer": "seavox_v19",
        "source_query": "mrgid_l4='23735'",
        "source_standard": "marine_regions_seavox_v19",
        "subtract_base_ids": (),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_skagerrak",
        "name": "Skagerrak",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "iho",
        "source_query": "mrgid=2379",
        "source_standard": "marine_regions_iho_v3",
        "subtract_base_ids": ("marine_north_sea",),
        "subtract_named_ids": ("tno_kattegat",),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_kattegat",
        "name": "Kattegat",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "iho",
        "source_query": "mrgid=2374",
        "source_standard": "marine_regions_iho_v3",
        "subtract_base_ids": ("marine_north_sea", "marine_baltic_sea"),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
        "simplify_tolerance": 0.01,
    },
    {
        "id": "tno_baltic_sea",
        "name": "Baltic Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_baltic_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "subtract_named_ids": ("tno_kattegat",),
        "clip_open_ocean_ids": ("tno_northeast_atlantic_ocean",),
    },
    {
        "id": "tno_sea_of_marmara",
        "name": "Sea of Marmara",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "source_layer": "iho",
        "source_query": "mrgid=3369",
        "source_standard": "marine_regions_iho_v3",
        "subtract_base_ids": ("marine_black_sea",),
        "simplify_tolerance": 0.005,
    },
    {
        "id": "tno_bosporus_dardanelles",
        "name": "Bosporus-Dardanelles Chokepoint",
        "water_type": "chokepoint",
        "region_group": "marine_macro",
        "is_chokepoint": True,
        "global_source_id": "med_bosporus_dardanelles",
        "source_standard": "tno_cloned_from_global_water_regions",
        "subtract_named_ids": ("tno_sea_of_marmara",),
        "simplify_tolerance": 0.005,
    },
    {
        "id": "tno_black_sea",
        "name": "Black Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_black_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
    },
    {
        "id": "tno_sea_of_azov",
        "name": "Sea of Azov",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_sea_of_azov",
        "source_standard": "tno_cloned_from_global_water_regions",
    },
    {
        "id": "tno_greenland_sea",
        "name": "Greenland Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_greenland_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS + TNO_ARCTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_norwegian_sea",
        "name": "Norwegian Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_norwegian_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS + TNO_ARCTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_barents_sea",
        "name": "Barents Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_barents_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ARCTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_beaufort_sea",
        "name": "Beaufort Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_beaufort_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ARCTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_labrador_sea",
        "name": "Labrador Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_labrador_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS + TNO_ARCTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_baffin_bay",
        "name": "Baffin Bay",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_baffin_bay",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS + TNO_ARCTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_hudson_bay",
        "name": "Hudson Bay",
        "water_type": "bay",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_hudson_bay",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": ("tno_northwest_atlantic_ocean", "tno_western_arctic_ocean"),
    },
    {
        "id": "tno_bay_of_biscay",
        "name": "Bay of Biscay",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_bay_of_biscay",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_north_sea",
        "name": "North Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_north_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "subtract_named_ids": ("tno_english_channel", "tno_strait_of_dover", "tno_skagerrak", "tno_kattegat"),
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_irish_sea",
        "name": "Irish Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_irish_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "subtract_named_ids": ("tno_north_channel",),
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_caribbean_sea",
        "name": "Caribbean Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_caribbean_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_gulf_of_mexico",
        "name": "Gulf of Mexico",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_gulf_of_mexico",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_gulf_of_guinea",
        "name": "Gulf of Guinea",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_gulf_of_guinea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_ATLANTIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_sea_of_okhotsk",
        "name": "Sea of Okhotsk",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_sea_of_okhotsk",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_east_china_sea",
        "name": "East China Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_east_china_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_yellow_sea",
        "name": "Yellow Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_yellow_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_south_china_sea",
        "name": "South China Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_south_china_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_philippine_sea",
        "name": "Philippine Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_philippine_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_sulu_sea",
        "name": "Sulu Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_sulu_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_celebes_sea",
        "name": "Celebes Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_celebes_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_gulf_of_alaska",
        "name": "Gulf of Alaska",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_gulf_of_alaska",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_tasman_sea",
        "name": "Tasman Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_tasman_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_PACIFIC_OPEN_OCEAN_IDS + TNO_SOUTHERN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_great_australian_bight",
        "name": "Great Australian Bight",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_great_australian_bight",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS + TNO_SOUTHERN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_scotia_sea",
        "name": "Scotia Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_scotia_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": ("tno_south_atlantic_antarctic_ocean",),
    },
    {
        "id": "tno_weddell_sea",
        "name": "Weddell Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_weddell_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": ("tno_south_atlantic_antarctic_ocean",),
    },
    {
        "id": "tno_ross_sea",
        "name": "Ross Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_ross_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": ("tno_south_pacific_antarctic_ocean",),
    },
    {
        "id": "tno_arabian_sea",
        "name": "Arabian Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_arabian_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_bay_of_bengal",
        "name": "Bay of Bengal",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_bay_of_bengal",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_red_sea",
        "name": "Red Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_red_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_gulf_of_aden",
        "name": "Gulf of Aden",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_gulf_of_aden",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_gulf_of_oman",
        "name": "Gulf of Oman",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_gulf_of_oman",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_persian_gulf",
        "name": "Persian Gulf",
        "water_type": "gulf",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_persian_gulf",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_mozambique_channel",
        "name": "Mozambique Channel",
        "water_type": "channel",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_mozambique_channel",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS + TNO_SOUTHERN_OPEN_OCEAN_IDS,
    },
    {
        "id": "tno_andaman_sea",
        "name": "Andaman Sea",
        "water_type": "sea",
        "region_group": "marine_macro",
        "is_chokepoint": False,
        "global_source_id": "marine_andaman_sea",
        "source_standard": "tno_cloned_from_global_water_regions",
        "clip_open_ocean_ids": TNO_INDIAN_OPEN_OCEAN_IDS,
    },
)
TNO_EXCLUDED_BASE_WATER_REGION_IDS = sorted({
    spec["source_id"]
    for spec in TNO_OPEN_OCEAN_SPLIT_SPECS
} | {
    str(spec.get("global_source_id") or "").strip()
    for spec in TNO_NAMED_MARGINAL_WATER_SPECS
    if str(spec.get("global_source_id") or "").strip()
})

ATL_TAG = "ATL"
ATL_COLOR_HEX = "#d8c7a6"
ATL_BASE_ISO2 = "ZZ"
ATL_SOURCE_TAG = "hgo_donor"
ATL_SEA_COLOR_HEX = "#9ec4e6"
ATL_SURFACE_LAND = "salt_flat_land"
ATL_SURFACE_SEA = "sea"

ATL_GEOMETRY_ROLE_DONOR_LAND = "donor_land"
ATL_GEOMETRY_ROLE_DONOR_ISLAND = "donor_island"
ATL_GEOMETRY_ROLE_SHORE_SEAL = "shore_seal"
ATL_GEOMETRY_ROLE_DONOR_SEA = "donor_sea"
ATL_GEOMETRY_ROLE_SEA_COMPLETION = "sea_completion"
ATL_GEOMETRY_ROLE_CAUSEWAY = "causeway"

ATL_JOIN_MODE_NONE = "none"
ATL_JOIN_MODE_GAP_FILL = "gap_fill"
ATL_JOIN_MODE_BOOLEAN_WELD = "boolean_weld"

DONOR_ISLAND_NAME_HINTS = (
    "island",
    "islands",
    "sicily",
    "mallorca",
    "menorca",
    "ibiza",
    "corsica",
    "sardinia",
    "olbia",
    "tavolara",
    "elba",
    "pantelleria",
    "egadi",
    "malta",
    "corfu",
    "crete",
    "naxos",
    "lesvos",
    "rodi",
    "astipalea",
    "cyprus",
    "pago",
    "pelagosa",
    "metcovico",
    "solta",
    "lagosta",
    "plauno",
    "saseno",
)

DONOR_CAUSEWAY_NAME_HINTS = (
    "dam site",
    "canal site",
    "landbridge site",
)

MEDITERRANEAN_WATER_REGION_GROUP = "mediterranean"
BATHYMETRY_GLOBAL_DEPTH_BANDS = (
    (0, -50),
    (-50, -100),
    (-100, -200),
    (-200, -500),
    (-500, -1000),
    (-1000, -2000),
    (-2000, -4000),
    (-4000, -6000),
)
BATHYMETRY_GLOBAL_CONTOURS = (-100, -200, -500, -1000, -2000, -4000)
BATHYMETRY_ATL_SYNTHETIC_PROFILE_DEFAULT = (
    (0, -50),
    (-50, -150),
    (-150, -300),
    (-300, -500),
)
BATHYMETRY_ATL_SYNTHETIC_PROFILE_SHALLOW = (
    (0, -25),
    (-25, -75),
    (-75, -150),
    (-150, -200),
)
TNO_RETIRED_ZERO_FEATURE_TAGS = {"AEF", "ALG", "BEL", "EST", "LAT", "LIT", "LUX", "NOR", "POL", "POR", "SSH", "TAI"}
TNO_FEATURED_TAG_REPLACEMENTS = {"RKB": "BRG"}
TNO_CONTROLLER_ONLY_COUNTRY_META = {
    "POR": {
        "display_name": "Portugal",
        "color_hex": "#4c664c",
        "base_iso2": "PT",
        "lookup_iso2": "PT",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_southern_europe",
        "subregion_label": "Southern Europe",
        "notes": "Controller-only TNO passthrough stub for the Macau administrative overlay.",
        "parent_owner_tag": "IBR",
        "hidden_from_country_list": True,
    },
    "PRC": {
        "display_name": "Communist China",
        "color_hex": "",
        "base_iso2": "CN",
        "lookup_iso2": "CN",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_eastern_asia",
        "subregion_label": "Eastern Asia",
        "notes": "Controller-only TNO frontline stub for the Communist China overlay.",
        "parent_owner_tag": "",
        "hidden_from_country_list": False,
    },
    "SIC": {
        "display_name": "Xikang Clique",
        "color_hex": "",
        "base_iso2": "CN",
        "lookup_iso2": "CN",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_eastern_asia",
        "subregion_label": "Eastern Asia",
        "notes": "Controller-only TNO frontline stub for the Xikang Clique overlay.",
        "parent_owner_tag": "",
        "hidden_from_country_list": False,
    },
    "SIK": {
        "display_name": "Sinkiang",
        "color_hex": "",
        "base_iso2": "CN",
        "lookup_iso2": "CN",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_eastern_asia",
        "subregion_label": "Eastern Asia",
        "notes": "Controller-only TNO frontline stub for the Sinkiang overlay.",
        "parent_owner_tag": "",
        "hidden_from_country_list": False,
    },
    "XSM": {
        "display_name": "Xibei San Ma",
        "color_hex": "#695a84",
        "base_iso2": "CN",
        "lookup_iso2": "CN",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_eastern_asia",
        "subregion_label": "Eastern Asia",
        "notes": "Controller-only TNO frontline stub for the Xibei San Ma overlay.",
        "parent_owner_tag": "",
        "hidden_from_country_list": False,
    },
}
TNO_INSPECTOR_GROUP_CHINA = {
    "id": "scenario_group_china_region",
    "label": "China Region",
    "anchor_id": "continent_asia",
}
TNO_INSPECTOR_GROUP_RUSSIA = {
    "id": "scenario_group_russia_region",
    "label": "Russia Region",
    "anchor_id": "continent_europe",
}

GER_PRESET_FEATURE_IDS = {
    "Alsace-Lorraine + Luxembourg": [
        "FR_ARR_57003", "FR_ARR_57005", "FR_ARR_57006", "FR_ARR_57007", "FR_ARR_57009",
        "FR_ARR_67002", "FR_ARR_67003", "FR_ARR_67004", "FR_ARR_67005", "FR_ARR_67008",
        "FR_ARR_68001", "FR_ARR_68002", "FR_ARR_68004", "FR_ARR_68006",
        "LU_ADM1_LUX-906", "LU_ADM1_LUX-907", "LU_ADM1_LUX-908",
    ],
    "North Schleswig + Bornholm": [
        "DK_HIST_NORTH_SCHLESWIG",
        "DK014",
    ],
    "Slovenia": [
        "SI031", "SI032", "SI033", "SI034", "SI035", "SI036",
        "SI037", "SI038", "SI041", "SI042", "SI043", "SI044",
    ],
}

GER_DISABLED_PRESET_NAMES = [
    "Bavaria",
    "Saxony",
    "Prussia (Eastern Core)",
    "Schleswig-Holstein",
    "Alsace-Lorraine + Luxembourg",
    "North Schleswig + Bornholm",
    "Slovenia",
]

"""
GER_TNO_1962_REGIONAL_PRESET_SPECS = [
    {"name": "吞并东方总督辖区", "owner_tag": "RKO"},
    {"name": "吞并波兰总督辖区", "owner_tag": "RKP"},
    {"name": "吞并勃艮第国", "owner_tag": "BRG"},
    {"name": "吞并荷兰总督府", "owner_tag": "RKN"},
]

"""

GER_TNO_1962_REGIONAL_PRESET_SPECS = [
    {"name": "\u541e\u5e76\u4e1c\u65b9\u603b\u7763\u8f96\u533a", "owner_tag": "RKO"},
    {"name": "\u541e\u5e76\u6ce2\u5170\u603b\u7763\u8f96\u533a", "owner_tag": "RKP"},
    {"name": "\u541e\u5e76\u52c3\u826e\u7b2c\u56fd", "owner_tag": "BRG"},
    {"name": "\u541e\u5e76\u8377\u5170\u603b\u7763\u5e9c", "owner_tag": "RKN"},
]

CRIMEA_TO_GER_FEATURE_IDS = [
    "RU_ARCTIC_FB_043",
    "UA_RAY_74538382B10810755627981",
    "UA_RAY_74538382B12626856106214",
    "UA_RAY_74538382B17328028725822",
    "UA_RAY_74538382B18343308961646",
    "UA_RAY_74538382B24072865224387",
    "UA_RAY_74538382B30799636343123",
    "UA_RAY_74538382B31597126471541",
    "UA_RAY_74538382B3276437105714",
    "UA_RAY_74538382B47758211773177",
    "UA_RAY_74538382B52948461958272",
    "UA_RAY_74538382B62014959099240",
    "UA_RAY_74538382B73102854459711",
    "UA_RAY_74538382B78065593112494",
    "UA_RAY_74538382B80563569865238",
    "UA_RAY_74538382B84040377374615",
    "UA_RAY_74538382B84610439401970",
    "UA_RAY_74538382B85800934600856",
    "UA_RAY_74538382B91806639169097",
]

TNO_1962_SCOTLAND_FEATURE_IDS = [
    "UKM50", "UKM61", "UKM62", "UKM63", "UKM64", "UKM65", "UKM71", "UKM72",
    "UKM73", "UKM75", "UKM76", "UKM77", "UKM78", "UKM81", "UKM82", "UKM83",
    "UKM84", "UKM91", "UKM92", "UKM93", "UKM94", "UKM95",
]

TNO_1962_WALES_FEATURE_IDS = [
    "UKL11", "UKL12", "UKL13", "UKL14", "UKL15", "UKL16", "UKL17", "UKL18",
    "UKL21", "UKL22", "UKL23", "UKL24",
]

TNO_1962_NORTHERN_IRELAND_FEATURE_IDS = [
    "UKN06", "UKN07", "UKN08", "UKN09", "UKN0A", "UKN0B", "UKN0C", "UKN0D",
    "UKN0E", "UKN0F", "UKN0G",
]

TNO_1962_GERMAN_BRITISH_FEATURE_IDS = [
    "GG",
    "JE",
    "FO",
    "UKJ34",
    "UKK30",
    "UKM66",
]

TNO_1962_ARMENIA_FEATURE_IDS = [
    "ARM-1553", "ARM-1554", "ARM-1555", "ARM-1670", "ARM-1671", "ARM-1672",
    "ARM-1673", "ARM-1674", "ARM-1675", "ARM-1732", "ARM-1733",
]

TNO_1962_BRITTANY_FEATURE_IDS = [
    "FR_ARR_22001", "FR_ARR_22002", "FR_ARR_22003", "FR_ARR_22004",
    "FR_ARR_29001", "FR_ARR_29002", "FR_ARR_29003", "FR_ARR_29004",
    "FR_ARR_35001", "FR_ARR_35002", "FR_ARR_35003", "FR_ARR_35004",
    "FR_ARR_56001", "FR_ARR_56002", "FR_ARR_56003",
]

TNO_1962_ITALY_DISABLED_PRESET_NAMES = [
    "Nice + Savoy",
    "Corsica",
    "Albania",
    "Malta",
    "Cyprus",
    "Dalmatia + Kotor Bay",
    "Italian Greek Islands",
]

TNO_1962_ITALY_REMOVED_FRENCH_BASELINE_TARGETS = {
    "MC_ADMIN0_PASSTHROUGH": "FRA",
    "FR_ARR_04001": "FRA",
    "FR_ARR_04002": "FRA",
    "FR_ARR_04003": "FRA",
    "FR_ARR_04004": "FRA",
    "FR_ARR_05001": "FRA",
    "FR_ARR_05002": "FRA",
    "FR_ARR_06001": "FRA",
}
TNO_DECOLONIZATION_CANONICAL_TAGS = ("BZ", "GY", "MC")
TNO_DECOLONIZATION_INDEPENDENT_TAGS = ("CEY", "AST", "BWA", "RAJ", "SAF")
TNO_DECOLONIZATION_NOTES = {
    "CEY": "Ceylon retained as an independent state after the British decolonization cleanup in TNO 1962.",
    "AST": "Australian dependencies approximation retained outside the British subject tree in TNO 1962.",
    "BWA": "British West Africa retained as an independent West African macro administration outside the British subject tree in TNO 1962.",
    "RAJ": "British Raj retained as an independent South Asian macro state outside the British subject tree in TNO 1962.",
    "SAF": "South Africa retained outside the British subject tree while preserving the South West Africa approximation in TNO 1962.",
}

TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES = {
    "FRA": [
        "DZA-2195",
        "DZA-2196",
        "DZA-2198",
        "DZA-2209",
        "ATLPRV_18153",
        "ATLSHL_west_med_6",
        "ATLSHL_west_med_7",
        "ATLSHL_west_med_9",
        "ATLWLD_west_med_22",
        "ATLWLD_west_med_24",
        "ATLWLD_west_med_25",
        "ATLWLD_west_med_26",
        "ATLWLD_west_med_27",
        "ATLWLD_west_med_29",
        "ATLWLD_west_med_31",
        "ATLWLD_west_med_70",
    ],
    "GCO": [
        "CM_ADM1_CMR-1462",
        "CM_ADM1_CMR-1476",
        "CM_ADM1_CMR-1477",
        "CM_ADM1_CMR-1480",
        "CM_ADM1_CMR-1481",
        "CM_ADM1_CMR-1482",
        "CM_ADM1_CMR-1483",
        "CM_ADM1_CMR-798",
        "CM_ADM1_CMR-799",
        "CM_ADM1_CMR-803",
        "CF_ADM1_CAF-1460",
        "CF_ADM1_CAF-4856",
        "CF_ADM1_CAF-794",
        "CF_ADM1_CAF-795",
        "CF_ADM1_CAF-801",
        "CF_ADM1_CAF-802",
        "CF_ADM1_CAF-804",
        "CF_ADM1_CAF-805",
        "CF_ADM1_CAF-806",
        "CF_ADM1_CAF-807",
        "CF_ADM1_CAF-808",
        "CF_ADM1_CAF-809",
        "CF_ADM1_CAF-810",
        "CF_ADM1_CAF-812",
        "CF_ADM1_CAF-866",
        "CF_ADM1_CAF-867",
        "CF_ADM1_CAF-868",
        "TD_ADM1_TCD-1464",
        "TD_ADM1_TCD-1474",
        "TD_ADM1_TCD-1484",
        "TD_ADM1_TCD-1485",
        "TD_ADM1_TCD-1486",
        "TD_ADM1_TCD-1487",
        "TD_ADM1_TCD-1488",
        "TD_ADM1_TCD-1489",
        "TD_ADM1_TCD-4858",
        "TD_ADM1_TCD-5580",
        "TD_ADM1_TCD-5582",
        "TD_ADM1_TCD-5583",
        "GA_ADM1_GAB-2168",
        "GA_ADM1_GAB-2186",
        "GA_ADM1_GAB-2187",
        "GA_ADM1_GAB-2621",
        "GA_ADM1_GAB-2622",
        "GA_ADM1_GAB-2623",
        "GA_ADM1_GAB-2624",
        "GA_ADM1_GAB-2627",
        "GA_ADM1_GAB-2628",
        "CG_ADM1_COG-2626",
        "CG_ADM1_COG-2880",
        "CG_ADM1_COG-3342",
        "CG_ADM1_COG-3343",
        "CG_ADM1_COG-3344",
        "CG_ADM1_COG-3345",
        "CG_ADM1_COG-4855",
        "CG_ADM1_COG-5855",
        "CG_ADM1_COG-2185__tno1962_1",
        "CG_ADM1_COG-2185__tno1962_2",
        "CG_ADM1_COG-2185__tno1962_3",
        "CG_ADM1_COG-2185__tno1962_4",
        "CG_ADM1_COG-3341__tno1962_1",
        "CG_ADM1_COG-3341__tno1962_2",
        "CG_ADM1_COG-3346__tno1962_1",
        "CG_ADM1_COG-3346__tno1962_2",
    ],
    "ITA": [
        "ATLPRV_18263",
        "ATLPRV_18260",
        "ATLISL_adriatica_CRO_3",
        "ATLPRV_18380",
        "ATLPRV_18254",
        "ATLPRV_19222",
        "ATLISL_adriatica_CRO_4",
        "SI044",
        "SI043",
        "SI038",
        "ATLISL_adriatica_CRO_9",
        "ATLSHL_adriatica_4",
        "ATLSHL_adriatica_17",
        "ATLSHL_adriatica_11",
        "ATLPRV_18235",
        "ATLPRV_18348",
        "ATLPRV_18347",
        "ATLISL_adriatica_corfu",
        "ATLPRV_18208",
    ],
    "IBR": [
        "ATLISL_west_med_balearics",
        "ATLPRV_18201",
        "ATLSHL_west_med_10",
        "ATLPRV_18175",
        "ATLPRV_18170",
        "ATLPRV_18185",
        "ATLPRV_18155",
        "ATLISL_west_med_ATL_1",
        "ATLISL_west_med_ATL_2",
        "ATLSHL_west_med_17",
        "ATLSHL_west_med_16",
        "MAR-3456",
        "MAR-3469",
        "EH_ADMIN0_PASSTHROUGH",
    ],
    "BUL": [
        "ATLPRV_18220",
        "EL513",
        "EL511",
        "EL515",
        "EL512",
        "ATLSHL_aegean_8",
        "EL514",
        "EL526",
    ],
    "CRO": [
        "RS127",
    ],
    "RKO": [
        "RU_RAY_50074027B12162041502673",
        "BY_RAY_67162791B52564132020414",
        "PL_POW_2001",
        "PL_POW_2009",
    ],
    "RKM": [
        "RU_RAY_50074027B44154738908147",
        "RU_RAY_50074027B11673707761487",
        "RU_RAY_50074027B49278461872326",
        "RU_RAY_50074027B5223158268211",
        "RU_RAY_50074027B5631740772865",
        "RU_RAY_50074027B58076034090645",
        "RU_RAY_50074027B64055482679717",
        "RU_RAY_50074027B71157437388348",
        "RU_RAY_50074027B87627181065564",
        "RU_RAY_50074027B99227036451137",
        "RU_RAY_50074027B99894122533642",
    ],
    "RKK": [
        "RU_RAY_50074027B17781956857402",
        "RU_RAY_50074027B16130547537538",
        "RU_RAY_50074027B44442883085225",
        "RU_RAY_50074027B65649433423925",
        "RU_RAY_50074027B22498534109926",
        "RU_RAY_50074027B5810919802918",
        "RU_RAY_50074027B71829249339229",
        "RU_RAY_50074027B81340357021350",
        "RU_RAY_50074027B15799201455367",
        "RU_RAY_50074027B11320166931328",
        "RU_RAY_50074027B24393572117028",
        "RU_RAY_50074027B81654035109443",
        "RU_RAY_50074027B75102551172104",
        "RU_RAY_50074027B64215473034686",
        "RU_RAY_50074027B64441195091452",
        "RU_RAY_50074027B82054617400422",
        "RU_RAY_50074027B94064958751973",
        "RU_RAY_50074027B35442546459500",
        "RU_RAY_50074027B81217323813629",
        "RU_RAY_50074027B72549152854781",
        "RU_RAY_50074027B39333917624056",
        "RU_RAY_50074027B2646786725720",
        "RU_RAY_50074027B55774221715414",
        "RU_RAY_50074027B2613413258578",
        "RU_RAY_50074027B85852796728949",
        "RU_RAY_50074027B5102078213757",
        "RU_RAY_50074027B28279959544204",
    ],
    "WRS": [
        "RU_RAY_50074027B94330276236622",
        "RU_RAY_50074027B57840246477228",
        "RU_RAY_50074027B88418643135218",
        "RU_RAY_50074027B76249175703521",
        "RU_RAY_50074027B65009722286705",
        "RU_RAY_50074027B95056184148415",
        "RU_RAY_50074027B59412945992369",
        "RU_RAY_50074027B26939350351836",
        "RU_RAY_50074027B78981709111612",
        "RU_RAY_50074027B52153292155727",
        "RU_RAY_50074027B13808999174668",
        "RU_RAY_50074027B96103137717036",
        "RU_RAY_50074027B82590027772677",
        "RU_RAY_50074027B21050205315965",
        "RU_RAY_50074027B94648571764089",
        "RU_RAY_50074027B27094742199405",
        "RU_RAY_50074027B17636475236668",
        "RU_RAY_50074027B68127795941955",
        "RU_RAY_50074027B71591309638211",
        "RU_RAY_50074027B93416420904070",
        "RU_RAY_50074027B19660495817530",
        "RU_RAY_50074027B34634777465880",
        "RU_RAY_50074027B5563807985387",
        "RU_RAY_50074027B66770935409727",
        "RU_RAY_50074027B51159964054862",
        "RU_RAY_50074027B6686274683844",
        "RU_RAY_50074027B51176471238152",
        "RU_RAY_50074027B41643930675404",
        "RU_RAY_50074027B5291843877359",
        "RU_RAY_50074027B66121314478788",
    ],
    "RSF": [
        "RU_RAY_50074027B8247596248333",
        "RU_RAY_50074027B28144113624552",
        "RU_RAY_50074027B77123826131271",
    ],
    "MON": [
        "MNG-3315",
    ],
    "MEN": [
        "MNG-3298",
        "MNG-3297",
        "CN_CITY_17275852B92392502748538",
        "CN_CITY_17275852B56850756381420",
        "CN_CITY_17275852B64978204094712",
        "CN_CITY_17275852B37803356904979",
        "CN_CITY_17275852B97070335713694",
        "CN_CITY_17275852B16095129082560",
        "CN_CITY_17275852B21512782047125",
        "CN_CITY_17275852B8665149309175",
        "CN_CITY_17275852B68447300329810",
    ],
    "GCE": [
        "UKK30",
    ],
    "TAN": [
        "MNG-3322",
        "MNG-3318",
        "MNG-3321",
        "MNG-3208",
        "MNG-3320",
    ],
    "AFG": [
        "TJK-366",
        "PAK-1112",
        "PAK-1123",
        "PAK-1108",
    ],
    "PER": [
        "XK_ADM1_KOS-5909",
        "RS228",
        "AZE-2415",
        "AZE-2419",
        "AZE-2420",
        "AZE-5567",
        "AZE-2423",
        "AZE-2421",
        "AZE-2422",
        "AZE-2418",
    ],
    "FRI": [
        "IN_ADM2_76128533B27432148084533",
        "IN_ADM2_76128533B32499449492865",
        "IN_ADM2_76128533B65773363805797",
        "IN_ADM2_76128533B10270619600482",
        "IN_ADM2_76128533B30151252629779",
        "IN_ADM2_76128533B67639510673366",
        "IN_ADM2_76128533B78458325839103",
        "IN_ADM2_76128533B23858286755005",
        "IN_ADM2_76128533B91480770176940",
        "IN_ADM2_76128533B25835998628545",
        "IN_ADM2_76128533B40226077866964",
        "IN_ADM2_76128533B88623139855224",
    ],
    "BRM": [
        "CN_CITY_17275852B59976310203554",
        "CN_CITY_17275852B66801672405752",
        "CN_CITY_17275852B45889256371362",
        "CN_CITY_17275852B14658621666192",
        "CN_CITY_17275852B85492016083287",
        "CN_CITY_17275852B50071782197016",
        "CN_CITY_17275852B20068359050292",
    ],
    "IAL": [
        "DZA-2189",
        "DZA-2188",
        "DZA-2194",
        "DZA-2192",
        "DZA-2193",
        "DZA-2212",
        "DZA-2214",
        "DZA-2211",
        "DZA-2210",
        "DZA-2213",
        "DZA-2197",
        "DZA-2208",
        "ATLSHL_west_med_5",
        "ATLPRV_18179",
        "DZA-2207",
        "DZA-2215",
        "DZA-2165",
        "DZA-2166",
        "DZA-2163",
        "DZA-2164",
        "DZA-2218",
        "DZA-2217",
        "DZA-2220",
        "DZA-2221",
        "DZA-2216",
        "DZA-2219",
        "DZA-2222",
        "DZA-2223",
        "DZA-2191",
    ],
    "ALC": [
        "DZA-2190",
        "DZA-2143",
        "DZA-2148",
        "DZA-2150",
        "DZA-2149",
        "DZA-2147",
        "DZA-2145",
        "DZA-2144",
        "DZA-2146",
        "DZA-2204",
        "DZA-2201",
        "DZA-2202",
        "DZA-2203",
        "DZA-2205",
        "DZA-2206",
        "DZA-2200",
        "DZA-2199",
    ],
    "IRK": [
        "RU_RAY_50074027B4550186077468",
        "RU_RAY_50074027B40490184073059",
        "RU_RAY_50074027B22427038197607",
        "RU_RAY_50074027B16590534350990",
        "RU_RAY_50074027B8712338035658",
        "RU_RAY_50074027B64994254262493",
        "RU_RAY_50074027B66325545457343",
        "RU_RAY_50074027B79492376749853",
        "RU_RAY_50074027B62361238296524",
        "RU_RAY_50074027B14964532797718",
        "RU_RAY_50074027B53313512527229",
        "RU_RAY_50074027B59094736613024",
        "RU_RAY_50074027B84795303923932",
        "RU_RAY_50074027B87661058912782",
        "RU_RAY_50074027B5428684796200",
    ],
    "BRY": [
        "RU_RAY_50074027B54571182544478",
        "RU_RAY_50074027B53092921168880",
        "RU_RAY_50074027B68324499400164",
        "RU_RAY_50074027B52589060558115",
        "RU_RAY_50074027B59256788667160",
        "RU_RAY_50074027B81201723878288",
        "RU_RAY_50074027B50382103456040",
        "RU_RAY_50074027B57723797898160",
        "RU_RAY_50074027B30174878367299",
        "RU_RAY_50074027B11980599165555",
        "RU_RAY_50074027B79731064340357",
        "RU_RAY_50074027B18238462468960",
        "RU_RAY_50074027B15921204725831",
        "RU_RAY_50074027B18535567359645",
        "RU_RAY_50074027B95740998867041",
        "RU_RAY_50074027B10017540039169",
        "RU_RAY_50074027B14990510856215",
        "RU_RAY_50074027B51279311685778",
        "RU_RAY_50074027B66749870989397",
        "RU_RAY_50074027B57524077165692",
        "RU_RAY_50074027B38959964880185",
        "RU_RAY_50074027B13810434880190",
        "RU_RAY_50074027B54676070684913",
        "RU_RAY_50074027B20013842772411",
        "RU_RAY_50074027B97952733144494",
        "RU_RAY_50074027B42772585169334",
        "RU_RAY_50074027B41432383086059",
    ],
    "CHT": [
        "RU_RAY_50074027B30395625379090",
        "RU_RAY_50074027B23946396037184",
        "RU_RAY_50074027B81312407752344",
        "RU_RAY_50074027B52095363621144",
        "RU_RAY_50074027B43719627358361",
        "RU_RAY_50074027B86196657571295",
        "RU_RAY_50074027B75343755211502",
        "RU_RAY_50074027B8579713719118",
        "RU_RAY_50074027B95803310425506",
        "RU_RAY_50074027B81573271033049",
        "RU_RAY_50074027B26231250423767",
        "RU_RAY_50074027B66856367478499",
        "RU_RAY_50074027B66579700233481",
        "RU_RAY_50074027B53968863670029",
        "RU_RAY_50074027B64669214156055",
        "RU_RAY_50074027B3030103558136",
        "RU_RAY_50074027B27187336625975",
        "RU_RAY_50074027B29408552391691",
        "RU_RAY_50074027B60421110465510",
        "RU_RAY_50074027B72033015120911",
        "RU_RAY_50074027B38917737008193",
        "RU_RAY_50074027B6450887110855",
        "RU_RAY_50074027B47040377041373",
        "RU_RAY_50074027B38981942782180",
        "RU_RAY_50074027B74126446189697",
        "RU_RAY_50074027B29861544165905",
        "RU_RAY_50074027B10681845453352",
        "RU_RAY_50074027B90632265551754",
        "RU_RAY_50074027B79971887964789",
        "RU_RAY_50074027B1949274339631",
    ],
    "YAK": [
        "RU_RAY_50074027B90279098260480",
        "RU_RAY_50074027B62743108472351",
        "RU_RAY_50074027B26762093153483",
        "RU_RAY_50074027B92925268599817",
        "RU_RAY_50074027B62766974958446",
        "RU_RAY_50074027B92204560005617",
        "RU_RAY_50074027B10692488874609",
        "RU_RAY_50074027B54343093409593",
        "RU_RAY_50074027B96478141616654",
        "RU_RAY_50074027B37762638415311",
        "RU_RAY_50074027B2556018304316",
        "RU_RAY_50074027B41588268711347",
        "RU_RAY_50074027B67452662643039",
    ],
    "SBA": [
        "RU_RAY_50074027B27046027245969",
        "RU_RAY_50074027B2445180989787",
        "RU_RAY_50074027B19101038571045",
        "RU_RAY_50074027B52603641216214",
        "RU_RAY_50074027B5882039532525",
        "RU_RAY_50074027B9240580019103",
        "RU_RAY_50074027B64879952129543",
        "RU_RAY_50074027B15054947326156",
        "RU_RAY_50074027B89196470968911",
        "RU_RAY_50074027B52636391168845",
        "RU_RAY_50074027B33581045729564",
        "RU_RAY_50074027B5817682891911",
        "RU_RAY_50074027B23485180175661",
        "RU_RAY_50074027B12640521682010",
        "RU_RAY_50074027B80078985689928",
        "RU_RAY_50074027B58243495740479",
        "RU_RAY_50074027B57998590529030",
        "RU_RAY_50074027B24591501749173",
        "RU_RAY_50074027B69769739908896",
        "RU_RAY_50074027B91366366280548",
        "RU_RAY_50074027B23914902368646",
        "RU_RAY_50074027B77751713871434",
        "RU_RAY_50074027B10793047244322",
        "RU_RAY_50074027B2836897877919",
        "RU_RAY_50074027B86232472456901",
        "RU_RAY_50074027B2452640805703",
    ],
    "GOR": [
        "RU_RAY_50074027B54726203316693",
        "RU_RAY_50074027B31803957515687",
        "RU_RAY_50074027B96655496117027",
        "RU_RAY_50074027B20716795967188",
        "RU_RAY_50074027B10341232584941",
        "RU_RAY_50074027B85030315682895",
        "RU_RAY_50074027B16961904381699",
        "RU_RAY_50074027B57067541625780",
        "RU_RAY_50074027B65458030094261",
        "RU_RAY_50074027B65238711486063",
        "RU_RAY_50074027B27185032673214",
        "RU_RAY_50074027B11949553415975",
        "RU_RAY_50074027B70704481809770",
        "RU_RAY_50074027B34306855223779",
        "RU_RAY_50074027B71432315029933",
        "RU_RAY_50074027B41946531355256",
        "RU_RAY_50074027B98333742065229",
    ],
    "KOM": [
        "RU_RAY_50074027B69393547238212",
        "RU_RAY_50074027B35821970089241",
        "RU_RAY_50074027B41552033877459",
        "RU_RAY_50074027B78945113117211",
        "RU_RAY_50074027B24046633276101",
        "RU_RAY_50074027B53357827316806",
        "RU_RAY_50074027B39888896704739",
        "RU_RAY_50074027B62021010666251",
        "RU_RAY_50074027B16688854937405",
        "RU_RAY_50074027B66575331271663",
        "RU_RAY_50074027B87517330580168",
        "RU_RAY_50074027B62771327701487",
        "RU_RAY_50074027B14882106865056",
        "RU_RAY_50074027B26687837165450",
        "RU_RAY_50074027B71551288540526",
        "RU_RAY_50074027B31965156004487",
        "RU_RAY_50074027B13026656101644",
        "RU_RAY_50074027B41291210718921",
    ],
    "VOL": [
        "RU_RAY_50074027B72539224473791",
        "RU_RAY_50074027B10865784748365",
        "RU_RAY_50074027B21071286858114",
        "RU_RAY_50074027B92557528225232",
        "RU_RAY_50074027B2871019088117",
        "RU_RAY_50074027B28831811708069",
        "RU_RAY_50074027B27653163023459",
        "RU_RAY_50074027B59926713884050",
        "RU_RAY_50074027B57869521400916",
        "RU_RAY_50074027B7896527915062",
        "RU_RAY_50074027B49802974490397",
        "RU_RAY_50074027B76724970954393",
        "RU_RAY_50074027B32782787425978",
        "RU_RAY_50074027B42819317151918",
        "RU_RAY_50074027B85218865173974",
        "RU_RAY_50074027B34235942495173",
        "RU_RAY_50074027B73796424716840",
        "RU_RAY_50074027B37788861563784",
        "RU_RAY_50074027B62324973885793",
        "RU_RAY_50074027B44706978372394",
        "RU_RAY_50074027B87884382763880",
    ],
    "SVR": [
        "RU_RAY_50074027B9981749344230",
        "RU_RAY_50074027B34285240101585",
        "RU_RAY_50074027B21999268703356",
        "RU_RAY_50074027B58618273203869",
        "RU_RAY_50074027B37150470601583",
        "RU_RAY_50074027B63812451412712",
        "RU_RAY_50074027B13867451681945",
        "RU_RAY_50074027B46854326262553",
        "RU_RAY_50074027B59065179162504",
        "RU_RAY_50074027B32599021943629",
        "RU_RAY_50074027B908465227031",
        "RU_RAY_50074027B43506275184231",
        "RU_RAY_50074027B61834405416866",
        "RU_RAY_50074027B14926078948215",
        "RU_RAY_50074027B1839066901705",
        "RU_RAY_50074027B32271657283037",
        "RU_RAY_50074027B82466107763770",
        "RU_RAY_50074027B99014675112578",
        "RU_RAY_50074027B39750055967275",
        "RU_RAY_50074027B80069960478046",
        "RU_RAY_50074027B65347508719245",
        "RU_RAY_50074027B17891021067219",
        "RU_RAY_50074027B23829204276737",
        "RU_RAY_50074027B37875982181689",
        "RU_RAY_50074027B34984618611243",
        "RU_RAY_50074027B31703371864859",
        "RU_RAY_50074027B41719256732887",
        "RU_RAY_50074027B99074376232586",
        "RU_RAY_50074027B90016896372270",
        "RU_RAY_50074027B4078355443533",
        "RU_RAY_50074027B46283635276731",
        "RU_RAY_50074027B90830635889717",
        "RU_RAY_50074027B79291363098032",
        "RU_RAY_50074027B35747671323830",
        "RU_RAY_50074027B89279027262739",
        "RU_RAY_50074027B86083656262946",
        "RU_RAY_50074027B3033714852105",
        "RU_RAY_50074027B86150609365879",
        "RU_RAY_50074027B55874149600418",
        "RU_RAY_50074027B61183763679661",
        "RU_RAY_50074027B16928982325503",
        "RU_RAY_50074027B62555187301125",
        "RU_RAY_50074027B36993675567197",
        "RU_RAY_50074027B44863367100393",
        "RU_RAY_50074027B68145102947423",
        "RU_RAY_50074027B44738927608854",
        "RU_RAY_50074027B28906813018549",
        "RU_RAY_50074027B28606060123578",
        "RU_RAY_50074027B31496942337081",
        "RU_RAY_50074027B79985122577956",
        "RU_RAY_50074027B57809326542315",
        "RU_RAY_50074027B37019235113150",
        "RU_RAY_50074027B962577442304",
        "RU_RAY_50074027B62340614203489",
        "RU_RAY_50074027B58786109430878",
        "RU_RAY_50074027B31451009482636",
        "RU_RAY_50074027B28860706284605",
        "RU_RAY_50074027B77564912174395",
        "RU_RAY_50074027B58259564251603",
        "RU_RAY_50074027B17433324636715",
        "RU_RAY_50074027B93262234465303",
        "RU_RAY_50074027B16274342774122",
        "RU_RAY_50074027B90256927178975",
        "RU_RAY_50074027B67031396039838",
        "RU_RAY_50074027B58553463142023",
        "RU_RAY_50074027B83808818851185",
        "RU_RAY_50074027B56223588847735",
        "RU_RAY_50074027B71545540908305",
        "RU_RAY_50074027B77128141881548",
        "RU_RAY_50074027B39416650406639",
        "RU_RAY_50074027B44910664086930",
        "RU_RAY_50074027B98445565270592",
        "RU_RAY_50074027B68372650413659",
        "RU_RAY_50074027B86383441268360",
        "RU_RAY_50074027B84577315553056",
        "RU_RAY_50074027B45586328769605",
        "RU_RAY_50074027B10143941987755",
        "RU_RAY_50074027B21858159893222",
        "RU_RAY_50074027B39462320896821",
        "RU_RAY_50074027B85683095957373",
        "RU_RAY_50074027B28518869085431",
        "RU_RAY_50074027B59084982393772",
        "RU_RAY_50074027B89723245705099",
        "RU_RAY_50074027B34194149868379",
        "RU_RAY_50074027B59260333720882",
        "RU_RAY_50074027B76835864360350",
        "RU_RAY_50074027B29117855811227",
        "RU_RAY_50074027B913230287563",
        "RU_RAY_50074027B6339965141747",
        "RU_RAY_50074027B36040821067036",
        "RU_RAY_50074027B98412549184479",
        "RU_RAY_50074027B64020270132903",
        "RU_RAY_50074027B11508462713906",
        "RU_RAY_50074027B87493845819863",
        "RU_RAY_50074027B88833009922563",
        "RU_RAY_50074027B92699557632668",
        "RU_RAY_50074027B80098888986721",
        "RU_RAY_50074027B74307668400106",
        "RU_RAY_50074027B4275177079349",
        "RU_RAY_50074027B66293111099001",
        "RU_RAY_50074027B9614004188530",
        "RU_RAY_50074027B55283752941545",
        "RU_RAY_50074027B84070546227145",
        "RU_RAY_50074027B78325838366914",
        "RU_RAY_50074027B52749496042519",
        "RU_RAY_50074027B45280576569410",
        "RU_RAY_50074027B31277912642085",
        "RU_RAY_50074027B46582029535198",
        "RU_RAY_50074027B74305253047814",
        "RU_RAY_50074027B14479824484507",
        "RU_RAY_50074027B15132137133452",
        "RU_RAY_50074027B15595970902062",
        "RU_RAY_50074027B63395441094430",
        "RU_RAY_50074027B16195915824724",
        "RU_RAY_50074027B5367199922404",
        "RU_RAY_50074027B50410806068929",
        "RU_RAY_50074027B30834192101705",
    ],
    "KUR": [
        "IRQ-3051",
        "IRQ-3046",
        "IRQ-3050",
        "IRQ-3242",
        "IRQ-3049",
        "IRQ-3052",
        "IRQ-3243",
    ],
    "JAP": [
        "CN_CITY_17275852B34854699874075",
        "CN_CITY_17275852B97124400303792",
        "CN_CITY_17275852B88708837863828",
        "CN_CITY_17275852B33561936369452",
        "CN_CITY_17275852B48136438053745",
        "CN_CITY_17275852B77518624384720",
        "CN_CITY_17275852B1364012400924",
        "CN_CITY_17275852B81072603241187",
        "CN_CITY_17275852B99355884213700",
        "CN_CITY_17275852B27963337647177",
        "CN_CITY_17275852B54632216874023",
        "CN_CITY_17275852B67438977719884",
        "TWN-1156",
        "TWN-1158",
        "TWN-1160",
        "TWN-1161",
        "TWN-1162",
        "TWN-1163",
        "TWN-1164",
        "TWN-1165",
        "TWN-1166",
        "TWN-1167",
        "TWN-1168",
        "TWN-1169",
        "TWN-1170",
        "TWN-1171",
        "TWN-1172",
        "TWN-1173",
        "TWN-1174",
        "TWN-1176",
        "TWN-1177",
        "TWN-3414",
        "TWN-3415",
        "US_CNTY_15003",
        "US_CNTY_15001",
        "US_CNTY_15005",
        "US_CNTY_15009",
        "US_CNTY_15007",
    ],
    "NCP": [
        "CN_CITY_17275852B45390451107599",
        "CN_CITY_17275852B37240019282451",
        "CN_CITY_17275852B91173560245297",
        "CN_CITY_17275852B56427962625414",
        "CN_CITY_17275852B97480690303",
    ],
    "RKU": [
        "RU_RAY_50074027B21430544456221",
        "RU_RAY_50074027B19608634361445",
        "RU_RAY_50074027B30333853270950",
        "RU_RAY_50074027B40672414055189",
        "RU_RAY_50074027B96632027100715",
        "RU_RAY_50074027B48200335175308",
        "RU_RAY_50074027B91680290875095",
        "RU_RAY_50074027B64075323117418",
        "RU_RAY_50074027B98963269942164",
        "RU_RAY_50074027B17337160846160",
        "RU_RAY_50074027B11167337977127",
        "RU_RAY_50074027B45827101487113",
        "RU_RAY_50074027B82795249676876",
        "RU_RAY_50074027B12057415827309",
        "RU_RAY_50074027B68994215866919",
        "RU_RAY_50074027B60449717020872",
        "RU_RAY_50074027B32449678742282",
        "RU_RAY_50074027B24816705084371",
        "RU_RAY_50074027B52711989546479",
        "RU_RAY_50074027B87683621003887",
        "RU_RAY_50074027B81381948245053",
        "RU_RAY_50074027B70843785500693",
        "RU_RAY_50074027B97793723887224",
        "RU_RAY_50074027B75729335409150",
    ],
    "TUR": [
        "ATLWLD_aegean_41",
        "ATLSHL_aegean_2",
        "ATLSHL_aegean_10",
        "ATLWLD_aegean_39",
        "ATLISL_aegean_lesvos",
        "ATLISL_aegean_chios",
        "ATLPRV_18181",
        "ATLSHL_aegean_3",
        "ATLISL_aegean_rhodes",
        "GEO-3027",
        "GEO-3028",
        "GEO-3038",
        "SYR-138",
        "SYR-140",
        "SYR-137",
        "SYR-136",
        "SYR-142",
        "SYR-141",
    ],
    "FFR": [
        "CI_ADM1_83157122B96959932745266",
        "CI_ADM1_83157122B34711482467037",
        "CI_ADM1_83157122B73612976130091",
        "CI_ADM1_83157122B96325295181308",
        "CI_ADM1_83157122B76853064397847",
    ],
    "AFA": [
        "NE_ADM1_NER-800",
        "TD_ADM1_TCD-5577",
        "TD_ADM1_TCD-5578",
        "TD_ADM1_TCD-5579",
        "TD_ADM1_TCD-1473",
        "TD_ADM1_TCD-1475",
        "TD_ADM1_TCD-1472",
        "TD_ADM1_TCD-5581",
        "TD_ADM1_TCD-1466",
        "TD_ADM1_TCD-1465",
        "NE_ADM1_NER-796",
        "NE_ADM1_NER-92",
        "NE_ADM1_NER-91",
        "NE_ADM1_NER-95",
        "NE_ADM1_NER-4859",
        "NE_ADM1_NER-93",
        "NE_ADM1_NER-94",
        "ML_ADM1_MLI-2690",
        "ML_ADM1_MLI-2688",
        "ML_ADM1_MLI-2689",
        "MR_ADM1_MRT-2796",
        "MR_ADM1_MRT-2798",
        "MR_ADM1_MRT-2795",
        "MR_ADM1_MRT-2783",
        "MR_ADM1_MRT-2797",
        "MR_ADM1_MRT-2789",
        "ML_ADM1_MLI-2809",
        "BF_ADM1_92566538B81581720767285",
    ],
    "RFA": [
        "RU_RAY_50074027B15872482411826",
        "RU_RAY_50074027B66849950652275",
        "RU_RAY_50074027B59423174958471",
        "RU_RAY_50074027B61486865886735",
        "RU_RAY_50074027B34454529298169",
        "RU_RAY_50074027B99340686489203",
        "RU_RAY_50074027B29535697880201",
        "RU_RAY_50074027B61732353469918",
        "RU_RAY_50074027B29205817441204",
        "RU_RAY_50074027B33321279608248",
        "RU_RAY_50074027B45070384031046",
        "RU_RAY_50074027B83598019874707",
        "RU_RAY_50074027B16848587825379",
        "RU_RAY_50074027B97275470142422",
        "RU_RAY_50074027B15858077100993",
        "RU_RAY_50074027B58575735972897",
        "RU_RAY_50074027B18276413342266",
        "RU_RAY_50074027B97359709446069",
        "RU_RAY_50074027B66970562543464",
        "RU_RAY_50074027B69239078282053",
        "RU_RAY_50074027B74877493637193",
        "RU_RAY_50074027B65892523893476",
        "RU_RAY_50074027B24324052900188",
        "RU_RAY_50074027B66038221919497",
        "RU_RAY_50074027B57985783040710",
        "RU_RAY_50074027B40753977825415",
        "RU_RAY_50074027B93581086999271",
        "RU_RAY_50074027B87731900886085",
        "RU_RAY_50074027B8751485821395",
        "RU_RAY_50074027B85754260597476",
        "RU_RAY_50074027B33340525070478",
        "RU_RAY_50074027B91375405563028",
        "RU_RAY_50074027B50212076410442",
        "RU_RAY_50074027B10379539839705",
        "RU_RAY_50074027B57421544908828",
        "RU_RAY_50074027B40112285502062",
        "RU_RAY_50074027B28435030643524",
        "RU_RAY_50074027B71368048698898",
        "RU_RAY_50074027B30864735873510",
        "RU_RAY_50074027B62501748698742",
        "RU_RAY_50074027B17917543280875",
        "RU_RAY_50074027B39292814865227",
        "RU_RAY_50074027B23262720042196",
        "RU_RAY_50074027B63935727212307",
        "RU_RAY_50074027B2325947694706",
        "RU_RAY_50074027B84010004825464",
    ],
    "TOM": [
        "RU_RAY_50074027B52838111466804",
        "RU_RAY_50074027B29329231814048",
        "RU_RAY_50074027B89987768012006",
        "RU_RAY_50074027B17928586927608",
        "RU_RAY_50074027B5869388987158",
        "RU_RAY_50074027B64441434364002",
        "RU_RAY_50074027B48772613269862",
        "RU_RAY_50074027B33454891885145",
        "RU_RAY_50074027B55969640981213",
        "RU_RAY_50074027B12924192729400",
        "RU_RAY_50074027B47808208285077",
        "RU_RAY_50074027B35867871719252",
        "RU_RAY_50074027B22320603613920",
        "RU_RAY_50074027B99774107929021",
        "RU_RAY_50074027B49750579589380",
        "RU_RAY_50074027B31214621786737",
        "RU_RAY_50074027B20937469807639",
        "RU_RAY_50074027B57867069546875",
        "RU_RAY_50074027B60404597472351",
        "RU_RAY_50074027B40569621525813",
        "RU_RAY_50074027B64298708996780",
        "RU_RAY_50074027B42769338425370",
    ],
    "ALT": [
        "RU_RAY_50074027B11056050899621",
        "RU_RAY_50074027B62478008051708",
        "RU_RAY_50074027B2598774008896",
        "RU_RAY_50074027B37224756468060",
        "RU_RAY_50074027B7427793780569",
        "RU_RAY_50074027B42619686972132",
        "RU_RAY_50074027B69764357402848",
        "RU_RAY_50074027B98895209347227",
        "RU_RAY_50074027B42495202262481",
        "RU_RAY_50074027B10369136530294",
        "RU_RAY_50074027B82296582296323",
        "RU_RAY_50074027B78575343416930",
        "RU_RAY_50074027B43513809805544",
        "RU_RAY_50074027B22497225506346",
        "RU_RAY_50074027B27229100203359",
        "RU_RAY_50074027B67798096823782",
        "RU_RAY_50074027B56266744785915",
    ],
    "TYM": [
        "RU_RAY_50074027B9555764209579",
        "RU_RAY_50074027B74833358041679",
        "RU_RAY_50074027B73846496493969",
        "RU_RAY_50074027B90169442712186",
        "RU_RAY_50074027B13302458240572",
        "RU_RAY_50074027B503001233598",
        "RU_RAY_50074027B23889198681107",
        "RU_RAY_50074027B55944525718876",
        "RU_RAY_50074027B21919606004919",
        "RU_RAY_50074027B91773725927909",
        "RU_RAY_50074027B86915351982352",
        "RU_RAY_50074027B65250804095519",
        "RU_RAY_50074027B30404242802447",
        "RU_RAY_50074027B38017248664200",
        "RU_RAY_50074027B30455457019741",
        "RU_RAY_50074027B12125827466721",
        "RU_RAY_50074027B34363353646392",
        "RU_RAY_50074027B85559256864717",
        "RU_RAY_50074027B80523103546976",
        "RU_RAY_50074027B14760341290043",
        "RU_RAY_50074027B79311648725094",
        "RU_RAY_50074027B53227072231380",
        "RU_RAY_50074027B15471708498057",
        "RU_RAY_50074027B67759897032241",
        "RU_RAY_50074027B54335415117985",
        "RU_RAY_50074027B56533188596324",
        "RU_RAY_50074027B18151265994633",
        "RU_RAY_50074027B19372262901440",
        "RU_RAY_50074027B92869762048488",
        "RU_RAY_50074027B66258945082472",
        "RU_RAY_50074027B16256502753972",
        "RU_RAY_50074027B34790783107353",
        "RU_RAY_50074027B74836114000977",
        "RU_RAY_50074027B92166999568031",
        "RU_RAY_50074027B6198597744919",
    ],
    "OMS": [
        "RU_RAY_50074027B94119153395337",
        "RU_RAY_50074027B54345914919420",
        "RU_RAY_50074027B38952198823257",
        "RU_RAY_50074027B24490071378824",
        "RU_RAY_50074027B10203743497329",
        "RU_RAY_50074027B91552985574667",
        "RU_RAY_50074027B94217277778008",
        "RU_RAY_50074027B61903098124852",
        "RU_RAY_50074027B31235318432407",
        "RU_RAY_50074027B1801630462439",
        "RU_RAY_50074027B74546691194068",
        "RU_RAY_50074027B42915894018382",
        "RU_RAY_50074027B53792659884597",
        "RU_RAY_50074027B84115521908944",
        "RU_RAY_50074027B40989256000236",
        "RU_RAY_50074027B76055617717778",
        "RU_RAY_50074027B1154757309769",
        "RU_RAY_50074027B77832194224419",
        "RU_RAY_50074027B11464632928939",
        "RU_RAY_50074027B77540490569541",
        "RU_RAY_50074027B79924738274126",
        "RU_RAY_50074027B41938053987638",
        "RU_RAY_50074027B10746223441661",
        "RU_RAY_50074027B1814535898991",
        "RU_RAY_50074027B81841250799510",
        "RU_RAY_50074027B89255847323601",
        "RU_RAY_50074027B98338576310909",
        "RU_RAY_50074027B40650082048510",
        "RU_RAY_50074027B11964872895292",
        "RU_RAY_50074027B50058998089809",
        "RU_RAY_50074027B47312345815604",
        "RU_RAY_50074027B11303742848027",
        "RU_RAY_50074027B66046349705368",
        "RU_RAY_50074027B42091681257278",
        "RU_RAY_50074027B51076398001550",
        "RU_RAY_50074027B73257379170390",
        "RU_RAY_50074027B15396054994341",
        "RU_RAY_50074027B75885575874433",
        "RU_RAY_50074027B21454982990779",
        "RU_RAY_50074027B52983592916775",
        "RU_RAY_50074027B86499512318901",
        "RU_RAY_50074027B25730099940493",
        "RU_RAY_50074027B10003621776126",
        "RU_RAY_50074027B30628495611334",
        "RU_RAY_50074027B21560944858055",
    ],
    "RUR": [
        "RU_RAY_50074027B6006339352283",
        "RU_RAY_50074027B65704335571669",
        "RU_RAY_50074027B38692746496419",
        "RU_RAY_50074027B11956854664950",
        "RU_RAY_50074027B13440984713855",
        "RU_RAY_50074027B50896552692330",
        "RU_RAY_50074027B87275395176909",
        "RU_RAY_50074027B56311400642429",
        "RU_RAY_50074027B27198107294682",
        "RU_RAY_50074027B67807179286813",
        "RU_RAY_50074027B95696969871843",
        "RU_RAY_50074027B73402533028604",
        "RU_RAY_50074027B89004724588312",
        "RU_RAY_50074027B92108534487256",
        "RU_RAY_50074027B30190639810101",
        "RU_RAY_50074027B15223656231949",
        "RU_RAY_50074027B42204781690882",
        "RU_RAY_50074027B13390964991428",
        "RU_RAY_50074027B33908420034541",
        "RU_RAY_50074027B37063735342850",
        "RU_RAY_50074027B49783608080364",
        "RU_RAY_50074027B61181893774399",
        "RU_RAY_50074027B76012718832492",
        "RU_RAY_50074027B23063195205268",
    ],
    "KRS": [
        "RU_RAY_50074027B68213314202961",
        "RU_RAY_50074027B31073193528551",
        "RU_RAY_50074027B97548464924661",
        "RU_RAY_50074027B3826534840215",
        "RU_RAY_50074027B86573453113564",
        "RU_RAY_50074027B9623133340795",
        "RU_RAY_50074027B9775696758448",
        "RU_RAY_50074027B5565094165552",
        "RU_RAY_50074027B93727242442988",
        "RU_RAY_50074027B24047128288969",
        "RU_RAY_50074027B61213730066010",
        "RU_RAY_50074027B33933531551688",
        "RU_RAY_50074027B46708388850213",
        "RU_RAY_50074027B782744775267",
        "RU_RAY_50074027B72095757320066",
    ],
    "OUR": [
        "RU_RAY_50074027B78297177563949",
        "RU_RAY_50074027B30219941944137",
        "RU_RAY_50074027B34738491600615",
        "RU_RAY_50074027B1644674550414",
        "RU_RAY_50074027B56233113775442",
        "RU_RAY_50074027B40271227634983",
        "RU_RAY_50074027B43089956732561",
        "RU_RAY_50074027B63939328308322",
        "RU_RAY_50074027B80768671311936",
        "RU_RAY_50074027B21488641063420",
        "RU_RAY_50074027B11628373622146",
        "RU_RAY_50074027B22575347101555",
        "RU_RAY_50074027B1688129398280",
        "RU_RAY_50074027B42894474720971",
        "RU_RAY_50074027B84484580118953",
        "RU_RAY_50074027B1349259071180",
        "RU_RAY_50074027B32656053456514",
        "RU_RAY_50074027B20766953749366",
        "RU_RAY_50074027B74551124760393",
        "RU_RAY_50074027B43884412711869",
        "RU_RAY_50074027B27291346725011",
        "RU_RAY_50074027B52448073907458",
        "RU_RAY_50074027B17551582327513",
        "RU_RAY_50074027B32469529603999",
        "RU_RAY_50074027B55367485598669",
        "RU_RAY_50074027B6411812796557",
        "RU_RAY_50074027B65825056432109",
        "RU_RAY_50074027B17899220838954",
        "RU_RAY_50074027B25090929121960",
        "RU_RAY_50074027B56843210888959",
        "RU_RAY_50074027B86537107705560",
        "RU_RAY_50074027B70684574200660",
        "RU_RAY_50074027B75775802654148",
        "RU_RAY_50074027B15397659710293",
        "RU_RAY_50074027B58734913057211",
        "RU_RAY_50074027B46234990239055",
        "RU_RAY_50074027B90298108562486",
        "RU_RAY_50074027B56261269840227",
        "RU_RAY_50074027B88013185762354",
        "RU_RAY_50074027B32234523409019",
        "RU_RAY_50074027B80784778261580",
        "RU_RAY_50074027B45994623884743",
        "RU_RAY_50074027B90614779989095",
        "RU_RAY_50074027B78384695872642",
        "RU_RAY_50074027B14866236496224",
        "RU_RAY_50074027B27931316124988",
        "RU_RAY_50074027B17054577586342",
        "RU_RAY_50074027B40618697737255",
        "RU_RAY_50074027B49919622206387",
    ],
    "NOV": [
        "RU_RAY_50074027B57630745445526",
        "RU_RAY_50074027B17069139049497",
        "RU_RAY_50074027B57738790926374",
        "RU_RAY_50074027B66695782907424",
        "RU_RAY_50074027B825124419295",
        "RU_RAY_50074027B31680341094146",
        "RU_RAY_50074027B99251072805017",
        "RU_RAY_50074027B26458158998268",
        "RU_RAY_50074027B38208689781366",
        "RU_RAY_50074027B30403513393594",
        "RU_RAY_50074027B83942452193490",
        "RU_RAY_50074027B86288600137250",
        "RU_RAY_50074027B20308709748837",
        "RU_RAY_50074027B10781871905366",
        "RU_RAY_50074027B77344027071403",
        "RU_RAY_50074027B48281585258812",
        "RU_RAY_50074027B93982822346714",
        "RU_RAY_50074027B58386304143379",
        "RU_RAY_50074027B1336621418144",
        "RU_RAY_50074027B72834669384190",
        "RU_RAY_50074027B3940071957277",
        "RU_RAY_50074027B77576750758664",
        "RU_RAY_50074027B35507316918508",
        "RU_RAY_50074027B71899291249917",
        "RU_RAY_50074027B71372738920568",
        "RU_RAY_50074027B63976435239634",
        "RU_RAY_50074027B42226450891188",
        "RU_RAY_50074027B14040427045082",
        "RU_RAY_50074027B16932918285671",
        "RU_RAY_50074027B58811812536316",
        "RU_RAY_50074027B1715913537377",
        "RU_RAY_50074027B54520830442466",
        "RU_RAY_50074027B77273209658100",
        "RU_RAY_50074027B70201567000150",
        "RU_RAY_50074027B82856800380020",
        "RU_RAY_50074027B71087427061133",
        "RU_RAY_50074027B84213807524310",
        "RU_RAY_50074027B8453473929567",
        "RU_RAY_50074027B15799482797585",
        "RU_RAY_50074027B76855541737815",
        "RU_RAY_50074027B71391443757864",
        "RU_RAY_50074027B18536602285327",
        "RU_RAY_50074027B47936450781023",
        "RU_RAY_50074027B45476358417172",
        "RU_RAY_50074027B19670057495733",
        "RU_RAY_50074027B94992557454451",
        "RU_RAY_50074027B52463258949821",
        "RU_RAY_50074027B59422198546785",
        "RU_RAY_50074027B25917769136183",
        "RU_RAY_50074027B63221441083377",
        "RU_RAY_50074027B50389061014103",
        "RU_RAY_50074027B2154875125895",
        "RU_RAY_50074027B52390719176951",
        "RU_RAY_50074027B30406481833497",
        "RU_RAY_50074027B95923812375268",
        "RU_RAY_50074027B86834547488285",
        "RU_RAY_50074027B95632257634540",
        "RU_RAY_50074027B36701865492404",
        "RU_RAY_50074027B55370730174848",
        "RU_RAY_50074027B10943489160103",
        "RU_RAY_50074027B23416918655185",
        "RU_RAY_50074027B7598546692655",
        "RU_RAY_50074027B81632682072915",
        "RU_RAY_50074027B5073921170544",
        "RU_RAY_50074027B23870764100253",
        "RU_RAY_50074027B34042519229436",
        "RU_RAY_50074027B92925758050684",
        "RU_RAY_50074027B19588857007790",
        "RU_RAY_50074027B34465006378506",
        "RU_RAY_50074027B1058063804271",
        "RU_RAY_50074027B70663252326506",
        "RU_RAY_50074027B83886659607675",
        "RU_RAY_50074027B42639071948243",
        "RU_RAY_50074027B84951526666168",
        "RU_RAY_50074027B1024572337800",
        "RU_RAY_50074027B59684569066792",
        "RU_RAY_50074027B85935779911627",
        "RU_RAY_50074027B57641669015548",
        "RU_RAY_50074027B92064145614684",
        "RU_RAY_50074027B1388901491568",
        "RU_RAY_50074027B10551483188825",
        "RU_RAY_50074027B36737161681879",
        "RU_RAY_50074027B71130034627460",
        "RU_RAY_50074027B40756489093750",
        "RU_RAY_50074027B93475347999022",
        "RU_RAY_50074027B30829642015709",
        "RU_RAY_50074027B47783670520754",
    ],
    "SAM": [
        "RU_RAY_50074027B81019147084957",
        "RU_RAY_50074027B71952656261998",
        "RU_RAY_50074027B29450610179229",
        "RU_RAY_50074027B75697889650200",
        "RU_RAY_50074027B21578169027167",
        "RU_RAY_50074027B22639528653177",
        "RU_RAY_50074027B71601382884380",
        "RU_RAY_50074027B18696350968774",
        "RU_RAY_50074027B16822435870965",
        "RU_RAY_50074027B41213194434352",
        "RU_RAY_50074027B51169643005911",
        "RU_RAY_50074027B18920333631541",
        "RU_RAY_50074027B58494309327601",
        "RU_RAY_50074027B69042014993745",
        "RU_RAY_50074027B162254919557",
        "RU_RAY_50074027B71986481877449",
        "RU_RAY_50074027B13106807035026",
        "RU_RAY_50074027B94750114415436",
        "RU_RAY_50074027B18672352117044",
        "RU_RAY_50074027B64491392404782",
        "RU_RAY_50074027B45979560927325",
        "RU_RAY_50074027B65580429840420",
        "RU_RAY_50074027B62598395721325",
        "RU_RAY_50074027B3504076174591",
        "RU_RAY_50074027B86178909427225",
        "RU_RAY_50074027B43476588942161",
        "RU_RAY_50074027B52168839909029",
        "RU_RAY_50074027B86765399126934",
        "RU_RAY_50074027B20925327326281",
        "RU_RAY_50074027B38118635608765",
        "RU_RAY_50074027B72738559478417",
        "RU_RAY_50074027B42412545361426",
        "RU_RAY_50074027B94297625349092",
        "RU_RAY_50074027B12201890066789",
        "RU_RAY_50074027B38225596479524",
        "RU_RAY_50074027B85690776295658",
        "RU_RAY_50074027B95115341980063",
        "RU_RAY_50074027B27656919133651",
        "RU_RAY_50074027B6645852757704",
        "RU_RAY_50074027B91893106294024",
        "RU_RAY_50074027B66648864289993",
        "RU_RAY_50074027B64412298842231",
        "RU_RAY_50074027B61660763245932",
        "RU_RAY_50074027B47970821426630",
        "RU_RAY_50074027B87542455562769",
        "RU_RAY_50074027B14046308931292",
        "RU_RAY_50074027B75875360813754",
    ],
    "TAT": [
        "RU_RAY_50074027B65680649502190",
        "RU_RAY_50074027B50870378095529",
        "RU_RAY_50074027B23135564614213",
        "RU_RAY_50074027B75126231322425",
        "RU_RAY_50074027B74270024958049",
        "RU_RAY_50074027B18720800896759",
        "RU_RAY_50074027B35491815687163",
        "RU_RAY_50074027B70950445205847",
        "RU_RAY_50074027B50222515317782",
        "RU_RAY_50074027B16082818896565",
        "RU_RAY_50074027B55935100114627",
        "RU_RAY_50074027B34722741360949",
        "RU_RAY_50074027B72145172947925",
        "RU_RAY_50074027B13097997893227",
        "RU_RAY_50074027B118068330623",
        "RU_RAY_50074027B32581079751483",
        "RU_RAY_50074027B71545093047352",
        "RU_RAY_50074027B69153114446918",
        "RU_RAY_50074027B84229869183057",
        "RU_RAY_50074027B24090004377266",
        "RU_RAY_50074027B97431177425360",
        "RU_RAY_50074027B86820200410565",
        "RU_RAY_50074027B9515993356197",
        "RU_RAY_50074027B95684013517374",
        "RU_RAY_50074027B95212793065375",
        "RU_RAY_50074027B93752716386466",
        "RU_RAY_50074027B850716987435",
        "RU_RAY_50074027B31759300167438",
        "RU_RAY_50074027B60985010124698",
        "RU_RAY_50074027B57478777755163",
        "RU_RAY_50074027B23577268238968",
        "RU_RAY_50074027B55167191655778",
        "RU_RAY_50074027B72395378197129",
        "RU_RAY_50074027B40407283881229",
        "RU_RAY_50074027B11385532042564",
        "RU_RAY_50074027B20422510937140",
        "RU_RAY_50074027B26896203164184",
        "RU_RAY_50074027B21782517866253",
        "RU_RAY_50074027B34615541367614",
        "RU_RAY_50074027B11474618491234",
        "RU_RAY_50074027B90915226779851",
        "RU_RAY_50074027B72378683266120",
        "RU_RAY_50074027B38115328423974",
        "RU_RAY_50074027B88266623404660",
        "RU_RAY_50074027B60884937558413",
        "RU_RAY_50074027B64084039723741",
        "RU_RAY_50074027B25745585862808",
        "RU_RAY_50074027B76252732369206",
        "RU_RAY_50074027B86184386577481",
        "RU_RAY_50074027B45287477613353",
        "RU_RAY_50074027B66059213577212",
        "RU_RAY_50074027B16188868533688",
        "RU_RAY_50074027B90828447565971",
        "RU_RAY_50074027B96335759543697",
        "RU_RAY_50074027B38173223175893",
        "RU_RAY_50074027B18567860996080",
        "RU_RAY_50074027B86343631049790",
        "RU_RAY_50074027B82042542483419",
        "RU_RAY_50074027B82698883305703",
        "RU_RAY_50074027B83821761201565",
        "RU_RAY_50074027B56747088904047",
        "RU_RAY_50074027B34536837751886",
        "RU_RAY_50074027B27017715662805",
        "RU_RAY_50074027B61119409198322",
        "RU_RAY_50074027B71700898288903",
        "RU_RAY_50074027B47324675773233",
        "RU_RAY_50074027B11413063881877",
        "RU_RAY_50074027B2525901146145",
        "RU_RAY_50074027B30901293245460",
        "RU_RAY_50074027B77142948304680",
    ],
    "URA": [
        "RU_RAY_50074027B5850936607294",
        "RU_RAY_50074027B72993481609927",
        "RU_RAY_50074027B18123411923849",
        "RU_RAY_50074027B58285687326194",
        "RU_RAY_50074027B23799547406598",
        "RU_RAY_50074027B21335467742043",
    ],
    "PFC": [
        "RU_RAY_50074027B74375992228315",
        "RU_RAY_50074027B76144209526439",
    ],
    "VMT": [
        "VNM-470",
        "VNM-452",
        "VNM-457",
        "VNM-451",
        "VNM-458",
        "VNM-455",
        "VNM-469",
        "VNM-464",
        "VNM-454",
        "VNM-511",
        "VNM-429",
    ],
    "PAK": [
        "IN_ADM2_76128533B68195849750399",
        "IN_ADM2_76128533B15567489974292",
        "IN_ADM2_76128533B32998994032811",
        "IN_ADM2_76128533B88214376170788",
        "IN_ADM2_76128533B20504715877560",
        "IN_ADM2_76128533B41744580856133",
        "IN_ADM2_76128533B32249045995424",
        "IN_ADM2_76128533B6393836306469",
        "IN_ADM2_76128533B74958462315105",
        "IN_ADM2_76128533B87327155385261",
        "IN_ADM2_76128533B37825396764028",
        "IN_ADM2_76128533B45655211862788",
        "IN_ADM2_76128533B50784044604286",
        "IN_ADM2_76128533B3371867518692",
    ],
    "SIA": [
        "MYS-1141",
        "MYS-1140",
        "MYS-1139",
        "MYS-1149",
        "MYS-1144",
        "MMR-3279",
        "KHM-1777",
        "KHM-1782",
        "KHM-1778",
        "KHM-1783",
        "KHM-1781",
        "KHM-1780",
        "KHM-1779",
        "LAO-3278",
        "LAO-3283",
        "LAO-3271",
    ],
    "MAN": [
        "CN_CITY_17275852B43165756519885",
        "CN_CITY_17275852B36714320356801",
        "CN_CITY_17275852B89036303488164",
        "CN_CITY_17275852B4344290320214",
        "CN_CITY_17275852B69801287390069",
        "CN_CITY_17275852B31900972836749",
        "CN_CITY_17275852B88151757349593",
        "CN_CITY_17275852B9681816955607",
        "CN_CITY_17275852B56182979447767",
        "CN_CITY_17275852B26763632681669",
        "CN_CITY_17275852B32842590404417",
        "CN_CITY_17275852B79805983057899",
        "CN_CITY_17275852B84472681161194",
        "CN_CITY_17275852B94774630505431",
        "CN_CITY_17275852B62534367670886",
        "CN_CITY_17275852B84296108244083",
        "CN_CITY_17275852B71122715185286",
    ],
}

TNO_1962_GREECE_COARSE_OWNER_BACKFILL = {
    "GR_ADM1_GRC-2883": "GRE",
    "GR_ADM1_GRC-2884": "GRE",
    "GR_ADM1_GRC-2885": "GRE",
    "GR_ADM1_GRC-2886": "GRE",
    "GR_ADM1_GRC-2892": "GRE",
    "GR_ADM1_GRC-2900": "GRE",
    "GR_ADM1_GRC-2949": "GRE",
    "GR_ADM1_GRC-2989": "GRE",
    "GR_ADM1_GRC-2991": "GRE",
    "GR_ADM1_GRC-2992": "BUL",
    "GR_ADM1_GRC-3001": "BUL",
}

TNO_1962_OWNER_ONLY_BACKFILL = {
    "CI_ADM1_83157122B12160353323799": "AFA",
    "CI_ADM1_83157122B20352934117266": "AFA",
    "CI_ADM1_83157122B28791092437733": "AFA",
    "CI_ADM1_83157122B58892240487392": "AFA",
    "CI_ADM1_83157122B62906982633778": "AFA",
    "CI_ADM1_83157122B69310198422077": "AFA",
    "CI_ADM1_83157122B74959515955757": "AFA",
    "CI_ADM1_83157122B79983119233374": "AFA",
    "UKK11": "ENG",
    "UKK12": "ENG",
    "UKK23": "ENG",
    "UKK25": "ENG",
    "UKK43": "ENG",
    "PL_POW_2001": "RKO",
    "PL_POW_2009": "RKO",
    "RU_RAY_50074027B11673707761487": "RKM",
    "RU_RAY_50074027B49278461872326": "RKM",
    "RU_RAY_50074027B5223158268211": "RKM",
    "RU_RAY_50074027B5631740772865": "RKM",
    "RU_RAY_50074027B58076034090645": "RKM",
    "RU_RAY_50074027B64055482679717": "RKM",
    "RU_RAY_50074027B71157437388348": "RKM",
    "RU_RAY_50074027B87627181065564": "RKM",
    "RU_RAY_50074027B99227036451137": "RKM",
    "RU_RAY_50074027B99894122533642": "RKM",
    "RU_RAY_50074027B93805213208185": "VOL",
}

TNO_1962_MANUAL_COUNTRY_OVERRIDES = {
    "WRS": {
        "display_name": "West Russian Revolutionary Front",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#a3424c",
        "notes": "West Russian Revolutionary Front scenario country restored for the north-western Russian transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "SAM": {
        "display_name": "Russian Liberation Army",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#c2a994",
        "notes": "Samara is repurposed as the Russian Liberation Army for the requested Volga transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "TAT": {
        "display_name": "Tatar Republic",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#b32400",
        "notes": "Tatar Republic takes over the former Samara-held TNO 1962 Russian breakaway territory.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "GCE": {
        "display_name": "German Cornwall Expeditionary Force",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_northern_europe",
        "subregion_label": "Northern Europe",
        "base_iso2": "GB",
        "lookup_iso2": "GB",
        "provenance_iso2": "GB",
        "color_hex": "#6a6a6a",
        "notes": "German expeditionary occupation zone across Cornwall and the Bristol approaches in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "GER",
    },
    "TAN": {
        "display_name": "People's Revolutionary Council",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#701510",
        "notes": "Tannu Tuva renamed to People's Revolutionary Council for the requested TNO 1962 transfer set.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "IRK": {
        "display_name": "Far Eastern Presidium",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#912b40",
        "notes": "Far Eastern Presidium formed from the Irkutsk transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "BRY": {
        "display_name": "Buryat Soviet Socialist Republic",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#af0f1c",
        "notes": "Buryat Soviet Socialist Republic formed from the Buryat transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "CHT": {
        "display_name": "Far Eastern Tsardom",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#8e838a",
        "notes": "Far Eastern Tsardom formed from the Chita transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "YAK": {
        "display_name": "Sakha Republic",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#4f6365",
        "notes": "Sakha Republic restored from the Yakutia transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "SBA": {
        "display_name": "Siberian Black Army",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#000000",
        "notes": "Siberian Black Army restored from the central Siberian transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "GOR": {
        "display_name": "13th Panzer Army - Gorky",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#a07683",
        "notes": "13th Panzer Army - Gorky formed from the Gorky transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "KOM": {
        "display_name": "Komi Republic",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#5e83a2",
        "notes": "Komi Republic restored from the requested north-eastern European transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "VOL": {
        "display_name": "Vologda Neutral Zone",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#6e6e85",
        "notes": "Vologda Neutral Zone restored from the requested Vologda transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "SVR": {
        "display_name": "Ural Military District",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#8c6e7c",
        "notes": "Sverdlovsk is restyled as the Ural Military District for the requested west Siberian transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "KUR": {
        "display_name": "Kurdistan",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_western_asia",
        "subregion_label": "Western Asia",
        "base_iso2": "IQ",
        "lookup_iso2": "IQ",
        "provenance_iso2": "IQ",
        "color_hex": "#635988",
        "notes": "Kurdistan restored from the requested northern Iraq transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "KOR": {
        "display_name": "Korean Residency-General",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_eastern_asia",
        "subregion_label": "Eastern Asia",
        "base_iso2": "KR",
        "lookup_iso2": "KR",
        "provenance_iso2": "KR",
        "color_hex": "#82132e",
        "notes": "Japanese colonial administration over Korea restyled as the Korean Residency-General in the 1962 scenario.",
        "entry_kind": "scenario_subject",
        "parent_owner_tag": "JAP",
    },
    "FFR": {
        "display_name": "Free France",
        "continent_id": "continent_africa",
        "continent_label": "Africa",
        "subregion_id": "subregion_western_africa",
        "subregion_label": "Western Africa",
        "base_iso2": "FR",
        "lookup_iso2": "FR",
        "provenance_iso2": "FR",
        "color_hex": "#464678",
        "notes": "Free France restored in West Africa from the requested Ivory Coast transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "AFA": {
        "display_name": "African Anarchy",
        "continent_id": "continent_africa",
        "continent_label": "Africa",
        "subregion_id": "subregion_western_africa",
        "subregion_label": "Western Africa",
        "base_iso2": "NE",
        "lookup_iso2": "NE",
        "provenance_iso2": "NE",
        "color_hex": "#050505",
        "notes": "African Anarchy created from the requested Saharan collapse zone in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "RFA": {
        "display_name": "Russian Anarchy",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#4a4a4a",
        "notes": "Russian Anarchy created from the requested northern Siberian collapse zone in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "TYM": {
        "display_name": "Tyumen",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#823d3d",
        "notes": "Tyumen restored from the requested western Siberian transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "RUR": {
        "display_name": "Rurik Kingdom",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#3c5a8a",
        "notes": "Rurik Kingdom created from the requested central Siberian transfer set in TNO 1962 using the Kemerovo palette color.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "KRS": {
        "display_name": "Krasnodar",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#d7d4ae",
        "notes": "Krasnodar created from the requested central Siberian transfer set in TNO 1962 using the KRS palette color.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "VOR": {
        "display_name": "Vorkuta Labor Camp",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#87bdb8",
        "notes": "Vorkuta Labor Camp tag reserved from the requested northern camp transfer set in TNO 1962; the overlapping territory is subsequently reassigned to the Orenburg-Ural Union.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
        "allow_zero_feature": True,
    },
    "OUR": {
        "display_name": "Orenburg-Ural Union",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#b4b3da",
        "notes": "Orenburg-Ural Union created from the requested southern Ural and Vorkuta transfer set in TNO 1962 using the Ural League palette color.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "URA": {
        "display_name": "Ural Military District Red Air Force",
        "continent_id": "continent_europe",
        "continent_label": "Europe",
        "subregion_id": "subregion_eastern_europe",
        "subregion_label": "Eastern Europe",
        "base_iso2": "RU",
        "lookup_iso2": "RU",
        "provenance_iso2": "RU",
        "color_hex": "#b4b3da",
        "notes": "Ural Military District Red Air Force created from the requested western Siberian air command transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "VMT": {
        "display_name": "Viet Minh",
        "continent_id": "continent_asia",
        "continent_label": "Asia",
        "subregion_id": "subregion_south_eastern_asia",
        "subregion_label": "South-Eastern Asia",
        "base_iso2": "VN",
        "lookup_iso2": "VN",
        "provenance_iso2": "VN",
        "color_hex": "#a76286",
        "notes": "Viet Minh restored from the requested northern Vietnamese transfer set in TNO 1962.",
        "entry_kind": "scenario_country",
        "parent_owner_tag": "",
    },
    "IAL": {
        "display_name": "Italian Algeria",
        "continent_id": "continent_africa",
        "continent_label": "Africa",
        "subregion_id": "subregion_northern_africa",
        "subregion_label": "Northern Africa",
        "base_iso2": "DZ",
        "lookup_iso2": "DZ",
        "provenance_iso2": "DZ",
        "color_hex": "#5f7f55",
        "notes": "Italian Algeria created from the requested eastern and southern Algerian transfer set in TNO 1962.",
        "entry_kind": "scenario_subject",
        "parent_owner_tag": "ITA",
    },
    "ALC": {
        "display_name": "Algerian Command",
        "continent_id": "continent_africa",
        "continent_label": "Africa",
        "subregion_id": "subregion_northern_africa",
        "subregion_label": "Northern Africa",
        "base_iso2": "DZ",
        "lookup_iso2": "DZ",
        "provenance_iso2": "DZ",
        "color_hex": "#b89d73",
        "notes": "Algerian Command created from the requested western Algerian transfer set in TNO 1962.",
        "entry_kind": "scenario_subject",
        "parent_owner_tag": "IBR",
    },
}

TNO_1962_COUNTRY_DISPLAY_NAME_OVERRIDES = {
    "CHI": "Republic of China",
    "RGC": "Sichuan Clique",
    "GNG": "Guangdong State",
    "GMA": "Northwest Pacification Government",
    "QMA": "13th National Revolutionary Army",
    "GCO": "German Central Africa",
}

TNO_1962_DIRECT_TNO_COLOR_TAGS = {
    "ENG",
    "SCO",
    "IRE",
    "SWE",
    "FIN",
    "ITA",
    "SPR",
    "POR",
}

TNO_1962_AMERICA_CONTINENT_IDS = {
    "continent_north_america",
    "continent_south_america",
}

TNO_1962_TNO_COLOR_PROXY_TAGS = {
    "FRA": "FRM",
    "WLS": "WAL",
    "PUE": "USA",
    "RKO": "OST",
    "RKU": "UKR",
    "RKK": "CAU",
    "RKN": "HOL",
    "RKP": "GGN",
    "RKNO": "NOR",
}

TNO_1962_TNO_COLOR_FIXED_HEX = {
    "BRM": "#40839e",
    "CAM": "#685d6d",
    "CHI": "#ce9f61",
    "FRI": "#2a62a2",
    "GER": "#3c3c3c",
    "INS": "#9f344d",
    "MAN": "#a80043",
    "MEN": "#8f354b",
    "PAK": "#21331e",
    "RKM": "#4f4554",
    "SHX": "#955a74",
    "TIB": "#c8c8c8",
    "VIN": "#a76286",
    "XIK": "#6873a0",
    "XIN": "#5f8e9c",
    "YUN": "#763446",
}

UNAPPLIED_ACTION_IDS = (
    "arctic_islands_to_ger",
)

CONGO_LAKE_TARGET_BBOX = (14.0, -6.4, 24.9, 4.2)
CONGO_LAKE_SEED_IDS = {2281, 5786}
CONGO_LAKE_SEARCH_BBOX = (2800, 1260, 3300, 1465)
SCENARIO_SPLIT_SUFFIX_RE = re.compile(r"__tno1962_(\d+)$")
STATE_FILE_RE = re.compile(r"^(?P<id>\d+)-(?P<name>.+)\.txt$")

ATLANTROPA_REGION_CONFIGS = {
    "adriatica": {
        "feature_group_id": "atlantropa_adriatica_salt_basin",
        "group_label": "Adriatica Salt Basin",
        "aoi_bbox": (11.3, 39.0, 21.4, 46.2),
        "sea_completion_bbox": (10.9, 38.8, 21.8, 46.4),
        "land_state_ids": [
            8487, 8488, 8489,
            8491, 8492, 8493, 8494, 8495, 8496, 8497,
            8501, 8502, 8503, 8504, 8505, 8506, 8507, 8508, 8509,
            9072, 9073, 9074, 9075, 9076, 9077,
            9888, 10340, 10458, 10459, 10460, 10461, 10462,
        ],
        "water_state_ids": [8597, 8601, 8602, 8604],
        "state_owner_overrides": {
            8487: "ITA",
            8488: "ITA",
            8489: "ITA",
            8491: "ITA",
            8492: "CRO",
            8493: "CRO",
            8494: "CRO",
            8495: "CRO",
            8497: "CRO",
            8501: "CRO",
            8502: "CRO",
            8503: "CRO",
            8504: "CRO",
            8505: "SER",
            8506: "ITA",
            8507: "ITA",
            8508: "GRE",
            8509: "GRE",
            9074: "GRE",
            9075: "ITA",
            9076: "CRO",
            9077: "ITA",
            10340: "CRO",
            10458: "ITA",
            10459: "ITA",
            10460: "ITA",
            10461: "ITA",
            10462: "ITA",
        },
        "control_points": {
            8491: (12.40, 45.35),
            10462: (13.75, 45.72),
            8495: (15.30, 44.15),
            8507: (19.20, 40.85),
            8509: (19.90, 39.75),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.14,
        "simplify_tolerance": 0.009,
        "precision_simplify_tolerance": 0.0075,
        "pixel_fragment_area_threshold": 0.0032,
        "island_replacement": True,
        "island_merge_distance": 0.03,
        "mainland_component_min_area": 2.8,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.086,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.11,
        "boolean_weld_width": 0.034,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.085,
        "shore_seal_width": 0.086,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.115,
        "causeway_keep_state_ids": [9072, 9073, 9077],
        "nearshore_island_join_state_ids": [8492, 8493, 8494, 8495, 8497, 8501, 8502, 8503, 8504, 8505, 8506, 8508, 9076, 10340],
        "major_island_groups": [
            {
                "id": "corfu",
                "label": "Corfu",
                "owner_tag": "GRE",
                "donor_state_ids": [8509, 9074],
                "baseline_feature_ids": ["EL622"],
                "search_margin": 0.18,
                "gap_fill_buffer": 0.08,
                "boolean_weld_distance": 0.1,
                "boolean_weld_width": 0.02,
            },
        ],
    },
    "sicily_tunis": {
        "feature_group_id": "atlantropa_sicily_tunis_salt_shelf",
        "group_label": "Sicily-Tunis Salt Shelf",
        "aoi_bbox": (7.4, 34.6, 16.2, 39.2),
        "sea_completion_bbox": (7.0, 34.2, 16.5, 39.5),
        "land_state_ids": [
            8486, 8557, 8558, 8559, 8560, 8561, 8562, 8566,
            9036, 9037, 9078, 9080, 9081, 9083,
        ],
        "water_state_ids": [8591, 8592, 8598, 8600, 8603, 8606],
        "state_owner_overrides": {
            8486: "ITA",
            8557: "ITA",
            8558: "ITA",
            8559: "ITA",
            8560: "ITA",
            8561: "ITA",
            8562: "TUN",
            8566: "ITA",
            9036: "TUN",
            9037: "ITA",
            9078: "ITA",
            9080: "ITA",
            9081: "TUN",
            9083: "ITA",
        },
        "control_points": {
            8557: (13.30, 38.15),
            8559: (15.10, 37.20),
            8562: (10.00, 37.00),
            9037: (11.95, 36.80),
            8561: (14.70, 35.90),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.14,
        "simplify_tolerance": 0.012,
        "precision_simplify_tolerance": 0.0105,
        "pixel_fragment_area_threshold": 0.0028,
        "island_replacement": True,
        "island_merge_distance": 0.03,
        "mainland_component_min_area": 2.8,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.075,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.095,
        "boolean_weld_width": 0.02,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.055,
        "shore_seal_width": 0.07,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.09,
        "causeway_keep_state_ids": [8486, 8566, 9078, 9080],
        "major_island_groups": [
            {
                "id": "sicily",
                "label": "Sicily",
                "owner_tag": "ITA",
                "donor_state_ids": [8557, 8558, 8559, 8561],
                "baseline_feature_ids": ["ITG11", "ITG12", "ITG13", "ITG14", "ITG15", "ITG17", "ITG18", "ITG19"],
                "search_margin": 0.35,
                "gap_fill_buffer": 0.12,
                "boolean_weld_distance": 0.18,
                "boolean_weld_width": 0.035,
            },
            {
                "id": "malta",
                "label": "Malta",
                "owner_tag": "ITA",
                "donor_state_ids": [8560],
                "baseline_feature_ids": ["MT001", "MT002"],
                "search_margin": 0.18,
                "gap_fill_buffer": 0.08,
                "boolean_weld_distance": 0.1,
                "boolean_weld_width": 0.02,
            },
        ],
    },
    "gabes": {
        "feature_group_id": "atlantropa_gulf_of_gabes_exposure",
        "group_label": "Gulf of Gabes Exposure",
        "aoi_bbox": (9.6, 32.9, 11.8, 34.8),
        "sea_completion_bbox": (9.4, 32.7, 12.1, 35.0),
        "land_state_ids": [10202, 9079],
        "water_state_ids": [8592, 8598, 8606],
        "state_owner_overrides": {
            10202: "TUN",
            9079: "TUN",
        },
        "control_points": {
            10202: (10.15, 33.72),
            9079: (11.25, 33.88),
            8562: (10.00, 37.00),
        },
        "preserve_margin": 0.025,
        "sea_preserve_margin": 0.025,
        "snap_tolerance": 0.1,
        "simplify_tolerance": 0.01,
        "precision_simplify_tolerance": 0.009,
        "pixel_fragment_area_threshold": 0.002,
        "island_replacement": False,
        "mainland_component_min_area": 2.2,
        "mainland_touch_tolerance": 0.03,
        "shore_seal_width": 0.06,
        "shore_seal_min_area": 0.00004,
        "shore_seal_max_area": 0.055,
    },
    "levant": {
        "feature_group_id": "atlantropa_levantine_retreat_margin",
        "group_label": "Levantine Retreat Margin",
        "aoi_bbox": (31.2, 30.5, 36.7, 37.5),
        "sea_completion_bbox": (30.8, 30.2, 37.1, 37.8),
        "land_state_ids": [
            8544, 8545, 9035, 8546, 8547, 8548, 8549, 8550,
            8551, 8552, 8553, 8554, 8555, 8556,
        ],
        "water_state_ids": [8609, 8611, 8612, 8613, 8614, 8615],
        "state_owner_overrides": {
            8544: "TUR",
            8545: "TUR",
            8546: "SYR",
            8547: "LEB",
            8548: "PAL",
            8549: "PAL",
            8550: "EGY",
            8551: "TUR",
            8552: "TUR",
            8553: "TUR",
            8554: "TUR",
            8555: "TUR",
            8556: "TUR",
            9035: "TUR",
        },
        "control_points": {
            9035: (36.10, 36.20),
            8545: (36.25, 35.95),
            8547: (35.45, 33.95),
            8548: (34.65, 32.25),
            8550: (33.45, 31.25),
            8555: (33.25, 35.10),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "precision_simplify_tolerance": 0.0105,
        "pixel_fragment_area_threshold": 0.0026,
        "island_replacement": True,
        "island_merge_distance": 0.024,
        "mainland_component_min_area": 3.0,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.094,
        "gap_fill_min_area": 0.00005,
        "gap_fill_max_area": 0.11,
        "boolean_weld_width": 0.027,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.07,
        "shore_seal_width": 0.082,
        "shore_seal_min_area": 0.00005,
        "shore_seal_max_area": 0.1,
        "major_island_groups": [
            {
                "id": "cyprus",
                "label": "Cyprus",
                "owner_tag": "TUR",
                "donor_state_ids": [8551, 8552, 8553, 8554, 8555, 8556],
                "baseline_feature_ids": ["CY000"],
                "search_margin": 0.26,
                "gap_fill_buffer": 0.12,
                "boolean_weld_distance": 0.16,
                "boolean_weld_width": 0.03,
            },
        ],
    },
    "tyrrhenian": {
        "feature_group_id": "atlantropa_tyrrhenian_and_west_italy",
        "group_label": "Tyrrhenian and West Italian Coast",
        "aoi_bbox": (5.7, 37.4, 18.8, 45.6),
        "sea_completion_bbox": (5.0, 37.0, 19.2, 46.0),
        "land_state_ids": [
            8466, 8467, 8468, 8469, 8470, 8471, 8472, 8473, 8474, 8475,
            8476, 8477, 8478, 8479, 8480, 8481, 8482, 8483, 8484, 8485,
        ],
        "water_state_ids": [8578, 8579, 8588, 8589, 8590, 8593],
        "state_owner_overrides": {
            8466: "FRA",
            8467: "FRA",
            8468: "ITA",
            8469: "ITA",
            8470: "ITA",
            8471: "ITA",
            8472: "ITA",
            8473: "ITA",
            8474: "ITA",
            8475: "ITA",
            8476: "ITA",
            8477: "ITA",
            8478: "ITA",
            8479: "ITA",
            8480: "ITA",
            8481: "ITA",
            8482: "ITA",
            8483: "ITA",
            8484: "ITA",
            8485: "ITA",
        },
        "control_points": {
            8466: (6.60, 43.75),
            8468: (8.95, 44.15),
            8470: (9.15, 42.15),
            8472: (8.85, 40.0),
            8475: (9.55, 40.15),
            8478: (12.65, 41.65),
            8483: (16.55, 38.65),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "precision_simplify_tolerance": 0.0105,
        "pixel_fragment_area_threshold": 0.0028,
        "island_replacement": True,
        "island_merge_distance": 0.03,
        "mainland_component_min_area": 3.2,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.11,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.16,
        "boolean_weld_width": 0.038,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.095,
        "shore_seal_width": 0.09,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.13,
        "major_island_groups": [
            {
                "id": "corsica",
                "label": "Corsica",
                "owner_tag": "ITA",
                "donor_state_ids": [8470],
                "baseline_feature_ids": ["FR_ARR_2A001", "FR_ARR_2A004", "FR_ARR_2B002", "FR_ARR_2B003"],
                "search_margin": 0.28,
                "gap_fill_buffer": 0.12,
                "boolean_weld_distance": 0.14,
                "boolean_weld_width": 0.03,
            },
            {
                "id": "sardinia",
                "label": "Sardinia",
                "owner_tag": "ITA",
                "donor_state_ids": [8471, 8472, 8473, 8474, 8475],
                "baseline_feature_ids": ["ITG2D", "ITG2E", "ITG2F", "ITG2G", "ITG2H"],
                "search_margin": 0.34,
                "gap_fill_buffer": 0.14,
                "boolean_weld_distance": 0.18,
                "boolean_weld_width": 0.04,
            },
        ],
    },
    "west_med": {
        "feature_group_id": "atlantropa_west_mediterranean_margin",
        "group_label": "West Mediterranean and Iberia-Algeria",
        "aoi_bbox": (-6.2, 34.0, 11.6, 44.7),
        "sea_completion_bbox": (-6.8, 33.3, 12.3, 45.1),
        "land_state_ids": [
            8446, 8447, 8448, 8449, 8450, 8451, 8452, 8453, 8454, 8455,
            8456, 8457, 8458, 8459, 8460, 8461, 8462, 8463, 8464, 8465,
        ],
        "water_state_ids": [8577, 8580, 8581, 8582, 8583, 8584, 8585, 8586, 8587, 8594, 8595, 8596, 9040],
        "state_owner_overrides": {
            8446: "SPR",
            8447: "SPR",
            8448: "SPR",
            8452: "SPR",
            8453: "SPR",
            8454: "ALC",
            8455: "SPR",
            8456: "SPR",
            8457: "SPR",
            8458: "SPR",
            8459: "SPR",
            8460: "SPR",
            8461: "SPR",
            8462: "FRA",
            8463: "FRA",
            8464: "FRA",
            8465: "IAL",
        },
        "control_points": {
            8447: (-5.55, 36.05),
            8452: (-5.35, 35.55),
            8454: (0.15, 36.8),
            8458: (1.75, 40.75),
            8460: (3.05, 39.7),
            8462: (2.8, 42.55),
            8463: (1.65, 43.35),
            8464: (5.4, 43.2),
            8465: (6.95, 36.85),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.024,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "precision_simplify_tolerance": 0.0105,
        "pixel_fragment_area_threshold": 0.0028,
        "island_replacement": True,
        "island_merge_distance": 0.032,
        "mainland_component_min_area": 3.5,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.094,
        "gap_fill_min_area": 0.00008,
        "gap_fill_max_area": 0.16,
        "boolean_weld_width": 0.032,
        "boolean_weld_min_area": 0.00002,
        "boolean_weld_max_area": 0.095,
        "shore_seal_width": 0.084,
        "shore_seal_min_area": 0.00008,
        "shore_seal_max_area": 0.13,
        "causeway_keep_state_ids": [8449],
        "major_island_groups": [
            {
                "id": "balearics",
                "label": "Balearics",
                "owner_tag": "SPR",
                "donor_state_ids": [8459, 8460, 8461],
                "baseline_feature_ids": ["ES531", "ES532", "ES533"],
                "search_margin": 0.3,
                "gap_fill_buffer": 0.12,
                "boolean_weld_distance": 0.16,
                "boolean_weld_width": 0.03,
            },
        ],
    },
    "aegean": {
        "feature_group_id": "atlantropa_aegean_and_islands",
        "group_label": "Aegean and Greek Islands",
        "aoi_bbox": (18.5, 33.4, 31.3, 42.35),
        "sea_completion_bbox": (22.0, 34.4, 31.7, 42.55),
        "land_state_ids": [
            8510, 8512, 8515, 8516, 8517, 8518, 8519, 8520, 8521, 8522,
            8523, 8524, 8525, 8526, 8527, 8528, 8529, 8530, 8531, 8532,
            8533, 8534, 8535, 8536, 8537, 8538, 8539, 8540, 8541, 8542,
            8543,
            8653,
        ],
        "water_state_ids": [8445, 8607, 8608, 8610, 8619, 8620, 8621, 8622],
        "state_owner_overrides": {
            8510: "GRE",
            8512: "GRE",
            8515: "GRE",
            8516: "GRE",
            8517: "GRE",
            8518: "GRE",
            8519: "GRE",
            8520: "GRE",
            8521: "GRE",
            8522: "GRE",
            8523: "GRE",
            8524: "GRE",
            8525: "GRE",
            8526: "GRE",
            8527: "GRE",
            8528: "GRE",
            8529: "GRE",
            8530: "GRE",
            8531: "GRE",
            8532: "GRE",
            8533: "TUR",
            8534: "TUR",
            8535: "GRE",
            8536: "GRE",
            8537: "TUR",
            8538: "GRE",
            8539: "GRE",
            8540: "TUR",
            8541: "GRE",
            8542: "GRE",
            8543: "TUR",
            8653: "GRE",
        },
        "control_points": {
            8516: (22.1, 37.35),
            8520: (23.75, 37.95),
            8522: (24.8, 35.15),
            8531: (26.95, 40.85),
            8533: (26.2, 40.2),
            8537: (27.15, 38.45),
            8540: (27.45, 37.1),
            8541: (28.0, 36.15),
            8543: (30.55, 36.75),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.024,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "precision_simplify_tolerance": 0.0105,
        "pixel_fragment_area_threshold": 0.0024,
        "island_replacement": True,
        "island_merge_distance": 0.036,
        "mainland_component_min_area": 2.5,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.092,
        "gap_fill_min_area": 0.00005,
        "gap_fill_max_area": 0.11,
        "boolean_weld_width": 0.028,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.08,
        "shore_seal_width": 0.08,
        "shore_seal_min_area": 0.00005,
        "shore_seal_max_area": 0.1,
        "major_island_groups": [
            {
                "id": "crete",
                "label": "Crete",
                "owner_tag": "GRE",
                "donor_state_ids": [8522, 8525],
                "group_bbox": (22.8, 34.2, 26.8, 35.9),
                "search_margin": 0.28,
                "gap_fill_buffer": 0.11,
                "boolean_weld_distance": 0.14,
                "boolean_weld_width": 0.028,
            },
            {
                "id": "euboea",
                "label": "Euboea",
                "owner_tag": "GRE",
                "donor_state_ids": [8521],
                "group_bbox": (23.15, 38.1, 24.8, 39.7),
                "search_margin": 0.16,
                "gap_fill_buffer": 0.06,
                "boolean_weld_distance": 0.1,
                "boolean_weld_width": 0.018,
            },
            {
                "id": "lesvos",
                "label": "Lesvos",
                "owner_tag": "GRE",
                "donor_state_ids": [8536],
                "group_bbox": (25.75, 38.8, 26.7, 39.55),
                "search_margin": 0.16,
                "gap_fill_buffer": 0.06,
                "boolean_weld_distance": 0.1,
                "boolean_weld_width": 0.018,
            },
            {
                "id": "chios",
                "label": "Chios",
                "owner_tag": "GRE",
                "donor_state_ids": [8538],
                "group_bbox": (25.85, 38.15, 26.7, 38.8),
                "search_margin": 0.16,
                "gap_fill_buffer": 0.06,
                "boolean_weld_distance": 0.1,
                "boolean_weld_width": 0.018,
            },
            {
                "id": "rhodes",
                "label": "Rhodes",
                "owner_tag": "GRE",
                "donor_state_ids": [8541],
                "group_bbox": (27.35, 35.8, 28.35, 36.45),
                "search_margin": 0.18,
                "gap_fill_buffer": 0.08,
                "boolean_weld_distance": 0.11,
                "boolean_weld_width": 0.02,
            },
            {
                "id": "limnos",
                "label": "Limnos",
                "owner_tag": "GRE",
                "donor_state_ids": [8535],
                "group_bbox": (25.0, 39.55, 25.7, 40.2),
                "search_margin": 0.14,
                "gap_fill_buffer": 0.05,
                "boolean_weld_distance": 0.08,
                "boolean_weld_width": 0.016,
            },
            {
                "id": "samothraki",
                "label": "Samothraki",
                "owner_tag": "GRE",
                "donor_state_ids": [8532],
                "group_bbox": (25.3, 40.3, 26.05, 41.0),
                "search_margin": 0.14,
                "gap_fill_buffer": 0.05,
                "boolean_weld_distance": 0.08,
                "boolean_weld_width": 0.016,
            },
            {
                "id": "imbros",
                "label": "Imbros",
                "owner_tag": "TUR",
                "donor_state_ids": [8534],
                "group_bbox": (25.75, 39.65, 26.55, 40.4),
                "search_margin": 0.14,
                "gap_fill_buffer": 0.05,
                "boolean_weld_distance": 0.08,
                "boolean_weld_width": 0.016,
            },
        ],
    },
    "libya_suez": {
        "feature_group_id": "atlantropa_libya_suez_and_qattara",
        "group_label": "Libya, Cyrenaica and Suez Chain",
        "aoi_bbox": (12.5, 28.0, 35.2, 34.2),
        "sea_completion_bbox": (11.8, 27.8, 35.9, 34.8),
        "land_state_ids": [8563, 8564, 8565, 8567, 8568, 8569, 8570, 8572, 8574, 8575, 8576],
        "water_state_ids": [8599, 8605, 8613, 8614, 8615, 8616, 8617, 8618],
        "state_owner_overrides": {
            8563: "LBA",
            8564: "LBA",
            8565: "LBA",
            8567: "LBA",
            8568: "LBA",
            8569: "EGY",
            8570: "EGY",
            8575: "EGY",
            8576: "EGY",
        },
        "control_points": {
            8563: (12.45, 31.95),
            8564: (13.2, 32.85),
            8565: (20.1, 32.05),
            8567: (21.15, 32.55),
            8568: (22.7, 32.7),
            8569: (25.2, 31.55),
            8570: (29.9, 31.05),
            8575: (32.45, 30.7),
            8576: (33.15, 30.55),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.022,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "precision_simplify_tolerance": 0.0105,
        "pixel_fragment_area_threshold": 0.0028,
        "island_replacement": False,
        "mainland_component_min_area": 3.5,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.108,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.13,
        "boolean_weld_width": 0.03,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.085,
        "shore_seal_width": 0.085,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.11,
        "causeway_keep_state_ids": [8575, 8576],
        "causeway_trim_state_ids": [8575, 8576],
        "causeway_drop_state_ids": [8572, 8574],
        "causeway_trim_width": 0.16,
        "sea_drop_enclosed_max_area": 0.045,
    },
}

COASTAL_RESTORE_AOI_CONFIGS = {
    "south_italy": {
        "label": "South Italy and lower Adriatic coast",
        "bbox": (12.0, 36.0, 19.5, 42.5),
    },
    "north_yugo": {
        "label": "North Yugoslavia and Dalmatian coast",
        "bbox": (12.0, 42.0, 19.8, 46.2),
    },
    "tunisia": {
        "label": "Central Tunisian coast",
        "bbox": (8.0, 31.5, 12.5, 37.8),
    },
    "egypt_north": {
        "label": "Northern Egypt and Palestine coast",
        "bbox": (24.0, 29.0, 35.5, 32.8),
    },
    "anatolia_sw": {
        "label": "South-west Anatolia and eastern Aegean coast",
        "bbox": (26.0, 35.0, 37.5, 38.8),
    },
    "french_riviera_liguria": {
        "label": "French Riviera, Liguria and north Tyrrhenian seam",
        "bbox": (5.0, 42.0, 10.8, 45.1),
    },
    "sardinia_tyrrhenian": {
        "label": "Sardinia, Corsica and Tyrrhenian coast",
        "bbox": (6.5, 37.2, 18.8, 44.6),
    },
    "west_mediterranean": {
        "label": "West Mediterranean and Iberia-Algeria coast",
        "bbox": (-6.5, 33.8, 11.8, 44.8),
    },
    "levant_focus": {
        "label": "Levant and Palestine shoreline seam focus",
        "bbox": (33.0, 31.0, 36.8, 35.2),
    },
    "levant_north": {
        "label": "Lebanon, Palestine and northern Levant coast",
        "bbox": (31.8, 30.8, 36.9, 35.9),
    },
    "aegean": {
        "label": "Aegean and Greek island shoreline",
        "bbox": (18.5, 33.2, 31.4, 42.2),
    },
    "bosphorus_black_sea_mouth": {
        "label": "Bosphorus and Black Sea mouth shoreline",
        "bbox": (28.0, 40.55, 31.8, 42.35),
    },
    "libya_suez": {
        "label": "Libya, Alexandria and Suez shoreline",
        "bbox": (12.1, 28.0, 35.6, 34.1),
    },
    "congo": {
        "label": "Congo Lake shoreline recovery ring",
        "bbox": (12.0, -7.0, 26.0, 5.0),
    },
}

CONTEXT_LAND_MASK_PROTECTED_AOI_KEYS = (
    "west_mediterranean",
    "aegean",
    "bosphorus_black_sea_mouth",
    "libya_suez",
    "congo",
)
CONTEXT_LAND_MASK_PROTECTED_AOI_MARGIN_DEG = 0.35


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict:
    payload = read_json_strict(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, found {type(payload).__name__}.")
    return payload


def _pid_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _load_active_server_metadata(path: Path = RUNTIME_ACTIVE_SERVER_METADATA_PATH) -> dict[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = load_json(path)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _ensure_scenario_publish_target_offline(
    scenario_dir: Path,
    metadata_path: Path | None = None,
) -> None:
    metadata_path = metadata_path or RUNTIME_ACTIVE_SERVER_METADATA_PATH
    metadata = _load_active_server_metadata(metadata_path)
    if not metadata:
        return
    raw_pid = metadata.get("pid")
    try:
        pid = int(raw_pid)
    except (TypeError, ValueError):
        return
    if pid <= 0 or not _pid_is_alive(pid):
        return
    raw_cwd = str(metadata.get("cwd") or "").strip()
    if not raw_cwd:
        return
    server_root = Path(raw_cwd).resolve()
    target_dir = scenario_dir.resolve()
    if not target_dir.is_relative_to(server_root):
        return
    raise RuntimeError(
        "Scenario data publish is blocked because a live dev server is serving this workspace. "
        f"Stop the local dev server or close browser tabs using {metadata.get('url') or 'the active preview'}, "
        f"then retry publishing {target_dir}."
    )


_mediterranean_template_water_gdf: gpd.GeoDataFrame | None = None
_global_water_regions_feature_index: dict[str, dict] | None = None
_marine_regions_feature_collection_cache: dict[tuple[str, str], dict] = {}


def load_mediterranean_template_water_gdf() -> gpd.GeoDataFrame:
    global _mediterranean_template_water_gdf
    if _mediterranean_template_water_gdf is not None:
        return _mediterranean_template_water_gdf.copy()
    payload = load_json(WATER_REGIONS_PATH)
    features = [
        feature
        for feature in payload.get("features", [])
        if str(feature.get("properties", {}).get("region_group") or "").strip().lower()
        == MEDITERRANEAN_WATER_REGION_GROUP
    ]
    gdf = geopandas_from_features(features).reset_index(drop=True)
    _mediterranean_template_water_gdf = gdf.copy()
    return gdf


def load_global_water_regions_feature_index() -> dict[str, dict]:
    global _global_water_regions_feature_index
    if _global_water_regions_feature_index is not None:
        return copy.deepcopy(_global_water_regions_feature_index)
    payload = load_json(WATER_REGIONS_PATH)
    feature_index = {}
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        region_id = str(props.get("id") or "").strip()
        if not region_id:
            continue
        feature_index[region_id] = feature
    _global_water_regions_feature_index = copy.deepcopy(feature_index)
    return feature_index


def fetch_marine_regions_feature_collection(source_layer: str, cql_filter: str) -> dict:
    cache_key = (str(source_layer).strip(), str(cql_filter).strip())
    cached = _marine_regions_feature_collection_cache.get(cache_key)
    if cached is not None:
        return copy.deepcopy(cached)
    response = requests.get(
        MARINE_REGIONS_WFS_URL,
        params={
            "service": "WFS",
            "version": "1.0.0",
            "request": "GetFeature",
            "typeName": f"MarineRegions:{cache_key[0]}",
            "outputFormat": "application/json",
            "cql_filter": cache_key[1],
            "maxFeatures": "2000",
        },
        timeout=MARINE_REGIONS_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as exc:
        excerpt = response.text[:240].replace("\n", " ").strip()
        raise ValueError(
            f"Marine Regions response was not JSON for {cache_key[0]} ({cache_key[1]}): {excerpt}"
        ) from exc
    if str(payload.get("type") or "").strip() != "FeatureCollection":
        raise ValueError(f"Marine Regions returned unexpected payload for {cache_key[0]} ({cache_key[1]}).")
    _marine_regions_feature_collection_cache[cache_key] = copy.deepcopy(payload)
    return payload


def subtract_geometry_list(source_geom, subtract_geometries: list) -> object:
    candidate = normalize_polygonal(source_geom)
    if candidate is None:
        return None
    if not subtract_geometries:
        return candidate
    subtract_union = safe_unary_union(subtract_geometries)
    if subtract_union is None:
        return candidate
    return normalize_polygonal(candidate.difference(subtract_union))


def buffer_polygonal(geom, buffer_distance: float) -> object:
    candidate = normalize_polygonal(geom)
    if candidate is None or buffer_distance <= 0:
        return candidate
    return normalize_polygonal(candidate.buffer(buffer_distance))


def prune_polygonal_components(geom, *, min_area: float = 0.0) -> object:
    candidate = normalize_polygonal(geom)
    if candidate is None:
        return None
    if min_area <= 0:
        return candidate
    parts = [part for part in iter_polygon_parts(candidate) if float(part.area) >= float(min_area)]
    if not parts:
        parts = [max(iter_polygon_parts(candidate), key=lambda part: float(part.area))]
    return normalize_polygonal(safe_unary_union(parts))


def _geometry_validity_message(geom) -> str:
    candidate = geom
    if candidate is None or getattr(candidate, "is_empty", True):
        return "empty geometry"
    try:
        return explain_validity(candidate)
    except Exception as exc:
        return f"validity check failed: {exc}"


def validate_tno_water_geometries(
    features: list[dict] | dict,
    *,
    stage_label: str,
    feature_ids: tuple[str, ...] | list[str] | None = None,
) -> None:
    target_ids = {
        str(feature_id).strip()
        for feature_id in (feature_ids or ())
        if str(feature_id).strip()
    }
    if isinstance(features, dict):
        iterable = features.get("features", []) or []
    else:
        iterable = features or []
    failures: list[str] = []
    for feature in iterable:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        feature_id = str(props.get("id") or "").strip()
        if target_ids and feature_id not in target_ids:
            continue
        geom = shape(feature.get("geometry")) if isinstance(feature, dict) and feature.get("geometry") else None
        if geom is None or geom.is_empty:
            failures.append(f"{feature_id or '<unknown>'}: empty geometry")
            continue
        if not geom.is_valid:
            failures.append(f"{feature_id or '<unknown>'}: {_geometry_validity_message(geom)}")
    if failures:
        raise ValueError(
            f"TNO water geometry validation failed at {stage_label}:\n- " + "\n- ".join(failures)
        )


def build_tno_open_ocean_split_features(
    land_mask_geom=None,
    *,
    supplement_subtract_geometries_by_source_id: dict[str, list] | None = None,
) -> list[dict]:
    feature_index = load_global_water_regions_feature_index()
    land_mask_geom = normalize_polygonal(land_mask_geom)
    supplement_subtract_geometries_by_source_id = supplement_subtract_geometries_by_source_id or {}
    split_features: list[dict] = []
    for split_spec in TNO_OPEN_OCEAN_SPLIT_SPECS:
        source_id = split_spec["source_id"]
        source_ids = tuple(
            str(region_id).strip()
            for region_id in (split_spec.get("source_ids") or (source_id,))
            if str(region_id).strip()
        )
        source_features = []
        for region_id in source_ids:
            source_feature = feature_index.get(region_id)
            if source_feature is None:
                raise ValueError(f"Unable to locate base water region '{region_id}' for TNO ocean split.")
            source_features.append(source_feature)
        source_props = dict(source_features[0].get("properties", {}))
        source_geom = normalize_polygonal(safe_unary_union([
            shape(feature.get("geometry"))
            for feature in source_features
            if feature.get("geometry")
        ]))
        if source_geom is None:
            raise ValueError(f"Base water region '{source_id}' has empty geometry.")
        supplement_subtract_geometries = [
            normalized_geom
            for normalized_geom in (
                normalize_polygonal(geom)
                for geom in supplement_subtract_geometries_by_source_id.get(source_id, [])
            )
            if normalized_geom is not None
        ]
        for child_spec in split_spec["children"]:
            child_boxes = child_spec.get("bboxes") or (child_spec.get("bbox"),)
            child_parts = []
            for child_bbox in child_boxes:
                if not child_bbox:
                    continue
                part_geom = normalize_polygonal(source_geom.intersection(box(*child_bbox)))
                if part_geom is not None:
                    child_parts.append(part_geom)
            for supplement_bbox in child_spec.get("supplement_bboxes", ()) or ():
                if not supplement_bbox:
                    continue
                supplement_geom = normalize_polygonal(box(*supplement_bbox))
                if supplement_geom is None:
                    continue
                if land_mask_geom is not None:
                    supplement_geom = normalize_polygonal(supplement_geom.difference(land_mask_geom))
                if supplement_geom is not None and supplement_subtract_geometries:
                    supplement_geom = subtract_geometry_list(supplement_geom, supplement_subtract_geometries)
                if supplement_geom is not None:
                    child_parts.append(supplement_geom)
            child_geom = normalize_polygonal(safe_unary_union(child_parts))
            if child_geom is not None and supplement_subtract_geometries:
                child_geom = subtract_geometry_list(child_geom, supplement_subtract_geometries)
            child_geom = prune_polygonal_components(
                child_geom,
                min_area=float(child_spec.get("component_min_area") or 0.0),
            )
            if child_geom is None:
                raise ValueError(
                    f"TNO ocean split '{child_spec['id']}' produced empty geometry from '{source_id}'."
                )
            child_name = child_spec["name"]
            child_props = dict(source_props)
            child_props.update({
                "id": child_spec["id"],
                "name": child_name,
                "label": child_name,
                "water_type": "ocean",
                "region_group": source_props.get("region_group") or "ocean_macro",
                "parent_id": source_id,
                "neighbors": "",
                "is_chokepoint": False,
                "interactive": False,
                "scenario_id": SCENARIO_ID,
                "source_standard": "tno_bbox_split_from_global_water_regions",
                "render_as_base_geography": False,
            })
            split_features.append(make_feature(child_geom, child_props))
    validate_tno_water_geometries(
        split_features,
        stage_label="scenario_water_seed",
    )
    return split_features


def clip_tno_open_ocean_split_features(
    split_features: list[dict],
    clip_geometries_by_id: dict[str, list],
    component_min_area_by_id: dict[str, float] | None = None,
) -> list[dict]:
    component_min_area_by_id = component_min_area_by_id or {}
    clipped_features: list[dict] = []
    for feature in split_features:
        props = dict(feature.get("properties", {}))
        feature_id = str(props.get("id") or "").strip()
        geom = normalize_polygonal(shape(feature.get("geometry")))
        if geom is None:
            raise ValueError(f"TNO ocean split feature '{feature_id}' has empty geometry.")
        buffered_clip_geometries = [
            buffered_geom
            for buffered_geom in (
                buffer_polygonal(clip_geom, TNO_WATER_SUBTRACT_BUFFER_DEGREES)
                for clip_geom in clip_geometries_by_id.get(feature_id, [])
            )
            if buffered_geom is not None
        ]
        clipped_geom = subtract_geometry_list(geom, buffered_clip_geometries)
        clipped_geom = prune_polygonal_components(
            clipped_geom,
            min_area=float(component_min_area_by_id.get(feature_id) or 0.0),
        )
        if clipped_geom is None:
            raise ValueError(f"TNO ocean split feature '{feature_id}' collapsed after coastal clipping.")
        clipped_features.append(make_feature(clipped_geom, props))
    validate_tno_water_geometries(
        clipped_features,
        stage_label="scenario_water_seed_clipped",
    )
    return clipped_features


def build_tno_named_marginal_water_features(snapshot_payload: dict) -> tuple[list[dict], dict[str, dict]]:
    feature_index = load_global_water_regions_feature_index()
    snapshot_features_by_id: dict[str, dict] = {}
    for feature in snapshot_payload.get("features", []):
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        feature_id = str(props.get("id") or "").strip()
        if feature_id:
            snapshot_features_by_id[feature_id] = feature

    prepared_geometries_by_id: dict[str, object] = {}
    diagnostics: dict[str, dict] = {}
    for spec in TNO_NAMED_MARGINAL_WATER_SPECS:
        global_source_id = str(spec.get("global_source_id") or "").strip()
        source_record_ids: list[str]
        source_layer = str(spec.get("source_layer") or "").strip()
        source_query = str(spec.get("source_query") or "").strip()
        if global_source_id:
            base_feature = feature_index.get(global_source_id)
            if base_feature is None:
                raise ValueError(f"Unable to locate cloned base water region '{global_source_id}' for {spec['id']}.")
            source_geom = normalize_polygonal(shape(base_feature.get("geometry")))
            source_record_ids = [global_source_id]
            source_layer = "global_water_regions"
            source_query = f"id='{global_source_id}'"
        else:
            snapshot_feature = snapshot_features_by_id.get(spec["id"])
            if snapshot_feature is None:
                raise ValueError(f"Named water snapshot is missing '{spec['id']}'.")
            snapshot_props = snapshot_feature.get("properties", {}) if isinstance(snapshot_feature, dict) else {}
            source_geom = normalize_polygonal(shape(snapshot_feature.get("geometry")))
            source_record_ids = list(snapshot_props.get("source_record_ids", []) or [])
        if source_geom is None:
            raise ValueError(f"Snapshot geometry collapsed for named water '{spec['id']}'.")
        subtract_base_ids = [
            str(region_id).strip()
            for region_id in spec.get("subtract_base_ids", ())
            if str(region_id).strip()
        ]
        subtract_base_geometries = []
        for region_id in subtract_base_ids:
            base_feature = feature_index.get(region_id)
            if base_feature is None:
                raise ValueError(f"Unable to locate base water region '{region_id}' for {spec['id']}.")
            base_geom = normalize_polygonal(shape(base_feature.get("geometry")))
            if base_geom is not None:
                subtract_base_geometries.append(base_geom)
        prepared_geom = subtract_geometry_list(source_geom, subtract_base_geometries)
        if prepared_geom is None:
            raise ValueError(f"Named water feature '{spec['id']}' collapsed after base water subtraction.")
        simplify_tolerance = float(spec.get("simplify_tolerance") or 0.0)
        if simplify_tolerance > 0:
            prepared_geom = smooth_polygonal(prepared_geom, simplify_tolerance=simplify_tolerance)
        prepared_geometries_by_id[spec["id"]] = prepared_geom
        diagnostics[spec["id"]] = {
            "name": spec["name"],
            "source_layer": source_layer,
            "source_query": source_query,
            "source_record_ids": source_record_ids,
            "source_standard": spec["source_standard"],
            "global_source_id": global_source_id,
            "subtract_base_ids": subtract_base_ids,
            "subtract_named_ids": [
                str(region_id).strip()
                for region_id in spec.get("subtract_named_ids", ())
                if str(region_id).strip()
            ],
            "clip_open_ocean_ids": list(spec.get("clip_open_ocean_ids", ()) or ()),
        }

    named_features: list[dict] = []
    for spec in TNO_NAMED_MARGINAL_WATER_SPECS:
        named_feature_id = spec["id"]
        final_geom = prepared_geometries_by_id.get(named_feature_id)
        if final_geom is None:
            raise ValueError(f"Prepared named water geometry missing for '{named_feature_id}'.")
        subtract_named_ids = diagnostics[named_feature_id]["subtract_named_ids"]
        subtract_named_geometries = []
        for region_id in subtract_named_ids:
            subtract_geom = prepared_geometries_by_id.get(region_id)
            if subtract_geom is None:
                raise ValueError(f"Named water '{named_feature_id}' references missing named subtraction '{region_id}'.")
            buffered_subtract_geom = buffer_polygonal(subtract_geom, TNO_WATER_SUBTRACT_BUFFER_DEGREES)
            if buffered_subtract_geom is not None:
                subtract_named_geometries.append(buffered_subtract_geom)
        final_geom = subtract_geometry_list(final_geom, subtract_named_geometries)
        if final_geom is None:
            raise ValueError(f"Named water feature '{named_feature_id}' collapsed after named water subtraction.")
        final_geom = safe_unary_union(iter_polygon_parts(final_geom))
        if final_geom is None:
            raise ValueError(f"Named water feature '{named_feature_id}' collapsed after final polygon normalization.")
        properties = {
            "id": named_feature_id,
            "name": spec["name"],
            "label": spec.get("label") or spec["name"],
            "water_type": spec["water_type"],
            "region_group": spec.get("region_group") or "marine_macro",
            "parent_id": str(spec.get("parent_id") or "").strip(),
            "neighbors": "",
            "is_chokepoint": bool(spec.get("is_chokepoint")),
            "interactive": True,
            "scenario_id": SCENARIO_ID,
            "source_standard": spec["source_standard"],
            "render_as_base_geography": False,
        }
        named_features.append(make_feature(final_geom, properties))
        diagnostics[named_feature_id]["geometry_area"] = round(float(final_geom.area), 6)
    return named_features, diagnostics


def sanitize_jsonable(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, dict):
        return {key: sanitize_jsonable(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [sanitize_jsonable(item) for item in value]
    return value


def write_json(path: Path, payload: dict) -> None:
    sanitized = sanitize_jsonable(payload)
    if path.name == "relief_overlays.geojson":
        sanitized = round_geojson_coordinates(sanitized, decimals=6)
    write_json_atomic(
        path,
        sanitized,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
        indent=None,
    )


def collect_gdf_feature_ids(gdf: gpd.GeoDataFrame) -> set[str]:
    if "id" not in gdf.columns:
        raise ValueError("GeoDataFrame is missing required 'id' column.")
    return {
        str(value).strip()
        for value in gdf["id"].tolist()
        if str(value).strip()
    }


def round_geojson_coordinates(payload: object, decimals: int = 6) -> object:
    if isinstance(payload, list):
        if payload and all(isinstance(value, (int, float)) for value in payload):
            rounded = []
            for value in payload:
                if isinstance(value, int):
                    rounded.append(value)
                else:
                    rounded.append(round(value, decimals))
            return rounded
        return [round_geojson_coordinates(item, decimals=decimals) for item in payload]
    if isinstance(payload, dict):
        next_payload = dict(payload)
        if "coordinates" in next_payload:
            next_payload["coordinates"] = round_geojson_coordinates(next_payload["coordinates"], decimals=decimals)
        if "geometries" in next_payload and isinstance(next_payload["geometries"], list):
            next_payload["geometries"] = [
                round_geojson_coordinates(item, decimals=decimals)
                for item in next_payload["geometries"]
            ]
        if "features" in next_payload and isinstance(next_payload["features"], list):
            next_payload["features"] = [
                round_geojson_coordinates(item, decimals=decimals)
                for item in next_payload["features"]
            ]
        if "geometry" in next_payload and next_payload["geometry"] is not None:
            next_payload["geometry"] = round_geojson_coordinates(next_payload["geometry"], decimals=decimals)
        return next_payload
    return payload


def marine_regions_named_water_snapshot_path(scenario_dir: Path) -> Path:
    return scenario_dir / MARINE_REGIONS_NAMED_WATER_SNAPSHOT_FILENAME


def tno_water_regions_provenance_path(scenario_dir: Path) -> Path:
    return scenario_dir / TNO_WATER_REGIONS_PROVENANCE_FILENAME


def rebuild_published_scenario_chunk_assets(scenario_dir: Path, checkpoint_dir: Path) -> None:
    manifest_path = scenario_dir / "manifest.json"
    manifest_payload = load_json(manifest_path)
    layer_payloads: dict[str, dict | None] = {}
    for layer_key, raw_url in {
        "water": manifest_payload.get("water_regions_url"),
        "special": manifest_payload.get("special_regions_url"),
        "relief": manifest_payload.get("relief_overlays_url"),
        "cities": manifest_payload.get("city_overrides_url"),
    }.items():
        url = str(raw_url or "").strip()
        if not url:
            continue
        payload_path = ROOT.joinpath(*Path(url).parts)
        if payload_path.exists():
            layer_payloads[layer_key] = load_json(payload_path)

    runtime_topology_payload = load_checkpoint_json(checkpoint_dir, "runtime_topology.topo.json")
    runtime_topology_url = str(
        manifest_payload.get("runtime_topology_url")
        or f"data/scenarios/{SCENARIO_ID}/runtime_topology.topo.json"
    ).strip()
    runtime_topology_path = ROOT.joinpath(*Path(runtime_topology_url).parts)
    runtime_topology_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(runtime_topology_path, runtime_topology_payload)

    runtime_bootstrap_topology_payload = build_bootstrap_runtime_topology(runtime_topology_payload)
    startup_topology_url = str(
        manifest_payload.get("runtime_bootstrap_topology_url")
        or f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME}"
    ).strip()
    startup_topology_path = ROOT.joinpath(*Path(startup_topology_url).parts)
    startup_topology_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(startup_topology_path, runtime_bootstrap_topology_payload)

    build_and_write_scenario_chunk_assets(
        scenario_dir=scenario_dir,
        manifest_payload=manifest_payload,
        layer_payloads=layer_payloads,
        startup_topology_payload=runtime_bootstrap_topology_payload,
        runtime_topology_payload=runtime_topology_payload,
        startup_topology_url=startup_topology_url,
        runtime_topology_url=runtime_topology_url,
        generated_at=str(manifest_payload.get("generated_at") or "").strip(),
        default_startup_topology_url=DEFAULT_STARTUP_TOPOLOGY_URL,
    )
    write_json_atomic(manifest_path, manifest_payload, ensure_ascii=False, indent=2, trailing_newline=True)


def collect_marine_regions_source_record_ids(source_layer: str, features: list[dict]) -> list[str]:
    id_fields = MARINE_REGIONS_SOURCE_RECORD_ID_FIELDS_BY_LAYER.get(str(source_layer).strip(), ())
    record_ids: list[str] = []
    seen: set[str] = set()
    for feature in features:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        if not isinstance(props, dict):
            continue
        for field in id_fields:
            value = props.get(field)
            if value in (None, ""):
                continue
            token = f"{field}:{value}"
            if token in seen:
                continue
            seen.add(token)
            record_ids.append(token)
    return sorted(record_ids)


def build_marine_regions_named_water_snapshot_payload() -> tuple[dict, dict]:
    snapshot_generated_at = utc_timestamp()
    snapshot_features: list[dict] = []
    water_extracts: list[dict[str, object]] = []
    local_clone_extracts: list[dict[str, object]] = []
    source_layers_used: set[str] = set()
    total_source_feature_count = 0
    feature_index = load_global_water_regions_feature_index()
    for spec in TNO_NAMED_MARGINAL_WATER_SPECS:
        global_source_id = str(spec.get("global_source_id") or "").strip()
        if global_source_id:
            base_feature = feature_index.get(global_source_id)
            if base_feature is None:
                raise ValueError(f"Unable to locate cloned base water region '{global_source_id}' for {spec['id']}.")
            base_props = base_feature.get("properties", {}) if isinstance(base_feature, dict) else {}
            local_clone_extracts.append({
                "id": spec["id"],
                "name": spec["name"],
                "label": spec.get("label") or spec["name"],
                "source_water_region_id": global_source_id,
                "source_water_region_name": str(base_props.get("name") or "").strip(),
                "source_standard": spec["source_standard"],
                "source_feature_count": 1,
            })
            continue
        payload = fetch_marine_regions_feature_collection(spec["source_layer"], spec["source_query"])
        source_features = payload.get("features", [])
        source_gdf = geopandas_from_features(source_features)
        if source_gdf.empty:
            raise ValueError(f"No Marine Regions features returned for {spec['id']} ({spec['source_query']}).")
        source_geom = normalize_polygonal(safe_unary_union(source_gdf.geometry.tolist()))
        if source_geom is None:
            raise ValueError(f"Marine Regions geometry collapsed for {spec['id']}.")
        source_record_ids = collect_marine_regions_source_record_ids(spec["source_layer"], source_features)
        snapshot_features.append(make_feature(source_geom, {
            "id": spec["id"],
            "name": spec["name"],
            "label": spec.get("label") or spec["name"],
            "source_layer": spec["source_layer"],
            "source_query": spec["source_query"],
            "source_record_ids": source_record_ids,
            "source_standard": spec["source_standard"],
            "snapshot_generated_at": snapshot_generated_at,
        }))
        water_extracts.append({
            "id": spec["id"],
            "name": spec["name"],
            "label": spec.get("label") or spec["name"],
            "source_layer": spec["source_layer"],
            "source_query": spec["source_query"],
            "source_record_ids": source_record_ids,
            "source_standard": spec["source_standard"],
            "source_feature_count": int(len(source_gdf)),
        })
        source_layers_used.add(str(spec["source_layer"]).strip())
        total_source_feature_count += int(len(source_gdf))

    snapshot_payload = feature_collection_from_features(snapshot_features)
    source_datasets = []
    for source_layer in sorted(source_layers_used):
        meta = dict(MARINE_REGIONS_DATASET_META.get(source_layer, {}))
        if not meta:
            continue
        meta["source_layer"] = source_layer
        source_datasets.append(meta)
    provenance_payload = {
        "generated_at": snapshot_generated_at,
        "asset_path": "data/scenarios/tno_1962/water_regions.geojson",
        "scenario_id": SCENARIO_ID,
        "builder": "tools/patch_tno_1962_bundle.py",
        "snapshot_path": f"data/scenarios/{SCENARIO_ID}/{MARINE_REGIONS_NAMED_WATER_SNAPSHOT_FILENAME}",
        "source_datasets": source_datasets,
        "water_extracts": water_extracts,
        "local_clone_extracts": local_clone_extracts,
        "diagnostics": {
            "snapshot_feature_count": len(snapshot_features),
            "local_clone_feature_count": len(local_clone_extracts),
            "source_feature_count": total_source_feature_count,
            "source_layers": sorted(source_layers_used),
        },
    }
    return snapshot_payload, provenance_payload


def load_or_refresh_marine_regions_named_water_snapshot(
    scenario_dir: Path,
    refresh_named_water_snapshot: bool = False,
) -> tuple[dict, dict]:
    snapshot_path = marine_regions_named_water_snapshot_path(scenario_dir)
    provenance_path = tno_water_regions_provenance_path(scenario_dir)
    if refresh_named_water_snapshot:
        snapshot_payload, provenance_payload = build_marine_regions_named_water_snapshot_payload()
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        provenance_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(snapshot_path, snapshot_payload)
        write_json(provenance_path, provenance_payload)
        return snapshot_payload, provenance_payload
    if not snapshot_path.exists():
        raise FileNotFoundError(
            f"Missing named water snapshot: {snapshot_path}. Run with --refresh-named-water-snapshot to create it."
        )
    if not provenance_path.exists():
        raise FileNotFoundError(
            f"Missing water-region provenance file: {provenance_path}. Run with --refresh-named-water-snapshot to create it."
        )
    return load_json(snapshot_path), load_json(provenance_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Patch the checked-in tno_1962 scenario bundle.")
    parser.add_argument("--stage", choices=STAGE_CHOICES, default=STAGE_ALL)
    parser.add_argument("--checkpoint-dir", default=str(DEFAULT_CHECKPOINT_DIR))
    parser.add_argument("--scenario-dir", default=str(SCENARIO_DIR))
    parser.add_argument(
        "--tno-root",
        default=None,
        help=(
            "Explicit TNO workshop root. "
            f"Can also be provided via ${TNO_ROOT_ENV_VAR}."
        ),
    )
    parser.add_argument(
        "--hgo-root",
        default=None,
        help=(
            "Explicit HGO donor root. "
            f"Can also be provided via ${HGO_ROOT_ENV_VAR}."
        ),
    )
    parser.add_argument("--publish-scope", choices=PUBLISH_SCOPE_CHOICES, default=PUBLISH_SCOPE_POLAR_RUNTIME)
    parser.add_argument(
        "--manual-sync-policy",
        choices=MANUAL_SYNC_POLICY_CHOICES,
        default=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    )
    parser.add_argument(
        "--refresh-named-water-snapshot",
        action="store_true",
        help="Refresh the repo-tracked Marine Regions named-water snapshot before building.",
    )
    return parser.parse_args()


def checkpoint_path(checkpoint_dir: Path, filename: str) -> Path:
    return scenario_bundle_platform.checkpoint_path(checkpoint_dir, filename)


def write_checkpoint_json(checkpoint_dir: Path, filename: str, payload: dict) -> None:
    scenario_bundle_platform.write_checkpoint_json(
        checkpoint_dir,
        filename,
        payload,
        write_json=write_json,
    )


def write_checkpoint_gdf(checkpoint_dir: Path, filename: str, gdf: gpd.GeoDataFrame) -> None:
    scenario_bundle_platform.write_checkpoint_gdf(
        checkpoint_dir,
        filename,
        gdf,
        write_json=write_json,
        gdf_to_feature_collection=gdf_to_feature_collection,
    )


def load_checkpoint_json(checkpoint_dir: Path, filename: str) -> dict:
    return scenario_bundle_platform.load_checkpoint_json(
        checkpoint_dir,
        filename,
        load_json=load_json,
    )


def gdf_to_feature_collection(gdf: gpd.GeoDataFrame) -> dict:
    if gdf is None or gdf.empty:
        return feature_collection_from_features([])
    return json.loads(gdf.to_json())

def load_checkpoint_gdf(checkpoint_dir: Path, filename: str) -> gpd.GeoDataFrame:
    return scenario_bundle_platform.load_checkpoint_gdf(
        checkpoint_dir,
        filename,
        load_json=load_json,
        geopandas_from_features=geopandas_from_features,
    )


CHECKPOINT_STAGE_METADATA_FILENAME = CONTRACT_CHECKPOINT_STAGE_METADATA_FILENAME
CHECKPOINT_SCENARIO_POLITICAL_FILENAME = CONTRACT_CHECKPOINT_POLITICAL_FILENAME
CHECKPOINT_SCENARIO_WATER_SEED_FILENAME = CONTRACT_CHECKPOINT_WATER_SEED_FILENAME
CHECKPOINT_WATER_FILENAME = CONTRACT_CHECKPOINT_WATER_FILENAME
CHECKPOINT_RELIEF_FILENAME = CONTRACT_CHECKPOINT_RELIEF_FILENAME
CHECKPOINT_BATHYMETRY_FILENAME = CONTRACT_CHECKPOINT_BATHYMETRY_FILENAME
CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME = CONTRACT_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME
CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME = CONTRACT_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME
CHECKPOINT_GEO_LOCALE_FILENAME = CONTRACT_CHECKPOINT_GEO_LOCALE_FILENAME
CHECKPOINT_GEO_LOCALE_EN_FILENAME = CONTRACT_CHECKPOINT_GEO_LOCALE_EN_FILENAME
CHECKPOINT_GEO_LOCALE_ZH_FILENAME = CONTRACT_CHECKPOINT_GEO_LOCALE_ZH_FILENAME
CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME = CONTRACT_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME
CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME = CONTRACT_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME
CHECKPOINT_LAND_MASK_FILENAME = CONTRACT_CHECKPOINT_LAND_MASK_FILENAME
CHECKPOINT_CONTEXT_LAND_MASK_FILENAME = CONTRACT_CHECKPOINT_CONTEXT_LAND_MASK_FILENAME
CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME = CONTRACT_CHECKPOINT_NAMED_WATER_SNAPSHOT_FILENAME
CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME = CONTRACT_CHECKPOINT_WATER_REGIONS_PROVENANCE_FILENAME
PUBLISH_FILENAMES_BY_SCOPE = CONTRACT_PUBLISH_FILENAMES_BY_SCOPE


def normalize_locale_override_entry(source: object) -> dict[str, str] | None:
    if not isinstance(source, dict):
        return None
    en = str(source.get("en") or source.get("name_en") or source.get("label_en") or "").strip()
    zh = str(source.get("zh") or source.get("name_zh") or source.get("label_zh") or source.get("name_cn") or "").strip()
    entry: dict[str, str] = {}
    if en:
        entry["en"] = en
    if zh:
        entry["zh"] = zh
    return entry or None


def round_geojson_coordinates(payload: object, decimals: int = 6) -> object:
    if isinstance(payload, list):
        if payload and all(isinstance(value, (int, float)) for value in payload):
            rounded: list[object] = []
            for value in payload:
                if isinstance(value, float):
                    rounded.append(round(value, decimals))
                else:
                    rounded.append(value)
            return rounded
        return [round_geojson_coordinates(item, decimals=decimals) for item in payload]
    if isinstance(payload, dict):
        rounded = {}
        for key, value in payload.items():
            if key in {"coordinates", "geometries", "features", "geometry"}:
                rounded[key] = round_geojson_coordinates(value, decimals=decimals)
            else:
                rounded[key] = value
        return rounded
    return payload


def build_locale_specific_geo_locale_payload(payload: dict, language: str) -> dict:
    normalized_language = "zh" if str(language or "").strip().lower() == "zh" else "en"
    language_geo: dict[str, dict[str, str]] = {}
    raw_geo = payload.get("geo", {}) if isinstance(payload, dict) else {}
    for feature_id, raw_entry in raw_geo.items():
        entry = normalize_locale_override_entry(raw_entry)
        if not entry:
            continue
        value = str(entry.get(normalized_language) or "").strip()
        if not value:
            continue
        language_geo[str(feature_id)] = {normalized_language: value}
    locale_payload = {
        key: value
        for key, value in payload.items()
        if key != "audit"
    }
    locale_payload["geo"] = language_geo
    return locale_payload


def ensure_geo_locale_variant_checkpoints(checkpoint_dir: Path) -> None:
    base_payload = load_checkpoint_json(checkpoint_dir, CHECKPOINT_GEO_LOCALE_FILENAME)
    write_checkpoint_json(
        checkpoint_dir,
        CHECKPOINT_GEO_LOCALE_EN_FILENAME,
        build_locale_specific_geo_locale_payload(base_payload, "en"),
    )
    write_checkpoint_json(
        checkpoint_dir,
        CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
        build_locale_specific_geo_locale_payload(base_payload, "zh"),
    )


def resolve_publish_filenames(scope: str) -> tuple[str, ...]:
    return resolve_scenario_publish_filenames(scope)


def validate_geo_locale_manual_overrides(geo_locale_payload: dict, manual_overrides_payload: dict) -> None:
    geo = geo_locale_payload.get("geo", {}) if isinstance(geo_locale_payload, dict) else {}
    manual_geo_raw = manual_overrides_payload.get("geo", {}) if isinstance(manual_overrides_payload, dict) else {}
    missing_feature_ids: list[str] = []
    mismatched_feature_ids: list[str] = []
    for raw_feature_id, raw_entry in manual_geo_raw.items():
        feature_id = str(raw_feature_id or "").strip()
        expected_entry = normalize_locale_override_entry(raw_entry)
        if not feature_id or not expected_entry:
            continue
        actual_entry = normalize_locale_override_entry(geo.get(feature_id))
        if actual_entry is None:
            missing_feature_ids.append(feature_id)
            continue
        if actual_entry != expected_entry:
            mismatched_feature_ids.append(feature_id)
    if missing_feature_ids or mismatched_feature_ids:
        details: list[str] = []
        if missing_feature_ids:
            details.append(f"missing={missing_feature_ids[:20]}")
        if mismatched_feature_ids:
            details.append(f"mismatched={mismatched_feature_ids[:20]}")
        raise ValueError("Geo locale checkpoint does not reflect manual overrides: " + "; ".join(details))


def validate_geo_locale_checkpoint(checkpoint_dir: Path, manual_overrides_path: Path) -> None:
    geo_locale_payload = load_checkpoint_json(checkpoint_dir, CHECKPOINT_GEO_LOCALE_FILENAME)
    manual_overrides_payload = load_json(manual_overrides_path) if manual_overrides_path.exists() else {}
    validate_geo_locale_manual_overrides(geo_locale_payload, manual_overrides_payload)
    ensure_geo_locale_variant_checkpoints(checkpoint_dir)


def default_scenario_manual_overrides_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "countries": {},
        "assignments": {},
    }


def load_scenario_manual_overrides_payload(scenario_dir: Path) -> dict[str, object]:
    manual_path = scenario_dir / MANUAL_OVERRIDE_FILENAME
    payload = load_json(manual_path) if manual_path.exists() else default_scenario_manual_overrides_payload(SCENARIO_ID)
    if not isinstance(payload, dict):
        payload = {}
    countries = payload.get("countries", {})
    assignments = payload.get("assignments", {})
    normalized = dict(payload)
    normalized["version"] = int(normalized.get("version") or 1)
    normalized["scenario_id"] = SCENARIO_ID
    normalized["generated_at"] = str(normalized.get("generated_at") or "").strip()
    normalized["countries"] = dict(countries) if isinstance(countries, dict) else {}
    normalized["assignments"] = dict(assignments) if isinstance(assignments, dict) else {}
    return normalized


def apply_dev_manual_overrides(
    countries_payload: dict,
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
    manual_overrides_payload: dict,
    audit_payload: dict,
) -> dict[str, object]:
    countries = countries_payload.setdefault("countries", {})
    owners = owners_payload.setdefault("owners", {})
    controllers = controllers_payload.setdefault("controllers", {})
    cores = normalize_feature_core_map(cores_payload.setdefault("cores", {}))
    cores_payload["cores"] = cores
    manual_countries = manual_overrides_payload.get("countries", {}) if isinstance(manual_overrides_payload, dict) else {}
    manual_assignments = manual_overrides_payload.get("assignments", {}) if isinstance(manual_overrides_payload, dict) else {}
    touched_country_tags: list[str] = []
    touched_assignment_feature_ids: list[str] = []
    create_tags: list[str] = []
    override_tags: list[str] = []

    for raw_tag, raw_entry in manual_countries.items():
        tag = normalize_tag(raw_tag)
        if not tag or not isinstance(raw_entry, dict):
            continue
        mode = str(raw_entry.get("mode") or "override").strip().lower() or "override"
        existing_entry = countries.get(tag)
        if mode == "create":
            if isinstance(existing_entry, dict):
                existing_primary_rule = str(existing_entry.get("primary_rule_source") or "").strip()
                existing_rule_sources = existing_entry.get("rule_sources")
                existing_is_dev_manual_create = (
                    existing_primary_rule == "dev_manual_tag_create"
                    or (
                        isinstance(existing_rule_sources, list)
                        and "dev_manual_tag_create" in existing_rule_sources
                    )
                )
                if existing_is_dev_manual_create:
                    mode = "override"
                else:
                    raise ValueError(f"Dev manual override cannot create existing tag: {tag}")
        if mode == "create":
            countries[tag] = {
                "tag": tag,
                "display_name": str(raw_entry.get("display_name") or raw_entry.get("display_name_en") or tag).strip(),
                "display_name_en": str(raw_entry.get("display_name_en") or raw_entry.get("display_name") or tag).strip(),
                "display_name_zh": str(raw_entry.get("display_name_zh") or "").strip(),
                "color_hex": normalize_hex(raw_entry.get("color_hex")) or "#808080",
                "feature_count": 0,
                "controller_feature_count": 0,
                "quality": "manual_reviewed",
                "source": "manual_rule",
                "base_iso2": normalize_iso2(raw_entry.get("base_iso2")) or tag,
                "lookup_iso2": normalize_iso2(raw_entry.get("lookup_iso2")) or tag,
                "provenance_iso2": normalize_iso2(raw_entry.get("provenance_iso2")) or tag,
                "scenario_only": bool(raw_entry.get("scenario_only", True)),
                "featured": bool(raw_entry.get("featured")),
                "capital_state_id": raw_entry.get("capital_state_id"),
                "notes": str(raw_entry.get("notes") or "").strip(),
                "synthetic_owner": False,
                "source_type": "scenario_extension",
                "historical_fidelity": "extended",
                "primary_rule_source": "dev_manual_tag_create",
                "rule_sources": ["dev_manual_tag_create"],
                "source_types": ["scenario_extension"],
                "historical_fidelity_summary": ["extended"],
                "parent_owner_tag": normalize_tag(raw_entry.get("parent_owner_tag")),
                "parent_owner_tags": [normalize_tag(raw_entry.get("parent_owner_tag"))] if normalize_tag(raw_entry.get("parent_owner_tag")) else [],
                "subject_kind": str(raw_entry.get("subject_kind") or "").strip(),
                "entry_kind": str(raw_entry.get("entry_kind") or ("scenario_subject" if normalize_tag(raw_entry.get("parent_owner_tag")) else "scenario_country")).strip(),
                "hidden_from_country_list": bool(raw_entry.get("hidden_from_country_list")),
                "continent_id": str(raw_entry.get("continent_id") or "").strip(),
                "continent_label": str(raw_entry.get("continent_label") or "").strip(),
                "subregion_id": str(raw_entry.get("subregion_id") or "").strip(),
                "subregion_label": str(raw_entry.get("subregion_label") or "").strip(),
            }
            create_tags.append(tag)
        elif not isinstance(existing_entry, dict):
            raise ValueError(f"Dev manual override cannot update missing tag: {tag}")
        entry = countries[tag]
        for field in (
            "display_name",
            "display_name_en",
            "display_name_zh",
            "parent_owner_tag",
            "subject_kind",
            "entry_kind",
            "capital_state_id",
            "continent_id",
            "continent_label",
            "subregion_id",
            "subregion_label",
            "notes",
        ):
            if field in raw_entry:
                entry[field] = raw_entry.get(field)
        if "color_hex" in raw_entry:
            normalized_hex = normalize_hex(raw_entry.get("color_hex"))
            if normalized_hex:
                entry["color_hex"] = normalized_hex
        if "featured" in raw_entry:
            entry["featured"] = bool(raw_entry.get("featured"))
        if "hidden_from_country_list" in raw_entry:
            entry["hidden_from_country_list"] = bool(raw_entry.get("hidden_from_country_list"))
        if "scenario_only" in raw_entry:
            entry["scenario_only"] = bool(raw_entry.get("scenario_only"))
        for field in ("base_iso2", "lookup_iso2", "provenance_iso2"):
            if field in raw_entry:
                normalized_iso2 = normalize_iso2(raw_entry.get(field))
                if normalized_iso2:
                    entry[field] = normalized_iso2
        entry["source_type"] = "scenario_extension"
        entry["historical_fidelity"] = "extended"
        entry["source_types"] = ["scenario_extension"]
        entry["historical_fidelity_summary"] = ["extended"]
        if mode == "create":
            entry["primary_rule_source"] = "dev_manual_tag_create"
            entry["rule_sources"] = ["dev_manual_tag_create"]
        else:
            override_tags.append(tag)
        normalized_parent = normalize_tag(entry.get("parent_owner_tag"))
        entry["parent_owner_tag"] = normalized_parent
        entry["parent_owner_tags"] = [normalized_parent] if normalized_parent else []
        touched_country_tags.append(tag)

    for raw_feature_id, raw_assignment in manual_assignments.items():
        feature_id = str(raw_feature_id or "").strip()
        if not feature_id or not isinstance(raw_assignment, dict):
            continue
        if "owner" in raw_assignment:
            owner_tag = normalize_tag(raw_assignment.get("owner"))
            if owner_tag:
                owners[feature_id] = owner_tag
        if "controller" in raw_assignment:
            controller_tag = normalize_tag(raw_assignment.get("controller"))
            if controller_tag:
                controllers[feature_id] = controller_tag
        if "cores" in raw_assignment:
            normalized_core_tags = normalize_core_tags(raw_assignment.get("cores"))
            if normalized_core_tags:
                cores[feature_id] = normalized_core_tags
            else:
                cores.pop(feature_id, None)
        touched_assignment_feature_ids.append(feature_id)

    audit_payload["dev_manual_override_summary"] = {
        "country_count": len(touched_country_tags),
        "assignment_count": len(touched_assignment_feature_ids),
        "create_tags": sorted(set(create_tags)),
        "override_tags": sorted(set(override_tags)),
    }
    return {
        "country_tags": sorted(set(touched_country_tags)),
        "assignment_feature_ids": sorted(set(touched_assignment_feature_ids)),
        "create_tags": sorted(set(create_tags)),
        "override_tags": sorted(set(override_tags)),
    }


def load_feature_migration_map() -> dict[str, list[str]]:
    if not FEATURE_MIGRATION_PATH.exists():
        return {}
    payload = load_json(FEATURE_MIGRATION_PATH)
    if not isinstance(payload, dict):
        return {}
    migration_map: dict[str, list[str]] = {}
    for raw_feature_id, raw_successors in payload.items():
        feature_id = str(raw_feature_id or "").strip()
        if not feature_id or not isinstance(raw_successors, list):
            continue
        successors = [
            str(successor_id or "").strip()
            for successor_id in raw_successors
            if str(successor_id or "").strip()
        ]
        if successors:
            migration_map[feature_id] = successors
    return migration_map


def expand_feature_code_map(
    feature_map: dict[str, object],
    *,
    valid_feature_ids: set[str],
    migration_map: dict[str, list[str]],
) -> dict[str, str]:
    expanded: dict[str, str] = {}
    source = feature_map if isinstance(feature_map, dict) else {}
    for raw_feature_id, raw_value in source.items():
        feature_id = str(raw_feature_id or "").strip()
        value = str(raw_value or "").strip()
        if not feature_id or not value:
            continue
        if feature_id in valid_feature_ids:
            expanded[feature_id] = value
            continue
        successor_ids = migration_map.get(feature_id) or []
        for successor_id in successor_ids:
            if successor_id in valid_feature_ids and successor_id not in expanded:
                expanded[successor_id] = value
    return expanded


def stable_json_hash(payload: object) -> str:
    data = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def normalize_tag(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalnum())


def normalize_core_tags(raw_value: object) -> list[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, str):
        text = raw_value.strip()
        if not text:
            return []
        if text[:1] in "[({" and text[-1:] in "])}":
            try:
                parsed = ast.literal_eval(text)
            except (SyntaxError, ValueError):
                parsed = None
            if parsed is not None and parsed is not raw_value:
                return normalize_core_tags(parsed)
        normalized = normalize_tag(text)
        return [normalized] if normalized else []
    if isinstance(raw_value, (list, tuple, set)):
        tags: list[str] = []
        seen: set[str] = set()
        for item in raw_value:
            for tag in normalize_core_tags(item):
                if tag in seen:
                    continue
                seen.add(tag)
                tags.append(tag)
        return tags
    normalized = normalize_tag(raw_value)
    return [normalized] if normalized else []


def normalize_feature_core_map(feature_map: dict[str, object]) -> dict[str, list[str]]:
    normalized: dict[str, list[str]] = {}
    source = feature_map if isinstance(feature_map, dict) else {}
    for raw_feature_id, raw_value in source.items():
        feature_id = str(raw_feature_id or "").strip()
        tags = normalize_core_tags(raw_value)
        if not feature_id or not tags:
            continue
        normalized[feature_id] = tags
    return normalized


def expand_feature_core_map(
    feature_map: dict[str, object],
    *,
    valid_feature_ids: set[str],
    migration_map: dict[str, list[str]],
) -> dict[str, list[str]]:
    expanded: dict[str, list[str]] = {}
    for feature_id, tags in normalize_feature_core_map(feature_map).items():
        if feature_id in valid_feature_ids:
            expanded[feature_id] = list(tags)
            continue
        successor_ids = migration_map.get(feature_id) or []
        for successor_id in successor_ids:
            if successor_id in valid_feature_ids and successor_id not in expanded:
                expanded[successor_id] = list(tags)
    return expanded


def primary_core_tag(raw_value: object, *, fallback: object = "") -> str:
    tags = normalize_core_tags(raw_value)
    if tags:
        return tags[0]
    return normalize_tag(fallback)


def canonicalize_feature_core_map(feature_map: dict[str, object]) -> dict[str, list[str]]:
    canonical: dict[str, list[str]] = {}
    for raw_feature_id, raw_value in feature_map.items():
        feature_id = str(raw_feature_id).strip()
        tags = normalize_core_tags(raw_value)
        if not feature_id or not tags:
            continue
        canonical[feature_id] = list(tags)
        source_feature_id = SCENARIO_SPLIT_SUFFIX_RE.sub("", feature_id)
        existing = canonical.get(source_feature_id)
        if existing and existing != tags:
            raise ValueError(
                f"Conflicting canonical core mapping for {source_feature_id}: {existing} vs {tags}"
            )
        canonical[source_feature_id] = list(tags)
    return canonical


def set_feature_core_tags(core_map: dict[str, object], feature_id: str, raw_value: object) -> None:
    normalized_feature_id = str(feature_id or "").strip()
    tags = normalize_core_tags(raw_value)
    if not normalized_feature_id or not tags:
        return
    core_map[normalized_feature_id] = tags


def normalize_iso2(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalpha())


def normalize_hex(raw: object) -> str:
    value = str(raw or "").strip().lower()
    if len(value) == 7 and value.startswith("#") and all(char in "0123456789abcdef" for char in value[1:]):
        return value
    return ""


def fallback_color(tag: str) -> str:
    seed = sum(ord(char) * (index + 1) for index, char in enumerate(tag))
    r = 72 + (seed % 104)
    g = 72 + ((seed // 7) % 104)
    b = 72 + ((seed // 13) % 104)
    return f"#{r:02x}{g:02x}{b:02x}"


def resolve_tno_root() -> Path:
    if _CLI_TNO_ROOT_OVERRIDE is not None:
        candidate = _CLI_TNO_ROOT_OVERRIDE
        if (
            candidate.exists()
            and (candidate / "map/provinces.bmp").exists()
            and (candidate / "map/definition.csv").exists()
            and (candidate / "history/states/163-Dalmatia.txt").exists()
        ):
            return candidate
        raise FileNotFoundError(f"Invalid --tno-root path: {candidate}")
    env_override = Path(os.environ[TNO_ROOT_ENV_VAR]).expanduser() if os.environ.get(TNO_ROOT_ENV_VAR) else None
    if env_override is not None:
        if (
            env_override.exists()
            and (env_override / "map/provinces.bmp").exists()
            and (env_override / "map/definition.csv").exists()
            and (env_override / "history/states/163-Dalmatia.txt").exists()
        ):
            return env_override
        raise FileNotFoundError(
            f"Invalid ${TNO_ROOT_ENV_VAR} path: {env_override}"
        )
    for candidate in TNO_ROOT_CANDIDATES:
        if (
            candidate.exists()
            and (candidate / "map/provinces.bmp").exists()
            and (candidate / "map/definition.csv").exists()
            and (candidate / "history/states/163-Dalmatia.txt").exists()
        ):
            return candidate
    raise FileNotFoundError(
        "Unable to locate a TNO workshop install. Checked: "
        + ", ".join(str(candidate) for candidate in TNO_ROOT_CANDIDATES)
    )


def resolve_hgo_root() -> Path:
    if _CLI_HGO_ROOT_OVERRIDE is not None:
        candidate = _CLI_HGO_ROOT_OVERRIDE
        if (
            candidate.exists()
            and (candidate / "map/provinces.bmp").exists()
            and (candidate / "map/definition.csv").exists()
            and (candidate / "history/states").exists()
        ):
            return candidate
        raise FileNotFoundError(f"Invalid --hgo-root path: {candidate}")
    env_override = Path(os.environ[HGO_ROOT_ENV_VAR]).expanduser() if os.environ.get(HGO_ROOT_ENV_VAR) else None
    if env_override is not None:
        if (
            env_override.exists()
            and (env_override / "map/provinces.bmp").exists()
            and (env_override / "map/definition.csv").exists()
            and (env_override / "history/states").exists()
        ):
            return env_override
        raise FileNotFoundError(
            f"Invalid ${HGO_ROOT_ENV_VAR} path: {env_override}"
        )
    if (
        HGO_ROOT.exists()
        and (HGO_ROOT / "map/provinces.bmp").exists()
        and (HGO_ROOT / "map/definition.csv").exists()
        and (HGO_ROOT / "history/states").exists()
    ):
        return HGO_ROOT
    raise FileNotFoundError(f"Unable to locate donor HGO mod at {HGO_ROOT}")


def load_hierarchy_groups() -> dict[str, list[str]]:
    payload = load_json(HIERARCHY_PATH)
    groups = payload.get("groups", {}) if isinstance(payload, dict) else {}
    return {
        str(group_id).strip(): [str(feature_id).strip() for feature_id in feature_ids if str(feature_id).strip()]
        for group_id, feature_ids in groups.items()
        if str(group_id).strip()
    }


def load_palette_entries(path: Path) -> dict[str, dict]:
    payload = load_json(path)
    entries = payload.get("entries", {}) if isinstance(payload, dict) else {}
    return {
        str(tag).strip().upper(): value
        for tag, value in entries.items()
        if str(tag).strip()
    }


def load_tno_ocean_fill_color() -> str:
    payload = load_json(TNO_PALETTE_PATH)
    ocean = payload.get("ocean", {}) if isinstance(payload, dict) else {}
    return normalize_hex(ocean.get("fill_color")) or "#2d4769"


def resolve_tno_palette_color(tag: str, palette_entries: dict[str, dict]) -> str:
    normalized_tag = normalize_tag(tag)
    if not normalized_tag:
        return ""
    fixed_color = normalize_hex(TNO_1962_TNO_COLOR_FIXED_HEX.get(normalized_tag))
    if fixed_color:
        return fixed_color
    direct_entry = palette_entries.get(normalized_tag, {})
    direct_color = normalize_hex(direct_entry.get("map_hex"))
    if direct_color:
        return direct_color
    proxy_tag = normalize_tag(TNO_1962_TNO_COLOR_PROXY_TAGS.get(normalized_tag))
    if not proxy_tag:
        return ""
    proxy_entry = palette_entries.get(proxy_tag, {})
    return normalize_hex(proxy_entry.get("map_hex")) or ""


def patch_tno_palette_defaults(countries_payload: dict, manifest_payload: dict) -> None:
    countries = countries_payload.setdefault("countries", {})
    tno_palette_entries = load_palette_entries(TNO_PALETTE_PATH)

    target_tags = (
        set(TNO_1962_DIRECT_TNO_COLOR_TAGS)
        | set(TNO_1962_TNO_COLOR_PROXY_TAGS.keys())
        | set(TNO_1962_TNO_COLOR_FIXED_HEX.keys())
    )
    for tag, country_entry in countries.items():
        normalized_tag = normalize_tag(tag)
        continent_id = str(country_entry.get("continent_id") or "").strip()
        should_patch = normalized_tag in target_tags or continent_id in TNO_1962_AMERICA_CONTINENT_IDS
        if not should_patch:
            continue
        color_hex = resolve_tno_palette_color(normalized_tag, tno_palette_entries)
        if not color_hex:
            continue
        country_entry["color_hex"] = color_hex

    manifest_payload["palette_id"] = "tno"
    style_defaults = manifest_payload.get("style_defaults")
    if not isinstance(style_defaults, dict):
        style_defaults = {}
    ocean_defaults = style_defaults.get("ocean")
    if not isinstance(ocean_defaults, dict):
        ocean_defaults = {}
    ocean_defaults["fillColor"] = load_tno_ocean_fill_color()
    style_defaults["ocean"] = ocean_defaults
    manifest_payload["style_defaults"] = style_defaults


def normalize_tno_country_registry(countries_payload: dict, owners_payload: dict) -> None:
    countries = countries_payload.setdefault("countries", {})
    owner_counts = Counter(
        normalize_tag(tag)
        for tag in owners_payload.get("owners", {}).values()
        if str(tag).strip()
    )

    for tag in sorted(TNO_RETIRED_ZERO_FEATURE_TAGS):
        if int(owner_counts.get(tag, 0)) == 0:
            countries.pop(tag, None)

    for country_entry in countries.values():
        if not isinstance(country_entry, dict):
            continue
        if str(country_entry.get("source_type") or "").strip() != "hoi4_owner":
            continue
        country_entry["source_type"] = "tno_baseline"
        country_entry["historical_fidelity"] = "tno_baseline"
        country_entry["source_types"] = ["tno_baseline"]
        country_entry["historical_fidelity_summary"] = ["tno_baseline"]


def ensure_tno_controller_only_countries(countries_payload: dict, controllers_payload: dict) -> None:
    countries = countries_payload.setdefault("countries", {})
    controller_counts = Counter(
        normalize_tag(tag)
        for tag in controllers_payload.get("controllers", {}).values()
        if str(tag).strip()
    )
    palette_entries = load_palette_entries(TNO_PALETTE_PATH)
    missing_controller_tags = sorted(
        tag
        for tag, count in controller_counts.items()
        if count > 0 and tag not in countries
    )

    for tag in missing_controller_tags:
        metadata = TNO_CONTROLLER_ONLY_COUNTRY_META.get(tag)
        if not metadata:
            raise ValueError(f"Missing TNO controller-only country metadata for controller tag {tag}.")
        countries[tag] = build_manual_country_entry(
            tag=tag,
            existing_entry=None,
            palette_entries=palette_entries,
            feature_count=0,
            continent_id=metadata["continent_id"],
            continent_label=metadata["continent_label"],
            subregion_id=metadata["subregion_id"],
            subregion_label=metadata["subregion_label"],
            base_iso2=metadata["base_iso2"],
            lookup_iso2=metadata["lookup_iso2"],
            display_name=metadata["display_name"],
            color_hex=metadata["color_hex"],
            rule_id=f"tno_1962_controller_only_{tag.lower()}",
            notes=metadata["notes"],
            source="controller_rule",
            source_type="controller_overlay",
            historical_fidelity="tno_baseline",
            entry_kind="controller_only",
            parent_owner_tag=metadata["parent_owner_tag"],
            scenario_only=True,
            hidden_from_country_list=bool(metadata["hidden_from_country_list"]),
        )
        countries[tag]["controller_feature_count"] = int(controller_counts.get(tag, 0))


def apply_tno_inspector_groups(countries_payload: dict) -> None:
    countries = countries_payload.setdefault("countries", {})

    for tag, country_entry in countries.items():
        if not isinstance(country_entry, dict):
            continue

        normalized_tag = normalize_tag(tag or country_entry.get("tag"))
        iso_candidates = {
            normalize_iso2(country_entry.get("base_iso2")),
            normalize_iso2(country_entry.get("lookup_iso2")),
            normalize_iso2(country_entry.get("provenance_iso2")),
        }
        iso_candidates.discard("")

        group_meta = None
        if "RU" in iso_candidates and not normalized_tag.startswith("RK"):
            group_meta = TNO_INSPECTOR_GROUP_RUSSIA
        elif "CN" in iso_candidates and normalized_tag != "MAN":
            group_meta = TNO_INSPECTOR_GROUP_CHINA

        if group_meta:
            country_entry["inspector_group_id"] = group_meta["id"]
            country_entry["inspector_group_label"] = group_meta["label"]
            country_entry["inspector_group_anchor_id"] = group_meta["anchor_id"]
        else:
            country_entry.pop("inspector_group_id", None)
            country_entry.pop("inspector_group_label", None)
            country_entry.pop("inspector_group_anchor_id", None)


def ensure_tno_manual_override_countries(countries_payload: dict, owners_payload: dict) -> None:
    countries = countries_payload.setdefault("countries", {})
    owner_counts = Counter(
        normalize_tag(tag)
        for tag in owners_payload.get("owners", {}).values()
        if str(tag).strip()
    )
    palette_entries = load_palette_entries(TNO_PALETTE_PATH)

    for tag, metadata in TNO_1962_MANUAL_COUNTRY_OVERRIDES.items():
        feature_count = int(owner_counts.get(tag, 0))
        allow_zero_feature = bool(metadata.get("allow_zero_feature"))
        if feature_count <= 0 and tag not in countries and not allow_zero_feature:
            continue
        countries[tag] = build_manual_country_entry(
            tag=tag,
            existing_entry=countries.get(tag),
            palette_entries=palette_entries,
            feature_count=feature_count,
            continent_id=metadata["continent_id"],
            continent_label=metadata["continent_label"],
            subregion_id=metadata["subregion_id"],
            subregion_label=metadata["subregion_label"],
            base_iso2=metadata["base_iso2"],
            lookup_iso2=metadata["lookup_iso2"],
            provenance_iso2=metadata["provenance_iso2"],
            display_name=metadata["display_name"],
            color_hex=metadata["color_hex"],
            rule_id=f"tno_1962_{tag.lower()}_manual_override",
            notes=metadata["notes"],
            source="manual_rule",
            source_type="scenario_extension",
            historical_fidelity="extended",
            entry_kind=metadata["entry_kind"],
            parent_owner_tag=metadata["parent_owner_tag"],
            scenario_only=True,
            hidden_from_country_list=False,
        )


def apply_tno_country_display_name_overrides(countries_payload: dict) -> None:
    countries = countries_payload.get("countries", {})
    if not isinstance(countries, dict):
        return
    for raw_tag, display_name in TNO_1962_COUNTRY_DISPLAY_NAME_OVERRIDES.items():
        tag = normalize_tag(raw_tag)
        if not tag or tag not in countries:
            continue
        entry = countries.get(tag)
        if not isinstance(entry, dict):
            continue
        entry["display_name"] = str(display_name).strip()


def rebuild_tno_featured_tags(manifest_payload: dict, countries_payload: dict) -> None:
    countries = countries_payload.get("countries", {}) if isinstance(countries_payload.get("countries"), dict) else {}
    releasable_payload = load_json(RELEASABLE_CATALOG_PATH)
    releasable_tags = {
        normalize_tag(entry.get("tag"))
        for entry in releasable_payload.get("entries", [])
        if isinstance(entry, dict) and normalize_tag(entry.get("tag"))
    }
    rebuilt_featured_tags: list[str] = []
    seen_tags: set[str] = set()
    for raw_tag in manifest_payload.get("featured_tags", []):
        normalized_tag = normalize_tag(raw_tag)
        normalized_tag = TNO_FEATURED_TAG_REPLACEMENTS.get(normalized_tag, normalized_tag)
        if not normalized_tag or normalized_tag in seen_tags:
            continue
        if normalized_tag not in countries and normalized_tag not in releasable_tags:
            continue
        rebuilt_featured_tags.append(normalized_tag)
        seen_tags.add(normalized_tag)
    manifest_payload["featured_tags"] = rebuilt_featured_tags


def infer_region_meta(tag: str) -> tuple[str, str, str, str]:
    south_east_asia_tags = {"PHI", "INS", "MAL", "BRM", "VIN", "LAO", "CAM", "SIA"}
    if tag in south_east_asia_tags:
        return (
            "continent_asia",
            "Asia",
            "subregion_south_eastern_asia",
            "South-Eastern Asia",
        )
    return (
        "continent_asia",
        "Asia",
        "subregion_eastern_asia",
        "Eastern Asia",
    )


def resolve_region_meta(rule: dict, existing_entry: dict | None, tag: str) -> tuple[str, str, str, str]:
    existing_entry = existing_entry if isinstance(existing_entry, dict) else {}
    inferred_continent_id, inferred_continent_label, inferred_subregion_id, inferred_subregion_label = infer_region_meta(tag)
    continent_id = (
        str(rule.get("continent_id") or "").strip()
        or str(existing_entry.get("continent_id") or "").strip()
        or inferred_continent_id
    )
    continent_label = (
        str(rule.get("continent_label") or "").strip()
        or str(existing_entry.get("continent_label") or "").strip()
        or inferred_continent_label
    )
    subregion_id = (
        str(rule.get("subregion_id") or "").strip()
        or str(existing_entry.get("subregion_id") or "").strip()
        or inferred_subregion_id
    )
    subregion_label = (
        str(rule.get("subregion_label") or "").strip()
        or str(existing_entry.get("subregion_label") or "").strip()
        or inferred_subregion_label
    )
    return continent_id, continent_label, subregion_id, subregion_label


def build_country_entry(
    rule: dict,
    *,
    existing_entry: dict | None,
    palette_entries: dict[str, dict],
    feature_count: int,
) -> dict:
    tag = normalize_tag(rule.get("tag"))
    existing_entry = existing_entry if isinstance(existing_entry, dict) else {}
    palette_entry = palette_entries.get(tag, {})
    base_iso2 = normalize_iso2(rule.get("base_iso2")) or normalize_iso2(existing_entry.get("base_iso2")) or "CN"
    lookup_iso2 = normalize_iso2(rule.get("lookup_iso2")) or normalize_iso2(existing_entry.get("lookup_iso2")) or base_iso2
    continent_id, continent_label, subregion_id, subregion_label = resolve_region_meta(rule, existing_entry, tag)
    parent_owner_tag = normalize_tag(rule.get("parent_owner_tag"))
    parent_owner_tags = [parent_owner_tag] if parent_owner_tag else []
    color_hex = (
        normalize_hex(rule.get("color_hex"))
        or normalize_hex(existing_entry.get("color_hex"))
        or normalize_hex(palette_entry.get("map_hex"))
        or normalize_hex(palette_entry.get("country_file_hex"))
        or fallback_color(tag)
    )
    display_name = (
        str(rule.get("display_name") or "").strip()
        or str(existing_entry.get("display_name") or "").strip()
        or str(palette_entry.get("localized_name") or "").strip()
        or tag
    )
    source_type = str(rule.get("source_type") or "scenario_extension").strip()
    historical_fidelity = str(rule.get("historical_fidelity") or "extended").strip()
    rule_id = str(rule.get("rule_id") or tag.lower()).strip()
    return {
        "tag": tag,
        "display_name": display_name,
        "color_hex": color_hex,
        "feature_count": int(feature_count),
        "quality": str(rule.get("quality") or "manual_reviewed").strip(),
        "source": str(rule.get("source") or "manual_rule").strip(),
        "base_iso2": base_iso2,
        "lookup_iso2": lookup_iso2,
        "provenance_iso2": normalize_iso2(rule.get("provenance_iso2")) or normalize_iso2(existing_entry.get("provenance_iso2")) or base_iso2,
        "scenario_only": bool(rule.get("scenario_only", existing_entry.get("scenario_only", True))),
        "featured": bool(rule.get("featured", existing_entry.get("featured", False))),
        "capital_state_id": rule.get("capital_state_id", existing_entry.get("capital_state_id")),
        "continent_id": continent_id,
        "continent_label": continent_label,
        "subregion_id": subregion_id,
        "subregion_label": subregion_label,
        "notes": str(rule.get("notes") or existing_entry.get("notes") or "").strip(),
        "synthetic_owner": False,
        "source_type": source_type,
        "historical_fidelity": historical_fidelity,
        "primary_rule_source": rule_id,
        "rule_sources": [rule_id],
        "source_types": [source_type] if source_type else [],
        "historical_fidelity_summary": [historical_fidelity] if historical_fidelity else [],
        "parent_owner_tag": parent_owner_tag,
        "parent_owner_tags": parent_owner_tags,
        "subject_kind": str(rule.get("subject_kind") or existing_entry.get("subject_kind") or "").strip(),
        "entry_kind": str(rule.get("entry_kind") or existing_entry.get("entry_kind") or "").strip(),
    }


def build_manual_country_entry(
    *,
    tag: str,
    existing_entry: dict | None,
    palette_entries: dict[str, dict],
    feature_count: int,
    continent_id: str,
    continent_label: str,
    subregion_id: str,
    subregion_label: str,
    base_iso2: str,
    lookup_iso2: str,
    provenance_iso2: str = "",
    display_name: str = "",
    color_hex: str = "",
    rule_id: str = "",
    notes: str = "",
    source: str = "manual_rule",
    source_type: str = "scenario_extension",
    historical_fidelity: str = "tno_baseline",
    entry_kind: str = "",
    parent_owner_tag: str = "",
    subject_kind: str = "",
    featured: bool = False,
    scenario_only: bool = True,
    hidden_from_country_list: bool = False,
) -> dict:
    normalized_tag = normalize_tag(tag)
    existing_entry = existing_entry if isinstance(existing_entry, dict) else {}
    palette_entry = palette_entries.get(normalized_tag, {})
    normalized_parent = normalize_tag(parent_owner_tag)
    normalized_base_iso2 = normalize_iso2(base_iso2) or normalize_iso2(existing_entry.get("base_iso2")) or "ZZ"
    normalized_lookup_iso2 = (
        normalize_iso2(lookup_iso2)
        or normalize_iso2(existing_entry.get("lookup_iso2"))
        or normalized_base_iso2
    )
    normalized_provenance_iso2 = (
        normalize_iso2(provenance_iso2)
        or normalize_iso2(existing_entry.get("provenance_iso2"))
        or normalized_base_iso2
    )
    resolved_display_name = (
        str(display_name or "").strip()
        or str(existing_entry.get("display_name") or "").strip()
        or str(palette_entry.get("localized_name") or "").strip()
        or normalized_tag
    )
    resolved_color_hex = (
        normalize_hex(color_hex)
        or normalize_hex(existing_entry.get("color_hex"))
        or normalize_hex(palette_entry.get("map_hex"))
        or normalize_hex(palette_entry.get("country_file_hex"))
        or fallback_color(normalized_tag)
    )
    resolved_rule_id = str(rule_id or f"tno_1962_{normalized_tag.lower()}_baseline").strip()
    return {
        "tag": normalized_tag,
        "display_name": resolved_display_name,
        "color_hex": resolved_color_hex,
        "feature_count": int(feature_count),
        "quality": str(existing_entry.get("quality") or "manual_reviewed").strip() or "manual_reviewed",
        "source": str(source or existing_entry.get("source") or "manual_rule").strip() or "manual_rule",
        "base_iso2": normalized_base_iso2,
        "lookup_iso2": normalized_lookup_iso2,
        "provenance_iso2": normalized_provenance_iso2,
        "scenario_only": bool(scenario_only),
        "featured": bool(existing_entry.get("featured", featured)),
        "capital_state_id": existing_entry.get("capital_state_id"),
        "continent_id": str(continent_id or existing_entry.get("continent_id") or "").strip(),
        "continent_label": str(continent_label or existing_entry.get("continent_label") or "").strip(),
        "subregion_id": str(subregion_id or existing_entry.get("subregion_id") or "").strip(),
        "subregion_label": str(subregion_label or existing_entry.get("subregion_label") or "").strip(),
        "notes": str(notes or existing_entry.get("notes") or "").strip(),
        "synthetic_owner": False,
        "source_type": str(source_type or existing_entry.get("source_type") or "scenario_extension").strip(),
        "historical_fidelity": str(
            historical_fidelity or existing_entry.get("historical_fidelity") or "tno_baseline"
        ).strip(),
        "primary_rule_source": resolved_rule_id,
        "rule_sources": [resolved_rule_id],
        "source_types": [str(source_type or existing_entry.get("source_type") or "scenario_extension").strip()],
        "historical_fidelity_summary": [
            str(historical_fidelity or existing_entry.get("historical_fidelity") or "tno_baseline").strip()
        ],
        "parent_owner_tag": normalized_parent,
        "parent_owner_tags": [normalized_parent] if normalized_parent else [],
        "subject_kind": str(subject_kind or existing_entry.get("subject_kind") or "").strip(),
        "entry_kind": str(entry_kind or existing_entry.get("entry_kind") or "").strip(),
        "hidden_from_country_list": bool(hidden_from_country_list),
        "inspector_group_id": str(existing_entry.get("inspector_group_id") or "").strip(),
        "inspector_group_label": str(existing_entry.get("inspector_group_label") or "").strip(),
        "inspector_group_anchor_id": str(existing_entry.get("inspector_group_anchor_id") or "").strip(),
    }


def build_atl_country_entry(existing_entry: dict | None, feature_count: int) -> dict:
    existing_entry = existing_entry if isinstance(existing_entry, dict) else {}
    return {
        "tag": ATL_TAG,
        "display_name": str(existing_entry.get("display_name") or "Atlantropa Reclamation Zone").strip(),
        "color_hex": normalize_hex(existing_entry.get("color_hex")) or ATL_COLOR_HEX,
        "feature_count": int(feature_count),
        "quality": "manual_reviewed",
        "source": "scenario_generated",
        "base_iso2": ATL_BASE_ISO2,
        "lookup_iso2": ATL_BASE_ISO2,
        "provenance_iso2": ATL_BASE_ISO2,
        "scenario_only": True,
        "featured": False,
        "capital_state_id": None,
        "continent_id": "continent_special",
        "continent_label": "Special",
        "subregion_id": "subregion_atlantropa",
        "subregion_label": "Atlantropa",
        "notes": "Synthetic owner used for Atlantropa land and sea staging in the 1962 scenario.",
        "synthetic_owner": True,
        "source_type": "scenario_synthetic",
        "historical_fidelity": "alternate_history",
        "primary_rule_source": "atlantropa_dummy_owner",
        "rule_sources": ["atlantropa_dummy_owner"],
        "source_types": ["scenario_synthetic"],
        "historical_fidelity_summary": ["alternate_history"],
        "parent_owner_tag": "",
        "parent_owner_tags": [],
        "subject_kind": "",
        "entry_kind": "",
        "hidden_from_country_list": True,
    }


def build_owner_stats_entry(country_entry: dict) -> dict:
    feature_count = int(country_entry.get("feature_count", 0) or 0)
    quality = str(country_entry.get("quality") or "manual_reviewed").strip() or "manual_reviewed"
    return {
        "display_name": str(country_entry.get("display_name") or country_entry.get("tag") or "").strip(),
        "feature_count": feature_count,
        "controller_feature_count": int(country_entry.get("controller_feature_count", 0) or 0),
        "quality": quality,
        "quality_breakdown": {quality: feature_count} if feature_count > 0 else {},
        "base_iso2": str(country_entry.get("base_iso2") or "").strip().upper(),
        "lookup_iso2": str(country_entry.get("lookup_iso2") or "").strip().upper(),
        "provenance_iso2": str(country_entry.get("provenance_iso2") or "").strip().upper(),
        "scenario_only": bool(country_entry.get("scenario_only")),
        "synthetic_owner": bool(country_entry.get("synthetic_owner")),
        "continent_label": str(country_entry.get("continent_label") or "").strip(),
        "subregion_label": str(country_entry.get("subregion_label") or "").strip(),
        "source_type": str(country_entry.get("source_type") or "").strip(),
        "historical_fidelity": str(country_entry.get("historical_fidelity") or "").strip(),
        "primary_rule_source": str(country_entry.get("primary_rule_source") or "").strip(),
        "rule_sources": list(country_entry.get("rule_sources", [])),
        "source_types": list(country_entry.get("source_types", [])),
        "historical_fidelity_summary": list(country_entry.get("historical_fidelity_summary", [])),
        "parent_owner_tag": str(country_entry.get("parent_owner_tag") or "").strip().upper(),
        "parent_owner_tags": list(country_entry.get("parent_owner_tags", [])),
        "subject_kind": str(country_entry.get("subject_kind") or "").strip(),
        "entry_kind": str(country_entry.get("entry_kind") or "").strip(),
        "hidden_from_country_list": bool(country_entry.get("hidden_from_country_list")),
    }


def load_scenario_country_entries(path: Path) -> dict[str, dict]:
    payload = load_json(path)
    countries = payload.get("countries", {})
    if not isinstance(countries, dict):
        raise ValueError(f"Scenario countries payload is not a dict: {path}")
    return countries


def apply_tno_decolonization_metadata(countries_payload: dict) -> None:
    countries = countries_payload.get("countries", {})
    if not isinstance(countries, dict):
        raise ValueError("tno_1962 countries payload does not contain a `countries` mapping.")

    palette_entries = load_palette_entries(TNO_PALETTE_PATH)
    canonical_countries = load_scenario_country_entries(MODERN_WORLD_COUNTRIES_PATH)

    for tag in TNO_DECOLONIZATION_CANONICAL_TAGS:
        existing_entry = countries.get(tag)
        if not isinstance(existing_entry, dict):
            raise ValueError(f"Decolonization metadata expected country entry for {tag}.")
        reference_entry = canonical_countries.get(tag)
        if not isinstance(reference_entry, dict):
            raise ValueError(f"Canonical modern_world country entry not found for {tag}.")
        countries[tag] = build_manual_country_entry(
            tag=tag,
            existing_entry=existing_entry,
            palette_entries=palette_entries,
            feature_count=int(existing_entry.get("feature_count", 0) or 0),
            continent_id=str(reference_entry.get("continent_id") or ""),
            continent_label=str(reference_entry.get("continent_label") or ""),
            subregion_id=str(reference_entry.get("subregion_id") or ""),
            subregion_label=str(reference_entry.get("subregion_label") or ""),
            base_iso2=str(reference_entry.get("base_iso2") or ""),
            lookup_iso2=str(reference_entry.get("lookup_iso2") or ""),
            provenance_iso2=str(reference_entry.get("provenance_iso2") or ""),
            display_name=str(reference_entry.get("display_name") or ""),
            color_hex=str(reference_entry.get("color_hex") or ""),
            rule_id=f"tno_1962_decolonization_{tag.lower()}",
            notes=str(existing_entry.get("notes") or "").strip(),
            source=str(existing_entry.get("source") or "manual_rule").strip() or "manual_rule",
            source_type=str(existing_entry.get("source_type") or "scenario_extension").strip() or "scenario_extension",
            historical_fidelity=str(existing_entry.get("historical_fidelity") or "extended").strip() or "extended",
            entry_kind="scenario_country",
            parent_owner_tag="",
            subject_kind="",
            featured=bool(existing_entry.get("featured", reference_entry.get("featured", False))),
            scenario_only=bool(reference_entry.get("scenario_only")),
            hidden_from_country_list=bool(
                existing_entry.get("hidden_from_country_list", reference_entry.get("hidden_from_country_list", False))
            ),
        )

    for tag in TNO_DECOLONIZATION_INDEPENDENT_TAGS:
        existing_entry = countries.get(tag)
        if not isinstance(existing_entry, dict):
            raise ValueError(f"Decolonization metadata expected country entry for {tag}.")
        countries[tag] = build_manual_country_entry(
            tag=tag,
            existing_entry=existing_entry,
            palette_entries=palette_entries,
            feature_count=int(existing_entry.get("feature_count", 0) or 0),
            continent_id=str(existing_entry.get("continent_id") or ""),
            continent_label=str(existing_entry.get("continent_label") or ""),
            subregion_id=str(existing_entry.get("subregion_id") or ""),
            subregion_label=str(existing_entry.get("subregion_label") or ""),
            base_iso2=str(existing_entry.get("base_iso2") or ""),
            lookup_iso2=str(existing_entry.get("lookup_iso2") or ""),
            provenance_iso2=str(existing_entry.get("provenance_iso2") or ""),
            display_name=str(existing_entry.get("display_name") or ""),
            color_hex=str(existing_entry.get("color_hex") or ""),
            rule_id=f"tno_1962_independent_{tag.lower()}",
            notes=TNO_DECOLONIZATION_NOTES.get(tag, str(existing_entry.get("notes") or "").strip()),
            source=str(existing_entry.get("source") or "manual_rule").strip() or "manual_rule",
            source_type=str(existing_entry.get("source_type") or "scenario_extension").strip() or "scenario_extension",
            historical_fidelity=str(existing_entry.get("historical_fidelity") or "tno_baseline").strip() or "tno_baseline",
            entry_kind="scenario_country",
            parent_owner_tag="",
            subject_kind="",
            featured=bool(existing_entry.get("featured")),
            scenario_only=bool(existing_entry.get("scenario_only", True)),
            hidden_from_country_list=bool(existing_entry.get("hidden_from_country_list")),
        )
        countries[tag]["parent_owner_tag"] = ""
        countries[tag]["parent_owner_tags"] = []
        countries[tag]["subject_kind"] = ""
        countries[tag]["entry_kind"] = "scenario_country"

    countries.pop("SUD", None)


def resolve_rule_feature_ids(
    rule: dict,
    *,
    baseline_owners: dict[str, str],
    hierarchy_groups: dict[str, list[str]],
) -> list[str]:
    include_feature_ids = {
        str(feature_id).strip()
        for feature_id in rule.get("include_feature_ids", [])
        if str(feature_id).strip()
    }
    for group_id in rule.get("include_hierarchy_group_ids", []):
        include_feature_ids.update(
            str(feature_id).strip()
            for feature_id in hierarchy_groups.get(str(group_id).strip(), [])
            if str(feature_id).strip()
        )
    include_owner_tags = {
        normalize_tag(tag)
        for tag in rule.get("include_existing_owner_tags", [])
        if normalize_tag(tag)
    }
    if include_owner_tags:
        include_feature_ids.update(
            feature_id
            for feature_id, owner_tag in baseline_owners.items()
            if normalize_tag(owner_tag) in include_owner_tags
        )
    include_prefixes = [str(prefix).strip() for prefix in rule.get("include_feature_prefixes", []) if str(prefix).strip()]
    if include_prefixes:
        include_feature_ids.update(
            feature_id
            for feature_id in baseline_owners
            if any(feature_id.startswith(prefix) for prefix in include_prefixes)
        )

    exclude_feature_ids = {
        str(feature_id).strip()
        for feature_id in rule.get("exclude_feature_ids", [])
        if str(feature_id).strip()
    }
    for group_id in rule.get("exclude_hierarchy_group_ids", []):
        exclude_feature_ids.update(
            str(feature_id).strip()
            for feature_id in hierarchy_groups.get(str(group_id).strip(), [])
            if str(feature_id).strip()
        )
    exclude_owner_tags = {
        normalize_tag(tag)
        for tag in rule.get("exclude_existing_owner_tags", [])
        if normalize_tag(tag)
    }
    if exclude_owner_tags:
        exclude_feature_ids.update(
            feature_id
            for feature_id, owner_tag in baseline_owners.items()
            if normalize_tag(owner_tag) in exclude_owner_tags
        )
    exclude_prefixes = [str(prefix).strip() for prefix in rule.get("exclude_feature_prefixes", []) if str(prefix).strip()]
    if exclude_prefixes:
        exclude_feature_ids.update(
            feature_id
            for feature_id in baseline_owners
            if any(feature_id.startswith(prefix) for prefix in exclude_prefixes)
        )

    include_feature_ids.difference_update(exclude_feature_ids)
    return sorted(include_feature_ids)


def apply_regional_rules(
    rule_pack_name: str,
    rule_path: Path,
    countries_payload: dict,
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
    audit_payload: dict,
) -> list[str]:
    rule_payload = load_json(rule_path)
    apply_to_controllers = bool(rule_payload.get("apply_to_controllers"))
    apply_to_cores = bool(rule_payload.get("apply_to_cores"))
    hierarchy_groups = load_hierarchy_groups()
    palette_entries = load_palette_entries(TNO_PALETTE_PATH)
    baseline_owners = {
        str(feature_id).strip(): normalize_tag(tag)
        for feature_id, tag in owners_payload.get("owners", {}).items()
        if str(feature_id).strip()
    }
    countries = countries_payload.get("countries", {})
    touched_tags: list[str] = []
    for rule in rule_payload.get("country_rules", []):
        tag = normalize_tag(rule.get("tag"))
        if not tag:
            continue
        preserve_existing_country_entry = bool(rule.get("preserve_existing_country_entry"))
        feature_ids = resolve_rule_feature_ids(
            rule,
            baseline_owners=baseline_owners,
            hierarchy_groups=hierarchy_groups,
        )
        if not feature_ids:
            raise ValueError(
                f"Regional rule pack `{rule_pack_name}` rule `{rule.get('rule_id')}` resolved zero features."
            )
        for feature_id in feature_ids:
            owners_payload["owners"][feature_id] = tag
            if apply_to_controllers:
                controllers_payload["controllers"][feature_id] = tag
            if apply_to_cores:
                set_feature_core_tags(cores_payload["cores"], feature_id, [tag])
        if preserve_existing_country_entry:
            if tag not in countries:
                raise ValueError(
                    f"Regional rule pack `{rule_pack_name}` rule `{rule.get('rule_id')}` "
                    "requested preserve_existing_country_entry "
                    f"but `{tag}` is missing from countries.json."
                )
        else:
            countries[tag] = build_country_entry(
                rule,
                existing_entry=countries.get(tag),
                palette_entries=palette_entries,
                feature_count=len(feature_ids),
            )
        touched_tags.append(tag)

    retired_tags = [normalize_tag(tag) for tag in rule_payload.get("retired_tags", []) if normalize_tag(tag)]
    remaining_retired_tags = {
        tag
        for tag in retired_tags
        if any(normalize_tag(owner_tag) == tag for owner_tag in owners_payload.get("owners", {}).values())
    }
    if remaining_retired_tags:
        raise ValueError(
            f"Regional rule pack `{rule_pack_name}` left active ownership on retired tags: "
            + ", ".join(sorted(remaining_retired_tags))
        )
    for retired_tag in retired_tags:
        countries.pop(retired_tag, None)
    for tag in touched_tags:
        audit_payload.setdefault("owner_stats", {})[tag] = build_owner_stats_entry(countries[tag])
    for retired_tag in retired_tags:
        audit_payload.setdefault("owner_stats", {}).pop(retired_tag, None)
    return touched_tags


def load_definition_entries(base_dir: Path) -> tuple[dict[int, int], dict[int, str], dict[int, int]]:
    province_rgb_key_by_id: dict[int, int] = {}
    province_type_by_id: dict[int, str] = {}
    rgb_key_to_id: dict[int, int] = {}
    with (base_dir / "map/definition.csv").open("r", encoding="utf-8", errors="ignore") as handle:
        reader = csv.reader(handle, delimiter=";")
        for row in reader:
            if len(row) < 5 or not row[0].isdigit():
                continue
            province_id = int(row[0])
            rgb_key = (int(row[1]) << 16) | (int(row[2]) << 8) | int(row[3])
            province_rgb_key_by_id[province_id] = rgb_key
            province_type_by_id[province_id] = row[4].strip().lower()
            rgb_key_to_id[rgb_key] = province_id
    return province_rgb_key_by_id, province_type_by_id, rgb_key_to_id


def load_province_key_image(base_dir: Path) -> np.ndarray:
    rgb_image = read_bmp24(base_dir / "map/provinces.bmp")
    return (
        rgb_image[:, :, 0].astype(np.uint32) << 16
    ) | (
        rgb_image[:, :, 1].astype(np.uint32) << 8
    ) | rgb_image[:, :, 2].astype(np.uint32)


def load_land_mask(base_dir: Path, province_key_image: np.ndarray | None = None) -> tuple[np.ndarray, dict[int, int], dict[int, str], dict[int, int]]:
    province_rgb_key_by_id, province_type_by_id, rgb_key_to_id = load_definition_entries(base_dir)
    key_image = province_key_image if province_key_image is not None else load_province_key_image(base_dir)
    land_keys = np.array(
        [rgb_key for province_id, rgb_key in province_rgb_key_by_id.items() if province_type_by_id.get(province_id) == "land"],
        dtype=np.uint32,
    )
    land_mask = np.isin(key_image, land_keys)
    return land_mask, province_rgb_key_by_id, province_type_by_id, rgb_key_to_id


def iter_polygon_parts(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return [part for part in geom.geoms if not part.is_empty]
    if isinstance(geom, GeometryCollection):
        parts: list[Polygon] = []
        for part in geom.geoms:
            parts.extend(iter_polygon_parts(part))
        return parts
    return []


def normalize_polygonal(geom):
    if geom is None or geom.is_empty:
        return None
    candidate = geom
    try:
        if not candidate.is_valid:
            candidate = make_valid(candidate)
    except Exception:
        try:
            candidate = geom.buffer(0)
        except Exception:
            candidate = geom
    parts = []
    for part in iter_polygon_parts(candidate):
        normalized_part = part
        try:
            if not normalized_part.is_valid:
                normalized_part = make_valid(normalized_part)
        except Exception:
            try:
                normalized_part = part.buffer(0)
            except Exception:
                normalized_part = part
        if isinstance(normalized_part, GeometryCollection):
            candidate_parts = iter_polygon_parts(normalized_part)
        elif isinstance(normalized_part, MultiPolygon):
            candidate_parts = [sub_part for sub_part in normalized_part.geoms if not sub_part.is_empty]
        elif isinstance(normalized_part, Polygon):
            candidate_parts = [normalized_part]
        else:
            candidate_parts = []
        for candidate_part in candidate_parts:
            if candidate_part.is_empty or candidate_part.area <= 1e-9:
                continue
            parts.append(orient(candidate_part, sign=-1.0))
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def safe_unary_union(geoms):
    normalized_parts = []
    for geom in geoms:
        normalized = normalize_polygonal(geom)
        if normalized is not None:
            normalized_parts.append(normalized)
    if not normalized_parts:
        return None
    return normalize_polygonal(unary_union(normalized_parts))


def polygonize_mask(mask: np.ndarray, transform: Affine | None = None):
    if not mask.any():
        raise ValueError("Expected non-empty mask.")
    shapes = raster_features.shapes(
        mask.astype(np.uint8),
        mask=mask.astype(bool),
        transform=transform or Affine.identity(),
    )
    geoms = [shape(geom) for geom, value in shapes if int(value) == 1]
    merged = unary_union(geoms)
    normalized = normalize_polygonal(merged)
    if normalized is None:
        raise ValueError("Polygonization returned no valid geometry.")
    return normalized


def smooth_polygonal(geom, *, buffer_radius: float = 0.0, simplify_tolerance: float = 0.0):
    candidate = normalize_polygonal(geom)
    if candidate is None:
        raise ValueError("Expected polygonal geometry.")
    if buffer_radius > 0:
        candidate = normalize_polygonal(candidate.buffer(buffer_radius).buffer(-buffer_radius))
    if simplify_tolerance > 0:
        candidate = normalize_polygonal(candidate.simplify(simplify_tolerance, preserve_topology=True))
    if candidate is None:
        raise ValueError("Geometry smoothing collapsed geometry.")
    return candidate


def estimate_equal_area_value(geom) -> float:
    candidate = normalize_polygonal(geom)
    if candidate is None:
        return 0.0
    try:
        series = gpd.GeoSeries([candidate], crs="EPSG:4326").to_crs("EPSG:6933")
        return float(series.area.iloc[0])
    except Exception:
        return float(candidate.area)


def estimate_geometry_arc_refs(geom) -> int:
    candidate = normalize_polygonal(geom)
    if candidate is None:
        return 0
    total = 0
    for polygon in iter_polygon_parts(candidate):
        total += len(list(polygon.exterior.coords))
        total += sum(len(list(interior.coords)) for interior in polygon.interiors)
    return int(total)


def estimate_topology_object_arc_refs(topology_payload: dict, object_name: str) -> int:
    obj = (topology_payload or {}).get("objects", {}).get(object_name, {})

    def count_arc_refs(value) -> int:
        if isinstance(value, int):
            return 1
        if isinstance(value, list):
            return sum(count_arc_refs(item) for item in value)
        if isinstance(value, dict):
            return count_arc_refs(value.get("arcs"))
        return 0

    return int(count_arc_refs(obj.get("geometries", [])))


def build_context_land_mask_geometry(
    land_mask_geom,
    *,
    tolerances: tuple[float, ...] = (0.25, 0.35, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0),
    max_area_delta_ratio: float = 0.005,
    max_component_increase: int = 96,
    target_arc_refs_min: int = 12_000,
    target_arc_refs_max: int = 20_000,
):
    precise_geom = normalize_polygonal(land_mask_geom)
    if precise_geom is None:
        raise ValueError("Expected precise land mask geometry.")
    base_area = max(estimate_equal_area_value(precise_geom), 1e-9)
    base_component_count = len(iter_polygon_parts(precise_geom))
    protected_aois = [
        box(*expand_bbox(COASTAL_RESTORE_AOI_CONFIGS[key]["bbox"], CONTEXT_LAND_MASK_PROTECTED_AOI_MARGIN_DEG))
        for key in CONTEXT_LAND_MASK_PROTECTED_AOI_KEYS
        if key in COASTAL_RESTORE_AOI_CONFIGS
    ]
    protected_aoi_union = safe_unary_union(protected_aois)
    protected_geom = normalize_polygonal(precise_geom.intersection(protected_aoi_union)) if protected_aoi_union is not None else None
    coarse_geom = normalize_polygonal(precise_geom.difference(protected_aoi_union)) if protected_aoi_union is not None else precise_geom
    best_candidate = None
    best_tolerance = None
    best_area_delta_ratio = None
    best_arc_refs = None
    for tolerance in tolerances:
        simplified_coarse = normalize_polygonal(coarse_geom.simplify(tolerance, preserve_topology=True)) if coarse_geom is not None else None
        candidate_polygons = []
        candidate_polygons.extend(iter_polygon_parts(simplified_coarse))
        candidate_polygons.extend(iter_polygon_parts(protected_geom))
        if not candidate_polygons:
            continue
        candidate = normalize_polygonal(candidate_polygons[0] if len(candidate_polygons) == 1 else MultiPolygon(candidate_polygons))
        if candidate is None:
            continue
        if len(iter_polygon_parts(candidate)) > (base_component_count + max_component_increase):
            continue
        candidate_area = estimate_equal_area_value(candidate)
        area_delta_ratio = abs(candidate_area - base_area) / base_area
        if area_delta_ratio > max_area_delta_ratio:
            continue
        candidate_arc_refs = estimate_geometry_arc_refs(candidate)
        if target_arc_refs_min <= candidate_arc_refs <= target_arc_refs_max:
            return candidate, float(tolerance), float(area_delta_ratio), False, int(candidate_arc_refs)
        if best_candidate is None or candidate_arc_refs < best_arc_refs:
            best_candidate = candidate
            best_tolerance = float(tolerance)
            best_area_delta_ratio = float(area_delta_ratio)
            best_arc_refs = int(candidate_arc_refs)
    if best_candidate is not None:
        return best_candidate, best_tolerance, best_area_delta_ratio, False, best_arc_refs
    return precise_geom, None, 0.0, True, int(estimate_geometry_arc_refs(precise_geom))


def make_feature(geom, properties: dict) -> dict:
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": mapping(geom),
    }


def feature_collection_from_features(features: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": features,
    }


def geopandas_from_features(features: list[dict]) -> gpd.GeoDataFrame:
    if not features:
        return gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")
    gdf = gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    return gdf


def topology_object_to_feature_collection(topo_dict: dict, object_name: str) -> dict:
    return serialize_as_geojson(topo_dict, objectname=object_name)


def topology_object_to_gdf(topo_dict: dict, object_name: str) -> gpd.GeoDataFrame:
    fc = topology_object_to_feature_collection(topo_dict, object_name)
    gdf = serialize_as_geodataframe(fc)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    elif str(gdf.crs).upper() != "EPSG:4326":
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def remap_topology_arc_indexes(value: object, offset: int) -> object:
    if not offset:
        return copy.deepcopy(value)
    if isinstance(value, list):
        if value and all(isinstance(item, int) for item in value):
            remapped: list[int] = []
            for arc_index in value:
                sign = -1 if arc_index < 0 else 1
                base_index = abs(arc_index)
                remapped.append((base_index + offset) * sign)
            return remapped
        return [remap_topology_arc_indexes(item, offset) for item in value]
    if isinstance(value, dict):
        remapped_dict = {}
        for key, item in value.items():
            if key == "arcs" or isinstance(item, (list, dict)):
                remapped_dict[key] = remap_topology_arc_indexes(item, offset)
            else:
                remapped_dict[key] = copy.deepcopy(item)
        return remapped_dict
    return copy.deepcopy(value)


def merge_topology_bboxes(*bboxes: object) -> list[float] | None:
    valid_boxes: list[list[float]] = []
    for bbox in bboxes:
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        try:
            valid_boxes.append([float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])])
        except (TypeError, ValueError):
            continue
    if not valid_boxes:
        return None
    return [
        min(box[0] for box in valid_boxes),
        min(box[1] for box in valid_boxes),
        max(box[2] for box in valid_boxes),
        max(box[3] for box in valid_boxes),
    ]


def sanitize_feature_collection_polygonal_geometries(feature_collection: dict) -> dict:
    if not isinstance(feature_collection, dict):
        return feature_collection
    sanitized_features: list[dict] = []
    for feature in feature_collection.get("features", []):
        if not isinstance(feature, dict):
            continue
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            sanitized_features.append(feature)
            continue
        normalized_geom = normalize_polygonal(shape(geometry_payload))
        if normalized_geom is None:
            sanitized_features.append(feature)
            continue
        sanitized_features.append({
            "type": "Feature",
            "properties": dict(feature.get("properties", {})),
            "geometry": mapping(normalized_geom),
        })
    return feature_collection_from_features(sanitized_features)


def load_state_path_index(states_dir: Path) -> tuple[dict[int, Path], dict[int, str]]:
    path_by_state_id: dict[int, Path] = {}
    name_by_state_id: dict[int, str] = {}
    for path in sorted(states_dir.glob("*.txt")):
        match = STATE_FILE_RE.match(path.name)
        if not match:
            continue
        state_id = int(match.group("id"))
        state_name = match.group("name")
        path_by_state_id[state_id] = path
        name_by_state_id[state_id] = state_name
    return path_by_state_id, name_by_state_id


def parse_state_province_ids(path: Path) -> list[int]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"provinces\s*=\s*\{([^}]*)\}", text, re.S)
    if not match:
        raise ValueError(f"Unable to find province list in {path}")
    return [int(value) for value in re.findall(r"\b\d+\b", match.group(1))]


def build_raw_geo_transform(width: int, height: int) -> Affine:
    return Affine(360.0 / float(width), 0.0, -180.0, 0.0, -180.0 / float(height), 90.0)


def load_hgo_context(root: Path) -> dict:
    key_image = load_province_key_image(root)
    province_rgb_key_by_id, province_type_by_id, rgb_key_to_id = load_definition_entries(root)
    raw_transform = build_raw_geo_transform(key_image.shape[1], key_image.shape[0])
    state_path_index, state_name_index = load_state_path_index(root / "history/states")
    return {
        "root": root,
        "key_image": key_image,
        "province_rgb_key_by_id": province_rgb_key_by_id,
        "province_type_by_id": province_type_by_id,
        "rgb_key_to_id": rgb_key_to_id,
        "raw_transform": raw_transform,
        "state_path_index": state_path_index,
        "state_name_index": state_name_index,
        "province_geom_cache": {},
        "state_geom_cache": {},
        "state_province_cache": {},
    }


def get_state_path(context: dict, state_id: int) -> Path:
    path = context["state_path_index"].get(int(state_id))
    if path is None:
        raise FileNotFoundError(f"Unable to locate donor state file for state id {state_id}")
    return path


def get_state_name(context: dict, state_id: int) -> str:
    return str(context["state_name_index"].get(int(state_id)) or f"State {state_id}")


def get_state_province_ids(context: dict, state_id: int) -> list[int]:
    state_id = int(state_id)
    cache = context["state_province_cache"]
    if state_id in cache:
        return cache[state_id]
    province_ids = parse_state_province_ids(get_state_path(context, state_id))
    cache[state_id] = province_ids
    return province_ids


def extract_province_geometry_raw(context: dict, province_id: int):
    province_id = int(province_id)
    cache = context["province_geom_cache"]
    if province_id in cache:
        return cache[province_id]
    rgb_key = context["province_rgb_key_by_id"].get(province_id)
    if rgb_key is None:
        raise KeyError(f"Province {province_id} is missing from donor definition.csv")
    key_image = context["key_image"]
    mask = key_image == rgb_key
    if not mask.any():
        raise ValueError(f"Province {province_id} has no pixels in donor provinces.bmp")
    ys, xs = np.where(mask)
    min_x, max_x = int(xs.min()), int(xs.max())
    min_y, max_y = int(ys.min()), int(ys.max())
    cropped = mask[min_y : max_y + 1, min_x : max_x + 1]
    transform = context["raw_transform"] * Affine.translation(min_x, min_y)
    geom = polygonize_mask(cropped, transform=transform)
    geom = smooth_polygonal(geom, simplify_tolerance=0.0025)
    cache[province_id] = geom
    return geom


def extract_state_geometry_raw(context: dict, state_id: int):
    state_id = int(state_id)
    cache = context["state_geom_cache"]
    if state_id in cache:
        return cache[state_id]
    province_ids = get_state_province_ids(context, state_id)
    parts = [extract_province_geometry_raw(context, province_id) for province_id in province_ids]
    geom = safe_unary_union(parts)
    if geom is None:
        raise ValueError(f"Donor state {state_id} collapsed to empty geometry")
    cache[state_id] = geom
    return geom


def solve_affine_from_control_points(control_pairs: list[tuple[tuple[float, float], tuple[float, float]]]) -> tuple[float, float, float, float, float, float]:
    if len(control_pairs) < 3:
        raise ValueError("At least three control points are required for affine fitting.")
    matrix = np.array([[src_x, src_y, 1.0] for (src_x, src_y), _ in control_pairs], dtype=float)
    target_x = np.array([dst_x for _, (dst_x, _dst_y) in control_pairs], dtype=float)
    target_y = np.array([dst_y for _, (_dst_x, dst_y) in control_pairs], dtype=float)
    ax, bx, cx = np.linalg.lstsq(matrix, target_x, rcond=None)[0]
    ay, by, cy = np.linalg.lstsq(matrix, target_y, rcond=None)[0]
    return float(ax), float(bx), float(cx), float(ay), float(by), float(cy)


def apply_affine_to_geometry(geom, coeffs: tuple[float, float, float, float, float, float]):
    ax, bx, cx, ay, by, cy = coeffs
    transformed = affinity.affine_transform(geom, [ax, bx, ay, by, cx, cy])
    return normalize_polygonal(transformed)


def local_land_union(full_land_gdf: gpd.GeoDataFrame, target_bbox: tuple[float, float, float, float], padding: float = 2.0):
    min_x, min_y, max_x, max_y = target_bbox
    bounds = full_land_gdf.bounds
    mask = (
        (bounds["maxx"] >= min_x - padding)
        & (bounds["minx"] <= max_x + padding)
        & (bounds["maxy"] >= min_y - padding)
        & (bounds["miny"] <= max_y + padding)
    )
    local = full_land_gdf.loc[mask]
    if local.empty:
        return None
    return safe_unary_union(local.geometry.tolist())


def local_land_boundary(full_land_gdf: gpd.GeoDataFrame, target_bbox: tuple[float, float, float, float], padding: float = 2.0):
    union = local_land_union(full_land_gdf, target_bbox, padding=padding)
    if union is None:
        return None
    return union.boundary


def build_mainland_reference_union(
    local_land,
    target_bbox: tuple[float, float, float, float],
    *,
    min_area: float = 3.0,
) -> object | None:
    aoi = box(*target_bbox)
    boundary_band = aoi.boundary.buffer(0.02)
    keep_parts: list[Polygon] = []
    ranked_parts = sorted(iter_polygon_parts(local_land), key=lambda part: float(part.area), reverse=True)
    for part in ranked_parts:
        if float(part.area) >= float(min_area) and part.intersects(boundary_band):
            keep_parts.append(part)
    if not keep_parts:
        keep_parts = ranked_parts[: max(1, min(3, len(ranked_parts)))]
    return safe_unary_union(keep_parts)


def donor_state_name_has_hint(state_name: str, hints: tuple[str, ...]) -> bool:
    text = str(state_name or "").strip().lower()
    if not text:
        return False
    return any(hint in text for hint in hints)


def classify_atl_geometry_role(
    *,
    state_id: int,
    state_name: str,
    geom,
    mainland_union,
    config: dict,
) -> str:
    causeway_keep_ids = {int(value) for value in config.get("causeway_keep_state_ids", [])}
    causeway_trim_ids = {int(value) for value in config.get("causeway_trim_state_ids", [])}
    causeway_drop_ids = {int(value) for value in config.get("causeway_drop_state_ids", [])}
    if int(state_id) in causeway_drop_ids:
        return "skip"
    if (
        int(state_id) in causeway_keep_ids
        or int(state_id) in causeway_trim_ids
        or donor_state_name_has_hint(state_name, DONOR_CAUSEWAY_NAME_HINTS)
    ):
        return ATL_GEOMETRY_ROLE_CAUSEWAY
    if not config.get("island_replacement"):
        return ATL_GEOMETRY_ROLE_DONOR_LAND
    if donor_state_name_has_hint(state_name, DONOR_ISLAND_NAME_HINTS):
        return ATL_GEOMETRY_ROLE_DONOR_ISLAND
    touch_tolerance = float(config.get("mainland_touch_tolerance", 0.035))
    if mainland_union is None:
        return ATL_GEOMETRY_ROLE_DONOR_LAND
    if geom.intersects(mainland_union.buffer(touch_tolerance)):
        return ATL_GEOMETRY_ROLE_DONOR_LAND
    return ATL_GEOMETRY_ROLE_DONOR_ISLAND


def assign_owner_from_nearest_rows(target_geom, candidate_rows: list[dict]) -> str:
    owner_tag = score_assignment_candidates(target_geom, candidate_rows, field_name="assigned_owner_tag")
    return normalize_tag(owner_tag) or ATL_TAG


def expand_bbox(bounds: tuple[float, float, float, float], margin: float) -> tuple[float, float, float, float]:
    min_x, min_y, max_x, max_y = bounds
    pad = max(0.0, float(margin))
    return (min_x - pad, min_y - pad, max_x + pad, max_y + pad)


def row_matches_donor_state_ids(row: dict, state_ids: set[int]) -> bool:
    if not state_ids:
        return False
    donor_ids = {int(value) for value in row.get("donor_state_ids", [])}
    return bool(donor_ids.intersection(state_ids))


def make_atl_row(
    *,
    feature_id: str,
    name: str,
    geometry,
    region_id: str,
    config: dict,
    assigned_owner_tag: str,
    geometry_role: str,
    donor_state_ids: list[int],
    donor_state_names: list[str],
    donor_province_ids: list[int],
    join_mode: str = ATL_JOIN_MODE_NONE,
) -> dict:
    normalized_join_mode = str(join_mode or ATL_JOIN_MODE_NONE).strip() or ATL_JOIN_MODE_NONE
    is_explicit_political = (
        geometry_role in {
            ATL_GEOMETRY_ROLE_DONOR_LAND,
            ATL_GEOMETRY_ROLE_DONOR_ISLAND,
            ATL_GEOMETRY_ROLE_CAUSEWAY,
        }
        and normalized_join_mode not in {ATL_JOIN_MODE_GAP_FILL, ATL_JOIN_MODE_BOOLEAN_WELD}
    )
    return {
        "id": feature_id,
        "name": name,
        "cntr_code": ATL_TAG,
        "admin1_group": config["feature_group_id"],
        "detail_tier": "scenario_atlantropa",
        "__source": ATL_SOURCE_TAG,
        "geometry": geometry,
        "region_id": region_id,
        "assigned_owner_tag": normalize_tag(assigned_owner_tag) or ATL_TAG,
        "atl_geometry_role": geometry_role,
        "atl_join_mode": normalized_join_mode,
        "interactive": bool(is_explicit_political),
        "donor_state_ids": [int(value) for value in donor_state_ids],
        "donor_state_names": [str(value).strip() for value in donor_state_names if str(value).strip()],
        "donor_province_ids": [int(value) for value in donor_province_ids],
    }


def build_major_island_rows(
    region_id: str,
    config: dict,
    island_rows: list[dict],
    baseline_land_full_gdf: gpd.GeoDataFrame,
    mainland_union,
) -> tuple[list[dict], list[dict]]:
    groups = list(config.get("major_island_groups", []) or [])
    if not groups or not island_rows:
        return [], island_rows

    used_row_ids: set[str] = set()
    rebuilt_rows: list[dict] = []
    touch_tolerance = float(config.get("mainland_touch_tolerance", 0.035))
    simplify_tolerance = float(config.get("simplify_tolerance", 0.01))
    region_aoi = box(*config["aoi_bbox"])

    for group in groups:
        donor_state_ids = {int(value) for value in group.get("donor_state_ids", [])}
        if not donor_state_ids:
            continue
        matched_rows = [
            row for row in island_rows
            if row.get("id") not in used_row_ids
            and donor_state_ids.intersection({int(value) for value in row.get("donor_state_ids", [])})
        ]
        if not matched_rows:
            continue

        donor_union = safe_unary_union([row["geometry"] for row in matched_rows])
        if donor_union is None:
            continue

        explicit_baseline_ids = {
            str(feature_id).strip()
            for feature_id in group.get("baseline_feature_ids", [])
            if str(feature_id).strip()
        }
        search_margin = float(group.get("search_margin", 0.3))
        group_bbox = tuple(group.get("group_bbox") or expand_bbox(donor_union.bounds, search_margin))
        group_aoi = box(*group_bbox).intersection(region_aoi)
        if group_aoi.is_empty:
            group_aoi = region_aoi

        local_baseline = baseline_land_full_gdf.loc[baseline_land_full_gdf.intersects(group_aoi)].copy().reset_index(drop=True)
        baseline_parts: list[Polygon] = []
        for baseline_row in local_baseline.to_dict("records"):
            baseline_id = str(baseline_row.get("id") or "").strip()
            geom = normalize_polygonal(baseline_row.get("geometry"))
            if geom is None:
                continue
            if explicit_baseline_ids and baseline_id not in explicit_baseline_ids:
                continue
            if mainland_union is not None and geom.intersects(mainland_union.buffer(touch_tolerance)):
                continue
            if not explicit_baseline_ids and not geom.intersects(donor_union.buffer(search_margin)):
                continue
            baseline_parts.extend(iter_polygon_parts(geom))

        baseline_union = safe_unary_union(baseline_parts)
        combined = donor_union
        join_mode = ATL_JOIN_MODE_NONE

        if baseline_union is not None:
            gap_fill_buffer = float(group.get("gap_fill_buffer", config.get("gap_fill_width", config.get("shore_seal_width", 0.07))))
            proximity_band = donor_union.buffer(gap_fill_buffer)
            baseline_gap = normalize_polygonal(
                baseline_union.intersection(proximity_band).difference(donor_union.buffer(gap_fill_buffer * 0.45))
            )
            gap_parts: list[Polygon] = []
            if baseline_gap is not None:
                max_gap_area = float(group.get("gap_fill_max_area", config.get("gap_fill_max_area", 0.25)))
                min_gap_area = float(group.get("gap_fill_min_area", config.get("gap_fill_min_area", 0.00004)))
                for part in iter_polygon_parts(baseline_gap):
                    if float(part.area) < min_gap_area or float(part.area) > max_gap_area:
                        continue
                    gap_parts.append(part)
            if gap_parts:
                combined = safe_unary_union([combined, *gap_parts]) or combined
                join_mode = ATL_JOIN_MODE_GAP_FILL

            boolean_weld_distance = float(group.get("boolean_weld_distance", config.get("mainland_touch_tolerance", 0.035)))
            boolean_weld_width = float(group.get("boolean_weld_width", config.get("boolean_weld_width", 0.018)))
            if donor_union.distance(baseline_union) <= boolean_weld_distance:
                try:
                    welded = smooth_polygonal(
                        safe_unary_union([combined, baseline_union]).buffer(boolean_weld_width).buffer(-boolean_weld_width),
                        simplify_tolerance=simplify_tolerance,
                    )
                except ValueError:
                    welded = normalize_polygonal(safe_unary_union([combined, baseline_union]))
                if welded is not None:
                    combined = welded
                    join_mode = ATL_JOIN_MODE_BOOLEAN_WELD

        combined = normalize_polygonal(combined.intersection(group_aoi))
        if combined is None:
            continue
        try:
            combined = smooth_polygonal(combined, simplify_tolerance=simplify_tolerance)
        except ValueError:
            combined = normalize_polygonal(combined)
        if combined is None:
            continue

        owner_tag = normalize_tag(group.get("owner_tag")) or assign_owner_from_nearest_rows(combined, matched_rows)
        donor_state_name_set = sorted({
            str(value).strip()
            for row in matched_rows
            for value in row.get("donor_state_names", [])
            if str(value).strip()
        })
        donor_province_ids = sorted({
            int(value)
            for row in matched_rows
            for value in row.get("donor_province_ids", [])
        })
        rebuilt_rows.append(make_atl_row(
            feature_id=f"ATLISL_{region_id}_{str(group.get('id') or 'island').strip().lower()}",
            name=f"{str(group.get('label') or config['group_label']).strip()} Rebuilt Island",
            geometry=combined,
            region_id=region_id,
            config=config,
            assigned_owner_tag=owner_tag,
            geometry_role=ATL_GEOMETRY_ROLE_DONOR_ISLAND,
            donor_state_ids=sorted(donor_state_ids),
            donor_state_names=donor_state_name_set,
            donor_province_ids=donor_province_ids,
            join_mode=join_mode,
        ))
        used_row_ids.update(str(row.get("id") or "").strip() for row in matched_rows)

    remaining_rows = [row for row in island_rows if str(row.get("id") or "").strip() not in used_row_ids]
    return rebuilt_rows, remaining_rows


def merge_island_rows(region_id: str, config: dict, island_rows: list[dict]) -> list[dict]:
    if not island_rows:
        return []
    merge_distance = float(config.get("island_merge_distance", 0.0))
    if merge_distance <= 0:
        return island_rows

    merged_rows: list[dict] = []
    rows_by_owner: dict[str, list[dict]] = {}
    for row in island_rows:
        rows_by_owner.setdefault(normalize_tag(row.get("assigned_owner_tag")) or ATL_TAG, []).append(row)

    for owner_tag in sorted(rows_by_owner):
        owner_rows = rows_by_owner[owner_tag]
        buffered = safe_unary_union([row["geometry"].buffer(merge_distance / 2.0) for row in owner_rows])
        if buffered is None:
            continue
        debuffered = normalize_polygonal(buffered.buffer(-(merge_distance / 2.0)))
        candidate_geom = debuffered or safe_unary_union([row["geometry"] for row in owner_rows])
        if candidate_geom is None:
            continue
        parts = sorted(
            iter_polygon_parts(candidate_geom),
            key=lambda part: (round(part.centroid.x, 6), round(part.centroid.y, 6)),
        )
        for index, part in enumerate(parts, start=1):
            matched_rows = [
                row
                for row in owner_rows
                if normalize_polygonal(row["geometry"]) is not None
                and row["geometry"].intersects(part.buffer(merge_distance))
            ]
            donor_state_ids = sorted({int(value) for row in matched_rows for value in row.get("donor_state_ids", [])})
            donor_province_ids = sorted({int(value) for row in matched_rows for value in row.get("donor_province_ids", [])})
            donor_state_names = sorted({str(value).strip() for row in matched_rows for value in row.get("donor_state_names", []) if str(value).strip()})
            merged_rows.append(make_atl_row(
                feature_id=f"ATLISL_{region_id}_{owner_tag}_{index}",
                name=f"{config['group_label']} Island Cluster {index}",
                geometry=part,
                region_id=region_id,
                config=config,
                assigned_owner_tag=owner_tag,
                geometry_role=ATL_GEOMETRY_ROLE_DONOR_ISLAND,
                donor_state_ids=donor_state_ids,
                donor_state_names=donor_state_names,
                donor_province_ids=donor_province_ids,
                join_mode=ATL_JOIN_MODE_NONE,
            ))
    return merged_rows


def build_shore_seal_rows(region_id: str, config: dict, donor_rows: list[dict], mainland_union) -> list[dict]:
    seal_width = float(config.get("gap_fill_width", config.get("shore_seal_width", 0.0)))
    if seal_width <= 0 or mainland_union is None:
        return []
    joinable_island_state_ids = {int(value) for value in config.get("nearshore_island_join_state_ids", [])}
    seal_source_rows = [
        row
        for row in donor_rows
        if (
            row.get("atl_geometry_role") in {ATL_GEOMETRY_ROLE_DONOR_LAND, ATL_GEOMETRY_ROLE_CAUSEWAY}
            or (
                row.get("atl_geometry_role") == ATL_GEOMETRY_ROLE_DONOR_ISLAND
                and row_matches_donor_state_ids(row, joinable_island_state_ids)
            )
        )
    ]
    if not seal_source_rows:
        return []
    donor_union = safe_unary_union([row["geometry"] for row in seal_source_rows])
    if donor_union is None:
        return []
    aoi = box(*config["aoi_bbox"])
    seal_candidate = normalize_polygonal(
        donor_union.buffer(seal_width).intersection(mainland_union.buffer(seal_width))
    )
    if seal_candidate is None:
        return []
    seal_candidate = normalize_polygonal(
        seal_candidate.intersection(aoi).difference(donor_union).difference(mainland_union)
    )
    if seal_candidate is None:
        return []

    min_area = float(config.get("gap_fill_min_area", config.get("shore_seal_min_area", 0.0)))
    max_area = float(config.get("gap_fill_max_area", config.get("shore_seal_max_area", 0.12)))
    seal_rows: list[dict] = []
    for index, part in enumerate(iter_polygon_parts(seal_candidate), start=1):
        if float(part.area) < min_area or float(part.area) > max_area:
            continue
        try:
            smoothed = smooth_polygonal(part, buffer_radius=0.0035, simplify_tolerance=float(config.get("simplify_tolerance", 0.01)))
        except ValueError:
            smoothed = normalize_polygonal(part)
        if smoothed is None:
            continue
        owner_tag = assign_owner_from_nearest_rows(smoothed, seal_source_rows)
        donor_state_ids = sorted({int(value) for row in seal_source_rows if row["geometry"].distance(smoothed) < seal_width * 1.5 for value in row.get("donor_state_ids", [])})
        donor_province_ids = sorted({int(value) for row in seal_source_rows if row["geometry"].distance(smoothed) < seal_width * 1.5 for value in row.get("donor_province_ids", [])})
        donor_state_names = sorted({str(value).strip() for row in seal_source_rows if row["geometry"].distance(smoothed) < seal_width * 1.5 for value in row.get("donor_state_names", []) if str(value).strip()})
        seal_rows.append(make_atl_row(
            feature_id=f"ATLSHL_{region_id}_{index}",
            name=f"{config['group_label']} Shore Seal {index}",
            geometry=smoothed,
            region_id=region_id,
            config=config,
            assigned_owner_tag=owner_tag,
            geometry_role=ATL_GEOMETRY_ROLE_SHORE_SEAL,
            donor_state_ids=donor_state_ids,
            donor_state_names=donor_state_names,
            donor_province_ids=donor_province_ids,
            join_mode=ATL_JOIN_MODE_GAP_FILL,
        ))
    return seal_rows


def build_boolean_weld_rows(region_id: str, config: dict, donor_rows: list[dict], mainland_union) -> list[dict]:
    weld_width = float(config.get("boolean_weld_width", 0.0))
    if weld_width <= 0 or mainland_union is None:
        return []
    joinable_island_state_ids = {int(value) for value in config.get("nearshore_island_join_state_ids", [])}
    weld_source_rows = [
        row
        for row in donor_rows
        if (
            row.get("atl_geometry_role") in {ATL_GEOMETRY_ROLE_DONOR_LAND, ATL_GEOMETRY_ROLE_SHORE_SEAL}
            or (
                row.get("atl_geometry_role") == ATL_GEOMETRY_ROLE_DONOR_ISLAND
                and row_matches_donor_state_ids(row, joinable_island_state_ids)
            )
        )
    ]
    if not weld_source_rows:
        return []
    donor_union = safe_unary_union([row["geometry"] for row in weld_source_rows])
    if donor_union is None:
        return []
    aoi = box(*config["aoi_bbox"])
    try:
        closed = smooth_polygonal(
            safe_unary_union([donor_union, mainland_union]).buffer(weld_width).buffer(-weld_width),
            simplify_tolerance=float(config.get("simplify_tolerance", 0.01)),
        )
    except ValueError:
        closed = normalize_polygonal(safe_unary_union([donor_union, mainland_union]))
    if closed is None:
        return []
    weld_candidate = normalize_polygonal(
        closed.intersection(aoi).difference(donor_union).difference(mainland_union)
    )
    if weld_candidate is None:
        return []

    min_area = float(config.get("boolean_weld_min_area", 0.0))
    max_area = float(config.get("boolean_weld_max_area", 0.08))
    weld_rows: list[dict] = []
    for index, part in enumerate(iter_polygon_parts(weld_candidate), start=1):
        if float(part.area) < min_area or float(part.area) > max_area:
            continue
        if not part.intersects(donor_union.buffer(weld_width)) or not part.intersects(mainland_union.buffer(weld_width)):
            continue
        try:
            smoothed = smooth_polygonal(part, buffer_radius=0.0025, simplify_tolerance=float(config.get("simplify_tolerance", 0.01)))
        except ValueError:
            smoothed = normalize_polygonal(part)
        if smoothed is None:
            continue
        owner_tag = assign_owner_from_nearest_rows(smoothed, weld_source_rows)
        donor_state_ids = sorted({int(value) for row in weld_source_rows if row["geometry"].distance(smoothed) < weld_width * 2.0 for value in row.get("donor_state_ids", [])})
        donor_province_ids = sorted({int(value) for row in weld_source_rows if row["geometry"].distance(smoothed) < weld_width * 2.0 for value in row.get("donor_province_ids", [])})
        donor_state_names = sorted({str(value).strip() for row in weld_source_rows if row["geometry"].distance(smoothed) < weld_width * 2.0 for value in row.get("donor_state_names", []) if str(value).strip()})
        weld_rows.append(make_atl_row(
            feature_id=f"ATLWLD_{region_id}_{index}",
            name=f"{config['group_label']} Boolean Weld {index}",
            geometry=smoothed,
            region_id=region_id,
            config=config,
            assigned_owner_tag=owner_tag,
            geometry_role=ATL_GEOMETRY_ROLE_SHORE_SEAL,
            donor_state_ids=donor_state_ids,
            donor_state_names=donor_state_names,
            donor_province_ids=donor_province_ids,
            join_mode=ATL_JOIN_MODE_BOOLEAN_WELD,
        ))
    return weld_rows


def count_small_polygon_parts(geoms: list[object], *, max_area: float) -> int:
    threshold = max(0.0, float(max_area))
    if threshold <= 0:
        return 0
    count = 0
    for geom in geoms:
        for part in iter_polygon_parts(geom):
            if float(part.area) <= threshold:
                count += 1
    return count


def build_atl_sea_completion_rows(
    region_id: str,
    config: dict,
    *,
    expected_sea_geom,
    existing_sea_geom,
    occupied_sea_geom,
) -> tuple[list[dict], object | None, dict]:
    completion_rows: list[dict] = []
    expected = normalize_polygonal(expected_sea_geom)
    if expected is None:
        return completion_rows, None, {
            "completion_feature_count": 0,
            "remaining_hole_count": 0,
            "remaining_hole_area": 0.0,
        }
    occupied = normalize_polygonal(occupied_sea_geom)
    completion_candidate = expected if occupied is None else normalize_polygonal(expected.difference(occupied.buffer(0.0004)))
    completion_union = None
    if completion_candidate is not None:
        min_area = max(
            float(config.get("pixel_fragment_area_threshold", 0.0025)) * 0.08,
            0.00002,
        )
        simplify_tolerance = float(
            config.get("precision_simplify_tolerance", config.get("simplify_tolerance", 0.01))
        )
        completion_parts: list[Polygon] = []
        for part in iter_polygon_parts(completion_candidate):
            if float(part.area) < min_area:
                continue
            try:
                smoothed = smooth_polygonal(part, buffer_radius=0.0015, simplify_tolerance=simplify_tolerance)
            except ValueError:
                smoothed = normalize_polygonal(part)
            if smoothed is None:
                continue
            completion_parts.extend(iter_polygon_parts(smoothed))
        completion_union = safe_unary_union(completion_parts)
        for index, part in enumerate(completion_parts, start=1):
            completion_rows.append(make_feature(part, {
                "id": f"ATLSEA_FILL_{region_id}_{index}",
                "name": f"{config['group_label']} Sea Completion {index}",
                "cntr_code": ATL_TAG,
                "admin1_group": f"{config['feature_group_id']}_sea",
                "detail_tier": "scenario_atlantropa",
                "__source": ATL_SOURCE_TAG,
                "scenario_id": SCENARIO_ID,
                "region_id": region_id,
                "region_group": f"{config['feature_group_id']}_sea",
                "atl_surface_kind": ATL_SURFACE_SEA,
                "atl_region_group": f"mediterranean_remaining_{region_id}",
                "atl_geometry_role": ATL_GEOMETRY_ROLE_SEA_COMPLETION,
                "atl_join_mode": ATL_JOIN_MODE_GAP_FILL,
                "atl_subbasin_id": f"{region_id}_fill_{index}",
                "interactive": False,
                "render_as_base_geography": False,
                "owner_tag": ATL_TAG,
                "synthetic_owner": True,
                "source_standard": "mediterranean_template_sea_completion",
            }))
    final_union = expected if completion_union is None and existing_sea_geom is None else safe_unary_union([
        geom for geom in [normalize_polygonal(existing_sea_geom), completion_union] if geom is not None
    ])
    remaining_holes = None
    if final_union is not None:
        remaining_holes = normalize_polygonal(expected.difference(final_union.buffer(0.00025)))
    significant_remaining_holes = []
    if remaining_holes is not None:
        significant_remaining_holes = [
            part for part in iter_polygon_parts(remaining_holes)
            if float(part.area) >= min_area
        ]
    diagnostics = {
        "completion_feature_count": len(completion_rows),
        "completion_area": round(float(completion_union.area), 6) if completion_union is not None else 0.0,
        "remaining_hole_count": len(significant_remaining_holes),
        "remaining_hole_area": round(
            sum(float(part.area) for part in significant_remaining_holes),
            6,
        ),
    }
    return completion_rows, completion_union, diagnostics


def collect_baseline_island_drop_ids(
    political_gdf: gpd.GeoDataFrame,
    replacement_specs: dict[str, dict],
) -> tuple[set[str], dict[str, dict]]:
    drop_ids: set[str] = set()
    diagnostics: dict[str, dict] = {}
    for region_id, spec in replacement_specs.items():
        donor_island_union = spec.get("donor_island_union")
        mainland_union = spec.get("mainland_union")
        if donor_island_union is None or mainland_union is None:
            diagnostics[region_id] = {
                "dropped_feature_count": 0,
                "dropped_feature_ids": [],
            }
            continue
        aoi = box(*spec["aoi_bbox"])
        local = political_gdf.loc[political_gdf.intersects(aoi)].copy().reset_index(drop=True)
        replace_buffer = float(spec.get("replace_buffer", 0.03))
        touch_tolerance = float(spec.get("touch_tolerance", 0.035))
        region_drop_ids: list[str] = []
        for row in local.to_dict("records"):
            feature_id = str(row.get("id") or "").strip()
            geom = normalize_polygonal(row.get("geometry"))
            if not feature_id or geom is None:
                continue
            if not geom.intersects(donor_island_union.buffer(replace_buffer)):
                continue
            if geom.intersects(mainland_union.buffer(touch_tolerance)):
                continue
            drop_ids.add(feature_id)
            region_drop_ids.append(feature_id)
        diagnostics[region_id] = {
            "dropped_feature_count": len(region_drop_ids),
            "dropped_feature_ids": sorted(region_drop_ids)[:200],
        }
    return drop_ids, diagnostics


def build_congo_lake_geometry(key_image: np.ndarray, province_type_by_id: dict[int, str], rgb_key_to_id: dict[int, int]):
    min_x, min_y, max_x, max_y = CONGO_LAKE_SEARCH_BBOX
    province_ids = np.vectorize(lambda value: rgb_key_to_id.get(int(value), -1), otypes=[np.int32])(
        key_image[min_y : max_y + 1, min_x : max_x + 1]
    )
    lake_ids = {province_id for province_id, province_type in province_type_by_id.items() if province_type == "lake"}
    adjacency: dict[int, set[int]] = {province_id: set() for province_id in lake_ids}
    right_pairs = np.stack([province_ids[:, :-1], province_ids[:, 1:]], axis=-1).reshape(-1, 2)
    down_pairs = np.stack([province_ids[:-1, :], province_ids[1:, :]], axis=-1).reshape(-1, 2)
    for left, right in np.vstack([right_pairs, down_pairs]):
        if left == right or left not in lake_ids or right not in lake_ids:
            continue
        adjacency[int(left)].add(int(right))
        adjacency[int(right)].add(int(left))

    component_ids = set(CONGO_LAKE_SEED_IDS)
    queue = deque(CONGO_LAKE_SEED_IDS)
    while queue:
        current = queue.popleft()
        for neighbor in adjacency.get(current, ()):
            if neighbor in component_ids:
                continue
            component_ids.add(neighbor)
            queue.append(neighbor)

    component_mask = np.isin(province_ids, np.array(sorted(component_ids), dtype=np.int32))
    ys, xs = np.where(component_mask)
    cropped = component_mask[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    source_geom = polygonize_mask(cropped)
    source_geom = smooth_polygonal(source_geom, buffer_radius=1.4, simplify_tolerance=0.62)
    lake_geom = fit_geometry_to_bbox(source_geom, CONGO_LAKE_TARGET_BBOX, simplify_tolerance=0.03)
    lake_geom = smooth_polygonal(lake_geom, buffer_radius=0.035, simplify_tolerance=0.02)
    return lake_geom, sorted(component_ids)


def fit_geometry_to_bbox(
    geom,
    target_bbox: tuple[float, float, float, float],
    *,
    simplify_tolerance: float = 0.0,
):
    source_min_x, source_min_y, source_max_x, source_max_y = geom.bounds
    target_min_x, target_min_y, target_max_x, target_max_y = target_bbox
    scale_x = (target_max_x - target_min_x) / max(1e-9, source_max_x - source_min_x)
    scale_y = (target_max_y - target_min_y) / max(1e-9, source_max_y - source_min_y)
    fitted = affinity.translate(geom, xoff=-source_min_x, yoff=-source_min_y)
    fitted = affinity.scale(fitted, xfact=scale_x, yfact=scale_y, origin=(0, 0))
    fitted = affinity.translate(fitted, xoff=target_min_x, yoff=target_min_y)
    return smooth_polygonal(fitted, simplify_tolerance=simplify_tolerance)


def load_reichskommissariat_companion_actions() -> dict[tuple[str, str], dict]:
    payload = load_json(REICHSKOMMISSARIAT_ACTIONS_PATH)
    actions: dict[tuple[str, str], dict] = {}
    for entry in payload.get("entries", []):
        owner_tag = normalize_tag(entry.get("tag"))
        for action in entry.get("companion_actions", []):
            action_id = str(action.get("id") or "").strip()
            if not owner_tag or not action_id:
                continue
            actions[(owner_tag, action_id)] = {
                "target_owner_tag": normalize_tag(action.get("target_owner_tag")),
                "feature_ids": [str(feature_id).strip() for feature_id in action.get("include_feature_ids", []) if str(feature_id).strip()],
                "hidden_in_ui": bool(action.get("hidden_in_ui")),
                "auto_apply_on_core_territory": bool(action.get("auto_apply_on_core_territory")),
            }
    return actions


def load_releasable_source_entry(tag: str) -> dict:
    normalized_tag = normalize_tag(tag)
    payload = load_json(RELEASABLE_SOURCE_PATH)
    for entry in payload.get("entries", []):
        if normalize_tag(entry.get("tag")) == normalized_tag:
            return copy.deepcopy(entry)
    raise ValueError(f"Unable to locate releasable source entry for {normalized_tag}.")


def resolve_feature_ids_from_preset_source(preset_source: dict | None) -> list[str]:
    if not isinstance(preset_source, dict):
        return []
    source_type = str(preset_source.get("type") or "").strip()
    if source_type != "feature_ids":
        raise ValueError(f"Unsupported preset_source type for TNO baseline patching: {source_type!r}")
    return [str(feature_id).strip() for feature_id in preset_source.get("feature_ids", []) if str(feature_id).strip()]


def resolve_boundary_variant(entry: dict, variant_id: str) -> dict:
    normalized_variant_id = str(variant_id or "").strip().lower()
    for variant in entry.get("boundary_variants", []):
        if str(variant.get("id") or "").strip().lower() == normalized_variant_id:
            return copy.deepcopy(variant)
    raise ValueError(
        f"Unable to locate boundary variant {variant_id!r} for releasable {normalize_tag(entry.get('tag'))}."
    )


def assign_feature_bundle(
    *,
    feature_ids: list[str],
    target_tag: str,
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
) -> list[str]:
    normalized_target = normalize_tag(target_tag)
    applied_feature_ids: list[str] = []
    for raw_feature_id in feature_ids:
        feature_id = str(raw_feature_id).strip()
        if not feature_id:
            continue
        owners_payload["owners"][feature_id] = normalized_target
        controllers_payload["controllers"][feature_id] = normalized_target
        set_feature_core_tags(cores_payload["cores"], feature_id, [normalized_target])
        applied_feature_ids.append(feature_id)
    return applied_feature_ids


def patch_tno_europe_baseline(
    countries_payload: dict,
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
) -> dict[str, list[str]]:
    countries = countries_payload.setdefault("countries", {})
    palette_entries = load_palette_entries(TNO_PALETTE_PATH)
    applied: dict[str, list[str]] = {}
    brg_source_entry = load_releasable_source_entry("BRG")
    brg_default_variant_id = str(brg_source_entry.get("default_boundary_variant_id") or "current_tno_initial").strip()
    brg_selected_variant = resolve_boundary_variant(brg_source_entry, brg_default_variant_id)
    brg_feature_ids = resolve_feature_ids_from_preset_source(brg_selected_variant.get("preset_source"))

    applied["crimea_to_ger"] = assign_feature_bundle(
        feature_ids=CRIMEA_TO_GER_FEATURE_IDS,
        target_tag="GER",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["scotland_to_sco"] = assign_feature_bundle(
        feature_ids=TNO_1962_SCOTLAND_FEATURE_IDS,
        target_tag="SCO",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["wales_to_wls"] = assign_feature_bundle(
        feature_ids=TNO_1962_WALES_FEATURE_IDS,
        target_tag="WLS",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["northern_ireland_to_ire"] = assign_feature_bundle(
        feature_ids=TNO_1962_NORTHERN_IRELAND_FEATURE_IDS,
        target_tag="IRE",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["british_outposts_to_ger"] = assign_feature_bundle(
        feature_ids=TNO_1962_GERMAN_BRITISH_FEATURE_IDS,
        target_tag="GER",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["burgundy_to_brg"] = assign_feature_bundle(
        feature_ids=brg_feature_ids,
        target_tag="BRG",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["armenia_to_arm"] = assign_feature_bundle(
        feature_ids=TNO_1962_ARMENIA_FEATURE_IDS,
        target_tag="ARM",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )
    applied["brittany_to_fra"] = assign_feature_bundle(
        feature_ids=TNO_1962_BRITTANY_FEATURE_IDS,
        target_tag="FRA",
        owners_payload=owners_payload,
        controllers_payload=controllers_payload,
        cores_payload=cores_payload,
    )

    countries["SCO"] = build_manual_country_entry(
        tag="SCO",
        existing_entry=countries.get("SCO"),
        palette_entries=palette_entries,
        feature_count=len(TNO_1962_SCOTLAND_FEATURE_IDS),
        continent_id="continent_europe",
        continent_label="Europe",
        subregion_id="subregion_northern_europe",
        subregion_label="Northern Europe",
        base_iso2="GB",
        lookup_iso2="GB",
        provenance_iso2="GB",
        color_hex="#e8e800",
        notes="TNO 1962 baseline independent Scotland after the partition of Britain.",
    )
    countries["WLS"] = build_manual_country_entry(
        tag="WLS",
        existing_entry=countries.get("WLS"),
        palette_entries=palette_entries,
        feature_count=len(TNO_1962_WALES_FEATURE_IDS),
        continent_id="continent_europe",
        continent_label="Europe",
        subregion_id="subregion_northern_europe",
        subregion_label="Northern Europe",
        base_iso2="GB",
        lookup_iso2="GB",
        provenance_iso2="GB",
        color_hex="#ff0000",
        notes="TNO 1962 baseline independent Wales after the partition of Britain.",
    )
    countries["ARM"] = build_manual_country_entry(
        tag="ARM",
        existing_entry=countries.get("ARM"),
        palette_entries=palette_entries,
        feature_count=len(TNO_1962_ARMENIA_FEATURE_IDS),
        continent_id="continent_asia",
        continent_label="Asia",
        subregion_id="subregion_western_asia",
        subregion_label="Western Asia",
        base_iso2="AM",
        lookup_iso2="AM",
        provenance_iso2="AM",
        color_hex="#b066b4",
        notes="TNO 1962 baseline independent Armenia released from Reichskommissariat Kaukasien.",
    )
    countries.pop("BRI", None)
    countries["BRG"] = build_manual_country_entry(
        tag="BRG",
        existing_entry=countries.get("BRG") or countries.get("RKB"),
        palette_entries=palette_entries,
        feature_count=len(brg_feature_ids),
        continent_id="continent_europe",
        continent_label="Europe",
        subregion_id="subregion_western_europe",
        subregion_label="Western Europe",
        base_iso2="BE",
        lookup_iso2="BE",
        provenance_iso2="BE",
        display_name="Ordensstaat Burgund",
        color_hex="#1a1a1a",
        rule_id="tno_1962_brg_baseline",
        notes="TNO 1962 baseline Burgundy replacing Reichskommissariat Belgien-Nordfrankreich.",
        entry_kind="scenario_country",
        parent_owner_tag="GER",
    )
    countries["BRG"]["release_lookup_iso2"] = "BE"
    countries["BRG"]["default_boundary_variant_id"] = brg_default_variant_id
    countries["BRG"]["selected_boundary_variant_id"] = str(brg_selected_variant.get("id") or "").strip()
    countries["BRG"]["selected_boundary_variant_label"] = str(brg_selected_variant.get("label") or "").strip()
    countries["BRG"]["selected_boundary_variant_description"] = str(
        brg_selected_variant.get("description") or ""
    ).strip()
    countries["BRG"]["boundary_variants"] = copy.deepcopy(brg_source_entry.get("boundary_variants", []))
    countries["BRG"]["companion_actions"] = copy.deepcopy(brg_source_entry.get("companion_actions", []))
    countries.pop("RKB", None)

    rkk_entry = countries.get("RKK")
    if not isinstance(rkk_entry, dict):
        raise ValueError("RKK entry not found in tno_1962 countries.")
    rkk_entry["continent_id"] = "continent_asia"
    rkk_entry["continent_label"] = "Asia"
    rkk_entry["subregion_id"] = "subregion_western_asia"
    rkk_entry["subregion_label"] = "Western Asia"

    return applied


def patch_baseline_maps(owners_payload: dict, controllers_payload: dict, cores_payload: dict) -> dict[str, list[str]]:
    action_map = load_reichskommissariat_companion_actions()
    action_specs = {
        "annexed_poland_to_ger": ("RKP", "annexed_poland_to_ger", "GER"),
        "ostland_marijampole_to_ger": ("RKO", "ostland_marijampole_to_ger", "GER"),
        "transnistria_to_rom": ("RKU", "transnistria_to_rom", "ROM"),
        "greater_finland_to_fin": ("RKM", "greater_finland_to_fin", "FIN"),
    }
    applied: dict[str, list[str]] = {}
    combined_german_features: list[str] = []

    for action_id, (source_tag, lookup_id, target_tag) in action_specs.items():
        action = action_map.get((source_tag, lookup_id))
        if not action or not action["feature_ids"]:
            raise ValueError(f"Unable to load action feature ids for {source_tag}/{lookup_id}.")
        applied[action_id] = action["feature_ids"]
        for feature_id in action["feature_ids"]:
            owners_payload["owners"][feature_id] = target_tag
            controllers_payload["controllers"][feature_id] = target_tag
            set_feature_core_tags(cores_payload["cores"], feature_id, [target_tag])
        if target_tag == "GER":
            combined_german_features.extend(action["feature_ids"])

    for feature_ids in GER_PRESET_FEATURE_IDS.values():
        combined_german_features.extend(feature_ids)
    for feature_id in combined_german_features:
        owners_payload["owners"][feature_id] = "GER"
        controllers_payload["controllers"][feature_id] = "GER"
        set_feature_core_tags(cores_payload["cores"], feature_id, ["GER"])

    applied["italy_french_baseline_restored"] = list(TNO_1962_ITALY_REMOVED_FRENCH_BASELINE_TARGETS.keys())
    for feature_id, target_tag in TNO_1962_ITALY_REMOVED_FRENCH_BASELINE_TARGETS.items():
        owners_payload["owners"][feature_id] = target_tag
        controllers_payload["controllers"][feature_id] = target_tag
        set_feature_core_tags(cores_payload["cores"], feature_id, [target_tag])

    return applied


def collect_feature_ids_for_owner_tag(owners_payload: dict, owner_tag: str) -> list[str]:
    normalized_tag = str(owner_tag or "").strip().upper()
    if not normalized_tag:
        return []
    owner_map = owners_payload.get("owners", {}) if isinstance(owners_payload, dict) else {}
    feature_ids = [
        str(feature_id).strip()
        for feature_id, tag in owner_map.items()
        if str(tag or "").strip().upper() == normalized_tag and str(feature_id).strip()
    ]
    return sorted(set(feature_ids))


def build_germany_regional_presets(owners_payload: dict) -> list[dict[str, object]]:
    presets: list[dict[str, object]] = []
    for spec in GER_TNO_1962_REGIONAL_PRESET_SPECS:
        feature_ids = collect_feature_ids_for_owner_tag(owners_payload, str(spec.get("owner_tag") or ""))
        if not feature_ids:
            raise ValueError(f"Unable to resolve TNO 1962 Germany regional preset: {spec!r}")
        presets.append({
            "name": str(spec.get("name") or "").strip(),
            "ids": feature_ids,
        })
    return presets


def patch_germany_metadata(countries_payload: dict, owners_payload: dict) -> None:
    ger_entry = countries_payload.get("countries", {}).get("GER")
    if not ger_entry:
        raise ValueError("GER entry not found in tno_1962 countries.")
    ger_entry["disabled_regional_preset_names"] = list(GER_DISABLED_PRESET_NAMES)
    ger_entry["disabled_regional_preset_reason"] = "Replaced by TNO 1962 regional presets"
    ger_entry["regional_presets"] = build_germany_regional_presets(owners_payload)


def patch_italy_metadata(countries_payload: dict) -> None:
    ita_entry = countries_payload.get("countries", {}).get("ITA")
    if not ita_entry:
        raise ValueError("ITA entry not found in tno_1962 countries.")
    ita_entry["disabled_regional_preset_names"] = list(TNO_1962_ITALY_DISABLED_PRESET_NAMES)
    ita_entry["disabled_regional_preset_reason"] = "Already applied in scenario baseline"


def apply_tno_feature_assignment_overrides(
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
    scenario_political_gdf: gpd.GeoDataFrame | None = None,
) -> dict[str, object]:
    override_map: dict[str, str] = {}
    for raw_tag, feature_ids in TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES.items():
        tag = normalize_tag(raw_tag)
        if not tag:
            continue
        for raw_feature_id in feature_ids:
            feature_id = str(raw_feature_id or "").strip()
            if not feature_id:
                continue
            existing = override_map.get(feature_id)
            if existing and existing != tag:
                raise ValueError(f"Conflicting manual assignment override for {feature_id}: {existing} vs {tag}")
            override_map[feature_id] = tag

    known_feature_ids = {
        str(feature_id).strip()
        for payload_key, payload in (
            ("owners", owners_payload),
            ("controllers", controllers_payload),
            ("cores", cores_payload),
        )
        for feature_id in payload.get(payload_key, {}).keys()
    }
    if scenario_political_gdf is not None and not scenario_political_gdf.empty:
        known_feature_ids.update(
            str(feature_id).strip()
            for feature_id in scenario_political_gdf["id"].astype(str).tolist()
            if str(feature_id).strip()
        )

    missing_feature_ids = sorted(
        feature_id for feature_id in override_map
        if feature_id not in known_feature_ids
    )
    if missing_feature_ids:
        preview = ", ".join(missing_feature_ids[:10])
        raise ValueError(
            f"TNO 1962 feature assignment overrides reference unknown feature ids: {preview}"
        )
    if scenario_political_gdf is not None and not scenario_political_gdf.empty:
        shell_fragment_override_ids = sorted(
            feature_id
            for feature_id in override_map
            if feature_id in {
                str(row.get("id") or "").strip()
                for row in scenario_political_gdf.to_dict("records")
                if is_runtime_shell_fragment_row(row)
            }
        )
        if shell_fragment_override_ids:
            preview = ", ".join(shell_fragment_override_ids[:10])
            raise ValueError(
                "TNO 1962 feature assignment overrides cannot target runtime shell fragments: "
                f"{preview}"
            )

    owners = owners_payload.setdefault("owners", {})
    controllers = controllers_payload.setdefault("controllers", {})
    cores = cores_payload.setdefault("cores", {})
    for feature_id, tag in override_map.items():
        owners[feature_id] = tag
        controllers[feature_id] = tag
        set_feature_core_tags(cores, feature_id, [tag])

    if scenario_political_gdf is not None and not scenario_political_gdf.empty:
        id_series = scenario_political_gdf["id"].fillna("").astype(str).str.strip()
        mask = id_series.isin(override_map)
        if mask.any():
            scenario_political_gdf.loc[mask, "cntr_code"] = id_series.loc[mask].map(override_map)

    return {
        "feature_count": len(override_map),
        "by_tag": {
            tag: sorted(feature_ids)
            for tag, feature_ids in sorted(TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES.items())
        },
    }


def apply_tno_greece_coarse_owner_backfill(
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
    scenario_political_gdf: gpd.GeoDataFrame | None = None,
) -> dict[str, object]:
    owners = owners_payload.setdefault("owners", {})
    controllers = controllers_payload.setdefault("controllers", {})
    cores = cores_payload.setdefault("cores", {})
    runtime_feature_ids: set[str] = set()
    if scenario_political_gdf is not None and not scenario_political_gdf.empty:
        runtime_feature_ids = {
            str(feature_id).strip()
            for feature_id in scenario_political_gdf["id"].astype(str).tolist()
            if str(feature_id).strip()
        }

    applied: dict[str, str] = {}
    for feature_id, owner_tag in TNO_1962_GREECE_COARSE_OWNER_BACKFILL.items():
        if runtime_feature_ids and feature_id not in runtime_feature_ids:
            raise ValueError(f"TNO Greece coarse owner backfill references missing runtime feature id: {feature_id}")
        controller_tag = normalize_tag(controllers.get(feature_id))
        if not controller_tag:
            raise ValueError(f"TNO Greece coarse owner backfill requires controller tag for {feature_id}")
        if controller_tag != owner_tag:
            raise ValueError(
                f"TNO Greece coarse owner backfill disagrees with controller tag for {feature_id}: "
                f"{controller_tag} vs {owner_tag}"
            )
        core_tags = normalize_core_tags(cores.get(feature_id))
        if not core_tags:
            raise ValueError(f"TNO Greece coarse owner backfill requires core tags for {feature_id}")
        if owner_tag not in core_tags:
            raise ValueError(
                f"TNO Greece coarse owner backfill disagrees with core tags for {feature_id}: "
                f"{core_tags} vs {owner_tag}"
            )
        owners[feature_id] = owner_tag
        applied[feature_id] = owner_tag

    return {
        "feature_count": len(applied),
        "by_tag": {
            tag: sorted(feature_id for feature_id, applied_tag in applied.items() if applied_tag == tag)
            for tag in sorted(set(applied.values()))
        },
    }


def apply_tno_owner_only_backfill(
    owners_payload: dict,
    scenario_political_gdf: gpd.GeoDataFrame | None = None,
) -> dict[str, object]:
    runtime_feature_ids: set[str] = set()
    shell_fragment_ids: set[str] = set()
    if scenario_political_gdf is not None and not scenario_political_gdf.empty:
        scenario_rows = scenario_political_gdf.to_dict("records")
        runtime_feature_ids = {
            str(row.get("id") or "").strip()
            for row in scenario_rows
            if str(row.get("id") or "").strip()
        }
        shell_fragment_ids = {
            str(row.get("id") or "").strip()
            for row in scenario_rows
            if is_runtime_shell_fragment_row(row) and str(row.get("id") or "").strip()
        }
        missing_feature_ids = sorted(
            feature_id for feature_id in TNO_1962_OWNER_ONLY_BACKFILL if feature_id not in runtime_feature_ids
        )
        if missing_feature_ids:
            preview = ", ".join(missing_feature_ids[:10])
            raise ValueError(f"TNO owner-only backfill references missing runtime feature id: {preview}")
        shell_fragment_override_ids = sorted(
            feature_id for feature_id in TNO_1962_OWNER_ONLY_BACKFILL if feature_id in shell_fragment_ids
        )
        if shell_fragment_override_ids:
            preview = ", ".join(shell_fragment_override_ids[:10])
            raise ValueError(
                "TNO owner-only backfill cannot target runtime shell fragments: "
                f"{preview}"
            )

    owners = owners_payload.setdefault("owners", {})
    for feature_id, owner_tag in TNO_1962_OWNER_ONLY_BACKFILL.items():
        owners[feature_id] = owner_tag

    if scenario_political_gdf is not None and not scenario_political_gdf.empty:
        id_series = scenario_political_gdf["id"].fillna("").astype(str).str.strip()
        mask = id_series.isin(TNO_1962_OWNER_ONLY_BACKFILL)
        if mask.any():
            scenario_political_gdf.loc[mask, "cntr_code"] = id_series.loc[mask].map(TNO_1962_OWNER_ONLY_BACKFILL)

    return {
        "feature_count": len(TNO_1962_OWNER_ONLY_BACKFILL),
        "by_tag": {
            tag: sorted(
                feature_id
                for feature_id, applied_tag in TNO_1962_OWNER_ONLY_BACKFILL.items()
                if applied_tag == tag
            )
            for tag in sorted(set(TNO_1962_OWNER_ONLY_BACKFILL.values()))
        },
    }


def load_runtime_political_gdf() -> gpd.GeoDataFrame:
    topology_payload = load_json(RUNTIME_POLITICAL_PATH)
    runtime_gdf = topology_object_to_gdf(topology_payload, "political")
    if runtime_gdf.empty:
        raise ValueError("Base runtime political topology contains zero features.")
    for column in ("id", "name", "cntr_code", "admin1_group", "detail_tier", "__source"):
        if column not in runtime_gdf.columns:
            runtime_gdf[column] = ""
    runtime_gdf["id"] = runtime_gdf["id"].fillna("").astype(str).str.strip()
    runtime_gdf["name"] = runtime_gdf["name"].fillna("").astype(str).str.strip()
    runtime_gdf["cntr_code"] = runtime_gdf["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    runtime_gdf["admin1_group"] = runtime_gdf["admin1_group"].fillna("").astype(str)
    runtime_gdf["detail_tier"] = runtime_gdf["detail_tier"].fillna("").astype(str)
    runtime_gdf["__source"] = runtime_gdf["__source"].fillna("").astype(str)
    runtime_gdf = runtime_gdf[runtime_gdf.geometry.notna() & ~runtime_gdf.geometry.is_empty].copy()
    runtime_gdf = runtime_gdf.reset_index(drop=True)
    if runtime_gdf["id"].duplicated().any():
        raise ValueError("Base runtime political topology has duplicate feature ids.")
    return runtime_gdf


def cut_political_features(
    political_gdf: gpd.GeoDataFrame,
    cut_geom,
) -> tuple[gpd.GeoDataFrame, dict[str, str]]:
    rows: list[dict] = []
    source_feature_id_by_new_id: dict[str, str] = {}
    cut_union = normalize_polygonal(cut_geom)
    if cut_union is None:
        raise ValueError("Expected non-empty cut geometry.")

    for row in political_gdf.to_dict("records"):
        feature_id = str(row.get("id") or "").strip()
        geom = normalize_polygonal(row.get("geometry"))
        if not feature_id or geom is None:
            continue
        parts = [geom]
        if geom.intersects(cut_union):
            diff = normalize_polygonal(geom.difference(cut_union))
            parts = iter_polygon_parts(diff)
        if not parts:
            continue
        for index, part in enumerate(parts, start=1):
            new_id = feature_id if len(parts) == 1 else f"{feature_id}__tno1962_{index}"
            next_row = {
                "id": new_id,
                "name": str(row.get("name") or feature_id).strip() or feature_id,
                "cntr_code": str(row.get("cntr_code") or "").strip().upper(),
                "admin1_group": str(row.get("admin1_group") or "").strip(),
                "detail_tier": str(row.get("detail_tier") or "").strip(),
                "__source": str(row.get("__source") or "").strip() or "runtime",
                "geometry": part,
            }
            rows.append(next_row)
            source_feature_id_by_new_id[new_id] = feature_id

    out = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    out = out.reset_index(drop=True)
    if out["id"].duplicated().any():
        raise ValueError("Scenario political topology contains duplicate feature ids after cutting.")
    return out, source_feature_id_by_new_id


def canonicalize_feature_code_map(feature_map: dict[str, str]) -> dict[str, str]:
    canonical: dict[str, str] = {}
    for raw_feature_id, raw_code in feature_map.items():
        feature_id = str(raw_feature_id).strip()
        code = str(raw_code).strip().upper()
        if not feature_id or not code:
            continue
        canonical[feature_id] = code
        source_feature_id = SCENARIO_SPLIT_SUFFIX_RE.sub("", feature_id)
        existing = canonical.get(source_feature_id)
        if existing and existing != code:
            raise ValueError(
                f"Conflicting canonical mapping for {source_feature_id}: {existing} vs {code}"
            )
        canonical[source_feature_id] = code
    return canonical


def score_assignment_candidates(
    target_geom,
    candidate_rows: list[dict],
    *,
    field_name: str,
    top_k: int = 8,
) -> str:
    if not candidate_rows:
        return ""
    target_point = target_geom.representative_point()
    scored: list[tuple[float, dict]] = []
    for row in candidate_rows:
        value = normalize_tag(row.get(field_name))
        geom = normalize_polygonal(row.get("geometry"))
        if not value or geom is None:
            continue
        distance = max(float(target_point.distance(geom.representative_point())), 1e-6)
        scored.append((distance, row))
    if not scored:
        return ""
    scored.sort(key=lambda item: item[0])
    top_rows = scored[:max(1, int(top_k))]
    weights: dict[str, float] = {}
    for distance, row in top_rows:
        value = normalize_tag(row.get(field_name))
        if not value:
            continue
        weights[value] = weights.get(value, 0.0) + (1.0 / distance)
    if not weights:
        return ""
    return max(weights.items(), key=lambda item: (item[1], item[0]))[0]


def build_restore_assignments(
    runtime_political_full_gdf: gpd.GeoDataFrame,
    source_owners: dict[str, str],
    source_controllers: dict[str, str],
    source_cores: dict[str, list[str]],
) -> tuple[gpd.GeoDataFrame, dict[str, dict[str, object]], dict[str, dict]]:
    source_feature_ids = {str(feature_id).strip() for feature_id in source_owners if str(feature_id).strip()}
    source_rows = runtime_political_full_gdf.loc[
        runtime_political_full_gdf["id"].isin(source_feature_ids)
    ].copy().reset_index(drop=True)
    restored_rows: list[dict] = []
    explicit_assignments: dict[str, dict[str, object]] = {}
    diagnostics: dict[str, dict] = {}
    seen_feature_ids: set[str] = set()

    source_records = source_rows.to_dict("records")
    source_with_assignment = []
    for row in source_records:
        feature_id = str(row.get("id") or "").strip()
        owner = normalize_tag(source_owners.get(feature_id))
        controller = normalize_tag(source_controllers.get(feature_id) or owner)
        core_tags = normalize_core_tags(source_cores.get(feature_id)) or ([owner] if owner else [])
        core = primary_core_tag(core_tags, fallback=owner)
        if not feature_id or not owner:
            continue
        source_with_assignment.append({
            **row,
            "owner_tag": owner,
            "controller_tag": controller,
            "core_tag": core,
            "core_tags": core_tags,
        })

    for restore_id, config in COASTAL_RESTORE_AOI_CONFIGS.items():
        aoi = box(*config["bbox"])
        local_all = runtime_political_full_gdf.loc[runtime_political_full_gdf.intersects(aoi)].copy().reset_index(drop=True)
        local_missing = local_all.loc[~local_all["id"].isin(source_feature_ids)].copy().reset_index(drop=True)
        local_source = [row for row in source_with_assignment if row.get("geometry") is not None and row["geometry"].intersects(aoi)]
        restored_count = 0
        assigned_tags: Counter[str] = Counter()
        unresolved_feature_ids: list[str] = []

        for row in local_missing.to_dict("records"):
            feature_id = str(row.get("id") or "").strip()
            if not feature_id or feature_id in seen_feature_ids:
                continue
            geom = normalize_polygonal(row.get("geometry"))
            if geom is None:
                continue
            cntr_code = normalize_tag(row.get("cntr_code"))
            same_code_candidates = [candidate for candidate in local_source if normalize_tag(candidate.get("cntr_code")) == cntr_code]
            owner_tag = score_assignment_candidates(geom, same_code_candidates, field_name="owner_tag")
            controller_tag = score_assignment_candidates(geom, same_code_candidates, field_name="controller_tag")
            core_tag = score_assignment_candidates(geom, same_code_candidates, field_name="core_tag")
            if not owner_tag:
                owner_tag = score_assignment_candidates(geom, local_source, field_name="owner_tag")
                controller_tag = controller_tag or score_assignment_candidates(geom, local_source, field_name="controller_tag")
                core_tag = core_tag or score_assignment_candidates(geom, local_source, field_name="core_tag")
            controller_tag = controller_tag or owner_tag
            core_tag = core_tag or owner_tag
            if not owner_tag:
                unresolved_feature_ids.append(feature_id)
                continue
            restored_rows.append(row)
            explicit_assignments[feature_id] = {
                "owner": owner_tag,
                "controller": controller_tag,
                "core": [core_tag] if core_tag else [owner_tag],
            }
            seen_feature_ids.add(feature_id)
            restored_count += 1
            assigned_tags[owner_tag] += 1

        diagnostics[restore_id] = {
            "label": config["label"],
            "bbox": list(config["bbox"]),
            "missing_feature_count": int(len(local_missing)),
            "restored_feature_count": int(restored_count),
            "assigned_owner_counts": dict(sorted(assigned_tags.items())),
            "unresolved_feature_ids": sorted(unresolved_feature_ids),
        }

    restore_gdf = gpd.GeoDataFrame(restored_rows, geometry="geometry", crs="EPSG:4326")
    if restore_gdf.crs is None:
        restore_gdf = restore_gdf.set_crs("EPSG:4326", allow_override=True)
    if not restore_gdf.empty:
        restore_gdf = restore_gdf.reset_index(drop=True)
    return restore_gdf, explicit_assignments, diagnostics


def build_single_antarctic_feature(
    runtime_political_full_gdf: gpd.GeoDataFrame,
) -> tuple[gpd.GeoDataFrame, dict[str, dict[str, object]], dict[str, object]]:
    aq_mask = runtime_political_full_gdf["cntr_code"].fillna("").astype(str).str.strip().str.upper() == "AQ"
    aq_rows = runtime_political_full_gdf.loc[aq_mask].copy().reset_index(drop=True)
    if aq_rows.empty:
        raise ValueError("Runtime political topology is missing Antarctic sector geometry.")

    antarctic_geom = normalize_polygonal(safe_unary_union(aq_rows.geometry.tolist()))
    if antarctic_geom is None or antarctic_geom.is_empty:
        raise ValueError("Antarctic sector union collapsed to empty geometry.")

    antarctic_gdf = gpd.GeoDataFrame(
        [{
            "id": "AQ",
            "name": "Antarctica",
            "cntr_code": "AQ",
            "admin1_group": "",
            "detail_tier": "",
            "__source": "scenario_runtime",
            "geometry": antarctic_geom,
        }],
        geometry="geometry",
        crs="EPSG:4326",
    )
    diagnostics = {
        "source_feature_ids": sorted(aq_rows["id"].astype(str).tolist()),
        "source_feature_count": int(len(aq_rows)),
        "union_part_count": int(len(iter_polygon_parts(antarctic_geom))),
    }
    explicit_assignments = {
        "AQ": {
            "owner": "AQ",
            "controller": "AQ",
            "core": ["AQ"],
        }
    }
    return antarctic_gdf, explicit_assignments, diagnostics


def build_runtime_shell_fragment_gdf(runtime_political_full_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    id_series = runtime_political_full_gdf["id"].fillna("").astype(str).str.strip()
    shell_gdf = runtime_political_full_gdf.loc[
        id_series.str.upper().str.startswith("RU_ARCTIC_FB_")
    ].copy().reset_index(drop=True)
    if shell_gdf.crs is None:
        shell_gdf = shell_gdf.set_crs("EPSG:4326", allow_override=True)
    if not shell_gdf.empty:
        shell_gdf["interactive"] = False
        shell_gdf["scenario_helper_kind"] = "shell_fallback"
        if "render_as_base_geography" not in shell_gdf.columns:
            shell_gdf["render_as_base_geography"] = False
    return shell_gdf


def load_existing_scenario_runtime_shell_fragment_gdf(scenario_dir: Path) -> gpd.GeoDataFrame:
    runtime_topology_path = scenario_dir / "runtime_topology.topo.json"
    if not runtime_topology_path.exists():
        return gpd.GeoDataFrame([], geometry="geometry", crs="EPSG:4326")
    topology_payload = load_json(runtime_topology_path)
    political_gdf = topology_object_to_gdf(topology_payload, "political")
    if political_gdf.empty:
        return gpd.GeoDataFrame([], geometry="geometry", crs="EPSG:4326")
    return build_runtime_shell_fragment_gdf(political_gdf)


def is_runtime_shell_fragment_row(row: dict[str, object]) -> bool:
    feature_id = str(row.get("id") or "").strip().upper()
    if feature_id.startswith("RU_ARCTIC_FB_"):
        return True
    return "shell fallback" in str(row.get("name") or "").strip().lower()


def build_polar_feature_diagnostics(political_gdf: gpd.GeoDataFrame) -> dict[str, dict[str, object]]:
    if political_gdf is None or political_gdf.empty:
        return {}

    id_series = political_gdf["id"].fillna("").astype(str).str.strip()
    polar_mask = (id_series == "AQ") | id_series.str.startswith("RU_ARCTIC_FB_")
    polar_gdf = political_gdf.loc[polar_mask].copy().reset_index(drop=True)
    if polar_gdf.empty:
        return {}

    area_km2_by_id: dict[str, float] = {}
    try:
        equal_area = polar_gdf.to_crs("EPSG:6933")
        for feature_id, geom in zip(polar_gdf["id"].astype(str).tolist(), equal_area.geometry.tolist()):
            area_km2_by_id[str(feature_id).strip()] = float(getattr(geom, "area", 0.0) or 0.0) / 1_000_000.0
    except Exception:
        area_km2_by_id = {}

    diagnostics: dict[str, dict[str, object]] = {}
    for row in polar_gdf.to_dict("records"):
        feature_id = str(row.get("id") or "").strip()
        geom = normalize_polygonal(row.get("geometry"))
        if not feature_id or geom is None:
            continue
        min_x, min_y, max_x, max_y = [float(value) for value in geom.bounds]
        area_km2 = float(area_km2_by_id.get(feature_id, 0.0) or 0.0)
        flags: list[str] = []
        if (
            abs(min_x + 180.0) < 1e-9
            and abs(min_y + 90.0) < 1e-9
            and abs(max_x - 180.0) < 1e-9
            and abs(max_y - 90.0) < 1e-9
        ):
            flags.append("world_bounds")
        if area_km2 > 25_000_000.0:
            flags.append("giant_feature")
        diagnostics[feature_id] = {
            "country_code": normalize_tag(row.get("cntr_code")),
            "bounds": [min_x, min_y, max_x, max_y],
            "area_km2": area_km2,
            "flags": flags,
        }
    return diagnostics


def rebuild_feature_maps_from_political_gdf(
    political_gdf: gpd.GeoDataFrame,
    source_feature_id_by_new_id: dict[str, str],
    source_owners: dict[str, str],
    source_controllers: dict[str, str],
    source_cores: dict[str, list[str]],
    explicit_assignments: dict[str, dict[str, object]] | None = None,
) -> tuple[dict, dict, dict]:
    owners: dict[str, str] = {}
    controllers: dict[str, str] = {}
    cores: dict[str, list[str]] = {}
    explicit_assignments = explicit_assignments or {}
    for row in political_gdf.to_dict("records"):
        feature_id = str(row.get("id") or "").strip()
        if not feature_id:
            continue
        if is_runtime_shell_fragment_row(row):
            continue
        explicit = explicit_assignments.get(feature_id)
        source_feature_id = source_feature_id_by_new_id.get(feature_id) or SCENARIO_SPLIT_SUFFIX_RE.sub("", feature_id)
        if not explicit and source_feature_id in explicit_assignments:
            explicit = explicit_assignments[source_feature_id]
        if explicit:
            owner_tag = normalize_tag(explicit.get("owner"))
            controller_tag = normalize_tag(explicit.get("controller")) or owner_tag
            core_tags = normalize_core_tags(explicit.get("core")) or ([owner_tag] if owner_tag else [])
            if not owner_tag:
                raise ValueError(f"Explicit assignment for {feature_id} is missing owner tag.")
            owners[feature_id] = owner_tag
            controllers[feature_id] = controller_tag
            cores[feature_id] = core_tags
            continue
        if source_feature_id not in source_owners:
            raise KeyError(f"Missing owner mapping for source feature id {source_feature_id} (new id {feature_id}).")
        owners[feature_id] = str(source_owners[source_feature_id]).strip().upper()
        controllers[feature_id] = str(source_controllers.get(source_feature_id) or owners[feature_id]).strip().upper()
        cores[feature_id] = normalize_core_tags(source_cores.get(source_feature_id)) or [owners[feature_id]]
    return (
        {"owners": owners},
        {"controllers": controllers},
        {"cores": cores},
    )


def compact_topology_properties(topo_payload: dict, object_name: str) -> None:
    geometries = (
        topo_payload.get("objects", {})
        .get(object_name, {})
        .get("geometries", [])
    )
    if not isinstance(geometries, list):
        return
    for geometry in geometries:
        if not isinstance(geometry, dict):
            continue
        properties = geometry.get("properties")
        if not isinstance(properties, dict):
            continue
        compacted = {
            key: value
            for key, value in properties.items()
            if value is not None
            and value != ""
            and not (isinstance(value, float) and math.isnan(value))
        }
        if compacted:
            geometry["properties"] = compacted
        else:
            geometry.pop("properties", None)


def build_region_affine_coeffs(config: dict, donor_context: dict) -> tuple[tuple[float, float, float, float, float, float], list[dict]]:
    control_pairs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    diagnostics: list[dict] = []
    for state_id, target_coord in config.get("control_points", {}).items():
        raw_geom = extract_state_geometry_raw(donor_context, int(state_id))
        raw_centroid = raw_geom.centroid
        target_lon, target_lat = target_coord
        control_pairs.append(((raw_centroid.x, raw_centroid.y), (target_lon, target_lat)))
        diagnostics.append({
            "state_id": int(state_id),
            "state_name": get_state_name(donor_context, int(state_id)),
            "raw_centroid": [round(raw_centroid.x, 6), round(raw_centroid.y, 6)],
            "target_coord": [round(target_lon, 6), round(target_lat, 6)],
        })
    coeffs = solve_affine_from_control_points(control_pairs)
    return coeffs, diagnostics


def build_atlantropa_from_hgo(
    donor_context: dict,
    baseline_land_full_gdf: gpd.GeoDataFrame,
) -> tuple[list[dict], dict[str, object], dict, dict[str, dict]]:
    atl_features: list[dict] = []
    region_unions: dict[str, object] = {}
    diagnostics: dict[str, dict] = {}
    replacement_specs: dict[str, dict] = {}

    seen_province_ids: set[int] = set()

    for region_id, config in ATLANTROPA_REGION_CONFIGS.items():
        aoi = box(*config["aoi_bbox"])
        precision_simplify_tolerance = float(
            config.get("precision_simplify_tolerance", config.get("simplify_tolerance", 0.01))
        )
        pixel_fragment_area_threshold = float(config.get("pixel_fragment_area_threshold", 0.0025))
        local_land = local_land_union(baseline_land_full_gdf, config["aoi_bbox"], padding=2.5)
        if local_land is None:
            raise ValueError(f"Unable to compute local shoreline context for Atlantropa region {region_id}.")
        local_boundary = local_land.boundary
        mainland_union = build_mainland_reference_union(
            local_land,
            config["aoi_bbox"],
            min_area=float(config.get("mainland_component_min_area", 3.0)),
        )
        coeffs, control_diagnostics = build_region_affine_coeffs(config, donor_context)

        region_feature_rows: list[dict] = []
        donor_land_state_ids = [int(value) for value in config.get("land_state_ids", [])]
        state_owner_overrides = {
            int(state_id): normalize_tag(tag)
            for state_id, tag in config.get("state_owner_overrides", {}).items()
            if normalize_tag(tag)
        }
        for state_id in donor_land_state_ids:
            state_name = get_state_name(donor_context, state_id)
            causeway_trim_ids = {int(value) for value in config.get("causeway_trim_state_ids", [])}
            province_ids = get_state_province_ids(donor_context, state_id)
            for province_id in province_ids:
                if province_id in seen_province_ids:
                    continue
                raw_geom = extract_province_geometry_raw(donor_context, province_id)
                fitted = apply_affine_to_geometry(raw_geom, coeffs)
                if fitted is None:
                    continue
                fitted = normalize_polygonal(fitted.intersection(aoi))
                if fitted is None:
                    continue
                if local_boundary is not None and config.get("snap_tolerance", 0) > 0:
                    fitted = normalize_polygonal(snap(fitted, local_boundary, float(config["snap_tolerance"])))
                if fitted is None:
                    continue
                fitted = normalize_polygonal(fitted.difference(local_land.buffer(float(config.get("preserve_margin", 0.03)))))
                if fitted is None:
                    continue
                if int(state_id) in causeway_trim_ids:
                    trim_width = float(config.get("causeway_trim_width", 0.12))
                    fitted = normalize_polygonal(fitted.intersection(aoi).intersection(local_land.buffer(trim_width)))
                    if fitted is None:
                        continue
                fitted = smooth_polygonal(fitted, simplify_tolerance=precision_simplify_tolerance)
                if fitted is None:
                    continue
                geometry_role = classify_atl_geometry_role(
                    state_id=state_id,
                    state_name=state_name,
                    geom=fitted,
                    mainland_union=mainland_union,
                    config=config,
                )
                if geometry_role == "skip":
                    continue
                assigned_owner_tag = state_owner_overrides.get(int(state_id)) or ATL_TAG
                feature_prefix = "ATLISRC" if geometry_role == ATL_GEOMETRY_ROLE_DONOR_ISLAND else "ATLPRV"
                region_feature_rows.append(make_atl_row(
                    feature_id=f"{feature_prefix}_{province_id}",
                    name=f"{config['group_label']} Province {province_id}",
                    geometry=fitted,
                    region_id=region_id,
                    config=config,
                    assigned_owner_tag=assigned_owner_tag,
                    geometry_role=geometry_role,
                    donor_state_ids=[state_id],
                    donor_state_names=[state_name],
                    donor_province_ids=[province_id],
                ))
                seen_province_ids.add(province_id)

        if not region_feature_rows:
            raise ValueError(f"Atlantropa donor extraction for region `{region_id}` produced zero land features.")

        major_island_state_ids = {
            int(value)
            for group in (config.get("major_island_groups", []) or [])
            for value in group.get("donor_state_ids", [])
        }
        donor_island_rows = [
            row
            for row in region_feature_rows
            if row.get("atl_geometry_role") == ATL_GEOMETRY_ROLE_DONOR_ISLAND
            or row_matches_donor_state_ids(row, major_island_state_ids)
        ]
        donor_island_row_ids = {
            str(row.get("id") or "").strip()
            for row in donor_island_rows
            if str(row.get("id") or "").strip()
        }
        non_island_rows = [
            row
            for row in region_feature_rows
            if str(row.get("id") or "").strip() not in donor_island_row_ids
        ]
        rebuilt_island_rows, residual_island_rows = build_major_island_rows(
            region_id,
            config,
            donor_island_rows,
            baseline_land_full_gdf,
            mainland_union,
        )
        merged_island_rows = merge_island_rows(region_id, config, residual_island_rows)
        region_feature_rows = [*non_island_rows, *rebuilt_island_rows, *merged_island_rows]

        shore_seal_rows = build_shore_seal_rows(region_id, config, region_feature_rows, mainland_union)
        region_feature_rows = [*region_feature_rows, *shore_seal_rows]
        boolean_weld_rows = build_boolean_weld_rows(region_id, config, region_feature_rows, mainland_union)
        region_feature_rows = [*region_feature_rows, *boolean_weld_rows]

        region_geom = safe_unary_union([row["geometry"] for row in region_feature_rows])
        if region_geom is None:
            raise ValueError(f"Atlantropa donor extraction for region `{region_id}` collapsed to empty geometry.")
        region_unions[region_id] = region_geom

        donor_island_union = safe_unary_union([
            row["geometry"]
            for row in region_feature_rows
            if row.get("atl_geometry_role") == ATL_GEOMETRY_ROLE_DONOR_ISLAND
        ])
        replacement_specs[region_id] = {
            "aoi_bbox": config["aoi_bbox"],
            "donor_island_union": donor_island_union,
            "mainland_union": mainland_union,
            "replace_buffer": float(config.get("mainland_touch_tolerance", 0.035)),
            "touch_tolerance": float(config.get("mainland_touch_tolerance", 0.035)),
        }

        overlap_area = float(region_geom.intersection(local_land).area) if local_land is not None else 0.0
        diagnostics[region_id] = {
            "feature_group_id": config["feature_group_id"],
            "group_label": config["group_label"],
            "aoi_bbox": list(config["aoi_bbox"]),
            "sea_completion_bbox": list(config.get("sea_completion_bbox") or config["aoi_bbox"]),
            "centroid": [round(region_geom.centroid.x, 6), round(region_geom.centroid.y, 6)],
            "bounds": [round(value, 6) for value in region_geom.bounds],
            "province_feature_count": len(region_feature_rows),
            "assigned_owner_counts": dict(sorted(Counter(
                str(row["assigned_owner_tag"]).strip().upper() for row in region_feature_rows
            ).items())),
            "geometry_role_counts": dict(sorted(Counter(
                str(row.get("atl_geometry_role") or "").strip()
                for row in region_feature_rows
                if str(row.get("atl_geometry_role") or "").strip()
            ).items())),
            "join_mode_counts": dict(sorted(Counter(
                str(row.get("atl_join_mode") or "").strip()
                for row in region_feature_rows
                if str(row.get("atl_join_mode") or "").strip()
            ).items())),
            "overlap_with_baseline_land_area": round(overlap_area, 6),
            "post_clip_area": round(float(region_geom.area), 6),
            "pixel_fragment_area_threshold": round(pixel_fragment_area_threshold, 6),
            "pixel_fragment_count": count_small_polygon_parts(
                [row["geometry"] for row in region_feature_rows],
                max_area=pixel_fragment_area_threshold,
            ),
            "control_points": control_diagnostics,
            "affine_coeffs": [round(value, 9) for value in coeffs],
        }

        for row in region_feature_rows:
            atl_features.append(make_feature(row["geometry"], {
                "id": row["id"],
                "name": row["name"],
                "cntr_code": ATL_TAG,
                "admin1_group": row["admin1_group"],
                "detail_tier": row["detail_tier"],
                "__source": row["__source"],
                "scenario_id": SCENARIO_ID,
                "region_id": row["region_id"],
                "region_group": config["feature_group_id"],
                "atl_surface_kind": ATL_SURFACE_LAND,
                "atl_region_group": row["region_id"],
                "atl_geometry_role": row["atl_geometry_role"],
                "atl_join_mode": row.get("atl_join_mode", ATL_JOIN_MODE_NONE),
                "interactive": bool(row.get("interactive", True)),
                "render_as_base_geography": False,
                "owner_tag": row["assigned_owner_tag"],
                "synthetic_owner": row["assigned_owner_tag"] == ATL_TAG,
                "donor_state_ids": row["donor_state_ids"],
                "donor_state_names": row["donor_state_names"],
                "donor_province_ids": row["donor_province_ids"],
                "donor_state_id": row["donor_state_ids"][0] if row["donor_state_ids"] else None,
                "donor_state_name": row["donor_state_names"][0] if row["donor_state_names"] else "",
                "donor_province_id": row["donor_province_ids"][0] if row["donor_province_ids"] else None,
                "assignment_source": "state_owner_override" if row["assigned_owner_tag"] != ATL_TAG else "atl_default",
                "source_standard": "hgo_donor_province_georef",
            }))

    return atl_features, region_unions, diagnostics, replacement_specs


def build_atl_sea_from_hgo(
    donor_context: dict,
    baseline_land_full_gdf: gpd.GeoDataFrame,
    atlantropa_region_unions: dict[str, object],
) -> tuple[list[dict], object | None, dict]:
    sea_features: list[dict] = []
    sea_geoms: list[object] = []
    diagnostics: dict[str, dict] = {}
    atlantropa_union = safe_unary_union(list(atlantropa_region_unions.values()))
    mediterranean_template_gdf = load_mediterranean_template_water_gdf()
    accumulated_sea_union = None

    for region_id, config in ATLANTROPA_REGION_CONFIGS.items():
        completion_bbox = tuple(config.get("sea_completion_bbox") or config["aoi_bbox"])
        aoi = box(*completion_bbox)
        local_land = local_land_union(baseline_land_full_gdf, completion_bbox, padding=2.5)
        if local_land is None:
            continue
        coeffs, _control = build_region_affine_coeffs(config, donor_context)
        precision_simplify_tolerance = float(
            config.get("precision_simplify_tolerance", config.get("simplify_tolerance", 0.01))
        )
        water_parts: list[tuple[int, int, int, object]] = []
        state_feature_counts: Counter[int] = Counter()
        for state_id in [int(value) for value in config.get("water_state_ids", [])]:
            province_ids = get_state_province_ids(donor_context, state_id)
            for province_id in province_ids:
                raw_geom = extract_province_geometry_raw(donor_context, province_id)
                fitted = apply_affine_to_geometry(raw_geom, coeffs)
                if fitted is None:
                    continue
                fitted = normalize_polygonal(fitted.intersection(aoi))
                if fitted is None:
                    continue
                fitted = normalize_polygonal(
                    fitted.difference(local_land.buffer(float(config.get("sea_preserve_margin", 0.03))))
                )
                if fitted is None:
                    continue
                if atlantropa_union is not None:
                    fitted = normalize_polygonal(fitted.difference(atlantropa_union.buffer(0.002)))
                if fitted is None:
                    continue
                if accumulated_sea_union is not None:
                    fitted = normalize_polygonal(fitted.difference(accumulated_sea_union.buffer(0.0004)))
                if fitted is None:
                    continue
                fitted = smooth_polygonal(
                    fitted,
                    simplify_tolerance=precision_simplify_tolerance,
                )
                if fitted is None:
                    continue
                component_index = 0
                for part in iter_polygon_parts(fitted):
                    normalized_part = normalize_polygonal(part)
                    if normalized_part is None:
                        continue
                    water_parts.append((state_id, province_id, component_index, normalized_part))
                    component_index += 1
                    state_feature_counts[state_id] += 1
        enclosed_max_area = float(config.get("sea_drop_enclosed_max_area", 0.0))
        if enclosed_max_area > 0 and water_parts:
            boundary_buffer = aoi.boundary.buffer(0.03)
            pruned_water_parts: list[tuple[int, int, int, object]] = []
            for state_id, province_id, component_index, fitted in water_parts:
                if float(fitted.area) <= enclosed_max_area and not fitted.intersects(boundary_buffer):
                    continue
                pruned_water_parts.append((state_id, province_id, component_index, fitted))
            water_parts = pruned_water_parts
        donor_water_union = safe_unary_union([geom for *_meta, geom in water_parts]) if water_parts else None

        local_template = mediterranean_template_gdf.loc[mediterranean_template_gdf.intersects(aoi)].copy().reset_index(drop=True)
        template_union = safe_unary_union(local_template.geometry.tolist()) if not local_template.empty else None
        expected_sea = None
        if template_union is not None:
            expected_sea = normalize_polygonal(template_union.intersection(aoi))
            if expected_sea is not None:
                expected_sea = normalize_polygonal(
                    expected_sea.difference(local_land.buffer(float(config.get("sea_preserve_margin", 0.03))))
                )
            if expected_sea is not None and atlantropa_union is not None:
                expected_sea = normalize_polygonal(expected_sea.difference(atlantropa_union.buffer(0.002)))

        covered_sea_union = safe_unary_union([
            geom for geom in [donor_water_union, accumulated_sea_union] if geom is not None
        ])
        completion_rows, completion_union, completion_diagnostics = build_atl_sea_completion_rows(
            region_id,
            config,
            expected_sea_geom=expected_sea,
            existing_sea_geom=covered_sea_union,
            occupied_sea_geom=covered_sea_union,
        )

        region_water = safe_unary_union([geom for geom in [donor_water_union, completion_union] if geom is not None])
        if region_water is None:
            diagnostics[region_id] = {
                "group_label": config["group_label"],
                "water_state_ids": [int(value) for value in config.get("water_state_ids", [])],
                "bounds": [],
                "centroid": [],
                "area": 0.0,
                "feature_count": 0,
                "water_state_feature_counts": {},
                "template_feature_count": int(len(local_template)),
                "expected_completion_area": round(float(expected_sea.area), 6) if expected_sea is not None else 0.0,
                **completion_diagnostics,
            }
            continue

        sea_geoms.append(region_water)
        accumulated_sea_union = safe_unary_union([geom for geom in [accumulated_sea_union, region_water] if geom is not None])
        for state_id, province_id, component_index, fitted in water_parts:
            sea_features.append(make_feature(fitted, {
                "id": f"ATLSEA_{region_id}_{state_id}_{province_id}_{component_index}",
                "name": f"{config['group_label']} Sea {state_id}-{province_id}-{component_index}",
                "cntr_code": ATL_TAG,
                "admin1_group": f"{config['feature_group_id']}_sea",
                "detail_tier": "scenario_atlantropa",
                "__source": ATL_SOURCE_TAG,
                "scenario_id": SCENARIO_ID,
                "region_id": region_id,
                "region_group": f"{config['feature_group_id']}_sea",
                "atl_surface_kind": ATL_SURFACE_SEA,
                "atl_region_group": f"mediterranean_remaining_{region_id}",
                "atl_geometry_role": ATL_GEOMETRY_ROLE_DONOR_SEA,
                "atl_join_mode": ATL_JOIN_MODE_NONE,
                "atl_subbasin_id": f"{region_id}_{state_id}_{province_id}_{component_index}",
                "interactive": False,
                "render_as_base_geography": False,
                "owner_tag": ATL_TAG,
                "synthetic_owner": True,
                "donor_state_id": state_id,
                "donor_state_name": get_state_name(donor_context, state_id),
                "donor_province_id": province_id,
                "source_standard": "hgo_donor_water_georef",
            }))
        sea_features.extend(completion_rows)
        diagnostics[region_id] = {
            "group_label": config["group_label"],
            "water_state_ids": [int(value) for value in config.get("water_state_ids", [])],
            "bounds": [round(value, 6) for value in region_water.bounds],
            "centroid": [round(region_water.centroid.x, 6), round(region_water.centroid.y, 6)],
            "area": round(float(region_water.area), 6),
            "feature_count": len(water_parts) + len(completion_rows),
            "water_state_feature_counts": {
                str(state_id): int(count)
                for state_id, count in sorted(state_feature_counts.items())
            },
            "template_feature_count": int(len(local_template)),
            "expected_completion_area": round(float(expected_sea.area), 6) if expected_sea is not None else 0.0,
            **completion_diagnostics,
        }

    if not sea_features:
        raise ValueError("Mediterranean donor extraction produced zero ATL sea features.")

    sea_union = safe_unary_union(sea_geoms)
    return sea_features, sea_union, diagnostics


def build_relief_overlays(atlantropa_region_unions: dict[str, object], lake_geom) -> dict:
    features: list[dict] = []
    for region_id, config in ATLANTROPA_REGION_CONFIGS.items():
        region_geom = atlantropa_region_unions.get(region_id)
        if region_geom is None:
            continue
        parent_id = config["feature_group_id"]
        features.append(make_feature(region_geom, {
            "id": f"{parent_id}_salt_texture",
            "overlay_kind": "salt_flat_texture",
            "parent_id": parent_id,
            "scenario_id": SCENARIO_ID,
            "interactive": False,
            "render_as_base_geography": True,
        }))
        features.append(make_feature(region_geom.boundary, {
            "id": f"{parent_id}_shoreline",
            "overlay_kind": "new_shoreline",
            "parent_id": parent_id,
            "scenario_id": SCENARIO_ID,
            "interactive": False,
            "render_as_base_geography": True,
        }))
        inner = normalize_polygonal(region_geom.buffer(-0.12))
        if inner is not None and not inner.is_empty:
            features.append(make_feature(inner.boundary, {
                "id": f"{parent_id}_contour",
                "overlay_kind": "drained_basin_contour",
                "parent_id": parent_id,
                "scenario_id": SCENARIO_ID,
                "interactive": False,
                "render_as_base_geography": True,
            }))

    lake_bounds = lake_geom.bounds
    lake_center_y = (lake_bounds[1] + lake_bounds[3]) * 0.5
    swamp_margin = lake_geom.buffer(0.35).difference(lake_geom.buffer(0.04))
    dam_approach = LineString([
        (lake_bounds[0] - 0.65, lake_center_y + 0.2),
        (lake_bounds[0] - 0.1, lake_center_y + 0.08),
        (lake_bounds[0] + 0.65, lake_center_y - 0.12),
    ])
    features.extend([
        make_feature(lake_geom.boundary, {
            "id": "congo_lake_shoreline",
            "overlay_kind": "lake_shoreline",
            "parent_id": "congo_lake",
            "scenario_id": SCENARIO_ID,
            "interactive": False,
            "render_as_base_geography": True,
        }),
        make_feature(swamp_margin, {
            "id": "congo_lake_swamp_margin",
            "overlay_kind": "swamp_margin",
            "parent_id": "congo_lake",
            "scenario_id": SCENARIO_ID,
            "interactive": False,
            "render_as_base_geography": True,
        }),
        make_feature(dam_approach, {
            "id": "congo_lake_dam_approach",
            "overlay_kind": "dam_approach",
            "parent_id": "congo_lake",
            "scenario_id": SCENARIO_ID,
            "interactive": False,
            "render_as_base_geography": True,
        }),
    ])
    return feature_collection_from_features(features)


def _atl_synthetic_depth_profile_for_region(region_id: str) -> tuple[tuple[int, int], ...]:
    if str(region_id or "").strip().lower() == "libya_suez_and_qattara":
        return BATHYMETRY_ATL_SYNTHETIC_PROFILE_SHALLOW
    return BATHYMETRY_ATL_SYNTHETIC_PROFILE_DEFAULT


def _estimate_bathymetry_step(geom, level_count: int) -> float:
    minx, miny, maxx, maxy = geom.bounds
    min_span = max(min(maxx - minx, maxy - miny), 0.12)
    return max(min_span / max(level_count * 2.4, 1), 0.02)


def _build_bathymetry_ring_rows(
    geom,
    *,
    region_id: str,
    region_group: str,
    bathymetry_mode: str,
    band_defs: tuple[tuple[int, int], ...],
) -> tuple[list[dict], list[dict]]:
    current = normalize_polygonal(geom)
    if current is None:
        return [], []
    band_rows: list[dict] = []
    contour_rows: list[dict] = []
    step = _estimate_bathymetry_step(current, len(band_defs))
    for index, (depth_min_m, depth_max_m) in enumerate(band_defs):
        next_geom = None
        if index < len(band_defs) - 1:
            next_geom = normalize_polygonal(current.buffer(-step))
        band_geom = current
        if next_geom is not None:
            band_geom = normalize_polygonal(current.difference(next_geom))
        if band_geom is not None:
            band_rows.append({
                "id": f"bath_{region_id}_{bathymetry_mode}_{abs(int(depth_max_m))}_{index}",
                "region_id": region_id,
                "region_group": region_group,
                "bathymetry_mode": bathymetry_mode,
                "depth_min_m": int(depth_min_m),
                "depth_max_m": int(depth_max_m),
                "geometry": band_geom,
            })
        if next_geom is not None:
            contour_geom = next_geom.boundary
            if contour_geom is not None and not contour_geom.is_empty:
                contour_rows.append({
                    "id": f"bath_contour_{region_id}_{bathymetry_mode}_{abs(int(depth_max_m))}_{index}",
                    "region_id": region_id,
                    "region_group": region_group,
                    "bathymetry_mode": bathymetry_mode,
                    "depth_m": int(depth_max_m),
                    "geometry": contour_geom,
                })
        if next_geom is None:
            break
        current = next_geom
    return band_rows, contour_rows


def _dissolve_bathymetry_rows(rows: list[dict], *, geometry_key: str = "geometry") -> gpd.GeoDataFrame:
    if not rows:
        return gpd.GeoDataFrame({geometry_key: gpd.GeoSeries([], crs="EPSG:4326")}, geometry=geometry_key, crs="EPSG:4326")
    grouped: dict[tuple, list[object]] = {}
    props_by_key: dict[tuple, dict[str, object]] = {}
    for row in rows:
        props = {key: value for key, value in row.items() if key != geometry_key}
        key = tuple(sorted(props.items(), key=lambda item: item[0]))
        grouped.setdefault(key, []).append(row[geometry_key])
        props_by_key[key] = props
    dissolved_rows: list[dict[str, object]] = []
    for key, geometries in grouped.items():
        sample_geom = next((geom for geom in geometries if geom is not None and not geom.is_empty), None)
        if sample_geom is None:
            continue
        if sample_geom.geom_type in {"LineString", "MultiLineString", "LinearRing"}:
            geom = unary_union(geometries)
        else:
            geom = safe_unary_union(geometries)
        if geom is not None and geom.geom_type in {"Polygon", "MultiPolygon", "GeometryCollection"}:
            geom = normalize_polygonal(geom)
        if geom is None or geom.is_empty:
            continue
        dissolved_rows.append({
            **props_by_key[key],
            geometry_key: geom,
        })
    if not dissolved_rows:
        return gpd.GeoDataFrame({geometry_key: gpd.GeoSeries([], crs="EPSG:4326")}, geometry=geometry_key, crs="EPSG:4326")
    return gpd.GeoDataFrame(dissolved_rows, geometry=geometry_key, crs="EPSG:4326")


def build_tno_bathymetry_payload(
    atl_sea_collection: list[dict],
    atlantropa_region_unions: dict[str, object],
) -> tuple[dict, dict]:
    band_rows: list[dict] = []
    contour_rows: list[dict] = []
    dry_union = safe_unary_union(list(atlantropa_region_unions.values()))
    dry_union = normalize_polygonal(dry_union)
    atl_counts = {
        "observed_region_ids": set(),
        "synthetic_region_ids": set(),
        "excluded_region_ids": sorted(atlantropa_region_unions.keys()),
    }

    for feature in atl_sea_collection:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        region_id = str(props.get("region_id") or "").strip()
        if not region_id:
            continue
        geometry = shape(feature.get("geometry")) if isinstance(feature, dict) and feature.get("geometry") else None
        geometry = normalize_polygonal(geometry)
        if geometry is None:
            continue
        if dry_union is not None:
            geometry = normalize_polygonal(geometry.difference(dry_union.buffer(0.0002)))
        if geometry is None:
            continue
        geometry_role = str(props.get("atl_geometry_role") or "").strip().lower()
        bathymetry_mode = "observed" if geometry_role == ATL_GEOMETRY_ROLE_DONOR_SEA else "synthetic"
        if bathymetry_mode == "observed":
            band_defs = BATHYMETRY_GLOBAL_DEPTH_BANDS
            atl_counts["observed_region_ids"].add(region_id)
        else:
            band_defs = _atl_synthetic_depth_profile_for_region(region_id)
            atl_counts["synthetic_region_ids"].add(region_id)
        region_group = str(props.get("region_group") or f"{region_id}_sea").strip() or f"{region_id}_sea"
        band_part_rows, contour_part_rows = _build_bathymetry_ring_rows(
            geometry,
            region_id=region_id,
            region_group=region_group,
            bathymetry_mode=bathymetry_mode,
            band_defs=band_defs,
        )
        band_rows.extend(band_part_rows)
        contour_rows.extend(contour_part_rows)

    band_gdf = _dissolve_bathymetry_rows(band_rows)
    contour_gdf = _dissolve_bathymetry_rows(contour_rows)
    topo = Topology(
        [band_gdf, contour_gdf],
        object_name=["bathymetry_bands", "bathymetry_contours"],
        topology=True,
        prequantize=1_000_000,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    )
    topo_payload = topo.to_dict()
    compact_topology_properties(topo_payload, "bathymetry_bands")
    compact_topology_properties(topo_payload, "bathymetry_contours")
    diagnostics = {
        "band_feature_count": int(len(band_gdf)),
        "contour_feature_count": int(len(contour_gdf)),
        "observed_region_ids": sorted(atl_counts["observed_region_ids"]),
        "synthetic_region_ids": sorted(atl_counts["synthetic_region_ids"]),
        "excluded_region_ids": atl_counts["excluded_region_ids"],
    }
    return topo_payload, diagnostics


def build_empty_bathymetry_payload() -> dict:
    return {
        "type": "Topology",
        "objects": {
            "bathymetry_bands": {"type": "GeometryCollection", "geometries": []},
            "bathymetry_contours": {"type": "GeometryCollection", "geometries": []},
        },
        "arcs": [],
    }


def recalculate_country_feature_counts(
    countries_payload: dict,
    owners_payload: dict,
    controllers_payload: dict,
    audit_payload: dict,
    manifest_payload: dict,
) -> None:
    counts = Counter(str(tag).upper() for tag in owners_payload.get("owners", {}).values())
    controller_counts = Counter(str(tag).upper() for tag in controllers_payload.get("controllers", {}).values())
    countries = countries_payload.get("countries", {})
    quality_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    approximate_count = 0
    manual_reviewed_feature_count = 0
    synthetic_owner_feature_count = 0
    for tag, country_entry in countries.items():
        feature_count = int(counts.get(str(tag).upper(), 0))
        country_entry["feature_count"] = feature_count
        country_entry["controller_feature_count"] = int(controller_counts.get(str(tag).upper(), 0))
        quality = str(country_entry.get("quality") or "").strip()
        source = str(country_entry.get("source") or "").strip()
        if quality:
            quality_counts[quality] += feature_count
        if source:
            source_counts[source] += feature_count
        if quality == "approx_existing_geometry":
            approximate_count += feature_count
        if quality == "manual_reviewed":
            manual_reviewed_feature_count += feature_count
        if country_entry.get("synthetic_owner"):
            synthetic_owner_feature_count += feature_count
    rebuilt_owner_stats = {}
    for tag, country_entry in countries.items():
        rebuilt_owner_stats[tag] = build_owner_stats_entry(country_entry)
    audit_payload["owner_stats"] = rebuilt_owner_stats
    audit_summary = audit_payload.get("summary", {})
    manifest_summary = manifest_payload.get("summary", {})
    audit_summary["feature_count"] = len(owners_payload.get("owners", {}))
    audit_summary["quality_counts"] = dict(sorted(quality_counts.items()))
    audit_summary["source_counts"] = dict(sorted(source_counts.items()))
    audit_summary["approximate_count"] = approximate_count
    audit_summary["manual_reviewed_feature_count"] = manual_reviewed_feature_count
    audit_summary["synthetic_owner_feature_count"] = synthetic_owner_feature_count
    audit_summary["synthetic_count"] = synthetic_owner_feature_count
    manifest_summary["feature_count"] = len(owners_payload.get("owners", {}))
    manifest_summary["approximate_count"] = approximate_count
    manifest_summary["synthetic_owner_feature_count"] = synthetic_owner_feature_count
    manifest_summary["synthetic_count"] = synthetic_owner_feature_count
    for summary in (audit_summary, manifest_summary):
        summary["owner_count"] = len({tag for tag in owners_payload.get("owners", {}).values() if str(tag).strip()})
        summary["controller_count"] = len({tag for tag in controllers_payload.get("controllers", {}).values() if str(tag).strip()})


def build_runtime_topology_payload(
    political_gdf: gpd.GeoDataFrame,
    water_gdf: gpd.GeoDataFrame,
    land_mask_gdf: gpd.GeoDataFrame,
    context_land_mask_gdf: gpd.GeoDataFrame,
) -> dict:
    keep_columns = [
        "id",
        "name",
        "cntr_code",
        "admin1_group",
        "detail_tier",
        "__source",
        "scenario_id",
        "scenario_helper_kind",
        "region_group",
        "atl_surface_kind",
        "atl_geometry_role",
        "atl_join_mode",
        "interactive",
        "render_as_base_geography",
        "geometry",
    ]
    available_columns = [column for column in keep_columns if column in political_gdf.columns]
    runtime_political_gdf = political_gdf.loc[:, available_columns].copy()
    topo = Topology(
        [runtime_political_gdf, land_mask_gdf, context_land_mask_gdf],
        object_name=["political", "land_mask", "context_land_mask"],
        topology=True,
        prequantize=False,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    )
    topo_dict = topo.to_dict()
    water_topo = Topology(
        [water_gdf],
        object_name=["scenario_water"],
        topology=True,
        prequantize=False,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    ).to_dict()
    arc_offset = len(topo_dict.get("arcs", []))
    topo_dict.setdefault("objects", {})["scenario_water"] = remap_topology_arc_indexes(
        water_topo.get("objects", {}).get("scenario_water", {"type": "GeometryCollection", "geometries": []}),
        arc_offset,
    )
    topo_dict["arcs"] = list(topo_dict.get("arcs", [])) + list(water_topo.get("arcs", []))
    merged_bbox = merge_topology_bboxes(topo_dict.get("bbox"), water_topo.get("bbox"))
    if merged_bbox is not None:
        topo_dict["bbox"] = merged_bbox
    topo_dict.setdefault("objects", {})["scenario_special_land"] = {
        "type": "GeometryCollection",
        "geometries": [],
    }
    compact_topology_properties(topo_dict, "political")
    political_out = topology_object_to_gdf(topo_dict, "political")
    topo_dict["objects"]["political"]["computed_neighbors"] = compute_neighbor_graph(political_out)
    return topo_dict


def build_countries_stage_state(
    scenario_dir: Path,
    refresh_named_water_snapshot: bool = False,
) -> dict[str, object]:
    countries_payload = load_json(scenario_dir / "countries.json")
    owners_payload = load_json(scenario_dir / "owners.by_feature.json")
    controllers_payload = load_json(scenario_dir / "controllers.by_feature.json")
    cores_payload = load_json(scenario_dir / "cores.by_feature.json")
    manual_overrides_payload = load_scenario_manual_overrides_payload(scenario_dir)
    manifest_payload = load_json(scenario_dir / "manifest.json")
    audit_payload = load_json(scenario_dir / "audit.json")
    current_water_regions = load_json(scenario_dir / "water_regions.geojson")
    named_water_snapshot_payload, water_regions_provenance_payload = load_or_refresh_marine_regions_named_water_snapshot(
        scenario_dir,
        refresh_named_water_snapshot=refresh_named_water_snapshot,
    )
    cores_payload["cores"] = normalize_feature_core_map(cores_payload.get("cores", {}))

    generated_at = utc_timestamp()
    runtime_political_full_gdf = load_runtime_political_gdf()
    valid_runtime_feature_ids = {
        str(feature_id).strip()
        for feature_id in runtime_political_full_gdf["id"].astype(str).tolist()
        if str(feature_id).strip()
    }
    migration_map = load_feature_migration_map()
    if migration_map:
        owners_payload["owners"] = expand_feature_code_map(
            owners_payload.get("owners", {}),
            valid_feature_ids=valid_runtime_feature_ids,
            migration_map=migration_map,
        )
        controllers_payload["controllers"] = expand_feature_code_map(
            controllers_payload.get("controllers", {}),
            valid_feature_ids=valid_runtime_feature_ids,
            migration_map=migration_map,
        )
        cores_payload["cores"] = expand_feature_core_map(
            cores_payload.get("cores", {}),
            valid_feature_ids=valid_runtime_feature_ids,
            migration_map=migration_map,
        )

    applied_annex_maps = patch_baseline_maps(owners_payload, controllers_payload, cores_payload)
    applied_annex_maps.update(
        patch_tno_europe_baseline(countries_payload, owners_payload, controllers_payload, cores_payload)
    )
    patch_germany_metadata(countries_payload, owners_payload)
    patch_italy_metadata(countries_payload)
    touched_regional_rule_tags = {
        rule_pack_name: apply_regional_rules(
            rule_pack_name,
            rule_path,
            countries_payload,
            owners_payload,
            controllers_payload,
            cores_payload,
            audit_payload,
        )
        for rule_pack_name, rule_path in REGIONAL_RULE_PACKS
    }
    apply_tno_decolonization_metadata(countries_payload)
    patch_tno_palette_defaults(countries_payload, manifest_payload)
    touched_east_asia_tags = touched_regional_rule_tags.get("east_asia", [])
    touched_south_asia_tags = touched_regional_rule_tags.get("south_asia", [])

    tno_root = resolve_tno_root()
    hgo_root = resolve_hgo_root()
    donor_context = load_hgo_context(hgo_root)
    tno_key_image = load_province_key_image(tno_root)
    source_owner_feature_ids = {str(feature_id).strip() for feature_id in owners_payload.get("owners", {}).keys() if str(feature_id).strip()}
    canonical_source_owners = canonicalize_feature_code_map(owners_payload["owners"])
    canonical_source_controllers = canonicalize_feature_code_map(controllers_payload["controllers"])
    canonical_source_cores = canonicalize_feature_core_map(cores_payload["cores"])
    restore_gdf, restore_assignments, restore_diagnostics = build_restore_assignments(
        runtime_political_full_gdf,
        canonical_source_owners,
        canonical_source_controllers,
        canonical_source_cores,
    )
    antarctic_gdf, antarctic_assignments, antarctic_diagnostics = build_single_antarctic_feature(
        runtime_political_full_gdf
    )
    shell_fragment_gdf = load_existing_scenario_runtime_shell_fragment_gdf(scenario_dir)
    runtime_owned_political_gdf = runtime_political_full_gdf.loc[
        runtime_political_full_gdf["id"].isin(source_owner_feature_ids)
    ].copy().reset_index(drop=True)
    runtime_owned_political_gdf = pd_concat_geodataframes([runtime_owned_political_gdf, restore_gdf])
    if runtime_owned_political_gdf.empty:
        raise ValueError("Owned runtime political topology resolved zero features.")

    _, province_type_by_id, rgb_key_to_id = load_definition_entries(tno_root)
    lake_geom, lake_component_ids = build_congo_lake_geometry(tno_key_image, province_type_by_id, rgb_key_to_id)

    atl_feature_collection, atlantropa_region_unions, atlantropa_diagnostics, atl_replacement_specs = build_atlantropa_from_hgo(
        donor_context,
        runtime_political_full_gdf,
    )
    atl_feature_ids = [str(feature["properties"]["id"]).strip() for feature in atl_feature_collection]
    atl_political_gdf = geopandas_from_features(atl_feature_collection)
    if atl_political_gdf.empty:
        raise ValueError("Atlantropa donor build returned zero political features.")

    island_drop_ids, island_replacement_diagnostics = collect_baseline_island_drop_ids(
        runtime_owned_political_gdf,
        atl_replacement_specs,
    )
    if island_drop_ids:
        runtime_owned_political_gdf = runtime_owned_political_gdf.loc[
            ~runtime_owned_political_gdf["id"].isin(island_drop_ids)
        ].copy().reset_index(drop=True)

    atl_sea_collection, atl_sea_union, med_water_diagnostics = build_atl_sea_from_hgo(
        donor_context,
        runtime_political_full_gdf,
        atlantropa_region_unions,
    )
    atl_sea_feature_ids = [str(feature["properties"]["id"]).strip() for feature in atl_sea_collection]
    atl_sea_gdf = geopandas_from_features(atl_sea_collection)

    scenario_cut_political_gdf, source_feature_id_by_new_id = cut_political_features(runtime_owned_political_gdf, lake_geom)
    scenario_political_gdf = gpd.GeoDataFrame(
        pd_concat_geodataframes([scenario_cut_political_gdf, shell_fragment_gdf, antarctic_gdf, atl_political_gdf, atl_sea_gdf]),
        geometry="geometry",
        crs="EPSG:4326",
    )
    scenario_political_gdf = scenario_political_gdf.drop_duplicates(subset=["id"], keep="first").reset_index(drop=True)
    if scenario_political_gdf["id"].duplicated().any():
        duplicates = scenario_political_gdf.loc[scenario_political_gdf["id"].duplicated(), "id"].tolist()[:10]
        raise ValueError(f"Duplicate political feature ids after ATL append: {duplicates}")

    explicit_assignments = {}
    explicit_assignments.update(antarctic_assignments)
    for feature in [*atl_feature_collection, *atl_sea_collection]:
        props = feature.get("properties", {}) if isinstance(feature, dict) else {}
        feature_id = str(props.get("id") or "").strip()
        owner_tag = normalize_tag(props.get("owner_tag")) or ATL_TAG
        if not feature_id or not owner_tag:
            continue
        explicit_assignments[feature_id] = {
            "owner": owner_tag,
            "controller": owner_tag,
            "core": owner_tag,
        }
    explicit_assignments.update(restore_assignments)
    owners_payload, controllers_payload, cores_payload = rebuild_feature_maps_from_political_gdf(
        scenario_political_gdf,
        source_feature_id_by_new_id,
        canonical_source_owners,
        canonical_source_controllers,
        canonical_source_cores,
        explicit_assignments=explicit_assignments,
    )
    feature_assignment_override_diagnostics = apply_tno_feature_assignment_overrides(
        owners_payload,
        controllers_payload,
        cores_payload,
        scenario_political_gdf,
    )
    owner_only_backfill_diagnostics = apply_tno_owner_only_backfill(
        owners_payload,
        scenario_political_gdf,
    )
    greece_coarse_owner_backfill_diagnostics = apply_tno_greece_coarse_owner_backfill(
        owners_payload,
        controllers_payload,
        cores_payload,
        scenario_political_gdf,
    )
    polar_feature_diagnostics = build_polar_feature_diagnostics(scenario_political_gdf)

    countries_payload.setdefault("countries", {})[ATL_TAG] = build_atl_country_entry(
        countries_payload.get("countries", {}).get(ATL_TAG),
        feature_count=sum(
            1
            for feature_id, assignment in explicit_assignments.items()
            if feature_id in {*atl_feature_ids, *atl_sea_feature_ids}
            and normalize_tag(assignment.get("owner")) == ATL_TAG
        ),
    )
    countries_payload.setdefault("countries", {})["AQ"] = build_manual_country_entry(
        tag="AQ",
        existing_entry=countries_payload.get("countries", {}).get("AQ"),
        palette_entries=load_palette_entries(TNO_PALETTE_PATH),
        feature_count=sum(
            1
            for feature_id, assignment in explicit_assignments.items()
            if feature_id == "AQ" and normalize_tag(assignment.get("owner")) == "AQ"
        ),
        continent_id="continent_antarctica",
        continent_label="Antarctica",
        subregion_id="subregion_antarctica",
        subregion_label="Antarctica",
        base_iso2="AQ",
        lookup_iso2="AQ",
        provenance_iso2="AQ",
        display_name="Antarctica",
        notes="Collapsed from runtime Antarctic sectors into a single land-only political feature for the TNO 1962 scenario.",
        source="scenario_generated",
        source_type="scenario_extension",
        historical_fidelity="tno_runtime_polar_fix",
    )
    normalize_tno_country_registry(countries_payload, owners_payload)
    ensure_tno_manual_override_countries(countries_payload, owners_payload)
    ensure_tno_controller_only_countries(countries_payload, controllers_payload)
    apply_tno_inspector_groups(countries_payload)
    apply_tno_country_display_name_overrides(countries_payload)
    dev_manual_override_diagnostics = apply_dev_manual_overrides(
        countries_payload,
        owners_payload,
        controllers_payload,
        cores_payload,
        manual_overrides_payload,
        audit_payload,
    )

    congo_props = {
        "id": "congo_lake",
        "name": "Congo Lake",
        "label": "Congo Lake",
        "water_type": "lake",
        "region_group": "tno_congo_basin",
        "parent_id": "",
        "neighbors": "",
        "is_chokepoint": False,
        "interactive": True,
        "scenario_id": SCENARIO_ID,
        "source_standard": "tno_lake_provinces_contour_extracted",
        "source_province_ids": lake_component_ids,
        "topology_mode": "true_water",
        "render_as_base_geography": True,
    }
    congo_feature = make_feature(lake_geom, congo_props)
    named_marginal_water_features, named_water_diagnostics = build_tno_named_marginal_water_features(
        named_water_snapshot_payload
    )
    base_land_union = safe_unary_union(runtime_political_full_gdf.geometry.tolist())
    atl_land_union = safe_unary_union(atl_political_gdf.geometry.tolist())
    if base_land_union is None or atl_land_union is None:
        raise ValueError("Unable to assemble land unions for runtime topology.")
    ocean_land_mask_geom = safe_unary_union([base_land_union, atl_land_union])
    if ocean_land_mask_geom is None:
        raise ValueError("Open-ocean land mask collapsed to empty geometry.")
    mediterranean_template_gdf = load_mediterranean_template_water_gdf()
    mediterranean_template_union = (
        safe_unary_union(mediterranean_template_gdf.geometry.tolist())
        if not mediterranean_template_gdf.empty
        else None
    )
    atlantic_supplement_subtract_geometries = [
        geom
        for geom in [atl_sea_union, mediterranean_template_union]
        if geom is not None
    ]
    open_ocean_component_min_area_by_id = {
        str(child_spec.get("id")).strip(): float(child_spec.get("component_min_area") or 0.0)
        for split_spec in TNO_OPEN_OCEAN_SPLIT_SPECS
        for child_spec in split_spec.get("children", ())
        if str(child_spec.get("id") or "").strip()
    }
    clip_open_ocean_geometries_by_id: dict[str, list] = {}
    for spec, feature in zip(TNO_NAMED_MARGINAL_WATER_SPECS, named_marginal_water_features):
        clip_geom = normalize_polygonal(shape(feature.get("geometry")))
        if clip_geom is None:
            raise ValueError(f"Named marginal water '{spec['id']}' has empty geometry after extraction.")
        for split_id in spec.get("clip_open_ocean_ids", ()) or ():
            clip_open_ocean_geometries_by_id.setdefault(str(split_id).strip(), []).append(clip_geom)
    scenario_water_features = clip_tno_open_ocean_split_features(
        build_tno_open_ocean_split_features(
            land_mask_geom=ocean_land_mask_geom,
            supplement_subtract_geometries_by_source_id={
                "marine_atlantic_ocean": atlantic_supplement_subtract_geometries,
            },
        ),
        clip_open_ocean_geometries_by_id,
        open_ocean_component_min_area_by_id,
    )
    scenario_water_features.extend(named_marginal_water_features)
    scenario_water_features.append(congo_feature)
    validate_tno_water_geometries(
        scenario_water_features,
        stage_label="scenario_water_seed_final",
    )
    water_feature_collection = feature_collection_from_features(scenario_water_features)
    water_gdf = geopandas_from_features(water_feature_collection["features"])

    land_without_lake = normalize_polygonal(base_land_union.difference(lake_geom))
    if land_without_lake is None:
        raise ValueError("Scenario land mask lost all land after Congo cut.")
    if atl_sea_union is not None:
        land_without_lake = normalize_polygonal(land_without_lake.difference(atl_sea_union))
    if land_without_lake is None:
        raise ValueError("Scenario land mask lost all land after ATL sea subtraction.")
    land_mask_geom = safe_unary_union([land_without_lake, atl_land_union])
    if land_mask_geom is None:
        raise ValueError("Scenario land mask collapsed to empty geometry.")
    land_mask_gdf = gpd.GeoDataFrame([{
        "id": "tno_1962_land_mask",
        "name": "TNO 1962 Land Mask",
        "geometry": land_mask_geom,
    }], geometry="geometry", crs="EPSG:4326")
    (
        context_land_mask_geom,
        context_land_mask_tolerance,
        context_land_mask_area_delta_ratio,
        context_land_mask_fallback_used,
        context_land_mask_arc_refs,
    ) = (
        build_context_land_mask_geometry(land_mask_geom)
    )
    context_land_mask_gdf = gpd.GeoDataFrame([{
        "id": "tno_1962_context_land_mask",
        "name": "TNO 1962 Context Land Mask",
        "geometry": context_land_mask_geom,
    }], geometry="geometry", crs="EPSG:4326")
    relief_overlays_payload = build_relief_overlays(atlantropa_region_unions, lake_geom)
    bathymetry_payload, bathymetry_diagnostics = build_tno_bathymetry_payload(
        atl_sea_collection,
        atlantropa_region_unions,
    )

    stage_metadata = {
        "generated_at": generated_at,
        "source_root": str(tno_root),
        "hgo_donor_root": str(hgo_root),
        "touched_east_asia_tags": touched_east_asia_tags,
        "touched_south_asia_tags": touched_south_asia_tags,
        "touched_regional_rule_tags": touched_regional_rule_tags,
        "applied_annex_maps": {key: list(value) for key, value in applied_annex_maps.items()},
        "atlantropa_diagnostics": atlantropa_diagnostics,
        "island_replacement_diagnostics": island_replacement_diagnostics,
        "med_water_diagnostics": med_water_diagnostics,
        "antarctic_diagnostics": antarctic_diagnostics,
        "restore_diagnostics": restore_diagnostics,
        "polar_feature_diagnostics": polar_feature_diagnostics,
        "feature_assignment_override_diagnostics": feature_assignment_override_diagnostics,
        "owner_only_backfill_diagnostics": owner_only_backfill_diagnostics,
        "greece_coarse_owner_backfill_diagnostics": greece_coarse_owner_backfill_diagnostics,
        "dev_manual_override_diagnostics": dev_manual_override_diagnostics,
        "atl_feature_ids": sorted(atl_feature_ids),
        "atl_sea_feature_ids": sorted(atl_sea_feature_ids),
        "bathymetry_diagnostics": bathymetry_diagnostics,
        "named_water_diagnostics": named_water_diagnostics,
        "named_water_snapshot_path": f"data/scenarios/{SCENARIO_ID}/{MARINE_REGIONS_NAMED_WATER_SNAPSHOT_FILENAME}",
        "water_regions_provenance_path": f"data/scenarios/{SCENARIO_ID}/{TNO_WATER_REGIONS_PROVENANCE_FILENAME}",
        "context_land_mask_tolerance": context_land_mask_tolerance,
        "context_land_mask_area_delta_ratio": context_land_mask_area_delta_ratio,
        "context_land_mask_fallback_used": context_land_mask_fallback_used,
        "context_land_mask_arc_refs": context_land_mask_arc_refs,
    }

    return {
        "countries_payload": countries_payload,
        "owners_payload": owners_payload,
        "controllers_payload": controllers_payload,
        "cores_payload": cores_payload,
        "manifest_payload": manifest_payload,
        "audit_payload": audit_payload,
        "manual_overrides_payload": manual_overrides_payload,
        "relief_overlays_payload": relief_overlays_payload,
        "bathymetry_payload": bathymetry_payload,
        "named_water_snapshot_payload": named_water_snapshot_payload,
        "water_regions_provenance_payload": water_regions_provenance_payload,
        "scenario_political_gdf": scenario_political_gdf,
        "water_gdf": water_gdf,
        "land_mask_gdf": land_mask_gdf,
        "context_land_mask_gdf": context_land_mask_gdf,
        "atl_feature_ids": sorted(atl_feature_ids),
        "atl_sea_feature_ids": sorted(atl_sea_feature_ids),
        "context_land_mask_tolerance": context_land_mask_tolerance,
        "context_land_mask_area_delta_ratio": context_land_mask_area_delta_ratio,
        "context_land_mask_fallback_used": context_land_mask_fallback_used,
        "context_land_mask_arc_refs": context_land_mask_arc_refs,
        "stage_metadata": stage_metadata,
    }


def build_runtime_topology_state_from_countries_state(state: dict[str, object]) -> dict[str, object]:
    countries_payload = state["countries_payload"]
    owners_payload = state["owners_payload"]
    controllers_payload = state["controllers_payload"]
    cores_payload = state["cores_payload"]
    manifest_payload = state["manifest_payload"]
    audit_payload = state["audit_payload"]
    scenario_political_gdf = state["scenario_political_gdf"]
    water_gdf = state["water_gdf"]
    land_mask_gdf = state["land_mask_gdf"]
    context_land_mask_gdf = state["context_land_mask_gdf"]
    relief_overlays_payload = state["relief_overlays_payload"]
    bathymetry_payload = state.get("bathymetry_payload") or build_empty_bathymetry_payload()
    named_water_snapshot_payload = state.get("named_water_snapshot_payload") or feature_collection_from_features([])
    water_regions_provenance_payload = state.get("water_regions_provenance_payload") or {}
    stage_metadata = state["stage_metadata"]

    runtime_topology_payload = build_runtime_topology_payload(
        scenario_political_gdf,
        water_gdf,
        land_mask_gdf,
        context_land_mask_gdf,
    )
    context_land_mask_arc_refs = estimate_topology_object_arc_refs(runtime_topology_payload, "context_land_mask")
    runtime_water_regions = sanitize_feature_collection_polygonal_geometries(
        topology_object_to_feature_collection(runtime_topology_payload, "scenario_water")
    )
    validate_tno_water_geometries(
        runtime_water_regions,
        stage_label="runtime_topology.scenario_water",
    )
    runtime_special_regions = feature_collection_from_features([])
    relief_overlays_payload = round_geojson_coordinates(relief_overlays_payload, decimals=6)

    recalculate_country_feature_counts(
        countries_payload,
        owners_payload,
        controllers_payload,
        audit_payload,
        manifest_payload,
    )
    rebuild_tno_featured_tags(manifest_payload, countries_payload)

    owner_baseline_hash = stable_json_hash(owners_payload["owners"])
    controller_baseline_hash = stable_json_hash(controllers_payload["controllers"])
    core_baseline_hash = stable_json_hash(cores_payload["cores"])
    generated_at = stage_metadata.get("generated_at") or utc_timestamp()

    manifest_payload["generated_at"] = generated_at
    audit_payload["generated_at"] = generated_at

    owners_payload["baseline_hash"] = owner_baseline_hash
    controllers_payload["baseline_hash"] = controller_baseline_hash
    controllers_payload["owner_baseline_hash"] = owner_baseline_hash
    cores_payload["baseline_hash"] = core_baseline_hash
    manifest_payload["baseline_hash"] = owner_baseline_hash
    manifest_payload["special_regions_url"] = "data/scenarios/tno_1962/special_regions.geojson"
    manifest_payload["water_regions_url"] = "data/scenarios/tno_1962/water_regions.geojson"
    manifest_payload["relief_overlays_url"] = "data/scenarios/tno_1962/relief_overlays.geojson"
    manifest_payload["bathymetry_topology_url"] = "data/scenarios/tno_1962/bathymetry.topo.json"
    manifest_payload["runtime_topology_url"] = "data/scenarios/tno_1962/runtime_topology.topo.json"
    manifest_payload["runtime_bootstrap_topology_url"] = (
        f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME}"
    )
    manifest_payload["releasable_catalog_url"] = "data/releasables/tno_1962.internal.phase1.catalog.json"
    manifest_payload["geo_locale_patch_url"] = f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_GEO_LOCALE_FILENAME}"
    manifest_payload["geo_locale_patch_url_en"] = f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_GEO_LOCALE_EN_FILENAME}"
    manifest_payload["geo_locale_patch_url_zh"] = f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_GEO_LOCALE_ZH_FILENAME}"
    manifest_payload["startup_bundle_url_en"] = (
        f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME}"
    )
    manifest_payload["startup_bundle_url_zh"] = (
        f"data/scenarios/{SCENARIO_ID}/{CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME}"
    )
    manifest_payload["performance_hints"] = {
        "render_profile_default": "balanced",
        "dynamic_borders_default": False,
        "scenario_relief_overlays_default": True,
        "water_regions_default": True,
        "special_regions_default": True,
    }
    manifest_payload["excluded_water_region_groups"] = ["mediterranean"]
    manifest_payload["excluded_water_region_ids"] = list(TNO_EXCLUDED_BASE_WATER_REGION_IDS)

    context_land_mask_tolerance = stage_metadata["context_land_mask_tolerance"]
    context_land_mask_area_delta_ratio = stage_metadata["context_land_mask_area_delta_ratio"]
    context_land_mask_fallback_used = stage_metadata["context_land_mask_fallback_used"]

    runtime_water_region_ids = [
        str(feature.get("properties", {}).get("id") or "").strip()
        for feature in runtime_water_regions.get("features", [])
        if str(feature.get("properties", {}).get("id") or "").strip()
    ]
    scenario_water_seed_ids = collect_gdf_feature_ids(water_gdf)
    runtime_water_region_id_set = set(runtime_water_region_ids)
    if scenario_water_seed_ids != runtime_water_region_id_set:
        raise ValueError(
            "Scenario water seed IDs diverged from runtime topology scenario_water IDs: "
            f"seed={sorted(scenario_water_seed_ids)} runtime={sorted(runtime_water_region_id_set)}"
        )
    named_marginal_water_ids = [spec["id"] for spec in TNO_NAMED_MARGINAL_WATER_SPECS]

    for summary in (
        manifest_payload.get("summary", {}),
        audit_payload.get("summary", {}),
    ):
        summary["feature_count"] = len(owners_payload["owners"])
        summary["tno_special_region_count"] = 0
        summary["tno_water_region_count"] = len(runtime_water_regions.get("features", []))
        summary["tno_named_marginal_water_count"] = len(named_marginal_water_ids)
        summary["tno_relief_overlay_count"] = len(relief_overlays_payload["features"])
        summary["tno_bathymetry_band_count"] = len(
            bathymetry_payload.get("objects", {}).get("bathymetry_bands", {}).get("geometries", [])
        )
        summary["tno_bathymetry_contour_count"] = len(
            bathymetry_payload.get("objects", {}).get("bathymetry_contours", {}).get("geometries", [])
        )
        summary["scenario_runtime_topology_object_count"] = 5
        summary["context_land_mask_tolerance"] = context_land_mask_tolerance
        summary["context_land_mask_area_delta_ratio"] = context_land_mask_area_delta_ratio
        summary["context_land_mask_fallback_used"] = context_land_mask_fallback_used
        summary["context_land_mask_arc_refs"] = context_land_mask_arc_refs

    atlantropa_diagnostics = stage_metadata["atlantropa_diagnostics"]
    med_water_diagnostics = stage_metadata["med_water_diagnostics"]
    diagnostics = audit_payload.setdefault("diagnostics", {})
    sea_coverage_hole_count_by_cluster = {
        region_id: int((med_water_diagnostics.get(region_id) or {}).get("remaining_hole_count") or 0)
        for region_id in ATLANTROPA_REGION_CONFIGS
    }
    fallback_ocean_hit_count_by_cluster = {
        region_id: 0
        for region_id in ATLANTROPA_REGION_CONFIGS
    }
    pixel_fragment_count_by_cluster = {
        region_id: int((atlantropa_diagnostics.get(region_id) or {}).get("pixel_fragment_count") or 0)
        for region_id in ATLANTROPA_REGION_CONFIGS
    }
    diagnostics.pop("derived_from_scenario_id", None)
    diagnostics.update({
        "source_root": stage_metadata["source_root"],
        "hgo_donor_root": stage_metadata["hgo_donor_root"],
        "bookmark_file": "tno_1962.bundle",
        "as_of_date": "1962.1.1.12",
        "scenario_source": "tno_local_bundle_patch_v6",
        "scenario_topology_source": "hgo_donor_and_tno_congo_cut",
        "tno_special_region_ids": [],
        "tno_water_region_ids": runtime_water_region_ids,
        "tno_named_marginal_water_ids": named_marginal_water_ids,
        "special_region_source": "runtime_topology_atl_political_features",
        "water_region_source": "tno_extracted_lake_provinces+tno_ocean_bbox_split+marine_regions_named_waters_snapshot+global_water_region_clones",
        "german_baseline_annex_sets_applied": [
            "Alsace-Lorraine + Luxembourg",
            "North Schleswig + Bornholm",
            "Slovenia",
            "annexed_poland_to_ger",
            "ostland_marijampole_to_ger",
            "transnistria_to_rom",
            "greater_finland_to_fin",
        ],
        "romania_transnistria_applied": True,
        "finland_greater_finland_applied": True,
        "left_unapplied_action_ids": list(UNAPPLIED_ACTION_IDS),
        "east_asia_owner_layer_tags": stage_metadata["touched_east_asia_tags"],
        "south_asia_owner_layer_tags": stage_metadata["touched_south_asia_tags"],
        "regional_owner_layer_tags": stage_metadata["touched_regional_rule_tags"],
        "atlantropa_geometry_source": "hgo_donor_provinces",
        "atlantropa_ownership_model": "dummy_tag_atl",
        "mediterranean_water_mode": "atl_sea_tiles_from_hgo_donor",
        "congo_lake_topology_mode": "true_water_preserved",
        "atlantropa_topology_mode": "atl_land_and_sea_tiles",
        "runtime_topology_path": "data/scenarios/tno_1962/runtime_topology.topo.json",
        "runtime_topology_objects": [
            "political",
            "scenario_water",
            "scenario_special_land",
            "land_mask",
            "context_land_mask",
        ],
        "context_land_mask_tolerance": context_land_mask_tolerance,
        "context_land_mask_area_delta_ratio": context_land_mask_area_delta_ratio,
        "context_land_mask_fallback_used": context_land_mask_fallback_used,
        "context_land_mask_arc_refs": context_land_mask_arc_refs,
        "action_feature_counts": {key: len(value) for key, value in stage_metadata["applied_annex_maps"].items()},
        "atlantropa_region_stats": atlantropa_diagnostics,
        "atlantropa_island_replacement_stats": stage_metadata["island_replacement_diagnostics"],
        "mediterranean_water_region_stats": med_water_diagnostics,
        "named_water_source_diagnostics": stage_metadata.get("named_water_diagnostics", {}),
        "bathymetry_stats": stage_metadata.get("bathymetry_diagnostics", {}),
        "sea_coverage_hole_count_by_cluster": sea_coverage_hole_count_by_cluster,
        "fallback_ocean_hit_count_by_cluster": fallback_ocean_hit_count_by_cluster,
        "pixel_fragment_count_by_cluster": pixel_fragment_count_by_cluster,
        "named_water_snapshot_path": stage_metadata.get("named_water_snapshot_path"),
        "water_regions_provenance_path": stage_metadata.get("water_regions_provenance_path"),
        "water_regions_provenance": water_regions_provenance_payload,
        "atl_feature_count": len(stage_metadata["atl_feature_ids"]),
        "atl_sea_feature_count": len(stage_metadata["atl_sea_feature_ids"]),
        "coastal_restore_stats": stage_metadata["restore_diagnostics"],
        "feature_assignment_override_diagnostics": stage_metadata["feature_assignment_override_diagnostics"],
        "owner_only_backfill_diagnostics": stage_metadata.get(
            "owner_only_backfill_diagnostics",
            {"feature_count": 0, "by_tag": {}},
        ),
        "greece_coarse_owner_backfill_diagnostics": stage_metadata.get(
            "greece_coarse_owner_backfill_diagnostics",
            {"feature_count": 0, "by_tag": {}},
        ),
    })

    stage_metadata["owner_baseline_hash"] = owner_baseline_hash
    stage_metadata["controller_baseline_hash"] = controller_baseline_hash
    stage_metadata["core_baseline_hash"] = core_baseline_hash
    stage_metadata["context_land_mask_arc_refs"] = context_land_mask_arc_refs

    full_state = dict(state)
    full_state.update({
        "runtime_topology_payload": runtime_topology_payload,
        "runtime_bootstrap_topology_payload": build_bootstrap_runtime_topology(runtime_topology_payload),
        "runtime_special_regions": runtime_special_regions,
        "runtime_water_regions": runtime_water_regions,
        "bathymetry_payload": bathymetry_payload,
        "named_water_snapshot_payload": named_water_snapshot_payload,
        "water_regions_provenance_payload": water_regions_provenance_payload,
        "owner_baseline_hash": owner_baseline_hash,
        "context_land_mask_arc_refs": context_land_mask_arc_refs,
        "stage_metadata": stage_metadata,
    })
    return full_state


def build_bundle_state(
    scenario_dir: Path,
    refresh_named_water_snapshot: bool = False,
) -> dict[str, object]:
    return build_runtime_topology_state_from_countries_state(
        build_countries_stage_state(
            scenario_dir,
            refresh_named_water_snapshot=refresh_named_water_snapshot,
        )
    )


def write_countries_stage_checkpoints(
    state: dict[str, object],
    checkpoint_dir: Path,
    scenario_dir: Path = SCENARIO_DIR,
) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_COUNTRIES):
            scenario_bundle_platform.write_countries_stage_checkpoints(
                state,
                checkpoint_dir,
                write_json=write_json,
                gdf_to_feature_collection=gdf_to_feature_collection,
            )


def load_countries_stage_checkpoints(checkpoint_dir: Path) -> dict[str, object]:
    return scenario_bundle_platform.load_countries_stage_checkpoints(
        checkpoint_dir,
        load_json=load_json,
        geopandas_from_features=geopandas_from_features,
    )


def write_runtime_topology_stage_checkpoints(
    state: dict[str, object],
    checkpoint_dir: Path,
    scenario_dir: Path = SCENARIO_DIR,
) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_RUNTIME_TOPOLOGY):
            scenario_bundle_platform.write_runtime_topology_stage_checkpoints(
                state,
                checkpoint_dir,
                write_json=write_json,
                gdf_to_feature_collection=gdf_to_feature_collection,
            )


def ensure_runtime_topology_checkpoints(
    scenario_dir: Path,
    checkpoint_dir: Path,
    refresh_named_water_snapshot: bool = False,
) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_RUNTIME_TOPOLOGY):
            scenario_bundle_platform.ensure_runtime_topology_checkpoints(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=refresh_named_water_snapshot,
                build_countries_stage_state=build_countries_stage_state,
                build_runtime_topology_state_from_countries_state=build_runtime_topology_state_from_countries_state,
                load_countries_stage_checkpoints=load_countries_stage_checkpoints,
                write_runtime_topology_stage_checkpoints=lambda state, path: write_runtime_topology_stage_checkpoints(
                    state,
                    path,
                    scenario_dir=scenario_dir,
                ),
            )


def build_runtime_topology_stage(checkpoint_dir: Path) -> dict[str, object]:
    with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_RUNTIME_TOPOLOGY):
        return build_runtime_topology_state_from_countries_state(load_countries_stage_checkpoints(checkpoint_dir))


def build_geo_locale_stage(
    scenario_dir: Path,
    checkpoint_dir: Path,
    refresh_named_water_snapshot: bool = False,
) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_GEO_LOCALE):
            ensure_runtime_topology_checkpoints(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=refresh_named_water_snapshot,
            )
            build_tno_geo_locale_patch(
                scenario_id=SCENARIO_ID,
                scenario_dir=checkpoint_dir,
                locales_path=ROOT / "data/locales.json",
                manual_overrides_path=scenario_dir / "geo_name_overrides.manual.json",
                reviewed_exceptions_path=scenario_dir / "geo_locale_reviewed_exceptions.json",
                output_path=checkpoint_dir / CHECKPOINT_GEO_LOCALE_FILENAME,
            )
            ensure_geo_locale_variant_checkpoints(checkpoint_dir)
            validate_geo_locale_checkpoint(checkpoint_dir, scenario_dir / "geo_name_overrides.manual.json")


def build_startup_assets_stage(
    scenario_dir: Path,
    checkpoint_dir: Path,
    refresh_named_water_snapshot: bool = False,
) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_STARTUP_ASSETS):
            ensure_runtime_topology_checkpoints(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=refresh_named_water_snapshot,
            )
            validate_geo_locale_checkpoint(checkpoint_dir, scenario_dir / "geo_name_overrides.manual.json")
            build_startup_bootstrap_assets(
                base_topology_path=ROOT / "data/europe_topology.na_v2.json",
                full_locales_path=ROOT / "data/locales.json",
                full_geo_aliases_path=ROOT / "data/geo_aliases.json",
                full_runtime_topology_path=checkpoint_dir / CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
                scenario_geo_patch_path=checkpoint_dir / CHECKPOINT_GEO_LOCALE_FILENAME,
                runtime_bootstrap_output_path=checkpoint_dir / CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME,
                startup_locales_output_path=ROOT / "data/locales.startup.json",
                startup_geo_aliases_output_path=ROOT / "data/geo_aliases.startup.json",
            )
            build_startup_bundles(
                scenario_manifest_path=checkpoint_dir / "manifest.json",
                data_manifest_path=ROOT / "data/manifest.json",
                topology_primary_path=ROOT / "data/europe_topology.json",
                startup_locales_path=ROOT / "data/locales.startup.json",
                geo_aliases_path=ROOT / "data/geo_aliases.startup.json",
                runtime_bootstrap_topology_path=checkpoint_dir / CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME,
                countries_path=checkpoint_dir / "countries.json",
                owners_path=checkpoint_dir / "owners.by_feature.json",
                controllers_path=checkpoint_dir / "controllers.by_feature.json",
                cores_path=checkpoint_dir / "cores.by_feature.json",
                geo_locale_patch_en_path=checkpoint_dir / CHECKPOINT_GEO_LOCALE_EN_FILENAME,
                geo_locale_patch_zh_path=checkpoint_dir / CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
                output_en_path=checkpoint_dir / CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
                output_zh_path=checkpoint_dir / CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
                report_path=STARTUP_BUNDLE_REPORT_PATH,
            )


def _build_manual_sync_file_report(filename: str, scenario_payload: dict, checkpoint_payload: dict) -> dict[str, object]:
    return scenario_bundle_platform.build_manual_sync_file_report(
        filename,
        scenario_payload,
        checkpoint_payload,
        normalize_core_tags=normalize_core_tags,
        normalize_locale_override_entry=normalize_locale_override_entry,
    )


def detect_unsynced_manual_edits(
    scenario_dir: Path,
    checkpoint_dir: Path,
    manual_sources: dict[str, Path],
    policy: str = MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    report_dir: Path | None = None,
    backup_root: Path | None = None,
) -> dict[str, object]:
    return scenario_bundle_platform.detect_unsynced_manual_edits(
        scenario_dir,
        checkpoint_dir,
        manual_sources,
        scenario_id=SCENARIO_ID,
        policy=policy,
        load_json=load_json,
        write_json=write_json,
        utc_timestamp=utc_timestamp,
        normalize_core_tags=normalize_core_tags,
        normalize_locale_override_entry=normalize_locale_override_entry,
        report_dir=report_dir or MANUAL_SYNC_REPORT_DIR,
        backup_root=backup_root or MANUAL_SYNC_BACKUP_ROOT,
        backup_continue_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
        strict_block_policy=MANUAL_SYNC_POLICY_STRICT_BLOCK,
    )


def write_bundle_stage(
    scenario_dir: Path,
    checkpoint_dir: Path,
    publish_scope: str = PUBLISH_SCOPE_POLAR_RUNTIME,
    manual_sync_policy: str = MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_WRITE_BUNDLE):
            if publish_scope in {PUBLISH_SCOPE_SCENARIO_DATA, PUBLISH_SCOPE_ALL}:
                _ensure_scenario_publish_target_offline(scenario_dir)
                scenario_bundle_platform.validate_strict_publish_bundle(
                    checkpoint_dir,
                    publish_scope,
                    scenario_data_scope=PUBLISH_SCOPE_SCENARIO_DATA,
                    all_scope=PUBLISH_SCOPE_ALL,
                    validate_publish_bundle_dir=validate_publish_bundle_dir,
                )
                validate_geo_locale_checkpoint(checkpoint_dir, scenario_dir / "geo_name_overrides.manual.json")
                scenario_bundle_platform.require_startup_stage_checkpoints(checkpoint_dir)
                detect_unsynced_manual_edits(
                    scenario_dir,
                    checkpoint_dir,
                    {
                        "scenario_manual_overrides": scenario_dir / MANUAL_OVERRIDE_FILENAME,
                        "geo_name_overrides": scenario_dir / "geo_name_overrides.manual.json",
                        "district_groups": scenario_dir / "district_groups.manual.json",
                    },
                    policy=manual_sync_policy,
                )
            scenario_bundle_platform.publish_checkpoint_bundle(
                scenario_dir,
                checkpoint_dir,
                publish_scope,
                load_checkpoint_json=load_checkpoint_json,
                write_json=write_json,
            )


def build_chunk_assets_stage(scenario_dir: Path, checkpoint_dir: Path) -> None:
    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=STAGE_CHUNK_ASSETS):
            scenario_bundle_platform.require_chunk_stage_publish_inputs(scenario_dir)
            rebuild_published_scenario_chunk_assets(scenario_dir, checkpoint_dir)


def print_bundle_summary(state: dict[str, object]) -> None:
    runtime_water_regions = state["runtime_water_regions"]
    stage_metadata = state.get("stage_metadata", {}) or {}
    atl_feature_ids = state.get("atl_feature_ids") or stage_metadata.get("atl_feature_ids") or []
    atl_sea_feature_ids = state.get("atl_sea_feature_ids") or stage_metadata.get("atl_sea_feature_ids") or []
    context_land_mask_tolerance = state.get("context_land_mask_tolerance", stage_metadata.get("context_land_mask_tolerance"))
    context_land_mask_area_delta_ratio = state.get(
        "context_land_mask_area_delta_ratio",
        stage_metadata.get("context_land_mask_area_delta_ratio"),
    )
    context_land_mask_fallback_used = state.get(
        "context_land_mask_fallback_used",
        stage_metadata.get("context_land_mask_fallback_used"),
    )
    context_land_mask_arc_refs = state.get("context_land_mask_arc_refs", stage_metadata.get("context_land_mask_arc_refs"))
    print("Rebuilt tno_1962 bundle with HGO donor Atlantropa features.")
    print(f"Owners baseline hash: {state['owner_baseline_hash']}")
    print(f"Political features: {len(state['owners_payload']['owners'])}")
    print(f"ATL land features: {len(atl_feature_ids)}")
    print(f"ATL sea features: {len(atl_sea_feature_ids)}")
    print(f"Water regions: {len(runtime_water_regions['features'])}")
    print(
        "Context land mask:",
        {
            "tolerance": context_land_mask_tolerance,
            "area_delta_ratio": context_land_mask_area_delta_ratio,
            "fallback_used": context_land_mask_fallback_used,
            "arc_refs": context_land_mask_arc_refs,
        },
    )


def main() -> None:
    global _CLI_TNO_ROOT_OVERRIDE
    global _CLI_HGO_ROOT_OVERRIDE
    args = parse_args()
    scenario_dir = Path(args.scenario_dir).resolve()
    checkpoint_dir = Path(args.checkpoint_dir).resolve()
    _CLI_TNO_ROOT_OVERRIDE = Path(args.tno_root).expanduser().resolve() if args.tno_root else None
    _CLI_HGO_ROOT_OVERRIDE = Path(args.hgo_root).expanduser().resolve() if args.hgo_root else None

    with _scenario_build_session_lock(scenario_dir):
        with _checkpoint_build_lock(checkpoint_dir, stage=args.stage):
            if args.stage == STAGE_COUNTRIES:
                state = build_countries_stage_state(
                    scenario_dir,
                    refresh_named_water_snapshot=args.refresh_named_water_snapshot,
                )
                write_countries_stage_checkpoints(state, checkpoint_dir, scenario_dir=scenario_dir)
                print(f"Wrote countries-stage checkpoints to {checkpoint_dir}")
                return

            if args.stage == STAGE_RUNTIME_TOPOLOGY:
                state = build_runtime_topology_stage(checkpoint_dir)
                write_runtime_topology_stage_checkpoints(state, checkpoint_dir, scenario_dir=scenario_dir)
                print_bundle_summary(state)
                return

            if args.stage == STAGE_GEO_LOCALE:
                build_geo_locale_stage(
                    scenario_dir,
                    checkpoint_dir,
                    refresh_named_water_snapshot=args.refresh_named_water_snapshot,
                )
                print(f"Updated geo locale checkpoint: {checkpoint_path(checkpoint_dir, 'geo_locale_patch.json')}")
                return

            if args.stage == STAGE_STARTUP_ASSETS:
                build_startup_assets_stage(
                    scenario_dir,
                    checkpoint_dir,
                    refresh_named_water_snapshot=args.refresh_named_water_snapshot,
                )
                print(f"Updated startup-assets checkpoints in {checkpoint_dir}")
                return

            if args.stage == STAGE_WRITE_BUNDLE:
                write_bundle_stage(
                    scenario_dir,
                    checkpoint_dir,
                    args.publish_scope,
                    manual_sync_policy=args.manual_sync_policy,
                )
                print(f"Published {args.publish_scope} checkpoint bundle to {scenario_dir}")
                return

            if args.stage == STAGE_CHUNK_ASSETS:
                build_chunk_assets_stage(
                    scenario_dir,
                    checkpoint_dir,
                )
                print(f"Rebuilt published chunk assets in {scenario_dir}")
                return

            countries_state = build_countries_stage_state(
                scenario_dir,
                refresh_named_water_snapshot=args.refresh_named_water_snapshot,
            )
            write_countries_stage_checkpoints(countries_state, checkpoint_dir, scenario_dir=scenario_dir)
            state = build_runtime_topology_stage(checkpoint_dir)
            write_runtime_topology_stage_checkpoints(state, checkpoint_dir, scenario_dir=scenario_dir)
            build_geo_locale_stage(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=args.refresh_named_water_snapshot,
            )
            build_startup_assets_stage(
                scenario_dir,
                checkpoint_dir,
                refresh_named_water_snapshot=args.refresh_named_water_snapshot,
            )
            write_bundle_stage(
                scenario_dir,
                checkpoint_dir,
                PUBLISH_SCOPE_ALL,
                manual_sync_policy=args.manual_sync_policy,
            )
            build_chunk_assets_stage(
                scenario_dir,
                checkpoint_dir,
            )
            print_bundle_summary(state)


def pd_concat_geodataframes(gdfs: list[gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    valid = [gdf.copy() for gdf in gdfs if gdf is not None and not gdf.empty]
    if not valid:
        return gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")
    base = gpd.GeoDataFrame(pd_concat_records([gdf.to_dict("records") for gdf in valid]), geometry="geometry", crs="EPSG:4326")
    return base.reset_index(drop=True)


def pd_concat_records(record_sets: list[list[dict]]) -> list[dict]:
    out: list[dict] = []
    for record_set in record_sets:
        out.extend(record_set)
    return out


if __name__ == "__main__":
    main()
