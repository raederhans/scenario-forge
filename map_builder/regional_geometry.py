"""Same-ID regional geometry assembly without rebuilding unrelated countries."""
from copy import deepcopy
from collections import defaultdict
import json

import geopandas as gpd
import shapely
from map_builder.coverage_validation import coverage_is_valid_exact
from shapely.geometry import shape
from shapely.geometry.polygon import orient

from map_builder.geo.topology import compute_neighbor_graph


def _feature_id(geometry):
    value = (geometry.get("properties") or {}).get("id")
    if value is None or not str(value).strip():
        raise ValueError("Every political feature requires a nonempty properties.id.")
    return str(value)


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


def _absolute_topology(topology):
    result = deepcopy(topology)
    transform = result.pop("transform", None)
    if transform is None:
        return result
    sx, sy = transform["scale"]
    tx, ty = transform["translate"]
    for arc in result.get("arcs", []):
        x = y = 0
        for point in arc:
            x += point[0]
            y += point[1]
            point[:2] = [x * sx + tx, y * sy + ty]
    for obj in result["objects"].values():
        for geometry in _geometries(obj):
            if geometry.get("type") == "Point":
                points = [geometry["coordinates"]]
            elif geometry.get("type") == "MultiPoint":
                points = geometry["coordinates"]
            else:
                continue
            for point in points:
                point[:2] = [point[0] * sx + tx, point[1] * sy + ty]
    return result


def _political_frame(topology):
    rows = []
    unreadable = []
    invalid = []
    for item in topology["objects"]["political"]["geometries"]:
        feature_id = _feature_id(item)
        try:
            geometry = _decode_geometry(topology, item)
        except (ValueError, TypeError, KeyError, IndexError, shapely.errors.GEOSException) as exc:
            unreadable.append({"id": feature_id, "error": str(exc)})
            continue
        if geometry is None or geometry.is_empty or not geometry.is_valid:
            invalid.append(feature_id)
        rows.append(dict(item.get("properties") or {}, geometry=geometry))
    if unreadable or invalid:
        raise ValueError("Political geometry preflight failed; candidate was not generated. " + json.dumps({
            "unreadable_features": unreadable, "invalid_feature_ids": invalid,
            "candidate_generated": False,
        }, ensure_ascii=False))
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _decode_geometry(topology, geometry):
    """Decode absolute arcs without implicit ring reorientation or repair."""
    def line(indices):
        coordinates = []
        for index in indices:
            segment = topology["arcs"][index if index >= 0 else ~index]
            if index < 0:
                segment = segment[::-1]
            coordinates.extend(segment if not coordinates else segment[1:])
        return coordinates

    kind = geometry.get("type")
    if kind is None:
        return None
    if kind == "GeometryCollection":
        from shapely.geometry import GeometryCollection
        return GeometryCollection([_decode_geometry(topology, item) for item in geometry["geometries"]])
    if kind in {"Point", "MultiPoint"}:
        coordinates = geometry["coordinates"]
    elif kind == "LineString":
        coordinates = line(geometry["arcs"])
    elif kind in {"Polygon", "MultiLineString"}:
        coordinates = [line(item) for item in geometry["arcs"]]
    elif kind == "MultiPolygon":
        coordinates = [[line(item) for item in polygon] for polygon in geometry["arcs"]]
    else:
        raise ValueError(f"Unsupported baseline geometry type: {kind}")
    return shape({"type": kind, "coordinates": coordinates})


def _valid_coverage(geometries):
    return (all(geom is not None and not geom.is_empty and geom.is_valid
                and geom.geom_type in {"Polygon", "MultiPolygon"} for geom in geometries)
            and bool(coverage_is_valid_exact(geometries)))


def _encode_exact_coverage(feature_ids, geometries):
    """Encode existing valid coverage segments without another geometric overlay.

    Chains end at graph junctions. Isolated rings use a canonical start vertex,
    so opposite traversals share an arc as well. No coordinates are inserted,
    simplified, rounded, or compared with an epsilon.
    """
    neighbors = defaultdict(set)
    prepared = []
    for geometry in geometries:
        polygons = [geometry] if geometry.geom_type == 'Polygon' else geometry.geoms
        polygon_rings = []
        for polygon in polygons:
            polygon = orient(polygon, sign=-1.0)
            rings = [tuple(tuple(point) for point in ring.coords)
                     for ring in [polygon.exterior, *polygon.interiors]]
            polygon_rings.append(rings)
            for ring in rings:
                for a, b in zip(ring, ring[1:]):
                    if a != b:
                        neighbors[a].add(b)
                        neighbors[b].add(a)
        prepared.append((geometry.geom_type, polygon_rings))
    arcs = []
    arc_indices = {}

    def register(coordinates):
        forward = tuple(coordinates)
        backward = forward[::-1]
        canonical = min(forward, backward)
        if canonical not in arc_indices:
            arc_indices[canonical] = len(arcs)
            arcs.append([list(point) for point in canonical])
        index = arc_indices[canonical]
        return index if forward == canonical else ~index

    def encode_ring(ring):
        vertices = ring[:-1]
        junctions = [index for index, point in enumerate(vertices) if len(neighbors[point]) != 2]
        start = junctions[0] if junctions else min(range(len(vertices)), key=vertices.__getitem__)
        ordered = vertices[start:] + vertices[:start]
        ordered += ordered[:1]
        refs = []
        chain = [ordered[0]]
        for index, point in enumerate(ordered[1:], 1):
            chain.append(point)
            if len(neighbors[point]) != 2 or index == len(vertices):
                refs.append(register(chain))
                chain = [point]
        return refs

    encoded = []
    for feature_id, (kind, polygons) in zip(feature_ids, prepared):
        polygon_arcs = [[encode_ring(ring) for ring in rings] for rings in polygons]
        encoded.append({'type': kind, 'properties': {'id': feature_id},
                        'arcs': polygon_arcs[0] if kind == 'Polygon' else polygon_arcs})
    return {'type': 'Topology', 'objects': {'political': {'type': 'GeometryCollection', 'geometries': encoded}}, 'arcs': arcs}


def _update_bbox(topology):
    points = [point for arc in topology["arcs"] for point in arc]
    for obj in topology["objects"].values():
        for geometry in _geometries(obj):
            if geometry.get("type") == "Point":
                points.append(geometry["coordinates"])
            elif geometry.get("type") == "MultiPoint":
                points.extend(geometry["coordinates"])
    topology["bbox"] = [min(p[0] for p in points), min(p[1] for p in points),
                        max(p[0] for p in points), max(p[1] for p in points)]


def replace_regional_geometry(baseline_topology, replacement_gdf, *, source_countries=None):
    """Return ``(candidate, diagnostics)`` for explicit same-ID replacements.

    All baseline feature properties, ordering and unrelated geometries survive.
    Replacement coverage is checked internally; its outer boundary is not snapped
    to untouched neighbours. Callers must rebuild downstream shared derivatives.
    """
    political = baseline_topology.get("objects", {}).get("political", {})
    if political.get("type") != "GeometryCollection":
        raise ValueError("Baseline political must be a GeometryCollection.")
    baseline_features = political.get("geometries", [])
    baseline_ids = [_feature_id(item) for item in baseline_features]
    if len(baseline_ids) != len(set(baseline_ids)):
        raise ValueError("Baseline political IDs must be unique.")
    if replacement_gdf.empty or "id" not in replacement_gdf.columns:
        raise ValueError("Replacement data must be nonempty with explicit properties.id.")
    if replacement_gdf["id"].isna().any() or any(not str(value).strip() for value in replacement_gdf["id"]):
        raise ValueError("Replacement IDs must be nonempty.")
    selected_ids = replacement_gdf["id"].astype(str).tolist()
    if len(selected_ids) != len(set(selected_ids)):
        raise ValueError("Replacement IDs must be unique.")
    by_id = dict(zip(baseline_ids, baseline_features))
    missing = sorted(set(selected_ids) - set(baseline_ids))
    if missing:
        raise ValueError(f"Replacement IDs are missing from baseline: {missing[:10]}")
    if source_countries is not None:
        allowed = {str(code).strip().upper() for code in source_countries if str(code).strip()}
        if not allowed:
            raise ValueError("source_countries cannot be empty.")
        rejected = [feature_id for feature_id in selected_ids
                    if str(by_id[feature_id]["properties"].get("cntr_code", "")).upper() not in allowed]
        if rejected:
            raise ValueError(f"Replacement IDs outside allowed source countries: {rejected[:10]}")
    if replacement_gdf.crs is None or replacement_gdf.crs.to_epsg() != 4326:
        raise ValueError("Replacement geometry must use EPSG:4326.")
    source_geometries = replacement_gdf.geometry.tolist()
    if not _valid_coverage(source_geometries):
        raise ValueError("Replacement requires nonempty valid polygonal shared-edge coverage.")
    if any(by_id[feature_id].get("type") not in {"Polygon", "MultiPolygon"} for feature_id in selected_ids):
        raise ValueError("Replacement targets must already be polygonal features.")

    encoded = _encode_exact_coverage(selected_ids, source_geometries)
    result = _absolute_topology(baseline_topology)
    before = _political_frame(result)
    replacements = {_feature_id(item): item for item in encoded["objects"]["political"]["geometries"]}
    offset = len(result.setdefault("arcs", []))
    result["arcs"].extend(encoded["arcs"])
    for item in result["objects"]["political"]["geometries"]:
        replacement = replacements.get(_feature_id(item))
        if replacement is not None:
            item["type"] = replacement["type"]
            item["arcs"] = _offset_arcs(replacement["arcs"], offset)
    _compact_arcs(result)
    after = _political_frame(result)
    after_by_id = dict(zip(baseline_ids, after.geometry))
    restored = [after_by_id[feature_id] for feature_id in selected_ids]
    if (not _valid_coverage(restored)
            or any(not source.equals(actual) for source, actual in zip(source_geometries, restored))):
        raise ValueError("Encoded replacement changed source geometry or invalidated coverage.")
    for geometry in restored:
        polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
        if any(p.exterior.is_ccw or any(not r.is_ccw for r in p.interiors) for p in polygons):
            raise ValueError("Encoded replacement has incompatible polygon winding.")
    changed_ids = []
    for feature_id, old, new in zip(baseline_ids, before.geometry, after.geometry):
        if feature_id in replacements:
            if not old.equals(new):
                changed_ids.append(feature_id)
        elif ((old is None or new is None) and old is not new
              or old is not None and new is not None and not old.equals_exact(new, 0)):
            raise ValueError(f"Unselected political geometry changed: {feature_id}")
    # Graph indices correspond to the untouched baseline feature order.
    result["objects"]["political"]["computed_neighbors"] = compute_neighbor_graph(after)
    for item in result["objects"]["political"]["geometries"]:
        if _feature_id(item) in replacements and "bbox" in item:
            item["bbox"] = list(after_by_id[_feature_id(item)].bounds)
    if "bbox" in result["objects"]["political"]:
        result["objects"]["political"]["bbox"] = after.total_bounds.tolist()
    _update_bbox(result)
    diagnostics = {
        "selected_ids": selected_ids, "changed_ids": changed_ids,
        "target_bounds": replacement_gdf.total_bounds.tolist(),
        "replacement_coverage_valid": True, "encoded_coverage_valid": True,
        "political_feature_count": len(baseline_ids), "neighbors_recomputed": True,
        "adjacent_country_seams_verified": False,
        "derived_assets_require_rebuild": ["shared border meshes", "scenario chunks and LOD", "spatial indexes and manifests"],
        "boundary_note": "Replacement coverage is validated internally; boundaries with untouched neighbours are not repaired or certified.",
    }
    return result, diagnostics
