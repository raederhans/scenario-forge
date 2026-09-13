from __future__ import annotations

import json
import importlib
import os
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import init_map_data
from map_builder import base_stage
from map_builder import build_orchestrator
from map_builder import contracts
from map_builder import country_feature_policies
from map_builder import validation_schema
from map_builder import config as cfg
from map_builder.processors import config_subdivisions
from tools import build_na_detail_topology


class ConfigTopologyQuantizationEnvTests(unittest.TestCase):
    def tearDown(self) -> None:
        importlib.reload(cfg)

    def test_topology_quantization_env_overrides_feed_candidate_profiles(self) -> None:
        with patch.dict(
            os.environ,
            {
                "RUNTIME_POLITICAL_TOPOLOGY_QUANTIZATION": "50000",
                "DETAIL_OUTPUT_TOPOLOGY_QUANTIZATION": "25000",
            },
        ):
            reloaded_cfg = importlib.reload(cfg)
            self.assertEqual(reloaded_cfg.RUNTIME_POLITICAL_TOPOLOGY_QUANTIZATION, 50_000)
            self.assertEqual(reloaded_cfg.DETAIL_OUTPUT_TOPOLOGY_QUANTIZATION, 25_000)
            _runtime_profile, runtime_parameters = init_map_data._candidate_topology_parameter_profile(
                "Runtime Political"
            )
            _detail_profile, detail_parameters = init_map_data._candidate_topology_parameter_profile(
                "Detail Bundle"
            )
            self.assertEqual(runtime_parameters["quantization"], 50_000)
            self.assertEqual(detail_parameters["quantization"], 25_000)

    def test_topology_quantization_env_override_fails_closed_on_invalid_value(self) -> None:
        with patch.dict(os.environ, {"RUNTIME_POLITICAL_TOPOLOGY_QUANTIZATION": "0"}):
            with self.assertRaisesRegex(ValueError, "RUNTIME_POLITICAL_TOPOLOGY_QUANTIZATION"):
                importlib.reload(cfg)


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

    def test_init_base_stage_wrappers_preserve_cache_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            output_path = output_dir / "artifact.json"
            output_path.write_text("{}", encoding="utf-8")

            signature = init_map_data._compute_stage_signature(
                stage_name="contract",
                inputs=[output_path],
                extra={"mode": "test"},
            )
            self.assertEqual(
                signature,
                base_stage.compute_stage_signature(
                    stage_name="contract",
                    inputs=[output_path],
                    extra={"mode": "test"},
                ),
            )

            cache_payload: dict[str, dict] = {}
            init_map_data._update_stage_cache(
                cache_payload=cache_payload,
                stage_name="contract",
                signature=signature,
                outputs=[output_path],
            )
            self.assertTrue(
                init_map_data._should_skip_stage(
                    cache_payload=cache_payload,
                    stage_name="contract",
                    signature=signature,
                    outputs=[output_path],
                )
            )

            init_map_data._write_build_stage_cache(output_dir, cache_payload)
            self.assertEqual(init_map_data._load_build_stage_cache(output_dir), cache_payload)

    def test_init_primary_topology_wrapper_delegates_to_stage_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            script_dir = root / "scripts"
            output_dir = root / "data"
            timings_root = root / "timings"
            stage_timings: dict[str, dict] = {}
            build_stage_cache: dict[str, dict] = {}
            expected = {"world_cities": [], "missing_cntr_code_count": 0}

            with patch.object(
                init_map_data.primary_topology_stage,
                "run_primary_topology_bundle",
                return_value=expected,
            ) as primary_mock:
                result = init_map_data.build_primary_topology_bundle(
                    script_dir,
                    output_dir,
                    stage_timings=stage_timings,
                    build_stage_cache=build_stage_cache,
                    timings_root=timings_root,
                )

            self.assertIs(result, expected)
            primary_mock.assert_called_once()
            primary_call = primary_mock.call_args
            self.assertEqual(primary_call.args, (script_dir, output_dir))
            self.assertIs(primary_call.kwargs["stage_timings"], stage_timings)
            self.assertIs(primary_call.kwargs["build_stage_cache"], build_stage_cache)
            self.assertEqual(primary_call.kwargs["timings_root"], timings_root)
            self.assertIs(primary_call.kwargs["stage_ops"], init_map_data)

    def test_init_detail_topology_wrappers_delegate_to_stage_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            script_dir = root / "scripts"
            output_dir = root / "data"
            timings_root = root / "timings"
            stage_timings: dict[str, dict] = {}
            build_stage_cache: dict[str, dict] = {}

            with patch.object(init_map_data.detail_topology_stage, "run_ru_city_detail_topology") as ru_mock:
                init_map_data.build_ru_city_detail_topology(
                    script_dir,
                    output_dir,
                    stage_timings=stage_timings,
                    build_stage_cache=build_stage_cache,
                    timings_root=timings_root,
                )

            ru_mock.assert_called_once()
            ru_call = ru_mock.call_args
            self.assertEqual(ru_call.args, (script_dir, output_dir))
            self.assertIs(ru_call.kwargs["stage_timings"], stage_timings)
            self.assertIs(ru_call.kwargs["build_stage_cache"], build_stage_cache)
            self.assertEqual(ru_call.kwargs["timings_root"], timings_root)
            self.assertEqual(ru_call.kwargs["project_root"], init_map_data.PROJECT_ROOT)
            self.assertEqual(ru_call.kwargs["init_map_data_path"], Path(init_map_data.__file__))
            self.assertIs(ru_call.kwargs["fetch_or_load_geojson_func"], init_map_data.fetch_or_load_geojson)
            self.assertIs(ru_call.kwargs["compute_stage_signature_func"], init_map_data._compute_stage_signature)
            self.assertIs(ru_call.kwargs["should_skip_stage_func"], init_map_data._should_skip_stage)
            self.assertIs(ru_call.kwargs["update_stage_cache_func"], init_map_data._update_stage_cache)
            self.assertIs(ru_call.kwargs["record_stage_timing_func"], init_map_data._record_stage_timing)
            self.assertIs(ru_call.kwargs["read_optional_json_func"], init_map_data._read_optional_json)

            with patch.object(init_map_data.detail_topology_stage, "run_na_detail_topology") as na_mock:
                init_map_data.build_na_detail_topology(
                    script_dir,
                    output_dir,
                    stage_timings=stage_timings,
                    build_stage_cache=build_stage_cache,
                    timings_root=timings_root,
                )

            na_mock.assert_called_once()
            na_call = na_mock.call_args
            self.assertEqual(na_call.args, (script_dir, output_dir))
            self.assertIs(na_call.kwargs["stage_timings"], stage_timings)
            self.assertIs(na_call.kwargs["build_stage_cache"], build_stage_cache)
            self.assertEqual(na_call.kwargs["timings_root"], timings_root)
            self.assertEqual(na_call.kwargs["project_root"], init_map_data.PROJECT_ROOT)
            self.assertEqual(na_call.kwargs["init_map_data_path"], Path(init_map_data.__file__))
            self.assertIs(na_call.kwargs["compute_stage_signature_func"], init_map_data._compute_stage_signature)
            self.assertIs(na_call.kwargs["should_skip_stage_func"], init_map_data._should_skip_stage)
            self.assertIs(na_call.kwargs["update_stage_cache_func"], init_map_data._update_stage_cache)
            self.assertIs(na_call.kwargs["record_stage_timing_func"], init_map_data._record_stage_timing)
            self.assertIs(na_call.kwargs["read_optional_json_func"], init_map_data._read_optional_json)
            self.assertIs(na_call.kwargs["candidate_topology_path_func"], init_map_data._candidate_topology_path)
            self.assertIs(
                na_call.kwargs["promote_candidate_topology_if_safe_func"],
                init_map_data._promote_candidate_topology_if_safe,
            )

    def test_init_runtime_political_topology_wrapper_delegates_to_stage_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            script_dir = root / "scripts"
            output_dir = root / "data"
            timings_root = root / "timings"
            stage_timings: dict[str, dict] = {}
            build_stage_cache: dict[str, dict] = {}

            with patch.object(
                init_map_data.runtime_political_topology_stage,
                "run_runtime_political_topology",
            ) as runtime_mock:
                init_map_data.build_runtime_political_topology(
                    script_dir,
                    output_dir,
                    stage_timings=stage_timings,
                    build_stage_cache=build_stage_cache,
                    timings_root=timings_root,
                )

            runtime_mock.assert_called_once()
            runtime_call = runtime_mock.call_args
            self.assertEqual(runtime_call.args, (script_dir, output_dir))
            self.assertIs(runtime_call.kwargs["stage_timings"], stage_timings)
            self.assertIs(runtime_call.kwargs["build_stage_cache"], build_stage_cache)
            self.assertEqual(runtime_call.kwargs["timings_root"], timings_root)
            self.assertEqual(runtime_call.kwargs["project_root"], init_map_data.PROJECT_ROOT)
            self.assertEqual(runtime_call.kwargs["init_map_data_path"], Path(init_map_data.__file__))
            self.assertIs(runtime_call.kwargs["compute_stage_signature_func"], init_map_data._compute_stage_signature)
            self.assertIs(runtime_call.kwargs["should_skip_stage_func"], init_map_data._should_skip_stage)
            self.assertIs(runtime_call.kwargs["update_stage_cache_func"], init_map_data._update_stage_cache)
            self.assertIs(runtime_call.kwargs["record_stage_timing_func"], init_map_data._record_stage_timing)
            self.assertIs(runtime_call.kwargs["read_optional_json_func"], init_map_data._read_optional_json)
            self.assertIs(runtime_call.kwargs["candidate_topology_path_func"], init_map_data._candidate_topology_path)
            self.assertIs(
                runtime_call.kwargs["promote_candidate_topology_if_safe_func"],
                init_map_data._promote_candidate_topology_if_safe,
            )

    def test_candidate_topology_audit_v2_records_parameters_transform_and_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            primary_path = root / "primary.topo.json"
            candidate_path = root / "runtime.candidate.topo.json"
            output_path = root / "runtime.topo.json"
            topology_payload = {
                "type": "Topology",
                "transform": {"scale": [0.1, 0.2], "translate": [-180, -90]},
                "objects": {"political": {"type": "GeometryCollection", "geometries": []}},
                "arcs": [],
            }
            primary_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            candidate_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            output_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            metrics = {"RU": {"feature_count": 1, "fragment_count": 0}}

            with patch.object(init_map_data, "_validate_candidate_topology_contract", return_value=[]), patch.object(
                init_map_data,
                "_collect_country_gate_metrics",
                return_value=metrics,
            ), patch.object(init_map_data, "evaluate_country_gate_metrics", return_value=[]):
                init_map_data._promote_candidate_topology_if_safe(
                    stage_label="Runtime Political",
                    primary_topology_path=primary_path,
                    candidate_path=candidate_path,
                    output_path=output_path,
                )

            audit = json.loads(init_map_data._candidate_topology_audit_path(output_path).read_text(encoding="utf-8"))
            self.assertEqual(audit["version"], 2)
            self.assertEqual(audit["stage"], "Runtime Political")
            self.assertEqual(audit["parameter_profile_id"], "runtime_political")
            self.assertEqual(
                audit["topology_parameters"]["quantization"],
                cfg.RUNTIME_POLITICAL_TOPOLOGY_QUANTIZATION,
            )
            self.assertFalse(audit["topology_parameters"]["presimplify"])
            self.assertFalse(audit["topology_parameters"]["toposimplify"])
            self.assertTrue(audit["topology_parameters"]["shared_coords"])
            self.assertEqual(audit["topology_transform"]["scale"], [0.1, 0.2])
            self.assertEqual(audit["topology_transform"]["translate"], [-180, -90])
            self.assertFalse(audit["fallback_used"])
            self.assertEqual(audit["result"], "promoted")

    def test_candidate_topology_promotion_fails_closed_when_evaluator_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            primary_path = root / "primary.topo.json"
            candidate_path = root / "detail.candidate.topo.json"
            output_path = root / "detail.topo.json"
            topology_payload = {
                "type": "Topology",
                "objects": {"political": {"type": "GeometryCollection", "geometries": []}},
                "arcs": [],
            }
            primary_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            candidate_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            output_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            metrics = {"RU": {"feature_count": 1, "fragment_count": 0}}

            with patch.object(init_map_data, "_validate_candidate_topology_contract", return_value=[]), patch.object(
                init_map_data,
                "_collect_country_gate_metrics",
                return_value=metrics,
            ), patch.object(init_map_data, "evaluate_country_gate_metrics", None):
                with self.assertRaises(SystemExit):
                    init_map_data._promote_candidate_topology_if_safe(
                        stage_label="Detail Bundle",
                        primary_topology_path=primary_path,
                        candidate_path=candidate_path,
                        output_path=output_path,
                    )

            audit = json.loads(init_map_data._candidate_topology_audit_path(output_path).read_text(encoding="utf-8"))
            self.assertEqual(audit["version"], 2)
            self.assertEqual(audit["result"], "failed_country_gate")
            self.assertIn("country gate evaluator unavailable", audit["gate_problems"])
            self.assertEqual(audit["parameter_profile_id"], "detail_output")
            self.assertTrue(audit["fallback_used"])

    def test_candidate_topology_contract_failure_writes_v2_audit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            primary_path = root / "primary.topo.json"
            candidate_path = root / "runtime.candidate.topo.json"
            output_path = root / "runtime.topo.json"
            topology_payload = {"type": "Topology", "objects": {}, "arcs": []}
            primary_path.write_text(json.dumps(topology_payload), encoding="utf-8")
            candidate_path.write_text(json.dumps(topology_payload), encoding="utf-8")

            with patch.object(init_map_data, "_validate_candidate_topology_contract", return_value=["bad topology"]):
                with self.assertRaises(SystemExit):
                    init_map_data._promote_candidate_topology_if_safe(
                        stage_label="Runtime Political",
                        primary_topology_path=primary_path,
                        candidate_path=candidate_path,
                        output_path=output_path,
                    )

            audit = json.loads(init_map_data._candidate_topology_audit_path(output_path).read_text(encoding="utf-8"))
            self.assertEqual(audit["version"], 2)
            self.assertEqual(audit["result"], "failed_contract")
            self.assertEqual(audit["contract_problems"], ["bad topology"])

    def test_init_hierarchy_locale_wrappers_delegate_to_stage_owner(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "data"
            stage_timings: dict[str, dict] = {}
            build_stage_cache: dict[str, dict] = {}
            expected = {"geo_missing_like": 0, "geo_literal_todo_markers": 0, "mt_requests": 0}

            with patch.object(
                init_map_data.hierarchy_locale_stage,
                "run_hierarchy_locale_stage",
                return_value=expected,
            ) as hierarchy_mock:
                result = init_map_data.run_hierarchy_locale_stage(
                    output_dir,
                    stage_timings=stage_timings,
                    build_stage_cache=build_stage_cache,
                )

            self.assertIs(result, expected)
            hierarchy_mock.assert_called_once()
            hierarchy_call = hierarchy_mock.call_args
            self.assertEqual(hierarchy_call.args, (output_dir,))
            self.assertIs(hierarchy_call.kwargs["stage_timings"], stage_timings)
            self.assertIs(hierarchy_call.kwargs["build_stage_cache"], build_stage_cache)
            self.assertEqual(hierarchy_call.kwargs["project_root"], init_map_data.PROJECT_ROOT)
            self.assertEqual(hierarchy_call.kwargs["init_map_data_path"], Path(init_map_data.__file__))
            self.assertIs(hierarchy_call.kwargs["compute_stage_signature_func"], init_map_data._compute_stage_signature)
            self.assertIs(hierarchy_call.kwargs["should_skip_stage_func"], init_map_data._should_skip_stage)
            self.assertIs(hierarchy_call.kwargs["update_stage_cache_func"], init_map_data._update_stage_cache)
            self.assertIs(hierarchy_call.kwargs["record_stage_timing_func"], init_map_data._record_stage_timing)
            self.assertIs(hierarchy_call.kwargs["write_json_atomic_func"], init_map_data.write_json_atomic)

            with patch.object(
                init_map_data.hierarchy_locale_stage,
                "run_geo_alias_normalization",
            ) as aliases_mock:
                init_map_data.run_geo_alias_normalization(output_dir)

            aliases_mock.assert_called_once()
            aliases_call = aliases_mock.call_args
            self.assertEqual(aliases_call.args, (output_dir,))
            self.assertEqual(aliases_call.kwargs["project_root"], init_map_data.PROJECT_ROOT)
            self.assertIs(aliases_call.kwargs["write_json_atomic_func"], init_map_data.write_json_atomic)

            with patch.object(
                init_map_data.hierarchy_locale_stage,
                "run_optional_machine_translation",
            ) as mt_mock:
                init_map_data.run_optional_machine_translation(output_dir, stage_timings=stage_timings)

            mt_mock.assert_called_once()
            mt_call = mt_mock.call_args
            self.assertEqual(mt_call.args, (output_dir,))
            self.assertIs(mt_call.kwargs["stage_timings"], stage_timings)
            self.assertEqual(mt_call.kwargs["project_root"], init_map_data.PROJECT_ROOT)
            self.assertIs(mt_call.kwargs["record_stage_timing_func"], init_map_data._record_stage_timing)

    def test_hierarchy_locale_contract_points_to_stage_owner_with_manifest_owner_stable(self) -> None:
        hierarchy_stage = next(
            stage for stage in contracts.INIT_MAP_DATA_STAGE_DESCRIPTORS if stage.name == "hierarchy_locales"
        )

        self.assertEqual(hierarchy_stage.owner, "map_builder/hierarchy_locale_stage.py")
        self.assertEqual(
            contracts.DATA_ARTIFACT_SPECS_BY_PATH["hierarchy.json"].owner,
            "init_map_data.hierarchy_locales",
        )
        self.assertEqual(
            contracts.DATA_ARTIFACT_SPECS_BY_PATH["geo_aliases.json"].owner,
            "init_map_data.hierarchy_locales",
        )
        self.assertEqual(
            contracts.DATA_ARTIFACT_SPECS_BY_PATH["locales.json"].owner,
            "init_map_data.hierarchy_locales",
        )

    def test_validation_schema_owner_matches_orchestrator_stage_contract(self) -> None:
        self.assertEqual(
            validation_schema.REQUIRED_CONTRACT_STAGE_NAMES,
            build_orchestrator.REQUIRED_CONTRACT_STAGE_NAMES,
        )
        validation_schema.assert_init_map_data_stage_alignment()

    def test_init_config_subdivision_wrapper_delegates_to_processor_owner(self) -> None:
        sentinel = object()

        with patch.object(init_map_data, "_processor_apply_config_subdivisions", return_value="done") as apply_mock:
            result = init_map_data.apply_config_subdivisions(sentinel)

        self.assertEqual(result, "done")
        apply_mock.assert_called_once_with(sentinel)

    def test_configured_subdivision_country_codes_excludes_protected_processors(self) -> None:
        with patch.object(config_subdivisions.cfg, "SUBDIVISIONS", {"JP", "RU", "cn", "GB"}):
            self.assertEqual(config_subdivisions.configured_subdivision_country_codes(), {"GB", "JP"})

    def test_subdivision_protected_countries_come_from_policy_table(self) -> None:
        policies = country_feature_policies.load_country_feature_policies()

        self.assertEqual(policies["schema_version"], 2)
        self.assertEqual(
            config_subdivisions.SUBDIVISION_PROTECTED_COUNTRIES,
            frozenset(policies["subdivision_protected_countries"]),
        )

    def test_topology_admin1_hierarchy_uses_policy_backed_protected_countries(self) -> None:
        protected = frozenset(country_feature_policies.load_country_feature_policies()["subdivision_protected_countries"])

        self.assertTrue(protected.isdisjoint(cfg.TOPOLOGY_ADMIN1_HIERARCHY_CODES))

    def test_detail_political_processor_chain_keeps_current_order_explicit(self) -> None:
        self.assertEqual(
            [name for name, _processor in build_na_detail_topology.DETAIL_POLITICAL_PROCESSOR_CHAIN],
            [
                "france_master_precision",
                "north_america",
                "africa_admin1",
                "global_basic_admin1",
                "denmark_border_detail",
                "cz_sk_border_detail",
                "belarus",
                "russia_ukraine",
                "au_city_overrides",
            ],
        )

    def test_detail_political_processor_chain_runs_in_declared_order(self) -> None:
        calls: list[str] = []

        def make_processor(name: str):
            def _processor(value):
                calls.append(name)
                return f"{value}>{name}"

            return _processor

        chain = (("first", make_processor("first")), ("second", make_processor("second")))
        with patch.object(build_na_detail_topology, "DETAIL_POLITICAL_PROCESSOR_CHAIN", chain):
            result = build_na_detail_topology._apply_detail_political_processor_chain("start")

        self.assertEqual(calls, ["first", "second"])
        self.assertEqual(result, "start>first>second")

    def test_init_main_delegates_to_build_orchestrator_run(self) -> None:
        fake_args = Namespace(mode="detail", strict=False, timings_json=None)

        with patch.object(init_map_data, "parse_args", return_value=fake_args), patch.object(
            init_map_data.validation_schema,
            "assert_init_map_data_stage_alignment",
        ) as schema_mock, patch.object(
            init_map_data.build_orchestrator,
            "run",
        ) as run_mock:
            init_map_data.main()

        schema_mock.assert_called_once_with()
        run_mock.assert_called_once()
        call_args = run_mock.call_args
        self.assertIs(call_args.args[0], fake_args)
        self.assertEqual(call_args.args[1], Path(init_map_data.__file__).resolve().parent)
        self.assertEqual(call_args.args[2], Path(init_map_data.__file__).resolve().parent / "data")
        self.assertIs(call_args.kwargs["stage_ops"], init_map_data)


if __name__ == "__main__":
    unittest.main()
