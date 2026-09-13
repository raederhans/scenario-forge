"""Lossless encoding at the Pages artifact boundary; source data stays untouched."""
from __future__ import annotations

import gzip
import hashlib
import json
import re
from pathlib import Path

from tools.political_detail_partition import (
    feature_bounds, geometry_coordinates, geometry_part_count,
    partition_political_detail_features, political_detail_chunk_ids,
)

_JSON_TOKEN_OR_SPACE = re.compile(rb'("(?:\\.|[^"\\])*")|[ \t\r\n]+')
_JSON_SUFFIXES = {".json", ".geojson", ".topojson"}


def compact_json_bytes(raw: bytes) -> bytes:
    # Keep number spelling, escapes, Unicode and whitespace inside strings exact.
    return _JSON_TOKEN_OR_SPACE.sub(lambda match: match[1] or b"", raw)


def _write_json(path: Path, payload: object) -> None:
    path.write_bytes(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _local_data_path(app_root: Path, url: str) -> Path:
    path = (app_root / url).resolve()
    if not path.is_relative_to((app_root / "data").resolve()):
        raise ValueError(f"Published data URL escapes app/data: {url}")
    return path


def _raw_feature_tokens(raw: bytes) -> list[bytes]:
    """Extract original JSON feature tokens without rewriting coordinate numbers."""
    text = raw.decode("utf-8")
    decoder = json.JSONDecoder()
    cursor = 1  # compact top-level object
    while cursor < len(text):
        key, cursor = decoder.raw_decode(text, cursor)
        cursor += 1  # colon
        if key == "features":
            cursor += 1  # opening array
            tokens = []
            while text[cursor] != "]":
                _feature, end = decoder.raw_decode(text, cursor)
                tokens.append(text[cursor:end].encode("utf-8"))
                cursor = end + (text[end] == ",")
            return tokens
        _value, cursor = decoder.raw_decode(text, cursor)
        if text[cursor] == "}":
            break
        cursor += 1
    raise ValueError("Political detail payload is missing features")


def _partition_published_details(app_root: Path, manifest_path: Path, manifest: dict, source_sizes: dict) -> None:
    """Apply the source generator's shard policy to existing whole-owner assets."""
    chunks = []
    replacements = {}
    for chunk in manifest.get("chunks", []):
        # Already partitioned source chunks use their canonical grouping.
        if chunk.get("layer") != "political" or chunk.get("lod") != "detail" or ".part." in chunk.get("id", ""):
            chunks.append(chunk)
            continue
        path = _local_data_path(app_root, str(chunk.get("url") or ""))
        if not path.is_relative_to((manifest_path.parent / "chunks").resolve()):
            raise ValueError("Political detail chunk escapes its scenario chunks directory")
        if path.suffix == ".gz":
            chunks.append(chunk)
            continue
        raw = path.read_bytes()
        payload = json.loads(raw)
        # Preserve additional collection metadata by retaining such a collection
        # intact; canonical political detail collections have only these keys.
        if payload.get("type") != "FeatureCollection" or set(payload) != {"type", "features"}:
            chunks.append(chunk)
            continue
        entries = [(str((feature.get("properties") or {}).get("id") or feature.get("id") or ""),
                    feature, feature_bounds(feature)) for feature in payload["features"]]
        if any(not entry[0] for entry in entries) or len({entry[0] for entry in entries}) != len(entries):
            raise ValueError(f"Political detail feature IDs are missing or duplicate: {path}")
        tokens = dict(zip((entry[0] for entry in entries), _raw_feature_tokens(raw), strict=True))
        shards = partition_political_detail_features(entries, feature_compact_sizes={fid: len(token) for fid, token in tokens.items()})
        if len(shards) <= 1:
            chunks.append(chunk)
            continue
        owner = chunk.get("owner_code") or (chunk.get("country_codes") or [""])[0]
        if not owner:
            raise ValueError(f"Political detail owner is missing: {path}")
        ids = political_detail_chunk_ids(owner, len(shards))
        replacements[chunk["id"]] = ids
        for chunk_id, shard in zip(ids, shards, strict=True):
            shard_path = path.with_name(chunk_id + ".json")
            # Keep source ordering inside each shard as well as exact tokens.
            selected = {entry[0] for entry in shard}
            shard = [entry for entry in entries if entry[0] in selected]
            shard_raw = b'{"type":"FeatureCollection","features":[' + b','.join(tokens[entry[0]] for entry in shard) + b']}'
            shard_path.write_bytes(shard_raw)
            old_weight = max(int(chunk.get("cache_byte_size") or 0), source_sizes.get(path, len(raw)))
            source_sizes[shard_path.resolve()] = max(len(shard_raw), round(old_weight * len(shard_raw) / len(raw)))
            coord_count = sum(sum(1 for _ in geometry_coordinates(entry[1].get("geometry"))) for entry in shard)
            part_count = sum(geometry_part_count(entry[1].get("geometry")) for entry in shard)
            metadata = dict(chunk)
            metadata.update(id=chunk_id, url=shard_path.relative_to(app_root).as_posix(), owner_code=owner,
                            country_codes=[owner], feature_count=len(shard), coord_count=coord_count, part_count=part_count,
                            estimated_path_cost=coord_count + 8 * part_count + 3 * len(shard),
                            bounds=[min(entry[2][0] for entry in shard), min(entry[2][1] for entry in shard),
                                    max(entry[2][2] for entry in shard), max(entry[2][3] for entry in shard)],
                            feature_bounds=[entry[2] for entry in shard])
            metadata.pop("cache_byte_size", None)
            chunks.append(metadata)
    manifest["chunks"] = chunks
    if not replacements:
        return
    meta_path = manifest_path.parent / "runtime_meta.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_bytes())
        counts = {}
        for chunk in chunks:
            layer = chunk.get("layer", "")
            counts[layer] = counts.get(layer, 0) + 1
        meta.update(total_chunk_count=len(chunks), political_chunk_count=counts.get("political", 0), layer_chunk_counts=counts)
        _write_json(meta_path, meta)
    context_path = manifest_path.parent / "context_lod.manifest.json"
    if context_path.is_file():
        context = json.loads(context_path.read_bytes())
        for entries in context.get("layers", {}).values():
            for entry in entries:
                entry["chunk_ids"] = [new for old in entry.get("chunk_ids", []) for new in replacements.get(old, [old])]
        _write_json(context_path, context)


def _refresh_scenario_source_hashes(app_root: Path) -> None:
    for manifest_path in sorted((app_root / "data/scenarios").glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_bytes())
        source = manifest.get("source")
        if not isinstance(source, dict):
            continue
        paths = {
            "base_topology_sha256": app_root / "data/europe_topology.json",
            "runtime_topology_sha256": manifest_path.parent / "runtime_topology.topo.json",
            "runtime_bootstrap_topology_sha256": manifest_path.parent / "runtime_topology.bootstrap.topo.json",
            "detail_chunk_manifest_sha256": manifest_path.parent / "detail_chunks.manifest.json",
            "countries_sha256": manifest_path.parent / "countries.json",
            "owners_sha256": manifest_path.parent / "owners.by_feature.json",
            "cores_sha256": manifest_path.parent / "cores.by_feature.json",
        }
        hashes = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items() if path.is_file()}
        # Replace only digest string tokens. Geometry and numeric tokens in the
        # startup bundle stay byte exact, including beyond float precision.
        for path in [manifest_path, *sorted(manifest_path.parent.glob("startup.bundle.*.json"))]:
            raw = path.read_bytes()
            for key, digest in hashes.items():
                pattern = rb'("' + key.encode('ascii') + rb'":")[a-fA-F0-9]{64}(")'
                raw = re.sub(pattern, lambda match: match[1] + digest.encode('ascii') + match[2], raw)
            path.write_bytes(raw)


def pack_published_runtime_data(app_root: Path, *, byte_exact_paths=()) -> dict:
    """Compact JSON, gzip registered chunks, and refresh delivery integrity records.

    This operates only on a freshly copied artifact. Source provenance fields in
    catalogs/build snapshots are intentionally retained; delivery manifests are
    refreshed. Cache weights retain the pre-encoding source size, which was the
    existing retention policy, independently of the new transfer size.
    """
    app_root = app_root.resolve()
    data_root = app_root / "data"
    excluded = {(app_root / path).resolve() for path in byte_exact_paths}
    source_sizes = {}
    compacted_count = 0
    whitespace_saved = 0
    for path in sorted(data_root.rglob("*")):
        if not path.is_file() or path.suffix not in _JSON_SUFFIXES or path.resolve() in excluded:
            continue
        raw = path.read_bytes()
        source_sizes[path.resolve()] = len(raw)
        compact = compact_json_bytes(raw)
        if compact != raw:
            path.write_bytes(compact)
            compacted_count += 1
            whitespace_saved += len(raw) - len(compact)

    chunk_count = 0
    gzip_saved = 0
    for manifest_path in sorted((data_root / "scenarios").glob("*/detail_chunks.manifest.json")):
        manifest = json.loads(manifest_path.read_bytes())
        _partition_published_details(app_root, manifest_path, manifest, source_sizes)
        chunks_dir = (manifest_path.parent / "chunks").resolve()
        referenced_paths = set()
        for chunk in manifest.get("chunks", []):
            url = str(chunk.get("url") or "")
            path = _local_data_path(app_root, url)
            # Only registered scenario chunks are migrated. Unrelated resource
            # contracts and author-side manifests retain their current URLs.
            if not path.is_relative_to(chunks_dir):
                raise ValueError(f"Chunk URL is outside its scenario chunks directory: {url}")
            if path.suffix == ".gz":
                referenced_paths.add(path)
                continue
            if path.suffix not in _JSON_SUFFIXES or not path.is_file():
                raise ValueError(f"Missing or unsupported published chunk: {url}")
            decoded = path.read_bytes()
            encoded = gzip.compress(decoded, compresslevel=6, mtime=0)
            encoded_path = path.with_name(path.name + ".gz")
            encoded_path.write_bytes(encoded)
            chunk.update(
                url=url + ".gz", encoding="gzip", byte_size=len(encoded),
                decoded_byte_size=len(decoded),
                cache_byte_size=max(int(chunk.get("cache_byte_size") or 0), source_sizes.get(path, len(decoded))),
                sha256=hashlib.sha256(encoded).hexdigest(),
            )
            referenced_paths.add(encoded_path)
            path.unlink()
            chunk_count += 1
            gzip_saved += len(decoded) - len(encoded)
        _write_json(manifest_path, manifest)
        # Old whole-owner files may remain after a scoped source rebuild. Only
        # copied generated chunks are pruned, never anything in source data/.
        for path in chunks_dir.glob("*"):
            if path.is_file() and path.resolve() not in referenced_paths and (
                path.suffix in _JSON_SUFFIXES or path.name.endswith(".json.gz")
            ):
                path.unlink()

    _refresh_scenario_source_hashes(app_root)

    # Existing startup sidecars must exactly match any newly compacted plain
    # payload. Keep the plain startup fallback until its contract is migrated.
    for path in sorted(data_root.rglob("*.json.gz")):
        plain = path.with_suffix("")
        if plain.is_file() and plain.resolve() not in excluded:
            path.write_bytes(gzip.compress(plain.read_bytes(), compresslevel=6, mtime=0))

    manifest_path = data_root / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_bytes())
        for name, record in manifest.get("outputs", {}).items():
            path = _local_data_path(app_root, "data/" + name)
            if not path.is_file() or not isinstance(record, dict):
                continue
            raw = path.read_bytes()
            record.update(size_bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
        _write_json(manifest_path, manifest)
    return {"compacted_files": compacted_count, "whitespace_saved_bytes": whitespace_saved,
            "gzip_chunk_count": chunk_count, "gzip_saved_bytes": gzip_saved}
