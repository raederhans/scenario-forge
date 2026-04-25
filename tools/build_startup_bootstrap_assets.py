from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.contracts import (
    SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
)


BOOTSTRAP_RUNTIME_OBJECTS = (
    "land_mask",
    "context_land_mask",
    "scenario_water",
    "scenario_special_land",
)
STARTUP_BASE_OBJECTS = (
    "political",
    "water_regions",
    "ocean",
    "land",
    "special_zones",
)
STARTUP_SUPPORT_CONSUMER_MATRIX = {
    "startup_locales": {
        "default_startup": [
            "js/main.js",
            "js/core/data_loader.js",
        ],
        "scenario_apply": [],
    },
    "startup_geo_aliases": {
        "default_startup": [
            "js/main.js",
            "js/core/data_loader.js",
        ],
        "scenario_apply": [],
    },
    "geo_locale_patch": {
        "default_startup": [],
        "scenario_apply": [
            "js/core/scenario_resources.js",
            "js/core/scenario_manager.js",
        ],
    },
}


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


def _json_size_bytes(payload: object) -> int:
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _normalize_string_set(values: object) -> set[str]:
    if not isinstance(values, list):
        return set()
    return {
        _normalize_key(value)
        for value in values
        if _normalize_key(value)
    }


def load_startup_support_whitelist(path: Path | None) -> dict[str, object] | None:
    if path is None:
        return None
    resolved = Path(path).resolve()
    if not resolved.exists():
        return None
    payload = read_json_strict(resolved)
    if not isinstance(payload, dict):
        raise TypeError(f"startup support whitelist must be a JSON object: {resolved}")
    return payload


def resolve_startup_support_whitelist_path(
    startup_locales_output_path: Path,
    startup_support_whitelist_path: Path | None = None,
) -> Path | None:
    if startup_support_whitelist_path is not None:
        resolved = Path(startup_support_whitelist_path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Explicit startup support whitelist does not exist: {resolved}")
        return resolved
    scenario_dir = Path(startup_locales_output_path).resolve().parent
    inferred = scenario_dir / "derived" / "startup_support_whitelist.json"
    return inferred if inferred.exists() else None


def build_bootstrap_runtime_topology(full_topology: dict) -> dict:
    selected_objects = {}
    for object_name in BOOTSTRAP_RUNTIME_OBJECTS:
        # Startup shell only needs object presence; empty collections keep scenarios
        # without water/special overlays on the same chunked-coarse contract.
        selected_objects[object_name] = {
            "type": "GeometryCollection",
            "geometries": [],
        }

    bootstrap_topology = {
        "type": "Topology",
        "objects": selected_objects,
        "arcs": [],
    }
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


def collect_startup_required_geo_keys(
    base_topology: dict,
    runtime_bootstrap_topology: dict,
    scenario_geo_patch: dict,
) -> dict[str, set[str]]:
    base_keys = _collect_geometry_locale_candidates(base_topology, STARTUP_BASE_OBJECTS)
    runtime_keys = _collect_geometry_locale_candidates(runtime_bootstrap_topology, BOOTSTRAP_RUNTIME_OBJECTS)
    patch_geo = scenario_geo_patch.get("geo", {}) if isinstance(scenario_geo_patch, dict) else {}
    patch_keys = {
        _normalize_key(feature_id)
        for feature_id in patch_geo.keys()
        if _normalize_key(feature_id)
    }
    return {
        "base_topology": base_keys,
        "runtime_bootstrap": runtime_keys,
        "geo_locale_patch": patch_keys,
        "combined": set().union(base_keys, runtime_keys, patch_keys),
    }


def build_startup_locales_payload(
    full_locales: dict,
    base_topology: dict,
    runtime_bootstrap_topology: dict,
    scenario_geo_patch: dict,
    startup_support_whitelist: dict | None = None,
) -> dict:
    required_geo_keys = collect_startup_required_geo_keys(
        base_topology,
        runtime_bootstrap_topology,
        scenario_geo_patch,
    )["combined"]
    required_geo_keys.update(_normalize_string_set((startup_support_whitelist or {}).get("locale_keys")))
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


def build_startup_geo_aliases_payload(
    full_geo_aliases: dict,
    startup_locales: dict,
    startup_support_whitelist: dict | None = None,
) -> dict:
    required_geo_keys = {
        _normalize_key(key)
        for key in (startup_locales.get("geo", {}) if isinstance(startup_locales, dict) else {}).keys()
        if _normalize_key(key)
    }
    explicit_alias_keys = _normalize_string_set((startup_support_whitelist or {}).get("alias_keys"))
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
        if explicit_alias_keys and normalized_alias not in explicit_alias_keys:
            continue
        startup_alias_map[normalized_alias] = normalized_stable_key
    return {
      "alias_to_stable_key": startup_alias_map,
    }


def build_startup_support_assets_report(
    *,
    scenario_id: str,
    base_topology_path: Path,
    full_locales_path: Path,
    full_geo_aliases_path: Path,
    scenario_geo_patch_path: Path,
    startup_locales_output_path: Path,
    startup_geo_aliases_output_path: Path,
    startup_support_whitelist_path: Path | None = None,
    base_topology: dict,
    runtime_bootstrap_topology: dict,
    scenario_geo_patch: dict,
    full_locales: dict,
    full_geo_aliases: dict,
    startup_locales: dict,
    startup_geo_aliases: dict,
    startup_support_whitelist: dict | None = None,
    report_path: Path | None = None,
) -> dict:
    required_key_sets = collect_startup_required_geo_keys(
        base_topology,
        runtime_bootstrap_topology,
        scenario_geo_patch,
    )
    full_locale_geo = full_locales.get("geo", {}) if isinstance(full_locales, dict) else {}
    full_locale_ui = full_locales.get("ui", {}) if isinstance(full_locales, dict) else {}
    full_alias_map = full_geo_aliases.get("alias_to_stable_key", {}) if isinstance(full_geo_aliases, dict) else {}
    startup_locale_geo = startup_locales.get("geo", {}) if isinstance(startup_locales, dict) else {}
    startup_locale_ui = startup_locales.get("ui", {}) if isinstance(startup_locales, dict) else {}
    startup_alias_map = startup_geo_aliases.get("alias_to_stable_key", {}) if isinstance(startup_geo_aliases, dict) else {}
    patch_geo = scenario_geo_patch.get("geo", {}) if isinstance(scenario_geo_patch, dict) else {}
    report = {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "consumer_matrix": STARTUP_SUPPORT_CONSUMER_MATRIX,
        "file_audit": {
            "base_topology": {
                "path": str(base_topology_path),
                "raw_bytes": base_topology_path.stat().st_size if base_topology_path.exists() else 0,
            },
            "full_locales": {
                "path": str(full_locales_path),
                "raw_bytes": full_locales_path.stat().st_size if full_locales_path.exists() else 0,
            },
            "full_geo_aliases": {
                "path": str(full_geo_aliases_path),
                "raw_bytes": full_geo_aliases_path.stat().st_size if full_geo_aliases_path.exists() else 0,
            },
            "geo_locale_patch": {
                "path": str(scenario_geo_patch_path),
                "raw_bytes": scenario_geo_patch_path.stat().st_size if scenario_geo_patch_path.exists() else 0,
                "consumers": STARTUP_SUPPORT_CONSUMER_MATRIX["geo_locale_patch"],
            },
            "startup_locales": {
                "path": str(startup_locales_output_path),
                "raw_bytes": startup_locales_output_path.stat().st_size if startup_locales_output_path.exists() else 0,
                "consumers": STARTUP_SUPPORT_CONSUMER_MATRIX["startup_locales"],
            },
            "startup_geo_aliases": {
                "path": str(startup_geo_aliases_output_path),
                "raw_bytes": startup_geo_aliases_output_path.stat().st_size if startup_geo_aliases_output_path.exists() else 0,
                "consumers": STARTUP_SUPPORT_CONSUMER_MATRIX["startup_geo_aliases"],
            },
            "startup_support_whitelist": {
                "path": str(startup_support_whitelist_path) if startup_support_whitelist_path else "",
                "raw_bytes": startup_support_whitelist_path.stat().st_size if startup_support_whitelist_path and startup_support_whitelist_path.exists() else 0,
            },
        },
        "required_geo_key_sources": {
            "base_topology": len(required_key_sets["base_topology"]),
            "runtime_bootstrap": len(required_key_sets["runtime_bootstrap"]),
            "geo_locale_patch": len(required_key_sets["geo_locale_patch"]),
            "combined": len(required_key_sets["combined"]),
        },
        "startup_locales": {
            "ui_key_count": len(full_locale_ui) if isinstance(full_locale_ui, dict) else 0,
            "geo_key_count_before": len(full_locale_geo) if isinstance(full_locale_geo, dict) else 0,
            "geo_key_count_after": len(startup_locale_geo) if isinstance(startup_locale_geo, dict) else 0,
            "bytes_before": _json_size_bytes({"ui": full_locale_ui, "geo": full_locale_geo}),
            "bytes_after": _json_size_bytes(startup_locales),
        },
        "startup_geo_aliases": {
            "alias_count_before": len(full_alias_map) if isinstance(full_alias_map, dict) else 0,
            "alias_count_after": len(startup_alias_map) if isinstance(startup_alias_map, dict) else 0,
            "bytes_before": _json_size_bytes({"alias_to_stable_key": full_alias_map}),
            "bytes_after": _json_size_bytes(startup_geo_aliases),
        },
        "startup_support_whitelist": {
            "locale_key_count": len(_normalize_string_set((startup_support_whitelist or {}).get("locale_keys"))),
            "alias_key_count": len(_normalize_string_set((startup_support_whitelist or {}).get("alias_keys"))),
        },
        "geo_locale_patch": {
            "geo_key_count": len(patch_geo) if isinstance(patch_geo, dict) else 0,
            "bytes": _json_size_bytes(scenario_geo_patch),
        },
    }
    if report_path is not None:
        write_json_atomic(report_path, report, ensure_ascii=False, indent=2, trailing_newline=True)
    return report


def build_runtime_bootstrap_topology_asset(
    *,
    full_runtime_topology_path: Path,
    runtime_bootstrap_output_path: Path,
) -> dict[str, object]:
    full_runtime_topology = read_json_strict(full_runtime_topology_path)
    runtime_bootstrap_topology = build_bootstrap_runtime_topology(full_runtime_topology)
    _write_minified_json(runtime_bootstrap_output_path, runtime_bootstrap_topology)
    return {
      "runtime_bootstrap_topology_path": str(runtime_bootstrap_output_path),
      "runtime_bootstrap_object_count": len(runtime_bootstrap_topology.get("objects", {})),
    }


def build_startup_support_assets(
    *,
    base_topology_path: Path,
    full_locales_path: Path,
    full_geo_aliases_path: Path,
    full_runtime_topology_path: Path,
    scenario_geo_patch_path: Path,
    startup_locales_output_path: Path,
    startup_geo_aliases_output_path: Path,
    startup_support_whitelist_path: Path | None = None,
    report_path: Path | None = None,
) -> dict[str, object]:
    base_topology = read_json_strict(base_topology_path)
    full_locales = read_json_strict(full_locales_path)
    full_geo_aliases = read_json_strict(full_geo_aliases_path)
    full_runtime_topology = read_json_strict(full_runtime_topology_path)
    scenario_geo_patch = read_json_strict(scenario_geo_patch_path)
    resolved_startup_support_whitelist_path = resolve_startup_support_whitelist_path(
        startup_locales_output_path,
        startup_support_whitelist_path,
    )
    startup_support_whitelist = load_startup_support_whitelist(resolved_startup_support_whitelist_path)
    runtime_bootstrap_topology = build_bootstrap_runtime_topology(full_runtime_topology)
    startup_locales = build_startup_locales_payload(
        full_locales,
        base_topology,
        runtime_bootstrap_topology,
        scenario_geo_patch,
        startup_support_whitelist=startup_support_whitelist,
    )
    startup_geo_aliases = build_startup_geo_aliases_payload(
        full_geo_aliases,
        startup_locales,
        startup_support_whitelist=startup_support_whitelist,
    )
    _write_minified_json(startup_locales_output_path, startup_locales)
    _write_minified_json(startup_geo_aliases_output_path, startup_geo_aliases)
    report = build_startup_support_assets_report(
        scenario_id=_normalize_key(scenario_geo_patch.get("scenario_id")),
        base_topology_path=base_topology_path,
        full_locales_path=full_locales_path,
        full_geo_aliases_path=full_geo_aliases_path,
        scenario_geo_patch_path=scenario_geo_patch_path,
        startup_locales_output_path=startup_locales_output_path,
        startup_geo_aliases_output_path=startup_geo_aliases_output_path,
        startup_support_whitelist_path=resolved_startup_support_whitelist_path,
        base_topology=base_topology,
        runtime_bootstrap_topology=runtime_bootstrap_topology,
        scenario_geo_patch=scenario_geo_patch,
        full_locales=full_locales,
        full_geo_aliases=full_geo_aliases,
        startup_locales=startup_locales,
        startup_geo_aliases=startup_geo_aliases,
        startup_support_whitelist=startup_support_whitelist,
        report_path=report_path,
    )
    return {
      "startup_locales_path": str(startup_locales_output_path),
      "startup_geo_aliases_path": str(startup_geo_aliases_output_path),
      "startup_geo_entry_count": len(startup_locales.get("geo", {})),
      "startup_alias_count": len(startup_geo_aliases.get("alias_to_stable_key", {})),
      "startup_support_whitelist_path": str(resolved_startup_support_whitelist_path) if resolved_startup_support_whitelist_path else "",
      "report": report,
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
    startup_support_whitelist_path: Path | None = None,
    report_path: Path | None = None,
) -> dict[str, object]:
    support_result = build_startup_support_assets(
        base_topology_path=base_topology_path,
        full_locales_path=full_locales_path,
        full_geo_aliases_path=full_geo_aliases_path,
        full_runtime_topology_path=full_runtime_topology_path,
        scenario_geo_patch_path=scenario_geo_patch_path,
        startup_locales_output_path=startup_locales_output_path,
        startup_geo_aliases_output_path=startup_geo_aliases_output_path,
        startup_support_whitelist_path=startup_support_whitelist_path,
        report_path=report_path,
    )
    runtime_result = build_runtime_bootstrap_topology_asset(
        full_runtime_topology_path=full_runtime_topology_path,
        runtime_bootstrap_output_path=runtime_bootstrap_output_path,
    )
    return {
      **runtime_result,
      **support_result,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build startup bootstrap topology and startup-core locale assets.")
    parser.add_argument("--base-topology", default=str(ROOT / "data/europe_topology.na_v2.json"))
    parser.add_argument("--full-locales", default=str(ROOT / "data/locales.json"))
    parser.add_argument("--full-geo-aliases", default=str(ROOT / "data/geo_aliases.json"))
    parser.add_argument("--runtime-topology", default=str(ROOT / "data/scenarios/tno_1962/runtime_topology.topo.json"))
    parser.add_argument("--scenario-geo-patch", default=str(ROOT / "data/scenarios/tno_1962" / SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME))
    parser.add_argument("--runtime-bootstrap-output", default=str(ROOT / "data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json"))
    parser.add_argument("--startup-locales-output", default=str(ROOT / "data/scenarios/tno_1962" / SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME))
    parser.add_argument("--startup-geo-aliases-output", default=str(ROOT / "data/scenarios/tno_1962" / SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME))
    parser.add_argument("--startup-support-whitelist", default="")
    parser.add_argument("--report-path", default="")
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
        startup_support_whitelist_path=Path(args.startup_support_whitelist).resolve() if _normalize_key(args.startup_support_whitelist) else None,
        report_path=Path(args.report_path).resolve() if _normalize_key(args.report_path) else None,
    )
    print(result)


if __name__ == "__main__":
    main()
