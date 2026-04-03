from __future__ import annotations

import shutil
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


ROOT = Path(__file__).resolve().parents[1]
PUBLISH_TARGETS = {"geo-locale", "startup-assets", "chunk-assets", "all"}


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
    from tools import dev_server

    with dev_server._locked_scenario_context(scenario_id, root=root) as context:
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


def publish_scenario_outputs_in_locked_context(
    context: dict[str, object],
    *,
    target: str,
    root: Path = ROOT,
    checkpoint_dir: Path | None = None,
) -> dict[str, object]:
    from tools import dev_server

    normalized_target = _validate_target(target)
    scenario_id = str(context["scenarioId"])
    scenario_dir = Path(context["scenarioDir"])
    results: dict[str, object] = {
        "scenarioId": scenario_id,
        "target": normalized_target,
    }

    if scenario_id != "tno_1962":
        if normalized_target == "geo-locale":
            geo_locale_path = Path(context["geoLocalePatchPath"])
            if not geo_locale_path.exists():
                raise dev_server.DevServerError(
                    "missing_geo_locale_patch",
                    "The active scenario does not have a generated geo locale patch to publish.",
                    status=400,
                )
            results["geoLocale"] = {
                "publishMode": "already_published",
                "publishedPaths": [str(geo_locale_path)],
            }
            return results
        raise dev_server.DevServerError(
            "publish_target_not_supported",
            f'Scenario "{scenario_id}" does not support publish target "{normalized_target}" yet.',
            status=501,
        )

    from tools import patch_tno_1962_bundle as tno_bundle

    resolved_checkpoint_dir = checkpoint_dir or tno_bundle.DEFAULT_CHECKPOINT_DIR
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

        if normalized_target in {"startup-assets", "all"}:
            tno_bundle.scenario_bundle_platform.require_startup_stage_checkpoints(resolved_checkpoint_dir)
            published_startup_paths = _tno_copy_checkpoint_artifacts(
                scenario_dir=scenario_dir,
                checkpoint_dir=resolved_checkpoint_dir,
                filenames=[
                    tno_bundle.CHECKPOINT_STARTUP_BUNDLE_EN_FILENAME,
                    tno_bundle.CHECKPOINT_STARTUP_BUNDLE_ZH_FILENAME,
                ],
            )
            supporting_paths: list[str] = []
            startup_locales_path = root / "data" / "locales.startup.json"
            startup_geo_aliases_path = root / "data" / "geo_aliases.startup.json"
            if startup_locales_path.exists():
                supporting_paths.append(str(startup_locales_path))
            if startup_geo_aliases_path.exists():
                supporting_paths.append(str(startup_geo_aliases_path))
            results["startupAssets"] = {
                "publishMode": "copied_from_checkpoint",
                "publishedPaths": [str(path) for path in published_startup_paths],
                "supportingPaths": supporting_paths,
                "checkpointDir": str(resolved_checkpoint_dir),
            }

        if normalized_target in {"chunk-assets", "all"}:
            tno_bundle.build_chunk_assets_stage(scenario_dir, resolved_checkpoint_dir)
            results["chunkAssets"] = {
                "publishMode": "rebuilt_from_published_inputs",
                "publishedPaths": [
                    str(scenario_dir / "detail_chunks.manifest.json"),
                    str(scenario_dir / "chunks"),
                ],
                "checkpointDir": str(resolved_checkpoint_dir),
            }

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
