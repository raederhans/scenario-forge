import json
import unittest
from math import sin
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union
from tools.build_political_display_lods import simplify_coverage_features


def fixture():
    edge = [(1 + (0.001 * sin(i) if 0 < i < 40 else 0), i / 40) for i in range(41)]
    a = Polygon([(0, 0), *edge, (0, 1), (0, 0)])
    b = Polygon([(2, 0), (2, 1), *edge[::-1], (2, 0)], holes=[[(1.3, .2), (1.5, .2), (1.5, .4), (1.3, .4), (1.3, .2)]])
    return [{"type": "Feature", "properties": {"id": fid, "owner": "X"}, "geometry": mapping(g)} for fid, g in [("a", a), ("b", b)]]


class DisplayLodTests(unittest.TestCase):
    def test_shared_interiors_preserve_union_holes_identity_and_source(self):
        features = fixture()
        original = json.dumps(features)
        result, report = simplify_coverage_features(features, .02)
        self.assertEqual(report["status"], "simplified")
        self.assertLess(report["output_points"], report["input_points"])
        self.assertEqual(json.dumps(features), original)
        self.assertTrue(unary_union([shape(f["geometry"]) for f in result]).equals(unary_union([shape(f["geometry"]) for f in features])))
        self.assertEqual([f["properties"] for f in features], [f["properties"] for f in result])
        self.assertEqual(len(shape(result[1]["geometry"]).interiors), 1)
        self.assertLessEqual(report["max_deviation_degrees"], .02)

    def test_protected_feature_and_its_neighbours_shared_border_are_exact(self):
        features = fixture()
        result, report = simplify_coverage_features(features, .02, ["a"])
        self.assertEqual(result, features)
        self.assertEqual(report["status"], "unchanged")
        self.assertEqual([item["retention_reason"] for item in report["feature_diagnostics"]],
                         ["protected", "no-point-reduction"])

    def test_overlapping_invalid_coverage_falls_back_without_repair(self):
        features = fixture()
        features[1]["geometry"] = features[0]["geometry"]
        result, report = simplify_coverage_features(features, .02)
        self.assertIs(result, features)
        self.assertEqual(report["reason"], "invalid-source-coverage")


if __name__ == "__main__": unittest.main()
