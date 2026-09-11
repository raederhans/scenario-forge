"""Check generated Atlantropa geometry and unrelated scenario-data preservation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from shapely.geometry import shape
from shapely.errors import GEOSException
from shapely.ops import unary_union
from topojson.utils import serialize_as_geojson


AREA_EPSILON = 1e-12  # square degrees; predicate tolerance, never a component filter
ATL_PREFIXES = ("ATLPRV_", "ATLISL_", "ATLWLD_", "ATLSHL_", "ATLSEA_", "ATLISRC_")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def feature_id(feature):
    return str((feature.get("properties") or {}).get("id") or feature.get("id") or "").strip()


def topology_features(path, object_name):
    payload = read_json(path)
    if object_name not in payload.get("objects", {}):
        raise ValueError(f"Missing topology object {object_name}: {path}")
    return serialize_as_geojson(payload, objectname=object_name)["features"]


def feature_index(features, label, issues):
    result = {}
    seen = set()
    for index, feature in enumerate(features):
        fid = feature_id(feature)
        if not fid or fid in seen:
            issues.append({"check": "feature_id", "source": label, "id": fid, "index": index})
            continue
        seen.add(fid)
        try:
            if not isinstance(feature.get("geometry"), dict):
                raise ValueError("missing geometry")
            geometry = shape(feature["geometry"])
            if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ("Polygon", "MultiPolygon"):
                raise ValueError("not a nonempty valid polygon")
        except (KeyError, TypeError, ValueError, AttributeError, GEOSException) as error:
            issues.append({"check": "geometry", "source": label, "id": fid, "error": str(error)})
            continue
        result[fid] = (feature, geometry)
    return result


def layer(feature):
    props = feature.get("properties") or {}
    if props.get("atl_render_layer"):
        return props["atl_render_layer"]
    fid = feature_id(feature)
    return "land" if fid.startswith(("ATLPRV_", "ATLISL_", "ATLWLD_")) else "water" if fid.startswith("ATLSEA_") else "other"


def compare_features(before, after, label, issues, *, compare_properties=False):
    for fid in sorted(set(before) | set(after)):
        if fid not in before or fid not in after:
            issues.append({"check": label, "id": fid, "difference": "added" if fid in after else "removed"})
            continue
        old, new = before[fid], after[fid]
        if not old[1].equals(new[1]):
            issues.append({"check": label, "id": fid, "difference": "geometry",
                           "symmetric_difference_area": old[1].symmetric_difference(new[1]).area})
        if compare_properties and old[0].get("properties") != new[0].get("properties"):
            issues.append({"check": label, "id": fid, "difference": "properties"})


def semantic_differences(before, after, path=""):
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            child = f"{path}/{key}"
            if key not in before or key not in after:
                yield {"path": child, "difference": "added" if key in after else "removed"}
            else:
                yield from semantic_differences(before[key], after[key], child)
    elif before != after:
        yield {"path": path or "/", "difference": "value", "before": before, "after": after}


def compare_baseline(directory, baseline, issues):
    runtime = "runtime_topology.topo.json"
    old = feature_index(topology_features(baseline / runtime, "political"), "baseline/political", issues)
    new = feature_index(topology_features(directory / runtime, "political"), "current/political", issues)
    compare_features({k: v for k, v in old.items() if not k.startswith(ATL_PREFIXES)},
                     {k: v for k, v in new.items() if not k.startswith(ATL_PREFIXES)},
                     "non_atl_political", issues, compare_properties=True)
    names = {"owners.by_feature.json", "controllers.by_feature.json", "cores.by_feature.json"}
    for folder in (directory, baseline):
        for path in folder.glob("*.json"):
            if any(token in path.name for token in ("manual", "locale", "localiz")) or path.name == "geo_aliases.startup.json":
                names.add(path.name)
    checked = []
    for name in sorted(names):
        current_path, old_path = directory / name, baseline / name
        if not current_path.exists() and not old_path.exists():
            continue
        checked.append(name)
        if not current_path.exists() or not old_path.exists():
            issues.append({"check": "baseline_file", "file": name,
                           "difference": "added" if current_path.exists() else "removed"})
            continue
        current, previous = read_json(current_path), read_json(old_path)
        field = next((key for key in ("owners", "controllers", "cores") if name.startswith(key + ".")), None)
        if field:
            # Synthetic helper retirement is in scope. Non-ATL assignments must
            # remain identical; missing mapping fields are an error, not {}.
            if not isinstance(current.get(field), dict) or not isinstance(previous.get(field), dict):
                issues.append({"check": "baseline_schema", "file": name, "field": field})
                continue
            current = {k: v for k, v in current[field].items() if not k.startswith(ATL_PREFIXES)}
            previous = {k: v for k, v in previous[field].items() if not k.startswith(ATL_PREFIXES)}
        else:
            current = {k: v for k, v in current.items() if k != "generated_at"}
            previous = {k: v for k, v in previous.items() if k != "generated_at"}
        issues.extend({"check": "baseline_semantics", "file": name, **difference}
                      for difference in semantic_differences(previous, current))
    return checked


def check_scenario(directory, baseline=None):
    directory = Path(directory)
    issues = []
    features = topology_features(directory / "scenario_atlantropa.topo.json", "scenario_atlantropa")
    source = feature_index(features, "source", issues)
    land = [(fid, geom) for fid, (feature, geom) in source.items() if layer(feature) == "land"]
    water = [geom for feature, geom in source.values() if layer(feature) == "water"]
    for name, geometries in (("land", land), ("water", water)):
        if not geometries:
            issues.append({"check": "source_layer_missing", "layer": name})
    water_union = unary_union(water)
    components = []
    for index, (fid, geometry) in enumerate(land):
        for other_id, other in land[index + 1:]:
            if geometry.intersects(other):
                area = geometry.intersection(other).area
                if area > AREA_EPSILON:
                    issues.append({"check": "land_overlap", "ids": [fid, other_id], "area": area})
        area = geometry.intersection(water_union).area
        if area > AREA_EPSILON:
            issues.append({"check": "land_sea_overlap", "id": fid, "area": area})
        parts = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        for part in parts:
            components.append({"id": fid, "area": part.area, "holes": len(part.interiors)})
    chunk_counts = {}
    for lod in ("coarse", "detail"):
        paths = sorted((directory / "chunks").glob(f"scenario_atlantropa.{lod}.*.json"))
        if not paths:
            issues.append({"check": "chunk_missing", "lod": lod})
        merged = {}
        for path in paths:
            chunk = feature_index(read_json(path)["features"], path.name, issues)
            for fid, entry in chunk.items():
                if fid in merged:
                    compare_features({fid: merged[fid]}, {fid: entry}, "chunk_duplicate_geometry", issues)
                merged[fid] = entry
            compare_features({k: source[k] for k in chunk if k in source}, chunk,
                             f"source_chunk_geometry:{path.name}", issues)
        compare_features(source, merged, f"source_{lod}_coverage", issues)
        chunk_counts[lod] = {"chunks": len(paths), "unique_features": len(merged)}
    baseline_files = compare_baseline(directory, Path(baseline), issues) if baseline else []
    return {"passed": not issues, "area_epsilon_square_degrees": AREA_EPSILON,
            "source_feature_count": len(features), "land_feature_count": len(land),
            "land_component_count": len(components), "land_hole_count": sum(c["holes"] for c in components),
            "small_component_count_below_0_0001_square_degrees": sum(c["area"] < 0.0001 for c in components),
            "component_note": "Small or disconnected components are statistics, not evidence of erroneous islands.",
            "chunks": chunk_counts, "baseline_checked": baseline is not None,
            "baseline_files": baseline_files, "issues": issues}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario-dir", type=Path, required=True)
    parser.add_argument("--baseline-dir", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = check_scenario(args.scenario_dir, args.baseline_dir)
    except (OSError, ValueError, KeyError, TypeError, GEOSException) as error:
        report = {"passed": False, "issues": [{"check": "input", "error": str(error)}]}
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "issue_count": len(report["issues"]),
                      "report": str(args.report) if args.report else None}) if args.report else output)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
