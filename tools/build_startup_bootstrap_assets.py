from __future__ import annotations

import argparse
import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic


BOOTSTRAP_RUNTIME_OBJECTS = (
    "political",
    "scenario_water",
    "land_mask",
    "context_land_mask",
)
STARTUP_BASE_OBJECTS = (
    "political",
    "water_regions",
    "ocean",
    "land",
    "special_zones",
)


def _write_minified_json(path: Path, payload: object) -> None:
    write_json_atomic(
        path,
        payload,
        ensure_ascii=False,
        indent=None,
        separators=(",", ":"),
    )


def _normalize_key(value: object) -> str:
    return str(value or "").strip()


def _collect_arc_indexes(value: object, bucket: set[int]) -> None:
    if isinstance(value, int):
        bucket.add(value if value >= 0 else ~value)
        return
    if isinstance(value, list):
        for item in value:
            _collect_arc_indexes(item, bucket)
        return
    if isinstance(value, dict):
        arcs = value.get("arcs")
        if arcs is not None:
            _collect_arc_indexes(arcs, bucket)
        geometries = value.get("geometries")
        if isinstance(geometries, list):
            for item in geometries:
                _collect_arc_indexes(item, bucket)


def _remap_arc_indexes(value: object, mapping: dict[int, int]) -> object:
    if isinstance(value, int):
        return mapping[value] if value >= 0 else ~mapping[~value]
    if isinstance(value, list):
        return [_remap_arc_indexes(item, mapping) for item in value]
    if isinstance(value, dict):
        remapped = {}
        for key, item in value.items():
            if key == "arcs":
                remapped[key] = _remap_arc_indexes(item, mapping)
            elif key == "geometries" and isinstance(item, list):
                remapped[key] = [_remap_arc_indexes(entry, mapping) for entry in item]
            else:
                remapped[key] = item
        return remapped
    return value


def build_bootstrap_runtime_topology(full_topology: dict) -> dict:
    selected_objects = {}
    for object_name in BOOTSTRAP_RUNTIME_OBJECTS:
        raw_object = full_topology.get("objects", {}).get(object_name)
        if not isinstance(raw_object, dict):
            continue
        selected_object = copy.deepcopy(raw_object)
        if object_name == "political":
            selected_object.pop("computed_neighbors", None)
        selected_objects[object_name] = selected_object

    used_arc_indexes: set[int] = set()
    for payload in selected_objects.values():
        _collect_arc_indexes(payload, used_arc_indexes)

    ordered_arc_indexes = sorted(used_arc_indexes)
    arc_mapping = {original_index: new_index for new_index, original_index in enumerate(ordered_arc_indexes)}
    remapped_objects = {
      object_name: _remap_arc_indexes(payload, arc_mapping)
      for object_name, payload in selected_objects.items()
    }

    bootstrap_topology = {
        "type": "Topology",
        "objects": remapped_objects,
        "arcs": [full_topology.get("arcs", [])[index] for index in ordered_arc_indexes],
    }
    if "transform" in full_topology:
        bootstrap_topology["transform"] = copy.deepcopy(full_topology["transform"])
    if "bbox" in full_topology:
        bootstrap_topology["bbox"] = copy.deepcopy(full_topology["bbox"])
    return bootstrap_topology


def _collect_geometry_locale_candidates(topology: dict, object_names: tuple[str, ...]) -> set[str]:
    keys: set[str] = set()
    for object_name in object_names:
        geometry_collection = topology.get("objects", {}).get(object_name, {})
        geometries = geometry_collection.get("geometries", []) if isinstance(geometry_collection, dict) else []
        for geometry in geometries:
            if not isinstance(geometry, dict):
                continue
            properties = geometry.get("properties", {}) if isinstance(geometry.get("properties"), dict) else {}
            identity_candidates = (
                geometry.get("id"),
                properties.get("id"),
                properties.get("stable_key"),
            )
            for candidate in identity_candidates:
                normalized = _normalize_key(candidate)
                if not normalized:
                    continue
                keys.add(normalized)
                if not normalized.startswith("id::"):
                    keys.add(f"id::{normalized}")
            for candidate in (
                properties.get("name"),
                properties.get("label"),
                properties.get("name_en"),
                properties.get("label_en"),
                properties.get("name_zh"),
                properties.get("label_zh"),
            ):
                normalized = _normalize_key(candidate)
                if normalized:
                    keys.add(normalized)
    return keys


def build_startup_locales_payload(
    full_locales: dict,
    base_topology: dict,
    runtime_bootstrap_topology: dict,
    scenario_geo_patch: dict,
) -> dict:
    required_geo_keys = _collect_geometry_locale_candidates(base_topology, STARTUP_BASE_OBJECTS)
    required_geo_keys.update(_collect_geometry_locale_candidates(runtime_bootstrap_topology, BOOTSTRAP_RUNTIME_OBJECTS))
    required_geo_keys.update(
        _normalize_key(feature_id)
        for feature_id in (scenario_geo_patch.get("geo", {}) if isinstance(scenario_geo_patch, dict) else {}).keys()
        if _normalize_key(feature_id)
    )
    full_geo = full_locales.get("geo", {}) if isinstance(full_locales, dict) else {}
    startup_geo = {
        key: value
        for key, value in full_geo.items()
        if _normalize_key(key) in required_geo_keys
    }
    return {
      "ui": copy.deepcopy(full_locales.get("ui", {}) if isinstance(full_locales, dict) else {}),
      "geo": startup_geo,
    }


def build_startup_geo_aliases_payload(full_geo_aliases: dict, startup_locales: dict) -> dict:
    required_geo_keys = {
        _normalize_key(key)
        for key in (startup_locales.get("geo", {}) if isinstance(startup_locales, dict) else {}).keys()
        if _normalize_key(key)
    }
    alias_map = full_geo_aliases.get("alias_to_stable_key", {}) if isinstance(full_geo_aliases, dict) else {}
    startup_alias_map = {}
    for alias, stable_key in alias_map.items():
        normalized_alias = _normalize_key(alias)
        normalized_stable_key = _normalize_key(stable_key)
        if not normalized_alias or not normalized_stable_key:
            continue
        if normalized_stable_key.startswith("city::") or normalized_alias.startswith("city::"):
            continue
        if normalized_stable_key not in required_geo_keys:
            continue
        startup_alias_map[normalized_alias] = normalized_stable_key
    return {
      "alias_to_stable_key": startup_alias_map,
    }


def build_startup_bootstrap_assets(
    *,
    base_topology_path: Path,
    full_locales_path: Path,
    full_geo_aliases_path: Path,
    full_runtime_topology_path: Path,
    scenario_geo_patch_path: Path,
    runtime_bootstrap_output_path: Path,
    startup_locales_output_path: Path,
    startup_geo_aliases_output_path: Path,
) -> dict[str, object]:
    base_topology = read_json_strict(base_topology_path)
    full_locales = read_json_strict(full_locales_path)
    full_geo_aliases = read_json_strict(full_geo_aliases_path)
    full_runtime_topology = read_json_strict(full_runtime_topology_path)
    scenario_geo_patch = read_json_strict(scenario_geo_patch_path)

    runtime_bootstrap_topology = build_bootstrap_runtime_topology(full_runtime_topology)
    startup_locales = build_startup_locales_payload(
        full_locales,
        base_topology,
        runtime_bootstrap_topology,
        scenario_geo_patch,
    )
    startup_geo_aliases = build_startup_geo_aliases_payload(full_geo_aliases, startup_locales)

    _write_minified_json(runtime_bootstrap_output_path, runtime_bootstrap_topology)
    _write_minified_json(startup_locales_output_path, startup_locales)
    _write_minified_json(startup_geo_aliases_output_path, startup_geo_aliases)

    return {
      "runtime_bootstrap_topology_path": str(runtime_bootstrap_output_path),
      "startup_locales_path": str(startup_locales_output_path),
      "startup_geo_aliases_path": str(startup_geo_aliases_output_path),
      "startup_geo_entry_count": len(startup_locales.get("geo", {})),
      "startup_alias_count": len(startup_geo_aliases.get("alias_to_stable_key", {})),
      "runtime_bootstrap_object_count": len(runtime_bootstrap_topology.get("objects", {})),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build startup bootstrap topology and startup-core locale assets.")
    parser.add_argument("--base-topology", default=str(ROOT / "data/europe_topology.na_v2.json"))
    parser.add_argument("--full-locales", default=str(ROOT / "data/locales.json"))
    parser.add_argument("--full-geo-aliases", default=str(ROOT / "data/geo_aliases.json"))
    parser.add_argument("--runtime-topology", default=str(ROOT / "data/scenarios/tno_1962/runtime_topology.topo.json"))
    parser.add_argument("--scenario-geo-patch", default=str(ROOT / "data/scenarios/tno_1962/geo_locale_patch.json"))
    parser.add_argument("--runtime-bootstrap-output", default=str(ROOT / "data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json"))
    parser.add_argument("--startup-locales-output", default=str(ROOT / "data/locales.startup.json"))
    parser.add_argument("--startup-geo-aliases-output", default=str(ROOT / "data/geo_aliases.startup.json"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = build_startup_bootstrap_assets(
        base_topology_path=Path(args.base_topology).resolve(),
        full_locales_path=Path(args.full_locales).resolve(),
        full_geo_aliases_path=Path(args.full_geo_aliases).resolve(),
        full_runtime_topology_path=Path(args.runtime_topology).resolve(),
        scenario_geo_patch_path=Path(args.scenario_geo_patch).resolve(),
        runtime_bootstrap_output_path=Path(args.runtime_bootstrap_output).resolve(),
        startup_locales_output_path=Path(args.startup_locales_output).resolve(),
        startup_geo_aliases_output_path=Path(args.startup_geo_aliases_output).resolve(),
    )
    print(result)


if __name__ == "__main__":
    main()
