import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import shutil
from unittest.mock import patch

import numpy as np

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
spec = importlib.util.spec_from_file_location('hgo_geographic_overlays', TOOLS/'build_geographic_overlays.py')
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)


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

    def test_ambiguous_same_country_city_is_rejected(self):
        place = dict(id='vp-1',name='Paris',entityTag='FRA',x=1,y=2)
        def city(identifier, country):
            return dict(properties=dict(id=identifier,country_code=country,name='Paris'),
                        geometry=dict(coordinates=[2,49]))
        controls, _ = geo.match_controls([place], [city('fr1','FR'),city('us','US')])
        self.assertEqual(len(controls), 1)
        controls, omitted = geo.match_controls([place], [city('fr1','FR'),city('fr2','FR')])
        self.assertEqual(controls, [])
        self.assertEqual(omitted['ambiguous'], 1)

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

    def test_gzip_float_grid_preserves_nodata_and_byte_contract(self):
        values = np.array([[[10.25,-20.5],[np.nan,np.nan]]],dtype='<f4')
        temporary_root=geo.ROOT/'.runtime/tests/geographic-overlays'
        temporary_root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            metadata = geo.put_gzip(Path(directory),'grid.gz',values,'gzip-f32le-x2')
            data = (Path(directory)/'grid.gz').read_bytes()
            self.assertEqual(metadata['decodedByteLength'], 16)
            self.assertEqual(metadata['sha256'],geo.digest(data))
            restored=np.frombuffer(gzip.decompress(data),dtype='<f4').reshape(1,2,2)
            np.testing.assert_array_equal(restored,values)

    def test_smooth_affine_case_and_analytic_jacobian(self):
        model,transform=fixture()
        controls,native=transform[:2]
        rbf=geo.fit_rbf(controls/[180,90],native)
        coordinates=np.array([[3,7],[8,2]],dtype=float)/[180,90]
        predicted,derivative=geo.evaluate_rbf(rbf,coordinates,True)
        np.testing.assert_allclose(predicted,[[1300,1300],[1800,1800]],atol=1e-7)
        epsilon=1e-6
        for axis in range(2):
            offset=np.zeros(2);offset[axis]=epsilon
            finite=(geo.evaluate_rbf(rbf,coordinates+offset)-geo.evaluate_rbf(rbf,coordinates-offset))/(2*epsilon)
            np.testing.assert_allclose(derivative[:,:,axis],finite,atol=1e-4)
        self.assertTrue((geo.cross2(derivative[:,0],derivative[:,1])<0).all())

    def test_native_river_supplement_preserves_source_and_deduplicates(self):
        water=np.zeros((50,100),dtype=bool)
        native=np.full((50,100),255,dtype=np.uint8)
        native[10,14]=3  # overlaps modern line
        native[20,20:26]=3
        native[30,30]=0  # endpoint marker alone is not a river line
        water[20,25]=True
        feature=dict(properties=dict(featurecla='River'),geometry=dict(type='LineString',coordinates=[[10,10],[16,10]]))
        with patch.object(geo,'WIDTH',100),patch.object(geo,'HEIGHT',50):
            result,stats=geo.river_raster([feature],lambda p:p,water,native_rivers=native)
        self.assertEqual(result[10,14],255)
        self.assertEqual(result[20,20],128)
        self.assertEqual(result[20,25],0)
        self.assertEqual(result[30,30],0)
        self.assertEqual(stats['nativeSupplementPixels'],5)

    def test_saved_registration_has_independent_holdout_and_bound_assets(self):
        folder=TOOLS.parent/'assets/overlays/geography'
        model=json.loads((folder/'georeference.json').read_bytes())
        metrics=model['validation']['supportedHoldout']
        self.assertGreaterEqual(metrics['count'], 60)
        self.assertLess(metrics['p95Px'], 20)
        self.assertLess(model['smoothRegistration']['confirmation']['metrics']['p95Px'],25)
        self.assertEqual(model['smoothRegistration']['jacobianCheck']['foldCount'],0)
        self.assertGreater(model['coverage']['supportedNativeLandFraction'],.8)
        self.assertGreater(model['coverage']['broadIlluminationLandFraction'],.95)
        controls=model['controlPoints']
        values=np.array([[p[k]for k in ('lon','lat','x','y')]for p in controls])
        held=np.arange(len(values))%5==1
        independent_fit=geo.fit_rbf(values[~held,:2]/[180,90],values[~held,2:])
        predicted=geo.evaluate_rbf(independent_fit,values[held,:2]/[180,90])
        errors=np.linalg.norm(predicted-values[held,2:],axis=1)
        reported=np.array([p['errorPx']for p in model['smoothRegistration']['confirmation']['points']])
        np.testing.assert_allclose(errors,reported,atol=.000051)
        ids={p['id'] for p in model['controlPoints']}
        self.assertTrue({p['id'] for p in model['validation']['holdoutPoints']} <= ids)
        self.assertTrue(all(p['supported'] == (p['errorPx'] is not None) for p in model['validation']['holdoutPoints']))
        manifest=json.loads((folder/'manifest.json').read_bytes())
        for asset in manifest['assets'].values():
            payload=(folder/asset['url']).read_bytes()
            self.assertEqual(len(payload),asset['byteLength'])
            self.assertEqual(geo.digest(payload),asset['sha256'])
            if asset['encoding'].startswith('gzip'):
                self.assertEqual(len(gzip.decompress(payload)),asset['decodedByteLength'])

    def test_packed_terrain_retains_both_source_classes_and_native_water(self):
        folder=TOOLS.parent/'assets/overlays/geography'
        manifest=json.loads((folder/'manifest.json').read_bytes())
        item=manifest['assets']['physical']
        values=np.frombuffer(gzip.decompress((folder/item['url']).read_bytes()),dtype=np.uint8).reshape(item['height'],item['width'])
        self.assertLessEqual(int((values>>4).max()),len(geo.NATIVE_CLASS_NAMES))
        self.assertLessEqual(int((values&15).max()),len(geo.CLASSES))
        self.assertTrue(set(np.unique(values))-{0} <= {p['code']for p in manifest['palette']})
        water=geo.sample_native(geo.native_water(TOOLS.parent/'assets/default'),item['width'],item['height'])
        self.assertFalse(values[water].any())
        self.assertGreater(np.count_nonzero(values&15),500000)

    def test_inverse_grid_does_not_label_invalid_cells_as_supported(self):
        folder=TOOLS.parent/'assets/overlays/geography'
        manifest=json.loads((folder/'manifest.json').read_bytes())
        for prefix in ('','broad'):
            coordinate_key=prefix+'InverseLonLat' if prefix else 'inverseLonLat'
            confidence_key=prefix+'InverseConfidence' if prefix else 'inverseConfidence'
            points=np.frombuffer(gzip.decompress((folder/manifest['assets'][coordinate_key]['url']).read_bytes()),dtype='<f4').reshape(256,512,2)
            confidence=np.frombuffer(gzip.decompress((folder/manifest['assets'][confidence_key]['url']).read_bytes()),dtype=np.uint8).reshape(256,512)
            np.testing.assert_array_equal(np.isfinite(points).all(axis=-1),confidence>0)
            self.assertTrue((abs(points[...,0][confidence>0])<=180).all())

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

    def test_balanced_derivation_masks_native_water_and_preserves_registration(self):
        folder=TOOLS.parent/'assets/overlays/geography'
        original=json.loads((folder/'manifest.json').read_bytes())
        temporary_root=geo.ROOT/'.runtime/tests/geographic-overlays'
        temporary_root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            output=Path(directory)
            (output/'manifest.json').write_bytes(geo.encoded(original))
            # A sentinel verifies the fast derivation does not rewrite a
            # geographic model or require recomputing its dependent lighting.
            sentinel=b'registration bytes must remain untouched'
            (output/'georeference.json').write_bytes(sentinel)
            for key in ('physical','rivers'):
                asset=original['assets'][key]
                shutil.copyfile(folder/asset['url'],output/asset['url'])
            derived=geo.build_balanced_only(geo.ROOT,output)
            self.assertEqual((output/'georeference.json').read_bytes(),sentinel)
            for key,asset in original['assets'].items():
                if key not in ('physicalBalanced','riversBalanced'):
                    self.assertEqual(derived['assets'][key],asset)
            self.assertEqual(derived['qualityLevels']['default'],'balanced')
            water=geo.native_water(TOOLS.parent/'assets/default')
            for fine_key,balanced_key in [('physical','physicalBalanced'),('rivers','riversBalanced')]:
                fine=original['assets'][fine_key]
                balanced=derived['assets'][balanced_key]
                self.assertEqual((balanced['width'],balanced['height']),(fine['width']//2,fine['height']//2))
                fine_values=np.frombuffer(gzip.decompress((folder/fine['url']).read_bytes()),dtype=np.uint8)
                balanced_values=np.frombuffer(gzip.decompress((output/balanced['url']).read_bytes()),dtype=np.uint8).reshape(balanced['height'],balanced['width'])
                self.assertTrue(set(np.unique(balanced_values)) <= set(np.unique(fine_values))|{0})
                sampled_water=geo.sample_native(water,balanced['width'],balanced['height'])
                self.assertFalse(balanced_values[sampled_water].any())


if __name__ == '__main__':
    unittest.main()
