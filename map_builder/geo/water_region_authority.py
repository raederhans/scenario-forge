"""Physical water constraints and source recovery for named water regions.

Region names describe a semantic partition; the physical ocean/land layers
define where marine regions may exist. Inland waters keep their own geometry.
"""
from __future__ import annotations

from copy import deepcopy
import re

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from map_builder.geo.water_geometry import compile_water_feature_collection
from map_builder.geo.physical_water_mask import physical_mask_to_planar_geometry

WATER_SOURCE_SIMPLIFY_DEGREES = 0.005

def polygonal(geometry):
    if geometry is None or geometry.is_empty:
        return MultiPolygon([])
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    return unary_union([polygonal(part) for part in geometry.geoms
                        if isinstance(part, (Polygon, MultiPolygon, GeometryCollection))])


def collection_geometry(collection):
    return polygonal(unary_union([polygonal(shape(f["geometry"]))
                                 for f in collection.get("features", []) if f.get("geometry")]))


def restore_marine_source(collection, source_frame, *, simplify_degrees=WATER_SOURCE_SIMPLIFY_DEGREES):
    """Recover complete NE named regions, including duplicate translated names.

    North/South Atlantic and Pacific share name_en values. Union matching rows
    instead of silently dropping all but the first translated-name ID.
    Existing feature IDs/properties, lake and custom Mediterranean partitions
    remain stable.
    """
    by_id = {}
    for _, row in source_frame.iterrows():
        name = str(row.get("name_en") or row.get("name") or "").strip().casefold()
        feature_id = "marine_" + re.sub(r"[^a-z0-9]+", "_", name).strip("_")
        by_id.setdefault(feature_id, []).append(polygonal(row.geometry))
    result = deepcopy(collection)
    for feature in result["features"]:
        props = feature.get("properties", {})
        sources = by_id.get(props.get("id"))
        if sources and props.get("water_type") != "lake":
            geometry = polygonal(unary_union(sources))
            geometry = polygonal(geometry.simplify(simplify_degrees, preserve_topology=True))
            feature["geometry"] = mapping(geometry)
    return result


def compile_named_water_regions(collection, *, ocean_mask=None, land_mask=None):
    """Compile after physical clipping and explicit parent/child subtraction.

    Named seas take their documented footprints out of macro oceans. Unrelated
    named regions are never resolved by array order or a guessed priority.
    """
    prepared = deepcopy(collection)
    features = prepared["features"]
    geometries = {f["properties"]["id"]: polygonal(shape(f["geometry"])) for f in features}
    named = []
    children = {}
    for feature in features:
        props = feature["properties"]
        feature_id = props["id"]
        if props.get("parent_id"):
            children.setdefault(props["parent_id"], []).append(geometries[feature_id])
        if props.get("water_type") not in {"ocean", "lake", "reservoir", "inland_sea", "river"}:
            named.append(geometries[feature_id])
    named_union = polygonal(unary_union(named))
    for feature in features:
        props = feature["properties"]
        geometry = geometries[props["id"]]
        if props.get("water_type") == "ocean" and not named_union.is_empty:
            geometry = polygonal(geometry.difference(named_union))
        elif props["id"] in children:
            geometry = polygonal(geometry.difference(unary_union(children[props["id"]])))
        feature["geometry"] = mapping(geometry)
    # Physical runtime masks have spherical edges, unlike planar named-water
    # sources. Let D3 clip poles/seams and sample those edges before booleans.
    # Shapely inputs are already planar masks supplied by the caller.
    ocean = physical_mask_to_planar_geometry(ocean_mask) if isinstance(ocean_mask, dict) else ocean_mask
    land = physical_mask_to_planar_geometry(land_mask) if isinstance(land_mask, dict) else land_mask
    return compile_water_feature_collection(prepared, ocean_mask=ocean, land_mask=land)
