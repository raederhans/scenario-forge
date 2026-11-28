"""Small geometry contracts for rebuilding the Modern World political map."""

from contextlib import ExitStack
from copy import deepcopy
import unittest
from unittest.mock import patch

from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
import topojson

from tools import build_modern_world_scenario as rebuild


def feature(feature_id, code, geometry):
    return {
        "type": "Feature",
        "properties": {"id": feature_id, "cntr_code": code, "name": feature_id},
        "geometry": mapping(geometry),
    }


def topology(*features):
    return topojson.Topology(
        {"type": "FeatureCollection", "features": list(features)},
        object_name="political", prequantize=False, topoquantize=False,
        presimplify=False, toposimplify=False,
    ).to_dict()


def country_sources(*items):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"ISO_A2": code, "NAME": code},
         "geometry": mapping(geometry)} for code, geometry in items
    ]}


class ModernWorldRebuildTests(unittest.TestCase):
    def run_rebuild_with_previous_owner(self, previous_owner):
        countries = {"countries": {tag: {"source_type": source} for tag, source in
                                  (("AA", "canonical_baseline"), ("BB", "canonical_baseline"),
                                   ("NEW", "scenario_extension"))}}
        payloads = {"manifest.json": {"summary": {}}, "countries.json": countries,
                    "owners.by_feature.json": {"owners": {"a": previous_owner, "b": "BB"}},
                    "cores.by_feature.json": {"cores": {"a": [previous_owner], "b": ["BB"]}},
                    "capital_hints.json": {}, "city_overrides.json": {}}
        features = [feature("a", "AA", box(0, 0, 1, 1)), feature("b", "BB", box(1, 0, 2, 1))]
        written = {}
        with ExitStack() as stack:
            stack.enter_context(patch.object(rebuild.sys, "argv", ["build_modern_world_scenario.py"]))
            stack.enter_context(patch.object(rebuild, "read", side_effect=lambda p: deepcopy(payloads.get(p.name, {}))))
            stack.enter_context(patch.object(rebuild, "load_country_sources", return_value={}))
            stack.enter_context(patch.object(rebuild, "rebuild_features", return_value=(features, {})))
            stack.enter_context(patch.object(rebuild, "encode_features", return_value={}))
            stack.enter_context(patch.object(rebuild, "update_country_records", side_effect=lambda p, *args: p))
            stack.enter_context(patch.object(rebuild, "update_capitals", return_value=({}, {})))
            stack.enter_context(patch.object(rebuild, "sha256_path", return_value="source"))
            stack.enter_context(patch.object(rebuild, "_build_snapshot_for_scenario",
                                             return_value={"snapshot_fingerprint": "snapshot"}))
            stack.enter_context(patch.object(rebuild, "_refresh_audit_payload", return_value={"diagnostics": {}}))
            stack.enter_context(patch.object(rebuild, "write",
                                             side_effect=lambda p, value, **kw: written.update({p.name: deepcopy(value)})))
            rebuild.main()
        return written

    def test_rebuild_restores_extension_owned_land_to_canonical(self):
        written = self.run_rebuild_with_previous_owner("NEW")
        self.assertEqual(written["owners.by_feature.json"]["owners"], {"a": "AA", "b": "BB"})
        self.assertEqual(written["cores.by_feature.json"]["cores"], {"a": ["AA"], "b": ["BB"]})
        self.assertEqual(set(written["countries.json"]["countries"]), {"AA", "BB"})

    def test_canonical_detail_and_interior_hole_survive_without_taking_neighbor_land(self):
        aa = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)],
                     holes=[[(1, 1), (1, 2), (2, 2), (2, 1)]])
        bb = box(4, 0, 6, 4)
        runtime = topology(feature("AA_DETAIL", "AA", aa), feature("BB_DETAIL", "BB", bb))
        primary = topology(feature("AA", "AA", box(0, 0, 4, 4)),
                           feature("BB", "BB", bb))

        features, audit = rebuild.rebuild_features(
            runtime, primary, country_sources(), required_ids=("AA_DETAIL", "BB_DETAIL"))

        by_id = {row["properties"]["id"]: shape(row["geometry"]) for row in features}
        self.assertEqual(set(by_id), {"AA_DETAIL", "BB_DETAIL"})
        self.assertTrue(by_id["AA_DETAIL"].equals(aa))
        self.assertTrue(by_id["BB_DETAIL"].equals(bb))
        self.assertFalse(by_id["AA_DETAIL"].covers(box(1.2, 1.2, 1.8, 1.8)))
        self.assertEqual(audit["retained_primary_component_ids"], [])

    def test_detached_primary_island_retains_country_identity(self):
        mainland, island = box(0, 0, 4, 4), box(10, 0, 11, 1)
        runtime = topology(feature("AA_DETAIL", "AA", mainland))
        primary = topology(feature("AA", "AA", MultiPolygon([mainland, island])))

        features, audit = rebuild.rebuild_features(runtime, primary, country_sources())

        gaps = [row for row in features if row["properties"].get("detail_tier") == "primary_gap"]
        self.assertEqual(len(gaps), 1)
        self.assertEqual(gaps[0]["properties"]["cntr_code"], "AA")
        self.assertEqual(gaps[0]["properties"]["__source"], "primary_gap")
        self.assertTrue(shape(gaps[0]["geometry"]).equals(island))
        self.assertEqual(audit["retained_primary_component_ids"],
                         [gaps[0]["properties"]["id"]])

    def test_missing_microstate_uses_source_outline_and_clips_neighbor(self):
        neighbor = box(0, 0, 4, 4)
        microstate = box(1, 1, 1.02, 1.02)
        runtime = topology(feature("AA_DETAIL", "AA", neighbor))
        primary = topology(feature("AA", "AA", neighbor),
                           feature("XX", "XX", microstate))

        features, audit = rebuild.rebuild_features(
            runtime, primary, country_sources(("XX", microstate)),
            required_ids=("AA_DETAIL",))

        by_id = {row["properties"]["id"]: row for row in features}
        self.assertEqual(set(by_id), {"AA_DETAIL", "XX"})
        self.assertEqual(by_id["XX"]["properties"]["cntr_code"], "XX")
        self.assertEqual(by_id["XX"]["properties"]["__source"],
                         "unquantized_country_source")
        self.assertTrue(shape(by_id["XX"]["geometry"]).equals(microstate))
        clipped = shape(by_id["AA_DETAIL"]["geometry"])
        self.assertAlmostEqual(clipped.intersection(microstate).area, 0)
        self.assertTrue(clipped.union(microstate).equals(neighbor))
        self.assertEqual(audit["recovered_microstates"], ["XX"])


if __name__ == "__main__":
    unittest.main()


class RebuildLineageTests(unittest.TestCase):
    def test_complete_and_unknown_ids(self):
        manifest = {"hierarchy_overrides": {"feature_splits": {"p": ["a", "b"]}}}
        self.assertEqual(rebuild.resolve_rebuild_lineage(["a", "b", "unknown"], manifest), {"a": "p", "b": "p", "unknown": "unknown"})
