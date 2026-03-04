#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scenario_builder.hoi4.audit import build_source_atlas, write_report_files
from scenario_builder.hoi4.compiler import compile_scenario_bundle
from scenario_builder.hoi4.parser import (
    discover_hoi4_source_root,
    load_hierarchy_groups,
    load_manual_rules,
    load_palette_map,
    load_palette_pack,
    load_runtime_country_names,
    load_runtime_features,
    parse_bookmark,
    parse_country_histories,
    parse_country_tags,
    parse_definition_csv,
    parse_states,
)


DEFAULT_SCENARIO_ID = "hoi4_1936"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build bundled HOI4 scenario assets.")
    parser.add_argument("--scenario-id", default=DEFAULT_SCENARIO_ID)
    parser.add_argument("--display-name", default="HOI4 1936")
    parser.add_argument("--source-root", default="")
    parser.add_argument(
        "--bookmark-file",
        default="common/bookmarks/the_gathering_storm.txt",
        help="Path relative to the HOI4 source root.",
    )
    parser.add_argument(
        "--runtime-topology",
        default=str(PROJECT_ROOT / "data/europe_topology.runtime_political_v1.json"),
    )
    parser.add_argument(
        "--hierarchy",
        default=str(PROJECT_ROOT / "data/hierarchy.json"),
    )
    parser.add_argument(
        "--palette-pack",
        default=str(PROJECT_ROOT / "data/palettes/hoi4_vanilla.palette.json"),
    )
    parser.add_argument(
        "--palette-map",
        default=str(PROJECT_ROOT / "data/palette-maps/hoi4_vanilla.map.json"),
    )
    parser.add_argument(
        "--manual-rules",
        default=str(PROJECT_ROOT / "data/scenario-rules/hoi4_1936.manual.json"),
    )
    parser.add_argument(
        "--scenario-output-dir",
        default=str(PROJECT_ROOT / "data/scenarios/hoi4_1936"),
    )
    parser.add_argument(
        "--report-dir",
        default=str(PROJECT_ROOT / "reports/generated/scenarios/hoi4_1936"),
    )
    parser.add_argument(
        "--skip-atlas",
        action="store_true",
        help="Skip source atlas generation.",
    )
    return parser


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    args = build_parser().parse_args()

    source_root = discover_hoi4_source_root(args.source_root or None)
    bookmark = parse_bookmark(source_root / args.bookmark_file)
    country_tags = parse_country_tags(source_root / "common/country_tags/00_countries.txt")
    country_histories = parse_country_histories(source_root / "history/countries")
    states_by_id = parse_states(source_root / "history/states")
    definition_entries = parse_definition_csv(source_root / "map/definition.csv")
    runtime_features = load_runtime_features(Path(args.runtime_topology))
    runtime_country_names = load_runtime_country_names(Path(args.runtime_topology))
    hierarchy_groups, country_meta_by_iso2 = load_hierarchy_groups(Path(args.hierarchy))
    palette_pack = load_palette_pack(Path(args.palette_pack))
    palette_map = load_palette_map(Path(args.palette_map))
    manual_rules = load_manual_rules(Path(args.manual_rules))

    diagnostics = {
        "source_root": str(source_root),
        "bookmark_file": args.bookmark_file,
        "bookmark_featured_count": len(bookmark.featured_tags),
        "country_tag_file_entries": len(country_tags),
        "country_history_count": len(country_histories),
        "state_count": len(states_by_id),
        "definition_entry_count": len(definition_entries),
        "runtime_feature_count": len(runtime_features),
        "manual_rule_count": len(manual_rules),
        "state_owner_counts": dict(
            sorted(
                Counter(record.owner_tag for record in states_by_id.values()).items(),
                key=lambda item: (-item[1], item[0]),
            )[:120]
        ),
    }

    bundle = compile_scenario_bundle(
        scenario_id=args.scenario_id,
        display_name=args.display_name,
        bookmark=bookmark,
        runtime_features=runtime_features,
        runtime_country_names=runtime_country_names,
        hierarchy_groups=hierarchy_groups,
        country_meta_by_iso2=country_meta_by_iso2,
        rules=manual_rules,
        states_by_id=states_by_id,
        country_histories=country_histories,
        palette_pack=palette_pack,
        palette_map=palette_map,
        diagnostics=diagnostics,
    )

    scenario_output_dir = Path(args.scenario_output_dir)
    report_dir = Path(args.report_dir)
    atlas_dir = report_dir / "source_atlas"
    atlas_paths: list[str] = []
    if not args.skip_atlas:
        atlas_paths = build_source_atlas(
            provinces_bmp_path=source_root / "map/provinces.bmp",
            definition_entries=definition_entries,
            states_by_id=states_by_id,
            palette_pack=palette_pack,
            output_dir=atlas_dir,
        )

    write_json(scenario_output_dir / "manifest.json", bundle["manifest"])
    write_json(scenario_output_dir / "countries.json", bundle["countries"])
    write_json(scenario_output_dir / "owners.by_feature.json", bundle["owners"])
    write_json(scenario_output_dir / "cores.by_feature.json", bundle["cores"])
    write_json(scenario_output_dir / "audit.json", bundle["audit"])

    scenario_index_path = scenario_output_dir.parent / "index.json"
    existing_index = {"version": 1, "default_scenario_id": args.scenario_id, "scenarios": []}
    if scenario_index_path.exists():
        try:
            existing_index = json.loads(scenario_index_path.read_text(encoding="utf-8"))
        except Exception:
            existing_index = {"version": 1, "default_scenario_id": args.scenario_id, "scenarios": []}
    scenarios = [
        item
        for item in existing_index.get("scenarios", [])
        if str(item.get("scenario_id") or "").strip() != args.scenario_id
    ]
    scenarios.append(
        {
            "scenario_id": args.scenario_id,
            "display_name": args.display_name,
            "manifest_url": f"data/scenarios/{args.scenario_id}/manifest.json",
            "audit_url": f"data/scenarios/{args.scenario_id}/audit.json",
        }
    )
    scenario_index_payload = {
        "version": 1,
        "default_scenario_id": args.scenario_id,
        "scenarios": sorted(scenarios, key=lambda item: str(item.get("display_name") or item.get("scenario_id") or "")),
    }
    write_json(scenario_index_path, scenario_index_payload)

    write_report_files(
        bundle=bundle,
        report_json_path=report_dir / "coverage_report.json",
        report_markdown_path=report_dir / "coverage_report.md",
        atlas_paths=atlas_paths,
    )

    print(f"[scenario] Built {args.scenario_id} from {source_root}")
    print(f"[scenario] Features: {bundle['audit']['summary']['feature_count']}")
    print(f"[scenario] Owners: {bundle['audit']['summary']['owner_count']}")
    print(f"[scenario] Quality counts: {bundle['audit']['summary']['quality_counts']}")
    print(f"[scenario] Geometry blockers: {bundle['audit']['summary']['geometry_blocker_count']}")
    print(f"[scenario] Critical unresolved: {bundle['audit']['summary']['critical_unresolved_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
