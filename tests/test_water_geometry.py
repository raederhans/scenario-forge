"""Regression checks for the planar-to-spherical water boundary contract."""
import json
from pathlib import Path
import subprocess
import unittest

from shapely.geometry import Polygon, box, mapping, shape

from map_builder.geo.water_geometry import compile_water_feature_collection, densify_water_topology, replace_water_topology_object


ROOT = Path(__file__).resolve().parents[1]


def collection(*geometries, kind="ocean"):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": str(i), "properties": {"id": str(i), "water_type": kind}, "geometry": mapping(g)}
        for i, g in enumerate(geometries)
    ]}


def contains(features, probes):
    script = '''const fs=require('fs'),vm=require('vm');const s={};vm.createContext(s);
vm.runInContext(fs.readFileSync('vendor/d3.v7.min.js','utf8'),s);
const data=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(data.features.map(f=>data.probes.map(p=>s.d3.geoContains(f,p)))));'''
    result = subprocess.run(["node", "-e", script], input=json.dumps({"features": features, "probes": probes}),
                            text=True, capture_output=True, check=True, cwd=ROOT, timeout=15)
    return json.loads(result.stdout)


def decode(topology):
    script = """const fs=require('fs'),vm=require('vm');const s={};vm.createContext(s);
vm.runInContext(fs.readFileSync('vendor/topojson-client.min.js','utf8'),s);
const data=JSON.parse(fs.readFileSync(0,'utf8'));
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(data.objects).map(([key,obj])=>[key,s.topojson.feature(data,obj)]))));"""
    result = subprocess.run(["node", "-e", script], input=json.dumps(topology), text=True,
                            capture_output=True, check=True, cwd=ROOT, timeout=15)
    return json.loads(result.stdout)


class WaterGeometryTests(unittest.TestCase):
    def test_reversed_shell_and_hole_remain_local(self):
        shell = list(box(10, 10, 30, 30).exterior.coords)
        hole = list(box(15, 15, 25, 25).exterior.coords)
        source = collection(Polygon(shell, [hole]), Polygon(shell[::-1], [hole[::-1]]))
        compiled = compile_water_feature_collection(source)
        self.assertEqual(contains(compiled["features"], [[12, 12], [20, 20], [100, -20]]), [[True, False, False]] * 2)

    def test_poles_and_date_line_have_no_epsilon_slit(self):
        source = collection(box(-180, 83.6, 180, 90), box(-180, -90, 180, -83.6))
        compiled = compile_water_feature_collection(source)
        probes = [[0, 89], [-60, 89], [60, 89], [179.99, 89], [-179.99, 89], [0, 89.999], [0, 0], [0, -89]]
        self.assertEqual(contains(compiled["features"], probes), [[True] * 6 + [False, False], [False] * 7 + [True]])
        for before, after in zip(source["features"], compiled["features"]):
            self.assertTrue(shape(after["geometry"]).is_valid)
            self.assertEqual(after["geometry"]["type"], "Polygon")
            self.assertLess(shape(before["geometry"]).symmetric_difference(shape(after["geometry"])).area, 1e-8)

    def test_full_width_southern_belt_stays_valid_and_local(self):
        compiled = compile_water_feature_collection(collection(box(-180, -70, 180, -60)))
        self.assertTrue(shape(compiled["features"][0]["geometry"]).is_valid)
        self.assertEqual(contains(compiled["features"], [[0, -65], [179.99, -65], [-179.99, -65], [0, -80], [0, 0]]),
                         [[True, True, True, False, False]])

    def test_physical_masks_exclude_land_without_removing_lakes(self):
        source = collection(box(0, 0, 20, 20), box(12, 12, 14, 14))
        source["features"][1]["properties"]["water_type"] = "lake"
        compiled = compile_water_feature_collection(source, ocean_mask=box(0, 0, 15, 20), land_mask=box(10, 10, 20, 20))
        self.assertEqual(contains(compiled["features"], [[5, 5], [13, 13], [18, 5]]), [[True, False, False], [False, True, False]])

    def test_topology_densification_does_not_mutate_shared_land_arcs(self):
        topology = {"type": "Topology", "transform": {"scale": [0.01, 0.01], "translate": [0, 0]},
                    "arcs": [[[0, 0], [1000, 0], [0, 1000], [-1000, -1000]]],
                    "objects": {"land": {"type": "Polygon", "arcs": [[0]]},
                                "water_regions": {"type": "GeometryCollection", "geometries": [
                                    {"type": "Polygon", "arcs": [[0]]}, {"type": "Polygon", "arcs": [[-1]]}]}}}
        compiled = densify_water_topology(topology)
        self.assertEqual(compiled["arcs"][0], topology["arcs"][0])
        self.assertEqual(compiled["objects"]["land"], topology["objects"]["land"])
        self.assertEqual(compiled["transform"], topology["transform"])
        self.assertEqual([f["arcs"] for f in compiled["objects"]["water_regions"]["geometries"]], [[[1]], [[-2]]])
        self.assertGreater(len(compiled["arcs"][1]), 40)
        self.assertEqual(densify_water_topology(compiled), compiled)

    def test_replacement_preserves_nonwater_decode_and_is_stable(self):
        topology = {"type": "Topology", "transform": {"scale": [0.036, 0.01736], "translate": [-180, -90]},
                    "metadata": {"keep": "unchanged"},
                    "arcs": [[[5020, 3000], [790, 1250], [-800, 250], [10, -1500]],
                             [[0, 0], [100, 0], [0, 100], [-100, -100]]],
                    "objects": {"political": {"type": "GeometryCollection", "geometries": [
                        {"type": "Polygon", "arcs": [[0]], "id": "country", "properties": {"x": 1}},
                        {"type": "LineString", "arcs": [-1]},
                        {"type": "Point", "coordinates": [5021, 3007, 5]},
                        {"type": "MultiPoint", "coordinates": [[5011, 3011], [5109, 3233]]}]},
                        "water_regions": {"type": "Polygon", "arcs": [[1]], "custom": "preserved"}}}
        compiled = compile_water_feature_collection(collection(Polygon(
            list(box(20, -60.54, 147, -10).exterior.coords),
            [list(box(60, -40, 80, -20).exterior.coords)])))
        replaced = replace_water_topology_object(topology, compiled)
        decoded = decode(replaced)
        self.assertEqual(decoded["political"], decode(topology)["political"])
        self.assertEqual(replaced["metadata"], topology["metadata"])
        self.assertEqual(replaced["objects"]["water_regions"]["custom"], "preserved")
        self.assertLessEqual(max(replaced["transform"]["scale"]), 0.0002)
        self.assertEqual(contains(decoded["water_regions"]["features"], [[90, -75], [90, -40], [70, -30]]),
                         [[False, True, False]])
        repeated = replace_water_topology_object(replaced, compiled)
        self.assertEqual(repeated, replaced)
        self.assertEqual(decode(repeated), decoded)


if __name__ == "__main__":
    unittest.main()
