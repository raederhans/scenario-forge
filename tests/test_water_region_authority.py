import unittest

import geopandas as gpd
from shapely.geometry import box, mapping, shape

from map_builder.geo.water_region_authority import compile_named_water_regions, restore_marine_source


def feature(feature_id, geometry, water_type="sea", **properties):
    return {"type": "Feature", "properties": {"id": feature_id, "water_type": water_type, **properties},
            "geometry": mapping(geometry)}


def collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


class WaterAuthorityTests(unittest.TestCase):
    def test_recovers_both_translated_ocean_halves_and_preserves_editing_identity(self):
        old = collection(feature("marine_atlantic_ocean", box(-40, -50, -10, 0), "ocean", label="Atlantic"))
        source = gpd.GeoDataFrame([
            {"name": "North Atlantic", "name_en": "Atlantic Ocean", "geometry": box(-40, 0, -10, 50)},
            {"name": "South Atlantic", "name_en": "Atlantic Ocean", "geometry": box(-40, -50, -10, 0)},
        ], crs="EPSG:4326")
        rebuilt = restore_marine_source(old, source)
        self.assertEqual(rebuilt["features"][0]["properties"], old["features"][0]["properties"])
        self.assertTrue(shape(rebuilt["features"][0]["geometry"]).equals(box(-40, -50, -10, 50)))

    def test_named_sea_has_exclusive_footprint_and_land_is_not_paintable_ocean(self):
        ocean = box(-20, -10, 20, 10)
        sea = box(0, -10, 20, 10)
        land = box(-10, -5, -5, 5)
        source = collection(feature("ocean", ocean, "ocean"), feature("sea", sea),
                            feature("lake", box(-9, -2, -6, 2), "lake"))
        compiled = compile_named_water_regions(source, ocean_mask=ocean, land_mask=land)
        shapes = {f["properties"]["id"]: shape(f["geometry"]) for f in compiled["features"]}
        self.assertEqual(shapes["ocean"].intersection(shapes["sea"]).area, 0)
        self.assertEqual(shapes["ocean"].intersection(land).area, 0)
        self.assertTrue(shapes["ocean"].union(shapes["sea"]).equals(ocean.difference(land)))
        self.assertEqual(shapes["lake"].area, 12)

    def test_explicit_parent_excludes_child_without_assigning_unrelated_priority(self):
        source = collection(feature("sea", box(0, 0, 5, 5)),
                            feature("bay", box(0, 0, 2, 2), parent_id="sea"))
        compiled = compile_named_water_regions(source)
        parent, child = [shape(f["geometry"]) for f in compiled["features"]]
        self.assertEqual(parent.intersection(child).area, 0)
        self.assertTrue(parent.union(child).equals(box(0, 0, 5, 5)))


if __name__ == "__main__":
    unittest.main()
