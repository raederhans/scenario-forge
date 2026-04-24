import argparse
import json
from pathlib import Path

from shapely import coverage_invalid_edges, coverage_is_valid
from shapely.geometry import Point, shape
from shapely.ops import nearest_points, unary_union
from topojson.utils import serialize_as_geojson


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIO_DIR = ROOT / "data" / "scenarios" / "tno_1962"
DEFAULT_REPORT_PATH = ROOT / ".runtime" / "reports" / "generated" / "tno_water_geometry_report.json"
WORLD_BBOX_WIDTH_THRESHOLD = 300.0
ANTIMERIDIAN_EPSILON = 1e-3
SEAM_DISTANCE_EPSILON = 5e-5
MACRO_LAND_OVERLAP_AREA_MIN = 20.0
MACRO_LAND_OVERLAP_RATIO_MAX = 0.08
MACRO_LAND_OVERLAP_ABS_MAX = 1.0
MACRO_INFLATION_LAND_DELTA_MAX = 0.05
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


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, got {type(payload).__name__}.")
    return payload


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


def _collect_feature_metrics(feature_collection: dict, *, label: str) -> dict:
    invalid = []
    empty = []
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
        "oversized_feature_bboxes": oversized_features,
        "oversized_part_bboxes": oversized_parts,
        "antimeridian_split_features": antimeridian_split_features,
    }


def _load_runtime_topology_feature_collection(path: Path, object_name: str) -> dict:
    topology_payload = _load_json(path)
    return serialize_as_geojson(topology_payload, objectname=object_name)


def _load_chunk_feature_collections(scenario_dir: Path) -> list[tuple[str, dict]]:
    chunks_dir = scenario_dir / "chunks"
    feature_collections = []
    for path in sorted(chunks_dir.glob("water.*.json")):
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
    oversized_parts = []
    oversized_features = []
    antimeridian_split_features = []
    for label, feature_collection in chunk_feature_collections or []:
        metric = _collect_feature_metrics(feature_collection, label=label)
        metrics.append(metric)
        feature_ids.update(metric["feature_ids"])
        invalid.extend(metric["invalid_feature_ids"])
        empty.extend(metric["empty_feature_ids"])
        oversized_features.extend(metric["oversized_feature_bboxes"])
        oversized_parts.extend(metric["oversized_part_bboxes"])
        antimeridian_split_features.extend(metric["antimeridian_split_features"])
    return {
        "chunks": metrics,
        "feature_ids": sorted(feature_ids),
        "invalid_feature_ids": sorted(set(filter(None, invalid))),
        "empty_feature_ids": sorted(set(filter(None, empty))),
        "oversized_feature_bboxes": oversized_features,
        "oversized_part_bboxes": oversized_parts,
        "antimeridian_split_features": antimeridian_split_features,
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
    return {"pairs": seam_results, "failures": failures}


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


def build_report_from_collections(
    *,
    scenario_id: str,
    source_water: dict,
    named_water_snapshot: dict,
    runtime_topology_payload: dict | None = None,
    runtime_water: dict | None = None,
    runtime_political: dict | None = None,
    chunk_feature_collections: list[tuple[str, dict]] | None = None,
) -> dict:
    if runtime_topology_payload is not None:
        runtime_water = runtime_water or serialize_as_geojson(runtime_topology_payload, objectname="scenario_water")
        runtime_political = runtime_political or serialize_as_geojson(runtime_topology_payload, objectname="political")
    if runtime_water is None or runtime_political is None:
        raise ValueError("Runtime water validator requires runtime_water and runtime_political feature collections.")
    chunk_metrics = _collect_chunk_metrics_from_feature_collections(chunk_feature_collections)
    source_metrics = _collect_feature_metrics(source_water, label="water_regions.geojson")
    runtime_metrics = _collect_feature_metrics(runtime_water, label="runtime_topology.topo.json::scenario_water")
    source_ids = set(source_metrics["feature_ids"])
    runtime_ids = set(runtime_metrics["feature_ids"])
    chunk_ids = set(chunk_metrics["feature_ids"])
    return {
        "scenario_id": scenario_id,
        "checks": {
            "source": source_metrics,
            "runtime": runtime_metrics,
            "chunks": chunk_metrics,
            "ocean_macro_coverage": _collect_ocean_macro_coverage(source_water),
            "first_wave_probe_coverage": _collect_probe_coverage(source_water),
            "first_wave_named_water_seams": _collect_named_water_seams(source_water),
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
        },
    }


def build_report(scenario_dir: Path) -> dict:
    return build_report_from_collections(
        scenario_id=scenario_dir.name,
        source_water=_load_json(scenario_dir / "water_regions.geojson"),
        runtime_topology_payload=_load_json(scenario_dir / "runtime_topology.topo.json"),
        named_water_snapshot=_load_json(scenario_dir / "derived" / "marine_regions_named_waters.snapshot.geojson"),
        chunk_feature_collections=_load_chunk_feature_collections(scenario_dir),
    )


def summarize_failures(report: dict, *, require_chunks: bool = True) -> list[str]:
    failures = []
    checks = report["checks"]
    section_names = ["source", "runtime"]
    if require_chunks:
        section_names.append("chunks")
    for section_name in section_names:
        section = checks[section_name]
        if section["invalid_feature_ids"]:
            failures.append(f"{section_name}: invalid={len(section['invalid_feature_ids'])}")
        if section["empty_feature_ids"]:
            failures.append(f"{section_name}: empty={len(section['empty_feature_ids'])}")
        if section["oversized_part_bboxes"]:
            failures.append(f"{section_name}: oversized_parts={len(section['oversized_part_bboxes'])}")
        if section["oversized_feature_bboxes"]:
            failures.append(f"{section_name}: oversized_features={len(section['oversized_feature_bboxes'])}")
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
    return failures


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
    args = parse_args()
    scenario_dir = Path(args.scenario_dir).resolve()
    report_path = Path(args.report_path).resolve()
    report = build_report(scenario_dir)
    failures = summarize_failures(report)
    report["ok"] = not failures
    report["failures"] = failures
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
