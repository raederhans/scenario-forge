"""Preserve validated French coverage across global TopoJSON quantization."""

from copy import deepcopy

import shapely
from shapely.geometry import mapping, shape
import topojson


def _feature_id(geometry):
    return str((geometry.get("properties") or {}).get("id", geometry.get("id", "")))


def _geometries(geometry):
    yield geometry
    for child in geometry.get("geometries", []):
        yield from _geometries(child)


def _offset_arcs(value, offset):
    if isinstance(value, list):
        return [_offset_arcs(item, offset) for item in value]
    return value + offset if value >= 0 else ~(~value + offset)


def _compact_arcs(topology):
    used = set()

    def collect(value):
        if isinstance(value, list):
            for item in value:
                collect(item)
        else:
            used.add(value if value >= 0 else ~value)

    geometries = [geometry for obj in topology["objects"].values()
                  for geometry in _geometries(obj)]
    for geometry in geometries:
        if "arcs" in geometry:
            collect(geometry["arcs"])
    indices = sorted(used)
    remap = {old: new for new, old in enumerate(indices)}

    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        return remap[value] if value >= 0 else ~remap[~value]

    topology["arcs"] = [topology["arcs"][index] for index in indices]
    for geometry in geometries:
        if "arcs" in geometry:
            geometry["arcs"] = rewrite(geometry["arcs"])


def _decode_polygon(topology, geometry):
    def ring(indices):
        coordinates = []
        for index in indices:
            segment = topology["arcs"][index if index >= 0 else ~index]
            if index < 0:
                segment = segment[::-1]
            coordinates.extend(segment if not coordinates else segment[1:])
        return coordinates

    arcs = geometry["arcs"]
    coordinates = ([ring(item) for item in arcs] if geometry["type"] == "Polygon"
                   else [[ring(item) for item in polygon] for polygon in arcs])
    return shape({"type": geometry["type"], "coordinates": coordinates})


def preserve_france_topology_precision(topology_dict, political_gdf):
    """Return a copy with FR_ARR geometry encoded losslessly as shared arcs.

    The input frame must contain exactly the French IDs already in ``political``
    and valid polygonal coverage in EPSG:4326. Properties and feature IDs come
    from the existing topology. Other geometry retains its decoded coordinates.
    No inputs are mutated; when neither input has French features, return the
    original topology. Unreferenced arcs are removed across all objects.
    """
    political = topology_dict.get("objects", {}).get("political", {})
    targets = [item for item in _geometries(political)
               if _feature_id(item).startswith("FR_ARR_")]
    if "id" not in political_gdf.columns:
        if targets:
            raise ValueError("French precision requires source feature IDs.")
        return topology_dict
    source = political_gdf[political_gdf["id"].astype(str).str.startswith("FR_ARR_")]
    if not targets and source.empty:
        return topology_dict
    source_ids = source["id"].astype(str).tolist()
    target_ids = [_feature_id(item) for item in targets]
    if (len(set(source_ids)) != len(source_ids)
            or len(set(target_ids)) != len(target_ids)
            or set(source_ids) != set(target_ids)):
        raise ValueError("French source and topology IDs must be unique and match exactly.")
    if any(item.get("type") not in {"Polygon", "MultiPolygon"} for item in targets):
        raise ValueError("French topology targets must be polygon geometry.")
    if source.crs is None or source.crs.to_epsg() != 4326:
        raise ValueError("French precision requires EPSG:4326 source geometry.")
    geometries = source.geometry.tolist()
    if any(geom is None or geom.is_empty or not geom.is_valid
           or geom.geom_type not in {"Polygon", "MultiPolygon"}
           for geom in geometries):
        raise ValueError("French precision requires nonempty valid polygon geometry.")
    if not shapely.coverage_is_valid(geometries):
        raise ValueError("French precision requires valid shared-edge coverage.")
    collection = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": feature_id},
         "geometry": mapping(geom)}
        for feature_id, geom in zip(source_ids, geometries)
    ]}
    encoded = topojson.Topology(
        collection, prequantize=False, topoquantize=False, presimplify=False,
        toposimplify=False, shared_coords=True, winding_order="CW_CCW",
        object_name="political",
    ).to_dict()
    # topojson's shoelace winding check can lose the sign of tiny rings at
    # large coordinates. Correct arc direction using GEOS's robust predicate;
    # this changes neither coordinates nor shared-edge identity.
    for item in encoded["objects"]["political"]["geometries"]:
        geometry = _decode_polygon(encoded, item)
        polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
        polygon_arcs = [item["arcs"]] if item["type"] == "Polygon" else item["arcs"]
        for polygon, rings in zip(polygons, polygon_arcs):
            for index, ring in enumerate([polygon.exterior, *polygon.interiors]):
                if ring.is_ccw != (index > 0):
                    rings[index] = [~arc for arc in reversed(rings[index])]
    replacements = {_feature_id(item): item
                    for item in encoded["objects"]["political"]["geometries"]}
    result = deepcopy(topology_dict)
    transform = result.pop("transform", None)
    if transform is not None:
        sx, sy = transform["scale"]
        tx, ty = transform["translate"]
        for arc in result.get("arcs", []):
            x = y = 0
            for point in arc:
                x += point[0]
                y += point[1]
                point[:2] = [x * sx + tx, y * sy + ty]
        for obj in result.get("objects", {}).values():
            for geometry in _geometries(obj):
                if geometry.get("type") == "Point":
                    points = [geometry["coordinates"]]
                elif geometry.get("type") == "MultiPoint":
                    points = geometry["coordinates"]
                else:
                    continue
                for point in points:
                    point[:2] = [point[0] * sx + tx, point[1] * sy + ty]
    offset = len(result.setdefault("arcs", []))
    result["arcs"].extend(encoded["arcs"])
    for target in _geometries(result["objects"]["political"]):
        replacement = replacements.get(_feature_id(target))
        if replacement is not None:
            target["type"] = replacement["type"]
            target["arcs"] = _offset_arcs(replacement["arcs"], offset)
    _compact_arcs(result)
    try:
        restored = {_feature_id(item): _decode_polygon(result, item)
                    for item in _geometries(result["objects"]["political"])
                    if _feature_id(item) in replacements}
        decoded_geometries = [restored[feature_id] for feature_id in source_ids]
        if (any(geom.is_empty or not geom.is_valid for geom in decoded_geometries)
                or not shapely.coverage_is_valid(decoded_geometries)
                or any(not before.equals(after)
                       for before, after in zip(geometries, decoded_geometries))):
            raise ValueError("French precision output changed geometry or invalidated coverage.")
        for geometry in decoded_geometries:
            polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
            for polygon in polygons:
                if polygon.exterior.is_ccw or any(not ring.is_ccw for ring in polygon.interiors):
                    raise ValueError("French precision output has incompatible polygon winding.")
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError("French precision output could not be decoded.") from exc
    return result
