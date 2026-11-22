"""Build a regional bookmark from political features and district boundaries."""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from fractions import Fraction
import heapq
import json
import math
from pathlib import Path
import re
import sys
from time import perf_counter
import unicodedata

import shapely
from pyproj import Geod, Transformer
from shapely.affinity import translate
from shapely.geometry import MultiPoint, box, shape
from shapely.ops import polygonize

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.contracts import sha256_json_stable, sha256_path
from map_builder.regional_geometry import _absolute_topology, _compact_arcs, _decode_geometry, _feature_id
from tools.check_scenario_contracts import _compose_snapshot_payload
from tools.lossless_topology import _geometry_arc_refs


RULES = ROOT / "data/scenario-rules"
SCENARIOS = ROOT / "data/scenarios"
GEOD = Geod(ellps="WGS84")


def read(path):
    return json.loads(path.read_bytes())


def write(path, payload, *, compact=False):
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False,
                      indent=None if compact else 2, separators=(",", ":") if compact else None)
    path.write_text(data + "\n", encoding="utf-8", newline="\n")


def regional_longitudes(polygon, meridian):
    west, _, east, _ = polygon.bounds
    if meridian - 180 <= west and east <= meridian + 180:
        return polygon

    def unwrap(x, y):
        return x + 360 * ((meridian + 180 - x) // 360), y

    parts = []
    for part in shapely.get_parts(polygon):
        left, _, right, _ = part.bounds
        if right - left > 180:
            part = shapely.transform(part, unwrap, interleaved=False)
        else:
            turns = round((meridian - (left + right) / 2) / 360)
            if turns:
                part = translate(part, xoff=360 * turns)
        parts.append(part)
    return shapely.union_all(parts)


def surface_area(polygon):
    if polygon.area == 0:
        return 0
    area, _ = GEOD.geometry_area_perimeter(shapely.orient_polygons(polygon))
    return abs(area)


def majority_district(polygon, districts, index, threshold):
    overlaps = []
    for i in index.query(polygon, predicate="intersects"):
        piece = polygon.intersection(index.geometries[i])
        if piece.area > 0:
            overlaps.append((surface_area(piece), districts[i], piece))
    if overlaps:
        covered = shapely.union_all([piece for _, _, piece in overlaps])
        if surface_area(covered) > surface_area(polygon) * threshold:
            return max(overlaps, key=lambda row: (row[0], row[1]["unit_key"]))[1]
    return None


def near_frontier(polygon, index, km):
    west, south, east, north = polygon.bounds
    dy = km / 110
    latitude = min(90, max(abs(south), abs(north)) + dy)
    dx = min(180, dy / math.cos(math.radians(latitude)))
    candidates = index.query(box(west - dx, south - dy, east + dx, north + dy))
    if not len(candidates):
        return False
    center = polygon.centroid
    projection = Transformer.from_crs(
        4326, f"+proj=aeqd +lon_0={center.x} +lat_0={center.y} +ellps=WGS84", always_xy=True
    )
    local = shapely.transform(polygon, projection.transform, interleaved=False)
    neighbors = shapely.transform(index.geometries[candidates], projection.transform, interleaved=False)
    return bool(shapely.dwithin(local, neighbors, km * 1000).any())


def select_members(topology, base_owners, units, membership, rules):
    excluded = set(membership["excluded_districts"]) | set(rules["excluded_districts"])
    units = [f for f in units["features"] if f["properties"]["unit_key"] not in excluded]
    districts = [f["properties"] for f in units]
    meridian = membership["central_meridian"]
    index = shapely.STRtree([regional_longitudes(shape(f["geometry"]), meridian) for f in units])
    west, south, east, north = shapely.total_bounds(index.geometries)
    envelopes = [box(west + offset, south, east + offset, north) for offset in (-360, 0, 360)]
    exclusions = {tag: box(*bounds) for tag, bounds in membership["neighbor_exclusion_bounds"].items()}
    absolute = _absolute_topology(topology) if "transform" in topology else topology
    owners, shapes, dropped = {}, {}, []
    missing = defaultdict(list)
    for row in absolute["objects"]["political"]["geometries"]:
        fid = _feature_id(row)
        tag = base_owners.get(fid)
        shell = "_FB_" in fid
        try:
            geometry = _decode_geometry(absolute, row)
        except (ValueError, TypeError, KeyError, IndexError, shapely.errors.GEOSException):
            if shell:
                dropped.append(fid)
                continue
            # A malformed non-member ring can still be ruled out by its actual arc bounds.
            points = [point for ref in _geometry_arc_refs(row)
                      for point in absolute["arcs"][ref if ref >= 0 else ~ref]]
            geometry = MultiPoint(points).envelope
            if (tag in membership["neighbor_tags"] or tag in membership["border_tags"]
                    or len(index.query(regional_longitudes(geometry, meridian)))):
                raise ValueError(f"Unreadable candidate geometry: {fid}")
            continue
        valid = (geometry is not None and geometry.geom_type in {"Polygon", "MultiPolygon"}
                 and geometry.is_valid and not geometry.is_empty and geometry.area > 0)
        if shell and not valid:
            dropped.append(fid)
            continue
        if (tag not in membership["neighbor_tags"] and tag not in membership["border_tags"]
                and not any(bounds.intersects(geometry.envelope) for bounds in envelopes)):
            continue
        polygon = regional_longitudes(geometry, meridian)
        whole = tag in membership["neighbor_tags"] and not (
            tag in exclusions and exclusions[tag].covers(polygon.representative_point()))
        border = tag in membership["border_tags"]
        if not valid:
            if whole or border or len(index.query(polygon)):
                raise ValueError(f"Invalid candidate geometry: {fid}")
            continue
        district = majority_district(polygon, districts, index, membership["majority_threshold"])
        if district:
            owner = rules["districts"].get(district["unit_key"], rules["provinces"].get(district["prov_ENG"]))
        elif whole or (border and near_frontier(polygon, index, membership["border_distance_km"])):
            owner = rules["neighbor_owner_map"].get(tag)
        else:
            continue
        if not owner:
            province = district["prov_ENG"] if district else "(outside empire)"
            missing[f"{tag} / {province}"].append(fid)
        else:
            owners[fid] = owner
            shapes[fid] = polygon
    if missing:
        raise ValueError("Unassigned features by base owner and province: " + json.dumps(missing, ensure_ascii=False))
    return owners, shapes, dropped


def crop_topology(base, owners, shapes):
    political = base["objects"]["political"]
    rows = political["geometries"]
    indices = [i for i, row in enumerate(rows) if _feature_id(row) in owners]
    remap = {old: new for new, old in enumerate(indices)}
    cropped = {
        "type": "GeometryCollection", "geometries": [deepcopy(rows[i]) for i in indices],
        "computed_neighbors": [[remap[j] for j in political["computed_neighbors"][i] if j in remap] for i in indices],
    }
    topology = {"type": "Topology", "objects": {"political": cropped}, "arcs": base["arcs"]}
    if "transform" in base:
        topology["transform"] = base["transform"]
    if "political_precision_feature_ids" in base:
        topology["political_precision_feature_ids"] = [i for i in base["political_precision_feature_ids"] if i in owners]
    _compact_arcs(topology)
    decoded = _absolute_topology(topology) if "transform" in topology else topology
    points = [p for arc in decoded["arcs"] for p in arc]
    topology["bbox"] = list(MultiPoint(points).bounds)
    west, south, east, north = shapely.total_bounds(list(shapes.values()))
    bounds = [west if -180 <= west <= 180 else (west + 180) % 360 - 180, south,
              east if -180 <= east <= 180 else (east + 180) % 360 - 180, north]
    return topology, bounds


class CuttingUnits:
    def __init__(self, features):
        features = sorted(features, key=lambda f: f["properties"]["unit_key"])
        self.rows = [f["properties"] for f in features]
        self.index = shapely.STRtree([shape(f["geometry"]) for f in features])

    def overlaps(self, polygon):
        return [(self.rows[i], polygon.intersection(self.index.geometries[i]))
                for i in sorted(self.index.query(polygon, predicate="intersects"))]


def partition(polygon, cutters, fraction, min_km2):
    """Polygonize one boundary network so gaps, islands and overlapping source units have one owner."""
    indices = sorted(cutters.index.query(polygon, predicate="intersects"))
    if not indices:
        return {}, 0
    lines = [polygon.boundary, *(cutters.index.geometries[i].boundary for i in indices)]
    pieces = defaultdict(list)
    for face in polygonize(shapely.union_all(lines)):
        point = face.representative_point()
        if polygon.covers(point):
            matches = cutters.index.query(point, predicate="covered_by")
            key = cutters.rows[min(matches)]["unit_key"] if len(matches) else "REMAINDER"
            pieces[key].append(face)
    fragments = [(key, part) for key, faces in sorted(pieces.items())
                 for part in shapely.get_parts(shapely.union_all(faces))]
    polygons = [p for _, p in fragments]
    tree = shapely.STRtree(polygons)
    edges = [dict() for _ in polygons]
    for i, j in zip(*tree.query(polygons, predicate="intersects")):
        if i < j:
            length = GEOD.geometry_length(polygons[i].boundary.intersection(polygons[j].boundary))
            if length > 0:
                edges[i][j] = edges[j][i] = length
    areas = [surface_area(p) for p in polygons]
    siblings = {i: [p] for i, p in enumerate(polygons)}
    threshold = max(surface_area(polygon) * fraction, min_km2 * 1e6)
    small = [(area, i) for i, area in enumerate(areas) if area < threshold]
    heapq.heapify(small)
    merged = 0
    while small:
        area, i = heapq.heappop(small)
        if i not in siblings or area != areas[i] or not edges[i]:
            continue
        target = max(edges[i], key=lambda j: (edges[i][j], -j))
        for j, length in edges[i].items():
            del edges[j][i]
            if j != target:
                edges[target][j] = edges[j][target] = edges[target].get(j, 0) + length
        siblings[target].extend(siblings.pop(i))
        areas[target] += area
        if areas[target] < threshold:
            heapq.heappush(small, (areas[target], target))
        merged += 1
    grouped = defaultdict(list)
    for i, parts in siblings.items():
        grouped[fragments[i][0]].extend(parts)
    pieces = {key: shapely.union_all(parts) for key, parts in grouped.items()}
    return pieces if len(pieces) > 1 else {}, merged


def strip_intersections(groups, districts):
    provinces = defaultdict(list)
    for row, geometry in zip(districts.rows, districts.index.geometries):
        provinces[row["prov_ENG"]].append(geometry)
    strips = []
    for group, adm2 in groups:
        masks = {p: shapely.union_all(provinces[p]) for p in sorted(group["provinces"])}
        for row, district in zip(adm2.rows, adm2.index.geometries):
            intersections = {p: district.intersection(g) for p, g in masks.items() if district.intersects(g)}
            if len(intersections) < 2:
                continue
            primary = max(intersections, key=lambda p: intersections[p].area)
            for province, overlap in intersections.items():
                if province == primary:
                    continue
                for part in shapely.get_parts(overlap):
                    if part.geom_type != "Polygon" or not part.area:
                        continue
                    area = surface_area(part) / 1e6
                    length = GEOD.geometry_length(part.boundary) / 2000
                    if area >= 1 and length >= 10 and length**2 >= 10 * area:
                        strips.append({"province": province, "adjacent_province": primary, "adm2": row["unit_key"],
                                       "name": row["shapeName"], "area_km2": round(area, 3),
                                       "half_perimeter_km": round(length, 3), "effective_width_km": round(area / length, 3)})
    return sorted(strips, key=lambda s: (-s["area_km2"], s["adm2"], s["province"]))[:20]


def split_features(topology, shapes, owners, historical, modern, rules, ownership):
    districts = CuttingUnits(historical["features"])
    groups = [(g, CuttingUnits(f for f in modern["features"] if f["properties"]["shapeGroup"] in g["countries"]))
              for g in rules["adm2_partitions"]]
    names = {f["properties"]["unit_key"]: f["properties"].get("shapeName") or f["properties"].get("Name_ENG")
             for f in historical["features"] + modern["features"]}
    lineage, residuals, subtractions, replacements = {}, {}, {}, {}
    inherited = {}
    merged = 0
    for row in topology["objects"]["political"]["geometries"]:
        fid = _feature_id(row)
        if "_FB_" in fid or fid in rules["subtract"].values():
            continue
        g = shapes[fid]
        if fid in rules["subtract"]:
            city = shapes[rules["subtract"][fid]]
            subtractions[fid] = surface_area(g.intersection(city)) / 1e6
            g = g.difference(city)
            shapes[fid] = g
            replacements[fid] = [(fid, row["properties"]["name"], g)]
        overlaps = [(p, surface_area(part)) for p, part in districts.overlaps(g) if part.area]
        half = surface_area(g) / 2
        adm2 = next((index for group, index in groups if sum(
            a for p, a in overlaps if p["prov_ENG"] in group["provinces"] or p["unit_key"] in group["districts"]
        ) > half), None)
        if adm2 is None and sum(a for p, a in overlaps if p["prov_ENG"] in rules["district_partitions"]) <= half:
            continue
        leaves = [((), row["properties"]["name"], g)]
        for cutters in ([adm2, districts] if adm2 is not None else [districts]):
            next_leaves = []
            for path, name, parent in leaves:
                pieces, count = partition(parent, cutters, rules["min_area_fraction"], rules["min_area_km2"])
                merged += count
                if pieces:
                    next_leaves.extend((path + (key,), names.get(key) or name, child) for key, child in pieces.items())
                else:
                    next_leaves.append((path, name, parent))
            leaves = next_leaves
        if len(leaves) == 1:
            continue
        replacements[fid] = []
        lineage[fid] = []
        residual = g.symmetric_difference(shapely.union_all([leaf[2] for leaf in leaves]))
        # Upper bound for WGS84 km² per square degree, including straight lon/lat edges with added vertices.
        residuals[fid] = residual.area * 12400
        for path, name, child in leaves:
            suffix = "__".join(re.sub(r"[^A-Za-z0-9]+", "_", key).strip("_") for key in path)
            cid = f"{fid}__RCW_{suffix}"
            if cid in shapes:
                raise ValueError(f"Duplicate child ID: {cid}")
            # Clipping noise can leave a sliver of a few square millimetres inside a neighbouring district.
            min_overlap = surface_area(child) * 1e-6
            district = max(((area, p["unit_key"], p) for p, part in districts.overlaps(child)
                            if (area := surface_area(part)) > min_overlap), default=None)
            if district:
                p = district[2]
                owner = ownership["districts"].get(p["unit_key"], ownership["provinces"].get(p["prov_ENG"]))
                if not owner:
                    raise ValueError(f"Unassigned child {cid} in {p['unit_key']}")
            else:
                owner = owners[fid]
                inherited[cid] = {"parent_id": fid, "owner": owner, "area_km2": surface_area(child) / 1e6}
            owners[cid], shapes[cid] = owner, child
            replacements[fid].append((cid, name, child))
            lineage[fid].append(cid)
        del shapes[fid], owners[fid]
    return replacements, {"children_by_parent": lineage, "residual_km2_by_parent": residuals,
                          "residual_measure": "Upper bound on symmetric difference in km² (12400 km²/deg²)",
                          "zero_intersection_inheritance": inherited,
                          "largest_strip_intersections": strip_intersections(groups, districts),
                          "strip_measure": "Secondary ADM2/province intersections before merging, ranked by area; area >= 1 km², half-perimeter >= 10 km, half-perimeter²/area >= 10. Effective width = twice area / perimeter.",
                          "subtracted_city_overlap_km2": subtractions, "merged_small_piece_count": merged}


def rebuild_split_topology(topology, replacements):
    base = _absolute_topology(topology) if "transform" in topology else topology
    paths = [tuple(map(tuple, arc)) for arc in base["arcs"]]
    original_count = len(paths)
    # Independently clipped rings can contain machine-sized spikes at a shared junction.
    # Use a common numerical identity for new vertices, preferring exact baseline coordinates.
    def vertex_key(point):
        return round(point[0], 12), round(point[1], 12)

    exact = {vertex_key(p): p for arc in paths for p in arc}
    for children in replacements.values():
        for _, _, child in children:
            for p in shapely.get_coordinates(child):
                exact.setdefault(vertex_key(p), tuple(p))
    rows = []
    for row in base["objects"]["political"]["geometries"]:
        fid = _feature_id(row)
        if fid not in replacements:
            rows.append(deepcopy(row))
            continue
        for cid, name, child in replacements[fid]:
            child = shapely.set_precision(child, 1e-12)
            rings = []
            for polygon in shapely.get_parts(shapely.orient_polygons(child, exterior_cw=True)):
                polygon_arcs = []
                for ring in [polygon.exterior, *polygon.interiors]:
                    polygon_arcs.append([len(paths)])
                    paths.append(tuple(exact.get(vertex_key(p), p) for p in ring.coords))
                rings.append(polygon_arcs)
            properties = {**row["properties"], "id": cid, "name": name}
            if cid != fid:
                for field in ("aliases", "name_en", "name_zh"):
                    properties.pop(field, None)
            rows.append({"type": child.geom_type, "id": cid, "properties": properties,
                         "arcs": rings[0] if child.geom_type == "Polygon" else rings})

    def edge(a, b):
        return (a, b) if a < b else (b, a)

    inserts = {}
    original_vertices = {v for path in paths[:original_count] for v in path}
    changed_vertices = {v for path in paths[original_count:] for v in path}
    all_vertices = changed_vertices | original_vertices
    # Intersections computed on an original edge may differ from that edge by a few ULPs.
    # Only test new vertices on old edges, and existing vertices on new edges.
    for path_group, candidates in [(paths[:original_count], changed_vertices), (paths[original_count:], all_vertices)]:
        vertices = sorted(candidates)
        if not vertices:
            continue
        tree = shapely.STRtree(shapely.points(vertices))
        edges = sorted({edge(a, b) for path in path_group for a, b in zip(path, path[1:]) if a != b})
        tolerance = 8 * math.ulp(180.)
        lines = shapely.linestrings(edges)
        for i, j in zip(*tree.query(lines, predicate="dwithin", distance=tolerance)):
            a, b = edges[i]
            p = vertices[j]
            if p == a or p == b:
                continue
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
            if 0 < t < 1 and min(math.dist(a, p), math.dist(b, p)) > tolerance:
                inserts.setdefault((a, b), set()).add((t, p))
    # Very narrow rings can put two unrelated sides within numerical precision.
    # A junction belongs on at most one edge of a feature, and never twice in its ring.
    rejected = set()
    for row in rows:
        rings = [paths[i if i >= 0 else ~i] for i in _geometry_arc_refs(row)]
        existing = {p for ring in rings for p in ring}
        closest = {}
        for ring in rings:
            for a, b in zip(ring, ring[1:]):
                segment = edge(a, b)
                for t, p in inserts.get(segment, ()):
                    insertion = (segment, (t, p))
                    if p in existing:
                        rejected.add(insertion)
                        continue
                    distance = abs((p[0]-a[0])*(b[1]-a[1]) - (p[1]-a[1])*(b[0]-a[0])) / math.dist(a, b)
                    candidate = distance, insertion
                    if p in closest and closest[p] != candidate:
                        rejected.add(max(candidate, closest[p])[1])
                        candidate = min(candidate, closest[p])
                    closest[p] = candidate
    for segment, intersection in rejected:
        inserts[segment].discard(intersection)
    # Evaluate junctions on their baseline segment with a single rounding.
    # Double-rounded intersections can cross a nearly collinear return edge.
    junctions = {}
    junction_edges = defaultdict(set)
    for path in paths[:original_count]:
        for a, b in zip(path, path[1:]):
            for _, p in inserts.get(edge(a, b), ()):
                if p not in original_vertices:
                    i = int(abs(b[1]-a[1]) > abs(b[0]-a[0]))
                    j = 1-i
                    ratio = (Fraction(p[i])-Fraction(a[i])) / (Fraction(b[i])-Fraction(a[i]))
                    ordinate = Fraction(a[j]) + ratio * (Fraction(b[j])-Fraction(a[j]))
                    projected = list(p)
                    projected[j] = float(ordinate)
                    distance = abs(Fraction(p[j]) - ordinate)
                    junction_edges[p].add((distance, edge(a, b)))
                    if p not in junctions or distance < junctions[p][0]:
                        junctions[p] = (distance, tuple(projected))
    for p, edges in junction_edges.items():
        for distance, segment in edges:
            if distance > junctions[p][0]:
                inserts[segment] = {(t, q) for t, q in inserts[segment] if q != p}
    junctions = {p: v for p, (_, v) in junctions.items()}
    neighbors = defaultdict(set)
    ends = set()
    noded = []
    for path in paths:
        coords = [path[0]]
        for a, b in zip(path, path[1:]):
            extra = inserts.get(edge(a, b))
            if extra:
                coords.extend(p for _, p in sorted(extra, reverse=a > b))
            coords.append(b)
        coords = [junctions.get(p, p) for p in coords]
        for a, b in zip(coords, coords[1:]):
            neighbors[a].add(b)
            neighbors[b].add(a)
        ends.update((coords[0], coords[-1]))
        noded.append(coords)
    ends.update(p for p, other in neighbors.items() if len(other) != 2)
    arcs, lookup, mappings = [], {}, []
    for path in noded:
        refs = []
        start = 0
        for i in range(1, len(path)):
            if path[i] in ends:
                segment = tuple(path[start:i+1])
                key = min(segment, segment[::-1])
                if key not in lookup:
                    lookup[key] = len(arcs)
                    arcs.append(key)
                ref = lookup[key]
                refs.append(ref if segment == key else ~ref)
                start = i
        mappings.append(refs)

    def rewrite(refs):
        if refs and isinstance(refs[0], int):
            return [j for i in refs for j in (mappings[i] if i >= 0 else [~v for v in reversed(mappings[~i])])]
        return [rewrite(ring) for ring in refs]

    result = {"type": "Topology", "bbox": base["bbox"], "arcs": arcs,
              "objects": {"political": {"type": "GeometryCollection", "geometries": rows}}}
    for row in rows:
        row["arcs"] = rewrite(row["arcs"])
    _compact_arcs(result)
    polygons = [_decode_geometry(result, row) for row in rows]
    tree = shapely.STRtree(polygons)
    result["objects"]["political"]["computed_neighbors"] = [
        sorted(int(j) for j in tree.query(g, predicate="intersects") if j != i) for i, g in enumerate(polygons)]
    if "political_precision_feature_ids" in base:
        result["political_precision_feature_ids"] = [
            child for fid in base["political_precision_feature_ids"]
            for child in ([r[0] for r in replacements[fid]] if fid in replacements else [fid])]
    return result


def city_key(name):
    return "".join(c for c in unicodedata.normalize("NFKD", name.casefold()) if c.isalnum())


def resolve_capitals(factions, cities, shapes, owners, meridian):
    names = defaultdict(list)
    for city in cities["features"]:
        props = city["properties"]
        labels = [props.get(k) for k in ("name", "name_ascii", "name_en")]
        for key in {city_key(n) for n in [*labels, *props.get("aliases", [])] if n}:
            names[key].append(city)
    ids = list(shapes)
    index = shapely.STRtree(list(shapes.values()))
    hints, unresolved = {}, {}
    for faction in factions:
        tag, requested = faction["tag"], faction["capital_city"]
        found_name = False
        matches = []
        for name in [requested] if isinstance(requested, str) else requested:
            candidates = names.get(city_key(name), [])
            found_name = found_name or bool(candidates)
            for city in candidates:
                point = shape(city["geometry"])
                regional_point = regional_longitudes(point, meridian)
                props = city["properties"]
                for i in index.query(regional_point, predicate="covered_by"):
                    fid = ids[i]
                    if owners[fid] == tag:
                        matches.append((fid != props.get("host_feature_id"), -props.get("population", 0),
                                        shapes[fid].area, fid, props["city_id"], city))
            if matches:
                break
        else:
            unresolved[tag] = {"city": requested, "reason": "outside_owned_land" if found_name else "name_not_found"}
            continue
        _, _, _, fid, city_id, city = min(matches, key=lambda m: m[:-1])
        props = city["properties"]
        lon, lat = city["geometry"]["coordinates"]
        hints[tag] = {
            "tag": tag, "city_id": city_id, "stable_key": props["stable_key"], "city_name": name,
            "name_ascii": props["name_ascii"], "country_code": props["country_code"],
            "display_name": faction["name_en"], "host_feature_id": fid, "lon": lon, "lat": lat,
            "capital_kind": "country_capital", "resolution_method": "owned_city",
        }
    return hints, unresolved


def country_tables(bookmark, owners, featured, reference_countries):
    counts = Counter(owners.values())
    factions = bookmark["factions"]
    parents = {f["parent"] for f in factions if f["parent"]}
    countries = {}
    alliances = Counter()
    by_iso2 = {row["base_iso2"]: row for row in reference_countries.values()}
    rule_source = bookmark["scenario_id"] + ".ownership"
    faction_source = bookmark["scenario_id"] + ".factions"
    for f in factions:
        tag, parent = f["tag"], f["parent"]
        iso2 = f["base_iso2"]
        geography = by_iso2[iso2]
        kind = "scenario_container" if tag in parents and not counts[tag] else "scenario_subject" if parent else ""
        entry = {
            "tag": tag, "display_name": f["name_en"], "display_name_en": f["name_en"],
            "display_name_zh": f["name_zh"], "color_hex": f["color_hex"], "entry_kind": kind,
            "parent_owner_tag": parent, "parent_owner_tags": [parent] if parent else [],
            "subject_kind": "civil_war_faction" if parent else "", "alliance": f["alliance"],
            "ruling_ideology": f["ruling_ideology"], "feature_count": counts[tag],
            "controller_feature_count": counts[tag], "featured": tag in featured,
            "base_iso2": iso2, "lookup_iso2": iso2, "provenance_iso2": iso2,
            **{key: geography[key] for key in ("continent_id", "continent_label", "subregion_id", "subregion_label")},
            "capital_state_id": None, "releasable": False, "scenario_only": True, "synthetic_owner": False,
            "alliance_source": faction_source, "ruling_ideology_source": faction_source,
            "source": "manual_rule", "source_type": "scenario_extension", "source_types": ["scenario_extension"],
            "primary_rule_source": rule_source, "rule_sources": [rule_source, faction_source],
            "quality": "approx_existing_geometry", "historical_fidelity": "extended",
            "historical_fidelity_summary": ["extended"], "notes": "",
        }
        if f["parent_merged"]:
            entry["presentation"] = "parent_merged"
        countries[tag] = entry
        alliances[f["alliance"]] += 1
    unknown = counts.keys() - countries.keys()
    if unknown:
        raise ValueError(f"Owners missing from factions: {sorted(unknown)}")
    return countries, {key: {**a, "member_count": alliances[key]} for key, a in bookmark["alliances"].items()}


def check_neighbor_nodes(fid, previous, current):
    if current.equals_exact(previous, 0):
        return 0, 0.0
    tolerance = 8 * math.ulp(180.)
    inserted = 0
    for src, dst in zip(shapely.get_parts(previous), shapely.get_parts(current), strict=True):
        for old, new in zip([src.exterior, *src.interiors], [dst.exterior, *dst.interiors], strict=True):
            points = list(old.coords)
            index = 0
            for p in new.coords:
                if index < len(points) and p == points[index]:
                    index += 1
                elif (0 < index < len(points) and
                      shapely.LineString(points[index-1:index+1]).distance(shapely.Point(p)) <= tolerance):
                    inserted += 1
                else:
                    raise ValueError(f"Vertex outside original neighbor edge: {fid}")
            if index != len(points):
                raise ValueError(f"Missing original neighbor vertex: {fid}")
    delta = previous.symmetric_difference(current).area * 12400
    if delta >= 1e-6:
        raise ValueError(f"Neighbor area changed: {fid}, {delta} km²")
    return inserted, delta


def hierarchy_overrides(base, members, children):
    """Project the base scenario's merge/split overrides onto the regional leaves."""
    base = base or {}
    base_splits = base.get("feature_splits") or {}
    splits = {}
    for parent, kids in base_splits.items():
        leaves = [leaf for kid in kids for leaf in children.get(kid, [kid]) if leaf in members]
        if leaves:
            splits[parent] = leaves
    nested = {kid for kids in base_splits.values() for kid in kids}
    for parent, kids in children.items():
        leaves = [kid for kid in kids if kid in members]
        if parent not in nested and leaves:
            splits[parent] = leaves
    merges = {merged: list(parts) for merged, parts in (base.get("feature_merges") or {}).items()
              if merged in members or merged in children}
    return {"feature_merges": dict(sorted(merges.items())), "feature_splits": dict(sorted(splits.items()))}


def build(output, base, base_owners, units, membership, ownership, bookmark, cities, generated_at, world_sha,
          reference_countries, split_rules, adm2, base_hierarchy=None):
    owners, shapes, dropped = select_members(base, base_owners, units, membership, ownership)
    topology, bounds = crop_topology(base, owners, shapes)
    replacements, split_audit = split_features(topology, shapes, owners, units, adm2, split_rules, ownership)
    if replacements:
        old = topology
        topology = rebuild_split_topology(old, replacements)
        original = {_feature_id(row): row for row in old["objects"]["political"]["geometries"]}
        noded, output_shapes = {}, {}
        max_neighbor_delta = 0.0
        for row in topology["objects"]["political"]["geometries"]:
            fid = _feature_id(row)
            polygon = _decode_geometry(topology, row)
            if not polygon.is_valid or polygon.is_empty:
                raise ValueError(f"Invalid split topology geometry: {fid}")
            if fid in original and fid not in replacements:
                previous = _decode_geometry(old, original[fid])
                added, delta = check_neighbor_nodes(fid, previous, polygon)
                max_neighbor_delta = max(max_neighbor_delta, delta)
                if added:
                    noded[fid] = int(added)
            shapes[fid] = regional_longitudes(polygon, membership["central_meridian"])
            output_shapes[fid] = polygon
        split_audit["inserted_vertices_by_neighbor"] = noded
        split_audit["max_neighbor_symmetric_difference_upper_bound_km2"] = max_neighbor_delta
        residuals = split_audit["residual_km2_by_parent"]
        for fid, children in replacements.items():
            domain = _decode_geometry(old, original[fid])
            if fid in split_rules["subtract"]:
                domain = domain.difference(_decode_geometry(old, original[split_rules["subtract"][fid]]))
            union = shapely.union_all([output_shapes[cid] for cid, _, _ in children])
            residuals[fid] = domain.symmetric_difference(union).area * 12400
        too_large = {fid: area for fid, area in residuals.items() if area > 5}
        if len(too_large) > 20:
            raise ValueError(f"Split parent residuals above 5 km²: {too_large}")
    hints, unresolved = resolve_capitals(bookmark["factions"], cities, shapes, owners, membership["central_meridian"])
    featured = [tag for tag in bookmark["featured_tags"] if tag in hints]
    default = bookmark["default_country"]
    if default not in hints:
        default = featured[0]
    countries, alliances = country_tables(bookmark, owners, featured, reference_countries)
    scenario_id = bookmark["scenario_id"]
    header = {"version": 1, "scenario_id": scenario_id, "generated_at": generated_at}
    baseline = sha256_json_stable(owners)
    summary = {"feature_count": len(owners), "owner_count": len(set(owners.values())),
               "shell_feature_count": sum("_FB_" in fid for fid in owners)}
    prefix = f"data/scenarios/{scenario_id}/"
    manifest = {
        **header, "version": 2, "scenario_contract_profile": "lightweight_base",
        **{k: bookmark[k] for k in ("display_name", "bookmark_name", "bookmark_description")},
        "bookmark_date": ownership["as_of"], "default_country": default, "featured_tags": featured,
        "region": {"bounds": bounds, "central_meridian": membership["central_meridian"]},
        "opening_view": {"bounds": membership["opening_bounds"]}, "palette_id": "hoi4_vanilla",
        "performance_hints": {"render_profile_default": "balanced"}, "style_defaults": {"ocean": {"fillColor": "#3b4a55"}},
        "baseline_hash": baseline, "summary": summary,
        "source": {"base_scenario": membership["base_scenario"], "base_topology_sha256": world_sha,
                   "base_scenario_runtime_topology_sha256": membership["base_topology_sha256"]},
        "runtime_topology_url": prefix + "runtime_topology.topo.json", "countries_url": prefix + "countries.json",
        "owners_url": prefix + "owners.by_feature.json", "cores_url": prefix + "cores.by_feature.json",
        "city_overrides_url": prefix + "city_overrides.json", "capital_hints_url": prefix + "capital_hints.json",
        "audit_url": prefix + "audit.json",
        "special_zone_layers_url": prefix + "special_zone_layers.json",
        "hierarchy_overrides": hierarchy_overrides(base_hierarchy, set(owners), split_audit["children_by_parent"]),
    }
    output.mkdir(parents=True, exist_ok=True)
    write(output / "runtime_topology.topo.json", topology, compact=True)
    manifest["source"]["runtime_topology_sha256"] = sha256_path(output / "runtime_topology.topo.json")
    write(output / "special_zone_layers.json", {
        "version": 1, "layers": [], "activeLayerId": "", "topologyFingerprint": baseline, "diagnostics": [],
    })
    write(output / "owners.by_feature.json", {**header, "baseline_hash": baseline, "owners": owners})
    write(output / "cores.by_feature.json", {**header, "baseline_hash": baseline, "cores": {f: [t] for f, t in owners.items()}})
    write(output / "countries.json", {**header, "countries": countries, "alliances": alliances, "default_country": default})
    write(output / "city_overrides.json", {
        **header, "capitals_by_tag": {tag: h["city_id"] for tag, h in hints.items()}, "capital_city_hints": hints,
        "cities": {h["city_id"]: {"host_feature_id": h["host_feature_id"]} for h in hints.values()},
    })
    write(output / "capital_hints.json", {**header, "entries": list(hints.values()), "entry_count": len(hints),
                                         "missing_tags": sorted(unresolved), "missing_tag_count": len(unresolved)})
    write(output / "manifest.json", manifest)
    snapshot = _compose_snapshot_payload(output, manifest)
    write(output / "build_snapshot.json", snapshot)
    write(output / "audit.json", {**header, "summary": summary, "snapshot_fingerprint": snapshot["snapshot_fingerprint"],
                                  "dropped_shell_ids": dropped, "dropped_shell_count": len(dropped),
                                  "unresolved_capitals": unresolved, "geometry_splits": split_audit})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario-id", required=True)
    parser.add_argument("--generated-at")
    args = parser.parse_args()
    start = perf_counter()
    scenario_id = args.scenario_id
    family = scenario_id.rsplit("_", 1)[0]
    membership = read(RULES / f"{family}.membership.json")
    split_rules = read(RULES / f"{family}.geometry_splits.json")
    base = SCENARIOS / membership["base_scenario"]
    path = base / "runtime_topology.topo.json"
    if sha256_path(path) != membership["base_topology_sha256"]:
        raise ValueError(f"Base topology SHA-256 mismatch: {path}")
    build(SCENARIOS / scenario_id, read(path), read(base / "owners.by_feature.json")["owners"],
          read(RULES / membership["units"]), membership, read(RULES / f"{scenario_id}.ownership.json"),
          read(RULES / f"{scenario_id}.factions.json"), read(ROOT / "data/world_cities.geojson"),
          args.generated_at or membership["generated_at"], read(base / "manifest.json")["source"]["base_topology_sha256"],
          read(SCENARIOS / "modern_world/countries.json")["countries"], split_rules,
          read(RULES / split_rules["adm2_source"]), read(base / "manifest.json").get("hierarchy_overrides"))
    print(f"Built {scenario_id} in {perf_counter() - start:.2f} seconds")


if __name__ == "__main__":
    main()
