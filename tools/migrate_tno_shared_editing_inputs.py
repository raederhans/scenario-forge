from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.scenario_city_overrides_composer import (
    build_capital_overrides_payload_from_capital_hints,
    extract_city_assets_payload,
    normalize_capital_overrides_payload,
)

SCENARIO_ID = "tno_1962"
SCENARIO_DIR = ROOT / "data" / "scenarios" / SCENARIO_ID


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_city_assets_partial(city_overrides_payload: dict[str, object]) -> dict[str, object]:
    return extract_city_assets_payload(
        city_overrides_payload,
        scenario_id=str(city_overrides_payload.get("scenario_id") or SCENARIO_ID),
    )


def build_capital_defaults_partial(capital_overrides_payload: dict[str, object]) -> dict[str, object]:
    return normalize_capital_overrides_payload(
        capital_overrides_payload,
        scenario_id=str(capital_overrides_payload.get("scenario_id") or SCENARIO_ID),
    )


def build_scenario_mutations(
    manual_overrides_payload: dict[str, object],
    city_overrides_payload: dict[str, object],
    geo_name_overrides_payload: dict[str, object],
    district_groups_payload: dict[str, object],
) -> dict[str, object]:
    countries = dict(manual_overrides_payload.get("countries") or {})
    assignments = dict(manual_overrides_payload.get("assignments") or {})
    geo_locale = dict(geo_name_overrides_payload.get("geo") or {})
    district_groups = dict(district_groups_payload.get("tags") or {})
    capital_city_hints = city_overrides_payload.get("capital_city_hints", {})
    capitals_by_tag = city_overrides_payload.get("capitals_by_tag", {})
    capitals: dict[str, dict[str, object]] = {}
    if isinstance(capital_city_hints, dict):
        for raw_tag, raw_hint in capital_city_hints.items():
            tag = str(raw_tag or "").strip().upper()
            if not tag or not isinstance(raw_hint, dict):
                continue
            if str(raw_hint.get("resolution_method") or "").strip() != "manual_override":
                continue
            capitals[tag] = {
                "feature_id": str(raw_hint.get("host_feature_id") or "").strip(),
                "city_id": str((capitals_by_tag or {}).get(tag) or raw_hint.get("city_id") or "").strip(),
                "capital_state_id": raw_hint.get("capital_state_id"),
                "city_override_entry": dict(raw_hint),
            }
    return {
        "version": 1,
        "scenario_id": SCENARIO_ID,
        "generated_at": str(manual_overrides_payload.get("generated_at") or "").strip(),
        "tags": {},
        "countries": countries,
        "assignments_by_feature_id": assignments,
        "capitals": capitals,
        "geo_locale": geo_locale,
        "district_groups": district_groups,
    }


def run(*, delete_legacy_capital_hints: bool) -> dict[str, object]:
    manual_overrides_path = SCENARIO_DIR / "scenario_manual_overrides.json"
    city_overrides_path = SCENARIO_DIR / "city_overrides.json"
    city_assets_partial_path = SCENARIO_DIR / "city_assets.partial.json"
    capital_defaults_partial_path = SCENARIO_DIR / "capital_defaults.partial.json"
    capital_hints_path = SCENARIO_DIR / "capital_hints.json"
    geo_name_overrides_path = SCENARIO_DIR / "geo_name_overrides.manual.json"
    district_groups_path = SCENARIO_DIR / "district_groups.manual.json"

    manual_overrides_payload = _read_json(manual_overrides_path)
    city_overrides_payload = _read_json(city_overrides_path)
    geo_name_overrides_payload = _read_json(geo_name_overrides_path)
    district_groups_payload = _read_json(district_groups_path)
    existing_city_assets_partial_payload = (
        _read_json(city_assets_partial_path)
        if city_assets_partial_path.exists()
        else None
    )
    existing_capital_defaults_partial_payload = (
        _read_json(capital_defaults_partial_path)
        if capital_defaults_partial_path.exists()
        else None
    )
    capital_hints_payload = _read_json(capital_hints_path) if capital_hints_path.exists() else None

    scenario_mutations_payload = build_scenario_mutations(
        manual_overrides_payload,
        city_overrides_payload,
        geo_name_overrides_payload,
        district_groups_payload,
    )
    city_assets_partial_payload = build_city_assets_partial(
        existing_city_assets_partial_payload or city_overrides_payload,
    )
    capital_defaults_source_payload: dict[str, object]
    if existing_capital_defaults_partial_payload is not None:
        capital_defaults_source_payload = existing_capital_defaults_partial_payload
    elif capital_hints_payload is not None:
        capital_defaults_source_payload = build_capital_overrides_payload_from_capital_hints(
            capital_hints_payload,
            scenario_id=SCENARIO_ID,
        )
    else:
        capital_defaults_source_payload = city_overrides_payload
    capital_defaults_partial_payload = build_capital_defaults_partial(capital_defaults_source_payload)

    scenario_mutations_path = SCENARIO_DIR / "scenario_mutations.json"
    _write_json(scenario_mutations_path, scenario_mutations_payload)
    _write_json(city_assets_partial_path, city_assets_partial_payload)
    _write_json(capital_defaults_partial_path, capital_defaults_partial_payload)
    legacy_capital_hints_existed = capital_hints_path.exists()
    if delete_legacy_capital_hints and legacy_capital_hints_existed:
        capital_hints_path.unlink(missing_ok=True)
    return {
        "scenarioMutationsPath": str(scenario_mutations_path),
        "cityAssetsPartialPath": str(city_assets_partial_path),
        "capitalDefaultsPartialPath": str(capital_defaults_partial_path),
        "legacyCapitalHintsExisted": legacy_capital_hints_existed,
        "deletedLegacyCapitalHints": delete_legacy_capital_hints and legacy_capital_hints_existed,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate checked-in tno_1962 shared editing inputs to canonical partial files.",
        allow_abbrev=False,
    )
    parser.add_argument(
        "--keep-legacy-capital-hints",
        action="store_true",
        help="Keep capital_hints.json instead of deleting it after migration.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    result = run(delete_legacy_capital_hints=not args.keep_legacy_capital_hints)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
