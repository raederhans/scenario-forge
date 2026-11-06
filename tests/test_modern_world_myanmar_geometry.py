import json
import unittest
from shapely.geometry import Point, shape
from map_builder.regional_geometry import _decode_geometry
from map_builder.scenario_capital_rules import ADDITIONAL_CAPITAL_CITIES
from tests.test_modern_world_regional_geometry import regional_partition, ROOT
from tools.apply_hoi4_geometry_splits import compile_external_parts, split_topology


class MyanmarGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original, cls.rules, cls.result, cls.splits, cls.report, cls.geometries = regional_partition("modern_world.myanmar.geometry_splits.json")

    def test_townships_and_strongpoints(self):
        units = json.loads((ROOT / "data/scenario-rules/modern_world.sources/myanmar/geoBoundaries-MMR-ADM3.geojson").read_text())
        parents = {r["properties"]["id"]: _decode_geometry(self.original,r)
                   for r in self.original["objects"]["political"]["geometries"]}
        for name,parent,suffix in [("Pangsang","MMR-3277","PANGSANG"),
                                   ("Laukkaing","MMR-3277","LAUKKAING"),
                                   ("Matman","MMR-3277","REMAINDER"),
                                   ("Lashio","MMR-3277","REMAINDER"),
                                   ("Paletwa","MMR-3274","PALETWA"),
                                   ("Sittwe","MMR-3273","SITTWE"),
                                   ("Hakha","MMR-3274","HAKHA"),
                                   ("Falam","MMR-3274","FALAM")]:
            unit = next(f for f in units["features"] if f["properties"]["shapeName"] == name)
            point = shape(unit["geometry"]).intersection(parents[parent]).representative_point()
            with self.subTest(township=name):
                self.assertTrue(self.geometries[parent+"__SPLIT_"+suffix].covers(point))
        samples = [(98.74,23.69,"LAUKKAING"),(97.75,22.93,"REMAINDER"),
                   (97.393,25.386,"MYITKYINA")]
        for lon,lat,suffix in samples:
            with self.subTest(lon=lon,lat=lat):
                hits = [fid for fid,g in self.geometries.items() if g.covers(Point(lon,lat))]
                self.assertEqual(len(hits),1)
                self.assertTrue(hits[0].endswith("__SPLIT_"+suffix),hits)

    def test_registered_capitals_are_inside_and_bounded(self):
        for city,host in [("pangkham","MMR-3277__SPLIT_PANGSANG"),
                          ("laiza","MMR-3296__SPLIT_REMAINDER"),
                          ("mrauk_u","MMR-3273__SPLIT_REMAINDER"),
                          ("falam","MMR-3274__SPLIT_FALAM")]:
            row = ADDITIONAL_CAPITAL_CITIES["CITY::scenario::"+city]
            point = Point(row["lon"],row["lat"])
            self.assertTrue(self.geometries[host].contains(point))
            if "source_coordinates" in row:
                self.assertLessEqual(point.distance(Point(row["source_coordinates"])),.02)
                self.assertEqual(row["notes"],"就近吸附到底图")

    def test_replay_and_nonempty_parts(self):
        self.assertTrue(all(g.is_valid and g.area>0 for g in self.geometries.values()))
        plan=compile_external_parts(self.rules,ROOT / "data/scenario-rules",self.result,self.splits)
        self.assertEqual(split_topology(self.result,plan),(self.result,{},[]))
