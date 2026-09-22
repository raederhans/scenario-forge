import unittest
from shapely.geometry import box, Polygon, shape
from shapely import union_all
from tools.adapt_us_county_scenarios import adapt, partition_feature, source_counties
from map_builder.regional_geometry import _encode_exact_coverage


class CountyAdaptationTests(unittest.TestCase):
    def test_unique_partition_preserves_residual_and_assignments(self):
        old = box(0, 0, 3, 1)
        props = {"id": "US_ZN_26_001", "name": "Historical district", "controller": "OCC"}
        assignments = {"owners": {props["id"]: "OLD"}, "cores": {props["id"]: ["A", "B"]}, "controllers": {}}
        features, check = partition_feature(props, old, {"US_CNTY_26001": box(0, 0, 1, 1), "US_CNTY_26003": box(1, 0, 2, 1)}, assignments)
        self.assertEqual(len(features), 3)
        self.assertEqual(len({f["properties"]["id"] for f in features}), 3)
        self.assertTrue(union_all([shape(f["geometry"]) for f in features]).equals(old))
        self.assertEqual(check["residual_area_degrees2"], 1)
        for feature in features:
            self.assertEqual(feature["properties"]["name"], props["name"])
            self.assertEqual(feature["properties"]["controller"], "OCC")
            self.assertEqual(feature["lineage"]["assignments"], {"owners": "OLD", "cores": ["A", "B"]})
        self.assertEqual(props["id"], "US_ZN_26_001")

    def test_tiny_fragment_is_not_discarded(self):
        features, _ = partition_feature({"id": "old"}, box(0, 0, 1, 1), {"US_CNTY_26001": box(0, 0, 1 - 1e-12, 1)}, {})
        self.assertEqual(len(features), 2)
        self.assertGreater(shape(features[-1]["geometry"]).area, 0)

    def test_invalid_baseline_rejected_without_repair(self):
        with self.assertRaisesRegex(ValueError, "repair is forbidden"):
            partition_feature({"id": "old"}, Polygon([(0, 0), (1, 1), (0, 1), (1, 0), (0, 0)]), {}, {})

    def test_overlapping_source_rejected(self):
        from shapely.geometry import mapping
        source = {"features": [{"properties": {"id": fid}, "geometry": mapping(geom)} for fid, geom in
                              [("US_CNTY_26001", box(0, 0, 2, 1)), ("US_CNTY_26003", box(1, 0, 3, 1))]]}
        with self.assertRaisesRegex(ValueError, "coverage"):
            source_counties(source)

    def fixture(self):
        ids = ["US_CNTY_26163__tno1962_1", "US_CNTY_26163__tno1962_2", "US_ZN_26_001", "IN_ADM2_TEST"]
        topology = _encode_exact_coverage(ids, [box(0, 0, 1, 1), box(1, 0, 2, 1), box(3, 0, 4, 1), box(5, 0, 6, 1)])
        for row, code in zip(topology["objects"]["political"]["geometries"], ["US", "US", "US", "IN"]):
            row["properties"]["cntr_code"] = code
        return ids, topology

    def test_pilot_keeps_cut_and_reports_parent_mismatch(self):
        ids, topology = self.fixture()
        collection, sidecars, report = adapt(topology, {"US_CNTY_26163": box(0, 0, 2, .75)}, {"owners": {ids[0]: "A", ids[1]: "B"}, "cores": {}, "controllers": {ids[1]: "C"}})
        self.assertEqual(len(collection["features"]), 4)
        self.assertEqual(set(sidecars["owners"]), set(ids[:2]))
        self.assertEqual(sidecars["controllers"], {ids[1]: "C"})
        self.assertEqual(report["pilot_parent_checks"][0]["children_overlap_area_degrees2"], 0)
        self.assertFalse(report["pilot_parent_checks"][0]["historical_union_equals_modern_parent"])
        self.assertEqual(report["pilot_parent_checks"][0]["historical_outside_modern_parent_area_degrees2"], .5)
        self.assertEqual(report["replaced_old_ids"], ids[:2])
        for fid, original in zip(ids[:2], [box(0, 0, 1, 1), box(1, 0, 2, 1)]):
            self.assertTrue(union_all([shape(f["geometry"]) for f in collection["features"] if f["properties"]["id"] == fid]).equals(original))

    def test_all_us_includes_uncovered_domain_without_inventing_lineage(self):
        ids, topology = self.fixture()
        collection, sidecars, report = adapt(topology, {"US_CNTY_26163": box(0, 0, 2, 1)}, {"owners": {}, "cores": {}}, all_us=True)
        self.assertEqual(len(collection["features"]), 3)
        self.assertEqual(sidecars, {"owners": {}, "cores": {}})
        self.assertEqual(report["inventory"][2]["classification"], "spatial_overlay_only_no_member_lineage")
        self.assertEqual(collection["features"][2]["lineage"]["kind"], "retained_residual")
        self.assertTrue(all(f["properties"]["id"] != f["lineage"]["old_feature_id"] for f in collection["features"]))
        self.assertNotIn(ids[-1], report["replaced_old_ids"])

    def test_run_reads_index_and_writes_patch_sidecars_with_input_binding(self):
        import hashlib
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from shapely.geometry import mapping
        from tools.adapt_us_county_scenarios import run
        ids, topology = self.fixture()
        with TemporaryDirectory() as directory:
            root = Path(directory)
            scenario = root / "data/scenarios/tno_1962"
            scenario.mkdir(parents=True)
            (scenario.parent / "index.json").write_text(json.dumps({"scenarios": [{"scenario_id": "tno_1962", "manifest_url": "data/scenarios/tno_1962/manifest.json"}]}))
            (scenario / "manifest.json").write_text(json.dumps({"runtime_topology_url": "data/scenarios/tno_1962/runtime.json"}))
            (scenario / "runtime.json").write_text(json.dumps(topology))
            (scenario / "owners.by_feature.json").write_text(json.dumps({"owners": {ids[0]: "A", ids[1]: "B"}}))
            source = root / "counties.geojson"
            source.write_text(json.dumps({"features": [{"properties": {"id": "US_CNTY_26163"}, "geometry": mapping(box(0, 0, 2, 1))}]}))
            (root / "source-report.json").write_text(json.dumps({"display_geojson_sha256": hashlib.sha256(source.read_bytes()).hexdigest()}))
            summary = run(source, root / ".runtime/output", root=root, all_us=True)
            self.assertEqual(summary[0]["features"], 3)
            output = root / ".runtime/output/tno_1962"
            report = json.loads((output / "adaptation.report.json").read_text())
            self.assertEqual(report["assignment_sidecar_present"], {"owners": True, "cores": False, "controllers": False})
            self.assertEqual(json.loads((output / "controllers.by_feature.json").read_text()), {"controllers": {}})
            owners = json.loads((output / "owners.by_feature.json").read_text())["owners"]
            self.assertEqual(owners[ids[1] + "__county_overlay_26163"], "B")
            source.write_text(source.read_text() + " ")
            with self.assertRaisesRegex(ValueError, "bind"):
                run(source, root / ".runtime/other", root=root, all_us=True)
            self.assertFalse((root / ".runtime/other").exists())

    def test_roundoff_is_measured_without_changing_geometry(self):
        from tools.adapt_us_county_scenarios import check_domain_preservation
        original = box(0, 0, 1, 1)
        perturbed = box(0, 0, 1 + 1e-13, 1)
        check = check_domain_preservation(original, perturbed)
        self.assertFalse(check["domain_exact_equal"])
        self.assertGreater(check["symmetric_difference_area_degrees2"], 0)
        self.assertGreater(check["hausdorff_distance_degrees"], 0)
        with self.assertRaisesRegex(ValueError, "within roundoff"):
            check_domain_preservation(original, box(0, 0, 1.001, 1))
        # Tiny area alone cannot approve a long narrow lost peninsula.
        thin = union_all([original, box(1, .5, 1.01, .5 + 1e-12)])
        with self.assertRaisesRegex(ValueError, "within roundoff"):
            check_domain_preservation(thin, original)

    def test_hgo_usa_country_code_is_selected_without_owner_inference(self):
        topology = _encode_exact_coverage(["HGO-S261", "HGO-S262"], [box(0, 0, 1, 1), box(2, 0, 3, 1)])
        rows = topology["objects"]["political"]["geometries"]
        rows[0]["properties"].update(cntr_code="USA", hgo_controller_tag="OTHER")
        rows[1]["properties"].update(cntr_code="CAN")
        collection, _, report = adapt(topology, {"US_CNTY_26163": box(0, 0, 1, 1)}, {"owners": {"HGO-S262": "USA"}}, all_us=True)
        self.assertEqual(report["replaced_old_ids"], ["HGO-S261"])
        self.assertEqual(collection["features"][0]["properties"]["hgo_controller_tag"], "OTHER")

    def test_output_scope_guard_precedes_source_read(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from tools.adapt_us_county_scenarios import run
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "inside root/.runtime"):
                run(root / "missing.json", root / "data/scenarios/candidate", root=root)

    def test_joint_noding_preserves_holes_and_narrow_oblique_faces(self):
        from shapely.geometry import MultiPolygon
        outer = [(0.1, 0.2), (2.7, 0.3), (2.6, 2.8), (0.2, 2.7), (0.1, 0.2)]
        hole = [(1.1, 1.1), (1.4, 1.15), (1.35, 1.4), (1.1, 1.1)]
        old = Polygon(outer, [hole])
        counties = {"US_CNTY_26001": Polygon([(-1, -1), (1.3, -1), (1.300000000001, 4), (-1, 4), (-1, -1)]),
                    "US_CNTY_26003": Polygon([(1.3, -1), (4, -1), (4, 4), (1.300000000001, 4), (1.3, -1)])}
        features, check = partition_feature({"id": "cut"}, old, counties, {})
        geometries = [shape(f["geometry"]) for f in features]
        merged = union_all(geometries)
        self.assertTrue(all(g.is_valid for g in geometries))
        self.assertLessEqual(merged.symmetric_difference(old).area, 1e-12)
        self.assertLessEqual(merged.hausdorff_distance(old), 1e-10)
        self.assertEqual(geometries[0].intersection(geometries[1]).area, 0)
        self.assertEqual(merged.intersection(Polygon(hole)).area, 0)
        self.assertTrue(check["all_pieces_valid"])

    def test_ambiguous_polygonized_face_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Ambiguous county"):
            partition_feature({"id": "cut"}, box(0, 0, 3, 1),
                              {"US_CNTY_26001": box(0, 0, 2, 1), "US_CNTY_26003": box(1, 0, 3, 1)}, {})

    def test_boundary_point_fallback_requires_entire_face_or_zero_overlap(self):
        from tools.adapt_us_county_scenarios import resolve_boundary_point_face
        face = box(1, 0, 2, 1)
        chosen, evidence = resolve_boundary_point_face(face, {"A": box(0, 0, 1, 1), "B": box(2, 0, 3, 1)}, "old")
        self.assertIsNone(chosen)
        self.assertEqual(evidence["decision"], "retained_residual_no_positive_county_overlap")
        chosen, evidence = resolve_boundary_point_face(face, {"A": face, "B": box(2, 0, 3, 1)}, "old")
        self.assertEqual(chosen, "A")
        self.assertEqual(evidence["decision"], "unique_entire_face_coverage")
        with self.assertRaisesRegex(ValueError, "Ambiguous county"):
            resolve_boundary_point_face(face, {"A": box(1, 0, 1.9, 1)}, "old")
        with self.assertRaisesRegex(ValueError, "Ambiguous county"):
            resolve_boundary_point_face(face, {"A": face, "B": box(1.9, 0, 2, 1)}, "old")

    def test_single_boundary_point_match_uses_full_face_evidence(self):
        # Simulate a representative point rounded onto the only county boundary.
        # The whole face is actually outside it and must remain residual.
        from unittest.mock import patch
        from shapely.geometry import Point
        from tools.adapt_us_county_scenarios import resolve_boundary_point_face
        face = box(1, 0, 2, 1)
        county = box(0, 0, 1, 1)
        from shapely.geometry.base import BaseGeometry
        original_point = BaseGeometry.representative_point
        def rounded_point(geometry):
            return Point(1, .5) if geometry.equals(face) else original_point(geometry)
        with patch("shapely.geometry.base.BaseGeometry.representative_point", rounded_point):
            features, report = partition_feature({"id": "old"}, face, {"US_CNTY_26001": county}, {})
        self.assertEqual(len(features), 1)
        self.assertIsNone(features[0]["lineage"]["modern_county_id"])
        self.assertEqual(report["boundary_point_fallbacks"][0]["point_matches"], ["US_CNTY_26001"])
        self.assertEqual(report["boundary_point_fallbacks"][0]["decision"], "retained_residual_no_positive_county_overlap")

    def test_only_strict_point_extent_parts_are_ignored_and_reported(self):
        topology = _encode_exact_coverage(["US_ZN_36_015"], [box(0, 0, 1, 1)])
        row = topology["objects"]["political"]["geometries"][0]
        arcs = row["arcs"]
        index = len(topology["arcs"])
        topology["arcs"].append([[3, 4], [3, 4]])
        row.update(type="MultiPolygon", arcs=[arcs, [[index]]])
        collection, _, report = adapt(topology, {"US_CNTY_36029": box(0, 0, 1, 1)}, {}, all_us=True)
        self.assertEqual(len(collection["features"]), 1)
        self.assertEqual(report["partition_checks"][0]["ignored_zero_extent_parts"], 1)
        self.assertTrue(shape(collection["features"][0]["geometry"]).equals(box(0, 0, 1, 1)))

    def test_generated_id_collision_rejected(self):
        ids, topology = self.fixture()
        topology["objects"]["political"]["geometries"][-1]["properties"]["id"] = ids[0] + "__county_overlay_26163"
        with self.assertRaisesRegex(ValueError, "collide"):
            adapt(topology, {"US_CNTY_26163": box(0, 0, 2, 1)}, {}, all_us=True)


if __name__ == "__main__":
    unittest.main()
