from copy import deepcopy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
import shapely
from shapely.geometry import Polygon, box, mapping
import topojson

from map_builder.regional_geometry import (
    _absolute_topology, _decode_geometry, replace_regional_geometry,
)
from tools.build_regional_topology import _run_processors, main


class RegionalGeometryTests(unittest.TestCase):
    def fixture(self):
        features = [{"type": "Feature", "id": f"feature-{index}",
                     "properties": {"id": feature_id, "cntr_code": country, "owner": "KEEP", "detail": {"x": 1}},
                     "geometry": mapping(geometry)}
                    for index, (feature_id, country, geometry) in enumerate([
                        ("A", "AA", box(0, 0, 1, 1)),
                        ("B", "BB", box(1, 0, 2, 1)),
                        ("C", "CC", box(3, 0, 4, 1)),
                    ])]
        topology = topojson.Topology({"type": "FeatureCollection", "features": features},
                                    object_name="political", prequantize=100001).to_dict()
        topology["objects"]["political"]["computed_neighbors"] = [[99], [99], [99]]
        topology["objects"]["extras"] = {"type": "GeometryCollection", "geometries": [
            {"type": "Point", "coordinates": [50, 50], "properties": {"keep": True}},
            {"type": "MultiPoint", "coordinates": [[25, 50], [75, 50]]},
            {"type": "LineString", "arcs": [~0]},
        ]}
        topology["arcs"].append([[4, 7], [8, 10]])
        replacements = gpd.GeoDataFrame([{"id": "A", "owner": "IGNORE", "geometry": box(0, 0, 0.8, 1)}], crs=4326)
        return topology, replacements

    def test_same_ids_unrelated_objects_metadata_and_fresh_neighbors(self):
        baseline, replacements = self.fixture()
        original = deepcopy(baseline)
        before = _absolute_topology(baseline)
        result, diagnostics = replace_regional_geometry(baseline, replacements, source_countries=["AA"])
        self.assertEqual(baseline, original)
        self.assertNotIn("transform", result)
        old_features = before["objects"]["political"]["geometries"]
        features = result["objects"]["political"]["geometries"]
        self.assertEqual([g["properties"]["id"] for g in features], ["A", "B", "C"])
        for old, new in zip(old_features, features):
            self.assertEqual(old["properties"], new["properties"])
            self.assertEqual(old["id"], new["id"])
        for index in [1, 2]:
            self.assertTrue(_decode_geometry(before, old_features[index]).equals_exact(_decode_geometry(result, features[index]), 0))
        for old, new in zip(before["objects"]["extras"]["geometries"], result["objects"]["extras"]["geometries"]):
            self.assertTrue(_decode_geometry(before, old).equals_exact(_decode_geometry(result, new), 0))
        self.assertEqual(result["objects"]["political"]["computed_neighbors"], [[], [], []])
        self.assertEqual(diagnostics["changed_ids"], ["A"])
        self.assertFalse(diagnostics["adjacent_country_seams_verified"])
        self.assertTrue(diagnostics["derived_assets_require_rebuild"])
        used = set()

        def visit(value, in_arcs=False):
            if isinstance(value, dict):
                for key, item in value.items():
                    visit(item, key == "arcs")
            elif isinstance(value, list):
                for item in value:
                    visit(item, in_arcs)
            elif in_arcs:
                used.add(value if value >= 0 else ~value)

        visit(result["objects"])
        self.assertEqual(used, set(range(len(result["arcs"]))))

    def test_holes_winding_and_new_neighbor_graph(self):
        baseline, replacements = self.fixture()
        replacements.loc[0, "geometry"] = Polygon(box(0, 0, 1, 1).exterior.coords,
                                                  [box(0.2, 0.2, 0.4, 0.4).exterior.coords])
        result, _ = replace_regional_geometry(baseline, replacements)
        actual = _decode_geometry(result, result["objects"]["political"]["geometries"][0])
        self.assertEqual(len(actual.interiors), 1)
        self.assertFalse(actual.exterior.is_ccw)
        self.assertTrue(actual.interiors[0].is_ccw)
        self.assertEqual(result["objects"]["political"]["computed_neighbors"], [[1], [0], []])

    def test_shared_replacement_arcs_and_repeated_assembly(self):
        baseline, _ = self.fixture()
        replacements = gpd.GeoDataFrame([
            {"id": "B", "geometry": box(0.8, 0, 2, 1)},
            {"id": "A", "geometry": box(0, 0, 0.8, 1)},
        ], crs=4326)
        result, _ = replace_regional_geometry(baseline, replacements)
        geometries = result["objects"]["political"]["geometries"]
        self.assertEqual([g["properties"]["id"] for g in geometries], ["A", "B", "C"])
        arcs_a = {ref if ref >= 0 else ~ref for ring in geometries[0]["arcs"] for ref in ring}
        arcs_b = {ref if ref >= 0 else ~ref for ring in geometries[1]["arcs"] for ref in ring}
        self.assertTrue(arcs_a & arcs_b)
        repeated, diagnostics = replace_regional_geometry(result, replacements)
        self.assertEqual(len(result["arcs"]), len(repeated["arcs"]))
        self.assertEqual(diagnostics["changed_ids"], [])
        self.assertEqual(result["objects"]["political"]["computed_neighbors"], [[1], [0], []])

    def test_nearly_collinear_shared_vertex_is_preserved_without_overlay(self):
        baseline, _ = self.fixture()
        # Reduced from the constrained French pilot. Re-noding through the
        # previous TopoJSON encoder removed this vertex from one side, changing
        # its geometry by 4.235e-22 deg2 despite quantization being disabled.
        a = (4.09983, 45.81185)
        b = (4.106134041086637, 45.81387061470615)
        c = (4.10894, 45.81477)
        polygons = [Polygon([a, b, c, (4.11296, 45.81984), (4.09, 45.82)]),
                    Polygon([c, b, a, (4.09, 45.80), (4.12, 45.80)])]
        replacements = gpd.GeoDataFrame([{'id': fid, 'geometry': geometry}
                                        for fid, geometry in zip(['A','B'], polygons)], crs=4326)
        self.assertTrue(shapely.coverage_is_valid(polygons))
        result, _ = replace_regional_geometry(baseline, replacements)
        actual = [_decode_geometry(result, item) for item in result['objects']['political']['geometries'][:2]]
        self.assertTrue(shapely.coverage_is_valid(actual))
        for source, decoded in zip(polygons, actual):
            self.assertTrue(source.equals(decoded))
            self.assertTrue(source.equals_exact(decoded, 0, normalize=True))
            self.assertEqual(shapely.get_num_coordinates(source), shapely.get_num_coordinates(decoded))

    def test_closed_shared_ring_canonical_rotation_deduplicates_arcs(self):
        baseline, _ = self.fixture()
        hole = [(0.2,0.2), (0.8,0.2), (0.8,0.8), (0.2,0.8), (0.2,0.2)]
        outer = Polygon(box(0,0,1,1).exterior.coords, [hole])
        inner = Polygon(hole[2:-1]+hole[:3])
        replacements = gpd.GeoDataFrame([{'id':'A','geometry':outer}, {'id':'B','geometry':inner}], crs=4326)
        result, _ = replace_regional_geometry(baseline, replacements)
        first, second = result['objects']['political']['geometries'][:2]
        outer_hole = first['arcs'][1]
        inner_shell = second['arcs'][0]
        self.assertEqual(len(outer_hole), 1)
        self.assertEqual(inner_shell, [~outer_hole[0]])

    def test_rejects_bad_selection(self):
        baseline, replacements = self.fixture()
        with self.assertRaisesRegex(ValueError, "outside"):
            replace_regional_geometry(baseline, replacements, source_countries=["BB"])
        with self.assertRaisesRegex(ValueError, "nonempty"):
            replace_regional_geometry(baseline, replacements.iloc[:0])
        replacements.loc[0, "id"] = "MISSING"
        with self.assertRaisesRegex(ValueError, "missing"):
            replace_regional_geometry(baseline, replacements)
        replacements.loc[0, "id"] = "A"
        duplicate = gpd.GeoDataFrame([replacements.iloc[0], replacements.iloc[0]], crs=4326)
        with self.assertRaisesRegex(ValueError, "unique"):
            replace_regional_geometry(baseline, duplicate)

    def test_rejects_invalid_empty_or_overlapping_replacement_geometry(self):
        baseline, replacements = self.fixture()
        for geometry in [None, Polygon(), Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])]:
            replacements.loc[0, "geometry"] = geometry
            with self.assertRaisesRegex(ValueError, "coverage"):
                replace_regional_geometry(baseline, replacements)
        overlapping = gpd.GeoDataFrame([
            {"id": "A", "geometry": box(0, 0, 1.2, 1)},
            {"id": "B", "geometry": box(1, 0, 2, 1)},
        ], crs=4326)
        with self.assertRaisesRegex(ValueError, "coverage"):
            replace_regional_geometry(baseline, overlapping)

    def test_cli_writes_candidate_atomically_and_rejects_input_overwrite(self):
        baseline, replacements = self.fixture()
        runtime = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            folder = Path(directory)
            baseline_path = folder / "baseline.json"
            replacement_path = folder / "replacement.geojson"
            output_path = folder / "candidate.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            replacement_path.write_text(replacements.to_json(), encoding="utf-8")
            before = baseline_path.read_bytes()
            arguments = ["--baseline-topology", str(baseline_path), "--replacement-geojson", str(replacement_path)]
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(main([*arguments, "--output-topology", str(output_path), "--source-countries", "AA"]), 0)
            self.assertEqual(json.loads(output.getvalue())["changed_ids"], ["A"])
            self.assertEqual(json.loads(output_path.read_text())["objects"]["political"]["computed_neighbors"], [[], [], []])
            self.assertEqual(baseline_path.read_bytes(), before)
            self.assertFalse(list(folder.glob("*.tmp")))
            with self.assertRaises(SystemExit):
                main([*arguments, "--output-topology", str(baseline_path)])
            self.assertEqual(baseline_path.read_bytes(), before)

    def test_preflight_identifies_unreadable_and_invalid_baseline_ids(self):
        baseline, replacements = self.fixture()
        baseline = _absolute_topology(baseline)
        features = baseline["objects"]["political"]["geometries"]
        offset = len(baseline["arcs"])
        baseline["arcs"].extend([
            [[0, 0], [0, 0]],
            [[1, 0], [2, 1], [2, 0], [1, 1], [1, 0]],
        ])
        features[1]["arcs"] = [[offset]]
        features[2]["arcs"] = [[offset + 1]]
        with self.assertRaises(ValueError) as caught:
            replace_regional_geometry(baseline, replacements)
        self.assertIn('"id": "B"', str(caught.exception))
        self.assertIn('"invalid_feature_ids": ["C"]', str(caught.exception))
        self.assertIn('"candidate_generated": false', str(caught.exception))

    def test_processor_mode_expands_coupled_countries_and_preserves_other_country(self):
        baseline, _ = self.fixture()
        units = [{"name": "coupled", "countries": ["AA", "BB"]}]

        def processor(frame, countries):
            self.assertEqual(countries, ["AA", "BB"])
            self.assertEqual(set(frame["id"]), {"A", "B", "C"})
            frame.loc[frame["id"] == "A", "geometry"] = box(0, 0, 0.8, 1)
            frame.loc[frame["id"] == "B", "geometry"] = box(0.8, 0, 2, 1)
            # Even an accidental unrelated processor edit must not be assembled.
            frame.loc[frame["id"] == "C", "geometry"] = box(30, 0, 40, 1)
            return frame.iloc[::-1]

        with patch("map_builder.regional_processors.resolve_processor_units", return_value=units) as resolve:
            with patch("map_builder.regional_processors.apply_selected_processors", side_effect=processor):
                replacements, countries, diagnostics = _run_processors(baseline, ["AA"])
        resolve.assert_called_once_with(["AA"])
        self.assertEqual(set(replacements["id"]), {"A", "B"})
        self.assertEqual(diagnostics["expanded_source_countries"], ["AA", "BB"])
        result, _ = replace_regional_geometry(baseline, replacements, source_countries=countries)
        old = _absolute_topology(baseline)
        self.assertTrue(_decode_geometry(old, old["objects"]["political"]["geometries"][2]).equals_exact(
            _decode_geometry(result, result["objects"]["political"]["geometries"][2]), 0))

    def test_processor_mode_rejects_added_removed_and_duplicate_ids(self):
        baseline, _ = self.fixture()
        units = [{"name": "coupled", "countries": ["AA", "BB"]}]

        def mutate(frame, mode):
            if mode == "remove":
                return frame[frame["id"] != "A"]
            if mode == "add":
                extra = frame.iloc[0].copy()
                extra["id"] = "NEW"
                return gpd.GeoDataFrame([*frame.to_dict("records"), extra.to_dict()], crs=frame.crs)
            frame.loc[frame["id"] == "A", "id"] = "B"
            return frame

        for mode in ["remove", "add", "duplicate"]:
            with self.subTest(mode=mode), patch("map_builder.regional_processors.resolve_processor_units", return_value=units):
                with patch("map_builder.regional_processors.apply_selected_processors", side_effect=lambda frame, countries: mutate(frame, mode)):
                    with self.assertRaisesRegex(ValueError, "same-ID"):
                        _run_processors(baseline, ["AA"])

    def test_processor_cli_requires_countries_and_rejects_scenario_baseline(self):
        baseline, _ = self.fixture()
        runtime = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            folder = Path(directory)
            baseline_path = folder / "master.json"
            output_path = folder / "candidate.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            arguments = ["--baseline-topology", str(baseline_path), "--output-topology", str(output_path), "--run-processors"]
            with self.assertRaises(SystemExit):
                main(arguments)
            units = [{"name": "coupled", "countries": ["AA", "BB"]}]
            with patch("map_builder.regional_processors.resolve_processor_units", return_value=units):
                with patch("map_builder.regional_processors.apply_selected_processors", side_effect=lambda frame, countries: frame):
                    output = io.StringIO()
                    with redirect_stdout(output):
                        self.assertEqual(main([*arguments, "--source-countries", "AA"]), 0)
            self.assertEqual(json.loads(output.getvalue())["expanded_source_countries"], ["AA", "BB"])
            self.assertTrue(output_path.exists())
            output_path.unlink()
            baseline["objects"]["scenario_water"] = {"type": "GeometryCollection", "geometries": []}
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            with self.assertRaises(SystemExit):
                main([*arguments, "--source-countries", "AA"])
            self.assertFalse(output_path.exists())


if __name__ == "__main__":
    unittest.main()
