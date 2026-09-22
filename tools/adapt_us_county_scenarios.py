"""Candidate county overlays: historical polygons remain the assignment authority.

This exports patches and lineage, not deployable scenario bundles. Modern counties
are a subdivision grid only; no historical membership or administrative names are
inferred. Every positive-area residual is retained, with no repair or snapping.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shapely
from shapely.geometry import mapping, shape, MultiPolygon
from shapely.ops import polygonize
from tools.stage_us_county_scenario import baseline_surface
from map_builder.regional_geometry import _absolute_topology, _decode_geometry

COUNTY = re.compile(r"^(US_CNTY_[0-9]{5})(?:__(.+))?$")
AREA_ROUNDOFF_LIMIT = 1e-12  # square degrees; never used to discard pieces
DISTANCE_ROUNDOFF_LIMIT = 1e-10  # degrees; rejects distant, arbitrarily thin losses
PILOT_PARENTS = {"US_CNTY_26163", "US_CNTY_36029"}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def polygonal(geometry):
    """Retain all polygon components, including arbitrarily small fragments."""
    if geometry.geom_type in {"Polygon", "MultiPolygon"}:
        return geometry
    parts = []
    for item in getattr(geometry, "geoms", []):
        child = polygonal(item)
        if not child.is_empty:
            parts.extend(child.geoms if child.geom_type == "MultiPolygon" else [child])
    return MultiPolygon(parts)


def valid_polygon(geometry):
    return (geometry is not None and not geometry.is_empty and geometry.is_valid
            and geometry.geom_type in {"Polygon", "MultiPolygon"})


def source_counties(source):
    result = {}
    for feature in source["features"]:
        fid = feature["properties"]["id"]
        if not COUNTY.fullmatch(fid) or COUNTY.fullmatch(fid).group(2) or fid in result:
            raise ValueError("Source requires unique exact county IDs")
        geometry = shape(feature["geometry"])
        if not valid_polygon(geometry):
            raise ValueError(f"Invalid source county {fid}")
        result[fid] = geometry
    if not result or not shapely.coverage_is_valid(list(result.values())):
        raise ValueError("Source county coverage is invalid or empty")
    return result


def check_domain_preservation(original, combined):
    exact = combined.equals(original)
    area = combined.symmetric_difference(original).area
    distance = combined.hausdorff_distance(original)
    if not (area <= AREA_ROUNDOFF_LIMIT and distance <= DISTANCE_ROUNDOFF_LIMIT):
        raise ValueError(f"Overlay does not preserve baseline within roundoff: area={area}, Hausdorff={distance}")
    return {"domain_exact_equal": exact, "symmetric_difference_area_degrees2": area,
            "hausdorff_distance_degrees": distance}


def resolve_boundary_point_face(face, counties, old_id):
    # A representative point can land on more than one boundary for a very thin
    # face. Check the entire face, not the largest overlap or a distance heuristic.
    positive = []
    for fid, county in counties.items():
        intersection = face.intersection(county)
        if intersection.area > 0:
            positive.append((fid, county.covers(face) or intersection.equals(face), intersection.area))
    evidence = {"face_area_degrees2": face.area,
                "positive_area_matches": [{"id": fid, "entire_face_covered": full, "area_degrees2": area}
                                          for fid, full, area in positive]}
    if not positive:
        evidence["decision"] = "retained_residual_no_positive_county_overlap"
        return None, evidence
    if len(positive) == 1 and positive[0][1]:
        evidence["decision"] = "unique_entire_face_coverage"
        return positive[0][0], evidence
    raise ValueError(f"Ambiguous county coverage face for {old_id}: positive-area evidence {positive}")


def partition_feature(properties, geometry, counties, assignments, *, unique_ids=True):
    """Partition one old domain; return pieces with unchanged assignment semantics."""
    old_id = properties["id"]
    if not valid_polygon(geometry):
        raise ValueError(f"Invalid baseline geometry {old_id}; repair is forbidden")
    # Node every boundary together once. Independent intersections/differences
    # can construct inconsistent near-coincident edges and false interior holes.
    # Every bounded face is retained by spatial membership, never by area cutoff.
    graph = shapely.union_all([geometry.boundary, *[county.boundary for county in counties.values()]])
    groups = defaultdict(list)
    boundary_point_fallbacks = []
    for face in polygonize(graph):
        point = face.representative_point()
        if not geometry.covers(point):
            continue
        matches = [fid for fid, county in counties.items() if county.covers(point)]
        if len(matches) > 1 or (len(matches) == 1 and not counties[matches[0]].contains(point)):
            chosen, evidence = resolve_boundary_point_face(face, counties, old_id)
            evidence["point_matches"] = matches
            boundary_point_fallbacks.append(evidence)
        else:
            chosen = matches[0] if matches else None
        groups[chosen].append(face)
    pieces = [(fid, shapely.union_all(groups[fid])) for fid in sorted(groups, key=lambda item: item or "~residual")]
    if any(not valid_polygon(part) for _, part in pieces):
        raise ValueError(f"Invalid polygonized piece for {old_id}")
    residual = next((part for fid, part in pieces if fid is None), MultiPolygon([]))
    combined = shapely.union_all([part for _, part in pieces])
    overlap = sum(part.area for _, part in pieces) - combined.area
    domain_check = check_domain_preservation(geometry, combined)
    max_pair_overlap = 0.0
    total_pair_overlap = 0.0
    for i, (_, left) in enumerate(pieces):
        for _, right in pieces[i + 1:]:
            area = left.intersection(right).area
            max_pair_overlap = max(max_pair_overlap, area)
            total_pair_overlap += area
    if total_pair_overlap > AREA_ROUNDOFF_LIMIT:
        raise ValueError(f"Overlay has positive-area overlap beyond roundoff for {old_id}: {total_pair_overlap}")
    output = []
    for county_id, part in pieces:
        piece_id = f"{old_id}__county_overlay_{county_id[8:] if county_id else 'residual'}"
        props = deepcopy(properties)
        props["id"] = piece_id if unique_ids else old_id
        output.append({"type": "Feature", "id": piece_id, "properties": props,
                       "geometry": mapping(part), "lineage": {
                           "old_feature_id": old_id, "modern_county_id": county_id,
                           "piece_id": piece_id, "kind": "county_intersection" if county_id else "retained_residual",
                           "assignments": {key: deepcopy(values[old_id]) for key, values in assignments.items() if old_id in values},
                       }})
    return output, {"id": old_id, "pieces": len(output), "partition_method": "joint_boundary_noding_polygonize",
                    "face_count": sum(len(faces) for faces in groups.values()), "all_pieces_valid": True,
                    "boundary_point_fallbacks": boundary_point_fallbacks, "residual_area_degrees2": residual.area,
                    "domain_preserved": True, **domain_check,
                    "internal_overlap_area_degrees2": total_pair_overlap,
                    "max_pair_overlap_area_degrees2": max_pair_overlap,
                    "area_sum_roundoff_degrees2": overlap}


def adapt(topology, counties, assignments, *, all_us=False):
    absolute = _absolute_topology(topology)
    rows = absolute["objects"]["political"]["geometries"]
    ids = [row.get("properties", {}).get("id") for row in rows]
    if len(ids) != len(set(ids)) or None in ids:
        raise ValueError("Baseline IDs must be present and unique")
    source_ids = list(counties)
    source_shapes = list(counties.values())
    tree = shapely.STRtree(source_shapes)
    inventory, output, checks, baseline_children = [], [], [], {}
    for row in rows:
        props = row.get("properties", {})
        fid = props["id"]
        match = COUNTY.fullmatch(fid)
        if props.get("cntr_code") not in {"US", "USA"} and not fid.startswith(("US_CNTY_", "US_ZN_")):
            continue
        kind = "split_county" if match and match.group(2) else "exact_county" if match else "spatial_overlay_only_no_member_lineage"
        entry = {"id": fid, "classification": kind}
        if match:
            entry["modern_parent_id"] = match.group(1)
            entry["modern_parent_available"] = match.group(1) in counties
        inventory.append(entry)
        try:
            geometry, zero_extent_parts = baseline_surface(absolute, row)
            entry["ignored_zero_extent_parts"] = zero_extent_parts
            if not valid_polygon(geometry):
                raise ValueError("invalid or empty baseline polygon")
            entry["baseline_valid"] = True
            nearby = {source_ids[i]: source_shapes[i] for i in tree.query(geometry, predicate="intersects")}
            entry["intersecting_modern_counties"] = sorted(k for k, v in nearby.items() if geometry.intersection(v).area > 0)
            if match and match.group(1) in PILOT_PARENTS:
                baseline_children.setdefault(match.group(1), []).append((fid, geometry))
            selected = all_us or (match and match.group(1) in PILOT_PARENTS and match.group(2))
            if not selected:
                entry["status"] = "inventoried"
                continue
            chosen = nearby if all_us else {match.group(1): counties[match.group(1)]} if match.group(1) in counties else {}
            features, check = partition_feature(props, geometry, chosen, assignments, unique_ids=all_us)
            check["ignored_zero_extent_parts"] = zero_extent_parts
            output.extend(features)
            checks.append(check)
            entry["status"] = "candidate_partitioned"
        except (ValueError, KeyError, TypeError, IndexError, shapely.errors.GEOSException) as exc:
            entry.update(status="unresolved", reason=str(exc))
    generated_ids = [f["properties"]["id"] for f in output]
    if all_us and (len(generated_ids) != len(set(generated_ids)) or set(generated_ids) & set(ids)):
        raise ValueError("Generated overlay IDs collide")
    pilots = []
    for parent in sorted(PILOT_PARENTS):
        children = baseline_children.get(parent, [])
        union = shapely.union_all([g for _, g in children])
        county = counties.get(parent)
        pilots.append({"modern_parent_id": parent, "baseline_child_ids": [fid for fid, _ in children],
                       "status": "inspected" if len(children) >= 2 and county is not None else "missing_children_or_parent",
                       "children_overlap_area_degrees2": sum(a.intersection(b).area for i, (_, a) in enumerate(children) for _, b in children[i + 1:]),
                       "historical_union_equals_modern_parent": union.equals(county) if county is not None else None,
                       "historical_outside_modern_parent_area_degrees2": union.difference(county).area if county is not None else None,
                       "modern_parent_outside_historical_union_area_degrees2": county.difference(union).area if county is not None else None})
    sidecars = {key: {} for key in assignments}
    for feature in output:
        for key, value in feature["lineage"]["assignments"].items():
            sidecars[key][feature["properties"]["id"]] = value
    return {"type": "FeatureCollection", "features": output}, sidecars, {
        "roundoff_limits": {"symmetric_difference_area_degrees2": AREA_ROUNDOFF_LIMIT,
                            "hausdorff_distance_degrees": DISTANCE_ROUNDOFF_LIMIT,
                            "total_pairwise_overlap_area_degrees2": AREA_ROUNDOFF_LIMIT,
                            "policy": "Validation only; no geometry repair, dropping, snapping or rounding"},
        "candidate_only": True, "release_ready": False, "historical_county_authority": False,
        "mode": "unique_id_all_us_patch" if all_us else "same_old_id_pilot_fragments_not_runtime_features",
        "inventory": inventory, "status_counts": dict(Counter(e.get("status") for e in inventory)),
        "classification_counts": dict(Counter(e["classification"] for e in inventory)),
        "partition_checks": checks, "pilot_parent_checks": pilots,
        "unresolved_ids_retained_in_baseline": [e["id"] for e in inventory if e.get("status") == "unresolved"],
        "replaced_old_ids": [item["id"] for item in checks],
        "patch_contract": "Replace only replaced_old_ids; retain all other baseline features and sidecars. Candidate sidecars contain explicit assignments only. Hierarchy, hosts, chunks and other references require bundle integration.",
    }


def run(source_path, output_dir, *, root=ROOT, all_us=False, scenario_ids=None):
    source_path, output_dir, root = Path(source_path), Path(output_dir), Path(root)
    runtime_root = (root / ".runtime").resolve()
    output_dir = output_dir.resolve()
    if not output_dir.is_relative_to(runtime_root) or output_dir == runtime_root:
        raise ValueError("Candidate output must be inside root/.runtime")
    if output_dir.exists():
        raise ValueError("Output directory must not exist")
    source_bytes = source_path.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    source_report = read(source_path.with_name("source-report.json"))
    if source_report.get("display_geojson_sha256") != source_hash:
        raise ValueError("County source report does not bind these source bytes")
    counties = source_counties(json.loads(source_bytes))
    index = read(root / "data/scenarios/index.json")
    entries = index["scenarios"]
    if scenario_ids and set(scenario_ids) - {e["scenario_id"] for e in entries}:
        raise ValueError("Unknown requested scenario")
    output_dir.mkdir(parents=True)
    summary = []
    for entry in entries:
        sid = entry["scenario_id"]
        if scenario_ids and sid not in scenario_ids:
            continue
        manifest_path = root / entry["manifest_url"]
        manifest = read(manifest_path)
        assignments, presence = {}, {}
        for key in ("owners", "cores", "controllers"):
            url = manifest.get(f"{key}_url")
            path = root / url if url else manifest_path.parent / f"{key}.by_feature.json"
            presence[key] = path.exists()
            payload = read(path) if path.exists() else {}
            assignments[key] = payload.get(key, payload)
        topology_path = root / manifest["runtime_topology_url"]
        topology_bytes = topology_path.read_bytes()
        collection, sidecars, report = adapt(json.loads(topology_bytes), counties, assignments, all_us=all_us)
        report.update(scenario_id=sid, source_sha256=source_hash,
                      baseline_sha256=hashlib.sha256(topology_bytes).hexdigest(), assignment_sidecar_present=presence)
        destination = output_dir / sid
        destination.mkdir()
        for name, payload in [("county_overlay.geojson", collection), ("adaptation.report.json", report),
                              *[(f"{key}.by_feature.json", {key: values}) for key, values in sidecars.items()]]:
            (destination / name).write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        summary.append({"scenario_id": sid, "features": len(collection["features"]),
                        "status_counts": report["status_counts"], "classification_counts": report["classification_counts"]})
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--county-source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--all-us", action="store_true")
    parser.add_argument("--scenario", action="append", dest="scenario_ids")
    args = parser.parse_args()
    print(json.dumps(run(args.county_source, args.output_dir, all_us=args.all_us, scenario_ids=args.scenario_ids), indent=2))


if __name__ == "__main__":
    main()
