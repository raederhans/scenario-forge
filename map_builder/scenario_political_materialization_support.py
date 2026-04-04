from __future__ import annotations

import copy
import re
from pathlib import Path

from map_builder.scenario_city_overrides_composer import (
    extract_city_assets_payload,
    normalize_capital_overrides_payload,
)
from map_builder.scenario_context import _read_json as read_json
from map_builder.scenario_context import read_json_or_none, repo_relative
from map_builder.scenario_political_materializer import (
    build_capital_city_override_entry_payload,
)
from map_builder.scenario_service_errors import ScenarioServiceError

TAG_CODE_PATTERN = re.compile(r"^[A-Z]{2,4}$")
COLOR_HEX_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")


def normalize_code(value: object) -> str:
    return str(value or "").strip().upper()


def normalize_text(value: object) -> str:
    return str(value or "").strip()


def validate_tag_code(
    tag: object,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> str:
    normalized_tag = normalize_code(tag)
    if not TAG_CODE_PATTERN.fullmatch(normalized_tag):
        raise error_cls(
            "invalid_tag_code",
            "Tag codes must use 2-4 uppercase ASCII letters.",
            status=400,
        )
    return normalized_tag


def validate_color_hex(
    color_hex: object,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> str:
    normalized_color = normalize_text(color_hex)
    if not COLOR_HEX_PATTERN.fullmatch(normalized_color):
        raise error_cls(
            "invalid_color_hex",
            "Color hex values must use the format #RRGGBB.",
            status=400,
        )
    return normalized_color.lower()


def apply_inspector_group_fields(
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


def scenario_country_entry(
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
    return apply_inspector_group_fields(
        entry,
        group_id=inspector_group_id,
        group_label=inspector_group_label,
        group_anchor_id=inspector_group_anchor_id,
    )


def load_country_catalog(
    context: dict[str, object],
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    countries_path = Path(context["countriesPath"])
    payload = read_json(countries_path)
    if not isinstance(payload, dict):
        raise error_cls("invalid_countries", "Scenario countries file must be a JSON object.", status=500)
    countries = payload.get("countries", {})
    if not isinstance(countries, dict):
        raise error_cls("invalid_countries", "Scenario countries catalog must contain a countries object.", status=500)
    payload["countries"] = countries
    return payload


def default_scenario_manual_overrides_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "countries": {},
        "assignments": {},
    }


def load_city_assets_payload(
    context: dict[str, object],
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    city_assets_partial_path = Path(context["cityAssetsPartialPath"])
    payload = read_json_or_none(city_assets_partial_path)
    if payload is None:
        raise error_cls(
            "missing_city_assets_partial",
            f'City assets partial is required for scenario "{context["scenarioId"]}".',
            status=500,
            details={
                "scenarioId": str(context["scenarioId"]),
                "path": str(city_assets_partial_path),
            },
        )
    return extract_city_assets_payload(payload, scenario_id=str(context["scenarioId"]))


def load_default_capital_overrides_payload(
    context: dict[str, object],
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    capital_defaults_partial_path = Path(context["capitalDefaultsPartialPath"])
    payload = read_json_or_none(capital_defaults_partial_path)
    if payload is None:
        raise error_cls(
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


def normalize_releasable_catalog(payload: object, *, scenario_id: str) -> dict[str, object]:
    if not isinstance(payload, dict):
        payload = {}
    entries = payload.get("entries", [])
    if not isinstance(entries, list):
        entries = []
    normalized = dict(payload)
    normalized["version"] = int(normalized.get("version") or 1)
    normalized["catalog_id"] = normalize_text(normalized.get("catalog_id")) or f"{scenario_id}.manual"
    normalized["generated_at"] = normalize_text(normalized.get("generated_at"))
    normalized["scenario_ids"] = [scenario_id]
    normalized["entries"] = entries
    return normalized


def load_source_releasable_catalog_for_materialization(
    context: dict[str, object],
) -> dict[str, object] | None:
    source_catalog_path = Path(context["releasableCatalogPath"]) if context.get("releasableCatalogPath") else None
    if source_catalog_path is None or not source_catalog_path.exists():
        return None
    local_catalog_path = Path(context["releasableCatalogLocalPath"]).resolve()
    if source_catalog_path.resolve() == local_catalog_path:
        return None
    return normalize_releasable_catalog(read_json(source_catalog_path), scenario_id=str(context["scenarioId"]))


def load_local_releasable_catalog_for_materialization(
    context: dict[str, object],
) -> dict[str, object] | None:
    local_catalog_path = Path(context["releasableCatalogLocalPath"])
    if not local_catalog_path.exists():
        return None
    return normalize_releasable_catalog(read_json(local_catalog_path), scenario_id=str(context["scenarioId"]))


def load_releasable_catalog_for_edits(context: dict[str, object]) -> dict[str, object] | None:
    local_catalog_path = Path(context["releasableCatalogLocalPath"])
    source_catalog_path = (
        Path(context["releasableCatalogPath"])
        if context.get("releasableCatalogPath")
        else None
    )
    if local_catalog_path.exists():
        return normalize_releasable_catalog(
            read_json(local_catalog_path),
            scenario_id=str(context["scenarioId"]),
        )
    if source_catalog_path is not None and source_catalog_path.exists():
        return normalize_releasable_catalog(
            read_json(source_catalog_path),
            scenario_id=str(context["scenarioId"]),
        )
    return None


def build_country_entry_from_mutation(
    context: dict[str, object],
    tag: str,
    mutation: dict[str, object],
    *,
    existing_entry: dict[str, object] | None,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    mode = str(mutation.get("mode") or "override").strip().lower() or "override"
    normalized_tag = validate_tag_code(tag, error_cls=error_cls)
    parent_owner_tag = normalize_code(mutation.get("parent_owner_tag"))
    if existing_entry is None:
        if mode != "create":
            raise error_cls(
                "unknown_scenario_tag",
                f'Tag "{normalized_tag}" does not exist in the active scenario countries catalog.',
                status=404,
            )
        entry = scenario_country_entry(
            scenario_id=str(context["scenarioId"]),
            tag=normalized_tag,
            display_name_en=normalize_text(mutation.get("display_name_en") or mutation.get("display_name") or normalized_tag),
            display_name_zh=normalize_text(mutation.get("display_name_zh") or normalized_tag),
            color_hex=validate_color_hex(mutation.get("color_hex") or "#000000", error_cls=error_cls),
            feature_count=0,
            parent_owner_tag=parent_owner_tag,
            inspector_group_id=normalize_text(mutation.get("inspector_group_id")),
            inspector_group_label=normalize_text(mutation.get("inspector_group_label")),
            inspector_group_anchor_id=normalize_text(mutation.get("inspector_group_anchor_id")),
        )
    else:
        entry = copy.deepcopy(existing_entry)

    display_name_en = normalize_text(
        mutation.get("display_name_en") or mutation.get("display_name") or entry.get("display_name_en") or entry.get("display_name")
    )
    display_name_zh = normalize_text(mutation.get("display_name_zh") or entry.get("display_name_zh"))
    if not display_name_en or not display_name_zh:
        raise error_cls(
            "missing_bilingual_name",
            "Both English and Chinese names are required.",
            status=400,
        )

    entry["display_name"] = display_name_en
    entry["display_name_en"] = display_name_en
    entry["display_name_zh"] = display_name_zh
    entry["color_hex"] = validate_color_hex(
        mutation.get("color_hex") or entry.get("color_hex") or "#000000",
        error_cls=error_cls,
    )
    entry["parent_owner_tag"] = parent_owner_tag
    entry["parent_owner_tags"] = [parent_owner_tag] if parent_owner_tag else []
    if "featured" in mutation:
        entry["featured"] = bool(mutation.get("featured"))
    if "notes" in mutation:
        entry["notes"] = normalize_text(mutation.get("notes"))
    if "capital_state_id" in mutation:
        entry["capital_state_id"] = mutation.get("capital_state_id")
    apply_inspector_group_fields(
        entry,
        group_id=normalize_text(mutation.get("inspector_group_id")),
        group_label=normalize_text(mutation.get("inspector_group_label")),
        group_anchor_id=normalize_text(mutation.get("inspector_group_anchor_id")),
    )
    return entry


def build_capital_city_override_entry(
    tag: str,
    country_entry: dict[str, object],
    capital_mutation: dict[str, object],
    *,
    previous_hint: dict[str, object] | None = None,
) -> dict[str, object]:
    previous_hint = previous_hint if isinstance(previous_hint, dict) else {}
    return build_capital_city_override_entry_payload(
        tag=tag,
        country_entry=country_entry,
        capital_state_id=capital_mutation.get("capital_state_id"),
        city_id=normalize_text(capital_mutation.get("city_id")),
        city_name=normalize_text(capital_mutation.get("city_name")),
        stable_key=normalize_text(capital_mutation.get("stable_key") or previous_hint.get("stable_key")),
        country_code=normalize_code(
            capital_mutation.get("country_code")
            or previous_hint.get("country_code")
            or country_entry.get("lookup_iso2")
            or country_entry.get("base_iso2")
        ),
        lookup_iso2=normalize_code(
            capital_mutation.get("lookup_iso2")
            or previous_hint.get("lookup_iso2")
            or country_entry.get("lookup_iso2")
        ),
        base_iso2=normalize_code(
            capital_mutation.get("base_iso2")
            or previous_hint.get("base_iso2")
            or country_entry.get("base_iso2")
            or country_entry.get("lookup_iso2")
        ),
        capital_kind=normalize_text(capital_mutation.get("capital_kind")),
        population=capital_mutation.get("population") if capital_mutation.get("population") is not None else previous_hint.get("population"),
        lon=capital_mutation.get("lon") if capital_mutation.get("lon") is not None else previous_hint.get("lon"),
        lat=capital_mutation.get("lat") if capital_mutation.get("lat") is not None else previous_hint.get("lat"),
        urban_match_id=normalize_text(capital_mutation.get("urban_match_id") or previous_hint.get("urban_match_id")),
        base_tier=normalize_text(capital_mutation.get("base_tier") or previous_hint.get("base_tier")).lower(),
        name_ascii=normalize_text(capital_mutation.get("name_ascii")) or normalize_text(previous_hint.get("name_ascii")),
        host_feature_id=normalize_text(capital_mutation.get("feature_id") or previous_hint.get("host_feature_id")),
        previous_hint=previous_hint,
    )


def find_releasable_catalog_entry(
    catalog_payload: dict[str, object],
    tag: str,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> tuple[int, dict[str, object]] | tuple[None, None]:
    entries = catalog_payload.get("entries", [])
    if not isinstance(entries, list):
        return None, None
    normalized_tag = validate_tag_code(tag, error_cls=error_cls)
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        if normalize_code(entry.get("tag")) == normalized_tag:
            return index, copy.deepcopy(entry)
    return None, None


def sync_releasable_catalog_entry_from_country(
    catalog_entry: dict[str, object],
    country_entry: dict[str, object],
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    updated = copy.deepcopy(catalog_entry)
    updated["display_name"] = normalize_text(
        country_entry.get("display_name") or country_entry.get("display_name_en") or updated.get("display_name")
    )
    updated["display_name_en"] = normalize_text(
        country_entry.get("display_name_en") or country_entry.get("display_name") or updated.get("display_name_en")
    )
    updated["display_name_zh"] = normalize_text(country_entry.get("display_name_zh") or updated.get("display_name_zh"))
    updated["color_hex"] = validate_color_hex(
        country_entry.get("color_hex") or updated.get("color_hex") or "#000000",
        error_cls=error_cls,
    )
    updated["capital_state_id"] = country_entry.get("capital_state_id")
    parent_owner_tag = normalize_code(country_entry.get("parent_owner_tag") or updated.get("parent_owner_tag"))
    updated["parent_owner_tag"] = parent_owner_tag
    updated["parent_owner_tags"] = [parent_owner_tag] if parent_owner_tag else []
    apply_inspector_group_fields(
        updated,
        group_id=normalize_text(country_entry.get("inspector_group_id")),
        group_label=normalize_text(country_entry.get("inspector_group_label")),
        group_anchor_id=normalize_text(country_entry.get("inspector_group_anchor_id")),
    )
    return updated


def build_editable_country_entry(
    normalized_tag: str,
    *,
    existing_entry: dict[str, object] | None,
    catalog_entry: dict[str, object] | None,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    if isinstance(existing_entry, dict):
        return copy.deepcopy(existing_entry)
    if not isinstance(catalog_entry, dict):
        raise error_cls(
            "unknown_scenario_tag",
            f'Unknown scenario tag "{normalized_tag}".',
            status=404,
        )
    lookup_code = normalize_code(
        catalog_entry.get("lookup_iso2")
        or catalog_entry.get("release_lookup_iso2")
        or catalog_entry.get("base_iso2")
        or normalized_tag
    )
    updated_entry = {
        "tag": normalized_tag,
        "display_name": normalize_text(
            catalog_entry.get("display_name")
            or catalog_entry.get("display_name_en")
            or normalized_tag
        ),
        "display_name_en": normalize_text(
            catalog_entry.get("display_name_en")
            or catalog_entry.get("display_name")
            or normalized_tag
        ),
        "display_name_zh": normalize_text(catalog_entry.get("display_name_zh")),
        "color_hex": validate_color_hex(
            catalog_entry.get("color_hex") or "#000000",
            error_cls=error_cls,
        ),
        "feature_count": int(catalog_entry.get("resolved_feature_count_hint") or 0),
        "controller_feature_count": int(
            catalog_entry.get("resolved_feature_count_hint") or 0
        ),
        "quality": "releasable",
        "source": "manual_rule",
        "base_iso2": normalize_code(catalog_entry.get("base_iso2") or lookup_code),
        "lookup_iso2": lookup_code,
        "provenance_iso2": normalize_code(
            catalog_entry.get("base_iso2") or lookup_code
        ),
        "scenario_only": True,
        "featured": bool(catalog_entry.get("featured")),
        "capital_state_id": catalog_entry.get("capital_state_id"),
        "notes": normalize_text(catalog_entry.get("notes")),
        "synthetic_owner": False,
        "source_type": "scenario_extension",
        "historical_fidelity": "extended",
        "parent_owner_tag": normalize_code(catalog_entry.get("parent_owner_tag")),
        "parent_owner_tags": [
            normalize_code(value)
            for value in (catalog_entry.get("parent_owner_tags") or [])
            if normalize_code(value)
        ],
        "subject_kind": normalize_text(catalog_entry.get("subject_kind")),
        "entry_kind": normalize_text(catalog_entry.get("entry_kind") or "releasable"),
        "hidden_from_country_list": bool(
            catalog_entry.get("hidden_from_country_list")
        ),
    }
    return apply_inspector_group_fields(
        updated_entry,
        group_id=normalize_text(catalog_entry.get("inspector_group_id")),
        group_label=normalize_text(catalog_entry.get("inspector_group_label")),
        group_anchor_id=normalize_text(catalog_entry.get("inspector_group_anchor_id")),
    )


def normalize_core_assignments(raw_cores_payload: dict[object, object]) -> dict[str, list[str]]:
    cores: dict[str, list[str]] = {}
    for raw_feature_id, raw_core_tags in raw_cores_payload.items():
        feature_id = str(raw_feature_id or "").strip()
        if not feature_id:
            continue
        normalized_core_tags: list[str] = []
        seen: set[str] = set()
        if isinstance(raw_core_tags, list):
            for raw_tag in raw_core_tags:
                normalized_tag = normalize_code(raw_tag)
                if not normalized_tag or normalized_tag in seen:
                    continue
                seen.add(normalized_tag)
                normalized_core_tags.append(normalized_tag)
        elif raw_core_tags is not None:
            normalized_tag = normalize_code(raw_core_tags)
            if normalized_tag:
                normalized_core_tags.append(normalized_tag)
        cores[feature_id] = normalized_core_tags
    return cores


def load_political_payload_bundle(
    context: dict[str, object],
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    owners_path = Path(context["ownersPath"])
    if not owners_path.exists():
        raise error_cls("missing_owners_file", "Scenario owners file is required for scenario political saves.", status=400)
    owners_payload = read_json(owners_path)
    if not isinstance(owners_payload, dict) or not isinstance(owners_payload.get("owners"), dict):
        raise error_cls("invalid_owners_file", "Scenario owners file must contain an owners object.", status=500)
    owners = {
        str(feature_id or "").strip(): normalize_code(owner_code)
        for feature_id, owner_code in owners_payload["owners"].items()
        if str(feature_id or "").strip()
    }

    controllers_path = Path(context["controllersPath"]) if context.get("controllersPath") else None
    controllers_payload: dict[str, object] | None = None
    controllers: dict[str, str] = {}
    if controllers_path is not None:
        if not controllers_path.exists():
            raise error_cls(
                "missing_controllers_file",
                "Scenario controllers file is declared but could not be found.",
                status=400,
            )
        controllers_payload = read_json(controllers_path)
        if not isinstance(controllers_payload, dict) or not isinstance(controllers_payload.get("controllers"), dict):
            raise error_cls("invalid_controllers_file", "Scenario controllers file must contain a controllers object.", status=500)
        controllers = {
            str(feature_id or "").strip(): normalize_code(owner_code)
            for feature_id, owner_code in controllers_payload["controllers"].items()
            if str(feature_id or "").strip()
        }

    cores_path = Path(context["coresPath"]) if context.get("coresPath") else None
    cores_payload: dict[str, object] | None = None
    cores: dict[str, list[str]] = {}
    if cores_path is not None:
        if not cores_path.exists():
            raise error_cls(
                "missing_cores_file",
                "Scenario cores file is declared but could not be found.",
                status=400,
            )
        cores_payload = read_json(cores_path)
        if not isinstance(cores_payload, dict) or not isinstance(cores_payload.get("cores"), dict):
            raise error_cls("invalid_cores_file", "Scenario cores file must contain a cores object.", status=500)
        cores = normalize_core_assignments(cores_payload["cores"])

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


def build_manual_assignment_record(
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


def build_manual_override_country_record(country_entry: dict[str, object], *, mode: str) -> dict[str, object]:
    return {
        "mode": "create" if str(mode).strip().lower() == "create" else "override",
        "display_name": normalize_text(country_entry.get("display_name") or country_entry.get("display_name_en")),
        "display_name_en": normalize_text(country_entry.get("display_name_en") or country_entry.get("display_name")),
        "display_name_zh": normalize_text(country_entry.get("display_name_zh")),
        "color_hex": normalize_text(country_entry.get("color_hex")).lower(),
        "parent_owner_tag": normalize_code(country_entry.get("parent_owner_tag")),
        "subject_kind": normalize_text(country_entry.get("subject_kind")),
        "entry_kind": normalize_text(country_entry.get("entry_kind")),
        "featured": bool(country_entry.get("featured")),
        "hidden_from_country_list": bool(country_entry.get("hidden_from_country_list")),
        "base_iso2": normalize_code(country_entry.get("base_iso2")),
        "lookup_iso2": normalize_code(country_entry.get("lookup_iso2")),
        "provenance_iso2": normalize_code(country_entry.get("provenance_iso2")),
        "capital_state_id": country_entry.get("capital_state_id"),
        "continent_id": normalize_text(country_entry.get("continent_id")),
        "continent_label": normalize_text(country_entry.get("continent_label")),
        "subregion_id": normalize_text(country_entry.get("subregion_id")),
        "subregion_label": normalize_text(country_entry.get("subregion_label")),
        "inspector_group_id": normalize_text(country_entry.get("inspector_group_id")),
        "inspector_group_label": normalize_text(country_entry.get("inspector_group_label")),
        "inspector_group_anchor_id": normalize_text(country_entry.get("inspector_group_anchor_id")),
        "notes": normalize_text(country_entry.get("notes")),
        "scenario_only": bool(country_entry.get("scenario_only", True)),
        "source_type": "scenario_extension",
        "historical_fidelity": "extended",
    }


def validate_core_tags(
    raw_core_tags: object,
    *,
    feature_id: str,
    allowed_tags: set[str],
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> list[str]:
    if raw_core_tags is None:
        return []
    if not isinstance(raw_core_tags, list):
        raise error_cls(
            "invalid_core_tags",
            f'Feature "{feature_id}" must provide cores as an array of tag codes.',
            status=400,
        )
    normalized_core_tags: list[str] = []
    invalid_tags: list[str] = []
    seen: set[str] = set()
    for raw_tag in raw_core_tags:
        normalized_tag = normalize_code(raw_tag)
        if not normalized_tag or normalized_tag not in allowed_tags:
            invalid_tags.append(str(raw_tag or ""))
            continue
        if normalized_tag in seen:
            continue
        seen.add(normalized_tag)
        normalized_core_tags.append(normalized_tag)
    if invalid_tags:
        raise error_cls(
            "invalid_core_tags",
            f'Feature "{feature_id}" used one or more core tags not declared by the scenario.',
            status=400,
            details={"featureId": feature_id, "invalidCoreTags": invalid_tags[:20]},
        )
    return normalized_core_tags


def default_releasable_catalog(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "catalog_id": f"{scenario_id}.manual",
        "generated_at": "",
        "scenario_ids": [scenario_id],
        "entries": [],
    }


def scenario_manual_catalog_entry(
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


def recompute_country_feature_counts(
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
        tag = normalize_code(raw_tag)
        if not tag or not isinstance(raw_country, dict):
            continue
        raw_country["feature_count"] = int(owner_counts.get(tag, 0))
        raw_country["controller_feature_count"] = int(controller_counts.get(tag, 0))
