"""Hierarchy, geo alias, and locale stage owner for init_map_data.

The public functions in init_map_data.py stay as compatibility wrappers; this
module owns the hierarchy/locale transaction and its optional machine translation
pass.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable


ComputeStageSignature = Callable[..., str]
ShouldSkipStage = Callable[..., bool]
UpdateStageCache = Callable[..., None]
RecordStageTiming = Callable[..., None]
WriteJsonAtomic = Callable[..., None]


def run_hierarchy_locale_stage(
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    project_root: Path,
    init_map_data_path: Path,
    compute_stage_signature_func: ComputeStageSignature,
    should_skip_stage_func: ShouldSkipStage,
    update_stage_cache_func: UpdateStageCache,
    record_stage_timing_func: RecordStageTiming,
    write_json_atomic_func: WriteJsonAtomic,
) -> dict[str, object] | None:
    stage_name = "hierarchy_locales"
    stage_start = time.perf_counter()
    topology_path = output_dir / "europe_topology.na_v2.json"
    runtime_topology_path = output_dir / "europe_topology.runtime_political_v1.json"
    baseline_locales_path = project_root / "data" / "i18n" / "locales_baseline.json"
    translation_audit_path = project_root / ".runtime" / "reports" / "generated" / "translation_source_audit.json"
    translation_review_queue_path = project_root / ".runtime" / "reports" / "generated" / "translation_review_queue.json"
    outputs = [
        output_dir / "hierarchy.json",
        output_dir / "geo_aliases.json",
        output_dir / "locales.json",
        translation_audit_path,
        translation_review_queue_path,
    ]
    signature = compute_stage_signature_func(
        stage_name=stage_name,
        inputs=[
            init_map_data_path,
            Path(__file__).resolve(),
            project_root / "tools" / "generate_hierarchy.py",
            project_root / "tools" / "geo_key_normalizer.py",
            project_root / "tools" / "translate_manager.py",
            project_root / "js" / "core" / "i18n_catalog.js",
            project_root / "data" / "i18n" / "manual_geo_overrides.json",
            project_root / "data" / "i18n" / "europe_geo_seeds.json",
            baseline_locales_path,
            topology_path,
            runtime_topology_path,
        ],
        extra={"scenario_root": str(output_dir / "scenarios")},
    )
    if build_stage_cache is not None and should_skip_stage_func(
        cache_payload=build_stage_cache,
        stage_name=stage_name,
        signature=signature,
        outputs=outputs,
    ):
        print("[INFO] Hierarchy/locales stage skipped: cache hit.")
        if stage_timings is not None:
            record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=True, cache_hit=True)
        return None

    from tools import generate_hierarchy, translate_manager

    print("[INFO] Generating Hierarchy Data....")
    generate_hierarchy.main()

    print("[INFO] Normalizing GEO keys....")
    run_geo_alias_normalization(
        output_dir,
        project_root=project_root,
        write_json_atomic_func=write_json_atomic_func,
    )

    print("[INFO] Syncing Translations....")
    translation_result = translate_manager.sync_translations(
        topology_path=topology_path,
        output_path=output_dir / "locales.json",
        geo_aliases_path=output_dir / "geo_aliases.json",
        hierarchy_path=output_dir / "hierarchy.json",
        runtime_topology_path=runtime_topology_path,
        scenarios_root=output_dir / "scenarios",
        baseline_locales_path=baseline_locales_path,
        audit_report_path=translation_audit_path,
        review_queue_path=translation_review_queue_path,
        machine_translate=False,
        network_mode="off",
    )
    if build_stage_cache is not None:
        update_stage_cache_func(
            cache_payload=build_stage_cache,
            stage_name=stage_name,
            signature=signature,
            outputs=outputs,
        )
    if stage_timings is not None:
        record_stage_timing_func(stage_timings, stage_name, stage_start, skipped=False)
    return translation_result


def run_geo_alias_normalization(
    output_dir: Path,
    *,
    project_root: Path,
    write_json_atomic_func: WriteJsonAtomic,
) -> None:
    from tools import geo_key_normalizer

    topology_path = geo_key_normalizer.resolve_default_topology(project_root)
    payload = geo_key_normalizer.normalize_geokeys(topology_path)
    output_path = output_dir / "geo_aliases.json"
    write_json_atomic_func(output_path, payload, ensure_ascii=False, indent=2)
    print(
        f"OK: geo aliases generated. entries={payload['entry_count']}, "
        f"aliases={payload['alias_count']}, conflicts={payload['conflict_count']}"
    )
    print(f"Saved geo aliases to: {output_path}")


def run_optional_machine_translation(
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    project_root: Path,
    record_stage_timing_func: RecordStageTiming,
) -> None:
    build_mt_mode = str(os.environ.get("MAPCREATOR_BUILD_MT", "off")).strip().lower()
    if build_mt_mode not in {"auto", "on"}:
        return
    print(f"[INFO] Running optional machine translation pass (mode={build_mt_mode})....")
    machine_translation_start = time.perf_counter()
    baseline_locales_path = project_root / "data" / "i18n" / "locales_baseline.json"
    translation_audit_path = (
        project_root / ".runtime" / "reports" / "generated" / "translation_source_audit.machine_translation.json"
    )
    translation_review_queue_path = (
        project_root / ".runtime" / "reports" / "generated" / "translation_review_queue.machine_translation.json"
    )

    from tools import translate_manager

    translation_result = translate_manager.sync_translations(
        topology_path=output_dir / "europe_topology.na_v2.json",
        output_path=output_dir / "locales.json",
        geo_aliases_path=output_dir / "geo_aliases.json",
        hierarchy_path=output_dir / "hierarchy.json",
        runtime_topology_path=output_dir / "europe_topology.runtime_political_v1.json",
        scenarios_root=output_dir / "scenarios",
        baseline_locales_path=baseline_locales_path,
        audit_report_path=translation_audit_path,
        review_queue_path=translation_review_queue_path,
        machine_translate=True,
        translator_delay_seconds=0.05,
        max_machine_translations=2500,
        auto_country_codes="visible-missing",
        network_mode=build_mt_mode,
    )
    print(
        "[INFO] Optional translation result: "
        f"geo_missing_like={translation_result['geo_missing_like']}, "
        f"todo_markers={translation_result['geo_literal_todo_markers']}, "
        f"mt_requests={translation_result['mt_requests']}"
    )
    if stage_timings is not None:
        record_stage_timing_func(
            stage_timings,
            "machine_translation",
            machine_translation_start,
            mode=build_mt_mode,
            mt_requests=translation_result.get("mt_requests"),
        )
