import json
from pathlib import Path

from shapely.geometry import shape


ROOT = Path(__file__).resolve().parents[1]
SCENARIO_WATER_PATH = ROOT / "data" / "scenarios" / "tno_1962" / "water_regions.geojson"
TARGET_OPEN_OCEAN_IDS = {
    "tno_northwest_pacific_ocean",
    "tno_northeast_pacific_ocean",
}
MIN_COMPONENT_AREA = 0.05


def _load_scenario_water_features():
    payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding="utf-8"))
    return payload.get("features", [])


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
        assert len(parts) <= 6, feature_id
        assert min(part.area for part in parts) >= MIN_COMPONENT_AREA - 1e-9, feature_id
