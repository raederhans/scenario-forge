#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scenario_builder.hoi4.parser import load_hierarchy_groups, load_runtime_features  # noqa: E402


DEFAULT_SPEC_PATH = PROJECT_ROOT / "data/releasables/hoi4_reichskommissariat_boundaries.internal.json"
DEFAULT_SOURCE_PATH = PROJECT_ROOT / "data/releasables/hoi4_vanilla.internal.phase1.source.json"
DEFAULT_REPORT_JSON = PROJECT_ROOT / "reports/generated/releasables/hoi4_reichskommissariat_boundaries.audit.json"
DEFAULT_REPORT_MD = PROJECT_ROOT / "reports/generated/releasables/hoi4_reichskommissariat_boundaries.audit.md"
EXPLICIT_ONLY_TAGS = {"RKP", "RKO", "RKU", "RKM"}
EXPLICIT_ONLY_VARIANT_IDS = {"hoi4", "historical_reference"}
EXPLICIT_ONLY_ACTION_IDS = {
    "RKP": {"annexed_poland_to_ger"},
    "RKO": set(),
    "RKU": set(),
    "RKM": {"greater_finland_to_fin"},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Materialize Reichskommissariat boundary specs into explicit feature_ids.")
    parser.add_argument("--spec", default=str(DEFAULT_SPEC_PATH))
    parser.add_argument("--source", default=str(DEFAULT_SOURCE_PATH))
    parser.add_argument("--hierarchy", default=str(PROJECT_ROOT / "data/hierarchy.json"))
    parser.add_argument("--runtime-topology", default="")
    parser.add_argument("--report-json", default=str(DEFAULT_REPORT_JSON))
    parser.add_argument("--report-md", default=str(DEFAULT_REPORT_MD))
    parser.add_argument("--check-only", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def normalize_tag(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalnum())


def normalize_country(raw: object) -> str:
    return "".join(char for char in str(raw or "").strip().upper() if char.isalpha())


def build_indexes(runtime_features: list[object]) -> tuple[set[str], dict[str, set[str]], dict[str, str], dict[str, str]]:
    all_ids: set[str] = set()
    ids_by_country: dict[str, set[str]] = {}
    country_by_id: dict[str, str] = {}
    name_by_id: dict[str, str] = {}
    for feature in runtime_features:
        feature_id = str(getattr(feature, "feature_id", "") or "").strip()
        country_code = normalize_country(getattr(feature, "country_code", ""))
        feature_name = str(getattr(feature, "name", "") or "").strip()
        if not feature_id:
            continue
        all_ids.add(feature_id)
        country_by_id[feature_id] = country_code
        name_by_id[feature_id] = feature_name
        if country_code:
            ids_by_country.setdefault(country_code, set()).add(feature_id)
    return all_ids, ids_by_country, country_by_id, name_by_id


def sorted_unique(values: set[str] | list[str]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


def build_feature_preset_source(feature_ids: list[str]) -> dict[str, object]:
    return {
        "type": "feature_ids",
        "feature_ids": feature_ids,
    }


def normalize_rule_id(raw: object) -> str:
    return str(raw or "").strip().lower()


def rule_uses_non_explicit_inputs(raw_entry: dict[str, object]) -> list[str]:
    offenders: list[str] = []
    for key in [
        "include_country_codes",
        "include_hierarchy_group_ids",
        "include_feature_id_prefixes",
        "exclude_country_codes",
        "exclude_hierarchy_group_ids",
        "exclude_feature_id_prefixes",
        "exclude_feature_ids",
    ]:
        if list(raw_entry.get(key, []) or []):
            offenders.append(key)
    return offenders


def requires_explicit_feature_ids(tag: str, kind: str, rule_id: str) -> bool:
    if tag not in EXPLICIT_ONLY_TAGS:
        return False
    if kind == "boundary_variant":
        return True
    if kind == "companion_action":
        return rule_id in EXPLICIT_ONLY_ACTION_IDS.get(tag, set())
    return False


def extract_existing_feature_ids(source_entry: dict[str, object], *, kind: str, rule_id: str) -> list[str]:
    if kind == "boundary_variant":
        for variant in source_entry.get("boundary_variants", []) or []:
            if normalize_rule_id(variant.get("id")) != rule_id:
                continue
            preset_source = variant.get("preset_source", {}) if isinstance(variant, dict) else {}
            if str(preset_source.get("type") or "").strip() != "feature_ids":
                return []
            return sorted_unique(preset_source.get("feature_ids", []) or [])
        return []
    if kind == "companion_action":
        for action in source_entry.get("companion_actions", []) or []:
            if normalize_rule_id(action.get("id")) != rule_id:
                continue
            preset_source = action.get("preset_source", {}) if isinstance(action, dict) else {}
            if str(preset_source.get("type") or "").strip() != "feature_ids":
                return []
            return sorted_unique(preset_source.get("feature_ids", []) or [])
        return []
    preset_source = source_entry.get("preset_source", {}) if isinstance(source_entry, dict) else {}
    if str(preset_source.get("type") or "").strip() != "feature_ids":
        return []
    return sorted_unique(preset_source.get("feature_ids", []) or [])


def resolve_entry_feature_ids(
    raw_entry: dict[str, object],
    *,
    all_feature_ids: set[str],
    ids_by_country: dict[str, set[str]],
    ids_by_group: dict[str, set[str]],
) -> tuple[list[str], dict[str, list[str]]]:
    selected: set[str] = set()
    diagnostics = {
        "missing_country_codes": [],
        "missing_groups": [],
        "missing_feature_ids": [],
        "missing_prefixes": [],
    }

    for raw_code in raw_entry.get("include_country_codes", []) or []:
        code = normalize_country(raw_code)
        feature_ids = ids_by_country.get(code, set())
        if not feature_ids:
            diagnostics["missing_country_codes"].append(code)
            continue
        selected.update(feature_ids)

    for raw_group in raw_entry.get("include_hierarchy_group_ids", []) or []:
        group_id = str(raw_group).strip()
        feature_ids = ids_by_group.get(group_id, set())
        if not feature_ids:
            diagnostics["missing_groups"].append(group_id)
            continue
        selected.update(feature_ids)

    for raw_prefix in raw_entry.get("include_feature_id_prefixes", []) or []:
        prefix = str(raw_prefix).strip()
        matches = {feature_id for feature_id in all_feature_ids if feature_id.startswith(prefix)}
        if not matches:
            diagnostics["missing_prefixes"].append(prefix)
            continue
        selected.update(matches)

    for raw_feature_id in raw_entry.get("include_feature_ids", []) or []:
        feature_id = str(raw_feature_id).strip()
        if feature_id not in all_feature_ids:
            diagnostics["missing_feature_ids"].append(feature_id)
            continue
        selected.add(feature_id)

    excluded: set[str] = set()
    for raw_code in raw_entry.get("exclude_country_codes", []) or []:
        excluded.update(ids_by_country.get(normalize_country(raw_code), set()))
    for raw_group in raw_entry.get("exclude_hierarchy_group_ids", []) or []:
        excluded.update(ids_by_group.get(str(raw_group).strip(), set()))
    for raw_prefix in raw_entry.get("exclude_feature_id_prefixes", []) or []:
        prefix = str(raw_prefix).strip()
        excluded.update(feature_id for feature_id in all_feature_ids if feature_id.startswith(prefix))
    for raw_feature_id in raw_entry.get("exclude_feature_ids", []) or []:
        feature_id = str(raw_feature_id).strip()
        if feature_id:
            excluded.add(feature_id)

    return sorted_unique(selected - excluded), diagnostics


def render_markdown(audit_rows: list[dict[str, object]]) -> str:
    lines = [
        "# HOI4 Reichskommissariat Boundary Audit",
        "",
        "| Tag | Kind | ID | Basis | Feature Count | Added | Removed | Non-explicit Inputs | Diagnostics |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |",
    ]
    for row in audit_rows:
        diagnostics = row.get("diagnostics", {})
        problems = []
        for key in ["missing_country_codes", "missing_groups", "missing_feature_ids", "missing_prefixes"]:
            values = diagnostics.get(key) or []
            if values:
                problems.append(f"{key}={len(values)}")
        lines.append(
            f"| `{row['tag']}` | `{row.get('kind', '')}` | `{row.get('rule_id', '')}` | `{row.get('basis', '')}` | "
            f"{row.get('feature_count', 0)} | "
            f"{row.get('added_count', 0)} | "
            f"{row.get('removed_count', 0)} | "
            f"{', '.join(row.get('non_explicit_inputs', [])) or '-'} | "
            f"{', '.join(problems) or 'ok'} |"
        )

    lines.extend(["", "## Rule Details", ""])
    for row in audit_rows:
        lines.append(f"### {row['tag']} · {row.get('kind', '')} · {row.get('rule_id', '')}")
        lines.append(f"- Feature count: `{row.get('feature_count', 0)}`")
        lines.append(f"- Added vs previous source: `{row.get('added_count', 0)}`")
        lines.append(f"- Removed vs previous source: `{row.get('removed_count', 0)}`")
        lines.append(f"- Non-explicit inputs: `{', '.join(row.get('non_explicit_inputs', [])) or '-'}`")
        feature_names = row.get("feature_names", []) or []
        added_names = row.get("added_feature_names", []) or []
        removed_names = row.get("removed_feature_names", []) or []
        lines.append("- Feature names:")
        lines.append(f"  {', '.join(feature_names) if feature_names else 'None'}")
        lines.append("- Added feature names:")
        lines.append(f"  {', '.join(added_names) if added_names else 'None'}")
        lines.append("- Removed feature names:")
        lines.append(f"  {', '.join(removed_names) if removed_names else 'None'}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    spec_path = Path(args.spec)
    source_path = Path(args.source)
    spec_payload = load_json(spec_path)
    source_payload = load_json(source_path)
    runtime_topology = Path(args.runtime_topology) if args.runtime_topology else PROJECT_ROOT / str(spec_payload.get("runtime_topology") or "")

    runtime_features = load_runtime_features(runtime_topology)
    hierarchy_groups, _country_meta = load_hierarchy_groups(Path(args.hierarchy))
    all_feature_ids, ids_by_country, _country_by_id, name_by_id = build_indexes(runtime_features)
    ids_by_group = {
        group_id: {feature_id for feature_id in feature_ids if feature_id in all_feature_ids}
        for group_id, feature_ids in hierarchy_groups.items()
    }

    entries = source_payload.get("entries", []) if isinstance(source_payload, dict) else []
    entries_by_tag = {
        normalize_tag(entry.get("tag")): entry
        for entry in entries
        if isinstance(entry, dict) and normalize_tag(entry.get("tag"))
    }

    audit_rows: list[dict[str, object]] = []
    default_variant_feature_ids_by_tag: dict[str, set[str]] = {}
    for spec_entry in spec_payload.get("entries", []) or []:
        if not isinstance(spec_entry, dict):
            continue
        tag = normalize_tag(spec_entry.get("tag"))
        source_entry = entries_by_tag.get(tag)
        if not source_entry:
            raise SystemExit(f"[rk-boundaries] Missing source entry for tag {tag}.")

        source_entry["notes"] = str(spec_entry.get("notes") or source_entry.get("notes") or "").strip()

        boundary_variant_specs = spec_entry.get("boundary_variants")
        companion_action_specs = spec_entry.get("companion_actions")
        if isinstance(boundary_variant_specs, list) and boundary_variant_specs:
            resolved_boundary_variants: list[dict[str, object]] = []
            default_variant_id = normalize_rule_id(spec_entry.get("default_boundary_variant_id"))

            for raw_variant in boundary_variant_specs:
                if not isinstance(raw_variant, dict):
                    continue
                variant_id = normalize_rule_id(raw_variant.get("id"))
                if not variant_id:
                    raise SystemExit(f"[rk-boundaries] Boundary variant for {tag} is missing an id.")
                non_explicit_inputs = rule_uses_non_explicit_inputs(raw_variant)
                if requires_explicit_feature_ids(tag, "boundary_variant", variant_id) and non_explicit_inputs:
                    raise SystemExit(
                        f"[rk-boundaries] Boundary variant {tag}:{variant_id} must use explicit include_feature_ids only; "
                        f"found {', '.join(non_explicit_inputs)}."
                    )
                feature_ids, diagnostics = resolve_entry_feature_ids(
                    raw_variant,
                    all_feature_ids=all_feature_ids,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                )
                if not feature_ids:
                    raise SystemExit(f"[rk-boundaries] Boundary variant {tag}:{variant_id} resolved zero feature IDs.")
                previous_feature_ids = extract_existing_feature_ids(
                    source_entry,
                    kind="boundary_variant",
                    rule_id=variant_id,
                )
                added_feature_ids = sorted(set(feature_ids) - set(previous_feature_ids))
                removed_feature_ids = sorted(set(previous_feature_ids) - set(feature_ids))
                preset_source = build_feature_preset_source(feature_ids)
                resolved_boundary_variants.append(
                    {
                        "id": variant_id,
                        "label": str(raw_variant.get("label") or variant_id).strip(),
                        "description": str(raw_variant.get("description") or "").strip(),
                        "basis": str(raw_variant.get("basis") or spec_entry.get("basis") or "").strip(),
                        "preset_source": preset_source,
                        "resolved_feature_count_hint": len(feature_ids),
                    }
                )
                audit_rows.append(
                    {
                        "tag": tag,
                        "kind": "boundary_variant",
                        "rule_id": variant_id,
                        "basis": str(raw_variant.get("basis") or spec_entry.get("basis") or "").strip(),
                        "precedence": str(raw_variant.get("precedence") or spec_entry.get("precedence") or "").strip(),
                        "notes": str(raw_variant.get("description") or spec_entry.get("notes") or "").strip(),
                        "feature_count": len(feature_ids),
                        "non_explicit_inputs": non_explicit_inputs,
                        "feature_ids": feature_ids,
                        "feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in feature_ids],
                        "added_count": len(added_feature_ids),
                        "removed_count": len(removed_feature_ids),
                        "added_feature_ids": added_feature_ids,
                        "removed_feature_ids": removed_feature_ids,
                        "added_feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in added_feature_ids],
                        "removed_feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in removed_feature_ids],
                        "diagnostics": diagnostics,
                    }
                )

            if not resolved_boundary_variants:
                raise SystemExit(f"[rk-boundaries] Spec for {tag} produced no boundary variants.")
            resolved_variant_ids = {str(item.get("id") or "").strip() for item in resolved_boundary_variants}
            if not default_variant_id:
                default_variant_id = str(resolved_boundary_variants[0].get("id") or "").strip()
            if default_variant_id not in resolved_variant_ids:
                raise SystemExit(f"[rk-boundaries] Default boundary variant {default_variant_id} missing for {tag}.")

            resolved_companion_actions: list[dict[str, object]] = []
            for raw_action in companion_action_specs or []:
                if not isinstance(raw_action, dict):
                    continue
                action_id = normalize_rule_id(raw_action.get("id"))
                if not action_id:
                    raise SystemExit(f"[rk-boundaries] Companion action for {tag} is missing an id.")
                non_explicit_inputs = rule_uses_non_explicit_inputs(raw_action)
                if requires_explicit_feature_ids(tag, "companion_action", action_id) and non_explicit_inputs:
                    raise SystemExit(
                        f"[rk-boundaries] Companion action {tag}:{action_id} must use explicit include_feature_ids only; "
                        f"found {', '.join(non_explicit_inputs)}."
                    )
                feature_ids, diagnostics = resolve_entry_feature_ids(
                    raw_action,
                    all_feature_ids=all_feature_ids,
                    ids_by_country=ids_by_country,
                    ids_by_group=ids_by_group,
                )
                if not feature_ids:
                    raise SystemExit(f"[rk-boundaries] Companion action {tag}:{action_id} resolved zero feature IDs.")
                previous_feature_ids = extract_existing_feature_ids(
                    source_entry,
                    kind="companion_action",
                    rule_id=action_id,
                )
                added_feature_ids = sorted(set(feature_ids) - set(previous_feature_ids))
                removed_feature_ids = sorted(set(previous_feature_ids) - set(feature_ids))
                target_owner_tag = normalize_tag(raw_action.get("target_owner_tag"))
                if not target_owner_tag:
                    raise SystemExit(f"[rk-boundaries] Companion action {tag}:{action_id} is missing target_owner_tag.")
                resolved_companion_actions.append(
                    {
                        "id": action_id,
                        "label": str(raw_action.get("label") or action_id).strip(),
                        "description": str(raw_action.get("description") or "").strip(),
                        "basis": str(raw_action.get("basis") or "").strip(),
                        "action_type": str(raw_action.get("action_type") or "ownership_transfer").strip(),
                        "target_owner_tag": target_owner_tag,
                        "auto_apply_on_core_territory": bool(raw_action.get("auto_apply_on_core_territory")),
                        "hidden_in_ui": bool(raw_action.get("hidden_in_ui")),
                        "preset_source": build_feature_preset_source(feature_ids),
                        "resolved_feature_count_hint": len(feature_ids),
                    }
                )
                audit_rows.append(
                    {
                        "tag": tag,
                        "kind": "companion_action",
                        "rule_id": action_id,
                        "basis": str(raw_action.get("basis") or "").strip(),
                        "precedence": "",
                        "notes": str(raw_action.get("description") or "").strip(),
                        "feature_count": len(feature_ids),
                        "non_explicit_inputs": non_explicit_inputs,
                        "feature_ids": feature_ids,
                        "feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in feature_ids],
                        "added_count": len(added_feature_ids),
                        "removed_count": len(removed_feature_ids),
                        "added_feature_ids": added_feature_ids,
                        "removed_feature_ids": removed_feature_ids,
                        "added_feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in added_feature_ids],
                        "removed_feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in removed_feature_ids],
                        "diagnostics": diagnostics,
                    }
                )

            default_variant = next(
                (item for item in resolved_boundary_variants if str(item.get("id") or "").strip() == default_variant_id),
                resolved_boundary_variants[0],
            )
            source_entry["default_boundary_variant_id"] = default_variant_id
            source_entry["boundary_variants"] = resolved_boundary_variants
            source_entry["companion_actions"] = resolved_companion_actions
            source_entry["preset_source"] = default_variant.get("preset_source", build_feature_preset_source([]))
            default_variant_feature_ids_by_tag[tag] = set(default_variant["preset_source"].get("feature_ids", []))
            continue

        feature_ids, diagnostics = resolve_entry_feature_ids(
            spec_entry,
            all_feature_ids=all_feature_ids,
            ids_by_country=ids_by_country,
            ids_by_group=ids_by_group,
        )
        if not feature_ids:
            raise SystemExit(f"[rk-boundaries] Spec for {tag} resolved zero feature IDs.")

        source_entry.pop("default_boundary_variant_id", None)
        source_entry.pop("boundary_variants", None)
        source_entry.pop("companion_actions", None)
        source_entry["preset_source"] = build_feature_preset_source(feature_ids)
        audit_rows.append(
            {
                "tag": tag,
                "kind": "preset_source",
                "rule_id": "default",
                "basis": str(spec_entry.get("basis") or "").strip(),
                "precedence": str(spec_entry.get("precedence") or "").strip(),
                "notes": str(spec_entry.get("notes") or "").strip(),
                "feature_count": len(feature_ids),
                "non_explicit_inputs": rule_uses_non_explicit_inputs(spec_entry),
                "feature_ids": feature_ids,
                "feature_names": [name_by_id.get(feature_id, feature_id) for feature_id in feature_ids],
                "added_count": 0,
                "removed_count": 0,
                "added_feature_ids": [],
                "removed_feature_ids": [],
                "added_feature_names": [],
                "removed_feature_names": [],
                "diagnostics": diagnostics,
            }
        )

    overlap_rows: list[dict[str, object]] = []
    overlap_tags = sorted(default_variant_feature_ids_by_tag)
    for index, left_tag in enumerate(overlap_tags):
        left_ids = default_variant_feature_ids_by_tag.get(left_tag, set())
        if not left_ids:
            continue
        for right_tag in overlap_tags[index + 1:]:
            right_ids = default_variant_feature_ids_by_tag.get(right_tag, set())
            overlap_ids = sorted(left_ids & right_ids)
            if not overlap_ids:
                continue
            overlap_rows.append(
                {
                    "left_tag": left_tag,
                    "right_tag": right_tag,
                    "count": len(overlap_ids),
                    "feature_ids": overlap_ids,
                }
            )

    audit_payload = {
        "version": 1,
        "spec_path": str(spec_path),
        "runtime_topology": str(runtime_topology),
        "entries": audit_rows,
        "default_variant_overlaps": overlap_rows,
    }
    write_json(Path(args.report_json), audit_payload)
    markdown = render_markdown(audit_rows)
    if overlap_rows:
        overlap_lines = ["", "## Default HOI4 Variant Overlaps", ""]
        for row in overlap_rows:
            overlap_lines.append(
                f"- `{row['left_tag']}` vs `{row['right_tag']}`: {row['count']} overlaps"
            )
        markdown += "\n" + "\n".join(overlap_lines)
    write_text(Path(args.report_md), markdown)
    if overlap_rows:
        raise SystemExit(
            "[rk-boundaries] Default boundary variant overlaps remain: "
            + ", ".join(f"{row['left_tag']}:{row['right_tag']}={row['count']}" for row in overlap_rows)
        )

    if args.check_only:
        return 0

    write_json(source_path, source_payload)
    print(f"[rk-boundaries] Updated {source_path}")
    print(f"[rk-boundaries] Audit JSON: {args.report_json}")
    print(f"[rk-boundaries] Audit Markdown: {args.report_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
