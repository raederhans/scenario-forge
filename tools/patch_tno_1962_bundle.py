from __future__ import annotations

import copy
import csv
import hashlib
import json
import math
import re
import sys
from collections import Counter, deque
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
from rasterio import features as raster_features
from rasterio.transform import Affine
from shapely import affinity
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import snap, unary_union
from topojson import Topology
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.geo.topology import compute_neighbor_graph
from scenario_builder.hoi4.audit import read_bmp24


SCENARIO_ID = "tno_1962"
SCENARIO_DIR = ROOT / f"data/scenarios/{SCENARIO_ID}"
RUNTIME_POLITICAL_PATH = ROOT / "data/europe_topology.runtime_political_v1.json"
FEATURE_MIGRATION_PATH = ROOT / "data/feature-migrations/by_hybrid_v1.json"
REICHSKOMMISSARIAT_ACTIONS_PATH = ROOT / "data/releasables/hoi4_reichskommissariat_boundaries.internal.json"
RELEASABLE_SOURCE_PATH = ROOT / "data/releasables/hoi4_vanilla.internal.phase1.source.json"
HIERARCHY_PATH = ROOT / "data/hierarchy.json"
PALETTE_PATH = ROOT / "data/palettes/hoi4_vanilla.palette.json"
TNO_PALETTE_PATH = ROOT / "data/palettes/tno.palette.json"
REGIONAL_RULE_PACKS: list[tuple[str, Path]] = [
    ("east_asia", ROOT / "data/scenario-rules/tno_1962.east_asia_ownership.manual.json"),
    ("south_asia", ROOT / "data/scenario-rules/tno_1962.south_asia_ownership.manual.json"),
]
HGO_ROOT = ROOT / "historic geographic overhaul"
TNO_ROOT_CANDIDATES = [
    Path("/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901"),
    Path("/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/3583339918"),
]

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
        "simplify_tolerance": 0.012,
        "island_replacement": True,
        "island_merge_distance": 0.028,
        "mainland_component_min_area": 2.8,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.078,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.095,
        "boolean_weld_width": 0.027,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.072,
        "shore_seal_width": 0.078,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.1,
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
        "island_replacement": True,
        "island_merge_distance": 0.024,
        "mainland_component_min_area": 3.0,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.082,
        "gap_fill_min_area": 0.00005,
        "gap_fill_max_area": 0.095,
        "boolean_weld_width": 0.021,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.058,
        "shore_seal_width": 0.072,
        "shore_seal_min_area": 0.00005,
        "shore_seal_max_area": 0.085,
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
        "island_replacement": True,
        "island_merge_distance": 0.03,
        "mainland_component_min_area": 3.2,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.095,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.145,
        "boolean_weld_width": 0.031,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.085,
        "shore_seal_width": 0.08,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.115,
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
            8454: "ALG",
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
            8465: "ALG",
        },
        "control_points": {
            8452: (-5.35, 35.55),
            8458: (1.75, 40.75),
            8460: (3.05, 39.7),
            8462: (2.8, 42.55),
            8463: (1.65, 43.35),
            8464: (5.4, 43.2),
            8465: (6.95, 36.85),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "island_replacement": True,
        "island_merge_distance": 0.03,
        "mainland_component_min_area": 3.5,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.09,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.145,
        "boolean_weld_width": 0.03,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.085,
        "shore_seal_width": 0.08,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.115,
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
        "aoi_bbox": (18.5, 33.4, 30.8, 41.9),
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
            8537: (27.15, 38.45),
            8540: (27.45, 37.1),
            8541: (28.0, 36.15),
            8543: (30.55, 36.75),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "island_replacement": True,
        "island_merge_distance": 0.026,
        "mainland_component_min_area": 2.5,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.082,
        "gap_fill_min_area": 0.00005,
        "gap_fill_max_area": 0.095,
        "boolean_weld_width": 0.024,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.068,
        "shore_seal_width": 0.072,
        "shore_seal_min_area": 0.00005,
        "shore_seal_max_area": 0.09,
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
        ],
    },
    "libya_suez": {
        "feature_group_id": "atlantropa_libya_suez_and_qattara",
        "group_label": "Libya, Cyrenaica and Suez Chain",
        "aoi_bbox": (12.5, 28.0, 35.2, 34.2),
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
            8564: (13.2, 32.85),
            8565: (20.1, 32.05),
            8569: (25.2, 31.55),
            8570: (29.7, 31.0),
            8575: (32.5, 30.55),
            8576: (32.95, 30.4),
        },
        "preserve_margin": 0.03,
        "sea_preserve_margin": 0.03,
        "snap_tolerance": 0.12,
        "simplify_tolerance": 0.012,
        "island_replacement": False,
        "mainland_component_min_area": 3.5,
        "mainland_touch_tolerance": 0.035,
        "gap_fill_width": 0.095,
        "gap_fill_min_area": 0.00006,
        "gap_fill_max_area": 0.11,
        "boolean_weld_width": 0.025,
        "boolean_weld_min_area": 0.00001,
        "boolean_weld_max_area": 0.07,
        "shore_seal_width": 0.075,
        "shore_seal_min_area": 0.00006,
        "shore_seal_max_area": 0.1,
        "causeway_keep_state_ids": [8575, 8576],
        "causeway_trim_state_ids": [8575, 8576],
        "causeway_drop_state_ids": [8572, 8574],
        "causeway_trim_width": 0.12,
        "sea_drop_enclosed_max_area": 0.18,
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
        "bbox": (18.5, 33.2, 30.8, 41.8),
    },
    "libya_suez": {
        "label": "Libya, Alexandria and Suez shoreline",
        "bbox": (12.5, 28.0, 34.8, 33.8),
    },
    "congo": {
        "label": "Congo Lake shoreline recovery ring",
        "bbox": (12.0, -7.0, 26.0, 5.0),
    },
}


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


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
    path.write_text(json.dumps(sanitized, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


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


def load_palette_entries(path: Path = PALETTE_PATH) -> dict[str, dict]:
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

    target_tags = set(TNO_1962_DIRECT_TNO_COLOR_TAGS) | set(TNO_1962_TNO_COLOR_PROXY_TAGS.keys())
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
    audit_payload: dict,
) -> list[str]:
    rule_payload = load_json(rule_path)
    hierarchy_groups = load_hierarchy_groups()
    palette_entries = load_palette_entries()
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
            candidate = candidate.buffer(0)
    except Exception:
        try:
            candidate = geom.buffer(0)
        except Exception:
            candidate = geom
    parts = [part for part in iter_polygon_parts(candidate) if not part.is_empty and part.area > 1e-9]
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
        "atl_join_mode": str(join_mode or ATL_JOIN_MODE_NONE).strip() or ATL_JOIN_MODE_NONE,
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
        cores_payload["cores"][feature_id] = normalized_target
        applied_feature_ids.append(feature_id)
    return applied_feature_ids


def patch_tno_europe_baseline(
    countries_payload: dict,
    owners_payload: dict,
    controllers_payload: dict,
    cores_payload: dict,
) -> dict[str, list[str]]:
    countries = countries_payload.setdefault("countries", {})
    palette_entries = load_palette_entries()
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
    applied["brittany_to_bri"] = assign_feature_bundle(
        feature_ids=TNO_1962_BRITTANY_FEATURE_IDS,
        target_tag="BRI",
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
    countries["BRI"] = build_manual_country_entry(
        tag="BRI",
        existing_entry=countries.get("BRI"),
        palette_entries=palette_entries,
        feature_count=len(TNO_1962_BRITTANY_FEATURE_IDS),
        continent_id="continent_europe",
        continent_label="Europe",
        subregion_id="subregion_western_europe",
        subregion_label="Western Europe",
        base_iso2="FR",
        lookup_iso2="FR",
        provenance_iso2="FR",
        color_hex="#766397",
        notes="TNO 1962 baseline independent Brittany released from France.",
    )
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
            cores_payload["cores"][feature_id] = target_tag
        if target_tag == "GER":
            combined_german_features.extend(action["feature_ids"])

    for feature_ids in GER_PRESET_FEATURE_IDS.values():
        combined_german_features.extend(feature_ids)
    for feature_id in combined_german_features:
        owners_payload["owners"][feature_id] = "GER"
        controllers_payload["controllers"][feature_id] = "GER"
        cores_payload["cores"][feature_id] = "GER"

    applied["italy_french_baseline_restored"] = list(TNO_1962_ITALY_REMOVED_FRENCH_BASELINE_TARGETS.keys())
    for feature_id, target_tag in TNO_1962_ITALY_REMOVED_FRENCH_BASELINE_TARGETS.items():
        owners_payload["owners"][feature_id] = target_tag
        controllers_payload["controllers"][feature_id] = target_tag
        cores_payload["cores"][feature_id] = target_tag

    return applied


def patch_germany_metadata(countries_payload: dict) -> None:
    ger_entry = countries_payload.get("countries", {}).get("GER")
    if not ger_entry:
        raise ValueError("GER entry not found in tno_1962 countries.")
    ger_entry["disabled_regional_preset_names"] = list(GER_PRESET_FEATURE_IDS.keys())
    ger_entry["disabled_regional_preset_reason"] = "Already applied in scenario baseline"


def patch_italy_metadata(countries_payload: dict) -> None:
    ita_entry = countries_payload.get("countries", {}).get("ITA")
    if not ita_entry:
        raise ValueError("ITA entry not found in tno_1962 countries.")
    ita_entry["disabled_regional_preset_names"] = list(TNO_1962_ITALY_DISABLED_PRESET_NAMES)
    ita_entry["disabled_regional_preset_reason"] = "Already applied in scenario baseline"


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
    source_cores: dict[str, str],
) -> tuple[gpd.GeoDataFrame, dict[str, dict[str, str]], dict[str, dict]]:
    source_feature_ids = {str(feature_id).strip() for feature_id in source_owners if str(feature_id).strip()}
    source_rows = runtime_political_full_gdf.loc[
        runtime_political_full_gdf["id"].isin(source_feature_ids)
    ].copy().reset_index(drop=True)
    restored_rows: list[dict] = []
    explicit_assignments: dict[str, dict[str, str]] = {}
    diagnostics: dict[str, dict] = {}
    seen_feature_ids: set[str] = set()

    source_records = source_rows.to_dict("records")
    source_with_assignment = []
    for row in source_records:
        feature_id = str(row.get("id") or "").strip()
        owner = normalize_tag(source_owners.get(feature_id))
        controller = normalize_tag(source_controllers.get(feature_id) or owner)
        core = normalize_tag(source_cores.get(feature_id) or owner)
        if not feature_id or not owner:
            continue
        source_with_assignment.append({
            **row,
            "owner_tag": owner,
            "controller_tag": controller,
            "core_tag": core,
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
                "core": core_tag,
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


def rebuild_feature_maps_from_political_gdf(
    political_gdf: gpd.GeoDataFrame,
    source_feature_id_by_new_id: dict[str, str],
    source_owners: dict[str, str],
    source_controllers: dict[str, str],
    source_cores: dict[str, str],
    explicit_assignments: dict[str, dict[str, str]] | None = None,
) -> tuple[dict, dict, dict]:
    owners: dict[str, str] = {}
    controllers: dict[str, str] = {}
    cores: dict[str, str] = {}
    explicit_assignments = explicit_assignments or {}
    for row in political_gdf.to_dict("records"):
        feature_id = str(row.get("id") or "").strip()
        if not feature_id:
            continue
        explicit = explicit_assignments.get(feature_id)
        source_feature_id = source_feature_id_by_new_id.get(feature_id) or SCENARIO_SPLIT_SUFFIX_RE.sub("", feature_id)
        if not explicit and source_feature_id in explicit_assignments:
            explicit = explicit_assignments[source_feature_id]
        if explicit:
            owner_tag = normalize_tag(explicit.get("owner"))
            controller_tag = normalize_tag(explicit.get("controller")) or owner_tag
            core_tag = normalize_tag(explicit.get("core")) or owner_tag
            if not owner_tag:
                raise ValueError(f"Explicit assignment for {feature_id} is missing owner tag.")
            owners[feature_id] = owner_tag
            controllers[feature_id] = controller_tag
            cores[feature_id] = core_tag
            continue
        if source_feature_id not in source_owners:
            raise KeyError(f"Missing owner mapping for source feature id {source_feature_id} (new id {feature_id}).")
        owners[feature_id] = str(source_owners[source_feature_id]).strip().upper()
        controllers[feature_id] = str(source_controllers.get(source_feature_id) or owners[feature_id]).strip().upper()
        cores[feature_id] = str(source_cores.get(source_feature_id) or owners[feature_id]).strip().upper()
    return (
        {"owners": owners},
        {"controllers": controllers},
        {"cores": cores},
    )


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
                fitted = smooth_polygonal(fitted, simplify_tolerance=float(config.get("simplify_tolerance", 0.01)))
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
                "interactive": True,
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

    for region_id, config in ATLANTROPA_REGION_CONFIGS.items():
        aoi = box(*config["aoi_bbox"])
        local_land = local_land_union(baseline_land_full_gdf, config["aoi_bbox"], padding=2.5)
        if local_land is None:
            continue
        coeffs, _control = build_region_affine_coeffs(config, donor_context)
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
                fitted = smooth_polygonal(
                    fitted,
                    simplify_tolerance=float(config.get("simplify_tolerance", 0.01)),
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
        if not water_parts:
            continue
        enclosed_max_area = float(config.get("sea_drop_enclosed_max_area", 0.0))
        if enclosed_max_area > 0:
            boundary_buffer = aoi.boundary.buffer(0.03)
            pruned_water_parts: list[tuple[int, int, int, object]] = []
            for state_id, province_id, component_index, fitted in water_parts:
                if float(fitted.area) <= enclosed_max_area and not fitted.intersects(boundary_buffer):
                    continue
                pruned_water_parts.append((state_id, province_id, component_index, fitted))
            water_parts = pruned_water_parts
        if not water_parts:
            continue
        region_water = safe_unary_union([geom for *_meta, geom in water_parts])
        if region_water is None:
            continue
        sea_geoms.append(region_water)
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
                "interactive": True,
                "render_as_base_geography": False,
                "owner_tag": ATL_TAG,
                "synthetic_owner": True,
                "donor_state_id": state_id,
                "donor_state_name": get_state_name(donor_context, state_id),
                "donor_province_id": province_id,
                "source_standard": "hgo_donor_water_georef",
            }))
        diagnostics[region_id] = {
            "group_label": config["group_label"],
            "water_state_ids": [int(value) for value in config.get("water_state_ids", [])],
            "bounds": [round(value, 6) for value in region_water.bounds],
            "centroid": [round(region_water.centroid.x, 6), round(region_water.centroid.y, 6)],
            "area": round(float(region_water.area), 6),
            "feature_count": len(water_parts),
            "water_state_feature_counts": {
                str(state_id): int(count)
                for state_id, count in sorted(state_feature_counts.items())
            },
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


def recalculate_country_feature_counts(
    countries_payload: dict,
    owners_payload: dict,
    controllers_payload: dict,
    audit_payload: dict,
    manifest_payload: dict,
) -> None:
    counts = Counter(str(tag).upper() for tag in owners_payload.get("owners", {}).values())
    countries = countries_payload.get("countries", {})
    quality_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    approximate_count = 0
    manual_reviewed_feature_count = 0
    synthetic_owner_feature_count = 0
    for tag, country_entry in countries.items():
        feature_count = int(counts.get(str(tag).upper(), 0))
        country_entry["feature_count"] = feature_count
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
) -> dict:
    keep_columns = [
        "id",
        "name",
        "cntr_code",
        "admin1_group",
        "detail_tier",
        "__source",
        "scenario_id",
        "region_group",
        "atl_surface_kind",
        "interactive",
        "render_as_base_geography",
        "geometry",
    ]
    available_columns = [column for column in keep_columns if column in political_gdf.columns]
    runtime_political_gdf = political_gdf.loc[:, available_columns].copy()
    topo = Topology(
        [runtime_political_gdf, water_gdf, land_mask_gdf],
        object_name=["political", "scenario_water", "land_mask"],
        topology=True,
        prequantize=1_000_000,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    )
    topo_dict = topo.to_dict()
    topo_dict.setdefault("objects", {})["scenario_special_land"] = {
        "type": "GeometryCollection",
        "geometries": [],
    }
    topo_dict["objects"]["land"] = copy.deepcopy(topo_dict["objects"]["land_mask"])
    political_out = topology_object_to_gdf(topo_dict, "political")
    topo_dict["objects"]["political"]["computed_neighbors"] = compute_neighbor_graph(political_out)
    return topo_dict


def main() -> None:
    countries_payload = load_json(SCENARIO_DIR / "countries.json")
    owners_payload = load_json(SCENARIO_DIR / "owners.by_feature.json")
    controllers_payload = load_json(SCENARIO_DIR / "controllers.by_feature.json")
    cores_payload = load_json(SCENARIO_DIR / "cores.by_feature.json")
    manifest_payload = load_json(SCENARIO_DIR / "manifest.json")
    audit_payload = load_json(SCENARIO_DIR / "audit.json")
    current_water_regions = load_json(SCENARIO_DIR / "water_regions.geojson")

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
        cores_payload["cores"] = expand_feature_code_map(
            cores_payload.get("cores", {}),
            valid_feature_ids=valid_runtime_feature_ids,
            migration_map=migration_map,
        )

    applied_annex_maps = patch_baseline_maps(owners_payload, controllers_payload, cores_payload)
    applied_annex_maps.update(
        patch_tno_europe_baseline(countries_payload, owners_payload, controllers_payload, cores_payload)
    )
    patch_germany_metadata(countries_payload)
    patch_italy_metadata(countries_payload)
    touched_regional_rule_tags = {
        rule_pack_name: apply_regional_rules(rule_pack_name, rule_path, countries_payload, owners_payload, audit_payload)
        for rule_pack_name, rule_path in REGIONAL_RULE_PACKS
    }
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
    canonical_source_cores = canonicalize_feature_code_map(cores_payload["cores"])
    restore_gdf, restore_assignments, restore_diagnostics = build_restore_assignments(
        runtime_political_full_gdf,
        canonical_source_owners,
        canonical_source_controllers,
        canonical_source_cores,
    )
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
        pd_concat_geodataframes([scenario_cut_political_gdf, atl_political_gdf, atl_sea_gdf]),
        geometry="geometry",
        crs="EPSG:4326",
    )
    if scenario_political_gdf["id"].duplicated().any():
        duplicates = scenario_political_gdf.loc[scenario_political_gdf["id"].duplicated(), "id"].tolist()[:10]
        raise ValueError(f"Duplicate political feature ids after ATL append: {duplicates}")

    explicit_assignments = {}
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

    countries_payload.setdefault("countries", {})[ATL_TAG] = build_atl_country_entry(
        countries_payload.get("countries", {}).get(ATL_TAG),
        feature_count=sum(
            1
            for feature_id, assignment in explicit_assignments.items()
            if feature_id in {*atl_feature_ids, *atl_sea_feature_ids}
            and normalize_tag(assignment.get("owner")) == ATL_TAG
        ),
    )

    congo_props = {}
    if current_water_regions.get("features"):
        congo_props = dict(current_water_regions["features"][0].get("properties", {}))
    congo_props.update({
        "id": "congo_lake",
        "name": congo_props.get("name") or "Congo Lake",
        "label": congo_props.get("label") or "Congo Lake",
        "water_type": "lake",
        "region_group": "tno_congo_basin",
        "interactive": True,
        "scenario_id": SCENARIO_ID,
        "source_standard": "tno_lake_provinces_contour_extracted",
        "source_province_ids": lake_component_ids,
        "topology_mode": "true_water",
        "render_as_base_geography": True,
    })
    congo_feature = make_feature(lake_geom, congo_props)
    water_feature_collection = feature_collection_from_features([congo_feature])
    water_gdf = geopandas_from_features(water_feature_collection["features"])

    base_land_union = safe_unary_union(runtime_political_full_gdf.geometry.tolist())
    atl_land_union = safe_unary_union(atl_political_gdf.geometry.tolist())
    if base_land_union is None or atl_land_union is None:
        raise ValueError("Unable to assemble land unions for runtime topology.")
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

    runtime_topology_payload = build_runtime_topology_payload(
        scenario_political_gdf,
        water_gdf,
        land_mask_gdf,
    )
    runtime_water_regions = topology_object_to_feature_collection(runtime_topology_payload, "scenario_water")
    runtime_special_regions = feature_collection_from_features([])
    relief_overlays_payload = build_relief_overlays(atlantropa_region_unions, lake_geom)

    recalculate_country_feature_counts(
        countries_payload,
        owners_payload,
        controllers_payload,
        audit_payload,
        manifest_payload,
    )

    owner_baseline_hash = stable_json_hash(owners_payload["owners"])
    controller_baseline_hash = stable_json_hash(controllers_payload["controllers"])
    core_baseline_hash = stable_json_hash(cores_payload["cores"])

    countries_payload["generated_at"] = generated_at
    owners_payload["generated_at"] = generated_at
    controllers_payload["generated_at"] = generated_at
    cores_payload["generated_at"] = generated_at
    audit_payload["generated_at"] = generated_at

    owners_payload["baseline_hash"] = owner_baseline_hash
    controllers_payload["baseline_hash"] = controller_baseline_hash
    controllers_payload["owner_baseline_hash"] = owner_baseline_hash
    cores_payload["baseline_hash"] = core_baseline_hash
    manifest_payload["baseline_hash"] = owner_baseline_hash
    manifest_payload["special_regions_url"] = "data/scenarios/tno_1962/special_regions.geojson"
    manifest_payload["water_regions_url"] = "data/scenarios/tno_1962/water_regions.geojson"
    manifest_payload["relief_overlays_url"] = "data/scenarios/tno_1962/relief_overlays.geojson"
    manifest_payload["runtime_topology_url"] = "data/scenarios/tno_1962/runtime_topology.topo.json"
    manifest_payload["performance_hints"] = {
        "render_profile_default": "balanced",
        "dynamic_borders_default": False,
        "scenario_relief_overlays_default": False,
        "water_regions_default": True,
        "special_regions_default": True,
    }
    manifest_payload["excluded_water_region_groups"] = ["mediterranean"]

    for summary in (
        manifest_payload.get("summary", {}),
        audit_payload.get("summary", {}),
    ):
        summary["feature_count"] = len(owners_payload["owners"])
        summary["tno_special_region_count"] = 0
        summary["tno_water_region_count"] = len(runtime_water_regions.get("features", []))
        summary["tno_relief_overlay_count"] = len(relief_overlays_payload["features"])
        summary["scenario_runtime_topology_object_count"] = 4

    diagnostics = audit_payload.setdefault("diagnostics", {})
    diagnostics.pop("derived_from_scenario_id", None)
    diagnostics.update({
        "source_root": str(tno_root),
        "hgo_donor_root": str(hgo_root),
        "bookmark_file": "tno_1962.bundle",
        "as_of_date": "1962.1.1.12",
        "scenario_source": "tno_local_bundle_patch_v6",
        "scenario_topology_source": "hgo_donor_and_tno_congo_cut",
        "tno_special_region_ids": [],
        "tno_water_region_ids": ["congo_lake"],
        "special_region_source": "runtime_topology_atl_political_features",
        "water_region_source": "tno_extracted_lake_provinces",
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
        "east_asia_owner_layer_tags": touched_east_asia_tags,
        "south_asia_owner_layer_tags": touched_south_asia_tags,
        "regional_owner_layer_tags": touched_regional_rule_tags,
        "atlantropa_geometry_source": "hgo_donor_provinces",
        "atlantropa_ownership_model": "dummy_tag_atl",
        "mediterranean_water_mode": "atl_sea_tiles_from_hgo_donor",
        "congo_lake_topology_mode": "true_water_preserved",
        "atlantropa_topology_mode": "atl_land_and_sea_tiles",
        "runtime_topology_path": "data/scenarios/tno_1962/runtime_topology.topo.json",
        "runtime_topology_objects": ["political", "scenario_water", "scenario_special_land", "land_mask"],
        "action_feature_counts": {key: len(value) for key, value in applied_annex_maps.items()},
        "atlantropa_region_stats": atlantropa_diagnostics,
        "atlantropa_island_replacement_stats": island_replacement_diagnostics,
        "mediterranean_water_region_stats": med_water_diagnostics,
        "atl_feature_count": len(atl_feature_ids),
        "atl_sea_feature_count": len(atl_sea_feature_ids),
        "coastal_restore_stats": restore_diagnostics,
    })

    write_json(SCENARIO_DIR / "countries.json", countries_payload)
    write_json(SCENARIO_DIR / "owners.by_feature.json", owners_payload)
    write_json(SCENARIO_DIR / "controllers.by_feature.json", controllers_payload)
    write_json(SCENARIO_DIR / "cores.by_feature.json", cores_payload)
    write_json(SCENARIO_DIR / "manifest.json", manifest_payload)
    write_json(SCENARIO_DIR / "audit.json", audit_payload)
    write_json(SCENARIO_DIR / "special_regions.geojson", runtime_special_regions)
    write_json(SCENARIO_DIR / "water_regions.geojson", runtime_water_regions)
    write_json(SCENARIO_DIR / "relief_overlays.geojson", relief_overlays_payload)
    write_json(SCENARIO_DIR / "runtime_topology.topo.json", runtime_topology_payload)

    print("Rebuilt tno_1962 bundle with HGO donor Atlantropa features.")
    print(f"Owners baseline hash: {owner_baseline_hash}")
    print(f"Political features: {len(owners_payload['owners'])}")
    print(f"ATL land features: {len(atl_feature_ids)}")
    print(f"ATL sea features: {len(atl_sea_feature_ids)}")
    print(f"Water regions: {len(runtime_water_regions['features'])}")


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
