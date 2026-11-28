from __future__ import annotations

import argparse
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder.thematic_hdi_ingest import (
    HDI_LAYER_ID,
    HDI_METRICS_RELATIVE_PATH,
    HDI_OUTPUT_PATHS,
    HDI_RUNTIME_METRIC_IDS,
    build_hdi_real_source_payloads,
    normalize_hdi_metric,
)
from tools import build_thematic_layers as builder


REPO_ROOT = Path(__file__).resolve().parents[1]
TEMP_ROOT = REPO_ROOT / ".runtime" / "tmp"


class ThematicHdiSourceIngestTest(unittest.TestCase):
    def _build_rows(self, rows: list[str]) -> dict:
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            path = Path(directory) / "hdr.csv"
            path.write_text("iso3,country,hdi_2023,le_2023,eys_2023,mys_2023,gnipc_2023\n" + "\n".join(rows), encoding="cp1252")
            with mock.patch("urllib.request.urlopen") as network:
                payloads = build_hdi_real_source_payloads(path)
            network.assert_not_called()
        self.assertEqual(builder.validate_payloads(payloads), [])
        return payloads

    def test_passthrough_normalization_clipping_and_no_hdi_reconstruction(self) -> None:
        payloads = self._build_rows([
            "USA,United States,0.923,90,22.123456789,19,100000.123456789",
            "CAN,Canada,,79,16,12,42000",
            "MEX,Mexico,0.75,10,0,0,50",
        ])
        features = {feature["join_key"]: feature for feature in payloads[HDI_METRICS_RELATIVE_PATH]["features"]}
        values = features["USA"]["values"]
        self.assertEqual(values["undp_expected_schooling"]["raw_value"], 22.123456789)
        self.assertEqual(values["undp_gni_per_capita"]["raw_value"], 100000.123456789)
        for metric_id in HDI_RUNTIME_METRIC_IDS[1:]:
            self.assertEqual(values[metric_id]["normalized_value"], 100)
        self.assertAlmostEqual(values["undp_hdi"]["normalized_value"], 92.3)
        self.assertIsNone(features["CAN"]["values"]["undp_hdi"]["raw_value"])
        self.assertEqual(features["CAN"]["values"]["undp_hdi"]["source_status"], "source_gap")
        self.assertEqual(features["CAN"]["coverage_status"], "partial")
        for metric_id in HDI_RUNTIME_METRIC_IDS[1:]:
            self.assertEqual(features["MEX"]["values"][metric_id]["normalized_value"], 0)
        self.assertAlmostEqual(normalize_hdi_metric("undp_life_expectancy", 52.5), 50)
        self.assertAlmostEqual(normalize_hdi_metric("undp_gni_per_capita", math.sqrt(100 * 75000)), 50)

    def test_missing_invalid_nonfinite_and_out_of_domain_values_stay_null(self) -> None:
        payloads = self._build_rows([
            "USA,United States,NaN,Infinity,NA,..,0",
            "CAN,Canada,1.01,-1,-2,-3,-4",
            "MEX,Mexico,,,,,",
        ])
        for feature in payloads[HDI_METRICS_RELATIVE_PATH]["features"]:
            self.assertEqual(feature["coverage_status"], "missing")
            for metric in feature["values"].values():
                self.assertIsNone(metric["raw_value"])
                self.assertIsNone(metric["normalized_value"])
                self.assertEqual(metric["source_status"], "source_gap")

    def test_hdi_cli_writes_only_selected_outputs_and_preserves_catalog_entries(self) -> None:
        payloads = self._build_rows(["USA,United States,0.9,80,16,12,40000"])
        existing_index = builder.read_json(builder.data_path(builder.INDEX_RELATIVE_PATH))
        existing_layers = json.loads(json.dumps(existing_index["layers"]))
        args = argparse.Namespace(include_hdi_real=True, include_wgi_real=False, hdi_source_cache_path=Path("hdr.csv"), generated_at="2026-10-05T00:00:00Z", skip_runtime_registry=False, skip_data_manifest=False)
        with mock.patch.object(builder, "parse_args", return_value=args), mock.patch.object(builder, "build_hdi_real_source_payloads", return_value=payloads), mock.patch.object(builder, "read_json", return_value=existing_index), mock.patch.object(builder, "write_json") as writer, mock.patch.object(builder, "update_runtime_asset_registry") as registry, mock.patch.object(builder, "refresh_data_manifest") as manifest:
            builder.main()
        self.assertEqual({call.args[0] for call in writer.call_args_list}, {builder.data_path(path) for path in (*HDI_OUTPUT_PATHS, builder.INDEX_RELATIVE_PATH)})
        old_without_hdi = [layer for layer in existing_layers if layer["layer_id"] != HDI_LAYER_ID]
        self.assertEqual([layer for layer in existing_index["layers"] if layer["layer_id"] != HDI_LAYER_ID], old_without_hdi)
        registry.assert_called_once()
        self.assertEqual(registry.call_args.kwargs, {"only_layer_ids": {HDI_LAYER_ID}})
        manifest.assert_called_once_with((*[builder.INDEX_RELATIVE_PATH, *HDI_OUTPUT_PATHS], "runtime_asset_registry.json"))


if __name__ == "__main__":
    unittest.main()
