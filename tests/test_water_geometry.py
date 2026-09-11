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
    def test_south_indian_long_latitude_edge_stays_out_of_antarctica(self):
        source = collection(box(20, -60.54, 147, -10))
        compiled = compile_water_feature_collection(source)
        self.assertEqual(contains(compiled["features"], [[80, -70], [90, -75], [80, -40]]), [[False, False, True]])
        self.assertEqual(compiled["features"][0]["properties"], source["features"][0]["properties"])
        self.assertEqual(source["features"][0]["geometry"], mapping(box(20, -60.54, 147, -10)))

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

    def test_collinear_shared_boundary_with_different_segmentation(self):
        a = Polygon([(0, 0), (3, 3), (0, 3), (0, 0)])
        b = Polygon([(0, 0), (3, 0), (3, 3), (1.33, 1.33), (0, 0)])
        compiled = compile_water_feature_collection(collection(a, b))
        edge_sets = [{tuple(p) for p in f["geometry"]["coordinates"][0] if p[0] == p[1]} for f in compiled["features"]]
        self.assertEqual(edge_sets[0], edge_sets[1])
        self.assertIn((1.33, 1.33), edge_sets[0])

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

    def test_quantized_diagonal_topology_is_idempotent(self):
        topology = {"type": "Topology", "transform": {"scale": [0.036, 0.01736], "translate": [-180, -90]},
                    "arcs": [[[5020, 3000], [790, 1250], [-800, 250], [10, -1500]]],
                    "objects": {"water_regions": {"type": "Polygon", "arcs": [[0]]}}}
        compiled = densify_water_topology(topology)
        self.assertEqual(densify_water_topology(compiled), compiled)
        self.assertEqual(len(compiled["arcs"]), 1)

    def test_additional_marine_classification_and_lake_exclusion(self):
        for field, value in [("water_type", "channel"), ("water_type", "bight"),
                             ("water_type", "marine_region"), ("region_group", "marine_macro"),
                             ("region_group", "marine_detail"), ("region_group", "ocean_macro")]:
            source = collection(box(0, 0, 10, 10), kind="")
            source["features"][0]["properties"][field] = value
            compiled = compile_water_feature_collection(source, ocean_mask=box(0, 0, 5, 10))
            self.assertAlmostEqual(shape(compiled["features"][0]["geometry"]).area, 50)
        source = collection(box(0, 0, 10, 10), kind="lake")
        source["features"][0]["properties"]["region_group"] = "marine_detail"
        compiled = compile_water_feature_collection(source, ocean_mask=box(0, 0, 5, 10))
        self.assertAlmostEqual(shape(compiled["features"][0]["geometry"]).area, 100)

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

    def test_base_grid_poles_quantize_inward_without_spherical_fold(self):
        topology = {"type": "Topology", "transform": {
            "scale": [0.03600360036, 0.0173616861686], "translate": [-180, -89.9999]},
            "arcs": [[[5000, 3000], [50, 60], [-50, -60]]],
            "objects": {"political": {"type": "LineString", "arcs": [0]}}}
        compiled = compile_water_feature_collection(collection(box(-180, 83.6, 180, 90), box(-180, -90, 180, -83.6)))
        replaced = replace_water_topology_object(topology, compiled)
        decoded = decode(replaced)
        self.assertEqual(decoded["political"], decode(topology)["political"])
        features = decoded["water_regions"]["features"]
        for feature in features:
            for ring in feature["geometry"]["coordinates"]:
                for lon, lat in ring:
                    self.assertTrue(-180 <= lon <= 180)
                    self.assertTrue(-90 <= lat <= 90)
        self.assertEqual(contains(features, [[0, 89.999], [179.99, 89.999], [-179.99, 89.999],
                                             [0, -89.999], [0, 0]]),
                         [[True, True, True, False, False], [False, False, False, True, False]])
        self.assertEqual(replace_water_topology_object(replaced, compiled), replaced)

    def test_unquantized_replacement_preserves_shared_water_and_land(self):
        topology = {"type": "Topology", "arcs": [[[0, 0], [0, 2], [2, 2], [0, 0]]],
                    "objects": {"land": {"type": "Polygon", "arcs": [[0]]}}}
        compiled = compile_water_feature_collection(collection(box(10, 0, 20, 10), box(20, 0, 30, 10)))
        replaced = replace_water_topology_object(topology, compiled)
        self.assertNotIn("transform", replaced)
        self.assertEqual(decode(replaced)["land"], decode(topology)["land"])
        geometries = replaced["objects"]["water_regions"]["geometries"]
        refs = [{arc if arc >= 0 else ~arc for ring in g["arcs"] for arc in ring} for g in geometries]
        self.assertTrue(refs[0] & refs[1], "Adjacent water polygons must share the encoded boundary arc")
        self.assertEqual(replace_water_topology_object(replaced, compiled), replaced)

    def test_clipped_empty_feature_keeps_identity_through_topology_encoding(self):
        source = collection(box(0, 0, 1, 1), box(10, 10, 20, 20))
        compiled = compile_water_feature_collection(source, ocean_mask=box(5, 5, 30, 30))
        self.assertEqual(compiled["features"][0]["geometry"], {"type": "MultiPolygon", "coordinates": []})
        encoded = replace_water_topology_object({"type": "Topology", "objects": {}, "arcs": []}, compiled)
        features = decode(encoded)["water_regions"]["features"]
        self.assertEqual([f["id"] for f in features], ["0", "1"])
        self.assertEqual(features[0]["geometry"], {"type": "MultiPolygon", "coordinates": []})
        self.assertEqual(features[0]["properties"], source["features"][0]["properties"])

    def test_snap_rounding_removes_subgrid_component_and_short_shared_arc(self):
        from shapely.geometry import MultiPolygon
        # A mask intersection leaves an almost-zero shared segment at y=1.
        left = Polygon([(0, 0), (1, 0), (1, 0.999999), (1, 1), (1, 2), (0, 2), (0, 0)])
        right = Polygon([(1, 0), (2, 0), (2, 2), (1, 2), (1, 1), (1, 0.999999), (1, 0)])
        tiny = box(3.00001, 0.00001, 3.00003, 0.00003)
        compiled = compile_water_feature_collection(collection(MultiPolygon([left, tiny]), right))
        topology = {"type": "Topology", "arcs": [], "objects": {},
                    "transform": {"scale": [0.0001, 0.0001], "translate": [0, 0]}}
        replaced = replace_water_topology_object(topology, compiled)
        features = decode(replaced)["water_regions"]["features"]
        geometries = [shape(f["geometry"]) for f in features]
        self.assertTrue(all(g.is_valid for g in geometries))
        self.assertAlmostEqual(geometries[0].intersection(geometries[1]).area, 0)
        self.assertAlmostEqual(geometries[0].union(geometries[1]).area, 4)
        measurements = replaced["water_geometry_quantization"]["features"]
        self.assertEqual(measurements[0]["source_components"], 2)
        self.assertEqual(measurements[0]["result_components"], 1)
        self.assertLess(measurements[0]["symmetric_difference_area_degrees2"], 1e-9)
        self.assertEqual(contains(features, [[0.5, 1], [1.5, 1]]), [[True, False], [False, True]])
        self.assertEqual(replace_water_topology_object(replaced, compiled), replaced)

    def test_snap_rounding_refuses_entire_feature_loss(self):
        compiled = collection(box(0, 0, 0.0000001, 0.0000001))
        topology = {"type": "Topology", "arcs": [], "objects": {},
                    "transform": {"scale": [0.0001, 0.0001], "translate": [0, 0]}}
        with self.assertRaisesRegex(ValueError, "feature.*collapsed"):
            replace_water_topology_object(topology, compiled)

    def test_compilation_keeps_original_high_precision_vertices(self):
        polygon = Polygon([(109.8280982809834, 55.5429957679581),
                           (110.12345678901234, 55.6), (110.1, 56.1),
                           (109.8280982809834, 55.5429957679581)])
        compiled = compile_water_feature_collection(collection(polygon))
        output = shape(compiled["features"][0]["geometry"])
        self.assertTrue(output.is_valid)
        self.assertTrue(set(polygon.exterior.coords).issubset(set(output.exterior.coords)))

    def test_degree_crossing_near_snapped_endpoint_is_on_grid_before_encoding(self):
        from map_builder.geo.water_geometry import _snap_water_to_transform
        transform = {"scale": [0.0036000360003600037 / 256, 0.001687919879198792 / 256],
                     "translate": [-180.0, -85.1907]}
        endpoint = (98.22568850688509, 10.749999996519492)
        crossing = (98.225688506191, 10.75)
        compiled = compile_water_feature_collection(collection(
            Polygon([endpoint, (98.4, 9.9), (99, 10.5), endpoint]),
            Polygon([endpoint, (99, 10.5), (99, 11.5), crossing, endpoint])))
        snapped, _ = _snap_water_to_transform(compiled, transform)
        for feature in snapped["features"]:
            for ring in shape(feature["geometry"]).exterior.coords:
                for coordinate, origin, scale in zip(ring, transform["translate"], transform["scale"]):
                    lattice = (coordinate - origin) / scale
                    self.assertAlmostEqual(lattice, round(lattice), delta=1e-8)
        topology = {"type": "Topology", "objects": {}, "arcs": [], "transform": transform}
        encoded = replace_water_topology_object(topology, compiled)
        self.assertEqual(replace_water_topology_object(encoded, compiled), encoded)
        self.assertTrue(all(shape(f["geometry"]).is_valid for f in decode(encoded)["water_regions"]["features"]))

    def test_unquantized_lillebaelt_hole_spike_and_canonical_diagnostic_id(self):
        hole = [(9.8041, 55.3241), (9.7983, 55.327), (9.7892, 55.3216),
                (9.790231114427, 55.316696945686), (9.790446285348, 55.315673785997),
                (9.7941, 55.2983), (9.807804638193, 55.299627514811),
                (9.819257036322, 55.300736863917), (9.8292, 55.3017),
                (9.828976711387, 55.302645692948), (9.826054521734, 55.315022025599),
                (9.8241, 55.3233), (9.823426119199, 55.323326955232),
                (9.81823804253, 55.323534478299), (9.8041, 55.3241),
                (9.809498391177, 55.321400804412), (9.8041, 55.3241)]
        source = collection(Polygon(box(9.7, 55.2, 9.9, 55.4).exterior.coords, [hole]))
        source["features"][0]["id"] = "5"
        source["features"][0]["properties"]["id"] = "tno_lillebaelt"
        self.assertFalse(shape(source["features"][0]["geometry"]).is_valid)
        topology = {"type": "Topology", "objects": {}, "arcs": []}
        encoded = replace_water_topology_object(topology, source)
        decoded = decode(encoded)["water_regions"]["features"][0]
        self.assertTrue(shape(decoded["geometry"]).is_valid)
        self.assertEqual(decoded["id"], "5")
        self.assertEqual(encoded["water_geometry_quantization"]["features"][0]["id"], "tno_lillebaelt")
        self.assertEqual(contains([decoded], [[9.75, 55.25], [9.81, 55.31]]), [[True, False]])

    def test_unquantized_shared_boundary_has_exact_zero_overlap(self):
        left = Polygon([(0, 0), (1, 1), (0, 2), (0, 0)])
        right = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (1 - 1e-14, 1), (0, 0)])
        self.assertGreater(left.intersection(right).area, 0)
        encoded = replace_water_topology_object({"type": "Topology", "objects": {}, "arcs": []}, collection(left, right))
        features = decode(encoded)["water_regions"]["features"]
        left, right = [shape(feature["geometry"]) for feature in features]
        self.assertTrue(left.is_valid and right.is_valid)
        self.assertEqual(left.intersection(right).area, 0)

    def test_wrapped_coordinates_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError, "EPSG"):
            compile_water_feature_collection(collection(box(170, 0, 190, 10)))


if __name__ == "__main__":
    unittest.main()
