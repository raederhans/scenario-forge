"""JSON source I/O, including the canonical gzip-only runtime topology."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path

RUNTIME_TOPOLOGY_FILENAME = "runtime_topology.topo.json"


def resolve_json_source_path(path: Path | str) -> Path:
    path = Path(path)
    if not path.exists() and path.name == RUNTIME_TOPOLOGY_FILENAME:
        compressed = path.with_name(path.name + ".gz")
        if compressed.exists():
            return compressed
    return path


def read_json_bytes(path: Path | str) -> bytes:
    source = resolve_json_source_path(path)
    raw = source.read_bytes()
    return gzip.decompress(raw) if source.suffix == ".gz" else raw


def read_json_source(path: Path | str) -> object:
    return json.loads(read_json_bytes(path).decode("utf-8-sig"))


def json_source_sha256(path: Path | str) -> str:
    return hashlib.sha256(resolve_json_source_path(path).read_bytes()).hexdigest()


def portable_gzip_bytes(raw: bytes) -> bytes:
    # Same portable header contract as tools.runtime_json_packing. Keep this
    # stdlib-only source layer independent of the Pages packing toolchain.
    encoded = gzip.compress(raw, compresslevel=6, mtime=0)
    return encoded[:9] + b"\xff" + encoded[10:]


def _write_bytes_atomic(path: Path, content: bytes) -> None:
    # Match the existing writers' replacement and Windows sharing retry policy
    # without importing their geopandas dependency into this source reader.
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        for attempt in range(5):
            try:
                temporary.replace(path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.25)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def write_runtime_topology_source(
    scenario_dir: Path | str,
    payload: object,
    max_bytes: int = 100 * 1024 * 1024,
) -> Path:
    """Write exact compact JSON, choosing gzip only at the storage limit."""
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 0:
        raise ValueError("max_bytes must be a non-negative integer")
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    plain = Path(scenario_dir) / RUNTIME_TOPOLOGY_FILENAME
    compressed = plain.with_name(plain.name + ".gz")
    target, content = (plain, raw) if len(raw) < max_bytes else (compressed, portable_gzip_bytes(raw))
    if len(content) >= max_bytes:
        raise ValueError(f"runtime topology storage is {len(content)} bytes (limit {max_bytes})")
    _write_bytes_atomic(target, content)
    # This generated source has exactly one canonical representation. In
    # particular, a previous gzip sidecar must not outlive a new plain source.
    (compressed if target == plain else plain).unlink(missing_ok=True)
    compressed.with_name(compressed.name + ".gz").unlink(missing_ok=True)
    return target
