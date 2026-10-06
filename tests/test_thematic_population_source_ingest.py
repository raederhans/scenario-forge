from __future__ import annotations

import argparse
import copy
import itertools
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from map_builder.thematic_population_ingest import (
    DEFAULT_POPULATION_SOURCE_CACHE_DIR, POPULATION_AUDIT_RELATIVE_PATH,
    POPULATION_LAYER_ID, POPULATION_MANIFEST_RELATIVE_PATH, POPULATION_METRICS,
    POPULATION_METRICS_RELATIVE_PATH, POPULATION_OUTPUT_PATHS,
    POPULATION_RUNTIME_DATA_VERSION, build_population_real_source_payloads,
    normalize_population_metric, population_runtime_selection,
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

    def test_rejects_indicator_year_duplicate_and_unknown_country(self) -> None:
        mutations = [lambda r: r["indicator"].update(id="wrong"), lambda r: r.update(date="2024"),
                     lambda r: r["country"].update(id="ZZ"), lambda r: r.update(countryiso3code="FRA"),
                     lambda r: r.pop("value")]
        for mutate in mutations:
            caches = _fixtures()
            mutate(caches["SP.POP.TOTL.json"][1][0])
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                self._build(caches)
        caches = _fixtures()
        caches["SP.POP.TOTL.json"][1].append(copy.deepcopy(caches["SP.POP.TOTL.json"][1][0]))
        caches["SP.POP.TOTL.json"][0]["total"] += 1
        with self.assertRaisesRegex(ValueError, "Duplicate WDI country observation"):
            self._build(caches)
        caches = _fixtures()
        caches["countries.json"][1][0]["id"] = "ZZZ"
        with self.assertRaisesRegex(ValueError, "requires audit"):
            self._build(caches)
        caches = _fixtures()
        caches["countries.json"][1].append(copy.deepcopy(caches["countries.json"][1][0]))
        caches["countries.json"][0]["total"] += 1
        with self.assertRaisesRegex(ValueError, "Duplicate WDI country metadata"):
            self._build(caches)

    def test_invalid_values_fail_closed(self) -> None:
        cases = [("SP.POP.TOTL", 1.5), ("SP.POP.TOTL", True), ("SP.POP.TOTL", "123"),
                 ("SP.POP.TOTL", ""), ("EN.POP.DNST", -1), ("SP.URB.TOTL.IN.ZS", 101),
                 ("SP.POP.65UP.TO.ZS", -0.01), ("SP.DYN.TFRT.IN", float("nan")),
                 ("SP.DYN.TFRT.IN", float("inf"))]
        for code, value in cases:
            caches = _fixtures()
            caches[f"{code}.json"][1][0]["value"] = value
            with self.subTest(code=code, value=value), self.assertRaises(ValueError):
                self._build(caches)

    @unittest.skipUnless(DEFAULT_POPULATION_SOURCE_CACHE_DIR.is_dir(), "Official WDI cache unavailable")
    def test_official_cache_every_country_raw_value_passes_through(self) -> None:
        payloads = build_population_real_source_payloads()
        self.assertEqual(builder.validate_payloads(payloads), [])
        features = {feature["join_key"]: feature for feature in payloads[POPULATION_METRICS_RELATIVE_PATH]["features"]}
        metadata = json.loads((DEFAULT_POPULATION_SOURCE_CACHE_DIR / "countries.json").read_text())[1]
        by_iso2 = {row["iso2Code"]: row for row in metadata}
        self.assertEqual(set(features), {row["id"] for row in metadata if row["region"]["id"] != "NA" and row["id"] != "CHI"})
        for metric_id, (code, unit) in POPULATION_METRICS.items():
            rows = json.loads((DEFAULT_POPULATION_SOURCE_CACHE_DIR / f"{code}.json").read_text())[1]
            for row in rows:
                country = by_iso2[row["country"]["id"]]
                if country["region"]["id"] == "NA" or country["id"] == "CHI":
                    continue
                value = features[country["id"]]["values"][metric_id]
                self.assertEqual(value["raw_value"], row["value"])
                self.assertEqual(value["unit"], unit)
                self.assertEqual(value["year"], 2023)
                self.assertEqual(value["source_status"], "source_gap" if row["value"] is None else "observed")
                self.assertEqual(value["normalized_value"], None if row["value"] is None else normalize_population_metric(metric_id, row["value"]))
        audit = payloads[POPULATION_AUDIT_RELATIVE_PATH]["coverage_summary"]
        self.assertEqual((audit["features"], audit["complete"], audit["partial"], audit["missing"]), (216, 215, 1, 0))
        self.assertEqual((audit["country_metadata_rows"], audit["country_metadata_countries"], audit["country_metadata_aggregates"]), (295, 217, 78))
        self.assertEqual((audit["source_rows"], audit["source_rows_dropped_aggregate"], audit["source_rows_unmatched"]), (1325, 240, 5))
        self.assertEqual(features["XKX"]["values"]["wdi_population_density"]["source_status"], "source_gap")

    def test_population_outputs_preserve_and_reject_partial_existing_outputs(self) -> None:
        payloads = self._build()
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            root = Path(directory)
            for path, payload in payloads.items():
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(payload), encoding="utf-8")
            with mock.patch.object(builder, "DATA_ROOT", root):
                self.assertEqual(builder.load_existing_population_payloads(), payloads)
                rebuilt = builder.build_payloads("2026-10-05T00:00:00Z", include_existing_hdi=False)
                for path, payload in payloads.items():
                    self.assertEqual(rebuilt[path], payload)
                (root / POPULATION_OUTPUT_PATHS[0]).unlink()
                with self.assertRaisesRegex(FileNotFoundError, "incomplete"):
                    builder.load_existing_population_payloads()

    def test_repeated_source_build_and_default_cli_preserve_population_bytes(self) -> None:
        TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as directory:
            root = Path(directory)
            source_dir = root / "source-cache"
            source_dir.mkdir()
            for filename, payload in _fixtures().items():
                (source_dir / filename).write_text(json.dumps(payload), encoding="utf-8")
            first = build_population_real_source_payloads(source_dir, generated_at="2026-10-05T00:00:00Z")
            second = build_population_real_source_payloads(source_dir, generated_at="2026-10-05T00:00:00Z")
            self.assertEqual(first, second)
            data_root = root / "data"
            for relative_path, payload in first.items():
                builder.write_json(data_root / relative_path, payload)
            before = {path: (data_root / path).read_bytes() for path in POPULATION_OUTPUT_PATHS}
            args = argparse.Namespace(include_population_real=False, include_hdi_real=False, include_wgi_real=False,
                                      generated_at="2026-10-06T00:00:00Z", skip_runtime_registry=True, skip_data_manifest=True)
            with mock.patch.object(builder, "DATA_ROOT", data_root), mock.patch.object(builder, "parse_args", return_value=args):
                builder.main()
            for path, original_bytes in before.items():
                self.assertEqual((data_root / path).read_bytes(), original_bytes)
            index = builder.read_json(data_root / builder.INDEX_RELATIVE_PATH)
            self.assertIn(POPULATION_LAYER_ID, {entry["layer_id"] for entry in index["layers"]})

    def test_scoped_cli_all_flag_combinations_refresh_requested_entries_and_preserve_others(self) -> None:
        population = self._build()
        original = builder.read_json(builder.data_path(builder.INDEX_RELATIVE_PATH))
        hdi_manifest = builder.read_json(builder.data_path(builder.HDI_REAL_MANIFEST_RELATIVE_PATH))
        wgi_manifest = builder.read_json(builder.data_path(builder.WGI_MANIFEST_RELATIVE_PATH))
        hdi_manifest["description"] = "Fresh HDI build"
        wgi_manifest["description"] = "Fresh WGI build"
        real = [(population, POPULATION_MANIFEST_RELATIVE_PATH, builder.build_population_index_entry),
                ({builder.HDI_REAL_MANIFEST_RELATIVE_PATH: hdi_manifest}, builder.HDI_REAL_MANIFEST_RELATIVE_PATH, builder.build_hdi_index_entry),
                ({builder.WGI_MANIFEST_RELATIVE_PATH: wgi_manifest}, builder.WGI_MANIFEST_RELATIVE_PATH, builder.build_wgi_index_entry)]
        for flags in itertools.product((False, True), repeat=3):
            if not any(flags):
                continue
            for existing in (False, True):
                with self.subTest(flags=flags, existing=existing):
                    index = copy.deepcopy(original)
                    requested = [entry for entry, enabled in zip(real, flags) if enabled]
                    requested_ids = {entry_fn(data[path])["layer_id"] for data, path, entry_fn in requested}
                    if not existing:
                        index["layers"] = [entry for entry in index["layers"] if entry["layer_id"] not in requested_ids]
                    untouched = [copy.deepcopy(entry) for entry in index["layers"] if entry["layer_id"] not in requested_ids]
                    args = argparse.Namespace(include_population_real=flags[0], include_hdi_real=flags[1], include_wgi_real=flags[2],
                                              population_source_cache_dir=Path("population-cache"), hdi_source_cache_path=Path("hdr.csv"),
                                              wgi_source_cache_path=Path("wgi.xlsx"), generated_at="2026-10-05T00:00:00Z",
                                              skip_runtime_registry=False, skip_data_manifest=False)
                    with mock.patch.object(builder, "parse_args", return_value=args), mock.patch.object(builder, "read_json", return_value=index), \
                         mock.patch.object(builder, "build_population_real_source_payloads", return_value=population), \
                         mock.patch.object(builder, "build_hdi_real_source_payloads", return_value=real[1][0]), \
                         mock.patch.object(builder, "build_wgi_real_source_payloads", return_value=real[2][0]), \
                         mock.patch.object(builder, "write_json") as writer, \
                         mock.patch.object(builder, "update_runtime_asset_registry") as registry, \
                         mock.patch.object(builder, "refresh_data_manifest") as manifest:
                        builder.main()
                    expected_paths = {builder.data_path(builder.INDEX_RELATIVE_PATH)} | {builder.data_path(path) for data, _, _ in requested for path in data}
                    self.assertEqual({call.args[0] for call in writer.call_args_list}, expected_paths)
                    self.assertEqual([entry for entry in index["layers"] if entry["layer_id"] not in requested_ids], untouched)
                    self.assertEqual(len(index["layers"]), len({entry["layer_id"] for entry in index["layers"]}))
                    for data, path, entry_fn in requested:
                        self.assertIn(entry_fn(data[path]), index["layers"])
                    registry.assert_called_once()
                    self.assertEqual(registry.call_args.kwargs, {"only_layer_ids": requested_ids})
                    self.assertEqual(set(manifest.call_args.args[0]), {path.relative_to(builder.DATA_ROOT).as_posix() for path in expected_paths} | {"runtime_asset_registry.json"})

    def test_scoped_population_registry_preserves_unrelated_assets(self) -> None:
        payloads = self._build()
        index = builder.read_json(builder.data_path(builder.INDEX_RELATIVE_PATH))
        index["layers"] = [entry for entry in index["layers"] if entry["layer_id"] != POPULATION_LAYER_ID]
        index["layers"].append(builder.build_population_index_entry(payloads[POPULATION_MANIFEST_RELATIVE_PATH]))
        payloads[builder.INDEX_RELATIVE_PATH] = index
        current = builder.read_json(builder.DATA_ROOT / "runtime_asset_registry.json")
        current["assets"]["other-wip"] = {"metadata": {"keep": "exact"}}
        before = copy.deepcopy(current)
        with mock.patch.object(builder, "read_json", return_value=current), mock.patch.object(builder, "write_json") as writer:
            builder.update_runtime_asset_registry(payloads, only_layer_ids={POPULATION_LAYER_ID})
        updated = writer.call_args.args[1]
        for key, value in before["assets"].items():
            if key not in {"thematic_layer_catalog", f"thematic_layer:{POPULATION_LAYER_ID}", "thematic_population_metrics"}:
                self.assertEqual(updated["assets"][key], value)
        self.assertEqual(updated["assets"]["thematic_population_metrics"]["metadata"]["data_version"], POPULATION_RUNTIME_DATA_VERSION)


if __name__ == "__main__":
    unittest.main()
