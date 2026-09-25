"""Bind capital markers to scenario territory without changing borders."""
from __future__ import annotations

import math
from pathlib import Path
import json

from shapely.geometry import Point, shape
from shapely.ops import nearest_points
from topojson.utils import serialize_as_geojson

# The coarse UAE coastline omits Abu Dhabi island; the Macau passthrough shell
# overlaps the coarse China polygon. These reviewed cartographic exceptions are
# bounded to the named city, not permissions to move any capital across borders.
CARTOGRAPHIC_SNAP_LIMITS_KM = {"CITY::ne::1159150565": 12, "CITY::ne::1159149085": 4}


def read_political_features(path: Path) -> list[dict]:
    topology = json.loads(path.read_text(encoding="utf-8"))
    features = []
    for name in ("political", "scenario_atlantropa"):
        if name not in topology.get("objects", {}):
            continue
        collection = serialize_as_geojson(topology, objectname=name)
        if isinstance(collection, str):
            collection = json.loads(collection)
        features.extend(collection.get("features", []))
    return features


def place_capital_markers(payload, countries, owners, features, *, coastal_tolerance_km=5):
    """Mutate a composed payload; return unresolved territory conflicts.

    A near-shore source point may miss a simplified coastline. Only that small
    cartographic discrepancy is snapped inward; a real cross-border capital
    requires an explicitly reviewed replacement city, never an automatic jump.
    """
    territories = {}
    for feature in features:
        feature_id = str(feature.get("properties", {}).get("id") or feature.get("id") or "")
        tag = owners.get(feature_id)
        if not tag or not feature.get("geometry"):
            continue
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            geometry = geometry.buffer(0)
        if not geometry.is_empty:
            territories.setdefault(tag, []).append((feature_id, geometry))
    conflicts = []
    for tag, hint in payload.get("capital_city_hints", {}).items():
        if not countries.get(tag, {}).get("feature_count") or not hint.get("city_id"):
            continue
        # Explicit map and hint must describe the same point.
        city_id = payload.get("capitals_by_tag", {}).get(tag) or hint["city_id"]
        if city_id != hint["city_id"]:
            conflicts.append({"tag": tag, "reason": "capital_hint_id_mismatch"})
            continue
        lon, lat = hint.get("lon"), hint.get("lat")
        if lon is None or lat is None:
            conflicts.append({"tag": tag, "reason": "capital_without_coordinates"})
            continue
        point = Point(lon, lat)
        options = territories.get(tag, [])
        inside = [(fid, g) for fid, g in options if g.covers(point)]
        placement = None
        if inside:
            placement = min(inside, key=lambda item: (item[0] != hint.get("host_feature_id"), item[1].area, item[0]))
        elif options:
            nearest = min(options, key=lambda item: item[1].distance(point))
            boundary_point = nearest_points(point, nearest[1])[1]
            distance_km = 111.32 * math.hypot(
                (boundary_point.x - lon) * math.cos(math.radians(lat)), boundary_point.y - lat,
            )
            # A point located in another country's land is not a coastal miss.
            foreign_land = any(g.contains(point) for other, rows in territories.items() if other != tag for _, g in rows)
            limit_km = CARTOGRAPHIC_SNAP_LIMITS_KM.get(city_id, coastal_tolerance_km)
            passthrough_overlap = (city_id, nearest[0]) in {
                ("CITY::ne::1159149085", "MO_ADMIN0_PASSTHROUGH"),
                ("CITY::ne::1159149077", "MC_ADMIN0_PASSTHROUGH"),
            }
            if distance_km <= limit_km and (not foreign_land or passthrough_overlap):
                interior = nearest[1].buffer(-0.00001)
                if interior.is_empty:
                    adjusted = nearest[1].representative_point()
                else:
                    adjusted = nearest_points(point, interior)[1]
                lon, lat = adjusted.x, adjusted.y
                hint.setdefault("source_coordinates", [point.x, point.y])
                hint["coordinate_adjustment"] = "simplified_coastline"
                placement = nearest
        if placement is None:
            conflicts.append({"tag": tag, "city_id": city_id, "city_name": hint.get("city_name"),
                              "reason": "capital_outside_territory"})
            continue
        hint.update({"host_feature_id": placement[0], "lon": lon, "lat": lat})
        override = payload.setdefault("cities", {}).setdefault(city_id, {"city_id": city_id})
        override["host_feature_id"] = placement[0]
        # Geometry changes stay scenario-scoped; base coordinates are retained.
        if hint.get("coordinate_adjustment"):
            override["lon"], override["lat"] = lon, lat
    return conflicts
