from copy import deepcopy
import unittest

from shapely.geometry import MultiPolygon, box, mapping, shape

from tools.atlantropa_geometry_quality import (
    exclude_land_from_sea,
    normalize_land_features,
    remove_processing_encroachments,
)


def feature(feature_id, geometry, owner="ATL"):
    return {"type": "Feature", "properties": {"id": feature_id, "owner_tag": owner, "atl_render_layer": "land"},
            "geometry": mapping(geometry) if geometry is not None else None}


class AtlantropaGeometryQualityTests(unittest.TestCase):
    def test_processing_encroachment_preserves_shared_source_and_islands(self):
        sources = {"FRA": box(0, 0, 2, 2), "ITA": box(1, 0, 3, 2)}
        island = box(9, 9, 9.00001, 9.00001)
        inputs = [feature("ATLPRV_1", MultiPolygon([box(0, 0, 3, 2), island]), "FRA")]
        snapshot = deepcopy(inputs)
        result, diagnostics = remove_processing_encroachments(inputs, sources)
        geometry = shape(result[0]["geometry"])
        self.assertEqual(inputs, snapshot)
        self.assertTrue(geometry.covers(island))
        self.assertTrue(geometry.covers(box(1, 0, 2, 2)))  # genuine shared source stays
        self.assertEqual(geometry.intersection(box(2, 0, 3, 2)).area, 0)
        self.assertEqual(diagnostics["processing_encroachments"][0]["removed_area"], 2)
        self.assertEqual(remove_processing_encroachments(result, sources)[0], result)
        self.assertEqual(remove_processing_encroachments(inputs, dict(reversed(list(sources.items()))))[0], result)

    def test_processing_encroachment_requires_own_source(self):
        inputs = [feature("ATLPRV_1", box(0, 0, 2, 2), "FRA")]
        result, diagnostics = remove_processing_encroachments(inputs, {"ITA": box(0, 0, 3, 3)})
        self.assertEqual(result, inputs)
        self.assertEqual(diagnostics["missing_source_features"][0]["feature_id"], "ATLPRV_1")
        result, diagnostics = remove_processing_encroachments(inputs, {"FRA": box(0, 0, 1, 1)})
        self.assertEqual(result, inputs)  # no other owner's exclusive source

    def test_sea_exclusion_preserves_land_join_and_water_elsewhere(self):
        land = [feature("LAND", box(0, 0, 2, 1))]
        sea = [feature("SEA", box(1, -1, 3, 2))]
        snapshot = deepcopy(land)
        result, diagnostics = exclude_land_from_sea(sea, land)
        repaired = shape(result[0]["geometry"])
        self.assertEqual(land, snapshot)
        self.assertEqual(repaired.intersection(shape(land[0]["geometry"])).area, 0)
        self.assertTrue(repaired.equals(box(1, -1, 3, 2).difference(box(0, 0, 2, 1))))
        self.assertEqual(diagnostics["land_sea_overlaps"][0]["area"], 1)
        self.assertEqual(exclude_land_from_sea(result, land)[0], result)
        self.assertEqual(result[0]["properties"], sea[0]["properties"])

    def test_roundoff_tolerance_does_not_filter_tiny_islands(self):
        island = box(20, 20, 20.00000001, 20.00000001)
        inputs = [feature("A", MultiPolygon([box(0, 0, 1, 1), island]))]
        self.assertEqual(normalize_land_features(inputs)[0], inputs)
        touching = [feature("B", box(1 - 1e-15, 0, 2, 1), "ITA")]
        self.assertEqual(normalize_land_features(inputs + touching)[0], inputs + touching)


if __name__ == "__main__":
    unittest.main()
