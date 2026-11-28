import unittest

import geopandas as gpd
from shapely.geometry import box

from tools.repair_scenario_geography import repair_placeholder_frame, PLACEHOLDER_ID


class ScenarioGeographyRepairTests(unittest.TestCase):
    def test_builder_frame_policy_is_idempotent_and_preserves_metadata(self):
        frame = gpd.GeoDataFrame([
            {'id': PLACEHOLDER_ID, 'owner': 'RAJ', 'geometry': box(0, 0, 3, 2)},
            {'id': 'PAK-1111', 'owner': 'PAK', 'geometry': box(0, 0, 2, 2)},
            {'id': 'OTHER', 'owner': 'RAJ', 'geometry': box(5, 5, 6, 6)},
        ], crs=4326)
        repaired = repair_placeholder_frame(frame)
        self.assertEqual(repaired.iloc[0].geometry.area, 2)
        self.assertEqual(repaired.iloc[0]['owner'], 'RAJ')
        self.assertEqual(frame.iloc[0].geometry.area, 6)
        self.assertTrue(repaired.iloc[1].geometry.equals_exact(frame.iloc[1].geometry, 0))
        self.assertIs(repair_placeholder_frame(repaired), repaired)
        absent = frame.iloc[1:]
        self.assertIs(repair_placeholder_frame(absent), absent)


if __name__ == '__main__':
    unittest.main()
