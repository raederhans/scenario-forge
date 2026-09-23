"""Prepare a same-ID, joint-source TNO precision candidate outside production data."""
from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import box

from map_builder.geo.regional_boundary_alignment import align_regional_boundaries
from map_builder.geo.scenario_surface_constraints import constrain_candidate_surface_geometry
from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from tools.pilot_tno_russia_precision import constrained_partition, node_owner_interfaces


def _metadata(item):
    result = {key: value for key, value in item.items()
              if key not in {"arcs", "coordinates", "geometries"}}
    if "geometries" in item:
        result["geometries"] = [_metadata(child) for child in item["geometries"]]
    return result


def _stored_edges(topology):
    political = topology["objects"]["political"]
    ids = [str(item["properties"]["id"]) for item in political["geometries"]]
    graph = political.get("computed_neighbors")
    if not isinstance(graph, list) or len(graph) != len(ids):
        raise ValueError("Baseline requires a complete computed_neighbors table.")
    result = set()
    for index, neighbors in enumerate(graph):
        for neighbor in neighbors:
            if not isinstance(neighbor, int) or not 0 <= neighbor < len(ids):
                raise ValueError("Neighbour table contains an invalid index.")
            if neighbor != index:
                result.add(tuple(sorted((ids[index], ids[neighbor]))))
    return result


def _assemble_candidate(baseline, replacements, source_countries, *, boundary_tolerance=0.0,
                        retained_enclave_countries=(), target_feature_ids=None,
                        frozen_domain_owners=None):
    countries = {str(code).strip().upper() for code in source_countries}
    if not countries or any(len(code) != 2 or not code.isascii() or not code.isalpha() for code in countries):
        raise ValueError("Source countries must be explicit ISO2 source codes.")
    absolute = _absolute_topology(baseline)
    rows = absolute["objects"]["political"]["geometries"]
    by_id = {str(item["properties"]["id"]): item for item in rows}
    if len(by_id) != len(rows):
        raise ValueError("Baseline political IDs must be unique.")
    if target_feature_ids is None:
        current = {fid: item for fid, item in by_id.items()
                   if str(item["properties"].get("cntr_code", "")).strip().upper() in countries}
        selected_countries = {str(item["properties"]["cntr_code"]).strip().upper() for item in current.values()}
        if selected_countries != countries:
            raise ValueError("Every selected source country must exist in the baseline.")
    else:
        target_feature_ids = [str(fid) for fid in target_feature_ids]
        if (not target_feature_ids or len(set(target_feature_ids)) != len(target_feature_ids)
                or set(target_feature_ids) - set(by_id)):
            raise ValueError("Explicit target_feature_ids must be unique existing baseline IDs.")
        current = {fid: by_id[fid] for fid in target_feature_ids}
    if replacements.empty or not {"id", "cntr_code"}.issubset(replacements.columns):
        raise ValueError("Replacement must contain nonempty id, cntr_code and geometry columns.")
    if replacements.crs is None or replacements.crs.to_epsg() != 4326:
        raise ValueError("Replacement geometry must use EPSG:4326.")
    ids = replacements["id"]
    if ids.isna().any() or any(not str(value) or str(value) != str(value).strip() for value in ids):
        raise ValueError("Replacement IDs must be nonempty and unpadded.")
    ids = ids.astype(str)
    if not ids.is_unique or set(ids) != set(current):
        raise ValueError("Replacement IDs must uniquely match ALL existing selected-country IDs; additions and omissions require explicit migration.")
    source_by_id = dict(zip(ids, replacements.geometry))
    for fid, code in zip(ids, replacements["cntr_code"]):
        expected = str(current[fid]["properties"]["cntr_code"]).strip().upper()
        if str(code).strip().upper() != expected:
            raise ValueError(f"Source country changed for {fid}.")
    source_geometry = list(source_by_id.values())
    if any(g is None or g.is_empty or not g.is_valid or g.geom_type not in {"Polygon", "MultiPolygon"} for g in source_geometry):
        raise ValueError("Replacement requires valid nonempty polygon geometry.")
    if not shapely.coverage_is_valid(source_geometry):
        raise ValueError("Replacement countries must form one valid joint coverage.")
    # Keep scenario metadata, ordering and source-country membership authoritative.
    old = gpd.GeoDataFrame([dict(item["properties"], geometry=_decode_geometry(absolute, item))
                           for item in current.values()], crs="EPSG:4326")
    selected = old.copy()
    selected["geometry"] = [source_by_id[fid] for fid in old["id"].astype(str)]
    if frozen_domain_owners is not None:
        if retained_enclave_countries or boundary_tolerance:
            raise ValueError("Frozen owner domains cannot combine with enclave or boundary-tolerance options")
        owners = {fid: frozen_domain_owners.get(fid) for fid in current}
        if any(not owner for owner in owners.values()):
            raise ValueError("Every frozen target requires an owner")
        baseline_by_id = dict(zip(old["id"].astype(str), old.geometry))
        domains = {}
        for fid, owner in owners.items():
            domains.setdefault(owner, []).append(fid)
        frozen = {}
        diagnostics = {}
        for owner, ids in sorted(domains.items()):
            pieces, diagnostic = constrained_partition(
                {fid: baseline_by_id[fid] for fid in ids}, source_by_id,
                {fid: fid for fid in ids})
            if diagnostic.get("baseline_overlap_resolutions"):
                raise ValueError(f"Frozen owner {owner} would resolve inherited overlap by nearest source")
            frozen.update(pieces)
            diagnostics[owner] = diagnostic
        frozen = node_owner_interfaces(frozen)
        selected["geometry"] = [frozen[fid] for fid in old["id"].astype(str)]
        if not shapely.coverage_is_valid(selected.geometry.values):
            raise ValueError("Frozen target coverage is invalid")
        if shapely.union_all(old.geometry.values).symmetric_difference(
                shapely.union_all(selected.geometry.values)).area > 1e-10:
            raise ValueError("Frozen target surface changed")
        alignment = {"method": "frozen_owner_domains", "owner_domains": diagnostics}
        constraints = {"target_union_preserved": True}
    else:
        enclave_codes = set(retained_enclave_countries)
        if enclave_codes & countries:
            raise ValueError("Reviewed enclaves must be non-target source countries")
        anchors = [item for item in rows if item["properties"].get("cntr_code") in enclave_codes]
        if {item["properties"].get("cntr_code") for item in anchors} != enclave_codes:
            raise ValueError("Every reviewed enclave must exist in the baseline")
        selected, alignment = align_regional_boundaries(
            old, selected, retained_hole_anchors=[_decode_geometry(absolute, item) for item in anchors])
        alignment["retained_enclave_countries"] = sorted(enclave_codes)
        extent = box(*selected.total_bounds)
        protected = []
        for name in ("political", "scenario_water", "scenario_atlantropa"):
            obj = absolute["objects"].get(name)
            if obj is None:
                raise ValueError(f"Published TNO protection object missing: {name}.")
            for item in obj.get("geometries", [obj]):
                if name == "political" and str(item.get("properties", {}).get("id")) in current:
                    continue
                geometry = _decode_geometry(absolute, item)
                if geometry is not None and geometry.intersects(extent):
                    protected.append(geometry)
        land_obj = absolute["objects"].get("land_mask")
        if land_obj is None:
            raise ValueError("Published TNO land_mask is required.")
        land = [_decode_geometry(absolute, item) for item in land_obj.get("geometries", [land_obj])]
        if not land or any(g is None or not g.is_valid for g in land):
            raise ValueError("Published land mask must contain valid geometry.")
        protected.append(extent.difference(shapely.union_all(land)))
        selected, constraints = constrain_candidate_surface_geometry(
            old, selected, shapely.union_all(protected), boundary_tolerance=boundary_tolerance)
    target_surface_delta = shapely.union_all(old.geometry.values).symmetric_difference(
        shapely.union_all(selected.geometry.values)).area
    if target_surface_delta > 1e-10:
        raise ValueError(f"Selected target surface changed: {target_surface_delta}")
    candidate, diagnostics = replace_regional_geometry(
        baseline, selected,
        source_countries=sorted(countries) if target_feature_ids is None else None,
    )
    precision_countries = baseline.get("political_precision_source_countries", [])
    if not isinstance(precision_countries, list) or any(
        not isinstance(code, str) or len(code) != 2 or not code.isascii() or not code.isupper()
        or not code.isalpha() for code in precision_countries
    ):
        raise ValueError("Baseline political_precision_source_countries must be an ISO2 list.")
    if target_feature_ids is None:
        candidate["political_precision_source_countries"] = sorted(set(precision_countries) | countries)
    else:
        # Partial/stable-ID upgrades may cross mutable scenario allegiances.
        # Declare exactly their IDs: country flags both omit reassigned targets
        # and unnecessarily expand coarse precision to untouched country units.
        precision_ids = baseline.get("political_precision_feature_ids", [])
        if (not isinstance(precision_ids, list)
                or any(not isinstance(value, str) or not value.strip() or value != value.strip()
                       for value in precision_ids)
                or len(set(precision_ids)) != len(precision_ids)
                or set(precision_ids) - set(by_id)):
            raise ValueError("Baseline political_precision_feature_ids must contain unique existing IDs.")
        candidate["political_precision_source_countries"] = sorted(precision_countries)
        candidate["political_precision_feature_ids"] = sorted(set(precision_ids) | set(current))
    if set(candidate["objects"]) != set(absolute["objects"]):
        raise ValueError("Candidate changed runtime object membership.")
    auxiliary = []
    for name, obj in absolute["objects"].items():
        if name == "political":
            continue
        new_obj = candidate["objects"][name]
        if _metadata(obj) != _metadata(new_obj) or not _decode_geometry(absolute, obj).equals_exact(_decode_geometry(candidate, new_obj), 0):
            raise ValueError(f"Candidate changed protected object: {name}.")
        auxiliary.append(name)
    before_edges, after_edges = _stored_edges(absolute), _stored_edges(candidate)
    untouched = lambda edge: all(fid not in current for fid in edge)
    old_untouched = {edge for edge in before_edges if untouched(edge)}
    new_untouched = {edge for edge in after_edges if untouched(edge)}
    if old_untouched != new_untouched:
        raise ValueError("Candidate changed adjacency between untouched features.")
    cross = lambda edge: sum(fid in current for fid in edge) == 1
    report = {**diagnostics, "scenario_id": "tno_1962", "source_countries": sorted(countries),
        "political_precision_source_countries": candidate["political_precision_source_countries"],
        "political_precision_feature_ids": candidate.get("political_precision_feature_ids", []),
        "source_feature_counts": dict(Counter(str(item["properties"]["cntr_code"]) for item in current.values())),
        "source_coordinates": int(shapely.get_num_coordinates(replacements.geometry.values).sum()),
        "baseline_target_coordinates": int(shapely.get_num_coordinates(old.geometry.values).sum()),
        "candidate_target_coordinates": int(shapely.get_num_coordinates(selected.geometry.values).sum()),
        "boundary_reconciliation": {"alignment": alignment, "surface_constraints": constraints},
        "protected_objects_unchanged": sorted(auxiliary), "untouched_adjacency_exact": True,
        "cross_boundary_edges_lost": [list(edge) for edge in sorted(before_edges-after_edges) if cross(edge)],
        "cross_boundary_edges_added": [list(edge) for edge in sorted(after_edges-before_edges) if cross(edge)],
        "policy": "Joint source coverage; scenario metadata and foreign geometry unchanged; published surface cuts retained through no-new-overlap constraints. Additional historical cuts require separate review.",
        "release_ready": False}
    return candidate, report


def prepare_candidate(scenario_dir: Path, replacement_geojson: Path, output: Path, *, source_countries,
                      boundary_tolerance=0.0, retained_enclave_countries=(), freeze_owner_domains=False):
    scenario_dir, replacement_geojson, output = scenario_dir.resolve(), replacement_geojson.resolve(), output.resolve()
    baseline_path = scenario_dir / "runtime_topology.topo.json"
    report_path = output.with_suffix(".report.json")
    if output == report_path:
        raise ValueError("Candidate and report must have different paths.")
    inputs = [baseline_path, replacement_geojson]
    for path in (output, report_path):
        if (path.exists() or path in inputs or path.is_relative_to(scenario_dir)
                or path.is_relative_to(ROOT / "data") or path.is_relative_to(ROOT / "dist")):
            raise ValueError("Use new candidate/report paths outside production and all input directories.")
    if read_json_strict(scenario_dir / "manifest.json").get("scenario_id") != "tno_1962":
        raise ValueError("This precision pilot requires a TNO 1962 baseline.")
    collection = read_json_strict(replacement_geojson)
    if collection.get("type") != "FeatureCollection" or not collection.get("features"):
        raise ValueError("Replacement must be a nonempty GeoJSON FeatureCollection.")
    if any(not {"id", "cntr_code"}.issubset(item.get("properties") or {}) for item in collection["features"]):
        raise ValueError("Every replacement feature requires properties.id and properties.cntr_code.")
    crs = collection.get("crs")
    if crs and crs.get("properties", {}).get("name") not in {
        "EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326"
    }:
        raise ValueError("Replacement GeoJSON must use WGS84 / EPSG:4326.")
    replacements = gpd.GeoDataFrame.from_features(collection["features"], crs="EPSG:4326")
    candidate, report = _assemble_candidate(read_json_strict(baseline_path), replacements, source_countries,
                                          boundary_tolerance=boundary_tolerance,
                                          retained_enclave_countries=retained_enclave_countries,
                                          frozen_domain_owners=(read_json_strict(scenario_dir / "owners.by_feature.json")["owners"]
                                                                if freeze_owner_domains else None))
    report.update({"source_file": str(replacement_geojson), "baseline_runtime": str(baseline_path), "output": str(output)})
    write_json_atomic(output, candidate, indent=None, separators=(",", ":"), allow_nan=False)
    write_json_atomic(report_path, report, indent=2, allow_nan=False)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario-dir", required=True, type=Path)
    parser.add_argument("--replacement-geojson", required=True, type=Path)
    parser.add_argument("--source-countries", required=True, nargs="+")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--boundary-tolerance", type=float, default=0.0,
                        help="Explicit EPSG:4326 overlay residual band, at most 1e-9 degrees; never moves coordinates.")
    parser.add_argument("--retain-enclave-countries", nargs="*", default=[],
        help="Reviewed non-target enclaves whose surrounding baseline coverage must survive source holes.")
    parser.add_argument("--freeze-owner-domains", action="store_true",
        help="Keep every selected owner footprint exact while updating internal source boundaries.")
    args = parser.parse_args(argv)
    report = prepare_candidate(args.scenario_dir, args.replacement_geojson, args.output,
                               source_countries=args.source_countries, boundary_tolerance=args.boundary_tolerance,
                               retained_enclave_countries=args.retain_enclave_countries,
                               freeze_owner_domains=args.freeze_owner_domains)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
