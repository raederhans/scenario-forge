"""Backfill source provenance and build the checked-in source ledger."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.io.fetch import (
    _ensure_cache_backfill_provenance,
    _provenance_path,
    _validate_cached_payload,
    _validate_json_bytes,
    _validate_vector_archive_bytes,
    fetch_or_cache_binary,
)
from map_builder.io.writers import write_json_atomic
from tools.source_governance_catalog import LEDGER_SOURCE_SPECS


DATA_DIR = PROJECT_ROOT / "data"
LEDGER_PATH = DATA_DIR / "source_ledger.json"


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _ensure_governance_provenance(spec: dict[str, object]) -> Path:
    filename = str(spec["filename"])
    configured_source_url = str(spec["configured_source_url"])
    fallback_urls = list(spec["fallback_urls"])
    fetch_kind = str(spec["fetch_kind"])
    cache_path = DATA_DIR / filename
    if not cache_path.exists():
        raise SystemExit(f"Missing local source file for ledger build: {cache_path}")

    if fetch_kind == "binary":
        fetch_or_cache_binary(
            configured_source_url,
            filename,
            fallback_urls=fallback_urls,
            min_size_bytes=int(spec["min_size_bytes"]),
        )
        return _provenance_path(cache_path)

    if fetch_kind == "geojson":
        validator = _validate_json_bytes
    elif fetch_kind == "vector_archive":
        validator = _validate_vector_archive_bytes
    else:
        raise SystemExit(f"Unsupported fetch kind for provenance backfill: {fetch_kind}")

    _validate_cached_payload(cache_path, validator, filename)
    _ensure_cache_backfill_provenance(
        cache_path=cache_path,
        configured_source_url=configured_source_url,
        fallback_candidates=fallback_urls,
        validator_name=str(spec["validator_name"]),
    )
    return _provenance_path(cache_path)


def main() -> None:
    ledger_entries: list[dict[str, object]] = []
    for spec in sorted(LEDGER_SOURCE_SPECS, key=lambda item: str(item["source_id"])):
        local_path = DATA_DIR / str(spec["filename"])
        provenance_path = _ensure_governance_provenance(spec)
        ledger_entries.append(
            {
                "source_id": spec["source_id"],
                "local_path": spec["local_path"],
                "origin_kind": spec["origin_kind"],
                "upstream_url": spec["configured_source_url"],
                "immutable_ref": spec["immutable_ref"],
                "current_local_sha256": _sha256_path(local_path),
                "license": spec["license"],
                "citation": spec["citation"],
                "consumers": spec["consumers"],
                "rebuild_command": spec["rebuild_command"],
                "provenance_sidecar": f"data/{provenance_path.name}",
                "status": spec["status"],
            }
        )
    write_json_atomic(LEDGER_PATH, ledger_entries, ensure_ascii=False, indent=2, trailing_newline=True)
    print(f"[source-ledger] Wrote {len(ledger_entries)} entries to {LEDGER_PATH}")


if __name__ == "__main__":
    main()

