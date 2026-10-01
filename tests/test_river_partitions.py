import copy
from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import random
import tempfile
import unittest

from shapely.geometry import Polygon, MultiPolygon, LineString, box, mapping, shape
from shapely.ops import unary_union
from tools.build_river_partitions import (
    build_pack, canonical_geometry, decode_features, geometry_fingerprint,
    partition_parent, select_rivers, node_contour_neighbors, main,
)
from tools.river_partitions.admission import compare_packs, read_selections


def feature(geometry, fid="P"):
    return {"type": "Feature", "properties": {"id": fid}, "geometry": mapping(geometry)}


class RiverPartitionTests(unittest.TestCase):
    def test_crossing_preserves_parent(self):
        f = feature(box(0, 0, 2, 2))
        before = copy.deepcopy(f)
        entry, report = partition_parent(f, [LineString([(-1, 1), (3, 1)])])
        self.assertEqual(report["status"], "partitioned")
        self.assertEqual(len(entry["cells"]), 2)
        self.assertEqual(f, before)
        self.assertTrue(unary_union([shape(c["geometry"]) for c in entry["cells"]]).equals(shape(f["geometry"])))

    def test_interior_endpoint_does_not_invent_cut(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(-1, 1), (1, 1)])])
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "uncut")

    def test_existing_border_is_not_a_partition(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(0, 0), (2, 0)])])
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "uncut")

    def test_multiple_crossings_retain_every_piece(self):
        line = LineString([(-1, .5), (3, .5), (3, 1.5), (-1, 1.5)])
        entry, _ = partition_parent(feature(box(0, 0, 2, 2)), [line])
        self.assertEqual(len(entry["cells"]), 3)

    def test_hole_is_not_filled(self):
        polygon = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (1, 3), (3, 3), (3, 1)]])
        entry, report = partition_parent(feature(polygon), [LineString([(-1, 2), (5, 2)])])
        self.assertEqual(report["status"], "partitioned")
        combined = unary_union([shape(c["geometry"]) for c in entry["cells"]])
        self.assertEqual(combined.area, polygon.area)
        self.assertEqual(combined.intersection(box(1, 1, 3, 3)).area, 0)

    def test_disconnected_original_is_not_a_new_cut(self):
        polygon = MultiPolygon([box(0, 0, 1, 1), box(2, 0, 3, 1)])
        entry, report = partition_parent(feature(polygon), [LineString([(0, 0), (3, 0)])])
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "uncut")

    def test_rejects_invalid_and_global_geometry(self):
        bowtie = Polygon([(0, 0), (2, 2), (0, 2), (2, 0), (0, 0)])
        for polygon in (bowtie, box(-179, 0, 179, 2), box(0, 85, 1, 86)):
            entry, report = partition_parent(feature(polygon), [LineString([(-1, 1), (3, 1)])])
            self.assertIsNone(entry)
            self.assertEqual(report["status"], "rejected")

    def test_no_sliver_deletion(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(-1, .00001), (3, .00001)])])
        self.assertEqual(report["status"], "partitioned")
        self.assertEqual(len(entry["cells"]), 2)
        self.assertLess(min(shape(c["geometry"]).area for c in entry["cells"]), .0001)

    def test_partition_budget_rejects_instead_of_truncating(self):
        entry, report = partition_parent(feature(box(0, 0, 2, 2)),
                                         [LineString([(-1, .5), (3, .5)]), LineString([(-1, 1.5), (3, 1.5)])], max_parts=2)
        self.assertIsNone(entry)
        self.assertEqual(report["status"], "rejected")

    def test_stable_identity_under_ring_reversal_and_line_order(self):
        f = feature(box(0, 0, 2, 2))
        reverse = copy.deepcopy(f)
        reverse["geometry"]["coordinates"] = [list(reversed(r)) for r in f["geometry"]["coordinates"]]
        self.assertEqual(geometry_fingerprint(f["geometry"]), geometry_fingerprint(reverse["geometry"]))
        a = LineString([(-1, .5), (3, .5)])
        b = LineString([(-1, 1.5), (3, 1.5)])
        left, _ = partition_parent(f, [a, b])
        right, _ = partition_parent(reverse, [LineString(list(b.coords)[::-1]), a])
        self.assertEqual([c["id"] for c in left["cells"]], [c["id"] for c in right["cells"]])

    def test_decode_delta_and_reverse_arcs(self):
        topology = {"type": "Topology", "transform": {"scale": [1, 1], "translate": [10, 20]},
                    "arcs": [[[0, 0], [2, 0], [0, 2]], [[0, 0], [0, 2], [2, 0]]],
                    "objects": {"political": {"type": "GeometryCollection", "geometries": [
                        {"type": "Polygon", "properties": {"id": "P"}, "arcs": [[0, -2]]}]}}}
        decoded = decode_features(topology)
        self.assertEqual(shape(decoded[0]["geometry"]).area, 4)
        self.assertEqual(decoded[0]["geometry"]["coordinates"][0][0], [10, 20])

    def test_river_selection_is_explicit(self):
        rivers = [{"type": "Feature", "properties": {"name": "Volga", "featurecla": kind},
                   "geometry": mapping(LineString([(i, 0), (i, 2)]))}
                  for i, kind in enumerate(["River", "Lake Centerline", "Canal"])]
        self.assertEqual(len(select_rivers(rivers, ["volga"])), 1)
        self.assertEqual(len(select_rivers(rivers, ["Volga"], True)), 2)
        with self.assertRaises(ValueError):
            select_rivers(rivers, ["missing"])

    def test_pack_requires_unique_ids_and_source_scope(self):
        f = feature(box(0, 0, 2, 2))
        river = [LineString([(-1, 1), (3, 1)])]
        with self.assertRaises(ValueError):
            build_pack([f, f], river, scene_id="test", source={})
        with self.assertRaises(ValueError):
            build_pack([f], river, scene_id="test", source={}, parent_ids={"missing"})
        a, _ = build_pack([f], river, scene_id="test", source={"revision": "1"})
        b, _ = build_pack([f], river, scene_id="other", source={"revision": "1"})
        self.assertNotEqual(a["packId"], b["packId"])

    def test_stendal_joint_noding_regression(self):
        fixture = json.loads((Path(__file__).parent / "fixtures/river_paint/stendal.json").read_text())
        lines = select_rivers(fixture["rivers"], ["Elbe"])
        entry, report = partition_parent(fixture["parent"], lines)
        self.assertEqual(report["status"], "partitioned")
        self.assertEqual(len(entry["cells"]), fixture["expectedCells"])
        self.assertEqual(report["symmetricDifferenceDegrees2"], 0)
        self.assertEqual(report["overlapDegrees2"], 0)

    def test_neighbor_noding_preserves_domain_and_cut_endpoint(self):
        left = feature(box(0, 0, 2, 2), "P")
        right = feature(box(2, 0, 4, 2), "N")
        entry, _ = partition_parent(left, [LineString([(-1, .375), (3, .375)])])
        original = copy.deepcopy(right)
        support, checks = node_contour_neighbors([left, right], [entry])
        self.assertEqual(len(support), 1)
        self.assertEqual(right, original)
        self.assertTrue(shape(support[0]["geometry"]).equals(shape(right["geometry"])))
        self.assertIn((2, .375), list(shape(support[0]["geometry"]).exterior.coords))
        self.assertEqual(checks[0]["symmetricDifferenceDegrees2"], 0)

    def test_seeded_crossings_preserve_coverage(self):
        rng = random.Random(191)
        for _ in range(80):
            y = rng.uniform(.01, 1.99)
            entry, report = partition_parent(feature(box(0, 0, 2, 2)), [LineString([(-1, y), (3, y)])])
            self.assertEqual(report["status"], "partitioned")
            self.assertEqual(report["overlapDegrees2"], 0)
            self.assertLessEqual(report["symmetricDifferenceDegrees2"], 1e-12)


class RiverAdmissionTests(unittest.TestCase):
    def setUp(self):
        runtime = Path(".runtime/tmp")
        runtime.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="rv-", dir=runtime)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fixture = json.loads((Path(__file__).parent / "fixtures/river_paint/stendal.json").read_text())
        self.land = self.write("land.json", {"type": "FeatureCollection", "features": [self.fixture["parent"]]})
        self.rivers = self.write("rivers.json", {"type": "FeatureCollection", "features": self.fixture["rivers"]})
        self.source = {
            "landDigest": "sha256:" + hashlib.sha256(self.land.read_bytes()).hexdigest(),
            "riverDigest": "sha256:" + hashlib.sha256(self.rivers.read_bytes()).hexdigest(),
            "includeLakeCenterlines": False, "riverNames": ["Elbe"],
        }
        self.selection = {"schemaVersion": 1, "sceneId": "test", "source": {
            key: self.source[key] for key in ("landDigest", "riverDigest")},
            "parents": ["DEE0D"], "rivers": ["Elbe"]}

    def write(self, name, document):
        path = self.root / name
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def cli(self, output, *flags):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return main(["--land", str(self.land), "--rivers", str(self.rivers),
                         "--scene-id", "test", "--output", str(output), *map(str, flags)])

    def resolve(self, *paths, parents=None, rivers=None):
        return read_selections(list(paths), parents or [], rivers or [], scene_id="test", source=self.source)

    def small_pack(self, ids=("P",)):
        land = [feature(box(0, 0, 2, 2), "P"), feature(box(2, 0, 4, 2), "N")]
        pack, report = build_pack(land, [LineString([(-1, .375), (5, .375)])],
                                  scene_id="test", source=self.source, parent_ids=set(ids))
        return pack, report

    def test_real_fixture_selection_and_legacy_cli_are_byte_identical(self):
        selection = self.write("selection.json", self.selection)
        left, right = self.root / "flags.json", self.root / "list.json"
        self.cli(left, "--parent", "DEE0D", "--river", "Elbe")
        self.cli(right, "--selection", selection, "--compare-against", left)
        self.assertEqual(left.read_bytes(), right.read_bytes())
        report = json.loads(right.with_suffix(".audit.json").read_text())
        self.assertEqual(report["parentCount"], 1)
        self.assertEqual(report["cellCount"], self.fixture["expectedCells"])
        self.assertEqual(report["packBytes"], len(right.read_bytes()))
        self.assertEqual(report["oldParentCount"], 1)
        self.assertEqual(report["newParentCount"], 0)
        self.assertTrue(report["compatibilityPassed"])
        self.assertEqual(report["geometryIssues"], {})

    def test_selection_source_mismatch_fails_before_geometry_build(self):
        for key, value in (("landDigest", "sha256:wrong"), ("riverDigest", "sha256:wrong")):
            selection = copy.deepcopy(self.selection)
            selection["source"][key] = value
            with self.subTest(key=key):
                output = self.root / "bad.json"
                with self.assertRaises(SystemExit) as exc:
                    self.cli(output, "--selection", self.write("selection.json", selection))
                self.assertEqual(exc.exception.code, 2)
                self.assertFalse(output.exists())
                self.assertFalse(output.with_suffix(".audit.json").exists())

    def test_selection_scene_and_optional_source_identity_checked(self):
        for key, value in (("landObject", "other"), ("includeLakeCenterlines", True), ("baselineHash", "other")):
            selection = copy.deepcopy(self.selection)
            selection["source"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.resolve(self.write("selection.json", selection))
        selection = copy.deepcopy(self.selection)
        selection["sceneId"] = "other"
        with self.assertRaises(ValueError):
            self.resolve(self.write("selection.json", selection))

    def test_malformed_and_empty_selections_rejected(self):
        for patch in ({"schemaVersion": 2}, {"schemaVersion": True}, {"parents": []},
                      {"parents": "DEE0D"}, {"rivers": []}, {"source": {}}, {"parent": ["DEE0D"]}):
            selection = {**self.selection, **patch}
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.resolve(self.write("selection.json", selection))

    def test_duplicate_parent_and_river_rejected(self):
        for patch in ({"parents": ["DEE0D", "DEE0D"]}, {"rivers": ["Elbe", " elbe "]}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                self.resolve(self.write("selection.json", {**self.selection, **patch}))
        path = self.write("selection.json", self.selection)
        with self.assertRaises(ValueError):
            self.resolve(path, path)
        with self.assertRaises(ValueError):
            self.resolve(path, parents=["DEE0D"])
        for flags in (("--parent", "DEE0D", "--parent", "DEE0D", "--river", "Elbe"),
                      ("--parent", "DEE0D", "--river", "Elbe", "--river", "elbe")):
            with self.subTest(flags=flags), self.assertRaises(SystemExit):
                self.cli(self.root / "bad.json", *flags)

    def test_regional_files_union_shared_rivers_but_not_parent_ownership(self):
        one = self.write("one.json", self.selection)
        two = self.write("two.json", {**self.selection, "parents": ["N"], "rivers": ["Elbe", "Seine"]})
        self.assertEqual(self.resolve(one, two), (["DEE0D", "N"], ["Elbe", "Seine"]))

    def test_unknown_parents_and_rivers_fail_without_outputs(self):
        for flags in (("--parent", "missing", "--river", "Elbe"),
                      ("--parent", "DEE0D", "--river", "missing"), ("--parent", "DEE0D")):
            output = self.root / "bad.json"
            with self.subTest(flags=flags), self.assertRaises(SystemExit):
                self.cli(output, *flags)
            self.assertFalse(output.exists())

    def test_no_intersection_auxiliary_uncut_and_rejected_are_counted(self):
        land = [feature(box(0, 0, 2, 2), "cut"), feature(box(0, 5, 2, 7), "away"),
                feature(box(4, 0, 6, 2), "uncut"), feature(box(7, 0, 9, 2), "aux"),
                feature(Polygon([(0, 0), (2, 2), (0, 2), (2, 0)]), "invalid")]
        land[-2]["properties"]["interactive"] = False
        lines = [LineString([(-1, 1), (5, 1)])]
        pack, report = build_pack(land, lines, scene_id="test", source={}, parent_ids={f["properties"]["id"] for f in land})
        self.assertEqual(report["summary"], {"partitioned": 1, "no_intersection": 1,
                                           "uncut": 1, "excluded_auxiliary": 1, "rejected": 1})
        self.assertEqual(report["examinedParentCount"], 5)
        self.assertEqual(report["excludedParentCount"], 4)
        self.assertEqual(report["geometryIssues"], {"invalid_parent": 1})
        reordered, reordered_report = build_pack(list(reversed(land)), lines, scene_id="test", source={}, parent_ids={f["properties"]["id"] for f in land})
        self.assertEqual(pack, reordered)
        self.assertEqual(report, reordered_report)

    def test_empty_or_duplicate_explicit_build_scope_rejected(self):
        for parents in (set(), ["P", "P"]):
            with self.subTest(parents=parents), self.assertRaises(ValueError):
                build_pack([feature(box(0, 0, 2, 2))], [], scene_id="test", source={}, parent_ids=parents)

    def test_support_promotion_does_not_fail_old_parent_stability(self):
        baseline, _ = self.small_pack()
        expanded, _ = self.small_pack(("P", "N"))
        report = compare_packs(expanded, baseline)
        self.assertTrue(report["passed"])
        self.assertEqual(report["oldParentCount"], 1)
        self.assertEqual(report["newParentCount"], 1)
        self.assertEqual(report["supportComparison"]["promotedToParent"], ["N"])
        self.assertFalse(report["supportComparison"]["affectsParentStabilityVerdict"])

    def test_exact_geometry_changes_fail_even_if_fingerprint_unchanged(self):
        baseline, _ = self.small_pack()
        for field in ("parentGeometry", "cells"):
            changed = copy.deepcopy(baseline)
            geom = changed["parents"][0][field] if field == "parentGeometry" else changed["parents"][0]["cells"][0]["geometry"]
            geom["coordinates"] = json.loads(json.dumps(geom["coordinates"]))
            geom["coordinates"][0][0][0] += 1e-10
            with self.subTest(field=field):
                report = compare_packs(changed, baseline)
                self.assertFalse(report["passed"])
                self.assertEqual(len(report["changedParents"]), 1)

    def test_missing_parent_and_changed_cell_id_fail(self):
        baseline, _ = self.small_pack()
        changed = copy.deepcopy(baseline)
        changed["parents"][0]["cells"][0]["id"] += "changed"
        self.assertIn("cellIds", compare_packs(changed, baseline)["changedParents"][0]["changes"])
        changed["parents"] = []
        self.assertEqual(compare_packs(changed, baseline)["missingParents"], ["P"])

    def test_comparison_contract_and_source_mismatches_fail(self):
        baseline, _ = self.small_pack()
        for key in ("sceneId", "algorithmVersion", "coordinateIdentityPrecision", "geometryWinding"):
            changed = copy.deepcopy(baseline)
            changed[key] = "wrong"
            with self.subTest(key=key), self.assertRaises(ValueError):
                compare_packs(changed, baseline)
        for key in ("landDigest", "riverDigest", "includeLakeCenterlines", "riverNames"):
            changed = copy.deepcopy(baseline)
            changed["source"][key] = [] if key == "riverNames" else "wrong"
            with self.subTest(key=key), self.assertRaises(ValueError):
                compare_packs(changed, baseline)

    def test_cli_comparison_failure_keeps_audit_and_existing_pack(self):
        old_output = self.root / "old.json"
        self.cli(old_output, "--parent", "DEE0D", "--river", "Elbe")
        baseline = json.loads(old_output.read_text())
        baseline["parents"][0]["cells"][0]["id"] += "changed"
        self.write("old.json", baseline)
        output = self.root / "candidate.json"
        output.write_text("prior output", encoding="utf-8")
        with self.assertRaises(SystemExit) as exc:
            self.cli(output, "--parent", "DEE0D", "--river", "Elbe", "--compare-against", old_output)
        self.assertEqual(exc.exception.code, 2)
        self.assertEqual(output.read_text(), "prior output")
        self.assertFalse(json.loads(output.with_suffix(".audit.json").read_text())["compatibilityPassed"])

    def test_cli_comparison_requires_all_old_parents_and_source_identity(self):
        baseline, _ = self.small_pack()
        path = self.write("baseline.json", baseline)
        with self.assertRaises(SystemExit):
            self.cli(self.root / "candidate.json", "--parent", "DEE0D", "--river", "Elbe", "--compare-against", path)
        baseline["source"]["landDigest"] = "wrong"
        self.write("baseline.json", baseline)
        with self.assertRaises(SystemExit):
            self.cli(self.root / "candidate.json", "--parent", "DEE0D", "--river", "Elbe", "--compare-against", path)

    def test_cli_cannot_overwrite_source_selection_baseline_or_audit(self):
        selection = self.write("selection.json", self.selection)
        for output in (self.land, self.rivers, selection):
            with self.subTest(output=output), self.assertRaises(SystemExit):
                self.cli(output, "--selection", selection)
        audit_selection = self.write("guard.audit.json", self.selection)
        with self.assertRaises(SystemExit):
            self.cli(self.root / "guard.json", "--selection", audit_selection)
        baseline = self.root / "baseline.json"
        self.cli(baseline, "--selection", selection)
        before = baseline.read_bytes()
        with self.assertRaises(SystemExit):
            self.cli(baseline, "--selection", selection, "--compare-against", baseline)
        self.assertEqual(baseline.read_bytes(), before)

    def test_checked_in_wave2_selection_has_explicit_stable_scope(self):
        path = Path(__file__).parent / "river_partitions/wave2-selection.json"
        selection = json.loads(path.read_text(encoding="utf-8"))
        parents, names = read_selections([path], [], [], scene_id="modern_world", source=selection["source"])
        self.assertEqual(len(parents), 12)
        self.assertEqual(len(names), 6)
        self.assertTrue(selection["source"]["includeLakeCenterlines"])


if __name__ == "__main__":
    unittest.main()
