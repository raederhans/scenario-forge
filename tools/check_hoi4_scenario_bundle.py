#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIO_DIR = PROJECT_ROOT / "data/scenarios/hoi4_1936"
DEFAULT_REPORT_DIR = PROJECT_ROOT / "reports/generated/scenarios/hoi4_1936"
DEFAULT_EXPECTATION_DIR = PROJECT_ROOT / "data/scenarios/expectations"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate a checked-in HOI4 scenario bundle.")
    parser.add_argument("--scenario-dir", default=str(DEFAULT_SCENARIO_DIR))
    parser.add_argument("--report-dir", default=str(DEFAULT_REPORT_DIR))
    parser.add_argument(
        "--expectation",
        default="",
        help="Optional explicit expectation file. Defaults to data/scenarios/expectations/<scenario_id>.expectation.json",
    )
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


def to_number(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def expect_number(
    *,
    errors: list[str],
    actual: object,
    expected: object,
    label: str,
) -> None:
    if actual != expected:
        errors.append(f"{label} must equal {expected}. Found {actual}.")


def apply_numeric_assertions(
    *,
    errors: list[str],
    payload: dict[str, object],
    equals: dict[str, object],
    minimums: dict[str, object],
    maximums: dict[str, object],
    prefix: str,
) -> None:
    for key, expected in equals.items():
        expect_number(
            errors=errors,
            actual=payload.get(key),
            expected=expected,
            label=f"{prefix}.{key}",
        )
    for key, expected in minimums.items():
        actual_value = to_number(payload.get(key))
        expected_value = to_number(expected)
        if actual_value is None or expected_value is None:
            errors.append(f"{prefix}.{key} must be numeric for min assertion.")
            continue
        if actual_value < expected_value:
            errors.append(f"{prefix}.{key} must be >= {expected_value}. Found {actual_value}.")
    for key, expected in maximums.items():
        actual_value = to_number(payload.get(key))
        expected_value = to_number(expected)
        if actual_value is None or expected_value is None:
            errors.append(f"{prefix}.{key} must be numeric for max assertion.")
            continue
        if actual_value > expected_value:
            errors.append(f"{prefix}.{key} must be <= {expected_value}. Found {actual_value}.")


def main() -> int:
    args = parse_args()
    scenario_dir = Path(args.scenario_dir)
    report_dir = Path(args.report_dir)

    manifest = load_json(scenario_dir / "manifest.json")
    countries = load_json(scenario_dir / "countries.json")
    audit = load_json(scenario_dir / "audit.json")
    owners = load_json(scenario_dir / "owners.by_feature.json")
    cores = load_json(scenario_dir / "cores.by_feature.json")
    controllers_path = scenario_dir / "controllers.by_feature.json"
    controllers = load_json(controllers_path) if controllers_path.exists() else {}

    scenario_id = str(manifest.get("scenario_id") or "").strip()
    expectation_path = Path(args.expectation) if args.expectation else DEFAULT_EXPECTATION_DIR / f"{scenario_id}.expectation.json"
    expectation = load_json(expectation_path) if expectation_path.exists() else {}

    coverage_report_path = report_dir / "coverage_report.md"
    coverage_report = coverage_report_path.read_text(encoding="utf-8") if coverage_report_path.exists() else ""

    summary = manifest.get("summary", {}) if isinstance(manifest.get("summary"), dict) else {}
    audit_summary = audit.get("summary", {}) if isinstance(audit.get("summary"), dict) else {}
    country_map = countries.get("countries", {}) if isinstance(countries.get("countries"), dict) else {}
    markdown_summary = parse_markdown_summary(coverage_report)

    errors: list[str] = []

    def expect(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    expected_scenario_id = str(expectation.get("scenario_id") or scenario_id).strip()
    require_controllers = bool(expectation.get("require_controllers", bool(manifest.get("controllers_url"))))
    expect(bool(scenario_id), "manifest.scenario_id must be present.")
    expect(scenario_id == expected_scenario_id, f"scenario_id must be {expected_scenario_id}. Found {scenario_id}.")
    expect(bool(manifest.get("owners_url")), "manifest.owners_url must be present.")
    expect(bool(manifest.get("cores_url")), "manifest.cores_url must be present.")
    expect(bool(manifest.get("countries_url")), "manifest.countries_url must be present.")
    expect(bool(manifest.get("audit_url")), "manifest.audit_url must be present.")
    if require_controllers:
        expect(bool(manifest.get("controllers_url")), "manifest.controllers_url must be present.")
        expect(controllers_path.exists(), "controllers.by_feature.json must exist.")

    manifest_required_fields = expectation.get("manifest_required_fields", [])
    if isinstance(manifest_required_fields, list):
        for field in manifest_required_fields:
            field_name = str(field).strip()
            if field_name:
                expect(bool(manifest.get(field_name)), f"manifest.{field_name} must be present.")

    required_country_fields = expectation.get("required_country_fields", [])
    if isinstance(required_country_fields, list):
        for field in required_country_fields:
            field_name = str(field).strip()
            if not field_name:
                continue
            missing = [
                tag
                for tag, entry in country_map.items()
                if field_name not in entry
            ]
            expect(not missing, f"All countries must include `{field_name}`. Missing: {missing[:10]}")

    country_assertions = expectation.get("country_assertions", [])
    if isinstance(country_assertions, list):
        for assertion in country_assertions:
            if not isinstance(assertion, dict):
                continue
            tag = str(assertion.get("tag") or "").strip().upper()
            field = str(assertion.get("field") or "").strip()
            if not tag or not field:
                continue
            expected_value = assertion.get("equals")
            actual_value = (country_map.get(tag) or {}).get(field)
            expect(
                actual_value == expected_value,
                f"country {tag}.{field} must be {expected_value}. Found {actual_value}.",
            )

    apply_numeric_assertions(
        errors=errors,
        payload=summary,
        equals=expectation.get("summary_equals", {}) if isinstance(expectation.get("summary_equals"), dict) else {},
        minimums=expectation.get("summary_min", {}) if isinstance(expectation.get("summary_min"), dict) else {},
        maximums=expectation.get("summary_max", {}) if isinstance(expectation.get("summary_max"), dict) else {},
        prefix="manifest.summary",
    )

    # Core consistency checks between manifest, audit, and payload assets.
    for key in [
        "feature_count",
        "owner_count",
        "approximate_count",
        "geometry_blocker_count",
        "failed_region_check_count",
        "synthetic_owner_feature_count",
        "critical_region_check_count",
        "owner_controller_split_feature_count",
        "controller_count",
    ]:
        manifest_value = summary.get(key)
        audit_value = audit_summary.get(key)
        if key == "approximate_count" and audit_value is None:
            audit_value = (audit_summary.get("quality_counts") or {}).get("approx_existing_geometry")
        if manifest_value is None and audit_value is None:
            continue
        expect(manifest_value == audit_value, f"manifest.summary.{key} must equal audit.summary.{key}.")

    expect(
        summary.get("feature_count") == len(owners.get("owners", {})),
        "manifest.summary.feature_count must equal owners.by_feature entry count.",
    )
    expect(
        summary.get("feature_count") == len(cores.get("cores", {})),
        "manifest.summary.feature_count must equal cores.by_feature entry count.",
    )
    if require_controllers and controllers:
        expect(
            summary.get("feature_count") == len(controllers.get("controllers", {})),
            "manifest.summary.feature_count must equal controllers.by_feature entry count.",
        )

    if coverage_report:
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
                audit_value = (audit_summary.get("quality_counts") or {}).get("approx_existing_geometry")
            if report_value is None and audit_value is None:
                continue
            expect(report_value == audit_value, f"coverage_report.md {md_key} must equal audit.summary.{audit_key}.")

    if errors:
        print("[scenario-check] FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("[scenario-check] OK")
    print(f"- Scenario: {scenario_id}")
    print(f"- Owners: {summary.get('owner_count')}")
    print(f"- Controllers: {summary.get('controller_count')}")
    print(f"- Features: {summary.get('feature_count')}")
    print(f"- Approximate: {summary.get('approximate_count')}")
    print(f"- Split(owner/controller): {summary.get('owner_controller_split_feature_count')}")
    print(f"- Synthetic: {summary.get('synthetic_count')}")
    print(f"- Blockers: {summary.get('blocker_count')}")
    print(f"- Critical checks: {summary.get('critical_region_check_count')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
