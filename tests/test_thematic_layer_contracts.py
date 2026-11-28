from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder.thematic_layer_contracts import (
    MISSING_SOURCE_STATUSES,
    validate_thematic_admin_metrics,
    validate_thematic_grid_rle,
    validate_thematic_layer_index,
)
from map_builder.thematic_wgi_ingest import WGI_LAYER_ID
from map_builder.thematic_hdi_ingest import HDI_LAYER_ID
from map_builder.thematic_population_ingest import POPULATION_LAYER_ID
from tools import build_thematic_layers as thematic_builder
from tools.build_thematic_layers import build_payloads


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO_ROOT / "data"
THEMATIC_ROOT = DATA_ROOT / "thematic_layers"
INDEX_PATH = THEMATIC_ROOT / "index.json"
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


if __name__ == "__main__":
    unittest.main()
