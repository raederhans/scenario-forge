"""Build a regional bookmark from whole political features and historical districts."""
import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import json
import math
from pathlib import Path
import sys
from time import perf_counter
import unicodedata

import shapely
from pyproj import Geod, Transformer
from shapely.affinity import translate
from shapely.geometry import MultiPoint, box, shape

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


def build(output, base, base_owners, units, membership, ownership, bookmark, cities, generated_at, world_sha,
          reference_countries):
    owners, shapes, dropped = select_members(base, base_owners, units, membership, ownership)
    topology, bounds = crop_topology(base, owners, shapes)
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
                                  "unresolved_capitals": unresolved})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario-id", required=True)
    parser.add_argument("--generated-at")
    args = parser.parse_args()
    start = perf_counter()
    scenario_id = args.scenario_id
    family = scenario_id.rsplit("_", 1)[0]
    membership = read(RULES / f"{family}.membership.json")
    base = SCENARIOS / membership["base_scenario"]
    path = base / "runtime_topology.topo.json"
    if sha256_path(path) != membership["base_topology_sha256"]:
        raise ValueError(f"Base topology SHA-256 mismatch: {path}")
    build(SCENARIOS / scenario_id, read(path), read(base / "owners.by_feature.json")["owners"],
          read(RULES / membership["units"]), membership, read(RULES / f"{scenario_id}.ownership.json"),
          read(RULES / f"{scenario_id}.factions.json"), read(ROOT / "data/world_cities.geojson"),
          args.generated_at or membership["generated_at"], read(base / "manifest.json")["source"]["base_topology_sha256"],
          read(SCENARIOS / "modern_world/countries.json")["countries"])
    print(f"Built {scenario_id} in {perf_counter() - start:.2f} seconds")


if __name__ == "__main__":
    main()
