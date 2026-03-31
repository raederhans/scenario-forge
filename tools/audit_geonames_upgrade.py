"""Audit the impact of upgrading GeoNames without mutating tracked data."""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.cities import (
    GEONAMES_COLUMNS,
    assign_stable_urban_area_ids,
    build_city_aliases_payload,
    build_merged_world_city_dataset,
    build_world_cities,
    emit_default_scenario_city_assets,
    load_geonames_frame,
)
from map_builder.io.readers import load_urban
from map_builder.io.writers import write_json_atomic


DATA_DIR = PROJECT_ROOT / "data"
SCENARIOS_DIR = DATA_DIR / "scenarios"
RUNTIME_TMP_DIR = PROJECT_ROOT / ".runtime" / "tmp" / "geonames_upgrade"
REPORT_DIR = PROJECT_ROOT / ".runtime" / "reports" / "generated"
REPORT_PATH = REPORT_DIR / "geonames_upgrade_audit.json"

LOCAL_GEONAMES_PATH = DATA_DIR / cfg.GEONAMES_CITIES15000_FILENAME
REMOTE_GEONAMES_PATH = RUNTIME_TMP_DIR / "upstream" / cfg.GEONAMES_CITIES15000_FILENAME
POLITICAL_PATH = DATA_DIR / "europe_topology.political.geojson"
TRACKED_WORLD_CITIES_PATH = DATA_DIR / cfg.WORLD_CITIES_FILENAME
TRACKED_CITY_ALIASES_PATH = DATA_DIR / cfg.CITY_ALIASES_FILENAME


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _download_remote_geonames() -> None:
    REMOTE_GEONAMES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(cfg.GEONAMES_CITIES15000_URL, timeout=(20, 300), stream=True) as response:
        response.raise_for_status()
        with open(REMOTE_GEONAMES_PATH, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                handle.write(chunk)


def _normalize_source_frame(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    result["population"] = pd.to_numeric(result["population"], errors="coerce").fillna(0).astype("int64")
    result = result[result["population"] >= int(cfg.WORLD_CITY_MIN_POPULATION)].copy()
    for column in ("geonameid", "name", "asciiname", "feature_code", "country_code", "admin1_code", "timezone", "alternatenames"):
        result[column] = result[column].fillna("").astype(str)
    return result


def _field_changes(local_frame: pd.DataFrame, remote_frame: pd.DataFrame) -> dict[str, object]:
    tracked_fields = [
        "name",
        "asciiname",
        "population",
        "feature_code",
        "country_code",
        "admin1_code",
        "timezone",
        "alternatenames",
    ]
    local_index = local_frame.set_index("geonameid", drop=False)
    remote_index = remote_frame.set_index("geonameid", drop=False)
    shared_ids = sorted(set(local_index.index).intersection(remote_index.index))
    field_counts = {field: 0 for field in tracked_fields}
    sample_rows: list[dict[str, object]] = []
    for geonameid in shared_ids:
        local_row = local_index.loc[geonameid]
        remote_row = remote_index.loc[geonameid]
        changed_fields = [
            field
            for field in tracked_fields
            if str(local_row.get(field) or "") != str(remote_row.get(field) or "")
        ]
        if not changed_fields:
            continue
        for field in changed_fields:
            field_counts[field] += 1
        if len(sample_rows) < 25:
            sample_rows.append(
                {
                    "geonameid": geonameid,
                    "changed_fields": changed_fields,
                    "local": {field: str(local_row.get(field) or "") for field in changed_fields},
                    "remote": {field: str(remote_row.get(field) or "") for field in changed_fields},
                }
            )
    return {
        "shared_id_count": len(shared_ids),
        "changed_field_counts": field_counts,
        "sample_rows": sample_rows,
    }


def _top_country_deltas(local_frame: pd.DataFrame, remote_frame: pd.DataFrame) -> list[dict[str, object]]:
    local_counts = Counter(local_frame["country_code"].tolist())
    remote_counts = Counter(remote_frame["country_code"].tolist())
    country_codes = sorted(set(local_counts).union(remote_counts))
    rows = []
    for country_code in country_codes:
        local_count = int(local_counts.get(country_code, 0))
        remote_count = int(remote_counts.get(country_code, 0))
        delta = remote_count - local_count
        if delta == 0:
            continue
        rows.append(
            {
                "country_code": country_code,
                "local_count": local_count,
                "remote_count": remote_count,
                "delta": delta,
            }
        )
    rows.sort(key=lambda row: (-abs(int(row["delta"])), row["country_code"]))
    return rows[:25]


def _canonicalize_json(value: object) -> object:
    if isinstance(value, dict):
        return {
            key: _canonicalize_json(item)
            for key, item in sorted(value.items())
            if key != "generated_at"
        }
    if isinstance(value, list):
        return [_canonicalize_json(item) for item in value]
    return value


def _json_signature(payload: object) -> str:
    canonical = json.dumps(_canonicalize_json(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _world_city_summary(world_cities: gpd.GeoDataFrame) -> dict[str, object]:
    rows = world_cities.to_dict(orient="records")
    ids = [_clean(row.get("id")) for row in rows if _clean(row.get("id"))]
    stable_keys = [_clean(row.get("stable_key")) for row in rows if _clean(row.get("stable_key"))]
    country_capitals = sorted(_clean(row.get("id")) for row in rows if bool(row.get("is_country_capital")))
    admin_capitals = sorted(_clean(row.get("id")) for row in rows if bool(row.get("is_admin_capital")))
    by_country = Counter(_clean(row.get("country_code")).upper() for row in rows if _clean(row.get("country_code")))
    return {
        "row_count": len(rows),
        "id_count": len(ids),
        "stable_key_count": len(stable_keys),
        "country_capital_count": len(country_capitals),
        "admin_capital_count": len(admin_capitals),
        "ids": sorted(ids),
        "stable_keys": sorted(stable_keys),
        "country_capital_ids": country_capitals,
        "admin_capital_ids": admin_capitals,
        "top_country_counts": [
            {"country_code": code, "count": int(count)}
            for code, count in by_country.most_common(25)
        ],
    }


def _world_city_diff(left: dict[str, object], right: dict[str, object]) -> dict[str, object]:
    left_ids = set(left["ids"])
    right_ids = set(right["ids"])
    left_stable = set(left["stable_keys"])
    right_stable = set(right["stable_keys"])
    left_country_capitals = set(left["country_capital_ids"])
    right_country_capitals = set(right["country_capital_ids"])
    left_admin_capitals = set(left["admin_capital_ids"])
    right_admin_capitals = set(right["admin_capital_ids"])
    return {
        "row_count_delta": int(right["row_count"]) - int(left["row_count"]),
        "added_ids": len(right_ids - left_ids),
        "removed_ids": len(left_ids - right_ids),
        "sample_added_ids": sorted(right_ids - left_ids)[:25],
        "sample_removed_ids": sorted(left_ids - right_ids)[:25],
        "added_stable_keys": len(right_stable - left_stable),
        "removed_stable_keys": len(left_stable - right_stable),
        "country_capital_delta": len(right_country_capitals) - len(left_country_capitals),
        "country_capitals_added": sorted(right_country_capitals - left_country_capitals)[:25],
        "country_capitals_removed": sorted(left_country_capitals - right_country_capitals)[:25],
        "admin_capital_delta": len(right_admin_capitals) - len(left_admin_capitals),
        "admin_capitals_added": sorted(right_admin_capitals - left_admin_capitals)[:25],
        "admin_capitals_removed": sorted(left_admin_capitals - right_admin_capitals)[:25],
    }


def _city_alias_summary(payload: dict[str, object]) -> dict[str, object]:
    alias_to_stable_key = payload.get("alias_to_stable_key", {})
    return {
        "entry_count": int(payload.get("entry_count") or 0),
        "alias_count": int(payload.get("alias_count") or 0),
        "ambiguous_alias_count": int(payload.get("ambiguous_alias_count") or 0),
        "signature": _json_signature(payload),
        "sample_aliases": sorted(alias_to_stable_key.keys())[:25],
    }


def _city_alias_diff(left: dict[str, object], right: dict[str, object]) -> dict[str, object]:
    return {
        "entry_count_delta": int(right["entry_count"]) - int(left["entry_count"]),
        "alias_count_delta": int(right["alias_count"]) - int(left["alias_count"]),
        "ambiguous_alias_count_delta": int(right["ambiguous_alias_count"]) - int(left["ambiguous_alias_count"]),
        "signature_changed": left["signature"] != right["signature"],
    }


def _clean(value: object) -> str:
    return str(value or "").strip()


def _prepare_candidate_root(root: Path) -> None:
    shutil.rmtree(root, ignore_errors=True)
    for scenario_dir in sorted(path for path in SCENARIOS_DIR.iterdir() if path.is_dir()):
        dest_dir = root / "scenarios" / scenario_dir.name
        dest_dir.mkdir(parents=True, exist_ok=True)
        for file_name in (
            "manifest.json",
            "countries.json",
            "owners.by_feature.json",
            "controllers.by_feature.json",
        ):
            source_path = scenario_dir / file_name
            if source_path.exists():
                shutil.copy2(source_path, dest_dir / file_name)


def _load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def _scenario_asset_summary(root: Path) -> dict[str, dict[str, object]]:
    summary: dict[str, dict[str, object]] = {}
    for scenario_dir in sorted(path for path in (root / "scenarios").iterdir() if path.is_dir()):
        capital_hints_path = scenario_dir / cfg.SCENARIO_CAPITAL_HINTS_FILENAME
        city_overrides_path = scenario_dir / cfg.SCENARIO_CITY_OVERRIDES_FILENAME
        if not capital_hints_path.exists() or not city_overrides_path.exists():
            continue
        capital_hints_payload = _load_json(capital_hints_path)
        city_overrides_payload = _load_json(city_overrides_path)
        summary[scenario_dir.name] = {
            "capital_hints_signature": _json_signature(capital_hints_payload),
            "capital_hints_entry_count": int(capital_hints_payload.get("entry_count") or 0),
            "capital_hints_missing_tag_count": int(capital_hints_payload.get("missing_tag_count") or 0),
            "capital_hints_rejected_candidate_count": int((capital_hints_payload.get("audit") or {}).get("rejected_candidate_count") or 0),
            "city_override_signature": _json_signature(city_overrides_payload),
            "city_override_count": int(((city_overrides_payload.get("cities") or {})).__len__()),
            "city_override_unresolved_capital_count": int((city_overrides_payload.get("audit") or {}).get("unresolved_capital_count") or 0),
            "city_override_unresolved_rename_count": int((city_overrides_payload.get("audit") or {}).get("unresolved_city_rename_count") or 0),
        }
    return summary


def _scenario_asset_diff(left: dict[str, dict[str, object]], right: dict[str, dict[str, object]]) -> dict[str, object]:
    scenario_ids = sorted(set(left).union(right))
    changed: list[dict[str, object]] = []
    for scenario_id in scenario_ids:
        left_entry = left.get(scenario_id, {})
        right_entry = right.get(scenario_id, {})
        deltas = {
            "capital_hints_entry_count_delta": int(right_entry.get("capital_hints_entry_count", 0)) - int(left_entry.get("capital_hints_entry_count", 0)),
            "capital_hints_missing_tag_count_delta": int(right_entry.get("capital_hints_missing_tag_count", 0)) - int(left_entry.get("capital_hints_missing_tag_count", 0)),
            "capital_hints_rejected_candidate_count_delta": int(right_entry.get("capital_hints_rejected_candidate_count", 0)) - int(left_entry.get("capital_hints_rejected_candidate_count", 0)),
            "city_override_count_delta": int(right_entry.get("city_override_count", 0)) - int(left_entry.get("city_override_count", 0)),
            "city_override_unresolved_capital_count_delta": int(right_entry.get("city_override_unresolved_capital_count", 0)) - int(left_entry.get("city_override_unresolved_capital_count", 0)),
            "city_override_unresolved_rename_count_delta": int(right_entry.get("city_override_unresolved_rename_count", 0)) - int(left_entry.get("city_override_unresolved_rename_count", 0)),
        }
        signature_changed = (
            left_entry.get("capital_hints_signature") != right_entry.get("capital_hints_signature")
            or left_entry.get("city_override_signature") != right_entry.get("city_override_signature")
        )
        if signature_changed or any(value != 0 for value in deltas.values()):
            changed.append({"scenario_id": scenario_id, "signature_changed": signature_changed, **deltas})
    return {
        "changed_scenario_count": len(changed),
        "changed_scenarios": changed,
    }


def _world_city_diff_has_changes(diff: dict[str, object]) -> bool:
    keys = (
        "row_count_delta",
        "added_ids",
        "removed_ids",
        "added_stable_keys",
        "removed_stable_keys",
        "country_capital_delta",
        "admin_capital_delta",
    )
    return any(int(diff.get(key, 0)) != 0 for key in keys)


def _city_alias_diff_has_changes(diff: dict[str, object]) -> bool:
    keys = ("entry_count_delta", "alias_count_delta", "ambiguous_alias_count_delta")
    return bool(diff.get("signature_changed")) or any(int(diff.get(key, 0)) != 0 for key in keys)


def _tracked_scenario_summary() -> dict[str, dict[str, object]]:
    root = RUNTIME_TMP_DIR / "tracked_snapshot"
    _prepare_candidate_root(root)
    for scenario_dir in sorted(path for path in SCENARIOS_DIR.iterdir() if path.is_dir()):
        for file_name in (cfg.SCENARIO_CAPITAL_HINTS_FILENAME, cfg.SCENARIO_CITY_OVERRIDES_FILENAME):
            source_path = scenario_dir / file_name
            if source_path.exists():
                shutil.copy2(source_path, root / "scenarios" / scenario_dir.name / file_name)
    return _scenario_asset_summary(root)


def _build_candidate_artifacts(label: str, geonames_path: Path) -> dict[str, object]:
    geonames_frame = load_geonames_frame(geonames_path)
    merged_dataset = build_merged_world_city_dataset(geonames_frame=geonames_frame)
    political = gpd.read_file(POLITICAL_PATH)
    urban = assign_stable_urban_area_ids(load_urban())
    world_cities = build_world_cities(
        political=political,
        urban=urban,
        merged_city_dataset=merged_dataset,
    )
    city_aliases = build_city_aliases_payload(world_cities)

    candidate_root = RUNTIME_TMP_DIR / f"{label}_candidate_root"
    _prepare_candidate_root(candidate_root)
    emit_default_scenario_city_assets(candidate_root, world_cities)

    candidate_dir = RUNTIME_TMP_DIR / label
    candidate_dir.mkdir(parents=True, exist_ok=True)
    (candidate_dir / "world_cities.geojson").write_text(world_cities.to_json(drop_id=True), encoding="utf-8")
    write_json_atomic(candidate_dir / "city_aliases.json", city_aliases, ensure_ascii=False, indent=2, trailing_newline=True)

    return {
        "geonames_frame": geonames_frame,
        "world_cities": world_cities,
        "world_cities_summary": _world_city_summary(world_cities),
        "city_aliases": city_aliases,
        "city_aliases_summary": _city_alias_summary(city_aliases),
        "scenario_summary": _scenario_asset_summary(candidate_root),
    }


def main() -> None:
    if not LOCAL_GEONAMES_PATH.exists():
        raise SystemExit(f"Missing local GeoNames zip: {LOCAL_GEONAMES_PATH}")
    if not POLITICAL_PATH.exists():
        raise SystemExit(f"Missing political reference layer: {POLITICAL_PATH}")
    if not TRACKED_WORLD_CITIES_PATH.exists():
        raise SystemExit(f"Missing tracked world_cities output: {TRACKED_WORLD_CITIES_PATH}")
    if not TRACKED_CITY_ALIASES_PATH.exists():
        raise SystemExit(f"Missing tracked city_aliases output: {TRACKED_CITY_ALIASES_PATH}")

    RUNTIME_TMP_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    _download_remote_geonames()

    local_frame = load_geonames_frame(LOCAL_GEONAMES_PATH)
    remote_frame = load_geonames_frame(REMOTE_GEONAMES_PATH)
    local_kept = _normalize_source_frame(local_frame)
    remote_kept = _normalize_source_frame(remote_frame)

    local_candidate = _build_candidate_artifacts("local", LOCAL_GEONAMES_PATH)
    remote_candidate = _build_candidate_artifacts("remote", REMOTE_GEONAMES_PATH)

    tracked_world_cities = gpd.read_file(TRACKED_WORLD_CITIES_PATH)
    tracked_city_aliases = _load_json(TRACKED_CITY_ALIASES_PATH)
    tracked_world_cities_summary = _world_city_summary(tracked_world_cities)
    tracked_city_aliases_summary = _city_alias_summary(tracked_city_aliases)
    tracked_scenario_summary = _tracked_scenario_summary()

    local_ids = set(local_kept["geonameid"])
    remote_ids = set(remote_kept["geonameid"])
    report = {
        "source_hashes": {
            "local_zip_sha256": _sha256_path(LOCAL_GEONAMES_PATH),
            "remote_zip_sha256": _sha256_path(REMOTE_GEONAMES_PATH),
            "local_zip_size_bytes": int(LOCAL_GEONAMES_PATH.stat().st_size),
            "remote_zip_size_bytes": int(REMOTE_GEONAMES_PATH.stat().st_size),
        },
        "raw_source_summary": {
            "local_rows": int(len(local_frame)),
            "remote_rows": int(len(remote_frame)),
            "local_kept_rows": int(len(local_kept)),
            "remote_kept_rows": int(len(remote_kept)),
            "added_kept_geonameids": len(remote_ids - local_ids),
            "removed_kept_geonameids": len(local_ids - remote_ids),
            "sample_added_geonameids": sorted(remote_ids - local_ids)[:25],
            "sample_removed_geonameids": sorted(local_ids - remote_ids)[:25],
            "top_country_deltas": _top_country_deltas(local_kept, remote_kept),
            "field_changes": _field_changes(local_kept, remote_kept),
        },
        "baseline_fidelity": {
            "local_candidate_vs_tracked_world_cities": _world_city_diff(
                tracked_world_cities_summary,
                local_candidate["world_cities_summary"],
            ),
            "local_candidate_vs_tracked_city_aliases": _city_alias_diff(
                tracked_city_aliases_summary,
                local_candidate["city_aliases_summary"],
            ),
            "local_candidate_vs_tracked_scenario_assets": _scenario_asset_diff(
                tracked_scenario_summary,
                local_candidate["scenario_summary"],
            ),
        },
        "upgrade_impact": {
            "remote_vs_local_world_cities": _world_city_diff(
                local_candidate["world_cities_summary"],
                remote_candidate["world_cities_summary"],
            ),
            "remote_vs_local_city_aliases": _city_alias_diff(
                local_candidate["city_aliases_summary"],
                remote_candidate["city_aliases_summary"],
            ),
            "remote_vs_local_scenario_assets": _scenario_asset_diff(
                local_candidate["scenario_summary"],
                remote_candidate["scenario_summary"],
            ),
        },
    }

    baseline_world_diff = report["baseline_fidelity"]["local_candidate_vs_tracked_world_cities"]
    baseline_alias_diff = report["baseline_fidelity"]["local_candidate_vs_tracked_city_aliases"]
    baseline_scenario_diff = report["baseline_fidelity"]["local_candidate_vs_tracked_scenario_assets"]

    can_promote = True
    blocking_reasons: list[str] = []
    if _world_city_diff_has_changes(baseline_world_diff):
        can_promote = False
        blocking_reasons.append("local_candidate_world_cities_do_not_match_tracked_output")
    if _city_alias_diff_has_changes(baseline_alias_diff):
        can_promote = False
        blocking_reasons.append("local_candidate_city_aliases_do_not_match_tracked_output")
    if int(baseline_scenario_diff.get("changed_scenario_count", 0)) != 0:
        can_promote = False
        blocking_reasons.append("local_candidate_scenario_city_assets_do_not_match_tracked_outputs")

    report["promotion_assessment"] = {
        "can_promote": can_promote,
        "blocking_reasons": blocking_reasons,
        "recommended_next_step": (
            "stop_at_audit_and_reconcile_local_baseline_before_any_geonames_promotion"
            if not can_promote
            else "promotion_can_be_reviewed_after_human_diff_review"
        ),
    }

    write_json_atomic(REPORT_PATH, report, ensure_ascii=False, indent=2, trailing_newline=True)
    print(f"[geonames-audit] Report written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
