from __future__ import annotations

import re
from pathlib import Path

from map_builder.scenario_context import _read_json as read_json
from map_builder.scenario_context import now_iso
from map_builder.scenario_service_errors import ScenarioServiceError

TAG_CODE_PATTERN = re.compile(r"^[A-Z]{2,4}$")
DISTRICT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def _normalize_code(value: object) -> str:
    return str(value or "").strip().upper()


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def validate_tag_code(
    tag: object,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> str:
    normalized_tag = _normalize_code(tag)
    if not TAG_CODE_PATTERN.fullmatch(normalized_tag):
        raise error_cls(
            "invalid_tag_code",
            "Tag codes must use 2-4 uppercase ASCII letters.",
            status=400,
        )
    return normalized_tag


def _validate_bilingual_name(
    name_en: object,
    name_zh: object,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> tuple[str, str]:
    normalized_name_en = _normalize_text(name_en)
    normalized_name_zh = _normalize_text(name_zh)
    if not normalized_name_en or not normalized_name_zh:
        raise error_cls(
            "missing_bilingual_name",
            "Both English and Chinese names are required.",
            status=400,
        )
    return normalized_name_en, normalized_name_zh


def _normalize_feature_ids(
    feature_ids: object,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> list[str]:
    if not isinstance(feature_ids, list):
        raise error_cls("invalid_feature_ids", "Feature ids must be provided as an array.", status=400)
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_feature_id in feature_ids:
        feature_id = _normalize_text(raw_feature_id)
        if not feature_id:
            raise error_cls("invalid_feature_ids", "Feature ids cannot contain empty values.", status=400)
        if feature_id in seen:
            continue
        seen.add(feature_id)
        normalized.append(feature_id)
    if not normalized:
        raise error_cls("empty_feature_ids", "At least one feature id is required.", status=400)
    return normalized


def load_scenario_tag_feature_ids(
    context: dict[str, object],
    tag: object,
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> set[str]:
    normalized_tag = validate_tag_code(tag, error_cls=error_cls)
    countries_payload = read_json(Path(context["countriesPath"]))
    countries = countries_payload.get("countries", {}) if isinstance(countries_payload, dict) else {}
    allowed_tags = {
        str(raw_tag or "").strip().upper()
        for raw_tag in countries.keys()
        if str(raw_tag or "").strip()
    }
    if normalized_tag not in allowed_tags:
        raise error_cls(
            "unknown_scenario_tag",
            f'Scenario tag "{normalized_tag}" does not exist in the active scenario countries catalog.',
            status=400,
        )
    owners_payload = read_json(Path(context["ownersPath"]))
    owners = owners_payload.get("owners", {}) if isinstance(owners_payload, dict) else {}
    return {
        str(feature_id or "").strip()
        for feature_id, owner_code in owners.items()
        if str(feature_id or "").strip() and _normalize_code(owner_code) == normalized_tag
    }


def build_tag_districts(
    *,
    tag: object,
    districts: object,
    valid_feature_ids: set[str] | None = None,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, dict[str, object]]:
    validate_tag_code(tag, error_cls=error_cls)
    if not isinstance(districts, list):
        raise error_cls("invalid_districts", "District payload must be an array.", status=400)

    normalized_districts: dict[str, dict[str, object]] = {}
    seen_name_en: set[str] = set()
    seen_name_zh: set[str] = set()
    seen_feature_ids: set[str] = set()

    for raw_district in districts:
        if not isinstance(raw_district, dict):
            raise error_cls("invalid_district", "Each district entry must be an object.", status=400)
        district_id = _normalize_text(raw_district.get("districtId") or raw_district.get("district_id"))
        if not DISTRICT_ID_PATTERN.fullmatch(district_id):
            raise error_cls(
                "invalid_district_id",
                "District ids must use letters, numbers, underscore, or hyphen.",
                status=400,
            )
        if district_id in normalized_districts:
            raise error_cls(
                "duplicate_district_ids",
                f'District id "{district_id}" is duplicated within the scenario tag payload.',
                status=400,
            )
        name_en, name_zh = _validate_bilingual_name(
            raw_district.get("nameEn"),
            raw_district.get("nameZh"),
            error_cls=error_cls,
        )
        name_key_en = name_en.lower()
        name_key_zh = name_zh.lower()
        if name_key_en in seen_name_en or name_key_zh in seen_name_zh:
            raise error_cls(
                "duplicate_district_names",
                "District names must be unique within the scenario tag payload.",
                status=400,
            )
        raw_feature_ids = raw_district.get("featureIds") or raw_district.get("feature_ids")
        if not isinstance(raw_feature_ids, list):
            raise error_cls("invalid_feature_ids", "Feature ids must be provided as an array.", status=400)
        normalized_raw_feature_ids = [_normalize_text(value) for value in raw_feature_ids]
        if len(set(normalized_raw_feature_ids)) != len(normalized_raw_feature_ids):
            raise error_cls(
                "duplicate_feature_ids",
                "Each feature id may only belong to one district.",
                status=400,
            )
        feature_ids = _normalize_feature_ids(raw_feature_ids, error_cls=error_cls)
        if valid_feature_ids is not None:
            unknown_feature_ids = [feature_id for feature_id in feature_ids if feature_id not in valid_feature_ids]
            if unknown_feature_ids:
                raise error_cls(
                    "unknown_feature_ids",
                    "One or more district features were not found in the scenario owners file.",
                    status=400,
                    details={"missingFeatureIds": unknown_feature_ids[:20]},
                )
        overlap = seen_feature_ids.intersection(feature_ids)
        if overlap:
            raise error_cls(
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


def load_district_groups_payload(
    context: dict[str, object],
    *,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    district_groups_path = Path(context["districtGroupsPath"])
    if district_groups_path.exists():
        payload = read_json(district_groups_path)
    else:
        payload = {
            "version": 1,
            "scenario_id": str(context["scenarioId"]),
            "generated_at": "",
            "tags": {},
        }
    if not isinstance(payload, dict):
        raise error_cls("invalid_district_groups", "District groups file must be a JSON object.", status=500)
    tags = payload.get("tags", {})
    if not isinstance(tags, dict):
        tags = {}
    legacy_countries = payload.get("countries", {})
    if not isinstance(legacy_countries, dict):
        legacy_countries = {}
    payload["tags"] = tags
    payload["countries"] = legacy_countries
    return payload


def build_district_groups_payload_in_context(
    context: dict[str, object],
    mutations_payload: dict[str, object],
    *,
    root: Path | None = None,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    existing_payload = load_district_groups_payload(context, error_cls=error_cls)
    if existing_payload.get("countries"):
        raise error_cls(
            "legacy_district_groups_detected",
            "Legacy geo-country district groups were detected. Migrate them before saving scenario-tag districts.",
            status=409,
            details={
                "legacyCountryCodes": sorted(
                    str(code or "").strip() for code in existing_payload["countries"].keys()
                ),
            },
        )

    scenario_id = str(context["scenarioId"])
    raw_tags = mutations_payload.get("district_groups", {})
    if not isinstance(raw_tags, dict):
        raw_tags = {}

    payload: dict[str, object] = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": now_iso(),
        "tags": {},
    }
    for raw_tag, raw_tag_payload in raw_tags.items():
        normalized_tag = validate_tag_code(raw_tag, error_cls=error_cls)
        if not isinstance(raw_tag_payload, dict):
            continue
        raw_districts = raw_tag_payload.get("districts", {})
        if not isinstance(raw_districts, dict):
            raw_districts = {}
        valid_feature_ids = load_scenario_tag_feature_ids(context, normalized_tag, error_cls=error_cls)
        normalized_districts = build_tag_districts(
            tag=normalized_tag,
            districts=[
                {
                    "districtId": raw_district.get("district_id")
                    or raw_district.get("districtId")
                    or raw_district_id,
                    "nameEn": raw_district.get("name_en") or raw_district.get("nameEn"),
                    "nameZh": raw_district.get("name_zh") or raw_district.get("nameZh"),
                    "featureIds": raw_district.get("feature_ids") or raw_district.get("featureIds") or [],
                }
                for raw_district_id, raw_district in raw_districts.items()
                if isinstance(raw_district, dict)
            ],
            valid_feature_ids=valid_feature_ids,
            error_cls=error_cls,
        )
        payload["tags"][normalized_tag] = {
            "tag": normalized_tag,
            "districts": normalized_districts,
        }
    return payload
