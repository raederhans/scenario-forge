import sys
from pathlib import Path
import unittest

import numpy as np

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import build_geographic_overlays as geo


def fixture():
    lonlat = np.array([[0, 0], [10, 0], [0, 10], [10, 10]], dtype=float)
    native = np.column_stack((1000+lonlat[:, 0]*100, 2000-lonlat[:, 1]*100))
    dt, triangles, valid, edges = geo.triangulate(lonlat, native)
    model = dict(controlPoints=[dict(lon=p[0], lat=p[1], x=q[0], y=q[1]) for p,q in zip(lonlat,native)],
                 triangles=triangles.tolist(), validTriangles=valid.tolist(), triangleMaxEdgeDegrees=edges.tolist())
    return model, (lonlat, native, dt, triangles, valid)


class GeographicOverlayTests(unittest.TestCase):
    def test_shared_triangles_roundtrip_and_no_extrapolation(self):
        model, transform = fixture()
        inverse, confidence = geo.raster_inverse(model)
        self.assertEqual(confidence[150, 150], 255)
        self.assertEqual(confidence[0, 0], 0)
        self.assertTrue(np.isnan(inverse[0, 0]).all())
        projected = geo.transform_points(*transform, [inverse[150, 150], [-1, 5]])
        np.testing.assert_allclose(projected[0], [1505, 1505], atol=.001)
        self.assertTrue(np.isnan(projected[1]).all())

    def test_folded_and_sparse_triangles_have_no_support(self):
        model, transform = fixture()
        # y reversed back into a north-up native image makes every triangle fold.
        flipped = transform[1].copy()
        flipped[:, 1] *= -1
        _, _, valid, _ = geo.triangulate(transform[0], flipped)
        self.assertFalse(valid.any())
        model['validTriangles'] = [False]*len(model['triangles'])
        inverse, confidence = geo.raster_inverse(model)
        self.assertFalse(confidence.any())
        self.assertTrue(np.isnan(inverse).all())

    def test_dateline_polygon_uses_both_edges_without_filling_center(self):
        topology = dict(transform=dict(scale=[1,1],translate=[0,0]),
                        arcs=[[[179,0],[-358,0],[0,10],[358,0],[0,-10]]],
                        objects=dict(physical_semantics=dict(geometries=[dict(type='Polygon',arcs=[[0]],
                            properties=dict(atlas_class='desert_bare',atlas_layer='semantic_overlay'))])))
        result = geo.physical_source_raster(topology,360,180)
        self.assertNotEqual(result[85,0], 0)
        self.assertNotEqual(result[85,359], 0)
        self.assertEqual(result[85,180], 0)

    def test_warp_masks_native_water_and_unsupported(self):
        source = np.ones((2,4), dtype=np.uint8)*7
        points = np.zeros((2,2,2), dtype=np.float32)
        confidence = np.array([[255,0],[255,255]], dtype=np.uint8)
        water = np.array([[False,False],[True,False]])
        result = geo.warp_physical(source, points, confidence, water)
        np.testing.assert_array_equal(result, [[7,0],[0,7]])

    def test_balanced_categorical_sampling_never_invents_packed_codes(self):
        values=np.array([[0,16,17,18],[32,33,34,35],[48,49,50,51],[64,65,66,67]],dtype=np.uint8)
        sampled=geo.categorical_nearest_2x2(values)
        np.testing.assert_array_equal(sampled,[[33,35],[65,67]])
        self.assertTrue(set(sampled.ravel()) <= set(values.ravel()))
        with self.assertRaises(ValueError):
            geo.categorical_nearest_2x2(values[:3])

    def test_balanced_river_max_pool_keeps_thin_lines_and_modern_precedence(self):
        values=np.array([[255,0,0,0],[0,128,0,128],[0,0,0,0],[128,0,0,0]],dtype=np.uint8)
        pooled=geo.maximum_2x2(values)
        np.testing.assert_array_equal(pooled,[[255,128],[128,0]])
        self.assertTrue(set(pooled.ravel()) <= {0,128,255})


if __name__ == '__main__':
    unittest.main()
