from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import shapely
from pyproj import Geod
from shapely.geometry import LineString, shape
from shapely.geometry.polygon import orient

from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _decode_geometry, _encode_exact_coverage,
    _geometries, _offset_arcs, _update_bbox,
)
from tools.rebuild_polar_assets import read, write, refresh_neighbors
from tools.materialize_polar_scenarios import refresh_scenario
from tools.check_scenario_contracts import write_json


def area_km2(geometry):
    polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
    geod = Geod(ellps="WGS84")
    return sum(abs(geod.geometry_area_perimeter(orient(p, sign=1))[0]) for p in polygons) / 1e6


def arc_ids(value):
    if isinstance(value, list):
        for item in value:
            yield from arc_ids(item)
    else:
        yield value if value >= 0 else ~value


def share_cut_arcs(topology, cuts):
    for index, boundaries in cuts.items():
        boundary = shapely.union_all(boundaries)
        arc = topology["arcs"][index]
        noded = [arc[0]]
        for a, b in zip(arc, arc[1:]):
            segment = LineString([a, b])
            points = {tuple(p) for p in shapely.get_coordinates(segment.intersection(boundary))}
            points -= {tuple(a), tuple(b)}
            noded.extend([list(p) for p in sorted(points, key=lambda p: (p[0]-a[0])**2 + (p[1]-a[1])**2)])
            noded.append(b)
        topology["arcs"][index] = noded
    junctions = {tuple(p) for arc in topology["arcs"] for p in (arc[0], arc[-1])}
    arcs, registry, remap = [], {}, {}
    for index, arc in enumerate(topology["arcs"]):
        indices, start = [], 0
        for end in range(1, len(arc)):
            if tuple(arc[end]) not in junctions and end != len(arc)-1:
                continue
            forward = tuple(map(tuple, arc[start:end+1]))
            canonical = min(forward, forward[::-1])
            if canonical not in registry:
                registry[canonical] = len(arcs)
                arcs.append([list(p) for p in canonical])
            number = registry[canonical]
            indices.append(number if canonical == forward else ~number)
            start = end
        remap[index] = indices

    def rewrite(value):
        if not value or isinstance(value[0], list):
            return [rewrite(v) for v in value]
        return [new for old in value for new in
                (remap[old] if old >= 0 else [~i for i in reversed(remap[~old])])]

    for obj in topology["objects"].values():
        for row in _geometries(obj):
            if "arcs" in row:
                row["arcs"] = rewrite(row["arcs"])
    topology["arcs"] = arcs
    _compact_arcs(topology)


def split_topology(topology, rules):
    result = _absolute_topology(topology)
    rows = result["objects"]["political"]["geometries"]
    by_id = {row["properties"]["id"]: row for row in rows}
    splits, additions, geometries, measurements = {}, [], {}, []
    cuts = defaultdict(list)
    tolerance = rules["area_tolerance_degrees2"]
    for entry in rules["entries"]:
        polygon = shape(entry["polygon"])
        if not polygon.is_valid:
            raise ValueError(f"Invalid cut polygon: {entry['id']}")
        for parent in entry["feature_ids"]:
            children = [parent + "__SPLIT_" + entry[side]["suffix"] for side in ("inside", "outside")]
            if parent not in by_id:
                if all(child in by_id for child in children):
                    continue
                raise ValueError(f"Missing split parent or children: {parent}")
            row = by_id[parent]
            original = _decode_geometry(result, row)
            parts = [original.intersection(polygon), original.difference(polygon)]
            if any(p.is_empty or not p.is_valid or p.geom_type not in {"Polygon", "MultiPolygon"} for p in parts):
                raise ValueError(f"Split must produce two valid polygonal parts: {parent}")
            drift = original.symmetric_difference(shapely.union_all(parts)).area
            overlap = parts[0].intersection(parts[1]).area
            if drift > tolerance or overlap > tolerance or abs(sum(p.area for p in parts)-original.area) > tolerance:
                raise ValueError(f"Split coverage mismatch: {parent}")
            splits[parent] = children
            for index in arc_ids(row["arcs"]):
                cuts[index].append(polygon.boundary)
            for child, part, side in zip(children, parts, ("inside", "outside")):
                props = deepcopy(row["properties"])
                original_name = props.get("name_en") or props.get("name") or parent
                props["aliases"] = list(dict.fromkeys([*props.get("aliases", []), original_name]))
                props.update(id=child, name=original_name + " · " + entry[side]["name_en"],
                             name_en=original_name + " · " + entry[side]["name_en"],
                             name_zh=(props.get("name_zh") or original_name) + " · " + entry[side]["name_zh"])
                additions.append({"type": part.geom_type, "properties": props})
                geometries[child] = part
                measurements.append(dict(parent_id=parent, child_id=child, area_km2=area_km2(part),
                                         area_degrees2=part.area, conservation_error_degrees2=drift,
                                         overlap_degrees2=overlap, sources=entry["sources"]))
    if not splits:
        return topology, {}, []
    encoded = _encode_exact_coverage(list(geometries), list(geometries.values()))
    offset = len(result["arcs"])
    result["arcs"].extend(encoded["arcs"])
    for row, encoded_row in zip(additions, encoded["objects"]["political"]["geometries"]):
        row["arcs"] = _offset_arcs(encoded_row["arcs"], offset)
    rows[:] = [row for row in rows if row["properties"]["id"] not in splits] + additions
    share_cut_arcs(result, cuts)
    _update_bbox(result)
    for row in additions:
        fid = row["properties"]["id"]
        actual = _decode_geometry(result, row)
        if not actual.is_valid or actual.symmetric_difference(geometries[fid]).area > tolerance:
            raise ValueError(f"Encoded split changed geometry: {fid}")
    refresh_neighbors(topology, result, set(geometries))
    return result, splits, measurements


def run_scenario(scenario_dir, rules):
    topology_path = scenario_dir / "runtime_topology.topo.json"
    before = read(topology_path)
    after, splits, measurements = split_topology(before, rules)
    if not splits:
        return {"changed": 0, "measurements": []}
    owners = read(scenario_dir / "owners.by_feature.json")["owners"]
    cores = read(scenario_dir / "cores.by_feature.json")["cores"]
    controller_path = scenario_dir / "controllers.by_feature.json"
    controllers = read(controller_path)["controllers"] if controller_path.exists() else owners
    assignments = {child: dict(parent_id=parent, owner=owners[parent], controller=controllers[parent], cores=cores[parent])
                   for parent, children in splits.items() for child in children}
    manifest = read(scenario_dir / "manifest.json")
    manifest.setdefault("hierarchy_overrides", {}).setdefault("feature_splits", {}).update(splits)
    patch = read(scenario_dir / "geo_locale_patch.json")
    shared_names = read(ROOT / "data/locales.json")["geo"]
    for row in after["objects"]["political"]["geometries"]:
        props = row["properties"]
        if props["id"] in assignments:
            parent = assignments[props["id"]]["parent_id"]
            source_names = patch["geo"].get("id::"+parent) or patch["geo"].get(parent) or shared_names.get("id::"+parent, {})
            for lang in ("en", "zh"):
                suffix = props["name_"+lang].rsplit(" · ", 1)[-1]
                props["name_"+lang] = source_names.get(lang, props["name_"+lang].rsplit(" · ", 1)[0]) + " · " + suffix
            props["name"] = props["name_en"]
            props["aliases"] = list(dict.fromkeys([*props.get("aliases", []), *source_names.values()]))
            patch["geo"]["id::"+props["id"]] = {"en": props["name_en"], "zh": props["name_zh"]}
    write_json(scenario_dir / "manifest.json", manifest)
    write_json(scenario_dir / "geo_locale_patch.json", patch)
    write(topology_path, after)
    refresh_scenario(scenario_dir, assignments, removed_ids=list(splits))
    return {"changed": len(splits), "measurements": measurements}


def main():
    rules = read(ROOT / "data/scenario-rules/hoi4_geometry_splits.json")
    write_json(ROOT / "data/feature-migrations/hoi4_feature_splits.v1.json", {
        "version": 1, "scenarios": rules["scenarios"],
        "feature_splits": {parent: [parent+"__SPLIT_"+entry[side]["suffix"] for side in ("inside", "outside")]
                           for entry in rules["entries"] for parent in entry["feature_ids"]},
        "semantics": "Copy parent paint and list membership to all children; explicit child paint wins. Runtime authority: scenario manifest hierarchy_overrides.feature_splits.",
    })
    for scenario in rules["scenarios"]:
        report = run_scenario(ROOT / "data/scenarios" / scenario, rules)
        if report["changed"]:
            write_json(ROOT / ".runtime/reports/generated" / f"{scenario}.geometry-splits.json", report)
        print(json.dumps({"scenario": scenario, **report}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
