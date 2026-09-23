import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box

from tools.prepare_tno_western_precision_sources import load_governed_adm2, parse_countries, select_same_ids


class WesternPrecisionSourceTests(unittest.TestCase):
    def test_default_and_explicit_country_selection(self):
        self.assertEqual(parse_countries(None), {"GB", "IT", "AT", "EE", "LV", "LT", "ES", "PT", "LU"})
        self.assertEqual(parse_countries(["CH", "HU", "MD"]), {"CH", "HU", "MD"})
        self.assertEqual(parse_countries(["CZ", "SK"]), {"CZ", "SK"})
        for countries in ([], ["CH", "CH"], ["GR"], ["unknown"]):
            with self.subTest(countries=countries), self.assertRaises(ValueError):
                parse_countries(countries)

    def test_governed_adm2_sources_have_exact_country_ids(self):
        runtime = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            data = root / "data"
            data.mkdir()
            ledger = []
            for code, iso3 in (("CZ", "CZE"), ("SK", "SVK")):
                frame = gpd.GeoDataFrame([
                    {"shapeID": "A", "shapeGroup": iso3, "shapeType": "ADM2", "geometry": box(0, 0, 1, 1)},
                    {"shapeID": "B", "shapeGroup": iso3, "shapeType": "ADM2", "geometry": box(1, 0, 2, 1)},
                ], crs=4326)
                path = data / f"geoBoundaries-{iso3}-ADM2.geojson"
                path.write_text(frame.to_json(), encoding="utf-8")
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                url = f"https://example.test/{iso3}/ADM2.geojson"
                sidecar = path.with_suffix(".provenance.json")
                sidecar.write_text(json.dumps({"filename": path.name,
                    "configured_source_url": url, "content_length": path.stat().st_size,
                    "sha256": digest}), encoding="utf-8")
                ledger.append({"source_id": f"gb_{iso3.lower()}_adm2",
                    "local_path": path.relative_to(root).as_posix(),
                    "provenance_sidecar": sidecar.relative_to(root).as_posix(),
                    "upstream_url": url, "current_local_sha256": digest})
            (data / "source_ledger.json").write_text(json.dumps(ledger), encoding="utf-8")
            with patch("tools.prepare_tno_western_precision_sources.ROOT", root):
                for code, iso3 in (("CZ", "CZE"), ("SK", "SVK")):
                    with self.subTest(code=code):
                        source, path, url = load_governed_adm2(code)
                        expected = [{"id": f"{code}_ADM2_{suffix}", "cntr_code": code}
                                    for suffix in ("A", "B")]
                        selected, excluded = select_same_ids(source, expected, {code})
                        self.assertEqual(set(selected.id), {row["id"] for row in expected})
                        self.assertTrue(selected.cntr_code.eq(code).all())
                        self.assertEqual(excluded, [])
                        self.assertEqual(url, f"https://example.test/{iso3}/ADM2.geojson")
                        path.write_bytes(path.read_bytes() + b"\n")
                        with self.assertRaisesRegex(ValueError, "does not match provenance and ledger"):
                            load_governed_adm2(code)

    def fixture(self):
        return gpd.GeoDataFrame([
            {"id": "UKA", "cntr_code": "GB", "geometry": box(0, 0, 1, 1)},
            {"id": "UKB", "cntr_code": "GB", "geometry": box(1, 0, 2, 1)},
        ], crs=4326)

    def test_historical_membership_filters_source_without_changing_geometry(self):
        source = self.fixture()
        result, excluded = select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}], {"GB"})
        self.assertEqual(list(result.id), ["UKA"])
        self.assertEqual(excluded, ["UKB"])
        self.assertTrue(result.geometry.iloc[0].equals_exact(source.geometry.iloc[0], 0))

    def test_missing_ids_duplicate_source_and_changed_country_fail(self):
        source = self.fixture()
        for baseline in [[{"id": "UNKNOWN", "cntr_code": "GB"}], [{"id": "UKA", "cntr_code": "IT"}]]:
            with self.assertRaises(ValueError):
                select_same_ids(source, baseline, {baseline[0]["cntr_code"]})
        source.loc[1, "id"] = "UKA"
        with self.assertRaises(ValueError):
            select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}], {"GB"})

    def test_duplicate_baseline_ids_and_source_country_drift_fail(self):
        source = self.fixture()
        with self.assertRaisesRegex(ValueError, "Baseline IDs must be unique"):
            select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}] * 2, {"GB"})
        source.loc[0, "cntr_code"] = "IT"
        with self.assertRaisesRegex(ValueError, "country membership changed"):
            select_same_ids(source, [{"id": "UKA", "cntr_code": "GB"}], {"GB"})

    def test_overlapping_source_is_not_silently_repaired(self):
        source = self.fixture()
        source.loc[1, "geometry"] = box(.5, 0, 2, 1)
        with self.assertRaises(ValueError):
            select_same_ids(source, source[["id", "cntr_code"]].to_dict("records"), {"GB"})


if __name__ == "__main__":
    unittest.main()
