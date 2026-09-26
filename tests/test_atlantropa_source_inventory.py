"""Focused checks for HGO source inventory lineage and spatial classification."""

import unittest

import numpy as np
from affine import Affine
from shapely.geometry import box

from tools import patch_tno_1962_bundle as builder
from tools.audit_atlantropa_sources import (
    anchor_coefficients_by_province,
    attribution_ids,
    classify_candidate,
    current_attribution_index,
    inverse_aoi_pixel_keys,
    province_projection,
)


class AtlantropaSourceInventoryTests(unittest.TestCase):
    def test_scalar_and_list_lineage_are_both_indexed(self):
        topology = {"objects": {"scenario_atlantropa": {"geometries": [
            {"properties": {"id": "ATLPRV_1", "atl_render_layer": "land", "donor_province_id": 1, "donor_state_id": 10}},
            {"properties": {"id": "ATLISL_x", "atl_render_layer": "land", "donor_province_ids": [2, 3], "donor_state_ids": [20, 21]}},
            {"properties": {"id": "ATLSEA_x", "atl_render_layer": "water", "donor_province_id": 4}},
        ]}}}
        provinces, states, land = current_attribution_index(topology)
        self.assertEqual(provinces[1], {"ATLPRV_1"})
        self.assertEqual(provinces[3], {"ATLISL_x"})
        self.assertEqual(states[21], {"ATLISL_x"})
        self.assertEqual(provinces[4], {"ATLSEA_x"})
        self.assertNotIn(4, land)
        self.assertEqual(attribution_ids({"donor_province_id": None},
                                         "donor_province_id", "donor_province_ids"), set())

    def test_inverse_aoi_keeps_only_window_pixels_and_neighbor_band(self):
        context = {"key_image": np.arange(25, dtype=np.uint32).reshape(5, 5),
                   "raw_transform": Affine(1, 0, 0, 0, -1, 5)}
        inside, near, scan = inverse_aoi_pixel_keys(context, (1, 0, 0, 0, 1, 0),
                                                    (1, 1, 3, 3), margin=1)
        self.assertEqual(inside, {11, 12, 16, 17})
        self.assertLess(len(inside), len(near))
        self.assertNotIn(0, near)
        self.assertEqual(scan["pixel_count"], 16)

    def test_absent_id_requires_spatial_coverage_evidence(self):
        source = box(0, 0, 1, 1)
        empty = box(3, 3, 4, 4)

        def classify(baseline, current, relation="inside_aoi"):
            return classify_candidate(configured_role=None, spatial_relation=relation,
                                      province_feature_ids=set(), source_geom=source,
                                      baseline_land=baseline, current_land=current)

        self.assertEqual(classify(empty, empty)[0], "unresolved")
        self.assertEqual(classify(source, empty)[0], "baseline_covered")
        self.assertEqual(classify(empty, source)[0], "covered_by_current_surface")
        status, evidence = classify(box(0, 0, 0.99, 1), empty)
        self.assertEqual(status, "unresolved")
        self.assertGreater(evidence["baseline_uncovered_area_deg2"], 0)
        self.assertEqual(classify(empty, empty, relation="outside_aoi")[0], "outside_aoi")

    def test_original_cyprus_anchor_uses_source_alignment(self):
        # 14138 belongs to the unnamed template, outside the configured Cyprus
        # donor states. It still has the island's own alignment in the real rule.
        config = builder.ATLANTROPA_REGION_CONFIGS["levant"]
        anchor = config["major_island_groups"][0]["source_island_anchors"][0]
        self.assertIn(14138, anchor["source_province_ids"])
        region_coeffs = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)
        island_coeffs = {int(state): (2.0, 0.0, 1.0, 0.0, 2.0, 1.0)
                         for state in anchor["donor_state_ids"]}
        anchor_coeffs = anchor_coefficients_by_province(config, island_coeffs)
        chosen, kind = province_projection(14138, [99999], region_coeffs,
                                           island_coeffs, anchor_coeffs)
        self.assertEqual(chosen, island_coeffs[int(anchor["donor_state_ids"][0])])
        self.assertEqual(kind, "source_island_anchor")
        self.assertEqual(province_projection(99998, [99999], region_coeffs,
                                             island_coeffs, anchor_coeffs),
                         (region_coeffs, "region_affine"))


if __name__ == "__main__":
    unittest.main()
