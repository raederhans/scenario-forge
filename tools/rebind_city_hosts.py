from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shapely.geometry import Point, shape
from shapely.strtree import STRtree
from topojson.utils import serialize_as_geojson

from map_builder.scenario_city_overrides_composer import extract_city_assets_payload
from tools.check_scenario_contracts import _build_snapshot_for_scenario, _refresh_audit_payload
from tools.repair_scenario_capitals import read, write_if_changed


def rebind_city_hosts(scenario_dir):
    scenario_dir = Path(scenario_dir)
    payload = read(scenario_dir / "city_overrides.json")
    cities = payload.setdefault("cities", {})
    rows = {f["properties"]["id"]: f["properties"]
            for f in read(ROOT / "data/world_cities.geojson")["features"]}
    topology = read(scenario_dir / "runtime_topology.topo.json")
    features = serialize_as_geojson(topology, objectname="political")["features"]
    ids = [f["properties"]["id"] for f in features]
    valid_ids = set(ids)
    geometries = [shape(f["geometry"]) for f in features]
    tree = STRtree(geometries)
    rebound, skipped = [], []
    for city_id in sorted(rows.keys() | cities.keys()):
        row = {**rows.get(city_id, {}), **cities.get(city_id, {})}
        host = row.get("host_feature_id")
        if host in valid_ids:
            continue
        point = Point(row["lon"], row["lat"])
        candidates = tree.query(point, predicate="intersects")
        if len(candidates):
            index = min(candidates, key=lambda i: ids[i])
        else:
            index = tree.nearest(point)
            if index is None or geometries[index].distance(point) > 0.02:
                skipped.append({"city_id": city_id, "host_feature_id": host})
                continue
        if city_id not in cities:
            cities[city_id] = {
                "city_id": city_id,
                "stable_key": row["stable_key"],
            }
        cities[city_id]["host_feature_id"] = ids[index]
        rebound.append(city_id)
    if rebound:
        write_if_changed(scenario_dir / "city_overrides.json", payload)
        partial = scenario_dir / "city_assets.partial.json"
        if partial.exists():
            write_if_changed(partial, extract_city_assets_payload(payload, scenario_id=scenario_dir.name))
        manifest = read(scenario_dir / "manifest.json")
        snapshot = _build_snapshot_for_scenario(scenario_dir, manifest)
        manifest["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
        write_if_changed(scenario_dir / "manifest.json", manifest)
        _refresh_audit_payload(scenario_dir, manifest, snapshot_payload=snapshot)
        for name in ("build_snapshot.json", "audit.json"):
            path = scenario_dir / name
            sidecar = Path(str(path) + ".gz")
            if sidecar.exists():
                sidecar.write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))
    return {"scenario_id": scenario_dir.name, "rebound_count": len(rebound),
            "rebound_cities": rebound, "skipped": skipped}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenarios", nargs="+", required=True)
    args = parser.parse_args()
    for scenario in args.scenarios:
        report = rebind_city_hosts(ROOT / "data/scenarios" / scenario)
        print(json.dumps({key: value for key, value in report.items() if key != "rebound_cities"},
                         ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
