#!/usr/bin/env python3
"""Refresh only quick-fill metadata; never rewrite topology or legacy hierarchy groups."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0, str(ROOT))
from map_builder.quick_fill_hierarchy import build_quick_fill_metadata, load_crosswalk


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = args.root / "data"
    path = data / "hierarchy.json"
    hierarchy = json.loads(path.read_text(encoding="utf-8"))
    topology = json.loads((data / "europe_topology.runtime_political_v1.json").read_text(encoding="utf-8"))
    properties = [row.get("properties", {}) for row in topology["objects"]["political"]["geometries"]]
    metadata = build_quick_fill_metadata(hierarchy, properties, load_crosswalk(data))
    if args.check:
        if hierarchy.get("quick_fill") != metadata: raise SystemExit("Quick-fill metadata is stale. Run tools/build_quick_fill_hierarchy.py")
    else:
        hierarchy["quick_fill"] = metadata
        path.write_text(json.dumps(hierarchy, indent=2, ensure_ascii=True), encoding="utf-8")
    print(json.dumps({country: list(record["levels"]) for country, record in metadata["countries"].items()}))


if __name__ == "__main__": main()
