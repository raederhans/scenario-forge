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

    def test_detached_reclamation_without_original_island_anchor_is_deferred(self):
        source = {1: box(0, 0, 1, 1),
                  2: MultiPolygon([box(1, 0, 2, 1), box(3, 3, 3.2, 3.2)])}
        _, prepared = self._run(source=source, target_rows=[("CORE", box(10, 10, 11, 11))],
                                state_provinces={100: [2]}, max_ratio=3.0)
        result = prepared["synthetic_island"]
        self.assertTrue(result["geometry"].equals(box(10, 10, 12, 11)))
        deferred = result["diagnostics"]["deferred_unanchored_components"]
        self.assertEqual(len(deferred), 1)
        self.assertAlmostEqual(deferred[0]["area"], 0.04)

    def test_explicit_baseline_outside_source_bbox_is_retained(self):
        source = box(0, 0, 1, 1)
        target = box(12, 14, 16, 18)
        _coefficients, prepared = self._run(source=source, target_rows=[("CORE", target)], max_ratio=4.0)

        self.assertTrue(prepared["synthetic_island"]["geometry"].covers(target))
        self.assertEqual(prepared["synthetic_island"]["diagnostics"]["baseline_missing_area"], 0.0)

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

    def test_missing_baseline_ids_are_rejected(self):
        source = box(0, 0, 1, 1)
        anchors = [{"baseline_feature_ids": ["MISSING"], "source_province_ids": [1], "donor_state_ids": [100]}]

        with self.assertRaisesRegex(ValueError, "Missing island alignment baseline"):
            self._run(source=source, target_rows=[("CORE", box(10, 10, 11, 11))], anchors=anchors)

    def test_duplicate_anchor_states_are_rejected(self):
        source = box(0, 0, 1, 1)
        anchors = [
            {"baseline_feature_ids": ["A"], "source_province_ids": [1], "donor_state_ids": [100]},
            {"baseline_feature_ids": ["B"], "source_province_ids": [2], "donor_state_ids": [100]},
        ]

        with self.assertRaisesRegex(ValueError, "Duplicate island alignment state"):
            self._run(
                source=source,
                target_rows=[("A", box(10, 10, 11, 11)), ("B", box(12, 12, 13, 13))],
                anchors=anchors,
            )

    def test_incomplete_donor_states_are_rejected(self):
        source = box(0, 0, 1, 1)
        anchors = [{"baseline_feature_ids": ["CORE"], "source_province_ids": [1], "donor_state_ids": [100]}]

        with self.assertRaisesRegex(ValueError, "Incomplete island alignment states"):
            self._run(
                source=source,
                target_rows=[("CORE", box(10, 10, 11, 11))],
                anchors=anchors,
                donor_state_ids=[100, 101],
            )


if __name__ == "__main__":
    unittest.main()
