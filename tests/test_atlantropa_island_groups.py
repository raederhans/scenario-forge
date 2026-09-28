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

    def test_component_anchor_does_not_fit_neighbor_island_in_same_feature(self):
        target = MultiPolygon([box(10, 10, 11, 11), box(20, 20, 21, 21)])
        anchor = {"baseline_feature_ids": ["CORE"], "baseline_component_bbox": [9, 9, 12, 12],
                  "source_province_ids": [1], "donor_state_ids": [100]}
        _, prepared = self._run(source=box(0, 0, 1, 1), target_rows=[("CORE", target)], anchors=[anchor])
        self.assertTrue(prepared["synthetic_island"]["geometry"].equals(box(10, 10, 11, 11)))

    def test_component_anchor_rejects_clipping_empty_and_ambiguous_windows(self):
        target = MultiPolygon([box(10, 10, 11, 11), box(20, 20, 21, 21)])
        for bounds in [(10.5, 10, 11, 11), (0, 0, 1, 1), (9, 9, 22, 22)]:
            with self.subTest(bounds=bounds), self.assertRaisesRegex(ValueError, "one complete baseline component"):
                self._run(source=box(0, 0, 1, 1), target_rows=[("CORE", target)], anchors=[{
                    "baseline_feature_ids": ["CORE"], "baseline_component_bbox": bounds,
                    "source_province_ids": [1], "donor_state_ids": [100],
                }])

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


class AtlantropaOriginalCorePreservationTests(unittest.TestCase):
    def test_original_core_survives_smoothing_without_importing_neighbor(self):
        core = box(0, 0, 1, 1)
        neighbor = box(2, 0, 3, 1)
        smoothed = box(.01, 0, 1.2, 1)
        baseline = gpd.GeoDataFrame({"id": ["CORE", "OTHER"],
            "geometry": [core, neighbor]}, geometry="geometry", crs="EPSG:4326")
        group = {"id": "core", "label": "Core", "owner_tag": "ITA", "donor_state_ids": [100],
            "baseline_feature_ids": ["CORE"], "preserve_baseline_core": True,
            "group_bbox": [-1, -1, 4, 2]}
        config = {"aoi_bbox": [-1, -1, 4, 2], "feature_group_id": "test",
                  "major_island_groups": [group]}
        donor = {"id": "ATLISRC_2", "donor_state_ids": [100],
                 "donor_state_names": ["Core"], "donor_province_ids": [2], "geometry": smoothed}
        with patch.object(builder, "smooth_polygonal", return_value=smoothed):
            rows, _ = builder.build_major_island_rows("test", config, [donor], baseline, None)
        result = rows[0]["geometry"]
        self.assertTrue(result.covers(core))
        self.assertEqual(result.intersection(neighbor).area, 0)
        self.assertTrue(result.equals(core.union(smoothed)))
        group["preserve_baseline_core"] = False
        with patch.object(builder, "smooth_polygonal", return_value=smoothed):
            rows, _ = builder.build_major_island_rows("test", config, [donor], baseline, None)
        self.assertGreater(core.difference(rows[0]["geometry"]).area, 0)


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

    def test_mainland_overlap_remains_rejected_without_explicit_configuration(self):
        with self.assertRaisesRegex(ValueError, "overlaps mainland"):
            self._build(box(2, -1, 4, 2))

    def test_mainland_clipping_cannot_remove_core_or_leave_detached_reclamation(self):
        for mainland, error in [(box(.5, -1, 4, 2), "removes original island"),
                                (box(1.5, -1, 2, 2), "detaches island reclamation")]:
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                self._build(mainland, allow=True)


if __name__ == "__main__":
    unittest.main()
