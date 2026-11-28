from __future__ import annotations

import unittest
from unittest.mock import patch

from shapely.geometry import LineString, Point, box
from topojson.utils import serialize_as_geojson

from tools import build_global_bathymetry_asset as bathymetry_asset


class BuildGlobalBathymetryAssetTest(unittest.TestCase):
    def test_regional_overview_groups_equal_depth_parts_without_changing_detail(self) -> None:
        rows = [
            {"depth_min_m": 0, "depth_max_m": -50, "geometry": box(0, 0, 1, 1)},
            {"depth_min_m": 0, "depth_max_m": -50, "geometry": box(2, 0, 3, 1)},
        ]
        payload = bathymetry_asset.build_topology_payload(
            rows, [{"depth_m": -50, "geometry": LineString([(0, 0), (0, 1)])}]
        )
        original_arcs = list(payload["arcs"])

        bands, contours = bathymetry_asset.build_regional_overview_rows(payload, rows)

        self.assertEqual(len(bands), 1)
        self.assertEqual(bands[0]["geometry"].geom_type, "MultiPolygon")
        self.assertEqual(len(bands[0]["geometry"].geoms), 2)
        self.assertEqual(len(contours), 1)
        self.assertEqual(payload["arcs"], original_arcs)

    def test_expansion_arcs_decode_and_rebuild_keeps_original_features(self) -> None:
        original = bathymetry_asset.build_topology_payload(
            [{"depth_min_m": 0, "depth_max_m": -50, "geometry": box(0, 0, 1, 1)}], []
        )
        base_count = len(original["arcs"])
        expanded = {**original, "arcs": list(original["arcs"]), "objects": {
            name: {**obj, "geometries": list(obj["geometries"])}
            for name, obj in original["objects"].items()
        }}
        bathymetry_asset.append_expansion_features(expanded, "bathymetry_bands", [{
            "depth_min_m": -6000, "depth_max_m": -12000,
            "asset_origin": bathymetry_asset.EXPANSION_ORIGIN,
            "tile_key": "e000_n000", "geometry": box(2, 0, 3, 1),
        }])
        expanded["bathymetry_expansion"] = {
            "base_arc_count": base_count, "base_bbox": original["bbox"],
            "origin": bathymetry_asset.EXPANSION_ORIGIN,
        }

        features = serialize_as_geojson(expanded, objectname="bathymetry_bands")["features"]
        self.assertEqual(len(features), 2)
        self.assertEqual(features[1]["properties"]["depth_max_m"], -12000)
        self.assertLess(
            box(2, 0, 3, 1).hausdorff_distance(bathymetry_asset.shape(features[1]["geometry"])),
            0.0001,
        )
        restored, restored_arc_count = bathymetry_asset.base_payload_for_expansion(expanded)
        self.assertEqual(restored_arc_count, base_count)
        self.assertEqual(restored["arcs"], original["arcs"])
        self.assertEqual(restored["objects"], original["objects"])

    def test_expansion_quantization_clamps_dateline_to_valid_longitude(self) -> None:
        payload = {
            "type": "Topology",
            "transform": {
                "scale": [9.04334237667571e-05, 5.5000055000055e-05],
                "translate": [-28.433333333333334, 20.0],
            },
            "arcs": [],
            "objects": {"bathymetry_bands": {"type": "GeometryCollection", "geometries": []}},
        }
        bathymetry_asset.append_expansion_features(payload, "bathymetry_bands", [{
            "depth_min_m": -2000, "depth_max_m": -4000,
            "asset_origin": bathymetry_asset.EXPANSION_ORIGIN,
            "tile_key": "w180_s020", "geometry": box(-180, -20, -179, -19),
        }])

        geometry = serialize_as_geojson(payload, objectname="bathymetry_bands")["features"][0]["geometry"]
        points = geometry["coordinates"][0]
        self.assertTrue(all(-180 <= x <= 180 and -90 <= y <= 90 for x, y in points))

    def test_global_marine_mask_includes_polar_and_indian_water_but_not_inland_seas(self) -> None:
        # Full-world source arcs must not enter topojson's padded dense decoder.
        with patch.object(bathymetry_asset, "serialize_as_geojson", side_effect=AssertionError("dense decode")):
            sources = bathymetry_asset.load_expansion_water()

        def covered(point):
            return any(geom.covers(Point(*point)) for _, _, geom in sources)

        for point in [(75, -25), (88, 12), (38, 20), (1, -65), (1, 85), (1, 89)]:
            self.assertTrue(covered(point), f"missing marine source at {point}")
        for point in [(50, 42), (35.5, 31.5), (26.5, 30)]:
            self.assertFalse(covered(point), f"inland water or land included at {point}")
        self.assertTrue(any(path.endswith("#ocean") for _, path, _ in sources))


if __name__ == "__main__":
    unittest.main()
