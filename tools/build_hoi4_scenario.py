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
from map_builder.io.writers import write_json_atomic
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
DEFAULT_BOOKMARK_FILE = "common/bookmarks/the_gathering_storm.txt"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build bundled HOI4 scenario assets.")
    parser.add_argument("--scenario-id", default=DEFAULT_SCENARIO_ID)
    parser.add_argument("--display-name", default="HOI4 1936")
    parser.add_argument("--source-root", default="")
    parser.add_argument(
        "--bookmark-file",
        default=DEFAULT_BOOKMARK_FILE,
        help="Path relative to the HOI4 source root.",
    )
    parser.add_argument(
        "--as-of-date",
        default="",
        help="Override scenario date replay anchor (for example: 1939.8.14.12). Defaults to bookmark date.",
    )
    parser.add_argument(
        "--baseline-bookmark-file",
        default=DEFAULT_BOOKMARK_FILE,
        help="Baseline bookmark used when computing owner state deltas.",
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
        help="Comma-separated rule file paths.",
    )
    parser.add_argument(
        "--controller-rules",
        default="",
        help="Optional comma-separated rule file paths for controller/frontline overlays.",
    )
    parser.add_argument(
        "--scenario-output-dir",
        default=str(PROJECT_ROOT / "data/scenarios/hoi4_1936"),
    )
    parser.add_argument(
        "--report-dir",
        default=str(PROJECT_ROOT / ".runtime/reports/generated/scenarios/hoi4_1936"),
    )
    parser.add_argument(
        "--default-scenario-id",
        default="",
        help="Override scenarios index default_scenario_id. By default the existing value is preserved.",
    )
    parser.add_argument(
        "--skip-atlas",
        action="store_true",
        help="Skip source atlas generation.",
    )
    return parser


def write_json(path: Path, payload: object) -> None:
    write_json_atomic(path, payload, ensure_ascii=False, indent=2, trailing_newline=True)


def resolve_scenario_output_dir(raw_value: str, scenario_id: str) -> Path:
    scenario_output_dir = Path(raw_value)
    folder_name = scenario_output_dir.name.strip()
    expected_name = str(scenario_id or "").strip()
    if not expected_name:
        raise ValueError("--scenario-id must not be empty.")
    if not folder_name:
        raise ValueError(
            f"--scenario-output-dir must end with the scenario folder name. Received: {scenario_output_dir}"
        )
    if folder_name != expected_name:
        raise ValueError(
            "--scenario-output-dir basename must match --scenario-id exactly. "
            f"Received basename `{folder_name}` for scenario `{expected_name}` "
            f"at `{scenario_output_dir}`."
        )
    return scenario_output_dir


def split_paths(raw_value: str) -> list[Path]:
    candidates = []
    for token in str(raw_value or "").replace(";", ",").split(","):
        candidate = token.strip()
        if candidate:
            candidates.append(Path(candidate))
    return candidates


def dedupe_rules_by_id(rules: list[object]) -> list[object]:
    deduped: dict[str, object] = {}
    for rule in rules:
        rule_id = str(getattr(rule, "rule_id", "")).strip()
        if not rule_id:
            continue
        deduped[rule_id] = rule
    return sorted(deduped.values(), key=lambda item: (item.priority, item.rule_id))


def load_rules_with_metadata(paths: list[Path]) -> tuple[list[object], list[dict[str, object]]]:
    merged_rules: list[object] = []
    metadata_entries: list[dict[str, object]] = []
    for path in paths:
        if not path.exists():
            raise FileNotFoundError(f"Rule file not found: {path}")
        merged_rules.extend(load_manual_rules(path))
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            metadata_entries.append(payload)
    return dedupe_rules_by_id(merged_rules), metadata_entries


def collect_state_delta_coverage(metadata_entries: list[dict[str, object]]) -> dict[str, object]:
    coverage: dict[str, object] = {}
    for entry in metadata_entries:
        value = entry.get("state_delta_coverage")
        if isinstance(value, dict):
            coverage.update(value)
    return coverage


def to_int_set(values: object) -> set[int]:
    parsed: set[int] = set()
    if not isinstance(values, list):
        return parsed
    for value in values:
        try:
            parsed.add(int(value))
        except (TypeError, ValueError):
            continue
    return parsed


def build_state_owner_delta(
    *,
    baseline_states: dict[int, object],
    target_states: dict[int, object],
) -> list[dict[str, object]]:
    delta_rows: list[dict[str, object]] = []
    for state_id in sorted(set(baseline_states) | set(target_states)):
        baseline_record = baseline_states.get(state_id)
        target_record = target_states.get(state_id)
        if not baseline_record or not target_record:
            continue
        baseline_owner = str(getattr(baseline_record, "owner_tag", "") or "").strip().upper()
        target_owner = str(getattr(target_record, "owner_tag", "") or "").strip().upper()
        if not baseline_owner or not target_owner or baseline_owner == target_owner:
            continue
        delta_rows.append(
            {
                "state_id": state_id,
                "file_name": str(getattr(target_record, "file_name", "") or ""),
                "from_owner": baseline_owner,
                "to_owner": target_owner,
                "from_controller": str(getattr(baseline_record, "controller_tag", "") or "").strip().upper() or baseline_owner,
                "to_controller": str(getattr(target_record, "controller_tag", "") or "").strip().upper() or target_owner,
            }
        )
    return delta_rows


def gate_state_delta_coverage(
    *,
    delta_rows: list[dict[str, object]],
    coverage: dict[str, object],
) -> dict[str, object]:
    delta_state_ids = {int(row["state_id"]) for row in delta_rows}
    frontline_ids = to_int_set(coverage.get("frontline_state_ids"))
    manual_ids = to_int_set(coverage.get("covered_by_manual_rules"))
    direct_ids = to_int_set(coverage.get("covered_by_direct_mapping"))
    covered_ids = manual_ids | direct_ids
    non_frontline_ids = delta_state_ids - frontline_ids
    uncovered_ids = sorted(non_frontline_ids - covered_ids)
    redundant_coverage_ids = sorted(covered_ids - non_frontline_ids)
    report = {
        "delta_state_count": len(delta_state_ids),
        "frontline_state_count": len(frontline_ids),
        "non_frontline_delta_state_count": len(non_frontline_ids),
        "covered_non_frontline_state_count": len(non_frontline_ids & covered_ids),
        "uncovered_non_frontline_state_ids": uncovered_ids,
        "redundant_coverage_state_ids": redundant_coverage_ids,
        "frontline_state_ids": sorted(frontline_ids),
        "covered_by_manual_rules": sorted(manual_ids),
        "covered_by_direct_mapping": sorted(direct_ids),
    }
    if uncovered_ids:
        raise ValueError(
            "State delta coverage gate failed. Non-frontline owner deltas are not covered: "
            + ", ".join(str(value) for value in uncovered_ids)
        )
    return report


def main() -> int:
    args = build_parser().parse_args()
    scenario_output_dir = resolve_scenario_output_dir(args.scenario_output_dir, args.scenario_id)

    source_root = discover_hoi4_source_root(args.source_root or None)
    bookmark = parse_bookmark(source_root / args.bookmark_file)
    as_of_date = str(args.as_of_date or bookmark.date).strip()
    if not as_of_date:
        raise ValueError("Unable to resolve scenario as_of_date from --as-of-date or bookmark date.")

    country_tags = parse_country_tags(source_root / "common/country_tags/00_countries.txt")
    country_histories = parse_country_histories(source_root / "history/countries")
    states_by_id = parse_states(source_root / "history/states", as_of_date=as_of_date)
    definition_entries = parse_definition_csv(source_root / "map/definition.csv")
    runtime_features = load_runtime_features(Path(args.runtime_topology))
    runtime_country_names = load_runtime_country_names(Path(args.runtime_topology))
    hierarchy_groups, country_meta_by_iso2 = load_hierarchy_groups(Path(args.hierarchy))
    palette_pack = load_palette_pack(Path(args.palette_pack))
    palette_map = load_palette_map(Path(args.palette_map))

    owner_rule_paths = split_paths(args.manual_rules)
    if not owner_rule_paths:
        raise ValueError("At least one owner manual rules path must be provided.")
    manual_rules, owner_rule_metadata = load_rules_with_metadata(owner_rule_paths)

    controller_rule_paths = split_paths(args.controller_rules)
    controller_rules: list[object] = []
    controller_rule_metadata: list[dict[str, object]] = []
    if controller_rule_paths:
        controller_rules, controller_rule_metadata = load_rules_with_metadata(controller_rule_paths)

    coverage = collect_state_delta_coverage(owner_rule_metadata)
    enable_region_checks = bool(coverage.get("enable_region_checks", args.scenario_id == "hoi4_1936"))
    enforce_region_checks = bool(coverage.get("enforce_region_checks", enable_region_checks))
    enforce_scenario_extensions = bool(
        coverage.get("enforce_scenario_extensions", args.scenario_id == "hoi4_1936")
    )
    baseline_bookmark = parse_bookmark(source_root / args.baseline_bookmark_file)
    baseline_date = str(coverage.get("baseline_as_of_date") or baseline_bookmark.date).strip()
    delta_rows: list[dict[str, object]] = []
    delta_gate_report: dict[str, object] = {}
    if baseline_date:
        baseline_states = parse_states(source_root / "history/states", as_of_date=baseline_date)
        delta_rows = build_state_owner_delta(
            baseline_states=baseline_states,
            target_states=states_by_id,
        )
        if coverage:
            delta_gate_report = gate_state_delta_coverage(
                delta_rows=delta_rows,
                coverage=coverage,
            )

    diagnostics = {
        "source_root": str(source_root),
        "bookmark_file": args.bookmark_file,
        "bookmark_featured_count": len(bookmark.featured_tags),
        "as_of_date": as_of_date,
        "country_tag_file_entries": len(country_tags),
        "country_history_count": len(country_histories),
        "state_count": len(states_by_id),
        "definition_entry_count": len(definition_entries),
        "runtime_feature_count": len(runtime_features),
        "manual_rule_count": len(manual_rules),
        "controller_rule_count": len(controller_rules),
        "enable_region_checks": enable_region_checks,
        "enforce_region_checks": enforce_region_checks,
        "enforce_scenario_extensions": enforce_scenario_extensions,
        "owner_rule_paths": [str(path) for path in owner_rule_paths],
        "controller_rule_paths": [str(path) for path in controller_rule_paths],
        "state_owner_counts": dict(
            sorted(
                Counter(record.owner_tag for record in states_by_id.values()).items(),
                key=lambda item: (-item[1], item[0]),
            )[:120]
        ),
    }
    if baseline_date:
        diagnostics["baseline_as_of_date"] = baseline_date
        diagnostics["state_owner_delta_count"] = len(delta_rows)
    if delta_gate_report:
        diagnostics["state_delta_gate"] = delta_gate_report

    bundle = compile_scenario_bundle(
        scenario_id=args.scenario_id,
        display_name=args.display_name,
        bookmark=bookmark,
        runtime_features=runtime_features,
        runtime_country_names=runtime_country_names,
        hierarchy_groups=hierarchy_groups,
        country_meta_by_iso2=country_meta_by_iso2,
        rules=manual_rules,
        controller_rules=controller_rules,
        states_by_id=states_by_id,
        country_histories=country_histories,
        palette_pack=palette_pack,
        palette_map=palette_map,
        diagnostics=diagnostics,
    )

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
    write_json(scenario_output_dir / "controllers.by_feature.json", bundle["controllers"])
    write_json(scenario_output_dir / "cores.by_feature.json", bundle["cores"])
    write_json(scenario_output_dir / "audit.json", bundle["audit"])

    if delta_rows:
        write_json(
            report_dir / "state_owner_delta.json",
            {
                "scenario_id": args.scenario_id,
                "baseline_as_of_date": baseline_date,
                "target_as_of_date": as_of_date,
                "delta_state_count": len(delta_rows),
                "rows": delta_rows,
                "coverage_gate": delta_gate_report,
            },
        )

    scenario_index_path = scenario_output_dir.parent / "index.json"
    existing_index = {"version": 1, "default_scenario_id": DEFAULT_SCENARIO_ID, "scenarios": []}
    if scenario_index_path.exists():
        try:
            existing_index = json.loads(scenario_index_path.read_text(encoding="utf-8"))
        except Exception:
            existing_index = {"version": 1, "default_scenario_id": DEFAULT_SCENARIO_ID, "scenarios": []}
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
    default_scenario_id = (
        str(args.default_scenario_id or "").strip()
        or str(existing_index.get("default_scenario_id") or "").strip()
        or DEFAULT_SCENARIO_ID
    )
    scenario_index_payload = {
        "version": 1,
        "default_scenario_id": default_scenario_id,
        "scenarios": sorted(
            scenarios,
            key=lambda item: str(item.get("display_name") or item.get("scenario_id") or ""),
        ),
    }
    write_json(scenario_index_path, scenario_index_payload)

    write_report_files(
        bundle=bundle,
        report_json_path=report_dir / "coverage_report.json",
        report_markdown_path=report_dir / "coverage_report.md",
        atlas_paths=atlas_paths,
    )

    print(f"[scenario] Built {args.scenario_id} from {source_root}")
    print(f"[scenario] Date anchor: {as_of_date}")
    print(f"[scenario] Features: {bundle['audit']['summary']['feature_count']}")
    print(f"[scenario] Owners: {bundle['audit']['summary']['owner_count']}")
    print(f"[scenario] Controllers: {bundle['audit']['summary'].get('controller_count', 0)}")
    print(
        "[scenario] Owner/controller split features: "
        f"{bundle['audit']['summary'].get('owner_controller_split_feature_count', 0)}"
    )
    print(f"[scenario] Quality counts: {bundle['audit']['summary']['quality_counts']}")
    print(f"[scenario] Geometry blockers: {bundle['audit']['summary']['geometry_blocker_count']}")
    print(f"[scenario] Critical unresolved: {bundle['audit']['summary']['critical_unresolved_count']}")
    if delta_rows:
        print(f"[scenario] State owner delta count: {len(delta_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
