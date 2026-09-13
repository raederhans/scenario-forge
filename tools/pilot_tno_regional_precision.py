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


def _assemble_candidate(baseline, replacements, source_countries):
    countries = {str(code).strip().upper() for code in source_countries}
    if not countries or any(len(code) != 2 or not code.isascii() or not code.isalpha() for code in countries):
        raise ValueError("Source countries must be explicit ISO2 source codes.")
    absolute = _absolute_topology(baseline)
    rows = absolute["objects"]["political"]["geometries"]
    by_id = {str(item["properties"]["id"]): item for item in rows}
    if len(by_id) != len(rows):
        raise ValueError("Baseline political IDs must be unique.")
    current = {fid: item for fid, item in by_id.items()
               if str(item["properties"].get("cntr_code", "")).strip().upper() in countries}
    selected_countries = {str(item["properties"]["cntr_code"]).strip().upper() for item in current.values()}
    if selected_countries != countries:
        raise ValueError("Every selected source country must exist in the baseline.")
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
    selected, alignment = align_regional_boundaries(old, selected)
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
    selected, constraints = constrain_candidate_surface_geometry(old, selected, shapely.union_all(protected))
    candidate, diagnostics = replace_regional_geometry(baseline, selected, source_countries=sorted(countries))
    precision_countries = baseline.get("political_precision_source_countries", [])
    if not isinstance(precision_countries, list) or any(
        not isinstance(code, str) or len(code) != 2 or not code.isascii() or not code.isupper()
        or not code.isalpha() for code in precision_countries
    ):
        raise ValueError("Baseline political_precision_source_countries must be an ISO2 list.")
    candidate["political_precision_source_countries"] = sorted(set(precision_countries) | countries)
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


def prepare_candidate(scenario_dir: Path, replacement_geojson: Path, output: Path, *, source_countries):
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
    candidate, report = _assemble_candidate(read_json_strict(baseline_path), replacements, source_countries)
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
    args = parser.parse_args(argv)
    report = prepare_candidate(args.scenario_dir, args.replacement_geojson, args.output,
                               source_countries=args.source_countries)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
