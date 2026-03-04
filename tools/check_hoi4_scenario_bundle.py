#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIO_DIR = PROJECT_ROOT / "data/scenarios/hoi4_1936"
DEFAULT_REPORT_DIR = PROJECT_ROOT / "reports/generated/scenarios/hoi4_1936"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate the checked-in HOI4 1936 scenario bundle.")
    parser.add_argument("--scenario-dir", default=str(DEFAULT_SCENARIO_DIR))
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT_DIR))
    return parser.parse_args()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_markdown_summary(markdown_text: str) -> dict[str, int]:
    patterns = {
        "feature_count": r"Features assigned: `(\d+)`",
        "owner_count": r"Owners present: `(\d+)`",
        "geometry_blocker_count": r"Geometry blockers: `(\d+)`",
        "failed_region_check_count": r"Failed region checks: `(\d+)`",
        "synthetic_owner_feature_count": r"Synthetic-owner features: `(\d+)`",
        "approximate_count": r"- `approx_existing_geometry`: `(\d+)`",
    }
    parsed: dict[str, int] = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, markdown_text)
        if match:
            parsed[key] = int(match.group(1))
    return parsed


def main() -> int:
    args = parse_args()
    scenario_dir = Path(args.scenario_dir)
    report_dir = Path(args.report_dir)

    manifest = load_json(scenario_dir / "manifest.json")
    countries = load_json(scenario_dir / "countries.json")
    audit = load_json(scenario_dir / "audit.json")
    coverage_report = (report_dir / "coverage_report.md").read_text(encoding="utf-8")

    summary = manifest.get("summary", {}) if isinstance(manifest.get("summary"), dict) else {}
    audit_summary = audit.get("summary", {}) if isinstance(audit.get("summary"), dict) else {}
    country_map = countries.get("countries", {}) if isinstance(countries.get("countries"), dict) else {}
    markdown_summary = parse_markdown_summary(coverage_report)

    errors: list[str] = []

    def expect(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    ger = country_map.get("GER", {})
    eng = country_map.get("ENG", {})
    ast = country_map.get("AST", {})

    expect(ger.get("lookup_iso2") == "DE", "GER.lookup_iso2 must be DE.")
    expect(eng.get("lookup_iso2") == "GB", "ENG.lookup_iso2 must be GB.")
    expect(bool(ast.get("lookup_iso2")), "AST.lookup_iso2 must be populated.")

    missing_provenance = [
        tag for tag, entry in country_map.items()
        if "provenance_iso2" not in entry or not str(entry.get("provenance_iso2") or "").strip()
    ]
    expect(not missing_provenance, f"All countries must have provenance_iso2. Missing: {missing_provenance[:10]}")

    missing_rule_fields = [
        tag for tag, entry in country_map.items()
        if "primary_rule_source" not in entry or "rule_sources" not in entry
    ]
    expect(not missing_rule_fields, f"All countries must expose primary_rule_source and rule_sources. Missing: {missing_rule_fields[:10]}")

    expect(summary.get("approximate_count") == 976, "manifest.summary.approximate_count must equal 976.")
    expect(summary.get("synthetic_count") == 18, "manifest.summary.synthetic_count must equal 18.")
    expect(summary.get("blocker_count") == 0, "manifest.summary.blocker_count must equal 0.")
    expect(summary.get("critical_region_check_count") == 13, "manifest.summary.critical_region_check_count must equal 13.")

    for key in [
        "feature_count",
        "owner_count",
        "approximate_count",
        "geometry_blocker_count",
        "failed_region_check_count",
        "synthetic_owner_feature_count",
        "critical_region_check_count",
    ]:
        manifest_value = summary.get(key)
        audit_value = audit_summary.get(key)
        if key == "approximate_count" and audit_value is None:
            audit_value = audit_summary.get("quality_counts", {}).get("approx_existing_geometry")
        expect(manifest_value == audit_value, f"manifest.summary.{key} must equal audit.summary.{key}.")

    md_to_audit_key = {
        "feature_count": "feature_count",
        "owner_count": "owner_count",
        "geometry_blocker_count": "geometry_blocker_count",
        "failed_region_check_count": "failed_region_check_count",
        "synthetic_owner_feature_count": "synthetic_owner_feature_count",
        "approximate_count": "approximate_count",
    }
    for md_key, audit_key in md_to_audit_key.items():
        report_value = markdown_summary.get(md_key)
        audit_value = audit_summary.get(audit_key)
        if md_key == "approximate_count" and audit_value is None:
            audit_value = audit_summary.get("quality_counts", {}).get("approx_existing_geometry")
        expect(report_value == audit_value, f"coverage_report.md {md_key} must equal audit.summary.{audit_key}.")

    if errors:
        print("[scenario-check] FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("[scenario-check] OK")
    print(f"- Scenario: {manifest.get('scenario_id')}")
    print(f"- Owners: {summary.get('owner_count')}")
    print(f"- Features: {summary.get('feature_count')}")
    print(f"- Approximate: {summary.get('approximate_count')}")
    print(f"- Synthetic: {summary.get('synthetic_count')}")
    print(f"- Blockers: {summary.get('blocker_count')}")
    print(f"- Critical checks: {summary.get('critical_region_check_count')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
