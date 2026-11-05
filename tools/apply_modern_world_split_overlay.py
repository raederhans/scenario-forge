from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.json_source import read_json_source
from map_builder.political_feature_merge_plans import ordered_plans
from scenario_builder.hoi4.parser import load_hierarchy_groups
from tools.apply_hoi4_split_overlay import apply_overlay, make_point_lookup
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario


def run_scenario(overlay, scenario_dir=ROOT / "data/scenarios/modern_world", *,
                 data_dir=ROOT / "data", dry_run=False,
                 read=read_json_source, write=write_json, refresh=refresh_scenario,
                 load_plans=ordered_plans, load_hierarchy=load_hierarchy_groups):
    scenario_dir = Path(scenario_dir)
    superseded = {eid for entry in overlay["entries"] for eid in entry.get("supersedes", [])}
    overlay = {**overlay, "entries": [entry for entry in overlay["entries"] if entry["id"] not in superseded]}
    topology = read(scenario_dir / "runtime_topology.topo.json")
    payload = read(scenario_dir / "countries.json")
    owners = read(scenario_dir / "owners.by_feature.json")["owners"]
    manifest = read(scenario_dir / "manifest.json")
    groups, meta = load_hierarchy(data_dir / "hierarchy.json")
    countries, assignments, report = apply_overlay(
        overlay, "modern_world",
        features={g["properties"]["id"]: g["properties"]
                  for g in topology["objects"]["political"]["geometries"]},
        owners=owners, cores=read(scenario_dir / "cores.by_feature.json")["cores"],
        countries=payload["countries"], default_country=manifest["default_country"],
        hierarchy_groups=groups, country_meta=meta, prefectures={}, bucket_by_feature={},
        plans=load_plans(data_dir),
        feature_splits=manifest.get("hierarchy_overrides", {}).get("feature_splits", {}),
        topology=topology, point_for_feature=make_point_lookup(topology),
    )
    counts = Counter({**owners, **{fid: row["owner"] for fid, row in assignments.items()}}.values())
    for tag, country in countries.items():
        country["feature_count"] = counts[tag]
        if "controller_feature_count" in country:
            country["controller_feature_count"] = counts[tag]
    if not dry_run and (assignments or countries != payload["countries"]):
        write(scenario_dir / "countries.json", {**payload, "countries": countries})
        refresh(scenario_dir, assignments, removed_ids=())
    return report


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    overlay = read_json_source(ROOT / "data/scenario-rules/modern_world.split_overlay.json")
    report = run_scenario(overlay, dry_run=args.dry_run)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.report:
        write_json(args.report, report)
    return report


if __name__ == "__main__":
    main()
