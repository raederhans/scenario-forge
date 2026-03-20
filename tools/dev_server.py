from __future__ import annotations

import copy
import http.server
import json
import os
import re
from pathlib import Path
import socketserver
import subprocess
import sys
from datetime import datetime
from urllib.parse import parse_qs, urlparse
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.writers import write_json_atomic

# Define the range of ports to try
PORT_START = 8000
PORT_END = 8010
BIND_ADDRESS = "127.0.0.1"
RUNTIME_ACTIVE_SERVER_PATH = Path(".runtime") / "dev" / "active_server.json"
SCENARIO_INDEX_PATH = ROOT / "data" / "scenarios" / "index.json"
GEO_LOCALE_BUILDER_BY_SCENARIO = {
    "tno_1962": ROOT / "tools" / "build_tno_1962_geo_locale_patch.py",
}
DEFAULT_SCENARIO_RELEASABLE_CATALOG_FILENAME = "releasable_catalog.manual.json"
DEFAULT_SCENARIO_DISTRICT_GROUPS_FILENAME = "district_groups.manual.json"
TAG_CODE_PATTERN = re.compile(r"^[A-Z]{2,4}$")
COUNTRY_CODE_PATTERN = re.compile(r"^[A-Z]{2,3}$")
DISTRICT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
COLOR_HEX_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


class DevServerError(Exception):
    def __init__(self, code: str, message: str, *, status: int = 400, details: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def _read_json_or_none(path: Path | None) -> object | None:
    if not path or not path.exists():
        return None
    return _read_json(path)


def _repo_relative(path: Path, *, root: Path = ROOT) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _ensure_path_within_root(path: Path, *, root: Path = ROOT) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise DevServerError(
            "path_outside_root",
            f"Refused to access a path outside the repository root: {path}",
            status=400,
        ) from exc
    return resolved


def _resolve_repo_path(raw_path: object, *, root: Path = ROOT) -> Path:
    text = str(raw_path or "").strip()
    if not text:
        raise DevServerError("missing_path", "Required scenario path is missing.", status=400)
    return _ensure_path_within_root(root / text, root=root)


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
    normalized_id = str(scenario_id or "").strip()
    if not normalized_id:
        raise DevServerError("missing_scenario_id", "Scenario id is required.", status=400)

    registry = _load_scenario_index(root=root)
    scenarios = registry.get("scenarios", []) if isinstance(registry, dict) else []
    scenario_entry = next(
        (entry for entry in scenarios if str(entry.get("scenario_id") or "").strip() == normalized_id),
        None,
    )
    if not scenario_entry:
        raise DevServerError(
            "unknown_scenario",
            f"Scenario \"{normalized_id}\" was not found in the scenario registry.",
            status=404,
        )

    manifest_path = _resolve_repo_path(scenario_entry.get("manifest_url"), root=root)
    if not manifest_path.exists():
        raise DevServerError(
            "missing_manifest",
            f"Manifest for scenario \"{normalized_id}\" does not exist: {manifest_path}",
            status=404,
        )
    manifest = _read_json(manifest_path)
    scenario_dir = manifest_path.parent

    owners_path = _resolve_repo_path(manifest.get("owners_url"), root=root)
    countries_path = _resolve_repo_path(manifest.get("countries_url"), root=root)
    controllers_url = str(manifest.get("controllers_url") or "").strip()
    releasable_catalog_url = str(manifest.get("releasable_catalog_url") or "").strip()
    district_groups_url = str(manifest.get("district_groups_url") or "").strip()
    geo_locale_patch_url = str(manifest.get("geo_locale_patch_url") or "").strip()
    controllers_path = _resolve_repo_path(controllers_url, root=root) if controllers_url else None
    releasable_catalog_path = _resolve_repo_path(releasable_catalog_url, root=root) if releasable_catalog_url else None
    district_groups_path = _resolve_repo_path(district_groups_url, root=root) if district_groups_url else (
        scenario_dir / DEFAULT_SCENARIO_DISTRICT_GROUPS_FILENAME
    )
    geo_locale_patch_path = _resolve_repo_path(geo_locale_patch_url, root=root) if geo_locale_patch_url else None

    for candidate in (owners_path, countries_path, controllers_path, geo_locale_patch_path, district_groups_path):
        if not candidate:
            continue
        try:
            candidate.relative_to(scenario_dir.resolve())
        except ValueError as exc:
            raise DevServerError(
                "path_not_allowed",
                f"Scenario file is outside the scenario directory: {candidate}",
                status=400,
            ) from exc

    context = {
        "scenarioId": normalized_id,
        "manifest": manifest,
        "manifestPath": manifest_path,
        "scenarioDir": scenario_dir,
        "ownersPath": owners_path,
        "countriesPath": countries_path,
        "controllersPath": controllers_path,
        "releasableCatalogUrl": releasable_catalog_url,
        "releasableCatalogPath": releasable_catalog_path,
        "releasableCatalogLocalPath": _ensure_path_within_root(
            scenario_dir / DEFAULT_SCENARIO_RELEASABLE_CATALOG_FILENAME,
            root=root,
        ),
        "districtGroupsUrl": district_groups_url,
        "districtGroupsPath": district_groups_path,
        "geoLocalePatchPath": geo_locale_patch_path,
        "manualGeoOverridesPath": _ensure_path_within_root(
            scenario_dir / "geo_name_overrides.manual.json",
            root=root,
        ),
    }
    return context


def _load_allowed_country_tags(context: dict[str, object]) -> set[str]:
    payload = _read_json(Path(context["countriesPath"]))
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
    baseline_hash: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    context = load_scenario_context(scenario_id, root=root)
    payload = build_scenario_ownership_payload(context, owners, baseline_hash=baseline_hash)
    owners_path = Path(context["ownersPath"])
    write_json_atomic(owners_path, payload, ensure_ascii=False, indent=2, trailing_newline=True)
    owner_codes = sorted(set(payload["owners"].values()))
    return {
        "ok": True,
        "scenarioId": context["scenarioId"],
        "filePath": _repo_relative(owners_path, root=root),
        "savedAt": _now_iso(),
        "stats": {
            "featureCount": len(payload["owners"]),
            "ownerCount": len(owner_codes),
            "ownerCodesSample": owner_codes[:12],
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


def _load_political_assignments(context: dict[str, object]) -> tuple[dict[str, str], dict[str, str]]:
    owners_path = Path(context["ownersPath"])
    controllers_path = Path(context["controllersPath"]) if context.get("controllersPath") else None
    owners_payload = _read_json(owners_path)
    if not isinstance(owners_payload, dict) or not isinstance(owners_payload.get("owners"), dict):
        raise DevServerError("invalid_owners_file", "Scenario owners file must contain an owners object.", status=500)
    controllers_payload: dict[str, object] | None = None
    if controllers_path is None:
        raise DevServerError("missing_controllers_file", "Scenario controllers file is required for tag creation.", status=400)
    controllers_payload = _read_json(controllers_path)
    if not isinstance(controllers_payload, dict) or not isinstance(controllers_payload.get("controllers"), dict):
        raise DevServerError("invalid_controllers_file", "Scenario controllers file must contain a controllers object.", status=500)
    owners = {
        str(feature_id or "").strip(): _normalize_code(owner_code)
        for feature_id, owner_code in owners_payload["owners"].items()
        if str(feature_id or "").strip()
    }
    controllers = {
        str(feature_id or "").strip(): _normalize_code(owner_code)
        for feature_id, owner_code in controllers_payload["controllers"].items()
        if str(feature_id or "").strip()
    }
    return owners, controllers


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
) -> dict[str, object]:
    parent_tags = [parent_owner_tag] if parent_owner_tag else []
    entry_kind = "scenario_subject" if parent_owner_tag else "scenario_country"
    return {
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


def _recompute_country_feature_counts(
    countries: dict[str, object],
    owners: dict[str, str],
    controllers: dict[str, str],
) -> None:
    owner_counts: dict[str, int] = {}
    controller_counts: dict[str, int] = {}
    for owner_code in owners.values():
        normalized_owner_code = _normalize_code(owner_code)
        if not normalized_owner_code:
            continue
        owner_counts[normalized_owner_code] = owner_counts.get(normalized_owner_code, 0) + 1
    for controller_code in controllers.values():
        normalized_controller_code = _normalize_code(controller_code)
        if not normalized_controller_code:
            continue
        controller_counts[normalized_controller_code] = controller_counts.get(normalized_controller_code, 0) + 1
    for raw_tag, raw_country in countries.items():
        tag = _normalize_code(raw_tag)
        if not tag or not isinstance(raw_country, dict):
            continue
        raw_country["feature_count"] = int(owner_counts.get(tag, 0))
        raw_country["controller_feature_count"] = int(controller_counts.get(tag, 0))


def _bootstrap_releasable_catalog(
    context: dict[str, object],
    *,
    root: Path = ROOT,
) -> tuple[dict[str, object], Path]:
    scenario_id = str(context["scenarioId"])
    local_path = Path(context["releasableCatalogLocalPath"])
    source_path = Path(context["releasableCatalogPath"]) if context.get("releasableCatalogPath") else None
    if local_path.exists():
        payload = _read_json(local_path)
    elif source_path and source_path.exists():
        payload = _read_json(source_path)
    else:
        payload = _default_releasable_catalog(scenario_id)
    catalog = _normalize_releasable_catalog(payload, scenario_id=scenario_id)
    write_json_atomic(local_path, catalog, ensure_ascii=False, indent=2, trailing_newline=True)
    current_url = _repo_relative(local_path, root=root)
    if str(context.get("manifest", {}).get("releasable_catalog_url") or "").strip() != current_url:
        _write_manifest(context, updates={"releasable_catalog_url": current_url}, root=root)
    return catalog, local_path


def _build_scenario_tag_create_payload(
    context: dict[str, object],
    *,
    feature_ids: object,
    tag: object,
    name_en: object,
    name_zh: object,
    color_hex: object,
    parent_owner_tag: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    normalized_tag = _validate_tag_code(tag)
    normalized_feature_ids = _normalize_feature_ids(feature_ids)
    normalized_name_en, normalized_name_zh = _validate_bilingual_name(name_en, name_zh)
    normalized_color_hex = _validate_color_hex(color_hex)
    normalized_parent_owner_tag = _normalize_code(parent_owner_tag)
    if normalized_parent_owner_tag and not TAG_CODE_PATTERN.fullmatch(normalized_parent_owner_tag):
        raise DevServerError(
            "invalid_parent_owner_tag",
            "Parent owner tags must use 2-4 uppercase ASCII letters.",
            status=400,
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

    owners, controllers = _load_political_assignments(context)
    missing_feature_ids = [feature_id for feature_id in normalized_feature_ids if feature_id not in owners or feature_id not in controllers]
    if missing_feature_ids:
        raise DevServerError(
            "unknown_feature_ids",
            "One or more selected features were not found in the scenario political files.",
            status=400,
            details={"missingFeatureIds": missing_feature_ids[:20]},
        )

    catalog_payload: dict[str, object] | None = None
    catalog_path = Path(context["releasableCatalogLocalPath"])
    if normalized_parent_owner_tag:
        source_path = Path(context["releasableCatalogPath"]) if context.get("releasableCatalogPath") else None
        if catalog_path.exists():
            catalog_payload = _normalize_releasable_catalog(_read_json(catalog_path), scenario_id=str(context["scenarioId"]))
        elif source_path and source_path.exists():
            catalog_payload = _normalize_releasable_catalog(_read_json(source_path), scenario_id=str(context["scenarioId"]))
        else:
            catalog_payload = _default_releasable_catalog(str(context["scenarioId"]))
        catalog_entries = catalog_payload.get("entries", [])
        if not isinstance(catalog_entries, list):
            catalog_entries = []
        if any(str(entry.get("tag") or "").strip().upper() == normalized_tag for entry in catalog_entries if isinstance(entry, dict)):
            raise DevServerError(
                "duplicate_releasable_tag",
                f'Tag "{normalized_tag}" already exists in the scenario releasable catalog.',
                status=409,
            )

    catalog_entry = _scenario_manual_catalog_entry(
        scenario_id=str(context["scenarioId"]),
        tag=normalized_tag,
        display_name_en=normalized_name_en,
        display_name_zh=normalized_name_zh,
        color_hex=normalized_color_hex,
        feature_ids=normalized_feature_ids,
        parent_owner_tag=normalized_parent_owner_tag,
    )
    country_entry = _scenario_country_entry(
        scenario_id=str(context["scenarioId"]),
        tag=normalized_tag,
        display_name_en=normalized_name_en,
        display_name_zh=normalized_name_zh,
        color_hex=normalized_color_hex,
        feature_count=len(normalized_feature_ids),
        parent_owner_tag=normalized_parent_owner_tag,
    )

    for feature_id in normalized_feature_ids:
        owners[feature_id] = normalized_tag
        controllers[feature_id] = normalized_tag

    countries[normalized_tag] = country_entry
    _recompute_country_feature_counts(countries, owners, controllers)
    countries_payload["generated_at"] = _now_iso()
    write_json_atomic(Path(context["countriesPath"]), countries_payload, ensure_ascii=False, indent=2, trailing_newline=True)

    owners_path = Path(context["ownersPath"])
    controllers_path = Path(context["controllersPath"]) if context.get("controllersPath") else None
    owners_payload = _read_json(owners_path)
    if not isinstance(owners_payload, dict):
        raise DevServerError("invalid_owners_file", "Scenario owners file must be a JSON object.", status=500)
    owners_payload["owners"] = owners
    write_json_atomic(owners_path, owners_payload, ensure_ascii=False, indent=2, trailing_newline=True)
    if controllers_path is None:
        raise DevServerError("missing_controllers_file", "Scenario controllers file is required for tag creation.", status=400)
    controllers_payload = _read_json(controllers_path)
    if not isinstance(controllers_payload, dict):
        raise DevServerError("invalid_controllers_file", "Scenario controllers file must be a JSON object.", status=500)
    controllers_payload["controllers"] = controllers
    write_json_atomic(controllers_path, controllers_payload, ensure_ascii=False, indent=2, trailing_newline=True)

    if normalized_parent_owner_tag:
        if catalog_payload is None:
            catalog_payload = _default_releasable_catalog(str(context["scenarioId"]))
        catalog_payload = _normalize_releasable_catalog(catalog_payload, scenario_id=str(context["scenarioId"]))
        current_url = _repo_relative(catalog_path, root=root)
        if str(context.get("manifest", {}).get("releasable_catalog_url") or "").strip() != current_url:
            _write_manifest(context, updates={"releasable_catalog_url": current_url}, root=root)
        catalog_entries = catalog_payload.get("entries", [])
        if not isinstance(catalog_entries, list):
            catalog_entries = []
        if any(str(entry.get("tag") or "").strip().upper() == normalized_tag for entry in catalog_entries if isinstance(entry, dict)):
            raise DevServerError(
                "duplicate_releasable_tag",
                f'Tag "{normalized_tag}" already exists in the scenario releasable catalog.',
                status=409,
            )
        catalog_entries.append(catalog_entry)
        catalog_payload["entries"] = catalog_entries
        catalog_payload["generated_at"] = _now_iso()
        write_json_atomic(catalog_path, catalog_payload, ensure_ascii=False, indent=2, trailing_newline=True)

    return {
        "ok": True,
        "scenarioId": context["scenarioId"],
        "tag": normalized_tag,
        "featureIds": normalized_feature_ids,
        "countryEntry": country_entry,
        "releasableEntry": catalog_entry if normalized_parent_owner_tag else None,
        "filePath": _repo_relative(Path(context["countriesPath"]), root=root),
        "catalogPath": _repo_relative(catalog_path, root=root) if normalized_parent_owner_tag else "",
        "manifestPath": _repo_relative(Path(context["manifestPath"]), root=root),
        "savedAt": _now_iso(),
        "stats": {
            "selectedFeatureCount": len(normalized_feature_ids),
            "countryCount": len(countries),
            "createdReleasable": bool(normalized_parent_owner_tag),
        },
    }


def save_scenario_tag_create_payload(
    scenario_id: object,
    *,
    feature_ids: object,
    tag: object,
    name_en: object,
    name_zh: object,
    color_hex: object,
    parent_owner_tag: object = "",
    root: Path = ROOT,
) -> dict[str, object]:
    context = load_scenario_context(scenario_id, root=root)
    return _build_scenario_tag_create_payload(
        context,
        feature_ids=feature_ids,
        tag=tag,
        name_en=name_en,
        name_zh=name_zh,
        color_hex=color_hex,
        parent_owner_tag=parent_owner_tag,
        root=root,
    )


def _load_district_groups_payload(context: dict[str, object]) -> dict[str, object]:
    district_groups_path = Path(context["districtGroupsPath"])
    if district_groups_path.exists():
        payload = _read_json(district_groups_path)
    else:
        payload = {
            "version": 1,
            "scenario_id": str(context["scenarioId"]),
            "generated_at": "",
            "countries": {},
        }
    if not isinstance(payload, dict):
        raise DevServerError("invalid_district_groups", "District groups file must be a JSON object.", status=500)
    countries = payload.get("countries", {})
    if not isinstance(countries, dict):
        countries = {}
    payload["countries"] = countries
    return payload


def _build_country_districts(
    *,
    country_code: str,
    districts: object,
    valid_feature_ids: set[str] | None = None,
) -> dict[str, dict[str, object]]:
    if not isinstance(districts, list):
        raise DevServerError("invalid_districts", "District payload must be an array.", status=400)
    normalized_districts: dict[str, dict[str, object]] = {}
    seen_name_en: set[str] = set()
    seen_name_zh: set[str] = set()
    seen_feature_ids: set[str] = set()

    for raw_district in districts:
        if not isinstance(raw_district, dict):
            raise DevServerError("invalid_district", "Each district entry must be an object.", status=400)
        district_id = _normalize_text(raw_district.get("districtId") or raw_district.get("district_id"))
        if not DISTRICT_ID_PATTERN.fullmatch(district_id):
            raise DevServerError(
                "invalid_district_id",
                "District ids must use letters, numbers, underscore, or hyphen.",
                status=400,
            )
        if district_id in normalized_districts:
            raise DevServerError(
                "duplicate_district_ids",
                f'District id "{district_id}" is duplicated within the country payload.',
                status=400,
            )
        name_en, name_zh = _validate_bilingual_name(raw_district.get("nameEn"), raw_district.get("nameZh"))
        name_key_en = name_en.lower()
        name_key_zh = name_zh.lower()
        if name_key_en in seen_name_en or name_key_zh in seen_name_zh:
            raise DevServerError(
                "duplicate_district_names",
                "District names must be unique within the country payload.",
                status=400,
            )
        raw_feature_ids = raw_district.get("featureIds") or raw_district.get("feature_ids")
        if not isinstance(raw_feature_ids, list):
            raise DevServerError("invalid_feature_ids", "Feature ids must be provided as an array.", status=400)
        normalized_raw_feature_ids = [_normalize_text(value) for value in raw_feature_ids]
        if len(set(normalized_raw_feature_ids)) != len(normalized_raw_feature_ids):
            raise DevServerError(
                "duplicate_feature_ids",
                "Each feature id may only belong to one district.",
                status=400,
            )
        feature_ids = _normalize_feature_ids(raw_feature_ids)
        if valid_feature_ids is not None:
            unknown_feature_ids = [feature_id for feature_id in feature_ids if feature_id not in valid_feature_ids]
            if unknown_feature_ids:
                raise DevServerError(
                    "unknown_feature_ids",
                    "One or more district features were not found in the scenario owners file.",
                    status=400,
                    details={"missingFeatureIds": unknown_feature_ids[:20]},
                )
        overlap = seen_feature_ids.intersection(feature_ids)
        if overlap:
            raise DevServerError(
                "duplicate_feature_ids",
                "Each feature id may only belong to one district.",
                status=400,
                details={"duplicateFeatureIds": sorted(overlap)[:20]},
            )
        seen_name_en.add(name_key_en)
        seen_name_zh.add(name_key_zh)
        seen_feature_ids.update(feature_ids)
        normalized_districts[district_id] = {
            "district_id": district_id,
            "name_en": name_en,
            "name_zh": name_zh,
            "feature_ids": feature_ids,
        }
    return normalized_districts


def save_scenario_district_groups_payload(
    scenario_id: object,
    *,
    country_code: object,
    districts: object,
    root: Path = ROOT,
) -> dict[str, object]:
    context = load_scenario_context(scenario_id, root=root)
    normalized_country_code = _validate_country_code(country_code)
    district_groups_payload = _load_district_groups_payload(context)
    owners, _controllers = _load_political_assignments(context)
    normalized_districts = _build_country_districts(
        country_code=normalized_country_code,
        districts=districts,
        valid_feature_ids=set(owners.keys()),
    )

    district_groups_payload["version"] = int(district_groups_payload.get("version") or 1)
    district_groups_payload["scenario_id"] = str(context["scenarioId"])
    district_groups_payload["generated_at"] = _now_iso()
    district_groups_payload.setdefault("countries", {})
    district_groups_payload["countries"][normalized_country_code] = {
        "country_code": normalized_country_code,
        "districts": normalized_districts,
    }

    district_groups_path = Path(context["districtGroupsPath"])
    write_json_atomic(district_groups_path, district_groups_payload, ensure_ascii=False, indent=2, trailing_newline=True)
    current_url = _repo_relative(district_groups_path, root=root)
    if str(context.get("manifest", {}).get("district_groups_url") or "").strip() != current_url:
        _write_manifest(context, updates={"district_groups_url": current_url}, root=root)

    return {
        "ok": True,
        "scenarioId": context["scenarioId"],
        "countryCode": normalized_country_code,
        "country": district_groups_payload["countries"][normalized_country_code],
        "filePath": _repo_relative(district_groups_path, root=root),
        "manifestPath": _repo_relative(Path(context["manifestPath"]), root=root),
        "savedAt": _now_iso(),
        "stats": {
            "countryCode": normalized_country_code,
            "districtCount": len(normalized_districts),
            "featureCount": sum(len(entry["feature_ids"]) for entry in normalized_districts.values()),
        },
    }


def _default_manual_geo_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "geo": {},
    }


def _normalize_locale_entry(en: object, zh: object) -> dict[str, str]:
    entry = {}
    en_text = str(en or "").strip()
    zh_text = str(zh or "").strip()
    if en_text:
        entry["en"] = en_text
    if zh_text:
        entry["zh"] = zh_text
    return entry


def _build_geo_locale_command(context: dict[str, object], *, root: Path = ROOT) -> list[str]:
    scenario_id = str(context["scenarioId"])
    builder_path = GEO_LOCALE_BUILDER_BY_SCENARIO.get(scenario_id)
    if not builder_path:
        raise DevServerError(
            "geo_locale_not_supported",
            f"Scenario \"{scenario_id}\" does not have a registered geo locale patch builder yet.",
            status=501,
        )
    return [
        sys.executable,
        str(builder_path),
        "--scenario-id",
        scenario_id,
        "--scenario-dir",
        str(context["scenarioDir"]),
        "--manual-overrides",
        str(context["manualGeoOverridesPath"]),
        "--output",
        str(context["geoLocalePatchPath"]),
    ]


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

    context = load_scenario_context(scenario_id, root=root)
    if not context["geoLocalePatchPath"]:
        raise DevServerError(
            "missing_geo_locale_patch",
            "The active scenario does not declare a geo locale patch target.",
            status=400,
        )

    normalized_feature_id = str(feature_id or "").strip()
    if not normalized_feature_id:
        raise DevServerError("missing_feature_id", "Feature id is required for geo locale saves.", status=400)

    manual_path = Path(context["manualGeoOverridesPath"])
    if manual_path.exists():
        manual_payload = _read_json(manual_path)
        if not isinstance(manual_payload, dict):
            manual_payload = _default_manual_geo_payload(str(context["scenarioId"]))
    else:
        manual_payload = _default_manual_geo_payload(str(context["scenarioId"]))

    manual_payload["version"] = int(manual_payload.get("version") or 1)
    manual_payload["scenario_id"] = str(context["scenarioId"])
    manual_payload["generated_at"] = __import__("datetime").datetime.now().astimezone().isoformat()
    manual_payload["geo"] = manual_payload.get("geo", {}) if isinstance(manual_payload.get("geo"), dict) else {}

    locale_entry = _normalize_locale_entry(en, zh)
    if locale_entry:
        manual_payload["geo"][normalized_feature_id] = locale_entry
    else:
        manual_payload["geo"].pop(normalized_feature_id, None)

    write_json_atomic(manual_path, manual_payload, ensure_ascii=False, indent=2, trailing_newline=True)

    command = _build_geo_locale_command(context, root=root)
    result = subprocess.run(
        command,
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise DevServerError(
            "geo_locale_build_failed",
            "The geo locale patch builder failed after updating manual overrides.",
            status=500,
            details={
                "command": command,
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-2000:],
            },
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
        "generatedPath": _repo_relative(Path(context["geoLocalePatchPath"]), root=root),
        "savedAt": __import__("datetime").datetime.now().astimezone().isoformat(),
        "entry": current_entry or None,
    }


def resolve_open_path():
    cli_path = sys.argv[1].strip() if len(sys.argv) > 1 and sys.argv[1] else ""
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


def write_active_server_metadata(base_url, open_path, port):
    metadata_path = resolve_runtime_active_server_path()
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    parsed = urlparse(open_path or "/")
    query = parse_qs(parsed.query or "")
    payload = {
        "url": base_url,
        "port": port,
        "pid": os.getpid(),
        "started_at": __import__("datetime").datetime.now().astimezone().isoformat(),
        "open_path": open_path,
        "cwd": str(Path.cwd()),
        "command": " ".join(sys.argv),
        "topology_variant": (query.get("topology_variant") or [""])[0],
        "render_profile_default": (query.get("render_profile") or [""])[0],
    }
    metadata_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return metadata_path


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Optional: Silence default logging to keep console clean, or keep it.
        pass

    def end_headers(self):
        # Keep the dev server aggressively uncached so edited JSON/JS/HTML
        # cannot leave an already-open tab in a stale UI state.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/districts/save":
                response = save_scenario_district_groups_payload(
                    payload.get("scenarioId"),
                    country_code=payload.get("countryCode") or payload.get("geoCountryCode"),
                    districts=payload.get("districts"),
                )
                self._send_json(200, response)
                return
            if route == "/__dev/scenario/ownership/save":
                response = save_scenario_ownership_payload(
                    payload.get("scenarioId"),
                    payload.get("owners"),
                    baseline_hash=payload.get("baselineHash"),
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


def start_server(open_path="/"):
    for port in range(PORT_START, PORT_END + 1):
        try:
            # Attempt to create the server
            # allow_reuse_address=False on Windows helps avoid some zombie socket issues,
            # but binding to a new port is the safest bet.
            httpd = socketserver.TCPServer((BIND_ADDRESS, port), Handler)

            base_url = f"http://{BIND_ADDRESS}:{port}"
            open_url = f"{base_url}{open_path}"
            metadata_path = write_active_server_metadata(base_url, open_path, port)
            print(f"[INFO] Success! Server started at {base_url}")
            print(f"[INFO] Opening browser at {open_url}")
            print(f"[INFO] Active server metadata written to {metadata_path}")
            print(f"[INFO] (If the browser doesn't open, please visit the URL manually)")

            # Open browser
            webbrowser.open(open_url)

            # Start serving
            httpd.serve_forever()
            return  # Exit function after server stops (though serve_forever usually blocks)

        except OSError as e:
            # WinError 10048 is "Address already in use"
            if e.errno == 10048 or "Address already in use" in str(e) or "閫氬父姣忎釜濂楁帴瀛楀湴鍧€" in str(e):
                print(f"[WARN] Port {port} is busy. Trying {port + 1}...")
                continue
            # Some other error occurred
            print(f"[ERROR] Unexpected error on port {port}: {e}")
            raise e

    print(f"[FATAL] Could not find any open port between {PORT_START} and {PORT_END}.")
    sys.exit(1)


if __name__ == "__main__":
    start_server(resolve_open_path())
