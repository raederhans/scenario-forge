import unittest

import geopandas as gpd
from shapely.geometry import MultiPolygon, box
import topojson as tp

from tools.build_runtime_political_topology import _compose_political_features


def _political_topology(country, *features):
    rows = [{"id": fid, "name": fid, "cntr_code": country, "geometry": geometry}
            for fid, geometry in features]
    return tp.Topology([gpd.GeoDataFrame(rows, crs="EPSG:4326")], object_name=["political"],
                       topology=True, prequantize=False).to_dict()


class PoliticalTopologyGapContractTests(unittest.TestCase):
    def test_runtime_composition_keeps_norwegian_islands_without_duplicate_mainland(self) -> None:
        mainland = box(5.0, 58.0, 12.0, 71.0)
        covered_island = box(15.0, 68.0, 16.0, 69.0)
        svalbard_west = box(10.0, 77.0, 16.0, 80.0)
        svalbard_east = box(20.0, 78.0, 24.0, 81.0)
        primary = _political_topology("NO", ("NO", MultiPolygon([mainland, covered_island, svalbard_west, svalbard_east])))
        detail = _political_topology("NO", ("NO_MAINLAND", mainland), ("NO_COVERED_ISLAND", covered_island))
        result = _compose_political_features(primary, detail, override_collection=None)

        ids = list(result["id"].astype(str))
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(set(ids) - {"NO_MAINLAND", "NO_COVERED_ISLAND"}, {
            "NO_PRIMARY_GAP_3", "NO_PRIMARY_GAP_4",
        })
        gaps = result.loc[result["id"].str.startswith("NO_PRIMARY_GAP_")]
        self.assertTrue(all(gaps["cntr_code"] == "NO"))
        self.assertTrue(all(gaps["__source"] == "primary_gap"))
        self.assertGreaterEqual(gaps.geometry.total_bounds[3], 81.0)
        self.assertTrue(all(geometry.intersection(mainland.union(covered_island)).is_empty for geometry in gaps.geometry))

    def test_runtime_composition_keeps_uncovered_french_overseas_components(self) -> None:
        overseas_boxes = {
            "GP": box(-61.6, 16.1, -61.5, 16.3),
            "GP_EXTRA": box(-61.4, 15.9, -61.3, 16.0),
        }
        mainland = box(0, 0, 4, 4)
        primary = _political_topology("FR", ("FR", MultiPolygon([mainland, *overseas_boxes.values()])))
        detail = _political_topology("FR", ("FR_DETAIL", mainland))
        result = _compose_political_features(primary, detail, override_collection=None)

        codes = set(result["cntr_code"].astype(str))
        self.assertIn("FR", codes)
        gp = result.loc[result["cntr_code"] == "GP"].iloc[0]
        self.assertEqual(gp.geometry.geom_type, "MultiPolygon")
        self.assertLessEqual(gp.geometry.bounds[0], -61.59)
        self.assertGreaterEqual(gp.geometry.bounds[2], -61.31)

    def test_runtime_composition_drops_primary_component_with_meaningful_detail_overlap(self) -> None:
        mainland = box(0, 0, 4, 4)
        primary = _political_topology("FR", ("FR", MultiPolygon([mainland, box(10, 0, 12, 2)])))
        detail = _political_topology("FR", ("FR_DETAIL", mainland), ("FR_OVERLAP_DETAIL", box(10, 0, 10.5, 2)))
        result = _compose_political_features(primary, detail, override_collection=None)

        retained_ids = set(result["id"].astype(str))
        self.assertNotIn("FR_PRIMARY_GAP_2", retained_ids)


if __name__ == "__main__":
    unittest.main()
