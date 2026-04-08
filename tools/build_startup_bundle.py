from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic

SUPPORTED_LANGUAGES = ("en", "zh")
STARTUP_BUNDLE_VERSION = 3
STARTUP_BOOTSTRAP_STRATEGY = "chunked-coarse-first"
STARTUP_BUNDLE_GZIP_BUDGET_BYTES = 5_000_000


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _read_json(path: Path) -> dict:
    payload = read_json_strict(path)
    if not isinstance(payload, dict):
        raise TypeError(f"Expected JSON object at {path}")
    return payload


def _sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _gzip_size(payload: object) -> int:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return len(gzip.compress(raw, compresslevel=9))


def _extract_language_entry(value: object, language: str) -> object:
    if isinstance(value, dict):
        preferred = _normalize_text(value.get(language))
        fallback = _normalize_text(value.get("en" if language == "zh" else "zh"))
        if preferred or fallback:
            return {language: preferred or fallback}
    return value


def _normalize_stable_key(value: object) -> str:
    text = _normalize_text(value)
    if text.startswith("id::"):
        return text[4:]
    return text


def _extract_geometry_key(geometry: object) -> str:
    if not isinstance(geometry, dict):
        return ""
    properties = geometry.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    for candidate in (
        properties.get("id"),
        properties.get("NUTS_ID"),
        geometry.get("id"),
    ):
        key = _normalize_stable_key(candidate)
        if key:
            return key
    return ""


def _extract_country_code_from_id(value: object) -> str:
    text = _normalize_text(value).upper()
    if not text:
        return ""
    prefix = text.split("-", 1)[0].split("_", 1)[0]
    alpha_prefix = "".join(ch for ch in prefix if "A" <= ch <= "Z")
    return alpha_prefix[:3] if 2 <= len(alpha_prefix[:3]) <= 3 else ""


def _normalize_country_code_alias(raw_code: object) -> str:
    code = "".join(ch for ch in _normalize_text(raw_code).upper() if "A" <= ch <= "Z")
    if code == "UK":
        return "GB"
    if code == "EL":
        return "GR"
    return code


def _extract_geometry_country_code(geometry: object) -> str:
    if not isinstance(geometry, dict):
        return ""
    properties = geometry.get("properties")
    if not isinstance(properties, dict):
        properties = {}
    for candidate in (
        properties.get("cntr_code"),
        properties.get("CNTR_CODE"),
        properties.get("iso_a2"),
        properties.get("ISO_A2"),
        properties.get("iso_a2_eh"),
        properties.get("ISO_A2_EH"),
        properties.get("adm0_a2"),
        properties.get("ADM0_A2"),
    ):
        normalized = _normalize_country_code_alias(candidate)
        if normalized and normalized not in {"ZZ", "XX"}:
            return normalized
    return _normalize_country_code_alias(
        _extract_country_code_from_id(properties.get("id"))
        or _extract_country_code_from_id(properties.get("NUTS_ID"))
        or _extract_country_code_from_id(geometry.get("id"))
    )


def build_runtime_political_meta(runtime_bootstrap_topology: dict) -> dict:
    geometries = (
        runtime_bootstrap_topology.get("objects", {}).get("political", {}).get("geometries", [])
        if isinstance(runtime_bootstrap_topology, dict)
        else []
    )
    neighbors = (
        runtime_bootstrap_topology.get("objects", {}).get("political", {}).get("computed_neighbors", [])
        if isinstance(runtime_bootstrap_topology, dict)
        else []
    )
    if not isinstance(geometries, list):
        geometries = []
    if not isinstance(neighbors, list):
        neighbors = []

    feature_ids: list[str] = []
    feature_index_by_id: dict[str, int] = {}
    canonical_country_by_feature_id: dict[str, str] = {}

    for index, geometry in enumerate(geometries):
        feature_id = _extract_geometry_key(geometry)
        if not feature_id:
            continue
        feature_ids.append(feature_id)
        feature_index_by_id[feature_id] = index
        canonical_country_by_feature_id[feature_id] = _extract_geometry_country_code(geometry)

    return {
        "featureIds": feature_ids,
        "featureIndexById": feature_index_by_id,
        "canonicalCountryByFeatureId": canonical_country_by_feature_id,
        "neighborGraph": (
            neighbors
            if len(neighbors) == len(geometries)
            else [[] for _ in geometries]
        ),
    }


def build_startup_runtime_shell(runtime_bootstrap_topology: dict) -> dict:
    source_objects = runtime_bootstrap_topology.get("objects", {}) if isinstance(runtime_bootstrap_topology, dict) else {}
    next_objects = {}
    for object_name in ("land_mask", "context_land_mask", "scenario_water", "scenario_special_land"):
        if object_name not in source_objects:
            continue
        next_objects[object_name] = {
            "type": "GeometryCollection",
            "geometries": [],
        }
    return {
        "type": "Topology",
        "objects": next_objects,
        "arcs": [],
        "bbox": copy.deepcopy(runtime_bootstrap_topology.get("bbox")),
    }


def _collect_topology_object_keys(topology: dict, object_names: tuple[str, ...]) -> set[str]:
    if not isinstance(topology, dict):
        return set()
    objects = topology.get("objects")
    if not isinstance(objects, dict):
        return set()
    keys: set[str] = set()
    for object_name in object_names:
        object_payload = objects.get(object_name)
        geometries = object_payload.get("geometries") if isinstance(object_payload, dict) else None
        if not isinstance(geometries, list):
            continue
        for geometry in geometries:
            key = _extract_geometry_key(geometry)
            if key:
                keys.add(key)
    return keys


def collect_required_geo_keys(
    topology_primary: dict,
    runtime_bootstrap_topology: dict,
    geo_locale_patch: dict,
) -> set[str]:
    required_keys = set()
    required_keys.update(
        _collect_topology_object_keys(
            topology_primary,
            (
                "political",
                "water_regions",
                "special_zones",
                "rivers",
                "urban",
                "physical",
            ),
        )
    )
    required_keys.update(
        _collect_topology_object_keys(
            runtime_bootstrap_topology,
            (
                "political",
                "land_mask",
                "context_land_mask",
                "scenario_water",
                "scenario_special_land",
            ),
        )
    )
    geo_patch = geo_locale_patch.get("geo") if isinstance(geo_locale_patch, dict) else None
    if isinstance(geo_patch, dict):
        for key in geo_patch.keys():
            normalized = _normalize_stable_key(key)
            if normalized:
                required_keys.add(normalized)
    return required_keys


def prune_startup_geo_locales(startup_locales_payload: dict, required_geo_keys: set[str]) -> dict:
    next_payload = {
        "ui": copy.deepcopy(startup_locales_payload.get("ui", {})),
        "geo": {},
    }
    source_geo = startup_locales_payload.get("geo", {})
    if not isinstance(source_geo, dict):
        return next_payload
    for key, value in source_geo.items():
        normalized = _normalize_stable_key(key)
        if normalized and normalized in required_geo_keys:
            next_payload["geo"][key] = value
    return next_payload


def prune_startup_geo_aliases(geo_aliases_payload: dict, required_geo_keys: set[str]) -> dict:
    alias_map = geo_aliases_payload.get("alias_to_stable_key", {}) if isinstance(geo_aliases_payload, dict) else {}
    if not isinstance(alias_map, dict):
        return {"alias_to_stable_key": {}}
    next_alias_map = {}
    for alias, stable_key in alias_map.items():
        normalized_target = _normalize_stable_key(stable_key)
        if normalized_target and normalized_target in required_geo_keys:
            next_alias_map[alias] = stable_key
    return {"alias_to_stable_key": next_alias_map}


def write_gzip_sidecar(payload: object, output_path: Path) -> Path:
    gzip_path = output_path.with_suffix(f"{output_path.suffix}.gz")
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    gzip_path.write_bytes(gzip.compress(raw, compresslevel=9))
    return gzip_path


def build_single_language_locales_payload(startup_locales: dict, language: str) -> dict:
    if language not in SUPPORTED_LANGUAGES:
        raise ValueError(f"Unsupported startup bundle language: {language}")
    next_payload = {"ui": {}, "geo": {}}
    for section_name in ("ui", "geo"):
        source_section = startup_locales.get(section_name, {})
        if not isinstance(source_section, dict):
            continue
        section_target = next_payload[section_name]
        for key, value in source_section.items():
            narrowed = _extract_language_entry(value, language)
            if narrowed in (None, "", {}):
                continue
            section_target[key] = narrowed
    return next_payload


def _resolve_display_name(entry: dict, fallback: str) -> str:
    display_name = entry.get("display_name")
    if isinstance(display_name, dict):
        return _normalize_text(display_name.get("en") or display_name.get("zh") or fallback)
    resolved = _normalize_text(display_name or entry.get("displayName") or fallback)
    return resolved or fallback


def build_startup_apply_seed(
    scenario_id: str,
    scenario_manifest: dict,
    countries_payload: dict,
    owners_payload: dict,
) -> dict:
    countries = countries_payload.get("countries", {}) if isinstance(countries_payload, dict) else {}
    owners = owners_payload.get("owners", {}) if isinstance(owners_payload, dict) else {}
    if not isinstance(countries, dict):
        countries = {}
    if not isinstance(owners, dict):
        owners = {}
    scenario_name_map = {}
    scenario_color_map = {}
    for raw_tag, raw_entry in countries.items():
        tag = _normalize_text(raw_tag).upper()
        entry = raw_entry if isinstance(raw_entry, dict) else {}
        if not tag:
            continue
        scenario_name_map[tag] = _resolve_display_name(entry, tag)
        color_hex = _normalize_text(entry.get("color_hex") or entry.get("colorHex")).lower()
        if color_hex.startswith("#") and len(color_hex) == 7:
            scenario_color_map[tag] = color_hex
    return {
        "scenario_id": scenario_id,
        "default_country_code": _normalize_text(
            scenario_manifest.get("default_active_country_code")
            or scenario_manifest.get("default_country")
        ).upper(),
        "map_semantic_mode": _normalize_text(scenario_manifest.get("map_mode") or "political") or "political",
        "scenario_name_map": scenario_name_map,
        "scenario_color_map": scenario_color_map,
        "resolved_owners": copy.deepcopy(owners),
    }


def build_startup_bundle_payload(
    *,
    language: str,
    scenario_manifest: dict,
    data_manifest: dict,
    topology_primary_path: Path,
    startup_locales_path: Path,
    startup_locales_payload: dict,
    geo_aliases_path: Path,
    runtime_bootstrap_topology_path: Path,
    countries_path: Path,
    owners_path: Path,
    controllers_path: Path,
    cores_path: Path,
    geo_locale_patch_path: Path,
) -> dict:
    scenario_id = _normalize_text(scenario_manifest.get("scenario_id"))
    if not scenario_id:
        raise ValueError("Scenario manifest is missing scenario_id.")

    topology_primary = _read_json(topology_primary_path)
    runtime_bootstrap_topology = _read_json(runtime_bootstrap_topology_path)
    runtime_political_meta = build_runtime_political_meta(runtime_bootstrap_topology)
    runtime_shell_topology = build_startup_runtime_shell(runtime_bootstrap_topology)
    countries_payload = _read_json(countries_path)
    owners_payload = _read_json(owners_path)
    controllers_payload = _read_json(controllers_path)
    cores_payload = _read_json(cores_path)
    geo_locale_patch = _read_json(geo_locale_patch_path)
    geo_aliases = _read_json(geo_aliases_path)
    required_geo_keys = collect_required_geo_keys(
        topology_primary,
        runtime_bootstrap_topology,
        geo_locale_patch,
    )
    pruned_locales_payload = prune_startup_geo_locales(startup_locales_payload, required_geo_keys)
    pruned_geo_aliases = prune_startup_geo_aliases(geo_aliases, required_geo_keys)
    apply_seed = build_startup_apply_seed(
        scenario_id,
        scenario_manifest,
        countries_payload,
        owners_payload,
    )

    manifest_subset = copy.deepcopy(scenario_manifest)
    manifest_subset["baseline_hash"] = _normalize_text(scenario_manifest.get("baseline_hash"))
    manifest_subset["generated_at"] = _normalize_text(scenario_manifest.get("generated_at"))
    manifest_subset["startup_bundle_version"] = STARTUP_BUNDLE_VERSION
    manifest_subset["startup_bootstrap_strategy"] = STARTUP_BOOTSTRAP_STRATEGY

    return {
        "version": STARTUP_BUNDLE_VERSION,
        "scenario_id": scenario_id,
        "language": language,
        "generated_at": _normalize_text(scenario_manifest.get("generated_at")),
        "baseline_hash": _normalize_text(scenario_manifest.get("baseline_hash")),
        "source": {
            "data_manifest_version": data_manifest.get("version"),
            "data_manifest_generated_at": _normalize_text(data_manifest.get("generated_at")),
            "startup_locales_sha256": _sha256_path(startup_locales_path),
            "base_topology_sha256": _sha256_path(topology_primary_path),
            "runtime_bootstrap_topology_sha256": _sha256_path(runtime_bootstrap_topology_path),
            "geo_aliases_sha256": _sha256_path(geo_aliases_path),
            "countries_sha256": _sha256_path(countries_path),
            "owners_sha256": _sha256_path(owners_path),
            "controllers_sha256": _sha256_path(controllers_path),
            "cores_sha256": _sha256_path(cores_path),
            "geo_locale_patch_sha256": _sha256_path(geo_locale_patch_path),
        },
        "manifest_subset": manifest_subset,
        "base": {
            "topology_primary": topology_primary,
            "locales": pruned_locales_payload,
            "geo_aliases": pruned_geo_aliases,
        },
        "scenario": {
            "bootstrap_strategy": STARTUP_BOOTSTRAP_STRATEGY,
            "countries": countries_payload,
            "owners": owners_payload,
            "controllers": controllers_payload,
            "cores": cores_payload,
            "geo_locale_patch": geo_locale_patch,
            "runtime_topology_bootstrap": runtime_shell_topology,
            "runtime_political_meta": runtime_political_meta,
            "apply_seed": apply_seed,
        },
    }


def build_startup_bundle_report(
    *,
    payload_by_language: dict[str, dict],
    output_paths_by_language: dict[str, Path],
    gzip_paths_by_language: dict[str, Path],
    startup_locales_payload_by_language: dict[str, dict],
    original_geo_aliases: dict,
    report_path: Path | None,
) -> dict:
    report = {
        "version": STARTUP_BUNDLE_VERSION,
        "generated_at": next(iter(payload_by_language.values())).get("generated_at", ""),
        "scenario_id": next(iter(payload_by_language.values())).get("scenario_id", ""),
        "gzip_budget_bytes": STARTUP_BUNDLE_GZIP_BUDGET_BYTES,
        "languages": {},
    }
    for language, payload in payload_by_language.items():
        output_path = output_paths_by_language[language]
        gzip_path = gzip_paths_by_language[language]
        raw_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        original_locales_payload = startup_locales_payload_by_language[language]
        original_geo_alias_map = original_geo_aliases.get("alias_to_stable_key", {}) if isinstance(original_geo_aliases, dict) else {}
        pruned_locales_payload = payload["base"]["locales"]
        pruned_geo_aliases = payload["base"]["geo_aliases"]
        runtime_shell = payload.get("scenario", {}).get("runtime_topology_bootstrap", {})
        runtime_political_meta = payload.get("scenario", {}).get("runtime_political_meta", {})
        runtime_shell_objects = runtime_shell.get("objects", {}) if isinstance(runtime_shell, dict) else {}
        runtime_feature_ids = runtime_political_meta.get("featureIds", []) if isinstance(runtime_political_meta, dict) else []
        owner_keys = set(
            _normalize_stable_key(key)
            for key in (payload.get("scenario", {}).get("owners", {}).get("owners", {}) or {}).keys()
            if _normalize_stable_key(key)
        )
        controller_keys = set(
            _normalize_stable_key(key)
            for key in (payload.get("scenario", {}).get("controllers", {}).get("controllers", {}) or {}).keys()
            if _normalize_stable_key(key)
        )
        runtime_feature_id_set = {
            _normalize_stable_key(feature_id)
            for feature_id in runtime_feature_ids
            if _normalize_stable_key(feature_id)
        }
        owner_overlap_count = len(runtime_feature_id_set & owner_keys)
        controller_overlap_count = len(runtime_feature_id_set & controller_keys)
        feature_count = len(runtime_feature_id_set)
        owner_overlap_ratio = owner_overlap_count / feature_count if feature_count else 1.0
        controller_overlap_ratio = controller_overlap_count / feature_count if feature_count else 1.0
        report["languages"][language] = {
            "output_path": str(output_path),
            "gzip_output_path": str(gzip_path),
            "raw_bytes": len(raw_bytes),
            "gzip_bytes": len(gzip.compress(raw_bytes, compresslevel=9)),
            "gzip_file_bytes": gzip_path.stat().st_size if gzip_path.exists() else 0,
            "gzip_budget_exceeded": (gzip_path.stat().st_size if gzip_path.exists() else 0) > STARTUP_BUNDLE_GZIP_BUDGET_BYTES,
            "locale_geo_keys_before": len(original_locales_payload.get("geo", {})),
            "locale_geo_keys_after": len(pruned_locales_payload.get("geo", {})),
            "geo_alias_keys_before": len(original_geo_alias_map),
            "geo_alias_keys_after": len(pruned_geo_aliases.get("alias_to_stable_key", {})),
            "contract": {
                "required_runtime_objects_present": {
                    object_name: object_name in runtime_shell_objects
                    for object_name in ("land_mask", "context_land_mask", "scenario_water")
                },
                "runtime_political_feature_count": feature_count,
                "owner_feature_overlap_count": owner_overlap_count,
                "owner_feature_overlap_ratio": owner_overlap_ratio,
                "controller_feature_overlap_count": controller_overlap_count,
                "controller_feature_overlap_ratio": controller_overlap_ratio,
            },
            "sections": {
                "base_topology_raw_bytes": len(
                    json.dumps(payload["base"]["topology_primary"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                ),
                "locales_raw_bytes": len(
                    json.dumps(payload["base"]["locales"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                ),
                "geo_aliases_raw_bytes": len(
                    json.dumps(payload["base"]["geo_aliases"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                ),
                "runtime_bootstrap_raw_bytes": len(
                    json.dumps(
                        payload["scenario"].get("runtime_topology_bootstrap"),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ),
                "runtime_political_meta_raw_bytes": len(
                    json.dumps(
                        payload["scenario"].get("runtime_political_meta"),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ),
                "apply_seed_raw_bytes": len(
                    json.dumps(payload["scenario"]["apply_seed"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                ),
                "bootstrap_strategy": payload["scenario"].get("bootstrap_strategy", ""),
            },
        }
    if report_path is not None:
        write_json_atomic(report_path, report, ensure_ascii=False, indent=2, trailing_newline=True)
    return report


def build_startup_bundles(
    *,
    scenario_manifest_path: Path,
    data_manifest_path: Path,
    topology_primary_path: Path,
    startup_locales_path: Path,
    geo_aliases_path: Path,
    runtime_bootstrap_topology_path: Path,
    countries_path: Path,
    owners_path: Path,
    controllers_path: Path,
    cores_path: Path,
    geo_locale_patch_en_path: Path,
    geo_locale_patch_zh_path: Path,
    output_en_path: Path,
    output_zh_path: Path,
    report_path: Path | None = None,
) -> dict:
    scenario_manifest = _read_json(scenario_manifest_path)
    data_manifest = _read_json(data_manifest_path)
    startup_locales = _read_json(startup_locales_path)
    original_geo_aliases = _read_json(geo_aliases_path)

    payload_by_language = {}
    output_paths_by_language = {
        "en": output_en_path,
        "zh": output_zh_path,
    }
    gzip_paths_by_language = {}
    startup_locales_payload_by_language = {}
    patch_paths_by_language = {
        "en": geo_locale_patch_en_path,
        "zh": geo_locale_patch_zh_path,
    }
    for language in SUPPORTED_LANGUAGES:
        single_language_locales_payload = build_single_language_locales_payload(startup_locales, language)
        startup_locales_payload_by_language[language] = single_language_locales_payload
        payload = build_startup_bundle_payload(
            language=language,
            scenario_manifest=scenario_manifest,
            data_manifest=data_manifest,
            topology_primary_path=topology_primary_path,
            startup_locales_path=startup_locales_path,
            startup_locales_payload=single_language_locales_payload,
            geo_aliases_path=geo_aliases_path,
            runtime_bootstrap_topology_path=runtime_bootstrap_topology_path,
            countries_path=countries_path,
            owners_path=owners_path,
            controllers_path=controllers_path,
            cores_path=cores_path,
            geo_locale_patch_path=patch_paths_by_language[language],
        )
        payload_by_language[language] = payload
        write_json_atomic(
            output_paths_by_language[language],
            payload,
            ensure_ascii=False,
            indent=None,
            separators=(",", ":"),
            trailing_newline=True,
        )
        gzip_paths_by_language[language] = write_gzip_sidecar(payload, output_paths_by_language[language])

    report = build_startup_bundle_report(
        payload_by_language=payload_by_language,
        output_paths_by_language=output_paths_by_language,
        gzip_paths_by_language=gzip_paths_by_language,
        startup_locales_payload_by_language=startup_locales_payload_by_language,
        original_geo_aliases=original_geo_aliases,
        report_path=report_path,
    )
    return {
        "scenario_id": _normalize_text(scenario_manifest.get("scenario_id")),
        "outputs": {language: str(path) for language, path in output_paths_by_language.items()},
        "gzip_outputs": {language: str(path) for language, path in gzip_paths_by_language.items()},
        "report_path": str(report_path) if report_path else "",
        "report": report,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build language-specific startup bundles for the default startup scenario.")
    parser.add_argument("--scenario-manifest", required=True)
    parser.add_argument("--data-manifest", default=str(ROOT / "data/manifest.json"))
    parser.add_argument("--topology-primary", default=str(ROOT / "data/europe_topology.json"))
    parser.add_argument("--startup-locales", default=str(ROOT / "data/scenarios/tno_1962/locales.startup.json"))
    parser.add_argument("--geo-aliases", default=str(ROOT / "data/scenarios/tno_1962/geo_aliases.startup.json"))
    parser.add_argument("--runtime-bootstrap-topology", required=True)
    parser.add_argument("--countries", required=True)
    parser.add_argument("--owners", required=True)
    parser.add_argument("--controllers", required=True)
    parser.add_argument("--cores", required=True)
    parser.add_argument("--geo-locale-patch-en", required=True)
    parser.add_argument("--geo-locale-patch-zh", required=True)
    parser.add_argument("--output-en", required=True)
    parser.add_argument("--output-zh", required=True)
    parser.add_argument("--report-path", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = build_startup_bundles(
        scenario_manifest_path=Path(args.scenario_manifest).resolve(),
        data_manifest_path=Path(args.data_manifest).resolve(),
        topology_primary_path=Path(args.topology_primary).resolve(),
        startup_locales_path=Path(args.startup_locales).resolve(),
        geo_aliases_path=Path(args.geo_aliases).resolve(),
        runtime_bootstrap_topology_path=Path(args.runtime_bootstrap_topology).resolve(),
        countries_path=Path(args.countries).resolve(),
        owners_path=Path(args.owners).resolve(),
        controllers_path=Path(args.controllers).resolve(),
        cores_path=Path(args.cores).resolve(),
        geo_locale_patch_en_path=Path(args.geo_locale_patch_en).resolve(),
        geo_locale_patch_zh_path=Path(args.geo_locale_patch_zh).resolve(),
        output_en_path=Path(args.output_en).resolve(),
        output_zh_path=Path(args.output_zh).resolve(),
        report_path=Path(args.report_path).resolve() if _normalize_text(args.report_path) else None,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
