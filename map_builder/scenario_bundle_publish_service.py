from __future__ import annotations

import copy
import shutil
import tempfile
from pathlib import Path
from typing import Callable, Iterable, Mapping

from map_builder import scenario_bundle_platform
from map_builder.scenario_build_session import ensure_scenario_build_session, record_published_target
from map_builder.json_source import (
    json_source_sha256,
    portable_gzip_bytes,
    resolve_json_source_path,
    write_runtime_topology_source,
)
from map_builder.io.writers import write_bytes_atomic
from map_builder.scenario_locks import _pid_is_alive
from map_builder.scenario_bundle_platform import load_checkpoint_json, load_json, utc_timestamp, write_json
from map_builder.scenario_geo_locale_materializer import (
    normalize_locale_override_entry,
    validate_geo_locale_checkpoint,
)
from map_builder.contracts import (
    MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    MANUAL_SYNC_POLICY_STRICT_BLOCK,
    SCENARIO_CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME as CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME as CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
    SCENARIO_CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME as CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
    SCENARIO_PUBLISH_SCOPE_SCENARIO_DATA as PUBLISH_SCOPE_SCENARIO_DATA,
    SCENARIO_PUBLISH_SCOPE_ALL as PUBLISH_SCOPE_ALL,
    normalize_scenario_core_tags as normalize_core_tags,
    resolve_scenario_publish_filenames,
)

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ID = "tno_1962"
SCENARIO_DIR = ROOT / "data" / "scenarios" / SCENARIO_ID
MANUAL_OVERRIDE_FILENAME = "scenario_manual_overrides.json"
MANUAL_SYNC_REPORT_DIR = ROOT / ".runtime" / "reports" / "generated" / "manual-sync"
MANUAL_SYNC_BACKUP_ROOT = ROOT / ".runtime" / "backups" / "scenario-rebuild"
RUNTIME_ACTIVE_SERVER_METADATA_PATH = ROOT / ".runtime" / "dev" / "active_server.json"


def plan_publish_scenario_build_in_locked_session(
    scenario_dir: Path,
    checkpoint_dir: Path,
    *,
    publish_scope: str,
    manual_sync_policy: str,
    scenario_id: str,
    scenario_data_scope: str,
    all_scope: str,
    manual_source_filenames: Mapping[str, str],
    validate_publish_bundle_dir: Callable[[Path], list[str]],
    ensure_publish_target_offline: Callable[[Path], None],
    validate_geo_locale_checkpoint: Callable[[Path, Path], None],
    require_startup_stage_checkpoints: Callable[[Path], None],
    detect_unsynced_manual_edits: Callable[..., dict[str, object]],
    resolve_publish_filenames: Callable[[str], Iterable[str]],
    geo_name_overrides_filename: str = "geo_name_overrides.manual.json",
) -> dict[str, object]:
    published_files = list(resolve_publish_filenames(publish_scope))
    published_paths = [scenario_dir / filename for filename in published_files]
    manual_sync_report: dict[str, object] | None = None
    if publish_scope in {scenario_data_scope, all_scope}:
        ensure_publish_target_offline(scenario_dir)
        scenario_bundle_platform.validate_strict_publish_bundle(
            checkpoint_dir,
            publish_scope,
            scenario_data_scope=scenario_data_scope,
            all_scope=all_scope,
            validate_publish_bundle_dir=validate_publish_bundle_dir,
        )
        validate_geo_locale_checkpoint(checkpoint_dir, scenario_dir / geo_name_overrides_filename)
        require_startup_stage_checkpoints(checkpoint_dir)
        manual_sources = {
            key: scenario_dir / filename
            for key, filename in manual_source_filenames.items()
        }
        manual_sync_report = detect_unsynced_manual_edits(
            scenario_dir,
            checkpoint_dir,
            manual_sources,
            policy=manual_sync_policy,
        )
    return {
        "scenarioDir": scenario_dir,
        "checkpointDir": checkpoint_dir,
        "scenarioId": scenario_id,
        "publishScope": publish_scope,
        "manualSyncPolicy": manual_sync_policy,
        "publishMode": "copied_from_checkpoint",
        "publishedFiles": published_files,
        "publishedPaths": published_paths,
        "manualSyncReport": manual_sync_report,
    }


def commit_publish_scenario_build_plan(
    publish_plan: Mapping[str, object],
    *,
    publish_checkpoint_bundle: Callable[..., None],
    load_checkpoint_json: Callable[[Path, str], dict],
    write_json: Callable[[Path, dict], None],
) -> None:
    publish_checkpoint_bundle(
        Path(publish_plan["scenarioDir"]),
        Path(publish_plan["checkpointDir"]),
        str(publish_plan["publishScope"]),
        load_checkpoint_json=load_checkpoint_json,
        write_json=write_json,
    )


def publish_scenario_build_in_locked_session(
    scenario_dir: Path,
    checkpoint_dir: Path,
    *,
    publish_scope: str,
    manual_sync_policy: str,
    scenario_id: str,
    scenario_data_scope: str,
    all_scope: str,
    manual_source_filenames: Mapping[str, str],
    validate_publish_bundle_dir: Callable[[Path], list[str]],
    ensure_publish_target_offline: Callable[[Path], None],
    validate_geo_locale_checkpoint: Callable[[Path, Path], None],
    require_startup_stage_checkpoints: Callable[[Path], None],
    detect_unsynced_manual_edits: Callable[..., dict[str, object]],
    publish_checkpoint_bundle: Callable[..., None],
    load_checkpoint_json: Callable[[Path, str], dict],
    write_json: Callable[[Path, dict], None],
    resolve_publish_filenames: Callable[[str], Iterable[str]],
    root: Path | None = None,
    geo_name_overrides_filename: str = "geo_name_overrides.manual.json",
) -> dict[str, object]:
    publish_plan = plan_publish_scenario_build_in_locked_session(
        scenario_dir,
        checkpoint_dir,
        publish_scope=publish_scope,
        manual_sync_policy=manual_sync_policy,
        scenario_id=scenario_id,
        scenario_data_scope=scenario_data_scope,
        all_scope=all_scope,
        manual_source_filenames=manual_source_filenames,
        validate_publish_bundle_dir=validate_publish_bundle_dir,
        ensure_publish_target_offline=ensure_publish_target_offline,
        validate_geo_locale_checkpoint=validate_geo_locale_checkpoint,
        require_startup_stage_checkpoints=require_startup_stage_checkpoints,
        detect_unsynced_manual_edits=detect_unsynced_manual_edits,
        resolve_publish_filenames=resolve_publish_filenames,
        geo_name_overrides_filename=geo_name_overrides_filename,
    )
    commit_publish_scenario_build_plan(
        publish_plan,
        publish_checkpoint_bundle=publish_checkpoint_bundle,
        load_checkpoint_json=load_checkpoint_json,
        write_json=write_json,
    )
    publish_plan["publishedPaths"] = [resolve_json_source_path(path) for path in publish_plan["publishedPaths"]]
    publish_plan["publishedFiles"] = [path.relative_to(scenario_dir).as_posix() for path in publish_plan["publishedPaths"]]
    record_published_target(
        build_dir=checkpoint_dir,
        target=publish_scope,
        published_paths=list(publish_plan["publishedPaths"]),
        root=root or scenario_dir.parent.parent.parent,
    )
    result: dict[str, object] = {
        "scenarioDir": str(publish_plan["scenarioDir"]),
        "checkpointDir": str(publish_plan["checkpointDir"]),
        "scenarioId": str(publish_plan["scenarioId"]),
        "publishScope": str(publish_plan["publishScope"]),
        "manualSyncPolicy": str(publish_plan["manualSyncPolicy"]),
        "publishedFiles": list(publish_plan["publishedFiles"]),
    }
    manual_sync_report = publish_plan.get("manualSyncReport")
    if manual_sync_report is not None:
        result["manualSyncReport"] = manual_sync_report
    return result


def publish_scenario_build(
    scenario_dir: Path,
    checkpoint_dir: Path,
    **kwargs,
) -> dict[str, object]:
    return publish_scenario_build_in_locked_session(
        scenario_dir,
        checkpoint_dir,
        **kwargs,
    )


def resolve_tno_checkpoint_dir(scenario_dir: Path = SCENARIO_DIR) -> Path:
    session = ensure_scenario_build_session(
        scenario_id=SCENARIO_ID,
        scenario_dir=scenario_dir,
        root=ROOT,
    )
    return Path(session["buildDir"])


def _load_active_server_metadata(path: Path = RUNTIME_ACTIVE_SERVER_METADATA_PATH) -> dict[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = load_json(path)
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _ensure_scenario_publish_target_offline(
    scenario_dir: Path,
    metadata_path: Path | None = None,
) -> None:
    metadata_path = metadata_path or RUNTIME_ACTIVE_SERVER_METADATA_PATH
    metadata = _load_active_server_metadata(metadata_path)
    if not metadata:
        return
    raw_pid = metadata.get("pid")
    try:
        pid = int(raw_pid)
    except (TypeError, ValueError):
        return
    if pid <= 0 or not _pid_is_alive(pid):
        return
    raw_cwd = str(metadata.get("cwd") or "").strip()
    if not raw_cwd:
        return
    server_root = Path(raw_cwd).resolve()
    target_dir = scenario_dir.resolve()
    if not target_dir.is_relative_to(server_root):
        return
    raise RuntimeError(
        "Scenario data publish is blocked because a live dev server is serving this workspace. "
        f"Stop the local dev server or close browser tabs using {metadata.get('url') or 'the active preview'}, "
        f"then retry publishing {target_dir}."
    )


def _bind_runtime_source_payload(payload: dict, runtime_url: str, runtime_sha256: str, *, filename: str) -> dict:
    payload = copy.deepcopy(payload)
    payload["source"] = {**payload.get("source", {}), "runtime_topology_sha256": runtime_sha256}
    if filename == "manifest.json":
        payload["runtime_topology_url"] = runtime_url
    elif filename == "audit.json":
        if "runtime_topology_path" in payload:
            payload["runtime_topology_path"] = runtime_url
    else:
        subset = payload.get("manifest_subset")
        if isinstance(subset, dict):
            subset["runtime_topology_url"] = runtime_url
            subset["source"] = {**subset.get("source", {}), "runtime_topology_sha256": runtime_sha256}
    return payload


def _sync_published_json_gzip(path: Path) -> None:
    sidecar = path.with_name(path.name + ".gz")
    if sidecar.exists() or path.name in {CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME, CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME}:
        write_bytes_atomic(sidecar, portable_gzip_bytes(path.read_bytes()))


def _refresh_rebound_runtime_snapshot(directory: Path, manifest: dict, runtime_sha256: str) -> None:
    snapshot_path = directory / "build_snapshot.json"
    if not snapshot_path.exists():
        return
    # Rebinding changes only source storage and startup metadata. Preserve the
    # frozen geometry/counts and refresh precisely these byte identities before
    # the publish validator reads the checkpoint snapshot.
    from map_builder.contracts import build_scenario_snapshot_payload

    previous = load_json(snapshot_path)
    input_sha = {**previous.get("input_sha", {}), CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME: runtime_sha256}
    output_sha = dict(previous.get("output_sha", {}))
    for filename in (CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME, CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME):
        for name in (filename, filename + ".gz"):
            path = directory / name
            if path.exists():
                output_sha[name] = json_source_sha256(path)
    snapshot = build_scenario_snapshot_payload(
        scenario_id=str(previous["scenario_id"]), profile_id=str(previous["profile"]),
        input_sha=input_sha, output_sha=output_sha,
        feature_count=int(previous.get("feature_count", 0)), water_count=int(previous.get("water_count", 0)),
        chunk_count=int(previous.get("chunk_count", 0)), generated_at=str(previous.get("generated_at", "")),
        environment=previous.get("environment"), durations=previous.get("durations"), report_paths=previous.get("report_paths"),
        contract_version=previous["contract_version"], builder_version=previous["builder_version"],
    )
    write_json(snapshot_path, snapshot)
    _sync_published_json_gzip(snapshot_path)
    manifest["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
    write_json(directory / "manifest.json", manifest)
    _sync_published_json_gzip(directory / "manifest.json")
    audit_path = directory / "audit.json"
    if audit_path.exists():
        audit = load_json(audit_path)
        audit["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
        audit["source"] = {**audit.get("source", {}), "build_snapshot_sha256": json_source_sha256(snapshot_path)}
        write_json(audit_path, audit)
        _sync_published_json_gzip(audit_path)


def validate_tno_publish_checkpoint_dir(checkpoint_dir: Path) -> list[str]:
    from tools import check_scenario_contracts as scenario_contracts

    validation_dir = checkpoint_dir
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    previous_contract_root = scenario_contracts.PROJECT_ROOT
    try:
        if checkpoint_dir.resolve() != SCENARIO_DIR.resolve():
            # The strict scenario validator selects TNO-specific checks from the
            # directory name. Validate external checkpoints through a temporary
            # data/scenarios/tno_1962 root so manifest URLs resolve to the
            # checkpoint files instead of the checked-in scenario directory.
            temp_dir = tempfile.TemporaryDirectory(prefix="tno-publish-validate-", dir=str(checkpoint_dir.parent))
            validation_root = Path(temp_dir.name)
            validation_dir = validation_root / "data" / "scenarios" / SCENARIO_ID
            shutil.copytree(checkpoint_dir, validation_dir, dirs_exist_ok=True)
            base_topology_source = ROOT / "data" / "europe_topology.json"
            base_topology_target = validation_root / "data" / "europe_topology.json"
            base_topology_target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(base_topology_source, base_topology_target)
            scenario_contracts.PROJECT_ROOT = validation_root
        errors = scenario_contracts.validate_publish_bundle_dir(validation_dir)
    finally:
        scenario_contracts.PROJECT_ROOT = previous_contract_root
        if temp_dir is not None:
            temp_dir.cleanup()

    return errors


def detect_unsynced_manual_edits(
    scenario_dir: Path,
    checkpoint_dir: Path,
    manual_sources: dict[str, Path],
    policy: str = MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
    report_dir: Path | None = None,
    backup_root: Path | None = None,
) -> dict[str, object]:
    return scenario_bundle_platform.detect_unsynced_manual_edits(
        scenario_dir,
        checkpoint_dir,
        manual_sources,
        scenario_id=SCENARIO_ID,
        policy=policy,
        load_json=load_json,
        write_json=write_json,
        utc_timestamp=utc_timestamp,
        normalize_core_tags=normalize_core_tags,
        normalize_locale_override_entry=normalize_locale_override_entry,
        report_dir=report_dir or MANUAL_SYNC_REPORT_DIR,
        backup_root=backup_root or MANUAL_SYNC_BACKUP_ROOT,
        backup_continue_policy=MANUAL_SYNC_POLICY_BACKUP_CONTINUE,
        strict_block_policy=MANUAL_SYNC_POLICY_STRICT_BLOCK,
    )


def publish_tno_checkpoint_bundle(
    scenario_dir: Path,
    checkpoint_dir: Path,
    publish_scope: str,
    *,
    load_checkpoint_json,
    write_json,
) -> None:
    """Keep checkpoints plain while publishing the canonical storage format."""
    filenames = resolve_scenario_publish_filenames(publish_scope)
    runtime_path = None
    if CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME in filenames:
        runtime_path = write_runtime_topology_source(
            scenario_dir, load_checkpoint_json(checkpoint_dir, CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME),
        )
    else:
        existing_runtime = resolve_json_source_path(scenario_dir / CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME)
        if existing_runtime.exists():
            runtime_path = existing_runtime
    runtime_url = f"data/scenarios/{SCENARIO_ID}/{runtime_path.name}" if runtime_path is not None else ""
    runtime_sha256 = json_source_sha256(runtime_path) if runtime_path is not None else ""
    binding_filenames = {"manifest.json", "audit.json", CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME, CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME}

    def write_published_json(path: Path, payload: dict) -> None:
        if runtime_path is not None:
            if path.name == CHECKPOINT_RUNTIME_TOPOLOGY_FILENAME:
                return
            if path.name in binding_filenames:
                payload = _bind_runtime_source_payload(payload, runtime_url, runtime_sha256, filename=path.name)
        write_json(path, payload)
        if runtime_path is not None and path.name in binding_filenames:
            _sync_published_json_gzip(path)

    scenario_bundle_platform.publish_checkpoint_bundle(
        scenario_dir, checkpoint_dir, publish_scope,
        load_checkpoint_json=load_checkpoint_json, write_json=write_published_json,
    )
    if runtime_path is not None:
        # Narrow polar-runtime publishes omit these files from their checkpoint
        # scope but must still bind the existing manifest to the new source.
        for filename in binding_filenames:
            path = scenario_dir / filename
            if filename not in filenames and path.exists():
                write_published_json(path, load_json(path))
        manifest_path = scenario_dir / "manifest.json"
        if manifest_path.exists():
            _refresh_rebound_runtime_snapshot(scenario_dir, load_json(manifest_path), runtime_sha256)


def build_tno_publish_service_kwargs(
    *,
    publish_scope: str,
    manual_sync_policy: str,
    validate_publish_checkpoint_dir=validate_tno_publish_checkpoint_dir,
) -> dict[str, object]:
    return {
        "publish_scope": publish_scope,
        "manual_sync_policy": manual_sync_policy,
        "scenario_id": SCENARIO_ID,
        "scenario_data_scope": PUBLISH_SCOPE_SCENARIO_DATA,
        "all_scope": PUBLISH_SCOPE_ALL,
        "manual_source_filenames": {
            "scenario_manual_overrides": MANUAL_OVERRIDE_FILENAME,
            "geo_name_overrides": "geo_name_overrides.manual.json",
            "district_groups": "district_groups.manual.json",
        },
        "validate_publish_bundle_dir": validate_publish_checkpoint_dir,
        "ensure_publish_target_offline": _ensure_scenario_publish_target_offline,
        "validate_geo_locale_checkpoint": validate_geo_locale_checkpoint,
        "require_startup_stage_checkpoints": scenario_bundle_platform.require_startup_stage_checkpoints,
        "detect_unsynced_manual_edits": detect_unsynced_manual_edits,
        "publish_checkpoint_bundle": publish_tno_checkpoint_bundle,
        "load_checkpoint_json": load_checkpoint_json,
        "write_json": write_json,
        "resolve_publish_filenames": resolve_scenario_publish_filenames,
        "root": ROOT,
    }
