import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from shapely import coverage_invalid_edges, coverage_is_valid
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import nearest_points, unary_union
from topojson.utils import serialize_as_geojson


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DEFAULT_SCENARIO_DIR = ROOT / "data" / "scenarios" / "tno_1962"
DEFAULT_REPORT_PATH = ROOT / ".runtime" / "reports" / "generated" / "tno_water_geometry_report.json"
WORLD_BBOX_WIDTH_THRESHOLD = 300.0
ANTIMERIDIAN_EPSILON = 1e-3
SEAM_DISTANCE_EPSILON = 5e-5
PARENT_CHILD_OVERLAP_EPSILON = 1e-8
MACRO_LAND_OVERLAP_AREA_MIN = 20.0
MACRO_LAND_OVERLAP_RATIO_MAX = 0.08
MACRO_LAND_OVERLAP_ABS_MAX = 1.0
MACRO_INFLATION_LAND_DELTA_MAX = 0.05
OCEAN_REFINEMENT_PHASE_TARGET_IDS = {
    "phase2_arctic": (
        "tno_greenland_sea",
        "tno_fram_strait",
        "tno_barents_sea",
        "tno_beaufort_sea",
        "tno_bering_sea",
        "tno_anadyrskiy_zaliv",
        "tno_hudson_strait",
    ),
    "phase3_southern_antimeridian": (
        "tno_ross_sea",
        "tno_weddell_sea",
        "tno_scotia_sea",
    ),
    "phase4_east_west_pacific": (
        "tno_sea_of_japan",
        "tno_east_china_sea",
        "tno_yellow_sea",
        "tno_south_china_sea",
        "tno_philippine_sea",
        "tno_sulu_sea",
        "tno_celebes_sea",
    ),
    "phase5_indian_ocean_oceania": (
        "tno_arabian_sea",
        "tno_bay_of_bengal",
        "tno_andaman_sea",
        "tno_malacca_strait",
        "tno_tasman_sea",
        "tno_great_australian_bight",
        "tno_mozambique_channel",
    ),
    "phase6_european_source_replacement": (
        "tno_bay_of_biscay",
        "tno_irish_sea",
        "tno_north_sea",
    ),
}
OCEAN_REFINEMENT_TARGET_IDS = tuple(
    sorted({feature_id for ids in OCEAN_REFINEMENT_PHASE_TARGET_IDS.values() for feature_id in ids})
)
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
    ("tno_norwegian_sea", "tno_northeast_atlantic_ocean"),
    ("tno_barents_sea", "tno_western_arctic_ocean"),
    ("tno_mozambique_channel", "tno_western_indian_ocean"),
    ("tno_english_channel", "tno_strait_of_dover"),
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
def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, got {type(payload).__name__}.")
    return payload


def _topology_object_to_feature_collection(topology_payload: dict, object_name: str) -> dict | None:
    if object_name not in (topology_payload.get("objects") or {}):
        return None
    return serialize_as_geojson(topology_payload, objectname=object_name)


def _topology_objects_to_feature_collections_for_d3(
    topology_payload: dict,
    object_names: list[str],
) -> dict[str, dict]:
    target_names = [
        object_name
        for object_name in object_names
        if object_name in (topology_payload.get("objects") or {})
    ]
    if not target_names:
        return {}
    script = r"""
const fs = require("fs");
const vm = require("vm");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("vendor/topojson-client.min.js", "utf8"), sandbox);
const topojson = sandbox.topojson;
const topology = payload.topology;
const out = {};
for (const objectName of payload.objectNames || []) {
  if (topology && topology.objects && topology.objects[objectName]) {
    out[objectName] = topojson.feature(topology, topology.objects[objectName]);
  }
}
process.stdout.write(JSON.stringify(out));
"""
    completed = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"topology": topology_payload, "objectNames": target_names}),
        text=True,
        encoding="utf-8",
        capture_output=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(completed.stdout or "{}")


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


def _feature_id(feature: dict) -> str:
    properties = feature.get("properties") or {}
    return str(properties.get("id") or feature.get("id") or "").strip()


def _feature_map(feature_collection: dict) -> dict[str, dict]:
    return {
        _feature_id(feature): feature
        for feature in feature_collection.get("features") or []
        if _feature_id(feature)
    }


def _bbox_width(geometry) -> float:
    min_x, _, max_x, _ = geometry.bounds
    return float(max_x - min_x)


def _part_bounds(parts) -> list[list[float]]:
    return [[float(value) for value in part.bounds] for part in parts]


def _is_antimeridian_split_feature(geometry) -> bool:
    parts = _iter_polygon_parts(geometry)
    if len(parts) < 2:
      return False
    feature_bounds = geometry.bounds
    min_x = float(feature_bounds[0])
    max_x = float(feature_bounds[2])
    touches_left = any(abs(float(part.bounds[0]) + 180.0) <= ANTIMERIDIAN_EPSILON for part in parts)
    touches_right = any(abs(float(part.bounds[2]) - 180.0) <= ANTIMERIDIAN_EPSILON for part in parts)
    if not (touches_left and touches_right):
        return False
    return abs(min_x + 180.0) <= ANTIMERIDIAN_EPSILON and abs(max_x - 180.0) <= ANTIMERIDIAN_EPSILON


def _iter_coordinate_pairs(value):
    if not isinstance(value, list):
        return
    if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
        yield float(value[0]), float(value[1])
        return
    for item in value:
        yield from _iter_coordinate_pairs(item)


def _iter_geometry_coordinate_pairs(geometry):
    if not isinstance(geometry, dict):
        return
    if str(geometry.get("type") or "").strip() == "GeometryCollection":
        geometries = geometry.get("geometries")
        if isinstance(geometries, list):
            for child in geometries:
                yield from _iter_geometry_coordinate_pairs(child)
        return
    yield from _iter_coordinate_pairs(geometry.get("coordinates"))


def _collect_feature_metrics(feature_collection: dict, *, label: str) -> dict:
    invalid = []
    empty = []
    out_of_range_coordinates = []
    oversized_features = []
    oversized_parts = []
    antimeridian_split_features = []
    feature_ids = []
    for feature in feature_collection.get("features") or []:
        feature_id = _feature_id(feature)
        feature_ids.append(feature_id)
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            empty.append(feature_id)
            continue
        bad_coordinate_samples = [
            [lon, lat]
            for lon, lat in _iter_geometry_coordinate_pairs(geometry_payload) or []
            if lon < -180.0 or lon > 180.0 or lat < -90.0 or lat > 90.0
        ]
        if bad_coordinate_samples:
            out_of_range_coordinates.append({
                "id": feature_id,
                "samples": bad_coordinate_samples[:5],
            })
        geometry = shape(geometry_payload)
        if geometry.is_empty:
            empty.append(feature_id)
            continue
        if not geometry.is_valid:
            invalid.append(feature_id)
        width = _bbox_width(geometry)
        parts = _iter_polygon_parts(geometry)
        if width > WORLD_BBOX_WIDTH_THRESHOLD:
            record = {
                "id": feature_id,
                "bbox_width": width,
                "part_count": len(parts),
                "part_bounds": _part_bounds(parts),
            }
            if _is_antimeridian_split_feature(geometry):
                antimeridian_split_features.append(record)
            else:
                oversized_features.append(record)
        for part in parts:
            part_width = _bbox_width(part)
            if part_width > WORLD_BBOX_WIDTH_THRESHOLD:
                oversized_parts.append({
                    "id": feature_id,
                    "bbox_width": part_width,
                    "bounds": [float(value) for value in part.bounds],
                })
    return {
        "label": label,
        "feature_count": len(feature_ids),
        "feature_ids": sorted(filter(None, feature_ids)),
        "invalid_feature_ids": sorted(filter(None, invalid)),
        "empty_feature_ids": sorted(filter(None, empty)),
        "out_of_range_coordinates": out_of_range_coordinates,
        "oversized_feature_bboxes": oversized_features,
        "oversized_part_bboxes": oversized_parts,
        "antimeridian_split_features": antimeridian_split_features,
    }


def _load_runtime_topology_feature_collection(path: Path, object_name: str) -> dict:
    topology_payload = _load_json(path)
    return serialize_as_geojson(topology_payload, objectname=object_name)


def _load_chunk_feature_collections(scenario_dir: Path, pattern: str = "water.*.json") -> list[tuple[str, dict]]:
    chunks_dir = scenario_dir / "chunks"
    feature_collections = []
    for path in sorted(chunks_dir.glob(pattern)):
        payload = _load_json(path)
        if str(payload.get("type") or "").strip() != "FeatureCollection":
            continue
        feature_collections.append((path.name, payload))
    return feature_collections


def _collect_chunk_metrics(scenario_dir: Path) -> dict:
    return _collect_chunk_metrics_from_feature_collections(_load_chunk_feature_collections(scenario_dir))


def _collect_chunk_metrics_from_feature_collections(chunk_feature_collections: list[tuple[str, dict]] | None) -> dict:
    metrics = []
    feature_ids = set()
    invalid = []
    empty = []
    out_of_range_coordinates = []
    oversized_parts = []
    oversized_features = []
    antimeridian_split_features = []
    for label, feature_collection in chunk_feature_collections or []:
        metric = _collect_feature_metrics(feature_collection, label=label)
        metrics.append(metric)
        feature_ids.update(metric["feature_ids"])
        invalid.extend(metric["invalid_feature_ids"])
        empty.extend(metric["empty_feature_ids"])
        out_of_range_coordinates.extend(metric["out_of_range_coordinates"])
        oversized_features.extend(metric["oversized_feature_bboxes"])
        oversized_parts.extend(metric["oversized_part_bboxes"])
        antimeridian_split_features.extend(metric["antimeridian_split_features"])
    return {
        "chunk_count": len(metrics),
        "chunks": metrics,
        "feature_ids": sorted(feature_ids),
        "invalid_feature_ids": sorted(set(filter(None, invalid))),
        "empty_feature_ids": sorted(set(filter(None, empty))),
        "out_of_range_coordinates": out_of_range_coordinates,
        "oversized_feature_bboxes": oversized_features,
        "oversized_part_bboxes": oversized_parts,
        "antimeridian_split_features": antimeridian_split_features,
    }


def _collect_ocean_refinement_target_metrics(
    *,
    source_water: dict,
    source_ids: set[str],
    runtime_ids: set[str],
    chunk_ids: set[str],
    require_chunks: bool = True,
) -> dict:
    feature_map = _feature_map(source_water)
    phases = {}
    all_missing = []
    for phase, target_ids in OCEAN_REFINEMENT_PHASE_TARGET_IDS.items():
        target_records = []
        missing = {"source": [], "runtime": [], "chunks": []}
        for feature_id in target_ids:
            feature = feature_map.get(feature_id)
            props = feature.get("properties") if feature else {}
            record = {
                "id": feature_id,
                "in_source": feature_id in source_ids,
                "in_runtime": feature_id in runtime_ids,
                "in_chunks": feature_id in chunk_ids,
                "water_type": str((props or {}).get("water_type") or ""),
                "region_group": str((props or {}).get("region_group") or ""),
                "parent_id": str((props or {}).get("parent_id") or ""),
                "source_standard": str((props or {}).get("source_standard") or ""),
            }
            surfaces = [
                ("source", "in_source"),
                ("runtime", "in_runtime"),
            ]
            if require_chunks:
                surfaces.append(("chunks", "in_chunks"))
            for surface, present_key in surfaces:
                if not record[present_key]:
                    missing[surface].append(feature_id)
                    all_missing.append({"phase": phase, "surface": surface, "id": feature_id})
            target_records.append(record)
        phases[phase] = {
            "target_count": len(target_ids),
            "targets": target_records,
            "missing": missing,
        }
    return {
        "target_count": len(OCEAN_REFINEMENT_TARGET_IDS),
        "target_ids": list(OCEAN_REFINEMENT_TARGET_IDS),
        "phases": phases,
        "missing": all_missing,
    }


def collect_d3_spherical_metrics(feature_collections: dict[str, dict]) -> dict:
    if not feature_collections:
        return {}
    script = r"""
const fs = require("fs");
const vm = require("vm");
const payload = JSON.parse(fs.readFileSync(0, "utf8"));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("vendor/d3.v7.min.js", "utf8"), sandbox);
const d3 = sandbox.d3;

function isWorldBounds(bounds) {
  return !!(
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Math.abs(Number(bounds[0][0]) + 180) < 1e-9 &&
    Math.abs(Number(bounds[0][1]) + 90) < 1e-9 &&
    Math.abs(Number(bounds[1][0]) - 180) < 1e-9 &&
    Math.abs(Number(bounds[1][1]) - 90) < 1e-9
  );
}

function featureId(feature) {
  const props = feature && feature.properties ? feature.properties : {};
  return String(props.id || feature.id || "").trim() || "<unknown>";
}

function polygonParts(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  if (geometry.type === "Polygon") return [geometry];
  if (geometry.type === "MultiPolygon") {
    return (Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      .map((coordinates) => ({ type: "Polygon", coordinates }));
  }
  if (geometry.type === "GeometryCollection") {
    return (Array.isArray(geometry.geometries) ? geometry.geometries : []).flatMap(polygonParts);
  }
  return [];
}

function diagnostics(geometry) {
  const feature = { type: "Feature", properties: {}, geometry };
  const area = Number(d3.geoArea(feature));
  const bounds = d3.geoBounds(feature);
  const worldBounds = isWorldBounds(bounds);
  const excessiveArea = Number.isFinite(area) && area > Math.PI * 2;
  return { area, bounds, worldBounds, excessiveArea, invalid: worldBounds || excessiveArea };
}

function analyzeCollection(collection, includeFeatureDiagnostics = false) {
  const invalidFeatures = [];
  const invalidParts = [];
  const featureDiagnosticsRows = [];
  const features = Array.isArray(collection && collection.features) ? collection.features : [];
  for (const feature of features) {
    if (!feature || !feature.geometry) continue;
    const id = featureId(feature);
    const featureDiagnostics = diagnostics(feature.geometry);
    if (includeFeatureDiagnostics) {
      featureDiagnosticsRows.push({ id, ...featureDiagnostics });
    }
    if (featureDiagnostics.invalid) {
      invalidFeatures.push({ id, ...featureDiagnostics });
    }
    polygonParts(feature.geometry).forEach((part, index) => {
      const partDiagnostics = diagnostics(part);
      if (partDiagnostics.invalid) {
        invalidParts.push({ id, partIndex: index, ...partDiagnostics });
      }
    });
  }
  return {
    featureCount: features.length,
    invalidFeatureCount: invalidFeatures.length,
    invalidPartCount: invalidParts.length,
    invalidFeatures,
    invalidParts,
    featureDiagnostics: featureDiagnosticsRows,
  };
}

const report = {};
for (const [label, collection] of Object.entries(payload.collections || {})) {
  report[label] = analyzeCollection(collection, String(label).startsWith("aq_"));
}
process.stdout.write(JSON.stringify(report));
"""
    completed = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"collections": feature_collections}),
        text=True,
        encoding="utf-8",
        capture_output=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(completed.stdout or "{}")


def _aq_polar_feature_collection(runtime_political: dict | None) -> dict:
    features = []
    for feature in (runtime_political or {}).get("features") or []:
        if not isinstance(feature, dict):
            continue
        feature_id = _feature_id(feature).upper()
        if feature_id == "AQ" or feature_id.startswith("AQ_"):
            features.append(feature)
    return {"type": "FeatureCollection", "features": features}


def _collect_aq_polar_spherical_diagnostics(
    *,
    scenario_id: str,
    aq_polar_runtime: dict,
    d3_spherical_metrics: dict,
) -> dict:
    metrics = d3_spherical_metrics.get("aq_polar_runtime") or {}
    feature_diagnostics = metrics.get("featureDiagnostics")
    feature_diagnostics = feature_diagnostics if isinstance(feature_diagnostics, list) else []
    failures = []
    if scenario_id == "tno_1962" and not feature_diagnostics:
        failures.append({"reason": "missing_aq_runtime_feature"})
    for row in feature_diagnostics:
        if not isinstance(row, dict):
            continue
        if row.get("invalid"):
            failures.append(
                {
                    "reason": "invalid_d3_spherical_geometry",
                    "id": str(row.get("id") or ""),
                    "worldBounds": bool(row.get("worldBounds")),
                    "excessiveArea": bool(row.get("excessiveArea")),
                }
            )
    return {
        "feature_count": len(aq_polar_runtime.get("features") or []),
        "failure_count": len(failures),
        "failures": failures,
        "features": feature_diagnostics,
    }


def _collect_ocean_macro_coverage(feature_collection: dict) -> dict:
    ocean_features = [
        feature for feature in (feature_collection.get("features") or [])
        if str((feature.get("properties") or {}).get("region_group") or "").strip() == "ocean_macro"
    ]
    polygonal = []
    for feature in ocean_features:
        geometry_payload = feature.get("geometry")
        if not geometry_payload:
            continue
        geom = shape(geometry_payload)
        if geom.is_empty:
            continue
        polygonal.append((_feature_id(feature), geom))
    if not polygonal:
        return {
            "feature_count": 0,
            "is_valid": True,
            "pairwise_overlap_count": 0,
            "overlaps": [],
            "legacy_coverage_valid": True,
            "legacy_invalid_edge_count": 0,
        }
    overlaps = []
    for index, (left_id, left_geom) in enumerate(polygonal):
        for right_id, right_geom in polygonal[index + 1:]:
            intersection = left_geom.intersection(right_geom)
            overlap_area = float(intersection.area) if not intersection.is_empty else 0.0
            if overlap_area > 1e-6:
                overlaps.append({
                    "left_id": left_id,
                    "right_id": right_id,
                    "overlap_area": overlap_area,
                    "bounds": [float(value) for value in intersection.bounds],
                })
    legacy_invalid_edges = coverage_invalid_edges([geom for _, geom in polygonal])
    legacy_invalid_edge_count = 0
    if legacy_invalid_edges is not None:
        if hasattr(legacy_invalid_edges, "is_empty"):
            if not legacy_invalid_edges.is_empty:
                if hasattr(legacy_invalid_edges, "geoms"):
                    legacy_invalid_edge_count = len(list(legacy_invalid_edges.geoms))
                else:
                    legacy_invalid_edge_count = 1
        else:
            legacy_invalid_edge_count = sum(
                1
                for edge in legacy_invalid_edges
                if edge is not None and not getattr(edge, "is_empty", True)
            )
    return {
        "feature_count": len(polygonal),
        "is_valid": len(overlaps) == 0,
        "pairwise_overlap_count": len(overlaps),
        "overlaps": overlaps,
        "legacy_coverage_valid": bool(coverage_is_valid([geom for _, geom in polygonal])),
        "legacy_invalid_edge_count": legacy_invalid_edge_count,
    }


def _collect_probe_coverage(feature_collection: dict) -> dict:
    feature_map = _feature_map(feature_collection)
    probe_results = []
    failures = []
    for probe in TRACKED_COVERAGE_PROBES:
        point = Point(*probe["point"])
        hits = []
        for feature_id in sorted(probe["allowed_ids"]):
            feature = feature_map.get(feature_id)
            if feature is None:
                continue
            geometry = shape(feature.get("geometry"))
            if geometry.contains(point) or geometry.touches(point):
                hits.append(feature_id)
        result = {
            "label": probe["label"],
            "point": list(probe["point"]),
            "allowed_ids": sorted(probe["allowed_ids"]),
            "hits": hits,
        }
        probe_results.append(result)
        if not hits:
            failures.append(result)
    return {"probes": probe_results, "failures": failures}


def _collect_named_water_seams(feature_collection: dict) -> dict:
    feature_map = _feature_map(feature_collection)
    seam_results = []
    failures = []
    for left_id, right_id in TRACKED_SEAM_PAIRS:
        left_feature = feature_map.get(left_id)
        right_feature = feature_map.get(right_id)
        if left_feature is None or right_feature is None:
            failures.append({"pair": [left_id, right_id], "reason": "missing_feature"})
            continue
        left_geom = shape(left_feature.get("geometry"))
        right_geom = shape(right_feature.get("geometry"))
        distance = float(left_geom.distance(right_geom))
        left_point, right_point = nearest_points(left_geom, right_geom)
        result = {
            "pair": [left_id, right_id],
            "distance": distance,
            "left_point": [float(v) for v in left_point.coords[0]],
            "right_point": [float(v) for v in right_point.coords[0]],
        }
        seam_results.append(result)
        if distance > SEAM_DISTANCE_EPSILON:
            failures.append(result)
    overlap_results = []
    overlap_failures = []
    skipped_external_parent_count = 0
    for child_feature in feature_collection.get("features") or []:
        child_props = child_feature.get("properties") or {}
        child_id = child_props.get("id")
        parent_id = child_props.get("parent_id")
        if not parent_id:
            continue
        parent_feature = feature_map.get(parent_id)
        if parent_feature is None or child_feature is None:
            skipped_external_parent_count += 1
            continue
        overlap_area = float(
            shape(parent_feature.get("geometry")).intersection(shape(child_feature.get("geometry"))).area
        )
        result = {
            "pair": [parent_id, child_id],
            "overlap_area": overlap_area,
        }
        overlap_results.append(result)
        if overlap_area > PARENT_CHILD_OVERLAP_EPSILON:
            overlap_failures.append(result)
    failures.extend(overlap_failures)
    return {
        "pairs": seam_results,
        "parent_child_overlap_pairs": overlap_results,
        "parent_child_overlap_checked_count": len(overlap_results),
        "parent_child_overlap_skipped_external_parent_count": skipped_external_parent_count,
        "failures": failures,
    }


def _collect_macro_land_overlap(feature_collection: dict, political_feature_collection: dict) -> dict:
    land_geometries = [
        shape(feature.get("geometry"))
        for feature in (political_feature_collection.get("features") or [])
        if feature.get("geometry")
    ]
    land_union = unary_union(land_geometries) if land_geometries else None
    suspicious = []
    checked_count = 0
    for feature in (feature_collection.get("features") or []):
        props = feature.get("properties") or {}
        if str(props.get("region_group") or "").strip() != "marine_macro":
            continue
        geometry_payload = feature.get("geometry")
        if not geometry_payload or land_union is None:
            continue
        geometry = shape(geometry_payload)
        area = float(geometry.area)
        if area < MACRO_LAND_OVERLAP_AREA_MIN:
            continue
        checked_count += 1
        land_overlap_area = float(geometry.intersection(land_union).area)
        land_overlap_ratio = land_overlap_area / area
        if (
            land_overlap_ratio > MACRO_LAND_OVERLAP_RATIO_MAX
            and land_overlap_area > MACRO_LAND_OVERLAP_ABS_MAX
        ):
            suspicious.append({
                "id": _feature_id(feature),
                "area": area,
                "land_overlap_area": land_overlap_area,
                "land_overlap_ratio": land_overlap_ratio,
            })
    return {
        "feature_count": sum(
            1
            for feature in (feature_collection.get("features") or [])
            if str((feature.get("properties") or {}).get("region_group") or "").strip() == "marine_macro"
        ),
        "checked_count": checked_count,
        "suspicious_count": len(suspicious),
        "suspicious_macros": suspicious,
    }


def _collect_named_water_snapshot_inflation(feature_collection: dict, snapshot_feature_collection: dict, political_feature_collection: dict) -> dict:
    land_geometries = [
        shape(feature.get("geometry"))
        for feature in (political_feature_collection.get("features") or [])
        if feature.get("geometry")
    ]
    land_union = unary_union(land_geometries) if land_geometries else None
    snapshot_feature_map = _feature_map(snapshot_feature_collection)
    suspicious = []
    checked_count = 0
    for feature in (feature_collection.get("features") or []):
        props = feature.get("properties") or {}
        feature_id = _feature_id(feature)
        if str(props.get("region_group") or "").strip() != "marine_macro":
            continue
        snapshot_feature = snapshot_feature_map.get(feature_id)
        if snapshot_feature is None or land_union is None:
            continue
        source_geometry = shape(snapshot_feature.get("geometry"))
        source_area = float(source_geometry.area)
        if source_area < MACRO_LAND_OVERLAP_AREA_MIN:
            continue
        final_geometry = shape(feature.get("geometry"))
        final_area = float(final_geometry.area)
        if source_area <= 0.0 or final_area <= 0.0:
            continue
        checked_count += 1
        source_land_overlap_ratio = float(source_geometry.intersection(land_union).area) / source_area
        final_land_overlap_ratio = float(final_geometry.intersection(land_union).area) / final_area
        if (final_land_overlap_ratio - source_land_overlap_ratio) > MACRO_INFLATION_LAND_DELTA_MAX:
            suspicious.append({
                "id": feature_id,
                "source_area": source_area,
                "final_area": final_area,
                "source_land_overlap_ratio": source_land_overlap_ratio,
                "final_land_overlap_ratio": final_land_overlap_ratio,
            })
    return {
        "checked_count": checked_count,
        "suspicious_count": len(suspicious),
        "suspicious_macros": suspicious,
    }


# Degrees in the source coordinate system, not kilometres. Existing sea builders
# reserve 0.03 around coasts, 0.002 around ATL land and 0.0004 between sea patches.
MEDITERRANEAN_COVERAGE_GUARD = 0.03 + 0.002 + 0.0004
MEDITERRANEAN_COVERAGE_PROBES = ((18.0, 36.0), (20.0, 36.0), (20.0, 38.0))


def _atlantropa_sea_collection(collection: dict) -> dict:
    return {"type": "FeatureCollection", "features": [
        feature for feature in collection.get("features", [])
        if (feature.get("properties") or {}).get("atl_surface_kind") == "sea"
        or (feature.get("properties") or {}).get("atl_render_layer") == "water"
    ]}


def collect_mediterranean_coverage(
    *, template: dict, atlantropa: dict, ordinary_water: dict, land: dict,
    atlantropa_chunks: list[tuple[str, dict]] | None = None,
    require_chunks: bool = True,
) -> dict:
    """Detect uncovered interiors across regional AOIs, allowing only coastal seams."""
    template_geom = unary_union([shape(f["geometry"]) for f in template.get("features", [])])

    def local_union(features):
        parts = []
        for feature in features:
            geom = shape(feature["geometry"])
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.intersects(template_geom):
                parts.append(geom.intersection(template_geom))
        return unary_union(parts)

    sea = _atlantropa_sea_collection(atlantropa)
    sea_ids = {str((f.get("properties") or {}).get("id") or f.get("id")) for f in sea["features"]}
    atl_land = [f for f in atlantropa.get("features", []) if
                (f.get("properties") or {}).get("atl_render_layer") == "land"
                or (f.get("properties") or {}).get("atl_surface_kind") == "land"]
    fixed_coverage = local_union(land.get("features", []) + atl_land + ordinary_water.get("features", []))
    collections = {"source": sea}
    if require_chunks:
        # Each LOD must stand alone; a complete coarse layer must not conceal
        # a missing detail tile when the renderer promotes to detail geometry.
        for lod in ("coarse", "detail"):
            collections[f"chunks:{lod}"] = _atlantropa_sea_collection({
                "features": [f for label, collection in atlantropa_chunks or []
                             if f".{lod}." in label for f in collection.get("features", [])]
            })
    surfaces = {}
    failures = []
    for label, collection in collections.items():
        sea_geom = local_union(collection["features"])
        uncovered = template_geom.difference(fixed_coverage.union(sea_geom))
        interior = uncovered.buffer(-MEDITERRANEAN_COVERAGE_GUARD)
        probes = [{"point": list(point), "covered": bool(sea_geom.covers(Point(point)))}
                  for point in MEDITERRANEAN_COVERAGE_PROBES if template_geom.covers(Point(point))]
        ids = {str((f.get("properties") or {}).get("id") or f.get("id")) for f in collection["features"]}
        missing_ids = sorted(sea_ids - ids)
        surfaces[label] = {
            "uncovered_area_degrees2": float(uncovered.area),
            "interior_gap_area_degrees2": float(interior.area),
            "interior_gap_bounds": list(interior.bounds) if not interior.is_empty else None,
            "probes": probes, "missing_sea_ids": missing_ids,
        }
        if interior.area > 1e-10:
            failures.append(f"{label}: uncovered Mediterranean interior")
        if any(not probe["covered"] for probe in probes):
            failures.append(f"{label}: missing Ionian probe coverage")
        if missing_ids:
            failures.append(f"{label}: missing Atlantropa sea features")
    return {"coastal_guard_degrees": MEDITERRANEAN_COVERAGE_GUARD,
            "coverage_domain_bounds": template.get("coverage_domain_bounds"),
            "surfaces": surfaces, "failures": failures}


def build_report_from_collections(
    *,
    scenario_id: str,
    source_water: dict,
    named_water_snapshot: dict,
    runtime_topology_payload: dict | None = None,
    runtime_water: dict | None = None,
    runtime_political: dict | None = None,
    runtime_land_mask: dict | None = None,
    runtime_context_land_mask: dict | None = None,
    chunk_feature_collections: list[tuple[str, dict]] | None = None,
    require_chunks: bool = True,
    mediterranean_template: dict | None = None,
    scenario_atlantropa: dict | None = None,
    atlantropa_chunk_feature_collections: list[tuple[str, dict]] | None = None,
) -> dict:
    d3_runtime_collections = {}
    if runtime_topology_payload is not None:
        d3_runtime_collections = _topology_objects_to_feature_collections_for_d3(
            runtime_topology_payload,
            ["scenario_water", "political", "land_mask", "context_land_mask"],
        )
        runtime_water = runtime_water or d3_runtime_collections.get("scenario_water")
        runtime_political = runtime_political or d3_runtime_collections.get("political")
        runtime_land_mask = runtime_land_mask or d3_runtime_collections.get("land_mask")
        runtime_context_land_mask = runtime_context_land_mask or d3_runtime_collections.get("context_land_mask")
    if runtime_water is None or runtime_political is None:
        raise ValueError("Runtime water validator requires runtime_water and runtime_political feature collections.")
    chunk_metrics = _collect_chunk_metrics_from_feature_collections(chunk_feature_collections)
    source_metrics = _collect_feature_metrics(source_water, label="water_regions.geojson")
    runtime_metrics = _collect_feature_metrics(runtime_water, label="runtime_topology.topo.json::scenario_water")
    runtime_land_mask_metrics = _collect_feature_metrics(
        runtime_land_mask or {"type": "FeatureCollection", "features": []},
        label="runtime_topology.topo.json::land_mask",
    )
    runtime_context_land_mask_metrics = _collect_feature_metrics(
        runtime_context_land_mask or {"type": "FeatureCollection", "features": []},
        label="runtime_topology.topo.json::context_land_mask",
    )
    d3_collections = {
        "source": source_water,
        "runtime": runtime_water,
        "runtime_land_mask": d3_runtime_collections.get("land_mask")
        or runtime_land_mask
        or {"type": "FeatureCollection", "features": []},
        "runtime_context_land_mask": d3_runtime_collections.get("context_land_mask")
        or runtime_context_land_mask
        or {"type": "FeatureCollection", "features": []},
    }
    aq_polar_runtime = _aq_polar_feature_collection(runtime_political)
    if aq_polar_runtime["features"]:
        d3_collections["aq_polar_runtime"] = aq_polar_runtime
    for label, collection in chunk_feature_collections or []:
        d3_collections[f"chunk:{label}"] = collection
    mediterranean_checks = {}
    if mediterranean_template is not None and scenario_atlantropa is not None:
        mediterranean_checks["mediterranean_coverage"] = collect_mediterranean_coverage(
            template=mediterranean_template, atlantropa=scenario_atlantropa,
            ordinary_water=source_water, land=runtime_land_mask or runtime_political,
            atlantropa_chunks=atlantropa_chunk_feature_collections, require_chunks=require_chunks,
        )
        mediterranean_checks["atlantropa_sea"] = _collect_feature_metrics(
            _atlantropa_sea_collection(scenario_atlantropa), label="scenario_atlantropa::sea")
        d3_collections["atlantropa_sea"] = _atlantropa_sea_collection(scenario_atlantropa)
        for label, collection in atlantropa_chunk_feature_collections or []:
            d3_collections[f"chunk:{label}"] = _atlantropa_sea_collection(collection)
    d3_spherical_metrics = collect_d3_spherical_metrics(d3_collections)
    source_ids = set(source_metrics["feature_ids"])
    runtime_ids = set(runtime_metrics["feature_ids"])
    chunk_ids = set(chunk_metrics["feature_ids"])
    return {
        "scenario_id": scenario_id,
        "contract": {
            "name": "tno_water_geometry",
            "schema_version": 3,
            "ocean_refinement_phase_targets": {
                phase: list(target_ids)
                for phase, target_ids in OCEAN_REFINEMENT_PHASE_TARGET_IDS.items()
            },
        },
        "checks": {
            **mediterranean_checks,
            "source": source_metrics,
            "runtime": runtime_metrics,
            "runtime_land_mask": runtime_land_mask_metrics,
            "runtime_context_land_mask": runtime_context_land_mask_metrics,
            "chunks": chunk_metrics,
            "d3_spherical": d3_spherical_metrics,
            "ocean_macro_coverage": _collect_ocean_macro_coverage(source_water),
            "first_wave_probe_coverage": _collect_probe_coverage(source_water),
            "first_wave_named_water_seams": _collect_named_water_seams(source_water),
            "aq_polar_spherical_diagnostics": _collect_aq_polar_spherical_diagnostics(
                scenario_id=scenario_id,
                aq_polar_runtime=aq_polar_runtime,
                d3_spherical_metrics=d3_spherical_metrics,
            ),
            "macro_land_overlap": _collect_macro_land_overlap(source_water, runtime_political),
            "named_water_snapshot_inflation": _collect_named_water_snapshot_inflation(
                source_water,
                named_water_snapshot,
                runtime_political,
            ),
            "id_consistency": {
                "source_only": sorted(source_ids - runtime_ids),
                "runtime_only": sorted(runtime_ids - source_ids),
                "chunk_missing": sorted(source_ids - chunk_ids),
                "chunk_only": sorted(chunk_ids - source_ids),
            },
            "ocean_refinement_targets": _collect_ocean_refinement_target_metrics(
                source_water=source_water,
                source_ids=source_ids,
                runtime_ids=runtime_ids,
                chunk_ids=chunk_ids,
                require_chunks=require_chunks,
            ),
        },
    }


def load_declared_mediterranean_template() -> dict:
    # Lazy import: the builder also uses this validator for intermediate stages.
    from tools.patch_tno_1962_bundle import mediterranean_construction_domain_bounds

    domain_bounds = mediterranean_construction_domain_bounds()
    if domain_bounds is None:
        raise ValueError("Mediterranean construction domain is empty.")
    domain = box(*domain_bounds)
    features = []
    for feature in _load_json(ROOT / "data" / "water_regions.geojson")["features"]:
        if (feature.get("properties") or {}).get("region_group") != "mediterranean":
            continue
        geom = shape(feature["geometry"]).intersection(domain)
        if not geom.is_empty:
            features.append({**feature, "geometry": mapping(geom)})
    return {"type": "FeatureCollection", "features": features,
            "coverage_domain_bounds": list(domain.bounds)}


def build_report(scenario_dir: Path) -> dict:
    return build_report_from_collections(
        scenario_id=scenario_dir.name,
        source_water=_load_json(scenario_dir / "water_regions.geojson"),
        runtime_topology_payload=_load_json(scenario_dir / "runtime_topology.topo.json"),
        named_water_snapshot=_load_json(scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson"),
        chunk_feature_collections=_load_chunk_feature_collections(scenario_dir),
        require_chunks=True,
        mediterranean_template=load_declared_mediterranean_template(),
        scenario_atlantropa=_topology_objects_to_feature_collections_for_d3(
            _load_json(scenario_dir / "scenario_atlantropa.topo.json"), ["scenario_atlantropa"]
        )["scenario_atlantropa"],
        atlantropa_chunk_feature_collections=_load_chunk_feature_collections(scenario_dir, "scenario_atlantropa.*.json"),
    )


def summarize_failures(report: dict, *, require_chunks: bool = True) -> list[str]:
    failures = []
    checks = report["checks"]
    section_names = ["source", "runtime", "runtime_land_mask", "runtime_context_land_mask"]
    if require_chunks:
        section_names.append("chunks")
    if "atlantropa_sea" in checks:
        section_names.append("atlantropa_sea")
    for failure in (checks.get("mediterranean_coverage") or {}).get("failures", []):
        failures.append(f"mediterranean_coverage: {failure}")
    for section_name in section_names:
        section = checks[section_name]
        if section["invalid_feature_ids"]:
            failures.append(f"{section_name}: invalid={len(section['invalid_feature_ids'])}")
        if section["empty_feature_ids"]:
            failures.append(f"{section_name}: empty={len(section['empty_feature_ids'])}")
        if section.get("out_of_range_coordinates"):
            failures.append(f"{section_name}: out_of_range_coordinates={len(section['out_of_range_coordinates'])}")
        if section["oversized_part_bboxes"]:
            failures.append(f"{section_name}: oversized_parts={len(section['oversized_part_bboxes'])}")
        if section["oversized_feature_bboxes"]:
            failures.append(f"{section_name}: oversized_features={len(section['oversized_feature_bboxes'])}")
    for label, section in (checks.get("d3_spherical") or {}).items():
        invalid_feature_count = int(section.get("invalidFeatureCount") or 0)
        invalid_part_count = int(section.get("invalidPartCount") or 0)
        if invalid_feature_count or invalid_part_count:
            failures.append(
                f"d3_spherical:{label}: invalid_features={invalid_feature_count} invalid_parts={invalid_part_count}"
            )
    coverage = checks["ocean_macro_coverage"]
    if not coverage["is_valid"] or coverage["pairwise_overlap_count"]:
        failures.append(
            f"ocean_macro_coverage: valid={coverage['is_valid']} pairwise_overlaps={coverage['pairwise_overlap_count']}"
        )
    if checks["first_wave_probe_coverage"]["failures"]:
        failures.append(
            f"first_wave_probe_coverage: misses={len(checks['first_wave_probe_coverage']['failures'])}"
        )
    if checks["first_wave_named_water_seams"]["failures"]:
        failures.append(
            f"first_wave_named_water_seams: gaps={len(checks['first_wave_named_water_seams']['failures'])}"
        )
    aq_polar = checks.get("aq_polar_spherical_diagnostics") or {}
    if int(aq_polar.get("failure_count") or 0):
        failures.append(f"aq_polar_spherical_diagnostics: failures={aq_polar['failure_count']}")
    if checks["macro_land_overlap"]["suspicious_count"]:
        failures.append(
            f"macro_land_overlap: suspicious={checks['macro_land_overlap']['suspicious_count']}"
        )
    if checks["named_water_snapshot_inflation"]["suspicious_count"]:
        failures.append(
            "named_water_snapshot_inflation: "
            f"suspicious={checks['named_water_snapshot_inflation']['suspicious_count']}"
        )
    id_consistency = checks["id_consistency"]
    if id_consistency["source_only"] or id_consistency["runtime_only"]:
        failures.append("id_consistency mismatch")
    if require_chunks and (id_consistency["chunk_missing"] or id_consistency["chunk_only"]):
        failures.append("id_consistency mismatch")
    target_metrics = checks.get("ocean_refinement_targets") or {}
    if target_metrics.get("missing"):
        failures.append(f"ocean_refinement_targets: missing={len(target_metrics['missing'])}")
    return failures


def _attach_run_diagnostics(report: dict, *, started_at: float, failure_shape: dict | None = None) -> dict:
    report["diagnostics"] = {
        "elapsed_seconds": round(time.perf_counter() - started_at, 3),
        "failure_shape": failure_shape,
        "feature_counts": {
            "source": int(((report.get("checks") or {}).get("source") or {}).get("feature_count") or 0),
            "runtime": int(((report.get("checks") or {}).get("runtime") or {}).get("feature_count") or 0),
            "chunk_unique": len((((report.get("checks") or {}).get("chunks") or {}).get("feature_ids") or [])),
            "chunk_count": int(((report.get("checks") or {}).get("chunks") or {}).get("chunk_count") or 0),
            "ocean_refinement_targets": int(
                ((report.get("checks") or {}).get("ocean_refinement_targets") or {}).get("target_count") or 0
            ),
        },
    }
    return report


# Compatibility alias for older tests and scripts. New callers should use the
# public name so validator metrics are part of the supported module API.
_collect_d3_spherical_metrics = collect_d3_spherical_metrics


def _write_failure_report(
    *,
    scenario_dir: Path,
    report_path: Path,
    started_at: float,
    exc: BaseException,
    stage: str,
) -> None:
    failure_shape = {
        "type": type(exc).__name__,
        "stage": stage,
        "message": str(exc),
    }
    report = _attach_run_diagnostics(
        {
            "scenario_id": scenario_dir.name,
            "ok": False,
            "failures": [f"{stage}: {type(exc).__name__}: {exc}"],
        },
        started_at=started_at,
        failure_shape=failure_shape,
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_report(report: dict, *, stage_label: str, require_chunks: bool = True) -> dict:
    failures = summarize_failures(report, require_chunks=require_chunks)
    report["ok"] = not failures
    report["failures"] = failures
    if failures:
        raise ValueError(
            f"TNO water geometry validation failed at {stage_label}:\n- " + "\n- ".join(failures)
        )
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate TNO scenario water geometry outputs.")
    parser.add_argument("--scenario-dir", default=str(DEFAULT_SCENARIO_DIR))
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH))
    return parser.parse_args()


def main() -> int:
    started_at = time.perf_counter()
    args = parse_args()
    scenario_dir = Path(args.scenario_dir).resolve()
    report_path = Path(args.report_path).resolve()
    try:
        report = build_report(scenario_dir)
    except (MemoryError, TimeoutError) as exc:
        _write_failure_report(
            scenario_dir=scenario_dir,
            report_path=report_path,
            started_at=started_at,
            exc=exc,
            stage="build_report",
        )
        print(f"build_report: {type(exc).__name__}: {exc}")
        print(f"report={report_path}")
        return 1
    except Exception as exc:
        _write_failure_report(
            scenario_dir=scenario_dir,
            report_path=report_path,
            started_at=started_at,
            exc=exc,
            stage="build_report",
        )
        print(f"build_report: {type(exc).__name__}: {exc}")
        print(f"report={report_path}")
        return 1
    failures = summarize_failures(report)
    report["ok"] = not failures
    report["failures"] = failures
    _attach_run_diagnostics(report, started_at=started_at)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if failures:
        for failure in failures:
            print(failure)
        print(f"report={report_path}")
        return 1
    print(f"ok report={report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
