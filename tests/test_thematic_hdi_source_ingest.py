from __future__ import annotations

import argparse
import csv
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder.thematic_hdi_ingest import (
    DEFAULT_HDI_SOURCE_CACHE_PATH, HDI_AUDIT_RELATIVE_PATH, HDI_LAYER_ID,
    HDI_MANIFEST_RELATIVE_PATH, HDI_METRICS, HDI_METRICS_RELATIVE_PATH, HDI_OUTPUT_PATHS,
    HDI_RUNTIME_DATA_VERSION, HDI_RUNTIME_METRIC_IDS,
    build_hdi_real_source_payloads, normalize_hdi_metric,
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

    def test_aggregate_and_unknown_codes_are_audited_without_name_matching(self) -> None:
        payloads = self._build_rows([
            "CIV,Côte d'Ivoire,0.6,60,10,5,2000",
            "ZZK.WORLD,World,0.7,70,14,9,5000",
            "ZZZ,United States,0.8,80,16,12,10000",
            "NOTISO,United States,0.8,80,16,12,10000",
        ])
        metrics = payloads[HDI_METRICS_RELATIVE_PATH]
        self.assertEqual([feature["join_key"] for feature in metrics["features"]], ["CIV"])
        self.assertEqual(metrics["features"][0]["name"], "Côte d'Ivoire")
        audit = payloads[HDI_AUDIT_RELATIVE_PATH]
        self.assertEqual({row["source_code"] for row in audit["dropped_aggregate_rows"]}, {"ZZK.WORLD", "ZZZ"})
        self.assertEqual([row["source_code"] for row in audit["unmatched_source_rows"]], ["NOTISO"])
        self.assertEqual(audit["coverage_summary"]["source_rows"], 4)

    def test_bad_headers_duplicate_countries_empty_countries_and_missing_file_fail(self) -> None:
        with self.assertRaisesRegex(FileNotFoundError, "source cache is missing"):
            build_hdi_real_source_payloads(TEMP_ROOT / "missing-hdr.csv")
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            path = Path(directory) / "bad.csv"
            path.write_text("iso3,country,hdi_2022\nUSA,United States,0.9", encoding="cp1252")
            with self.assertRaisesRegex(ValueError, "missing required columns"):
                build_hdi_real_source_payloads(path)
        with self.assertRaisesRegex(ValueError, "Duplicate UNDP country ISO3: USA"):
            self._build_rows(["USA,United States,0.9,80,16,12,40000"] * 2)
        with self.assertRaisesRegex(ValueError, "no admin0 countries"):
            self._build_rows(["ZZK.WORLD,World,0.7,70,14,9,5000"])

    @unittest.skipUnless(DEFAULT_HDI_SOURCE_CACHE_PATH.is_file(), "Official UNDP cache is unavailable")
    def test_official_csv_all_country_raw_values_and_missing_values_pass_through(self) -> None:
        payloads = build_hdi_real_source_payloads(DEFAULT_HDI_SOURCE_CACHE_PATH)
        self.assertEqual(builder.validate_payloads(payloads), [])
        features = {feature["join_key"]: feature for feature in payloads[HDI_METRICS_RELATIVE_PATH]["features"]}
        with DEFAULT_HDI_SOURCE_CACHE_PATH.open(encoding="cp1252", newline="") as handle:
            rows = list(csv.DictReader(handle))
        country_rows = [row for row in rows if not row["iso3"].startswith("ZZ")]
        self.assertEqual(set(features), {row["iso3"] for row in country_rows})
        self.assertEqual(len(features), 195)
        for row in country_rows:
            for metric_id, (column, unit) in HDI_METRICS.items():
                metric = features[row["iso3"]]["values"][metric_id]
                expected_raw = float(row[column]) if row[column] else None
                self.assertEqual(metric["raw_value"], expected_raw)
                self.assertEqual(metric["unit"], unit)
                self.assertEqual(metric["year"], 2023)
                self.assertEqual(metric["source_status"], "observed" if expected_raw is not None else "source_gap")
                if expected_raw is None:
                    self.assertIsNone(metric["normalized_value"])
                else:
                    self.assertAlmostEqual(metric["normalized_value"], normalize_hdi_metric(metric_id, expected_raw), places=12)
        coverage = payloads[HDI_AUDIT_RELATIVE_PATH]["coverage_summary"]
        self.assertEqual(coverage["source_rows"], 206)
        self.assertEqual(coverage["source_rows_dropped_aggregate"], 11)
        self.assertEqual(coverage["source_rows_unmatched"], 0)
        self.assertEqual((coverage["complete"], coverage["partial"], coverage["missing"]), (193, 2, 0))
        selection = payloads[HDI_MANIFEST_RELATIVE_PATH]["runtime_consumer"]
        self.assertEqual(selection["data_version"], HDI_RUNTIME_DATA_VERSION)
        self.assertEqual(selection["historical_reference_policy"]["reference_year"], 2023)
        self.assertFalse(selection["historical_reference_policy"]["historical_measurement"])

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

    def test_scoped_registry_update_preserves_unrelated_metadata(self) -> None:
        payloads = self._build_rows(["USA,United States,0.9,80,16,12,40000"])
        index = builder.read_json(builder.data_path(builder.INDEX_RELATIVE_PATH))
        entry = builder.build_hdi_index_entry(payloads[HDI_MANIFEST_RELATIVE_PATH])
        index["layers"] = [layer for layer in index["layers"] if layer["layer_id"] != HDI_LAYER_ID] + [entry]
        payloads[builder.INDEX_RELATIVE_PATH] = index
        current = builder.read_json(builder.DATA_ROOT / "runtime_asset_registry.json")
        current["assets"]["unrelated-test"] = {"metadata": {"keep": "exact"}}
        old_assets = json.loads(json.dumps(current["assets"]))
        with mock.patch.object(builder, "read_json", return_value=current), mock.patch.object(builder, "write_json") as writer:
            builder.update_runtime_asset_registry(payloads, only_layer_ids={HDI_LAYER_ID})
        result = writer.call_args.args[1]
        for key, value in old_assets.items():
            if key not in {"thematic_layer_catalog", f"thematic_layer:{HDI_LAYER_ID}", "thematic_hdi_metrics"}:
                self.assertEqual(result["assets"][key], value)
        self.assertEqual(result["assets"]["thematic_hdi_metrics"]["metadata"]["data_version"], HDI_RUNTIME_DATA_VERSION)

    def test_combined_real_source_flags_refresh_or_append_both_catalog_entries(self) -> None:
        hdi_payloads = self._build_rows(["USA,United States,0.9,80,16,12,40000"])
        wgi_manifest = builder.read_json(builder.data_path(builder.WGI_MANIFEST_RELATIVE_PATH))
        wgi_manifest["description"] = "Fresh WGI description from the requested rebuild."
        wgi_payloads = {builder.WGI_MANIFEST_RELATIVE_PATH: wgi_manifest}
        original_index = builder.read_json(builder.data_path(builder.INDEX_RELATIVE_PATH))
        args = argparse.Namespace(include_hdi_real=True, include_wgi_real=True, hdi_source_cache_path=Path("hdr.csv"), wgi_source_cache_path=Path("wgi.xlsx"), generated_at="2026-10-05T00:00:00Z", skip_runtime_registry=False, skip_data_manifest=False)
        for existing_wgi in (True, False):
            with self.subTest(existing_wgi=existing_wgi):
                index = json.loads(json.dumps(original_index))
                if not existing_wgi:
                    index["layers"] = [layer for layer in index["layers"] if layer["layer_id"] != builder.WGI_LAYER_ID]
                unrelated = [layer for layer in index["layers"] if layer["layer_id"] not in {HDI_LAYER_ID, builder.WGI_LAYER_ID}]
                with mock.patch.object(builder, "parse_args", return_value=args), mock.patch.object(builder, "build_hdi_real_source_payloads", return_value=hdi_payloads), mock.patch.object(builder, "build_wgi_real_source_payloads", return_value=wgi_payloads), mock.patch.object(builder, "read_json", return_value=index), mock.patch.object(builder, "write_json") as writer, mock.patch.object(builder, "update_runtime_asset_registry") as registry, mock.patch.object(builder, "refresh_data_manifest"):
                    builder.main()
                self.assertEqual([layer for layer in index["layers"] if layer["layer_id"] == builder.WGI_LAYER_ID], [builder.build_wgi_index_entry(wgi_manifest)])
                self.assertEqual([layer for layer in index["layers"] if layer["layer_id"] == HDI_LAYER_ID], [builder.build_hdi_index_entry(hdi_payloads[HDI_MANIFEST_RELATIVE_PATH])])
                self.assertEqual([layer for layer in index["layers"] if layer["layer_id"] not in {HDI_LAYER_ID, builder.WGI_LAYER_ID}], unrelated)
                self.assertEqual({call.args[0] for call in writer.call_args_list}, {builder.data_path(path) for path in (*HDI_OUTPUT_PATHS, builder.WGI_MANIFEST_RELATIVE_PATH, builder.INDEX_RELATIVE_PATH)})
                registry.assert_called_once()
                self.assertEqual(registry.call_args.kwargs, {"only_layer_ids": {HDI_LAYER_ID, builder.WGI_LAYER_ID}})

    def test_default_build_rejects_partial_hdi_output_set(self) -> None:
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            data_root = Path(directory)
            recipe = data_root / HDI_OUTPUT_PATHS[0]
            recipe.parent.mkdir(parents=True)
            recipe.write_text("{}", encoding="utf-8")
            with mock.patch.object(builder, "DATA_ROOT", data_root):
                with self.assertRaisesRegex(FileNotFoundError, "UNDP HDI real-source outputs are incomplete"):
                    builder.load_existing_hdi_payloads()


if __name__ == "__main__":
    unittest.main()
