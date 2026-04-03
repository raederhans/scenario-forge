from __future__ import annotations

from copy import deepcopy

DEFAULT_SCENARIO_MUTATIONS_FILENAME = "scenario_mutations.json"


def default_scenario_mutations_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "tags": {},
        "countries": {},
        "assignments_by_feature_id": {},
        "capitals": {},
        "geo_locale": {},
    }


def normalize_scenario_mutations_payload(payload: object, *, scenario_id: str) -> dict[str, object]:
    if not isinstance(payload, dict):
        payload = {}
    normalized = deepcopy(payload)
    normalized["version"] = int(normalized.get("version") or 1)
    normalized["scenario_id"] = scenario_id
    normalized["generated_at"] = str(normalized.get("generated_at") or "").strip()
    for field in ("tags", "countries", "assignments_by_feature_id", "capitals", "geo_locale"):
        value = normalized.get(field)
        normalized[field] = dict(value) if isinstance(value, dict) else {}
    return normalized
