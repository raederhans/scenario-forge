from __future__ import annotations

import unittest
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import Polygon

from map_builder.geo import local_canonicalization


def _square(x: float, y: float, size: float = 1.0) -> Polygon:
    return Polygon(
        [
            (x, y),
            (x + size, y),
            (x + size, y + size),
            (x, y + size),
        ]
    )


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
