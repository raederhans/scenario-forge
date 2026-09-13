"""Prepare a France-only TNO precision candidate, preserving published special geography."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import mapping, box

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.processors.france import apply_france_master_precision
from map_builder.geo.regional_boundary_alignment import align_regional_boundaries
from map_builder.geo.scenario_surface_constraints import constrain_candidate_surface_geometry
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from tools.patch_tno_1962_bundle import build_tno_base_geography_water_clone_union, cut_political_features


def _object_identity(topology, name):
    obj = topology["objects"][name]
    features = obj.get("geometries", [obj])
    result = []
    for item in features:
        geometry = _decode_geometry(topology, item)
        result.append({"metadata": {k: v for k, v in item.items() if k not in {"arcs", "coordinates", "geometries"}},
                       "geometry": mapping(geometry) if geometry is not None else None})
    return hashlib.sha256(json.dumps(result, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def prepare_candidate(master_path: Path, scenario_dir: Path, output_path: Path, *, reconcile_boundaries=False):
    master_path, scenario_dir, output_path = master_path.resolve(), scenario_dir.resolve(), output_path.resolve()
    baseline_path = scenario_dir / "runtime_topology.topo.json"
    if output_path.exists() or output_path.is_relative_to(scenario_dir) or output_path == master_path:
        raise ValueError("Use a new candidate path outside the scenario and master inputs")
    if read_json_strict(scenario_dir / "manifest.json").get("scenario_id") != "tno_1962":
        raise ValueError("This pilot applies only to the reviewed TNO 1962 scenario")
    baseline = read_json_strict(baseline_path)
    absolute = _absolute_topology(baseline)
    master = _absolute_topology(read_json_strict(master_path))
    master_fr = [g for g in master["objects"]["political"]["geometries"] if g.get("properties", {}).get("id", "").startswith("FR_ARR_")]
    master_frame = gpd.GeoDataFrame([dict(g["properties"], geometry=_decode_geometry(master, g)) for g in master_fr], crs="EPSG:4326")
    restored = apply_france_master_precision(master_frame)
    current = {g["properties"]["id"]: g for g in absolute["objects"]["political"]["geometries"] if g.get("properties", {}).get("id", "").startswith("FR_ARR_")}
    if len(current) != 315 or len(restored) != 320:
        raise ValueError("TNO France membership changed; review the pilot's source/history selection")
    excluded = set(restored.id) - set(current)
    expected_excluded = {"FR_ARR_2A001", "FR_ARR_2A004", "FR_ARR_2B002", "FR_ARR_2B003", "FR_ARR_2B005"}
    if excluded != expected_excluded:
        raise ValueError("Corsica replacement membership differs from the reviewed TNO history")
    selected = restored.loc[restored.id.isin(current)].copy()
    water = absolute["objects"]["scenario_water"]["geometries"]
    congo = [_decode_geometry(absolute, g) for g in water if g.get("properties", {}).get("id") == "congo_lake"]
    if len(congo) != 1:
        raise ValueError("Published Congo lake is missing or duplicated")
    cut = shapely.union_all([congo[0], build_tno_base_geography_water_clone_union()])
    cut_ids = selected.loc[selected.geometry.intersects(cut), "id"].tolist()
    selected, migration, removed = cut_political_features(selected, cut)
    if removed or set(selected.id) != set(current) or any(k != v for k, v in migration.items()):
        raise ValueError("TNO water cut changed French IDs; explicit migration is required")
    reconciliation = None
    if reconcile_boundaries:
        old_france = gpd.GeoDataFrame([
            dict(g["properties"], geometry=_decode_geometry(absolute, g))
            for g in current.values()
        ], crs=selected.crs)
        selected, alignment = align_regional_boundaries(old_france, selected)
        extent = box(*selected.total_bounds)
        surfaces = []
        for name in ("political", "scenario_water", "scenario_atlantropa"):
            for item in absolute["objects"][name]["geometries"]:
                if name == "political" and item.get("properties", {}).get("id") in current:
                    continue
                geometry = _decode_geometry(absolute, item)
                if geometry is not None and geometry.intersects(extent):
                    surfaces.append(geometry)
        land = [_decode_geometry(absolute, item)
                for item in absolute["objects"]["land_mask"]["geometries"]]
        if not land or any(geometry is None or not geometry.is_valid for geometry in land):
            raise ValueError("Published land mask must be valid for coastline preservation")
        surfaces.append(extent.difference(shapely.union_all(land)))
        selected, constraints = constrain_candidate_surface_geometry(
            old_france, selected, shapely.union_all(surfaces))
        reconciliation = {"alignment": alignment, "surface_constraints": constraints,
                          "policy": "retain baseline outer coverage; forbid newly introduced foreign/special-surface overlap and new coverage outside the published land mask"}
    candidate, diagnostics = replace_regional_geometry(baseline, selected, source_countries=["FR"])
    names = set(absolute["objects"]) - {"political"}
    protected = {name: _object_identity(absolute, name) for name in sorted(names)}
    if set(candidate["objects"]) != set(absolute["objects"]):
        raise ValueError("Runtime object membership changed")
    for name, identity in protected.items():
        if _object_identity(candidate, name) != identity:
            raise ValueError(f"Protected TNO object changed: {name}")
    owners = read_json_strict(scenario_dir / "owners.by_feature.json")["owners"]
    report = {**diagnostics, "scenario_id": "tno_1962", "source_master": str(master_path),
              "excluded_corsica_ids": sorted(excluded), "water_cut_affected_france_ids": cut_ids,
              "france_owners": sorted({owners[fid] for fid in current}),
              "protected_object_identities": protected, "protected_objects_unchanged": True,
              "boundary_reconciliation": reconciliation,
              "old_france_coordinates": int(sum(shapely.get_num_coordinates(_decode_geometry(absolute, g)) for g in current.values())),
              "new_france_coordinates": int(shapely.get_num_coordinates(selected.geometry.values).sum()),
              "release_ready": False}
    write_json_atomic(output_path, candidate, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    write_json_atomic(output_path.with_suffix(".report.json"), report, ensure_ascii=False, indent=2)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--scenario-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reconcile-boundaries", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare_candidate(args.master, args.scenario_dir, args.output,
                                     reconcile_boundaries=args.reconcile_boundaries), ensure_ascii=False, indent=2))
