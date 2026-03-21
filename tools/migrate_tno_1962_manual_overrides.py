from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

import sys

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.patch_tno_1962_bundle import (
    MANUAL_OVERRIDE_FILENAME,
    SCENARIO_DIR,
    SCENARIO_ID,
    default_scenario_manual_overrides_payload,
    load_json,
    write_json,
)


def build_country_override_record(country_entry: dict[str, object], *, mode: str) -> dict[str, object]:
    return {
        "mode": mode,
        "display_name": str(country_entry.get("display_name") or country_entry.get("display_name_en") or "").strip(),
        "display_name_en": str(country_entry.get("display_name_en") or country_entry.get("display_name") or "").strip(),
        "display_name_zh": str(country_entry.get("display_name_zh") or "").strip(),
        "color_hex": str(country_entry.get("color_hex") or "").strip().lower(),
        "parent_owner_tag": str(country_entry.get("parent_owner_tag") or "").strip().upper(),
        "subject_kind": str(country_entry.get("subject_kind") or "").strip(),
        "entry_kind": str(country_entry.get("entry_kind") or "").strip(),
        "featured": bool(country_entry.get("featured")),
        "hidden_from_country_list": bool(country_entry.get("hidden_from_country_list")),
        "base_iso2": str(country_entry.get("base_iso2") or "").strip().upper(),
        "lookup_iso2": str(country_entry.get("lookup_iso2") or "").strip().upper(),
        "provenance_iso2": str(country_entry.get("provenance_iso2") or "").strip().upper(),
        "capital_state_id": country_entry.get("capital_state_id"),
        "continent_id": str(country_entry.get("continent_id") or "").strip(),
        "continent_label": str(country_entry.get("continent_label") or "").strip(),
        "subregion_id": str(country_entry.get("subregion_id") or "").strip(),
        "subregion_label": str(country_entry.get("subregion_label") or "").strip(),
        "notes": str(country_entry.get("notes") or "").strip(),
        "scenario_only": bool(country_entry.get("scenario_only", True)),
        "source_type": "scenario_extension",
        "historical_fidelity": "extended",
    }


def migrate_manual_overrides(scenario_dir: Path) -> dict[str, object]:
    countries_payload = load_json(scenario_dir / "countries.json")
    owners_payload = load_json(scenario_dir / "owners.by_feature.json")
    controllers_payload = load_json(scenario_dir / "controllers.by_feature.json")
    cores_payload = load_json(scenario_dir / "cores.by_feature.json")
    output = default_scenario_manual_overrides_payload(SCENARIO_ID)
    output["generated_at"] = countries_payload.get("generated_at") or ""

    countries = countries_payload.get("countries", {})
    owners = owners_payload.get("owners", {})
    controllers = controllers_payload.get("controllers", {})
    cores = cores_payload.get("cores", {})

    created_tags = {
        str(tag).strip().upper()
        for tag, country_entry in countries.items()
        if isinstance(country_entry, dict)
        and str(country_entry.get("primary_rule_source") or "").strip() == "dev_manual_tag_create"
    }
    for tag in sorted(created_tags):
        country_entry = countries.get(tag)
        if not isinstance(country_entry, dict):
            continue
        output["countries"][tag] = build_country_override_record(country_entry, mode="create")

    feature_ids = set(owners.keys()) | set(controllers.keys()) | set(cores.keys())
    for feature_id in sorted(str(feature_id).strip() for feature_id in feature_ids if str(feature_id).strip()):
        owner = str(owners.get(feature_id) or "").strip().upper()
        controller = str(controllers.get(feature_id) or "").strip().upper()
        core_tags = [
            str(tag or "").strip().upper()
            for tag in (cores.get(feature_id) if isinstance(cores.get(feature_id), list) else [cores.get(feature_id)])
            if str(tag or "").strip()
        ]
        if owner not in created_tags and controller not in created_tags and not any(tag in created_tags for tag in core_tags):
            continue
        output["assignments"][feature_id] = {
            "owner": owner,
            "controller": controller,
            "cores": core_tags,
        }
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill scenario manual overrides for tno_1962.")
    parser.add_argument("--scenario-dir", default=str(SCENARIO_DIR))
    parser.add_argument("--output", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    scenario_dir = Path(args.scenario_dir).resolve()
    output_path = Path(args.output).resolve() if args.output else scenario_dir / MANUAL_OVERRIDE_FILENAME
    payload = migrate_manual_overrides(scenario_dir)
    write_json(output_path, payload)
    print(
        {
            "scenario_id": SCENARIO_ID,
            "output": str(output_path),
            "country_count": len(payload["countries"]),
            "assignment_count": len(payload["assignments"]),
        }
    )


if __name__ == "__main__":
    main()
