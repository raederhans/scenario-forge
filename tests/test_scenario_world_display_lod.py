from __future__ import annotations

from copy import deepcopy
import json
from math import sin
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from shapely.geometry import Point, Polygon, mapping, shape
from shapely.ops import unary_union

from tools import scenario_chunk_assets as assets


def fixture():
    edge = [(1 + (0.001 * sin(i) if 0 < i < 40 else 0), i / 40) for i in range(41)]
    geometries = [
        Polygon([(0, 0), *edge, (0, 1), (0, 0)]),
        Polygon([(2, 0), (2, 1), *edge[::-1], (2, 0)],
                holes=[[(1.3, .2), (1.5, .2), (1.5, .4), (1.3, .4), (1.3, .2)]]),
    ]
    return [{"type": "Feature", "id": fid, "meta": {"source": "coarse"},
             "properties": {"id": fid, "owner": "X", "country": "original"},
             "geometry": mapping(geometry)} for fid, geometry in zip(("a", "b"), geometries)]


class ScenarioWorldDisplayLodTests(unittest.TestCase):
    def setUp(self):
        output_root = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        output_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="world-display-lod-test-", dir=output_root)
        self.addCleanup(self.temp.cleanup)
        self.scenario = Path(self.temp.name) / "tno_1962"
        (self.scenario / "chunks").mkdir(parents=True)

    def write_chunk(self, chunk_id, features, lod, *, topology=False, plain=False):
        path = self.scenario / "chunks" / f"{chunk_id}.json"
        payload = {"type": "FeatureCollection", "source": "original-source",
                   "meta": {"tier": "original"}, "features": features}
        if topology or plain:
            payload = {"type": "FeatureCollection", "features": [
                {key: value for key, value in feature.items() if key != "meta"}
                for feature in features
            ]}
        wire = assets.feature_collection_to_topology(payload) if topology else payload
        assets._write_minified_json(path, wire)
        geometry_cost = assets._summarize_payload_geometry_cost(payload)
        cost = assets._build_chunk_cost_summary(payload, path)
        return {"id": chunk_id, "layer": "political", "lod": lod,
                "url": f"data/scenarios/tno_1962/chunks/{chunk_id}.json",
                "global_coverage": lod == "coarse", "bounds": [-180, -90, 180, 90],
                "data_format": "topojson" if topology else "geojson",
                "cache_byte_size": assets._minified_json_byte_size(payload),
                "country_codes": ["X"], "feature_count": len(features),
                "lod_diagnostics": assets._build_political_coarse_lod_diagnostics(
                    {**geometry_cost, "byte_size": cost["byte_size"]},
                    {**geometry_cost, "byte_size": cost["byte_size"]},
                ), **cost}

    def path(self, entry):
        return self.scenario / "chunks" / f"{entry['id']}.json"

    def apply(self, chunks):
        return assets._apply_tno_world_display_lod(scenario_dir=self.scenario, all_chunks=chunks)

    def test_shared_interiors_reduce_points_and_preserve_identity_union_perimeter_holes_and_metadata(self):
        features = fixture()
        untouched = {"type": "Feature", "properties": {"id": "coarse-only"},
                     "geometry": mapping(Polygon([(3, 0), (4, 0), (4, 1), (3, 1)]))}
        coarse = self.write_chunk("world", [features[1], features[0], untouched], "coarse")
        detail_features = deepcopy(features)
        for feature in detail_features:
            feature["properties"]["country"] = "detail-only-metadata"
        detail = self.write_chunk("X.detail", detail_features, "detail")
        source = json.loads(self.path(coarse).read_text(encoding="utf-8"))
        detail_bytes = self.path(detail).read_bytes()
        chunks_before = deepcopy([coarse, detail])
        with patch.object(assets, "simplify_coverage_features", wraps=assets.simplify_coverage_features) as simplify:
            updated, diagnostics = self.apply([coarse, detail])
        members = simplify.call_args.args[0]
        self.assertEqual([feature["properties"]["id"] for feature in members], ["a", "b"])
        self.assertEqual(members[0]["properties"]["country"], "original")
        self.assertEqual(simplify.call_args.args[1], .02)
        result = json.loads(self.path(coarse).read_text(encoding="utf-8"))
        self.assertEqual([feature["properties"] for feature in result["features"]],
                         [feature["properties"] for feature in source["features"]])
        self.assertEqual([feature.get("id") for feature in result["features"]],
                         [feature.get("id") for feature in source["features"]])
        self.assertEqual([feature.get("meta") for feature in result["features"]],
                         [feature.get("meta") for feature in source["features"]])
        self.assertEqual({key: value for key, value in result.items() if key != "features"},
                         {key: value for key, value in source.items() if key != "features"})
        self.assertEqual(result["features"][2], source["features"][2])
        before_union = unary_union([shape(feature["geometry"]) for feature in source["features"]])
        after_union = unary_union([shape(feature["geometry"]) for feature in result["features"]])
        self.assertTrue(before_union.equals(after_union))
        self.assertTrue(before_union.boundary.equals(after_union.boundary))
        self.assertEqual(len(shape(result["features"][0]["geometry"]).interiors), 1)
        self.assertLess(updated["coord_count"], coarse["coord_count"])
        for key, value in assets._build_chunk_cost_summary(result, self.path(coarse)).items():
            self.assertEqual(updated[key], value)
        self.assertEqual(updated["feature_bounds"], assets._build_feature_bounds_summary(result["features"], include_zero_area=True))
        self.assertEqual(updated["url"], coarse["url"])
        self.assertEqual(updated["country_codes"], coarse["country_codes"])
        stage = updated["lod_diagnostics"]["world_display_stage"]
        self.assertEqual(stage["previous"], coarse["lod_diagnostics"])
        for key, value in coarse["lod_diagnostics"].items():
            if not key.startswith("optimized_") and not key.endswith("reduction"):
                self.assertEqual(updated["lod_diagnostics"][key], value)
        for field in ("feature_count", "coord_count", "part_count", "byte_size", "estimated_path_cost"):
            self.assertEqual(updated["lod_diagnostics"][f"optimized_{field}"],
                             assets._summarize_payload_geometry_cost(result).get(field, updated.get(field)))
        for field, reduction in (("coord_count", "coord_reduction"), ("byte_size", "byte_size_reduction"),
                                 ("estimated_path_cost", "estimated_path_cost_reduction")):
            self.assertEqual(updated["lod_diagnostics"][reduction],
                             coarse["lod_diagnostics"][f"source_{field}"] - updated[field])
        self.assertEqual(stage["before"]["coord_count"], coarse["coord_count"])
        self.assertEqual(stage["after"]["coord_count"], updated["coord_count"])
        self.assertEqual(stage["after"]["byte_size"], self.path(coarse).stat().st_size)
        self.assertNotIn("groups", stage)
        self.assertEqual(diagnostics["simplified_group_count"], 1)
        self.assertEqual(self.path(detail).read_bytes(), detail_bytes)
        self.assertEqual([coarse, detail], chunks_before)

    def test_unchanged_geometry_does_not_rewrite_coarse_or_detail(self):
        coarse = self.write_chunk("world", fixture()[:1], "coarse")
        detail = self.write_chunk("X.detail", fixture()[:1], "detail")
        before = self.path(coarse).read_bytes()
        with patch.object(assets, "_write_minified_json", wraps=assets._write_minified_json) as writer:
            updated, diagnostics = self.apply([coarse, detail])
        writer.assert_not_called()
        self.assertEqual(self.path(coarse).read_bytes(), before)
        self.assertEqual(updated["sha256"], coarse["sha256"])
        self.assertEqual(diagnostics["status"], "unchanged")

    def assert_output_costs(self, updated):
        wire = json.loads(self.path(updated).read_text(encoding="utf-8"))
        expanded = assets.decode_political_chunk(wire)
        byte_size = self.path(updated).stat().st_size
        expanded_size = assets._minified_json_byte_size(expanded)
        self.assertEqual(updated["data_format"], "topojson" if wire["type"] == "Topology" else "geojson")
        self.assertEqual(updated["byte_size"], byte_size)
        self.assertEqual(updated["decoded_byte_size"], byte_size)
        self.assertEqual(updated["cache_byte_size"], expanded_size)
        for field, value in assets._build_chunk_cost_summary(expanded, self.path(updated)).items():
            self.assertEqual(updated[field], value)
        lod = updated["lod_diagnostics"]
        self.assertEqual(lod["optimized_byte_size"], byte_size)
        self.assertEqual(lod["wire_byte_size"], byte_size)
        self.assertEqual(lod["expanded_geojson_byte_size"], expanded_size)
        self.assertEqual(lod["world_display_stage"]["after"]["wire_byte_size"], byte_size)
        self.assertEqual(lod["world_display_stage"]["after"]["expanded_geojson_byte_size"], expanded_size)
        return wire, expanded

    def test_topology_input_uses_real_wire_encoder_and_no_rewrite_on_second_pass(self):
        # Repeated coarse-only rings ensure real lossless arc sharing remains
        # worthwhile after the eligible shard's shared interior is simplified.
        extras = [{"type": "Feature", "id": f"extra-{index}", "properties": {"id": f"extra-{index}"},
                   "geometry": mapping(Point(5, 5).buffer(1))} for index in range(4)]
        coarse = self.write_chunk("world", [*fixture(), *extras], "coarse", topology=True)
        detail = self.write_chunk("X.detail", fixture(), "detail", topology=True)
        source = assets.decode_political_chunk(json.loads(self.path(coarse).read_text(encoding="utf-8")))
        coarse["lod_diagnostics"].update(global_shard_coverage_applied=True, wire_byte_size=1,
                                         expanded_geojson_byte_size=2)
        with patch.object(assets, "POLITICAL_COARSE_TOPOLOGY_MIN_BYTES", 0), \
                patch.object(assets, "_encode_political_coarse_wire", wraps=assets._encode_political_coarse_wire) as encoder:
            updated, report = self.apply([coarse, detail])
        encoder.assert_called_once()
        self.assertEqual(report["status"], "simplified")
        wire, expanded = self.assert_output_costs(updated)
        self.assertEqual(wire["type"], "Topology")
        self.assertLess(updated["byte_size"], updated["cache_byte_size"])
        self.assertTrue(updated["lod_diagnostics"]["global_shard_coverage_applied"])
        self.assertEqual(expanded["features"][2:], source["features"][2:])
        self.assertEqual([feature.get("id") for feature in expanded["features"]],
                         [feature.get("id") for feature in source["features"]])
        before_union = unary_union([shape(feature["geometry"]) for feature in source["features"][:2]])
        after_union = unary_union([shape(feature["geometry"]) for feature in expanded["features"][:2]])
        self.assertTrue(before_union.equals(after_union))
        self.assertTrue(before_union.boundary.equals(after_union.boundary))
        before_bytes = self.path(coarse).read_bytes()
        with patch.object(assets, "_encode_political_coarse_wire") as encoder, \
                patch.object(assets, "_write_minified_json") as writer:
            second, report = self.apply([updated, detail])
        encoder.assert_not_called()
        writer.assert_not_called()
        self.assertEqual(report["status"], "unchanged")
        self.assertEqual(self.path(coarse).read_bytes(), before_bytes)
        self.assertEqual(second["lod_diagnostics"]["world_display_stage"]["previous"], coarse["lod_diagnostics"])
        self.assert_output_costs(second)

    def test_topology_can_return_to_geojson_without_stale_wire_metadata(self):
        coarse = self.write_chunk("world", fixture(), "coarse", topology=True)
        coarse["lod_diagnostics"].update(wire_byte_size=1, expanded_geojson_byte_size=2)
        detail = self.write_chunk("X.detail", fixture(), "detail")
        with patch.object(assets, "POLITICAL_COARSE_TOPOLOGY_MIN_BYTES", 10**9):
            updated, report = self.apply([coarse, detail])
        self.assertEqual(report["status"], "simplified")
        wire, _expanded = self.assert_output_costs(updated)
        self.assertEqual(wire["type"], "FeatureCollection")
        self.assertEqual(updated["byte_size"], updated["cache_byte_size"])

    def test_invalid_topology_and_encoding_failure_do_not_write(self):
        coarse = self.write_chunk("world", fixture(), "coarse", topology=True)
        detail = self.write_chunk("X.detail", fixture(), "detail")
        before = self.path(coarse).read_bytes()
        with patch.object(assets, "_encode_political_coarse_wire", side_effect=ValueError("bad encoding")):
            updated, report = self.apply([coarse, detail])
        self.assertIsNone(updated)
        self.assertEqual(report["reason"], "invalid-world-output")
        self.assertEqual(self.path(coarse).read_bytes(), before)
        invalid = json.loads(before)
        invalid["objects"]["political"]["geometries"][0]["arcs"] = [[999]]
        assets._write_minified_json(self.path(coarse), invalid)
        before = self.path(coarse).read_bytes()
        updated, report = self.apply([coarse, detail])
        self.assertIsNone(updated)
        self.assertEqual(report["reason"], "invalid-coarse-input")
        self.assertEqual(self.path(coarse).read_bytes(), before)

    def test_equal_point_count_result_does_not_rewrite(self):
        features = fixture()
        coarse = self.write_chunk("world", features, "coarse")
        detail = self.write_chunk("X.detail", features, "detail")
        result = deepcopy(features)
        result[0]["geometry"]["coordinates"] = tuple(tuple(reversed(ring)) for ring in result[0]["geometry"]["coordinates"])
        with patch.object(assets, "simplify_coverage_features", return_value=(result, {"status": "simplified"})), \
                patch.object(assets, "_write_minified_json") as writer:
            _updated, report = self.apply([coarse, detail])
        writer.assert_not_called()
        self.assertEqual(report["status"], "unchanged")
        self.assertEqual(report["groups"][0]["reason"], "no-point-reduction")

    def test_unmatched_or_repeated_shard_ids_leave_coarse_exact(self):
        for unmatched in (True, False):
            with self.subTest(unmatched=unmatched):
                features = fixture()
                coarse = self.write_chunk("world", features, "coarse")
                details = [self.write_chunk("X.detail", features, "detail")]
                extra = deepcopy(features[:1])
                if unmatched:
                    extra[0]["properties"]["id"] = "missing"
                    details = [self.write_chunk("X.detail", [features[0], extra[0]], "detail")]
                else:
                    details.append(self.write_chunk("duplicate.detail", extra, "detail"))
                before = self.path(coarse).read_bytes()
                with patch.object(assets, "simplify_coverage_features", wraps=assets.simplify_coverage_features) as simplify:
                    _updated, diagnostics = self.apply([coarse, *details])
                simplify.assert_not_called()
                self.assertEqual(self.path(coarse).read_bytes(), before)
                self.assertEqual(diagnostics["fallback_group_count"], len(details))

    def test_invalid_inputs_fail_closed_with_explicit_diagnostics(self):
        for error in ("duplicate-id", "missing-id", "invalid-json", "escape-url"):
            with self.subTest(error=error):
                coarse = self.write_chunk("world", fixture(), "coarse")
                features = fixture()
                if error == "duplicate-id":
                    features[1]["properties"]["id"] = "a"
                elif error == "missing-id":
                    features[0].pop("id")
                    features[0]["properties"].pop("id")
                detail = self.write_chunk("X.detail", features, "detail")
                if error == "invalid-json":
                    self.path(detail).write_text("{", encoding="utf-8")
                elif error == "escape-url":
                    detail["url"] = "data/scenarios/tno_1962/../../outside.json"
                before = self.path(coarse).read_bytes()
                updated, diagnostics = self.apply([coarse, detail])
                self.assertEqual(updated["sha256"], coarse["sha256"])
                self.assertEqual(self.path(coarse).read_bytes(), before)
                self.assertEqual(diagnostics["groups"][0]["reason"], "invalid-detail-input")
                self.assertIn("error", diagnostics["groups"][0])
        updated, diagnostics = self.apply([])
        self.assertIsNone(updated)
        self.assertEqual(diagnostics["reason"], "expected-one-global-political-coarse")
        coarse["url"] = "data/scenarios/another/chunks/world.json"
        updated, diagnostics = self.apply([coarse])
        self.assertIsNone(updated)
        self.assertEqual(diagnostics["reason"], "invalid-coarse-input")

    def test_known_group_error_is_reported_and_unexpected_error_propagates(self):
        coarse = self.write_chunk("world", fixture(), "coarse")
        detail = self.write_chunk("X.detail", fixture(), "detail")
        before = self.path(coarse).read_bytes()
        with patch.object(assets, "simplify_coverage_features", side_effect=ValueError("invalid group")):
            _updated, diagnostics = self.apply([coarse, detail])
        self.assertEqual(diagnostics["groups"][0]["reason"], "invalid-group-result")
        self.assertEqual(self.path(coarse).read_bytes(), before)
        with patch.object(assets, "simplify_coverage_features", side_effect=RuntimeError("unexpected failure")):
            with self.assertRaisesRegex(RuntimeError, "unexpected failure"):
                self.apply([coarse, detail])

    def test_build_invokes_world_stage_after_political_files_exist_only_for_tno(self):
        collection = {"type": "FeatureCollection", "features": fixture()}
        observed = []
        original = assets._apply_tno_world_display_lod

        def inspect_stage(**kwargs):
            chunks = kwargs["all_chunks"]
            self.assertEqual({chunk["lod"] for chunk in chunks}, {"coarse", "detail"})
            for chunk in chunks:
                self.assertTrue(self.path(chunk).exists())
            observed.extend(chunks)
            return original(**kwargs)

        with patch.object(assets, "_topology_object_to_feature_collection", return_value=collection), \
                patch.object(assets, "_load_owner_map", return_value={"a": "X", "b": "X"}), \
                patch.object(assets, "_apply_tno_world_display_lod", side_effect=inspect_stage) as stage:
            chunks, _layers = assets._build_political_chunk_payloads(
                scenario_id="tno_1962", scenario_dir=self.scenario,
                startup_topology_payload={}, runtime_topology_payload={},
            )
        self.assertEqual(stage.call_count, 1)
        coarse = next(chunk for chunk in chunks if chunk["lod"] == "coarse")
        self.assertIn("world_display_stage", coarse["lod_diagnostics"])
        self.assertGreater(len(observed), 1)
        with patch.object(assets, "_apply_tno_world_display_lod") as stage:
            assets._build_political_chunk_payloads(
                scenario_id="other", scenario_dir=self.scenario,
                startup_topology_payload=None, runtime_topology_payload=None,
            )
        stage.assert_not_called()


if __name__ == "__main__":
    unittest.main()
