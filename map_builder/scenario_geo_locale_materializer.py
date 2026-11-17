from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from map_builder.contracts import (
    SCENARIO_CHECKPOINT_GEO_LOCALE_FILENAME as CHECKPOINT_GEO_LOCALE_FILENAME,
    SCENARIO_CHECKPOINT_GEO_LOCALE_EN_FILENAME as CHECKPOINT_GEO_LOCALE_EN_FILENAME,
    SCENARIO_CHECKPOINT_GEO_LOCALE_ZH_FILENAME as CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
    SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
)
from map_builder.scenario_bundle_platform import load_checkpoint_json, load_json, write_checkpoint_json
from map_builder.scenario_build_session import (
    ensure_scenario_build_session,
    record_stage_outputs,
)
from map_builder.scenario_geo_locale_registry import (
    get_registered_geo_locale_builder_path,
)
from map_builder.scenario_service_errors import ScenarioServiceError

NON_TNO_GEO_LOCALE_CHECKPOINT_FILENAME = "geo_locale_patch.json"


def normalize_locale_override_entry(source: object) -> dict[str, str] | None:
    if not isinstance(source, dict):
        return None
    en = str(source.get("en") or source.get("name_en") or source.get("label_en") or "").strip()
    zh = str(source.get("zh") or source.get("name_zh") or source.get("label_zh") or source.get("name_cn") or "").strip()
    entry: dict[str, str] = {}
    if en:
        entry["en"] = en
    if zh:
        entry["zh"] = zh
    return entry or None


def build_locale_specific_geo_locale_payload(payload: dict, language: str) -> dict:
    normalized_language = "zh" if str(language or "").strip().lower() == "zh" else "en"
    language_geo: dict[str, dict[str, str]] = {}
    raw_geo = payload.get("geo", {}) if isinstance(payload, dict) else {}
    for feature_id, raw_entry in raw_geo.items():
        entry = normalize_locale_override_entry(raw_entry)
        if not entry:
            continue
        value = str(entry.get(normalized_language) or "").strip()
        if not value:
            continue
        language_geo[str(feature_id)] = {normalized_language: value}
    locale_payload = {
        key: value
        for key, value in payload.items()
        if key != "audit"
    }
    locale_payload["geo"] = language_geo
    return locale_payload


def ensure_geo_locale_variant_checkpoints(checkpoint_dir: Path) -> None:
    base_payload = load_checkpoint_json(checkpoint_dir, CHECKPOINT_GEO_LOCALE_FILENAME)
    write_checkpoint_json(
        checkpoint_dir,
        CHECKPOINT_GEO_LOCALE_EN_FILENAME,
        build_locale_specific_geo_locale_payload(base_payload, "en"),
    )
    write_checkpoint_json(
        checkpoint_dir,
        CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
        build_locale_specific_geo_locale_payload(base_payload, "zh"),
    )


def validate_geo_locale_manual_overrides(geo_locale_payload: dict, manual_overrides_payload: dict) -> None:
    geo = geo_locale_payload.get("geo", {}) if isinstance(geo_locale_payload, dict) else {}
    manual_geo_raw = manual_overrides_payload.get("geo", {}) if isinstance(manual_overrides_payload, dict) else {}
    missing_feature_ids: list[str] = []
    mismatched_feature_ids: list[str] = []
    for raw_feature_id, raw_entry in manual_geo_raw.items():
        feature_id = str(raw_feature_id or "").strip()
        expected_entry = normalize_locale_override_entry(raw_entry)
        if not feature_id or not expected_entry:
            continue
        actual_entry = normalize_locale_override_entry(geo.get(feature_id))
        if actual_entry is None:
            missing_feature_ids.append(feature_id)
            continue
        if actual_entry != expected_entry:
            mismatched_feature_ids.append(feature_id)
    if missing_feature_ids or mismatched_feature_ids:
        details: list[str] = []
        if missing_feature_ids:
            details.append(f"missing={missing_feature_ids[:20]}")
        if mismatched_feature_ids:
            details.append(f"mismatched={mismatched_feature_ids[:20]}")
        raise ValueError("Geo locale checkpoint does not reflect manual overrides: " + "; ".join(details))


def validate_geo_locale_checkpoint(checkpoint_dir: Path, manual_overrides_path: Path) -> None:
    geo_locale_payload = load_checkpoint_json(checkpoint_dir, CHECKPOINT_GEO_LOCALE_FILENAME)
    manual_overrides_payload = load_json(manual_overrides_path) if manual_overrides_path.exists() else {}
    validate_geo_locale_manual_overrides(geo_locale_payload, manual_overrides_payload)
    ensure_geo_locale_variant_checkpoints(checkpoint_dir)


def default_manual_geo_payload(scenario_id: str) -> dict[str, object]:
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "generated_at": "",
        "geo": {},
    }


def normalize_geo_locale_entry(en: object, zh: object) -> dict[str, str]:
    entry: dict[str, str] = {}
    en_text = str(en or "").strip()
    zh_text = str(zh or "").strip()
    if en_text:
        entry["en"] = en_text
    if zh_text:
        entry["zh"] = zh_text
    return entry


def build_manual_geo_payload_from_mutations(
    scenario_id: str,
    mutations_payload: dict[str, object],
    *,
    generated_at: str,
) -> dict[str, object]:
    payload = default_manual_geo_payload(scenario_id)
    payload["generated_at"] = generated_at
    raw_geo = mutations_payload.get("geo_locale", {})
    if not isinstance(raw_geo, dict):
        return payload
    normalized_geo: dict[str, dict[str, str]] = {}
    for raw_feature_id, raw_entry in raw_geo.items():
        feature_id = str(raw_feature_id or "").strip()
        if not feature_id or not isinstance(raw_entry, dict):
            continue
        normalized_entry = normalize_geo_locale_entry(
            raw_entry.get("en"),
            raw_entry.get("zh"),
        )
        if normalized_entry:
            normalized_geo[feature_id] = normalized_entry
    payload["geo"] = normalized_geo
    return payload


def _run_legacy_geo_locale_builder(
    context: dict[str, object],
    *,
    root: Path,
    builder_path: Path,
    output_path: Path,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
) -> dict[str, object]:
    scenario_id = str(context["scenarioId"])
    command = [
        sys.executable,
        str(builder_path),
        "--scenario-id",
        scenario_id,
        "--scenario-dir",
        str(context["scenarioDir"]),
        "--manual-overrides",
        str(context["manualGeoOverridesPath"]),
        "--output",
        str(output_path),
    ]
    build_error_details: dict[str, object] = {
        "command": command,
    }
    try:
        result = subprocess.run(
            command,
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception as exc:
        build_error_details["error"] = repr(exc)
        raise error_cls(
            "geo_locale_build_failed",
            "The geo locale patch builder failed after updating manual overrides.",
            status=500,
            details=build_error_details,
        ) from exc
    if result.returncode != 0:
        build_error_details.update(
            {
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-2000:],
            }
        )
        raise error_cls(
            "geo_locale_build_failed",
            "The geo locale patch builder failed after updating manual overrides.",
            status=500,
            details=build_error_details,
        )
    return {
        "checkpointPaths": [str(output_path)],
        "buildMode": "subprocess",
    }


def resolve_geo_locale_builder_path(
    context: dict[str, object],
    *,
    fallback_builder_path: Path | None = None,
) -> Path | None:
    if fallback_builder_path is not None:
        return Path(fallback_builder_path)
    registered_builder_path = get_registered_geo_locale_builder_path(
        str(context["scenarioId"])
    )
    if registered_builder_path:
        return Path(registered_builder_path)
    return None


def materialize_scenario_geo_locale(
    context: dict[str, object],
    *,
    root: Path,
    error_cls: type[ScenarioServiceError] = ScenarioServiceError,
    fallback_builder_path: Path | None = None,
    checkpoint_dir: Path | None = None,
) -> dict[str, object]:
    scenario_id = str(context["scenarioId"])
    build_session = ensure_scenario_build_session(
        scenario_id=scenario_id,
        scenario_dir=Path(context["scenarioDir"]),
        root=root,
        build_dir=checkpoint_dir,
    )
    resolved_checkpoint_dir = Path(build_session["buildDir"])
    if scenario_id == "tno_1962":
        from tools import patch_tno_1962_bundle as tno_bundle

        tno_bundle.build_geo_locale_stage(
            Path(context["scenarioDir"]),
            resolved_checkpoint_dir,
            refresh_named_water_snapshot=False,
        )
        tno_bundle.build_startup_assets_stage(
            Path(context["scenarioDir"]),
            resolved_checkpoint_dir,
            refresh_named_water_snapshot=False,
        )
        checkpoint_paths = [
            resolved_checkpoint_dir / SCENARIO_CHECKPOINT_RUNTIME_BOOTSTRAP_FILENAME,
            resolved_checkpoint_dir / CHECKPOINT_GEO_LOCALE_FILENAME,
            resolved_checkpoint_dir / CHECKPOINT_GEO_LOCALE_EN_FILENAME,
            resolved_checkpoint_dir / CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
            resolved_checkpoint_dir / SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
            resolved_checkpoint_dir / SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
        ]
        record_stage_outputs(
            build_dir=resolved_checkpoint_dir,
            stage="geo-locale",
            output_paths=checkpoint_paths,
            root=root,
        )
        return {
            "checkpointPaths": [
                str(path) for path in checkpoint_paths
            ],
            "checkpointDir": str(resolved_checkpoint_dir),
            "snapshotHash": str(build_session["snapshotHash"]),
            "buildMode": "in_process",
        }

    builder_path = resolve_geo_locale_builder_path(
        context,
        fallback_builder_path=fallback_builder_path,
    )
    if not builder_path:
        raise error_cls(
            "geo_locale_not_supported",
            f'Scenario "{scenario_id}" does not have a registered geo locale patch builder yet.',
            status=501,
        )
    output_path = resolved_checkpoint_dir / NON_TNO_GEO_LOCALE_CHECKPOINT_FILENAME
    result = _run_legacy_geo_locale_builder(
        context,
        root=root,
        builder_path=Path(builder_path),
        output_path=output_path,
        error_cls=error_cls,
    )
    record_stage_outputs(
        build_dir=resolved_checkpoint_dir,
        stage="geo-locale",
        output_paths=[output_path],
        root=root,
    )
    result["checkpointDir"] = str(resolved_checkpoint_dir)
    result["snapshotHash"] = str(build_session["snapshotHash"])
    return result
