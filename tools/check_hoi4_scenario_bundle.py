#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
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


def evaluate_owner_set_assertions(
    *,
    errors: list[str],
    assertions: list[object],
    owners_by_feature_id: dict[str, object],
) -> None:
    for index, raw in enumerate(assertions):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or f"owner_set_assertion_{index + 1}").strip()
        expected_owner = str(raw.get("expected_owner_tag") or "").strip().upper()
        if not expected_owner:
            errors.append(f"{name}: expected_owner_tag is required.")
            continue

        selected_ids: set[str] = set()
        for feature_id in raw.get("feature_ids", []) or []:
            candidate = str(feature_id).strip()
            if candidate:
                selected_ids.add(candidate)

        for prefix in raw.get("feature_id_prefixes", []) or []:
            prefix_value = str(prefix).strip()
            if not prefix_value:
                continue
            selected_ids.update(
                feature_id
                for feature_id in owners_by_feature_id.keys()
                if feature_id.startswith(prefix_value)
            )

        excluded_ids = {
            str(feature_id).strip()
            for feature_id in raw.get("exclude_feature_ids", []) or []
            if str(feature_id).strip()
        }
        selected_ids -= excluded_ids

        if not selected_ids:
            errors.append(f"{name}: assertion resolved zero feature IDs.")
            continue

        missing_ids = sorted(feature_id for feature_id in selected_ids if feature_id not in owners_by_feature_id)
        if missing_ids:
            errors.append(
                f"{name}: {len(missing_ids)} selected feature IDs are missing from owners payload "
                f"(sample: {missing_ids[:8]})."
            )
            continue

        wrong_ids = sorted(
            feature_id
            for feature_id in selected_ids
            if str(owners_by_feature_id.get(feature_id) or "").strip().upper() != expected_owner
        )
        if wrong_ids:
            errors.append(
                f"{name}: {len(wrong_ids)} / {len(selected_ids)} features do not match owner `{expected_owner}` "
                f"(sample: {wrong_ids[:8]})."
            )


def evaluate_controller_set_assertions(
    *,
    errors: list[str],
    assertions: list[object],
    controllers_by_feature_id: dict[str, object],
) -> None:
    for index, raw in enumerate(assertions):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or f"controller_set_assertion_{index + 1}").strip()
        expected_controller = str(raw.get("expected_controller_tag") or "").strip().upper()
        if not expected_controller:
            errors.append(f"{name}: expected_controller_tag is required.")
            continue

        selected_ids: set[str] = set()
        for feature_id in raw.get("feature_ids", []) or []:
            candidate = str(feature_id).strip()
            if candidate:
                selected_ids.add(candidate)

        for prefix in raw.get("feature_id_prefixes", []) or []:
            prefix_value = str(prefix).strip()
            if not prefix_value:
                continue
            selected_ids.update(
                feature_id
                for feature_id in controllers_by_feature_id.keys()
                if feature_id.startswith(prefix_value)
            )

        excluded_ids = {
            str(feature_id).strip()
            for feature_id in raw.get("exclude_feature_ids", []) or []
            if str(feature_id).strip()
        }
        selected_ids -= excluded_ids

        if not selected_ids:
            errors.append(f"{name}: assertion resolved zero feature IDs.")
            continue

        missing_ids = sorted(feature_id for feature_id in selected_ids if feature_id not in controllers_by_feature_id)
        if missing_ids:
            errors.append(
                f"{name}: {len(missing_ids)} selected feature IDs are missing from controllers payload "
                f"(sample: {missing_ids[:8]})."
            )
            continue

        wrong_ids = sorted(
            feature_id
            for feature_id in selected_ids
            if str(controllers_by_feature_id.get(feature_id) or "").strip().upper() != expected_controller
        )
        if wrong_ids:
            errors.append(
                f"{name}: {len(wrong_ids)} / {len(selected_ids)} features do not match controller `{expected_controller}` "
                f"(sample: {wrong_ids[:8]})."
            )


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
    owners_by_feature_id = owners.get("owners", {}) if isinstance(owners.get("owners", {}), dict) else {}
    controllers_by_feature_id = (
        controllers.get("controllers", {})
        if isinstance(controllers.get("controllers", {}), dict)
        else {}
    )

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

    featured_tags = [
        str(tag or "").strip().upper()
        for tag in (manifest.get("featured_tags") or [])
        if str(tag or "").strip()
    ]
    missing_featured_tags = [tag for tag in featured_tags if tag not in country_map]
    expect(
        not missing_featured_tags,
        f"manifest.featured_tags must all exist in countries.json. Missing: {missing_featured_tags[:10]}",
    )

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

    owner_set_assertions = expectation.get("owner_set_assertions", [])
    if isinstance(owner_set_assertions, list):
        evaluate_owner_set_assertions(
            errors=errors,
            assertions=owner_set_assertions,
            owners_by_feature_id=owners_by_feature_id,
        )
    controller_set_assertions = expectation.get("controller_set_assertions", [])
    if isinstance(controller_set_assertions, list):
        evaluate_controller_set_assertions(
            errors=errors,
            assertions=controller_set_assertions,
            controllers_by_feature_id=controllers_by_feature_id,
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
        summary.get("feature_count") == len(owners_by_feature_id),
        "manifest.summary.feature_count must equal owners.by_feature entry count.",
    )
    expect(
        summary.get("feature_count") == len(cores.get("cores", {})),
        "manifest.summary.feature_count must equal cores.by_feature entry count.",
    )
    if require_controllers and controllers:
        expect(
            summary.get("feature_count") == len(controllers_by_feature_id),
            "manifest.summary.feature_count must equal controllers.by_feature entry count.",
        )

    owner_tag_counts = Counter(
        str(tag or "").strip().upper()
        for tag in owners_by_feature_id.values()
        if str(tag or "").strip()
    )
    controller_tag_counts = Counter(
        str(tag or "").strip().upper()
        for tag in controllers_by_feature_id.values()
        if str(tag or "").strip()
    )
    missing_controller_country_tags = [
        tag
        for tag, count in sorted(controller_tag_counts.items())
        if count > 0 and tag not in country_map
    ]
    expect(
        not missing_controller_country_tags,
        "All controller tags must exist in countries.json. Missing: "
        f"{missing_controller_country_tags[:10]}",
    )
    for tag, entry in country_map.items():
        if str(entry.get("entry_kind") or "").strip().lower() != "controller_only":
            continue
        expected_controller_count = controller_tag_counts.get(tag, 0)
        actual_controller_count = int(entry.get("controller_feature_count") or 0)
        actual_owner_count = int(entry.get("feature_count") or 0)
        expect(
            actual_controller_count == expected_controller_count,
            f"controller_only country {tag}.controller_feature_count must equal controller payload count "
            f"({expected_controller_count}). Found {actual_controller_count}.",
        )
        expect(
            actual_owner_count == 0,
            f"controller_only country {tag}.feature_count must stay at 0. Found {actual_owner_count}.",
        )
        expect(
            owner_tag_counts.get(tag, 0) == 0,
            f"controller_only country {tag} must not own features in owners payload.",
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
