from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable, Iterable

from map_builder.contracts import (
    SCENARIO_COUNTRIES_STAGE_ARTIFACTS,
    SCENARIO_CHUNK_STAGE_REQUIRED_FILENAMES,
    SCENARIO_GEO_LOCALE_STAGE_ARTIFACTS,
    SCENARIO_OPTIONAL_RUNTIME_STAGE_ARTIFACTS,
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA,
    SCENARIO_RUNTIME_STAGE_EXTRA_ARTIFACTS,
    SCENARIO_STARTUP_BUNDLE_STAGE_ARTIFACTS,
    SCENARIO_STARTUP_SUPPORT_STAGE_ARTIFACTS,
    SCENARIO_STARTUP_STAGE_ARTIFACTS,
    SCENARIO_WATER_STAGE_ARTIFACTS,
    ScenarioCheckpointArtifact,
    resolve_scenario_publish_filenames,
)


def checkpoint_path(checkpoint_dir: Path, filename: str) -> Path:
    return checkpoint_dir / filename


def write_checkpoint_json(
    checkpoint_dir: Path,
    filename: str,
    payload: dict,
    *,
    write_json: Callable[[Path, dict], None],
) -> None:
    path = checkpoint_path(checkpoint_dir, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, payload)


def write_checkpoint_gdf(
    checkpoint_dir: Path,
    filename: str,
    gdf,
    *,
    write_json: Callable[[Path, dict], None],
    gdf_to_feature_collection: Callable[[object], dict],
) -> None:
    write_checkpoint_json(
        checkpoint_dir,
        filename,
        gdf_to_feature_collection(gdf),
        write_json=write_json,
    )


def load_checkpoint_json(
    checkpoint_dir: Path,
    filename: str,
    *,
    load_json: Callable[[Path], object],
) -> dict:
    path = checkpoint_path(checkpoint_dir, filename)
    if not path.exists():
        raise FileNotFoundError(f"Missing checkpoint artifact: {path}")
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise TypeError(f"Checkpoint artifact must be a JSON object: {path}")
    return payload


def load_checkpoint_gdf(
    checkpoint_dir: Path,
    filename: str,
    *,
    load_json: Callable[[Path], object],
    geopandas_from_features: Callable[[list[object]], object],
):
    payload = load_checkpoint_json(checkpoint_dir, filename, load_json=load_json)
    return geopandas_from_features(payload.get("features", []))


def write_checkpoint_artifacts(
    state: dict[str, object],
    checkpoint_dir: Path,
    artifacts: Iterable[ScenarioCheckpointArtifact],
    *,
    write_json: Callable[[Path, dict], None],
    gdf_to_feature_collection: Callable[[object], dict],
) -> None:
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    for artifact in artifacts:
        payload = state[artifact.state_key]
        if artifact.payload_kind == "gdf":
            write_checkpoint_gdf(
                checkpoint_dir,
                artifact.filename,
                payload,
                write_json=write_json,
                gdf_to_feature_collection=gdf_to_feature_collection,
            )
        else:
            write_checkpoint_json(
                checkpoint_dir,
                artifact.filename,
                payload,
                write_json=write_json,
            )


def write_optional_checkpoint_artifacts(
    state: dict[str, object],
    checkpoint_dir: Path,
    artifacts: Iterable[ScenarioCheckpointArtifact],
    *,
    write_json: Callable[[Path, dict], None],
) -> None:
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    for artifact in artifacts:
        payload = state.get(artifact.state_key)
        if isinstance(payload, dict):
            write_checkpoint_json(
                checkpoint_dir,
                artifact.filename,
                payload,
                write_json=write_json,
            )


def load_checkpoint_artifacts(
    checkpoint_dir: Path,
    artifacts: Iterable[ScenarioCheckpointArtifact],
    *,
    load_json: Callable[[Path], object],
    geopandas_from_features: Callable[[list[object]], object],
) -> dict[str, object]:
    state: dict[str, object] = {}
    for artifact in artifacts:
        if artifact.payload_kind == "gdf":
            state[artifact.state_key] = load_checkpoint_gdf(
                checkpoint_dir,
                artifact.filename,
                load_json=load_json,
                geopandas_from_features=geopandas_from_features,
            )
        else:
            state[artifact.state_key] = load_checkpoint_json(
                checkpoint_dir,
                artifact.filename,
                load_json=load_json,
            )
    return state


def load_optional_checkpoint_artifacts(
    checkpoint_dir: Path,
    artifacts: Iterable[ScenarioCheckpointArtifact],
    *,
    load_json: Callable[[Path], object],
) -> dict[str, object]:
    state: dict[str, object] = {}
    for artifact in artifacts:
        path = checkpoint_path(checkpoint_dir, artifact.filename)
        if path.exists():
            state[artifact.state_key] = load_checkpoint_json(
                checkpoint_dir,
                artifact.filename,
                load_json=load_json,
            )
    return state


def all_checkpoint_files_exist(checkpoint_dir: Path, filenames: Iterable[str]) -> bool:
    return all(checkpoint_path(checkpoint_dir, filename).exists() for filename in filenames)


def require_directory_files(base_dir: Path, filenames: Iterable[str], *, label: str) -> None:
    missing = [filename for filename in filenames if not (base_dir / filename).exists()]
    if missing:
        sample = ", ".join(missing[:8])
        if len(missing) > 8:
            sample += ", ..."
        raise FileNotFoundError(f"Missing {label} artifacts in {base_dir}: {sample}")


def write_countries_stage_checkpoints(
    state: dict[str, object],
    checkpoint_dir: Path,
    *,
    write_json: Callable[[Path, dict], None],
    gdf_to_feature_collection: Callable[[object], dict],
) -> None:
    write_checkpoint_artifacts(
        state,
        checkpoint_dir,
        SCENARIO_COUNTRIES_STAGE_ARTIFACTS,
        write_json=write_json,
        gdf_to_feature_collection=gdf_to_feature_collection,
    )
    write_optional_checkpoint_artifacts(
        state,
        checkpoint_dir,
        SCENARIO_OPTIONAL_RUNTIME_STAGE_ARTIFACTS,
        write_json=write_json,
    )


def load_countries_stage_checkpoints(
    checkpoint_dir: Path,
    *,
    load_json: Callable[[Path], object],
    geopandas_from_features: Callable[[list[object]], object],
) -> dict[str, object]:
    state = load_checkpoint_artifacts(
        checkpoint_dir,
        SCENARIO_COUNTRIES_STAGE_ARTIFACTS,
        load_json=load_json,
        geopandas_from_features=geopandas_from_features,
    )
    state.update(
        load_optional_checkpoint_artifacts(
            checkpoint_dir,
            SCENARIO_OPTIONAL_RUNTIME_STAGE_ARTIFACTS,
            load_json=load_json,
        )
    )
    return state


def write_water_stage_checkpoints(
    state: dict[str, object],
    checkpoint_dir: Path,
    *,
    write_json: Callable[[Path, dict], None],
    gdf_to_feature_collection: Callable[[object], dict],
) -> None:
    write_checkpoint_artifacts(
        state,
        checkpoint_dir,
        SCENARIO_WATER_STAGE_ARTIFACTS,
        write_json=write_json,
        gdf_to_feature_collection=gdf_to_feature_collection,
    )


def load_water_stage_checkpoints(
    checkpoint_dir: Path,
    *,
    load_json: Callable[[Path], object],
    geopandas_from_features: Callable[[list[object]], object],
) -> dict[str, object]:
    return load_checkpoint_artifacts(
        checkpoint_dir,
        SCENARIO_WATER_STAGE_ARTIFACTS,
        load_json=load_json,
        geopandas_from_features=geopandas_from_features,
    )


def write_runtime_topology_stage_checkpoints(
    state: dict[str, object],
    checkpoint_dir: Path,
    *,
    write_json: Callable[[Path, dict], None],
    gdf_to_feature_collection: Callable[[object], dict],
) -> None:
    write_countries_stage_checkpoints(
        state,
        checkpoint_dir,
        write_json=write_json,
        gdf_to_feature_collection=gdf_to_feature_collection,
    )
    write_water_stage_checkpoints(
        state,
        checkpoint_dir,
        write_json=write_json,
        gdf_to_feature_collection=gdf_to_feature_collection,
    )
    write_checkpoint_artifacts(
        state,
        checkpoint_dir,
        SCENARIO_RUNTIME_STAGE_EXTRA_ARTIFACTS,
        write_json=write_json,
        gdf_to_feature_collection=gdf_to_feature_collection,
    )


def require_geo_locale_stage_checkpoints(checkpoint_dir: Path) -> None:
    require_directory_files(
        checkpoint_dir,
        (artifact.filename for artifact in SCENARIO_GEO_LOCALE_STAGE_ARTIFACTS),
        label="geo-locale checkpoint",
    )


def require_water_stage_checkpoints(checkpoint_dir: Path) -> None:
    require_directory_files(
        checkpoint_dir,
        (artifact.filename for artifact in SCENARIO_WATER_STAGE_ARTIFACTS),
        label="water-state checkpoint",
    )


def require_startup_stage_checkpoints(checkpoint_dir: Path) -> None:
    require_directory_files(
        checkpoint_dir,
        (artifact.filename for artifact in SCENARIO_STARTUP_STAGE_ARTIFACTS),
        label="startup-assets checkpoint",
    )


def require_startup_support_stage_checkpoints(checkpoint_dir: Path) -> None:
    require_directory_files(
        checkpoint_dir,
        (artifact.filename for artifact in SCENARIO_STARTUP_SUPPORT_STAGE_ARTIFACTS),
        label="startup-support-assets checkpoint",
    )


def require_startup_bundle_stage_checkpoints(checkpoint_dir: Path) -> None:
    require_directory_files(
        checkpoint_dir,
        (artifact.filename for artifact in SCENARIO_STARTUP_BUNDLE_STAGE_ARTIFACTS),
        label="startup-bundle-assets checkpoint",
    )


def require_chunk_stage_checkpoints(checkpoint_dir: Path) -> None:
    require_directory_files(
        checkpoint_dir,
        SCENARIO_CHUNK_STAGE_REQUIRED_FILENAMES,
        label="chunk-assets checkpoint",
    )


def require_chunk_stage_publish_inputs(scenario_dir: Path) -> None:
    require_directory_files(
        scenario_dir,
        SCENARIO_CHUNK_STAGE_REQUIRED_FILENAMES,
        label="chunk-assets publish",
    )


def ensure_runtime_topology_checkpoints(
    scenario_dir: Path,
    checkpoint_dir: Path,
    *,
    refresh_named_water_snapshot: bool,
    build_countries_stage_state: Callable[..., dict[str, object]],
    build_water_stage_state: Callable[..., dict[str, object]],
    build_runtime_topology_state: Callable[[dict[str, object], dict[str, object]], dict[str, object]],
    load_countries_stage_checkpoints: Callable[[Path], dict[str, object]],
    load_water_stage_checkpoints: Callable[[Path], dict[str, object]],
    write_countries_stage_checkpoints: Callable[[dict[str, object], Path], None],
    write_water_stage_checkpoints: Callable[[dict[str, object], Path], None],
    write_runtime_topology_stage_checkpoints: Callable[[dict[str, object], Path], None],
) -> None:
    countries_stage_required = [artifact.filename for artifact in SCENARIO_COUNTRIES_STAGE_ARTIFACTS]
    water_stage_required = [artifact.filename for artifact in SCENARIO_WATER_STAGE_ARTIFACTS]
    required = [
        *countries_stage_required,
        *water_stage_required,
        *(artifact.filename for artifact in SCENARIO_RUNTIME_STAGE_EXTRA_ARTIFACTS),
        *(artifact.filename for artifact in SCENARIO_OPTIONAL_RUNTIME_STAGE_ARTIFACTS),
    ]
    if all_checkpoint_files_exist(checkpoint_dir, required):
        return

    if all_checkpoint_files_exist(checkpoint_dir, countries_stage_required):
        countries_state = load_countries_stage_checkpoints(checkpoint_dir)
    else:
        countries_state = build_countries_stage_state(
            scenario_dir,
            refresh_named_water_snapshot=refresh_named_water_snapshot,
        )
        write_countries_stage_checkpoints(countries_state, checkpoint_dir)

    if all_checkpoint_files_exist(checkpoint_dir, water_stage_required):
        water_state = load_water_stage_checkpoints(checkpoint_dir)
    else:
        water_state = build_water_stage_state(
            scenario_dir,
            checkpoint_dir,
            refresh_named_water_snapshot=refresh_named_water_snapshot,
        )
        write_water_stage_checkpoints(water_state, checkpoint_dir)

    state = build_runtime_topology_state(countries_state, water_state)
    write_runtime_topology_stage_checkpoints(state, checkpoint_dir)


def build_manual_sync_file_report(
    filename: str,
    scenario_payload: dict,
    checkpoint_payload: dict,
    *,
    normalize_core_tags: Callable[[object], list[str]],
    normalize_locale_override_entry: Callable[[object], dict[str, str] | None],
) -> dict[str, object]:
    if filename == "countries.json":
        scenario_countries = scenario_payload.get("countries", {}) if isinstance(scenario_payload, dict) else {}
        checkpoint_countries = checkpoint_payload.get("countries", {}) if isinstance(checkpoint_payload, dict) else {}
        changed_keys = sorted(
            key
            for key in set(scenario_countries.keys()) | set(checkpoint_countries.keys())
            if scenario_countries.get(key) != checkpoint_countries.get(key)
        )
        kind = "countries"
    elif filename in {"owners.by_feature.json", "controllers.by_feature.json"}:
        key = "owners" if filename.startswith("owners") else "controllers"
        scenario_map = scenario_payload.get(key, {}) if isinstance(scenario_payload, dict) else {}
        checkpoint_map = checkpoint_payload.get(key, {}) if isinstance(checkpoint_payload, dict) else {}
        changed_keys = sorted(
            feature_id
            for feature_id in set(scenario_map.keys()) | set(checkpoint_map.keys())
            if scenario_map.get(feature_id) != checkpoint_map.get(feature_id)
        )
        kind = key
    elif filename == "cores.by_feature.json":
        scenario_map = scenario_payload.get("cores", {}) if isinstance(scenario_payload, dict) else {}
        checkpoint_map = checkpoint_payload.get("cores", {}) if isinstance(checkpoint_payload, dict) else {}
        changed_keys = sorted(
            feature_id
            for feature_id in set(scenario_map.keys()) | set(checkpoint_map.keys())
            if normalize_core_tags(scenario_map.get(feature_id)) != normalize_core_tags(checkpoint_map.get(feature_id))
        )
        kind = "cores"
    else:
        scenario_geo = scenario_payload.get("geo", {}) if isinstance(scenario_payload, dict) else {}
        checkpoint_geo = checkpoint_payload.get("geo", {}) if isinstance(checkpoint_payload, dict) else {}
        changed_keys = sorted(
            feature_id
            for feature_id in set(scenario_geo.keys()) | set(checkpoint_geo.keys())
            if normalize_locale_override_entry(scenario_geo.get(feature_id))
            != normalize_locale_override_entry(checkpoint_geo.get(feature_id))
        )
        kind = "geo_locale_patch"
    return {
        "file": filename,
        "kind": kind,
        "changed_keys_sample": changed_keys[:25],
        "changed_key_count": len(changed_keys),
    }


def detect_unsynced_manual_edits(
    scenario_dir: Path,
    checkpoint_dir: Path,
    manual_sources: dict[str, Path],
    *,
    scenario_id: str,
    policy: str,
    load_json: Callable[[Path], object],
    write_json: Callable[[Path, dict], None],
    utc_timestamp: Callable[[], str],
    normalize_core_tags: Callable[[object], list[str]],
    normalize_locale_override_entry: Callable[[object], dict[str, str] | None],
    report_dir: Path,
    backup_root: Path,
    backup_continue_policy: str,
    strict_block_policy: str,
) -> dict[str, object]:
    monitored_filenames = (
        "countries.json",
        "owners.by_feature.json",
        "controllers.by_feature.json",
        "cores.by_feature.json",
        "geo_locale_patch.json",
    )
    drift_files: list[dict[str, object]] = []
    for filename in monitored_filenames:
        scenario_path = scenario_dir / filename
        checkpoint_payload_path = checkpoint_dir / filename
        if not scenario_path.exists() or not checkpoint_payload_path.exists():
            continue
        scenario_payload = load_json(scenario_path)
        checkpoint_payload = load_json(checkpoint_payload_path)
        if scenario_payload == checkpoint_payload:
            continue
        if not isinstance(scenario_payload, dict) or not isinstance(checkpoint_payload, dict):
            raise TypeError(f"Manual sync comparison expects JSON objects for {filename}")
        drift_files.append(
            build_manual_sync_file_report(
                filename,
                scenario_payload,
                checkpoint_payload,
                normalize_core_tags=normalize_core_tags,
                normalize_locale_override_entry=normalize_locale_override_entry,
            )
        )

    timestamp = utc_timestamp().replace(":", "").replace("-", "")
    report = {
        "scenario_id": scenario_id,
        "generated_at": utc_timestamp(),
        "policy": policy,
        "has_drift": bool(drift_files),
        "manual_sources": {key: str(path) for key, path in manual_sources.items()},
        "files": drift_files,
    }
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"{scenario_id}-{timestamp}.json"
    write_json(report_path, report)
    report["report_path"] = str(report_path)
    if not drift_files:
        return report

    if policy == backup_continue_policy:
        backup_dir = backup_root / scenario_id / timestamp
        backup_dir.mkdir(parents=True, exist_ok=True)
        for filename in resolve_scenario_publish_filenames(SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA):
            source_path = scenario_dir / filename
            if source_path.exists():
                backup_path = backup_dir / filename
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, backup_path)
        report["backup_path"] = str(backup_dir)

    if policy == strict_block_policy:
        raise ValueError(f"Unsynced manual edits detected. See report: {report_path}")
    return report


def validate_strict_publish_bundle(
    checkpoint_dir: Path,
    publish_scope: str,
    *,
    scenario_data_scope: str,
    all_scope: str,
    validate_publish_bundle_dir: Callable[[Path], list[str]],
) -> None:
    if publish_scope not in {scenario_data_scope, all_scope}:
        return
    strict_contract_errors = validate_publish_bundle_dir(checkpoint_dir)
    if strict_contract_errors:
        raise ValueError(
            "Strict bundle validation failed for publish checkpoint:\n- "
            + "\n- ".join(strict_contract_errors)
        )


def publish_checkpoint_bundle(
    scenario_dir: Path,
    checkpoint_dir: Path,
    publish_scope: str,
    *,
    load_checkpoint_json: Callable[[Path, str], dict],
    write_json: Callable[[Path, dict], None],
) -> None:
    scenario_dir.mkdir(parents=True, exist_ok=True)
    for filename in resolve_scenario_publish_filenames(publish_scope):
        payload = load_checkpoint_json(checkpoint_dir, filename)
        output_path = scenario_dir / filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(output_path, payload)
