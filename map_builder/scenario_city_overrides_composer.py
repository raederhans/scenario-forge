from __future__ import annotations

import copy

CITY_ASSET_AUDIT_KEYS = {
    "renamed_city_count",
    "name_conflict_count",
    "unresolved_city_rename_count",
    "name_conflicts",
    "unresolved_city_renames",
}


def _normalize_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def extract_city_assets_payload(payload: object, *, scenario_id: str) -> dict[str, object]:
    normalized_payload = _normalize_dict(payload)
    audit_payload = _normalize_dict(normalized_payload.get("audit"))
    return {
        "version": int(normalized_payload.get("version") or 1),
        "scenario_id": scenario_id,
        "generated_at": str(normalized_payload.get("generated_at") or "").strip(),
        "cities": copy.deepcopy(_normalize_dict(normalized_payload.get("cities"))),
        "audit": {
            key: copy.deepcopy(value)
            for key, value in audit_payload.items()
            if key in CITY_ASSET_AUDIT_KEYS
        },
    }


def normalize_capital_overrides_payload(payload: object, *, scenario_id: str) -> dict[str, object]:
    normalized_payload = _normalize_dict(payload)
    return {
        "version": int(normalized_payload.get("version") or 1),
        "scenario_id": scenario_id,
        "generated_at": str(normalized_payload.get("generated_at") or "").strip(),
        "capitals_by_tag": copy.deepcopy(_normalize_dict(normalized_payload.get("capitals_by_tag"))),
        "capital_city_hints": copy.deepcopy(_normalize_dict(normalized_payload.get("capital_city_hints"))),
        "audit": copy.deepcopy(_normalize_dict(normalized_payload.get("audit"))),
    }


def build_capital_overrides_payload_from_capital_hints(
    capital_hints_payload: object,
    *,
    scenario_id: str,
    generated_at: str = "",
) -> dict[str, object]:
    normalized_payload = _normalize_dict(capital_hints_payload)
    entries = normalized_payload.get("entries")
    if not isinstance(entries, list):
        entries = []

    capitals_by_tag: dict[str, object] = {}
    capital_city_hints: dict[str, object] = {}
    for raw_entry in entries:
        if not isinstance(raw_entry, dict):
            continue
        normalized_tag = str(raw_entry.get("tag") or "").strip().upper()
        normalized_city_id = str(raw_entry.get("city_id") or "").strip()
        if not normalized_tag or not normalized_city_id:
            continue
        capitals_by_tag[normalized_tag] = normalized_city_id
        capital_city_hints[normalized_tag] = copy.deepcopy(raw_entry)

    audit_payload = _normalize_dict(normalized_payload.get("audit"))
    merged_audit = {
        "default_capital_entry_count": len(capitals_by_tag),
        "default_capital_missing_tag_count": int(normalized_payload.get("missing_tag_count") or 0),
        "default_capital_missing_tags": copy.deepcopy(normalized_payload.get("missing_tags") or []),
    }
    for key in ("rejected_candidate_count", "rejected_candidates", "featured_runtime_missing_count", "featured_runtime_missing_tags"):
        if key in audit_payload:
            merged_audit[f"default_{key}"] = copy.deepcopy(audit_payload[key])

    return {
        "version": int(normalized_payload.get("version") or 1),
        "scenario_id": scenario_id,
        "generated_at": str(generated_at or normalized_payload.get("generated_at") or "").strip(),
        "capitals_by_tag": capitals_by_tag,
        "capital_city_hints": capital_city_hints,
        "audit": merged_audit,
    }


def merge_capital_overrides_payload(
    base_payload: object,
    override_payload: object,
    *,
    scenario_id: str,
    generated_at: str = "",
) -> dict[str, object]:
    base = normalize_capital_overrides_payload(base_payload, scenario_id=scenario_id)
    override = normalize_capital_overrides_payload(override_payload, scenario_id=scenario_id)
    merged_capitals_by_tag = copy.deepcopy(base["capitals_by_tag"])
    merged_capitals_by_tag.update(copy.deepcopy(override["capitals_by_tag"]))
    merged_capital_city_hints = copy.deepcopy(base["capital_city_hints"])
    merged_capital_city_hints.update(copy.deepcopy(override["capital_city_hints"]))
    merged_audit = copy.deepcopy(base["audit"])
    merged_audit.update(copy.deepcopy(override["audit"]))
    return {
        "version": max(int(base["version"]), int(override["version"])),
        "scenario_id": scenario_id,
        "generated_at": str(generated_at or override["generated_at"] or base["generated_at"] or "").strip(),
        "capitals_by_tag": merged_capitals_by_tag,
        "capital_city_hints": merged_capital_city_hints,
        "audit": merged_audit,
    }


def compose_city_overrides_payload(
    city_assets_payload: object,
    capital_overrides_payload: object,
    *,
    scenario_id: str,
    generated_at: str = "",
) -> dict[str, object]:
    city_assets = extract_city_assets_payload(city_assets_payload, scenario_id=scenario_id)
    capital_overrides = normalize_capital_overrides_payload(capital_overrides_payload, scenario_id=scenario_id)
    audit_payload = copy.deepcopy(city_assets["audit"])
    audit_payload.update(copy.deepcopy(capital_overrides["audit"]))
    return {
        "version": max(int(city_assets["version"]), int(capital_overrides["version"])),
        "scenario_id": scenario_id,
        "generated_at": str(generated_at or capital_overrides["generated_at"] or city_assets["generated_at"] or "").strip(),
        "capitals_by_tag": copy.deepcopy(capital_overrides["capitals_by_tag"]),
        "capital_city_hints": copy.deepcopy(capital_overrides["capital_city_hints"]),
        "cities": copy.deepcopy(city_assets["cities"]),
        "audit": audit_payload,
    }
