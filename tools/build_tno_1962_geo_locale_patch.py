#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic

DEFAULT_SCENARIO_ID = "tno_1962"
DEFAULT_SCENARIO_DIR = ROOT / "data" / "scenarios" / DEFAULT_SCENARIO_ID
DEFAULT_LOCALES_PATH = ROOT / "data" / "locales.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build feature-keyed geo locale patch for TNO 1962.")
    parser.add_argument("--scenario-id", default=DEFAULT_SCENARIO_ID)
    parser.add_argument("--scenario-dir", default=str(DEFAULT_SCENARIO_DIR))
    parser.add_argument("--locales", default=str(DEFAULT_LOCALES_PATH))
    parser.add_argument("--manual-overrides", default="")
    parser.add_argument("--output", default="")
    return parser.parse_args()


def normalize_text(value: object) -> str:
    return str(value or "").strip()


def read_json(path: Path) -> object:
    return read_json_strict(path)


def write_json(path: Path, payload: object) -> None:
    write_json_atomic(path, payload, ensure_ascii=False, indent=2, trailing_newline=True)


def normalize_locale_entry(source: object) -> dict[str, str] | None:
    if not isinstance(source, dict):
        return None
    en = normalize_text(source.get("en") or source.get("name_en") or source.get("label_en"))
    zh = normalize_text(source.get("zh") or source.get("name_zh") or source.get("label_zh") or source.get("name_cn"))
    locale_entry: dict[str, str] = {}
    if en:
        locale_entry["en"] = en
    if zh:
        locale_entry["zh"] = zh
    return locale_entry or None


SPLIT_FEATURE_SUFFIX_RE = re.compile(r"__tno1962_\d+$", re.IGNORECASE)


def base_feature_id(feature_id: object) -> str:
    normalized = normalize_text(feature_id)
    if not normalized:
        return ""
    return SPLIT_FEATURE_SUFFIX_RE.sub("", normalized)


def build_patch(*, scenario_id: str, scenario_dir: Path, locales_path: Path, manual_overrides_path: Path, output_path: Path) -> dict[str, object]:
    locales_payload = read_json(locales_path)
    base_geo_locales = locales_payload.get("geo", {}) if isinstance(locales_payload, dict) else {}
    topology_payload = read_json(scenario_dir / "runtime_topology.topo.json")
    owners_payload = read_json(scenario_dir / "owners.by_feature.json")
    manual_payload = read_json(manual_overrides_path) if manual_overrides_path.exists() else {}

    owners_by_feature = owners_payload.get("owners", {}) if isinstance(owners_payload, dict) else {}
    manual_geo_raw = manual_payload.get("geo", {}) if isinstance(manual_payload, dict) else {}
    manual_geo = {
        normalize_text(feature_id): locale_entry
        for feature_id, raw_entry in manual_geo_raw.items()
        if (locale_entry := normalize_locale_entry(raw_entry))
    }

    political_geometries = (
        topology_payload.get("objects", {})
        .get("political", {})
        .get("geometries", [])
    )

    geo: dict[str, dict[str, str]] = {}
    collision_candidates: list[dict[str, str]] = []
    omitted_features: list[dict[str, str]] = []
    safe_feature_copies = 0
    manual_feature_overrides = 0
    raw_name_feature_ids: dict[str, list[str]] = {}

    for geometry in political_geometries:
        properties = geometry.get("properties", {}) if isinstance(geometry, dict) else {}
        feature_id = normalize_text(properties.get("id") or geometry.get("id"))
        raw_name = normalize_text(properties.get("name") or properties.get("label"))
        if feature_id and raw_name:
            raw_name_feature_ids.setdefault(raw_name, []).append(feature_id)

    ambiguous_raw_names = {
        raw_name: {
            "feature_ids": sorted(feature_ids),
            "base_feature_ids": sorted({base_feature_id(feature_id) for feature_id in feature_ids if base_feature_id(feature_id)}),
        }
        for raw_name, feature_ids in raw_name_feature_ids.items()
        if len(feature_ids) > 1
    }
    cross_base_ambiguous_raw_names = {
        raw_name: group
        for raw_name, group in ambiguous_raw_names.items()
        if len(group.get("base_feature_ids", [])) > 1
    }
    split_clone_safe_copies = 0
    cross_base_collision_count = 0
    unique_raw_name_safe_copies = 0

    for geometry in political_geometries:
        properties = geometry.get("properties", {}) if isinstance(geometry, dict) else {}
        feature_id = normalize_text(properties.get("id") or geometry.get("id"))
        raw_name = normalize_text(properties.get("name") or properties.get("label"))
        owner_tag = normalize_text(owners_by_feature.get(feature_id)).upper()
        if not feature_id:
            continue

        if feature_id in manual_geo:
            geo[feature_id] = manual_geo[feature_id]
            manual_feature_overrides += 1
            continue

        locale_entry = base_geo_locales.get(raw_name) if isinstance(base_geo_locales, dict) else None
        normalized_locale = normalize_locale_entry(locale_entry)
        locale_en = normalize_text(normalized_locale.get("en")) if normalized_locale else ""
        locale_zh = normalize_text(normalized_locale.get("zh")) if normalized_locale else ""

        ambiguous_group = ambiguous_raw_names.get(raw_name) if raw_name else None
        raw_name_is_unique = bool(raw_name) and ambiguous_group is None
        raw_name_is_split_clone_group = bool(ambiguous_group) and len(ambiguous_group.get("base_feature_ids", [])) == 1

        if raw_name and locale_zh and locale_en == raw_name and raw_name_is_unique:
            geo[feature_id] = {
                "en": raw_name,
                "zh": locale_zh,
            }
            safe_feature_copies += 1
            unique_raw_name_safe_copies += 1
            continue

        if raw_name and locale_zh and locale_en == raw_name and raw_name_is_split_clone_group:
            geo[feature_id] = {
                "en": raw_name,
                "zh": locale_zh,
            }
            safe_feature_copies += 1
            split_clone_safe_copies += 1
            continue

        if raw_name and locale_zh and locale_en == raw_name and not raw_name_is_unique:
            cross_base_collision_count += 1
            collision_candidates.append(
                {
                    "feature_id": feature_id,
                    "owner_tag": owner_tag,
                    "raw_name": raw_name,
                    "locale_en": locale_en,
                    "locale_zh": locale_zh,
                    "reason": "non_unique_raw_name",
                    "matching_feature_ids": ambiguous_group.get("feature_ids", []) if ambiguous_group else [],
                    "matching_base_feature_ids": ambiguous_group.get("base_feature_ids", []) if ambiguous_group else [],
                }
            )
            continue

        if raw_name and locale_en and locale_en != raw_name:
            collision_candidates.append(
                {
                    "feature_id": feature_id,
                    "owner_tag": owner_tag,
                    "raw_name": raw_name,
                    "locale_en": locale_en,
                    "locale_zh": locale_zh,
                    "reason": "locale_en_mismatch",
                }
            )
            continue

        omitted_features.append(
            {
                "feature_id": feature_id,
                "owner_tag": owner_tag,
                "raw_name": raw_name,
                "reason": (
                    "missing_raw_name"
                    if not raw_name
                    else "missing_locale"
                    if not normalized_locale
                    else "missing_zh"
                ),
            }
        )

    payload = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "geo": geo,
        "audit": {
            "safe_feature_copies": safe_feature_copies,
            "manual_feature_overrides": manual_feature_overrides,
            "unique_raw_name_safe_copy_count": unique_raw_name_safe_copies,
            "split_clone_safe_copy_count": split_clone_safe_copies,
            "collision_candidate_count": len(collision_candidates),
            "cross_base_collision_count": cross_base_collision_count,
            "omitted_feature_count": len(omitted_features),
            "collision_reason_counts": {
                "non_unique_raw_name": sum(1 for row in collision_candidates if row.get("reason") == "non_unique_raw_name"),
                "locale_en_mismatch": sum(1 for row in collision_candidates if row.get("reason") == "locale_en_mismatch"),
            },
            "duplicate_raw_name_count": len(ambiguous_raw_names),
            "ambiguous_raw_name_count": len(cross_base_ambiguous_raw_names),
            "ambiguous_raw_name_sample": [
                {
                    "raw_name": raw_name,
                    "feature_ids": cross_base_ambiguous_raw_names[raw_name]["feature_ids"],
                    "base_feature_ids": cross_base_ambiguous_raw_names[raw_name]["base_feature_ids"],
                }
                for raw_name in sorted(cross_base_ambiguous_raw_names)[:200]
            ],
            "collision_candidates_sample": sorted(
                collision_candidates,
                key=lambda row: (row.get("owner_tag", ""), row.get("feature_id", "")),
            )[:200],
            "collision_candidates": sorted(
                collision_candidates,
                key=lambda row: (row.get("owner_tag", ""), row.get("feature_id", "")),
            ),
            "omitted_features": sorted(
                omitted_features,
                key=lambda row: (row.get("owner_tag", ""), row.get("feature_id", "")),
            ),
        },
    }
    write_json(output_path, payload)
    return payload


def main() -> None:
    args = parse_args()
    scenario_id = normalize_text(args.scenario_id) or DEFAULT_SCENARIO_ID
    scenario_dir = Path(args.scenario_dir)
    locales_path = Path(args.locales)
    manual_overrides_path = Path(args.manual_overrides) if args.manual_overrides else scenario_dir / "geo_name_overrides.manual.json"
    output_path = Path(args.output) if args.output else scenario_dir / "geo_locale_patch.json"

    payload = build_patch(
        scenario_id=scenario_id,
        scenario_dir=scenario_dir,
        locales_path=locales_path,
        manual_overrides_path=manual_overrides_path,
        output_path=output_path,
    )
    audit = payload.get("audit", {}) if isinstance(payload, dict) else {}
    print(
        f"[geo-locale-patch] Wrote {output_path} with {len(payload.get('geo', {}))} feature locales "
        f"({audit.get('safe_feature_copies', 0)} safe copies, {audit.get('manual_feature_overrides', 0)} manual overrides, "
        f"{audit.get('cross_base_collision_count', len(audit.get('collision_candidates', [])))} cross-base collisions, "
        f"{audit.get('split_clone_safe_copy_count', 0)} split-clone safe copies, "
        f"{audit.get('omitted_feature_count', len(audit.get('omitted_features', [])))} omitted)."
    )


if __name__ == "__main__":
    main()
