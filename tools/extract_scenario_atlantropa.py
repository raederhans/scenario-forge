#!/usr/bin/env python3
"""Split TNO 1962 Atlantropa features into a first-class TopoJSON object."""

from __future__ import annotations

import argparse
import copy
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.json_source import read_json_source, resolve_json_source_path, write_runtime_topology_source


ATLANTROPA_OBJECT_NAME = "scenario_atlantropa"
ATLANTROPA_TOPOLOGY_FILENAME = "scenario_atlantropa.topo.json"
ATLANTROPA_METADATA_FILENAME = "scenario_atlantropa_metadata.json"
ATLANTROPA_SEA_FILL_COLOR = "#203856"
ATLANTROPA_SALT_FLAT_FILL_COLOR = "#7c6f53"
ATLANTROPA_SHOAL_FILL_COLOR = "#3a5d70"
ATLANTROPA_PREFIX_RULES: tuple[tuple[str, str, bool, str], ...] = (
    ("ATLSEA_FILL_", "water", True, "atlantropa_sea"),
    ("ATLSEA_", "water", True, "atlantropa_sea"),
    ("ATLPRV_", "land", True, "owner"),
    ("ATLISL_", "land", True, "owner"),
    ("ATLWLD_", "land", True, "owner"),
    ("ATLSHL_", "shoal", True, "shoal_pattern"),
)
ATL_SYSTEM_CNTR_PREFIXES = ("ATLISL_", "ATLSHL_", "ATLSEA_", "ATLSEA_FILL_")


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    return read_json_source(path)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def feature_id_for_geometry(geometry: dict[str, Any]) -> str:
    props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
    return str(props.get("id") or geometry.get("id") or "").strip()


def classify_atlantropa_feature(feature_id: str) -> tuple[str, bool, str] | None:
    normalized = str(feature_id or "").strip().upper()
    for prefix, render_layer, interactive, color_rule in ATLANTROPA_PREFIX_RULES:
        if normalized.startswith(prefix):
            return render_layer, interactive, color_rule
    return None


def is_atlantropa_feature(feature_id: str) -> bool:
    return classify_atlantropa_feature(feature_id) is not None


def remap_computed_neighbors(
    original_neighbors: Any,
    old_to_new_index: dict[int, int],
    original_geometry_count: int,
) -> list[list[int]] | None:
    if original_neighbors is None:
        return None
    if not isinstance(original_neighbors, list):
        raise ValueError("objects.political.computed_neighbors must be a list when present")
    if len(original_neighbors) != original_geometry_count:
        raise ValueError(
            "objects.political.computed_neighbors length must match objects.political.geometries before migration"
        )

    next_neighbors: list[list[int]] = [[] for _old_index in old_to_new_index]
    for old_index, new_index in old_to_new_index.items():
        neighbor_indices = original_neighbors[old_index]
        if not isinstance(neighbor_indices, list):
            raise ValueError("objects.political.computed_neighbors entries must be lists")
        remapped: set[int] = set()
        for neighbor_index in neighbor_indices:
            if not isinstance(neighbor_index, int) or isinstance(neighbor_index, bool):
                raise ValueError("objects.political.computed_neighbors entries must contain integer indices")
            if neighbor_index < 0 or neighbor_index >= original_geometry_count:
                raise ValueError("objects.political.computed_neighbors entries must point at existing geometries")
            if neighbor_index in old_to_new_index:
                remapped.add(old_to_new_index[neighbor_index])
        next_neighbors[new_index] = sorted(remapped)
    return next_neighbors


def decorate_atlantropa_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    next_geometry = copy.deepcopy(geometry)
    props = next_geometry.setdefault("properties", {})
    if not isinstance(props, dict):
        props = {}
        next_geometry["properties"] = props
    feature_id = feature_id_for_geometry(next_geometry)
    if feature_id and not props.get("id"):
        props["id"] = feature_id
    rule = classify_atlantropa_feature(feature_id)
    if rule is None:
        return next_geometry
    render_layer, interactive, color_rule = rule
    props["atl_render_layer"] = render_layer
    props["atl_interactive"] = interactive
    props["atl_color_rule"] = color_rule
    props["interactive"] = interactive
    if feature_id.upper().startswith(ATL_SYSTEM_CNTR_PREFIXES):
        props["cntr_code"] = "ATL"
    return next_geometry


def split_topology_payload(
    payload: dict[str, Any],
    *,
    require_atlantropa_features: bool = True,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    next_payload = copy.deepcopy(payload)
    objects = next_payload.setdefault("objects", {})
    if not isinstance(objects, dict):
        raise ValueError("runtime topology payload must contain an objects mapping")
    political = objects.get("political")
    if not isinstance(political, dict):
        raise ValueError("runtime topology payload must contain objects.political")
    geometries = political.get("geometries")
    if not isinstance(geometries, list):
        raise ValueError("runtime topology objects.political.geometries must be a list")

    existing_atlantropa = objects.get(ATLANTROPA_OBJECT_NAME)
    existing_atlantropa_geometries = (
        existing_atlantropa.get("geometries")
        if isinstance(existing_atlantropa, dict)
        else None
    )
    existing_atlantropa_count = len(existing_atlantropa_geometries) if isinstance(existing_atlantropa_geometries, list) else 0

    political_geometries: list[dict[str, Any]] = []
    atlantropa_geometries: list[dict[str, Any]] = []
    retained_old_indices: list[int] = []
    for old_index, geometry in enumerate(geometries):
        if not isinstance(geometry, dict):
            political_geometries.append(geometry)
            retained_old_indices.append(old_index)
            continue
        feature_id = feature_id_for_geometry(geometry)
        if is_atlantropa_feature(feature_id):
            atlantropa_geometries.append(decorate_atlantropa_geometry(geometry))
        else:
            political_geometries.append(geometry)
            retained_old_indices.append(old_index)

    if not atlantropa_geometries:
        if existing_atlantropa_count:
            decorated_existing = [
                decorate_atlantropa_geometry(geometry)
                for geometry in existing_atlantropa_geometries
                if isinstance(geometry, dict) and is_atlantropa_feature(feature_id_for_geometry(geometry))
            ]
            if not decorated_existing:
                raise ValueError(f"objects.{ATLANTROPA_OBJECT_NAME} exists but contains no ATL* geometries")
            objects[ATLANTROPA_OBJECT_NAME] = {
                "type": "GeometryCollection",
                "geometries": decorated_existing,
            }
            return next_payload, decorated_existing
        if not require_atlantropa_features:
            objects[ATLANTROPA_OBJECT_NAME] = {
                "type": "GeometryCollection",
                "geometries": [],
            }
            return next_payload, []
        raise ValueError("objects.political contains no ATL* geometries to migrate")

    old_to_new_index = {
        old_index: new_index
        for new_index, old_index in enumerate(retained_old_indices)
    }
    remapped_neighbors = remap_computed_neighbors(
        political.get("computed_neighbors") if "computed_neighbors" in political else None,
        old_to_new_index,
        len(geometries),
    )
    political["geometries"] = political_geometries
    if remapped_neighbors is not None:
        political["computed_neighbors"] = remapped_neighbors
    objects[ATLANTROPA_OBJECT_NAME] = {
        "type": "GeometryCollection",
        "geometries": atlantropa_geometries,
    }
    return next_payload, atlantropa_geometries


def build_single_object_topology(payload: dict[str, Any], object_name: str) -> dict[str, Any]:
    objects = payload.get("objects") if isinstance(payload.get("objects"), dict) else {}
    source_object = objects.get(object_name) if isinstance(objects, dict) else None
    if not isinstance(source_object, dict):
        source_object = {"type": "GeometryCollection", "geometries": []}
    next_payload = {
        "type": "Topology",
        "objects": {
            object_name: copy.deepcopy(source_object),
        },
        "arcs": copy.deepcopy(payload.get("arcs") if isinstance(payload.get("arcs"), list) else []),
    }
    for key in ("bbox", "transform"):
        if key in payload:
            next_payload[key] = copy.deepcopy(payload[key])
    return next_payload


def build_metadata(scenario_id: str, geometries: list[dict[str, Any]]) -> dict[str, Any]:
    prefix_counts: Counter[str] = Counter()
    render_layer_counts: Counter[str] = Counter()
    color_rule_counts: Counter[str] = Counter()
    interactive_count = 0
    for geometry in geometries:
        props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
        feature_id = str(props.get("id") or geometry.get("id") or "").strip().upper()
        for prefix, _render_layer, _interactive, _color_rule in ATLANTROPA_PREFIX_RULES:
            if feature_id.startswith(prefix):
                prefix_counts[prefix] += 1
                break
        render_layer = str(props.get("atl_render_layer") or "").strip()
        color_rule = str(props.get("atl_color_rule") or "").strip()
        if render_layer:
            render_layer_counts[render_layer] += 1
        if color_rule:
            color_rule_counts[color_rule] += 1
        if props.get("atl_interactive") is True:
            interactive_count += 1
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": utc_timestamp(),
        "object_name": ATLANTROPA_OBJECT_NAME,
        "feature_count": len(geometries),
        "interactive_feature_count": interactive_count,
        "prefix_rules": [
            {
                "prefix": prefix,
                "atl_render_layer": render_layer,
                "atl_interactive": interactive,
                "atl_color_rule": color_rule,
            }
            for prefix, render_layer, interactive, color_rule in ATLANTROPA_PREFIX_RULES
        ],
        "prefix_counts": dict(sorted(prefix_counts.items())),
        "render_layer_counts": dict(sorted(render_layer_counts.items())),
        "color_rule_counts": dict(sorted(color_rule_counts.items())),
    }


def update_runtime_meta(scenario_dir: Path) -> None:
    meta_path = scenario_dir / "runtime_meta.json"
    if not meta_path.exists():
        return
    payload = load_json(meta_path)
    names = payload.get("runtime_topology_object_names")
    if not isinstance(names, list):
        names = []
    names = sorted({*(str(name) for name in names if str(name).strip()), ATLANTROPA_OBJECT_NAME})
    payload["runtime_topology_object_names"] = names
    payload["runtime_topology_object_count"] = len(names)
    write_json(meta_path, payload)


def update_manifest(scenario_dir: Path, metadata: dict[str, Any]) -> None:
    manifest_path = scenario_dir / "manifest.json"
    manifest = load_json(manifest_path)
    scenario_id = str(manifest.get("scenario_id") or scenario_dir.name).strip() or scenario_dir.name
    manifest["scenario_atlantropa_topology_url"] = f"data/scenarios/{scenario_id}/{ATLANTROPA_TOPOLOGY_FILENAME}"
    manifest["scenario_atlantropa_metadata_url"] = f"data/scenarios/{scenario_id}/{ATLANTROPA_METADATA_FILENAME}"
    performance_hints = manifest.setdefault("performance_hints", {})
    if isinstance(performance_hints, dict):
        performance_hints["scenario_atlantropa_default"] = True
    style_defaults = manifest.setdefault("style_defaults", {})
    if isinstance(style_defaults, dict):
        style_defaults.setdefault("atlantropa_sea", {})["fillColor"] = ATLANTROPA_SEA_FILL_COLOR
        style_defaults.setdefault("atlantropa_salt_flat", {})["fillColor"] = ATLANTROPA_SALT_FLAT_FILL_COLOR
        style_defaults.setdefault("atlantropa_shoal", {})["fillColor"] = ATLANTROPA_SHOAL_FILL_COLOR
    summary = manifest.setdefault("summary", {})
    if isinstance(summary, dict):
        summary["scenario_atlantropa_feature_count"] = int(metadata.get("feature_count") or 0)
    write_json(manifest_path, manifest)


def migrate_scenario(scenario_dir: Path) -> dict[str, Any]:
    scenario_dir = scenario_dir.resolve()
    manifest = load_json(scenario_dir / "manifest.json")
    scenario_id = str(manifest.get("scenario_id") or scenario_dir.name).strip() or scenario_dir.name

    runtime_url = str(manifest.get("runtime_topology_url") or "").strip()
    relative = PurePosixPath(runtime_url).relative_to(PurePosixPath("data/scenarios") / scenario_id) if runtime_url else PurePosixPath("runtime_topology.topo.json")
    runtime_path = scenario_dir.joinpath(*relative.parts).resolve()
    if not runtime_path.is_relative_to(scenario_dir):
        raise ValueError(f"Runtime topology URL escapes scenario directory: {runtime_url}")
    runtime_path = resolve_json_source_path(runtime_path)
    runtime_payload, atlantropa_geometries = split_topology_payload(load_json(runtime_path))
    runtime_path = write_runtime_topology_source(scenario_dir, runtime_payload)
    manifest["runtime_topology_url"] = f"data/scenarios/{scenario_id}/{runtime_path.name}"
    write_json(scenario_dir / "manifest.json", manifest)

    bootstrap_path = scenario_dir / "runtime_topology.bootstrap.topo.json"
    if bootstrap_path.exists():
        bootstrap_payload, _bootstrap_atlantropa_geometries = split_topology_payload(
            load_json(bootstrap_path),
            require_atlantropa_features=False,
        )
        write_json(bootstrap_path, bootstrap_payload)

    scenario_atlantropa_topology = build_single_object_topology(runtime_payload, ATLANTROPA_OBJECT_NAME)
    metadata = build_metadata(scenario_id, atlantropa_geometries)
    write_json(scenario_dir / ATLANTROPA_TOPOLOGY_FILENAME, scenario_atlantropa_topology)
    write_json(scenario_dir / ATLANTROPA_METADATA_FILENAME, metadata)
    update_runtime_meta(scenario_dir)
    update_manifest(scenario_dir, metadata)
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario_dir", type=Path, help="Scenario directory, e.g. data/scenarios/tno_1962")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    metadata = migrate_scenario(args.scenario_dir)
    print(json.dumps({
        "scenario_id": metadata.get("scenario_id"),
        "feature_count": metadata.get("feature_count"),
        "prefix_counts": metadata.get("prefix_counts"),
        "render_layer_counts": metadata.get("render_layer_counts"),
        "color_rule_counts": metadata.get("color_rule_counts"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
