from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.overture_transport_common import utc_now, write_json
from tools.build_global_transport_roads import ROAD_SHARDS
from tools.build_global_transport_rail import FOCUS_REGION_SPECS, RAIL_SHARDS


ROAD_ROOT = ROOT / "data" / "transport_layers" / "global_road"
RAIL_ROOT = ROOT / "data" / "transport_layers" / "global_rail"
ROAD_CATALOG_PATH = ROAD_ROOT / "catalog.json"
RAIL_CATALOG_PATH = RAIL_ROOT / "catalog.json"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_road_catalog() -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for shard in ROAD_SHARDS:
        manifest_path = ROAD_ROOT / "shards" / shard["id"] / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Missing road shard manifest: {manifest_path.relative_to(ROOT)}")
        manifest = load_json(manifest_path)
        entries.append(
            {
                "id": shard["id"],
                "manifest_path": str(manifest_path.relative_to(ROOT)).replace("\\", "/"),
                "lon_min": float(shard["lon_min"]),
                "lon_max": float(shard["lon_max"]),
                "feature_counts": manifest.get("feature_counts") or {},
                "phase_status": ((manifest.get("extensions") or {}).get("road") or {}).get("phase_status") or {},
            }
        )
    return {
        "version": "global_transport_catalog_v1",
        "family": "road",
        "generated_at": utc_now(),
        "distribution_tier": "sharded_manifest_catalog",
        "source_policy": "overture_only_checked_in_v1",
        "default_variant": "default",
        "entries": entries,
    }


def build_rail_catalog() -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    for shard_spec in RAIL_SHARDS:
        manifest_path = RAIL_ROOT / "regions" / shard_spec["region_id"] / "shards" / shard_spec["id"] / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Missing rail shard manifest: {manifest_path.relative_to(ROOT)}")
        manifest = load_json(manifest_path)
        entries.append(
            {
                "id": shard_spec["id"],
                "region_id": shard_spec["region_id"],
                "manifest_path": str(manifest_path.relative_to(ROOT)).replace("\\", "/"),
                "lon_min": float(shard_spec["lon_min"]),
                "lon_max": float(shard_spec["lon_max"]),
                "lat_min": float(((manifest.get("extensions") or {}).get("rail") or {}).get("region", {}).get("lat_min", 0.0)),
                "lat_max": float(((manifest.get("extensions") or {}).get("rail") or {}).get("region", {}).get("lat_max", 0.0)),
                "feature_counts": manifest.get("feature_counts") or {},
                "phase_status": ((manifest.get("extensions") or {}).get("rail") or {}).get("phase_status") or {},
            }
        )
    return {
        "version": "global_transport_catalog_v1",
        "family": "rail",
        "generated_at": utc_now(),
        "distribution_tier": "regional_sharded_manifest_catalog",
        "source_policy": "overture_only_checked_in_v1",
        "default_variant": "default",
        "coverage_scope": "focus_regions_only",
        "regions": [
            {
                "id": region_spec["id"],
                "lon_min": float(region_spec["lon_min"]),
                "lon_max": float(region_spec["lon_max"]),
                "lat_min": float(region_spec["lat_min"]),
                "lat_max": float(region_spec["lat_max"]),
                "default_shard": next(
                    (shard["id"] for shard in RAIL_SHARDS if shard["region_id"] == region_spec["id"]),
                    "",
                ),
            }
            for region_spec in FOCUS_REGION_SPECS
        ],
        "entries": entries,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build top-level global transport catalog files.")
    parser.add_argument(
        "--family",
        choices=("all", "road", "rail"),
        default="road",
        help="Select which catalog(s) to write.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.family in {"all", "road"}:
        write_json(ROAD_CATALOG_PATH, build_road_catalog(), compact=False)
    if args.family in {"all", "rail"}:
        write_json(RAIL_CATALOG_PATH, build_rail_catalog(), compact=False)
    print(f"Wrote global transport catalog(s) for {args.family}.")


if __name__ == "__main__":
    main()
