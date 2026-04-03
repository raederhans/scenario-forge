from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable, Mapping

from map_builder import scenario_bundle_platform
from map_builder.scenario_build_session import record_published_target


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

    publish_checkpoint_bundle(
        scenario_dir,
        checkpoint_dir,
        publish_scope,
        load_checkpoint_json=load_checkpoint_json,
        write_json=write_json,
    )
    result: dict[str, object] = {
        "scenarioDir": str(scenario_dir),
        "checkpointDir": str(checkpoint_dir),
        "scenarioId": scenario_id,
        "publishScope": publish_scope,
        "manualSyncPolicy": manual_sync_policy,
        "publishedFiles": list(resolve_publish_filenames(publish_scope)),
    }
    record_published_target(
        build_dir=checkpoint_dir,
        target=publish_scope,
        published_paths=[scenario_dir / filename for filename in resolve_publish_filenames(publish_scope)],
        root=root or scenario_dir.parent.parent.parent,
    )
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
