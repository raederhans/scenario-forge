"""Freeze-report the current GeoNames cities15000 upstream without changing local data."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import requests


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.io.fetch import _provenance_path
from map_builder.io.writers import write_json_atomic


DATA_DIR = PROJECT_ROOT / "data"
REPORT_DIR = PROJECT_ROOT / ".runtime" / "reports" / "generated"
REPORT_PATH = REPORT_DIR / "geonames_freeze_report.json"


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _hash_remote_payload(url: str) -> tuple[str, int]:
    digest = hashlib.sha256()
    size_bytes = 0
    with requests.get(url, timeout=(20, 300), stream=True) as response:
        response.raise_for_status()
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            size_bytes += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size_bytes


def main() -> None:
    local_path = DATA_DIR / cfg.GEONAMES_CITIES15000_FILENAME
    if not local_path.exists():
        raise SystemExit(f"Missing local GeoNames cache: {local_path}")

    provenance_path = _provenance_path(local_path)
    local_sha = _sha256_path(local_path)
    remote_sha, remote_size = _hash_remote_payload(cfg.GEONAMES_CITIES15000_URL)
    payload = {
        "source_id": "geonames_cities15000",
        "local_path": f"data/{local_path.name}",
        "local_provenance_path": f"data/{provenance_path.name}",
        "configured_source_url": cfg.GEONAMES_CITIES15000_URL,
        "local_sha256": local_sha,
        "local_size_bytes": int(local_path.stat().st_size),
        "remote_sha256": remote_sha,
        "remote_size_bytes": int(remote_size),
        "hash_match": local_sha == remote_sha,
        "requires_upgrade_review": local_sha != remote_sha,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json_atomic(REPORT_PATH, payload, ensure_ascii=False, indent=2, trailing_newline=True)
    print(
        "[geonames-freeze] "
        f"hash_match={payload['hash_match']} "
        f"local_sha256={local_sha} remote_sha256={remote_sha}"
    )
    print(f"[geonames-freeze] Report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()

