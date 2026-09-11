import json
import hashlib
import gzip
import sys
import unittest
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import nearest_points, unary_union
from topojson.utils import serialize_as_geojson


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import patch_tno_1962_bundle as tno_bundle
from tools.audit_tno_water_family_refinement import build_report as build_family_refinement_report
from tools.validate_tno_water_geometries import (
    OCEAN_REFINEMENT_PHASE_TARGET_IDS,
    collect_d3_spherical_metrics,
    collect_mediterranean_coverage,
    load_declared_mediterranean_template,
    _topology_objects_to_feature_collections_for_d3,
    build_report_from_collections,
    summarize_failures,
)

SCENARIO_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "water_regions.geojson"
RUNTIME_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "runtime_topology.topo.json"
RUNTIME_BOOTSTRAP_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "runtime_topology.bootstrap.topo.json"
SCENARIO_WATER_SOURCE_REVIEW_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "water_refinement_source_reviews.json"
SCENARIO_WATER_PUBLISHED_PROVENANCE_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "water_regions.provenance.json"
SCENARIO_NAMED_WATER_SNAPSHOT_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "derived" / "marine_regions_named_waters.snapshot.geojson"
SCENARIO_WATER_PROVENANCE_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "derived" / "water_regions.provenance.json"
SCENARIO_MANIFEST_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "manifest.json"
DETAIL_CHUNK_MANIFEST_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "detail_chunks.manifest.json"
STARTUP_BUNDLE_EN_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "startup.bundle.en.json"
STARTUP_BUNDLE_ZH_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "startup.bundle.zh.json"
STARTUP_BUNDLE_EN_GZIP_PATH = STARTUP_BUNDLE_EN_PATH.with_suffix(f"{STARTUP_BUNDLE_EN_PATH.suffix}.gz")
STARTUP_BUNDLE_ZH_GZIP_PATH = STARTUP_BUNDLE_ZH_PATH.with_suffix(f"{STARTUP_BUNDLE_ZH_PATH.suffix}.gz")
TARGET_OPEN_OCEAN_IDS = {
    "tno_northwest_pacific_ocean",
    "tno_northeast_pacific_ocean",
    "tno_west_central_pacific_ocean",
}
TRACKED_INLAND_WATER_IDS = {
    "tno_qyzylorda_inland_water",
}
TRACKED_BASE_GEOGRAPHY_WATER_IDS = {
    "caspian_sea",
    "lake_superior",
    "lake_michigan",
    "lake_huron",
    "lake_erie",
    "lake_ontario",
}
TARGET_OPEN_OCEAN_MAX_COMPONENTS = {
    "tno_northwest_pacific_ocean": 7,
    "tno_northeast_pacific_ocean": 6,
    "tno_west_central_pacific_ocean": 5,
}
MIN_COMPONENT_AREA = 0.05
WORLD_BBOX_WIDTH_THRESHOLD = 300.0
SEAM_DISTANCE_EPSILON = 5e-5
PARENT_CHILD_OVERLAP_EPSILON = 1e-8
MACRO_LAND_OVERLAP_AREA_MIN = 20.0
MACRO_LAND_OVERLAP_RATIO_MAX = 0.08
MACRO_LAND_OVERLAP_ABS_MAX = 1.0
MACRO_INFLATION_LAND_DELTA_MAX = 0.05
BASE_GEOGRAPHY_WATER_LAND_OVERLAP_ABS_MAX = 1e-5

TRACKED_DETAIL_IDS = {
    "tno_severn_estuary",
    "tno_st_georges_channel",
    "tno_st_brides_bay",
    "tno_bay_of_brest",
    "tno_swansea_bay",
    "tno_carmarthen_bay",
    "tno_bridgwater_bay",
    "tno_barnstaple_bideford_bay",
    "tno_gulf_of_riga",
    "tno_bothnian_sea",
    "tno_bay_of_bothnia",
    "tno_gulf_of_finland",
    "tno_central_baltic_sea",
    "tno_the_sound",
    "tno_storebaelt",
    "tno_lillebaelt",
    "tno_wadden_sea",
    "tno_thames_estuary",
    "tno_blackwater_estuary",
    "tno_the_wash",
    "tno_humber_estuary",
    "tno_firth_of_forth",
    "tno_moray_firth",
    "tno_pentland_firth",
    "tno_poole_bay",
    "tno_solent",
    "tno_weymouth_bay",
    "tno_lyme_bay",
    "tno_plymouth_sound",
    "tno_mounts_bay",
    "tno_rye_bay",
    "tno_cardigan_bay",
    "tno_caernarfon_bay",
    "tno_menai_strait",
    "tno_liverpool_bay",
    "tno_morecambe_bay",
    "tno_solway_firth",
    "tno_belfast_lough",
    "tno_seto_naikai",
    "tno_tatarskiy_proliv",
    "tno_taiwan_strait",
    "tno_bo_hai",
    "tno_liaodong_wan",
    "tno_gulf_of_tonkin",
    "tno_gulf_of_thailand",
    "tno_gulf_of_papua",
    "tno_torres_strait",
    "tno_great_barrier_reef_coastal_waters",
    "tno_bass_strait",
    "tno_hudson_strait",
    "tno_anadyrskiy_zaliv",
    "tno_fram_strait",
}

TRACKED_NAMED_WATER_IDS = TRACKED_DETAIL_IDS | {
    "tno_black_sea",
    "tno_sea_of_azov",
    "tno_sea_of_marmara",
    "tno_bosporus_dardanelles",
    "tno_baltic_sea",
    "tno_bay_of_biscay",
    "tno_irish_sea",
    "tno_greenland_sea",
    "tno_norwegian_sea",
    "tno_barents_sea",
    "tno_baffin_bay",
    "tno_mozambique_channel",
    "tno_gulf_of_guinea",
    "tno_ross_sea",
    "tno_bering_sea",
    "tno_gulf_of_alaska",
    "tno_beaufort_sea",
    "tno_labrador_sea",
    "tno_gulf_of_st_lawrence",
    "tno_hudson_bay",
    "tno_caribbean_sea",
    "tno_gulf_of_mexico",
    "tno_sea_of_japan",
    "tno_sea_of_okhotsk",
    "tno_yellow_sea",
    "tno_east_china_sea",
    "tno_south_china_sea",
    "tno_philippine_sea",
    "tno_sulu_sea",
    "tno_celebes_sea",
    "tno_coral_sea",
    "tno_tasman_sea",
    "tno_great_australian_bight",
    "tno_gulf_of_carpentaria",
    "tno_arafura_sea",
    "tno_timor_sea",
    "tno_bay_of_bengal",
    "tno_arabian_sea",
    "tno_red_sea",
    "tno_gulf_of_aden",
    "tno_gulf_of_oman",
    "tno_persian_gulf",
    "tno_andaman_sea",
    "tno_natuna_sea",
    "tno_java_sea",
    "tno_banda_sea",
    "tno_molucca_sea",
    "tno_halmahera_sea",
    "tno_malacca_strait",
    "tno_singapore_strait",
    "tno_makassar_strait",
}

TRACKED_COVERAGE_PROBES = [
    {"label": "gulf_of_riga", "point": (23.46, 57.71), "allowed_ids": {"tno_gulf_of_riga"}},
    {"label": "bothnian_sea", "point": (19.9, 61.2), "allowed_ids": {"tno_bothnian_sea"}},
    {"label": "bothnian_bay", "point": (22.6, 65.55), "allowed_ids": {"tno_bay_of_bothnia"}},
    {"label": "gulf_of_finland", "point": (26.2, 59.95), "allowed_ids": {"tno_gulf_of_finland"}},
    {"label": "central_baltic", "point": (18.916123, 56.76805), "allowed_ids": {"tno_central_baltic_sea"}},
    {"label": "the_sound", "point": (12.73, 55.95), "allowed_ids": {"tno_the_sound"}},
    {"label": "storebaelt", "point": (11.03, 55.25), "allowed_ids": {"tno_storebaelt"}},
    {"label": "lillebaelt", "point": (9.84, 55.34), "allowed_ids": {"tno_lillebaelt"}},
    {"label": "st_georges_channel", "point": (-5.45, 52.0), "allowed_ids": {"tno_st_georges_channel"}},
    {"label": "severn_estuary", "point": (-2.74, 51.55), "allowed_ids": {"tno_severn_estuary"}},
    {"label": "st_brides_bay", "point": (-5.12, 51.79), "allowed_ids": {"tno_st_brides_bay"}},
    {"label": "bay_of_brest", "point": (-4.496007, 48.334829), "allowed_ids": {"tno_bay_of_brest"}},
    {"label": "bay_of_biscay", "point": (-4.65, 45.2), "allowed_ids": {"tno_bay_of_biscay"}},
    {"label": "swansea_bay", "point": (-3.88, 51.54), "allowed_ids": {"tno_swansea_bay"}},
    {"label": "carmarthen_bay", "point": (-4.41, 51.68), "allowed_ids": {"tno_carmarthen_bay"}},
    {"label": "bridgwater_bay", "point": (-3.18, 51.25), "allowed_ids": {"tno_bridgwater_bay"}},
    {"label": "barnstaple_bideford_bay", "point": (-4.312879, 51.065519), "allowed_ids": {"tno_barnstaple_bideford_bay"}},
    {"label": "wadden_sea", "point": (8.959014, 53.886707), "allowed_ids": {"tno_wadden_sea"}},
    {"label": "thames_estuary", "point": (1.002599, 51.430599), "allowed_ids": {"tno_thames_estuary"}},
    {"label": "blackwater_estuary", "point": (0.970901, 51.769569), "allowed_ids": {"tno_blackwater_estuary"}},
    {"label": "the_wash", "point": (0.31, 52.95), "allowed_ids": {"tno_the_wash"}},
    {"label": "humber_estuary", "point": (0.02, 53.60), "allowed_ids": {"tno_humber_estuary"}},
    {"label": "firth_of_forth", "point": (-3.05, 56.0), "allowed_ids": {"tno_firth_of_forth"}},
    {"label": "moray_firth", "point": (-3.44, 57.75), "allowed_ids": {"tno_moray_firth"}},
    {"label": "pentland_firth", "point": (-3.02, 58.75), "allowed_ids": {"tno_pentland_firth"}},
    {"label": "poole_bay", "point": (-1.86, 50.62), "allowed_ids": {"tno_poole_bay"}},
    {"label": "solent", "point": (-1.23, 50.77), "allowed_ids": {"tno_solent"}},
    {"label": "weymouth_bay", "point": (-2.327569, 50.589111), "allowed_ids": {"tno_weymouth_bay"}},
    {"label": "lyme_bay", "point": (-2.969261, 50.548571), "allowed_ids": {"tno_lyme_bay"}},
    {"label": "plymouth_sound", "point": (-4.149958, 50.34827), "allowed_ids": {"tno_plymouth_sound"}},
    {"label": "mounts_bay", "point": (-5.452821, 50.046406), "allowed_ids": {"tno_mounts_bay"}},
    {"label": "rye_bay", "point": (0.82, 50.90), "allowed_ids": {"tno_rye_bay"}},
    {"label": "cardigan_bay", "point": (-4.50, 52.43), "allowed_ids": {"tno_cardigan_bay"}},
    {"label": "caernarfon_bay", "point": (-4.45, 53.08), "allowed_ids": {"tno_caernarfon_bay"}},
    {"label": "menai_strait", "point": (-4.03, 53.26), "allowed_ids": {"tno_menai_strait"}},
    {"label": "irish_sea", "point": (-5.0, 53.4), "allowed_ids": {"tno_irish_sea"}},
    {"label": "liverpool_bay", "point": (-3.26, 53.46), "allowed_ids": {"tno_liverpool_bay"}},
    {"label": "morecambe_bay", "point": (-3.03, 54.05), "allowed_ids": {"tno_morecambe_bay"}},
    {"label": "solway_firth", "point": (-3.47, 54.93), "allowed_ids": {"tno_solway_firth"}},
    {"label": "belfast_lough", "point": (-5.78, 54.68), "allowed_ids": {"tno_belfast_lough"}},
    {"label": "black_sea", "point": (34.7, 43.4), "allowed_ids": {"tno_black_sea"}},
    {"label": "sea_of_azov", "point": (36.85, 46.1), "allowed_ids": {"tno_sea_of_azov"}},
    {"label": "sea_of_marmara", "point": (27.7, 40.75), "allowed_ids": {"tno_sea_of_marmara"}},
    {"label": "greenland_sea", "point": (-14.183779, 76.629887), "allowed_ids": {"tno_greenland_sea"}},
    {"label": "fram_strait", "point": (-1.5, 76.724494), "allowed_ids": {"tno_fram_strait"}},
    {"label": "norwegian_sea", "point": (1.14, 68.58), "allowed_ids": {"tno_norwegian_sea"}},
    {"label": "barents_sea", "point": (43.11, 74.17), "allowed_ids": {"tno_barents_sea"}},
    {"label": "baffin_bay", "point": (-67.12, 74.50), "allowed_ids": {"tno_baffin_bay"}},
    {"label": "mozambique_channel", "point": (40.88, -19.30), "allowed_ids": {"tno_mozambique_channel"}},
    {"label": "gulf_of_guinea", "point": (3.05, 3.25), "allowed_ids": {"tno_gulf_of_guinea"}},
    {"label": "ross_sea", "point": (-168.0911, -78.5673), "allowed_ids": {"tno_ross_sea"}},
    {"label": "weddell_sea", "point": (-37.425662, -68.672356), "allowed_ids": {"tno_weddell_sea"}},
    {"label": "scotia_sea", "point": (-48.964392, -60.640768), "allowed_ids": {"tno_scotia_sea"}},
    {"label": "bering_sea", "point": (-170.8823, 58.7917), "allowed_ids": {"tno_bering_sea"}},
    {"label": "anadyrskiy_zaliv", "point": (-176.994996, 64.436176), "allowed_ids": {"tno_anadyrskiy_zaliv"}},
    {"label": "gulf_of_alaska", "point": (-147.3894, 57.3575), "allowed_ids": {"tno_gulf_of_alaska"}},
    {"label": "beaufort_sea", "point": (-136.1302, 72.7404), "allowed_ids": {"tno_beaufort_sea"}},
    {"label": "labrador_sea", "point": (-52.7329, 53.9977), "allowed_ids": {"tno_labrador_sea"}},
    {"label": "gulf_of_st_lawrence", "point": (-61.3940, 48.9139), "allowed_ids": {"tno_gulf_of_st_lawrence"}},
    {"label": "hudson_bay", "point": (-86.1234, 60.2827), "allowed_ids": {"tno_hudson_bay"}},
    {"label": "hudson_strait", "point": (-71.0908, 61.8610), "allowed_ids": {"tno_hudson_strait"}},
    {"label": "caribbean_sea", "point": (-72.7250, 15.5764), "allowed_ids": {"tno_caribbean_sea"}},
    {"label": "gulf_of_mexico", "point": (-89.2272, 25.5858), "allowed_ids": {"tno_gulf_of_mexico"}},
    {"label": "sea_of_okhotsk", "point": (147.8, 53.9), "allowed_ids": {"tno_sea_of_okhotsk"}},
    {"label": "bo_hai", "point": (119.55, 39.1), "allowed_ids": {"tno_bo_hai"}},
    {"label": "liaodong_wan", "point": (121.55, 40.78), "allowed_ids": {"tno_liaodong_wan"}},
    {"label": "taiwan_strait", "point": (119.9, 24.4), "allowed_ids": {"tno_taiwan_strait"}},
    {"label": "seto_naikai", "point": (133.5, 34.2), "allowed_ids": {"tno_seto_naikai"}},
    {"label": "tatarskiy_proliv", "point": (141.4, 50.9), "allowed_ids": {"tno_tatarskiy_proliv"}},
    {"label": "gulf_of_tonkin", "point": (108.3, 20.35), "allowed_ids": {"tno_gulf_of_tonkin"}},
    {"label": "gulf_of_thailand", "point": (101.2, 11.15), "allowed_ids": {"tno_gulf_of_thailand"}},
    {"label": "natuna_sea", "point": (106.7592, 0.7869), "allowed_ids": {"tno_natuna_sea"}},
    {"label": "philippine_sea", "point": (134.8, 18.4), "allowed_ids": {"tno_philippine_sea"}},
    {"label": "malacca_strait", "point": (99.7, 4.2), "allowed_ids": {"tno_malacca_strait"}},
    {"label": "singapore_strait", "point": (104.166, 1.2415), "allowed_ids": {"tno_singapore_strait"}},
    {"label": "java_sea", "point": (112.0, -5.8), "allowed_ids": {"tno_java_sea"}},
    {"label": "makassar_strait", "point": (117.8, -1.8), "allowed_ids": {"tno_makassar_strait"}},
    {"label": "sulu_sea", "point": (120.9, 9.7), "allowed_ids": {"tno_sulu_sea"}},
    {"label": "celebes_sea", "point": (121.9, 4.9), "allowed_ids": {"tno_celebes_sea"}},
    {"label": "molucca_sea", "point": (126.1, 0.9), "allowed_ids": {"tno_molucca_sea"}},
    {"label": "halmahera_sea", "point": (128.3, 1.5), "allowed_ids": {"tno_halmahera_sea"}},
    {"label": "banda_sea", "point": (128.0, -5.4), "allowed_ids": {"tno_banda_sea"}},
    {"label": "arabian_sea", "point": (64.4, 16.6), "allowed_ids": {"tno_arabian_sea"}},
    {"label": "gulf_of_aden", "point": (47.3, 12.3), "allowed_ids": {"tno_gulf_of_aden"}},
    {"label": "qyzylorda_inland_water", "point": (63.38183, 45.97802), "allowed_ids": {"tno_qyzylorda_inland_water"}},
    {"label": "gulf_of_oman", "point": (58.3, 24.2), "allowed_ids": {"tno_gulf_of_oman"}},
    {"label": "persian_gulf", "point": (51.7, 26.8), "allowed_ids": {"tno_persian_gulf"}},
    {"label": "red_sea", "point": (38.5, 20.5), "allowed_ids": {"tno_red_sea"}},
    {"label": "gulf_of_carpentaria", "point": (138.4, -14.1), "allowed_ids": {"tno_gulf_of_carpentaria"}},
    {"label": "arafura_sea", "point": (132.6, -9.4), "allowed_ids": {"tno_arafura_sea"}},
    {"label": "timor_sea", "point": (125.5, -11.4), "allowed_ids": {"tno_timor_sea"}},
    {"label": "coral_sea", "point": (151.6, -18.4), "allowed_ids": {"tno_coral_sea"}},
    {"label": "gulf_of_papua", "point": (145.6, -8.7), "allowed_ids": {"tno_gulf_of_papua"}},
    {"label": "torres_strait", "point": (142.2, -10.1), "allowed_ids": {"tno_torres_strait"}},
    {
        "label": "great_barrier_reef_coastal_waters",
        "point": (146.3407, -17.4308),
        "allowed_ids": {"tno_great_barrier_reef_coastal_waters"},
    },
    {"label": "tasman_sea", "point": (160.0, -31.8), "allowed_ids": {"tno_tasman_sea"}},
    {"label": "bass_strait", "point": (146.9, -39.1), "allowed_ids": {"tno_bass_strait"}},
    {"label": "great_australian_bight", "point": (131.0, -34.0), "allowed_ids": {"tno_great_australian_bight"}},
]

TRACKED_SEAM_PAIRS = [
    ("tno_celtic_sea", "tno_northeast_atlantic_ocean"),
    ("tno_bay_of_biscay", "tno_northeast_atlantic_ocean"),
    ("tno_celtic_sea", "tno_english_channel"),
    ("tno_irish_sea", "tno_northeast_atlantic_ocean"),
    ("tno_irish_sea", "tno_north_channel"),
    ("tno_irish_sea", "tno_st_georges_channel"),
    ("tno_irish_sea", "tno_st_brides_bay"),
    ("tno_baltic_sea", "tno_kattegat"),
    ("tno_baltic_sea", "tno_the_sound"),
    ("tno_baltic_sea", "tno_storebaelt"),
    ("tno_baltic_sea", "tno_lillebaelt"),
    ("tno_baltic_sea", "tno_central_baltic_sea"),
    ("tno_baltic_sea", "tno_gulf_of_riga"),
    ("tno_baltic_sea", "tno_gulf_of_finland"),
    ("tno_baltic_sea", "tno_bothnian_sea"),
    # Bay of Bothnia is separated from the Baltic parent remnant by Bothnian Sea.
    ("tno_north_sea", "tno_wadden_sea"),
    ("tno_north_sea", "tno_thames_estuary"),
    ("tno_north_sea", "tno_blackwater_estuary"),
    ("tno_north_sea", "tno_the_wash"),
    ("tno_black_sea", "tno_sea_of_azov"),
    ("tno_bosporus_dardanelles", "tno_sea_of_marmara"),
    ("tno_greenland_sea", "tno_norwegian_sea"),
    ("tno_greenland_sea", "tno_fram_strait"),
    ("tno_norwegian_sea", "tno_northeast_atlantic_ocean"),
    ("tno_barents_sea", "tno_western_arctic_ocean"),
    ("tno_mozambique_channel", "tno_western_indian_ocean"),
    ("tno_english_channel", "tno_strait_of_dover"),
    ("tno_english_channel", "tno_poole_bay"),
    ("tno_english_channel", "tno_solent"),
    ("tno_english_channel", "tno_weymouth_bay"),
    ("tno_english_channel", "tno_lyme_bay"),
    ("tno_english_channel", "tno_plymouth_sound"),
    ("tno_english_channel", "tno_mounts_bay"),
    ("tno_irish_sea", "tno_cardigan_bay"),
    ("tno_irish_sea", "tno_liverpool_bay"),
    ("tno_irish_sea", "tno_solway_firth"),
    ("tno_bering_sea", "tno_northeast_pacific_ocean"),
    ("tno_bering_sea", "tno_gulf_of_alaska"),
    ("tno_bering_sea", "tno_anadyrskiy_zaliv"),
    ("tno_gulf_of_alaska", "tno_northeast_pacific_ocean"),
    ("tno_beaufort_sea", "tno_western_arctic_ocean"),
    ("tno_labrador_sea", "tno_northwest_atlantic_ocean"),
    ("tno_gulf_of_st_lawrence", "tno_northwest_atlantic_ocean"),
    ("tno_caribbean_sea", "tno_west_central_atlantic_ocean"),
    ("tno_caribbean_sea", "tno_gulf_of_mexico"),
    ("tno_arabian_sea", "tno_gulf_of_aden"),
    ("tno_arabian_sea", "tno_gulf_of_oman"),
    ("tno_gulf_of_oman", "tno_persian_gulf"),
    ("tno_red_sea", "tno_gulf_of_aden"),
    ("tno_ross_sea", "tno_south_pacific_antarctic_ocean"),
    ("tno_weddell_sea", "tno_south_atlantic_antarctic_ocean"),
    ("tno_scotia_sea", "tno_south_atlantic_antarctic_ocean"),
    ("tno_yellow_sea", "tno_bo_hai"),
    ("tno_bo_hai", "tno_liaodong_wan"),
    ("tno_east_china_sea", "tno_taiwan_strait"),
    ("tno_south_china_sea", "tno_gulf_of_tonkin"),
    ("tno_south_china_sea", "tno_gulf_of_thailand"),
    ("tno_south_china_sea", "tno_natuna_sea"),
    ("tno_south_china_sea", "tno_singapore_strait"),
    ("tno_south_china_sea", "tno_sulu_sea"),
    ("tno_andaman_sea", "tno_malacca_strait"),
    ("tno_malacca_strait", "tno_singapore_strait"),
    ("tno_philippine_sea", "tno_sulu_sea"),
    ("tno_philippine_sea", "tno_celebes_sea"),
    ("tno_philippine_sea", "tno_molucca_sea"),
    ("tno_philippine_sea", "tno_halmahera_sea"),
    ("tno_java_sea", "tno_makassar_strait"),
    ("tno_celebes_sea", "tno_makassar_strait"),
    ("tno_banda_sea", "tno_molucca_sea"),
    ("tno_molucca_sea", "tno_halmahera_sea"),
    ("tno_molucca_sea", "tno_celebes_sea"),
    ("tno_molucca_sea", "tno_banda_sea"),
    ("tno_coral_sea", "tno_gulf_of_papua"),
    ("tno_coral_sea", "tno_torres_strait"),
    ("tno_coral_sea", "tno_great_barrier_reef_coastal_waters"),
    ("tno_tasman_sea", "tno_bass_strait"),
    ("tno_arafura_sea", "tno_gulf_of_carpentaria"),
    ("tno_arafura_sea", "tno_timor_sea"),
]
def _load_scenario_water_features():
    payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding="utf-8"))
    return payload.get("features", [])


def _load_runtime_water_features():
    payload = json.loads(RUNTIME_WATER_PATH.read_text(encoding="utf-8"))
    feature_collection = serialize_as_geojson(payload, objectname="scenario_water")
    return feature_collection.get("features", [])


def _load_runtime_bootstrap_water_features():
    payload = json.loads(RUNTIME_BOOTSTRAP_WATER_PATH.read_text(encoding="utf-8"))
    feature_collection = serialize_as_geojson(payload, objectname="scenario_water")
    return feature_collection.get("features", [])


def _load_runtime_political_features():
    payload = json.loads(RUNTIME_WATER_PATH.read_text(encoding="utf-8"))
    feature_collection = serialize_as_geojson(payload, objectname="political")
    return feature_collection.get("features", [])


def _load_runtime_topology_feature_collection(object_name):
    payload = json.loads(RUNTIME_WATER_PATH.read_text(encoding="utf-8"))
    return serialize_as_geojson(payload, objectname=object_name)


def _load_runtime_topology_feature_collections_for_d3(object_names):
    payload = json.loads(RUNTIME_WATER_PATH.read_text(encoding="utf-8"))
    return _topology_objects_to_feature_collections_for_d3(payload, object_names)


def _load_named_water_snapshot_features():
    payload = json.loads(SCENARIO_NAMED_WATER_SNAPSHOT_PATH.read_text(encoding="utf-8"))
    return payload.get("features", [])


def _load_water_provenance():
    return json.loads(SCENARIO_WATER_PROVENANCE_PATH.read_text(encoding="utf-8"))


def _load_water_chunk_features():
    features = []
    chunks_dir = ROOT / "data" / "scenarios" / "tno_1962" / "chunks"
    for path in sorted(chunks_dir.glob("water.*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        features.extend(payload.get("features", []) or [])
    return features


def _load_water_manifest_chunk_feature_ids():
    feature_ids = set()
    manifest = json.loads(DETAIL_CHUNK_MANIFEST_PATH.read_text(encoding="utf-8"))
    for chunk in manifest.get("chunks", []):
        if chunk.get("layer") != "water":
            continue
        chunk_id = str(chunk.get("id") or "")
        chunk_url = str(chunk.get("url") or "")
        assert chunk_id.startswith("water.")
        assert chunk_url.startswith("data/scenarios/tno_1962/chunks/")
        payload = json.loads((ROOT / chunk_url).read_text(encoding="utf-8"))
        assert payload.get("type") == "FeatureCollection"
        for feature in payload.get("features", []) or []:
            feature_ids.add(str(feature.get("properties", {}).get("id") or ""))
    return feature_ids


def _load_scenario_manifest():
    return json.loads(SCENARIO_MANIFEST_PATH.read_text(encoding="utf-8"))


def _load_startup_bundle(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _load_startup_bundle_gzip(path: Path):
    return json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _feature_map(features):
    return {
        str(feature.get("properties", {}).get("id") or ""): feature
        for feature in features
        if str(feature.get("properties", {}).get("id") or "").strip()
    }


def _iter_polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        parts = []
        for child in geometry.geoms:
            parts.extend(_iter_polygon_parts(child))
        return parts
    return []


def _bbox_width(geometry):
    min_x, _, max_x, _ = geometry.bounds
    return max_x - min_x


def _polygonal_vertex_count(geometry):
    total = 0
    for part in _iter_polygon_parts(geometry):
        total += len(part.exterior.coords)
        total += sum(len(ring.coords) for ring in part.interiors)
    return total


def _maximum_polygonal_coordinate_step(geometry):
    maximum = 0.0
    for part in _iter_polygon_parts(geometry):
        for ring in (part.exterior, *part.interiors):
            coordinates = list(ring.coords)
            for start, end in zip(coordinates, coordinates[1:]):
                longitude_step = min(
                    abs(end[0] - start[0]),
                    abs(end[0] - start[0] - 360.0),
                    abs(end[0] - start[0] + 360.0),
                )
                maximum = max(maximum, longitude_step, abs(end[1] - start[1]))
    return maximum


def _load_runtime_land_union():
    geometries = [
        shape(feature["geometry"])
        for feature in _load_runtime_political_features()
        if feature.get("geometry")
    ]
    return unary_union(geometries)


def _load_runtime_object_union(object_name):
    feature_collection = _load_runtime_topology_feature_collection(object_name)
    geometries = [
        shape(feature["geometry"])
        for feature in feature_collection.get("features", [])
        if feature.get("geometry")
    ]
    return unary_union(geometries)


def test_tno_scenario_water_geometries_are_all_valid():
    invalid_features = []
    for feature in _load_scenario_water_features():
        props = feature.get("properties", {})
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            invalid_features.append(str(props.get("id") or ""))
    assert invalid_features == []


def test_problematic_pacific_open_oceans_are_pruned_to_large_components():
    feature_map = {
        str(feature.get("properties", {}).get("id") or ""): feature
        for feature in _load_scenario_water_features()
    }
    for feature_id in TARGET_OPEN_OCEAN_IDS:
        feature = feature_map[feature_id]
        geometry = shape(feature["geometry"])
        parts = _iter_polygon_parts(geometry)
        assert parts, feature_id
        assert len(parts) <= TARGET_OPEN_OCEAN_MAX_COMPONENTS[feature_id], feature_id
        assert min(part.area for part in parts) >= MIN_COMPONENT_AREA - 1e-9, feature_id


def test_problematic_pacific_open_ocean_split_specs_preserve_pruning_contract():
    child_specs = {
        str(child_spec.get("id") or ""): child_spec
        for split_spec in tno_bundle.TNO_OPEN_OCEAN_SPLIT_SPECS
        for child_spec in split_spec.get("children", ())
    }
    for feature_id in TARGET_OPEN_OCEAN_IDS:
        assert float(child_specs[feature_id].get("component_min_area") or 0.0) == MIN_COMPONENT_AREA


def test_tno_scenario_water_parts_do_not_have_world_sized_bboxes():
    offending = []
    for feature in _load_scenario_water_features():
        feature_id = str(feature.get("properties", {}).get("id") or "")
        geometry = shape(feature["geometry"])
        for part in _iter_polygon_parts(geometry):
            if _bbox_width(part) > WORLD_BBOX_WIDTH_THRESHOLD:
                offending.append(feature_id)
    assert offending == []


def test_tno_runtime_land_masks_do_not_have_world_sized_bboxes():
    offending = []
    for object_name in ("land_mask", "context_land_mask"):
        feature_collection = _load_runtime_topology_feature_collection(object_name)
        for feature in feature_collection.get("features", []) or []:
            geometry = shape(feature["geometry"])
            for part in _iter_polygon_parts(geometry):
                if _bbox_width(part) > WORLD_BBOX_WIDTH_THRESHOLD:
                    offending.append(f"{object_name}:{feature.get('properties', {}).get('id')}")
    assert offending == []


def test_tno_water_and_runtime_masks_are_d3_spherical_safe():
    runtime_collections = _load_runtime_topology_feature_collections_for_d3([
        "scenario_water",
        "land_mask",
        "context_land_mask",
    ])
    metrics = collect_d3_spherical_metrics({
        "source": {"type": "FeatureCollection", "features": _load_scenario_water_features()},
        "runtime": runtime_collections["scenario_water"],
        "runtime_land_mask": runtime_collections["land_mask"],
        "runtime_context_land_mask": runtime_collections["context_land_mask"],
    })
    failures = []
    for label, section in metrics.items():
        invalid_features = section.get("invalidFeatures") or []
        invalid_parts = section.get("invalidParts") or []
        if invalid_features or invalid_parts:
            failures.append(
                f"{label}: features={invalid_features[:3]} parts={invalid_parts[:3]}"
            )
    assert failures == []


def test_large_marine_macros_do_not_overrun_land_mask():
    land_union = _load_runtime_land_union()
    failures = []
    for feature in _load_scenario_water_features():
        props = feature.get("properties", {})
        if str(props.get("region_group") or "").strip() != "marine_macro":
            continue
        geometry = shape(feature["geometry"])
        area = float(geometry.area)
        if area < MACRO_LAND_OVERLAP_AREA_MIN:
            continue
        land_overlap_area = float(geometry.intersection(land_union).area)
        land_overlap_ratio = land_overlap_area / area
        if (
            land_overlap_ratio > MACRO_LAND_OVERLAP_RATIO_MAX
            and land_overlap_area > MACRO_LAND_OVERLAP_ABS_MAX
        ):
            failures.append(
                f"{props.get('id')} land_overlap_ratio={land_overlap_ratio:.6f} "
                f"land_overlap_area={land_overlap_area:.6f} area={area:.6f}"
            )
    assert failures == []


def test_large_marine_macros_do_not_increase_land_overlap_far_beyond_snapshot_sources():
    land_union = _load_runtime_land_union()
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    failures = []
    for feature in _load_scenario_water_features():
        props = feature.get("properties", {})
        feature_id = str(props.get("id") or "").strip()
        if str(props.get("region_group") or "").strip() != "marine_macro":
            continue
        snapshot_feature = snapshot_feature_map.get(feature_id)
        if snapshot_feature is None:
            continue
        source_geometry = shape(snapshot_feature["geometry"])
        source_area = float(source_geometry.area)
        if source_area < MACRO_LAND_OVERLAP_AREA_MIN:
            continue
        final_geometry = shape(feature["geometry"])
        final_area = float(final_geometry.area)
        if source_area <= 0.0 or final_area <= 0.0:
            continue
        source_land_overlap_ratio = float(source_geometry.intersection(land_union).area) / source_area
        final_land_overlap_ratio = float(final_geometry.intersection(land_union).area) / final_area
        if (final_land_overlap_ratio - source_land_overlap_ratio) > MACRO_INFLATION_LAND_DELTA_MAX:
            failures.append(
                f"{feature_id} source_land_overlap_ratio={source_land_overlap_ratio:.6f} "
                f"final_land_overlap_ratio={final_land_overlap_ratio:.6f}"
            )
    assert failures == []


def test_tno_north_channel_uses_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_north_channel"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    assert props.get("source_standard") == "marine_regions_seavox_v19"
    assert _polygonal_vertex_count(geometry) >= 120


def test_tno_scotia_sea_uses_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    feature = feature_map["tno_scotia_sea"]
    snapshot_feature = snapshot_feature_map["tno_scotia_sea"]
    props = feature.get("properties", {})
    snapshot_props = snapshot_feature.get("properties", {})
    geometry = shape(feature["geometry"])
    snapshot_geometry = shape(snapshot_feature["geometry"])
    assert props.get("source_standard") == "marine_regions_seavox_v19"
    assert snapshot_props.get("source_query") == "mrgid_sr='24034'"
    assert snapshot_props.get("source_record_ids") == ["mrgid_r:23624", "mrgid_sr:24034"]
    assert _polygonal_vertex_count(geometry) >= 300
    assert _maximum_polygonal_coordinate_step(geometry) <= 0.25 + 1e-9
    assert geometry.symmetric_difference(snapshot_geometry).area / snapshot_geometry.area <= 0.005


def test_tno_weddell_sea_uses_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    feature = feature_map["tno_weddell_sea"]
    snapshot_feature = snapshot_feature_map["tno_weddell_sea"]
    props = feature.get("properties", {})
    snapshot_props = snapshot_feature.get("properties", {})
    geometry = shape(feature["geometry"])
    snapshot_geometry = shape(snapshot_feature["geometry"])
    assert props.get("source_standard") == "marine_regions_seavox_v19"
    assert snapshot_props.get("source_query") == "mrgid_sr='24035'"
    assert snapshot_props.get("source_record_ids") == ["mrgid_r:23624", "mrgid_sr:24035"]
    assert _polygonal_vertex_count(geometry) >= 400
    assert _maximum_polygonal_coordinate_step(geometry) <= 0.25 + 1e-9
    assert geometry.symmetric_difference(snapshot_geometry).area / snapshot_geometry.area <= 0.005


def test_tno_north_sea_uses_iho_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_north_sea"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    assert props.get("source_standard") == "marine_regions_iho_v3"
    assert props.get("region_group") == "marine_macro"
    assert _polygonal_vertex_count(geometry) >= 1000


def test_tno_baltic_sea_uses_iho_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_baltic_sea"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    assert props.get("source_standard") == "marine_regions_iho_v3"
    assert props.get("region_group") == "marine_macro"
    assert 10000 <= _polygonal_vertex_count(geometry) <= 60000
    assert 0.05 <= geometry.area <= 0.3
    minx, miny, maxx, maxy = geometry.bounds
    assert 9.0 <= minx <= 10.5
    assert 53.0 <= miny <= 54.2
    assert 23.0 <= maxx <= 24.0
    assert 59.0 <= maxy <= 60.2
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    snapshot_props = snapshot_feature_map["tno_baltic_sea"].get("properties", {})
    assert snapshot_props.get("source_layer") == "iho"
    assert snapshot_props.get("source_query") == "mrgid=2401"
    assert snapshot_props.get("source_record_ids") == ["mrgid:2401"]
    assert snapshot_props.get("snapshot_simplify_tolerance") == 0.008
    provenance = _load_water_provenance()
    extract_by_id = {
        str(entry.get("id") or ""): entry
        for entry in provenance.get("water_extracts", [])
    }
    clone_ids = {
        str(entry.get("id") or "")
        for entry in provenance.get("local_clone_extracts", [])
    }
    assert extract_by_id["tno_baltic_sea"].get("source_layer") == "iho"
    assert extract_by_id["tno_baltic_sea"].get("source_query") == "mrgid=2401"
    assert extract_by_id["tno_baltic_sea"].get("source_record_ids") == ["mrgid:2401"]
    assert extract_by_id["tno_baltic_sea"].get("source_feature_count") == 1
    assert extract_by_id["tno_baltic_sea"].get("snapshot_simplify_tolerance") == 0.008
    assert "tno_baltic_sea" not in clone_ids


def test_tno_bay_of_biscay_uses_iho_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_bay_of_biscay"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    assert props.get("source_standard") == "marine_regions_iho_v3"
    assert props.get("region_group") == "marine_macro"
    assert 1000 <= _polygonal_vertex_count(geometry) <= 5000
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    snapshot_props = snapshot_feature_map["tno_bay_of_biscay"].get("properties", {})
    assert snapshot_props.get("source_layer") == "iho"
    assert snapshot_props.get("source_query") == "mrgid=2359"
    assert snapshot_props.get("source_record_ids") == ["mrgid:2359"]
    assert snapshot_props.get("snapshot_simplify_tolerance") == 0.004
    provenance = _load_water_provenance()
    extract_by_id = {
        str(entry.get("id") or ""): entry
        for entry in provenance.get("water_extracts", [])
    }
    clone_ids = {
        str(entry.get("id") or "")
        for entry in provenance.get("local_clone_extracts", [])
    }
    assert extract_by_id["tno_bay_of_biscay"].get("source_layer") == "iho"
    assert extract_by_id["tno_bay_of_biscay"].get("source_query") == "mrgid=2359"
    assert extract_by_id["tno_bay_of_biscay"].get("source_record_ids") == ["mrgid:2359"]
    assert extract_by_id["tno_bay_of_biscay"].get("snapshot_simplify_tolerance") == 0.004
    assert "tno_bay_of_biscay" not in clone_ids


def test_tno_irish_sea_uses_seavox_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_irish_sea"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    source_query = "mrgid_l3='23731' OR mrgid_l4='23739' OR mrgid_sr='24210' OR mrgid_sr='24214'"
    source_record_ids = [
        "mrgid_l1:23629",
        "mrgid_l2:23637",
        "mrgid_l3:23729",
        "mrgid_l3:23730",
        "mrgid_l3:23731",
        "mrgid_l4:23739",
        "mrgid_l4:23740",
        "mrgid_l4:23741",
        "mrgid_l4:23742",
        "mrgid_r:23618",
        "mrgid_sr:24210",
        "mrgid_sr:24212",
        "mrgid_sr:24213",
        "mrgid_sr:24214",
        "mrgid_sr:24220",
        "mrgid_sr:24221",
        "mrgid_sr:24222",
        "mrgid_sr:24223",
        "mrgid_sr:24224",
        "mrgid_sr:24225",
        "mrgid_sr:24226",
        "mrgid_sr:24227",
        "mrgid_sr:24228",
        "mrgid_sr:24229",
        "mrgid_sr:24230",
        "mrgid_sr:24231",
        "mrgid_sr:24232",
        "mrgid_sr:24233",
        "mrgid_sr:24236",
    ]
    assert props.get("source_standard") == "marine_regions_seavox_v19"
    assert props.get("region_group") == "marine_macro"
    assert 1500 <= _polygonal_vertex_count(geometry) <= 4000
    assert 4.7 <= geometry.area <= 5.1
    atlantic_geometry = shape(feature_map["tno_northeast_atlantic_ocean"]["geometry"])
    assert geometry.distance(atlantic_geometry) <= SEAM_DISTANCE_EPSILON
    assert geometry.intersection(atlantic_geometry).area == 0
    minx, miny, maxx, maxy = geometry.bounds
    assert -6.7 <= minx <= -6.4
    assert 51.6 <= miny <= 51.9
    assert -2.9 <= maxx <= -2.6
    assert 55.2 <= maxy <= 55.4
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    snapshot_props = snapshot_feature_map["tno_irish_sea"].get("properties", {})
    assert snapshot_props.get("source_layer") == "seavox_v19"
    assert snapshot_props.get("source_query") == source_query
    assert snapshot_props.get("source_record_ids") == source_record_ids
    assert snapshot_props.get("snapshot_simplify_tolerance") == 0.002
    provenance = _load_water_provenance()
    extract_by_id = {
        str(entry.get("id") or ""): entry
        for entry in provenance.get("water_extracts", [])
    }
    clone_ids = {
        str(entry.get("id") or "")
        for entry in provenance.get("local_clone_extracts", [])
    }
    assert extract_by_id["tno_irish_sea"].get("source_layer") == "seavox_v19"
    assert extract_by_id["tno_irish_sea"].get("source_query") == source_query
    assert extract_by_id["tno_irish_sea"].get("source_record_ids") == source_record_ids
    assert extract_by_id["tno_irish_sea"].get("source_feature_count") == 19
    assert extract_by_id["tno_irish_sea"].get("snapshot_simplify_tolerance") == 0.002
    assert "tno_irish_sea" not in clone_ids


def test_tno_south_china_sea_uses_seavox_source_backed_refinement_precision():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_south_china_sea"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    assert props.get("source_standard") == "marine_regions_seavox_v19"
    assert props.get("region_group") == "marine_macro"
    assert 5000 <= _polygonal_vertex_count(geometry) <= 50000
    assert 170 <= geometry.area <= 240
    minx, miny, maxx, maxy = geometry.bounds
    assert 101.5 <= minx <= 103.0
    assert 0.0 <= miny <= 2.0
    assert 121.0 <= maxx <= 123.0
    assert 22.0 <= maxy <= 24.5
    snapshot_feature_map = _feature_map(_load_named_water_snapshot_features())
    snapshot_props = snapshot_feature_map["tno_south_china_sea"].get("properties", {})
    assert snapshot_props.get("source_layer") == "seavox_v19"
    assert snapshot_props.get("source_query") == "mrgid_sr='24144'"
    assert snapshot_props.get("source_record_ids") == ["mrgid_r:23623", "mrgid_sr:24144"]
    assert snapshot_props.get("snapshot_simplify_tolerance") == 0.03
    provenance = _load_water_provenance()
    extract_by_id = {
        str(entry.get("id") or ""): entry
        for entry in provenance.get("water_extracts", [])
    }
    clone_ids = {
        str(entry.get("id") or "")
        for entry in provenance.get("local_clone_extracts", [])
    }
    assert extract_by_id["tno_south_china_sea"].get("source_layer") == "seavox_v19"
    assert extract_by_id["tno_south_china_sea"].get("source_query") == "mrgid_sr='24144'"
    assert extract_by_id["tno_south_china_sea"].get("source_record_ids") == ["mrgid_r:23623", "mrgid_sr:24144"]
    assert extract_by_id["tno_south_china_sea"].get("source_feature_count") == 1
    assert extract_by_id["tno_south_china_sea"].get("snapshot_simplify_tolerance") == 0.03
    assert "tno_south_china_sea" not in clone_ids


def test_tno_hudson_strait_splits_hudson_bay_as_source_backed_detail():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map["tno_hudson_strait"]
    props = feature.get("properties", {})
    geometry = shape(feature["geometry"])
    assert props.get("region_group") == "marine_detail"
    assert props.get("parent_id") == "tno_hudson_bay"
    assert props.get("source_standard") == "marine_regions_seavox_v19"
    assert props.get("is_chokepoint") is True
    assert _polygonal_vertex_count(geometry) >= 1000


def test_tno_remaining_ocean_backlog_splits_use_source_backed_details():
    feature_map = _feature_map(_load_scenario_water_features())
    expected = {
        "tno_anadyrskiy_zaliv": ("tno_bering_sea", "gulf", False),
        "tno_fram_strait": ("tno_greenland_sea", "strait", True),
    }

    failures = []
    for feature_id, (parent_id, water_type, is_chokepoint) in expected.items():
        feature = feature_map.get(feature_id)
        if feature is None:
            failures.append(f"{feature_id}:missing")
            continue
        props = feature.get("properties", {})
        geometry = shape(feature["geometry"])
        if props.get("region_group") != "marine_detail":
            failures.append(f"{feature_id}:region_group={props.get('region_group')}")
        if props.get("parent_id") != parent_id:
            failures.append(f"{feature_id}:parent_id={props.get('parent_id')}")
        if props.get("water_type") != water_type:
            failures.append(f"{feature_id}:water_type={props.get('water_type')}")
        if bool(props.get("is_chokepoint")) is not is_chokepoint:
            failures.append(f"{feature_id}:is_chokepoint={props.get('is_chokepoint')}")
        if props.get("source_standard") != "marine_regions_seavox_v19":
            failures.append(f"{feature_id}:source_standard={props.get('source_standard')}")
        if geometry.is_empty or float(geometry.area) <= 0.0:
            failures.append(f"{feature_id}:empty_geometry")

    assert failures == []


def test_tno_runtime_water_feature_ids_match_source():
    source_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_scenario_water_features()
    }
    runtime_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_runtime_water_features()
    }
    assert runtime_ids == source_ids


def test_tno_runtime_bootstrap_water_feature_ids_match_source():
    bootstrap_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_runtime_bootstrap_water_features()
    }
    assert bootstrap_ids == {""} or bootstrap_ids == set()


def test_tno_water_chunk_feature_ids_cover_current_detail_regions():
    chunk_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_water_chunk_features()
    }
    missing = sorted(feature_id for feature_id in TRACKED_DETAIL_IDS if feature_id not in chunk_ids)
    assert missing == []


def test_tno_water_chunk_feature_ids_cover_tracked_new_family_regions():
    chunk_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_water_chunk_features()
    }
    tracked_ids = TRACKED_NAMED_WATER_IDS | TRACKED_INLAND_WATER_IDS | TRACKED_BASE_GEOGRAPHY_WATER_IDS
    missing = sorted(feature_id for feature_id in tracked_ids if feature_id not in chunk_ids)
    assert missing == []


def test_tno_ocean_refinement_phase_targets_are_synchronized():
    source_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_scenario_water_features()
    }
    runtime_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_runtime_water_features()
    }
    chunk_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_water_chunk_features()
    }
    manifest_chunk_ids = _load_water_manifest_chunk_feature_ids()

    failures = []
    # 阶段目标必须同时落到 source、runtime、chunk 和 manifest；缺一层都会让首屏或 detail promotion 读到旧水域。
    for phase, target_ids in OCEAN_REFINEMENT_PHASE_TARGET_IDS.items():
        for feature_id in target_ids:
            if feature_id not in source_ids:
                failures.append(f"{phase}:{feature_id}:source")
            if feature_id not in runtime_ids:
                failures.append(f"{phase}:{feature_id}:runtime")
            if feature_id not in chunk_ids:
                failures.append(f"{phase}:{feature_id}:chunks")
            if feature_id not in manifest_chunk_ids:
                failures.append(f"{phase}:{feature_id}:manifest_chunks")
    assert failures == []


def test_tno_water_family_refinement_audit_reports_low_precision_candidates():
    # 这个 fixture 同时覆盖低精度 clone、已有 detail、provenance 记录，锁住候选分类与优先级判定语义。
    macro_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_macro",
            "name": "Fixture Macro",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "tno_cloned_from_global_water_regions",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]],
        },
    }
    standard_clone_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_standard_clone",
            "name": "Fixture Standard Clone",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "tno_cloned_from_global_water_regions",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [float(point_index), 4.0]
                for point_index in range(120)
            ]],
        },
    }
    detailed_macro_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_detailed_macro",
            "name": "Fixture Detailed Macro",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "iho",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [float(point_index), 2.0]
                for point_index in range(122)
            ]],
        },
    }
    detailed_clone_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_detailed_clone",
            "name": "Fixture Detailed Clone",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "tno_cloned_from_global_water_regions",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [float(point_index), 5.0]
                for point_index in range(121)
            ]],
        },
    }
    detail_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_detail",
            "name": "Fixture Detail",
            "region_group": "marine_detail",
            "parent_id": "fixture_detailed_macro",
            "water_type": "bay",
            "source_standard": "iho",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[2.0, 0.0], [2.5, 0.0], [2.5, 0.5], [2.0, 0.0]]],
        },
    }
    clone_detail_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_detailed_clone_detail",
            "name": "Fixture Detailed Clone Detail",
            "region_group": "marine_detail",
            "parent_id": "fixture_detailed_clone",
            "water_type": "bay",
            "source_standard": "marine_regions_seavox_v19",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[5.0, 0.0], [5.5, 0.0], [5.5, 0.5], [5.0, 0.0]]],
        },
    }
    support_macro_features = [
        {
            "type": "Feature",
            "properties": {
                "id": f"fixture_support_macro_{index}",
                "name": f"Fixture Support Macro {index}",
                "region_group": "marine_macro",
                "water_type": "sea",
                "source_standard": "marine_regions_seavox_v19",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [float(point_index), float(index)]
                    for point_index in range(130 + index)
                ]],
            },
        }
        for index in range(10)
    ]
    report = build_family_refinement_report(
        {
            "type": "FeatureCollection",
            "features": [
                macro_feature,
                standard_clone_feature,
                detailed_macro_feature,
                detailed_clone_feature,
                detail_feature,
                clone_detail_feature,
                *support_macro_features,
            ],
        },
        provenance_payload={
            "water_extracts": [{
                "id": "fixture_detailed_macro",
                "source_layer": "iho",
                "source_query": "mrgid=fixture",
                "source_record_ids": ["mrgid:fixture"],
                "source_feature_count": 1,
            }, *[
                {
                    "id": feature["properties"]["id"],
                    "source_layer": "seavox_v19",
                    "source_query": f"fixture={feature['properties']['id']}",
                    "source_record_ids": [feature["properties"]["id"]],
                    "source_feature_count": 1,
                }
                for feature in support_macro_features
            ]],
            "local_clone_extracts": [{
                "id": "fixture_macro",
                "source_water_region_id": "fixture_global_macro",
                "source_water_region_name": "Fixture Global Macro",
                "source_feature_count": 1,
            }, {
                "id": "fixture_standard_clone",
                "source_water_region_id": "fixture_standard_clone_global",
                "source_water_region_name": "Fixture Standard Clone Global",
                "source_feature_count": 1,
            }, {
                "id": "fixture_detailed_clone",
                "source_water_region_id": "fixture_detailed_clone_global",
                "source_water_region_name": "Fixture Detailed Clone Global",
                "source_feature_count": 1,
            }],
        },
        generated_at="2026-06-01T00:00:00Z",
    )

    assert report["contract"]["schema_version"] == 4
    assert report["contract"]["high_vertex_review_percentile"] == 0.90
    assert report["contract"]["terminal_public_source_status"] == "terminal_public_source"
    assert report["summary"]["marine_macro_count"] == 14
    assert report["summary"]["marine_macro_with_children_count"] == 2
    assert report["summary"]["marine_macro_without_children_count"] == 12
    assert report["summary"]["low_precision_candidate_count"] == 1
    assert report["summary"]["source_replacement_candidate_count"] == 3
    assert report["summary"]["terminal_public_source_candidate_count"] == 0
    assert report["summary"]["backlog_candidate_count"] == 12
    assert report["summary"]["provenance_gap_count"] == 0
    assert report["summary"]["source_summary"] == {"local_clone": 3, "other": 1, "marine_regions": 10}
    candidate = report["low_precision_candidates"][0]
    assert candidate["id"] == "fixture_macro"
    assert candidate["vertex_count"] == 4
    assert candidate["precision_band"] == "low"
    assert candidate["source_family"] == "local_clone"
    assert candidate["provenance_status"] == "recorded"
    assert candidate["suggested_priority"] == "high"
    assert candidate["recommended_action"] == "replace_or_refine_with_public_source"
    assert "uses global water clone source" in candidate["reasons"]
    assert {item["id"] for item in report["source_replacement_candidates"]} == {
        "fixture_macro",
        "fixture_standard_clone",
        "fixture_detailed_clone",
    }
    assert {item["id"] for item in report["low_precision_candidates"]} == {"fixture_macro"}
    standard_clone_row = next(row for row in report["source_replacement_candidates"] if row["id"] == "fixture_standard_clone")
    assert standard_clone_row["precision_band"] == "standard"
    assert standard_clone_row["source_family"] == "local_clone"
    detailed_row = next(row for row in report["families"] if row["id"] == "fixture_detailed_macro")
    assert detailed_row["child_count"] == 1
    assert detailed_row["children"][0]["vertex_count"] == 4
    assert detailed_row["provenance_status"] == "recorded"


def test_tno_water_family_refinement_terminal_review_monitors_local_clone():
    reviewed_clone_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_reviewed_clone",
            "name": "Fixture Reviewed Clone",
            "region_group": "marine_macro",
            "water_type": "chokepoint",
            "source_standard": "tno_cloned_from_global_water_regions",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [float(point_index), 4.0]
                for point_index in range(120)
            ]],
        },
    }
    reviewed_clone_detail_feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_reviewed_clone_detail",
            "name": "Fixture Reviewed Clone Detail",
            "region_group": "marine_detail",
            "parent_id": "fixture_reviewed_clone",
            "water_type": "strait",
            "source_standard": "marine_regions_seavox_v19",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0.0, 4.0], [1.0, 4.0], [1.0, 5.0], [0.0, 4.0]]],
        },
    }
    support_macro_features = [
        {
            "type": "Feature",
            "properties": {
                "id": f"fixture_support_macro_{index}",
                "name": f"Fixture Support Macro {index}",
                "region_group": "marine_macro",
                "water_type": "sea",
                "source_standard": "marine_regions_seavox_v19",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [float(point_index), float(index)]
                    for point_index in range(130 + index)
                ]],
            },
        }
        for index in range(10)
    ]
    report = build_family_refinement_report(
        {
            "type": "FeatureCollection",
            "features": [reviewed_clone_feature, reviewed_clone_detail_feature, *support_macro_features],
        },
        provenance_payload={
            "water_extracts": [
                {
                    "id": feature["properties"]["id"],
                    "source_layer": "seavox_v19",
                    "source_query": f"fixture={feature['properties']['id']}",
                    "source_record_ids": [feature["properties"]["id"]],
                    "source_feature_count": 1,
                }
                for feature in support_macro_features
            ],
            "local_clone_extracts": [{
                "id": "fixture_reviewed_clone",
                "source_water_region_id": "fixture_reviewed_clone_global",
                "source_water_region_name": "Fixture Reviewed Clone Global",
                "source_feature_count": 1,
            }],
        },
        source_review_payload={
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{
                "id": "fixture_reviewed_clone",
                "review_status": "terminal_public_source",
                "reviewed_at": "2026-06-02",
                "source_queries": [{
                    "source_layer": "gazetteer_polygon",
                    "cql_filter": "mrgid IN (fixture_bosporus, fixture_dardanelles)",
                }],
                "evidence": ["Fixture source review found no replacement polygon source."],
            }],
        },
        generated_at="2026-06-02T00:00:00Z",
    )

    assert report["summary"]["source_replacement_candidate_count"] == 0
    assert report["summary"]["terminal_public_source_candidate_count"] == 1
    assert {item["id"] for item in report["source_replacement_candidates"]} == set()
    assert "fixture_reviewed_clone" not in {item["id"] for item in report["backlog_candidates"]}
    reviewed_row = next(row for row in report["families"] if row["id"] == "fixture_reviewed_clone")
    assert reviewed_row["child_count"] == 1
    assert reviewed_row["recommended_action"] == "monitor_terminal_public_source"
    terminal_row = report["terminal_public_source_candidates"][0]
    assert terminal_row["id"] == "fixture_reviewed_clone"
    assert "public source review found no verified replacement polygon source" in terminal_row["reasons"]


def test_tno_water_family_refinement_terminal_review_monitors_standard_macro():
    reviewed_macro = {
        "type": "Feature",
        "properties": {
            "id": "fixture_reviewed_standard",
            "name": "Fixture Reviewed Standard",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "marine_regions_iho_v3",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [float(point_index), 1.0]
                for point_index in range(120)
            ]],
        },
    }
    support_macro_features = [
        {
            "type": "Feature",
            "properties": {
                "id": f"fixture_standard_support_{index}",
                "name": f"Fixture Standard Support {index}",
                "region_group": "marine_macro",
                "water_type": "sea",
                "source_standard": "marine_regions_seavox_v19",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [float(point_index), float(index)]
                    for point_index in range(200 + index)
                ]],
            },
        }
        for index in range(10)
    ]
    features = [reviewed_macro, *support_macro_features]
    report = build_family_refinement_report(
        {"type": "FeatureCollection", "features": features},
        provenance_payload={
            "water_extracts": [
                {
                    "id": feature["properties"]["id"],
                    "source_layer": "iho" if feature["properties"]["id"] == "fixture_reviewed_standard" else "seavox_v19",
                    "source_query": f"fixture={feature['properties']['id']}",
                    "source_record_ids": [feature["properties"]["id"]],
                    "source_feature_count": 1,
                }
                for feature in features
            ],
        },
        source_review_payload={
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{
                "id": "fixture_reviewed_standard",
                "review_status": "terminal_public_source",
                "reviewed_at": "2026-06-02",
                "source_queries": [{
                    "source_layer": "iho",
                    "cql_filter": "mrgid=fixture",
                }],
                "evidence": ["Fixture source review found no child polygon source."],
            }],
        },
        generated_at="2026-06-02T00:00:00Z",
    )

    reviewed_row = next(row for row in report["families"] if row["id"] == "fixture_reviewed_standard")
    assert reviewed_row["precision_band"] == "standard"
    assert reviewed_row["recommended_action"] == "monitor_terminal_public_source"
    assert "fixture_reviewed_standard" not in {item["id"] for item in report["backlog_candidates"]}
    assert [item["id"] for item in report["terminal_public_source_candidates"]] == ["fixture_reviewed_standard"]
    assert "public source review found no verified child polygon source" in report["terminal_public_source_candidates"][0]["reasons"]


def test_tno_water_family_refinement_terminal_source_reviews_exit_actionable_queues():
    water_payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding="utf-8"))
    provenance_payload = json.loads(SCENARIO_WATER_PUBLISHED_PROVENANCE_PATH.read_text(encoding="utf-8"))
    source_review_payload = json.loads(SCENARIO_WATER_SOURCE_REVIEW_PATH.read_text(encoding="utf-8"))
    reviewed_ids = {
        item["id"]
        for item in source_review_payload["features"]
        if item["review_status"] == "terminal_public_source"
    }

    report = build_family_refinement_report(
        water_payload,
        provenance_payload=provenance_payload,
        source_review_payload=source_review_payload,
        generated_at="2026-06-02T00:00:00Z",
    )

    expected_remaining_backlog_ids = set()
    assert len(reviewed_ids) == 44
    assert reviewed_ids <= {item["id"] for item in report["terminal_public_source_candidates"]}
    reviewed_rows = [row for row in report["families"] if row["id"] in reviewed_ids]
    assert {row["recommended_action"] for row in reviewed_rows} == {"monitor_terminal_public_source"}
    assert {row["source_review"]["review_status"] for row in reviewed_rows} == {"terminal_public_source"}
    assert reviewed_ids.isdisjoint({item["id"] for item in report["backlog_candidates"]})
    assert reviewed_ids.isdisjoint({item["id"] for item in report["high_precision_split_candidates"]})
    assert reviewed_ids.isdisjoint({item["id"] for item in report["source_replacement_candidates"]})
    assert {item["id"] for item in report["backlog_candidates"]} == expected_remaining_backlog_ids
    assert report["summary"]["terminal_public_source_candidate_count"] == len(reviewed_ids)
    assert report["summary"]["high_precision_split_candidate_count"] == 0
    assert report["summary"]["backlog_candidate_count"] == len(expected_remaining_backlog_ids)


def test_tno_water_family_refinement_recent_terminal_reviews_record_structured_evidence():
    water_payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding="utf-8"))
    provenance_payload = json.loads(SCENARIO_WATER_PUBLISHED_PROVENANCE_PATH.read_text(encoding="utf-8"))
    source_review_payload = json.loads(SCENARIO_WATER_SOURCE_REVIEW_PATH.read_text(encoding="utf-8"))
    report = build_family_refinement_report(
        water_payload,
        provenance_payload=provenance_payload,
        source_review_payload=source_review_payload,
        generated_at="2026-06-05T00:00:00Z",
    )
    recent_terminal_rows = [
        row
        for row in report["families"]
        if row.get("source_review", {}).get("reviewed_at") == "2026-06-05"
    ]

    assert len(recent_terminal_rows) == 40
    assert {row["source_review"]["terminal_reason"] for row in recent_terminal_rows} == {
        "no_public_child_polygon_source",
    }
    assert {row["source_review"]["child_result_count"] for row in recent_terminal_rows} == {0}
    assert all(row["source_review"]["matched_record_ids"] for row in recent_terminal_rows)

    records_by_id = {
        item["id"]: item
        for item in source_review_payload["features"]
        if item.get("reviewed_at") == "2026-06-05"
    }
    assert records_by_id["tno_gulf_of_mexico"]["matched_record_ids"] == [
        "iho:mrgid=4288",
        "seavox_v19:mrgid_sr=24044",
    ]
    assert records_by_id["tno_beaufort_sea"]["matched_record_ids"] == [
        "iho:mrgid=4256",
        "seavox_v19:mrgid_sr=24023",
    ]
    assert records_by_id["tno_labrador_sea"]["matched_record_ids"] == [
        "iho:mrgid=4291",
        "seavox_v19:mrgid_sr=24050",
    ]
    assert all(
        any("mrgid_l1" in query["cql_filter"] and "mrgid_l4" in query["cql_filter"] for query in record["source_queries"])
        for record in records_by_id.values()
    )
    assert records_by_id["tno_timor_sea"]["rejected_child_candidates"] == [
        {
            "name": "Joseph Bonaparte Gulf",
            "source_layer": "seavox_v19",
            "cql_filter": "mrgid_sr='24062'",
            "matched_record_id": "seavox_v19:mrgid_sr=24062",
            "reason": "no_intersection_with_current_parent_geometry",
        }
    ]
    assert records_by_id["tno_ross_sea"]["rejected_child_candidates"] == [
        {
            "name": "McMurdo Sound",
            "source_layer": "seavox_v19",
            "cql_filter": "mrgid_sr='24145'",
            "matched_record_id": "seavox_v19:mrgid_sr=24145",
            "reason": "no_intersection_with_current_parent_geometry",
        }
    ]


def test_tno_bosporus_source_review_records_terminal_public_source():
    payload = json.loads(SCENARIO_WATER_SOURCE_REVIEW_PATH.read_text(encoding="utf-8"))
    assert payload["reviewed_at"] == "2026-06-05"
    records_by_id = {item["id"]: item for item in payload["features"]}
    record = records_by_id["tno_bosporus_dardanelles"]
    assert record["review_status"] == "terminal_public_source"
    assert record["reviewed_at"] == "2026-06-02"
    source_queries = record["source_queries"]
    assert {"source_layer": "gazetteer_details", "cql_filter": "mrgid=3721 OR mrgid=3725"} in source_queries
    assert {"source_layer": "gazetteer_line", "cql_filter": "mrgid IN (3721,3725)"} in source_queries
    assert any("direct public polygon or line source" in item for item in record["evidence"])


def test_tno_water_family_refinement_audit_reports_high_precision_review_candidates():
    def make_macro(index, vertex_count):
        return {
            "type": "Feature",
            "properties": {
                "id": f"fixture_macro_{index}",
                "name": f"Fixture Macro {index:02d}",
                "region_group": "marine_macro",
                "water_type": "sea",
                "source_standard": "marine_regions_seavox_v19",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [float(point_index), float(index)]
                    for point_index in range(vertex_count)
                ]],
            },
        }

    features = [
        make_macro(index, vertex_count)
        for index, vertex_count in enumerate([100, 101, 102, 103, 104, 105, 106, 107, 108, 130, 140, 150], start=1)
    ]
    features.append({
        "type": "Feature",
        "properties": {
            "id": "fixture_macro_11_detail",
            "name": "Fixture Macro 11 Detail",
            "region_group": "marine_detail",
            "parent_id": "fixture_macro_11",
            "water_type": "bay",
            "source_standard": "marine_regions_seavox_v19",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[0.0, 11.0], [1.0, 11.0], [1.0, 12.0], [0.0, 11.0]]],
        },
    })
    provenance_payload = {
        "water_extracts": [
            {
                "id": feature["properties"]["id"],
                "source_layer": "seavox_v19",
                "source_query": f"fixture={feature['properties']['id']}",
                "source_record_ids": [feature["properties"]["id"]],
                "source_feature_count": 1,
            }
            for feature in features
        ],
    }

    report = build_family_refinement_report(
        {"type": "FeatureCollection", "features": features},
        provenance_payload=provenance_payload,
        source_review_payload={
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{
                "id": "fixture_macro_10",
                "review_status": "terminal_public_source",
                "reviewed_at": "2026-06-02",
                "source_queries": [{
                    "source_layer": "seavox_v19",
                    "cql_filter": "fixture=terminal",
                }],
                "evidence": ["Fixture source review found no child polygon source."],
            }],
        },
        generated_at="2026-06-01T00:00:00Z",
    )

    assert report["contract"]["high_vertex_review_threshold"] == 130
    assert report["summary"]["high_precision_split_candidate_count"] == 1
    assert report["summary"]["terminal_public_source_candidate_count"] == 1
    assert report["summary"]["simplification_review_candidate_count"] == 1
    assert report["summary"]["precision_summary"]["high_review"] == 3
    assert [item["id"] for item in report["high_precision_split_candidates"]] == [
        "fixture_macro_12",
    ]
    assert report["high_precision_split_candidates"][0]["recommended_action"] == "split_child_water_candidates"
    assert "high-detail macro still needs child water split review" in report["high_precision_split_candidates"][0]["reasons"]
    assert [item["id"] for item in report["terminal_public_source_candidates"]] == [
        "fixture_macro_10",
    ]
    assert report["terminal_public_source_candidates"][0]["recommended_action"] == "monitor_terminal_public_source"
    assert "public source review found no verified child polygon source" in report["terminal_public_source_candidates"][0]["reasons"]
    assert report["terminal_public_source_candidates"][0]["source_review"]["source_queries"][0]["cql_filter"] == "fixture=terminal"
    assert [item["id"] for item in report["simplification_review_candidates"]] == [
        "fixture_macro_11",
    ]
    assert report["simplification_review_candidates"][0]["recommended_action"] == "monitor_simplification_only_if_performance_requires"
    assert "high-detail macro already has child water coverage" in report["simplification_review_candidates"][0]["reasons"]


def test_tno_water_family_refinement_rejects_invalid_source_review_contract():
    feature = {
        "type": "Feature",
        "properties": {
            "id": "fixture_macro",
            "name": "Fixture Macro",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "marine_regions_seavox_v19",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [float(point_index), 0.0]
                for point_index in range(140)
            ]],
        },
    }
    base_record = {
        "id": "fixture_macro",
        "review_status": "terminal_public_source",
        "reviewed_at": "2026-06-02",
        "source_queries": [{
            "source_layer": "seavox_v19",
            "cql_filter": "fixture=terminal",
        }],
        "evidence": ["Fixture source review found no child polygon source."],
    }

    invalid_payloads = [
        ("scenario_id must be tno_1962", {
            "schema_version": 1,
            "scenario_id": "wrong_scenario",
            "reviewed_at": "2026-06-02",
            "features": [base_record],
        }),
        ("unknown source review_status", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{**base_record, "review_status": "unreviewed"}],
        }),
        ("duplicate source review record", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [base_record, base_record],
        }),
        ("source review reviewed_at must use YYYY-MM-DD", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "not-a-date",
            "features": [base_record],
        }),
        ("source review reviewed_at: fixture_macro must use YYYY-MM-DD", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{**base_record, "reviewed_at": "not-a-date"}],
        }),
        ("requires source_queries", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{**base_record, "source_queries": []}],
        }),
        ("requires evidence", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{**base_record, "evidence": []}],
        }),
        ("child_result_count must be a non-negative integer", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{**base_record, "child_result_count": True}],
        }),
        ("matched_record_ids must be non-empty strings", {
            "schema_version": 1,
            "scenario_id": "tno_1962",
            "reviewed_at": "2026-06-02",
            "features": [{**base_record, "matched_record_ids": []}],
        }),
    ]

    for expected_message, source_review_payload in invalid_payloads:
        try:
            build_family_refinement_report(
                {"type": "FeatureCollection", "features": [feature]},
                source_review_payload=source_review_payload,
                generated_at="2026-06-01T00:00:00Z",
            )
        except ValueError as exc:
            assert expected_message in str(exc)
        else:
            raise AssertionError(f"invalid source review payload was accepted: {expected_message}")


def test_tno_water_validator_report_schema_locks_ocean_refinement_signals():
    water_feature = {
        "type": "Feature",
        "properties": {
            "id": "tno_greenland_sea",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "fixture",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [-2.0, 76.0],
                [-1.0, 76.0],
                [-1.0, 77.0],
                [-2.0, 77.0],
                [-2.0, 76.0],
            ]],
        },
    }
    source_water = {"type": "FeatureCollection", "features": [water_feature]}
    runtime_political = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"id": "fixture_land"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[10.0, 10.0], [11.0, 10.0], [11.0, 11.0], [10.0, 11.0], [10.0, 10.0]]],
            },
        }],
    }

    report = build_report_from_collections(
        scenario_id="fixture",
        source_water=source_water,
        runtime_water=source_water,
        runtime_political=runtime_political,
        named_water_snapshot=source_water,
        chunk_feature_collections=[("water.fixture.json", source_water)],
    )

    assert report["contract"]["schema_version"] == 3
    checks = report["checks"]
    for key in (
        "source",
        "runtime",
        "chunks",
        "d3_spherical",
        "first_wave_probe_coverage",
        "first_wave_named_water_seams",
        "aq_polar_spherical_diagnostics",
        "macro_land_overlap",
        "named_water_snapshot_inflation",
        "id_consistency",
        "ocean_refinement_targets",
    ):
        assert key in checks
    assert checks["chunks"]["chunk_count"] == 1
    assert report["contract"]["ocean_refinement_phase_targets"] == {
        phase: list(target_ids)
        for phase, target_ids in OCEAN_REFINEMENT_PHASE_TARGET_IDS.items()
    }
    assert "phase2_arctic" in checks["ocean_refinement_targets"]["phases"]
    assert checks["aq_polar_spherical_diagnostics"]["failure_count"] == 0


def test_tno_water_validator_reports_aq_polar_spherical_diagnostics():
    water_feature = {
        "type": "Feature",
        "properties": {
            "id": "tno_ross_sea",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "fixture",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [-170.0, -78.0],
                [-168.0, -78.0],
                [-168.0, -77.0],
                [-170.0, -77.0],
                [-170.0, -78.0],
            ]],
        },
    }
    aq_feature = {
        "type": "Feature",
        "properties": {"id": "AQ"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [20.0, -82.0],
                [20.0, -80.0],
                [24.0, -80.0],
                [24.0, -82.0],
                [20.0, -82.0],
            ]],
        },
    }
    source_water = {"type": "FeatureCollection", "features": [water_feature]}
    runtime_political = {"type": "FeatureCollection", "features": [aq_feature]}

    report = build_report_from_collections(
        scenario_id="tno_1962",
        source_water=source_water,
        runtime_water=source_water,
        runtime_political=runtime_political,
        named_water_snapshot=source_water,
        chunk_feature_collections=[("water.fixture.json", source_water)],
    )

    diagnostics = report["checks"]["aq_polar_spherical_diagnostics"]
    assert diagnostics["feature_count"] == 1
    assert diagnostics["failure_count"] == 0
    assert diagnostics["features"][0]["id"] == "AQ"


def test_tno_water_validator_report_allows_missing_chunks_when_runtime_gate_owns_chunks():
    water_feature = {
        "type": "Feature",
        "properties": {
            "id": "tno_greenland_sea",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "fixture",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [-2.0, 76.0],
                [-1.0, 76.0],
                [-1.0, 77.0],
                [-2.0, 77.0],
                [-2.0, 76.0],
            ]],
        },
    }
    source_water = {"type": "FeatureCollection", "features": [water_feature]}
    runtime_political = {"type": "FeatureCollection", "features": []}

    report = build_report_from_collections(
        scenario_id="fixture",
        source_water=source_water,
        runtime_water=source_water,
        runtime_political=runtime_political,
        named_water_snapshot=source_water,
        chunk_feature_collections=[],
        require_chunks=False,
    )

    targets = report["checks"]["ocean_refinement_targets"]["phases"]["phase2_arctic"]["targets"]
    target = next(record for record in targets if record["id"] == "tno_greenland_sea")
    assert target["in_source"] is True
    assert target["in_runtime"] is True
    assert target["in_chunks"] is False
    assert report["checks"]["id_consistency"]["chunk_missing"] == ["tno_greenland_sea"]
    failures = summarize_failures(report, require_chunks=False)
    assert not any("id_consistency" in failure for failure in failures)
    assert not any("surface=chunks" in failure for failure in failures)


def test_tno_water_validator_report_requires_chunks_when_chunk_gate_is_active():
    water_feature = {
        "type": "Feature",
        "properties": {
            "id": "tno_greenland_sea",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "fixture",
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[
                -2.0, 76.0
            ], [
                -1.0, 76.0
            ], [
                -1.0, 77.0
            ], [
                -2.0, 77.0
            ], [
                -2.0, 76.0
            ]]],
        },
    }
    source_water = {"type": "FeatureCollection", "features": [water_feature]}
    runtime_political = {"type": "FeatureCollection", "features": []}

    report = build_report_from_collections(
        scenario_id="fixture",
        source_water=source_water,
        runtime_water=source_water,
        runtime_political=runtime_political,
        named_water_snapshot=source_water,
        chunk_feature_collections=[],
        require_chunks=True,
    )

    failures = summarize_failures(report, require_chunks=True)
    assert report["checks"]["id_consistency"]["chunk_missing"] == ["tno_greenland_sea"]
    assert any("id_consistency" in failure for failure in failures)
    assert any(
        item == {"phase": "phase2_arctic", "surface": "chunks", "id": "tno_greenland_sea"}
        for item in report["checks"]["ocean_refinement_targets"]["missing"]
    )


def test_tno_water_validator_checks_geometry_collection_coordinates():
    water_feature = {
        "type": "Feature",
        "properties": {
            "id": "geometry_collection_bad_lon",
            "region_group": "marine_macro",
            "water_type": "sea",
            "source_standard": "fixture",
        },
        "geometry": {
            "type": "GeometryCollection",
            "geometries": [
                {
                    "type": "Polygon",
                    "coordinates": [[
                        [180.25, 10.0],
                        [180.5, 10.0],
                        [180.5, 10.5],
                        [180.25, 10.5],
                        [180.25, 10.0],
                    ]],
                }
            ],
        },
    }
    source_water = {"type": "FeatureCollection", "features": [water_feature]}
    runtime_political = {"type": "FeatureCollection", "features": []}

    report = build_report_from_collections(
        scenario_id="fixture",
        source_water=source_water,
        runtime_water=source_water,
        runtime_political=runtime_political,
        named_water_snapshot=source_water,
        chunk_feature_collections=[],
        require_chunks=False,
    )

    source_metrics = report["checks"]["source"]
    assert source_metrics["out_of_range_coordinates"][0]["id"] == "geometry_collection_bad_lon"
    failures = summarize_failures(report, require_chunks=False)
    assert any("source: out_of_range_coordinates=1" == failure for failure in failures)


def test_tno_tracked_inland_water_regions_keep_source_contract():
    feature_map = _feature_map(_load_scenario_water_features())
    feature = feature_map.get("tno_qyzylorda_inland_water")
    assert feature is not None
    props = feature.get("properties", {})
    assert props.get("water_type") == "lake"
    assert props.get("region_group") == "inland_lake"
    assert props.get("source_standard") == "tno_political_interior_hole"
    assert props.get("source_feature_id") == "KAZ-3197"
    assert bool(props.get("interactive")) is True
    assert bool(props.get("render_as_base_geography")) is True


def test_tno_base_geography_water_clones_keep_source_contract():
    feature_map = _feature_map(_load_scenario_water_features())
    expected_groups = {
        "caspian_sea": ("inland_sea", "eurasia_lakes"),
        "lake_superior": ("lake", "great_lakes"),
        "lake_michigan": ("lake", "great_lakes"),
        "lake_huron": ("lake", "great_lakes"),
        "lake_erie": ("lake", "great_lakes"),
        "lake_ontario": ("lake", "great_lakes"),
    }
    for feature_id, (water_type, region_group) in expected_groups.items():
        feature = feature_map.get(feature_id)
        assert feature is not None, feature_id
        props = feature.get("properties", {})
        assert props.get("water_type") == water_type
        assert props.get("region_group") == region_group
        assert props.get("source_standard") == "tno_cloned_from_global_water_regions"
        assert props.get("source_feature_id") == feature_id
        assert bool(props.get("interactive")) is True
        assert bool(props.get("render_as_base_geography")) is True


def _assert_tno_base_geography_water_clones_are_cut_out_of_runtime_land_surfaces():
    runtime_water_map = _feature_map(_load_runtime_water_features())
    runtime_political_union = _load_runtime_object_union("political")
    runtime_land_mask_union = _load_runtime_object_union("land_mask")
    failures = []

    for feature_id in sorted(TRACKED_BASE_GEOGRAPHY_WATER_IDS):
        feature = runtime_water_map.get(feature_id)
        assert feature is not None, feature_id
        geometry = shape(feature["geometry"])
        political_overlap = float(geometry.intersection(runtime_political_union).area)
        land_mask_overlap = float(geometry.intersection(runtime_land_mask_union).area)
        if (
            political_overlap > BASE_GEOGRAPHY_WATER_LAND_OVERLAP_ABS_MAX
            or land_mask_overlap > BASE_GEOGRAPHY_WATER_LAND_OVERLAP_ABS_MAX
        ):
            failures.append(
                f"{feature_id}: political={political_overlap:.6f} land_mask={land_mask_overlap:.6f}"
            )

    assert failures == []


def test_tno_base_geography_water_clones_are_cut_out_of_runtime_land_surfaces():
    _assert_tno_base_geography_water_clones_are_cut_out_of_runtime_land_surfaces()


class TnoWaterGeometryDataContractTest(unittest.TestCase):
    def test_tno_base_geography_water_clones_are_cut_out_of_runtime_land_surfaces(self):
        _assert_tno_base_geography_water_clones_are_cut_out_of_runtime_land_surfaces()


def test_tno_tracked_detail_regions_exist_and_have_parent_ids():
    feature_map = _feature_map(_load_scenario_water_features())
    for feature_id in TRACKED_DETAIL_IDS:
        feature = feature_map.get(feature_id)
        assert feature is not None, feature_id
        props = feature.get("properties", {})
        assert str(props.get("region_group") or "").strip() == "marine_detail", feature_id
        assert str(props.get("parent_id") or "").strip() != "", feature_id
        assert bool(props.get("interactive")) is True, feature_id


def test_tno_open_ocean_regions_stay_non_interactive():
    offending = []
    for feature in _load_scenario_water_features():
        props = feature.get("properties", {})
        if str(props.get("region_group") or "").strip() != "ocean_macro":
            continue
        if bool(props.get("interactive")):
            offending.append(str(props.get("id") or ""))
    assert offending == []


def test_tno_manifest_and_startup_bundles_reflect_current_water_bootstrap():
    source_feature_count = len(_load_scenario_water_features())
    manifest = _load_scenario_manifest()
    bundle_paths = (
        (STARTUP_BUNDLE_EN_PATH, STARTUP_BUNDLE_EN_GZIP_PATH),
        (STARTUP_BUNDLE_ZH_PATH, STARTUP_BUNDLE_ZH_GZIP_PATH),
    )
    expected_runtime_sha = _sha256_path(RUNTIME_WATER_PATH)
    expected_bootstrap_sha = _sha256_path(RUNTIME_BOOTSTRAP_WATER_PATH)
    expected_detail_manifest_sha = _sha256_path(DETAIL_CHUNK_MANIFEST_PATH)
    expected_named_marginal_count = len(tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS)

    # manifest 和双语 startup bundle 共用同一组水域 hash，防止重建只刷新场景数据却漏掉首屏缓存。
    assert int(manifest.get("summary", {}).get("tno_water_region_count") or 0) == source_feature_count
    assert int(manifest.get("summary", {}).get("tno_named_marginal_water_count") or 0) == expected_named_marginal_count
    assert str(manifest.get("water_regions_mode") or "") == "exclusive"
    manifest_source = manifest.get("source", {})
    assert str(manifest_source.get("runtime_topology_sha256") or "") == expected_runtime_sha
    assert str(manifest_source.get("runtime_bootstrap_topology_sha256") or "") == expected_bootstrap_sha
    assert str(manifest_source.get("detail_chunk_manifest_sha256") or "") == expected_detail_manifest_sha

    for bundle_path, gzip_path in bundle_paths:
        bundle = _load_startup_bundle(bundle_path)
        gzip_bundle = _load_startup_bundle_gzip(gzip_path)
        assert gzip_bundle.get("source") == bundle.get("source")
        manifest_subset = bundle.get("manifest_subset", {})
        source_meta = bundle.get("source", {})

        assert str(bundle.get("generated_at") or "") == str(manifest.get("generated_at") or "")
        assert str(bundle.get("baseline_hash") or "") == str(manifest.get("baseline_hash") or "")
        assert str(manifest_subset.get("water_regions_mode") or "") == "exclusive"
        assert int(manifest_subset.get("summary", {}).get("tno_water_region_count") or 0) == source_feature_count
        assert int(manifest_subset.get("summary", {}).get("tno_named_marginal_water_count") or 0) == expected_named_marginal_count
        assert str(source_meta.get("runtime_topology_sha256") or "") == expected_runtime_sha
        assert str(source_meta.get("runtime_bootstrap_topology_sha256") or "") == expected_bootstrap_sha
        assert str(source_meta.get("detail_chunk_manifest_sha256") or "") == expected_detail_manifest_sha
        runtime_meta = bundle.get("scenario", {}).get("runtime_political_meta", {})
        runtime_feature_ids = runtime_meta.get("featureIds", []) or []
        assert len(runtime_feature_ids) > 1000
        stale_shell_ids = [
            feature_id
            for feature_id in runtime_feature_ids
            if str(feature_id).startswith("RU_ARCTIC_FB_")
            and str(feature_id)[len("RU_ARCTIC_FB_"):].isdigit()
        ]
        assert stale_shell_ids == []


def test_tno_tracked_probe_points_are_covered_by_expected_water_regions():
    feature_map = _feature_map(_load_scenario_water_features())
    failures = []
    for probe in TRACKED_COVERAGE_PROBES:
        point = Point(*probe["point"])
        hits = []
        for feature_id in probe["allowed_ids"]:
            feature = feature_map.get(feature_id)
            assert feature is not None, feature_id
            geom = shape(feature["geometry"])
            if geom.contains(point) or geom.touches(point):
                hits.append(feature_id)
        if not hits:
            failures.append(f"{probe['label']} -> {sorted(probe['allowed_ids'])}")
    assert failures == []


def test_tno_tracked_neighbor_pairs_do_not_leave_gaps():
    feature_map = _feature_map(_load_scenario_water_features())
    failures = []
    for left_id, right_id in TRACKED_SEAM_PAIRS:
        left = feature_map.get(left_id)
        right = feature_map.get(right_id)
        assert left is not None, left_id
        assert right is not None, right_id
        left_geom = shape(left["geometry"])
        right_geom = shape(right["geometry"])
        distance = float(left_geom.distance(right_geom))
        if distance > SEAM_DISTANCE_EPSILON:
            left_point, right_point = nearest_points(left_geom, right_geom)
            failures.append(
                f"{left_id}<->{right_id} distance={distance:.8f} "
                f"left={tuple(round(v, 4) for v in left_point.coords[0])} "
                f"right={tuple(round(v, 4) for v in right_point.coords[0])}"
            )
    assert failures == []


def test_tno_parent_child_water_regions_do_not_overlap():
    feature_map = _feature_map(_load_scenario_water_features())
    failures = []
    checked_pairs = set()
    checked_count = 0
    for child in feature_map.values():
        child_props = child.get("properties") or {}
        child_id = child_props.get("id")
        parent_id = child_props.get("parent_id")
        if not parent_id:
            continue
        parent = feature_map.get(parent_id)
        if parent is None:
            continue
        checked_pairs.add((parent_id, child_id))
        checked_count += 1
        assert child is not None, child_id
        overlap_area = float(shape(parent["geometry"]).intersection(shape(child["geometry"])).area)
        if overlap_area > PARENT_CHILD_OVERLAP_EPSILON:
            failures.append(f"{parent_id}<->{child_id} overlap_area={overlap_area:.12f}")
    assert checked_count > 0
    assert ("tno_greenland_sea", "tno_fram_strait") in checked_pairs
    assert ("tno_bering_sea", "tno_anadyrskiy_zaliv") in checked_pairs
    assert failures == []


class TnoWaterRecentRefinementContractTest(unittest.TestCase):
    """Expose recent ocean refinement contracts through unittest discovery."""

    def test_runtime_water_feature_ids_match_source(self):
        test_tno_runtime_water_feature_ids_match_source()

    def test_runtime_bootstrap_water_feature_ids_match_source(self):
        test_tno_runtime_bootstrap_water_feature_ids_match_source()

    def test_water_chunks_cover_current_detail_regions(self):
        test_tno_water_chunk_feature_ids_cover_current_detail_regions()

    def test_water_chunks_cover_tracked_new_family_regions(self):
        test_tno_water_chunk_feature_ids_cover_tracked_new_family_regions()

    def test_ocean_refinement_phase_targets_are_synchronized(self):
        test_tno_ocean_refinement_phase_targets_are_synchronized()

    def test_tracked_probe_points_are_covered_by_expected_water_regions(self):
        test_tno_tracked_probe_points_are_covered_by_expected_water_regions()

    def test_tracked_neighbor_pairs_do_not_leave_gaps(self):
        test_tno_tracked_neighbor_pairs_do_not_leave_gaps()

    def test_parent_child_water_regions_do_not_overlap(self):
        test_tno_parent_child_water_regions_do_not_overlap()

    def test_remaining_ocean_backlog_splits_use_source_backed_details(self):
        test_tno_remaining_ocean_backlog_splits_use_source_backed_details()

    def test_family_refinement_audit_reports_low_precision_candidates(self):
        test_tno_water_family_refinement_audit_reports_low_precision_candidates()

    def test_family_refinement_terminal_review_monitors_local_clone(self):
        test_tno_water_family_refinement_terminal_review_monitors_local_clone()

    def test_family_refinement_terminal_review_monitors_standard_macro(self):
        test_tno_water_family_refinement_terminal_review_monitors_standard_macro()

    def test_family_refinement_terminal_source_reviews_exit_actionable_queues(self):
        test_tno_water_family_refinement_terminal_source_reviews_exit_actionable_queues()

    def test_family_refinement_recent_terminal_reviews_record_structured_evidence(self):
        test_tno_water_family_refinement_recent_terminal_reviews_record_structured_evidence()

    def test_bosporus_source_review_records_terminal_public_source(self):
        test_tno_bosporus_source_review_records_terminal_public_source()

    def test_family_refinement_audit_reports_high_precision_review_candidates(self):
        test_tno_water_family_refinement_audit_reports_high_precision_review_candidates()

    def test_family_refinement_rejects_invalid_source_review_contract(self):
        test_tno_water_family_refinement_rejects_invalid_source_review_contract()

    def test_water_validator_report_schema_locks_ocean_refinement_signals(self):
        test_tno_water_validator_report_schema_locks_ocean_refinement_signals()

    def test_water_validator_reports_aq_polar_spherical_diagnostics(self):
        test_tno_water_validator_reports_aq_polar_spherical_diagnostics()

    def test_manifest_and_startup_bundles_reflect_current_water_bootstrap(self):
        test_tno_manifest_and_startup_bundles_reflect_current_water_bootstrap()

    def test_water_validator_checks_geometry_collection_coordinates(self):
        test_tno_water_validator_checks_geometry_collection_coordinates()


def _mediterranean_fixture_collection(*entries):
    from shapely.geometry import mapping
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": feature_id, "atl_surface_kind": kind},
         "geometry": mapping(geom)} for feature_id, kind, geom in entries
    ]}


def test_mediterranean_validator_detects_cross_region_macro_gap():
    from shapely.geometry import box
    template = _mediterranean_fixture_collection(("template", "sea", box(16, 34, 23, 40)))
    sea = _mediterranean_fixture_collection(("ATLSEA_left", "sea", box(16, 34, 17, 40)))
    empty = _mediterranean_fixture_collection()
    result = collect_mediterranean_coverage(
        template=template, atlantropa=sea, ordinary_water=empty, land=empty,
        atlantropa_chunks=[("scenario_atlantropa.coarse.fixture", sea), ("scenario_atlantropa.detail.fixture", sea)],
    )
    assert result["surfaces"]["source"]["interior_gap_area_degrees2"] > 30
    assert any("source: uncovered" in failure for failure in result["failures"])
    assert any("missing Ionian" in failure for failure in result["failures"])


def test_mediterranean_validator_preserves_land_and_other_water_coverage():
    from shapely.geometry import box
    template = _mediterranean_fixture_collection(("template", "sea", box(0, 0, 10, 10)))
    atl = _mediterranean_fixture_collection(
        ("ATLSEA", "sea", box(0, 0, 4, 10)),
        ("ATLPRV", "land", box(4, 0, 6, 10)),
    )
    land = _mediterranean_fixture_collection(("island", "land", box(6, 0, 8, 10)))
    other_water = _mediterranean_fixture_collection(("ordinary_sea", "sea", box(8, 0, 10, 10)))
    result = collect_mediterranean_coverage(
        template=template, atlantropa=atl, ordinary_water=other_water, land=land,
        atlantropa_chunks=[("scenario_atlantropa.coarse.fixture", atl), ("scenario_atlantropa.detail.fixture", atl)],
    )
    assert result["failures"] == []
    assert result["surfaces"]["source"]["uncovered_area_degrees2"] == 0


def test_mediterranean_validator_detects_chunk_omission():
    from shapely.geometry import box
    sea = _mediterranean_fixture_collection(("ATLSEA", "sea", box(16, 34, 23, 40)))
    empty = _mediterranean_fixture_collection()
    result = collect_mediterranean_coverage(
        template=sea, atlantropa=sea, ordinary_water=empty, land=empty,
        atlantropa_chunks=[],
    )
    assert result["surfaces"]["source"]["interior_gap_area_degrees2"] == 0
    assert result["surfaces"]["chunks:detail"]["missing_sea_ids"] == ["ATLSEA"]
    assert any("chunks:detail: uncovered" in failure for failure in result["failures"])
    assert collect_mediterranean_coverage(
        template=sea, atlantropa=sea, ordinary_water=empty, land=empty,
        atlantropa_chunks=[], require_chunks=False,
    )["failures"] == []


def test_mediterranean_validator_allows_only_narrow_construction_seams():
    from shapely.geometry import box
    template = _mediterranean_fixture_collection(("template", "sea", box(0, 0, 10, 10)))
    sea = _mediterranean_fixture_collection(("ATLSEA", "sea", box(0.03, 0.03, 9.97, 9.97)))
    empty = _mediterranean_fixture_collection()
    result = collect_mediterranean_coverage(
        template=template, atlantropa=sea, ordinary_water=empty, land=empty,
        require_chunks=False,
    )
    assert result["surfaces"]["source"]["uncovered_area_degrees2"] > 0
    assert result["failures"] == []


def test_mediterranean_validator_requires_detail_even_when_coarse_is_complete():
    from shapely.geometry import box
    sea = _mediterranean_fixture_collection(("ATLSEA", "sea", box(16, 34, 23, 40)))
    empty = _mediterranean_fixture_collection()
    result = collect_mediterranean_coverage(
        template=sea, atlantropa=sea, ordinary_water=empty, land=empty,
        atlantropa_chunks=[("scenario_atlantropa.coarse.r0c0.json", sea)],
    )
    assert result["surfaces"]["chunks:coarse"]["interior_gap_area_degrees2"] == 0
    assert result["surfaces"]["chunks:detail"]["missing_sea_ids"] == ["ATLSEA"]
    assert all(not probe["covered"] for probe in result["surfaces"]["chunks:detail"]["probes"])
    assert any("chunks:detail: uncovered" in failure for failure in result["failures"])


def test_mediterranean_validator_declared_extent_excludes_red_sea_not_ionian_gap(monkeypatch):
    from shapely.geometry import box
    from tools import validate_tno_water_geometries as validator
    payload = _mediterranean_fixture_collection(
        ("med_ionian", "sea", box(16.5, 35.2, 22, 38.8)),
        ("red_sea_tail", "sea", box(33.5, 27.2, 34.2, 27.79)),
    )
    for feature in payload["features"]:
        feature["properties"]["region_group"] = "mediterranean"
    monkeypatch.setattr(validator, "_load_json", lambda path: payload)
    template = load_declared_mediterranean_template()
    assert template["coverage_domain_bounds"][1] == 27.8
    assert [f["properties"]["id"] for f in template["features"]] == ["med_ionian"]
    empty = _mediterranean_fixture_collection()
    result = collect_mediterranean_coverage(
        template=template, atlantropa=empty, ordinary_water=empty, land=empty, require_chunks=False,
    )
    assert result["surfaces"]["source"]["interior_gap_area_degrees2"] > 10
    assert any("source: uncovered" in failure for failure in result["failures"])
