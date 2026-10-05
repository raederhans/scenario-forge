"""Apply reviewed city rules and validate placements against current boundaries.

Only existing scenario city artifacts and their integrity metadata are updated;
the command does not modify countries, ownership or topology.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.io.writers import write_json_atomic
from map_builder.scenario_capital_rules import REVIEWED_CAPITALS, apply_reviewed_capitals
from map_builder.scenario_capital_placement import place_capital_markers, read_political_features
from map_builder.scenario_city_overrides_composer import extract_city_assets_payload
from tools.check_scenario_contracts import _build_snapshot_for_scenario, _refresh_audit_payload


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_if_changed(path, payload):
    if path.exists() and read(path) == payload:
        return
    write_json_atomic(path, payload, ensure_ascii=False, indent=2)
    sidecar = Path(str(path) + ".gz")
    if sidecar.exists():
        sidecar.write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def repair_scenario(scenario_id, city_rows, *, geometry_cache=None, dry_run=False):
    directory = ROOT / "data/scenarios" / scenario_id
    countries = read(directory / "countries.json")["countries"]
    owners = read(directory / "owners.by_feature.json")["owners"]
    original = read(directory / "city_overrides.json")
    payload = apply_reviewed_capitals(original, countries, city_rows, scenario_id=scenario_id, strict=True)
    mutations_path = directory / "scenario_mutations.json"
    if mutations_path.exists():
        # Restore explicit edits before validation, so the checked point is the
        # point that will actually be written.
        for tag in read(mutations_path).get("capitals", {}):
            for key in ("capitals_by_tag", "capital_city_hints"):
                if tag in original.get(key, {}):
                    payload[key][tag] = copy.deepcopy(original[key][tag])
    # Repair legacy explicit/hint disagreements before placing the markers.
    for tag, city_id in payload["capitals_by_tag"].items():
        hint = payload["capital_city_hints"].get(tag, {})
        if hint.get("city_id") == city_id:
            continue
        row = city_rows[city_id]
        payload["capital_city_hints"][tag] = {
            **hint, "tag": tag, "city_id": city_id, "stable_key": f"id::{city_id}",
            "city_name": row.get("name_en", row.get("name")),
            **{key: row.get(key) for key in ("lon", "lat", "host_feature_id", "population", "base_tier", "country_code")},
        }
    conflicts = []
    if owners:
        cache_path = geometry_cache / f"{scenario_id}-capital-geometries.json" if geometry_cache else None
        if cache_path and cache_path.exists():
            # Developer cache is optional and only for read-only diagnosis.
            if not dry_run:
                raise ValueError("Geometry cache is permitted only with --dry-run")
            features = read(cache_path)["features"]
        else:
            features = read_political_features(directory / "runtime_topology.topo.json")
        conflicts = place_capital_markers(payload, countries, owners, features)
    payload.setdefault("audit", {})["capital_territory_conflicts"] = conflicts
    changed = [tag for tag in countries if (
        payload["capitals_by_tag"].get(tag) != original.get("capitals_by_tag", {}).get(tag)
        or payload["capital_city_hints"].get(tag) != original.get("capital_city_hints", {}).get(tag)
    )]
    summary = {"scenario_id": scenario_id, "changed_count": len(changed), "changed_tags": changed, "conflicts": conflicts}
    if dry_run:
        return summary
    if conflicts:
        raise ValueError(json.dumps(summary, ensure_ascii=False))
    write_if_changed(directory / "city_overrides.json", payload)
    partial = directory / "city_assets.partial.json"
    if partial.exists():
        write_if_changed(partial, extract_city_assets_payload(payload, scenario_id=scenario_id))
    defaults_path = directory / "capital_defaults.partial.json"
    if defaults_path.exists():
        defaults = read(defaults_path)
        original_defaults = copy.deepcopy(defaults)
        for key in ("capitals_by_tag", "capital_city_hints"):
            defaults[key] = copy.deepcopy(payload[key])
            if mutations_path.exists():
                for tag in read(mutations_path).get("capitals", {}):
                    if tag in original_defaults.get(key, {}):
                        defaults[key][tag] = original_defaults[key][tag]
                    else:
                        defaults[key].pop(tag, None)
        for key in list(defaults.get("audit", {})):
            if key in payload["audit"]:
                defaults["audit"][key] = copy.deepcopy(payload["audit"][key])
        defaults.setdefault("audit", {})["default_capital_entry_count"] = len(defaults["capitals_by_tag"])
        write_if_changed(defaults_path, defaults)
    hints_path = directory / "capital_hints.json"
    if hints_path.exists():
        hints = read(hints_path)
        by_tag = {e["tag"]: e for e in hints.get("entries", [])}
        by_tag.update(copy.deepcopy(payload["capital_city_hints"]))
        hints["entries"] = [by_tag[tag] for tag in sorted(by_tag)]
        hints["entry_count"] = len(hints["entries"])
        hints["missing_tags"] = [tag for tag in hints.get("missing_tags", []) if tag not in by_tag]
        hints["missing_tag_count"] = len(hints["missing_tags"])
        write_if_changed(hints_path, hints)
    manifest = read(directory / "manifest.json")
    snapshot = _build_snapshot_for_scenario(directory, manifest)
    manifest["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
    write_if_changed(directory / "manifest.json", manifest)
    _refresh_audit_payload(directory, manifest, snapshot_payload=snapshot)
    for name in ("build_snapshot.json", "audit.json"):
        path = directory / name
        sidecar = Path(str(path) + ".gz")
        if sidecar.exists():
            sidecar.write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario-id", choices=sorted(REVIEWED_CAPITALS), action="append")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--geometry-cache", type=Path, help="Read-only audit cache directory; requires --dry-run")
    args = parser.parse_args()
    city_rows = {f["properties"]["id"]: f["properties"] for f in read(ROOT / "data/world_cities.geojson")["features"]}
    for scenario_id in args.scenario_id or REVIEWED_CAPITALS:
        print(json.dumps(repair_scenario(scenario_id, city_rows, geometry_cache=args.geometry_cache, dry_run=args.dry_run),
                         ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
