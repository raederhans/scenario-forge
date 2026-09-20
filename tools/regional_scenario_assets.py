"""Atomic, fail-closed scenario asset rebuild for an already-cropped candidate."""
from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import tempfile
import argparse
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
from shapely.geometry import shape
from topojson.utils import serialize_as_geojson

from map_builder.geo.topology import compute_neighbor_graph
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets, _resolve_feature_owner_bucket


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _features(path: Path) -> dict[str, dict[str, Any]]:
    payload = _read(path)
    if payload.get("type") != "Topology" or "political" not in payload.get("objects", {}):
        raise ValueError(f"Expected political Topology: {path}")
    payload = serialize_as_geojson(payload, objectname="political")
    result = {}
    for feature in payload.get("features", []):
        props = feature.get("properties") or {}
        fid = str(props.get("id") or feature.get("id") or "").strip()
        if not fid or fid in result:
            raise ValueError(f"invalid or duplicate political feature id in {path}")
        geom = feature.get("geometry")
        if not isinstance(geom, dict) or shape(geom).is_empty or not shape(geom).is_valid or shape(geom).geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"invalid political geometry {fid} in {path}")
        result[fid] = feature
    if not result:
        raise ValueError(f"Empty political topology: {path}")
    return result


def _objects(path: Path) -> dict[str, Any]:
    payload = _read(path)
    decoded = {}
    for name, obj in payload.get("objects", {}).items():
        if name == "political":
            continue
        if obj.get("type") != "GeometryCollection":
            payload["objects"][name] = {"type": "GeometryCollection", "geometries": [obj]}
        decoded[name] = serialize_as_geojson(payload, objectname=name)
    return decoded


def _local_path(directory: Path, url: str, scenario_id: str) -> Path:
    prefix = f"data/scenarios/{scenario_id}/"
    normalized = str(url).replace("\\", "/")
    if not normalized.startswith(prefix):
        raise ValueError(f"Expected scenario-local URL: {url}")
    path = (directory / normalized[len(prefix):]).resolve()
    if not path.is_relative_to(directory.resolve()) or path == directory.resolve():
        raise ValueError(f"URL escapes scenario directory: {url}")
    return path


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _same_geometry(left: dict, right: dict) -> bool:
    if left == right:
        return True
    a, b = shape(left), shape(right)
    return a.equals_exact(b, 0, normalize=True) or a.equals(b)


def _copy_gzip(path: Path) -> None:
    gz = Path(str(path) + ".gz")
    with path.open("rb") as source, gzip.GzipFile(filename=str(gz), mode="wb", compresslevel=9, mtime=0) as target:
        shutil.copyfileobj(source, target)


def _verify_gzip(path: Path) -> None:
    gz = Path(str(path) + ".gz")
    if not gz.exists():
        return
    with gzip.open(gz, "rb") as source:
        if source.read() != path.read_bytes():
            raise ValueError(f"gzip sidecar does not match JSON: {gz}")


def build_regional_scenario_assets(*, baseline_dir: Path | str, candidate_runtime_path: Path | str,
                                   output_dir: Path | str, candidate_owners_path: Path | str | None = None,
                                   added_feature_ids: tuple[str, ...] = (),
                                   removed_helper_ids: tuple[str, ...] = ()) -> dict[str, Any]:
    baseline = Path(baseline_dir).resolve()
    output = Path(output_dir).resolve()
    candidate_runtime = Path(candidate_runtime_path).resolve()
    if output.exists() or output.is_relative_to(baseline) or baseline.is_relative_to(output):
        raise ValueError("output_dir must be a new sibling directory, never baseline or nested")
    manifest = _read(baseline / "manifest.json")
    runtime_url = str(manifest.get("runtime_topology_url") or "").replace("\\", "/")
    scenario_id = str(manifest.get("scenario_id") or baseline.name)
    expected_prefix = f"data/scenarios/{scenario_id}/"
    if not runtime_url.startswith(expected_prefix):
        raise ValueError("runtime_topology_url must be inside data/scenarios/<scenario_id>/")
    old_runtime_path = _local_path(baseline, runtime_url, scenario_id)
    old = _features(old_runtime_path)
    new = _features(candidate_runtime)
    old_ids = set(old)
    new_ids = set(new)
    for declaration in (added_feature_ids, removed_helper_ids):
        if not isinstance(declaration, (tuple, list)) or any(
                not isinstance(fid, str) or not fid or fid != fid.strip() for fid in declaration):
            raise ValueError('Membership declarations must be lists/tuples of nonempty IDs')
    if added_feature_ids or removed_helper_ids:
        added_set = set(added_feature_ids)
        removed_set = set(removed_helper_ids)
        if len(added_set) != len(added_feature_ids):
            raise ValueError("Duplicate added_feature_ids declared")
        if len(removed_set) != len(removed_helper_ids):
            raise ValueError("Duplicate removed_helper_ids declared")
        if new_ids - old_ids != added_set:
            raise ValueError("Runtime new minus old does not equal explicitly declared additions")
        if old_ids - new_ids != removed_set:
            raise ValueError("Runtime old minus new does not equal explicitly declared removals")
        for fid in added_set:
            feature = new[fid]
            if not fid.startswith("RU_RAY_"):
                raise ValueError(f"Addition {fid} is not a valid RU_RAY_* id")
            if str(feature.get("properties", {}).get("id")) != fid:
                raise ValueError(f"Addition {fid} properties.id mismatch")
            if feature.get("properties", {}).get("interactive") is False:
                raise ValueError(f"Addition {fid} has interactive=False")
        for fid in removed_set:
            feature = old[fid]
            if not fid.startswith("RU_ARCTIC_FB_"):
                raise ValueError(f"Removal {fid} is not a valid RU_ARCTIC_FB_* id")
            props = feature.get("properties", {})
            if props.get("interactive") is not False:
                raise ValueError(f"Removal {fid} is not interactive=False")
            if props.get("scenario_helper_kind") != "shell_fallback":
                raise ValueError(f"Removal {fid} is not shell_fallback")
    else:
        if old_ids != new_ids:
            raise ValueError("candidate political IDs differ: split/merge is not supported")
    common_ids = old_ids.intersection(new_ids)
    changed = {fid for fid in common_ids if old[fid].get("properties", {}) != new[fid].get("properties", {}) or
               not _same_geometry(old[fid]["geometry"], new[fid]["geometry"])}
    nonpolitical_old = {k: v for k, v in _objects(old_runtime_path).items() if k != "political"}
    nonpolitical_new = {k: v for k, v in _objects(candidate_runtime).items() if k != "political"}
    if nonpolitical_old != nonpolitical_new:
        raise ValueError("non-political runtime topology objects changed; use full builder")
    staging_parent = output.parent
    staging_parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.staging-", dir=staging_parent))
    try:
        shutil.copytree(baseline, staging, dirs_exist_ok=True)
        target_runtime = _local_path(staging, runtime_url, scenario_id)
        target_runtime.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate_runtime, target_runtime)
        if candidate_owners_path:
            shutil.copy2(Path(candidate_owners_path), staging / "owners.by_feature.json")
        old_owners = _read(baseline / "owners.by_feature.json").get("owners", {}) if (baseline / "owners.by_feature.json").exists() else {}
        new_owners = _read(staging / "owners.by_feature.json").get("owners", {}) if (staging / "owners.by_feature.json").exists() else {}
        for owners in (old_owners, new_owners):
            if not isinstance(owners, dict) or any(not isinstance(v, str) or not v.strip() for v in owners.values()):
                raise ValueError("Owner map is invalid")
        if added_feature_ids:
            registered = _read(staging / 'countries.json').get('countries', {})
            for fid in added_feature_ids:
                owner = new_owners.get(fid)
                if not owner or owner == "SOV" or owner not in registered:
                    raise ValueError(f"Addition {fid} must have registered country non-SOV owner")
        # TNO also keeps owner records for auxiliary Atlantropa objects. Those
        # records belong to the context pipeline and must be preserved verbatim.
        if ({k: v for k, v in old_owners.items() if k not in old_ids}
                != {k: v for k, v in new_owners.items() if k not in new_ids}):
            raise ValueError("Non-political owner records changed; full context rebuild required")
        owner_changed = {fid for fid in common_ids if old_owners.get(fid) != new_owners.get(fid)}
        def buckets(features, owners):
            return {fid: _resolve_feature_owner_bucket(f, scenario_dir=baseline,
                    owners_by_feature_id=owners, fallback_index=i)
                    for i, (fid, f) in enumerate(features.items())}
        old_buckets, new_buckets = buckets(old, old_owners), buckets(new, new_owners)
        affected_ids = changed | owner_changed | set(added_feature_ids) | set(removed_helper_ids)
        affected_owners = {b[fid] for fid in affected_ids for b in (old_buckets, new_buckets) if fid in b}
        old_manifest = _read(baseline / "detail_chunks.manifest.json") if (baseline / "detail_chunks.manifest.json").exists() else {"chunks": []}
        reusable = {}
        cached_ids_by_owner = {}
        for entry in old_manifest.get("chunks", []):
            if entry.get("layer") != "political" or entry.get("lod") != "detail":
                continue
            if set(entry.get("country_codes") or []) & affected_owners:
                continue
            source = _local_path(baseline, entry.get("url", ""), scenario_id)
            if not source.exists() or _digest(source) != str(entry.get("sha256") or "") or source.stat().st_size != entry.get("byte_size"):
                raise ValueError(f"baseline political chunk cache failed validation: {entry.get('id')}")
            _verify_gzip(source)
            features = _read(source).get("features", [])
            expected = {fid for fid, owner in old_buckets.items() if owner in entry.get("country_codes", [])}
            cached_ids = [(f.get("properties") or {}).get("id") for f in features]
            chunk_owners = entry.get("country_codes") or []
            if len(chunk_owners) != 1:
                raise ValueError(f"Cached political chunk needs one owner: {entry['id']}")
            owner = chunk_owners[0]
            seen_ids = cached_ids_by_owner.setdefault(owner, set())
            if (len(cached_ids) != len(set(cached_ids)) or not set(cached_ids).issubset(expected)
                    or seen_ids.intersection(cached_ids)):
                raise ValueError(f"Cached chunk membership differs from runtime: {entry['id']}")
            seen_ids.update(cached_ids)
            for feature in features:
                original = old[feature["properties"]["id"]]
                if feature["properties"] != original["properties"] or not _same_geometry(feature["geometry"], original["geometry"]):
                    raise ValueError(f"Cached chunk differs from runtime: {entry['id']}")
            destination = staging / source.relative_to(baseline)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            if source.with_name(source.name + ".gz").exists():
                shutil.copy2(source.with_name(source.name + ".gz"), destination.with_name(destination.name + ".gz"))
            reusable[str(entry["id"])] = dict(entry)
        for owner in cached_ids_by_owner:
            expected = {fid for fid, bucket in old_buckets.items() if bucket == owner}
            if cached_ids_by_owner.get(owner, set()) != expected:
                raise ValueError(f"Cached owner shard set is incomplete: {owner}")
        # Remove stale affected owner chunks from the staging copy. The builder
        # will recreate only owners present in the candidate; an owner that lost
        # all features must not survive by virtue of baseline copying.
        for entry in old_manifest.get("chunks", []):
            if entry.get("layer") != "political" or entry.get("lod") != "detail":
                continue
            if not (set(entry.get("country_codes") or []) & affected_owners):
                continue
            raw_url = str(entry.get("url") or "").replace("\\", "/")
            stale = _local_path(staging, raw_url, scenario_id)
            for stale_path in (stale, stale.with_name(stale.name + ".gz")):
                stale_path.unlink(missing_ok=True)
        context_chunks = [dict(entry) for entry in old_manifest.get("chunks", []) if entry.get("layer") != "political"]
        context_layers = (_read(baseline / "context_lod.manifest.json").get("layers", {})
                          if (baseline / "context_lod.manifest.json").exists() else {})
        context_layers = {k: v for k, v in context_layers.items() if k != "political"}
        for entry in context_chunks:
            source = _local_path(baseline, entry.get("url", ""), scenario_id)
            if not source.exists() or _digest(source) != entry.get("sha256") or source.stat().st_size != entry.get("byte_size"):
                raise ValueError(f"Context chunk cache failed validation: {entry['id']}")
            _verify_gzip(source)
        report = {"scenario_id": scenario_id, "changed_ids": sorted(changed), "owner_changed_ids": sorted(owner_changed),
                  "added_ids": sorted(added_feature_ids), "removed_ids": sorted(removed_helper_ids), "reused_baseline": True,
                  "reused_political_detail_chunks": sorted(reusable), "reused_context_chunks": len(context_chunks),
                  "old_runtime_sha256": _digest(old_runtime_path), "candidate_runtime_sha256": _digest(candidate_runtime),
                  "directly_affected_owner_chunks": sorted(affected_owners - {""}), "status": "staged",
                  "release_ready": False, "remaining_stages": ["scenario_semantic_and_boundary_validation", "startup_bootstrap_and_bundles", "snapshot_fingerprint_and_audit", "browser_runtime_validation"]}
        _copy_gzip(target_runtime)
        manifest_payload = _read(staging / "manifest.json")
        candidate_payload = _read(target_runtime)
        candidate_payload["objects"]["political"]["computed_neighbors"] = compute_neighbor_graph(
            gpd.GeoDataFrame.from_features(list(new.values()), crs="EPSG:4326"))
        target_runtime.write_text(json.dumps(candidate_payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        layer_payloads = {}
        for layer, field in {"water": "water_regions_url", "special": "special_regions_url", "relief": "relief_overlays_url", "cities": "city_overrides_url"}.items():
            if manifest_payload.get(field):
                layer_payloads[layer] = _read(_local_path(staging, manifest_payload[field], scenario_id))
        result = build_and_write_scenario_chunk_assets(
            scenario_dir=staging, manifest_payload=manifest_payload,
            runtime_topology_payload=candidate_payload, startup_topology_payload=None, layer_payloads=layer_payloads,
            startup_topology_url=manifest_payload.get("startup_topology_url", ""),
            runtime_topology_url=runtime_url,
            reusable_political_chunks=reusable,
            reusable_context_assets={"chunks": context_chunks, "layers": context_layers},
        )
        manifest_payload["source"] = {**manifest_payload.get("source", {}), "runtime_topology_sha256": _digest(target_runtime), "detail_chunk_manifest_sha256": _digest(staging / "detail_chunks.manifest.json")}
        (staging / "manifest.json").write_text(json.dumps(manifest_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report.update({"status": "candidate", "adjacency_recomputed": True, "runtime_sha256": _digest(target_runtime)})
        (staging / "regional_rebuild.report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        for json_path in staging.rglob("*.json"):
            if Path(str(json_path) + ".gz").exists():
                try:
                    _verify_gzip(json_path)
                    continue
                except (ValueError, OSError, EOFError):
                    pass
            _copy_gzip(json_path)
        if output.exists():
            raise FileExistsError(output)
        staging.rename(output)
        return report | {"build_result": {"detail_chunks": len(result.get("detail_chunk_manifest", {}).get("chunks", []))}}
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", required=True, type=Path)
    parser.add_argument("--candidate-runtime", required=True, type=Path)
    parser.add_argument("--candidate-owners", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(build_regional_scenario_assets(baseline_dir=args.baseline_dir,
        candidate_runtime_path=args.candidate_runtime, candidate_owners_path=args.candidate_owners,
        output_dir=args.output_dir), ensure_ascii=False, indent=2))
