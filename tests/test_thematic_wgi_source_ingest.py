from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder.thematic_wgi_ingest import (
    DIMENSION_SHEETS,
    DIMENSION_TO_METRIC_ID,
    WGI_AUDIT_RELATIVE_PATH,
    WGI_COMPOSITE_METRIC_ID,
    WGI_GOVERNMENT_EFFECTIVENESS_METRIC_ID,
    WGI_METRICS_RELATIVE_PATH,
    WGI_RULE_OF_LAW_METRIC_ID,
    build_wgi_real_source_payloads,
    source_code_to_join_key,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "thematic_wgi_2024_minimal.csv"


def _feature_by_join_key(metrics_payload: dict, join_key: str) -> dict:
    for feature in metrics_payload["features"]:
        if feature["join_key"] == join_key:
            return feature
    raise AssertionError(f"feature not found: {join_key}")


class ThematicWgiSourceIngestTest(unittest.TestCase):
    def test_six_dimensions_use_source_union_and_audit_each_dimension(self) -> None:
        rows = ["Economy (name),Economy (code),Year,Governance dimension,Governance score (0-100),Number of sources"]
        for index, (sheet, dimension) in enumerate(DIMENSION_SHEETS.items()):
            rows.append(f"United States,USA,2024,{sheet},{70 + index},10")
        rows.extend([
            "Canada,CAN,2024,va,64,8",
            "Mexico,MEX,2024,pv,,7",
            "World,WLD,2024,rq,60,9",
            "Unknown,ZZZ,2024,cc,50,6",
        ])
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "six-dimensions.csv"
            path.write_text("\n".join(rows), encoding="utf-8")
            payloads = build_wgi_real_source_payloads(path)
        metrics = payloads[WGI_METRICS_RELATIVE_PATH]
        audit = payloads[WGI_AUDIT_RELATIVE_PATH]["coverage_summary"]["dimensions"]
        self.assertEqual({feature["join_key"] for feature in metrics["features"]}, {"USA", "CAN", "MEX"})
        self.assertEqual(_feature_by_join_key(metrics, "USA")["coverage_status"], "complete")
        canada = _feature_by_join_key(metrics, "CAN")
        self.assertEqual(canada["coverage_status"], "partial")
        self.assertEqual(canada["values"][WGI_COMPOSITE_METRIC_ID]["source_status"], "source_gap")
        mexico = _feature_by_join_key(metrics, "MEX")
        political_stability = mexico["values"][DIMENSION_TO_METRIC_ID["political_stability"]]
        self.assertEqual(political_stability["source_status"], "source_gap")
        self.assertEqual(political_stability["uncertainty"]["number_of_sources"], 7)
        self.assertEqual(mexico["coverage_status"], "missing")
        self.assertEqual(audit["voice_and_accountability"]["source_rows_mapped"], 2)
        self.assertEqual(audit["political_stability"]["source_rows_with_missing_score"], 1)
        self.assertEqual(audit["regulatory_quality"]["source_rows_dropped_aggregate"], 1)
        self.assertEqual(audit["control_of_corruption"]["source_rows_unmatched"], 1)
        for dimension, counts in audit.items():
            self.assertEqual(counts["selected_source_rows"], counts["source_rows_mapped"] + counts["source_rows_unmatched"] + counts["source_rows_dropped_aggregate"])
            self.assertEqual(counts["observed"] + counts["source_gap"], 3)
            self.assertEqual(counts["source_rows_mapped"] + counts["missing_source_rows"], 3)

    def _build_fixture_payloads(self) -> dict[str, dict]:
        with mock.patch("urllib.request.urlopen") as urlopen:
            payloads = build_wgi_real_source_payloads(
                FIXTURE_PATH,
                generated_at="2026-06-22T00:00:00Z",
                accessed_at="2026-06-22T00:00:00Z",
            )
        urlopen.assert_not_called()
        return payloads

    def test_wgi_ingest_builds_government_effectiveness_rule_of_law_and_composite(self) -> None:
        metrics = self._build_fixture_payloads()[WGI_METRICS_RELATIVE_PATH]
        usa = _feature_by_join_key(metrics, "USA")
        values = usa["values"]

        self.assertEqual(values[WGI_GOVERNMENT_EFFECTIVENESS_METRIC_ID]["normalized_value"], 80.0)
        self.assertEqual(values[WGI_RULE_OF_LAW_METRIC_ID]["normalized_value"], 72.0)
        self.assertEqual(values[WGI_COMPOSITE_METRIC_ID]["normalized_value"], 76.0)
        self.assertEqual(values[WGI_COMPOSITE_METRIC_ID]["source_status"], "observed")
        self.assertEqual(values[WGI_COMPOSITE_METRIC_ID]["year"], 2024)
        ge_uncertainty = values[WGI_GOVERNMENT_EFFECTIVENESS_METRIC_ID]["uncertainty"]
        self.assertEqual(ge_uncertainty["number_of_sources"], 12)
        self.assertEqual(ge_uncertainty["score_standard_error"], 4.2)
        self.assertEqual(ge_uncertainty["score_confidence_interval_90"], {"lower": 72.0, "upper": 88.0})
        self.assertEqual(ge_uncertainty["estimate"], 1.2)
        self.assertEqual(ge_uncertainty["estimate_standard_error"], 0.15)
        self.assertEqual(ge_uncertainty["estimate_confidence_interval_90"], {"lower": 0.9, "upper": 1.5})
        composite_uncertainty = values[WGI_COMPOSITE_METRIC_ID]["uncertainty"]
        self.assertEqual(composite_uncertainty["method"], "not_computed")
        self.assertIn("not inferred", composite_uncertainty["reason"])

    def test_wgi_join_uses_explicit_codes_without_fuzzy_name_matching(self) -> None:
        metrics = self._build_fixture_payloads()[WGI_METRICS_RELATIVE_PATH]
        join_keys = {feature["join_key"] for feature in metrics["features"]}

        self.assertEqual(source_code_to_join_key("ADO"), "AND")
        self.assertEqual(source_code_to_join_key("XKX"), "XKX")
        self.assertIsNone(source_code_to_join_key("CHI"))
        self.assertIsNone(source_code_to_join_key("ZZZ"))
        self.assertIn("USA", join_keys)
        self.assertIn("AND", join_keys)
        self.assertIn("XKX", join_keys)
        self.assertNotIn("CHI", join_keys)
        self.assertNotIn("ZZZ", join_keys)

    def test_wgi_missing_one_metric_sets_composite_partial_source_gap(self) -> None:
        metrics = self._build_fixture_payloads()[WGI_METRICS_RELATIVE_PATH]
        brazil = _feature_by_join_key(metrics, "BRA")
        values = brazil["values"]

        self.assertEqual(brazil["coverage_status"], "partial")
        self.assertEqual(values[WGI_GOVERNMENT_EFFECTIVENESS_METRIC_ID]["source_status"], "observed")
        self.assertIsNone(values[WGI_RULE_OF_LAW_METRIC_ID]["raw_value"])
        self.assertEqual(values[WGI_RULE_OF_LAW_METRIC_ID]["source_status"], "source_gap")
        self.assertIsNone(values[WGI_COMPOSITE_METRIC_ID]["normalized_value"])
        self.assertEqual(values[WGI_COMPOSITE_METRIC_ID]["source_status"], "partial_source_gap")


if __name__ == "__main__":
    unittest.main()
