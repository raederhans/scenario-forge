from __future__ import annotations

import shutil
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from map_builder.scenario_build_session import (
    ensure_scenario_build_session,
    record_published_target,
)
from map_builder.scenario_context import (
    ScenarioContextError,
    load_locked_scenario_context,
)
from map_builder.scenario_geo_locale_materializer import (
    NON_TNO_GEO_LOCALE_CHECKPOINT_FILENAME,
)

ROOT = Path(__file__).resolve().parents[1]
PUBLISH_TARGETS = {"geo-locale", "startup-support-assets", "startup-bundle-assets", "startup-assets", "chunk-assets", "all"}


def _validate_target(target: str) -> str:
    normalized_target = str(target or "").strip().lower()
    if normalized_target not in PUBLISH_TARGETS:
        raise ValueError(f"Unsupported publish target: {target}")
    return normalized_target


@contextmanager
def load_locked_publish_context(
    scenario_id: str,
    *,
    root: Path = ROOT,
) -> Iterator[dict[str, object]]:
    with load_locked_scenario_context(
        scenario_id,
        root=root,
        holder="scenario_publish_service",
    ) as context:
        yield context


def _copy_artifact(source_path: Path, target_path: Path) -> None:
    if not source_path.exists():
        raise FileNotFoundError(f"Missing publish source artifact: {source_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_path, target_path)


def _tno_copy_checkpoint_artifacts(
    *,
    scenario_dir: Path,
    checkpoint_dir: Path,
    filenames: list[str],
) -> list[Path]:
    published_paths: list[Path] = []
    for filename in filenames:
        source_path = checkpoint_dir / filename
        target_path = scenario_dir / filename
        _copy_artifact(source_path, target_path)
        published_paths.append(target_path)
    return published_paths


def _require_existing_publish_paths(paths: list[Path], *, label: str) -> None:
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        sample = ", ".join(missing[:8])
        if len(missing) > 8:
            sample += ", ..."
        raise FileNotFoundError(f"Missing {label} artifacts: {sample}")


def publish_scenario_outputs_in_locked_context(
    context: dict[str, object],
    *,
    target: str,
    root: Path = ROOT,
    checkpoint_dir: Path | None = None,
) -> dict[str, object]:
    normalized_target = _validate_target(target)
    scenario_id = str(context["scenarioId"])
    scenario_dir = Path(context["scenarioDir"])
    results: dict[str, object] = {
        "scenarioId": scenario_id,
        "target": normalized_target,
    }

    if scenario_id != "tno_1962":
        if normalized_target == "geo-locale":
            build_session = ensure_scenario_build_session(
                scenario_id=scenario_id,
                scenario_dir=scenario_dir,
                root=root,
                build_dir=checkpoint_dir,
            )
            resolved_checkpoint_dir = Path(build_session["buildDir"])
            source_geo_locale_path = resolved_checkpoint_dir / NON_TNO_GEO_LOCALE_CHECKPOINT_FILENAME
            geo_locale_path = Path(context["geoLocalePatchPath"])
            if not source_geo_locale_path.exists():
                raise ScenarioContextError(
                    "missing_geo_locale_patch",
                    "The active scenario does not have a generated geo locale patch to publish.",
                    status=400,
                )
            _copy_artifact(source_geo_locale_path, geo_locale_path)
            record_published_target(
                build_dir=resolved_checkpoint_dir,
                target="geo-locale",
                published_paths=[geo_locale_path],
                root=root,
            )
            results["geoLocale"] = {
                "publishMode": "copied_from_checkpoint",
                "publishedPaths": [str(geo_locale_path)],
                "checkpointDir": str(resolved_checkpoint_dir),
            }
            return results
        raise ScenarioContextError(
            "publish_target_not_supported",
            f'Scenario "{scenario_id}" does not support publish target "{normalized_target}" yet.',
            status=501,
        )

    from tools import patch_tno_1962_bundle as tno_bundle

    resolved_checkpoint_dir = checkpoint_dir or tno_bundle.resolve_default_checkpoint_dir(scenario_dir)
    with tno_bundle._checkpoint_build_lock(
        resolved_checkpoint_dir,
        stage=f"publish_{normalized_target.replace('-', '_')}",
    ):
        if normalized_target in {"geo-locale", "all"}:
            published_geo_paths = _tno_copy_checkpoint_artifacts(
                scenario_dir=scenario_dir,
                checkpoint_dir=resolved_checkpoint_dir,
                filenames=[
                    tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME,
                    tno_bundle.CHECKPOINT_GEO_LOCALE_FILENAME,
                    tno_bundle.CHECKPOINT_GEO_LOCALE_EN_FILENAME,
                    tno_bundle.CHECKPOINT_GEO_LOCALE_ZH_FILENAME,
                ],
            )
            results["geoLocale"] = {
                "publishMode": "copied_from_checkpoint",
                "publishedPaths": [str(path) for path in published_geo_paths],
                "checkpointDir": str(resolved_checkpoint_dir),
            }
            record_published_target(
                build_dir=resolved_checkpoint_dir,
                target="geo-locale",
                published_paths=published_geo_paths,
                root=root,
            )

        if normalized_target in {"startup-support-assets", "startup-assets", "all"}:
            tno_bundle.scenario_bundle_platform.require_startup_support_stage_checkpoints(resolved_checkpoint_dir)
            published_support_paths = _tno_copy_checkpoint_artifacts(
                scenario_dir=scenario_dir,
                checkpoint_dir=resolved_checkpoint_dir,
                filenames=[
                    tno_bundle.CHECKPOINT_RUNTIME_BOOTSTRAP_TOPOLOGY_FILENAME,
                    tno_bundle.CHECKPOINT_STARTUP_LOCALES_FILENAME,
                    tno_bundle.CHECKPOINT_STARTUP_GEO_ALIASES_FILENAME,
                ],
            )
            results["startupSupportAssets"] = {
                "publishMode": "copied_from_checkpoint",
                "publishedPaths": [str(path) for path in published_support_paths],
                "checkpointDir": str(resolved_checkpoint_dir),
            }
            record_published_target(
                build_dir=resolved_checkpoint_dir,
                target="startup-support-assets",
                published_paths=published_support_paths,
                root=root,
            )

        if normalized_target in {"startup-bundle-assets", "startup-assets", "all"}:
            tno_bundle.scenario_bundle_platform.require_startup_bundle_stage_checkpoints(resolved_checkpoint_dir)
            published_startup_paths = _tno_copy_checkpoint_artifacts(
                scenario_dir=scenario_dir,
                checkpoint_dir=resolved_checkpoint_dir,
                filenames=[
                    tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
                    tno_bundle.CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
                ],
            )
            results["startupBundleAssets"] = {
                "publishMode": "copied_from_checkpoint",
                "publishedPaths": [str(path) for path in published_startup_paths],
                "checkpointDir": str(resolved_checkpoint_dir),
            }
            record_published_target(
                build_dir=resolved_checkpoint_dir,
                target="startup-bundle-assets",
                published_paths=published_startup_paths,
                root=root,
            )

        if normalized_target in {"startup-assets", "all"}:
            results["startupAssets"] = {
                "publishMode": "copied_from_checkpoint",
                "publishedPaths": [
                    *results.get("startupSupportAssets", {}).get("publishedPaths", []),
                    *results.get("startupBundleAssets", {}).get("publishedPaths", []),
                ],
                "supportingPaths": [],
                "checkpointDir": str(resolved_checkpoint_dir),
            }

        if normalized_target in {"chunk-assets", "all"}:
            tno_bundle.scenario_bundle_platform.require_chunk_stage_checkpoints(resolved_checkpoint_dir)
            tno_bundle.scenario_bundle_platform.require_chunk_stage_publish_inputs(scenario_dir)
            published_chunk_paths = [
                scenario_dir / "detail_chunks.manifest.json",
                scenario_dir / "chunks",
            ]
            _require_existing_publish_paths(published_chunk_paths, label="chunk-assets publish")
            results["chunkAssets"] = {
                "publishMode": "checkpoint_stage_outputs",
                "publishedPaths": [
                    str(path) for path in published_chunk_paths
                ],
                "checkpointDir": str(resolved_checkpoint_dir),
            }
            record_published_target(
                build_dir=resolved_checkpoint_dir,
                target="chunk-assets",
                published_paths=published_chunk_paths,
                root=root,
            )

    return results


def publish_scenario_outputs(
    scenario_id: str,
    *,
    target: str,
    root: Path = ROOT,
    checkpoint_dir: Path | None = None,
) -> dict[str, object]:
    with load_locked_publish_context(scenario_id, root=root) as context:
        return publish_scenario_outputs_in_locked_context(
            context,
            target=target,
            root=root,
            checkpoint_dir=checkpoint_dir,
        )
