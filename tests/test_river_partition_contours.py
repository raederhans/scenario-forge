import unittest

from tools.river_partitions.prepare_contour_inputs import interactive_features, seam_expectations


def rectangle(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]]}


class ContourInputsTest(unittest.TestCase):
    def setUp(self):
        self.source = [{"id": "P", "geometry": rectangle(0, 0, 2, 2)}]
        self.pack = {"parents": [{"parentId": "P", "parentGeometry": self.source[0]["geometry"], "cells": [
            {"id": "a", "geometry": rectangle(0, 0, 2, 1)}, {"id": "b", "geometry": rectangle(0, 1, 2, 2)}]}]}

    def test_shapely_oracle_includes_holes_and_all_fragment_boundaries(self):
        self.assertEqual(seam_expectations(self.pack, self.source), {"P": 2})
        # A square frame with a central hole; split both side strips at y=2.
        hole = rectangle(1, 1, 3, 3)["coordinates"][0]
        geometry = rectangle(0, 0, 4, 4)
        geometry["coordinates"].append(hole)
        pieces = [rectangle(0, 0, 4, 1), rectangle(0, 3, 4, 4),
                  rectangle(0, 1, 1, 2), rectangle(0, 2, 1, 3),
                  rectangle(3, 1, 4, 2), rectangle(3, 2, 4, 3)]
        self.source[0]["geometry"] = geometry
        self.pack["parents"][0].update(parentGeometry=geometry, cells=[{"geometry": p} for p in pieces])
        self.assertEqual(seam_expectations(self.pack, self.source), {"P": 6})

    def test_reject_changed_source_and_gap_or_overlap(self):
        for changed in [rectangle(0, 1.1, 2, 2), rectangle(0, 0.9, 2, 2)]:
            self.pack["parents"][0]["cells"][1]["geometry"] = changed
            with self.assertRaisesRegex(ValueError, "coverage/overlap changed: P"):
                seam_expectations(self.pack, self.source)
        self.pack["parents"][0]["parentGeometry"] = rectangle(0, 0, 2, 3)
        with self.assertRaisesRegex(ValueError, "Source parent geometry changed: P"):
            seam_expectations(self.pack, self.source)

    def test_full_interactive_filter_and_duplicate_guard(self):
        doc = {"type": "FeatureCollection", "features": [*self.source,
            {"id": "base", "properties": {"render_as_base_geography": True}},
            {"id": "hidden", "properties": {"interactive": False}}, {"id": "P_FB_1"}]}
        features, count = interactive_features(doc)
        self.assertEqual(count, 4)
        self.assertEqual([f["id"] for f in features], ["P"])
        doc["features"].append(self.source[0])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            interactive_features(doc)


if __name__ == "__main__":
    unittest.main()
