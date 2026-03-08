#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scenario_builder.hoi4.parser import (  # noqa: E402
    discover_hoi4_source_root,
    load_hierarchy_groups,
    load_palette_pack,
    parse_country_histories,
    parse_country_tags,
    parse_states,
)

EXPLICIT_ONLY_TAGS = {"RKP", "RKO", "RKU", "RKM"}
EXPECTED_BOUNDARY_VARIANT_IDS_BY_TAG = {
    "RKP": {"historical_reference"},
    "RKO": {"hoi4", "historical_reference"},
    "RKU": {"historical_reference"},
    "RKM": {"historical_reference"},
}
EXPECTED_DEFAULT_BOUNDARY_VARIANT_ID_BY_TAG = {
    "RKP": "historical_reference",
    "RKO": "hoi4",
    "RKU": "historical_reference",
    "RKM": "historical_reference",
}
EXPECTED_COMPANION_ACTION_IDS = {
    "RKP": {"annexed_poland_to_ger"},
    "RKO": {"ostland_marijampole_to_ger"},
    "RKU": {"transnistria_to_rom", "crimea_to_ger"},
    "RKM": {"greater_finland_to_fin", "arctic_islands_to_ger"},
}


def normalize_tag(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalnum())


def normalize_iso2(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalpha())


def normalize_hex(raw: object) -> str:
    value = str(raw or "").strip().lower()
    if len(value) == 7 and value.startswith("#") and all(char in "0123456789abcdef" for char in value[1:]):
        return value
    return ""


def fallback_color(tag: str) -> str:
    seed = sum(ord(char) * (index + 1) for index, char in enumerate(tag))
    r = 72 + (seed % 104)
    g = 72 + ((seed // 7) % 104)
    b = 72 + ((seed // 13) % 104)
    return f"#{r:02x}{g:02x}{b:02x}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build HOI4 releasable preset catalog assets.")
    parser.add_argument(
        "--source-json",
        default=str(PROJECT_ROOT / "data/releasables/hoi4_vanilla.internal.phase1.source.json"),
    )
    parser.add_argument(
        "--catalog-output",
        default=str(PROJECT_ROOT / "data/releasables/hoi4_vanilla.internal.phase1.catalog.json"),
    )
    parser.add_argument(
        "--report-output",
        default=str(PROJECT_ROOT / "reports/generated/releasables/hoi4_vanilla.internal.phase1.report.md"),
    )
    parser.add_argument("--source-root", default="")
    parser.add_argument(
        "--palette-pack",
        default=str(PROJECT_ROOT / "data/palettes/hoi4_vanilla.palette.json"),
    )
    parser.add_argument(
        "--hierarchy",
        default=str(PROJECT_ROOT / "data/hierarchy.json"),
    )
    return parser


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def normalize_preset_source(raw: object) -> dict[str, object]:
    payload = raw if isinstance(raw, dict) else {}
    return {
        "type": str(payload.get("type") or "").strip(),
        "name": str(payload.get("name") or "").strip(),
        "group_ids": [str(item).strip() for item in payload.get("group_ids", []) if str(item).strip()],
        "feature_ids": [str(item).strip() for item in payload.get("feature_ids", []) if str(item).strip()],
    }


def normalize_boundary_variant(raw: object) -> dict[str, object]:
    payload = raw if isinstance(raw, dict) else {}
    return {
        "id": str(payload.get("id") or "").strip().lower(),
        "label": str(payload.get("label") or "").strip(),
        "description": str(payload.get("description") or "").strip(),
        "basis": str(payload.get("basis") or "").strip(),
        "preset_source": normalize_preset_source(payload.get("preset_source")),
        "resolved_feature_count_hint": payload.get("resolved_feature_count_hint"),
    }


def normalize_companion_action(raw: object) -> dict[str, object]:
    payload = raw if isinstance(raw, dict) else {}
    return {
        "id": str(payload.get("id") or "").strip().lower(),
        "label": str(payload.get("label") or "").strip(),
        "description": str(payload.get("description") or "").strip(),
        "basis": str(payload.get("basis") or "").strip(),
        "action_type": str(payload.get("action_type") or "").strip(),
        "target_owner_tag": normalize_tag(payload.get("target_owner_tag")),
        "auto_apply_on_core_territory": bool(payload.get("auto_apply_on_core_territory")),
        "hidden_in_ui": bool(payload.get("hidden_in_ui")),
        "preset_source": normalize_preset_source(payload.get("preset_source")),
        "resolved_feature_count_hint": payload.get("resolved_feature_count_hint"),
    }


def resolve_feature_count_hint(preset_source: dict[str, object], hierarchy_groups: dict[str, list[str]]) -> int | None:
    source_type = str(preset_source.get("type") or "").strip()
    if source_type == "feature_ids":
        return len({feature_id for feature_id in preset_source.get("feature_ids", []) if feature_id})
    if source_type != "hierarchy_group_ids":
        return None

    feature_ids: set[str] = set()
    for group_id in preset_source.get("group_ids", []):
        feature_ids.update(str(item).strip() for item in hierarchy_groups.get(group_id, []) if str(item).strip())
    return len(feature_ids)


def build_core_owner_indexes(states_by_id: dict[int, object]) -> tuple[set[str], dict[str, set[str]], dict[str, list[int]]]:
    active_owner_tags: set[str] = set()
    parent_owners_by_core: dict[str, set[str]] = defaultdict(set)
    core_state_ids: dict[str, list[int]] = defaultdict(list)

    for state in states_by_id.values():
        owner_tag = normalize_tag(getattr(state, "owner_tag", ""))
        if owner_tag:
            active_owner_tags.add(owner_tag)
        for core_tag in getattr(state, "core_tags", []) or []:
            normalized_core_tag = normalize_tag(core_tag)
            if not normalized_core_tag:
                continue
            if owner_tag:
                parent_owners_by_core[normalized_core_tag].add(owner_tag)
            core_state_ids[normalized_core_tag].append(int(getattr(state, "state_id", 0) or 0))

    return active_owner_tags, parent_owners_by_core, core_state_ids


def build_catalog_entry(
    raw_entry: dict[str, object],
    *,
    source_scenario_ids: list[str],
    country_tags: dict[str, str],
    country_histories: dict[str, object],
    active_owner_tags: set[str],
    parent_owners_by_core: dict[str, set[str]],
    core_state_ids: dict[str, list[int]],
    hierarchy_groups: dict[str, list[str]],
    palette_entries: dict[str, dict[str, object]],
) -> dict[str, object]:
    manual_overlay = bool(raw_entry.get("allow_manual_overlay"))
    tag = normalize_tag(raw_entry.get("tag"))
    parent_owner_tag = normalize_tag(raw_entry.get("parent_owner_tag"))
    release_lookup_iso2 = normalize_iso2(raw_entry.get("release_lookup_iso2"))
    scenario_ids = [
        str(value).strip()
        for value in raw_entry.get("scenario_ids", source_scenario_ids)
        if str(value).strip()
    ]
    preset_source = normalize_preset_source(raw_entry.get("preset_source"))
    default_boundary_variant_id = str(raw_entry.get("default_boundary_variant_id") or "").strip().lower()
    boundary_variants = [
        normalize_boundary_variant(item)
        for item in raw_entry.get("boundary_variants", [])
        if isinstance(item, dict)
    ]
    companion_actions = [
        normalize_companion_action(item)
        for item in raw_entry.get("companion_actions", [])
        if isinstance(item, dict)
    ]
    notes = str(raw_entry.get("notes") or "").strip()
    palette_entry = palette_entries.get(tag, {}) if isinstance(palette_entries, dict) else {}
    display_name = (
        str(raw_entry.get("display_name_override") or "").strip()
        or str(palette_entry.get("localized_name") or "").strip()
        or str(palette_entry.get("country_file_label") or "").strip()
        or tag
    )
    color_hex = (
        normalize_hex(raw_entry.get("color_hex_override"))
        or normalize_hex(palette_entry.get("map_hex"))
        or normalize_hex(palette_entry.get("country_file_hex"))
        or fallback_color(tag)
    )
    capital_state_id = getattr(country_histories.get(tag), "capital_state_id", None)
    parent_owners = sorted(parent_owners_by_core.get(tag, set()))
    validation_errors: list[str] = []

    if not tag:
        validation_errors.append("missing_tag")
    if tag and tag not in country_tags and not manual_overlay:
        validation_errors.append("unknown_country_tag")
    if tag in active_owner_tags:
        validation_errors.append("tag_is_active_owner")
    if not release_lookup_iso2:
        validation_errors.append("missing_release_lookup_iso2")
    if not capital_state_id and not manual_overlay:
        validation_errors.append("missing_capital_state_id")
    if not parent_owners and not manual_overlay:
        validation_errors.append("missing_core_parent_owner")
    if len(parent_owners) > 1 and not manual_overlay:
        validation_errors.append("multi_parent_core")
    if parent_owner_tag and parent_owners and parent_owner_tag not in parent_owners and not manual_overlay:
        validation_errors.append("parent_owner_mismatch")
    if not parent_owner_tag and len(parent_owners) == 1:
        parent_owner_tag = parent_owners[0]
    if not parent_owner_tag:
        validation_errors.append("missing_parent_owner_tag")

    source_type = str(preset_source.get("type") or "").strip()
    if source_type not in {"legacy_preset_name", "hierarchy_group_ids", "feature_ids"}:
        validation_errors.append("invalid_preset_source_type")
    if source_type == "legacy_preset_name" and not str(preset_source.get("name") or "").strip():
        validation_errors.append("missing_legacy_preset_name")
    if source_type == "hierarchy_group_ids" and not list(preset_source.get("group_ids", [])):
        validation_errors.append("missing_hierarchy_group_ids")
    if source_type == "feature_ids" and not list(preset_source.get("feature_ids", [])):
        validation_errors.append("missing_feature_ids")

    feature_count_hint = resolve_feature_count_hint(preset_source, hierarchy_groups)
    if source_type == "hierarchy_group_ids" and not feature_count_hint:
        validation_errors.append("empty_hierarchy_mapping")
    if source_type == "feature_ids" and feature_count_hint == 0:
        validation_errors.append("empty_feature_mapping")
    if manual_overlay and source_type == "legacy_preset_name":
        validation_errors.append("manual_overlay_unsupported_legacy_preset_name")

    boundary_variant_ids = {variant.get("id") for variant in boundary_variants if variant.get("id")}
    if boundary_variants and not default_boundary_variant_id:
        validation_errors.append("missing_default_boundary_variant_id")
    if default_boundary_variant_id and default_boundary_variant_id not in boundary_variant_ids:
        validation_errors.append("default_boundary_variant_missing")

    normalized_boundary_variants: list[dict[str, object]] = []
    for variant in boundary_variants:
        variant_errors: list[str] = []
        variant_id = str(variant.get("id") or "").strip()
        variant_source = normalize_preset_source(variant.get("preset_source"))
        variant_source_type = str(variant_source.get("type") or "").strip()
        variant_hint = resolve_feature_count_hint(variant_source, hierarchy_groups)
        if not variant_id:
            variant_errors.append("missing_id")
        if variant_source_type not in {"legacy_preset_name", "hierarchy_group_ids", "feature_ids"}:
            variant_errors.append("invalid_preset_source_type")
        if variant_source_type == "legacy_preset_name" and not str(variant_source.get("name") or "").strip():
            variant_errors.append("missing_legacy_preset_name")
        if variant_source_type == "hierarchy_group_ids" and not list(variant_source.get("group_ids", [])):
            variant_errors.append("missing_hierarchy_group_ids")
        if variant_source_type == "feature_ids" and not list(variant_source.get("feature_ids", [])):
            variant_errors.append("missing_feature_ids")
        if variant_source_type == "hierarchy_group_ids" and not variant_hint:
            variant_errors.append("empty_hierarchy_mapping")
        if variant_source_type == "feature_ids" and variant_hint == 0:
            variant_errors.append("empty_feature_mapping")
        if variant_errors:
            validation_errors.append(f"boundary_variant:{variant_id or 'unknown'}:{','.join(variant_errors)}")
        normalized_boundary_variants.append(
            {
                **variant,
                "preset_source": variant_source,
                "resolved_feature_count_hint": variant_hint,
            }
        )

    if tag in EXPLICIT_ONLY_TAGS:
        resolved_variant_ids = {str(variant.get("id") or "").strip() for variant in normalized_boundary_variants if variant.get("id")}
        if resolved_variant_ids != EXPECTED_BOUNDARY_VARIANT_IDS_BY_TAG.get(tag, set()):
            validation_errors.append("boundary_variant_ids_mismatch")
        if default_boundary_variant_id != EXPECTED_DEFAULT_BOUNDARY_VARIANT_ID_BY_TAG.get(tag, ""):
            validation_errors.append("default_boundary_variant_unexpected")
        for variant in normalized_boundary_variants:
            if str(variant.get("preset_source", {}).get("type") or "").strip() != "feature_ids":
                validation_errors.append(f"boundary_variant:{variant.get('id') or 'unknown'}:non_explicit_source")

    normalized_companion_actions: list[dict[str, object]] = []
    for action in companion_actions:
        action_errors: list[str] = []
        action_id = str(action.get("id") or "").strip()
        action_type = str(action.get("action_type") or "").strip()
        target_owner_tag = normalize_tag(action.get("target_owner_tag"))
        action_source = normalize_preset_source(action.get("preset_source"))
        action_source_type = str(action_source.get("type") or "").strip()
        action_hint = resolve_feature_count_hint(action_source, hierarchy_groups)
        if not action_id:
            action_errors.append("missing_id")
        if action_type != "ownership_transfer":
            action_errors.append("invalid_action_type")
        if not target_owner_tag:
            action_errors.append("missing_target_owner_tag")
        elif target_owner_tag not in country_tags and target_owner_tag not in active_owner_tags:
            action_errors.append("unknown_target_owner_tag")
        if action_source_type not in {"legacy_preset_name", "hierarchy_group_ids", "feature_ids"}:
            action_errors.append("invalid_preset_source_type")
        if action_source_type == "legacy_preset_name" and not str(action_source.get("name") or "").strip():
            action_errors.append("missing_legacy_preset_name")
        if action_source_type == "hierarchy_group_ids" and not list(action_source.get("group_ids", [])):
            action_errors.append("missing_hierarchy_group_ids")
        if action_source_type == "feature_ids" and not list(action_source.get("feature_ids", [])):
            action_errors.append("missing_feature_ids")
        if action_source_type == "hierarchy_group_ids" and not action_hint:
            action_errors.append("empty_hierarchy_mapping")
        if action_source_type == "feature_ids" and action_hint == 0:
            action_errors.append("empty_feature_mapping")
        if action_errors:
            validation_errors.append(f"companion_action:{action_id or 'unknown'}:{','.join(action_errors)}")
        normalized_companion_actions.append(
            {
                **action,
                "target_owner_tag": target_owner_tag,
                "auto_apply_on_core_territory": bool(action.get("auto_apply_on_core_territory")),
                "hidden_in_ui": bool(action.get("hidden_in_ui")),
                "preset_source": action_source,
                "resolved_feature_count_hint": action_hint,
            }
        )

    if tag in EXPLICIT_ONLY_TAGS:
        resolved_action_ids = {str(action.get("id") or "").strip() for action in normalized_companion_actions if action.get("id")}
        if resolved_action_ids != EXPECTED_COMPANION_ACTION_IDS.get(tag, set()):
            validation_errors.append("companion_action_ids_mismatch")
        for action in normalized_companion_actions:
            if str(action.get("preset_source", {}).get("type") or "").strip() != "feature_ids":
                validation_errors.append(f"companion_action:{action.get('id') or 'unknown'}:non_explicit_source")

    return {
        "tag": tag,
        "display_name": display_name,
        "color_hex": color_hex,
        "capital_state_id": capital_state_id,
        "parent_owner_tag": parent_owner_tag,
        "parent_owner_tags": parent_owners,
        "release_lookup_iso2": release_lookup_iso2,
        "entry_kind": "releasable",
        "scenario_ids": scenario_ids,
        "scenario_only": True,
        "allow_manual_overlay": manual_overlay,
        "preset_source": preset_source,
        "default_boundary_variant_id": default_boundary_variant_id,
        "boundary_variants": normalized_boundary_variants,
        "companion_actions": normalized_companion_actions,
        "core_state_ids": sorted({state_id for state_id in core_state_ids.get(tag, []) if state_id}),
        "resolved_feature_count_hint": feature_count_hint,
        "validation_status": "ok" if not validation_errors else "error",
        "validation_errors": validation_errors,
        "notes": notes,
    }


def render_markdown_report(catalog_payload: dict[str, object]) -> str:
    lines = [
        "# HOI4 Vanilla Internal Releasables Phase 1",
        "",
        f"- Catalog: `{catalog_payload['catalog_id']}`",
        f"- Generated at: `{catalog_payload['generated_at']}`",
        f"- Scenario IDs: `{', '.join(catalog_payload.get('scenario_ids', []))}`",
        f"- Selected entries: `{catalog_payload['summary']['entry_count']}`",
        f"- Excluded entries: `{catalog_payload['summary']['excluded_count']}`",
        f"- Validation errors: `{catalog_payload['summary']['validation_error_count']}`",
        "",
        "## Selected Entries",
        "",
        "| Tag | Name | Parent | Lookup ISO2 | Source | Feature Hint | Variants / Actions | Validation |",
        "| --- | --- | --- | --- | --- | ---: | --- | --- |",
    ]

    for entry in catalog_payload.get("entries", []):
        preset_source = entry.get("preset_source", {})
        source_label = str(preset_source.get("type") or "")
        if source_label == "legacy_preset_name":
            source_label = f"legacy:{preset_source.get('name')}"
        elif source_label == "hierarchy_group_ids":
            source_label = f"groups:{len(preset_source.get('group_ids', []))}"
        elif source_label == "feature_ids":
            source_label = f"features:{len(preset_source.get('feature_ids', []))}"
        feature_hint = entry.get("resolved_feature_count_hint")
        feature_text = "" if feature_hint is None else str(feature_hint)
        lines.append(
            f"| `{entry['tag']}` | {entry['display_name']} | `{entry['parent_owner_tag']}` | "
            f"`{entry['release_lookup_iso2']}` | `{source_label}` | {feature_text} | "
            f"`{entry.get('default_boundary_variant_id', '') or '-'}` / `{len(entry.get('companion_actions', []))}` | "
            f"`{entry['validation_status']}` |"
        )

    lines.extend(
        [
            "",
            "## Excluded Entries",
            "",
            "| Tag | Reason | Notes |",
            "| --- | --- | --- |",
        ]
    )

    for entry in catalog_payload.get("excluded", []):
        lines.append(
            f"| `{entry.get('tag', '')}` | `{entry.get('reason', '')}` | {entry.get('notes', '')} |"
        )

    validation_errors = [
        entry
        for entry in catalog_payload.get("entries", [])
        if entry.get("validation_errors")
    ]
    if validation_errors:
        lines.extend(["", "## Validation Errors", ""])
        for entry in validation_errors:
            lines.append(f"- `{entry['tag']}`: {', '.join(entry.get('validation_errors', []))}")

    return "\n".join(lines) + "\n"


def main() -> int:
    args = build_parser().parse_args()
    source_json_path = Path(args.source_json)
    catalog_output_path = Path(args.catalog_output)
    report_output_path = Path(args.report_output)
    source_root = discover_hoi4_source_root(args.source_root or None)

    source_payload = load_json(source_json_path)
    hierarchy_groups, _country_meta = load_hierarchy_groups(Path(args.hierarchy))
    palette_pack = load_palette_pack(Path(args.palette_pack))
    country_tags = parse_country_tags(source_root / "common/country_tags/00_countries.txt")
    country_histories = parse_country_histories(source_root / "history/countries")
    states_by_id = parse_states(source_root / "history/states")
    active_owner_tags, parent_owners_by_core, core_state_ids = build_core_owner_indexes(states_by_id)
    palette_entries = palette_pack.get("entries", {}) if isinstance(palette_pack, dict) else {}
    scenario_ids = [str(value).strip() for value in source_payload.get("scenario_ids", []) if str(value).strip()]

    entries = [
        build_catalog_entry(
            raw_entry,
            source_scenario_ids=scenario_ids,
            country_tags=country_tags,
            country_histories=country_histories,
            active_owner_tags=active_owner_tags,
            parent_owners_by_core=parent_owners_by_core,
            core_state_ids=core_state_ids,
            hierarchy_groups=hierarchy_groups,
            palette_entries=palette_entries,
        )
        for raw_entry in source_payload.get("entries", [])
        if isinstance(raw_entry, dict)
    ]

    excluded = [
        {
            "tag": normalize_tag(item.get("tag")),
            "reason": str(item.get("reason") or "").strip(),
            "notes": str(item.get("notes") or "").strip(),
        }
        for item in source_payload.get("excluded", [])
        if isinstance(item, dict)
    ]

    catalog_payload = {
        "version": 1,
        "catalog_id": str(source_payload.get("catalog_id") or "hoi4_vanilla.internal.phase1").strip(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scenario_ids": scenario_ids,
        "entries": entries,
        "excluded": excluded,
        "summary": {
            "entry_count": len(entries),
            "excluded_count": len(excluded),
            "validation_error_count": sum(1 for entry in entries if entry.get("validation_errors")),
        },
    }

    write_json(catalog_output_path, catalog_payload)
    write_text(report_output_path, render_markdown_report(catalog_payload))

    print(f"[releasables] Built {catalog_payload['catalog_id']} from {source_root}")
    print(f"[releasables] Entries: {catalog_payload['summary']['entry_count']}")
    print(f"[releasables] Validation errors: {catalog_payload['summary']['validation_error_count']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
