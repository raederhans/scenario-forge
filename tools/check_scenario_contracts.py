#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Any

from shapely.geometry import box, shape

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.contracts import (
    SCENARIO_BUILD_SNAPSHOT_FILENAME,
    SCENARIO_BUILDER_VERSION,
    SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
    SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
    SCENARIO_CONTRACT_VERSION,
    SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD,
    SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE,
    SCENARIO_GEO_LOCALE_PATCH_MANIFEST_LANGUAGE_FIELDS,
    SCENARIO_PROFILE_LIGHTWEIGHT_BASE,
    SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE,
    SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS,
    SCENARIO_STRICT_REQUIRED_FILENAMES,
    SCENARIO_STRATEGIC_VALUES_FILENAME,
    build_scenario_snapshot_payload,
    normalize_scenario_contract_tag,
    resolve_scenario_contract_profile,
    sha256_path,
)
from map_builder.io.writers import write_json_atomic
from tools.build_startup_bootstrap_assets import build_startup_bootstrap_assets
from tools.build_startup_bundle import build_startup_bundles
from tools.scenario_contract_paths import (
    TNO_ATLANTROPA_DONOR_LEDGER_FILENAME,
    TNO_COVERAGE_DERIVED_DIRNAME,
    TNO_COVERAGE_LEDGER_FILENAMES,
    TNO_COVERAGE_REPORT_PATHS,
    TNO_GEOMETRY_DROP_AUDIT_FILENAME,
)
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets

DEFAULT_SCENARIOS_ROOT = PROJECT_ROOT / "data/scenarios"
IGNORED_DIR_NAMES = {"expectations"}
COMMON_REQUIRED_MANIFEST_FIELDS = (
    "version",
    "scenario_id",
    "display_name",
    "bookmark_name",
    "bookmark_description",
    "bookmark_date",
    "default_country",
    "featured_tags",
    "palette_id",
    "baseline_hash",
    "countries_url",
    "owners_url",
    "cores_url",
    "audit_url",
    "summary",
    "generated_at",
)
V2_REQUIRED_MANIFEST_FIELDS = (
    "performance_hints",
    "style_defaults",
    "city_overrides_url",
)
SUSPICIOUS_LOCALE_TRANSLATIONS = {
    "\u8df3\u6c60",
    "\u4e3b\u6301\u4eba",
    "\u534f\u8bae",
    "\u4e00\u4e2a\u65e5\u5fd7",
    "\u591a\u4e91",
}
STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES = ("RU_ARCTIC_FB_",)
SCENARIO_ATLANTROPA_OBJECT_NAME = "scenario_atlantropa"
SCENARIO_ATLANTROPA_LAYER_KEY = "scenario_atlantropa"
ATLANTROPA_FEATURE_PREFIXES = (
    "ATLPRV_",
    "ATLISL_",
    "ATLSEA_FILL_",
    "ATLSEA_",
    "ATLWLD_",
    "ATLSHL_",
)
ATLANTROPA_RENDER_LAYER_VALUES = {"water", "land", "shoal", "relief"}
ATLANTROPA_COLOR_RULE_VALUES = {"atlantropa_sea", "owner", "salt_flat", "shoal_pattern"}
WATER_REGIONS_MODE_VALUES = {"combined", "exclusive"}
ATLANTROPA_PREFIX_FIELD_RULES = (
    ("ATLSEA_FILL_", "water", "atlantropa_sea"),
    ("ATLSEA_", "water", "atlantropa_sea"),
    ("ATLPRV_", "land", "owner"),
    ("ATLISL_", "land", "owner"),
    ("ATLWLD_", "land", "owner"),
    ("ATLSHL_", "shoal", "shoal_pattern"),
)
TNO_PROTECTED_COVERAGE_PREFIXES = (
    "RU_ARCTIC_FB_",
    "ATLSEA_FILL_",
    "ATLSEA_",
    "ATLPRV_",
    "ATLISL_",
    "AQ",
)
TNO_ATLANTROPA_BASIN_PROBES = (
    {
        "id": "ionian_mediterranean",
        "label": "Ionian Mediterranean",
        "bbox": [19.0, 34.4, 22.5, 40.0],
        "expected_prefixes": ("ATLSEA_", "ATLSEA_FILL_"),
    },
    {
        "id": "libya_suez_chain",
        "label": "Libya and Suez Atlantropa Chain",
        "bbox": [11.0, 27.8, 34.2, 35.3],
        "expected_prefixes": ("ATLSEA_", "ATLSEA_FILL_", "ATLPRV_"),
    },
    {
        "id": "suez_canal_site",
        "label": "Suez Atlantropa Canal Site",
        "bbox": [31.0, 27.8, 35.0, 32.5],
        "expected_prefixes": ("ATLSEA_", "ATLSEA_FILL_", "ATLPRV_"),
    },
    {
        "id": "malta_rebuilt_island",
        "label": "Malta Rebuilt Island",
        "bbox": [13.0, 35.0, 15.5, 36.6],
        "expected_prefixes": ("ATLISL_", "ATLSEA_", "ATLSEA_FILL_"),
    },
    {
        "id": "cretan_mediterranean",
        "label": "Cretan Mediterranean",
        "bbox": [22.0, 34.4, 31.0, 36.9],
        "expected_prefixes": ("ATLSEA_", "ATLSEA_FILL_", "ATLISL_"),
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate checked-in scenario contracts using the scenario directory name "
            "as the canonical scenario_id."
        )
    )
    parser.add_argument(
        "--scenarios-root",
        default=str(DEFAULT_SCENARIOS_ROOT),
        help="Root directory containing scenario folders. Defaults to data/scenarios.",
    )
    parser.add_argument(
        "--scenario-dir",
        action="append",
        default=[],
        help="Optional specific scenario directory to validate. May be repeated.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Enable strict bundle/runtime validation for publish-ready scenario or checkpoint directories.",
    )
    parser.add_argument(
        "--write-safe",
        action="store_true",
        help="Apply safe derived-asset repairs, then rerun validation and require a zero-diff second repair pass.",
    )
    parser.add_argument(
        "--report-path",
        action="append",
        default=[],
        help="Optional JSON report output path. May be repeated to write one validation result to multiple compatibility paths.",
    )
    return parser.parse_args()


def create_repair_tracks() -> dict[str, Any]:
    # repair tracks 记录的是“这轮 strict 检查观察到了什么偏差”，
    # 目的是把终端报告和 JSON 报告补充得更可读，不代表这些问题都允许自动修。
    return {
        "owners_controllers_keyset": None,
        "owners_cores_keyset": None,
        "runtime_topology_extra_ids": None,
        "geo_locale_collision_candidates": [],
    }


def build_scenario_report(scenario_dir: Path, strict: bool) -> dict[str, Any]:
    profile = resolve_scenario_contract_profile(scenario_dir.name)
    return {
        "scenario_id": scenario_dir.name,
        "scenario_dir": str(scenario_dir),
        "profile": profile.profile_id,
        "gate_mode": profile.gate_mode,
        "strict_mode": strict,
        "status": "ok",
        "errors": [],
        "warnings": [],
        "violations": [],
        "snapshot_fingerprint": "",
        "safe_fixable": False,
        "safe_fixes_applied": [],
        "risky_fixes_required": [],
        "forbidden_violations": [],
        "idempotent": True,
        "artifact_counts": {},
        "owner_bucket_mismatch_count": 0,
        "reverse_coverage_gap_count": 0,
        "coverage_ledger_ok": True,
        "protected_prefix_drop_count": 0,
        "basin_probe_failures": [],
        "polar_spherical_failures": [],
        "polar_feature_count": 0,
        "polar_gate_ref": "",
        "repair_tracks": create_repair_tracks(),
    }


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON at {path}: {exc}") from exc


def has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def write_json(path: Path, payload: object) -> None:
    stable_payload = json.loads(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    write_json_atomic(
        path,
        stable_payload,
        ensure_ascii=False,
        indent=2,
        trailing_newline=True,
    )


def _load_optional_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    payload = load_json(path)
    return payload if isinstance(payload, dict) else None


def _coverage_prefix_for_feature_id(feature_id: str) -> str:
    normalized = str(feature_id or "").strip().upper()
    for prefix in TNO_PROTECTED_COVERAGE_PREFIXES:
        if prefix == "AQ":
            if normalized == "AQ" or normalized.startswith("AQ_"):
                return "AQ"
            continue
        if normalized.startswith(prefix):
            return prefix
    return ""


def _iter_coordinate_positions(value: Any):
    if not isinstance(value, (list, tuple)):
        return
    if (
        len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        yield float(value[0]), float(value[1])
        return
    for item in value:
        yield from _iter_coordinate_positions(item)


def _geometry_bbox(geometry: Any) -> list[float] | None:
    if not isinstance(geometry, dict):
        return None
    geometry_type = str(geometry.get("type") or "").strip()
    if geometry_type == "GeometryCollection":
        bboxes = [
            bbox
            for bbox in (_geometry_bbox(child) for child in geometry.get("geometries") or [])
            if bbox is not None
        ]
        if not bboxes:
            return None
        return [
            min(bbox[0] for bbox in bboxes),
            min(bbox[1] for bbox in bboxes),
            max(bbox[2] for bbox in bboxes),
            max(bbox[3] for bbox in bboxes),
        ]
    positions = list(_iter_coordinate_positions(geometry.get("coordinates")))
    if not positions:
        return None
    xs = [point[0] for point in positions]
    ys = [point[1] for point in positions]
    return [min(xs), min(ys), max(xs), max(ys)]


def _bbox_intersects(
    left: list[float] | tuple[float, ...] | None,
    right: list[float] | tuple[float, ...] | None,
) -> bool:
    if left is None or right is None or len(left) < 4 or len(right) < 4:
        return False
    return not (
        float(left[2]) < float(right[0])
        or float(right[2]) < float(left[0])
        or float(left[3]) < float(right[1])
        or float(right[3]) < float(left[1])
    )


def _geometry_intersects_bbox(geometry: Any, bbox: list[float] | tuple[float, ...] | None) -> bool:
    if not isinstance(geometry, dict) or bbox is None or len(bbox) < 4:
        return False
    candidate = shape(geometry)
    probe = box(float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3]))
    return not candidate.is_empty and bool(candidate.intersects(probe))


def _ring_planar_area(ring: Any) -> float:
    if not isinstance(ring, (list, tuple)) or len(ring) < 4:
        return 0.0
    total = 0.0
    for first, second in zip(ring, ring[1:]):
        if not (
            isinstance(first, (list, tuple))
            and isinstance(second, (list, tuple))
            and len(first) >= 2
            and len(second) >= 2
        ):
            continue
        total += (float(first[0]) * float(second[1])) - (float(second[0]) * float(first[1]))
    return total / 2.0


def _polygon_planar_area(coordinates: Any) -> float:
    if not isinstance(coordinates, (list, tuple)) or not coordinates:
        return 0.0
    exterior = abs(_ring_planar_area(coordinates[0]))
    holes = sum(abs(_ring_planar_area(ring)) for ring in coordinates[1:])
    return max(0.0, exterior - holes)


def _geometry_planar_area(geometry: Any) -> float:
    if not isinstance(geometry, dict):
        return 0.0
    geometry_type = str(geometry.get("type") or "").strip()
    if geometry_type == "Polygon":
        return _polygon_planar_area(geometry.get("coordinates"))
    if geometry_type == "MultiPolygon":
        return sum(_polygon_planar_area(polygon) for polygon in geometry.get("coordinates") or [])
    if geometry_type == "GeometryCollection":
        return sum(_geometry_planar_area(child) for child in geometry.get("geometries") or [])
    return 0.0


def _runtime_object_geometries(payload: dict[str, Any], object_name: str) -> list[dict[str, Any]]:
    objects = payload.get("objects") if isinstance(payload, dict) else None
    runtime_object = objects.get(object_name) if isinstance(objects, dict) else None
    geometries = runtime_object.get("geometries") if isinstance(runtime_object, dict) else None
    return [geometry for geometry in geometries if isinstance(geometry, dict)] if isinstance(geometries, list) else []


def _feature_id_from_mapping(mapping: dict[str, Any]) -> str:
    props = mapping.get("properties") if isinstance(mapping.get("properties"), dict) else {}
    return str(props.get("id") or mapping.get("id") or "").strip()


def _minimal_geo_locale_patch_payload(scenario_id: str, generated_at: str) -> dict[str, Any]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": generated_at,
        "geo": {},
    }


def _build_language_geo_locale_patch(base_payload: dict[str, Any], language: str) -> dict[str, Any]:
    geo = base_payload.get("geo") if isinstance(base_payload.get("geo"), dict) else {}
    return {
        "version": base_payload.get("version", 1),
        "scenario_id": str(base_payload.get("scenario_id") or "").strip(),
        "generated_at": str(base_payload.get("generated_at") or "").strip(),
        "language": language,
        "geo": {
            feature_id: dict(entry)
            for feature_id, entry in geo.items()
            if isinstance(entry, dict) and entry.get(language)
        },
    }


def _ensure_geo_locale_patch_inputs(
    scenario_dir: Path,
    *,
    scenario_id: str,
    generated_at: str,
) -> dict[str, Path]:
    base_path = scenario_dir / "geo_locale_patch.json"
    base_payload = _load_optional_json(base_path) or _minimal_geo_locale_patch_payload(scenario_id, generated_at)
    base_payload["scenario_id"] = scenario_id
    base_payload["generated_at"] = generated_at
    if not isinstance(base_payload.get("geo"), dict):
        base_payload["geo"] = {}
    write_json(base_path, base_payload)
    language_paths = {
        language: scenario_dir / filename
        for language, filename in SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE.items()
    }
    for language, path in language_paths.items():
        write_json(path, _build_language_geo_locale_patch(base_payload, language))
    return {
        "base": base_path,
        **{language: path for language, path in language_paths.items()},
    }


def _load_layer_payloads_from_manifest(manifest: dict[str, Any]) -> dict[str, dict[str, Any] | None]:
    layer_payloads: dict[str, dict[str, Any] | None] = {}
    for layer_key, raw_url in {
        "water": manifest.get("water_regions_url"),
        "special": manifest.get("special_regions_url"),
        "special_zone_layers": manifest.get("special_zone_layers_url"),
        "relief": manifest.get("relief_overlays_url"),
        "cities": manifest.get("city_overrides_url"),
        "strategic_values": manifest.get("strategic_values_url"),
    }.items():
        value = str(raw_url or "").strip()
        if not value:
            continue
        path = (PROJECT_ROOT / value).resolve()
        if path.exists():
            payload = load_json(path)
            if isinstance(payload, dict):
                layer_payloads[layer_key] = payload
    return layer_payloads


def _count_feature_collection_features(path: Path) -> int:
    payload = _load_optional_json(path)
    features = payload.get("features") if isinstance(payload, dict) else None
    return len(features) if isinstance(features, list) else 0


def _count_runtime_political_features(path: Path) -> int:
    payload = _load_optional_json(path)
    if not isinstance(payload, dict):
        return 0
    geometries = (
        payload.get("objects", {})
        .get("political", {})
        .get("geometries", [])
    )
    return len(geometries) if isinstance(geometries, list) else 0


def _count_detail_chunks(path: Path) -> int:
    payload = _load_optional_json(path)
    chunks = payload.get("chunks") if isinstance(payload, dict) else None
    return len(chunks) if isinstance(chunks, list) else 0


def _collect_snapshot_inputs(
    scenario_dir: Path,
    manifest: dict[str, Any],
) -> dict[str, str]:
    paths = {
        "countries.json": scenario_dir / "countries.json",
        "owners.by_feature.json": scenario_dir / "owners.by_feature.json",
        "cores.by_feature.json": scenario_dir / "cores.by_feature.json",
        "water_regions.geojson": scenario_dir / "water_regions.geojson",
        "runtime_topology.topo.json": scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
        "geo_locale_patch.json": scenario_dir / "geo_locale_patch.json",
    }
    manifest_input_fields = {
        "special_regions_url": "special_regions.geojson",
        "special_zone_layers_url": "special_zone_layers.json",
        "relief_overlays_url": "relief_overlays.geojson",
        "bathymetry_topology_url": "bathymetry.topo.json",
        "city_overrides_url": "city_overrides.json",
        "capital_hints_url": "capital_hints.json",
        "strategic_values_url": SCENARIO_STRATEGIC_VALUES_FILENAME,
        "scenario_atlantropa_topology_url": "scenario_atlantropa.topo.json",
        "scenario_atlantropa_metadata_url": "scenario_atlantropa_metadata.json",
    }
    for field_name, label in manifest_input_fields.items():
        raw_url = str(manifest.get(field_name) or "").strip()
        if not raw_url:
            continue
        public_path = PurePosixPath(raw_url)
        try:
            local_path = public_path.relative_to(PurePosixPath("data/scenarios") / scenario_dir.name)
        except ValueError:
            candidate_path = PROJECT_ROOT.joinpath(*public_path.parts)
        else:
            candidate_path = scenario_dir.joinpath(*local_path.parts).resolve()
            if not candidate_path.is_relative_to(scenario_dir.resolve()):
                raise ValueError(f"Scenario snapshot asset escapes its bundle: {raw_url}")
        paths[label] = candidate_path
    input_sha: dict[str, str] = {}
    for name, path in paths.items():
        if path.exists():
            input_sha[name] = _sha256_path(path)
    return input_sha


def _collect_snapshot_outputs(
    scenario_dir: Path,
    profile_id: str,
) -> dict[str, str]:
    candidate_paths = {
        "runtime_topology.bootstrap.topo.json": scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
        "detail_chunks.manifest.json": scenario_dir / "detail_chunks.manifest.json",
        "context_lod.manifest.json": scenario_dir / "context_lod.manifest.json",
        "runtime_meta.json": scenario_dir / "runtime_meta.json",
        "mesh_pack.json": scenario_dir / "mesh_pack.json",
        "scenario_atlantropa.topo.json": scenario_dir / "scenario_atlantropa.topo.json",
        "scenario_atlantropa_metadata.json": scenario_dir / "scenario_atlantropa_metadata.json",
        TNO_COVERAGE_LEDGER_FILENAMES[0]: scenario_dir / TNO_COVERAGE_LEDGER_FILENAMES[0],
        TNO_COVERAGE_LEDGER_FILENAMES[1]: scenario_dir / TNO_COVERAGE_LEDGER_FILENAMES[1],
        "locales.startup.json": scenario_dir / SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
        "geo_aliases.startup.json": scenario_dir / SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
        SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["en"]: scenario_dir / SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["en"],
        f"{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE['en']}.gz": scenario_dir / f"{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE['en']}.gz",
        SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["zh"]: scenario_dir / SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["zh"],
        f"{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE['zh']}.gz": scenario_dir / f"{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE['zh']}.gz",
    }
    output_sha: dict[str, str] = {}
    for name, path in candidate_paths.items():
        if path.exists():
            output_sha[name] = _sha256_path(path)
    if profile_id == SCENARIO_PROFILE_LIGHTWEIGHT_BASE.profile_id:
        return output_sha
    return output_sha


def _compose_snapshot_payload(
    scenario_dir: Path,
    manifest: dict[str, Any],
    *,
    report_paths: dict[str, object] | None = None,
) -> dict[str, Any]:
    scenario_id = str(manifest.get("scenario_id") or scenario_dir.name).strip() or scenario_dir.name
    profile = resolve_scenario_contract_profile(scenario_id)
    runtime_path = scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME
    water_path = scenario_dir / "water_regions.geojson"
    detail_chunk_manifest_path = scenario_dir / "detail_chunks.manifest.json"
    summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
    feature_count = int(summary.get("feature_count") or _count_runtime_political_features(runtime_path) or 0)
    snapshot_payload = build_scenario_snapshot_payload(
        scenario_id=scenario_id,
        profile_id=profile.profile_id,
        input_sha=_collect_snapshot_inputs(scenario_dir, manifest),
        output_sha=_collect_snapshot_outputs(scenario_dir, profile.profile_id),
        feature_count=feature_count,
        water_count=_count_feature_collection_features(water_path),
        chunk_count=_count_detail_chunks(detail_chunk_manifest_path),
        generated_at=str(manifest.get("generated_at") or "").strip(),
        # build_snapshot.json is checked in with scenario data, so machine-local
        # paths stay out of the persisted payload.
        environment={},
        durations={},
        report_paths={},
        contract_version=SCENARIO_CONTRACT_VERSION,
        builder_version=SCENARIO_BUILDER_VERSION,
    )
    return snapshot_payload


def _build_snapshot_for_scenario(
    scenario_dir: Path,
    manifest: dict[str, Any],
    *,
    report_paths: dict[str, object] | None = None,
) -> dict[str, Any]:
    snapshot_payload = _compose_snapshot_payload(
        scenario_dir,
        manifest,
        report_paths=report_paths,
    )
    snapshot_path = scenario_dir / SCENARIO_BUILD_SNAPSHOT_FILENAME
    write_json(snapshot_path, snapshot_payload)
    return snapshot_payload


def _refresh_audit_payload(
    scenario_dir: Path,
    manifest: dict[str, Any],
    *,
    snapshot_payload: dict[str, Any],
    owner_bucket_mismatch_count: int = 0,
    reverse_coverage_gap_count: int = 0,
) -> dict[str, Any]:
    audit_path = scenario_dir / "audit.json"
    audit_payload = _load_optional_json(audit_path) or {"version": 1}
    audit_payload["scenario_id"] = str(manifest.get("scenario_id") or scenario_dir.name).strip()
    audit_payload["generated_at"] = str(manifest.get("generated_at") or "").strip()
    audit_payload["profile"] = snapshot_payload.get("profile")
    audit_payload["snapshot_fingerprint"] = snapshot_payload.get("snapshot_fingerprint")
    audit_payload["source"] = {
        **(manifest.get("source") if isinstance(manifest.get("source"), dict) else {}),
        "build_snapshot_sha256": _sha256_path(scenario_dir / SCENARIO_BUILD_SNAPSHOT_FILENAME),
    }
    audit_payload["summary"] = copy.deepcopy(
        manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
    )
    audit_payload["artifact_counts"] = {
        "feature_count": snapshot_payload.get("feature_count", 0),
        "water_count": snapshot_payload.get("water_count", 0),
        "chunk_count": snapshot_payload.get("chunk_count", 0),
    }
    audit_payload["owner_bucket_mismatch_count"] = int(owner_bucket_mismatch_count)
    audit_payload["reverse_coverage_gap_count"] = int(reverse_coverage_gap_count)
    write_json(audit_path, audit_payload)
    return audit_payload


def _load_chunk_feature_index(
    scenario_dir: Path,
    *,
    layer_name: str | None = None,
) -> dict[str, dict[str, Any]]:
    detail_manifest = _load_optional_json(scenario_dir / "detail_chunks.manifest.json") or {}
    chunks = detail_manifest.get("chunks") if isinstance(detail_manifest.get("chunks"), list) else []
    by_feature_id: dict[str, dict[str, Any]] = {}
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        chunk_layer = str(chunk.get("layer") or "").strip()
        if layer_name and chunk_layer != layer_name:
            continue
        chunk_url = str(chunk.get("url") or "").strip()
        # A staged bundle keeps public URLs, but its ledgers must inspect the
        # staged chunks rather than similarly named checked-in assets.
        chunk_prefix = PurePosixPath("data/scenarios") / scenario_dir.name
        try:
            chunk_relative = PurePosixPath(chunk_url).relative_to(chunk_prefix)
        except ValueError:
            continue
        chunk_path = scenario_dir.joinpath(*chunk_relative.parts).resolve()
        if not chunk_path.is_relative_to(scenario_dir.resolve()):
            continue
        if chunk_path is None or not chunk_path.exists():
            continue
        chunk_payload = _load_optional_json(chunk_path) or {}
        features = chunk_payload.get("features") if isinstance(chunk_payload.get("features"), list) else []
        chunk_id = str(chunk.get("id") or chunk_path.stem).strip()
        chunk_lod = str(chunk.get("lod") or "").strip()
        for feature in features:
            if not isinstance(feature, dict):
                continue
            feature_id = _feature_id_from_mapping(feature)
            if not feature_id:
                continue
            entry = by_feature_id.setdefault(
                feature_id,
                {
                    "chunk_ids": [],
                    "detail_chunk_ids": [],
                    "feature": None,
                    "feature_source_chunk_id": "",
                },
            )
            entry["chunk_ids"].append(chunk_id)
            if chunk_lod == "detail":
                entry["detail_chunk_ids"].append(chunk_id)
            if entry["feature"] is None or chunk_lod == "detail":
                entry["feature"] = feature
                entry["feature_source_chunk_id"] = chunk_id
    return by_feature_id


def _round_bbox(bbox: list[float] | None) -> list[float] | None:
    if bbox is None:
        return None
    return [round(float(value), 6) for value in bbox[:4]]


def _atlantropa_feature_row(
    geometry: dict[str, Any],
    chunk_entry: dict[str, Any] | None,
) -> dict[str, Any]:
    props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
    feature_id = str(props.get("id") or geometry.get("id") or "").strip()
    feature = chunk_entry.get("feature") if isinstance(chunk_entry, dict) else None
    feature_geometry = feature.get("geometry") if isinstance(feature, dict) else None
    bbox = _geometry_bbox(feature_geometry)
    chunk_ids = sorted(str(chunk_id) for chunk_id in (chunk_entry or {}).get("chunk_ids", []) if str(chunk_id).strip())
    detail_chunk_ids = sorted(
        str(chunk_id) for chunk_id in (chunk_entry or {}).get("detail_chunk_ids", []) if str(chunk_id).strip()
    )
    prefix = _coverage_prefix_for_feature_id(feature_id)
    donor_provinces = props.get("donor_province_ids")
    donor_states = props.get("donor_state_ids")
    donor_provinces = list(donor_provinces) if isinstance(donor_provinces, (list, tuple)) else []
    donor_states = list(donor_states) if isinstance(donor_states, (list, tuple)) else []
    provenance = "donor_metadata" if donor_provinces else "unknown"
    if not donor_provinces and feature_id.startswith("ATLPRV_") and feature_id[7:].isdigit():
        donor_provinces = [int(feature_id[7:])]
        provenance = "stable_province_id"
    return {
        "feature_id": feature_id,
        "prefix": prefix,
        "source_kind": str(props.get("__source") or "").strip(),
        "donor_basin": str(props.get("admin1_group") or props.get("region_group") or "").strip(),
        "donor_state": ",".join(map(str, donor_states)),
        "donor_province": ",".join(map(str, donor_provinces)),
        "donor_state_ids": donor_states,
        "donor_province_ids": donor_provinces,
        "donor_provenance": provenance,
        "role": str(props.get("atl_geometry_role") or "").strip(),
        "join_mode": str(props.get("atl_join_mode") or "").strip(),
        "surface_kind": str(props.get("atl_surface_kind") or "").strip(),
        "render_layer": str(props.get("atl_render_layer") or "").strip(),
        "color_rule": str(props.get("atl_color_rule") or "").strip(),
        "interactive": props.get("atl_interactive") is True,
        "runtime_present": True,
        "chunk_present": bool(detail_chunk_ids or chunk_ids),
        "chunk_ids": detail_chunk_ids or chunk_ids,
        "bbox": _round_bbox(bbox),
        "planar_area": round(_geometry_planar_area(feature_geometry), 6),
        "drop_reason": "" if detail_chunk_ids or chunk_ids else "missing_scenario_atlantropa_chunk",
        "_probe_geometry": feature_geometry,
    }


def _build_basin_probe_rows(feature_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    probe_rows: list[dict[str, Any]] = []
    for probe in TNO_ATLANTROPA_BASIN_PROBES:
        expected_prefixes = set(probe["expected_prefixes"])
        bbox_candidates = [
            row
            for row in feature_rows
            if row.get("prefix") in expected_prefixes
            and _bbox_intersects(row.get("bbox"), probe["bbox"])
        ]
        matches = [
            row
            for row in bbox_candidates
            if _geometry_intersects_bbox(row.get("_probe_geometry"), probe["bbox"])
        ]
        chunk_missing = sorted(str(row["feature_id"]) for row in matches if not row.get("chunk_present"))
        failure_reasons = []
        if not bbox_candidates:
            failure_reasons.append("no_matching_atlantropa_feature_bbox")
        elif not matches:
            failure_reasons.append("no_matching_atlantropa_feature_geometry")
        if chunk_missing:
            failure_reasons.append("matching_features_missing_detail_chunk")
        probe_rows.append(
            {
                "id": probe["id"],
                "label": probe["label"],
                "bbox": list(probe["bbox"]),
                "expected_prefixes": sorted(expected_prefixes),
                "matching_feature_ids": sorted(str(row["feature_id"]) for row in matches)[:50],
                "match_count": len(matches),
                "bbox_candidate_count": len(bbox_candidates),
                "chunk_missing_feature_ids": chunk_missing[:50],
                "ok": not failure_reasons,
                "failure_reasons": failure_reasons,
            }
        )
    return probe_rows


def _public_atlantropa_feature_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if not key.startswith("_")}


def _build_atlantropa_donor_ledger(
    scenario_dir: Path,
    manifest: dict[str, Any],
    runtime_payload: dict[str, Any],
) -> dict[str, Any]:
    metadata_path = scenario_dir / "scenario_atlantropa_metadata.json"
    detail_manifest_path = scenario_dir / "detail_chunks.manifest.json"
    chunk_index = _load_chunk_feature_index(scenario_dir, layer_name=SCENARIO_ATLANTROPA_LAYER_KEY)
    geometries = _runtime_object_geometries(runtime_payload, SCENARIO_ATLANTROPA_OBJECT_NAME)
    feature_rows = [
        _atlantropa_feature_row(geometry, chunk_index.get(_feature_id_from_mapping(geometry)))
        for geometry in geometries
    ]
    prefix_counts: dict[str, int] = defaultdict(int)
    for row in feature_rows:
        prefix = str(row.get("prefix") or "").strip()
        if prefix:
            prefix_counts[prefix] += 1
    basin_probes = _build_basin_probe_rows(feature_rows)
    missing_chunk_ids = sorted(str(row["feature_id"]) for row in feature_rows if not row.get("chunk_present"))
    metadata = _load_optional_json(metadata_path) or {}
    return {
        "version": 1,
        "scenario_id": scenario_dir.name,
        "generated_at": str(manifest.get("generated_at") or "").strip(),
        "source": {
            "runtime_topology_sha256": _sha256_path(scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME),
            "scenario_atlantropa_metadata_sha256": _sha256_path(metadata_path) if metadata_path.exists() else "",
            "detail_chunk_manifest_sha256": _sha256_path(detail_manifest_path) if detail_manifest_path.exists() else "",
        },
        "protected_prefixes": list(TNO_PROTECTED_COVERAGE_PREFIXES),
        "summary": {
            "runtime_feature_count": len(feature_rows),
            "chunk_feature_count": len({feature_id for feature_id, entry in chunk_index.items() if entry.get("feature") is not None}),
            "interactive_feature_count": len([row for row in feature_rows if row.get("interactive")]),
            "prefix_counts": dict(sorted(prefix_counts.items())),
            "metadata_prefix_counts": metadata.get("prefix_counts") if isinstance(metadata.get("prefix_counts"), dict) else {},
            "missing_chunk_count": len(missing_chunk_ids),
            "basin_probe_count": len(basin_probes),
            "basin_probe_failure_count": len([probe for probe in basin_probes if not probe.get("ok")]),
        },
        "basin_probes": basin_probes,
        "missing_chunk_feature_ids": missing_chunk_ids[:100],
        "features": sorted(
            (_public_atlantropa_feature_row(row) for row in feature_rows),
            key=lambda row: str(row.get("feature_id") or ""),
        ),
    }


def _prefix_counts_for_ids(feature_ids: set[str]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for feature_id in feature_ids:
        prefix = _coverage_prefix_for_feature_id(feature_id)
        if prefix:
            counts[prefix] += 1
    return dict(sorted(counts.items()))


def _protected_ids_from_mappings(*mappings: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for mapping in mappings:
        for feature_id in mapping.keys():
            normalized = str(feature_id or "").strip()
            if _coverage_prefix_for_feature_id(normalized):
                ids.add(normalized)
    return ids


def _protected_ids_from_runtime_geometries(geometries: list[dict[str, Any]]) -> set[str]:
    return {
        feature_id
        for feature_id in (_feature_id_from_mapping(geometry) for geometry in geometries)
        if _coverage_prefix_for_feature_id(feature_id)
    }


def _build_geometry_drop_audit(
    scenario_dir: Path,
    manifest: dict[str, Any],
    runtime_payload: dict[str, Any],
) -> dict[str, Any]:
    owners = (_load_optional_json(scenario_dir / "owners.by_feature.json") or {}).get("owners")
    cores = (_load_optional_json(scenario_dir / "cores.by_feature.json") or {}).get("cores")
    owners = owners if isinstance(owners, dict) else {}
    cores = cores if isinstance(cores, dict) else {}
    runtime_political_geometries = _runtime_object_geometries(runtime_payload, "political")
    runtime_atlantropa_geometries = _runtime_object_geometries(runtime_payload, SCENARIO_ATLANTROPA_OBJECT_NAME)
    runtime_political_ids = _protected_ids_from_runtime_geometries(runtime_political_geometries)
    runtime_atlantropa_ids = _protected_ids_from_runtime_geometries(runtime_atlantropa_geometries)
    runtime_props_by_id = {
        _feature_id_from_mapping(geometry): geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
        for geometry in runtime_political_geometries + runtime_atlantropa_geometries
        if _coverage_prefix_for_feature_id(_feature_id_from_mapping(geometry))
    }
    bootstrap_payload = _load_optional_json(scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME) or {}
    bootstrap_ids = _protected_ids_from_runtime_geometries(_runtime_object_geometries(bootstrap_payload, "political"))
    bootstrap_ids.update(_protected_ids_from_runtime_geometries(_runtime_object_geometries(bootstrap_payload, SCENARIO_ATLANTROPA_OBJECT_NAME)))
    chunk_index = _load_chunk_feature_index(scenario_dir)
    chunk_ids = {feature_id for feature_id in chunk_index.keys() if _coverage_prefix_for_feature_id(feature_id)}
    owner_ids = _protected_ids_from_mappings(owners)
    core_ids = _protected_ids_from_mappings(cores)
    protected_ids = sorted(runtime_political_ids | runtime_atlantropa_ids | bootstrap_ids | chunk_ids | owner_ids | core_ids)
    rows: list[dict[str, Any]] = []
    for feature_id in protected_ids:
        prefix = _coverage_prefix_for_feature_id(feature_id)
        runtime_stage = feature_id in runtime_political_ids or feature_id in runtime_atlantropa_ids
        owner_core_stage = feature_id in owner_ids and feature_id in core_ids
        bootstrap_stage = feature_id in bootstrap_ids
        chunk_stage = feature_id in chunk_ids
        props = runtime_props_by_id.get(feature_id, {})
        expected_stages = ["runtime", "detail_chunk"]
        if prefix == "RU_ARCTIC_FB_":
            expected_stages.append("startup_bootstrap")
        else:
            expected_stages.append("owner_core")
        present_by_stage = {
            "runtime": runtime_stage,
            "owner_core": owner_core_stage,
            "startup_bootstrap": bootstrap_stage,
            "detail_chunk": chunk_stage,
        }
        missing_stages = [stage for stage in expected_stages if not present_by_stage.get(stage)]
        source_area = props.get("source_fragment_area")
        final_area = props.get("retained_fragment_area")
        try:
            source_area_float = float(source_area)
        except (TypeError, ValueError):
            source_area_float = None
        try:
            final_area_float = float(final_area)
        except (TypeError, ValueError):
            final_area_float = None
        rows.append(
            {
                "feature_id": feature_id,
                "prefix": prefix,
                "expected_stages": expected_stages,
                "present": present_by_stage,
                "missing_stages": missing_stages,
                "drop_reason": ",".join(missing_stages),
                "source_area": source_area_float,
                "final_area": final_area_float,
                "area_delta": round(final_area_float - source_area_float, 6)
                if source_area_float is not None and final_area_float is not None
                else None,
                "owner_hint_present": bool(props.get("scenario_shell_owner_hint")),
                "controller_hint_present": bool(props.get("scenario_shell_controller_hint")),
                "visual_only": props.get("interactive") is False and props.get("render_as_base_geography") is False,
            }
        )
    drop_rows = [row for row in rows if row["missing_stages"]]
    stages = {
        "runtime_political": _prefix_counts_for_ids(runtime_political_ids),
        "runtime_atlantropa": _prefix_counts_for_ids(runtime_atlantropa_ids),
        "startup_bootstrap": _prefix_counts_for_ids(bootstrap_ids),
        "owner_core": _prefix_counts_for_ids(owner_ids & core_ids),
        "detail_chunk": _prefix_counts_for_ids(chunk_ids),
    }
    return {
        "version": 1,
        "scenario_id": scenario_dir.name,
        "generated_at": str(manifest.get("generated_at") or "").strip(),
        "protected_prefixes": list(TNO_PROTECTED_COVERAGE_PREFIXES),
        "summary": {
            "protected_feature_count": len(rows),
            "protected_prefix_drop_count": len(drop_rows),
            "runtime_only_shell_count": len([row for row in rows if row["prefix"] == "RU_ARCTIC_FB_"]),
            "polar_feature_count": len([row for row in rows if row["prefix"] == "AQ"]),
        },
        "stages": stages,
        "features": rows,
        "drop_rows": drop_rows[:100],
        "polar_gate_ref": "verify:tno-polar-coverage",
    }


def write_tno_coverage_ledgers(
    scenario_dir: Path,
    manifest: dict[str, Any],
) -> dict[str, str]:
    if scenario_dir.name != "tno_1962":
        return {}
    runtime_payload = load_json(scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME)
    derived_dir = scenario_dir / TNO_COVERAGE_DERIVED_DIRNAME
    derived_dir.mkdir(parents=True, exist_ok=True)
    ledger_path = derived_dir / TNO_ATLANTROPA_DONOR_LEDGER_FILENAME
    drop_audit_path = derived_dir / TNO_GEOMETRY_DROP_AUDIT_FILENAME
    write_json(ledger_path, _build_atlantropa_donor_ledger(scenario_dir, manifest, runtime_payload))
    write_json(drop_audit_path, _build_geometry_drop_audit(scenario_dir, manifest, runtime_payload))
    ledger_hashes = {
        "atlantropa_donor_ledger": _sha256_path(ledger_path),
        "geometry_drop_audit": _sha256_path(drop_audit_path),
    }
    runtime_meta_path = scenario_dir / "runtime_meta.json"
    runtime_meta = _load_optional_json(runtime_meta_path) or {
        "version": 1,
        "scenario_id": scenario_dir.name,
    }
    runtime_meta["coverage_ledger_hashes"] = ledger_hashes
    runtime_meta["coverage_ledger_paths"] = {
        "atlantropa_donor_ledger": f"data/scenarios/{scenario_dir.name}/{TNO_COVERAGE_LEDGER_FILENAMES[0]}",
        "geometry_drop_audit": f"data/scenarios/{scenario_dir.name}/{TNO_COVERAGE_LEDGER_FILENAMES[1]}",
    }
    runtime_meta["coverage_report_paths"] = dict(TNO_COVERAGE_REPORT_PATHS)
    write_json(runtime_meta_path, runtime_meta)
    return ledger_hashes


def apply_safe_scenario_contract_repairs(
    scenario_dir: Path,
    *,
    report_path: Path | None = None,
    rebuild_chunk_assets: bool = True,
) -> list[str]:
    manifest_path = scenario_dir / "manifest.json"
    manifest = load_json(manifest_path)
    scenario_id = str(manifest.get("scenario_id") or scenario_dir.name).strip() or scenario_dir.name
    profile = resolve_scenario_contract_profile(scenario_id)
    generated_at = str(manifest.get("generated_at") or "").strip()
    if not generated_at:
        raise ValueError("manifest.generated_at is required for --write-safe repairs.")
    runtime_topology_path = scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME
    if not runtime_topology_path.exists():
        raise FileNotFoundError(f"Missing runtime topology for safe repair: {runtime_topology_path}")

    safe_fixes_applied: list[str] = []
    # safe repair 是“从现有 authoring 输入重新物化派生产物”的车道。
    # 它负责把缺失或过期的派生产物补齐，但继续把数据语义冲突留给 strict gate 明确报错。
    # --write-safe 只允许重建“可推导且幂等”的派生产物：
    # manifest 补字段、startup support、chunk assets、startup bundles、audit/snapshot。
    # 需要人工判断的数据语义问题仍然通过 strict error 暴露，不在这里悄悄兜底。
    geo_patch_required = bool(
        profile.expect_startup_assets
        or str(manifest.get(SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD) or "").strip()
        or any(str(manifest.get(field_name) or "").strip() for field_name in SCENARIO_GEO_LOCALE_PATCH_MANIFEST_LANGUAGE_FIELDS.values())
    )
    geo_patch_paths: dict[str, Path] = {}
    if geo_patch_required:
        geo_patch_paths = _ensure_geo_locale_patch_inputs(
            scenario_dir,
            scenario_id=scenario_id,
            generated_at=generated_at,
        )
        safe_fixes_applied.append("geo_locale_patch_inputs")

    runtime_topology_url = str(
        manifest.get("runtime_topology_url")
        or f"data/scenarios/{scenario_id}/{SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME}"
    ).strip()
    manifest["runtime_topology_url"] = runtime_topology_url

    if profile.expect_runtime_bootstrap or profile.expect_startup_assets:
        runtime_bootstrap_path = scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME
        startup_support_whitelist_path = scenario_dir / "derived" / "startup_support_whitelist.json"
        build_startup_bootstrap_assets(
            base_topology_path=PROJECT_ROOT / profile.startup_support_base_topology,
            full_locales_path=PROJECT_ROOT / "data/locales.json",
            full_geo_aliases_path=PROJECT_ROOT / "data/geo_aliases.json",
            full_runtime_topology_path=runtime_topology_path,
            scenario_geo_patch_path=geo_patch_paths["base"],
            runtime_bootstrap_output_path=runtime_bootstrap_path,
            startup_locales_output_path=scenario_dir / SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
            startup_geo_aliases_output_path=scenario_dir / SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
            startup_support_whitelist_path=(
                startup_support_whitelist_path if startup_support_whitelist_path.exists() else None
            ),
        )
        runtime_bootstrap_url = f"data/scenarios/{scenario_id}/{SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME}"
        manifest["runtime_bootstrap_topology_url"] = runtime_bootstrap_url
        manifest["startup_topology_url"] = runtime_bootstrap_url
        safe_fixes_applied.append("startup_support_assets")

    if geo_patch_required:
        for language, field_name in SCENARIO_GEO_LOCALE_PATCH_MANIFEST_LANGUAGE_FIELDS.items():
            manifest[field_name] = f"data/scenarios/{scenario_id}/{SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE[language]}"
        manifest[SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD] = f"data/scenarios/{scenario_id}/geo_locale_patch.json"
    manifest["audit_url"] = str(manifest.get("audit_url") or f"data/scenarios/{scenario_id}/audit.json").strip()
    layer_payloads = _load_layer_payloads_from_manifest(manifest)
    if profile.expect_chunk_assets and rebuild_chunk_assets:
        runtime_bootstrap_payload = load_json(scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME)
        runtime_topology_payload = load_json(runtime_topology_path)
        build_and_write_scenario_chunk_assets(
            scenario_dir=scenario_dir,
            manifest_payload=manifest,
            layer_payloads=layer_payloads,
            startup_topology_payload=runtime_bootstrap_payload,
            runtime_topology_payload=runtime_topology_payload,
            startup_topology_url=str(manifest.get("startup_topology_url") or "").strip(),
            runtime_topology_url=runtime_topology_url,
            generated_at=generated_at,
        )
        safe_fixes_applied.append("chunk_assets")

    if scenario_id == "tno_1962":
        write_tno_coverage_ledgers(
            scenario_dir,
            manifest,
        )
        safe_fixes_applied.append("coverage_ledgers")

    if profile.expect_startup_assets:
        for language, field_name in SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS.items():
            manifest[field_name] = f"data/scenarios/{scenario_id}/{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE[language]}"
        write_json(manifest_path, manifest)
        build_startup_bundles(
            scenario_manifest_path=manifest_path,
            data_manifest_path=PROJECT_ROOT / "data/manifest.json",
            topology_primary_path=PROJECT_ROOT / "data/europe_topology.json",
            startup_locales_path=scenario_dir / SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
            geo_aliases_path=scenario_dir / SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
            full_runtime_topology_path=runtime_topology_path,
            runtime_bootstrap_topology_path=scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
            countries_path=scenario_dir / "countries.json",
            owners_path=scenario_dir / "owners.by_feature.json",
            cores_path=scenario_dir / "cores.by_feature.json",
            geo_locale_patch_en_path=geo_patch_paths["en"],
            geo_locale_patch_zh_path=geo_patch_paths["zh"],
            output_en_path=scenario_dir / SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["en"],
            output_zh_path=scenario_dir / SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["zh"],
            detail_chunk_manifest_path=(scenario_dir / "detail_chunks.manifest.json")
            if (scenario_dir / "detail_chunks.manifest.json").exists()
            else None,
            report_path=None,
        )
        safe_fixes_applied.append("startup_bundles")

    manifest["scenario_contract_profile"] = profile.profile_id
    manifest["source"] = {
        **(manifest.get("source") if isinstance(manifest.get("source"), dict) else {}),
        "base_topology_sha256": _sha256_path(PROJECT_ROOT / "data" / "europe_topology.json"),
        "runtime_topology_sha256": _sha256_path(runtime_topology_path),
    }
    runtime_bootstrap_path = scenario_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME
    if runtime_bootstrap_path.exists():
        manifest["source"]["runtime_bootstrap_topology_sha256"] = _sha256_path(runtime_bootstrap_path)
    detail_chunk_manifest_path = scenario_dir / "detail_chunks.manifest.json"
    if detail_chunk_manifest_path.exists():
        manifest["source"]["detail_chunk_manifest_sha256"] = _sha256_path(detail_chunk_manifest_path)

    write_json(manifest_path, manifest)
    snapshot_payload = _build_snapshot_for_scenario(
        scenario_dir,
        manifest,
        report_paths={"validation_report": str(report_path) if report_path else ""},
    )
    manifest["snapshot_fingerprint"] = snapshot_payload["snapshot_fingerprint"]
    write_json(manifest_path, manifest)
    _refresh_audit_payload(scenario_dir, manifest, snapshot_payload=snapshot_payload)
    safe_fixes_applied.extend(["build_snapshot", "audit_sync", "manifest_source_sync"])
    return safe_fixes_applied


# Compatibility alias for older tests and scripts. New callers should import the
# public name above so repair ownership stays visible at the module boundary.
_apply_safe_repairs = apply_safe_scenario_contract_repairs


def _capture_safe_repair_hashes(scenario_dir: Path) -> dict[str, str]:
    tracked_paths = [
        "manifest.json",
        "audit.json",
        SCENARIO_BUILD_SNAPSHOT_FILENAME,
        "geo_locale_patch.json",
        SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE["en"],
        SCENARIO_GEO_LOCALE_PATCH_FILENAMES_BY_LANGUAGE["zh"],
        SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
        SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
        SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
        SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["en"],
        f"{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE['en']}.gz",
        SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["zh"],
        f"{SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE['zh']}.gz",
        "detail_chunks.manifest.json",
        "context_lod.manifest.json",
        "runtime_meta.json",
        "mesh_pack.json",
        *TNO_COVERAGE_LEDGER_FILENAMES,
    ]
    hashes: dict[str, str] = {}
    for relative_path in tracked_paths:
        path = scenario_dir / relative_path
        if path.exists():
            hashes[relative_path.replace("\\", "/")] = _sha256_path(path)
    chunks_dir = scenario_dir / "chunks"
    if chunks_dir.exists():
        for chunk_path in sorted(chunks_dir.rglob("*.json")):
            hashes[str(chunk_path.relative_to(scenario_dir)).replace("\\", "/")] = _sha256_path(chunk_path)
    return hashes


def _classify_violation(message: str) -> str:
    risky_markers = (
        "owners/cores feature keysets",
        "runtime_topology is missing feature ids",
        "missing owners.by_feature ownership",
        "missing scenario_shell_owner_hint",
        "owner/controller hints",
    )
    if any(marker in message for marker in risky_markers):
        return "risky"
    safe_markers = (
        "detail chunk",
        "detail political feature",
        "detail political chunk union",
        "political detail chunk feature ids",
        "runtime_bootstrap_topology_url",
        "startup_topology_url",
        "startup_bundle_url",
        "detail_chunks.manifest.json",
        "audit.json",
        "build_snapshot.json",
        "manifest.source.",
        "manifest.summary.feature_count",
        "startup bundle",
        "startup support",
        "coverage ledger",
        "atlantropa donor ledger",
        "geometry_drop_audit",
        "protected prefix coverage",
        "basin probes",
        "runtime_meta.json coverage_ledger",
    )
    if any(marker in message for marker in safe_markers):
        return "safe"
    return "forbidden"


def _materialize_violation_report(report: dict[str, Any]) -> None:
    violations: list[dict[str, Any]] = []
    risky: list[str] = []
    forbidden: list[str] = []
    safe_count = 0
    for index, error in enumerate(report.get("errors", []), start=1):
        fix_class = _classify_violation(str(error))
        if fix_class == "safe":
            safe_count += 1
        elif fix_class == "risky":
            risky.append(str(error))
        else:
            forbidden.append(str(error))
        violations.append(
            {
                "index": index,
                "severity": "error",
                "fix_class": fix_class,
                "message": str(error),
            }
        )
    report["violations"] = violations
    report["safe_fixable"] = safe_count > 0 and not risky and not forbidden
    report["risky_fixes_required"] = risky
    report["forbidden_violations"] = forbidden


def discover_scenario_dirs(scenarios_root: Path, explicit_dirs: list[str]) -> list[Path]:
    if explicit_dirs:
        return sorted(Path(raw).resolve() for raw in explicit_dirs)
    return sorted(
        path.resolve()
        for path in scenarios_root.iterdir()
        if path.is_dir() and path.name not in IGNORED_DIR_NAMES
    )


def scenario_relative_url_to_path(raw_url: str) -> Path | None:
    if not str(raw_url or "").strip():
        return None
    posix_path = PurePosixPath(str(raw_url).strip())
    return PROJECT_ROOT.joinpath(*posix_path.parts)


def normalize_featured_tags(manifest: dict) -> list[str]:
    tags: list[str] = []
    for raw in manifest.get("featured_tags") or []:
        tag = str(raw or "").strip().upper()
        if tag:
            tags.append(tag)
    return tags


def scenario_requires_public_capital_hints(expected_scenario_id: str) -> bool:
    return expected_scenario_id not in cfg.SCENARIO_IDS_WITHOUT_PUBLIC_CAPITAL_HINTS


def validate_manifest_version_matrix(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    version = manifest.get("version")
    if version not in (1, 2):
        errors.append(f"manifest.version must be 1 or 2. Found {version!r}.")
        return

    for field in COMMON_REQUIRED_MANIFEST_FIELDS:
        if not has_value(manifest.get(field)):
            errors.append(f"manifest.{field} must be present.")

    if version == 1:
        drift_fields = [field for field in V2_REQUIRED_MANIFEST_FIELDS if has_value(manifest.get(field))]
        if drift_fields:
            errors.append(
                "manifest.version 1 must not declare v2-only fields. "
                f"Found: {', '.join(drift_fields)}."
            )
        return

    missing_v2 = [field for field in V2_REQUIRED_MANIFEST_FIELDS if not has_value(manifest.get(field))]
    if scenario_requires_public_capital_hints(expected_scenario_id) and not has_value(manifest.get("capital_hints_url")):
        missing_v2.append("capital_hints_url")
    if missing_v2:
        errors.append(
            "manifest.version 2 must include all required v2 fields. "
            f"Missing: {', '.join(missing_v2)}."
        )
    if not scenario_requires_public_capital_hints(expected_scenario_id) and has_value(manifest.get("capital_hints_url")):
        errors.append(
            "Scenarios without public capital hints must not declare manifest.capital_hints_url."
        )
    if has_value(manifest.get("performance_hints")) and not isinstance(manifest.get("performance_hints"), dict):
        errors.append("manifest.performance_hints must be an object for version 2.")
    if has_value(manifest.get("style_defaults")) and not isinstance(manifest.get("style_defaults"), dict):
        errors.append("manifest.style_defaults must be an object for version 2.")


def validate_manifest_urls(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    for key, raw_value in manifest.items():
        if not key.endswith("_url"):
            continue
        url = str(raw_value or "").strip()
        if not url:
            continue
        if not url.startswith("data/scenarios/"):
            continue
        posix_path = PurePosixPath(url)
        if len(posix_path.parts) < 3:
            errors.append(f"manifest.{key} must point at data/scenarios/<scenario_id>/..., found `{url}`.")
            continue
        actual_dir = posix_path.parts[2]
        if actual_dir != expected_scenario_id:
            errors.append(
                f"manifest.{key} must point at scenario directory `{expected_scenario_id}`. "
                f"Found `{actual_dir}` via `{url}`."
            )


def validate_water_regions_mode(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    raw_mode = manifest.get("water_regions_mode")
    if raw_mode is None or raw_mode == "":
        return
    mode = str(raw_mode).strip().lower()
    if mode not in WATER_REGIONS_MODE_VALUES:
        errors.append(
            "manifest.water_regions_mode must be one of "
            f"{sorted(WATER_REGIONS_MODE_VALUES)}. Found {raw_mode!r}."
        )
        return
    if expected_scenario_id == "tno_1962" and mode != "exclusive":
        errors.append("manifest.water_regions_mode must be 'exclusive' for tno_1962.")


def validate_special_zone_layers(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    raw_url = str(manifest.get("special_zone_layers_url") or "").strip()
    if not raw_url:
        errors.append("manifest.special_zone_layers_url is required for layer-based special zones.")
        return
    path = scenario_relative_url_to_path(raw_url)
    if path is None or not path.exists():
        errors.append(f"special_zone_layers_url target must exist. Missing: {raw_url}")
        return
    payload = load_json(path)
    if not isinstance(payload, dict):
        errors.append("special_zone_layers.json must be a JSON object.")
        return
    if int(payload.get("version") or 0) != 1:
        errors.append("special_zone_layers.json version must be 1.")
    layers = payload.get("layers")
    if not isinstance(layers, list):
        errors.append("special_zone_layers.json layers must be an array.")
        return
    active_layer_id = str(payload.get("activeLayerId") or "").strip()
    layer_ids: set[str] = set()
    owners_path = PROJECT_ROOT / "data" / "scenarios" / expected_scenario_id / "owners.by_feature.json"
    known_feature_ids: set[str] = set()
    if owners_path.exists():
        owners_payload = load_json(owners_path)
        owners = owners_payload.get("owners") if isinstance(owners_payload, dict) else None
        if isinstance(owners, dict):
            known_feature_ids = {str(feature_id).strip() for feature_id in owners if str(feature_id).strip()}
    for index, layer in enumerate(layers):
        if not isinstance(layer, dict):
            errors.append(f"special_zone_layers.json layer {index} must be an object.")
            continue
        layer_id = str(layer.get("id") or "").strip()
        if not layer_id:
            errors.append(f"special_zone_layers.json layer {index} is missing id.")
            continue
        if layer_id in layer_ids:
            errors.append(f"special_zone_layers.json duplicate layer id: {layer_id}.")
        layer_ids.add(layer_id)
        if str(layer.get("source") or "").strip() not in {"project", "scenario"}:
            errors.append(f"special_zone_layers.json layer {layer_id} has invalid source.")
        if not isinstance(layer.get("style"), dict):
            errors.append(f"special_zone_layers.json layer {layer_id} style must be an object.")
        member_ids = layer.get("memberFeatureIds")
        if not isinstance(member_ids, list):
            errors.append(f"special_zone_layers.json layer {layer_id} memberFeatureIds must be an array.")
            continue
        invalid_ids = sorted({
            str(feature_id).strip()
            for feature_id in member_ids
            if str(feature_id).strip() and known_feature_ids and str(feature_id).strip() not in known_feature_ids
        })
        if invalid_ids:
            errors.append(f"special_zone_layers.json layer {layer_id} references unknown feature ids: {invalid_ids[:10]}.")
    if active_layer_id and active_layer_id not in layer_ids:
        errors.append("special_zone_layers.json activeLayerId must match an existing layer id.")


def validate_runtime_capitals(expected_scenario_id: str, manifest: dict, errors: list[str]) -> None:
    city_overrides_url = str(manifest.get("city_overrides_url") or "").strip()
    if not city_overrides_url:
        return
    city_overrides_path = scenario_relative_url_to_path(city_overrides_url)
    if city_overrides_path is None or not city_overrides_path.exists():
        errors.append(f"city_overrides_url target must exist. Missing: {city_overrides_url}")
        return

    try:
        payload = load_json(city_overrides_path)
    except Exception as exc:
        errors.append(str(exc))
        return
    payload_scenario_id = str(payload.get("scenario_id") or "").strip()
    if payload_scenario_id and payload_scenario_id != expected_scenario_id:
        errors.append(
            f"city_overrides.json scenario_id must be `{expected_scenario_id}`. Found `{payload_scenario_id}`."
        )

    capitals_by_tag = payload.get("capitals_by_tag")
    capital_city_hints = payload.get("capital_city_hints")
    if not isinstance(capitals_by_tag, dict):
        errors.append("city_overrides.json capitals_by_tag must be an object.")
        return
    if not isinstance(capital_city_hints, dict):
        errors.append("city_overrides.json capital_city_hints must be an object.")
        return

    country_tags: set[str] = set()
    countries_url = str(manifest.get("countries_url") or "").strip()
    countries_path = scenario_relative_url_to_path(countries_url) if countries_url else None
    if countries_path is not None and countries_path.exists():
        try:
            countries_payload = load_json(countries_path)
            countries = countries_payload.get("countries")
            if isinstance(countries, dict):
                country_tags = {
                    normalize_scenario_contract_tag(tag)
                    for tag in countries.keys()
                    if normalize_scenario_contract_tag(tag)
                }
        except Exception as exc:
            errors.append(str(exc))

    if country_tags and expected_scenario_id == "tno_1962":
        invalid_capital_tags = sorted(
            tag
            for tag in capitals_by_tag.keys()
            if normalize_scenario_contract_tag(tag) not in country_tags
        )
        invalid_hint_tags = sorted(
            tag
            for tag in capital_city_hints.keys()
            if normalize_scenario_contract_tag(tag) not in country_tags
        )
        invalid_hint_entry_tags = sorted(
            f"{tag}:{entry.get('tag')}"
            for tag, entry in capital_city_hints.items()
            if isinstance(entry, dict)
            and normalize_scenario_contract_tag(entry.get("tag")) not in country_tags
        )
        if invalid_capital_tags:
            errors.append(f"city_overrides.json capitals_by_tag has tags missing from countries.json: {invalid_capital_tags[:20]}.")
        if invalid_hint_tags:
            errors.append(f"city_overrides.json capital_city_hints has tags missing from countries.json: {invalid_hint_tags[:20]}.")
        if invalid_hint_entry_tags:
            errors.append(f"city_overrides.json capital_city_hints entries must tag registered countries: {invalid_hint_entry_tags[:20]}.")

    featured_tags = normalize_featured_tags(manifest)
    missing_tags = [
        tag
        for tag in featured_tags
        if tag not in capitals_by_tag and tag not in capital_city_hints
    ]
    if missing_tags:
        errors.append(
            "Every manifest.featured_tag must be resolvable from city_overrides.json "
            "capitals_by_tag or capital_city_hints. "
            f"Missing: {missing_tags[:20]}."
        )

    capital_hints_url = str(manifest.get("capital_hints_url") or "").strip()
    if not capital_hints_url and not scenario_requires_public_capital_hints(expected_scenario_id):
        return
    if not capital_hints_url:
        return
    capital_hints_path = scenario_relative_url_to_path(capital_hints_url)
    if capital_hints_path is None or not capital_hints_path.exists():
        errors.append(f"capital_hints_url target must exist. Missing: {capital_hints_url}")
        return
    try:
        capital_hints_payload = load_json(capital_hints_path)
    except Exception as exc:
        errors.append(str(exc))
        return
    capital_hints_scenario_id = str(capital_hints_payload.get("scenario_id") or "").strip()
    if capital_hints_scenario_id and capital_hints_scenario_id != expected_scenario_id:
        errors.append(
            f"capital_hints.json scenario_id must be `{expected_scenario_id}`. Found `{capital_hints_scenario_id}`."
        )


def validate_internal_authoring_inputs(expected_scenario_id: str, errors: list[str]) -> None:
    if scenario_requires_public_capital_hints(expected_scenario_id):
        return
    scenario_dir = PROJECT_ROOT / "data" / "scenarios" / expected_scenario_id
    required_paths = (
        scenario_dir / "scenario_mutations.json",
        scenario_dir / cfg.SCENARIO_CITY_ASSETS_PARTIAL_FILENAME,
        scenario_dir / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME,
    )
    missing_paths = [path.name for path in required_paths if not path.exists()]
    if missing_paths:
        errors.append(
            "Scenarios without public capital hints must check in canonical authoring inputs. "
            f"Missing: {', '.join(missing_paths)}."
        )
    legacy_capital_hints_path = scenario_dir / cfg.SCENARIO_CAPITAL_HINTS_FILENAME
    if legacy_capital_hints_path.exists():
        errors.append(
            "Scenarios without public capital hints must not check in legacy capital_hints.json."
        )


def validate_locale_patch(
    expected_scenario_id: str,
    manifest: dict,
    errors: list[str],
    warnings: list[str],
    strict: bool = False,
    repair_tracks: dict[str, Any] | None = None,
) -> None:
    def _parse_audit_count(audit_payload: dict[str, Any], field: str, fallback: int) -> int:
        raw_value = audit_payload.get(field)
        if raw_value in (None, ""):
            return fallback
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            warning_key = f"{field}:{fallback}"
            if warning_key not in warned_invalid_audit_counts:
                warnings.append(
                    f"audit.{field} must be numeric when present; using fallback value {fallback}."
                )
                warned_invalid_audit_counts.add(warning_key)
            return fallback

    patch_descriptors = [
        (SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD, str(manifest.get(SCENARIO_GEO_LOCALE_PATCH_MANIFEST_FIELD) or "").strip()),
        *(
            (field_name, str(manifest.get(field_name) or "").strip())
            for field_name in SCENARIO_GEO_LOCALE_PATCH_MANIFEST_LANGUAGE_FIELDS.values()
        ),
    ]
    active_patch_descriptors = [(field, url) for field, url in patch_descriptors if url]
    if not active_patch_descriptors:
        return
    audit_reported = False
    suspicious_reported = False
    warned_invalid_audit_counts: set[str] = set()
    suspicious_sample_signatures: set[tuple[str, ...]] = set()
    for field_name, geo_locale_patch_url in active_patch_descriptors:
        geo_locale_patch_path = scenario_relative_url_to_path(geo_locale_patch_url)
        if geo_locale_patch_path is None or not geo_locale_patch_path.exists():
            errors.append(f"{field_name} target must exist. Missing: {geo_locale_patch_url}")
            continue

        try:
            payload = load_json(geo_locale_patch_path)
        except Exception as exc:
            errors.append(str(exc))
            continue
        payload_scenario_id = str(payload.get("scenario_id") or "").strip()
        if payload_scenario_id and payload_scenario_id != expected_scenario_id:
            errors.append(
                f"{field_name} scenario_id must be `{expected_scenario_id}`. Found `{payload_scenario_id}`."
            )

        geo_payload = payload.get("geo")
        if not isinstance(geo_payload, dict):
            errors.append(f"{field_name} geo payload must be an object.")
            continue

        audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else {}
        collision_candidates = audit.get("collision_candidates", [])
        if collision_candidates not in (None, [], {}) and not isinstance(collision_candidates, list):
            errors.append(f"{field_name} audit.collision_candidates must be a list when present.")
            continue
        collision_candidates = collision_candidates if isinstance(collision_candidates, list) else []
        reviewed_collision_candidates = audit.get("reviewed_collision_candidates", [])
        if reviewed_collision_candidates not in (None, [], {}) and not isinstance(reviewed_collision_candidates, list):
            errors.append(f"{field_name} audit.reviewed_collision_candidates must be a list when present.")
            continue
        reviewed_collision_candidates = (
            reviewed_collision_candidates if isinstance(reviewed_collision_candidates, list) else []
        )
        excluded_feature_prefixes = audit.get("excluded_feature_prefixes", [])
        if excluded_feature_prefixes not in (None, [], {}) and not isinstance(excluded_feature_prefixes, list):
            errors.append(f"{field_name} audit.excluded_feature_prefixes must be a list when present.")
            continue
        excluded_feature_prefixes = [
            str(prefix).strip().upper()
            for prefix in (excluded_feature_prefixes if isinstance(excluded_feature_prefixes, list) else [])
            if str(prefix).strip()
        ]
        excluded_features = audit.get("excluded_features", [])
        if excluded_features not in (None, [], {}) and not isinstance(excluded_features, list):
            errors.append(f"{field_name} audit.excluded_features must be a list when present.")
            continue
        excluded_features = excluded_features if isinstance(excluded_features, list) else []

        collision_count = _parse_audit_count(audit, "collision_candidate_count", len(collision_candidates))
        cross_base_collision_count = _parse_audit_count(audit, "cross_base_collision_count", collision_count)
        split_clone_safe_copy_count = _parse_audit_count(audit, "split_clone_safe_copy_count", 0)
        reviewed_collision_exception_count = _parse_audit_count(
            audit,
            "reviewed_collision_exception_count",
            len(reviewed_collision_candidates),
        )
        excluded_feature_count = _parse_audit_count(audit, "excluded_feature_count", len(excluded_features))

        if collision_count != len(collision_candidates):
            errors.append(
                f"{field_name} audit.collision_candidate_count must equal the collision_candidates list length."
            )
        if reviewed_collision_exception_count != len(reviewed_collision_candidates):
            errors.append(
                f"{field_name} audit.reviewed_collision_exception_count must equal the reviewed_collision_candidates list length."
            )
        if excluded_feature_count != len(excluded_features):
            errors.append(
                f"{field_name} audit.excluded_feature_count must equal the excluded_features list length."
            )
        if excluded_features and not excluded_feature_prefixes:
            errors.append(
                f"{field_name} audit.excluded_features requires non-empty excluded_feature_prefixes."
            )
        for excluded_row in excluded_features:
            if not isinstance(excluded_row, dict):
                errors.append(f"{field_name} audit.excluded_features must only contain objects.")
                break
            feature_id = str(excluded_row.get("feature_id") or "").strip().upper()
            if not feature_id:
                errors.append(f"{field_name} audit.excluded_features must include feature_id values.")
                break
            if excluded_feature_prefixes and not feature_id.startswith(tuple(excluded_feature_prefixes)):
                errors.append(
                    f"{field_name} audit.excluded_features may only include ids that match excluded_feature_prefixes. "
                    f"Offending feature: {feature_id}."
                )
                break

        if collision_candidates:
            if not audit_reported:
                sample = (
                    audit.get("collision_candidates_sample")
                    if isinstance(audit.get("collision_candidates_sample"), list)
                    else collision_candidates[:5]
                )
                message = (
                    f"{field_name} recorded unresolved locale collision candidates. "
                    f"{cross_base_collision_count} cross-base collisions remain after "
                    f"{split_clone_safe_copy_count} split-clone safe copies and "
                    f"{reviewed_collision_exception_count} reviewed exceptions. Sample: {sample[:5]!r}."
                )
                if strict:
                    errors.append(message)
                else:
                    warnings.append(message)
                if repair_tracks is not None:
                    geo_locale_tracks = repair_tracks.setdefault("geo_locale_collision_candidates", [])
                    if isinstance(geo_locale_tracks, list):
                        geo_locale_tracks.append(
                            {
                                "field_name": field_name,
                                "collision_candidate_count": collision_count,
                                "cross_base_collision_count": cross_base_collision_count,
                                "split_clone_safe_copy_count": split_clone_safe_copy_count,
                                "reviewed_collision_exception_count": reviewed_collision_exception_count,
                                "sample": sample[:5],
                            }
                        )
                audit_reported = True

        suspicious_samples: list[str] = []
        for feature_id, entry in geo_payload.items():
            if not isinstance(entry, dict):
                continue
            zh_value = entry.get("zh")
            en_value = entry.get("en")
            if zh_value in SUSPICIOUS_LOCALE_TRANSLATIONS:
                suspicious_samples.append(
                    f"{feature_id}:{str(en_value or '').strip()}->{str(zh_value or '').strip()}"
                )
            if len(suspicious_samples) >= 8:
                break
        suspicious_signature = tuple(suspicious_samples)
        if suspicious_samples and not suspicious_reported and suspicious_signature not in suspicious_sample_signatures:
            errors.append(
                f"{field_name} contains high-risk machine-translation candidates. "
                f"Sample: {suspicious_samples}."
            )
            suspicious_reported = True
            suspicious_sample_signatures.add(suspicious_signature)


def _load_required_local_json(path: Path, errors: list[str]) -> dict | None:
    if not path.exists():
        errors.append(f"Required file is missing: {path}")
        return None
    try:
        return load_json(path)
    except Exception as exc:
        errors.append(str(exc))
        return None


def _sha256_path(path: Path) -> str:
    import hashlib

    if _uses_text_sha_normalization(path):
        return _sha256_text_path_normalized_lf(path)

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_text_path_normalized_lf(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    pending_cr = False
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if pending_cr:
                if chunk.startswith(b"\n"):
                    digest.update(b"\n")
                    chunk = chunk[1:]
                else:
                    digest.update(b"\r")
                pending_cr = False
            if chunk.endswith(b"\r"):
                pending_cr = True
                chunk = chunk[:-1]
            digest.update(chunk.replace(b"\r\n", b"\n"))
    if pending_cr:
        digest.update(b"\r")
    return digest.hexdigest()


def _uses_text_sha_normalization(path: Path) -> bool:
    if path.suffix == ".gz":
        return False
    return path.suffix in {".json", ".geojson"}


def _resolve_scenario_url(target_dir: Path, url: object, errors: list[str], field_name: str) -> Path | None:
    value = str(url or "").strip()
    if not value:
        errors.append(f"manifest.{field_name} is required in strict mode.")
        return None
    path = (PROJECT_ROOT / value).resolve()
    try:
        path.relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        errors.append(f"manifest.{field_name} must stay under the repository root. Found {value!r}.")
        return None
    expected_prefix = f"data/scenarios/{target_dir.name}/"
    if not PurePosixPath(value).as_posix().startswith(expected_prefix):
        errors.append(f"manifest.{field_name} must point inside {expected_prefix}. Found {value!r}.")
        return None
    if not path.is_file():
        errors.append(f"manifest.{field_name} points to a missing file: {value}")
        return None
    return path


def _required_profile_filenames(profile_id: str, manifest: dict[str, Any]) -> list[str]:
    profile = resolve_scenario_contract_profile(profile_id)
    required = list(SCENARIO_STRICT_REQUIRED_FILENAMES)
    if profile.expect_runtime_bootstrap or str(manifest.get("runtime_bootstrap_topology_url") or "").strip():
        required.append(SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME)
    if profile.expect_chunk_assets or str(manifest.get("detail_chunk_manifest_url") or "").strip():
        required.append("detail_chunks.manifest.json")
    if profile.expect_startup_assets or any(
        str(manifest.get(field_name) or "").strip()
        for field_name in SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS.values()
    ):
        required.extend(
            [
                SCENARIO_CHECKPOINT_STARTUP_LOCALES_FILENAME,
                SCENARIO_CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
                SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["en"],
                SCENARIO_STARTUP_BUNDLE_FILENAMES_BY_LANGUAGE["zh"],
            ]
        )
    if str(manifest.get("audit_url") or "").strip():
        required.append("audit.json")
    if str(manifest.get("special_zone_layers_url") or "").strip():
        required.append("special_zone_layers.json")
    if str(manifest.get("strategic_values_url") or "").strip():
        required.append(SCENARIO_STRATEGIC_VALUES_FILENAME)
    if str(manifest.get("scenario_atlantropa_topology_url") or "").strip():
        required.append("scenario_atlantropa.topo.json")
    if str(manifest.get("scenario_atlantropa_metadata_url") or "").strip():
        required.append("scenario_atlantropa_metadata.json")
    required.append(SCENARIO_BUILD_SNAPSHOT_FILENAME)
    return sorted(dict.fromkeys(required))


def _parse_detail_chunk_bucket(chunk_id: str) -> str:
    prefix = "political.detail.country."
    if not str(chunk_id or "").startswith(prefix):
        return ""
    return normalize_scenario_contract_tag(str(chunk_id)[len(prefix):])


def _resolve_detail_feature_owner_bucket(
    feature: dict[str, Any],
    owners_by_feature_id: dict[str, str],
    errors: list[str],
    *,
    chunk_id: str,
) -> tuple[str, str]:
    props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    feature_id = str(props.get("id") or feature.get("id") or "").strip()
    if not feature_id:
        errors.append(f"detail chunk {chunk_id} contains a political feature without properties.id.")
        return "", ""
    owner_tag = normalize_scenario_contract_tag(owners_by_feature_id.get(feature_id))
    if owner_tag:
        return feature_id, owner_tag
    if str(props.get("scenario_helper_kind") or "").strip() == "shell_fallback":
        shell_hint = normalize_scenario_contract_tag(props.get("scenario_shell_owner_hint"))
        if shell_hint:
            return feature_id, shell_hint
        errors.append(
            f"detail chunk {chunk_id} feature {feature_id} is shell_fallback but missing scenario_shell_owner_hint."
        )
        return feature_id, ""
    errors.append(f"detail chunk {chunk_id} feature {feature_id} is missing owners.by_feature ownership.")
    return feature_id, ""


def _collect_geojson_coordinates(value: Any, coordinates: list[tuple[float, float]]) -> None:
    if not isinstance(value, list):
        return
    if (
        len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        lon = float(value[0])
        lat = float(value[1])
        if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
            coordinates.append((lon, lat))
        return
    for item in value:
        _collect_geojson_coordinates(item, coordinates)


def _collect_geojson_feature_coordinates(geometry: Any, coordinates: list[tuple[float, float]]) -> None:
    if not isinstance(geometry, dict):
        return
    geometry_type = str(geometry.get("type") or "").strip()
    if geometry_type == "GeometryCollection":
        geometries = geometry.get("geometries") if isinstance(geometry.get("geometries"), list) else []
        for child in geometries:
            _collect_geojson_feature_coordinates(child, coordinates)
        return
    _collect_geojson_coordinates(geometry.get("coordinates"), coordinates)


def _feature_bounds_for_contract(feature: dict[str, Any]) -> list[float]:
    coordinates: list[tuple[float, float]] = []
    geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
    _collect_geojson_feature_coordinates(geometry, coordinates)
    if not coordinates:
        return [-180.0, -90.0, 180.0, 90.0]
    longitudes = [coord[0] for coord in coordinates]
    latitudes = [coord[1] for coord in coordinates]
    return [
        max(-180.0, min(180.0, min(longitudes))),
        max(-90.0, min(90.0, min(latitudes))),
        max(-180.0, min(180.0, max(longitudes))),
        max(-90.0, min(90.0, max(latitudes))),
    ]


def _bounds_area_for_contract(bounds: list[float]) -> float:
    if len(bounds) != 4:
        return 0.0
    return max(0.0, float(bounds[2]) - float(bounds[0])) * max(0.0, float(bounds[3]) - float(bounds[1]))


def _normalize_manifest_feature_bounds(raw_bounds: Any) -> list[float] | None:
    if not isinstance(raw_bounds, list) or len(raw_bounds) != 4:
        return None
    try:
        bounds = [float(value) for value in raw_bounds]
    except (TypeError, ValueError):
        return None
    if not all(-180.0 <= bounds[index] <= 180.0 for index in (0, 2)):
        return None
    if not all(-90.0 <= bounds[index] <= 90.0 for index in (1, 3)):
        return None
    if _bounds_area_for_contract(bounds) <= 0:
        return None
    return bounds


def _validate_detail_chunk_feature_bounds(
    chunk_id: str,
    chunk: dict[str, Any],
    features: list[dict[str, Any]],
    errors: list[str],
    *,
    required: bool,
) -> None:
    raw_feature_bounds = chunk.get("feature_bounds")
    if not isinstance(raw_feature_bounds, list) or not raw_feature_bounds:
        if required:
            errors.append(f"detail chunk {chunk_id} feature_bounds must be present for political detail chunks.")
        return
    manifest_bounds: list[list[float]] = []
    for index, raw_bounds in enumerate(raw_feature_bounds):
        normalized_bounds = _normalize_manifest_feature_bounds(raw_bounds)
        if normalized_bounds is None:
            errors.append(f"detail chunk {chunk_id} feature_bounds[{index}] must be a valid non-empty bbox.")
            continue
        manifest_bounds.append(normalized_bounds)
    expected_bounds = [
        bounds
        for feature in features
        for bounds in [_feature_bounds_for_contract(feature)]
        if _bounds_area_for_contract(bounds) > 0
    ]
    if len(manifest_bounds) != len(expected_bounds):
        errors.append(
            f"detail chunk {chunk_id} feature_bounds length must match non-empty payload feature bounds. "
            f"manifest={len(manifest_bounds)} actual={len(expected_bounds)}."
        )
    for index, expected_bounds_entry in enumerate(expected_bounds[:len(manifest_bounds)]):
        manifest_bounds_entry = manifest_bounds[index]
        if any(abs(manifest_bounds_entry[axis] - expected_bounds_entry[axis]) > 1e-7 for axis in range(4)):
            errors.append(
                f"detail chunk {chunk_id} feature_bounds[{index}] must match payload geometry bounds. "
                f"manifest={manifest_bounds_entry} actual={expected_bounds_entry}."
            )
            break


def _collect_feature_ids_from_geojson(path: Path, errors: list[str]) -> set[str]:
    payload = _load_required_local_json(path, errors)
    if payload is None:
        return set()
    features = payload.get("features")
    if not isinstance(features, list):
        errors.append(f"chunk payload must be a FeatureCollection with features at {path}.")
        return set()
    ids: set[str] = set()
    for feature in features:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        # Detail GeoJSON may use top-level numeric feature ids for transport
        # order, while properties.id carries the runtime topology identity.
        feature_id = str(props.get("id") or feature.get("id") or "").strip()
        if feature_id:
            ids.add(feature_id)
    return ids


def _validate_source_metadata(
    target_dir: Path,
    manifest: dict,
    errors: list[str],
    *,
    runtime_topology_path: Path,
    bootstrap_topology_path: Path | None,
    detail_chunk_manifest_path: Path | None,
) -> None:
    source = manifest.get("source")
    if not isinstance(source, dict):
        errors.append("manifest.source must be an object in strict mode.")
        return
    required_sha_fields = ["base_topology_sha256", "runtime_topology_sha256"]
    hgo_source_paths: dict[str, Path] = {}
    if target_dir.name == "hgo_1936":
        hgo_source_paths = {
            "hgo_seed_sha256": PROJECT_ROOT / "data" / "hgo_runtime" / "seed.json",
            "hgo_provinces_bmp_sha256": PROJECT_ROOT / "data" / "hgo_runtime" / "provinces.bmp",
        }
        required_sha_fields.extend(hgo_source_paths)
    if bootstrap_topology_path is not None:
        required_sha_fields.append("runtime_bootstrap_topology_sha256")
    if detail_chunk_manifest_path is not None:
        required_sha_fields.append("detail_chunk_manifest_sha256")
    missing = [field for field in required_sha_fields if not str(source.get(field) or "").strip()]
    if missing:
        errors.append(f"manifest.source is missing required sha fields in strict mode: {missing}.")
    base_topology_path = PROJECT_ROOT / "data" / "europe_topology.json"
    actual_by_field = {
        "runtime_topology_sha256": _sha256_path(runtime_topology_path),
    }
    if base_topology_path.exists():
        actual_by_field["base_topology_sha256"] = _sha256_path(base_topology_path)
    else:
        errors.append(f"base topology source file is missing in strict mode: {base_topology_path}.")
    if bootstrap_topology_path is not None:
        actual_by_field["runtime_bootstrap_topology_sha256"] = _sha256_path(bootstrap_topology_path)
    if detail_chunk_manifest_path is not None:
        actual_by_field["detail_chunk_manifest_sha256"] = _sha256_path(detail_chunk_manifest_path)
    for field, path in hgo_source_paths.items():
        if path.exists():
            actual_by_field[field] = _sha256_path(path)
        else:
            errors.append(f"HGO source file is missing in strict mode: {path}.")
    for field, actual_sha in actual_by_field.items():
        expected_sha = str(source.get(field) or "").strip()
        if expected_sha and expected_sha != actual_sha:
            errors.append(
                f"manifest.source.{field} must match the checked-in artifact sha. "
                f"manifest={expected_sha} actual={actual_sha}."
            )


def _validate_build_snapshot(
    target_dir: Path,
    manifest: dict[str, Any],
    errors: list[str],
) -> dict[str, Any] | None:
    snapshot_path = target_dir / SCENARIO_BUILD_SNAPSHOT_FILENAME
    snapshot_payload = _load_required_local_json(snapshot_path, errors)
    if snapshot_payload is None:
        return None
    expected_snapshot = _compose_snapshot_payload(target_dir, manifest)
    expected_fingerprint = str(expected_snapshot.get("snapshot_fingerprint") or "").strip()
    actual_fingerprint = str(snapshot_payload.get("snapshot_fingerprint") or "").strip()
    if actual_fingerprint != expected_fingerprint:
        errors.append(
            "build_snapshot.json snapshot_fingerprint must match current scenario artifacts. "
            f"snapshot={actual_fingerprint} actual={expected_fingerprint}."
        )
    for field_name in (
        "scenario_id",
        "profile",
        "contract_version",
        "builder_version",
        "feature_count",
        "water_count",
        "chunk_count",
    ):
        if snapshot_payload.get(field_name) != expected_snapshot.get(field_name):
            errors.append(
                f"build_snapshot.json field {field_name} must match the current scenario contract snapshot."
            )
    for map_name in ("input_sha", "output_sha"):
        actual_map = snapshot_payload.get(map_name)
        expected_map = expected_snapshot.get(map_name)
        if actual_map != expected_map:
            errors.append(
                f"build_snapshot.json field {map_name} must match the current scenario artifact shas."
            )
    return snapshot_payload


def _validate_startup_bundle_sources(
    target_dir: Path,
    manifest: dict[str, Any],
    errors: list[str],
) -> None:
    manifest_source = manifest.get("source") if isinstance(manifest.get("source"), dict) else {}
    for language, field_name in SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS.items():
        bundle_url = str(manifest.get(field_name) or "").strip()
        if not bundle_url:
            continue
        bundle_path = _resolve_scenario_url(target_dir, bundle_url, errors, field_name)
        if bundle_path is None:
            continue
        bundle_payload = _load_required_local_json(bundle_path, errors)
        if bundle_payload is None:
            continue
        bundle_source_raw = bundle_payload.get("source")
        if not isinstance(bundle_source_raw, dict):
            errors.append(f"startup bundle {language} must include a source object.")
            continue
        bundle_source = bundle_source_raw
        for source_field in (
            "runtime_topology_sha256",
            "runtime_bootstrap_topology_sha256",
            "detail_chunk_manifest_sha256",
        ):
            manifest_sha = str(manifest_source.get(source_field) or "").strip()
            bundle_sha = str(bundle_source.get(source_field) or "").strip()
            if manifest_sha and not bundle_sha:
                errors.append(
                    f"startup bundle {language} source.{source_field} must be present when manifest.source.{source_field} is set."
                )
                continue
            if manifest_sha and bundle_sha != manifest_sha:
                errors.append(
                    f"startup bundle {language} source.{source_field} must match manifest.source.{source_field}."
                )


def _validate_runtime_shell_topology(
    path: Path,
    errors: list[str],
    field_name: str,
    manifest: dict,
    *,
    require_overlay_shell_objects: bool,
) -> None:
    payload = _load_required_local_json(path, errors)
    if payload is None:
        return
    objects = payload.get("objects")
    if not isinstance(objects, dict):
        errors.append(f"{field_name} payload must contain objects at {path}.")
        return
    if str(manifest.get("map_mode") or "").strip().lower() != "blank":
        political_geometries = objects.get("political", {}).get("geometries") if isinstance(objects.get("political"), dict) else None
        if not isinstance(political_geometries, list) or not political_geometries:
            errors.append(f"{field_name} must contain non-empty objects.political.geometries in strict mode.")
    if require_overlay_shell_objects:
        required_objects = ["land_mask", "context_land_mask", "scenario_water"]
        if str(manifest.get("scenario_atlantropa_topology_url") or "").strip():
            required_objects.append(SCENARIO_ATLANTROPA_OBJECT_NAME)
        for object_name in required_objects:
            if object_name not in objects:
                errors.append(f"{field_name} must contain objects.{object_name} in strict mode.")


def _validate_detail_chunk_manifest(
    target_dir: Path,
    detail_manifest_path: Path,
    runtime_feature_ids: set[str],
    owners_by_feature_id: dict[str, str],
    errors: list[str],
    atlantropa_feature_ids: set[str] | None = None,
) -> dict[str, int]:
    payload = _load_required_local_json(detail_manifest_path, errors)
    if payload is None:
        return {
            "owner_bucket_mismatch_count": 0,
            "reverse_coverage_gap_count": 0,
        }
    chunks = payload.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        errors.append("detail_chunks.manifest.json must contain a non-empty chunks list in strict mode.")
        return {
            "owner_bucket_mismatch_count": 0,
            "reverse_coverage_gap_count": 0,
        }
    seen_ids: set[str] = set()
    duplicate_ids: list[str] = []
    political_ids: set[str] = set()
    atlantropa_all_ids: set[str] = set()
    atlantropa_detail_ids: set[str] = set()
    feature_to_chunk: dict[str, str] = {}
    owner_bucket_mismatch_count = 0
    require_precise_chunk_manifest = target_dir.name == "tno_1962"
    for chunk in chunks:
        if not isinstance(chunk, dict):
            errors.append("detail_chunks.manifest.json chunks entries must be objects.")
            continue
        chunk_id = str(chunk.get("id") or "").strip()
        if not chunk_id:
            errors.append("detail chunk entry is missing id.")
            continue
        if chunk_id in seen_ids:
            duplicate_ids.append(chunk_id)
        seen_ids.add(chunk_id)
        chunk_url = str(chunk.get("url") or "").strip()
        chunk_path = _resolve_scenario_url(target_dir, chunk_url, errors, f"detail_chunk[{chunk_id}].url")
        if chunk_path is None:
            continue
        expected_byte_size = chunk.get("byte_size")
        try:
            expected_byte_size_int = int(expected_byte_size)
        except (TypeError, ValueError):
            errors.append(f"detail chunk {chunk_id} byte_size must be an integer.")
            expected_byte_size_int = None
        if expected_byte_size_int is not None and expected_byte_size_int != chunk_path.stat().st_size:
            errors.append(
                f"detail chunk {chunk_id} byte_size must match file size. "
                f"manifest={expected_byte_size_int} actual={chunk_path.stat().st_size}."
            )
        expected_sha256 = str(chunk.get("sha256") or "").strip().lower()
        if not expected_sha256:
            if require_precise_chunk_manifest:
                errors.append(f"detail chunk {chunk_id} sha256 must be present in strict mode.")
        else:
            actual_sha256 = _sha256_path(chunk_path)
            if expected_sha256 != actual_sha256:
                errors.append(
                    f"detail chunk {chunk_id} sha256 must match file content. "
                    f"manifest={expected_sha256} actual={actual_sha256}."
                )
        chunk_layer = str(chunk.get("layer") or "").strip()
        chunk_lod = str(chunk.get("lod") or "").strip()
        if chunk_layer == SCENARIO_ATLANTROPA_LAYER_KEY:
            chunk_payload = _load_required_local_json(chunk_path, errors)
            if chunk_payload is None:
                continue
            features = chunk_payload.get("features")
            if not isinstance(features, list):
                errors.append(f"scenario_atlantropa chunk {chunk_id} must be a FeatureCollection with features.")
                continue
            expected_feature_count = chunk.get("feature_count")
            try:
                expected_feature_count_int = int(expected_feature_count)
            except (TypeError, ValueError):
                errors.append(f"scenario_atlantropa chunk {chunk_id} feature_count must be an integer.")
                expected_feature_count_int = None
            if expected_feature_count_int is not None and expected_feature_count_int != len(features):
                errors.append(
                    f"scenario_atlantropa chunk {chunk_id} feature_count must match payload feature length. "
                    f"manifest={expected_feature_count_int} actual={len(features)}."
                )
            _validate_detail_chunk_feature_bounds(
                chunk_id,
                chunk,
                features,
                errors,
                required=require_precise_chunk_manifest and chunk_lod == "detail",
            )
            for feature in features:
                if not isinstance(feature, dict):
                    continue
                props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
                feature_id = str(props.get("id") or feature.get("id") or "").strip()
                if not feature_id:
                    errors.append(f"scenario_atlantropa chunk {chunk_id} contains a feature without properties.id.")
                    continue
                if not _is_atlantropa_feature_id(feature_id):
                    errors.append(f"scenario_atlantropa chunk {chunk_id} contains non-ATL feature {feature_id}.")
                atlantropa_all_ids.add(feature_id)
                if chunk_lod == "detail":
                    atlantropa_detail_ids.add(feature_id)
                if str(props.get("atl_render_layer") or "").strip() not in ATLANTROPA_RENDER_LAYER_VALUES:
                    errors.append(f"scenario_atlantropa chunk {chunk_id} feature {feature_id} has invalid atl_render_layer.")
                if str(props.get("atl_color_rule") or "").strip() not in ATLANTROPA_COLOR_RULE_VALUES:
                    errors.append(f"scenario_atlantropa chunk {chunk_id} feature {feature_id} has invalid atl_color_rule.")
                if not isinstance(props.get("atl_interactive"), bool):
                    errors.append(f"scenario_atlantropa chunk {chunk_id} feature {feature_id} must store boolean atl_interactive.")
                expected_field_rule = _expected_atlantropa_field_rule(feature_id)
                render_layer = str(props.get("atl_render_layer") or "").strip()
                color_rule = str(props.get("atl_color_rule") or "").strip()
                if expected_field_rule and (render_layer, color_rule) != expected_field_rule:
                    errors.append(
                        f"scenario_atlantropa chunk {chunk_id} feature {feature_id} must use prefix fields "
                        f"atl_render_layer={expected_field_rule[0]!r} atl_color_rule={expected_field_rule[1]!r}; "
                        f"got atl_render_layer={render_layer!r} atl_color_rule={color_rule!r}."
                    )
        if (
            chunk_layer == "political"
            and chunk_lod == "detail"
        ):
            chunk_payload = _load_required_local_json(chunk_path, errors)
            if chunk_payload is None:
                continue
            features = chunk_payload.get("features")
            if not isinstance(features, list):
                errors.append(f"detail chunk {chunk_id} must be a FeatureCollection with features.")
                continue
            expected_feature_count = chunk.get("feature_count")
            try:
                expected_feature_count_int = int(expected_feature_count)
            except (TypeError, ValueError):
                errors.append(f"detail chunk {chunk_id} feature_count must be an integer.")
                expected_feature_count_int = None
            if expected_feature_count_int is not None and expected_feature_count_int != len(features):
                errors.append(
                    f"detail chunk {chunk_id} feature_count must match payload feature length. "
                    f"manifest={expected_feature_count_int} actual={len(features)}."
                )
            _validate_detail_chunk_feature_bounds(
                chunk_id,
                chunk,
                features,
                errors,
                required=require_precise_chunk_manifest,
            )
            chunk_bucket = _parse_detail_chunk_bucket(chunk_id)
            manifest_country_codes = [
                normalize_scenario_contract_tag(code)
                for code in (chunk.get("country_codes") or [])
                if normalize_scenario_contract_tag(code)
            ]
            if chunk_bucket and manifest_country_codes and chunk_bucket not in manifest_country_codes:
                errors.append(
                    f"detail chunk {chunk_id} country_codes must include the chunk owner bucket {chunk_bucket}."
                )
            for feature in features:
                if not isinstance(feature, dict):
                    continue
                feature_id, owner_bucket = _resolve_detail_feature_owner_bucket(
                    feature,
                    owners_by_feature_id,
                    errors,
                    chunk_id=chunk_id,
                )
                if not feature_id:
                    continue
                if chunk_bucket and owner_bucket and owner_bucket != chunk_bucket:
                    owner_bucket_mismatch_count += 1
                    errors.append(
                        f"detail chunk {chunk_id} feature {feature_id} must stay in owner bucket {owner_bucket}."
                    )
                if manifest_country_codes and owner_bucket and owner_bucket not in manifest_country_codes:
                    owner_bucket_mismatch_count += 1
                    errors.append(
                        f"detail chunk {chunk_id} feature {feature_id} owner bucket {owner_bucket} "
                        "must match manifest country_codes."
                    )
                if feature_id in feature_to_chunk and feature_to_chunk[feature_id] != chunk_id:
                    errors.append(
                        f"detail political feature {feature_id} appears in multiple chunks: "
                        f"{feature_to_chunk[feature_id]} and {chunk_id}."
                    )
                feature_to_chunk[feature_id] = chunk_id
                political_ids.add(feature_id)
    if duplicate_ids:
        errors.append(f"detail chunk ids must be unique. Duplicates: {sorted(set(duplicate_ids))[:10]}.")
    illegal_chunk_ids = sorted(political_ids - runtime_feature_ids)
    if illegal_chunk_ids:
        errors.append(
            "political detail chunk feature ids must belong to full runtime political ids. "
            f"Sample: {illegal_chunk_ids[:10]}."
        )
    reverse_coverage_gap_count = len(runtime_feature_ids - political_ids)
    if reverse_coverage_gap_count:
        errors.append(
            "detail political chunk union must cover runtime political ids. "
            f"Missing sample: {sorted(runtime_feature_ids - political_ids)[:10]}."
        )
    if atlantropa_feature_ids is not None:
        illegal_atlantropa_chunk_ids = sorted(atlantropa_all_ids - atlantropa_feature_ids)
        if illegal_atlantropa_chunk_ids:
            errors.append(
                "scenario_atlantropa chunk feature ids must belong to runtime scenario_atlantropa ids. "
                f"Sample: {illegal_atlantropa_chunk_ids[:10]}."
            )
        missing_atlantropa_detail_chunk_ids = sorted(atlantropa_feature_ids - atlantropa_detail_ids)
        if missing_atlantropa_detail_chunk_ids:
            errors.append(
                "scenario_atlantropa detail chunks must cover runtime scenario_atlantropa ids. "
                f"Missing sample: {missing_atlantropa_detail_chunk_ids[:10]}."
            )
    return {
        "owner_bucket_mismatch_count": owner_bucket_mismatch_count,
        "reverse_coverage_gap_count": reverse_coverage_gap_count,
    }


def _is_atlantropa_feature_id(feature_id: str) -> bool:
    normalized = str(feature_id or "").strip().upper()
    return any(normalized.startswith(prefix) for prefix in ATLANTROPA_FEATURE_PREFIXES)


def _expected_atlantropa_field_rule(feature_id: str) -> tuple[str, str] | None:
    normalized = str(feature_id or "").strip().upper()
    for prefix, render_layer, color_rule in ATLANTROPA_PREFIX_FIELD_RULES:
        if normalized.startswith(prefix):
            return render_layer, color_rule
    return None


def _extract_runtime_object_feature_ids(
    runtime_payload: dict,
    errors: list[str],
    runtime_path: Path,
    object_name: str,
    *,
    required: bool = True,
) -> set[str]:
    objects = runtime_payload.get("objects")
    if not isinstance(objects, dict):
        errors.append(f"runtime_topology payload must contain objects at {runtime_path}.")
        return set()
    runtime_object = objects.get(object_name)
    if not isinstance(runtime_object, dict):
        if required:
            errors.append(f"runtime_topology payload must contain objects.{object_name} at {runtime_path}.")
        return set()
    geometries = runtime_object.get("geometries")
    if not isinstance(geometries, list):
        errors.append(f"runtime_topology payload must contain objects.{object_name}.geometries at {runtime_path}.")
        return set()
    feature_ids: set[str] = set()
    missing_ids = 0
    for geometry in geometries:
        if not isinstance(geometry, dict):
            continue
        props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
        feature_id = str(props.get("id") or geometry.get("id") or "").strip()
        if not feature_id:
            missing_ids += 1
            continue
        feature_ids.add(feature_id)
    if missing_ids:
        errors.append(
            f"runtime_topology {object_name} geometries must expose stable ids. Missing ids on {missing_ids} geometries."
        )
    return feature_ids


def _extract_runtime_political_feature_ids(runtime_payload: dict, errors: list[str], runtime_path: Path) -> set[str]:
    return _extract_runtime_object_feature_ids(runtime_payload, errors, runtime_path, "political")


def _validate_runtime_atlantropa_layer(
    runtime_payload: dict,
    *,
    owner_ids: set[str],
    errors: list[str],
    runtime_path: Path,
) -> set[str]:
    objects = runtime_payload.get("objects") if isinstance(runtime_payload, dict) else None
    if not isinstance(objects, dict):
        errors.append(f"runtime_topology payload must contain objects at {runtime_path}.")
        return set()
    political_geometries = objects.get("political", {}).get("geometries", []) if isinstance(objects.get("political"), dict) else []
    if isinstance(political_geometries, list):
        political_atl_ids = []
        for geometry in political_geometries:
            props = geometry.get("properties") if isinstance(geometry, dict) and isinstance(geometry.get("properties"), dict) else {}
            feature_id = str(props.get("id") or (geometry.get("id") if isinstance(geometry, dict) else "") or "").strip()
            if _is_atlantropa_feature_id(feature_id):
                political_atl_ids.append(feature_id)
        if political_atl_ids:
            errors.append(
                "runtime_topology political object must not contain ATL* features once scenario_atlantropa is present. "
                f"Sample: {political_atl_ids[:10]}."
            )
    atlantropa = objects.get(SCENARIO_ATLANTROPA_OBJECT_NAME)
    if not isinstance(atlantropa, dict):
        errors.append(f"runtime_topology payload must contain objects.{SCENARIO_ATLANTROPA_OBJECT_NAME} at {runtime_path}.")
        return set()
    geometries = atlantropa.get("geometries")
    if not isinstance(geometries, list) or not geometries:
        errors.append(f"runtime_topology objects.{SCENARIO_ATLANTROPA_OBJECT_NAME}.geometries must be non-empty.")
        return set()
    atlantropa_ids: set[str] = set()
    for geometry in geometries:
        if not isinstance(geometry, dict):
            continue
        props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
        feature_id = str(props.get("id") or geometry.get("id") or "").strip()
        if not feature_id:
            errors.append("scenario_atlantropa geometry is missing stable properties.id.")
            continue
        if not _is_atlantropa_feature_id(feature_id):
            errors.append(f"scenario_atlantropa geometry {feature_id} must use an ATL* feature id.")
        atlantropa_ids.add(feature_id)
        render_layer = str(props.get("atl_render_layer") or "").strip()
        color_rule = str(props.get("atl_color_rule") or "").strip()
        if render_layer not in ATLANTROPA_RENDER_LAYER_VALUES:
            errors.append(f"scenario_atlantropa feature {feature_id} has invalid atl_render_layer={render_layer!r}.")
        if color_rule not in ATLANTROPA_COLOR_RULE_VALUES:
            errors.append(f"scenario_atlantropa feature {feature_id} has invalid atl_color_rule={color_rule!r}.")
        if not isinstance(props.get("atl_interactive"), bool):
            errors.append(f"scenario_atlantropa feature {feature_id} must store boolean atl_interactive.")
        expected_field_rule = _expected_atlantropa_field_rule(feature_id)
        if expected_field_rule and (render_layer, color_rule) != expected_field_rule:
            errors.append(
                f"scenario_atlantropa feature {feature_id} must use prefix fields "
                f"atl_render_layer={expected_field_rule[0]!r} atl_color_rule={expected_field_rule[1]!r}; "
                f"got atl_render_layer={render_layer!r} atl_color_rule={color_rule!r}."
            )
    owner_atl_ids = {feature_id for feature_id in owner_ids if _is_atlantropa_feature_id(feature_id)}
    if atlantropa_ids != owner_atl_ids:
        errors.append(
            "scenario_atlantropa ids must match ATL* owners.by_feature ids. "
            f"runtime={len(atlantropa_ids)} owners={len(owner_atl_ids)} "
            f"missing={sorted(owner_atl_ids - atlantropa_ids)[:10]} "
            f"extra={sorted(atlantropa_ids - owner_atl_ids)[:10]}."
        )
    return atlantropa_ids


def _validate_runtime_topology_object_count(
    target_dir: Path,
    manifest_summary: dict,
    runtime_payload: dict,
    errors: list[str],
) -> None:
    objects = runtime_payload.get("objects") if isinstance(runtime_payload, dict) else None
    if not isinstance(objects, dict):
        return
    runtime_object_names = sorted(str(name) for name in objects.keys())
    runtime_object_count = len(runtime_object_names)
    manifest_count = manifest_summary.get("scenario_runtime_topology_object_count")
    if manifest_count is not None:
        try:
            manifest_count_int = int(manifest_count)
        except (TypeError, ValueError):
            errors.append(
                "manifest.summary.scenario_runtime_topology_object_count must be an integer in strict mode. "
                f"Found {manifest_count!r}."
            )
        else:
            if manifest_count_int != runtime_object_count:
                errors.append(
                    "manifest.summary.scenario_runtime_topology_object_count must equal runtime_topology object count. "
                    f"manifest={manifest_count_int} runtime={runtime_object_count} objects={runtime_object_names}."
                )
    runtime_meta_path = target_dir / "runtime_meta.json"
    if not runtime_meta_path.is_file():
        return
    runtime_meta = _load_required_local_json(runtime_meta_path, errors)
    if runtime_meta is None:
        return
    meta_count = runtime_meta.get("runtime_topology_object_count")
    try:
        meta_count_int = int(meta_count)
    except (TypeError, ValueError):
        errors.append(f"runtime_meta.json runtime_topology_object_count must be an integer. Found {meta_count!r}.")
    else:
        if meta_count_int != runtime_object_count:
            errors.append(
                "runtime_meta.json runtime_topology_object_count must equal runtime_topology object count. "
                f"runtime_meta={meta_count_int} runtime={runtime_object_count}."
            )
    meta_names = runtime_meta.get("runtime_topology_object_names")
    if isinstance(meta_names, list):
        normalized_meta_names = sorted(str(name) for name in meta_names if str(name).strip())
        if normalized_meta_names != runtime_object_names:
            errors.append(
                "runtime_meta.json runtime_topology_object_names must equal runtime_topology object names. "
                f"runtime_meta={normalized_meta_names} runtime={runtime_object_names}."
            )


def _validate_atlantropa_publish_mirror(
    target_dir: Path,
    manifest: dict,
    manifest_summary: dict,
    runtime_atlantropa_feature_ids: set[str],
    errors: list[str],
) -> None:
    topology_path = _resolve_scenario_url(
        target_dir,
        manifest.get("scenario_atlantropa_topology_url"),
        errors,
        "scenario_atlantropa_topology_url",
    )
    if topology_path is None:
        return
    topology_payload = _load_required_local_json(topology_path, errors)
    if topology_payload is None:
        return
    mirror_errors: list[str] = []
    mirror_ids = _extract_runtime_object_feature_ids(
        topology_payload,
        mirror_errors,
        topology_path,
        SCENARIO_ATLANTROPA_OBJECT_NAME,
    )
    if mirror_errors:
        errors.extend(mirror_errors)
    if mirror_ids != runtime_atlantropa_feature_ids:
        errors.append(
            "scenario_atlantropa_topology_url must mirror runtime_topology objects.scenario_atlantropa ids. "
            f"mirror={len(mirror_ids)} runtime={len(runtime_atlantropa_feature_ids)} "
            f"missing={sorted(runtime_atlantropa_feature_ids - mirror_ids)[:10]} "
            f"extra={sorted(mirror_ids - runtime_atlantropa_feature_ids)[:10]}."
        )
    summary_count = manifest_summary.get("scenario_atlantropa_feature_count")
    if summary_count is None:
        return
    try:
        summary_count_int = int(summary_count)
    except (TypeError, ValueError):
        errors.append(f"manifest.summary.scenario_atlantropa_feature_count must be an integer. Found {summary_count!r}.")
        return
    if summary_count_int != len(runtime_atlantropa_feature_ids):
        errors.append(
            "manifest.summary.scenario_atlantropa_feature_count must equal runtime scenario_atlantropa feature count. "
            f"manifest={summary_count_int} runtime={len(runtime_atlantropa_feature_ids)}."
        )


def _validate_tno_coverage_ledgers(
    target_dir: Path,
    errors: list[str],
    report: dict[str, Any] | None,
) -> None:
    if target_dir.name != "tno_1962":
        return
    ledger_path = target_dir / TNO_COVERAGE_DERIVED_DIRNAME / TNO_ATLANTROPA_DONOR_LEDGER_FILENAME
    drop_audit_path = target_dir / TNO_COVERAGE_DERIVED_DIRNAME / TNO_GEOMETRY_DROP_AUDIT_FILENAME
    missing_paths = [
        str(path.relative_to(target_dir)).replace("\\", "/")
        for path in (ledger_path, drop_audit_path)
        if not path.exists()
    ]
    if missing_paths:
        if report is not None:
            report["coverage_ledger_ok"] = False
        errors.append(
            "coverage ledger files must be generated for tno_1962 strict mode. "
            f"Missing: {missing_paths}."
        )
        return
    ledger = _load_required_local_json(ledger_path, errors)
    drop_audit = _load_required_local_json(drop_audit_path, errors)
    if ledger is None or drop_audit is None:
        if report is not None:
            report["coverage_ledger_ok"] = False
        return
    ledger_failures: list[str] = []
    if ledger.get("scenario_id") != "tno_1962":
        ledger_failures.append("atlantropa_donor_ledger scenario_id mismatch")
    if drop_audit.get("scenario_id") != "tno_1962":
        ledger_failures.append("geometry_drop_audit scenario_id mismatch")
    summary = ledger.get("summary") if isinstance(ledger.get("summary"), dict) else {}
    drop_summary = drop_audit.get("summary") if isinstance(drop_audit.get("summary"), dict) else {}
    missing_chunk_count = int(summary.get("missing_chunk_count") or 0)
    basin_probe_failures = [
        probe
        for probe in ledger.get("basin_probes", [])
        if isinstance(probe, dict) and not probe.get("ok")
    ] if isinstance(ledger.get("basin_probes"), list) else []
    protected_prefix_drop_count = int(drop_summary.get("protected_prefix_drop_count") or 0)
    polar_feature_count = int(drop_summary.get("polar_feature_count") or 0)
    polar_gate_ref = str(drop_audit.get("polar_gate_ref") or "verify:tno-polar-coverage").strip()
    polar_spherical_failures: list[dict[str, str]] = []
    if missing_chunk_count:
        ledger_failures.append(f"atlantropa donor ledger has {missing_chunk_count} features missing chunks")
    if basin_probe_failures:
        ledger_failures.append(f"atlantropa donor ledger has {len(basin_probe_failures)} basin probe failures")
    if protected_prefix_drop_count:
        ledger_failures.append(f"geometry_drop_audit has {protected_prefix_drop_count} protected prefix drops")
    if polar_feature_count < 1:
        polar_spherical_failures.append({"reason": "missing_aq_runtime_feature"})
        ledger_failures.append("geometry_drop_audit must record at least one AQ polar runtime feature")
    runtime_meta = _load_optional_json(target_dir / "runtime_meta.json") or {}
    runtime_hashes = runtime_meta.get("coverage_ledger_hashes") if isinstance(runtime_meta.get("coverage_ledger_hashes"), dict) else {}
    expected_hashes = {
        "atlantropa_donor_ledger": _sha256_path(ledger_path),
        "geometry_drop_audit": _sha256_path(drop_audit_path),
    }
    for key, expected_hash in expected_hashes.items():
        if str(runtime_hashes.get(key) or "").strip() != expected_hash:
            ledger_failures.append(f"runtime_meta.json coverage_ledger_hashes.{key} must match {key} content")
    if report is not None:
        report["coverage_ledger_ok"] = not ledger_failures
        report["protected_prefix_drop_count"] = protected_prefix_drop_count
        report["basin_probe_failures"] = [
            {
                "id": str(probe.get("id") or ""),
                "label": str(probe.get("label") or ""),
                "failure_reasons": list(probe.get("failure_reasons") or []),
            }
            for probe in basin_probe_failures
        ]
        report["polar_spherical_failures"] = polar_spherical_failures
        report["polar_feature_count"] = polar_feature_count
        report["polar_gate_ref"] = polar_gate_ref
        report.setdefault("artifact_counts", {})["atlantropa_ledger_features"] = int(summary.get("runtime_feature_count") or 0)
        report.setdefault("artifact_counts", {})["protected_coverage_features"] = int(
            drop_summary.get("protected_feature_count") or 0
        )
    if ledger_failures:
        errors.append("coverage ledger strict checks failed: " + "; ".join(ledger_failures[:5]))


def validate_strict_bundle_contract(
    target_dir: Path,
    errors: list[str],
    repair_tracks: dict[str, Any] | None = None,
    report: dict[str, Any] | None = None,
) -> None:
    manifest = _load_required_local_json(target_dir / "manifest.json", errors)
    if manifest is None:
        return
    # strict gate 的目标是把 checked-in scenario 目录当成发布物来审计：
    # 不只看 manifest 存在，还要核对 owners / cores / runtime topology / chunk metadata
    # 之间是否还能互相解释同一份场景真相。
    required_filenames = _required_profile_filenames(target_dir.name, manifest)
    required_payloads = {
        filename: _load_required_local_json(target_dir / filename, errors)
        for filename in required_filenames
        if filename.endswith(".json")
    }
    if any(required_payloads.get(filename) is None for filename in SCENARIO_STRICT_REQUIRED_FILENAMES):
        return
    owners_payload = required_payloads["owners.by_feature.json"]
    cores_payload = required_payloads["cores.by_feature.json"]
    countries_payload = required_payloads.get("countries.json") or {}
    if not countries_payload and target_dir.name == "tno_1962":
        countries_payload = _load_required_local_json(target_dir / "countries.json", errors) or {}
    runtime_payload = required_payloads[SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME]

    owners = owners_payload.get("owners")
    cores = cores_payload.get("cores")
    countries = countries_payload.get("countries") if isinstance(countries_payload.get("countries"), dict) else {}
    if not isinstance(owners, dict):
        errors.append("owners.by_feature.json owners payload must be an object in strict mode.")
        return
    if not isinstance(cores, dict):
        errors.append("cores.by_feature.json cores payload must be an object in strict mode.")
        return
    if not isinstance(countries, dict):
        errors.append("countries.json countries payload must be an object in strict mode.")
        return

    non_list_core_ids = [feature_id for feature_id, value in cores.items() if not isinstance(value, list)]
    if non_list_core_ids:
        errors.append(
            "cores.by_feature.json must store arrays for every feature in strict mode. "
            f"Sample: {non_list_core_ids[:10]}."
        )
    if target_dir.name == "tno_1962":
        country_tags = {
            normalize_scenario_contract_tag(tag)
            for tag in countries.keys()
            if normalize_scenario_contract_tag(tag)
        }
        country_tags.update(
            normalize_scenario_contract_tag(entry.get("tag"))
            for entry in countries.values()
            if isinstance(entry, dict) and normalize_scenario_contract_tag(entry.get("tag"))
        )
        invalid_core_tags: dict[str, list[str]] = {}
        for feature_id, core_tags in cores.items():
            if not isinstance(core_tags, list):
                continue
            unknown_tags = sorted(
                {
                    normalize_scenario_contract_tag(tag)
                    for tag in core_tags
                    if normalize_scenario_contract_tag(tag)
                    and normalize_scenario_contract_tag(tag) not in country_tags
                }
            )
            if unknown_tags:
                invalid_core_tags[str(feature_id)] = unknown_tags
        if invalid_core_tags:
            sample = [
                f"{feature_id}:{','.join(tags)}"
                for feature_id, tags in list(sorted(invalid_core_tags.items()))[:10]
            ]
            errors.append(f"cores.by_feature.json must only reference countries.json tags in strict mode. Sample: {sample}.")

    owner_ids = {str(feature_id).strip() for feature_id in owners.keys() if str(feature_id).strip()}
    core_ids = {str(feature_id).strip() for feature_id in cores.keys() if str(feature_id).strip()}
    if report is not None:
        report["artifact_counts"] = {
            "owner_features": len(owner_ids),
            "core_features": len(core_ids),
        }
    if owner_ids != core_ids:
        core_only_ids = sorted(core_ids - owner_ids)
        owner_only_ids = sorted(owner_ids - core_ids)
        if repair_tracks is not None:
            repair_tracks["owners_cores_keyset"] = {
                "owners_count": len(owner_ids),
                "cores_count": len(core_ids),
                "core_only_count": len(core_only_ids),
                "core_only_sample": core_only_ids[:10],
                "owner_only_count": len(owner_only_ids),
                "owner_only_sample": owner_only_ids[:10],
            }
        errors.append(
            "owners/cores feature keysets must match in strict mode. "
            f"owners={len(owner_ids)} cores={len(core_ids)} "
            f"core_only={core_only_ids[:10]} "
            f"owner_only={owner_only_ids[:10]}."
        )

    strategic_payload = required_payloads.get(SCENARIO_STRATEGIC_VALUES_FILENAME)
    if strategic_payload is not None:
        if strategic_payload.get("scenario_id") != manifest.get("scenario_id"):
            errors.append(
                f"{SCENARIO_STRATEGIC_VALUES_FILENAME} scenario_id must match manifest.scenario_id."
            )
        if strategic_payload.get("baseline_hash") != owners_payload.get("baseline_hash"):
            errors.append(
                f"{SCENARIO_STRATEGIC_VALUES_FILENAME} baseline_hash must match owners.by_feature.json baseline_hash."
            )
        strategic_buckets = strategic_payload.get("buckets")
        strategic_bucket_by_feature = strategic_payload.get("bucket_by_feature")
        strategic_resource_points = strategic_payload.get("resource_points")
        if not isinstance(strategic_buckets, dict) or not strategic_buckets:
            errors.append(f"{SCENARIO_STRATEGIC_VALUES_FILENAME} buckets must be a non-empty object.")
        if not isinstance(strategic_bucket_by_feature, dict):
            errors.append(f"{SCENARIO_STRATEGIC_VALUES_FILENAME} bucket_by_feature must be an object.")
        else:
            strategic_feature_ids = {
                str(feature_id).strip()
                for feature_id in strategic_bucket_by_feature.keys()
                if str(feature_id).strip()
            }
            unknown_strategic_ids = sorted(strategic_feature_ids - owner_ids)
            if unknown_strategic_ids:
                errors.append(
                    f"{SCENARIO_STRATEGIC_VALUES_FILENAME} bucket_by_feature must only reference owner features. "
                    f"Sample: {unknown_strategic_ids[:10]}."
                )
            missing_strategic_ids = sorted(owner_ids - strategic_feature_ids)
            if missing_strategic_ids:
                errors.append(
                    f"{SCENARIO_STRATEGIC_VALUES_FILENAME} bucket_by_feature must cover owner features. "
                    f"Sample: {missing_strategic_ids[:10]}."
                )
            if report is not None:
                report.setdefault("artifact_counts", {})["strategic_features"] = len(strategic_feature_ids)
        if not (
            isinstance(strategic_resource_points, dict)
            and strategic_resource_points.get("type") == "FeatureCollection"
            and isinstance(strategic_resource_points.get("features"), list)
        ):
            errors.append(
                f"{SCENARIO_STRATEGIC_VALUES_FILENAME} resource_points must be a GeoJSON FeatureCollection."
            )

    manifest_summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
    manifest_feature_count = manifest_summary.get("feature_count")
    try:
        expected_feature_count = int(manifest_feature_count)
    except (TypeError, ValueError):
        errors.append(f"manifest.summary.feature_count must be an integer in strict mode. Found {manifest_feature_count!r}.")
        expected_feature_count = None
    if expected_feature_count is not None and expected_feature_count != len(owner_ids):
        errors.append(
            "manifest.summary.feature_count must equal owners feature count in strict mode. "
            f"manifest={expected_feature_count} owners={len(owner_ids)}."
        )
    _validate_runtime_topology_object_count(target_dir, manifest_summary, runtime_payload, errors)
    if target_dir.name == "tno_1962":
        for field_name in ("scenario_atlantropa_topology_url", "scenario_atlantropa_metadata_url"):
            if not str(manifest.get(field_name) or "").strip():
                errors.append(f"manifest.{field_name} is required for tno_1962 strict Atlantropa layer contract.")
        style_defaults = manifest.get("style_defaults") if isinstance(manifest.get("style_defaults"), dict) else {}
        for style_key in ("atlantropa_sea", "atlantropa_salt_flat", "atlantropa_shoal"):
            fill_color = style_defaults.get(style_key, {}).get("fillColor") if isinstance(style_defaults.get(style_key), dict) else ""
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", str(fill_color or "").strip()):
                errors.append(f"manifest.style_defaults.{style_key}.fillColor must be a hex color.")

    runtime_political_feature_ids = _extract_runtime_political_feature_ids(runtime_payload, errors, target_dir / "runtime_topology.topo.json")
    runtime_atlantropa_feature_ids = set()
    if target_dir.name == "tno_1962":
        runtime_atlantropa_feature_ids = _validate_runtime_atlantropa_layer(
            runtime_payload,
            owner_ids=owner_ids,
            errors=errors,
            runtime_path=target_dir / "runtime_topology.topo.json",
        )
        _validate_atlantropa_publish_mirror(
            target_dir,
            manifest,
            manifest_summary,
            runtime_atlantropa_feature_ids,
            errors,
        )
    runtime_feature_ids = runtime_political_feature_ids | runtime_atlantropa_feature_ids
    runtime_topology_path = target_dir / "runtime_topology.topo.json"
    bootstrap_topology_path = None
    source_bootstrap_topology_path = None
    detail_chunk_manifest_path = None
    runtime_bootstrap_url = str(manifest.get("runtime_bootstrap_topology_url") or "").strip()
    startup_topology_url = str(manifest.get("startup_topology_url") or "").strip()
    detail_chunk_manifest_url = str(manifest.get("detail_chunk_manifest_url") or "").strip()
    has_startup_bundle_urls = any(
        str(manifest.get(field_name) or "").strip()
        for field_name in ("startup_bundle_url_en", "startup_bundle_url_zh")
    )
    require_overlay_shell_objects = bool(detail_chunk_manifest_url or has_startup_bundle_urls)
    if runtime_bootstrap_url:
        bootstrap_topology_path = _resolve_scenario_url(target_dir, runtime_bootstrap_url, errors, "runtime_bootstrap_topology_url")
        if bootstrap_topology_path is not None:
            _validate_runtime_shell_topology(
                bootstrap_topology_path,
                errors,
                "runtime_bootstrap_topology_url",
                manifest,
                require_overlay_shell_objects=False,
            )
            source_bootstrap_topology_path = bootstrap_topology_path
    if startup_topology_url:
        startup_topology_path = _resolve_scenario_url(target_dir, startup_topology_url, errors, "startup_topology_url")
        if startup_topology_path is not None:
            _validate_runtime_shell_topology(
                startup_topology_path,
                errors,
                "startup_topology_url",
                manifest,
                require_overlay_shell_objects=require_overlay_shell_objects,
            )
            source_bootstrap_topology_path = startup_topology_path
    if detail_chunk_manifest_url:
        detail_chunk_manifest_path = _resolve_scenario_url(target_dir, detail_chunk_manifest_url, errors, "detail_chunk_manifest_url")
        if detail_chunk_manifest_path is not None:
            detail_chunk_metrics = _validate_detail_chunk_manifest(
                target_dir,
                detail_chunk_manifest_path,
                runtime_political_feature_ids,
                {
                    str(feature_id).strip(): normalize_scenario_contract_tag(owner_tag)
                    for feature_id, owner_tag in owners.items()
                    if str(feature_id).strip() and normalize_scenario_contract_tag(owner_tag)
                },
                errors,
                atlantropa_feature_ids=runtime_atlantropa_feature_ids if target_dir.name == "tno_1962" else None,
            )
            if report is not None:
                report["owner_bucket_mismatch_count"] = int(detail_chunk_metrics["owner_bucket_mismatch_count"])
                report["reverse_coverage_gap_count"] = int(detail_chunk_metrics["reverse_coverage_gap_count"])
    if detail_chunk_manifest_url and (not runtime_bootstrap_url or not startup_topology_url):
        errors.append(
            "chunked scenario manifests must define runtime_bootstrap_topology_url and startup_topology_url in strict mode."
        )
    _validate_source_metadata(
        target_dir,
        manifest,
        errors,
        runtime_topology_path=runtime_topology_path,
        bootstrap_topology_path=source_bootstrap_topology_path,
        detail_chunk_manifest_path=detail_chunk_manifest_path,
    )
    _validate_startup_bundle_sources(target_dir, manifest, errors)
    missing_runtime_ids = sorted(owner_ids - runtime_feature_ids)
    if missing_runtime_ids:
        errors.append(
            "runtime_topology is missing feature ids referenced by owners/cores in strict mode. "
            f"Sample: {missing_runtime_ids[:10]}."
        )
    extra_runtime_ids = runtime_feature_ids - owner_ids
    illegal_runtime_only_ids = sorted(
        feature_id
        for feature_id in extra_runtime_ids
        if not any(feature_id.startswith(prefix) for prefix in STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES)
    )
    if illegal_runtime_only_ids:
        if repair_tracks is not None:
            repair_tracks["runtime_topology_extra_ids"] = {
                "extra_runtime_id_count": len(illegal_runtime_only_ids),
                "extra_runtime_id_sample": illegal_runtime_only_ids[:10],
                "allowed_runtime_only_prefixes": list(STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES),
            }
        errors.append(
            "runtime_topology political geometries may only exceed the feature maps with shell fallback ids in strict mode. "
            f"Sample: {illegal_runtime_only_ids[:10]}."
        )
    runtime_geometries = (
        runtime_payload.get("objects", {})
        .get("political", {})
        .get("geometries", [])
    )
    shell_runtime_only_contract_errors: list[str] = []
    if isinstance(runtime_geometries, list):
        for geometry in runtime_geometries:
            if not isinstance(geometry, dict):
                continue
            props = geometry.get("properties") if isinstance(geometry.get("properties"), dict) else {}
            feature_id = str(props.get("id") or geometry.get("id") or "").strip()
            if feature_id not in extra_runtime_ids:
                continue
            if not any(feature_id.startswith(prefix) for prefix in STRICT_RUNTIME_ONLY_FEATURE_ID_PREFIXES):
                continue
            if (
                re.fullmatch(r"RU_ARCTIC_FB_\d+", feature_id)
                or props.get("scenario_helper_kind") != "shell_fallback"
                or not props.get("scenario_shell_owner_hint")
                or not props.get("scenario_shell_controller_hint")
            ):
                shell_runtime_only_contract_errors.append(feature_id)
    if shell_runtime_only_contract_errors:
        errors.append(
            "runtime-only Arctic shell features must be coalesced shell_fallback geometry with owner/controller hints in strict mode. "
            f"Sample: {shell_runtime_only_contract_errors[:10]}."
        )
    _validate_tno_coverage_ledgers(target_dir, errors, report)
    snapshot_payload = _validate_build_snapshot(target_dir, manifest, errors)
    if snapshot_payload is not None and report is not None:
        report["snapshot_fingerprint"] = str(snapshot_payload.get("snapshot_fingerprint") or "").strip()
    audit_url = str(manifest.get("audit_url") or "").strip()
    if audit_url:
        audit_path = _resolve_scenario_url(target_dir, audit_url, errors, "audit_url")
        if audit_path is not None:
            audit_payload = _load_required_local_json(audit_path, errors)
            if audit_payload is not None:
                expected_fingerprint = str((snapshot_payload or {}).get("snapshot_fingerprint") or "").strip()
                actual_fingerprint = str(audit_payload.get("snapshot_fingerprint") or "").strip()
                if not actual_fingerprint:
                    errors.append("audit.json must expose snapshot_fingerprint when manifest.audit_url is declared.")
                elif expected_fingerprint and actual_fingerprint != expected_fingerprint:
                    errors.append(
                        "audit.json snapshot_fingerprint must match build_snapshot.json. "
                        f"audit={actual_fingerprint} snapshot={expected_fingerprint}."
                    )
                manifest_summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
                audit_summary = audit_payload.get("summary") if isinstance(audit_payload.get("summary"), dict) else {}
                if audit_summary != manifest_summary:
                    errors.append("audit.json summary must match manifest.summary for derived scenario artifacts.")


def validate_publish_bundle_dir(target_dir: Path) -> list[str]:
    errors: list[str] = []
    validate_strict_bundle_contract(target_dir, errors)
    return errors


def inspect_scenario_contract(
    scenario_dir: Path,
    duplicate_scenario_dirs: dict[str, list[str]],
    strict: bool = False,
) -> dict[str, Any]:
    report = build_scenario_report(scenario_dir, strict)
    errors: list[str] = report["errors"]
    warnings: list[str] = report["warnings"]
    repair_tracks: dict[str, Any] = report["repair_tracks"]
    manifest_path = scenario_dir / "manifest.json"
    if not manifest_path.exists():
        report["errors"] = [f"manifest.json is missing at {manifest_path}."]
        report["status"] = "failed"
        return report

    try:
        manifest = load_json(manifest_path)
    except Exception as exc:
        report["errors"] = [str(exc)]
        report["status"] = "failed"
        return report
    expected_scenario_id = scenario_dir.name
    actual_scenario_id = str(manifest.get("scenario_id") or "").strip()

    if actual_scenario_id != expected_scenario_id:
        errors.append(
            f"manifest.scenario_id must equal scenario directory name `{expected_scenario_id}`. "
            f"Found `{actual_scenario_id}`."
        )
    duplicate_dirs = duplicate_scenario_dirs.get(actual_scenario_id or expected_scenario_id, [])
    if duplicate_dirs:
        errors.append(
            "scenario_id must be globally unique across data/scenarios. "
            f"Duplicate directories for `{actual_scenario_id or expected_scenario_id}`: {duplicate_dirs}."
        )

    validate_manifest_version_matrix(expected_scenario_id, manifest, errors)
    validate_manifest_urls(expected_scenario_id, manifest, errors)
    validate_water_regions_mode(expected_scenario_id, manifest, errors)
    validate_special_zone_layers(expected_scenario_id, manifest, errors)
    validate_runtime_capitals(expected_scenario_id, manifest, errors)
    validate_internal_authoring_inputs(expected_scenario_id, errors)
    validate_locale_patch(expected_scenario_id, manifest, errors, warnings, strict=strict, repair_tracks=repair_tracks)
    if strict:
        validate_strict_bundle_contract(scenario_dir, errors, repair_tracks=repair_tracks, report=report)
    report["status"] = "failed" if errors else "ok"
    _materialize_violation_report(report)
    return report


def validate_scenario_contract(
    scenario_dir: Path,
    duplicate_scenario_dirs: dict[str, list[str]],
    strict: bool = False,
) -> tuple[list[str], list[str]]:
    report = inspect_scenario_contract(scenario_dir, duplicate_scenario_dirs, strict=strict)
    return list(report["errors"]), list(report["warnings"])


def collect_duplicate_scenario_dirs(scenario_dirs: list[Path]) -> dict[str, list[str]]:
    scenario_id_to_dirs: defaultdict[str, list[str]] = defaultdict(list)
    for scenario_dir in scenario_dirs:
        manifest_path = scenario_dir / "manifest.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = load_json(manifest_path)
        except Exception:
            continue
        scenario_id = str(manifest.get("scenario_id") or "").strip()
        if scenario_id:
            scenario_id_to_dirs[scenario_id].append(scenario_dir.name)

    duplicates: dict[str, list[str]] = {}
    for scenario_id, dirs in scenario_id_to_dirs.items():
        if len(dirs) > 1:
            duplicates[scenario_id] = sorted(dirs)
    return duplicates


def render_repair_track_lines(repair_tracks: dict[str, Any], strict: bool) -> list[str]:
    # 这里输出给终端看的都是“人类快速排查线索”，
    # 所以保留 sample 和计数摘要，不复述完整结构化 report。
    lines: list[str] = []
    owners_controllers = repair_tracks.get("owners_controllers_keyset")
    if strict and isinstance(owners_controllers, dict):
        lines.append(
            "owners/controllers keyset "
            f"controller_only={owners_controllers.get('controller_only_count', 0)} "
            f"owner_only={owners_controllers.get('owner_only_count', 0)} "
            f"sample={owners_controllers.get('controller_only_sample', [])[:5]}"
        )
    owners_cores = repair_tracks.get("owners_cores_keyset")
    if strict and isinstance(owners_cores, dict):
        lines.append(
            "owners/cores keyset "
            f"core_only={owners_cores.get('core_only_count', 0)} "
            f"owner_only={owners_cores.get('owner_only_count', 0)} "
            f"sample={owners_cores.get('core_only_sample', [])[:5]}"
        )
    runtime_topology_extra_ids = repair_tracks.get("runtime_topology_extra_ids")
    if strict and isinstance(runtime_topology_extra_ids, dict):
        lines.append(
            "runtime_topology extra ids "
            f"count={runtime_topology_extra_ids.get('extra_runtime_id_count', 0)} "
            f"sample={runtime_topology_extra_ids.get('extra_runtime_id_sample', [])[:5]}"
        )
    geo_locale_collision_candidates = repair_tracks.get("geo_locale_collision_candidates")
    if isinstance(geo_locale_collision_candidates, list):
        for entry in geo_locale_collision_candidates:
            if not isinstance(entry, dict):
                continue
            lines.append(
                "geo_locale collision candidates "
                f"field={entry.get('field_name', '')} "
                f"remaining={entry.get('cross_base_collision_count', 0)} "
                f"safe_copies={entry.get('split_clone_safe_copy_count', 0)} "
                f"reviewed_exceptions={entry.get('reviewed_collision_exception_count', 0)} "
                f"sample={entry.get('sample', [])[:2]}"
            )
    return lines


def write_validation_report(report_path: Path, reports: list[dict[str, Any]], strict: bool) -> None:
    payload = {
        "mode": "strict" if strict else "default",
        "scenario_count": len(reports),
        "reports": reports,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def resolve_validation_report_paths(values: list[str] | str | None) -> list[Path]:
    if isinstance(values, str):
        values = [values] if values.strip() else []
    return [Path(value).resolve() for value in (values or []) if str(value).strip()]


def main() -> int:
    args = parse_args()
    if args.write_safe and not args.strict:
        raise SystemExit("--write-safe requires --strict.")
    scenarios_root = Path(args.scenarios_root).resolve()
    scenario_dirs = discover_scenario_dirs(scenarios_root, args.scenario_dir)
    if not scenario_dirs:
        raise SystemExit("No scenario directories found to validate.")

    duplicate_scenario_dirs = collect_duplicate_scenario_dirs(discover_scenario_dirs(scenarios_root, []))
    report_paths = resolve_validation_report_paths(args.report_path)
    report_path = report_paths[0] if report_paths else None
    any_errors = False
    reports: list[dict[str, Any]] = []
    for scenario_dir in scenario_dirs:
        safe_fixes_applied: list[str] = []
        idempotent = True
        if args.write_safe:
            pre_repair_report = inspect_scenario_contract(scenario_dir, duplicate_scenario_dirs, strict=args.strict)
            _materialize_violation_report(pre_repair_report)
            if pre_repair_report.get("risky_fixes_required") or pre_repair_report.get("forbidden_violations"):
                pre_repair_report["errors"].append(
                    "safe repair blocked: scenario has risky or forbidden violations."
                )
                pre_repair_report["status"] = "failed"
                reports.append(pre_repair_report)
                any_errors = True
                print(f"[scenario-contract] FAILED {scenario_dir.name}")
                for error in pre_repair_report["errors"]:
                    print(f"- {error}")
                continue
            before_second_pass = {}
            try:
                safe_fixes_applied = apply_safe_scenario_contract_repairs(
                    scenario_dir,
                    report_path=report_path,
                )
                before_second_pass = _capture_safe_repair_hashes(scenario_dir)
                second_pass_fixes = apply_safe_scenario_contract_repairs(
                    scenario_dir,
                    report_path=report_path,
                )
                after_second_pass = _capture_safe_repair_hashes(scenario_dir)
                idempotent = before_second_pass == after_second_pass
                if second_pass_fixes and second_pass_fixes != safe_fixes_applied:
                    safe_fixes_applied = list(dict.fromkeys([*safe_fixes_applied, *second_pass_fixes]))
            except Exception as exc:
                report = build_scenario_report(scenario_dir, args.strict)
                report["errors"].append(f"safe repair failed: {exc}")
                report["status"] = "failed"
                report["idempotent"] = False
                _materialize_violation_report(report)
                reports.append(report)
                any_errors = True
                print(f"[scenario-contract] FAILED {scenario_dir.name}")
                print(f"- safe repair failed: {exc}")
                continue

        report = inspect_scenario_contract(scenario_dir, duplicate_scenario_dirs, strict=args.strict)
        report["safe_fixes_applied"] = safe_fixes_applied
        report["idempotent"] = idempotent
        if args.write_safe and not idempotent:
            report["errors"].append("safe repair second pass produced additional file diffs.")
            report["status"] = "failed"
            _materialize_violation_report(report)
        reports.append(report)
        errors = list(report["errors"])
        warnings = list(report["warnings"])
        if errors:
            any_errors = True
            print(f"[scenario-contract] FAILED {scenario_dir.name}")
            for error in errors:
                print(f"- {error}")
            for warning in warnings:
                print(f"! {warning}")
            repair_track_lines = render_repair_track_lines(report.get("repair_tracks", {}), strict=args.strict)
            for line in repair_track_lines:
                print(f"~ {line}")
            continue
        print(f"[scenario-contract] OK {scenario_dir.name}")
        for warning in warnings:
            print(f"! {warning}")
        repair_track_lines = render_repair_track_lines(report.get("repair_tracks", {}), strict=args.strict)
        for line in repair_track_lines:
            print(f"~ {line}")

    for output_path in report_paths:
        write_validation_report(output_path, reports, strict=args.strict)

    return 1 if any_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
