"""Read-only planning for regional political topology rebuilds."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable

from shapely.geometry import shape
from topojson.utils import serialize_as_geojson

ROOT = Path(__file__).resolve().parents[1]


def _features(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("type") == "Topology":
        obj = payload.get("objects", {}).get("political")
        if obj is None:
            raise ValueError(f"Topology has no political object: {path}")
        payload = serialize_as_geojson(payload, objectname="political")
    features = payload.get("features") if isinstance(payload, dict) else None
    if not isinstance(features, list):
        raise ValueError(f"Expected political FeatureCollection or Topology: {path}")
    if any(not isinstance(f, dict) for f in features):
        raise ValueError(f"Malformed political feature: {path}")
    return features


def _index(features: list[dict[str, Any]], label: str) -> dict[str, dict[str, Any]]:
    result = {}
    for feature in features:
        fid = _fid(feature)
        if not fid:
            raise ValueError(f"{label} contains a feature without id")
        if fid in result:
            raise ValueError(f"{label} contains duplicate feature id: {fid}")
        try:
            geometry = shape(feature.get("geometry"))
            if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in {"Polygon", "MultiPolygon"}:
                raise ValueError(f"{label} contains invalid geometry: {fid}")
        except (AttributeError, TypeError):
            raise ValueError(f"{label} contains invalid geometry: {fid}") from None
        result[fid] = feature
    return result


def _fid(feature: dict[str, Any]) -> str:
    props = feature.get("properties") or {}
    return str(props.get("id") or feature.get("id") or "").strip()


def _country(feature: dict[str, Any]) -> str:
    props = feature.get("properties") or {}
    for value in (props.get("cntr_code"), props.get("country_code"), props.get("iso_a2")):
        value = str(value or "").strip().upper()
        if value:
            return value
    fid = _fid(feature)
    prefix = fid.split("_", 1)[0].upper() if "_" in fid else ""
    return prefix if re.fullmatch(r"[A-Z]{2}", prefix) else ""


def _geometry_key(feature: dict[str, Any]) -> str:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return ""
    try:
        return shape(geometry).normalize().wkb_hex
    except Exception:
        return json.dumps(geometry, sort_keys=True, separators=(",", ":"))


def _selected_ids(features: Iterable[dict[str, Any]], countries: set[str], ids: set[str]) -> set[str]:
    return {
        _fid(feature)
        for feature in features
        if _fid(feature) and ((_fid(feature) in ids) or (_country(feature) in countries))
    }


def _owners(scenario_dir: Path | None) -> dict[str, str]:
    if not scenario_dir:
        return {}
    path = Path(scenario_dir) / "owners.by_feature.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    owners = payload.get("owners") if isinstance(payload, dict) else {}
    return {str(k): str(v) for k, v in owners.items()} if isinstance(owners, dict) else {}


def _chunk_path(scenario_dir: Path, url: str) -> Path:
    normalized = url.replace("\\", "/")
    prefix = "data/scenarios/"
    if normalized.startswith(prefix):
        parts = normalized[len(prefix):].split("/", 1)
        if len(parts) != 2:
            raise ValueError(f"Invalid scenario chunk URL: {url}")
        normalized = parts[1]
    base = scenario_dir.resolve()
    path = (base / normalized).resolve()
    if not path.is_relative_to(base):
        raise ValueError(f"Chunk URL escapes scenario directory: {url}")
    return path


def _affected_chunks(scenario_dir: Path, changed: set[str]) -> list[str]:
    manifest_path = scenario_dir / "detail_chunks.manifest.json"
    if not manifest_path.exists():
        return []
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    result: set[str] = set()
    for chunk in manifest.get("chunks", []):
        if chunk.get("layer") != "political":
            continue
        ids = set()
        bounds = chunk.get("feature_bounds")
        if isinstance(bounds, list):
            ids = {str(entry.get("id")) for entry in bounds if isinstance(entry, dict) and entry.get("id")}
        if ids & changed:
            result.add(str(chunk.get("id")))
            continue
        url = str(chunk.get("url") or "")
        path = _chunk_path(scenario_dir, url)
        if path.exists():
            try:
                ids = {_fid(f) for f in json.loads(path.read_text(encoding="utf-8")).get("features", [])}
            except (OSError, ValueError, TypeError):
                ids = set()
            if ids & changed:
                result.add(str(chunk.get("id")))
    return sorted(result)


def plan_regional_rebuild(
    *, baseline_topology: Path | str, candidate_topology: Path | str | None = None,
    source_countries: Iterable[str] = (), feature_ids: Iterable[str] = (),
    scenario_dirs: Iterable[Path | str] = (),
) -> dict[str, Any]:
    scenario_dirs = list(scenario_dirs)
    old = _index(_features(Path(baseline_topology)), "baseline topology")
    preview = candidate_topology is None
    new = old if preview else _index(_features(Path(candidate_topology)), "candidate topology")
    countries = {str(x).strip().upper() for x in source_countries if str(x).strip()}
    if any(not re.fullmatch(r"[A-Z]{2}", value) for value in countries):
        raise ValueError("source_countries must contain ISO-3166 alpha-2 codes")
    from map_builder.regional_processors import get_supported_country_codes, resolve_processor_units
    requested_countries = set(countries)
    for unit in resolve_processor_units(countries & get_supported_country_codes()):
        countries.update(unit["countries"])
    ids = {str(x).strip() for x in feature_ids if str(x).strip()}
    if not countries and not ids:
        raise ValueError("at least one source country or feature id selector is required")
    selected = _selected_ids(list(old.values()) + list(new.values()), countries, ids)
    common = set(old) & set(new)
    changed_all = {fid for fid in common if _geometry_key(old[fid]) != _geometry_key(new[fid])}
    metadata_changed = {fid for fid in common if old[fid].get("properties", {}) != new[fid].get("properties", {})}
    added = set(new) - set(old)
    removed = set(old) - set(new)
    changed = changed_all & selected
    blocked = []
    if added or removed:
        blocked.append({"reason": "split_merge_or_id_set_change", "added_ids": sorted(added), "removed_ids": sorted(removed)})
    if ids - (set(old) | set(new)):
        blocked.append({"reason": "unknown_feature_ids", "ids": sorted(ids - (set(old) | set(new)))})
    impact_ids = selected if preview else changed
    scenarios = []
    for raw_dir in scenario_dirs:
        directory = Path(raw_dir)
        owners = _owners(directory)
        chunk_blockers = []
        manifest_path = directory / "detail_chunks.manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for chunk in manifest.get("chunks", []):
                url = str(chunk.get("url") or "")
                chunk_path = _chunk_path(directory, url)
                if not chunk_path.exists():
                    chunk_blockers.append({"chunk": chunk.get("id"), "reason": "chunk_missing_or_unreadable"})
        scenarios.append({
            "scenario_dir": str(directory),
            "old_owners": {fid: owners[fid] for fid in sorted(impact_ids) if fid in owners},
            "new_owners": {fid: owners[fid] for fid in sorted(impact_ids) if fid in owners},
            "owner_change_supported": False,
            "owner_change_blocked": "candidate owners input is not supported; current scenario owners are reported for review",
            "directly_affected_chunks": _affected_chunks(directory, impact_ids),
            "blocked_reasons": chunk_blockers,
            "adjacency_water_land_checks": [{"reason": "political geometry changes require shared-boundary and water/land mask review", "status": "required"}],
        })
    return {
        "source_selection": {"requested_countries": sorted(requested_countries), "countries": sorted(countries), "feature_ids": sorted(ids), "selected_ids": sorted(selected)},
        "changed_ids": sorted(changed),
        "changed_ids_all_sources": sorted(changed_all),
        "non_target_changed_ids": sorted(changed_all - selected),
        "non_target_changed": bool(changed_all - selected),
        "metadata_changed_ids": sorted(metadata_changed),
        "blocked_reasons": blocked + ([{"reason": "metadata_changed_same_id", "ids": sorted(metadata_changed)}] if metadata_changed else []),
        "apply_eligible": bool(changed) and not blocked and not metadata_changed and not (changed_all - selected) and not preview and not list(scenario_dirs),
        "master_only_eligible": bool(changed) and not blocked and not metadata_changed and not (changed_all - selected) and not preview,
        "scenario_rebuild_required": bool(list(scenario_dirs)),
        "preview": preview,
        "scenarios": scenarios,
        "adjacency_water_land_checks": [{"reason": "shared boundaries and water/land masks cannot be skipped", "status": "required"}],
    }
