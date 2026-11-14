from __future__ import annotations

from helpers.polygon_fixtures import _square
import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon

from map_builder import country_feature_policies
from map_builder.geo import local_canonicalization


class _ExplodingGeometry:
    is_empty = False

    def intersection(self, _other):
        raise RuntimeError("boom")


class LocalCanonicalizationTest(unittest.TestCase):
    def test_canonicalize_country_boundaries_legalizes_clip_geometry_before_intersection(self) -> None:
        political = gpd.GeoDataFrame(
            [{"id": "RU-1", "cntr_code": "RU", "geometry": _square(0, 0, 2.0)}],
            geometry="geometry",
            crs="EPSG:4326",
        )
        invalid_shell = Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)])
        shell = gpd.GeoDataFrame(
            [{"id": "RU-shell", "cntr_code": "RU", "geometry": invalid_shell}],
            geometry="geometry",
            crs="EPSG:4326",
        )

        with patch.object(
            local_canonicalization,
            "_build_country_subset_topology",
            side_effect=lambda subset: subset.copy(),
        ):
            out, reports = local_canonicalization.canonicalize_country_boundaries(
                political,
                shell_gdf=shell,
                target_country_codes=["RU"],
            )

        self.assertEqual(len(out), 1)
        self.assertFalse(out.geometry.iloc[0].is_empty)
        self.assertEqual(reports[0]["country_code"], "RU")
        self.assertFalse(reports[0]["skipped"])


    def test_evaluate_country_gate_metrics_uses_pipeline_promotion_policy(self) -> None:
        baseline = {
            "RU": {
                "feature_count": 10,
                "fragment_count": 2,
                "total_area_km2": 100.0,
                "max_fragment_area_km2": 20.0,
                "shared_arc_ratio": 0.9,
            },
            "DE": {
                "feature_count": 4,
                "fragment_count": 1,
                "total_area_km2": 0.5,
                "max_fragment_area_km2": 0.3,
                "shared_arc_ratio": 0.8,
            },
        }
        candidate = {
            "RU": {
                "feature_count": 9,
                "fragment_count": 3,
                "total_area_km2": 20.0,
                "max_fragment_area_km2": 21.0,
                "shared_arc_ratio": 0.88,
            },
            "DE": {
                "feature_count": 4,
                "fragment_count": 1,
                "total_area_km2": 1.5,
                "max_fragment_area_km2": 0.3,
                "shared_arc_ratio": 0.8,
            },
        }

        problems = local_canonicalization.evaluate_country_gate_metrics(
            baseline,
            candidate,
            target_country_codes=["RU", "DE"],
        )

        self.assertEqual(
            problems,
            [
                "RU: feature_count regressed 10->9",
                "RU: max_fragment_area_km2 regressed 20.000->21.000",
                "RU: shared_arc_ratio regressed 0.9000->0.8800",
                "RU: order-of-magnitude reduction target missed (100.000->20.000)",
                "DE: total_area_km2 regressed 0.500->1.500",
                "DE: total_area_km2 target missed (1.500 > 1.000)",
            ],
        )

    def test_evaluate_country_gate_metrics_reports_missing_candidate_metrics(self) -> None:
        self.assertEqual(
            local_canonicalization.evaluate_country_gate_metrics(None, None),
            ["candidate country metrics unavailable"],
        )

    def test_country_gate_policy_constants_come_from_policy_table(self) -> None:
        policies = country_feature_policies.load_country_feature_policies()["country_gate"]
        support_tiers = policies["support_tiers"]
        display_tiers = country_feature_policies.load_country_feature_policies()["display"]["detailOverlaySupportTiers"]

        self.assertEqual(
            local_canonicalization.LOCAL_CANONICAL_COUNTRY_CODES,
            tuple(policies["target_country_codes"]),
        )
        self.assertEqual(
            local_canonicalization.COUNTRY_GAP_TARGET_KM2,
            policies["country_gap_target_km2"],
        )
        self.assertEqual(
            local_canonicalization.STRICT_GAP_TARGET_COUNTRIES,
            tuple(support_tiers["strict_gap_target_countries"]),
        )
        self.assertEqual(
            local_canonicalization.ORDER_OF_MAGNITUDE_IMPROVEMENT_COUNTRIES,
            tuple(support_tiers["order_of_magnitude_improvement_countries"]),
        )
        self.assertEqual(display_tiers, support_tiers)
        self.assertEqual(
            country_feature_policies.display_detail_overlay_support_tier_codes("strict_gap_target_countries"),
            tuple(support_tiers["strict_gap_target_countries"]),
        )

    def test_intersect_feature_geometry_reports_country_code_and_feature_id(self) -> None:
        with patch.object(local_canonicalization, "_make_valid", side_effect=lambda geom: geom):
            with self.assertRaisesRegex(ValueError, "RU: clip intersection failed for feature 'RU-1': boom"):
                local_canonicalization._intersect_feature_geometry(
                    _ExplodingGeometry(),
                    object(),
                    country_code="RU",
                    feature_id="RU-1",
                )


if __name__ == "__main__":
    unittest.main()
