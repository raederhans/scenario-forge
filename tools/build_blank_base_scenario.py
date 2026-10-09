"""Rebuild the ownerless blank map from complete Modern World geometry.

Copy topology without re-encoding coordinates and retain every existing blank ID.
The existing scenario materializer refreshes sidecars, manifests and snapshots.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shapely
from shapely.geometry import mapping, shape
from shapely.validation import explain_validity

from map_builder import config as cfg
from map_builder.json_source import (
    json_source_sha256, read_json_source, resolve_json_source_path, write_runtime_topology_source,
)
from map_builder.processors.arctic_recovery import _read, decoded_structure, polygonal
from map_builder.regional_geometry import _absolute_topology, _encode_exact_coverage
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario
from tools.rebuild_polar_assets import append_missing, refresh_neighbors

FORBIDDEN_BLANK_PROPERTIES = {
    "cntr_code", "country_code", "owner", "controller", "core", "cores",
    "scenario_owner", "scenario_controller", "color", "color_hex",
    "admin1_group", "legacy_name", "anchor_county_name",
}


def read(path: Path) -> dict:
    return read_json_source(path)


def political_rows(topology: dict, label: str) -> list[dict]:
    political = topology.get("objects", {}).get("political", {})
    rows = political.get("geometries")
    if topology.get("type") != "Topology" or political.get("type") != "GeometryCollection":
        raise ValueError(f"{label}: expected a political TopoJSON GeometryCollection")
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{label}: political features must be nonempty")
    if any(not isinstance(row, dict) or not isinstance(row.get("properties"), dict) for row in rows):
        raise ValueError(f"{label}: political features must have properties")
    ids = [row["properties"].get("id") for row in rows]
    if any(not isinstance(fid, str) or not fid.strip() for fid in ids):
        raise ValueError(f"{label}: political feature IDs must be nonempty strings")
    if len(ids) != len(set(ids)):
        raise ValueError(f"{label}: political feature IDs must be unique")
    return rows


def validate_source_geometry(topology: dict) -> None:
    """Reject unreadable, empty or invalid donor land before any file is written."""
    rows = political_rows(topology, "source")
    absolute = _absolute_topology(topology)
    for row in rows:
        fid = row["properties"]["id"]
        try:
            kind = row.get("type")
            if kind not in {"Polygon", "MultiPolygon"}:
                raise ValueError("political feature must be polygonal")
            polygons = [row["arcs"]] if kind == "Polygon" else row["arcs"]
            if not polygons or any(not polygon for polygon in polygons):
                raise ValueError("polygon must contain rings")
            for polygon in polygons:
                for ring in polygon:
                    if not ring:
                        raise ValueError("ring must contain arcs")
                    previous = None
                    for index in ring:
                        if type(index) is not int:
                            raise ValueError("arc reference must be an integer")
                        offset = index if index >= 0 else ~index
                        if not 0 <= offset < len(absolute["arcs"]):
                            raise ValueError("arc reference is out of range")
                        segment = absolute["arcs"][offset]
                        if len(segment) < 2:
                            raise ValueError("arc must contain at least two points")
                        segment = segment if index >= 0 else segment[::-1]
                        if previous is not None and previous != segment[0]:
                            raise ValueError("ring arcs are disconnected")
                        previous = segment[-1]
            decoded = decoded_structure(absolute, row)
            polygons = [decoded["coordinates"]] if kind == "Polygon" else decoded["coordinates"]
            for polygon in polygons:
                for ring in polygon:
                    if any(len(point) != 2 or any(not math.isfinite(v) for v in point) for point in ring):
                        raise ValueError("ring coordinates must be finite pairs")
                    if len(ring) < 4 or len(set(map(tuple, ring))) < 3 or ring[0] != ring[-1]:
                        raise ValueError("degenerate or unclosed ring")
            geometry = shape(decoded)
            if geometry.is_empty or geometry.area <= 0 or not geometry.is_valid:
                raise ValueError(f"invalid polygon: {explain_validity(geometry)}")
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ValueError(f"source geometry {fid}: {exc}") from exc


def rebuild_topology(source: dict, previous: dict, restoration: dict | None = None) -> dict:
    """Copy complete donor topology, preserving IDs and exact encoded geometry."""
    previous_rows = political_rows(previous, "previous blank")
    validate_source_geometry(source)
    result = deepcopy(source)
    for row in result["objects"]["political"]["geometries"]:
        row["properties"] = {
            key: value for key, value in row["properties"].items()
            if key not in FORBIDDEN_BLANK_PROPERTIES
        }
    if restoration and restoration.get("features"):
        features = restoration["features"]
        ids = [feature["properties"]["id"] for feature in features]
        donor = _encode_exact_coverage(ids, [shape(feature["geometry"]) for feature in features])
        for row, feature in zip(donor["objects"]["political"]["geometries"], features):
            row["properties"] = {key: deepcopy(value) for key, value in feature["properties"].items()
                                 if key not in FORBIDDEN_BLANK_PROPERTIES}
        before = result
        # The source inventory has already subtracted every existing feature.
        # ownerless=True would trim Arctic helpers and change donor coordinates.
        result, report = append_missing(result, donor, ids, ownerless=False)
        if set(report["added_ids"]) != set(ids):
            raise ValueError("Source recovery did not retain all requested identities")
        refresh_neighbors(before, result, set(ids))
        validate_source_geometry(result)
    missing = {row["properties"]["id"] for row in previous_rows} - {
        row["properties"]["id"] for row in result["objects"]["political"]["geometries"]
    }
    if missing:
        raise ValueError(f"source is missing existing blank IDs: {sorted(missing)[:10]}")
    return result


def load_restoration_inputs(admin1_path: Path, india_path: Path, land_path: Path, lakes_path: Path):
    """Read existing local sources only; missing inputs stop the rebuild."""
    import geopandas as gpd

    for path in (admin1_path, india_path, land_path, lakes_path):
        if not path.is_file():
            raise FileNotFoundError(f"Required blank restoration source is missing: {path}")
    admin1 = gpd.read_file(admin1_path).to_crs("EPSG:4326")
    units = [(f"BLANK_SOURCE_NE_{row['adm1_code']}", str(row["name"]), "ne_admin1", row.geometry)
             for _, row in admin1.iterrows()]
    for feature in read(india_path)["features"]:
        props = feature["properties"]
        units.append((f"IN_ADM2_{props['shapeID']}", str(props["shapeName"]),
                      "india_adm2", shape(feature["geometry"])))
    primary = _absolute_topology(read(land_path))
    land = [_read(primary, row) for row in primary["objects"]["land"]["geometries"]]
    lakes = [polygonal(shape(feature["geometry"])) for feature in read(lakes_path)["features"]]
    if not units or not land or not lakes:
        raise ValueError("Blank restoration source collections must be nonempty")
    return units, land, lakes


def inventory_missing_land(source: dict, units, land, lakes) -> tuple[dict, dict]:
    """Recover only source units absent from existing political coverage.

    Existing coast slivers are excluded by the same <5% component policy used
    by the runtime builder. Candidates must intersect published physical land
    and must exclude every lake and every existing political feature.
    """
    from pyproj import Geod

    absolute = _absolute_topology(source)
    existing_ids = {row["properties"]["id"] for row in political_rows(source, "source")}
    existing = [shape(decoded_structure(absolute, row))
                for row in political_rows(absolute, "source")]
    political_tree, land_tree, lake_tree = map(shapely.STRtree, (existing, land, lakes))
    geod = Geod(ellps="WGS84")
    features, candidates, restored = [], [], []
    seen = set()
    for fid, name, source_kind, raw in units:
        if not fid or fid in seen:
            raise ValueError(f"Missing or duplicate restoration source ID: {fid}")
        seen.add(fid)
        geometry = polygonal(raw)
        if geometry.is_empty or geometry.area <= 0 or not geometry.is_valid:
            raise ValueError(f"Invalid restoration source geometry: {fid}")
        if fid in existing_ids:
            continue
        nearby = [existing[int(i)] for i in political_tree.query(geometry, predicate="intersects")]
        occupied = shapely.union_all(nearby)
        coverage = geometry.intersection(occupied).area / geometry.area
        if coverage >= cfg.RUNTIME_PRIMARY_COMPONENT_OVERLAP_THRESHOLD:
            continue
        physical = shapely.union_all([land[int(i)] for i in land_tree.query(geometry, predicate="intersects")])
        water = shapely.union_all([lakes[int(i)] for i in lake_tree.query(geometry, predicate="intersects")])
        missing = polygonal(geometry.intersection(physical).difference(water).difference(occupied))
        if restored:
            missing = polygonal(missing.difference(shapely.union_all(restored)))
        if missing.is_empty or missing.area <= 1e-10:
            continue
        area_km2 = abs(geod.geometry_area_perimeter(missing)[0]) / 1e6
        features.append({"type": "Feature", "properties": {
            "id": fid, "name": name, "detail_tier": "source_recovery",
            "__source": f"blank_source_recovery:{source_kind}",
        }, "geometry": mapping(missing)})
        restored.append(missing)
        candidates.append({"id": fid, "name": name, "source": source_kind,
                           "existing_coverage_ratio": coverage, "restored_km2": area_km2,
                           "bounds": list(missing.bounds)})
    return {"type": "FeatureCollection", "features": features}, {
        "source_unit_count": len(seen), "candidate_count": len(candidates),
        "restored_km2": sum(row["restored_km2"] for row in candidates),
        "policy": "source unit <5% covered; physical land minus lakes and existing political coverage",
        "candidates": candidates,
    }


def refresh_blank_audit_diagnostics(scenario_dir: Path) -> None:
    """Replace legacy mixed-source diagnostics after the normal materializer."""
    manifest = read(scenario_dir / "manifest.json")
    audit_path = scenario_dir / "audit.json"
    audit = read(audit_path)
    diagnostics = audit.setdefault("diagnostics", {})
    diagnostics["baseline_hash"] = manifest["baseline_hash"]
    diagnostics.pop("detail_topology_feature_count", None)
    diagnostics["ownerless_source_feature_count"] = manifest["summary"]["feature_count"]
    write_json(audit_path, audit)


def build_blank_base_scenario(source_path: Path, scenario_dir: Path, *, restoration: dict | None = None,
                              restoration_report: dict | None = None) -> dict:
    source_path, scenario_dir = Path(source_path).resolve(), Path(scenario_dir).resolve()
    manifest_path = scenario_dir / "manifest.json"
    manifest = read(manifest_path)
    if (scenario_dir.name != "blank_base" or manifest.get("scenario_id") != "blank_base"
            or manifest.get("map_mode") != "blank"):
        raise ValueError("target must be the ownerless blank_base scenario")
    target_path = scenario_dir / "runtime_topology.topo.json"
    if resolve_json_source_path(source_path) == resolve_json_source_path(target_path):
        raise ValueError("source topology must differ from the blank target")
    for name, key in (("owners.by_feature.json", "owners"),
                      ("cores.by_feature.json", "cores"),
                      ("controllers.by_feature.json", "controllers")):
        path = scenario_dir / name
        if name.startswith("controllers") and not path.exists():
            continue
        if read(path)[key]:
            raise ValueError("blank_base assignment sidecars must be empty")
    previous = read(target_path)
    result = rebuild_topology(read(source_path), previous, restoration)
    source_metadata = manifest.setdefault("source", {})
    source_metadata["ownerless_topology_source"] = (
        resolve_json_source_path(source_path).relative_to(ROOT).as_posix()
    )
    source_metadata["ownerless_topology_source_sha256"] = json_source_sha256(source_path)
    if restoration_report is not None:
        source_metadata["ownerless_restoration_sources"] = restoration_report["inputs"]
    manifest["generated_at"] = datetime.now(timezone.utc).isoformat()
    actual_target = write_runtime_topology_source(scenario_dir, result)
    manifest["runtime_topology_url"] = actual_target.relative_to(ROOT).as_posix()
    source_metadata["runtime_topology_sha256"] = json_source_sha256(actual_target)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fixes = refresh_scenario(scenario_dir, {})
    # audit.json is excluded from both snapshot inputs and outputs.
    refresh_blank_audit_diagnostics(scenario_dir)
    return {
        "feature_count": len(result["objects"]["political"]["geometries"]),
        "preserved_feature_count": len(previous["objects"]["political"]["geometries"]),
        "source_sha256": source_metadata["ownerless_topology_source_sha256"],
        "restored_source_feature_count": len((restoration or {}).get("features", [])),
        "refreshed_assets": fixes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-topology", type=Path,
                        default=ROOT / "data/scenarios/modern_world/runtime_topology.topo.json")
    parser.add_argument("--scenario-dir", type=Path, default=ROOT / "data/scenarios/blank_base")
    parser.add_argument("--admin1-source", type=Path, default=ROOT / "data/ne_10m_admin_1_states_provinces.shp")
    parser.add_argument("--india-source", type=Path, default=ROOT / "data/geoBoundaries-IND-ADM2.geojson")
    parser.add_argument("--land-topology", type=Path, default=ROOT / "data/europe_topology.json")
    parser.add_argument("--lakes-source", type=Path, default=ROOT / "data/global_lakes.geojson")
    parser.add_argument("--restoration-source-root", type=Path, default=ROOT,
                        help="Repository root for portable restoration input provenance")
    parser.add_argument("--inventory-only", action="store_true", help="Write source candidates without changing the scenario")
    parser.add_argument("--inventory-path", type=Path,
                        default=ROOT / ".runtime/reports/generated/blank-source-inventory.json")
    args = parser.parse_args()
    units, land, lakes = load_restoration_inputs(args.admin1_source, args.india_source,
                                                args.land_topology, args.lakes_source)
    restoration, report = inventory_missing_land(read(args.source_topology), units, land, lakes)
    input_paths = [args.admin1_source, args.india_source, args.land_topology, args.lakes_source]
    if args.admin1_source.suffix == ".shp":
        input_paths.extend(args.admin1_source.with_suffix(suffix) for suffix in (".dbf", ".shx", ".prj"))
        cpg = args.admin1_source.with_suffix(".cpg")
        if cpg.exists():
            input_paths.append(cpg)
    report["inputs"] = [{
        "path": path.resolve().relative_to(
            ROOT if path.resolve().is_relative_to(ROOT) else args.restoration_source_root.resolve()
        ).as_posix(),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    } for path in input_paths]
    write_json(args.inventory_path, report)
    write_json(args.inventory_path.with_suffix(".geojson"), restoration)
    if args.inventory_only:
        print(json.dumps({key: value for key, value in report.items() if key != "candidates"}, indent=2))
    else:
        print(json.dumps(build_blank_base_scenario(args.source_topology, args.scenario_dir,
                                                   restoration=restoration, restoration_report=report), indent=2))


if __name__ == "__main__":
    main()
