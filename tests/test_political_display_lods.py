import gzip
import hashlib
import json
import shutil
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from math import sin
from shapely.geometry import Polygon, mapping, shape
from shapely.errors import GEOSException
from shapely.ops import unary_union
from tools.build_political_display_lods import simplify_coverage_features, cached_simplify_coverage_features, build_overlay, coordinate_count


def fixture():
    edge = [(1 + (0.001 * sin(i) if 0 < i < 40 else 0), i / 40) for i in range(41)]
    a = Polygon([(0, 0), *edge, (0, 1), (0, 0)])
    b = Polygon([(2, 0), (2, 1), *edge[::-1], (2, 0)], holes=[[(1.3, .2), (1.5, .2), (1.5, .4), (1.3, .4), (1.3, .2)]])
    return [{"type": "Feature", "properties": {"id": fid, "owner": "X"}, "geometry": mapping(g)} for fid, g in [("a", a), ("b", b)]]


class DisplayLodTests(unittest.TestCase):
    def test_shared_interiors_preserve_union_holes_identity_and_source(self):
        features = fixture()
        original = json.dumps(features)
        result, report = simplify_coverage_features(features, .02)
        self.assertEqual(report["status"], "simplified")
        self.assertLess(report["output_points"], report["input_points"])
        self.assertEqual(json.dumps(features), original)
        self.assertTrue(unary_union([shape(f["geometry"]) for f in result]).equals(unary_union([shape(f["geometry"]) for f in features])))
        self.assertEqual([f["properties"] for f in features], [f["properties"] for f in result])
        self.assertEqual(len(shape(result[1]["geometry"]).interiors), 1)
        self.assertLessEqual(report["max_deviation_degrees"], .02)

    def test_protected_feature_and_its_neighbours_shared_border_are_exact(self):
        features = fixture()
        result, report = simplify_coverage_features(features, .02, ["a"])
        self.assertEqual(result, features)
        self.assertEqual(report["status"], "unchanged")
        self.assertEqual([item["retention_reason"] for item in report["feature_diagnostics"]],
                         ["protected", "no-point-reduction"])

    def test_overlapping_invalid_coverage_falls_back_without_repair(self):
        features = fixture()
        features[1]["geometry"] = features[0]["geometry"]
        result, report = simplify_coverage_features(features, .02)
        self.assertIs(result, features)
        self.assertEqual(report["reason"], "invalid-source-coverage")

    def test_invalid_components_stay_exact_while_disjoint_valid_coverage_simplifies(self):
        features = fixture()
        invalid = mapping(Polygon([(10, 0), (11, 0), (11, 1), (10, 1)]))
        features.extend([{"type": "Feature", "properties": {"id": fid}, "geometry": invalid}
                         for fid in ("overlap-a", "overlap-b")])
        result, report = simplify_coverage_features(features, .02)
        self.assertEqual(report["status"], "simplified")
        self.assertEqual(set(report["retained_exact_ids"]), {"overlap-a", "overlap-b"})
        costs = report["retention_costs"]
        overlap_cost = next(item for item in costs if item["reason"] == "invalid-coverage-boundary")
        self.assertEqual(overlap_cost["feature_count"], 2)
        self.assertEqual(overlap_cost["coordinate_count"], 2 * coordinate_count(invalid))
        self.assertIs(result[2], features[2])
        self.assertIs(result[3], features[3])
        self.assertLess(report["output_points"], report["input_points"])
        self.assertTrue(unary_union([shape(f["geometry"]) for f in result[:2]]).equals(
            unary_union([shape(f["geometry"]) for f in features[:2]])))

    def test_retention_diagnostics_record_actual_branches_and_coordinate_costs(self):
        features = fixture()
        extras = [
            ("invalid", mapping(Polygon([(10, 0), (11, 1), (10, 1), (11, 0), (10, 0)]))),
            ("date", mapping(Polygon([(-179, 0), (179, 0), (179, 1), (-179, 1)]))),
            ("protected", mapping(Polygon([(20, 0), (21, 0), (21, 1), (20, 1)]))),
            ("point", {"type": "Point", "coordinates": [30, 0]}),
        ]
        features.extend({"type": "Feature", "properties": {"id": fid}, "geometry": geometry}
                        for fid, geometry in extras)
        result, report = simplify_coverage_features(features, .02, ["protected"])
        self.assertEqual(report["status"], "simplified")
        self.assertEqual([item["retention_reason"] for item in report["feature_diagnostics"][2:]],
                         ["invalid-geometry", "dateline", "protected", "non-polygon"])
        self.assertTrue(all(item["retained_exact"] for item in report["feature_diagnostics"][2:]))
        self.assertTrue(all(not item["retained_exact"] and item["retention_reason"] is None
                            for item in report["feature_diagnostics"][:2]))
        self.assertEqual(sum(item["input_points"] for item in report["feature_diagnostics"]), report["input_points"])
        self.assertEqual(sum(item["output_points"] for item in report["feature_diagnostics"]), report["output_points"])
        self.assertEqual(sum(item["coordinate_count"] for item in report["retention_costs"]),
                         sum(coordinate_count(feature["geometry"]) for feature in features[2:]))
        self.assertEqual(report["retention_costs"], sorted(report["retention_costs"],
                         key=lambda item: (-item["coordinate_count"], item["reason"])))
        self.assertTrue(all(result[i] is features[i] for i in range(2, len(features))))

    def test_zero_tolerance_and_limit_fallback_have_branch_diagnostics(self):
        features = fixture()
        self.assertEqual({item["retention_reason"] for item in simplify_coverage_features(features, 0)[1]["feature_diagnostics"]},
                         {"zero-tolerance"})
        with patch("tools.build_political_display_lods.coverage_simplify", return_value=[Polygon(), Polygon()]):
            result, report = simplify_coverage_features(features, .02)
        self.assertIs(result, features)
        self.assertEqual({item["retention_reason"] for item in report["feature_diagnostics"]}, {"deviation-or-topology-limit"})
        self.assertEqual(report["retention_costs"], [{"reason": "deviation-or-topology-limit", "feature_count": 2,
                                                   "coordinate_count": report["input_points"]}])

    def test_whole_group_union_failure_falls_back_after_valid_subcoverage(self):
        features = fixture()
        source_union = unary_union([shape(f["geometry"]) for f in features])
        other_union = Polygon([(10, 0), (11, 0), (11, 1), (10, 1)])
        for final_union in (other_union, GEOSException("retained-neighbour union failed")):
            with self.subTest(final_union=type(final_union).__name__):
                with patch("tools.build_political_display_lods.unary_union",
                           side_effect=[source_union, source_union, source_union, final_union]):
                    result, report = simplify_coverage_features(features, .02)
                self.assertIs(result, features)
                self.assertEqual(report["status"], "fallback")
                self.assertEqual(report["reason"], "whole-group-coverage-check-failed")
                self.assertEqual(report["output_points"], report["input_points"])
                self.assertEqual({item["retention_reason"] for item in report["feature_diagnostics"]},
                                 {"whole-group-coverage-check-failed"})

    def test_dateline_and_zero_tolerance_do_not_simplify(self):
        features = [{"type": "Feature", "properties": {"id": "date"}, "geometry": mapping(Polygon([(-179, 0), (179, 0), (179, 1), (-179, 1)]))}]
        self.assertEqual(simplify_coverage_features(features, .02)[1]["reason"], "dateline-needs-spherical-review")
        self.assertEqual(simplify_coverage_features(fixture(), 0)[1]["status"], "unchanged")
        with self.assertRaises(ValueError):
            simplify_coverage_features(fixture(), float("nan"))

    def test_missing_and_duplicate_ids_fail_closed(self):
        features = fixture()
        features[1]["properties"]["id"] = "a"
        with self.assertRaises(ValueError): simplify_coverage_features(features, .02)
        features[1]["properties"].clear()
        with self.assertRaises(ValueError): simplify_coverage_features(features, .02)

    def test_cache_binds_property_order_and_preserves_protection_iterators(self):
        with tempfile.TemporaryDirectory() as folder:
            features = fixture()
            cache = Path(folder)
            _, _, first = cached_simplify_coverage_features(features, .02, [], cache_root=cache, stage_name="lod")
            features[0]["properties"] = dict(reversed(list(features[0]["properties"].items())))
            value, _, second = cached_simplify_coverage_features(features, .02, [], cache_root=cache, stage_name="lod")
            self.assertNotEqual(first["key"], second["key"])
            self.assertEqual(list(value[0]["properties"]), ["owner", "id"])
            protected, report, _ = cached_simplify_coverage_features(
                features, .02, iter(["a"]), cache_root=cache, stage_name="lod")
            self.assertEqual(report["status"], "unchanged")
            self.assertIs(protected, features)

    def test_staged_manifest_family_hash_bounds_and_source_bytes(self):
        self._assert_staged_manifest_family()

    def test_staged_overlay_accepts_topology_coarse_wire(self):
        self._assert_staged_manifest_family(coarse_topology=True)

    def _assert_staged_manifest_family(self, coarse_topology=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "source"
            prefix = Path("data/scenarios/pilot")
            directory = root / prefix
            (directory / "chunks").mkdir(parents=True)
            features = fixture()
            payload = {"type": "FeatureCollection", "features": features}
            raw = json.dumps(payload).encode()
            chunks = []
            for lod in ["coarse", "detail"]:
                url = (prefix / "chunks" / (lod + ".json.gz")).as_posix()
                wire = raw
                if coarse_topology and lod == "coarse":
                    from tools.scenario_chunk_format import feature_collection_to_topology
                    wire = json.dumps(feature_collection_to_topology(payload)).encode()
                (root / url).write_bytes(gzip.compress(wire, mtime=0))
                chunks.append({"id": f"political.{lod}.test", "layer": "political", "lod": lod, "url": url,
                               "min_zoom": 0 if lod == "coarse" else 1.35, "max_zoom": 1.35 if lod == "coarse" else 99,
                               "global_coverage": lod == "coarse", "bounds": [0, 0, 2, 1], "country_codes": ["X"]})
            manifest = {"version": 1, "scenario_id": "pilot", "chunks": chunks}
            (directory / "detail_chunks.manifest.json").write_text(json.dumps(manifest))
            (directory / "context_lod.manifest.json").write_text(json.dumps({"layers": {}}))
            before = {p: p.read_bytes() for p in directory.rglob("*") if p.is_file()}
            output = Path(folder) / "candidate"
            report = build_overlay(root, "pilot", output)
            self.assertEqual(report["regional_variants"], 1)
            self.assertLess(report["world_points_after"], report["world_points_before"])
            staged = json.loads((output / prefix / "detail_chunks.manifest.json").read_text())
            regional = next(c for c in staged["chunks"] if c["lod"] == "regional")
            detail = next(c for c in staged["chunks"] if c["lod"] == "detail")
            self.assertEqual(regional["lod_group_id"], detail["lod_group_id"])
            self.assertLess(detail["min_zoom"], regional["max_zoom"])
            for chunk in staged["chunks"]:
                path = output / chunk["url"]
                if not path.exists(): continue
                data = path.read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), chunk["sha256"])
                self.assertEqual(len(data), chunk["byte_size"])
                actual = json.loads(data)["features"]
                self.assertEqual([list(shape(f["geometry"]).bounds) for f in actual], chunk["feature_bounds"])
            self.assertEqual(before, {p: p.read_bytes() for p in before})
            self.assertEqual(report["build_graph"]["cache_hits"], 0)
            with patch("tools.build_political_display_lods.simplify_coverage_features",
                       side_effect=AssertionError("warm build must not simplify again")):
                warm = Path(folder) / "warm"
                warm_report = build_overlay(root, "pilot", warm)
            uncached = Path(folder) / "uncached"
            uncached_report = build_overlay(root, "pilot", uncached, use_cache=False)
            def artifacts(directory):
                return {p.relative_to(directory).as_posix(): p.read_bytes()
                        for p in (directory / "data").rglob("*") if p.is_file()}
            self.assertEqual(artifacts(output), artifacts(warm))
            self.assertEqual(artifacts(output), artifacts(uncached))
            self.assertEqual(warm_report["build_graph"]["cache_hits"], 2)
            self.assertFalse(uncached_report["build_graph"]["enabled"])
            self.assertFalse(warm_report["build_graph"]["release_approved"])
            # Overlay payloads become the source's derived files after promotion;
            # detail bytes continue to come from the original source authority.
            shutil.copytree(output / "data", root / "data", dirs_exist_ok=True)
            rebuilt = Path(folder) / "rebuilt"
            build_overlay(root, "pilot", rebuilt, use_cache=False)
            rebuilt_manifest = json.loads((rebuilt / prefix / "detail_chunks.manifest.json").read_text())
            self.assertEqual(len({c["id"] for c in rebuilt_manifest["chunks"]}), len(rebuilt_manifest["chunks"]))
            self.assertEqual([c for c in rebuilt_manifest["chunks"] if c["lod"] == "regional"], [regional])
            self.assertEqual(next(c for c in rebuilt_manifest["chunks"] if c["lod"] == "detail")["min_zoom"], 4.0)
            # A derived variant that no longer reduces points must leave the
            # original detail eligible at the original regional entry zoom.
            with patch("tools.build_political_display_lods.simplify_coverage_features",
                       side_effect=lambda features, *_: (features, {"status": "unchanged", "reason": "no-point-reduction"})):
                no_variant = Path(folder) / "no-variant"
                build_overlay(root, "pilot", no_variant, use_cache=False)
            no_variant_manifest = json.loads((no_variant / prefix / "detail_chunks.manifest.json").read_text())
            self.assertFalse(any(c["lod"] == "regional" for c in no_variant_manifest["chunks"]))
            restored_detail = next(c for c in no_variant_manifest["chunks"] if c["lod"] == "detail")
            self.assertEqual(restored_detail["min_zoom"], regional["min_zoom"])
            self.assertNotIn("lod_group_id", restored_detail)
            promoted_manifest = json.loads((directory / "detail_chunks.manifest.json").read_text())
            unrelated = {**regional, "id": "political.regional.unrelated"}
            unrelated.pop("lod_group_id")
            promoted_manifest["chunks"].append(unrelated)
            (directory / "detail_chunks.manifest.json").write_text(json.dumps(promoted_manifest))
            unrelated_output = Path(folder) / "unrelated"
            build_overlay(root, "pilot", unrelated_output, use_cache=False)
            unrelated_manifest = json.loads((unrelated_output / prefix / "detail_chunks.manifest.json").read_text())
            self.assertIn(unrelated, unrelated_manifest["chunks"])
            with self.assertRaises(ValueError): build_overlay(root, "pilot", root)
            with self.assertRaises(ValueError): build_overlay(root, "../pilot", output)


if __name__ == "__main__": unittest.main()
