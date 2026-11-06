#!/usr/bin/env python3
"""Build plausible urban patches for land exposed by TNO's Atlantropa dam.

The output is a deterministic supplement to the real-world urban layer. It is
only shown by the runtime for tno_1962 while Atlantropa land is visible:

  python tools/build_tno_atlantropa_urban.py

Real Natural Earth urban outlines from the Mediterranean are used as shape
templates (translated, rotated and modestly scaled), then clipped to the
newly exposed land of each host Atlantropa feature. Placement favours three
kinds of settlement: extensions of existing coastal cities across the old
shoreline, ports on the final shoreline and a few near-shore inland towns.
The interior of the large salt flats stays empty.

Identical inputs and seed produce byte-identical output; nothing time-based
is written.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import random
import sys

import numpy as np
import shapely
import shapely.affinity
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, unary_union

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.scenario_topology_decode import topology_object_to_geojson  # noqa: E402

DEFAULT_ATLANTROPA = ROOT / "data/scenarios/tno_1962/scenario_atlantropa.topo.json"
DEFAULT_OLD_LAND = ROOT / "data/europe_topology.json"
DEFAULT_URBAN = ROOT / "data/europe_urban.geojson"
DEFAULT_OUTPUT = ROOT / "data/scenarios/tno_1962/urban_overlays.geojson"
ATLANTROPA_OBJECT = "scenario_atlantropa"
DEFAULT_SEED = 1962
DEFAULT_COVERAGE = 0.02
ID_PREFIX = "UA_ATL_"
OWNER_METHOD = "atlantropa_synthetic"

# Templates come from real urban areas around the Mediterranean.
TEMPLATE_BBOX = (-6.0, 30.0, 37.0, 46.0)
# Local equal-area frame; all placement work happens in kilometres.
LAEA = "+proj=laea +lat_0=38 +lon_0=15 +datum=WGS84 +units=km +no_defs"

# Share of the coverage budget per settlement kind.
BUDGET_SHARES = (("extension", 0.5), ("port", 0.35), ("inland", 0.15))
OLD_COAST_REACH_KM = 8.0       # existing city must lie this close to new land
PORT_STEP_KM = (40.0, 95.0)     # spacing between port sites on the new shoreline
PORT_SITE_PROBABILITY = 0.45
INLAND_OLD_COAST_KM = 22.0      # inland towns stay within this of the old shore
INLAND_NEW_COAST_KM = 14.0      # ... or within this of the new shore
SPACING_KM = 1.5                # minimum gap between generated patches
EXISTING_GAP_KM = 0.3           # generated land never overlaps real urban areas
MIN_PART_KM2 = 1.5
MIN_PIECE_KM2 = 3.0
MIN_KEPT_SHARE = 0.55
EDGE_INSET_KM = 0.02            # keeps rounded coordinates inside the mask
COORD_PRECISION = 4


def load_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _project_fn(transformer):
    def project(coords):
        x, y = transformer.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])
    return project


def to_local(geometry, transformer):
    return valid_polygonal(shapely.transform(geometry, _project_fn(transformer)))


def valid_polygonal(geometry):
    if geometry.is_valid:
        return geometry
    return polygonal(shapely.make_valid(geometry))


def polygon_parts(geometry):
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return [part for item in geometry.geoms for part in polygon_parts(item)]
    return []


def polygonal(geometry, min_part_area=0.0):
    parts = [part for part in polygon_parts(geometry) if part.area >= min_part_area]
    if not parts:
        return Polygon()
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def quantile(values, q):
    ordered = sorted(values)
    if not ordered:
        return 0.0
    position = (len(ordered) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def load_inputs(atlantropa_path, old_land_path, urban_path):
    atl = topology_object_to_geojson(load_json(atlantropa_path), ATLANTROPA_OBJECT)["features"]
    layers = {"land": [], "shoal": [], "water": []}
    for feature in atl:
        props = feature.get("properties") or {}
        layer = props.get("atl_render_layer")
        if layer in layers:
            layers[layer].append((str(props.get("id") or ""), props, valid_polygonal(shape(feature["geometry"]))))
    for items in layers.values():
        items.sort(key=lambda item: item[0])
    if not layers["land"]:
        raise ValueError("Atlantropa topology has no land features")
    land_bounds = unary_union([geometry for _, _, geometry in layers["land"]]).bounds
    window = box(land_bounds[0] - 1, land_bounds[1] - 1, land_bounds[2] + 1, land_bounds[3] + 1)
    old_land_payload = load_json(old_land_path)
    old_land = topology_object_to_geojson(old_land_payload, "land")["features"]
    old_land_geometry = unary_union([
        valid_polygonal(shape(feature["geometry"])).intersection(window) for feature in old_land])
    urban = load_json(urban_path)["features"]
    return layers, old_land_geometry, urban, window


def build_templates(urban_features, transformer):
    minx, miny, maxx, maxy = TEMPLATE_BBOX
    pool = []
    for feature in urban_features:
        geometry = shape(feature["geometry"])
        if geometry.geom_type != "Polygon" or not geometry.is_valid:
            continue
        centroid = geometry.centroid
        if not (minx <= centroid.x <= maxx and miny <= centroid.y <= maxy):
            continue
        local = to_local(geometry, transformer)
        local = shapely.affinity.translate(local, -local.centroid.x, -local.centroid.y)
        props = feature.get("properties") or {}
        pool.append({
            "id": str(props.get("id") or ""),
            "geometry": local,
            "area": local.area,
            "scalerank": props.get("scalerank", 9),
            "min_zoom": props.get("min_zoom", 7.7),
        })
    pool.sort(key=lambda item: item["id"])
    areas = [item["area"] for item in pool]
    stats = {q: quantile(areas, q) for q in (0.1, 0.5, 0.75, 0.9)}
    common = [item for item in pool if stats[0.1] <= item["area"] <= stats[0.75]]
    large = [item for item in pool if stats[0.75] < item["area"] <= stats[0.9]]
    if not common or not large:
        raise ValueError("Not enough Mediterranean urban templates")
    return common, large, stats, len(pool)


def pick_template(rng, common, large, prefer_large=False):
    large_share = 0.35 if prefer_large else 0.12
    group = large if rng.random() < large_share else common
    return group[rng.randrange(len(group))]


def place_template(template, rng, center):
    geometry = shapely.affinity.rotate(template["geometry"], rng.uniform(0, 360), origin=(0, 0))
    scale = rng.uniform(0.85, 1.15)
    geometry = shapely.affinity.scale(geometry, scale, scale, origin=(0, 0))
    return shapely.affinity.translate(geometry, center.x, center.y)


class Placer:
    def __init__(self, hosts, allowed, existing_urban):
        self.hosts = hosts
        self.host_tree = STRtree([host["geometry"] for host in hosts])
        self.allowed = allowed
        self.allowed_by_host = {}
        self.existing_tree = STRtree(existing_urban) if existing_urban else None
        self.existing = existing_urban
        self.placed = []
        self.placed_tree = None
        self.placed_dirty = False
        self.features = []

    def host_allowed(self, index):
        cached = self.allowed_by_host.get(index)
        if cached is None:
            host = self.hosts[index]["geometry"]
            cached = polygonal(host.intersection(self.allowed))
            shapely.prepare(cached)
            self.allowed_by_host[index] = cached
        return cached

    def conflicts(self, geometry, check_existing=True):
        guard = geometry.buffer(SPACING_KM)
        if check_existing and self.existing_tree is not None:
            for index in self.existing_tree.query(guard, predicate="intersects"):
                return True
        if self.placed_dirty:
            self.placed_tree = STRtree(self.placed) if self.placed else None
            self.placed_dirty = False
        if self.placed_tree is not None:
            for _ in self.placed_tree.query(guard, predicate="intersects"):
                return True
        return False

    def try_place(self, patch, template, kind):
        # Extensions grow out of an existing city, so only they may touch one.
        if patch.is_empty or self.conflicts(patch, check_existing=kind != "extension"):
            return 0.0
        pieces = []
        for index in sorted(int(i) for i in self.host_tree.query(patch, predicate="intersects")):
            clipped = polygonal(patch.intersection(self.host_allowed(index)), MIN_PART_KM2)
            if clipped.is_empty or clipped.area < MIN_PIECE_KM2:
                continue
            pieces.append((index, clipped))
        kept = sum(piece.area for _, piece in pieces)
        if kept < MIN_KEPT_SHARE * patch.area:
            return 0.0
        for index, piece in pieces:
            inset = polygonal(piece.buffer(-EDGE_INSET_KM, join_style="mitre"), MIN_PART_KM2)
            if inset.is_empty or inset.area < MIN_PIECE_KM2:
                continue
            self.features.append({
                "host": self.hosts[index],
                "geometry": inset,
                "template": template,
                "kind": kind,
            })
        self.placed.append(patch)
        self.placed_dirty = True
        return kept


def line_parts(geometry):
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        return [part for item in geometry.geoms for part in line_parts(item)]
    return []


def build_overlays(atlantropa_path=DEFAULT_ATLANTROPA, old_land_path=DEFAULT_OLD_LAND,
                   urban_path=DEFAULT_URBAN, *, seed=DEFAULT_SEED, coverage=DEFAULT_COVERAGE):
    layers, old_land, urban_features, window = load_inputs(atlantropa_path, old_land_path, urban_path)
    forward = Transformer.from_crs("EPSG:4326", LAEA, always_xy=True)
    inverse = Transformer.from_crs(LAEA, "EPSG:4326", always_xy=True)
    rng = random.Random(seed)

    hosts = []
    for feature_id, props, geometry in layers["land"]:
        hosts.append({
            "id": feature_id,
            "code": str(props.get("cntr_code") or "ATL"),
            "geometry": to_local(geometry, forward),
        })
    atl_land = unary_union([host["geometry"] for host in hosts])
    old_local = to_local(old_land, forward)
    blocked = unary_union([to_local(geometry, forward) for _, _, geometry in layers["shoal"] + layers["water"]])
    new_land = polygonal(atl_land.difference(old_local))
    new_land_area = new_land.area

    near_urban = []
    window_local = to_local(window, forward)
    for feature in urban_features:
        geometry = shape(feature["geometry"])
        local = to_local(geometry, forward)
        if not local.intersects(window_local):
            continue
        near_urban.append((str(feature["properties"].get("id") or ""), local))
    near_urban.sort(key=lambda item: item[0])
    existing_geometries = [geometry for _, geometry in near_urban]
    existing_union = unary_union(existing_geometries) if existing_geometries else Polygon()

    allowed = polygonal(new_land.difference(blocked).difference(existing_union.buffer(EXISTING_GAP_KM)))
    shapely.prepare(allowed)
    common, large, template_stats, template_pool_size = build_templates(urban_features, forward)
    placer = Placer(hosts, allowed, existing_geometries)

    old_coast = old_local.boundary.intersection(new_land.buffer(0.5))
    new_coast = new_land.boundary.difference(old_local.buffer(0.5))
    interior = polygonal(allowed.buffer(-2.0))
    shapely.prepare(interior)
    target_total = coverage * new_land_area
    budgets = {kind: share * target_total for kind, share in BUDGET_SHARES}
    used = {kind: 0.0 for kind, _ in BUDGET_SHARES}

    def center_for(point):
        if interior.is_empty:
            return point
        return nearest_points(interior, point)[0]

    # 1) Existing cities on the old shoreline grow onto the exposed seabed.
    candidates = []
    for urban_id, geometry in near_urban:
        if geometry.distance(new_land) > OLD_COAST_REACH_KM:
            continue
        weight = min(6.0, 0.6 + geometry.area / 40.0)
        candidates.append((rng.random() ** (1.0 / weight), urban_id, geometry))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    for _, _, geometry in candidates:
        if used["extension"] >= budgets["extension"]:
            break
        template = pick_template(rng, common, large, prefer_large=geometry.area > 120)
        radius = math.sqrt(template["area"] / math.pi)
        anchor = nearest_points(new_land, geometry.centroid)[0]
        dx, dy = anchor.x - geometry.centroid.x, anchor.y - geometry.centroid.y
        length = math.hypot(dx, dy) or 1.0
        push = radius * 0.6 + 0.5
        target = Point(anchor.x + dx / length * push, anchor.y + dy / length * push)
        center = target if allowed.contains(target) else center_for(target)
        used["extension"] += placer.try_place(place_template(template, rng, center), template, "extension")

    # 2) Ports on the final shoreline.
    port_sites = []
    for line in sorted(line_parts(new_coast), key=lambda item: (-item.length, item.bounds)):
        if line.length < PORT_STEP_KM[0]:
            continue
        distance = rng.uniform(0, PORT_STEP_KM[1])
        while distance < line.length:
            port_sites.append((rng.random(), line.interpolate(distance)))
            distance += rng.uniform(*PORT_STEP_KM)
    port_sites.sort(key=lambda item: (item[0], item[1].x, item[1].y))
    for roll, point in port_sites:
        if used["port"] >= budgets["port"]:
            break
        if roll > PORT_SITE_PROBABILITY:
            continue
        template = pick_template(rng, common, large)
        used["port"] += placer.try_place(place_template(template, rng, center_for(point)), template, "port")

    # 3) A few inland towns close to either shoreline; far salt flats stay empty.
    near_shore = polygonal(interior.intersection(
        unary_union([old_coast.buffer(INLAND_OLD_COAST_KM), new_coast.buffer(INLAND_NEW_COAST_KM)])))
    shapely.prepare(near_shore)
    minx, miny, maxx, maxy = near_shore.bounds if not near_shore.is_empty else (0, 0, 0, 0)
    attempts = 0
    while used["inland"] < budgets["inland"] and attempts < 4000 and not near_shore.is_empty:
        attempts += 1
        point = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        if not near_shore.contains(point):
            continue
        template = pick_template(rng, common, large)
        used["inland"] += placer.try_place(place_template(template, rng, point), template, "inland")

    features = []
    for item in placer.features:
        lonlat = shapely.transform(item["geometry"], _project_fn(inverse))
        geometry = encode_geometry(lonlat)
        area = shape(geometry)
        features.append({
            "sort_key": (round(area.centroid.x, 4), round(area.centroid.y, 4), item["host"]["id"]),
            "host": item["host"],
            "template": item["template"],
            "geometry": geometry,
            "area_sqkm": round(item["geometry"].area, 3),
        })
    features.sort(key=lambda item: item["sort_key"])
    output = []
    for index, item in enumerate(features, start=1):
        identity = f"{ID_PREFIX}{index:04d}"
        output.append({"type": "Feature", "properties": {
            "scalerank": item["template"]["scalerank"],
            "featurecla": "Urban area",
            "area_sqkm": item["area_sqkm"],
            "min_zoom": item["template"]["min_zoom"],
            "id": identity,
            "country_owner_id": item["host"]["id"],
            "country_owner_code": item["host"]["code"],
            "country_owner_method": OWNER_METHOD,
        }, "geometry": item["geometry"]})
    areas = [feature["properties"]["area_sqkm"] for feature in output]
    report = {
        "seed": seed,
        "feature_count": len(output),
        "new_land_km2": round(new_land_area, 1),
        "urban_km2": round(sum(areas), 1),
        "coverage": round(sum(areas) / new_land_area, 5) if new_land_area else 0.0,
        "area_quantiles_km2": {f"p{int(q * 100)}": round(quantile(areas, q), 2) for q in (0.1, 0.5, 0.75, 0.9)},
        "template_pool": template_pool_size,
        "template_quantiles_km2": {f"p{int(q * 100)}": round(v, 2) for q, v in template_stats.items()},
        "placed_by_kind_km2": {kind: round(value, 1) for kind, value in used.items()},
    }
    return {"type": "FeatureCollection", "features": output}, report


def encode_geometry(geometry):
    parts = []
    for part in polygon_parts(geometry):
        oriented = orient(part, sign=-1.0)
        rings = mapping(oriented)["coordinates"]
        rounded = [[[round(x, COORD_PRECISION), round(y, COORD_PRECISION)] for x, y in ring] for ring in rings]
        candidate = Polygon(rounded[0], rounded[1:])
        if not candidate.is_valid or candidate.is_empty:
            fixed = polygonal(shapely.make_valid(candidate))
            for fixed_part in polygon_parts(fixed):
                fixed_rings = mapping(orient(fixed_part, sign=-1.0))["coordinates"]
                parts.append([[[round(x, COORD_PRECISION), round(y, COORD_PRECISION)] for x, y in ring]
                              for ring in fixed_rings])
            continue
        parts.append(rounded)
    if len(parts) == 1:
        return {"type": "Polygon", "coordinates": parts[0]}
    return {"type": "MultiPolygon", "coordinates": parts}


def serialize(collection):
    return json.dumps(collection, ensure_ascii=False, separators=(",", ":"))


def write_overlays(output_path=DEFAULT_OUTPUT, **kwargs):
    collection, report = build_overlays(**kwargs)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(serialize(collection), encoding="utf-8", newline="\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--atlantropa", type=Path, default=DEFAULT_ATLANTROPA)
    parser.add_argument("--old-land", type=Path, default=DEFAULT_OLD_LAND)
    parser.add_argument("--urban", type=Path, default=DEFAULT_URBAN)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--coverage", type=float, default=DEFAULT_COVERAGE)
    args = parser.parse_args()
    report = write_overlays(args.output, atlantropa_path=args.atlantropa, old_land_path=args.old_land,
                            urban_path=args.urban, seed=args.seed, coverage=args.coverage)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
