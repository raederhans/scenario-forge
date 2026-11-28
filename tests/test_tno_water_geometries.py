import json
import sys
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.ops import nearest_points, unary_union
from map_builder.json_source import read_json_source
from tools.scenario_topology_decode import topology_object_to_geojson


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.validate_tno_water_geometries import collect_d3_spherical_metrics, _topology_objects_to_feature_collections_for_d3

SCENARIO_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "water_regions.geojson"
RUNTIME_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "runtime_topology.topo.json"
SEAM_DISTANCE_EPSILON = 5e-5
PARENT_CHILD_OVERLAP_EPSILON = 1e-8
TRACKED_BASE_GEOGRAPHY_WATER_IDS = {
    "caspian_sea",
    "lake_superior",
    "lake_michigan",
    "lake_huron",
    "lake_erie",
    "lake_ontario",
}
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


TRACKED_COVERAGE_PROBES = [
    {"label": "gulf_of_riga", "point": (23.46, 57.71), "allowed_ids": {"tno_gulf_of_riga"}},
    {"label": "lillebaelt", "point": (9.84, 55.34), "allowed_ids": {"tno_lillebaelt"}},
    {"label": "norwegian_sea", "point": (1.14, 68.58), "allowed_ids": {"tno_norwegian_sea"}},
    {"label": "ross_sea", "point": (-168.0911, -78.5673), "allowed_ids": {"tno_ross_sea"}},
    {"label": "great_australian_bight", "point": (131.0, -34.0), "allowed_ids": {"tno_great_australian_bight"}},
]

TRACKED_SEAM_PAIRS = [
    ("tno_celtic_sea", "tno_northeast_atlantic_ocean"),
    ("tno_baltic_sea", "tno_kattegat"),
    ("tno_english_channel", "tno_lyme_bay"),
    ("tno_arafura_sea", "tno_timor_sea"),
]
def _load_scenario_water_features():
    payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding="utf-8"))
    return payload.get("features", [])


def _load_runtime_water_features():
    payload = read_json_source(RUNTIME_WATER_PATH)
    feature_collection = topology_object_to_geojson(payload, "scenario_water")
    return feature_collection.get("features", [])


def _load_runtime_topology_feature_collections_for_d3(object_names):
    payload = read_json_source(RUNTIME_WATER_PATH)
    return _topology_objects_to_feature_collections_for_d3(payload, object_names)


def _load_water_chunk_features():
    features = []
    chunks_dir = ROOT / "data" / "scenarios" / "tno_1962" / "chunks"
    for path in sorted(chunks_dir.glob("water.*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        features.extend(payload.get("features", []) or [])
    return features


def _feature_map(features):
    return {
        str(feature.get("properties", {}).get("id") or ""): feature
        for feature in features
        if str(feature.get("properties", {}).get("id") or "").strip()
    }


def _load_runtime_object_union(object_name):
    feature_collection = topology_object_to_geojson(read_json_source(RUNTIME_WATER_PATH), object_name)
    geometries = [
        shape(feature["geometry"])
        for feature in feature_collection.get("features", [])
        if feature.get("geometry")
    ]
    return unary_union(geometries)


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


def test_tno_base_geography_water_clones_are_cut_out_of_runtime_land_surfaces():
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


def test_tno_water_chunk_feature_ids_cover_current_detail_regions():
    chunk_ids = {
        str(feature.get("properties", {}).get("id") or "")
        for feature in _load_water_chunk_features()
    }
    missing = sorted(feature_id for feature_id in TRACKED_DETAIL_IDS if feature_id not in chunk_ids)
    assert missing == []


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
