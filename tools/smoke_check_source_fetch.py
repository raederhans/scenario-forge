"""Smoke-check selected upstream sources in an isolated temporary cache."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.io.fetch import fetch_or_load_geojson


CANONICAL_DATA_DIR = PROJECT_ROOT / "data"
SMOKE_CACHE_DIR = PROJECT_ROOT / ".runtime" / "tmp" / "source_smoke"

SOURCE_SPECS = {
    "fr_arr": {
        "label": "France arrondissements",
        "url": cfg.FR_ARR_URL,
        "filename": cfg.FR_ARR_FILENAME,
        "fallback_urls": cfg.FR_ARR_FALLBACK_URLS,
    },
    "pl_powiaty": {
        "label": "Poland powiaty",
        "url": cfg.PL_POWIATY_URL,
        "filename": cfg.PL_POWIATY_FILENAME,
        "fallback_urls": cfg.PL_POWIATY_FALLBACK_URLS,
    },
}


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _provenance_path(cache_path: Path) -> Path:
    suffix = cache_path.suffix
    stem = cache_path.name[:-len(suffix)] if suffix else cache_path.name
    return cache_path.with_name(f"{stem}.provenance.json")


def _run_source_smoke(source_key: str) -> None:
    spec = SOURCE_SPECS[source_key]
    canonical_path = CANONICAL_DATA_DIR / spec["filename"]
    if not canonical_path.exists():
        raise SystemExit(f"[{source_key}] Missing canonical cache file: {canonical_path}")

    fetch_or_load_geojson(
        spec["url"],
        spec["filename"],
        fallback_urls=spec["fallback_urls"],
    )

    smoke_path = SMOKE_CACHE_DIR / spec["filename"]
    if not smoke_path.exists():
        raise SystemExit(f"[{source_key}] Smoke cache file missing: {smoke_path}")

    provenance_path = _provenance_path(smoke_path)
    if not provenance_path.exists():
        raise SystemExit(f"[{source_key}] Provenance sidecar missing: {provenance_path}")

    canonical_hash = _sha256_path(canonical_path)
    smoke_hash = _sha256_path(smoke_path)
    if canonical_hash != smoke_hash:
        raise SystemExit(
            f"[{source_key}] Hash mismatch. canonical={canonical_hash} smoke={smoke_hash}"
        )

    provenance_payload = json.loads(provenance_path.read_text(encoding="utf-8"))
    if provenance_payload.get("sha256") != smoke_hash:
        raise SystemExit(
            f"[{source_key}] Provenance sha256 mismatch: {provenance_payload.get('sha256')} != {smoke_hash}"
        )
    if provenance_payload.get("capture_mode") != "downloaded":
        raise SystemExit(
            f"[{source_key}] Expected capture_mode=downloaded, found {provenance_payload.get('capture_mode')!r}"
        )
    if not str(provenance_payload.get("resolved_source_url") or "").strip():
        raise SystemExit(f"[{source_key}] resolved_source_url must be recorded.")

    print(
        f"[source-smoke] {source_key}: ok "
        f"hash={smoke_hash} resolved={provenance_payload.get('resolved_source_url')}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Smoke-check selected upstream fetch targets.")
    parser.add_argument(
        "--source",
        action="append",
        choices=sorted(SOURCE_SPECS),
        help="Source key to validate. Defaults to all supported keys.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    selected_sources = args.source or sorted(SOURCE_SPECS)
    shutil.rmtree(SMOKE_CACHE_DIR, ignore_errors=True)
    SMOKE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["MAPCREATOR_DATA_CACHE_DIR"] = str(SMOKE_CACHE_DIR)
    for source_key in selected_sources:
        _run_source_smoke(source_key)
    print("[source-smoke] All selected sources passed.")


if __name__ == "__main__":
    main()
