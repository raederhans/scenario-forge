"""Physical mask adaptation must preserve D3's spherical covered surface."""
import json
from pathlib import Path
import subprocess
import unittest

from shapely.geometry import Point, Polygon, box, mapping
from shapely.geometry.polygon import orient

from map_builder.geo.physical_water_mask import physical_mask_to_planar_geometry, inherit_physical_water_masks
from map_builder.geo.spherical_safety import _topology_feature_collection

ROOT = Path(__file__).resolve().parents[1]


def d3_contains(mask, probes):
    script = """const fs=require('fs'),vm=require('vm'),s={};vm.createContext(s);
vm.runInContext(fs.readFileSync('vendor/d3.v7.min.js','utf8'),s);
const data=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(data.probes.map(p=>s.d3.geoContains(data.mask,p))));"""
    completed = subprocess.run(['node', '-e', script], input=json.dumps({'mask': mask, 'probes': probes}),
                               text=True, capture_output=True, cwd=ROOT, check=True, timeout=15)
    return json.loads(completed.stdout)


def decode_objects(topology):
    script = """const fs=require('fs'),vm=require('vm'),s={};vm.createContext(s);
vm.runInContext(fs.readFileSync('vendor/topojson-client.min.js','utf8'),s);
const t=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(t.objects).map(([key,value])=>[key,s.topojson.feature(t,value)]))));"""
    completed = subprocess.run(['node', '-e', script], input=json.dumps(topology), text=True,
                               capture_output=True, cwd=ROOT, check=True, timeout=15)
    return json.loads(completed.stdout)


class PhysicalMaskTests(unittest.TestCase):
    def assert_matches_sphere(self, mask, probes):
        planar = physical_mask_to_planar_geometry(mask)
        self.assertTrue(planar.is_valid)
        self.assertEqual([planar.covers(Point(point)) for point in probes], d3_contains(mask, probes))
        return planar

    def test_hole_and_long_spherical_edges(self):
        mask = mapping(orient(Polygon(box(10, 10, 70, 60).exterior.coords,
                                      [box(25, 25, 40, 40).exterior.coords]), sign=-1))
        planar = self.assert_matches_sphere(mask, [[15, 15], [30, 30], [40, 62], [40, 72], [0, 0]])
        self.assertGreater(planar.bounds[3], 60)
        self.assertFalse(planar.covers(Point(30, 30)))

    def test_native_date_line_clipping(self):
        mask = {'type': 'Polygon', 'coordinates': [[[170, 0], [170, 20], [-170, 20], [-170, 0], [170, 0]]]}
        planar = self.assert_matches_sphere(mask, [[179, 10], [-179, 10], [0, 10], [179, -10]])
        self.assertTrue(planar.covers(Point(179, 10)))
        self.assertTrue(planar.covers(Point(-179, 10)))
        self.assertFalse(planar.covers(Point(0, 10)))

    def test_current_physical_ocean_and_land_keep_poles_and_holes(self):
        # The source ocean's planar bbox ends at 83.5996 N. Its actual spherical
        # surface nevertheless includes the cap, while land includes Antarctica.
        topology = json.loads((ROOT / 'data/europe_topology.json').read_text(encoding='utf-8'))
        probes = [[0, 89], [179.5, 85], [-179.5, 85], [90, -80], [0, -89], [0, 0], [30, 30]]
        for object_name in ('ocean', 'land'):
            mask = _topology_feature_collection(topology, object_name, 'physical_mask_test')
            self.assert_matches_sphere(mask, probes)

    def test_inheritance_preserves_both_grids_and_shared_target_geometry(self):
        target = {"type": "Topology", "metadata": {"source": "target"},
                  "transform": {"scale": [0.00360003600036, 0.001687919879], "translate": [-180, -85.1907]},
                  "arcs": [[[100, 200], [1000, 0], [0, 500], [-1000, -500]],
                           [[0, 0], [3, 0], [0, 3], [-3, -3]]],
                  "objects": {"political": {"type": "GeometryCollection", "geometries": [
                      {"type": "Polygon", "arcs": [[0]], "id": "country", "properties": {"owner": "X"}},
                      {"type": "LineString", "arcs": [-1]},
                      {"type": "Point", "coordinates": [171, 309, 44]},
                      {"type": "MultiPoint", "coordinates": [[54, 234], [543, 653]]}]},
                      "land": {"type": "Polygon", "arcs": [[0]], "properties": {"old": True}},
                      "ocean": {"type": "Polygon", "arcs": [[1]]}}}
        authority = {"type": "Topology", "transform": {"scale": [0.03600360036, 0.0173616861686], "translate": [-180, -89.9999]},
                     "arcs": [[[400, 500], [300, 0], [0, 400], [-300, -400]],
                              [[0, 0], [2, 0], [0, 2], [-2, -2]]],
                     "objects": {"land": {"type": "Polygon", "arcs": [[0]], "properties": {"source": "primary"}},
                                 "ocean": {"type": "Polygon", "arcs": [[-1]]},
                                 "unused": {"type": "Polygon", "arcs": [[1]]}}}
        before_target, before_authority = json.dumps(target), json.dumps(authority)
        inherited = inherit_physical_water_masks(target, authority)
        actual = decode_objects(inherited)
        self.assertEqual(actual["political"], decode_objects(target)["political"])
        for name in ("land", "ocean"):
            self.assertEqual(actual[name], decode_objects(authority)[name])
        self.assertNotIn("transform", inherited)
        self.assertEqual(len(inherited["arcs"]), 2)
        self.assertEqual(inherited["metadata"], target["metadata"])
        self.assertEqual(inherit_physical_water_masks(inherited, authority), inherited)
        self.assertEqual(json.dumps(target), before_target)
        self.assertEqual(json.dumps(authority), before_authority)



if __name__ == '__main__':
    unittest.main()
