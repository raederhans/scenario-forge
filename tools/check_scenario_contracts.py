#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path, PurePosixPath


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCENARIOS_ROOT = PROJECT_ROOT / "data/scenarios"
IGNORED_DIR_NAMES = {"expectations"}
COMMON_REQUIRED_MANIFEST_FIELDS = (
    "version",
    "scenario_id",
    "display_name",
    "bookmark_name",
    "bookmark_description",
    "bookmark_date",
    "default_country",
    "featured_tags",
    "palette_id",
    "baseline_hash",
    "countries_url",
    "owners_url",
    "controllers_url",
    "cores_url",
    "audit_url",
    "summary",
    "generated_at",
)
V2_REQUIRED_MANIFEST_FIELDS = (
    "performance_hints",
    "style_defaults",
    "city_overrides_url",
    "capital_hints_url",
)
SUSPICIOUS_LOCALE_TRANSLATIONS = {
    "\u8df3\u6c60",
    "\u4e3b\u6301\u4eba",
    "\u534f\u8bae",
    "\u4e00\u4e2a\u65e5\u5fd7",
    "\u591a\u4e91",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate checked-in scenario contracts using the scenario directory name "
            "as the canonical scenario_id."
        )
    )
    parser.add_argument(
        "--scenarios-root",
        default=str(DEFAULT_SCENARIOS_ROOT),
        help="Root directory containing scenario folders. Defaults to data/scenarios.",
    )
    parser.add_argument(
        "--scenario-dir",
        action="append",
        default=[],
        help="Optional specific scenario directory to validate. May be repeated.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON at {path}: {exc}") from exc


def has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def discover_scenario_dirs(scenarios_root: Path, explicit_dirs: list[str]) -> list[Path]:
    if explicit_dirs:
        return sorted(Path(raw).resolve() for raw in explicit_dirs)
    return sorted(
        path.resolve()
        for path in scenarios_root.iterdir()
        if path.is_dir() and path.name not in IGNORED_DIR_NAMES
    )


def scenario_relative_url_to_path(raw_url: str) -> Path | None:
    if not str(raw_url or "").strip():
        return None
    posix_path = PurePosixPath(str(raw_url).strip())
    return PROJECT_ROOT.joinpath(*posix_path.parts)


def normalize_featured_tags(manifest: dict) -> list[str]:
    tags: list[str] = []
    for raw in manifest.get("featured_tags") or []:
        tag = str(raw or "").strip().upper()
        if tag:
            tags.append(tag)
    return tags


def validate_manifest_version_matrix(manifest: dict, errors: list[str]) -> None:
    version = manifest.get("version")
    if version not in (1, 2):
        errors.append(f"manifest.version must be 1 or 2. Found {version!r}.")
        return

    for field in COMMON_REQUIRED_MANIFEST_FIELDS:
        if not has_value(manifest.get(field)):
            errors.append(f"manifest.{field} must be present.")

    if version == 1:
        drift_fields = [field for field in V2_REQUIRED_MANIFEST_FIELDS if has_value(manifest.get(field))]
        if drift_fields:
            errors.append(
                "manifest.version 1 must not declare v2-only fields. "
                f"Found: {', '.join(drift_fields)}."
            )
        return

    missing_v2 = [field for field in V2_REQUIRED_MANIFEST_FIELDS if not has_value(manifest.get(field))]
    if missing_v2:
        errors.append(
            "manifest.version 2 must include all required v2 fields. "
            f"Missing: {', '.join(missing_v2)}."
        )
    if has_value(manifest.get("performance_hints")) and not isinstance(manifest.get("performance_hints"), dict):
        errors.append("manifest.performance_hints must be an object for version 2.")
    if has_value(manifest.get("style_defaults")) and not isinstance(manifest.get("style_defaults"), dict):
        errors.append("manifest.style_defaults must be an object for version 2.")


def validate_manifest_urls(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    for key, raw_value in manifest.items():
        if not key.endswith("_url"):
            continue
        url = str(raw_value or "").strip()
        if not url:
            continue
        if not url.startswith("data/scenarios/"):
            continue
        posix_path = PurePosixPath(url)
        if len(posix_path.parts) < 3:
            errors.append(f"manifest.{key} must point at data/scenarios/<scenario_id>/..., found `{url}`.")
            continue
        actual_dir = posix_path.parts[2]
        if actual_dir != expected_scenario_id:
            errors.append(
                f"manifest.{key} must point at scenario directory `{expected_scenario_id}`. "
                f"Found `{actual_dir}` via `{url}`."
            )


def validate_runtime_capitals(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    city_overrides_url = str(manifest.get("city_overrides_url") or "").strip()
    if not city_overrides_url:
        return
    city_overrides_path = scenario_relative_url_to_path(city_overrides_url)
    if city_overrides_path is None or not city_overrides_path.exists():
        errors.append(f"city_overrides_url target must exist. Missing: {city_overrides_url}")
        return

    try:
        payload = load_json(city_overrides_path)
    except Exception as exc:
        errors.append(str(exc))
        return
    payload_scenario_id = str(payload.get("scenario_id") or "").strip()
    if payload_scenario_id and payload_scenario_id != expected_scenario_id:
        errors.append(
            f"city_overrides.json scenario_id must be `{expected_scenario_id}`. Found `{payload_scenario_id}`."
        )

    capitals_by_tag = payload.get("capitals_by_tag")
    capital_city_hints = payload.get("capital_city_hints")
    if not isinstance(capitals_by_tag, dict):
        errors.append("city_overrides.json capitals_by_tag must be an object.")
        return
    if not isinstance(capital_city_hints, dict):
        errors.append("city_overrides.json capital_city_hints must be an object.")
        return

    featured_tags = normalize_featured_tags(manifest)
    missing_tags = [
        tag
        for tag in featured_tags
        if tag not in capitals_by_tag and tag not in capital_city_hints
    ]
    if missing_tags:
        errors.append(
            "Every manifest.featured_tag must be resolvable from city_overrides.json "
            "capitals_by_tag or capital_city_hints. "
            f"Missing: {missing_tags[:20]}."
        )

    capital_hints_url = str(manifest.get("capital_hints_url") or "").strip()
    if not capital_hints_url:
        return
    capital_hints_path = scenario_relative_url_to_path(capital_hints_url)
    if capital_hints_path is None or not capital_hints_path.exists():
        errors.append(f"capital_hints_url target must exist. Missing: {capital_hints_url}")
        return
    try:
        capital_hints_payload = load_json(capital_hints_path)
    except Exception as exc:
        errors.append(str(exc))
        return
    capital_hints_scenario_id = str(capital_hints_payload.get("scenario_id") or "").strip()
    if capital_hints_scenario_id and capital_hints_scenario_id != expected_scenario_id:
        errors.append(
            f"capital_hints.json scenario_id must be `{expected_scenario_id}`. Found `{capital_hints_scenario_id}`."
        )


def validate_locale_patch(
    expected_scenario_id: str,
    manifest: dict,
    errors: list[str],
    warnings: list[str],
) -> None:
    geo_locale_patch_url = str(manifest.get("geo_locale_patch_url") or "").strip()
    if not geo_locale_patch_url:
        return
    geo_locale_patch_path = scenario_relative_url_to_path(geo_locale_patch_url)
    if geo_locale_patch_path is None or not geo_locale_patch_path.exists():
        errors.append(f"geo_locale_patch_url target must exist. Missing: {geo_locale_patch_url}")
        return

    try:
        payload = load_json(geo_locale_patch_path)
    except Exception as exc:
        errors.append(str(exc))
        return
    payload_scenario_id = str(payload.get("scenario_id") or "").strip()
    if payload_scenario_id and payload_scenario_id != expected_scenario_id:
        errors.append(
            f"geo_locale_patch.json scenario_id must be `{expected_scenario_id}`. Found `{payload_scenario_id}`."
        )

    geo_payload = payload.get("geo")
    if not isinstance(geo_payload, dict):
        errors.append("geo_locale_patch.json geo payload must be an object.")
        return

    audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else {}
    collision_candidates = audit.get("collision_candidates") if isinstance(audit, dict) else []
    if collision_candidates and isinstance(collision_candidates, list):
        sample = collision_candidates[:5]
        warnings.append(
            "geo_locale_patch.json recorded locale collision candidates for manual review. "
            f"Sample: {sample!r}."
        )
    elif collision_candidates not in (None, [], {}):
        errors.append("geo_locale_patch.json audit.collision_candidates must be a list when present.")

    suspicious_samples: list[str] = []
    for feature_id, entry in geo_payload.items():
        if not isinstance(entry, dict):
            continue
        zh_value = entry.get("zh")
        en_value = entry.get("en")
        if zh_value in SUSPICIOUS_LOCALE_TRANSLATIONS:
            suspicious_samples.append(
                f"{feature_id}:{str(en_value or '').strip()}->{str(zh_value or '').strip()}"
            )
        if len(suspicious_samples) >= 8:
            break
    if suspicious_samples:
        errors.append(
            "geo_locale_patch.json contains high-risk machine-translation candidates. "
            f"Sample: {suspicious_samples}."
        )


def validate_scenario_contract(
    scenario_dir: Path,
    duplicate_scenario_dirs: dict[str, list[str]],
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    manifest_path = scenario_dir / "manifest.json"
    if not manifest_path.exists():
        return [f"manifest.json is missing at {manifest_path}."], warnings

    try:
        manifest = load_json(manifest_path)
    except Exception as exc:
        return [str(exc)], warnings
    expected_scenario_id = scenario_dir.name
    actual_scenario_id = str(manifest.get("scenario_id") or "").strip()

    if actual_scenario_id != expected_scenario_id:
        errors.append(
            f"manifest.scenario_id must equal scenario directory name `{expected_scenario_id}`. "
            f"Found `{actual_scenario_id}`."
        )
    duplicate_dirs = duplicate_scenario_dirs.get(actual_scenario_id or expected_scenario_id, [])
    if duplicate_dirs:
        errors.append(
            "scenario_id must be globally unique across data/scenarios. "
            f"Duplicate directories for `{actual_scenario_id or expected_scenario_id}`: {duplicate_dirs}."
        )

    validate_manifest_version_matrix(manifest, errors)
    validate_manifest_urls(expected_scenario_id, manifest, errors)
    validate_runtime_capitals(expected_scenario_id, manifest, errors)
    validate_locale_patch(expected_scenario_id, manifest, errors, warnings)
    return errors, warnings


def collect_duplicate_scenario_dirs(scenario_dirs: list[Path]) -> dict[str, list[str]]:
    scenario_id_to_dirs: defaultdict[str, list[str]] = defaultdict(list)
    for scenario_dir in scenario_dirs:
        manifest_path = scenario_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = load_json(manifest_path)
        except Exception:
            continue
        scenario_id = str(manifest.get("scenario_id") or "").strip()
        if scenario_id:
            scenario_id_to_dirs[scenario_id].append(scenario_dir.name)

    duplicates: dict[str, list[str]] = {}
    for scenario_id, dirs in scenario_id_to_dirs.items():
        if len(dirs) > 1:
            duplicates[scenario_id] = sorted(dirs)
    return duplicates


def main() -> int:
    args = parse_args()
    scenarios_root = Path(args.scenarios_root).resolve()
    scenario_dirs = discover_scenario_dirs(scenarios_root, args.scenario_dir)
    if not scenario_dirs:
        raise SystemExit("No scenario directories found to validate.")

    duplicate_scenario_dirs = collect_duplicate_scenario_dirs(discover_scenario_dirs(scenarios_root, []))
    any_errors = False
    for scenario_dir in scenario_dirs:
        errors, warnings = validate_scenario_contract(scenario_dir, duplicate_scenario_dirs)
        if errors:
            any_errors = True
            print(f"[scenario-contract] FAILED {scenario_dir.name}")
            for error in errors:
                print(f"- {error}")
            for warning in warnings:
                print(f"! {warning}")
            continue
        print(f"[scenario-contract] OK {scenario_dir.name}")
        for warning in warnings:
            print(f"! {warning}")

    return 1 if any_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
