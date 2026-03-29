from __future__ import annotations

import time
from pathlib import Path

from map_builder.contracts import INIT_MAP_DATA_STAGE_DESCRIPTORS


CONTRACT_STAGE_NAMES = frozenset(stage.name for stage in INIT_MAP_DATA_STAGE_DESCRIPTORS)
REQUIRED_CONTRACT_STAGE_NAMES = frozenset(
    {
        "primary_topology_bundle",
        "detail_topology",
        "runtime_political_topology",
        "hierarchy_locales",
        "palette_assets",
        "world_cities",
        "city_lights_assets",
        "derived_hoi4_assets",
        "manifest",
        "validation",
    }
)


def _assert_contract_stage_alignment() -> None:
    missing = sorted(REQUIRED_CONTRACT_STAGE_NAMES - CONTRACT_STAGE_NAMES)
    if missing:
        raise ValueError(
            "INIT_MAP_DATA_STAGE_DESCRIPTORS is missing required orchestrator stages: "
            + ", ".join(missing)
        )


def _log_translation_result(translation_result: dict[str, object] | None) -> None:
    if not translation_result:
        return
    print(
        "[INFO] Translation sync result: "
        f"geo_missing_like={translation_result['geo_missing_like']}, "
        f"todo_markers={translation_result['geo_literal_todo_markers']}, "
        f"mt_requests={translation_result['mt_requests']}"
    )


def _run_manifest_and_validation(
    *,
    ops,
    output_dir: Path,
    stage_timings: dict[str, dict],
    strict: bool,
    include_dependent_asset_checks: bool = False,
) -> None:
    manifest_start = time.perf_counter()
    ops.write_data_manifest(output_dir)
    ops._record_stage_timing(stage_timings, "manifest", manifest_start)
    validation_start = time.perf_counter()
    if include_dependent_asset_checks:
        ops.validate_build_outputs(
            output_dir,
            strict=strict,
            include_dependent_asset_checks=True,
        )
    else:
        ops.validate_build_outputs(output_dir, strict=strict)
    ops._record_stage_timing(stage_timings, "validation", validation_start)


def run(args, script_dir: Path, output_dir: Path, *, stage_ops) -> None:
    _assert_contract_stage_alignment()
    build_stage_cache = stage_ops._load_build_stage_cache(output_dir)
    stage_timings: dict[str, dict] = {}
    timings_root = (
        args.timings_json.parent / f"{args.timings_json.stem}.stages"
        if args.timings_json is not None
        else None
    )
    main_start = time.perf_counter()

    def finalize_build() -> None:
        stage_ops._record_stage_timing(stage_timings, "total", main_start, mode=args.mode)
        stage_ops._write_build_stage_cache(output_dir, build_stage_cache)
        stage_ops._write_timings_json(args.timings_json, stage_timings)

    if args.mode == "detail":
        stage_ops.build_ru_city_detail_topology(
            script_dir,
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
            timings_root=timings_root,
        )
        stage_ops.build_na_detail_topology(
            script_dir,
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
            timings_root=timings_root,
        )
        stage_ops.build_runtime_political_topology(
            script_dir,
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
            timings_root=timings_root,
        )
        _run_manifest_and_validation(
            ops=stage_ops,
            output_dir=output_dir,
            stage_timings=stage_timings,
            strict=args.strict,
        )
        print("Done.")
        finalize_build()
        return

    if args.mode == "i18n":
        translation_result = stage_ops.run_hierarchy_locale_stage(
            output_dir,
            stage_timings=stage_timings,
            build_stage_cache=build_stage_cache,
        )
        _log_translation_result(translation_result)
        _run_manifest_and_validation(
            ops=stage_ops,
            output_dir=output_dir,
            stage_timings=stage_timings,
            strict=args.strict,
        )
        print("Done.")
        finalize_build()
        return

    if args.mode == "palettes":
        print("[INFO] Rebuilding palette assets....")
        palette_start = time.perf_counter()
        stage_ops.run_palette_imports(output_dir, strict=args.strict)
        stage_ops._record_stage_timing(stage_timings, "palette_assets", palette_start)
        _run_manifest_and_validation(
            ops=stage_ops,
            output_dir=output_dir,
            stage_timings=stage_timings,
            strict=args.strict,
        )
        print("Done.")
        finalize_build()
        return

    primary_context = stage_ops.build_primary_topology_bundle(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )
    if args.mode == "primary":
        _run_manifest_and_validation(
            ops=stage_ops,
            output_dir=output_dir,
            stage_timings=stage_timings,
            strict=args.strict,
            include_dependent_asset_checks=True,
        )
        print(f"Features with missing CNTR_CODE: {primary_context['missing_cntr_code_count']}")
        print("Done.")
        finalize_build()
        return

    stage_ops.build_ru_city_detail_topology(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )
    stage_ops.build_na_detail_topology(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )
    stage_ops.build_runtime_political_topology(
        script_dir,
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
        timings_root=timings_root,
    )

    translation_result = stage_ops.run_hierarchy_locale_stage(
        output_dir,
        stage_timings=stage_timings,
        build_stage_cache=build_stage_cache,
    )
    _log_translation_result(translation_result)

    stage_ops.run_optional_machine_translation(
        output_dir,
        stage_timings=stage_timings,
    )

    derived_assets_start = time.perf_counter()
    stage_ops.rebuild_derived_hoi4_assets(output_dir, strict=args.strict)
    stage_ops._record_stage_timing(stage_timings, "derived_hoi4_assets", derived_assets_start)

    scenario_city_assets_start = time.perf_counter()
    stage_ops.emit_default_scenario_city_assets(output_dir, primary_context["world_cities"])
    stage_ops._record_stage_timing(stage_timings, "scenario_city_assets", scenario_city_assets_start)

    _run_manifest_and_validation(
        ops=stage_ops,
        output_dir=output_dir,
        stage_timings=stage_timings,
        strict=args.strict,
        include_dependent_asset_checks=True,
    )
    print(f"Features with missing CNTR_CODE: {primary_context['missing_cntr_code_count']}")
    print("Done.")
    finalize_build()
