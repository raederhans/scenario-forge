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


def build_indexes(runtime_features: list[object]) -> tuple[set[str], dict[str, set[str]], dict[str, str]]:
    all_ids: set[str] = set()
    ids_by_country: dict[str, set[str]] = {}
    country_by_id: dict[str, str] = {}
    for feature in runtime_features:
        feature_id = str(getattr(feature, "feature_id", "") or "").strip()
        country_code = normalize_country(getattr(feature, "country_code", ""))
        if not feature_id:
            continue
        all_ids.add(feature_id)
        country_by_id[feature_id] = country_code
        if country_code:
            ids_by_country.setdefault(country_code, set()).add(feature_id)
    return all_ids, ids_by_country, country_by_id


def sorted_unique(values: set[str] | list[str]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


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
        "| Tag | Basis | Feature Count | Whole-group Inputs | Explicit Fringe IDs | Diagnostics |",
        "| --- | --- | ---: | --- | ---: | --- |",
    ]
    for row in audit_rows:
        diagnostics = row.get("diagnostics", {})
        problems = []
        for key in ["missing_country_codes", "missing_groups", "missing_feature_ids", "missing_prefixes"]:
            values = diagnostics.get(key) or []
            if values:
                problems.append(f"{key}={len(values)}")
        lines.append(
            f"| `{row['tag']}` | `{row.get('basis', '')}` | {row.get('feature_count', 0)} | "
            f"{', '.join(row.get('whole_group_inputs', [])) or '-'} | "
            f"{len(row.get('explicit_fringe_ids', []))} | "
            f"{', '.join(problems) or 'ok'} |"
        )

    lines.extend(["", "## Explicit Fringe IDs", ""])
    for row in audit_rows:
        lines.append(f"### {row['tag']}")
        explicit_ids = row.get("explicit_fringe_ids", [])
        if explicit_ids:
            lines.extend([f"- `{feature_id}`" for feature_id in explicit_ids])
        else:
            lines.append("- None")
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
    all_feature_ids, ids_by_country, _country_by_id = build_indexes(runtime_features)
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
    for spec_entry in spec_payload.get("entries", []) or []:
        if not isinstance(spec_entry, dict):
            continue
        tag = normalize_tag(spec_entry.get("tag"))
        source_entry = entries_by_tag.get(tag)
        if not source_entry:
            raise SystemExit(f"[rk-boundaries] Missing source entry for tag {tag}.")

        feature_ids, diagnostics = resolve_entry_feature_ids(
            spec_entry,
            all_feature_ids=all_feature_ids,
            ids_by_country=ids_by_country,
            ids_by_group=ids_by_group,
        )
        if not feature_ids:
            raise SystemExit(f"[rk-boundaries] Spec for {tag} resolved zero feature IDs.")

        whole_group_inputs = sorted_unique(
            list(spec_entry.get("include_country_codes", []) or [])
            + list(spec_entry.get("include_hierarchy_group_ids", []) or [])
            + list(spec_entry.get("include_feature_id_prefixes", []) or [])
        )
        explicit_fringe_ids = sorted_unique(spec_entry.get("include_feature_ids", []) or [])
        previous_ids = sorted_unique(
            ((source_entry.get("preset_source") or {}).get("feature_ids", []))
            if isinstance(source_entry.get("preset_source"), dict)
            else []
        )
        source_entry["preset_source"] = {
            "type": "feature_ids",
            "feature_ids": feature_ids,
        }
        audit_rows.append(
            {
                "tag": tag,
                "basis": str(spec_entry.get("basis") or "").strip(),
                "precedence": str(spec_entry.get("precedence") or "").strip(),
                "notes": str(spec_entry.get("notes") or "").strip(),
                "feature_count": len(feature_ids),
                "whole_group_inputs": whole_group_inputs,
                "explicit_fringe_ids": explicit_fringe_ids,
                "added_count": len(sorted(set(feature_ids) - set(previous_ids))),
                "removed_count": len(sorted(set(previous_ids) - set(feature_ids))),
                "diagnostics": diagnostics,
            }
        )

    audit_payload = {
        "version": 1,
        "spec_path": str(spec_path),
        "runtime_topology": str(runtime_topology),
        "entries": audit_rows,
    }
    write_json(Path(args.report_json), audit_payload)
    write_text(Path(args.report_md), render_markdown(audit_rows))

    if args.check_only:
        return 0

    write_json(source_path, source_payload)
    print(f"[rk-boundaries] Updated {source_path}")
    print(f"[rk-boundaries] Audit JSON: {args.report_json}")
    print(f"[rk-boundaries] Audit Markdown: {args.report_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
