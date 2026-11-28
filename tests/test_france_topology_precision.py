from copy import deepcopy
import unittest
from unittest.mock import patch

import geopandas as gpd
import shapely
from shapely.geometry import Polygon, box, mapping, shape
import topojson

from map_builder.geo.france_topology_precision import preserve_france_topology_precision


def decoded(topology, geometry):
    def arc(index):
        points = topology["arcs"][index if index >= 0 else ~index]
        transform = topology.get("transform")
        if transform:
            x = y = 0
            decoded_points = []
            for dx, dy in points:
                x += dx
                y += dy
                decoded_points.append([x * transform["scale"][0] + transform["translate"][0],
                                       y * transform["scale"][1] + transform["translate"][1]])
            points = decoded_points
        return points if index >= 0 else points[::-1]

    def ring(indices):
        points = []
        for index in indices:
            segment = arc(index)
            points.extend(segment if not points else segment[1:])
        return points

    if geometry["type"] == "Polygon":
        return shape({"type": "Polygon", "coordinates": [ring(item) for item in geometry["arcs"]]})
    if geometry["type"] == "MultiPolygon":
        return shape({"type": "MultiPolygon", "coordinates": [
            [ring(item) for item in polygon] for polygon in geometry["arcs"]]})
    raise AssertionError(geometry["type"])


class FranceTopologyPrecisionTests(unittest.TestCase):
    def fixture(self):
        # Valid tiny shared-edge polygons collapse on a world-scale 100k grid.
        geometries = [box(2, 48, 2.0001, 48.0001), box(2.0001, 48, 2.0002, 48.0001)]
        source = gpd.GeoDataFrame([
            {"id": f"FR_ARR_{index}", "geometry": geom}
            for index, geom in enumerate(geometries)
        ], crs="EPSG:4326")
        features = [{"type": "Feature", "id": f"metadata-{index}",
                     "properties": {"id": row.id, "owner": "FRA", "nested": {"keep": [1, 2]}},
                     "geometry": mapping(row.geometry)}
                    for index, row in source.iterrows()]
        features.append({"type": "Feature", "properties": {"id": "OTHER"},
                         "geometry": mapping(box(-180, -85, 180, 85))})
        topology = topojson.Topology(
            {"type": "FeatureCollection", "features": features},
            prequantize=100000, object_name="political",
        ).to_dict()
        return source, topology

    def test_restores_coverage_preserves_other_geometry_and_metadata(self):
        source, topology = self.fixture()
        original = deepcopy(topology)
        old_geometries = topology["objects"]["political"]["geometries"]
        self.assertTrue(shapely.coverage_is_valid(source.geometry.tolist()))
        with self.assertRaisesRegex(ValueError, "linearring"):
            decoded(topology, old_geometries[0])
        result = preserve_france_topology_precision(topology, source)
        self.assertEqual(topology, original)
        self.assertNotIn("transform", result)
        geometries = result["objects"]["political"]["geometries"]
        restored = [decoded(result, item) for item in geometries[:2]]
        self.assertTrue(shapely.coverage_is_valid(restored))
        for actual, expected in zip(restored, source.geometry):
            self.assertTrue(actual.equals_exact(expected, 0, normalize=True))
            self.assertFalse(actual.exterior.is_ccw)
        self.assertTrue(decoded(result, geometries[2]).equals_exact(decoded(topology, old_geometries[2]), 0))
        for old, new in zip(old_geometries, geometries):
            self.assertEqual({k: v for k, v in old.items() if k not in {"type", "arcs"}},
                             {k: v for k, v in new.items() if k not in {"type", "arcs"}})

    def test_holes_follow_d3_winding(self):
        source, topology = self.fixture()
        shell = box(1, 45, 2, 46)
        hole = box(1.2, 45.2, 1.4, 45.4)
        source.loc[0, "geometry"] = Polygon(shell.exterior.coords, [hole.exterior.coords])
        result = preserve_france_topology_precision(topology, source)
        polygon = decoded(result, result["objects"]["political"]["geometries"][0])
        self.assertFalse(polygon.exterior.is_ccw)
        self.assertTrue(polygon.interiors[0].is_ccw)

    def test_invalid_encoded_output_is_rejected(self):
        source, topology = self.fixture()
        with patch("map_builder.geo.france_topology_precision._decode_polygon", return_value=box(1, 1, 2, 2)):
            with self.assertRaisesRegex(ValueError, "output"):
                preserve_france_topology_precision(topology, source)


if __name__ == "__main__":
    unittest.main()
