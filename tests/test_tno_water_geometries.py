import json
import hashlib
import sys
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import nearest_points, unary_union
from topojson.utils import serialize_as_geojson


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import patch_tno_1962_bundle as tno_bundle
from tools.validate_tno_water_geometries import (
    _collect_d3_spherical_metrics,
    _topology_objects_to_feature_collections_for_d3,
)

SCENARIO_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "water_regions.geojson"
RUNTIME_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "runtime_topology.topo.json"
RUNTIME_BOOTSTRAP_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "runtime_topology.bootstrap.topo.json"
SCENARIO_NAMED_WATER_SNAPSHOT_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "derived" / "marine_regions_named_waters.snapshot.geojson"
SCENARIO_MANIFEST_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "manifest.json"
STARTUP_BUNDLE_EN_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "startup.bundle.en.json"
STARTUP_BUNDLE_ZH_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "startup.bundle.zh.json"
TARGET_OPEN_OCEAN_IDS = {
    "tno_northwest_pacific_ocean",
    "tno_northeast_pacific_ocean",
}
TRACKED_INLAND_WATER_IDS = {
    "tno_qyzylorda_inland_water",
}
TARGET_OPEN_OCEAN_MAX_COMPONENTS = {
    "tno_northwest_pacific_ocean": 7,
    "tno_northeast_pacific_ocean": 6,
}
MIN_COMPONENT_AREA = 0.05
WORLD_BBOX_WIDTH_THRESHOLD = 300.0
SEAM_DISTANCE_EPSILON = 5e-5
MACRO_LAND_OVERLAP_AREA_MIN = 20.0
MACRO_LAND_OVERLAP_RATIO_MAX = 0.08
MACRO_LAND_OVERLAP_ABS_MAX = 1.0
MACRO_INFLATION_LAND_DELTA_MAX = 0.05

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
    "tno_cardigan_bay",
    "tno_liverpool_bay",
    "tno_solway_firth",
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
}

TRACKED_NAMED_WATER_IDS = TRACKED_DETAIL_IDS | {
    "tno_black_sea",
    "tno_sea_of_azov",
    "tno_sea_of_marmara",
    "tno_bosporus_dardanelles",
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
    {"label": "swansea_bay", "point": (-3.99, 51.58), "allowed_ids": {"tno_swansea_bay"}},
    {"label": "carmarthen_bay", "point": (-4.41, 51.68), "allowed_ids": {"tno_carmarthen_bay"}},
    {"label": "bridgwater_bay", "point": (-3.18, 51.25), "allowed_ids": {"tno_bridgwater_bay"}},
    {"label": "barnstaple_bideford_bay", "point": (-4.312879, 51.065519), "allowed_ids": {"tno_barnstaple_bideford_bay"}},
    {"label": "wadden_sea", "point": (8.959014, 53.886707), "allowed_ids": {"tno_wadden_sea"}},
    {"label": "thames_estuary", "point": (1.002599, 51.430599), "allowed_ids": {"tno_thames_estuary"}},
    {"label": "blackwater_estuary", "point": (0.970901, 51.769569), "allowed_ids": {"tno_blackwater_estuary"}},
    {"label": "the_wash", "point": (0.31, 52.95), "allowed_ids": {"tno_the_wash"}},
    {"label": "humber_estuary", "point": (-0.18, 53.63), "allowed_ids": {"tno_humber_estuary"}},
    {"label": "firth_of_forth", "point": (-3.05, 56.0), "allowed_ids": {"tno_firth_of_forth"}},
    {"label": "moray_firth", "point": (-3.44, 57.75), "allowed_ids": {"tno_moray_firth"}},
    {"label": "pentland_firth", "point": (-3.02, 58.75), "allowed_ids": {"tno_pentland_firth"}},
    {"label": "poole_bay", "point": (-1.86, 50.62), "allowed_ids": {"tno_poole_bay"}},
    {"label": "solent", "point": (-1.23, 50.77), "allowed_ids": {"tno_solent"}},
    {"label": "cardigan_bay", "point": (-4.63, 52.12), "allowed_ids": {"tno_cardigan_bay"}},
    {"label": "liverpool_bay", "point": (-3.26, 53.46), "allowed_ids": {"tno_liverpool_bay"}},
    {"label": "solway_firth", "point": (-3.47, 54.93), "allowed_ids": {"tno_solway_firth"}},
    {"label": "black_sea", "point": (34.7, 43.4), "allowed_ids": {"tno_black_sea"}},
    {"label": "sea_of_azov", "point": (36.85, 46.1), "allowed_ids": {"tno_sea_of_azov"}},
    {"label": "sea_of_marmara", "point": (27.7, 40.75), "allowed_ids": {"tno_sea_of_marmara"}},
    {"label": "greenland_sea", "point": (-1.73, 76.73), "allowed_ids": {"tno_greenland_sea"}},
    {"label": "norwegian_sea", "point": (1.14, 68.58), "allowed_ids": {"tno_norwegian_sea"}},
    {"label": "barents_sea", "point": (43.11, 74.17), "allowed_ids": {"tno_barents_sea"}},
    {"label": "baffin_bay", "point": (-67.12, 74.50), "allowed_ids": {"tno_baffin_bay"}},
    {"label": "mozambique_channel", "point": (40.88, -19.30), "allowed_ids": {"tno_mozambique_channel"}},
    {"label": "gulf_of_guinea", "point": (3.05, 3.25), "allowed_ids": {"tno_gulf_of_guinea"}},
    {"label": "ross_sea", "point": (-168.0911, -78.5673), "allowed_ids": {"tno_ross_sea"}},
    {"label": "bering_sea", "point": (-170.8823, 58.7917), "allowed_ids": {"tno_bering_sea"}},
    {"label": "gulf_of_alaska", "point": (-147.3894, 57.3575), "allowed_ids": {"tno_gulf_of_alaska"}},
    {"label": "beaufort_sea", "point": (-136.1302, 72.7404), "allowed_ids": {"tno_beaufort_sea"}},
    {"label": "labrador_sea", "point": (-52.7329, 53.9977), "allowed_ids": {"tno_labrador_sea"}},
    {"label": "gulf_of_st_lawrence", "point": (-61.3940, 48.9139), "allowed_ids": {"tno_gulf_of_st_lawrence"}},
    {"label": "hudson_bay", "point": (-86.1234, 60.2827), "allowed_ids": {"tno_hudson_bay"}},
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
    ("tno_celtic_sea", "tno_english_channel"),
    ("tno_irish_sea", "tno_north_channel"),
    ("tno_baltic_sea", "tno_kattegat"),
    ("tno_baltic_sea", "tno_the_sound"),
    ("tno_north_sea", "tno_wadden_sea"),
    ("tno_north_sea", "tno_thames_estuary"),
    ("tno_north_sea", "tno_blackwater_estuary"),
    ("tno_north_sea", "tno_the_wash"),
    ("tno_black_sea", "tno_sea_of_azov"),
    ("tno_bosporus_dardanelles", "tno_sea_of_marmara"),
    ("tno_greenland_sea", "tno_norwegian_sea"),
    ("tno_norwegian_sea", "tno_northeast_atlantic_ocean"),
    ("tno_barents_sea", "tno_western_arctic_ocean"),
    ("tno_mozambique_channel", "tno_western_indian_ocean"),
    ("tno_english_channel", "tno_poole_bay"),
    ("tno_english_channel", "tno_solent"),
    ("tno_irish_sea", "tno_cardigan_bay"),
    ("tno_irish_sea", "tno_liverpool_bay"),
    ("tno_irish_sea", "tno_solway_firth"),
    ("tno_bering_sea", "tno_northeast_pacific_ocean"),
    ("tno_bering_sea", "tno_gulf_of_alaska"),
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
    ("tno_yellow_sea", "tno_bo_hai"),
    ("tno_bo_hai", "tno_liaodong_wan"),
    ("tno_east_china_sea", "tno_taiwan_strait"),
    ("tno_south_china_sea", "tno_gulf_of_tonkin"),
    ("tno_south_china_sea", "tno_gulf_of_thailand"),
    ("tno_south_china_sea", "tno_natuna_sea"),
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


def _load_water_chunk_features():
    features = []
    chunks_dir = ROOT / "data" / "scenarios" / "tno_1962" / "chunks"
    for path in sorted(chunks_dir.glob("water.*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        features.extend(payload.get("features", []) or [])
    return features


def _load_scenario_manifest():
    return json.loads(SCENARIO_MANIFEST_PATH.read_text(encoding="utf-8"))


def _load_startup_bundle(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


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


def _load_runtime_land_union():
    geometries = [
        shape(feature["geometry"])
        for feature in _load_runtime_political_features()
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
    metrics = _collect_d3_spherical_metrics({
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
    tracked_ids = TRACKED_NAMED_WATER_IDS | TRACKED_INLAND_WATER_IDS
    missing = sorted(feature_id for feature_id in tracked_ids if feature_id not in chunk_ids)
    assert missing == []


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
    bundle_paths = (STARTUP_BUNDLE_EN_PATH, STARTUP_BUNDLE_ZH_PATH)
    expected_runtime_sha = _sha256_path(RUNTIME_WATER_PATH)
    expected_bootstrap_sha = _sha256_path(RUNTIME_BOOTSTRAP_WATER_PATH)
    expected_named_marginal_count = len(tno_bundle.TNO_NAMED_MARGINAL_WATER_SPECS)

    assert int(manifest.get("summary", {}).get("tno_water_region_count") or 0) == source_feature_count
    assert int(manifest.get("summary", {}).get("tno_named_marginal_water_count") or 0) == expected_named_marginal_count

    for bundle_path in bundle_paths:
        bundle = _load_startup_bundle(bundle_path)
        manifest_subset = bundle.get("manifest_subset", {})
        source_meta = bundle.get("source", {})

        assert str(bundle.get("generated_at") or "") == str(manifest.get("generated_at") or "")
        assert str(bundle.get("baseline_hash") or "") == str(manifest.get("baseline_hash") or "")
        assert int(manifest_subset.get("summary", {}).get("tno_water_region_count") or 0) == source_feature_count
        assert int(manifest_subset.get("summary", {}).get("tno_named_marginal_water_count") or 0) == expected_named_marginal_count
        assert str(source_meta.get("runtime_topology_sha256") or "") == expected_runtime_sha
        assert str(source_meta.get("runtime_bootstrap_topology_sha256") or "") == expected_bootstrap_sha
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
