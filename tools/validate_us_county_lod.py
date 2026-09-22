"""Validate a county candidate's independently replaceable coarse/detail shards.

This is a candidate-only geometry gate, not approval of foreign boundaries,
historical ownership, or legacy project migrations.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path

import shapely
from shapely.geometry import shape


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def feature_map(features):
    result = {}
    for feature in features:
        fid = feature["properties"]["id"]
        if fid in result:
            raise ValueError(f"duplicate county ID: {fid}")
        geometry = shape(feature["geometry"])
        if geometry.geom_type not in {"Polygon", "MultiPolygon"} or geometry.is_empty or not geometry.is_valid:
            raise ValueError(f"invalid county geometry: {fid}")
        result[fid] = geometry
    return result


def validate_lod_sets(source, coarse, detail_shards):
    if not source or set(source) != set(coarse):
        raise ValueError("coarse county membership differs from source")
    details = {}
    shard_results = []
    for shard_id, geometries in detail_shards.items():
        if not geometries or set(geometries) - set(source):
            raise ValueError(f"empty or unknown county shard: {shard_id}")
        if set(details) & set(geometries):
            raise ValueError(f"duplicate county across detail shards: {shard_id}")
        details.update(geometries)
        source_matches = all(geom.equals(source[fid]) for fid, geom in geometries.items())
        fine = list(geometries.values())
        rough = [coarse[fid] for fid in geometries]
        fine_union = shapely.union_all(fine)
        rough_union = shapely.union_all(rough)
        same_domain = fine_union.equals(rough_union)
        fine_coverage = bool(shapely.coverage_is_valid(fine))
        rough_coverage = bool(shapely.coverage_is_valid(rough))
        shard_results.append({
            "id": shard_id,
            "feature_count": len(geometries),
            "detail_matches_source": source_matches,
            "detail_coverage_valid": fine_coverage,
            "coarse_coverage_valid": rough_coverage,
            "domain_equal": same_domain,
            "domain_difference_degrees2": fine_union.symmetric_difference(rough_union).area,
            "pass": source_matches and fine_coverage and rough_coverage and same_domain,
        })
    if set(details) != set(source):
        raise ValueError("detail county membership differs from source")
    source_coverage = bool(shapely.coverage_is_valid(list(source.values())))
    coarse_coverage = bool(shapely.coverage_is_valid(list(coarse.values())))
    detail_coverage = bool(shapely.coverage_is_valid(list(details.values())))
    passed = source_coverage and coarse_coverage and detail_coverage and all(s["pass"] for s in shard_results)
    return {
        "status": "PASS" if passed else "FAIL",
        "scope": "US county source/detail identity and arbitrary whole-detail-shard LOD replacement only",
        "release_ready": False,
        "county_count": len(source),
        "detail_shard_count": len(detail_shards),
        "source_coverage_valid": source_coverage,
        "coarse_coverage_valid": coarse_coverage,
        "detail_coverage_valid": detail_coverage,
        "all_shard_combinations_proven": passed,
        "proof": "Each shard is a valid coverage with the same coarse/detail union; the complete detail coverage is valid. Replacing any subset of whole shards preserves the union and introduces no area overlap. This does not assert identical internal county edges or individual-feature replacement safety.",
        "shards": shard_results,
    }


def load_chunk(stage_dir, scenario_id, entry):
    prefix = f"data/scenarios/{scenario_id}/"
    url = entry["url"]
    if not url.startswith(prefix):
        raise ValueError(f"unexpected chunk URL: {url}")
    path = (stage_dir / url[len(prefix):]).resolve()
    if not path.is_relative_to(stage_dir.resolve()):
        raise ValueError("chunk path escapes candidate")
    raw = path.read_bytes()
    if len(raw) != entry["byte_size"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
        raise ValueError(f"chunk integrity mismatch: {entry['id']}")
    compressed = Path(str(path) + ".gz")
    if compressed.exists() and gzip.decompress(compressed.read_bytes()) != raw:
        raise ValueError(f"stale compressed chunk: {entry['id']}")
    features = json.loads(raw)["features"]
    if len(features) != entry["feature_count"]:
        raise ValueError(f"chunk feature count mismatch: {entry['id']}")
    return features


def validate(stage_dir, source_path):
    stage_dir, source_path = Path(stage_dir), Path(source_path)
    source = feature_map(read(source_path)["features"])
    if any(not fid.startswith("US_CNTY_") for fid in source):
        raise ValueError("county source contains non-county IDs")
    manifest = read(stage_dir / "manifest.json")
    digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if manifest["source"]["us_county_source_sha256"] != digest:
        raise ValueError("source differs from candidate source identity")
    chunks = read(stage_dir / "detail_chunks.manifest.json")
    scenario_id = chunks["scenario_id"]
    if scenario_id != manifest["scenario_id"]:
        raise ValueError("candidate scenario identity mismatch")
    coarse, detail_shards, checked = {}, {}, []
    chunk_ids = set()
    for entry in chunks["chunks"]:
        if entry["id"] in chunk_ids:
            raise ValueError(f"duplicate chunk ID: {entry['id']}")
        chunk_ids.add(entry["id"])
        if entry["layer"] != "political" or entry["lod"] not in {"coarse", "detail"}:
            continue
        if entry["lod"] == "detail" and "US" not in entry.get("country_codes", []):
            continue
        features = load_chunk(stage_dir, scenario_id, entry)
        counties = [f for f in features if f["properties"]["id"] in source
                    or f["properties"]["id"].startswith("US_CNTY_")]
        geometries = feature_map(counties)
        if entry["lod"] == "coarse":
            if set(coarse) & set(geometries):
                raise ValueError("duplicate county across coarse chunks")
            coarse.update(geometries)
        elif geometries:
            detail_shards[entry["id"]] = geometries
        checked.append({"id": entry["id"], "sha256": entry["sha256"]})
    report = validate_lod_sets(source, coarse, detail_shards)
    report.update(source_sha256=digest, checked_chunks=checked)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", required=True, type=Path)
    parser.add_argument("--county-source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = validate(args.candidate_dir, args.county_source)
    except (ValueError, KeyError, OSError) as exc:
        report = {"status": "FAIL", "release_ready": False, "error": str(exc)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: val for key, val in report.items() if key not in {"shards", "checked_chunks"}}))
    raise SystemExit(0 if report["status"] == "PASS" else 1)
