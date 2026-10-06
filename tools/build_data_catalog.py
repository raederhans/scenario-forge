#!/usr/bin/env python3
"""Build a thin checked-in catalog for runtime-readable data assets."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.io.writers import write_json_atomic
from map_builder.json_schema_contracts import validate_json_contract
from map_builder.runtime_asset_registry import load_runtime_asset_registry
from map_builder.transport_workbench_contracts import validate_transport_manifest


DATA_DIR = PROJECT_ROOT / "data"
DATA_MANIFEST_PATH = DATA_DIR / "manifest.json"
SOURCE_LEDGER_PATH = DATA_DIR / "source_ledger.json"
TRANSPORT_ROOT = DATA_DIR / "transport_layers"
CATALOG_PATH = DATA_DIR / "CATALOG.json"
CATALOG_MD_PATH = DATA_DIR / "CATALOG.md"

CATALOG_VERSION = 1
TRANSPORT_MANIFEST_SCHEMA_REF = "schema://transport/manifest/v1"
TRANSPORT_AUDIT_SCHEMA_REF = "schema://transport/build_audit/v1"
TRANSPORT_SUBTYPE_CATALOG_SCHEMA_REF = "schema://transport/subtype_catalog/v1"
TRANSPORT_CARRIER_SCHEMA_REF = "schema://transport/carrier_payload/v1"
TRANSPORT_PROVENANCE_SCHEMA_REF = "schema://transport/provenance_payload/v1"

JSON_SUFFIXES = (".json", ".geojson")
TOPOLOGY_SUFFIXES = (".topo.json",)

GEOMETRY_SCHEMA_REF = {
    "point": "schema://geojson/feature_collection/point/v1",
    "line": "schema://geojson/feature_collection/line/v1",
    "polygon": "schema://geojson/feature_collection/polygon/v1",
}

TOPOLOGY_OBJECT_SCHEMA_REF = {
    "roads": "schema://topojson/line_collection/roads_v1",
    "railways": "schema://topojson/line_collection/railways_v1",
    "physical_semantics": "schema://topojson/object/physical_semantics_v1",
    "contours": "schema://topojson/object/contours_v1",
    "political": "schema://topojson/object/political_v1",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build data/CATALOG.json and data/CATALOG.md.")
    parser.add_argument("--output", default=str(CATALOG_PATH), help="Catalog JSON output path.")
    parser.add_argument("--markdown-output", default=str(CATALOG_MD_PATH), help="Catalog Markdown output path.")
    return parser.parse_args()


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_rel_path(value: str | Path) -> str:
    if isinstance(value, Path):
        try:
            return str(value.relative_to(PROJECT_ROOT)).replace("\\", "/")
        except ValueError:
            return str(value).replace("\\", "/")
    return str(value).replace("\\", "/").strip()


def _is_json_like(path: str) -> bool:
    normalized = _normalize_rel_path(path)
    return normalized.endswith(JSON_SUFFIXES) or normalized.endswith(TOPOLOGY_SUFFIXES)


def _detect_format(path: str, manifest_meta: dict[str, Any] | None = None) -> str:
    normalized = _normalize_rel_path(path)
    metadata = manifest_meta or {}
    if str(metadata.get("type") or "").strip() == "topology":
        return "topojson"
    if normalized.endswith(".geojson"):
        return "geojson"
    if normalized.endswith(".topo.json"):
        return "topojson"
    if normalized.endswith(".json"):
        return "json"
    if normalized.endswith(".js"):
        return "javascript"
    if normalized.endswith(".md"):
        return "markdown"
    return Path(normalized).suffix.lstrip(".") or "unknown"


def _detect_read_mode(path: str, manifest_meta: dict[str, Any] | None = None) -> str:
    normalized = _normalize_rel_path(path)
    if normalized.endswith(".js"):
        return "module"
    if _detect_format(normalized, manifest_meta) in {"geojson", "json", "topojson"}:
        return "json"
    return "binary"


def _default_cache_policy(*, path: str, role: str) -> str:
    normalized_role = str(role or "").strip()
    normalized_path = _normalize_rel_path(path)
    if normalized_role in {"build_manifest", "transport_manifest", "transport_build_audit", "transport_subtype_catalog"}:
        return "no-cache"
    if normalized_path.endswith("/manifest.json") or normalized_path.endswith("/build_audit.json"):
        return "no-cache"
    if normalized_path.endswith(".js"):
        return "module"
    return "default"


def _manifest_ref(relative_path: str, field: str) -> str:
    return f"data/manifest.json::outputs::{relative_path}::{field}"


def _ledger_ref(source_id: str, field: str) -> str:
    return f"data/source_ledger.json::{source_id}::{field}"


def _choose_preferred_key(current_key: str, next_key: str) -> str:
    def score(value: str) -> tuple[int, int, str]:
        text = str(value or "").strip()
        if text.startswith("transport_manifest:"):
            return (5, -len(text), text)
        if text and ":" not in text:
            return (4, -len(text), text)
        if text.startswith("transport:"):
            return (3, -len(text), text)
        if text.startswith("manifest_output:"):
            return (2, -len(text), text)
        if text.startswith("source:"):
            return (1, -len(text), text)
        return (0, -len(text), text)

    return next_key if score(next_key) > score(current_key) else current_key


def _should_replace_schema_ref(current_schema_ref: str, next_schema_ref: str) -> bool:
    current = str(current_schema_ref or "").strip()
    next_value = str(next_schema_ref or "").strip()
    if not next_value:
        return False
    if not current:
        return True
    if current == "schema://json/object/v1" and next_value != current:
        return True
    if current == "schema://topojson/topology/v1" and next_value != current:
        return True
    if current == "schema://geojson/feature_collection/v1" and next_value != current:
        return True
    return False


def _should_replace_owner(current_owner: str, next_owner: str) -> bool:
    current = str(current_owner or "").strip()
    next_value = str(next_owner or "").strip()
    if not next_value:
        return False
    if not current:
        return True
    if current.startswith("runtime_asset_registry.assets.") and next_value != current:
        return True
    return False


def _deepcopy_json_like(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _load_manifest_outputs() -> dict[str, dict[str, Any]]:
    manifest = _load_data_manifest()
    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict):
        raise SystemExit("data/manifest.json is missing an `outputs` object.")
    return outputs


def _load_data_manifest() -> dict[str, Any]:
    payload = _read_json(DATA_MANIFEST_PATH)
    if not isinstance(payload, dict):
        raise SystemExit("data/manifest.json must be a JSON object.")
    return payload


def _load_source_ledger() -> list[dict[str, Any]]:
    payload = _read_json(SOURCE_LEDGER_PATH)
    if not isinstance(payload, list):
        raise SystemExit("data/source_ledger.json must be a list.")
    return payload


def _ledger_index_by_local_path(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        _normalize_rel_path(entry.get("local_path", "")): entry
        for entry in entries
        if isinstance(entry, dict) and str(entry.get("local_path") or "").strip()
    }


def _should_emit_source_ledger_asset(entry: dict[str, Any]) -> bool:
    # Optional caches are machine-local rebuild inputs. Keeping them out of the
    # checked-in catalog makes the catalog deterministic across clean and warm worktrees.
    local_presence = str(entry.get("local_presence") or "required").strip()
    return local_presence != "optional_cache"


def _derive_generic_schema_ref(path: str, manifest_meta: dict[str, Any] | None = None) -> str:
    metadata = manifest_meta or {}
    if metadata.get("schema_ref"):
        return str(metadata["schema_ref"])
    normalized = _normalize_rel_path(path)
    detected_format = _detect_format(normalized, metadata)
    if detected_format == "topojson":
        object_names = metadata.get("object_names")
        if isinstance(object_names, list) and len(object_names) == 1:
            object_name = str(object_names[0] or "").strip()
            if object_name in TOPOLOGY_OBJECT_SCHEMA_REF:
                return TOPOLOGY_OBJECT_SCHEMA_REF[object_name]
        return "schema://topojson/topology/v1"
    if detected_format == "geojson":
        geometry_hint = str(metadata.get("geometry_kind") or "").strip()
        if geometry_hint in GEOMETRY_SCHEMA_REF:
            return GEOMETRY_SCHEMA_REF[geometry_hint]
        return "schema://geojson/feature_collection/v1"
    if detected_format == "json":
        return "schema://json/object/v1"
    if detected_format == "javascript":
        return "schema://javascript/module/v1"
    return ""


def _derive_transport_schema_ref(*, manifest: dict[str, Any], logical_path: str, asset_path: str) -> str:
    normalized_logical_path = str(logical_path or "").strip()
    if normalized_logical_path.endswith("build_audit"):
        return TRANSPORT_AUDIT_SCHEMA_REF
    if normalized_logical_path.endswith("subtype_catalog"):
        return TRANSPORT_SUBTYPE_CATALOG_SCHEMA_REF
    if normalized_logical_path.endswith("carrier"):
        return TRANSPORT_CARRIER_SCHEMA_REF
    if normalized_logical_path.endswith("provenance"):
        return TRANSPORT_PROVENANCE_SCHEMA_REF

    normalized_asset_path = _normalize_rel_path(asset_path)
    if normalized_asset_path.endswith(".topo.json"):
        leaf_key = normalized_logical_path.split(".")[-1]
        return TOPOLOGY_OBJECT_SCHEMA_REF.get(leaf_key, "schema://topojson/topology/v1")

    geometry_kind = str(manifest.get("geometry_kind") or "").strip()
    leaf_key = normalized_logical_path.split(".")[-1]
    if leaf_key in {"road_labels", "rail_stations_major"}:
        return GEOMETRY_SCHEMA_REF["point"]
    return GEOMETRY_SCHEMA_REF.get(geometry_kind, "schema://geojson/feature_collection/v1")


def _iter_transport_manifest_leaf_paths(container: Any, path_parts: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], str]]:
    results: list[tuple[tuple[str, ...], str]] = []
    if isinstance(container, dict):
        for key, value in container.items():
            results.extend(_iter_transport_manifest_leaf_paths(value, (*path_parts, str(key))))
        return results
    if isinstance(container, str) and container.strip():
        results.append((path_parts, container.strip()))
    return results


def collect_transport_path_contract_errors(
    manifest: dict[str, Any],
    manifest_path: Path,
    *,
    project_root: Path = PROJECT_ROOT,
) -> list[str]:
    errors: list[str] = []
    relative_manifest_path = _normalize_rel_path(manifest_path.relative_to(project_root) if manifest_path.is_absolute() and manifest_path.is_relative_to(project_root) else manifest_path)
    leaf_paths = _iter_transport_manifest_leaf_paths(manifest.get("paths"), ("paths",))
    variants = manifest.get("variants")
    if isinstance(variants, dict):
        for variant_id, variant_meta in variants.items():
            if isinstance(variant_meta, dict):
                leaf_paths.extend(
                    _iter_transport_manifest_leaf_paths(
                        variant_meta.get("paths"),
                        ("variants", str(variant_id), "paths"),
                    )
                )

    geometry_kind = str(manifest.get("geometry_kind") or "").strip()
    for logical_parts, raw_path in leaf_paths:
        normalized_path = _normalize_rel_path(raw_path)
        label = ".".join(logical_parts)
        if not normalized_path.startswith("data/"):
            errors.append(f"{relative_manifest_path}: `{label}` must stay under data/. Got `{normalized_path}`.")
            continue
        target_path = project_root / normalized_path
        if not target_path.is_file():
            errors.append(f"{relative_manifest_path}: `{label}` target missing at {normalized_path}.")
            continue
        if not _is_json_like(normalized_path):
            errors.append(f"{relative_manifest_path}: `{label}` must point to a JSON/GeoJSON/TopoJSON file.")
            continue
        try:
            payload = _read_json(target_path)
        except Exception as exc:  # pragma: no cover - surfaced through CLI
            errors.append(f"{relative_manifest_path}: `{label}` invalid JSON at {normalized_path}: {exc}")
            continue

        leaf_key = logical_parts[-1] if logical_parts else ""
        if leaf_key == "build_audit":
            if not isinstance(payload, dict):
                errors.append(f"{relative_manifest_path}: `{label}` must decode to an object.")
            continue
        if leaf_key == "subtype_catalog":
            if not isinstance(payload, list):
                errors.append(f"{relative_manifest_path}: `{label}` must decode to a list.")
            continue
        if leaf_key in {"carrier", "provenance"}:
            if not isinstance(payload, (dict, list)):
                errors.append(f"{relative_manifest_path}: `{label}` must decode to an object or list.")
            continue

        if normalized_path.endswith(".topo.json"):
            if not isinstance(payload, dict) or payload.get("type") != "Topology":
                errors.append(f"{relative_manifest_path}: `{label}` must decode to a Topology object.")
            if leaf_key in {"roads", "railways"}:
                topology_objects = payload.get("objects") if isinstance(payload, dict) else None
                if not isinstance(topology_objects, dict) or leaf_key not in topology_objects:
                    errors.append(f"{relative_manifest_path}: `{label}` topology is missing object `{leaf_key}`.")
            continue

        if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
            features = payload.get("features")
            if not isinstance(features, list):
                errors.append(f"{relative_manifest_path}: `{label}` FeatureCollection must contain a list `features`.")
                continue
            if not features:
                continue
            geometry_types = {
                str((feature or {}).get("geometry", {}).get("type") or "").strip()
                for feature in features
                if isinstance(feature, dict)
            }
            expected_kind = geometry_kind
            if leaf_key in {"road_labels", "rail_stations_major"}:
                expected_kind = "point"
            if expected_kind == "point":
                allowed = {"Point", "MultiPoint"}
            elif expected_kind == "line":
                allowed = {"LineString", "MultiLineString"}
            elif expected_kind == "polygon":
                allowed = {"Polygon", "MultiPolygon"}
            else:
                allowed = set()
            if allowed and any(geometry_type and geometry_type not in allowed for geometry_type in geometry_types):
                errors.append(
                    f"{relative_manifest_path}: `{label}` geometry kinds {sorted(geometry_types)} "
                    f"do not match expected {sorted(allowed)}."
                )
            continue

        if not isinstance(payload, dict):
            errors.append(f"{relative_manifest_path}: `{label}` must decode to a JSON object or FeatureCollection.")

    return errors


def iter_transport_manifest_paths(transport_root: Path = TRANSPORT_ROOT) -> list[Path]:
    return sorted(path for path in transport_root.rglob("manifest.json") if path.is_file())


def _transport_manifest_key_namespace(manifest_path: Path, manifest_asset_key: str) -> str:
    if manifest_asset_key.startswith("transport_manifest:"):
        return manifest_asset_key.split("transport_manifest:", 1)[1]
    try:
        manifest_dir = manifest_path.parent.relative_to(TRANSPORT_ROOT)
    except ValueError:
        manifest_dir = manifest_path.parent
    return ":".join(part for part in manifest_dir.parts if part)


def _build_transport_entries(
    entries_by_url: dict[str, dict[str, Any]],
    *,
    manifest_outputs: dict[str, dict[str, Any]],
    ledger_by_path: dict[str, dict[str, Any]],
    runtime_asset_key_by_url: dict[str, str],
    generated_at_values: list[str],
) -> None:
    for manifest_path in iter_transport_manifest_paths():
        manifest = _read_json(manifest_path)
        manifest_generated_at = str(manifest.get("generated_at") or "").strip()
        if manifest_generated_at:
            generated_at_values.append(manifest_generated_at)
        relative_manifest_path = _normalize_rel_path(manifest_path)
        shared_errors = validate_transport_manifest(manifest, source_label=relative_manifest_path)
        path_errors = collect_transport_path_contract_errors(manifest, manifest_path)
        errors = [*shared_errors, *path_errors]
        if errors:
            raise SystemExit("\n".join(errors))

        family_id = str(manifest.get("family") or manifest_path.parent.name).strip()
        manifest_asset_key = runtime_asset_key_by_url.get(relative_manifest_path, "")
        transport_key_namespace = _transport_manifest_key_namespace(manifest_path, manifest_asset_key)
        if not manifest_asset_key:
            manifest_asset_key = f"transport_manifest:{transport_key_namespace}"
        _merge_catalog_entry(
            entries_by_url,
            {
                "key": manifest_asset_key,
                "url": relative_manifest_path,
                "role": "transport_manifest",
                "format": _detect_format(relative_manifest_path),
                "schemaRef": TRANSPORT_MANIFEST_SCHEMA_REF,
                "hashRef": "",
                "owner": str(manifest.get("build_command") or relative_manifest_path),
                "cachePolicy": "no-cache",
                "sourceId": str((ledger_by_path.get(relative_manifest_path) or {}).get("source_id") or ""),
                "readMode": _detect_read_mode(relative_manifest_path),
                "aliases": [],
            },
        )

        transport_leaf_paths = _iter_transport_manifest_leaf_paths(manifest.get("paths"), ("paths",))
        variants = manifest.get("variants")
        if isinstance(variants, dict):
            for variant_id, variant_meta in variants.items():
                if isinstance(variant_meta, dict):
                    transport_leaf_paths.extend(
                        _iter_transport_manifest_leaf_paths(
                            variant_meta.get("paths"),
                            ("variants", str(variant_id), "paths"),
                        )
                    )

        for logical_parts, raw_path in transport_leaf_paths:
            normalized_path = _normalize_rel_path(raw_path)
            relative_path_inside_data = (
                Path(normalized_path).relative_to("data").as_posix()
                if normalized_path.startswith("data/")
                else normalized_path
            )
            manifest_meta = manifest_outputs.get(relative_path_inside_data, {})
            ledger_entry = ledger_by_path.get(normalized_path) or {}
            logical_path = ".".join(logical_parts)
            key_suffix = ":".join(str(part) for part in logical_parts[1:])
            entry_key = f"transport:{transport_key_namespace}:{key_suffix}".replace("::", ":")
            role = "transport_pack"
            leaf_key = logical_parts[-1] if logical_parts else ""
            if leaf_key == "build_audit":
                role = "transport_build_audit"
            elif leaf_key == "subtype_catalog":
                role = "transport_subtype_catalog"
            elif leaf_key == "carrier":
                role = "transport_carrier_payload"
            elif leaf_key == "provenance":
                role = "transport_provenance_payload"
            _merge_catalog_entry(
                entries_by_url,
                {
                    "key": entry_key,
                    "url": normalized_path,
                    "role": role,
                    "format": _detect_format(normalized_path, manifest_meta),
                    "schemaRef": _derive_transport_schema_ref(
                        manifest=manifest,
                        logical_path=logical_path,
                        asset_path=normalized_path,
                    ),
                    "hashRef": (
                        _manifest_ref(relative_path_inside_data, "sha256")
                        if relative_path_inside_data in manifest_outputs
                        else _ledger_ref(str(ledger_entry.get("source_id") or ""), "current_local_sha256")
                        if ledger_entry.get("source_id")
                        else ""
                    ),
                    "owner": str(manifest.get("build_command") or relative_manifest_path),
                    "cachePolicy": _default_cache_policy(path=normalized_path, role=role),
                    "sourceId": str(ledger_entry.get("source_id") or ""),
                    "readMode": _detect_read_mode(normalized_path, manifest_meta),
                    "aliases": [logical_path],
                },
            )


def _merge_catalog_entry(entries_by_url: dict[str, dict[str, Any]], candidate: dict[str, Any]) -> None:
    url = _normalize_rel_path(candidate.get("url", ""))
    if not url:
        return
    next_entry = {
        "key": str(candidate.get("key") or "").strip(),
        "url": url,
        "role": str(candidate.get("role") or "").strip(),
        "format": str(candidate.get("format") or "").strip(),
        "schemaRef": str(candidate.get("schemaRef") or "").strip(),
        "hashRef": str(candidate.get("hashRef") or "").strip(),
        "owner": str(candidate.get("owner") or "").strip(),
        "cachePolicy": str(candidate.get("cachePolicy") or "").strip() or "default",
        "sourceId": str(candidate.get("sourceId") or "").strip(),
        "readMode": str(candidate.get("readMode") or "").strip() or _detect_read_mode(url),
        "aliases": sorted({
            alias
            for alias in candidate.get("aliases", [])
            if str(alias or "").strip()
        }),
    }
    contract_errors = validate_catalog_entry_contract(next_entry, source_label=f"catalog entry `{url}`")
    if contract_errors:
        raise SystemExit("\n".join(contract_errors))

    current = entries_by_url.get(url)
    if not current:
        entries_by_url[url] = next_entry
        return

    previous_key = str(current.get("key") or "").strip()
    preferred_key = _choose_preferred_key(previous_key, next_entry["key"])
    prefer_next = preferred_key == next_entry["key"] and preferred_key != current.get("key")
    current["key"] = preferred_key
    if prefer_next and next_entry["role"]:
        current["role"] = next_entry["role"]
    elif not current.get("role") and next_entry["role"]:
        current["role"] = next_entry["role"]
    if prefer_next and next_entry["format"]:
        current["format"] = next_entry["format"]
    elif not current.get("format") and next_entry["format"]:
        current["format"] = next_entry["format"]
    if (prefer_next and next_entry["schemaRef"]) or _should_replace_schema_ref(current.get("schemaRef", ""), next_entry["schemaRef"]):
        current["schemaRef"] = next_entry["schemaRef"]
    elif not current.get("schemaRef") and next_entry["schemaRef"]:
        current["schemaRef"] = next_entry["schemaRef"]
    if prefer_next and next_entry["hashRef"]:
        current["hashRef"] = next_entry["hashRef"]
    elif not current.get("hashRef") and next_entry["hashRef"]:
        current["hashRef"] = next_entry["hashRef"]
    if (prefer_next and next_entry["owner"]) or _should_replace_owner(current.get("owner", ""), next_entry["owner"]):
        current["owner"] = next_entry["owner"]
    elif not current.get("owner") and next_entry["owner"]:
        current["owner"] = next_entry["owner"]
    if current.get("cachePolicy") in {"", "default"} and next_entry["cachePolicy"] not in {"", "default"}:
        current["cachePolicy"] = next_entry["cachePolicy"]
    if prefer_next and next_entry["sourceId"]:
        current["sourceId"] = next_entry["sourceId"]
    elif not current.get("sourceId") and next_entry["sourceId"]:
        current["sourceId"] = next_entry["sourceId"]
    if prefer_next and next_entry["readMode"]:
        current["readMode"] = next_entry["readMode"]
    elif not current.get("readMode") and next_entry["readMode"]:
        current["readMode"] = next_entry["readMode"]
    aliases = {
        *[alias for alias in current.get("aliases", []) if str(alias or "").strip()],
        *next_entry["aliases"],
    }
    if previous_key and previous_key != preferred_key:
        aliases.add(previous_key)
    if current["key"] != next_entry["key"]:
        aliases.add(next_entry["key"])
    current["aliases"] = sorted(aliases)


def validate_catalog_entry_contract(entry: object, *, source_label: str = "catalog entry") -> list[str]:
    return validate_json_contract(
        entry,
        schema_name="catalog_entry.schema.json",
        source_label=source_label,
    )


def build_catalog_payload() -> dict[str, Any]:
    data_manifest = _load_data_manifest()
    manifest_outputs = _load_manifest_outputs()
    runtime_registry = load_runtime_asset_registry()
    source_ledger = _load_source_ledger()
    ledger_by_path = _ledger_index_by_local_path(source_ledger)
    generated_at_values = [
        value
        for value in [str(data_manifest.get("generated_at") or "").strip()]
        if value
    ]

    entries_by_url: dict[str, dict[str, Any]] = {}
    runtime_asset_key_by_url = {
        _normalize_rel_path(spec.get("url", "")): asset_key
        for asset_key, spec in (runtime_registry.get("assets") or {}).items()
        if isinstance(spec, dict) and str(spec.get("url") or "").strip()
    }

    for asset_key, asset_spec in sorted((runtime_registry.get("assets") or {}).items()):
        if not isinstance(asset_spec, dict):
            continue
        asset_url = _normalize_rel_path(asset_spec.get("url", ""))
        relative_path_inside_data = (
            Path(asset_url).relative_to("data").as_posix()
            if asset_url.startswith("data/")
            else asset_url
        )
        manifest_meta = manifest_outputs.get(relative_path_inside_data, {})
        ledger_entry = ledger_by_path.get(asset_url) or {}
        _merge_catalog_entry(
            entries_by_url,
            {
                "key": asset_key,
                "url": asset_url,
                "role": str(asset_spec.get("role") or manifest_meta.get("role") or ""),
                "format": _detect_format(asset_url, manifest_meta),
                "schemaRef": str(asset_spec.get("schema_ref") or _derive_generic_schema_ref(asset_url, manifest_meta)),
                "hashRef": (
                    _manifest_ref(relative_path_inside_data, "sha256")
                    if relative_path_inside_data in manifest_outputs
                    else _ledger_ref(str(ledger_entry.get("source_id") or ""), "current_local_sha256")
                    if ledger_entry.get("source_id")
                    else ""
                ),
                "owner": str(manifest_meta.get("owner") or f"runtime_asset_registry.assets.{asset_key}"),
                "cachePolicy": _default_cache_policy(path=asset_url, role=str(asset_spec.get("role") or "")),
                "sourceId": str(ledger_entry.get("source_id") or ""),
                "readMode": _detect_read_mode(asset_url, manifest_meta),
                "aliases": [],
            },
        )

    for relative_path, metadata in sorted(manifest_outputs.items()):
        absolute_like_path = relative_path if relative_path.startswith("js/") else f"data/{relative_path}"
        ledger_entry = ledger_by_path.get(absolute_like_path) or {}
        _merge_catalog_entry(
            entries_by_url,
            {
                "key": f"manifest_output:{relative_path}",
                "url": absolute_like_path,
                "role": str(metadata.get("role") or ""),
                "format": _detect_format(absolute_like_path, metadata),
                "schemaRef": _derive_generic_schema_ref(absolute_like_path, metadata),
                "hashRef": _manifest_ref(relative_path, "sha256"),
                "owner": str(metadata.get("owner") or ""),
                "cachePolicy": _default_cache_policy(path=absolute_like_path, role=str(metadata.get("role") or "")),
                "sourceId": str(ledger_entry.get("source_id") or ""),
                "readMode": _detect_read_mode(absolute_like_path, metadata),
                "aliases": [],
            },
        )

    for ledger_entry in source_ledger:
        if not isinstance(ledger_entry, dict):
            continue
        if not _should_emit_source_ledger_asset(ledger_entry):
            continue
        local_path = _normalize_rel_path(ledger_entry.get("local_path", ""))
        if not local_path or not _is_json_like(local_path):
            continue
        if not (PROJECT_ROOT / local_path).is_file():
            continue
        _merge_catalog_entry(
            entries_by_url,
            {
                "key": f"source:{ledger_entry.get('source_id')}",
                "url": local_path,
                "role": "source_ledger_asset",
                "format": _detect_format(local_path),
                "schemaRef": _derive_generic_schema_ref(local_path),
                "hashRef": _ledger_ref(str(ledger_entry.get("source_id") or ""), "current_local_sha256"),
                "owner": "source_ledger",
                "cachePolicy": "default",
                "sourceId": str(ledger_entry.get("source_id") or ""),
                "readMode": _detect_read_mode(local_path),
                "aliases": [],
            },
        )

    _build_transport_entries(
        entries_by_url,
        manifest_outputs=manifest_outputs,
        ledger_by_path=ledger_by_path,
        runtime_asset_key_by_url=runtime_asset_key_by_url,
        generated_at_values=generated_at_values,
    )

    entries = sorted(entries_by_url.values(), key=lambda item: (item["url"], item["key"]))
    role_counts = Counter(entry["role"] for entry in entries)
    format_counts = Counter(entry["format"] for entry in entries)
    read_mode_counts = Counter(entry["readMode"] for entry in entries)
    return {
        "version": CATALOG_VERSION,
        "generated_at": max(generated_at_values) if generated_at_values else datetime.now(timezone.utc).isoformat(),
        "counts": {
            "entries": len(entries),
            "by_role": dict(sorted(role_counts.items())),
            "by_format": dict(sorted(format_counts.items())),
            "by_read_mode": dict(sorted(read_mode_counts.items())),
        },
        "entries": entries,
    }


def build_catalog_markdown(payload: dict[str, Any]) -> str:
    counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
    role_counts = counts.get("by_role") if isinstance(counts.get("by_role"), dict) else {}
    lines = [
        "# Data Catalog",
        "",
        f"- generated_at: {payload.get('generated_at', '')}",
        f"- version: {payload.get('version', '')}",
        f"- entries: {counts.get('entries', 0)}",
        "",
        "## Counts by role",
        "",
        "| role | count |",
        "| --- | ---: |",
    ]
    for role, count in sorted(role_counts.items()):
        lines.append(f"| {role} | {count} |")

    lines.extend(
        [
            "",
            "## Entries",
            "",
            "| key | url | role | format | readMode | schemaRef | hashRef | cachePolicy | owner | sourceId |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for entry in payload.get("entries", []):
        lines.append(
            "| {key} | {url} | {role} | {format} | {readMode} | {schemaRef} | {hashRef} | {cachePolicy} | {owner} | {sourceId} |".format(
                key=entry.get("key", ""),
                url=entry.get("url", ""),
                role=entry.get("role", ""),
                format=entry.get("format", ""),
                readMode=entry.get("readMode", ""),
                schemaRef=entry.get("schemaRef", ""),
                hashRef=entry.get("hashRef", ""),
                cachePolicy=entry.get("cachePolicy", ""),
                owner=entry.get("owner", ""),
                sourceId=entry.get("sourceId", ""),
            )
        )
    lines.append("")
    return "\n".join(lines)


def write_catalog(payload: dict[str, Any], *, output_path: Path, markdown_output_path: Path) -> None:
    markdown = build_catalog_markdown(payload)
    write_json_atomic(output_path, payload, ensure_ascii=False, indent=2, trailing_newline=True)
    markdown_output_path.write_text(markdown, encoding="utf-8")


def main() -> None:
    args = parse_args()
    payload = build_catalog_payload()
    output_path = Path(args.output).resolve()
    markdown_output_path = Path(args.markdown_output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_output_path.parent.mkdir(parents=True, exist_ok=True)
    write_catalog(payload, output_path=output_path, markdown_output_path=markdown_output_path)
    print(
        f"[data-catalog] Wrote {payload['counts']['entries']} entries "
        f"to {_normalize_rel_path(output_path)} and {_normalize_rel_path(markdown_output_path)}"
    )


if __name__ == "__main__":
    main()
