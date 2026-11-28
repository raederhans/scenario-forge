from copy import deepcopy
import unittest

import geopandas as gpd
from shapely.geometry import Polygon, box, mapping
import topojson

from map_builder.regional_geometry import (
    _absolute_topology, _decode_geometry, replace_regional_geometry,
)


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


if __name__ == "__main__":
    unittest.main()
