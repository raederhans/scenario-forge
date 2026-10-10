"""Refresh only integrity metadata after publishing political raster assets."""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.check_scenario_contracts import _build_snapshot_for_scenario, _sha256_path


def refresh_snapshot(scenario_id: str) -> None:
    directory = ROOT / "data" / "scenarios" / scenario_id
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    snapshot = _build_snapshot_for_scenario(directory, manifest)
    manifest["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    audit_path = directory / "audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    # Keep the existing semantic audit findings; only its integrity pointers change.
    audit["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
    audit.setdefault("source", {})["build_snapshot_sha256"] = _sha256_path(directory / "build_snapshot.json")
    audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    for name in ("manifest.json", "build_snapshot.json", "audit.json"):
        target = directory / name
        sidecar = directory / f"{name}.gz"
        if sidecar.exists():
            sidecar.write_bytes(gzip.compress(target.read_bytes(), compresslevel=9, mtime=0))
    print(f"{scenario_id}: refreshed snapshot {snapshot['snapshot_fingerprint']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True, choices=("hoi4_1936", "hoi4_1939", "tno_1962"))
    refresh_snapshot(parser.parse_args().scenario)
