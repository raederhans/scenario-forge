"""Absorb adjacent same-owner shell fallback polygons after a scenario rebuild."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import ExitStack, redirect_stdout
from copy import deepcopy
import json
from pathlib import Path
import re
import shutil
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shapely import STRtree
from shapely.errors import GEOSException
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from map_builder.geo.topology import _extract_country_code_from_id
from map_builder.json_source import json_source_sha256, read_json_source, write_runtime_topology_source
from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _decode_geometry, _encode_exact_coverage, _geometries, _offset_arcs,
)
from tools.apply_political_feature_merges import SCENARIOS, feature_id, rewrite, write_compact
from tools.fill_political_coverage_gaps import (
    AREA_TOLERANCE, arc_refs, area_km2, boundary_length, decode_political, polygonal, polygons,
    rewrite_shared_arcs, ring_coordinates, shared_arc_lengths, validate_coverage, validate_shared_arcs,
)
from tools.materialize_polar_scenarios import refresh_scenario, synchronize_scenario_snapshot

DATA = ROOT / "data"
FRAGMENT = re.compile(r"_(?:ARCTIC|SHELL)_FB_\d+$")
EDGE_TOLERANCE = 0.001


def protected_ids(data):
    patterns = ("scenario-rules/*.json", "releasables/*.json", "country_feature_policies.json",
                "feature-migrations/*.json", "political_feature_merges/*.json", "quick_fill/*.json",
                "scenarios/*/special_zone_layers.json", "scenarios/*/geo_name_overrides.manual.json",
                "scenarios/*/releasable_catalog.manual.json",
                "scenarios/*/scenario_manual_overrides.json", "scenarios/*/scenario_mutations.json",
                "scenarios/*/manifest.json", "scenarios/*/derived/startup_support_whitelist.json",
                "hierarchy.json", "operational_presets/*.json")
    named = set()

    def collect(value):
        if isinstance(value, dict):
            for key, child in value.items():
                collect(key)
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)
        elif isinstance(value, str) and FRAGMENT.search(value):
            named.add(value.removeprefix("id::"))

    for pattern in patterns:
        for path in data.glob(pattern):
            collect(read_json_source(path))
    return named


def geographic_country(row):
    props = row.get("properties") or {}
    keys = ("cntr_code", "CNTR_CODE", "CNTR", "iso_a2", "ISO_A2", "iso_a2_eh", "ISO_A2_EH",
            "adm0_a2", "ADM0_A2", "country_code", "countryCode", "__city_country_code")

    def first_text(keys):
        return next((str(props[key]).strip() for key in keys
                     if props.get(key) is not None and str(props[key]).strip()), "")

    def normalize(text):
        code = re.sub("[^A-Z0-9]", "", text.upper())
        if code in {"XX", "ZZ"} or not (2 <= len(code) <= 3 and re.search("[A-Z]", code)):
            return ""
        return {"UK": "GB", "EL": "GR"}.get(code, code)

    return normalize(first_text(keys)) or normalize(
        _extract_country_code_from_id(first_text(("id", "NUTS_ID"))) or _extract_country_code_from_id(row.get("id")))


def district_rows(document):
    for tag, entry in document["tags"].items():
        for key, district in entry["districts"].items():
            yield (tag, key), district


def district_memberships(directory):
    path = directory / "district_groups.manual.json"
    memberships = defaultdict(set)
    if path.exists():
        for key, district in district_rows(read_json_source(path)):
            for member in district["feature_ids"]:
                memberships[member].add(key)
    return memberships


def edges(geometry):
    for part in polygons(geometry):
        part = orient(part)
        for ring in (part.exterior, *part.interiors):
            points = list(ring.coords)
            for a, b in zip(points, points[1:]):
                if a != b:
                    yield LineString([a, b])


def facing_strips(fragment, tree):
    for edge in edges(fragment):
        (x, y), (u, v) = edge.coords
        for j in tree.query(edge, predicate="dwithin", distance=EDGE_TOLERANCE):
            side = tree.geometries[j]
            (a, b), (c, d) = side.coords
            direction = (u - x) * (c - a) + (v - y) * (d - b)
            if direction > -0.99 * edge.length * side.length:
                continue
            clipped = edge.intersection(side.buffer(EDGE_TOLERANCE, cap_style="flat"))
            if clipped.geom_type != "LineString" or clipped.is_empty:
                continue
            ends = list(clipped.coords)
            projected = [side.interpolate(side.project(point)).coords[0] for point in clipped.boundary.geoms]
            if len(projected) != 2:
                continue
            strip = Polygon([ends[0], ends[-1], projected[1], projected[0]])
            if strip.is_valid and strip.area > 0 and strip.area <= clipped.length ** 2:
                yield strip


def assignments(geometries, owners, pending, fragments, districts):
    tree = STRtree(geometries)
    hosts = {i: i for i in range(len(geometries)) if i not in fragments}
    assigned = defaultdict(list)
    buffers = {}
    edge_trees = {}
    while pending:
        wave = {}
        for i in sorted(pending):
            geometry = geometries[i]
            lengths = defaultdict(float)
            contacts = defaultdict(list)
            if not owners[i] or geometry.is_empty:
                continue
            for j in tree.query(geometry, predicate="dwithin", distance=EDGE_TOLERANCE):
                j = int(j)
                if j not in hosts or owners[i] != owners[j]:
                    continue
                if districts[i] and not districts[i].issubset(districts[hosts[j]]):
                    continue
                neighbor = geometries[j]
                if j not in buffers:
                    buffers[j] = neighbor.boundary.buffer(EDGE_TOLERANCE)
                    edge_trees[j] = STRtree(list(edges(neighbor)))
                length = boundary_length(geometry.boundary.intersection(buffers[j]))
                if not length:
                    continue
                shared = geometry.boundary.intersection(neighbor.boundary)
                strips = list(facing_strips(geometry, edge_trees[j]))
                if shared.length or strips or geometry.overlaps(neighbor):
                    host = hosts[j]
                    lengths[host] += length
                    contacts[host].append((j, strips))
            if lengths:
                host = max(lengths, key=lambda j: (lengths[j], -j))
                wave[i] = host
                assigned[host].append((i, contacts[host]))
        if not wave:
            break
        hosts.update(wave)
        pending = pending.difference(wave)
    return assigned


def remap_arcs(value, replacements):
    if value and isinstance(value[0], int):
        result = []
        for ref in value:
            mapped = replacements.get(ref if ref >= 0 else ~ref)
            if mapped is None:
                result.append(ref)
            elif ref >= 0:
                result.extend(mapped)
            else:
                result.extend(~r for r in reversed(mapped))
        return result
    return [remap_arcs(child, replacements) for child in value]


def index_arcs(index, row, start=0):
    for ref in set(arc_refs(row["arcs"])):
        if ref >= start:
            index[ref].append(row)


def external_arcs(rows, group, arc_users):
    members = {id(rows[i]) for i in group}
    refs = sorted({ref for i in group for ref in arc_refs(rows[i]["arcs"])})
    shared = []
    neighbors = {}
    for ref in refs:
        users = [row for row in arc_users[ref] if id(row) not in members]
        if users:
            for row in users:
                _, lines = neighbors.setdefault(id(row), (row, []))
                lines.append([len(shared)])
            shared.append(ref)
    return shared, neighbors


def protected_seams(strips, arcs):
    if not arcs:
        return strips
    lines = [LineString(arc) for arc in arcs]
    tree = STRtree(lines)
    vertices = [set(map(tuple, arc)) for arc in arcs]
    allowed = []
    for strip in strips:
        for j in tree.query(strip, predicate="intersects"):
            contact = strip.intersection(lines[j])
            if contact.geom_type == "Point" and contact.coords[0] in vertices[j]:
                continue
            if contact.geom_type == "MultiPoint" and all(p.coords[0] in vertices[j] for p in contact.geoms):
                continue
            break
        else:
            allowed.append(strip)
    return allowed


def remove_collinear_nodes(geometry, extras):
    def ring_points(ring):
        points = list(ring.coords)[:-1]
        kept = []
        for i, point in enumerate(points):
            if point in extras:
                chord = LineString([points[i - 1], points[(i + 1) % len(points)]])
                if chord.covers(Point(point)):
                    continue
            kept.append(point)
        return kept

    parts = [Polygon(ring_points(p.exterior), [ring_points(r) for r in p.interiors]) for p in polygons(geometry)]
    return parts[0] if geometry.geom_type == "Polygon" else MultiPolygon(parts)


def encode_host(topology, host_id, geometry, shared, neighbors, political_rows):
    fixed = [topology["arcs"][r] for r in shared]
    offsets = [[i] for i in range(len(shared))]

    def encode(candidate):
        tracker = {"type": "MultiLineString", "arcs": offsets}
        rows = [{"type": "MultiLineString", "properties": {"id": host_id}, "arcs": offsets}]
        rows.extend({"type": "MultiLineString", "properties": {"id": feature_id(row)}, "arcs": refs}
                    for key, (row, refs) in neighbors.items() if key in political_rows)
        local = {"arcs": fixed, "objects": {"political": {"geometries": rows}, "source": tracker}}
        expected = shared_arc_lengths(local)
        rewrite_shared_arcs(local, _encode_exact_coverage([host_id], [candidate]), {0})
        return local, rows, tracker["arcs"], expected

    local, rows, mapped, expected = encode(geometry)
    extras = set()
    for old, refs in zip(fixed, mapped):
        coords = ring_coordinates(local, refs)
        if coords != old:
            extras.update(set(map(tuple, coords)) - set(map(tuple, old)))
    if extras:
        clean = remove_collinear_nodes(geometry, extras)
        if not clean.is_valid or not clean.equals(geometry):
            raise ValueError("external arc coordinates changed")
        local, rows, mapped, expected = encode(clean)
    if any(ring_coordinates(local, refs) != old for old, refs in zip(fixed, mapped)):
        raise ValueError("external arc coordinates changed")
    checked = validate_shared_arcs(expected, shared_arc_lengths(local), set(), {})
    result = rows[0]
    host_arcs = set(arc_refs(result["arcs"]))
    if not checked["passed"] or any(not host_arcs.issuperset(arc_refs(row["arcs"])) for row in rows[1:]):
        raise ValueError("shared boundary lost")
    actual = _decode_geometry(local, result)
    offset = len(topology["arcs"])
    replacements = {ref: _offset_arcs(chain, offset) for ref, chain in zip(shared, mapped)}
    return actual, local["arcs"], _offset_arcs(result["arcs"], offset), replacements


def merge_batch(topology, rows, geometries, host, entries, tags, tree, arc_users, political_rows):
    group = [host, *(i for i, _ in entries)]
    sources = [geometries[i] for i in group]
    original = unary_union(sources)
    shared, neighbors = external_arcs(rows, group, arc_users)
    strips = [strip for _, contacts in entries for _, patches in contacts for strip in patches]
    strips = protected_seams(strips, [topology["arcs"][r] for r in shared]) if strips else []
    merged = original
    if strips:
        seams = unary_union(strips)
        occupied = set(map(int, tree.query(seams, predicate="intersects"))) - set(group)
        seams = seams.difference(unary_union([geometries[j] for j in sorted(occupied)]))
        sources.extend(polygons(seams))
        merged = unary_union(sources)
    parts = list(polygons(merged))
    for i, contacts in entries:
        if not any(part.intersects(geometries[i]) and part.intersects(geometries[j])
                   for j, _ in contacts for part in parts):
            raise ValueError("gap remains between fragment and host")
    actual, arcs, host_refs, replacements = encode_host(
        topology, feature_id(rows[host]), merged, shared, neighbors, political_rows)
    adjacent = sorted(j for j in map(int, tree.query(actual, predicate="intersects"))
                      if j not in group and not geometries[j].is_empty)
    others = [geometries[j] for j in adjacent]
    baseline = {(0, k): original.intersection(g).area for k, g in enumerate(others, 1)}
    added = actual.difference(original)
    for j in adjacent:
        if tags[j] != tags[host] and added.intersection(geometries[j]).area > AREA_TOLERANCE:
            raise ValueError("Political overlap increased")
    validate_coverage([rows[i] for i in [host, *adjacent]], [sources, *([g] for g in others)],
                      [actual, *others], {0}, baseline)

    start = len(topology["arcs"])
    topology["arcs"].extend(arcs)
    for row, _ in neighbors.values():
        row["arcs"] = remap_arcs(row["arcs"], replacements)
        index_arcs(arc_users, row, start)
    rows[host].update(type=actual.geom_type, arcs=host_refs)
    index_arcs(arc_users, rows[host], start)
    geometries[host] = actual
    for i, _ in entries:
        geometries[i] = Polygon()
        rows[i]["arcs"] = []


def absorb_group(topology, rows, geometries, host, entries, tags, arc_users, political_rows, removed, failures):
    tree = STRtree(geometries)

    def attempt(batch):
        reachable = {host}
        ready = []
        for i, contacts in batch:
            valid = [(removed.get(j, j), patches) for j, patches in contacts if removed.get(j, j) in reachable]
            if valid:
                ready.append((i, valid))
                reachable.add(i)
            else:
                failures[i] = "rejected connecting fragment"
        if not ready:
            return
        try:
            merge_batch(topology, rows, geometries, host, ready, tags, tree, arc_users, political_rows)
        except (ValueError, GEOSException) as error:
            if len(ready) == 1:
                reason = str(error)
                if reason.endswith(": filled geometry is invalid"):
                    reason = "filled geometry is invalid"
                else:
                    reason = reason.partition(":")[0]
                failures[ready[0][0]] = "GEOS overlay error" if isinstance(error, GEOSException) else reason
            else:
                middle = len(ready) // 2
                attempt(ready[:middle])
                attempt(ready[middle:])
        else:
            removed.update((i, host) for i, _ in ready)

    attempt(entries)


def absorb_topology(topology, owners=None, named=(), max_fragment_km2=3000, *, memberships=None):
    absolute = _absolute_topology(topology) if "transform" in topology else topology
    political = absolute["objects"]["political"]
    features_before = len(political["geometries"])
    memberships = memberships or {}
    mapping = {}
    absorbed_area = 0.0
    while True:
        rows = political["geometries"]
        ids = [feature_id(row) for row in rows]
        fragments = {i for i, key in enumerate(ids) if FRAGMENT.search(key)}
        pending = {i for i in fragments if ids[i] not in named}
        kept = {"no_host": 0, "over_area": 0, "named": len(fragments) - len(pending), "validation": 0}
        removed = {}
        failures = {}
        if pending:
            geometries = [polygonal(decode_political(absolute, row)[0]) for row in rows]
            areas = {i: area_km2(geometries[i]) for i in pending}
            large = {i for i in pending if areas[i] > max_fragment_km2}
            kept["over_area"] = len(large)
            pending -= large
            tags = [geographic_country(row) if owners is None else owners.get(key)
                    for row, key in zip(rows, ids)]
            districts = [memberships.get(key, frozenset()) for key in ids]
            arc_users = defaultdict(list)
            for obj in absolute["objects"].values():
                for row in _geometries(obj):
                    if "arcs" in row:
                        index_arcs(arc_users, row)
            political_rows = {id(row) for row in rows}
            groups = assignments(geometries, tags, pending, fragments, districts)
            for host, entries in groups.items():
                absorb_group(absolute, rows, geometries, host, entries, tags, arc_users, political_rows,
                             removed, failures)
        if not removed:
            kept["validation"] = len(failures)
            kept["no_host"] = len(pending) - len(failures)
            break
        mapping.update((ids[i], ids[host]) for i, host in removed.items())
        absorbed_area += sum(areas[i] for i in removed)
        political["geometries"] = [row for i, row in enumerate(rows) if i not in removed]
        remaining = [g for i, g in enumerate(geometries) if i not in removed]
        _compact_arcs(absolute)
    if mapping:
        if "computed_neighbors" in political:
            left, right = STRtree(remaining).query(remaining, predicate="intersects")
            adjacent = [[] for _ in remaining]
            for i, j in zip(left, right):
                if i != j:
                    adjacent[i].append(int(j))
            political["computed_neighbors"] = [sorted(row) for row in adjacent]
        if "political_precision_feature_ids" in absolute:
            absolute["political_precision_feature_ids"] = list(dict.fromkeys(
                mapping.get(key, key) for key in absolute["political_precision_feature_ids"]))
        if absolute is not topology:
            topology.clear()
            topology.update(absolute)
    return mapping, {"fragments": len(fragments) + len(mapping), "absorbed": len(mapping),
                     "retained": len(fragments), "retained_by_reason": kept,
                     "validation_by_reason": dict(Counter(failures.values())), "absorbed_km2": round(absorbed_area, 6),
                     "hosts": len(set(mapping.values())), "features_before": features_before,
                     "features_after": len(political["geometries"])}


def project_anchors(value, mapping):
    if isinstance(value, list):
        return [project_anchors(item, mapping) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key in {"host_feature_id", "political_feature_id", "feature_id"} and isinstance(item, str):
                result[key] = mapping.get(item, item)
            else:
                result[key] = project_anchors(item, mapping)
        return result
    return value


def project_cities(payload, mapping, world):
    result = project_anchors(payload, mapping)
    cities = result["cities"]
    for feature in world:
        props = feature["properties"]
        city_id = props["id"]
        host = props.get("host_feature_id")
        if host in mapping and not cities.get(city_id, {}).get("host_feature_id"):
            city = cities.setdefault(city_id, {"stable_key": props["stable_key"], "city_id": city_id})
            city["host_feature_id"] = mapping[host]
    return result


def merge_population(document, mapping, version):
    features = document["features"].copy()
    groups = defaultdict(list)
    for member, host in mapping.items():
        groups[host].append(features.pop(member))
    for host, additions in groups.items():
        rows = [features[host], *additions]
        areas = [row["land_area_km2"] for row in rows if row["land_area_km2"] is not None]
        counts = [row["population"] for row in rows if row["population"] is not None]
        area = sum(areas) if areas else None
        population = sum(counts) if counts else None
        merged = dict(rows[0], population=population, land_area_km2=area)
        for field in ("coverage_fraction", "overlap_fraction", "raw_coverage_fraction"):
            if any(field in row for row in rows) and area:
                merged[field] = sum((row.get(field) or 0) * (row["land_area_km2"] or 0) for row in rows) / area
        if counts:
            merged["status"] = "ok" if merged["coverage_fraction"] == 1 else "partial_coverage"
        merged["density"] = population / area if merged["status"] == "ok" else None
        features[host] = merged
    return dict(document, features=features, feature_count=len(features), geometry_version=version)


def write_scenario(directory, topology, mapping, population_paths):
    data = directory.parent.parent
    written = write_runtime_topology_source(directory, topology)
    rewrite(directory / "manifest.json", lambda doc: dict(
        doc, runtime_topology_url=f"data/scenarios/{directory.name}/{written.name}"))
    world = read_json_source(data / "world_cities.geojson")["features"]
    for name in ("city_overrides.json", "city_assets.partial.json"):
        path = directory / name
        if path.exists():
            rewrite(path, lambda doc: project_cities(doc, mapping, world))
    for name in ("capital_hints.json", "capital_defaults.partial.json", "strategic_values.by_feature.json"):
        path = directory / name
        if path.exists():
            rewrite(path, lambda doc: project_anchors(doc, mapping))

    def prune_names(doc):
        return dict(doc, geo={key: value for key, value in doc["geo"].items()
                              if key.removeprefix("id::") not in mapping})

    for path in directory.glob("geo_locale_patch*.json"):
        rewrite(path, prune_names)
    district_path = directory / "district_groups.manual.json"
    if district_path.exists():
        def remove_members(doc):
            updated = deepcopy(doc)
            for _, district in district_rows(updated):
                district["feature_ids"] = [member for member in district["feature_ids"] if member not in mapping]
            return updated

        rewrite(district_path, remove_members)
    refresh_scenario(directory, {}, sorted(mapping))

    def prune_audit(value):
        if isinstance(value, dict):
            return {k: prune_audit(v) for k, v in value.items() if k not in mapping}
        if isinstance(value, list):
            return [prune_audit(v) for v in value
                    if not (isinstance(v, str) and v in mapping
                            or isinstance(v, dict) and v.get("feature_id") in mapping)]
        return mapping.get(value, value) if isinstance(value, str) else value

    changed = rewrite(directory / "audit.json", prune_audit)
    locales = directory / "locales.startup.json"
    if locales.exists():
        changed |= rewrite(locales, prune_names)
    aliases = directory / "geo_aliases.startup.json"
    if aliases.exists():
        changed |= rewrite(aliases, lambda doc: dict(doc, alias_to_stable_key={
            key: value for key, value in doc["alias_to_stable_key"].items()
            if key.removeprefix("id::") not in mapping and value.removeprefix("id::") not in mapping}))
    shell = directory / "startup.runtime_shell.topo.json"
    if shell.exists():
        bundle = read_json_source(directory / "startup.bundle.en.json")
        write_compact(shell, bundle["scenario"]["runtime_topology_bootstrap"])
    if changed:
        synchronize_scenario_snapshot(directory)

    for path in population_paths:
        version = json_source_sha256(written)
        rewrite(path, lambda doc: merge_population(doc, mapping, version))

        def update_layer(doc):
            scenarios = doc["scenarios"].copy()
            old = scenarios[directory.name]
            scenarios[directory.name] = dict(old, geometry_version=version,
                                            feature_count=old["feature_count"] - len(mapping),
                                            core_feature_count=old["core_feature_count"] - len(mapping))
            return dict(doc, scenarios=scenarios)

        rewrite(path.parent.parent / "manifest.json", update_layer)


def process_scenario(directory, named, max_fragment_km2, dry_run):
    topology = read_json_source(directory / "runtime_topology.topo.json")
    owners = None if directory.name == "blank_base" else read_json_source(directory / "owners.by_feature.json")["owners"]
    mapping, report = absorb_topology(topology, owners, named, max_fragment_km2,
                                      memberships=district_memberships(directory))
    if mapping and not dry_run:
        data = directory.parent.parent
        population = list(data.glob(f"thematic_layers/population/*/features/{directory.name}.json"))
        scratch = data.parent / ".runtime/tmp"
        scratch.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=scratch) as tmp, ExitStack() as rollback:
            backup = Path(tmp) / directory.name
            shutil.copytree(directory, backup)
            for index, path in enumerate([*population, *(p.parent.parent / "manifest.json" for p in population)]):
                saved = Path(tmp) / str(index)
                shutil.copy2(path, saved)
                rollback.callback(saved.replace, path)
            rollback.callback(backup.replace, directory)
            rollback.callback(directory.replace, Path(tmp) / "incomplete")
            with redirect_stdout(sys.stderr):
                write_scenario(directory, topology, mapping, population)
            rollback.pop_all()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", nargs="+", action="extend", choices=SCENARIOS)
    parser.add_argument("--max-fragment-km2", type=float, default=3000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    named = protected_ids(DATA)
    print(json.dumps({name: process_scenario(DATA / "scenarios" / name, named, args.max_fragment_km2, args.dry_run)
                      for name in dict.fromkeys(args.scenario or SCENARIOS)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
