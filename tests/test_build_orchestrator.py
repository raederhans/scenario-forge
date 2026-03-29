from __future__ import annotations

import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import init_map_data
from map_builder import build_orchestrator


class _FakeStageOps:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.cache = {"cache": True}
        self.timings_writes: list[tuple[Path | None, dict[str, dict]]] = []
        self.cache_writes: list[tuple[Path, dict[str, dict]]] = []
        self.validation_calls: list[tuple[Path, bool, bool]] = []

    def _load_build_stage_cache(self, output_dir: Path) -> dict[str, dict]:
        self.calls.append(("load_build_stage_cache", output_dir))
        return self.cache

    def _write_build_stage_cache(self, output_dir: Path, cache_payload: dict[str, dict]) -> None:
        self.calls.append(("write_build_stage_cache", output_dir))
        self.cache_writes.append((output_dir, cache_payload))

    def _write_timings_json(self, path: Path | None, timings: dict[str, dict]) -> None:
        self.calls.append(("write_timings_json", path))
        self.timings_writes.append((path, dict(timings)))

    def _record_stage_timing(
        self,
        timings: dict[str, dict],
        stage_name: str,
        _start_time: float,
        **extra: object,
    ) -> None:
        timings[stage_name] = dict(extra)
        self.calls.append(("record_stage_timing", stage_name))

    def build_primary_topology_bundle(
        self,
        script_dir: Path,
        output_dir: Path,
        *,
        stage_timings: dict[str, dict],
        build_stage_cache: dict[str, dict],
        timings_root: Path | None,
    ) -> dict[str, object]:
        self.calls.append(
            (
                "build_primary_topology_bundle",
                script_dir,
                output_dir,
                build_stage_cache is self.cache,
                timings_root,
            )
        )
        return {
            "world_cities": [{"name": "Paris"}],
            "missing_cntr_code_count": 7,
        }

    def build_ru_city_detail_topology(self, *args, **kwargs) -> None:
        self.calls.append(("build_ru_city_detail_topology", args[0], args[1]))

    def build_na_detail_topology(self, *args, **kwargs) -> None:
        self.calls.append(("build_na_detail_topology", args[0], args[1]))

    def build_runtime_political_topology(self, *args, **kwargs) -> None:
        self.calls.append(("build_runtime_political_topology", args[0], args[1]))

    def run_hierarchy_locale_stage(self, output_dir: Path, *, stage_timings, build_stage_cache):
        self.calls.append(("run_hierarchy_locale_stage", output_dir, build_stage_cache is self.cache))
        return {
            "geo_missing_like": 1,
            "geo_literal_todo_markers": 2,
            "mt_requests": 3,
        }

    def run_palette_imports(self, output_dir: Path, *, strict: bool) -> None:
        self.calls.append(("run_palette_imports", output_dir, strict))

    def run_optional_machine_translation(self, output_dir: Path, *, stage_timings: dict[str, dict]) -> None:
        self.calls.append(("run_optional_machine_translation", output_dir))
        stage_timings["machine_translation"] = {"mode": "auto"}

    def rebuild_derived_hoi4_assets(self, output_dir: Path, *, strict: bool) -> None:
        self.calls.append(("rebuild_derived_hoi4_assets", output_dir, strict))

    def emit_default_scenario_city_assets(self, output_dir: Path, world_cities) -> None:
        self.calls.append(("emit_default_scenario_city_assets", output_dir, list(world_cities)))

    def write_data_manifest(self, output_dir: Path) -> None:
        self.calls.append(("write_data_manifest", output_dir))

    def validate_build_outputs(
        self,
        output_dir: Path,
        *,
        strict: bool,
        include_dependent_asset_checks: bool = False,
    ) -> None:
        self.calls.append(("validate_build_outputs", output_dir, strict, include_dependent_asset_checks))
        self.validation_calls.append((output_dir, strict, include_dependent_asset_checks))


class BuildOrchestratorTest(unittest.TestCase):
    def _args(self, mode: str, timings_json: Path | None) -> Namespace:
        return Namespace(mode=mode, strict=True, timings_json=timings_json)

    def test_run_detail_mode_keeps_existing_order_and_finalize(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            ops = _FakeStageOps()

            build_orchestrator.run(
                self._args("detail", root / "timings.json"),
                root / "scripts",
                root / "data",
                stage_ops=ops,
            )

            ordered_names = [call[0] for call in ops.calls]
            self.assertEqual(
                ordered_names,
                [
                    "load_build_stage_cache",
                    "build_ru_city_detail_topology",
                    "build_na_detail_topology",
                    "build_runtime_political_topology",
                    "write_data_manifest",
                    "record_stage_timing",
                    "validate_build_outputs",
                    "record_stage_timing",
                    "record_stage_timing",
                    "write_build_stage_cache",
                    "write_timings_json",
                ],
            )
            self.assertEqual(ops.validation_calls, [(root / "data", True, False)])
            self.assertEqual(ops.cache_writes, [(root / "data", ops.cache)])
            self.assertEqual(ops.timings_writes[0][0], root / "timings.json")
            self.assertIn("total", ops.timings_writes[0][1])

    def test_run_i18n_mode_only_runs_locale_stage_then_finalize(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            ops = _FakeStageOps()

            build_orchestrator.run(
                self._args("i18n", None),
                root / "scripts",
                root / "data",
                stage_ops=ops,
            )

            ordered_names = [call[0] for call in ops.calls]
            self.assertEqual(
                ordered_names,
                [
                    "load_build_stage_cache",
                    "run_hierarchy_locale_stage",
                    "write_data_manifest",
                    "record_stage_timing",
                    "validate_build_outputs",
                    "record_stage_timing",
                    "record_stage_timing",
                    "write_build_stage_cache",
                    "write_timings_json",
                ],
            )
            self.assertEqual(ops.validation_calls, [(root / "data", True, False)])

    def test_run_palettes_mode_reuses_same_finalize_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            ops = _FakeStageOps()

            build_orchestrator.run(
                self._args("palettes", root / "timings.json"),
                root / "scripts",
                root / "data",
                stage_ops=ops,
            )

            ordered_names = [call[0] for call in ops.calls]
            self.assertEqual(
                ordered_names,
                [
                    "load_build_stage_cache",
                    "run_palette_imports",
                    "record_stage_timing",
                    "write_data_manifest",
                    "record_stage_timing",
                    "validate_build_outputs",
                    "record_stage_timing",
                    "record_stage_timing",
                    "write_build_stage_cache",
                    "write_timings_json",
                ],
            )
            self.assertEqual(ops.validation_calls, [(root / "data", True, False)])

    def test_run_all_mode_preserves_stage_order_and_dependent_validation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            ops = _FakeStageOps()

            build_orchestrator.run(
                self._args("all", root / "timings.json"),
                root / "scripts",
                root / "data",
                stage_ops=ops,
            )

            ordered_names = [call[0] for call in ops.calls]
            self.assertEqual(
                ordered_names,
                [
                    "load_build_stage_cache",
                    "build_primary_topology_bundle",
                    "build_ru_city_detail_topology",
                    "build_na_detail_topology",
                    "build_runtime_political_topology",
                    "run_hierarchy_locale_stage",
                    "run_optional_machine_translation",
                    "rebuild_derived_hoi4_assets",
                    "record_stage_timing",
                    "emit_default_scenario_city_assets",
                    "record_stage_timing",
                    "write_data_manifest",
                    "record_stage_timing",
                    "validate_build_outputs",
                    "record_stage_timing",
                    "record_stage_timing",
                    "write_build_stage_cache",
                    "write_timings_json",
                ],
            )
            self.assertEqual(ops.validation_calls, [(root / "data", True, True)])
            emit_call = next(call for call in ops.calls if call[0] == "emit_default_scenario_city_assets")
            self.assertEqual(emit_call[2], [{"name": "Paris"}])

    def test_run_propagates_stage_error_without_finalize_side_effects(self) -> None:
        class ExplodingOps(_FakeStageOps):
            def build_na_detail_topology(self, *args, **kwargs) -> None:
                raise RuntimeError("detail failed")

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            ops = ExplodingOps()

            with self.assertRaisesRegex(RuntimeError, "detail failed"):
                build_orchestrator.run(
                    self._args("detail", root / "timings.json"),
                    root / "scripts",
                    root / "data",
                    stage_ops=ops,
                )

            ordered_names = [call[0] for call in ops.calls]
            self.assertNotIn("write_build_stage_cache", ordered_names)
            self.assertNotIn("write_timings_json", ordered_names)

    def test_init_main_delegates_to_build_orchestrator_run(self) -> None:
        fake_args = Namespace(mode="detail", strict=False, timings_json=None)

        with patch.object(init_map_data, "parse_args", return_value=fake_args), patch.object(
            init_map_data.build_orchestrator,
            "run",
        ) as run_mock:
            init_map_data.main()

        run_mock.assert_called_once()
        call_args = run_mock.call_args
        self.assertIs(call_args.args[0], fake_args)
        self.assertEqual(call_args.args[1], Path(init_map_data.__file__).resolve().parent)
        self.assertEqual(call_args.args[2], Path(init_map_data.__file__).resolve().parent / "data")
        self.assertIs(call_args.kwargs["stage_ops"], init_map_data)


if __name__ == "__main__":
    unittest.main()
