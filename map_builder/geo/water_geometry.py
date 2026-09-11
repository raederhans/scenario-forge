"""Compile planar longitude/latitude water boundaries for D3's spherical edges.

Run after all clipping/simplification. Coordinates express straight lines in the
longitude/latitude plane (a 179 -> -179 edge is deliberately NOT unwrapped).
Date-line crossing inputs must already be split at +/-180; out-of-range inputs
are rejected. Existing date-line pieces and exact pole coordinates are retained;
linear sampling handles wide polygons without introducing artificial seams.
"""
from __future__ import annotations

from copy import deepcopy
import math

from shapely import make_valid, set_precision
from shapely.affinity import affine_transform
from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.strtree import STRtree

# Below this planar area, D3's spherical area sum can lose the orientation sign
# of coastal clipping fragments. This is a numerical floor, not simplification.
D3_MIN_COMPONENT_AREA_DEGREES2 = 1e-10


def _parts(geometry):
    if isinstance(geometry, Polygon):
        if not geometry.is_empty and geometry.area > 0:
            yield geometry
    elif isinstance(geometry, (MultiPolygon, GeometryCollection)):
        for child in geometry.geoms:
            yield from _parts(child)


def _mask_geometry(value):
    if value is None:
        return None
    if hasattr(value, "geom_type"):
        return value
    if value.get("type") == "FeatureCollection":
        return unary_union([shape(f["geometry"]) for f in value["features"] if f.get("geometry")])
    if value.get("type") == "Feature":
        return shape(value["geometry"])
    return shape(value)


def _marine(feature):
    props = feature.get("properties") or {}
    kind = str(props.get("water_type", "")).lower()
    if kind in {"lake", "reservoir", "river", "inland_sea"}:
        return False
    return (kind in {"ocean", "sea", "strait", "chokepoint", "gulf", "bay", "channel", "bight", "marine_region"}
            or props.get("source_layer") == "marine"
            or props.get("region_group") in {"marine_macro", "marine_detail", "ocean_macro"})


def _densify_line(coordinates, step, vertices=None):
    result = []
    for start, end in zip(coordinates, coordinates[1:]):
        ax, ay = start[:2]
        bx, by = end[:2]
        dx, dy = bx - ax, by - ay
        fractions = {0.0}
        for origin, delta in ((ax, dx), (ay, dy)):
            if not delta:
                continue
            low, high = sorted((origin, origin + delta))
            for index in range(math.floor(low / step) + 1, math.ceil(high / step)):
                fraction = (index * step - origin) / delta
                if 0 < fraction < 1:
                    fractions.add(fraction)
        # Nodes already present on a neighbour's boundary must also appear here.
        # This makes differently segmented collinear shared edges identical.
        if vertices is not None and (dx or dy):
            tree, points = vertices
            tolerance = 1e-10
            candidates = tree.query(box(min(ax, bx) - tolerance, min(ay, by) - tolerance,
                                        max(ax, bx) + tolerance, max(ay, by) + tolerance))
            length2 = dx * dx + dy * dy
            length = math.sqrt(length2)
            for index in candidates:
                point = points[int(index)]
                fraction = ((point.x - ax) * dx + (point.y - ay) * dy) / length2
                if (tolerance < fraction * length and tolerance < (1 - fraction) * length
                        and abs((point.x - ax) * dy - (point.y - ay) * dx) <= tolerance * length):
                    fractions.add(fraction)
        for fraction in sorted(fractions):
            point = ([ax, ay] if fraction == 0 else
                     [round(ax + fraction * dx, 12), round(ay + fraction * dy, 12)])
            if not result or point != result[-1]:
                result.append(point)
    if coordinates:
        final = list(coordinates[-1][:2])
        if not result or final != result[-1]:
            result.append(final)
    return result


def compile_water_feature_collection(collection, *, ocean_mask=None, land_mask=None,
                                     fill_ocean_regions=None, max_step_degrees=0.25):
    """Return a copy with clipped, wound, noded and linear-densified water polygons.

    Masks are Shapely geometry, GeoJSON geometry, Feature or FeatureCollection.
    Ocean/sea features are intersected with ocean_mask and differenced with
    land_mask; lakes and inland seas retain their source coverage. Empty clipped
    features keep their id/properties and an empty MultiPolygon. Global coverage
    allocation is a caller decision; fill_ocean_regions is reserved and rejected.
    """
    if fill_ocean_regions is not None:
        raise ValueError("Allocate uncovered ocean to region IDs before compilation.")
    if not math.isfinite(max_step_degrees) or not 0 < max_step_degrees <= 10:
        raise ValueError("max_step_degrees must be finite and in (0, 10].")
    if collection.get("type") != "FeatureCollection":
        raise ValueError("Expected a FeatureCollection.")
    ocean, land = _mask_geometry(ocean_mask), _mask_geometry(land_mask)
    result = deepcopy(collection)
    prepared = []
    precision_removals = []
    all_vertices = set()
    for feature in result["features"]:
        raw = feature.get("geometry")
        if not raw or raw.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError("Water features must have Polygon or MultiPolygon geometry.")
        geometry = shape(raw)
        if not geometry.is_empty:
            xmin, ymin, xmax, ymax = geometry.bounds
            if not all(math.isfinite(v) for v in geometry.bounds) or xmin < -180 or xmax > 180 or ymin < -90 or ymax > 90:
                raise ValueError("Water coordinates must be finite and within EPSG:4326 bounds.")
            if not geometry.is_valid:
                raise ValueError("Repair invalid source water geometry before compilation.")
        if _marine(feature):
            if ocean is not None:
                geometry = geometry.intersection(ocean)
            if land is not None:
                geometry = geometry.difference(land)
        polygons = []
        source_parts = list(_parts(geometry))
        retained_parts = [part for part in source_parts if part.area > D3_MIN_COMPONENT_AREA_DEGREES2]
        if source_parts and not retained_parts:
            raise ValueError("Water feature collapsed below the D3 component precision floor.")
        removed_parts = [part for part in source_parts if part.area <= D3_MIN_COMPONENT_AREA_DEGREES2]
        if removed_parts:
            precision_removals.append({"id": (feature.get("properties") or {}).get("id") or feature.get("id"),
                                       "component_count": len(removed_parts),
                                       "area_degrees2": sum(part.area for part in removed_parts)})
        for polygon in retained_parts:
            polygon = orient(polygon, sign=-1)
            polygons.append(polygon)
            for ring in (polygon.exterior, *polygon.interiors):
                all_vertices.update(tuple(p[:2]) for p in ring.coords)
        prepared.append(polygons)
    points = [Point(coordinate) for coordinate in sorted(all_vertices)]
    vertices = (STRtree(points), points) if points else None
    for feature, polygons in zip(result["features"], prepared):
        coordinates = [[_densify_line(list(ring.coords), max_step_degrees, vertices)
                        for ring in (polygon.exterior, *polygon.interiors)] for polygon in polygons]
        feature["geometry"] = ({"type": "Polygon", "coordinates": coordinates[0]} if len(coordinates) == 1
                               else {"type": "MultiPolygon", "coordinates": coordinates})
        feature.pop("bbox", None)
    result.pop("bbox", None)
    if precision_removals:
        result["water_geometry_precision"] = {
            "minimum_component_area_degrees2": D3_MIN_COMPONENT_AREA_DEGREES2,
            "removed_components": [
                *(result.get("water_geometry_precision", {}).get("removed_components", [])),
                *precision_removals,
            ],
        }
    return result


def densify_water_topology(topology, *, object_name="water_regions", max_step_degrees=0.25):
    """Restore linear samples removed by topology encoding, only on water arcs.

    Clones arcs shared with non-water objects, preserving water sharing
    and the original quantization transform.
    Call only on already compiled/wound water; this does not clip or rewind.
    """
    if not math.isfinite(max_step_degrees) or not 0 < max_step_degrees <= 10:
        raise ValueError("max_step_degrees must be finite and in (0, 10].")
    result = deepcopy(topology)
    target = result.get("objects", {}).get(object_name)
    if target is None:
        raise ValueError(f"Missing topology object: {object_name}")
    indices = set()
    def collect(value):
        if isinstance(value, list):
            for child in value:
                collect(child)
        elif isinstance(value, int):
            indices.add(value if value >= 0 else ~value)
    def visit(geometry):
        collect(geometry.get("arcs", []))
        for child in geometry.get("geometries", []):
            visit(child)
    visit(target)
    water_indices = indices.copy()
    indices.clear()
    for name, geometry in result["objects"].items():
        if name != object_name:
            visit(geometry)
    non_water_indices = indices.copy()
    indices = water_indices
    transform = result.get("transform")
    remap = {}
    for source_index in sorted(indices):
        index = source_index
        if source_index in non_water_indices:
            index = len(result["arcs"])
            result["arcs"].append(deepcopy(result["arcs"][source_index]))
        remap[source_index] = index
        arc = result["arcs"][index]
        if transform:
            sx, sy = transform["scale"]
            tx, ty = transform["translate"]
            x = y = 0
            coordinates = []
            for dx, dy in arc:
                x, y = x + dx, y + dy
                coordinates.append([x * sx + tx, y * sy + ty])
            # Grid samples move by up to one quantization unit after encoding.
            # Do not repeatedly resample these short segments: that would add
            # vertices on every build and could shift already quantized edges.
            dense = []
            for start, end in zip(coordinates, coordinates[1:]):
                if (abs(end[0] - start[0]) <= max_step_degrees + abs(sx) + 1e-12
                        and abs(end[1] - start[1]) <= max_step_degrees + abs(sy) + 1e-12):
                    dense.append(start)
                else:
                    dense.extend(_densify_line([start, end], max_step_degrees)[:-1])
            if coordinates:
                dense.append(coordinates[-1])
            encoded = []
            x = y = 0
            for lon, lat in dense:
                nx, ny = round((lon - tx) / sx), round((lat - ty) / sy)
                if not encoded or (nx, ny) != (x, y):
                    encoded.append([nx - x, ny - y])
                    x, y = nx, ny
            result["arcs"][index] = encoded
        else:
            dense = []
            for start, end in zip(arc, arc[1:]):
                if max(abs(end[0] - start[0]), abs(end[1] - start[1])) <= max_step_degrees + 1e-9:
                    dense.append(start)
                else:
                    dense.extend(_densify_line([start, end], max_step_degrees)[:-1])
            if arc:
                dense.append(arc[-1])
            result["arcs"][index] = dense
    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(child) for child in value]
        return remap[value] if value >= 0 else ~remap[~value]
    def rewrite_geometry(geometry):
        if "arcs" in geometry:
            geometry["arcs"] = rewrite(geometry["arcs"])
        for child in geometry.get("geometries", []):
            rewrite_geometry(child)
    rewrite_geometry(target)
    return result

def _grid_limits(origin, scale, lower, upper):
    low = math.ceil((lower - origin) / scale)
    high = math.floor((upper - origin) / scale)
    while low * scale + origin < lower:
        low += 1
    while high * scale + origin > upper:
        high -= 1
    return low, high


def _snap_water_to_transform(collection, transform):
    """Canonicalize all water on one integer grid before topology construction."""
    sx, sy = transform["scale"]
    tx, ty = transform["translate"]
    xmin, xmax = _grid_limits(tx, sx, -180, 180)
    ymin, ymax = _grid_limits(ty, sy, -90, 90)
    extent = box(xmin, ymin, xmax, ymax)
    snapped = deepcopy(collection)
    measurements = []
    measured_sources = []
    for feature_index, feature in enumerate(snapped["features"]):
        source = shape(feature["geometry"])
        if source.is_empty:
            continue
        repair_area = 0.0
        if not source.is_valid:
            repaired = make_valid(source)
            # Compiled input can contain tiny self contacts
            # from floating point line interpolation. Reject material changes.
            repair_area = abs(repaired.area - source.area)
            if repair_area > source.length * 1e-9:
                raise ValueError("Invalid water source requires material repair before grid snapping.")
            source = repaired
        lattice = affine_transform(source, [1 / sx, 0, 0, 1 / sy, -tx / sx, -ty / sy])
        if not lattice.is_valid:
            lattice = make_valid(lattice)
        lattice = set_precision(lattice, grid_size=1, mode="valid_output").intersection(extent)
        polygons = list(_parts(lattice))
        if not polygons:
            identifier = (feature.get("properties") or {}).get("id") or feature.get("id")
            raise ValueError(f"Water feature {identifier!r} collapsed on the refined topology grid.")
        lattice = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
        geometry = affine_transform(lattice, [sx, 0, 0, sy, tx, ty])
        if not geometry.is_valid:
            raise ValueError("Snap-rounded water geometry is invalid.")
        changed_area = source.symmetric_difference(geometry).area
        # A vertex can move by at most one cell (boundary clamping included).
        # Refuse larger movement rather than retry with unbounded refinements.
        error_bound = 2 * source.length * math.hypot(sx, sy) + 4 * sx * sy
        if changed_area > error_bound:
            raise ValueError("Water snap-rounding exceeded its grid displacement area bound.")
        measurements.append({"id": (feature.get("properties") or {}).get("id") or feature.get("id"),
                             "source_repair_area_change_degrees2": repair_area,
                             "source_area_degrees2": source.area,
                             "result_area_degrees2": geometry.area,
                             "symmetric_difference_area_degrees2": changed_area,
                             "area_error_bound_degrees2": error_bound,
                             "source_components": len(list(_parts(source))),
                             "result_components": len(polygons)})
        measured_sources.append((feature_index, source, measurements[-1]))
        feature["geometry"] = {"type": geometry.geom_type,
                               "coordinates": geometry.__geo_interface__["coordinates"]}
    # Set_precision can remove vertices or split short shared boundaries; restore
    # the same planar-edge contract and shared collinear nodes after that step.
    snapped = compile_water_feature_collection(snapped)
    # Compilation introduces fixed-degree samples, which need not lie on the
    # target quantization grid. Canonicalize these BEFORE the topology encoder
    # discovers shared arcs; a near-end sample must not become a zero-length
    # shared arc when it later rounds back onto that same endpoint.
    for feature_index, source, measurement in measured_sources:
        feature = snapped["features"][feature_index]
        geometry = shape(feature["geometry"])
        lattice = affine_transform(geometry, [1 / sx, 0, 0, 1 / sy, -tx / sx, -ty / sy])
        if not lattice.is_valid:
            lattice = make_valid(lattice)
        lattice = set_precision(lattice, grid_size=1, mode="valid_output").intersection(extent)
        polygons = [orient(part, sign=-1) for part in _parts(lattice)]
        if not polygons:
            raise ValueError("Water feature collapsed during final shared-grid canonicalization.")
        lattice = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
        geometry = affine_transform(lattice, [sx, 0, 0, sy, tx, ty])
        if not geometry.is_valid:
            raise ValueError("Final shared-grid water geometry is invalid.")
        changed_area = source.symmetric_difference(geometry).area
        if changed_area > measurement["area_error_bound_degrees2"]:
            raise ValueError("Final water snap-rounding exceeded its grid displacement area bound.")
        measurement.update(result_area_degrees2=geometry.area,
                           symmetric_difference_area_degrees2=changed_area,
                           result_components=len(polygons))
        feature["geometry"] = {"type": geometry.geom_type,
                               "coordinates": geometry.__geo_interface__["coordinates"]}
    return snapped, {"grid_degrees": [sx, sy], "features": measurements,
                     "total_symmetric_difference_area_degrees2": sum(
                         row["symmetric_difference_area_degrees2"] for row in measurements)}


def _orient_encoded_water_rings(topology, object_name):
    """Enforce source planar winding on encoded rings without changing arcs.

    Translation before math.fsum avoids catastrophic cancellation of tiny
    far-origin polygon areas. Reversing references leaves shared arcs intact.
    """
    def orient_polygon(rings):
        for index, ring in enumerate(rings):
            points = []
            for reference in ring:
                arc = topology["arcs"][reference if reference >= 0 else ~reference]
                ordered = arc if reference >= 0 else arc[::-1]
                points.extend(ordered if not points else ordered[1:])
            if len(points) < 3:
                continue
            ox, oy = points[0][:2]
            area2 = math.fsum((a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy)
                              for a, b in zip(points, points[1:] + points[:1]))
            if (index == 0 and area2 > 0) or (index > 0 and area2 < 0):
                ring[:] = [~reference for reference in reversed(ring)]
    def visit(geometry):
        if geometry.get("type") == "Polygon":
            orient_polygon(geometry["arcs"])
        elif geometry.get("type") == "MultiPolygon":
            for polygon in geometry["arcs"]:
                orient_polygon(polygon)
        for child in geometry.get("geometries", []):
            visit(child)
    visit(topology["objects"][object_name])


def replace_water_topology_object(topology, collection, *, object_name="water_regions",
                                  quantization_refinement=256):
    """Replace compiled water while preserving decoded non-water geometry exactly.

    Existing quantized coordinates are rescaled by a power of two until their
    largest grid step is <= 0.0002 degrees. Binary scaling preserves the decoded
    values of every old arc and Point/MultiPoint. Water is snap-rounded on the
    target integer grid before shared topology construction, with bounded area
    changes recorded in water_geometry_quantization. Encoding is followed by
    linear sampling on that finer grid. Only unreferenced arcs are removed;
    object metadata is retained. Entire-feature collapse is rejected. Unquantized
    water uses a common 1e-9 degree numerical grid to prevent serialized
    self-contacts; this compatibility tolerance is not a survey accuracy claim.
    """
    import topojson

    if (not isinstance(quantization_refinement, int) or isinstance(quantization_refinement, bool)
            or quantization_refinement < 2
            or quantization_refinement & (quantization_refinement - 1)):
        raise ValueError("quantization_refinement must be an integer power of two >= 2.")
    if topology.get("type") != "Topology":
        raise ValueError("Expected a Topology.")
    if collection.get("type") != "FeatureCollection":
        raise ValueError("Expected a compiled water FeatureCollection.")
    target_transform = deepcopy(topology.get("transform"))
    snap_report = None
    if target_transform:
        scales = target_transform["scale"]
        if not all(math.isfinite(scale) and scale > 0 for scale in scales):
            raise ValueError("Topology transform scales must be finite and positive.")
        factor = 1
        while max(scales) / factor > 0.0002:
            factor *= quantization_refinement
        target_transform["scale"] = [scale / factor for scale in scales]
        collection, snap_report = _snap_water_to_transform(collection, target_transform)
    else:
        # Even unquantized JSON needs a common numerical grid: independent
        # floating-point intersection vertices can otherwise create microscopic
        # self-crossings or overlaps after serialization and topology splitting.
        collection, snap_report = _snap_water_to_transform(
            collection, {"scale": [1e-9, 1e-9], "translate": [0, 0]})
    # Python topojson cannot encode empty polygon features. Keep those records
    # outside its geometry pass, then restore them in their original order.
    source_features = collection.get("features", [])
    populated = []
    for feature in source_features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            raise ValueError("Compiled water must contain Polygon or MultiPolygon geometry.")
        populated.append(bool(geometry.get("coordinates")))
    encoding_collection = {"type": "FeatureCollection", "features": [
        feature for feature, present in zip(source_features, populated) if present]}
    encoded = topojson.Topology(
        encoding_collection, prequantize=False, topoquantize=False, presimplify=False,
        # Source shells/holes were oriented by GEOS. Python topojson's optional
        # shoelace rewind loses the sign of tiny polygons at large coordinates.
        toposimplify=False, shared_coords=True, winding_order=None,
        object_name=object_name,
    ).to_dict()
    encoded_features = iter(encoded["objects"][object_name]["geometries"])
    restored = []
    for source, present in zip(source_features, populated):
        geometry = next(encoded_features) if present else {"type": "MultiPolygon", "arcs": []}
        geometry.pop("id", None)
        if "id" in source:
            geometry["id"] = deepcopy(source["id"])
        if "properties" in source:
            geometry["properties"] = deepcopy(source["properties"])
        restored.append(geometry)
    encoded["objects"][object_name]["geometries"] = restored
    _orient_encoded_water_rings(encoded, object_name)
    if target_transform is None:
        encoded = densify_water_topology(encoded, object_name=object_name)
    result = deepcopy(topology)
    result.setdefault("objects", {})
    result.setdefault("arcs", [])
    transform = result.get("transform")
    if transform:
        scales = transform["scale"]
        if not all(math.isfinite(scale) and scale > 0 for scale in scales):
            raise ValueError("Topology transform scales must be finite and positive.")
        factor = 1
        while max(scales) / factor > 0.0002:
            factor *= quantization_refinement
        if factor != 1:
            transform["scale"] = [scale / factor for scale in scales]
            result["arcs"] = [[[coordinate[0] * factor, coordinate[1] * factor, *coordinate[2:]]
                               for coordinate in arc] for arc in result["arcs"]]
            def refine_points(geometry):
                if geometry.get("type") == "Point":
                    point = geometry["coordinates"]
                    geometry["coordinates"] = [point[0] * factor, point[1] * factor, *point[2:]]
                elif geometry.get("type") == "MultiPoint":
                    geometry["coordinates"] = [[point[0] * factor, point[1] * factor, *point[2:]]
                                               for point in geometry["coordinates"]]
                for child in geometry.get("geometries", []):
                    refine_points(child)
            for geometry in result["objects"].values():
                refine_points(geometry)
        sx, sy = transform["scale"]
        tx, ty = transform["translate"]
        xmin, xmax = _grid_limits(tx, sx, -180, 180)
        ymin, ymax = _grid_limits(ty, sy, -90, 90)
        arcs = []
        for arc in encoded["arcs"]:
            quantized = []
            for lon, lat in arc:
                point = [min(xmax, max(xmin, round((lon - tx) / sx))),
                         min(ymax, max(ymin, round((lat - ty) / sy)))]
                if not quantized or point != quantized[-1]:
                    quantized.append(point)
            if len(quantized) < 2:
                raise ValueError(f"Water arc collapsed on the refined topology grid: {arc[:4]!r}")
            previous = [0, 0]
            deltas = []
            for point in quantized:
                deltas.append([point[0] - previous[0], point[1] - previous[1]])
                previous = point
            arcs.append(deltas)
    else:
        arcs = encoded["arcs"]

    def map_arcs(value, remap):
        if isinstance(value, list):
            return [map_arcs(child, remap) for child in value]
        return remap[value] if value >= 0 else ~remap[~value]

    def rewrite(geometry, remap):
        if "arcs" in geometry:
            geometry["arcs"] = map_arcs(geometry["arcs"], remap)
        for child in geometry.get("geometries", []):
            rewrite(child, remap)

    offset = len(result["arcs"])
    water = encoded["objects"][object_name]
    rewrite(water, {index: index + offset for index in range(len(arcs))})
    old_object = result["objects"].get(object_name, {})
    # Preserve foreign object members, but geometry and its stale bbox belong to
    # the new collection. Feature properties/IDs come from the compiled source.
    for key, value in old_object.items():
        if key not in {"type", "arcs", "coordinates", "geometries", "bbox"} and key not in water:
            water[key] = value
    result["objects"][object_name] = water
    result["arcs"].extend(arcs)
    referenced = set()

    def collect_arcs(value):
        if isinstance(value, list):
            for child in value:
                collect_arcs(child)
        else:
            referenced.add(value if value >= 0 else ~value)

    def collect(geometry):
        collect_arcs(geometry.get("arcs", []))
        for child in geometry.get("geometries", []):
            collect(child)

    for geometry in result["objects"].values():
        collect(geometry)
    ordered = sorted(referenced)
    remap = {old: new for new, old in enumerate(ordered)}
    for geometry in result["objects"].values():
        rewrite(geometry, remap)
    result["arcs"] = [result["arcs"][old] for old in ordered]
    if target_transform is not None:
        # Restore only genuinely long edges after encoding, using quantization
        # tolerance so short canonical grid segments are not sampled again.
        result = densify_water_topology(result, object_name=object_name)
    # Existing global bounds can cease to describe the replaced ocean coverage.
    result.pop("bbox", None)
    if snap_report is not None:
        result["water_geometry_quantization"] = snap_report
    if "water_geometry_precision" in collection:
        result["water_geometry_precision"] = deepcopy(collection["water_geometry_precision"])
    else:
        result.pop("water_geometry_precision", None)
    return result
