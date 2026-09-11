"""Regression tests for small unquantized water components in TopoJSON."""

import json
from pathlib import Path
import subprocess
import unittest

from map_builder.geo.water_geometry import compile_water_feature_collection, replace_water_topology_object


ROOT = Path(__file__).resolve().parents[1]


def feature_collection(coordinates):
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "id": "water",
            "properties": {"id": "water", "water_type": "ocean"},
            "geometry": {"type": "MultiPolygon", "coordinates": coordinates},
        }],
    }


def decode_and_measure(topology, probes):
    script = """const fs=require('fs'),vm=require('vm');const s={};vm.createContext(s);
vm.runInContext(fs.readFileSync('vendor/d3.v7.min.js','utf8'),s);
vm.runInContext(fs.readFileSync('vendor/topojson-client.min.js','utf8'),s);
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const feature=s.topojson.feature(input.topology,input.topology.objects.water_regions).features[0];
const geometry=feature.geometry;
const parts=geometry.type==='Polygon'?(geometry.coordinates.length?1:0):geometry.coordinates.length;
process.stdout.write(JSON.stringify({
  area:s.d3.geoArea(feature),
  contains:input.probes.map(point=>s.d3.geoContains(feature,point)),
  parts,
}));"""
    result = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"topology": topology, "probes": probes}),
        text=True,
        capture_output=True,
        check=True,
        cwd=ROOT,
        timeout=15,
    )
    return json.loads(result.stdout)


class WaterTopologyWindingTests(unittest.TestCase):
    def test_small_far_from_origin_polygon_keeps_compiled_winding(self):
        # This real clipped TNO component is small enough for topojson's second
        # shoelace pass to lose its sign through cancellation at x ~= 40.
        ring = [
            [40.52661514, -11.35281467],
            [40.53072357, -11.36044216],
            [40.52280045, -11.35340214],
            [40.52661514, -11.35281467],
        ]
        topology = replace_water_topology_object(
            {"type": "Topology", "objects": {}, "arcs": []},
            feature_collection([[ring]]),
        )
        measured = decode_and_measure(topology, [[40.5267, -11.354], [0, 0]])
        self.assertLess(measured["area"], 1e-6)
        self.assertEqual(measured["contains"], [True, False])
        self.assertEqual(measured["parts"], 1)

    def test_mixed_large_and_tiny_components_keep_independent_local_winding(self):
        large = [[
            [35.0, -15.0],
            [35.0, -14.0],
            [36.0, -14.0],
            [36.0, -15.0],
            [35.0, -15.0],
        ]]
        tiny = [[
            [40.52661514, -11.35281467],
            [40.53072357, -11.36044216],
            [40.52280045, -11.35340214],
            [40.52661514, -11.35281467],
        ]]
        topology = replace_water_topology_object(
            {"type": "Topology", "objects": {}, "arcs": []},
            feature_collection([large, tiny]),
        )
        measured = decode_and_measure(
            topology,
            [[35.5, -14.5], [40.5267, -11.354], [0, 0]],
        )
        self.assertLess(measured["area"], 1e-3)
        self.assertEqual(measured["contains"], [True, True, False])
        self.assertEqual(measured["parts"], 2)

    def test_unquantized_encoding_drops_only_subprecision_component(self):
        normal = [[
            [-79.0, -2.0],
            [-79.0, -1.0],
            [-78.0, -1.0],
            [-78.0, -2.0],
            [-79.0, -2.0],
        ]]
        # Real stage-1 clipping residue: 3.79e-12 square degrees. TNO's source
        # topology has no transform, so grid snapping cannot remove this part.
        residue = [[
            [-80.81899398885444, -1.676930550096142],
            [-80.8190081900819, -1.6769310323103213],
            [-80.8189941615309, -1.6769300227309913],
            [-80.81899398885444, -1.676930550096142],
        ]]
        compiled = compile_water_feature_collection(feature_collection([normal, residue]))
        precision = compiled["water_geometry_precision"]
        self.assertEqual(precision["minimum_component_area_degrees2"], 1e-10)
        self.assertEqual(len(precision["removed_components"]), 1)
        self.assertEqual(precision["removed_components"][0]["id"], "water")
        self.assertEqual(precision["removed_components"][0]["component_count"], 1)
        self.assertLess(precision["removed_components"][0]["area_degrees2"], 1e-10)
        topology = replace_water_topology_object(
            {"type": "Topology", "objects": {}, "arcs": []},
            compiled,
        )
        measured = decode_and_measure(topology, [[-78.5, -1.5], [0, 0]])
        self.assertEqual(measured["parts"], 1)
        self.assertEqual(measured["contains"], [True, False])

    def test_unquantized_encoding_refuses_whole_feature_loss(self):
        residue = [[
            [-80.81899398885444, -1.676930550096142],
            [-80.8190081900819, -1.6769310323103213],
            [-80.8189941615309, -1.6769300227309913],
            [-80.81899398885444, -1.676930550096142],
        ]]
        with self.assertRaises(ValueError):
            compile_water_feature_collection(feature_collection([residue]))


if __name__ == "__main__":
    unittest.main()
