#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.contracts import SCENARIO_STRICT_REQUIRED_FILENAMES

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
STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES = ("RU_ARCTIC_FB_",)


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
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Enable strict bundle/runtime validation for publish-ready scenario or checkpoint directories.",
    )
    parser.add_argument(
        "--report-path",
        default="",
        help="Optional JSON report output path. Writes a structured validation report when provided.",
    )
    return parser.parse_args()


def create_repair_tracks() -> dict[str, Any]:
    return {
        "owners_controllers_keyset": None,
        "owners_cores_keyset": None,
        "runtime_topology_extra_ids": None,
        "geo_locale_collision_candidates": [],
    }


def build_scenario_report(scenario_dir: Path, strict: bool) -> dict[str, Any]:
    return {
        "scenario_id": scenario_dir.name,
        "scenario_dir": str(scenario_dir),
        "strict_mode": strict,
        "status": "ok",
        "errors": [],
        "warnings": [],
        "repair_tracks": create_repair_tracks(),
    }


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
    strict: bool = False,
    repair_tracks: dict[str, Any] | None = None,
) -> None:
    def _parse_audit_count(audit_payload: dict[str, Any], field: str, fallback: int) -> int:
        raw_value = audit_payload.get(field)
        if raw_value in (None, ""):
            return fallback
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            warning_key = f"{field}:{fallback}"
            if warning_key not in warned_invalid_audit_counts:
                warnings.append(
                    f"audit.{field} must be numeric when present; using fallback value {fallback}."
                )
                warned_invalid_audit_counts.add(warning_key)
            return fallback

    patch_descriptors = [
        ("geo_locale_patch_url", str(manifest.get("geo_locale_patch_url") or "").strip()),
        ("geo_locale_patch_url_en", str(manifest.get("geo_locale_patch_url_en") or "").strip()),
        ("geo_locale_patch_url_zh", str(manifest.get("geo_locale_patch_url_zh") or "").strip()),
    ]
    active_patch_descriptors = [(field, url) for field, url in patch_descriptors if url]
    if not active_patch_descriptors:
        return
    audit_reported = False
    suspicious_reported = False
    warned_invalid_audit_counts: set[str] = set()
    suspicious_sample_signatures: set[tuple[str, ...]] = set()
    for field_name, geo_locale_patch_url in active_patch_descriptors:
        geo_locale_patch_path = scenario_relative_url_to_path(geo_locale_patch_url)
        if geo_locale_patch_path is None or not geo_locale_patch_path.exists():
            errors.append(f"{field_name} target must exist. Missing: {geo_locale_patch_url}")
            continue

        try:
            payload = load_json(geo_locale_patch_path)
        except Exception as exc:
            errors.append(str(exc))
            continue
        payload_scenario_id = str(payload.get("scenario_id") or "").strip()
        if payload_scenario_id and payload_scenario_id != expected_scenario_id:
            errors.append(
                f"{field_name} scenario_id must be `{expected_scenario_id}`. Found `{payload_scenario_id}`."
            )

        geo_payload = payload.get("geo")
        if not isinstance(geo_payload, dict):
            errors.append(f"{field_name} geo payload must be an object.")
            continue

        audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else {}
        collision_candidates = audit.get("collision_candidates", [])
        if collision_candidates not in (None, [], {}) and not isinstance(collision_candidates, list):
            errors.append(f"{field_name} audit.collision_candidates must be a list when present.")
            continue
        collision_candidates = collision_candidates if isinstance(collision_candidates, list) else []
        reviewed_collision_candidates = audit.get("reviewed_collision_candidates", [])
        if reviewed_collision_candidates not in (None, [], {}) and not isinstance(reviewed_collision_candidates, list):
            errors.append(f"{field_name} audit.reviewed_collision_candidates must be a list when present.")
            continue
        reviewed_collision_candidates = (
            reviewed_collision_candidates if isinstance(reviewed_collision_candidates, list) else []
        )
        excluded_feature_prefixes = audit.get("excluded_feature_prefixes", [])
        if excluded_feature_prefixes not in (None, [], {}) and not isinstance(excluded_feature_prefixes, list):
            errors.append(f"{field_name} audit.excluded_feature_prefixes must be a list when present.")
            continue
        excluded_feature_prefixes = [
            str(prefix).strip().upper()
            for prefix in (excluded_feature_prefixes if isinstance(excluded_feature_prefixes, list) else [])
            if str(prefix).strip()
        ]
        excluded_features = audit.get("excluded_features", [])
        if excluded_features not in (None, [], {}) and not isinstance(excluded_features, list):
            errors.append(f"{field_name} audit.excluded_features must be a list when present.")
            continue
        excluded_features = excluded_features if isinstance(excluded_features, list) else []

        collision_count = _parse_audit_count(audit, "collision_candidate_count", len(collision_candidates))
        cross_base_collision_count = _parse_audit_count(audit, "cross_base_collision_count", collision_count)
        split_clone_safe_copy_count = _parse_audit_count(audit, "split_clone_safe_copy_count", 0)
        reviewed_collision_exception_count = _parse_audit_count(
            audit,
            "reviewed_collision_exception_count",
            len(reviewed_collision_candidates),
        )
        excluded_feature_count = _parse_audit_count(audit, "excluded_feature_count", len(excluded_features))

        if collision_count != len(collision_candidates):
            errors.append(
                f"{field_name} audit.collision_candidate_count must equal the collision_candidates list length."
            )
        if reviewed_collision_exception_count != len(reviewed_collision_candidates):
            errors.append(
                f"{field_name} audit.reviewed_collision_exception_count must equal the reviewed_collision_candidates list length."
            )
        if excluded_feature_count != len(excluded_features):
            errors.append(
                f"{field_name} audit.excluded_feature_count must equal the excluded_features list length."
            )
        if excluded_features and not excluded_feature_prefixes:
            errors.append(
                f"{field_name} audit.excluded_features requires non-empty excluded_feature_prefixes."
            )
        for excluded_row in excluded_features:
            if not isinstance(excluded_row, dict):
                errors.append(f"{field_name} audit.excluded_features must only contain objects.")
                break
            feature_id = str(excluded_row.get("feature_id") or "").strip().upper()
            if not feature_id:
                errors.append(f"{field_name} audit.excluded_features must include feature_id values.")
                break
            if excluded_feature_prefixes and not feature_id.startswith(tuple(excluded_feature_prefixes)):
                errors.append(
                    f"{field_name} audit.excluded_features may only include ids that match excluded_feature_prefixes. "
                    f"Offending feature: {feature_id}."
                )
                break

        if collision_candidates:
            if not audit_reported:
                sample = (
                    audit.get("collision_candidates_sample")
                    if isinstance(audit.get("collision_candidates_sample"), list)
                    else collision_candidates[:5]
                )
                message = (
                    f"{field_name} recorded unresolved locale collision candidates. "
                    f"{cross_base_collision_count} cross-base collisions remain after "
                    f"{split_clone_safe_copy_count} split-clone safe copies and "
                    f"{reviewed_collision_exception_count} reviewed exceptions. Sample: {sample[:5]!r}."
                )
                if strict:
                    errors.append(message)
                else:
                    warnings.append(message)
                if repair_tracks is not None:
                    geo_locale_tracks = repair_tracks.setdefault("geo_locale_collision_candidates", [])
                    if isinstance(geo_locale_tracks, list):
                        geo_locale_tracks.append(
                            {
                                "field_name": field_name,
                                "collision_candidate_count": collision_count,
                                "cross_base_collision_count": cross_base_collision_count,
                                "split_clone_safe_copy_count": split_clone_safe_copy_count,
                                "reviewed_collision_exception_count": reviewed_collision_exception_count,
                                "sample": sample[:5],
                            }
                        )
                audit_reported = True

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
        suspicious_signature = tuple(suspicious_samples)
        if suspicious_samples and not suspicious_reported and suspicious_signature not in suspicious_sample_signatures:
            errors.append(
                f"{field_name} contains high-risk machine-translation candidates. "
                f"Sample: {suspicious_samples}."
            )
            suspicious_reported = True
            suspicious_sample_signatures.add(suspicious_signature)


def _load_required_local_json(path: Path, errors: list[str]) -> dict | None:
    if not path.exists():
        errors.append(f"Required file is missing: {path}")
        return None
    try:
        return load_json(path)
    except Exception as exc:
        errors.append(str(exc))
        return None


def _extract_runtime_political_feature_ids(runtime_payload: dict, errors: list[str], runtime_path: Path) -> set[str]:
    objects = runtime_payload.get("objects")
    if not isinstance(objects, dict):
        errors.append(f"runtime_topology payload must contain objects at {runtime_path}.")
        return set()
    political = objects.get("political")
    if not isinstance(political, dict):
        errors.append(f"runtime_topology payload must contain objects.political at {runtime_path}.")
        return set()
    geometries = political.get("geometries")
    if not isinstance(geometries, list):
        errors.append(f"runtime_topology payload must contain objects.political.geometries at {runtime_path}.")
        return set()
    feature_ids: set[str] = set()
    missing_ids = 0
    for geometry in geometries:
        if not isinstance(geometry, dict):
            continue
        props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
        feature_id = str(props.get("id") or geometry.get("id") or "").strip()
        if not feature_id:
            missing_ids += 1
            continue
        feature_ids.add(feature_id)
    if missing_ids:
        errors.append(
            f"runtime_topology political geometries must expose stable ids. Missing ids on {missing_ids} geometries."
        )
    return feature_ids


def validate_strict_bundle_contract(
    target_dir: Path,
    errors: list[str],
    repair_tracks: dict[str, Any] | None = None,
) -> None:
    required_payloads = {
        filename: _load_required_local_json(target_dir / filename, errors)
        for filename in SCENARIO_STRICT_REQUIRED_FILENAMES
    }
    if any(payload is None for payload in required_payloads.values()):
        return
    manifest = required_payloads["manifest.json"]
    owners_payload = required_payloads["owners.by_feature.json"]
    controllers_payload = required_payloads["controllers.by_feature.json"]
    cores_payload = required_payloads["cores.by_feature.json"]
    runtime_payload = required_payloads["runtime_topology.topo.json"]

    owners = owners_payload.get("owners")
    controllers = controllers_payload.get("controllers")
    cores = cores_payload.get("cores")
    if not isinstance(owners, dict):
        errors.append("owners.by_feature.json owners payload must be an object in strict mode.")
        return
    if not isinstance(controllers, dict):
        errors.append("controllers.by_feature.json controllers payload must be an object in strict mode.")
        return
    if not isinstance(cores, dict):
        errors.append("cores.by_feature.json cores payload must be an object in strict mode.")
        return

    non_list_core_ids = [feature_id for feature_id, value in cores.items() if not isinstance(value, list)]
    if non_list_core_ids:
        errors.append(
            "cores.by_feature.json must store arrays for every feature in strict mode. "
            f"Sample: {non_list_core_ids[:10]}."
        )

    owner_ids = {str(feature_id).strip() for feature_id in owners.keys() if str(feature_id).strip()}
    controller_ids = {str(feature_id).strip() for feature_id in controllers.keys() if str(feature_id).strip()}
    core_ids = {str(feature_id).strip() for feature_id in cores.keys() if str(feature_id).strip()}
    if owner_ids != controller_ids:
        controller_only_ids = sorted(controller_ids - owner_ids)
        owner_only_ids = sorted(owner_ids - controller_ids)
        if repair_tracks is not None:
            repair_tracks["owners_controllers_keyset"] = {
                "owners_count": len(owner_ids),
                "controllers_count": len(controller_ids),
                "controller_only_count": len(controller_only_ids),
                "controller_only_sample": controller_only_ids[:10],
                "owner_only_count": len(owner_only_ids),
                "owner_only_sample": owner_only_ids[:10],
            }
        errors.append(
            "owners/controllers feature keysets must match in strict mode. "
            f"owners={len(owner_ids)} controllers={len(controller_ids)} "
            f"controller_only={controller_only_ids[:10]} "
            f"owner_only={owner_only_ids[:10]}."
        )
    if owner_ids != core_ids:
        core_only_ids = sorted(core_ids - owner_ids)
        owner_only_ids = sorted(owner_ids - core_ids)
        if repair_tracks is not None:
            repair_tracks["owners_cores_keyset"] = {
                "owners_count": len(owner_ids),
                "cores_count": len(core_ids),
                "core_only_count": len(core_only_ids),
                "core_only_sample": core_only_ids[:10],
                "owner_only_count": len(owner_only_ids),
                "owner_only_sample": owner_only_ids[:10],
            }
        errors.append(
            "owners/cores feature keysets must match in strict mode. "
            f"owners={len(owner_ids)} cores={len(core_ids)} "
            f"core_only={core_only_ids[:10]} "
            f"owner_only={owner_only_ids[:10]}."
        )

    manifest_summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
    manifest_feature_count = manifest_summary.get("feature_count")
    try:
        expected_feature_count = int(manifest_feature_count)
    except (TypeError, ValueError):
        errors.append(f"manifest.summary.feature_count must be an integer in strict mode. Found {manifest_feature_count!r}.")
        expected_feature_count = None
    if expected_feature_count is not None and expected_feature_count != len(owner_ids):
        errors.append(
            "manifest.summary.feature_count must equal owners feature count in strict mode. "
            f"manifest={expected_feature_count} owners={len(owner_ids)}."
        )

    runtime_feature_ids = _extract_runtime_political_feature_ids(runtime_payload, errors, target_dir / "runtime_topology.topo.json")
    missing_runtime_ids = sorted(owner_ids - runtime_feature_ids)
    if missing_runtime_ids:
        errors.append(
            "runtime_topology is missing feature ids referenced by owners/controllers/cores in strict mode. "
            f"Sample: {missing_runtime_ids[:10]}."
        )
    extra_runtime_ids = runtime_feature_ids - owner_ids
    illegal_runtime_only_ids = sorted(
        feature_id
        for feature_id in extra_runtime_ids
        if not any(feature_id.startswith(prefix) for prefix in STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES)
    )
    if illegal_runtime_only_ids:
        if repair_tracks is not None:
            repair_tracks["runtime_topology_extra_ids"] = {
                "extra_runtime_id_count": len(illegal_runtime_only_ids),
                "extra_runtime_id_sample": illegal_runtime_only_ids[:10],
                "allowed_runtime_only_prefixes": list(STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES),
            }
        errors.append(
            "runtime_topology political geometries may only exceed the feature maps with shell fallback ids in strict mode. "
            f"Sample: {illegal_runtime_only_ids[:10]}."
        )


def validate_publish_bundle_dir(target_dir: Path) -> list[str]:
    errors: list[str] = []
    validate_strict_bundle_contract(target_dir, errors)
    return errors


def inspect_scenario_contract(
    scenario_dir: Path,
    duplicate_scenario_dirs: dict[str, list[str]],
    strict: bool = False,
) -> dict[str, Any]:
    report = build_scenario_report(scenario_dir, strict)
    errors: list[str] = report["errors"]
    warnings: list[str] = report["warnings"]
    repair_tracks: dict[str, Any] = report["repair_tracks"]
    manifest_path = scenario_dir / "manifest.json"
    if not manifest_path.exists():
        report["errors"] = [f"manifest.json is missing at {manifest_path}."]
        report["status"] = "failed"
        return report

    try:
        manifest = load_json(manifest_path)
    except Exception as exc:
        report["errors"] = [str(exc)]
        report["status"] = "failed"
        return report
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
    validate_locale_patch(expected_scenario_id, manifest, errors, warnings, strict=strict, repair_tracks=repair_tracks)
    if strict:
        validate_strict_bundle_contract(scenario_dir, errors, repair_tracks=repair_tracks)
    report["status"] = "failed" if errors else "ok"
    return report


def validate_scenario_contract(
    scenario_dir: Path,
    duplicate_scenario_dirs: dict[str, list[str]],
    strict: bool = False,
) -> tuple[list[str], list[str]]:
    report = inspect_scenario_contract(scenario_dir, duplicate_scenario_dirs, strict=strict)
    return list(report["errors"]), list(report["warnings"])


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


def render_repair_track_lines(repair_tracks: dict[str, Any], strict: bool) -> list[str]:
    lines: list[str] = []
    owners_controllers = repair_tracks.get("owners_controllers_keyset")
    if strict and isinstance(owners_controllers, dict):
        lines.append(
            "owners/controllers keyset "
            f"controller_only={owners_controllers.get('controller_only_count', 0)} "
            f"owner_only={owners_controllers.get('owner_only_count', 0)} "
            f"sample={owners_controllers.get('controller_only_sample', [])[:5]}"
        )
    owners_cores = repair_tracks.get("owners_cores_keyset")
    if strict and isinstance(owners_cores, dict):
        lines.append(
            "owners/cores keyset "
            f"core_only={owners_cores.get('core_only_count', 0)} "
            f"owner_only={owners_cores.get('owner_only_count', 0)} "
            f"sample={owners_cores.get('core_only_sample', [])[:5]}"
        )
    runtime_topology_extra_ids = repair_tracks.get("runtime_topology_extra_ids")
    if strict and isinstance(runtime_topology_extra_ids, dict):
        lines.append(
            "runtime_topology extra ids "
            f"count={runtime_topology_extra_ids.get('extra_runtime_id_count', 0)} "
            f"sample={runtime_topology_extra_ids.get('extra_runtime_id_sample', [])[:5]}"
        )
    geo_locale_collision_candidates = repair_tracks.get("geo_locale_collision_candidates")
    if isinstance(geo_locale_collision_candidates, list):
        for entry in geo_locale_collision_candidates:
            if not isinstance(entry, dict):
                continue
            lines.append(
                "geo_locale collision candidates "
                f"field={entry.get('field_name', '')} "
                f"remaining={entry.get('cross_base_collision_count', 0)} "
                f"safe_copies={entry.get('split_clone_safe_copy_count', 0)} "
                f"reviewed_exceptions={entry.get('reviewed_collision_exception_count', 0)} "
                f"sample={entry.get('sample', [])[:2]}"
            )
    return lines


def write_validation_report(report_path: Path, reports: list[dict[str, Any]], strict: bool) -> None:
    payload = {
        "mode": "strict" if strict else "default",
        "scenario_count": len(reports),
        "reports": reports,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    args = parse_args()
    scenarios_root = Path(args.scenarios_root).resolve()
    scenario_dirs = discover_scenario_dirs(scenarios_root, args.scenario_dir)
    if not scenario_dirs:
        raise SystemExit("No scenario directories found to validate.")

    duplicate_scenario_dirs = collect_duplicate_scenario_dirs(discover_scenario_dirs(scenarios_root, []))
    any_errors = False
    reports: list[dict[str, Any]] = []
    for scenario_dir in scenario_dirs:
        report = inspect_scenario_contract(scenario_dir, duplicate_scenario_dirs, strict=args.strict)
        reports.append(report)
        errors = list(report["errors"])
        warnings = list(report["warnings"])
        if errors:
            any_errors = True
            print(f"[scenario-contract] FAILED {scenario_dir.name}")
            for error in errors:
                print(f"- {error}")
            for warning in warnings:
                print(f"! {warning}")
            repair_track_lines = render_repair_track_lines(report.get("repair_tracks", {}), strict=args.strict)
            for line in repair_track_lines:
                print(f"~ {line}")
            continue
        print(f"[scenario-contract] OK {scenario_dir.name}")
        for warning in warnings:
            print(f"! {warning}")
        repair_track_lines = render_repair_track_lines(report.get("repair_tracks", {}), strict=args.strict)
        for line in repair_track_lines:
            print(f"~ {line}")

    if args.report_path:
        write_validation_report(Path(args.report_path).resolve(), reports, strict=args.strict)

    return 1 if any_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
