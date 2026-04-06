from __future__ import annotations

import argparse
import copy
from contextlib import contextmanager
import gzip
import http.server
import json
import math
import os
import re
from pathlib import Path
import socketserver
import sys
from datetime import datetime
from urllib.parse import parse_qs, urlparse
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder import config as cfg
from map_builder.io.writers import write_json_atomic, write_text_atomic
from map_builder.scenario_city_overrides_composer import (
    extract_city_assets_payload,
    normalize_capital_overrides_payload,
)
from map_builder.scenario_context import (
    _read_json as scenario_context_read_json,
    ensure_path_within_allowed_bases as scenario_context_ensure_path_within_allowed_bases,
    ensure_path_within_root as scenario_context_ensure_path_within_root,
    load_locked_scenario_context as scenario_context_load_locked_scenario_context,
    load_scenario_context as scenario_context_load_scenario_context,
    locked_repo_paths as scenario_context_locked_repo_paths,
    normalize_locked_paths as scenario_context_normalize_locked_paths,
    repo_relative as scenario_context_repo_relative,
    resolve_repo_path as scenario_context_resolve_repo_path,
    scenario_transaction_paths as scenario_context_transaction_paths,
)
from map_builder.scenario_mutations import (
    DEFAULT_SCENARIO_MUTATIONS_FILENAME,
    default_scenario_mutations_payload,
    normalize_scenario_mutations_payload,
)
from map_builder.scenario_materialization_service import (
    materialize_in_locked_context,
    write_mutation_patch_in_locked_context,
)
from map_builder.scenario_publish_service import (
    publish_scenario_outputs_in_locked_context,
)
from map_builder.scenario_geo_locale_materializer import (
    normalize_geo_locale_entry as _normalize_locale_entry,
)
from map_builder.scenario_district_groups_service import (
    build_tag_districts as build_tag_districts_service,
    load_scenario_tag_feature_ids as load_scenario_tag_feature_ids_service,
)
from map_builder.scenario_political_materialization_service import (
    build_political_materialization_transaction_in_context,
    build_political_materializer_deps,
)
from map_builder.scenario_political_materializer import (
    build_capital_city_override_entry_payload,
)
from map_builder import scenario_political_support
from map_builder.scenario_service_errors import ScenarioServiceError as DevServerError

# Define the range of ports to try
PORT_START = 8000
PORT_END = 8030
BIND_ADDRESS = "127.0.0.1"
RUNTIME_ACTIVE_SERVER_PATH = Path(".runtime") / "dev" / "active_server.json"
DEFAULT_SHARED_DISTRICT_TEMPLATES_PATH = ROOT / "data" / "scenarios" / "district_templates.shared.json"
MAX_JSON_BODY_BYTES = 1024 * 1024
TAG_CODE_PATTERN = re.compile(r"^[A-Z]{2,4}$")
COUNTRY_CODE_PATTERN = re.compile(r"^[A-Z]{2,3}$")
DISTRICT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
COLOR_HEX_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
INSPECTOR_GROUP_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$")
GZIP_STATIC_SUFFIXES = (".json", ".geojson", ".topo.json")


class DevServerTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def handle_error(self, request, client_address):
        _, error, _ = sys.exc_info()
        if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def _read_json(path: Path) -> object:
    return scenario_context_read_json(path)


def _normalize_locked_paths(paths: list[Path | None]) -> list[Path]:
    return scenario_context_normalize_locked_paths(paths)


@contextmanager
def _locked_repo_paths(paths: list[Path | None]):
    with scenario_context_locked_repo_paths(paths):
        yield


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def _read_json_or_none(path: Path | None) -> object | None:
    if not path or not path.exists():
        return None
    return _read_json(path)


def _capture_text_snapshot(path: Path) -> tuple[Path, bool, str]:
    if path.exists():
        return path, True, path.read_text(encoding="utf-8")
    return path, False, ""


def _restore_text_snapshot(path: Path, *, existed: bool, original_text: str) -> None:
    if existed:
        write_text_atomic(path, original_text, encoding="utf-8")
    else:
        path.unlink(missing_ok=True)


def _repo_relative(path: Path, *, root: Path = ROOT) -> str:
    return scenario_context_repo_relative(path, root=root)


def _ensure_path_within_root(path: Path, *, root: Path = ROOT) -> Path:
    return scenario_context_ensure_path_within_root(path, root=root, error_cls=DevServerError)


def _resolve_repo_path(raw_path: object, *, root: Path = ROOT) -> Path:
    return scenario_context_resolve_repo_path(raw_path, root=root, error_cls=DevServerError)


def _ensure_path_within_allowed_bases(
    path: Path,
    *,
    allowed_bases: tuple[Path, ...],
    label: str,
    root: Path = ROOT,
) -> Path:
    return scenario_context_ensure_path_within_allowed_bases(
        path,
        allowed_bases=allowed_bases,
        label=label,
        root=root,
        error_cls=DevServerError,
    )


def _normalize_code(value: object) -> str:
    return str(value or "").strip().upper()


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _normalize_feature_ids(feature_ids: object) -> list[str]:
    if not isinstance(feature_ids, list):
        raise DevServerError("invalid_feature_ids", "Feature ids must be provided as an array.", status=400)
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_feature_id in feature_ids:
        feature_id = _normalize_text(raw_feature_id)
        if not feature_id:
            raise DevServerError("invalid_feature_ids", "Feature ids cannot contain empty values.", status=400)
        if feature_id in seen:
            continue
        seen.add(feature_id)
        normalized.append(feature_id)
    if not normalized:
        raise DevServerError("empty_feature_ids", "At least one feature id is required.", status=400)
    return normalized


def _validate_tag_code(tag: object) -> str:
    normalized_tag = _normalize_code(tag)
    if not TAG_CODE_PATTERN.fullmatch(normalized_tag):
        raise DevServerError(
            "invalid_tag_code",
            "Tag codes must use 2-4 uppercase ASCII letters.",
            status=400,
        )
    return normalized_tag


def _validate_country_code(country_code: object) -> str:
    normalized_country_code = _normalize_code(country_code)
    if not COUNTRY_CODE_PATTERN.fullmatch(normalized_country_code):
        raise DevServerError(
            "invalid_country_code",
            "Country codes must use 2-3 uppercase ASCII letters.",
            status=400,
        )
    return normalized_country_code


def _validate_color_hex(color_hex: object) -> str:
    normalized_color = _normalize_text(color_hex)
    if not COLOR_HEX_PATTERN.fullmatch(normalized_color):
        raise DevServerError(
            "invalid_color_hex",
            "Color hex values must use the format #RRGGBB.",
            status=400,
        )
    return normalized_color.lower()


def _normalize_optional_int(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = int(text)
    except (TypeError, ValueError) as exc:
        raise DevServerError("invalid_integer", "Expected an integer value.", status=400) from exc
    return parsed


def _normalize_optional_float(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = float(text)
    except (TypeError, ValueError) as exc:
        raise DevServerError("invalid_number", "Expected a numeric value.", status=400) from exc
    if not math.isfinite(parsed):
        raise DevServerError("invalid_number", "Expected a finite numeric value.", status=400)
    return parsed


def _normalize_inspector_group_fields(
    group_id: object,
    group_label: object,
    group_anchor_id: object,
) -> tuple[str, str, str]:
    normalized_id = _normalize_text(group_id)
    normalized_label = _normalize_text(group_label)
    normalized_anchor_id = _normalize_text(group_anchor_id)
    if not normalized_id and not normalized_label and not normalized_anchor_id:
        return "", "", ""
    if not normalized_id:
        raise DevServerError("missing_inspector_group_id", "Inspector group id is required.", status=400)
    if not INSPECTOR_GROUP_ID_PATTERN.fullmatch(normalized_id):
        raise DevServerError(
            "invalid_inspector_group_id",
            "Inspector group ids must use letters, numbers, underscore, or hyphen.",
            status=400,
        )
    if not normalized_label:
        raise DevServerError("missing_inspector_group_label", "Inspector group label is required.", status=400)
    if not normalized_anchor_id:
        raise DevServerError(
            "missing_inspector_group_anchor_id",
            "Inspector group anchor id is required.",
            status=400,
        )
    return normalized_id, normalized_label, normalized_anchor_id


def _validate_bilingual_name(name_en: object, name_zh: object) -> tuple[str, str]:
    normalized_name_en = _normalize_text(name_en)
    normalized_name_zh = _normalize_text(name_zh)
    if not normalized_name_en or not normalized_name_zh:
        raise DevServerError(
            "missing_bilingual_name",
            "Both English and Chinese names are required.",
            status=400,
        )
    return normalized_name_en, normalized_name_zh


def _manifest_relative_path(path: Path, *, root: Path = ROOT) -> str:
    return _repo_relative(path, root=root)


def _write_manifest(context: dict[str, object], *, updates: dict[str, object], root: Path = ROOT) -> dict[str, object]:
    manifest_path = Path(context["manifestPath"])
    with _locked_repo_paths([manifest_path]):
        manifest = _read_json(manifest_path)
        if not isinstance(manifest, dict):
            raise DevServerError("invalid_manifest", "Scenario manifest must be a JSON object.", status=500)
        manifest.update(updates)
        write_json_atomic(manifest_path, manifest, ensure_ascii=False, indent=2, trailing_newline=True)
        context["manifest"] = manifest
        return manifest


def _load_scenario_index(*, root: Path = ROOT) -> dict[str, object]:
    index_path = _ensure_path_within_root(
        SCENARIO_INDEX_PATH if root == ROOT else root / "data" / "scenarios" / "index.json",
        root=root,
    )
    return _read_json(index_path)


def load_scenario_context(scenario_id: object, *, root: Path = ROOT) -> dict[str, object]:
    return scenario_context_load_scenario_context(
        scenario_id,
        root=root,
        error_cls=DevServerError,
    )


def _scenario_transaction_paths(context: dict[str, object]) -> list[Path]:
    return [Path(path) for path in scenario_context_transaction_paths(context)]


@contextmanager
def _locked_scenario_context(scenario_id: object, *, root: Path = ROOT, extra_paths: list[Path | None] | None = None):
    with scenario_context_load_locked_scenario_context(
        scenario_id,
        root=root,
        extra_paths=extra_paths,
        holder="dev_server",
        error_cls=DevServerError,
    ) as context:
        yield context


def _extract_allowed_country_tags(payload: object) -> set[str]:
    countries = payload.get("countries", {}) if isinstance(payload, dict) else {}
    allowed_tags = {
        str(tag or "").strip().upper()
        for tag in countries.keys()
        if str(tag or "").strip()
    }
    if not allowed_tags:
        raise DevServerError(
            "missing_country_tags",
            "Scenario countries file did not expose any valid owner tags.",
            status=400,
        )
    return allowed_tags


def _load_allowed_country_tags(context: dict[str, object], *, countries_payload: object | None = None) -> set[str]:
    payload = countries_payload if countries_payload is not None else _read_json(Path(context["countriesPath"]))
    return _extract_allowed_country_tags(payload)


def build_scenario_ownership_payload(
    context: dict[str, object],
    owners: object,
    *,
    baseline_hash: object = "",
) -> dict[str, object]:
    if not isinstance(owners, dict):
        raise DevServerError("invalid_owners", "Owners payload must be an object.", status=400)

    expected_baseline_hash = str(context["manifest"].get("baseline_hash") or "").strip()
    normalized_baseline_hash = str(baseline_hash or "").strip()
    if normalized_baseline_hash and expected_baseline_hash and normalized_baseline_hash != expected_baseline_hash:
        raise DevServerError(
            "baseline_hash_mismatch",
            "The provided baseline hash does not match the current scenario manifest.",
            status=409,
            details={
                "expected": expected_baseline_hash,
                "received": normalized_baseline_hash,
            },
        )

    allowed_tags = _load_allowed_country_tags(context)
    sanitized_owners: dict[str, str] = {}
    invalid_feature_ids: list[str] = []
    invalid_owner_codes: list[str] = []
    for raw_feature_id, raw_owner_code in owners.items():
        feature_id = str(raw_feature_id or "").strip()
        owner_code = str(raw_owner_code or "").strip().upper()
        if not feature_id:
            invalid_feature_ids.append(str(raw_feature_id or ""))
            continue
        if not owner_code or owner_code not in allowed_tags:
            invalid_owner_codes.append(f"{feature_id}:{owner_code}")
            continue
        sanitized_owners[feature_id] = owner_code

    if invalid_feature_ids:
        raise DevServerError(
            "invalid_feature_ids",
            "One or more ownership entries used an empty feature id.",
            status=400,
            details={"invalidFeatureIds": invalid_feature_ids[:20]},
        )
    if invalid_owner_codes:
        raise DevServerError(
            "invalid_owner_codes",
            "One or more ownership entries used a tag not declared by the scenario.",
            status=400,
            details={"invalidOwnerCodes": invalid_owner_codes[:20]},
        )
    if not sanitized_owners:
        raise DevServerError("empty_owners", "No ownership entries were provided.", status=400)

    return {
        "owners": sanitized_owners,
        "baseline_hash": expected_baseline_hash or normalized_baseline_hash,
    }


def save_scenario_ownership_payload(
    scenario_id: object,
    owners: object,
    *,
    assignments_by_feature_id: object | None = None,
    baseline_hash: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    with _locked_scenario_context(scenario_id, root=root) as context:
        countries_payload = _load_country_catalog(context)
        countries = countries_payload["countries"]
        expected_baseline_hash = str(context["manifest"].get("baseline_hash") or "").strip()
        normalized_baseline_hash = str(baseline_hash or "").strip()
        if normalized_baseline_hash and expected_baseline_hash and normalized_baseline_hash != expected_baseline_hash:
            raise DevServerError(
                "baseline_hash_mismatch",
                "The provided baseline hash does not match the current scenario manifest.",
                status=409,
                details={
                    "expected": expected_baseline_hash,
                    "received": normalized_baseline_hash,
                },
            )
        political_bundle = _load_political_payload_bundle(context)
        owners_map = political_bundle["owners"]
        has_controllers = bool(political_bundle["hasControllers"])
        has_cores = bool(political_bundle["hasCores"])
        allowed_tags = {
            str(tag or "").strip().upper()
            for tag in countries.keys()
            if str(tag or "").strip()
        }
        known_feature_ids = set(owners_map.keys())
        mutations_payload = _load_scenario_mutations_payload(context)
        touched_feature_ids: list[str] = []

        if owners is not None:
            if not isinstance(owners, dict):
                raise DevServerError("invalid_owners", "Owners payload must be an object.", status=400)
            if not owners and assignments_by_feature_id is None:
                raise DevServerError("empty_owners", "No ownership entries were provided.", status=400)
            for raw_feature_id, raw_owner_code in owners.items():
                feature_id = str(raw_feature_id or "").strip()
                owner_code = _normalize_code(raw_owner_code)
                if not feature_id:
                    raise DevServerError("invalid_feature_ids", "Feature ids cannot be empty.", status=400)
                if feature_id not in known_feature_ids:
                    raise DevServerError(
                        "unknown_feature_ids",
                        "One or more ownership entries referenced a feature outside the active scenario.",
                        status=400,
                        details={"missingFeatureIds": [feature_id]},
                    )
                if owner_code not in allowed_tags:
                    raise DevServerError(
                        "invalid_owner_codes",
                        "One or more ownership entries used a tag not declared by the scenario.",
                        status=400,
                        details={"invalidOwnerCodes": [f"{feature_id}:{owner_code}"]},
                    )
                existing_assignment = mutations_payload["assignments_by_feature_id"].get(feature_id)
                assignment_record = dict(existing_assignment) if isinstance(existing_assignment, dict) else {}
                assignment_record["owner"] = owner_code
                mutations_payload["assignments_by_feature_id"][feature_id] = assignment_record
                touched_feature_ids.append(feature_id)

        if assignments_by_feature_id is not None:
            if not isinstance(assignments_by_feature_id, dict):
                raise DevServerError(
                    "invalid_assignments_by_feature_id",
                    "assignmentsByFeatureId must be an object keyed by feature id.",
                    status=400,
                )
            for raw_feature_id, raw_assignment in assignments_by_feature_id.items():
                feature_id = str(raw_feature_id or "").strip()
                if not feature_id:
                    raise DevServerError("invalid_feature_ids", "Feature ids cannot be empty.", status=400)
                if feature_id not in known_feature_ids:
                    raise DevServerError(
                        "unknown_feature_ids",
                        "One or more feature assignments referenced a feature outside the active scenario.",
                        status=400,
                        details={"missingFeatureIds": [feature_id]},
                    )
                if not isinstance(raw_assignment, dict):
                    raise DevServerError(
                        "invalid_assignment_payload",
                        f'Feature "{feature_id}" must map to an object with owner/controller/cores fields.',
                        status=400,
                    )
                if "owner" in raw_assignment:
                    owner_tag = _normalize_code(raw_assignment.get("owner"))
                    if owner_tag not in allowed_tags:
                        raise DevServerError(
                            "invalid_owner_codes",
                            f'Feature "{feature_id}" used an owner tag not declared by the scenario.',
                            status=400,
                            details={"featureId": feature_id, "invalidOwnerTag": owner_tag},
                        )
                    existing_assignment = mutations_payload["assignments_by_feature_id"].get(feature_id)
                    assignment_record = dict(existing_assignment) if isinstance(existing_assignment, dict) else {}
                    assignment_record["owner"] = owner_tag
                    mutations_payload["assignments_by_feature_id"][feature_id] = assignment_record
                if "controller" in raw_assignment:
                    if not has_controllers:
                        raise DevServerError(
                            "missing_controllers_file",
                            "Scenario controllers file is required when saving controller assignments.",
                            status=400,
                        )
                    controller_tag = _normalize_code(raw_assignment.get("controller"))
                    if controller_tag not in allowed_tags:
                        raise DevServerError(
                            "invalid_controller_codes",
                            f'Feature "{feature_id}" used a controller tag not declared by the scenario.',
                            status=400,
                            details={"featureId": feature_id, "invalidControllerTag": controller_tag},
                        )
                    assignment_record = dict(mutations_payload["assignments_by_feature_id"].get(feature_id)) if isinstance(mutations_payload["assignments_by_feature_id"].get(feature_id), dict) else {}
                    assignment_record["controller"] = controller_tag
                    mutations_payload["assignments_by_feature_id"][feature_id] = assignment_record
                if "cores" in raw_assignment:
                    if not has_cores:
                        raise DevServerError(
                            "missing_cores_file",
                            "Scenario cores file is required when saving core assignments.",
                            status=400,
                        )
                    assignment_record = dict(mutations_payload["assignments_by_feature_id"].get(feature_id)) if isinstance(mutations_payload["assignments_by_feature_id"].get(feature_id), dict) else {}
                    assignment_record["cores"] = _validate_core_tags(
                        raw_assignment.get("cores"),
                        feature_id=feature_id,
                        allowed_tags=allowed_tags,
                    )
                    mutations_payload["assignments_by_feature_id"][feature_id] = assignment_record
                touched_feature_ids.append(feature_id)

        touched_feature_ids = list(dict.fromkeys(touched_feature_ids))
        if not touched_feature_ids:
            raise DevServerError(
                "empty_assignments",
                "No scenario ownership or assignment changes were provided.",
                status=400,
            )

        pipeline_result = _write_and_materialize_mutation_pipeline(
            context,
            mutation_patch={
                "assignments_by_feature_id": mutations_payload["assignments_by_feature_id"],
            },
            target="political",
            root=root,
        )
        materialized = pipeline_result["materialize"]["political"]["materialized"]
        owners_payload = materialized["ownersPayload"]
        owner_codes = sorted(set(owners_payload["owners"].values()))
        return {
            "ok": True,
            "scenarioId": context["scenarioId"],
            "filePath": _repo_relative(Path(context["ownersPath"]), root=root),
            "mutationsPath": _repo_relative(Path(context["mutationsPath"]), root=root),
            "manualOverridesPath": _repo_relative(Path(context["manualOverridesPath"]), root=root),
            "savedAt": _now_iso(),
            "stats": {
                "featureCount": len(owners_payload["owners"]),
                "ownerCount": len(owner_codes),
                "ownerCodesSample": owner_codes[:12],
                "touchedFeatureCount": len(touched_feature_ids),
            },
        }


def _load_country_catalog(context: dict[str, object]) -> dict[str, object]:
    countries_path = Path(context["countriesPath"])
    payload = _read_json(countries_path)
    if not isinstance(payload, dict):
        raise DevServerError("invalid_countries", "Scenario countries file must be a JSON object.", status=500)
    countries = payload.get("countries", {})
    if not isinstance(countries, dict):
        raise DevServerError("invalid_countries", "Scenario countries catalog must contain a countries object.", status=500)
    payload["countries"] = countries
    return payload


def _default_scenario_manual_overrides_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "countries": {},
        "assignments": {},
    }


def _load_scenario_mutations_payload(context: dict[str, object]) -> dict[str, object]:
    mutations_path = Path(context["mutationsPath"])
    scenario_id = str(context["scenarioId"])
    payload = _read_json_or_none(mutations_path)
    if payload is None:
        payload = default_scenario_mutations_payload(scenario_id)
    return normalize_scenario_mutations_payload(payload, scenario_id=scenario_id)


def _write_and_materialize_mutation_pipeline(
    context: dict[str, object],
    *,
    mutation_patch: dict[str, object] | None,
    target: str,
    publish_targets: tuple[str, ...] = (),
    root: Path = ROOT,
) -> dict[str, object]:
    mutations_snapshot = _capture_text_snapshot(Path(context["mutationsPath"]))
    try:
        write_result = write_mutation_patch_in_locked_context(
            context,
            mutation_patch=mutation_patch,
            root=root,
        )
        materialize_result = materialize_in_locked_context(
            context,
            target=target,
            root=root,
        )
        geo_locale_checkpoint_dir = None
        geo_locale_result = materialize_result.get("geoLocale") if isinstance(materialize_result, dict) else None
        if isinstance(geo_locale_result, dict):
            materialized_geo_locale = geo_locale_result.get("materialized")
            if isinstance(materialized_geo_locale, dict):
                checkpoint_dir_text = str(materialized_geo_locale.get("checkpointDir") or "").strip()
                if checkpoint_dir_text:
                    geo_locale_checkpoint_dir = Path(checkpoint_dir_text)
        publish_results: dict[str, object] = {}
        for publish_target in publish_targets:
            publish_results[publish_target] = publish_scenario_outputs_in_locked_context(
                context,
                target=publish_target,
                root=root,
                checkpoint_dir=geo_locale_checkpoint_dir if publish_target in {"geo-locale", "startup-assets"} else None,
            )
        return {
            "write": write_result,
            "materialize": materialize_result,
            "publish": publish_results,
        }
    except Exception:
        _restore_text_snapshot(
            mutations_snapshot[0],
            existed=mutations_snapshot[1],
            original_text=mutations_snapshot[2],
        )
        raise


def _build_mutation_country_record(country_entry: dict[str, object], *, mode: str) -> dict[str, object]:
    return {
        "mode": "create" if str(mode).strip().lower() == "create" else "override",
        "tag": _normalize_code(country_entry.get("tag")),
        "display_name": _normalize_text(country_entry.get("display_name") or country_entry.get("display_name_en")),
        "display_name_en": _normalize_text(country_entry.get("display_name_en") or country_entry.get("display_name")),
        "display_name_zh": _normalize_text(country_entry.get("display_name_zh")),
        "color_hex": _normalize_text(country_entry.get("color_hex")).lower(),
        "parent_owner_tag": _normalize_code(country_entry.get("parent_owner_tag")),
        "featured": bool(country_entry.get("featured")),
        "notes": _normalize_text(country_entry.get("notes")),
        "base_iso2": _normalize_code(country_entry.get("base_iso2")),
        "lookup_iso2": _normalize_code(country_entry.get("lookup_iso2")),
        "provenance_iso2": _normalize_code(country_entry.get("provenance_iso2")),
        "subject_kind": _normalize_text(country_entry.get("subject_kind")),
        "entry_kind": _normalize_text(country_entry.get("entry_kind")),
        "hidden_from_country_list": bool(country_entry.get("hidden_from_country_list")),
        "capital_state_id": country_entry.get("capital_state_id"),
        "inspector_group_id": _normalize_text(country_entry.get("inspector_group_id")),
        "inspector_group_label": _normalize_text(country_entry.get("inspector_group_label")),
        "inspector_group_anchor_id": _normalize_text(country_entry.get("inspector_group_anchor_id")),
    }


def _build_mutation_tag_record(
    *,
    scenario_id: str,
    tag: str,
    feature_ids: list[str],
    name_en: str,
    name_zh: str,
    color_hex: str,
    parent_owner_tag: str,
    inspector_group_id: str,
    inspector_group_label: str,
    inspector_group_anchor_id: str,
) -> dict[str, object]:
    return {
        "scenario_id": scenario_id,
        "tag": tag,
        "feature_ids": list(feature_ids),
        "display_name_en": name_en,
        "display_name_zh": name_zh,
        "color_hex": color_hex.lower(),
        "parent_owner_tag": parent_owner_tag,
        "inspector_group_id": inspector_group_id,
        "inspector_group_label": inspector_group_label,
        "inspector_group_anchor_id": inspector_group_anchor_id,
    }


def _build_mutation_capital_record(
    *,
    feature_id: str,
    city_id: str,
    capital_state_id: object,
    city_override_entry: dict[str, object],
) -> dict[str, object]:
    return {
        "feature_id": feature_id,
        "city_id": city_id,
        "capital_state_id": capital_state_id,
        "city_override_entry": copy.deepcopy(city_override_entry),
    }


def _write_json_transaction(file_payloads: list[tuple[Path, object]]) -> None:
    with _locked_repo_paths([path for path, _payload in file_payloads]):
        snapshots: list[tuple[Path, bool, str]] = []
        for path, _payload in file_payloads:
            path.parent.mkdir(parents=True, exist_ok=True)
            snapshots.append(_capture_text_snapshot(path))
        try:
            for path, payload in file_payloads:
                write_json_atomic(path, payload, ensure_ascii=False, indent=2, trailing_newline=True)
        except Exception as exc:
            rollback_errors: list[str] = []
            for path, existed, original_text in reversed(snapshots):
                try:
                    _restore_text_snapshot(path, existed=existed, original_text=original_text)
                except Exception as rollback_exc:
                    rollback_errors.append(f"{path}: {rollback_exc}")
            for error in rollback_errors:
                exc.add_note(f"Rollback failed: {error}")
            raise


def _load_city_assets_payload(context: dict[str, object]) -> dict[str, object]:
    city_assets_partial_path = Path(context["cityAssetsPartialPath"])
    payload = _read_json_or_none(city_assets_partial_path)
    if payload is None:
        raise DevServerError(
            "missing_city_assets_partial",
            f'City assets partial is required for scenario "{context["scenarioId"]}".',
            status=500,
            details={
                "scenarioId": str(context["scenarioId"]),
                "path": str(city_assets_partial_path),
            },
        )
    return extract_city_assets_payload(payload, scenario_id=str(context["scenarioId"]))


def _load_default_capital_overrides_payload(context: dict[str, object]) -> dict[str, object]:
    capital_defaults_partial_path = Path(context["capitalDefaultsPartialPath"])
    payload = _read_json_or_none(capital_defaults_partial_path)
    if payload is None:
        raise DevServerError(
            "missing_capital_defaults_partial",
            f'Capital defaults partial is required for scenario "{context["scenarioId"]}".',
            status=500,
            details={
                "scenarioId": str(context["scenarioId"]),
                "path": str(capital_defaults_partial_path),
            },
        )
    return normalize_capital_overrides_payload(
        payload,
        scenario_id=str(context["scenarioId"]),
    )


def _load_releasable_catalog_for_edits(context: dict[str, object]) -> dict[str, object] | None:
    local_catalog_path = Path(context["releasableCatalogLocalPath"])
    source_catalog_path = Path(context["releasableCatalogPath"]) if context.get("releasableCatalogPath") else None
    if local_catalog_path.exists():
        return _normalize_releasable_catalog(_read_json(local_catalog_path), scenario_id=str(context["scenarioId"]))
    if source_catalog_path is not None and source_catalog_path.exists():
        return _normalize_releasable_catalog(_read_json(source_catalog_path), scenario_id=str(context["scenarioId"]))
    return None


def _load_source_releasable_catalog_for_materialization(context: dict[str, object]) -> dict[str, object] | None:
    source_catalog_path = Path(context["releasableCatalogPath"]) if context.get("releasableCatalogPath") else None
    if source_catalog_path is None or not source_catalog_path.exists():
        return None
    local_catalog_path = Path(context["releasableCatalogLocalPath"]).resolve()
    if source_catalog_path.resolve() == local_catalog_path:
        return None
    return _normalize_releasable_catalog(_read_json(source_catalog_path), scenario_id=str(context["scenarioId"]))


def _load_local_releasable_catalog_for_materialization(context: dict[str, object]) -> dict[str, object] | None:
    local_catalog_path = Path(context["releasableCatalogLocalPath"])
    if not local_catalog_path.exists():
        return None
    return _normalize_releasable_catalog(_read_json(local_catalog_path), scenario_id=str(context["scenarioId"]))


def _build_country_entry_from_mutation(
    context: dict[str, object],
    tag: str,
    mutation: dict[str, object],
    *,
    existing_entry: dict[str, object] | None,
) -> dict[str, object]:
    mode = str(mutation.get("mode") or "override").strip().lower() or "override"
    normalized_tag = _validate_tag_code(tag)
    parent_owner_tag = _normalize_code(mutation.get("parent_owner_tag"))
    if existing_entry is None:
        if mode != "create":
            raise DevServerError(
                "unknown_scenario_tag",
                f'Tag "{normalized_tag}" does not exist in the active scenario countries catalog.',
                status=404,
            )
        entry = _scenario_country_entry(
            scenario_id=str(context["scenarioId"]),
            tag=normalized_tag,
            display_name_en=_normalize_text(mutation.get("display_name_en") or mutation.get("display_name") or normalized_tag),
            display_name_zh=_normalize_text(mutation.get("display_name_zh") or normalized_tag),
            color_hex=_validate_color_hex(mutation.get("color_hex") or "#000000"),
            feature_count=0,
            parent_owner_tag=parent_owner_tag,
            inspector_group_id=_normalize_text(mutation.get("inspector_group_id")),
            inspector_group_label=_normalize_text(mutation.get("inspector_group_label")),
            inspector_group_anchor_id=_normalize_text(mutation.get("inspector_group_anchor_id")),
        )
    else:
        entry = copy.deepcopy(existing_entry)

    display_name_en = _normalize_text(mutation.get("display_name_en") or mutation.get("display_name") or entry.get("display_name_en") or entry.get("display_name"))
    display_name_zh = _normalize_text(mutation.get("display_name_zh") or entry.get("display_name_zh"))
    if not display_name_en or not display_name_zh:
        raise DevServerError(
            "missing_bilingual_name",
            "Both English and Chinese names are required.",
            status=400,
        )

    entry["display_name"] = display_name_en
    entry["display_name_en"] = display_name_en
    entry["display_name_zh"] = display_name_zh
    entry["color_hex"] = _validate_color_hex(mutation.get("color_hex") or entry.get("color_hex") or "#000000")
    entry["parent_owner_tag"] = parent_owner_tag
    entry["parent_owner_tags"] = [parent_owner_tag] if parent_owner_tag else []
    if "featured" in mutation:
        entry["featured"] = bool(mutation.get("featured"))
    if "notes" in mutation:
        entry["notes"] = _normalize_text(mutation.get("notes"))
    if "capital_state_id" in mutation:
        entry["capital_state_id"] = mutation.get("capital_state_id")
    _apply_inspector_group_fields(
        entry,
        group_id=_normalize_text(mutation.get("inspector_group_id")),
        group_label=_normalize_text(mutation.get("inspector_group_label")),
        group_anchor_id=_normalize_text(mutation.get("inspector_group_anchor_id")),
    )
    return entry


def _build_capital_city_override_entry(
    tag: str,
    country_entry: dict[str, object],
    capital_mutation: dict[str, object],
    *,
    previous_hint: dict[str, object] | None = None,
) -> dict[str, object]:
    previous_hint = previous_hint if isinstance(previous_hint, dict) else {}
    normalized_city_id = _normalize_text(capital_mutation.get("city_id"))
    normalized_city_name = _normalize_text(capital_mutation.get("city_name"))
    normalized_name_ascii = _normalize_text(capital_mutation.get("name_ascii")) or normalized_city_name
    normalized_capital_kind = _normalize_text(capital_mutation.get("capital_kind"))
    normalized_base_tier = _normalize_text(capital_mutation.get("base_tier")).lower()
    normalized_lookup_iso2 = _normalize_code(
        capital_mutation.get("lookup_iso2")
        or previous_hint.get("lookup_iso2")
        or country_entry.get("lookup_iso2")
    )
    normalized_base_iso2 = _normalize_code(
        capital_mutation.get("base_iso2")
        or previous_hint.get("base_iso2")
        or country_entry.get("base_iso2")
        or normalized_lookup_iso2
    )
    normalized_country_code = _normalize_code(
        capital_mutation.get("country_code")
        or previous_hint.get("country_code")
        or normalized_lookup_iso2
        or normalized_base_iso2
    )
    normalized_feature_id = _normalize_text(capital_mutation.get("feature_id") or previous_hint.get("host_feature_id"))
    return {
        **previous_hint,
        "tag": tag,
        "display_name": _normalize_text(country_entry.get("display_name") or country_entry.get("display_name_en") or tag),
        "lookup_iso2": normalized_lookup_iso2,
        "base_iso2": normalized_base_iso2,
        "capital_state_id": capital_mutation.get("capital_state_id"),
        "city_id": normalized_city_id,
        "stable_key": _normalize_text(capital_mutation.get("stable_key") or previous_hint.get("stable_key")) or f"id::{normalized_city_id}",
        "city_name": normalized_city_name or _normalize_text(previous_hint.get("city_name")) or normalized_city_id,
        "name_ascii": normalized_name_ascii or _normalize_text(previous_hint.get("name_ascii")) or normalized_city_id,
        "capital_kind": normalized_capital_kind or _normalize_text(previous_hint.get("capital_kind")) or "manual_capital",
        "base_tier": normalized_base_tier or _normalize_text(previous_hint.get("base_tier")),
        "population": capital_mutation.get("population") if capital_mutation.get("population") is not None else previous_hint.get("population"),
        "country_code": normalized_country_code,
        "host_feature_id": normalized_feature_id,
        "urban_match_id": _normalize_text(capital_mutation.get("urban_match_id") or previous_hint.get("urban_match_id")),
        "lon": capital_mutation.get("lon") if capital_mutation.get("lon") is not None else previous_hint.get("lon"),
        "lat": capital_mutation.get("lat") if capital_mutation.get("lat") is not None else previous_hint.get("lat"),
        "source": "manual_override",
        "resolution_method": "dev_workspace_manual",
        "confidence": "manual",
    }


def _political_materializer_deps():
    return build_political_materializer_deps()


def _build_political_materialization_transaction(
    context: dict[str, object],
    mutations_payload: dict[str, object],
    *,
    root: Path = ROOT,
) -> tuple[list[tuple[Path, object]], dict[str, object]]:
    return build_political_materialization_transaction_in_context(
        context,
        mutations_payload,
        root=root,
    )


def _find_releasable_catalog_entry(catalog_payload: dict[str, object], tag: str) -> tuple[int, dict[str, object]] | tuple[None, None]:
    entries = catalog_payload.get("entries", [])
    if not isinstance(entries, list):
        return None, None
    normalized_tag = _validate_tag_code(tag)
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        if _normalize_code(entry.get("tag")) == normalized_tag:
            return index, copy.deepcopy(entry)
    return None, None


def _apply_inspector_group_fields(
    payload: dict[str, object],
    *,
    group_id: str = "",
    group_label: str = "",
    group_anchor_id: str = "",
) -> dict[str, object]:
    if group_id:
        payload["inspector_group_id"] = group_id
        payload["inspector_group_label"] = group_label or group_id
        payload["inspector_group_anchor_id"] = group_anchor_id
    else:
        payload.pop("inspector_group_id", None)
        payload.pop("inspector_group_label", None)
        payload.pop("inspector_group_anchor_id", None)
    return payload


def _sync_releasable_catalog_entry_from_country(
    catalog_entry: dict[str, object],
    country_entry: dict[str, object],
) -> dict[str, object]:
    updated = copy.deepcopy(catalog_entry)
    updated["display_name"] = _normalize_text(
        country_entry.get("display_name") or country_entry.get("display_name_en") or updated.get("display_name")
    )
    updated["display_name_en"] = _normalize_text(
        country_entry.get("display_name_en") or country_entry.get("display_name") or updated.get("display_name_en")
    )
    updated["display_name_zh"] = _normalize_text(country_entry.get("display_name_zh") or updated.get("display_name_zh"))
    updated["color_hex"] = _validate_color_hex(country_entry.get("color_hex") or updated.get("color_hex") or "#000000")
    updated["capital_state_id"] = country_entry.get("capital_state_id")
    parent_owner_tag = _normalize_code(country_entry.get("parent_owner_tag") or updated.get("parent_owner_tag"))
    updated["parent_owner_tag"] = parent_owner_tag
    updated["parent_owner_tags"] = [parent_owner_tag] if parent_owner_tag else []
    _apply_inspector_group_fields(
        updated,
        group_id=_normalize_text(country_entry.get("inspector_group_id")),
        group_label=_normalize_text(country_entry.get("inspector_group_label")),
        group_anchor_id=_normalize_text(country_entry.get("inspector_group_anchor_id")),
    )
    return updated


def _build_editable_country_entry(
    normalized_tag: str,
    *,
    existing_entry: dict[str, object] | None,
    catalog_entry: dict[str, object] | None,
) -> dict[str, object]:
    if isinstance(existing_entry, dict):
        return copy.deepcopy(existing_entry)
    if not isinstance(catalog_entry, dict):
        raise DevServerError("unknown_scenario_tag", f'Unknown scenario tag "{normalized_tag}".', status=404)
    lookup_code = _normalize_code(
        catalog_entry.get("lookup_iso2")
        or catalog_entry.get("release_lookup_iso2")
        or catalog_entry.get("base_iso2")
        or normalized_tag
    )
    updated_entry = {
        "tag": normalized_tag,
        "display_name": _normalize_text(catalog_entry.get("display_name") or catalog_entry.get("display_name_en") or normalized_tag),
        "display_name_en": _normalize_text(catalog_entry.get("display_name_en") or catalog_entry.get("display_name") or normalized_tag),
        "display_name_zh": _normalize_text(catalog_entry.get("display_name_zh")),
        "color_hex": _validate_color_hex(catalog_entry.get("color_hex") or "#000000"),
        "feature_count": int(catalog_entry.get("resolved_feature_count_hint") or 0),
        "controller_feature_count": int(catalog_entry.get("resolved_feature_count_hint") or 0),
        "quality": "releasable",
        "source": "manual_rule",
        "base_iso2": _normalize_code(catalog_entry.get("base_iso2") or lookup_code),
        "lookup_iso2": lookup_code,
        "provenance_iso2": _normalize_code(catalog_entry.get("base_iso2") or lookup_code),
        "scenario_only": True,
        "featured": bool(catalog_entry.get("featured")),
        "capital_state_id": catalog_entry.get("capital_state_id"),
        "notes": _normalize_text(catalog_entry.get("notes")),
        "synthetic_owner": False,
        "source_type": "scenario_extension",
        "historical_fidelity": "extended",
        "parent_owner_tag": _normalize_code(catalog_entry.get("parent_owner_tag")),
        "parent_owner_tags": [
            _normalize_code(value)
            for value in (catalog_entry.get("parent_owner_tags") or [])
            if _normalize_code(value)
        ],
        "subject_kind": _normalize_text(catalog_entry.get("subject_kind")),
        "entry_kind": _normalize_text(catalog_entry.get("entry_kind") or "releasable"),
        "hidden_from_country_list": bool(catalog_entry.get("hidden_from_country_list")),
    }
    return _apply_inspector_group_fields(
        updated_entry,
        group_id=_normalize_text(catalog_entry.get("inspector_group_id")),
        group_label=_normalize_text(catalog_entry.get("inspector_group_label")),
        group_anchor_id=_normalize_text(catalog_entry.get("inspector_group_anchor_id")),
    )


def _normalize_core_assignments(raw_cores_payload: dict[object, object]) -> dict[str, list[str]]:
    cores: dict[str, list[str]] = {}
    for raw_feature_id, raw_core_tags in raw_cores_payload.items():
        feature_id = str(raw_feature_id or "").strip()
        if not feature_id:
            continue
        normalized_core_tags: list[str] = []
        seen: set[str] = set()
        if isinstance(raw_core_tags, list):
            for raw_tag in raw_core_tags:
                normalized_tag = _normalize_code(raw_tag)
                if not normalized_tag or normalized_tag in seen:
                    continue
                seen.add(normalized_tag)
                normalized_core_tags.append(normalized_tag)
        elif raw_core_tags is not None:
            normalized_tag = _normalize_code(raw_core_tags)
            if normalized_tag:
                normalized_core_tags.append(normalized_tag)
        cores[feature_id] = normalized_core_tags
    return cores


def _load_political_payload_bundle(context: dict[str, object]) -> dict[str, object]:
    owners_path = Path(context["ownersPath"])
    if not owners_path.exists():
        raise DevServerError("missing_owners_file", "Scenario owners file is required for scenario political saves.", status=400)
    owners_payload = _read_json(owners_path)
    if not isinstance(owners_payload, dict) or not isinstance(owners_payload.get("owners"), dict):
        raise DevServerError("invalid_owners_file", "Scenario owners file must contain an owners object.", status=500)
    owners = {
        str(feature_id or "").strip(): _normalize_code(owner_code)
        for feature_id, owner_code in owners_payload["owners"].items()
        if str(feature_id or "").strip()
    }

    controllers_path = Path(context["controllersPath"]) if context.get("controllersPath") else None
    controllers_payload: dict[str, object] | None = None
    controllers: dict[str, str] = {}
    if controllers_path is not None:
        if not controllers_path.exists():
            raise DevServerError(
                "missing_controllers_file",
                "Scenario controllers file is declared but could not be found.",
                status=400,
            )
        controllers_payload = _read_json(controllers_path)
        if not isinstance(controllers_payload, dict) or not isinstance(controllers_payload.get("controllers"), dict):
            raise DevServerError("invalid_controllers_file", "Scenario controllers file must contain a controllers object.", status=500)
        controllers = {
            str(feature_id or "").strip(): _normalize_code(owner_code)
            for feature_id, owner_code in controllers_payload["controllers"].items()
            if str(feature_id or "").strip()
        }

    cores_path = Path(context["coresPath"]) if context.get("coresPath") else None
    cores_payload: dict[str, object] | None = None
    cores: dict[str, list[str]] = {}
    if cores_path is not None:
        if not cores_path.exists():
            raise DevServerError(
                "missing_cores_file",
                "Scenario cores file is declared but could not be found.",
                status=400,
            )
        cores_payload = _read_json(cores_path)
        if not isinstance(cores_payload, dict) or not isinstance(cores_payload.get("cores"), dict):
            raise DevServerError("invalid_cores_file", "Scenario cores file must contain a cores object.", status=500)
        cores = _normalize_core_assignments(cores_payload["cores"])

    return {
        "ownersPath": owners_path,
        "ownersPayload": owners_payload,
        "owners": owners,
        "controllersPath": controllers_path,
        "controllersPayload": controllers_payload,
        "controllers": controllers,
        "hasControllers": controllers_payload is not None,
        "coresPath": cores_path,
        "coresPayload": cores_payload,
        "cores": cores,
        "hasCores": cores_payload is not None,
    }


def _load_owner_assignments(context: dict[str, object]) -> dict[str, str]:
    owners_path = Path(context["ownersPath"])
    if not owners_path.exists():
        raise DevServerError("missing_owners_file", "Scenario owners file is required for scenario political saves.", status=400)
    owners_payload = _read_json(owners_path)
    if not isinstance(owners_payload, dict) or not isinstance(owners_payload.get("owners"), dict):
        raise DevServerError("invalid_owners_file", "Scenario owners file must contain an owners object.", status=500)
    return {
        str(feature_id or "").strip(): _normalize_code(owner_code)
        for feature_id, owner_code in owners_payload["owners"].items()
        if str(feature_id or "").strip()
    }


def _build_manual_assignment_record(
    feature_id: str,
    owners: dict[str, str],
    controllers: dict[str, str],
    cores: dict[str, list[str]],
    *,
    has_controllers: bool,
    has_cores: bool,
) -> dict[str, object]:
    record: dict[str, object] = {
        "owner": owners.get(feature_id, ""),
    }
    if has_controllers:
        record["controller"] = controllers.get(feature_id, "")
    if has_cores:
        record["cores"] = list(cores.get(feature_id, []))
    return record


def _load_full_political_assignments(context: dict[str, object]) -> tuple[dict[str, str], dict[str, str], dict[str, list[str]]]:
    payload_bundle = _load_political_payload_bundle(context)
    owners = payload_bundle["owners"]
    controllers = payload_bundle["controllers"]
    cores = payload_bundle["cores"]
    return owners, controllers, cores


def _load_political_assignments(context: dict[str, object]) -> tuple[dict[str, str], dict[str, str]]:
    payload_bundle = _load_political_payload_bundle(context)
    owners = payload_bundle["owners"]
    controllers = payload_bundle["controllers"]
    return owners, controllers


def _build_manual_override_country_record(country_entry: dict[str, object], *, mode: str) -> dict[str, object]:
    return {
        "mode": "create" if str(mode).strip().lower() == "create" else "override",
        "display_name": _normalize_text(country_entry.get("display_name") or country_entry.get("display_name_en")),
        "display_name_en": _normalize_text(country_entry.get("display_name_en") or country_entry.get("display_name")),
        "display_name_zh": _normalize_text(country_entry.get("display_name_zh")),
        "color_hex": _normalize_text(country_entry.get("color_hex")).lower(),
        "parent_owner_tag": _normalize_code(country_entry.get("parent_owner_tag")),
        "subject_kind": _normalize_text(country_entry.get("subject_kind")),
        "entry_kind": _normalize_text(country_entry.get("entry_kind")),
        "featured": bool(country_entry.get("featured")),
        "hidden_from_country_list": bool(country_entry.get("hidden_from_country_list")),
        "base_iso2": _normalize_code(country_entry.get("base_iso2")),
        "lookup_iso2": _normalize_code(country_entry.get("lookup_iso2")),
        "provenance_iso2": _normalize_code(country_entry.get("provenance_iso2")),
        "capital_state_id": country_entry.get("capital_state_id"),
        "continent_id": _normalize_text(country_entry.get("continent_id")),
        "continent_label": _normalize_text(country_entry.get("continent_label")),
        "subregion_id": _normalize_text(country_entry.get("subregion_id")),
        "subregion_label": _normalize_text(country_entry.get("subregion_label")),
        "inspector_group_id": _normalize_text(country_entry.get("inspector_group_id")),
        "inspector_group_label": _normalize_text(country_entry.get("inspector_group_label")),
        "inspector_group_anchor_id": _normalize_text(country_entry.get("inspector_group_anchor_id")),
        "notes": _normalize_text(country_entry.get("notes")),
        "scenario_only": bool(country_entry.get("scenario_only", True)),
        "source_type": "scenario_extension",
        "historical_fidelity": "extended",
    }


def _validate_core_tags(raw_core_tags: object, *, feature_id: str, allowed_tags: set[str]) -> list[str]:
    if raw_core_tags is None:
        return []
    if not isinstance(raw_core_tags, list):
        raise DevServerError(
            "invalid_core_tags",
            f'Feature "{feature_id}" must provide cores as an array of tag codes.',
            status=400,
        )
    normalized_core_tags: list[str] = []
    invalid_tags: list[str] = []
    seen: set[str] = set()
    for raw_tag in raw_core_tags:
        normalized_tag = _normalize_code(raw_tag)
        if not normalized_tag or normalized_tag not in allowed_tags:
            invalid_tags.append(str(raw_tag or ""))
            continue
        if normalized_tag in seen:
            continue
        seen.add(normalized_tag)
        normalized_core_tags.append(normalized_tag)
    if invalid_tags:
        raise DevServerError(
            "invalid_core_tags",
            f'Feature "{feature_id}" used one or more core tags not declared by the scenario.',
            status=400,
            details={"featureId": feature_id, "invalidCoreTags": invalid_tags[:20]},
        )
    return normalized_core_tags


def _load_scenario_tag_feature_ids(context: dict[str, object], tag: str) -> set[str]:
    return load_scenario_tag_feature_ids_service(
        context,
        tag,
        error_cls=DevServerError,
    )


def _default_releasable_catalog(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "catalog_id": f"{scenario_id}.manual",
        "generated_at": "",
        "scenario_ids": [scenario_id],
        "entries": [],
    }


def _normalize_releasable_catalog(payload: object, *, scenario_id: str) -> dict[str, object]:
    if not isinstance(payload, dict):
        payload = {}
    entries = payload.get("entries", [])
    if not isinstance(entries, list):
        entries = []
    normalized = dict(payload)
    normalized["version"] = int(normalized.get("version") or 1)
    normalized["catalog_id"] = _normalize_text(normalized.get("catalog_id")) or f"{scenario_id}.manual"
    normalized["generated_at"] = _normalize_text(normalized.get("generated_at"))
    normalized["scenario_ids"] = [scenario_id]
    normalized["entries"] = entries
    return normalized


def _scenario_manual_catalog_entry(
    *,
    scenario_id: str,
    tag: str,
    display_name_en: str,
    display_name_zh: str,
    color_hex: str,
    feature_ids: list[str],
    parent_owner_tag: str,
) -> dict[str, object]:
    lookup_code = parent_owner_tag or tag
    preset_source = {
        "type": "feature_ids",
        "name": "",
        "group_ids": [],
        "feature_ids": feature_ids,
    }
    return {
        "tag": tag,
        "display_name": display_name_en,
        "display_name_en": display_name_en,
        "display_name_zh": display_name_zh,
        "color_hex": color_hex,
        "capital_state_id": None,
        "parent_owner_tag": parent_owner_tag,
        "parent_owner_tags": [parent_owner_tag] if parent_owner_tag else [],
        "release_lookup_iso2": lookup_code,
        "lookup_iso2": lookup_code,
        "entry_kind": "releasable",
        "scenario_ids": [scenario_id],
        "scenario_only": True,
        "allow_manual_overlay": True,
        "preset_source": preset_source,
        "default_boundary_variant_id": "current_manual",
        "boundary_variants": [
            {
                "id": "current_manual",
                "label": "Current Selection",
                "description": "Manual releasable created from the selected features.",
                "basis": "manual_selection",
                "preset_source": preset_source,
                "resolved_feature_count_hint": len(feature_ids),
            }
        ],
    }


def _scenario_country_entry(
    *,
    scenario_id: str,
    tag: str,
    display_name_en: str,
    display_name_zh: str,
    color_hex: str,
    feature_count: int,
    parent_owner_tag: str,
    inspector_group_id: str = "",
    inspector_group_label: str = "",
    inspector_group_anchor_id: str = "",
) -> dict[str, object]:
    parent_tags = [parent_owner_tag] if parent_owner_tag else []
    entry_kind = "scenario_subject" if parent_owner_tag else "scenario_country"
    entry = {
        "tag": tag,
        "display_name": display_name_en,
        "display_name_en": display_name_en,
        "display_name_zh": display_name_zh,
        "color_hex": color_hex,
        "feature_count": feature_count,
        "controller_feature_count": feature_count,
        "quality": "manual_reviewed",
        "source": "manual_rule",
        "base_iso2": tag,
        "lookup_iso2": tag,
        "provenance_iso2": tag,
        "scenario_only": True,
        "featured": False,
        "capital_state_id": None,
        "notes": "",
        "synthetic_owner": False,
        "source_type": "scenario_extension",
        "historical_fidelity": "extended",
        "primary_rule_source": "dev_manual_tag_create",
        "rule_sources": ["dev_manual_tag_create"],
        "source_types": ["scenario_extension"],
        "historical_fidelity_summary": ["extended"],
        "parent_owner_tag": parent_owner_tag,
        "parent_owner_tags": parent_tags,
        "subject_kind": "releasable_state" if parent_owner_tag else "",
        "entry_kind": entry_kind,
        "hidden_from_country_list": False,
    }
    return _apply_inspector_group_fields(
        entry,
        group_id=inspector_group_id,
        group_label=inspector_group_label,
        group_anchor_id=inspector_group_anchor_id,
    )


def _recompute_country_feature_counts(
    countries: dict[str, object],
    owners: dict[str, str],
    controllers: dict[str, str],
) -> None:
    owner_counts: dict[str, int] = {}
    controller_counts: dict[str, int] = {}
    for owner_code in owners.values():
        if not owner_code:
            continue
        owner_counts[owner_code] = owner_counts.get(owner_code, 0) + 1
    for controller_code in controllers.values():
        if not controller_code:
            continue
        controller_counts[controller_code] = controller_counts.get(controller_code, 0) + 1
    for raw_tag, raw_country in countries.items():
        tag = _normalize_code(raw_tag)
        if not tag or not isinstance(raw_country, dict):
            continue
        raw_country["feature_count"] = int(owner_counts.get(tag, 0))
        raw_country["controller_feature_count"] = int(controller_counts.get(tag, 0))


# Keep dev_server's legacy helper names stable while making map_builder the
# single implementation source for political materialization support.
_load_country_catalog = scenario_political_support.load_country_catalog
_default_scenario_manual_overrides_payload = (
    scenario_political_support.default_scenario_manual_overrides_payload
)
_load_city_assets_payload = scenario_political_support.load_city_assets_payload
_load_default_capital_overrides_payload = (
    scenario_political_support.load_default_capital_overrides_payload
)
_load_source_releasable_catalog_for_materialization = (
    scenario_political_support.load_source_releasable_catalog_for_materialization
)
_load_local_releasable_catalog_for_materialization = (
    scenario_political_support.load_local_releasable_catalog_for_materialization
)
_load_releasable_catalog_for_edits = (
    scenario_political_support.load_releasable_catalog_for_edits
)
_build_country_entry_from_mutation = (
    scenario_political_support.build_country_entry_from_mutation
)
_build_capital_city_override_entry = (
    scenario_political_support.build_capital_city_override_entry
)
_find_releasable_catalog_entry = (
    scenario_political_support.find_releasable_catalog_entry
)
_apply_inspector_group_fields = scenario_political_support.apply_inspector_group_fields
_sync_releasable_catalog_entry_from_country = (
    scenario_political_support.sync_releasable_catalog_entry_from_country
)
_build_editable_country_entry = scenario_political_support.build_editable_country_entry
_normalize_core_assignments = scenario_political_support.normalize_core_assignments
_load_political_payload_bundle = scenario_political_support.load_political_payload_bundle
_build_manual_assignment_record = (
    scenario_political_support.build_manual_assignment_record
)
_build_manual_override_country_record = (
    scenario_political_support.build_manual_override_country_record
)
_validate_core_tags = scenario_political_support.validate_core_tags
_default_releasable_catalog = scenario_political_support.default_releasable_catalog
_normalize_releasable_catalog = scenario_political_support.normalize_releasable_catalog
_scenario_manual_catalog_entry = (
    scenario_political_support.scenario_manual_catalog_entry
)
_scenario_country_entry = scenario_political_support.scenario_country_entry
_recompute_country_feature_counts = (
    scenario_political_support.recompute_country_feature_counts
)


def save_scenario_tag_create_payload(
    scenario_id: object,
    *,
    feature_ids: object,
    tag: object,
    name_en: object,
    name_zh: object,
    color_hex: object,
    parent_owner_tag: object = "",
    inspector_group_id: object = "",
    inspector_group_label: object = "",
    inspector_group_anchor_id: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    with _locked_scenario_context(scenario_id, root=root) as context:
        normalized_tag = _validate_tag_code(tag)
        normalized_feature_ids = _normalize_feature_ids(feature_ids)
        normalized_name_en, normalized_name_zh = _validate_bilingual_name(name_en, name_zh)
        normalized_color_hex = _validate_color_hex(color_hex)
        normalized_parent_owner_tag = _normalize_code(parent_owner_tag)
        normalized_group_id, normalized_group_label, normalized_group_anchor_id = _normalize_inspector_group_fields(
            inspector_group_id,
            inspector_group_label,
            inspector_group_anchor_id,
        )
        countries_payload = _load_country_catalog(context)
        countries = countries_payload["countries"]
        if normalized_tag in countries:
            raise DevServerError(
                "duplicate_country_tag",
                f'Tag "{normalized_tag}" already exists in the scenario country catalog.',
                status=409,
            )
        if normalized_parent_owner_tag and normalized_parent_owner_tag not in countries:
            raise DevServerError(
                "unknown_parent_owner_tag",
                f'Parent owner tag "{normalized_parent_owner_tag}" does not exist in the scenario country catalog.',
                status=400,
            )

        political_bundle = _load_political_payload_bundle(context)
        owners = political_bundle["owners"]
        missing_feature_ids = [
            feature_id
            for feature_id in normalized_feature_ids
            if feature_id not in owners
        ]
        if missing_feature_ids:
            raise DevServerError(
                "unknown_feature_ids",
                "One or more selected features were not found in the scenario political files.",
                status=400,
                details={"missingFeatureIds": missing_feature_ids[:20]},
            )

        catalog_payload = _load_releasable_catalog_for_edits(context)
        if normalized_parent_owner_tag and catalog_payload is not None:
            catalog_entry_index, _catalog_entry = _find_releasable_catalog_entry(catalog_payload, normalized_tag)
            if catalog_entry_index is not None:
                raise DevServerError(
                    "duplicate_releasable_tag",
                    f'Tag "{normalized_tag}" already exists in the scenario releasable catalog.',
                    status=409,
                )

        country_entry = _scenario_country_entry(
            scenario_id=str(context["scenarioId"]),
            tag=normalized_tag,
            display_name_en=normalized_name_en,
            display_name_zh=normalized_name_zh,
            color_hex=normalized_color_hex,
            feature_count=len(normalized_feature_ids),
            parent_owner_tag=normalized_parent_owner_tag,
            inspector_group_id=normalized_group_id,
            inspector_group_label=normalized_group_label,
            inspector_group_anchor_id=normalized_group_anchor_id,
        )
        tag_mutation = {
            "tag": normalized_tag,
            "parent_owner_tag": normalized_parent_owner_tag,
            "feature_ids": normalized_feature_ids,
        }
        country_mutation = _build_manual_override_country_record(country_entry, mode="create")
        assignment_patch: dict[str, dict[str, object]] = {}
        for feature_id in normalized_feature_ids:
            assignment_record: dict[str, object] = {"owner": normalized_tag}
            if political_bundle["hasControllers"]:
                assignment_record["controller"] = normalized_tag
            if political_bundle["hasCores"]:
                assignment_record["cores"] = [normalized_tag]
            assignment_patch[feature_id] = assignment_record

        pipeline_result = _write_and_materialize_mutation_pipeline(
            context,
            mutation_patch={
                "tags": {normalized_tag: tag_mutation},
                "countries": {normalized_tag: country_mutation},
                "assignments_by_feature_id": assignment_patch,
            },
            target="political",
            root=root,
        )
        materialized = pipeline_result["materialize"]["political"]["materialized"]
        materialized_countries = materialized["countriesPayload"]["countries"]
        materialized_catalog = materialized.get("catalogPayload")
        catalog_entry_index, catalog_entry = _find_releasable_catalog_entry(materialized_catalog, normalized_tag) if isinstance(materialized_catalog, dict) else (None, None)
        return {
            "ok": True,
            "scenarioId": context["scenarioId"],
            "tag": normalized_tag,
            "featureIds": normalized_feature_ids,
            "countryEntry": materialized_countries.get(normalized_tag),
            "releasableEntry": catalog_entry if normalized_parent_owner_tag else None,
            "filePath": _repo_relative(Path(context["countriesPath"]), root=root),
            "mutationsPath": _repo_relative(Path(context["mutationsPath"]), root=root),
            "manualOverridesPath": _repo_relative(Path(context["manualOverridesPath"]), root=root),
            "catalogPath": _repo_relative(Path(context["releasableCatalogLocalPath"]), root=root) if normalized_parent_owner_tag else "",
            "manifestPath": _repo_relative(Path(context["manifestPath"]), root=root),
            "savedAt": _now_iso(),
            "stats": {
                "selectedFeatureCount": len(normalized_feature_ids),
                "countryCount": len(materialized_countries),
                "createdReleasable": bool(normalized_parent_owner_tag),
            },
        }


def save_scenario_country_payload(
    scenario_id: object,
    *,
    tag: object,
    name_en: object | None = None,
    name_zh: object | None = None,
    color_hex: object | None = None,
    parent_owner_tag: object | None = None,
    notes: object | None = None,
    featured: object | None = None,
    root: Path = ROOT,
) -> dict[str, object]:
    with _locked_scenario_context(scenario_id, root=root) as context:
        countries_payload = _load_country_catalog(context)
        countries = countries_payload["countries"]
        normalized_tag = _validate_tag_code(tag)
        existing_entry = countries.get(normalized_tag) if isinstance(countries.get(normalized_tag), dict) else None
        catalog_payload = _load_releasable_catalog_for_edits(context)
        catalog_entry: dict[str, object] | None = None
        if catalog_payload is not None:
            _catalog_entry_index, catalog_entry = _find_releasable_catalog_entry(catalog_payload, normalized_tag)
        if existing_entry is None and catalog_entry is None:
            raise DevServerError(
                "unknown_scenario_tag",
                f'Tag "{normalized_tag}" does not exist in the active scenario countries catalog or releasable catalog.',
                status=404,
            )

        updated_entry = _build_editable_country_entry(
            normalized_tag,
            existing_entry=existing_entry,
            catalog_entry=catalog_entry,
        )

        resolved_name_en = _normalize_text(name_en) if name_en is not None else _normalize_text(updated_entry.get("display_name_en"))
        resolved_name_zh = _normalize_text(name_zh) if name_zh is not None else _normalize_text(updated_entry.get("display_name_zh"))
        if not resolved_name_en or not resolved_name_zh:
            raise DevServerError(
                "missing_bilingual_name",
                "Both English and Chinese names are required.",
                status=400,
            )
        resolved_color_hex = _validate_color_hex(color_hex) if color_hex is not None else _validate_color_hex(updated_entry.get("color_hex") or "#000000")
        resolved_parent_owner_tag = (
            _normalize_code(parent_owner_tag)
            if parent_owner_tag is not None
            else _normalize_code(updated_entry.get("parent_owner_tag"))
        )
        known_tags = {normalized_tag, *[str(key or "").strip().upper() for key in countries.keys()]}
        if catalog_payload is not None:
            known_tags.update(
                _normalize_code(entry.get("tag"))
                for entry in (catalog_payload.get("entries", []) if isinstance(catalog_payload.get("entries"), list) else [])
                if isinstance(entry, dict)
            )
        if resolved_parent_owner_tag and resolved_parent_owner_tag not in known_tags:
            raise DevServerError(
                "unknown_parent_owner_tag",
                f'Parent owner tag "{resolved_parent_owner_tag}" does not exist in the scenario country or releasable catalog.',
                status=400,
            )
        updated_entry["display_name"] = resolved_name_en
        updated_entry["display_name_en"] = resolved_name_en
        updated_entry["display_name_zh"] = resolved_name_zh
        updated_entry["color_hex"] = resolved_color_hex
        updated_entry["parent_owner_tag"] = resolved_parent_owner_tag
        updated_entry["parent_owner_tags"] = [resolved_parent_owner_tag] if resolved_parent_owner_tag else []
        if notes is not None:
            updated_entry["notes"] = _normalize_text(notes)
        if featured is not None:
            updated_entry["featured"] = bool(featured)

        mutations_payload = _load_scenario_mutations_payload(context)
        existing_manual_entry = (
            mutations_payload.get("countries", {}).get(normalized_tag)
            if isinstance(mutations_payload.get("countries"), dict)
            else None
        )
        manual_mode = "override"
        if isinstance(existing_manual_entry, dict) and str(existing_manual_entry.get("mode") or "").strip().lower() == "create":
            manual_mode = "create"
        elif isinstance(existing_entry, dict) and str(existing_entry.get("primary_rule_source") or "").strip() == "dev_manual_tag_create":
            manual_mode = "create"
        pipeline_result = _write_and_materialize_mutation_pipeline(
            context,
            mutation_patch={
                "countries": {
                    normalized_tag: _build_manual_override_country_record(updated_entry, mode=manual_mode),
                }
            },
            target="political",
            root=root,
        )
        materialized = pipeline_result["materialize"]["political"]["materialized"]
        materialized_countries = materialized["countriesPayload"]["countries"]
        materialized_catalog = materialized.get("catalogPayload")
        _catalog_entry_index, updated_catalog_entry = _find_releasable_catalog_entry(materialized_catalog, normalized_tag) if isinstance(materialized_catalog, dict) else (None, None)
        catalog_path_relative = _repo_relative(Path(context["releasableCatalogLocalPath"]), root=root) if updated_catalog_entry is not None else ""
        manifest_path_relative = _repo_relative(Path(context["manifestPath"]), root=root) if materialized.get("manifestPayload") is not None else ""
        return {
            "ok": True,
            "scenarioId": context["scenarioId"],
            "tag": normalized_tag,
            "countryEntry": materialized_countries.get(normalized_tag),
            "catalogEntry": updated_catalog_entry,
            "filePath": _repo_relative(Path(context["countriesPath"]), root=root),
            "catalogPath": catalog_path_relative,
            "mutationsPath": _repo_relative(Path(context["mutationsPath"]), root=root),
            "manualOverridesPath": _repo_relative(Path(context["manualOverridesPath"]), root=root),
            "manifestPath": manifest_path_relative,
            "savedAt": _now_iso(),
        }


def save_scenario_capital_payload(
    scenario_id: object,
    *,
    tag: object,
    feature_id: object,
    city_id: object,
    capital_state_id: object = None,
    city_name: object = "",
    stable_key: object = "",
    country_code: object = "",
    lookup_iso2: object = "",
    base_iso2: object = "",
    capital_kind: object = "",
    population: object = None,
    lon: object = None,
    lat: object = None,
    urban_match_id: object = "",
    base_tier: object = "",
    name_ascii: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    with _locked_scenario_context(scenario_id, root=root) as context:
        normalized_tag = _validate_tag_code(tag)
        normalized_feature_id = str(feature_id or "").strip()
        normalized_city_id = _normalize_text(city_id)
        if not normalized_feature_id:
            raise DevServerError("missing_feature_id", "A capital feature id is required.", status=400)
        if not normalized_city_id:
            raise DevServerError("missing_city_id", "A city id is required.", status=400)

        countries_payload = _load_country_catalog(context)
        countries = countries_payload["countries"]
        existing_entry = countries.get(normalized_tag) if isinstance(countries.get(normalized_tag), dict) else None
        catalog_payload = _load_releasable_catalog_for_edits(context)
        catalog_entry: dict[str, object] | None = None
        if catalog_payload is not None:
            _catalog_entry_index, catalog_entry = _find_releasable_catalog_entry(catalog_payload, normalized_tag)
        if existing_entry is None and catalog_entry is None:
            raise DevServerError(
                "unknown_scenario_tag",
                f'Tag "{normalized_tag}" does not exist in the active scenario countries catalog or releasable catalog.',
                status=404,
            )

        updated_entry = _build_editable_country_entry(
            normalized_tag,
            existing_entry=existing_entry,
            catalog_entry=catalog_entry,
        )

        owners = _load_owner_assignments(context)
        if normalized_feature_id not in owners:
            raise DevServerError(
                "unknown_feature_id",
                f'Feature "{normalized_feature_id}" was not found in the scenario owners file.',
                status=400,
            )
        if owners.get(normalized_feature_id) != normalized_tag:
            raise DevServerError(
                "capital_feature_owner_mismatch",
                "The selected feature is not owned by the requested country in the saved scenario owners file.",
                status=400,
                details={
                    "featureId": normalized_feature_id,
                    "featureOwnerTag": owners.get(normalized_feature_id),
                    "requestedTag": normalized_tag,
                },
            )

        normalized_capital_state_id = _normalize_optional_int(capital_state_id)
        normalized_population = _normalize_optional_int(population)
        normalized_lon = _normalize_optional_float(lon)
        normalized_lat = _normalize_optional_float(lat)
        normalized_lookup_iso2 = _normalize_code(lookup_iso2) or _normalize_code(updated_entry.get("lookup_iso2"))
        normalized_base_iso2 = _normalize_code(base_iso2) or _normalize_code(updated_entry.get("base_iso2")) or normalized_lookup_iso2
        normalized_country_code = _normalize_code(country_code) or normalized_lookup_iso2 or normalized_base_iso2
        normalized_city_name = _normalize_text(city_name)
        normalized_name_ascii = _normalize_text(name_ascii) or normalized_city_name
        normalized_stable_key = _normalize_text(stable_key) or f"id::{normalized_city_id}"
        normalized_capital_kind = _normalize_text(capital_kind)
        normalized_urban_match_id = _normalize_text(urban_match_id)
        normalized_base_tier = _normalize_text(base_tier).lower()

        mutations_payload = _load_scenario_mutations_payload(context)
        previous_capital_mutation = (
            mutations_payload.get("capitals", {}).get(normalized_tag)
            if isinstance(mutations_payload.get("capitals"), dict)
            else None
        )
        default_capital_overrides_payload = _load_default_capital_overrides_payload(context)
        previous_hint: dict[str, object] = {}
        default_hint = (
            default_capital_overrides_payload.get("capital_city_hints", {}).get(normalized_tag)
            if isinstance(default_capital_overrides_payload.get("capital_city_hints"), dict)
            else None
        )
        if isinstance(default_hint, dict):
            previous_hint.update(copy.deepcopy(default_hint))
        mutation_hint = (
            previous_capital_mutation.get("city_override_entry")
            if isinstance(previous_capital_mutation, dict)
            else None
        )
        if isinstance(mutation_hint, dict):
            previous_hint.update(copy.deepcopy(mutation_hint))
        pipeline_result = _write_and_materialize_mutation_pipeline(
            context,
            mutation_patch={
                "capitals": {
                    normalized_tag: _build_mutation_capital_record(
                        feature_id=normalized_feature_id,
                        city_id=normalized_city_id,
                        capital_state_id=normalized_capital_state_id,
                        city_override_entry=build_capital_city_override_entry_payload(
                            tag=normalized_tag,
                            country_entry=updated_entry,
                            capital_state_id=normalized_capital_state_id,
                            city_id=normalized_city_id,
                            city_name=normalized_city_name,
                            stable_key=normalized_stable_key,
                            country_code=normalized_country_code,
                            lookup_iso2=normalized_lookup_iso2,
                            base_iso2=normalized_base_iso2,
                            capital_kind=normalized_capital_kind,
                            population=normalized_population,
                            lon=normalized_lon,
                            lat=normalized_lat,
                            urban_match_id=normalized_urban_match_id,
                            base_tier=normalized_base_tier,
                            name_ascii=normalized_name_ascii,
                            host_feature_id=normalized_feature_id,
                            previous_hint=previous_hint,
                        ),
                    )
                }
            },
            target="political",
            root=root,
        )
        materialized = pipeline_result["materialize"]["political"]["materialized"]
        materialized_countries = materialized["countriesPayload"]["countries"]
        materialized_catalog = materialized.get("catalogPayload")
        _catalog_entry_index, updated_catalog_entry = _find_releasable_catalog_entry(
            materialized_catalog,
            normalized_tag,
        ) if isinstance(materialized_catalog, dict) else (None, None)
        city_overrides_payload = materialized["cityOverridesPayload"]
        city_override_entry = (
            city_overrides_payload.get("capital_city_hints", {}).get(normalized_tag)
            if isinstance(city_overrides_payload, dict)
            else None
        )
        city_overrides_relative = _repo_relative(Path(context["cityOverridesPath"]), root=root)
        catalog_path_relative = _repo_relative(Path(context["releasableCatalogLocalPath"]), root=root) if updated_catalog_entry is not None else ""
        manifest_path_relative = _repo_relative(Path(context["manifestPath"]), root=root) if materialized.get("manifestPayload") is not None else ""
        return {
            "ok": True,
            "scenarioId": context["scenarioId"],
            "tag": normalized_tag,
            "featureId": normalized_feature_id,
            "cityId": normalized_city_id,
            "countryEntry": materialized_countries.get(normalized_tag),
            "catalogEntry": updated_catalog_entry,
            "cityOverrideEntry": city_override_entry,
            "filePath": _repo_relative(Path(context["countriesPath"]), root=root),
            "catalogPath": catalog_path_relative,
            "cityOverridesPath": city_overrides_relative,
            "mutationsPath": _repo_relative(Path(context["mutationsPath"]), root=root),
            "manualOverridesPath": _repo_relative(Path(context["manualOverridesPath"]), root=root),
            "manifestPath": manifest_path_relative,
            "savedAt": _now_iso(),
        }


def _load_district_groups_payload(context: dict[str, object]) -> dict[str, object]:
    district_groups_path = Path(context["districtGroupsPath"])
    if district_groups_path.exists():
        payload = _read_json(district_groups_path)
    else:
        payload = {
            "version": 1,
            "scenario_id": str(context["scenarioId"]),
            "generated_at": "",
            "tags": {},
        }
    if not isinstance(payload, dict):
        raise DevServerError("invalid_district_groups", "District groups file must be a JSON object.", status=500)
    tags = payload.get("tags", {})
    if not isinstance(tags, dict):
        tags = {}
    legacy_countries = payload.get("countries", {})
    if not isinstance(legacy_countries, dict):
        legacy_countries = {}
    payload["tags"] = tags
    payload["countries"] = legacy_countries
    return payload


def _build_tag_districts(
    *,
    tag: str,
    districts: object,
    valid_feature_ids: set[str] | None = None,
) -> dict[str, dict[str, object]]:
    return build_tag_districts_service(
        tag=tag,
        districts=districts,
        valid_feature_ids=valid_feature_ids,
        error_cls=DevServerError,
    )


def _save_scenario_district_groups_payload_from_context(
    context: dict[str, object],
    *,
    tag: object,
    districts: object,
    root: Path = ROOT,
) -> dict[str, object]:
    normalized_tag = _validate_tag_code(tag)
    district_groups_payload = _load_district_groups_payload(context)
    if district_groups_payload.get("countries"):
        raise DevServerError(
            "legacy_district_groups_detected",
            "Legacy geo-country district groups were detected. Migrate them before saving scenario-tag districts.",
            status=409,
            details={
                "legacyCountryCodes": sorted(str(code or "").strip() for code in district_groups_payload["countries"].keys()),
            },
        )
    valid_feature_ids = _load_scenario_tag_feature_ids(context, normalized_tag)
    normalized_districts = _build_tag_districts(
        tag=normalized_tag,
        districts=districts,
        valid_feature_ids=valid_feature_ids,
    )
    pipeline_result = _write_and_materialize_mutation_pipeline(
        context,
        mutation_patch={
            "district_groups": {
                normalized_tag: {
                    "tag": normalized_tag,
                    "districts": normalized_districts,
                }
            }
        },
        target="district-groups",
        root=root,
    )
    district_groups_payload = pipeline_result["materialize"]["districtGroups"]["districtGroupsPayload"]
    district_groups_path = Path(context["districtGroupsPath"])
    current_url = _repo_relative(district_groups_path, root=root)

    return {
        "ok": True,
        "scenarioId": context["scenarioId"],
        "tag": normalized_tag,
        "tagRecord": district_groups_payload["tags"][normalized_tag],
        "filePath": _repo_relative(district_groups_path, root=root),
        "districtGroupsUrl": current_url,
        "manifestPath": _repo_relative(Path(context["manifestPath"]), root=root),
        "savedAt": _now_iso(),
        "stats": {
            "tag": normalized_tag,
            "districtCount": len(normalized_districts),
            "featureCount": sum(len(entry["feature_ids"]) for entry in normalized_districts.values()),
        },
    }


def save_scenario_district_groups_payload(
    scenario_id: object,
    *,
    tag: object,
    districts: object,
    root: Path = ROOT,
) -> dict[str, object]:
    with _locked_scenario_context(scenario_id, root=root) as context:
        return _save_scenario_district_groups_payload_from_context(
            context,
            tag=tag,
            districts=districts,
            root=root,
        )


def _load_shared_district_templates_payload(*, root: Path = ROOT) -> dict[str, object]:
    shared_templates_path = _ensure_path_within_root(
        DEFAULT_SHARED_DISTRICT_TEMPLATES_PATH if root == ROOT else root / "data" / "scenarios" / "district_templates.shared.json",
        root=root,
    )
    if shared_templates_path.exists():
        payload = _read_json(shared_templates_path)
    else:
        payload = {
            "version": 1,
            "generated_at": "",
            "templates": {},
        }
    if not isinstance(payload, dict):
        raise DevServerError("invalid_shared_templates", "Shared district templates file must be a JSON object.", status=500)
    templates = payload.get("templates", {})
    if not isinstance(templates, dict):
        templates = {}
    payload["templates"] = templates
    return payload


def save_shared_district_template_payload(
    scenario_id: object,
    *,
    tag: object,
    template_tag: object,
    districts: object,
    root: Path = ROOT,
) -> dict[str, object]:
    shared_templates_path = _ensure_path_within_root(
        DEFAULT_SHARED_DISTRICT_TEMPLATES_PATH if root == ROOT else root / "data" / "scenarios" / "district_templates.shared.json",
        root=root,
    )
    with _locked_scenario_context(scenario_id, root=root, extra_paths=[shared_templates_path]) as context:
        normalized_tag = _validate_tag_code(tag)
        normalized_template_tag = _validate_tag_code(template_tag)
        valid_feature_ids = _load_scenario_tag_feature_ids(context, normalized_tag)
        normalized_districts = _build_tag_districts(
            tag=normalized_tag,
            districts=districts,
            valid_feature_ids=valid_feature_ids,
        )
        payload = _load_shared_district_templates_payload(root=root)
        payload["version"] = int(payload.get("version") or 1)
        payload["generated_at"] = _now_iso()
        payload["templates"][normalized_template_tag] = {
            "tag": normalized_template_tag,
            "source_scenario_id": str(context["scenarioId"]),
            "source_tag": normalized_tag,
            "saved_at": payload["generated_at"],
            "districts": normalized_districts,
        }
        write_json_atomic(shared_templates_path, payload, ensure_ascii=False, indent=2, trailing_newline=True)

        return {
            "ok": True,
            "scenarioId": context["scenarioId"],
            "tag": normalized_tag,
            "templateTag": normalized_template_tag,
            "template": payload["templates"][normalized_template_tag],
            "filePath": _repo_relative(shared_templates_path, root=root),
            "savedAt": _now_iso(),
            "stats": {
                "tag": normalized_tag,
                "templateTag": normalized_template_tag,
                "districtCount": len(normalized_districts),
                "featureCount": sum(len(entry["feature_ids"]) for entry in normalized_districts.values()),
            },
        }


def apply_shared_district_template_payload(
    scenario_id: object,
    *,
    tag: object,
    template_tag: object,
    root: Path = ROOT,
) -> dict[str, object]:
    shared_templates_path = _ensure_path_within_root(
        DEFAULT_SHARED_DISTRICT_TEMPLATES_PATH if root == ROOT else root / "data" / "scenarios" / "district_templates.shared.json",
        root=root,
    )
    with _locked_scenario_context(scenario_id, root=root, extra_paths=[shared_templates_path]) as context:
        normalized_tag = _validate_tag_code(tag)
        normalized_template_tag = _validate_tag_code(template_tag)
        shared_payload = _load_shared_district_templates_payload(root=root)
        template = shared_payload.get("templates", {}).get(normalized_template_tag)
        if not isinstance(template, dict):
            raise DevServerError(
                "missing_shared_template",
                f'Shared district template "{normalized_template_tag}" does not exist.',
                status=404,
            )
        template_districts = list((template.get("districts") or {}).values()) if isinstance(template.get("districts"), dict) else []
        applied_districts = [
            {
                "districtId": district.get("district_id") or district.get("id"),
                "nameEn": district.get("name_en") or district.get("nameEn"),
                "nameZh": district.get("name_zh") or district.get("nameZh"),
                "featureIds": district.get("feature_ids") or district.get("featureIds") or [],
            }
            for district in template_districts
        ]
        save_result = _save_scenario_district_groups_payload_from_context(
            context,
            tag=normalized_tag,
            districts=applied_districts,
            root=root,
        )
        save_result["templateTag"] = normalized_template_tag
        save_result["appliedTemplate"] = template
        return save_result


def save_scenario_geo_locale_entry(
    scenario_id: object,
    *,
    feature_id: object,
    en: object = "",
    zh: object = "",
    mode: object = "manual_override",
    root: Path = ROOT,
) -> dict[str, object]:
    normalized_mode = str(mode or "manual_override").strip().lower() or "manual_override"
    if normalized_mode != "manual_override":
        raise DevServerError(
            "unsupported_geo_locale_mode",
            f"Unsupported geo locale save mode: {normalized_mode}",
            status=400,
        )
    with _locked_scenario_context(scenario_id, root=root) as context:
        if not context["geoLocalePatchPath"]:
            raise DevServerError(
                "missing_geo_locale_patch",
                "The active scenario does not declare a geo locale patch target.",
                status=400,
            )

        normalized_feature_id = str(feature_id or "").strip()
        if not normalized_feature_id:
            raise DevServerError("missing_feature_id", "Feature id is required for geo locale saves.", status=400)
        locale_entry = _normalize_locale_entry(en, zh)
        mutation_entry: dict[str, object] | None = locale_entry or None
        publish_targets: tuple[str, ...] = ("geo-locale",)
        if str(context["scenarioId"]) == "tno_1962":
            publish_targets = ("geo-locale", "startup-assets")
        _write_and_materialize_mutation_pipeline(
            context,
            mutation_patch={
                "geo_locale": {
                    normalized_feature_id: mutation_entry,
                }
            },
            target="geo-locale",
            publish_targets=publish_targets,
            root=root,
        )

        geo_locale_patch_payload = _read_json(Path(context["geoLocalePatchPath"]))
        current_entry = (
            geo_locale_patch_payload.get("geo", {}).get(normalized_feature_id)
            if isinstance(geo_locale_patch_payload, dict)
            else None
        )
        return {
            "ok": True,
            "scenarioId": context["scenarioId"],
            "featureId": normalized_feature_id,
            "filePath": _repo_relative(Path(context["manualGeoOverridesPath"]), root=root),
            "mutationsPath": _repo_relative(Path(context["mutationsPath"]), root=root),
            "generatedPath": _repo_relative(Path(context["geoLocalePatchPath"]), root=root),
            "savedAt": _now_iso(),
            "entry": current_entry or None,
        }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the local Scenario Forge development server.",
        allow_abbrev=False,
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Bind to a fixed port instead of scanning the default port range.",
    )
    parser.add_argument(
        "open_path",
        nargs="?",
        default="",
        help="Optional initial path to open in the browser, such as /?render_profile=balanced.",
    )
    return parser.parse_args(argv)


def resolve_open_path(cli_path: str = ""):
    cli_path = str(cli_path or "").strip()
    env_path = os.environ.get("MAPCREATOR_OPEN_PATH", "").strip()
    raw_path = cli_path or env_path or "/"
    if not raw_path.startswith("/"):
        raw_path = f"/{raw_path}"
    return raw_path


def resolve_runtime_active_server_path():
    runtime_root = os.environ.get("MAPCREATOR_RUNTIME_ROOT", "").strip()
    if runtime_root:
        return Path(runtime_root) / "dev" / "active_server.json"
    return RUNTIME_ACTIVE_SERVER_PATH


def should_open_browser() -> bool:
    raw = str(os.environ.get("MAPCREATOR_OPEN_BROWSER", "1") or "").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def write_active_server_metadata(base_url, open_path, port):
    metadata_path = resolve_runtime_active_server_path()
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    parsed = urlparse(open_path or "/")
    query = parse_qs(parsed.query or "")
    payload = {
        "url": base_url,
        "port": port,
        "pid": os.getpid(),
        "started_at": _now_iso(),
        "open_path": open_path,
        "cwd": str(Path.cwd()),
        "command": " ".join(sys.argv),
        "topology_variant": (query.get("topology_variant") or [""])[0],
        "render_profile_default": (query.get("render_profile") or [""])[0],
    }
    metadata_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return metadata_path


class Handler(http.server.SimpleHTTPRequestHandler):
    STATIC_REVALIDATE_SUFFIXES = {
        ".js",
        ".mjs",
        ".css",
        ".json",
        ".geojson",
        ".topo.json",
        ".svg",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".woff",
        ".woff2",
        ".ttf",
    }

    def log_message(self, format, *args):
        # Optional: Silence default logging to keep console clean, or keep it.
        pass

    def _cache_mode(self) -> str:
        raw = os.environ.get("MAPCREATOR_DEV_CACHE_MODE", "").strip().lower()
        if raw == "revalidate-static":
            return "revalidate-static"
        return "nostore"

    def _resolve_cache_headers(self) -> dict[str, str]:
        route = urlparse(self.path or "").path
        if route.startswith("/__dev/"):
            return {
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        if self._cache_mode() == "revalidate-static":
            filesystem_path = Path(self.translate_path(self.path))
            suffix = "".join(filesystem_path.suffixes[-2:]).lower() or filesystem_path.suffix.lower()
            if filesystem_path.is_file() and (
                filesystem_path.suffix.lower() in self.STATIC_REVALIDATE_SUFFIXES
                or suffix in self.STATIC_REVALIDATE_SUFFIXES
            ):
                return {
                    "Cache-Control": "no-cache, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                }
        return {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        }

    def end_headers(self):
        for header_name, header_value in self._resolve_cache_headers().items():
            self.send_header(header_name, header_value)
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _client_accepts_gzip(self) -> bool:
        encodings = str(self.headers.get("Accept-Encoding") or "").lower()
        return "gzip" in encodings

    def _resolve_static_gzip_target(self) -> Path | None:
        route = urlparse(self.path or "").path
        if route.startswith("/__dev/"):
            return None
        filesystem_path = Path(self.translate_path(self.path))
        if not filesystem_path.is_file():
            return None
        name = filesystem_path.name.lower()
        if not any(name.endswith(suffix) for suffix in GZIP_STATIC_SUFFIXES):
            return None
        return filesystem_path

    def _maybe_send_gzip_static(self, *, head_only: bool) -> bool:
        if not self._client_accepts_gzip():
            return False
        target_path = self._resolve_static_gzip_target()
        if not target_path:
            return False
        compressed_body = gzip.compress(target_path.read_bytes())
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(target_path)))
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(compressed_body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(compressed_body)
        return True

    def _read_json_body(self) -> dict[str, object]:
        raw_length = self.headers.get("Content-Length", "").strip()
        if not raw_length:
            raise DevServerError("missing_content_length", "Request body is required.", status=400)
        try:
            content_length = int(raw_length)
        except ValueError as exc:
            raise DevServerError("invalid_content_length", "Content-Length must be an integer.", status=400) from exc
        if content_length <= 0:
            raise DevServerError("empty_body", "Request body is required.", status=400)
        if content_length > MAX_JSON_BODY_BYTES:
            raise DevServerError(
                "body_too_large",
                f"Request body exceeds the {MAX_JSON_BODY_BYTES} byte limit.",
                status=413,
            )
        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DevServerError("invalid_json", "Request body must be valid UTF-8 JSON.", status=400) from exc
        if not isinstance(payload, dict):
            raise DevServerError("invalid_payload", "Request body must be a JSON object.", status=400)
        return payload

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Origin", f"http://{BIND_ADDRESS}:{self.server.server_address[1]}")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self._maybe_send_gzip_static(head_only=False):
            return
        super().do_GET()

    def do_HEAD(self):
        if self._maybe_send_gzip_static(head_only=True):
            return
        super().do_HEAD()

    def do_POST(self):
        route = urlparse(self.path or "").path
        try:
            payload = self._read_json_body()
            if route == "/__dev/scenario/tag/create":
                response = save_scenario_tag_create_payload(
                    payload.get("scenarioId"),
                    feature_ids=payload.get("featureIds"),
                    tag=payload.get("tag"),
                    name_en=payload.get("nameEn"),
                    name_zh=payload.get("nameZh"),
                    color_hex=payload.get("colorHex"),
                    parent_owner_tag=payload.get("parentOwnerTag"),
                    inspector_group_id=payload.get("inspectorGroupId"),
                    inspector_group_label=payload.get("inspectorGroupLabel"),
                    inspector_group_anchor_id=payload.get("inspectorGroupAnchorId"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/districts/save":
                response = save_scenario_district_groups_payload(
                    payload.get("scenarioId"),
                    tag=payload.get("tag"),
                    districts=payload.get("districts"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/district-templates/save":
                response = save_shared_district_template_payload(
                    payload.get("scenarioId"),
                    tag=payload.get("tag"),
                    template_tag=payload.get("templateTag") or payload.get("tag"),
                    districts=payload.get("districts"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/district-templates/apply":
                response = apply_shared_district_template_payload(
                    payload.get("scenarioId"),
                    tag=payload.get("tag"),
                    template_tag=payload.get("templateTag"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/ownership/save":
                response = save_scenario_ownership_payload(
                    payload.get("scenarioId"),
                    payload.get("owners"),
                    assignments_by_feature_id=payload.get("assignmentsByFeatureId"),
                    baseline_hash=payload.get("baselineHash"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/country/save":
                response = save_scenario_country_payload(
                    payload.get("scenarioId"),
                    tag=payload.get("tag"),
                    name_en=payload.get("nameEn"),
                    name_zh=payload.get("nameZh"),
                    color_hex=payload.get("colorHex"),
                    parent_owner_tag=payload.get("parentOwnerTag"),
                    notes=payload.get("notes"),
                    featured=payload.get("featured"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/capital/save":
                response = save_scenario_capital_payload(
                    payload.get("scenarioId"),
                    tag=payload.get("tag"),
                    feature_id=payload.get("featureId"),
                    city_id=payload.get("cityId"),
                    capital_state_id=payload.get("capitalStateId"),
                    city_name=payload.get("cityName"),
                    stable_key=payload.get("stableKey"),
                    country_code=payload.get("countryCode"),
                    lookup_iso2=payload.get("lookupIso2"),
                    base_iso2=payload.get("baseIso2"),
                    capital_kind=payload.get("capitalKind"),
                    population=payload.get("population"),
                    lon=payload.get("lon"),
                    lat=payload.get("lat"),
                    urban_match_id=payload.get("urbanMatchId"),
                    base_tier=payload.get("baseTier"),
                    name_ascii=payload.get("nameAscii"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/geo-locale/save":
                response = save_scenario_geo_locale_entry(
                    payload.get("scenarioId"),
                    feature_id=payload.get("featureId"),
                    en=payload.get("en"),
                    zh=payload.get("zh"),
                    mode=payload.get("mode"),
                )
                self._send_json(200, response)
                return
            raise DevServerError("not_found", f"Unknown dev server route: {route}", status=404)
        except DevServerError as error:
            self._send_json(
                error.status,
                {
                    "ok": False,
                    "code": error.code,
                    "message": error.message,
                    "details": error.details,
                },
            )
        except Exception as error:  # pragma: no cover - safety net
            self._send_json(
                500,
                {
                    "ok": False,
                    "code": "internal_error",
                    "message": f"Unexpected dev server failure: {error}",
                },
            )


def start_server(open_path="/", preferred_port: int | None = None):
    candidate_ports = [preferred_port] if preferred_port else list(range(PORT_START, PORT_END + 1))
    for port in candidate_ports:
        try:
            # Attempt to create the server
            # allow_reuse_address=False on Windows helps avoid some zombie socket issues,
            # but binding to a new port is the safest bet.
            httpd = DevServerTCPServer((BIND_ADDRESS, port), Handler)

            base_url = f"http://{BIND_ADDRESS}:{port}"
            open_url = f"{base_url}{open_path}"
            metadata_path = write_active_server_metadata(base_url, open_path, port)
            print(f"[INFO] Success! Server started at {base_url}")
            print(f"[INFO] Active server metadata written to {metadata_path}")
            if should_open_browser():
                print(f"[INFO] Opening browser at {open_url}")
                print(f"[INFO] (If the browser doesn't open, please visit the URL manually)")
                webbrowser.open(open_url)
            else:
                print(f"[INFO] Browser auto-open disabled. Visit {open_url} manually if needed.")

            # Start serving
            httpd.serve_forever()
            return  # Exit function after server stops (though serve_forever usually blocks)

        except OSError as e:
            # WinError 10048 is "Address already in use"
            if e.errno == 10048 or "Address already in use" in str(e) or "閫氬父姣忎釜濂楁帴瀛楀湴鍧€" in str(e):
                if preferred_port:
                    print(f"[ERROR] Requested port {port} is busy.")
                    sys.exit(1)
                print(f"[WARN] Port {port} is busy. Trying {port + 1}...")
                continue
            # Some other error occurred
            print(f"[ERROR] Unexpected error on port {port}: {e}")
            raise e

    if preferred_port:
        print(f"[FATAL] Could not bind the requested port {preferred_port}.")
        sys.exit(1)
    print(f"[FATAL] Could not find any open port between {PORT_START} and {PORT_END}.")
    sys.exit(1)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    preferred_port = int(os.environ.get("MAPCREATOR_DEV_PORT") or args.port or 0)
    if preferred_port < 0 or preferred_port > 65535:
        raise SystemExit(f"Invalid --port value: {preferred_port}")
    start_server(resolve_open_path(args.open_path), preferred_port=preferred_port or None)


if __name__ == "__main__":
    main()
