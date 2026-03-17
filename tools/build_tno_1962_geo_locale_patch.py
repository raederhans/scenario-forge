#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
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
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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

        if raw_name and locale_zh and locale_en == raw_name:
            geo[feature_id] = {
                "en": raw_name,
                "zh": locale_zh,
            }
            safe_feature_copies += 1
            continue

        if raw_name and locale_en and locale_en != raw_name:
            collision_candidates.append(
                {
                    "feature_id": feature_id,
                    "owner_tag": owner_tag,
                    "raw_name": raw_name,
                    "locale_en": locale_en,
                    "locale_zh": locale_zh,
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
        f"{len(audit.get('collision_candidates', []))} collisions, {len(audit.get('omitted_features', []))} omitted)."
    )


if __name__ == "__main__":
    main()
