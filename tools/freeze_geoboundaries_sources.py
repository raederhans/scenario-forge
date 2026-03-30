"""Verify geoBoundaries sources are frozen to official static links without byte drift."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.source_smoke_catalog import SOURCE_GROUPS, SOURCE_SPECS


DATA_DIR = PROJECT_ROOT / "data"
REPORT_DIR = PROJECT_ROOT / ".runtime" / "reports" / "generated"
REPORT_PATH = REPORT_DIR / "geoboundaries_freeze_report.json"


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_url(url: str) -> str:
    digest = hashlib.sha256()
    with requests.get(url, timeout=(20, 120), stream=True) as response:
        response.raise_for_status()
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            digest.update(chunk)
    return digest.hexdigest()


def _metadata_url(spec: dict[str, object]) -> str:
    return f"https://www.geoboundaries.org/api/current/gbOpen/{spec['iso']}/{spec['adm']}/"


def main() -> None:
    failures: list[str] = []
    report_entries: list[dict[str, object]] = []
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    for source_key in SOURCE_GROUPS["geoboundaries_phase2"]:
        spec = SOURCE_SPECS[source_key]
        local_path = DATA_DIR / str(spec["filename"])
        if not local_path.exists():
            failures.append(f"[{source_key}] Missing local cache file: {local_path}")
            continue

        metadata_url = _metadata_url(spec)
        metadata = requests.get(metadata_url, timeout=(10, 30)).json()
        configured_url = str(spec["url"])
        fallback_urls = list(spec["fallback_urls"])
        official_url = str(metadata["gjDownloadURL"])
        local_sha = _sha256_path(local_path)
        remote_sha = _sha256_url(official_url)
        entry = {
            "source_key": source_key,
            "label": spec["label"],
            "iso": spec["iso"],
            "adm": spec["adm"],
            "filename": spec["filename"],
            "metadata_url": metadata_url,
            "boundaryID": metadata.get("boundaryID"),
            "buildDate": metadata.get("buildDate"),
            "gjDownloadURL": official_url,
            "staticDownloadLink": metadata.get("staticDownloadLink"),
            "configured_url": configured_url,
            "fallback_urls": fallback_urls,
            "local_sha256": local_sha,
            "remote_sha256": remote_sha,
            "hash_match": local_sha == remote_sha,
            "config_url_match": configured_url == official_url,
            "fallbacks_cleared": fallback_urls == [],
        }
        report_entries.append(entry)

        if not entry["hash_match"]:
            failures.append(
                f"[{source_key}] Hash drift detected: local={local_sha} remote={remote_sha}"
            )
        if not entry["config_url_match"]:
            failures.append(
                f"[{source_key}] Config URL is not frozen to gjDownloadURL: {configured_url}"
            )
        if not entry["fallbacks_cleared"]:
            failures.append(f"[{source_key}] fallback_urls must be empty after freeze.")

        print(
            f"[geoboundaries-freeze] {source_key}: "
            f"hash_match={entry['hash_match']} config_url_match={entry['config_url_match']}"
        )

    REPORT_PATH.write_text(json.dumps(report_entries, ensure_ascii=False, indent=2), encoding="utf-8")

    if failures:
        for failure in failures:
            print(failure, file=sys.stderr)
        raise SystemExit(1)

    print(f"[geoboundaries-freeze] Report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
