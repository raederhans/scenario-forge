from __future__ import annotations

import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder.thematic_layer_contracts import (
    MISSING_SOURCE_STATUSES,
    validate_thematic_admin_metrics,
    validate_thematic_build_audit,
    validate_thematic_grid_rle,
    validate_thematic_layer_index,
    validate_thematic_layer_manifest,
)
from map_builder.thematic_wgi_ingest import (
    WGI_LAYER_ID, WGI_METRIC_IDS, WGI_GOVERNMENT_EFFECTIVENESS_METRIC_ID,
    WGI_RUNTIME_DATA_VERSION, WGI_RUNTIME_METRIC_IDS, WGI_RUNTIME_SCENARIO_IDS,
    WGI_RUNTIME_METHOD, build_wgi_historical_reference_policy, build_wgi_recipe_payload,
    WGI_COMPOSITE_METRIC_ID, DIMENSION_TO_METRIC_ID,
)
from map_builder.json_schema_contracts import validate_json_contract
from map_builder.thematic_hdi_ingest import (
    HDI_LAYER_ID, HDI_RUNTIME_METRIC_IDS, HDI_OUTPUT_PATHS, HDI_MANIFEST_RELATIVE_PATH,
    HDI_METRICS_RELATIVE_PATH, HDI_AUDIT_RELATIVE_PATH, HDI_RUNTIME_DATA_VERSION,
    hdi_runtime_selection,
)
from map_builder.thematic_population_ingest import (
    POPULATION_LAYER_ID, POPULATION_RUNTIME_METRIC_IDS,
    POPULATION_RUNTIME_DATA_VERSION, POPULATION_OUTPUT_PATHS, population_runtime_selection,
)
from tools import build_thematic_layers as thematic_builder
from tools.build_thematic_layers import (
    THEMATIC_RUNTIME_PUBLISH_SCOPE,
    THEMATIC_RUNTIME_READINESS,
    build_payloads,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO_ROOT / "data"
THEMATIC_ROOT = DATA_ROOT / "thematic_layers"
INDEX_PATH = THEMATIC_ROOT / "index.json"
RUNTIME_ASSET_REGISTRY_PATH = DATA_ROOT / "runtime_asset_registry.json"
EXPECTED_LAYER_IDS = {
    "political_state_capacity_demo",
    WGI_LAYER_ID,
    HDI_LAYER_ID,
    POPULATION_LAYER_ID,
    "social_human_development_demo",
    "population_density_demo",
}


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _repo_path(repo_relative_path: str) -> Path:
    return REPO_ROOT / repo_relative_path


def _iter_layer_manifests() -> list[tuple[dict, dict]]:
    index_payload = _read_json(INDEX_PATH)
    return [
        (layer, _read_json(_repo_path(layer["manifest_path"])))
        for layer in index_payload["layers"]
    ]


def _grid_payload() -> tuple[dict, dict]:
    for layer, manifest in _iter_layer_manifests():
        if layer["layer_id"] == "population_density_demo":
            return manifest, _read_json(_repo_path(manifest["paths"]["grid"]))
    raise AssertionError("population_density_demo layer not found")


class ThematicLayerContractTest(unittest.TestCase):
    def test_checked_in_index_matches_builder_and_schema(self) -> None:
        index_payload = _read_json(INDEX_PATH)
        rebuilt = build_payloads(index_payload["generated_at"], include_existing_wgi=True)

        self.assertEqual(index_payload, rebuilt["thematic_layers/index.json"])
        self.assertEqual(validate_thematic_layer_index(index_payload), [])
        self.assertEqual({layer["layer_id"] for layer in index_payload["layers"]}, EXPECTED_LAYER_IDS)

    def test_manifest_payloads_validate_and_point_to_existing_files(self) -> None:
        for layer, manifest in _iter_layer_manifests():
            with self.subTest(layer_id=layer["layer_id"]):
                self.assertEqual(validate_thematic_layer_manifest(manifest, source_label=layer["manifest_path"]), [])
                self.assertEqual(manifest["layer_id"], layer["layer_id"])
                if layer["layer_id"] == WGI_LAYER_ID:
                    self.assertEqual(manifest["source_policy"], "real_source_cache_only")
                    self.assertEqual(manifest["metric_ids"], list(WGI_METRIC_IDS))
                    self.assertEqual(manifest["coverage_scope"]["join_key_type"], "iso_a3")
                elif layer["layer_id"] == HDI_LAYER_ID:
                    self.assertEqual(manifest["source_policy"], "real_source_cache_only")
                    self.assertEqual(manifest["metric_ids"], list(HDI_RUNTIME_METRIC_IDS))
                elif layer["layer_id"] == POPULATION_LAYER_ID:
                    self.assertEqual(manifest["source_policy"], "real_source_cache_only")
                    self.assertEqual(manifest["metric_ids"], list(POPULATION_RUNTIME_METRIC_IDS))
                else:
                    self.assertEqual(manifest["source_policy"], "fixture_only")
                self.assertGreaterEqual(len(manifest["limitations"]), 1)

                paths = manifest["paths"]
                payload_key = "grid" if manifest["geometry_kind"] == "grid_720x360" else "metrics"
                self.assertTrue(_repo_path(paths[payload_key]).is_file())
                self.assertTrue(_repo_path(paths["build_audit"]).is_file())
                for recipe_path in paths["source_recipes"]:
                    recipe = _read_json(_repo_path(recipe_path))
                    self.assertFalse(recipe["download_policy"]["network_allowed"])

    def test_admin_metric_manifest_rejects_duplicate_metric_ids(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            if manifest["geometry_kind"] == "grid_720x360":
                continue
            broken_manifest = copy.deepcopy(manifest)
            broken_manifest["metric_ids"] = [
                broken_manifest["metric_ids"][0],
                broken_manifest["metric_ids"][0],
            ]

            errors = validate_thematic_layer_manifest(broken_manifest)

            self.assertTrue(any("$.metric_ids" in error for error in errors), errors)
            return
        raise AssertionError("admin metric manifest not found")

    def test_admin_metric_payloads_preserve_missing_values_as_null(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            if manifest["geometry_kind"] == "grid_720x360":
                continue
            metrics_path = _repo_path(manifest["paths"]["metrics"])
            metrics_payload = _read_json(metrics_path)
            errors = validate_thematic_admin_metrics(metrics_payload, source_label=manifest["paths"]["metrics"])
            self.assertEqual(errors, [])

            missing_seen = False
            for feature in metrics_payload["features"]:
                for metric_payload in feature["values"].values():
                    if metric_payload["source_status"] in MISSING_SOURCE_STATUSES:
                        missing_seen = True
                        self.assertIsNone(metric_payload["raw_value"])
                        self.assertIsNone(metric_payload["normalized_value"])
                    else:
                        self.assertIsInstance(metric_payload["raw_value"], (int, float))
                        self.assertIsInstance(metric_payload["normalized_value"], (int, float))
            if manifest["source_policy"] == "fixture_only":
                self.assertTrue(missing_seen)

    def test_admin_metric_contract_rejects_non_finite_numbers(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            if manifest["geometry_kind"] == "grid_720x360":
                continue
            metrics_payload = _read_json(_repo_path(manifest["paths"]["metrics"]))
            broken_payload = copy.deepcopy(metrics_payload)
            broken_metric = broken_payload["features"][0]["values"][broken_payload["metric_ids"][0]]
            broken_metric["raw_value"] = math.nan
            broken_metric["normalized_value"] = math.inf

            errors = validate_thematic_admin_metrics(broken_payload)

            self.assertTrue(any("raw_value must be a finite number" in error for error in errors), errors)
            self.assertTrue(any("normalized_value must be a finite number" in error for error in errors), errors)
            return
        raise AssertionError("admin metric payload not found")

    def test_admin_metric_contract_rejects_coverage_status_value_mismatch(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            if manifest["geometry_kind"] == "grid_720x360":
                continue
            metrics_payload = _read_json(_repo_path(manifest["paths"]["metrics"]))
            broken_payload = copy.deepcopy(metrics_payload)
            target_feature = next(
                (feature for feature in broken_payload["features"] if feature.get("coverage_status") == "partial"),
                broken_payload["features"][0],
            )
            expected_status = target_feature["coverage_status"]
            target_feature["coverage_status"] = "complete" if expected_status != "complete" else "missing"

            errors = validate_thematic_admin_metrics(broken_payload)

            self.assertTrue(
                any(f"coverage_status must be {expected_status}" in error for error in errors),
                errors,
            )
            return
        raise AssertionError("admin metric payload not found")

    def test_admin_metric_contract_rejects_duplicate_metric_ids(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            if manifest["geometry_kind"] == "grid_720x360":
                continue
            metrics_payload = _read_json(_repo_path(manifest["paths"]["metrics"]))
            broken_payload = copy.deepcopy(metrics_payload)
            broken_payload["metric_ids"] = [
                broken_payload["metric_ids"][0],
                broken_payload["metric_ids"][0],
            ]

            errors = validate_thematic_admin_metrics(broken_payload)

            self.assertTrue(any("$.metric_ids duplicates" in error for error in errors), errors)
            return
        raise AssertionError("admin metric payload not found")

    def test_admin_metric_contract_rejects_non_finite_uncertainty_numbers(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            if manifest["geometry_kind"] == "grid_720x360":
                continue
            metrics_payload = _read_json(_repo_path(manifest["paths"]["metrics"]))
            broken_payload = copy.deepcopy(metrics_payload)
            broken_metric = broken_payload["features"][0]["values"][broken_payload["metric_ids"][0]]
            broken_metric["uncertainty"] = {
                "method": "not_computed",
                "reason": "Allowed text fields stay textual.",
                "score_standard_error": "nan",
                "score_confidence_interval_90": {"lower": 1.0, "upper": math.inf},
            }

            errors = validate_thematic_admin_metrics(broken_payload)

            self.assertTrue(any("uncertainty.score_standard_error must be a finite number" in error for error in errors), errors)
            self.assertTrue(
                any("uncertainty.score_confidence_interval_90.upper must be a finite number" in error for error in errors),
                errors,
            )
            return
        raise AssertionError("admin metric payload not found")

    def test_existing_wgi_payloads_fail_fast_when_outputs_are_partial(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            first_output = thematic_builder.WGI_REAL_OUTPUT_PATHS[0]
            first_path = temp_root / first_output
            first_path.parent.mkdir(parents=True)
            first_path.write_text("{}", encoding="utf-8")

            with mock.patch.object(thematic_builder, "data_path", side_effect=lambda relative_path: temp_root / relative_path):
                with self.assertRaises(FileNotFoundError) as raised:
                    thematic_builder.load_existing_wgi_payloads()

        self.assertIn("WGI real-source outputs are incomplete", str(raised.exception))
        self.assertIn(thematic_builder.WGI_REAL_OUTPUT_PATHS[1], str(raised.exception))

    def test_grid_rle_contract_matches_declared_grid_size(self) -> None:
        manifest, grid_payload = _grid_payload()
        errors = validate_thematic_grid_rle(grid_payload, source_label=manifest["paths"]["grid"])

        self.assertEqual(errors, [])
        self.assertEqual(grid_payload["grid"]["columns"], 720)
        self.assertEqual(grid_payload["grid"]["rows"], 360)
        self.assertEqual(grid_payload["missing_cell_count"], 0)
        self.assertEqual(grid_payload["missing_value_policy"]["source_gap_encoding"], "none")
        self.assertEqual(sum(run[1] for run in grid_payload["data"]), 720 * 360)
        self.assertGreater(sum(1 for run in grid_payload["data"] if run[0] != grid_payload["neutral_value"]), 0)

    def test_grid_rle_requires_missing_mask_when_missing_cells_exist(self) -> None:
        manifest, grid_payload = _grid_payload()
        broken_payload = copy.deepcopy(grid_payload)
        broken_payload["missing_cell_count"] = 1

        errors = validate_thematic_grid_rle(broken_payload, source_label=manifest["paths"]["grid"])

        self.assertTrue(any("missing_mask_rle" in error for error in errors), errors)

    def test_build_audits_validate_and_mark_fixture_inputs(self) -> None:
        for _layer, manifest in _iter_layer_manifests():
            audit_path = _repo_path(manifest["build_audit_path"])
            audit_payload = _read_json(audit_path)
            errors = validate_thematic_build_audit(audit_payload, source_label=manifest["build_audit_path"])

            self.assertEqual(errors, [])
            if manifest["source_policy"] == "fixture_only":
                self.assertTrue(audit_payload["fixture_notice"]["enabled"])
            else:
                self.assertFalse(audit_payload["fixture_notice"]["enabled"])
                self.assertIn("dropped_aggregate_rows", audit_payload)
            self.assertGreaterEqual(audit_payload["coverage_summary"]["features"], 1)
            for source_input in audit_payload["source_inputs"]:
                self.assertEqual(source_input["source_policy"], manifest["source_policy"])

    def test_runtime_asset_registry_declares_thematic_catalog_and_manifests(self) -> None:
        registry = _read_json(RUNTIME_ASSET_REGISTRY_PATH)
        assets = registry["assets"]

        self.assertEqual(registry["thematic_layer_index_key"], "thematic_layer_catalog")
        self.assertEqual(
            set(registry["thematic_layer_manifest_keys"]),
            EXPECTED_LAYER_IDS,
        )
        self.assertEqual(assets["thematic_layer_catalog"]["url"], "data/thematic_layers/index.json")
        self.assertEqual(
            assets["thematic_layer_catalog"]["metadata"]["publish_scope"],
            THEMATIC_RUNTIME_PUBLISH_SCOPE,
        )
        self.assertEqual(
            assets["thematic_layer_catalog"]["metadata"]["runtime_readiness"],
            THEMATIC_RUNTIME_READINESS,
        )
        for layer_id, asset_key in registry["thematic_layer_manifest_keys"].items():
            with self.subTest(layer_id=layer_id):
                self.assertIn(asset_key, assets)
                manifest = _read_json(_repo_path(assets[asset_key]["url"]))
                metadata = assets[asset_key]["metadata"]
                self.assertEqual(metadata["layer_id"], layer_id)
                self.assertEqual(metadata["source_policy"], manifest["source_policy"])
                self.assertEqual(metadata["publish_scope"], THEMATIC_RUNTIME_PUBLISH_SCOPE)
                self.assertEqual(metadata["runtime_readiness"], "main_map_ready" if layer_id in {WGI_LAYER_ID, HDI_LAYER_ID, POPULATION_LAYER_ID} else THEMATIC_RUNTIME_READINESS)

    def test_population_outputs_remain_in_default_build_and_runtime_registration(self) -> None:
        index = _read_json(INDEX_PATH)
        rebuilt = build_payloads(index["generated_at"], include_existing_wgi=True)
        for relative_path in POPULATION_OUTPUT_PATHS:
            self.assertEqual(rebuilt[relative_path], _read_json(DATA_ROOT / relative_path))
        registry = _read_json(RUNTIME_ASSET_REGISTRY_PATH)
        for key in (f"thematic_layer:{POPULATION_LAYER_ID}", "thematic_population_metrics"):
            metadata = registry["assets"][key]["metadata"]
            self.assertEqual(metadata["data_version"], POPULATION_RUNTIME_DATA_VERSION)
            for selection_key, value in population_runtime_selection().items():
                self.assertEqual(metadata[selection_key], value)

    def test_hdi_real_outputs_remain_in_default_build_and_runtime_registration(self) -> None:
        manifest = _read_json(DATA_ROOT / HDI_MANIFEST_RELATIVE_PATH)
        default_payloads = build_payloads(_read_json(INDEX_PATH)["generated_at"], include_existing_wgi=True)
        for relative_path in HDI_OUTPUT_PATHS:
            self.assertEqual(default_payloads[relative_path], _read_json(DATA_ROOT / relative_path))
        selection = hdi_runtime_selection()
        for key, value in selection.items():
            self.assertEqual(manifest["runtime_consumer"][key], value)
        registry = _read_json(RUNTIME_ASSET_REGISTRY_PATH)
        for asset_key in (f"thematic_layer:{HDI_LAYER_ID}", "thematic_hdi_metrics"):
            metadata = registry["assets"][asset_key]["metadata"]
            self.assertEqual(metadata["data_version"], HDI_RUNTIME_DATA_VERSION)
            self.assertEqual(metadata["supported_metrics"], list(HDI_RUNTIME_METRIC_IDS))
            self.assertEqual(metadata["historical_reference_policy"]["reference_year"], 2023)
        audit = _read_json(DATA_ROOT / HDI_AUDIT_RELATIVE_PATH)
        metrics = _read_json(DATA_ROOT / HDI_METRICS_RELATIVE_PATH)
        coverage = audit["coverage_summary"]
        self.assertEqual(coverage["source_rows"], len(metrics["features"]) + len(audit["dropped_aggregate_rows"]) + len(audit["unmatched_source_rows"]))
        for metric_id in HDI_RUNTIME_METRIC_IDS:
            counts = coverage["metrics"][metric_id]
            self.assertEqual(counts["observed"] + counts["source_gap"], len(metrics["features"]))

    def test_wgi_runtime_selection_preserves_official_metrics_and_historical_reference_scope(self) -> None:
        manifest = _read_json(THEMATIC_ROOT / "political/wgi_state_capacity_v1/manifest.json")
        consumer = manifest["runtime_consumer"]
        self.assertEqual(consumer["status"], "main_map_ready")
        self.assertTrue(consumer["supports_main_map_render"])
        self.assertEqual(consumer["supported_metrics"], list(WGI_RUNTIME_METRIC_IDS))
        self.assertEqual(len(consumer["supported_metrics"]), 6)
        self.assertEqual(consumer["supported_metrics"][0], WGI_GOVERNMENT_EFFECTIVENESS_METRIC_ID)
        self.assertNotIn(WGI_COMPOSITE_METRIC_ID, consumer["supported_metrics"])
        self.assertEqual(consumer["supported_scenarios"], list(WGI_RUNTIME_SCENARIO_IDS))
        self.assertEqual(consumer["method"], WGI_RUNTIME_METHOD)
        self.assertEqual(consumer["historical_reference_policy"], build_wgi_historical_reference_policy())
        self.assertEqual(consumer["data_version"], WGI_RUNTIME_DATA_VERSION)
        recipe = _read_json(THEMATIC_ROOT / "source_recipes/wgi_state_capacity_v1.manual.json")
        self.assertEqual(recipe, build_wgi_recipe_payload(recipe["generated_at"]))

    def test_wgi_six_dimension_coverage_reconciles_source_rows(self) -> None:
        metrics = _read_json(THEMATIC_ROOT / "political/wgi_state_capacity_v1/metrics.admin0.json")
        audit = _read_json(THEMATIC_ROOT / "political/wgi_state_capacity_v1/build_audit.json")
        coverage = audit["coverage_summary"]
        self.assertEqual(coverage["metric_count"], 7)
        self.assertEqual(set(coverage["dimensions"]), set(DIMENSION_TO_METRIC_ID))
        for dimension, metric_id in DIMENSION_TO_METRIC_ID.items():
            counts = coverage["dimensions"][dimension]
            values = [feature["values"][metric_id] for feature in metrics["features"]]
            self.assertEqual(counts["metric_id"], metric_id)
            self.assertEqual(counts["observed"], sum(value["source_status"] == "observed" for value in values))
            self.assertEqual(counts["source_rows_mapped"], sum("source_row_ref" in value for value in values))
            self.assertEqual(counts["observed"] + counts["source_gap"], len(values))
            self.assertEqual(counts["source_rows_mapped"] + counts["missing_source_rows"], len(values))
            self.assertEqual(counts["selected_source_rows"], counts["source_rows_mapped"] + counts["source_rows_unmatched"] + counts["source_rows_dropped_aggregate"])

    def test_wgi_mapping_schema_and_runtime_registry_are_reproducible(self) -> None:
        mapping = _read_json(THEMATIC_ROOT / "wgi_country_code_mapping.json")
        self.assertEqual(validate_json_contract(mapping, schema_name="thematic_wgi_country_mapping.schema.json", source_label="WGI mapping"), [])
        registry = _read_json(RUNTIME_ASSET_REGISTRY_PATH)
        payloads = build_payloads(_read_json(INDEX_PATH)["generated_at"], include_existing_wgi=True)
        with mock.patch.object(thematic_builder, "write_json") as writer:
            thematic_builder.update_runtime_asset_registry(payloads)
        self.assertEqual(writer.call_args.args[1], registry)
        for key in (f"thematic_layer:{WGI_LAYER_ID}", "thematic_wgi_metrics", "thematic_wgi_country_mapping"):
            spec = registry["assets"][key]
            self.assertTrue(_repo_path(spec["url"]).is_file())
            if "schema_ref" in spec:
                self.assertTrue(_repo_path(spec["schema_ref"]).is_file())
            self.assertEqual(spec["metadata"]["data_version"], WGI_RUNTIME_DATA_VERSION)
            self.assertEqual(spec["metadata"]["supported_metrics"], list(WGI_RUNTIME_METRIC_IDS))
            self.assertEqual(spec["metadata"]["supported_scenarios"], list(WGI_RUNTIME_SCENARIO_IDS))
            self.assertEqual(spec["metadata"]["method"], WGI_RUNTIME_METHOD)
            self.assertEqual(spec["metadata"]["historical_reference_policy"], build_wgi_historical_reference_policy())


if __name__ == "__main__":
    unittest.main()
