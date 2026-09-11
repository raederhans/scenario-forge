"""Detail-topology stage owners for init_map_data.

The public entry points keep the existing init_map_data behavior, while this
module owns the stage sequencing around detail topology subprocesses.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from map_builder import config as cfg


ComputeStageSignature = Callable[..., str]
ShouldSkipStage = Callable[..., bool]
UpdateStageCache = Callable[..., None]
RecordStageTiming = Callable[..., None]
ReadOptionalJson = Callable[[Path | None], dict | None]


def run_ru_city_detail_topology(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
    project_root: Path,
    init_map_data_path: Path,
    fetch_or_load_geojson_func: Callable[..., object],
    compute_stage_signature_func: ComputeStageSignature,
    should_skip_stage_func: ShouldSkipStage,
    update_stage_cache_func: UpdateStageCache,
    record_stage_timing_func: RecordStageTiming,
    read_optional_json_func: ReadOptionalJson,
) -> None:
    stage_name = "ru_city_detail_topology"
    stage_start = time.perf_counter()
    source_topology = output_dir / "europe_topology.json.bak"
    if not source_topology.exists():
        print(
            "[RU City Detail] Skipped: source detail topology not found at "
            f"{source_topology}."
        )
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, reason="missing-source")
        return

    patch_script = script_dir / "tools" / "patch_ru_city_detail.py"
    if not patch_script.exists():
        print(f"[RU City Detail] Skipped: patch script missing at {patch_script}.")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, reason="missing-script")
        return

    ru_adm2_path = output_dir / cfg.RUS_ADM2_FILENAME
    if not ru_adm2_path.exists():
        print("[RU City Detail] Downloading Russia ADM2 (geoBoundaries)...")
        fetch_or_load_geojson_func(
            cfg.RUS_ADM2_URL,
            cfg.RUS_ADM2_FILENAME,
            fallback_urls=cfg.RUS_ADM2_FALLBACK_URLS,
        )

    output_path = output_dir / "europe_topology.highres.json"
    signature = compute_stage_signature_func(
        stage_name=stage_name,
        inputs=[
            init_map_data_path,
            patch_script,
            source_topology,
            ru_adm2_path,
            project_root / "map_builder" / "config.py",
            project_root / "map_builder" / "geo" / "topology.py",
        ],
        extra={"output": str(output_path)},
    )
    if build_stage_cache is not None and should_skip_stage_func(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=[output_path],
    ):
        print("[RU City Detail] Skipped: cache hit.")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return

    child_timings_path = timings_root / f"{stage_name}.json" if timings_root is not None else None
    cmd = [
        sys.executable,
        str(patch_script),
        "--source-topology",
        str(source_topology),
        "--output-topology",
        str(output_path),
        "--ru-adm2",
        str(ru_adm2_path),
    ]
    if child_timings_path is not None:
        child_timings_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--timings-json", str(child_timings_path)])
    print("[RU City Detail] Building patched detail topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[RU City Detail] Failed to patch detail topology: {exc}")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, failed=True)
        return
    if build_stage_cache is not None:
        update_stage_cache_func(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=[output_path],
        )
    if stage_timings is not None:
        record_stage_timing_func(
            stage_timings,
            stage_name,
            stage_start,
            skipped=False,
            child_timings=read_optional_json_func(child_timings_path),
        )


def run_na_detail_topology(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
    project_root: Path,
    init_map_data_path: Path,
    compute_stage_signature_func: ComputeStageSignature,
    should_skip_stage_func: ShouldSkipStage,
    update_stage_cache_func: UpdateStageCache,
    record_stage_timing_func: RecordStageTiming,
    read_optional_json_func: ReadOptionalJson,
    candidate_topology_path_func: Callable[[Path], Path],
    promote_candidate_topology_if_safe_func: Callable[..., None],
) -> None:
    stage_name = "detail_topology"
    stage_start = time.perf_counter()
    primary_topology = output_dir / "europe_topology.json"
    source_topology = output_dir / "europe_topology.highres.json"
    if not source_topology.exists():
        source_topology = output_dir / "europe_topology.json.bak"
    if not source_topology.exists():
        print("[Detail Bundle] Skipped: no source detail topology found.")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, reason="missing-source")
        return

    patch_script = script_dir / "tools" / "build_na_detail_topology.py"
    if not patch_script.exists():
        print(f"[Detail Bundle] Skipped: patch script missing at {patch_script}.")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, reason="missing-script")
        return

    output_path = output_dir / "europe_topology.na_v2.json"
    candidate_path = candidate_topology_path_func(output_path)
    signature = compute_stage_signature_func(
        stage_name=stage_name,
        inputs=[
            init_map_data_path,
            patch_script,
            source_topology,
            primary_topology,
            project_root / "map_builder" / "config.py",
            project_root / "map_builder" / "geo" / "topology.py",
            project_root / "map_builder" / "geo" / "spherical_safety.py",
            project_root / "map_builder" / "geo" / "water_geometry.py",
            project_root / "map_builder" / "geo" / "water_region_authority.py",
            project_root / "map_builder" / "geo" / "physical_water_mask.py",
            project_root / "map_builder" / "geo" / "water_validation.py",
            project_root / "tools" / "check_water_geometry.mjs",
            project_root / "map_builder" / "geo" / "local_canonicalization.py",
            project_root / "map_builder" / "processors" / "detail_shell_coverage.py",
            project_root / "map_builder" / "processors" / "russia_ukraine.py",
        ],
        extra={"output": str(output_path)},
    )
    if build_stage_cache is not None and should_skip_stage_func(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=[output_path],
    ):
        print("[Detail Bundle] Skipped: cache hit.")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return

    child_timings_path = timings_root / f"{stage_name}.json" if timings_root is not None else None
    cmd = [
        sys.executable,
        str(patch_script),
        "--source-topology",
        str(source_topology),
        "--output-topology",
        str(candidate_path),
    ]
    if child_timings_path is not None:
        child_timings_path.parent.mkdir(parents=True, exist_ok=True)
        cmd.extend(["--timings-json", str(child_timings_path)])
    print("[Detail Bundle] Building enriched detail topology...")
    try:
        subprocess.check_call(cmd, cwd=script_dir)
    except subprocess.CalledProcessError as exc:
        print(f"[Detail Bundle] Failed to build enriched detail topology: {exc}")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, failed=True)
        return
    try:
        if primary_topology.exists():
            promote_candidate_topology_if_safe_func(
                stage_label="Detail Bundle",
                primary_topology_path=primary_topology,
                candidate_path=candidate_path,
                output_path=output_path,
            )
        elif candidate_path.exists():
            shutil.copy2(candidate_path, output_path)
            print("[Detail Bundle] Promoted candidate without baseline comparison.")
    except BaseException:
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, failed=True, gate_failed=True)
        raise
    if build_stage_cache is not None:
        update_stage_cache_func(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=[output_path],
        )
    if stage_timings is not None:
        record_stage_timing_func(
            stage_timings,
            stage_name,
            stage_start,
            skipped=False,
            child_timings=read_optional_json_func(child_timings_path),
        )
