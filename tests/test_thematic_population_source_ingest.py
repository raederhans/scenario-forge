from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from map_builder.thematic_population_ingest import (
    POPULATION_AUDIT_RELATIVE_PATH,
    POPULATION_METRICS,
    POPULATION_METRICS_RELATIVE_PATH,
    POPULATION_RUNTIME_DATA_VERSION,
    build_population_real_source_payloads,
    normalize_population_metric,
    population_runtime_selection,
)
from tools import build_thematic_layers as builder

TEMP_ROOT = builder.REPO_ROOT / ".runtime/tmp/thematic-population-tests"


def _fixtures() -> dict[str, list]:
    countries = [{"id": code, "iso2Code": iso2, "name": name, "region": {"id": region}}
                 for code, iso2, name, region in (("USA", "US", "United States", "NAC"),
                                                ("XKX", "XK", "Kosovo", "ECS"),
                                                ("GIB", "GI", "Gibraltar", "ECS"),
                                                ("CHI", "JG", "Channel Islands", "ECS"),
                                                ("WLD", "1W", "World", "NA"),
                                                ("HIC", "XD", "High income", "NA"))]
    caches = {"countries.json": [{"page": 1, "pages": 1, "per_page": "400", "total": len(countries)}, countries]}
    for metric_id, (code, _) in POPULATION_METRICS.items():
        values = {"wdi_population_total": 123456789, "wdi_population_density": 234.567890123,
                  "wdi_urban_population_share": 78.123456789,
                  "wdi_population_65_plus_share": 17.987654321,
                  "wdi_total_fertility_rate": 1.23456789123}
        rows = [{"indicator": {"id": code}, "country": {"id": country["iso2Code"], "value": country["name"]},
                 "countryiso3code": "" if country["id"] == "HIC" else country["id"],
                 "date": "2023", "value": None if metric_id == "wdi_population_density" and country["id"] == "XKX" else values[metric_id]}
                for country in countries]
        caches[f"{code}.json"] = [{"page": 1, "pages": 1, "per_page": 400, "total": len(rows),
                                   "sourceid": "2", "lastupdated": "2026-07-13"}, rows]
    return caches


class ThematicPopulationSourceIngestTest(unittest.TestCase):
    def _build(self, caches: dict[str, list] | None = None) -> dict:
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            source_dir = Path(directory)
            for filename, payload in (caches if caches is not None else _fixtures()).items():
                (source_dir / filename).write_text(json.dumps(payload), encoding="utf-8")
            return build_population_real_source_payloads(source_dir, generated_at="2026-10-05T00:00:00Z")

    def test_raw_precision_missing_country_classification_and_reference_policy(self) -> None:
        payloads = self._build()
        self.assertEqual(builder.validate_payloads(payloads), [])
        features = {feature["join_key"]: feature for feature in payloads[POPULATION_METRICS_RELATIVE_PATH]["features"]}
        self.assertEqual(set(features), {"USA", "XKX", "GIB"})
        for metric_id, (code, unit) in POPULATION_METRICS.items():
            metric = features["USA"]["values"][metric_id]
            self.assertEqual(metric["raw_value"], _fixtures()[f"{code}.json"][1][0]["value"])
            self.assertEqual(metric["normalized_value"], normalize_population_metric(metric_id, metric["raw_value"]))
            self.assertEqual(metric["unit"], unit)
        missing = features["XKX"]["values"]["wdi_population_density"]
        self.assertIsNone(missing["raw_value"])
        self.assertIsNone(missing["normalized_value"])
        self.assertEqual(missing["source_status"], "source_gap")
        audit = payloads[POPULATION_AUDIT_RELATIVE_PATH]
        self.assertEqual(len(audit["dropped_aggregate_rows"]), 10)
        self.assertEqual({row["source_code"] for row in audit["dropped_aggregate_rows"]}, {"WLD", "HIC"})
        self.assertEqual({row["source_code"] for row in audit["unmatched_source_rows"]}, {"CHI"})
        self.assertEqual(audit["coverage_summary"]["runtime_unmapped_join_keys"], ["GIB"])
        selection = population_runtime_selection()
        self.assertEqual(selection["data_version"], POPULATION_RUNTIME_DATA_VERSION)
        self.assertEqual(selection["supported_scenarios"], ["modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"])
        self.assertEqual(selection["historical_reference_policy"]["reference_year"], 2023)
        self.assertFalse(selection["historical_reference_policy"]["historical_measurement"])

    def test_absent_observations_are_explicit_gaps(self) -> None:
        caches = _fixtures()
        for filename in ("EN.POP.DNST.json", "SP.DYN.TFRT.IN.json"):
            caches[filename][1] = [row for row in caches[filename][1] if row["country"]["id"] != "US"]
            caches[filename][0]["total"] -= 1
        payloads = self._build(caches)
        usa = next(feature for feature in payloads[POPULATION_METRICS_RELATIVE_PATH]["features"] if feature["join_key"] == "USA")
        self.assertEqual(usa["coverage_status"], "partial")
        for metric_id in ("wdi_population_density", "wdi_total_fertility_rate"):
            self.assertEqual(usa["values"][metric_id]["source_status"], "source_gap")
        self.assertEqual(len(payloads[POPULATION_AUDIT_RELATIVE_PATH]["missing_join_keys"]), 2)

    def test_rejects_truncated_pages_mixed_revisions_sources_and_bad_response(self) -> None:
        mutations = [lambda p: p[0].update(total=999), lambda p: p[0].update(pages=2),
                     lambda p: p[0].update(page=2), lambda p: p[0].update(per_page=1),
                     lambda p: p[0].update(lastupdated="2026-07-12"), lambda p: p[0].update(sourceid="1"),
                     lambda p: p.__setitem__(1, None), lambda p: p.__setitem__(0, {"message": "error"})]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                caches = _fixtures()
                mutate(caches["EN.POP.DNST.json"])
                with self.assertRaises(ValueError):
                    self._build(caches)
        caches = _fixtures()
        caches["countries.json"][0]["pages"] = 2
        with self.assertRaisesRegex(ValueError, "truncated"):
            self._build(caches)
        caches = _fixtures()
        del caches["SP.POP.TOTL.json"]
        with self.assertRaises(FileNotFoundError):
            self._build(caches)


if __name__ == "__main__":
    unittest.main()
