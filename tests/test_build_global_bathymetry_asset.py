from __future__ import annotations

import unittest

from shapely.geometry import LineString, Point, Polygon, box
from topojson.utils import serialize_as_geojson

from tools import build_global_bathymetry_asset as bathymetry_asset


class BuildGlobalBathymetryAssetTest(unittest.TestCase):
    def test_build_geo_dataframe_keeps_empty_geometry_column(self) -> None:
        gdf = bathymetry_asset.build_geo_dataframe([])

        self.assertEqual(list(gdf.columns), ["geometry"])
        self.assertEqual(str(gdf.crs), "EPSG:4326")
        self.assertEqual(len(gdf), 0)

    def test_build_topology_payload_accepts_empty_inputs(self) -> None:
        payload = bathymetry_asset.build_topology_payload([], [])

        self.assertIn("objects", payload)
        self.assertIn("bathymetry_bands", payload["objects"])
        self.assertIn("bathymetry_contours", payload["objects"])

    def test_contour_follows_depth_transition_without_coverage_edges(self) -> None:
        water = box(0, 0, 4, 2)
        bands = [
            {"depth_min_m": -50, "depth_max_m": -100, "geometry": box(0, 0, 1, 2)},
            {"depth_min_m": -100, "depth_max_m": -200, "geometry": box(1, 0, 3, 2)},
        ]

        contours = bathymetry_asset.build_contour_rows(bands, water)
        by_depth = {row["depth_m"]: row["geometry"] for row in contours}

        self.assertEqual(set(by_depth), {-100})
        self.assertLess(by_depth[-100].hausdorff_distance(LineString([(1, 0), (1, 2)])), 0.04)
        self.assertFalse(by_depth[-100].intersects(box(2.9, 0.2, 3.1, 1.8)))

    def test_replacing_contours_preserves_decoded_band_geometries(self) -> None:
        bands = [
            {"depth_min_m": -50, "depth_max_m": -100, "geometry": box(0, 0, 1, 2)},
            {"depth_min_m": -100, "depth_max_m": -200, "geometry": box(1, 0, 2, 2)},
        ]
        original = bathymetry_asset.build_topology_payload(
            bands, [{"depth_m": -50, "geometry": LineString([(0.5, 0), (0.5, 2)])}]
        )
        updated = bathymetry_asset.replace_contours_preserving_bands(
            original, [{"depth_m": -100, "geometry": LineString([(1, 0), (1, 2)])}]
        )

        decoded = lambda payload, name: serialize_as_geojson(payload, objectname=name)["features"]
        self.assertEqual(
            [feature["geometry"] for feature in decoded(original, "bathymetry_bands")],
            [feature["geometry"] for feature in decoded(updated, "bathymetry_bands")],
        )
        self.assertEqual(
            [feature["properties"]["depth_m"] for feature in decoded(updated, "bathymetry_contours")],
            [-100],
        )

    def test_clip_edges_include_only_source_bbox_edges_on_band_outer_edge(self) -> None:
        ocean = box(0, 0, 4, 4)
        bands = [{"geometry": box(0, 0, 2, 2)}, {"geometry": box(2, 0, 3, 2)}]

        clip_edges = bathymetry_asset.build_clip_edges(ocean, bands)

        self.assertEqual(clip_edges["type"], "MultiLineString")
        self.assertEqual(len(clip_edges["coordinates"]), 2)
        self.assertTrue(all(
            all(x == 0 for x, _ in line) or all(y == 0 for _, y in line)
            for line in clip_edges["coordinates"]
        ))
        self.assertAlmostEqual(sum(LineString(line).length for line in clip_edges["coordinates"]), 5, places=2)

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

    def test_expansion_quantization_discards_collapsed_outer_and_hole(self) -> None:
        payload = {
            "type": "Topology",
            "transform": {"scale": [0.001, 0.001], "translate": [0, 0]},
            "arcs": [],
            "objects": {"bathymetry_bands": {"type": "GeometryCollection", "geometries": []}},
        }
        rows = [
            {"depth_min_m": -100, "depth_max_m": -200,
             "asset_origin": bathymetry_asset.EXPANSION_ORIGIN, "tile_key": "e000_n000",
             "geometry": box(0.1, 0.1, 0.100001, 0.100001)},
            {"depth_min_m": -100, "depth_max_m": -200,
             "asset_origin": bathymetry_asset.EXPANSION_ORIGIN, "tile_key": "e000_n000",
             "geometry": Polygon(
                 [(0, 0), (1, 0), (1, 1), (0, 1)],
                 holes=[[(0.5, 0.5), (0.500001, 0.5), (0.500001, 0.500001), (0.5, 0.500001)]],
             )},
        ]

        bathymetry_asset.append_expansion_features(payload, "bathymetry_bands", rows)

        features = serialize_as_geojson(payload, objectname="bathymetry_bands")["features"]
        self.assertEqual(len(features), 1)
        self.assertEqual(len(features[0]["geometry"]["coordinates"]), 1)

    def test_horizontal_tile_edges_use_matching_half_degree_anchors(self) -> None:
        payload = {
            "type": "Topology",
            "transform": {"scale": [0.001, 0.001], "translate": [-180, -90]},
            "arcs": [],
            "objects": {"bathymetry_bands": {"type": "GeometryCollection", "geometries": []}},
        }
        rows = [
            {"depth_min_m": -4000, "depth_max_m": -6000,
             "asset_origin": bathymetry_asset.EXPANSION_ORIGIN, "tile_key": "w160_n010",
             "geometry": Polygon([(-160, 10), (-140, 10), (-140, 30), (-160, 30)])},
            {"depth_min_m": -6000, "depth_max_m": -12000,
             "asset_origin": bathymetry_asset.EXPANSION_ORIGIN, "tile_key": "w160_n030",
             "geometry": Polygon([(-160, 30), (-155, 30), (-140, 30), (-140, 50), (-160, 50)])},
        ]

        bathymetry_asset.append_expansion_features(payload, "bathymetry_bands", rows)
        features = serialize_as_geojson(payload, objectname="bathymetry_bands")["features"]
        edges = [
            {(round(x, 3), round(y, 3)) for x, y in feature["geometry"]["coordinates"][0] if y == 30}
            for feature in features
        ]
        expected = {(-160 + index * 0.5, 30) for index in range(41)}
        self.assertEqual(edges, [expected, expected])

    def test_small_boundary_band_survives_area_filter(self) -> None:
        tile = box(-160, 10, -140, 30)
        strip = box(-150.0666667, 29.9666667, -149.9, 30)
        self.assertLess(strip.area, bathymetry_asset.MIN_POLYGON_AREA)
        self.assertTrue(bathymetry_asset.retain_expansion_component(strip, tile))
        self.assertFalse(bathymetry_asset.retain_expansion_component(box(
            -150.0666667, 29.8, -149.9, 29.8333333
        ), tile))

    def test_global_marine_mask_includes_polar_and_indian_water_but_not_inland_seas(self) -> None:
        sources = bathymetry_asset.load_expansion_water()

        def covered(point):
            return any(geom.covers(Point(*point)) for _, _, geom in sources)

        for point in [(75, -25), (88, 12), (38, 20), (1, -65), (1, 85), (1, 89)]:
            self.assertTrue(covered(point), f"missing marine source at {point}")
        for point in [(50, 42), (35.5, 31.5), (26.5, 30)]:
            self.assertFalse(covered(point), f"inland water or land included at {point}")
        self.assertTrue(any(path.endswith("#ocean") for _, path, _ in sources))

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

if __name__ == "__main__":
    unittest.main()
