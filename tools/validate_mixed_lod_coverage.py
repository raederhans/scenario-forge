"""Verify every independent detail-chunk loading combination without enumeration.

A chunk is an atomic choice between its coarse and detail union. A point is
covered for every choice iff at least one chunk covers it in both variants.
This checks coverage, not per-feature ownership or overlap validity.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shapely
from shapely.geometry import GeometryCollection, box, mapping, shape

from map_builder.json_source import read_json_source
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.scenario_chunk_format import decode_political_chunk

AREA_EPSILON = 1e-12


def union(geometries):
    return shapely.union_all(list(geometries))


def mixed_coverage_sets(before, after, *, domain, additions):
    """Return exact planar sets; a missing chunk is an empty choice in both LODs."""
    empty = GeometryCollection()
    guaranteed = union(coarse.intersection(detail) for coarse, detail in after.values())
    loss_options = []
    for key in before.keys() | after.keys():
        old = before.get(key, (empty, empty))
        new = after.get(key, (empty, empty))
        loss_options.extend(a.difference(b) for a, b in zip(old, new))
    # A lost point can be exposed by a loading combination exactly when no
    # other chunk must cover it. The losing chunk cannot cover it in both of
    # its new variants, so subtracting the full guaranteed union is sufficient.
    regression = union(loss_options).difference(guaranteed).intersection(domain)
    restoration_missing = additions.difference(guaranteed)
    return guaranteed, regression, restoration_missing


def read(path):
    if Path(path).name in {"runtime_topology.topo.json", "runtime_topology.topo.json.gz"}:
        return read_json_source(path)
    return json.loads(path.read_text(encoding="utf-8"))


def local_path(directory, url):
    prefix = f"data/scenarios/{read(directory / 'manifest.json')['scenario_id']}/"
    if not isinstance(url, str) or not url.startswith(prefix):
        raise ValueError(f"Nonlocal scenario URL: {url}")
    path = (directory / url[len(prefix):]).resolve()
    if not path.is_relative_to(directory.resolve()) or path == directory.resolve():
        raise ValueError(f"Scenario URL escapes directory: {url}")
    return path


def feature_rows(payload, label):
    if isinstance(payload, dict) and payload.get("type") == "Topology":
        payload = decode_political_chunk(payload)
    rows = {}
    for feature in payload["features"]:
        fid = str(feature.get("properties", {}).get("id") or feature.get("id") or "")
        if not fid or fid in rows:
            raise ValueError(f"Missing or duplicate feature ID in {label}: {fid}")
        rows[fid] = shape(feature["geometry"])
    return rows


def load_scenario(directory):
    directory = Path(directory).resolve()
    manifest = read(directory / "manifest.json")
    topology = _absolute_topology(read(local_path(directory, manifest["runtime_topology_url"])))
    runtime = {}
    for feature in topology["objects"]["political"]["geometries"]:
        fid = feature["properties"]["id"]
        if fid in runtime:
            raise ValueError(f"Duplicate runtime ID: {fid}")
        runtime[fid] = _decode_geometry(topology, feature)
    coarse, chunks, membership = {}, {}, {}
    entries = read(directory / "detail_chunks.manifest.json")["chunks"]
    for entry in entries:
        if entry["layer"] != "political":
            continue
        chunk_payload = read(local_path(directory, entry["url"]))
        rows = feature_rows(chunk_payload, entry["id"])
        if entry["lod"] == "coarse":
            if coarse.keys() & rows.keys():
                raise ValueError("Duplicate coarse political IDs")
            coarse.update(rows)
        elif entry["lod"] == "detail":
            if entry["id"] in chunks or membership.keys() & rows.keys():
                raise ValueError("Detail chunks must assign each political ID exactly once")
            chunks[entry["id"]] = rows
            membership.update({fid: entry["id"] for fid in rows})
    if runtime.keys() != coarse.keys() or runtime.keys() != membership.keys():
        raise ValueError("Runtime/coarse/detail ID sets differ")
    return {"runtime": runtime, "coarse": coarse, "chunks": chunks, "membership": membership}


def clipped_union(rows, extent, label):
    parts = []
    for fid, geom in rows.items():
        if geom is None or geom.is_empty:
            raise ValueError(f"Missing/empty {label} geometry: {fid}")
        if extent is not None and not geom.envelope.intersects(extent):
            continue
        if not geom.is_valid:
            raise ValueError(f"Invalid {label} geometry: {fid}: {shapely.is_valid_reason(geom)}")
        part = geom.intersection(extent) if extent is not None else geom
        if not part.is_empty:
            parts.append(part)
    return union(parts)


def chunk_unions(scenario, extent):
    return {key: (clipped_union({fid: scenario['coarse'][fid] for fid in rows}, extent, 'coarse'),
                  clipped_union(rows, extent, 'detail'))
            for key, rows in scenario['chunks'].items()}


def describe(geometry, include_geometry=False):
    result = {"area_degrees2": float(geometry.area), "empty": geometry.is_empty}
    if not geometry.is_empty:
        point = geometry.representative_point()
        result.update(bounds=list(geometry.bounds), probe=[point.x, point.y])
    if include_geometry:
        result["geometry"] = mapping(geometry)
    return result


def validate(before, after, bounds=None, *, include_geometry=False, full_source_coverage=False):
    if bounds is not None and (len(bounds) != 4 or not all(math.isfinite(v) for v in bounds)
            or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]):
        raise ValueError('Bounds must contain four finite values with west < east and south < north')
    if before['runtime'].keys() != after['runtime'].keys():
        raise ValueError("This validator requires unchanged political feature IDs")
    extent = box(*bounds) if bounds is not None else None
    old_source = clipped_union(before['runtime'], extent, 'baseline runtime')
    new_source = clipped_union(after['runtime'], extent, 'candidate runtime')
    additions = new_source.difference(old_source)
    lost_source = old_source.difference(new_source)
    new = chunk_unions(after, extent)
    if full_source_coverage:
        # This stronger gate does not need to overlay potentially invalid old
        # coarse polygons. Every source point must survive every new loading
        # state, including original territory and the new restoration.
        guaranteed = union(coarse.intersection(detail) for coarse, detail in new.values())
        regression = old_source.difference(guaranteed)
        restoration_missing = additions.difference(guaranteed)
    else:
        old = chunk_unions(before, extent)
        guaranteed, regression, restoration_missing = mixed_coverage_sets(
            old, new, domain=old_source.union(new_source), additions=additions)
    source_missing = new_source.difference(guaranteed)
    return {
        "passed": all(g.area <= AREA_EPSILON for g in (lost_source, regression, restoration_missing)),
        "coverage_comparison": "complete_source_in_all_states" if full_source_coverage else "same_state_against_baseline",
        "bounds": list(bounds) if bounds is not None else None,
        "area_epsilon_degrees2": AREA_EPSILON,
        "independent_chunk_dimensions": len(before['chunks'].keys() | new.keys()),
        "changed_detail_membership_ids": sorted(fid for fid in before['membership']
            if before['membership'][fid] != after['membership'][fid]),
        "source_territory_lost": describe(lost_source, include_geometry),
        "any_same_state_coverage_regression": None if full_source_coverage else describe(regression, include_geometry),
        "original_source_not_guaranteed_in_all_states": describe(regression, include_geometry) if full_source_coverage else None,
        "restored_source_area": describe(additions, include_geometry),
        "restoration_not_guaranteed_in_all_states": describe(restoration_missing, include_geometry),
        "candidate_source_not_guaranteed_in_all_states": describe(source_missing, include_geometry),
        "limitations": ["Planar coverage gate only; does not certify ownership, overlap, source intent or browser behavior.",
            "Each manifest detail chunk is one independent atomic coarse/detail replacement.",
            "Regression is restricted to source political land, excluding unsupported old coarse protrusions.",
            ("Pass requires preserved original territory and all original and restored source land guaranteed in every candidate state."
             if full_source_coverage else
             "Candidate source not guaranteed is diagnostic; pass additionally requires no lost original territory, no same-state regression and all restored source area guaranteed.")],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-dir', required=True, type=Path)
    parser.add_argument('--candidate-dir', required=True, type=Path)
    parser.add_argument('--bounds', nargs=4, type=float, action='append')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--include-geometry', action='store_true')
    parser.add_argument('--full-source-coverage', action='store_true',
                        help='Require all original and restored source land in every candidate state; do not overlay old coarse geometries.')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() or not output.is_relative_to(ROOT / '.runtime'):
        raise ValueError('Output must be a new file inside this workspace .runtime')
    before, after = load_scenario(args.baseline_dir), load_scenario(args.candidate_dir)
    windows = [validate(before, after, bounds, include_geometry=args.include_geometry,
                        full_source_coverage=args.full_source_coverage)
               for bounds in (args.bounds or [None])]
    result = {"passed": all(w['passed'] for w in windows), "windows": windows}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({"passed": result['passed'], "output": str(output), "windows": len(windows)}))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
