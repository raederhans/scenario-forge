import json
from pathlib import Path
import unittest

from shapely.geometry import shape
from shapely.ops import unary_union

from tools.build_tno_atlantropa_urban import (
    DEFAULT_ATLANTROPA,
    DEFAULT_OLD_LAND,
    DEFAULT_OUTPUT,
    DEFAULT_URBAN,
    build_overlays,
    load_inputs,
    polygon_parts,
    serialize,
)

# Rounded output may move a vertex by ~6 m; allow that, nothing more.
EDGE_TOLERANCE_DEG = 2e-4


class TnoAtlantropaUrbanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.collection, cls.report = build_overlays()
        # The checked-in asset is built on one machine; GEOS/PROJ float
        # differences elsewhere can change individual placements, so it is
        # checked for the same properties rather than byte equality.
        cls.checked_in = json.loads(Path(DEFAULT_OUTPUT).read_text(encoding="utf-8"))
        cls.collections = {"built": cls.collection, "checked_in": cls.checked_in}
        cls.layers, cls.old_land, _, _ = load_inputs(DEFAULT_ATLANTROPA, DEFAULT_OLD_LAND, DEFAULT_URBAN)
        cls.hosts = {feature_id: geometry for feature_id, _, geometry in cls.layers["land"]}

    def test_build_is_deterministic(self):
        rebuilt, _ = build_overlays()
        self.assertEqual(serialize(rebuilt), serialize(self.collection))

    def test_features_have_unique_ids_and_existing_atlantropa_owners(self):
        for name, collection in self.collections.items():
            with self.subTest(collection=name):
                self._check_ids_and_owners(collection["features"])

    def _check_ids_and_owners(self, features):
        self.assertGreater(len(features), 50)
        ids = [feature["properties"]["id"] for feature in features]
        self.assertEqual(len(ids), len(set(ids)))
        for feature in features:
            props = feature["properties"]
            self.assertTrue(props["id"].startswith("UA_ATL_"))
            self.assertIn(props["country_owner_id"], self.hosts)
            self.assertEqual(props["country_owner_code"], "ATL")
            self.assertEqual(props["featurecla"], "Urban area")
            self.assertGreater(props["area_sqkm"], 0)

    def test_geometry_stays_on_new_land_of_its_host(self):
        blocked = unary_union([geometry for _, _, geometry in self.layers["shoal"] + self.layers["water"]])
        for name, collection in self.collections.items():
            with self.subTest(collection=name):
                self._check_geometry(collection["features"], blocked)

    def _check_geometry(self, features, blocked):
        for feature in features:
            geometry = shape(feature["geometry"])
            self.assertTrue(geometry.is_valid, feature["properties"]["id"])
            for part in polygon_parts(geometry):
                self.assertFalse(part.exterior.is_ccw)
            host = self.hosts[feature["properties"]["country_owner_id"]]
            self.assertTrue(host.buffer(EDGE_TOLERANCE_DEG).contains(geometry), feature["properties"]["id"])
            self.assertLess(geometry.intersection(self.old_land).area, geometry.area * 0.01)
            self.assertLess(geometry.intersection(blocked).area, geometry.area * 0.01)

    def test_coverage_stays_sparse(self):
        self.assertGreaterEqual(self.report["coverage"], 0.01)
        self.assertLessEqual(self.report["coverage"], 0.03)
        checked_in_km2 = sum(feature["properties"]["area_sqkm"] for feature in self.checked_in["features"])
        self.assertAlmostEqual(checked_in_km2, self.report["urban_km2"], delta=self.report["urban_km2"] * 0.1)


if __name__ == "__main__":
    unittest.main()
