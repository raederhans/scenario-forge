#!/usr/bin/env python3
"""Register pinned quick-fill inputs/outputs without touching unrelated asset metadata."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPECS = {
    "quick_fill/reference/china-pca-2017.json": ("quick_fill_china_reference", "source", "schema://quick_fill/china_reference/v1"),
    "quick_fill/china_prefecture_crosswalk.v1.json": ("quick_fill_prefecture_crosswalk", "derived", "schema://quick_fill/prefecture_crosswalk/v1"),
}


def main() -> None:
    data = ROOT / "data"
    manifest_path = data / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for relative, (role, artifact_class, schema_ref) in SPECS.items():
        payload = (data / relative).read_bytes()
        manifest["outputs"][relative] = {
            "role": role, "artifact_class": artifact_class, "owner": "quick_fill_hierarchy",
            "description": "Pinned, geometry-free reference for audited quick-fill membership.",
            "size_bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(),
            "schema_ref": schema_ref, "type": "json",
        }
    payload = (data / "hierarchy.json").read_bytes()
    manifest["outputs"]["hierarchy.json"].update(size_bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    ledger_path = data / "source_ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    source_id = "china_pca_2017_quick_fill_reference"
    ledger = [entry for entry in ledger if entry.get("source_id") != source_id]
    relative = "quick_fill/reference/china-pca-2017.json"
    ledger.append({
        "source_id": source_id, "local_path": "data/" + relative, "origin_kind": "download",
        "upstream_url": "https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/e01c078c68e044242bfcc4d26a970b2314b098cd/dist/pca-code.json",
        "immutable_ref": "e01c078c68e044242bfcc4d26a970b2314b098cd / 2017-10-31 code reference",
        "current_local_sha256": manifest["outputs"][relative]["sha256"],
        "license": "WTFPL-2.0; see data/quick_fill/reference/LICENSE.china-pca.txt",
        "citation": "modood/Administrative-divisions-of-China, pinned NBS code reference; not a boundary accuracy assertion",
        "consumers": ["tools/build_china_prefecture_crosswalk.py", "data/quick_fill/china_prefecture_crosswalk.v1.json"],
        "rebuild_command": "python tools/build_china_prefecture_crosswalk.py",
        "provenance_sidecar": "data/quick_fill/china_prefecture_crosswalk.v1.json",
        "status": "frozen_verified", "local_presence": "required",
    })
    ledger_path.write_text(json.dumps(ledger, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__": main()
