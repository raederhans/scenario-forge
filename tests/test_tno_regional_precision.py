from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

import geopandas as gpd
import shapely
from shapely.geometry import box, mapping
import topojson

from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.pilot_tno_regional_precision import _assemble_candidate, prepare_candidate


class TnoRegionalPrecisionTests(unittest.TestCase):
    def fixture(self):
        water = box(2.5, 0.6, 2.7, 0.8)
        atlantropa = box(1.3, 0.6, 1.5, 0.8)
        records = [
            ("FR_KEEP", "FR", box(-1, 0, 0, 1)),
            ("DE_A", "DE", box(0, 0, 1, 1)),
            ("BE_A", "BE", box(1, 0, 2, 1).difference(atlantropa)),
            ("NL_A", "NL", box(2, 0, 3, 1).difference(water)),
            ("FR_OTHER", "FR", box(-2, 0, -1, 1)),
        ]
        features = [{"type": "Feature", "id": f"stable-{fid}",
                     "properties": {"id": fid, "cntr_code": code, "owner": "GER", "name": fid},
                     "geometry": mapping(geometry)} for fid, code, geometry in records]
        topology = topojson.Topology({"type": "FeatureCollection", "features": features},
                                    object_name="political", prequantize=False).to_dict()
        topology["objects"]["political"]["computed_neighbors"] = [[1, 4], [0, 2], [1, 3], [2], [0]]
        topology["political_precision_source_countries"] = ["JP"]
        for name, geometry in {
            "land_mask": box(-2, 0, 3, 1), "scenario_water": water,
            "scenario_atlantropa": atlantropa, "context_land_mask": box(-3, -1, 4, 2),
            "scenario_special_land": box(10, 10, 11, 11),
        }.items():
            index = len(topology["arcs"])
            topology["arcs"].append(list(map(list, geometry.exterior.coords)))
            topology["objects"][name] = {"type": "Polygon", "arcs": [[index]], "properties": {"name": name}}
        topology["objects"]["scenario_coastline"] = {"type": "LineString", "arcs": [0]}
        replacements = gpd.GeoDataFrame([
            {"id": "NL_A", "cntr_code": "NL", "owner": "IGNORE", "geometry": box(2.1, 0, 3.2, 1)},
            {"id": "DE_A", "cntr_code": "DE", "owner": "IGNORE", "geometry": box(-0.2, 0, 0.9, 1)},
            {"id": "BE_A", "cntr_code": "BE", "owner": "IGNORE", "geometry": box(0.9, 0, 2.1, 1)},
        ], crs=4326)
        return topology, replacements

    def test_joint_sources_preserve_foreign_metadata_surfaces_and_neighbors(self):
        baseline, replacements = self.fixture()
        original = deepcopy(baseline)
        candidate, report = _assemble_candidate(baseline, replacements, ["DE", "BE", "NL"])
        self.assertEqual(baseline, original)
        old = _absolute_topology(baseline)
        old_rows = old["objects"]["political"]["geometries"]
        new_rows = candidate["objects"]["political"]["geometries"]
        self.assertEqual([r["properties"] for r in old_rows], [r["properties"] for r in new_rows])
        self.assertEqual([r["id"] for r in old_rows], [r["id"] for r in new_rows])
        for index in [0, 4]:
            self.assertTrue(_decode_geometry(old, old_rows[index]).equals_exact(
                _decode_geometry(candidate, new_rows[index]), 0))
        geometries = [_decode_geometry(candidate, row) for row in new_rows[1:4]]
        self.assertTrue(shapely.coverage_is_valid(geometries))
        union = shapely.union_all(geometries)
        self.assertTrue(union.equals(shapely.union_all([
            _decode_geometry(old, row) for row in old_rows[1:4]])))
        for name in ["scenario_water", "scenario_atlantropa"]:
            self.assertEqual(union.intersection(_decode_geometry(old, old["objects"][name])).area, 0)
        self.assertEqual(union.difference(_decode_geometry(old, old["objects"]["land_mask"])).area, 0)
        self.assertEqual(candidate["political_precision_source_countries"], ["BE", "DE", "JP", "NL"])
        self.assertEqual(report["political_precision_source_countries"], ["BE", "DE", "JP", "NL"])
        self.assertEqual(len(report["protected_objects_unchanged"]), 6)
        self.assertTrue(report["untouched_adjacency_exact"])
        self.assertEqual(report["source_feature_counts"], {"DE": 1, "BE": 1, "NL": 1})
        self.assertFalse(report["release_ready"])
        # New internal boundaries survive; no country-by-country stitching.
        self.assertEqual(geometries[0].bounds[2], 0.9)
        self.assertEqual(geometries[1].bounds[2], 2.1)

    def test_rejects_id_and_country_changes_and_invalid_joint_coverage(self):
        baseline, replacements = self.fixture()
        variants = [replacements.iloc[:2].copy(), replacements.copy(), replacements.copy(), replacements.copy()]
        variants[1].loc[0, "id"] = "ADDED"
        variants[2].loc[0, "cntr_code"] = "DE"
        variants[3].loc[0, "geometry"] = box(1.9, 0, 3.2, 1)
        for variant in variants:
            with self.subTest(ids=list(variant["id"])):
                with self.assertRaises(ValueError):
                    _assemble_candidate(baseline, variant, ["DE", "BE", "NL"])

    def test_explicit_targets_declare_precision_ids_without_expanding_country_scope(self):
        baseline, replacements = self.fixture()
        baseline['political_precision_feature_ids'] = ['FR_KEEP']
        candidate, report = _assemble_candidate(baseline, replacements, ['CN'],
            target_feature_ids=['DE_A', 'BE_A', 'NL_A'])
        self.assertEqual(candidate['political_precision_source_countries'], ['JP'])
        self.assertEqual(candidate['political_precision_feature_ids'], ['BE_A', 'DE_A', 'FR_KEEP', 'NL_A'])
        self.assertEqual(report['political_precision_feature_ids'], candidate['political_precision_feature_ids'])
        self.assertNotIn('FR_OTHER', candidate['political_precision_feature_ids'])

    def test_file_candidate_and_no_overwrite_guards(self):
        baseline, replacements = self.fixture()
        runtime = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            scenario = root / "baseline"
            scenario.mkdir()
            (scenario / "manifest.json").write_text(json.dumps({"scenario_id": "tno_1962"}), encoding="utf-8")
            baseline_path = scenario / "runtime_topology.topo.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            baseline_bytes = baseline_path.read_bytes()
            source = root / "replacement.geojson"
            source.write_text(replacements.to_json(), encoding="utf-8")
            output = root / "candidate.topo.json"
            report = prepare_candidate(scenario, source, output, source_countries=["DE", "BE", "NL"])
            self.assertTrue(output.exists())
            self.assertTrue(output.with_suffix(".report.json").exists())
            self.assertEqual(baseline_path.read_bytes(), baseline_bytes)
            self.assertEqual(report["source_countries"], ["BE", "DE", "NL"])
            for forbidden in [output, source, baseline_path, scenario / "new.json"]:
                with self.subTest(path=str(forbidden)):
                    with self.assertRaises(ValueError):
                        prepare_candidate(scenario, source, forbidden, source_countries=["DE", "BE", "NL"])


if __name__ == "__main__":
    unittest.main()
