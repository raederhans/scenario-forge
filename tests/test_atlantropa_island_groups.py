import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon, box

from tools import patch_tno_1962_bundle as builder


class AtlantropaIslandGroupAlignmentTests(unittest.TestCase):
    def _run(self, *, source, target_rows, anchors=None, donor_state_ids=None, max_ratio=2.0,
             region_aoi=(0, 0, 30, 30), state_provinces=None):
        target_ids = [row_id for row_id, _ in target_rows]
        config = {
            "aoi_bbox": region_aoi,
            "major_island_groups": [{
                "id": "synthetic_island",
                "label": "Synthetic",
                "owner_tag": "ITA",
                "donor_state_ids": donor_state_ids or [100],
                "source_island_anchors": anchors or [{
                    "baseline_feature_ids": target_ids,
                    "source_province_ids": [1],
                    "donor_state_ids": donor_state_ids or [100],
                }],
                "max_baseline_area_ratio": max_ratio,
            }],
        }
        baseline = gpd.GeoDataFrame(
            {"id": [row_id for row_id, _ in target_rows],
             "geometry": [geometry for _, geometry in target_rows]},
            geometry="geometry",
            crs="EPSG:4326",
        )
        context = {"province_geom_cache": {}, "state_name_index": {}}
        states = state_provinces or {100: [1]}
        with patch.object(builder, "extract_province_geometry_raw", side_effect=lambda _context, pid: source[pid] if isinstance(source, dict) else source), \
             patch.object(builder, "get_state_province_ids", side_effect=lambda _context, state_id: states[int(state_id)]):
            return builder.prepare_source_aligned_island_groups(config, context, baseline)

    def test_source_core_is_aligned_and_relative_position_is_preserved(self):
        source = {1: box(0, 0, 2, 1), 2: box(2, 0, 3, 1)}
        target = box(10, 20, 14, 22)
        _coefficients, prepared = self._run(source=source, target_rows=[("CORE", target)],
                                           state_provinces={100: [2]}, max_ratio=4.0)

        aligned = prepared["synthetic_island"]["geometry"]
        self.assertTrue(aligned.equals(box(10, 20, 16, 22)))
        self.assertEqual(prepared["synthetic_island"]["diagnostics"]["area_ratio"], 1.5)

    def test_direct_union_preserves_hole_and_disconnected_component(self):
        source = MultiPolygon([
            Polygon(
                [(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)],
                holes=[[(1, 1), (1, 2), (2, 2), (2, 1), (1, 1)]],
            ),
            box(6, 6, 7, 7),
        ])
        target = MultiPolygon([
            Polygon(
                [(10, 10), (14, 10), (14, 14), (10, 14), (10, 10)],
                holes=[[(11, 11), (11, 12), (12, 12), (12, 11), (11, 11)]],
            ),
            box(16, 16, 17, 17),
        ])
        _coefficients, prepared = self._run(source=source, target_rows=[("CORE", target)], max_ratio=4.0)

        aligned = prepared["synthetic_island"]["geometry"]
        self.assertEqual(len(list(aligned.geoms)), 2)
        self.assertEqual(len(list(aligned.geoms)[0].interiors), 1)
        self.assertEqual(prepared["synthetic_island"]["diagnostics"]["parts"], 2)

    def test_area_budget_raises_instead_of_clipping_to_baseline(self):
        source = box(0, 0, 2, 2)
        target = Polygon([(10, 10), (14, 10), (14, 11), (11, 11), (11, 14), (10, 14), (10, 10)])

        with self.assertRaisesRegex(ValueError, "area budget exceeded"):
            self._run(source=source, target_rows=[("CORE", target)], max_ratio=1.1)


class AtlantropaIslandMainlandContactTests(unittest.TestCase):
    def _build(self, mainland, *, allow=False):
        core = box(0, 0, 1, 1)
        group = {"id": "coastal", "label": "Coastal", "owner_tag": "TUR",
                 "donor_state_ids": [100], "clip_mainland_overlap": allow}
        config = {"aoi_bbox": [-5, -5, 5, 5], "feature_group_id": "test",
                  "major_island_groups": [group]}
        candidate = box(0, 0, 3, 1)
        aligned = {"geometry": candidate, "baseline_geometry": core,
                   "donor_state_names": ["Coastal"], "donor_province_ids": [2], "diagnostics": {}}
        rows, _ = builder.build_major_island_rows("test", config,
            [{"id": "ATLISRC_2", "donor_state_ids": [100], "geometry": candidate}],
            gpd.GeoDataFrame(), mainland, aligned_groups={"coastal": aligned})
        return rows[0]["geometry"], aligned["diagnostics"]

    def test_source_reclamation_can_end_at_mainland_without_added_geometry(self):
        geometry, diagnostics = self._build(box(2, -1, 4, 2), allow=True)
        self.assertTrue(geometry.equals(box(0, 0, 2, 1)))
        self.assertEqual(diagnostics["mainland_overlap_removed_area"], 1)


if __name__ == "__main__":
    unittest.main()
