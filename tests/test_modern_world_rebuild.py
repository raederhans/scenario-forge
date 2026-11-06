"""Small geometry contracts for rebuilding the Modern World political map."""

from contextlib import ExitStack
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

import geopandas as gpd
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping, shape
import topojson

from map_builder.geo.france_topology_precision import _decode_polygon
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


def tiny_arctic_geometry():
    # Two near-collinear shells reduced from RU_ARCTIC_FB_8851. The real
    # feature lost coverage when encoded among the full political map.
    return MultiPolygon([
        Polygon([(72.85212852128521, 68.78942712627126),
                 (72.83412834128342, 68.79984215642158),
                 (73.53613536135362, 68.58112652326524)]),
        Polygon([(73.53613536135362, 68.58112652326524),
                 (73.60813608136081, 68.47697622176223),
                 (73.58653586535866, 68.50822131221311)]),
    ])


class ModernWorldRebuildTests(unittest.TestCase):
    def run_rebuild_with_previous_owner(self, previous_owner, previous_cores=None):
        countries = {"countries": {tag: {"source_type": source} for tag, source in
                                  (("AA", "canonical_baseline"), ("BB", "canonical_baseline"),
                                   ("NEW", "scenario_extension"))}}
        payloads = {"manifest.json": {"summary": {}}, "countries.json": countries,
                    "owners.by_feature.json": {"owners": {"a": previous_owner, "b": "BB"}},
                    "cores.by_feature.json": {"cores": {"a": previous_cores or [previous_owner], "b": ["BB"]}},
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

    def test_rebuild_restores_occupied_land_held_by_a_canonical_country(self):
        written = self.run_rebuild_with_previous_owner("BB", previous_cores=["AA"])
        self.assertEqual(written["owners.by_feature.json"]["owners"], {"a": "AA", "b": "BB"})

    def test_rebuild_rejects_changed_canonical_ownership(self):
        with self.assertRaisesRegex(ValueError, "Canonical ownership changed"):
            self.run_rebuild_with_previous_owner("BB")

    def test_reviewed_source_island_preserves_existing_land_ids_and_foreign_land(self):
        mainland, island = box(0, 0, 4, 4), box(10, 0, 11, 1)
        foreign = box(10.99, 0, 12, 1)
        baseline = topology(feature("PM", "PM", mainland), feature("CA", "CA", foreign))
        source = country_sources(("PM", MultiPolygon([box(-0.1, 0, 4, 4), island])))
        features, report = rebuild.rebuild_features(
            baseline, baseline, country_sources(), required_ids=("PM", "CA"), island_sources=source)
        by_id = {f["properties"]["id"]: shape(f["geometry"]) for f in features}
        self.assertEqual(set(by_id), {"PM", "CA"})
        self.assertTrue(by_id["PM"].equals(mainland.union(island.difference(foreign))))
        self.assertTrue(by_id["CA"].equals(foreign))
        self.assertEqual(by_id["PM"].intersection(foreign).area, 0)
        self.assertEqual(len(report["restored_source_islands"]), 1)
        self.assertEqual(rebuild.restore_reviewed_source_islands(
            features, source, by_id["PM"].union(by_id["CA"])), [])

    def test_capital_audit_count_matches_hints_after_update(self):
        hints = {"entries": [{"tag": "AQ", "city_id": ""},
                             {"tag": "GP", "city_id": "CITY::ne::1159143181"}],
                 "entry_count": 2}
        overrides = {"capitals_by_tag": {"GP": "CITY::ne::1159143181"},
                     "capital_city_hints": {"GP": {"city_id": "CITY::ne::1159143181"}},
                     "audit": {"capital_hint_count": 999, "default_capital_entry_count": 999}}
        with patch("map_builder.cities._build_capital_catalog", return_value={}), \
                patch("map_builder.scenario_capital_placement.place_capital_markers", return_value=[]):
            updated_hints, updated_overrides = rebuild.update_capitals(
                hints, overrides, {"AQ": {}, "GP": {}}, [], {"features": []})

        self.assertEqual(updated_hints["entry_count"], 2)
        self.assertEqual(updated_overrides["audit"]["capital_hint_count"],
                         len(updated_overrides["capital_city_hints"]))
        self.assertEqual(updated_overrides["audit"]["default_capital_entry_count"], 1)

    def test_antarctic_source_sectors_become_visible_neutral_region(self):
        sector = feature("AQ_TEST", "AQ", box(10, -85, 20, -75))
        sector["properties"].update(detail_tier="antarctic_sector", claimants=["AU"])
        runtime = topology(sector)
        features, audit = rebuild.rebuild_features(runtime, runtime, country_sources())
        self.assertEqual(features[0]["properties"]["cntr_code"], "AQ")
        self.assertEqual(features[0]["properties"]["detail_tier"], "")
        self.assertTrue(shape(features[0]["geometry"]).equals(shape(sector["geometry"])))
        self.assertEqual(audit["neutral_antarctic_feature_ids"], ["AQ_TEST"])
        self.assertEqual(runtime["objects"]["political"]["geometries"][0]["properties"]["detail_tier"],
                         "antarctic_sector")

    def test_encoding_rejects_projected_coordinates(self):
        with self.assertRaisesRegex(ValueError, "longitude/latitude"):
            rebuild.encode_features([feature("VA", "VA", box(4525200, 2092100, 4525400, 2092400))])

    def test_projected_country_source_restores_microstate_in_lon_lat(self):
        microstate = box(1, 1, 1.02, 1.02)
        projected = gpd.GeoDataFrame(
            [{"ISO_A2": "XX", "NAME": "Microstate", "geometry": microstate}],
            crs="EPSG:4326",
        ).to_crs("EPSG:3857")
        runtime_tmp = Path(__file__).resolve().parents[1] / ".runtime" / "tmp"
        runtime_tmp.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=runtime_tmp) as temp_dir:
            path = Path(temp_dir) / "countries.geojson"
            projected.to_file(path, driver="GeoJSON")
            self.assertEqual(gpd.read_file(path).crs.to_epsg(), 3857)

            sources = rebuild.load_country_sources(path)

        loaded = shape(sources["features"][0]["geometry"])
        for actual, expected in zip(loaded.bounds, microstate.bounds):
            self.assertAlmostEqual(actual, expected, places=6)
        neighbor = box(0, 0, 4, 4)
        features, audit = rebuild.rebuild_features(
            topology(feature("AA_DETAIL", "AA", neighbor)),
            topology(feature("AA", "AA", neighbor), feature("XX", "XX", microstate)),
            sources,
        )
        by_id = {row["properties"]["id"]: shape(row["geometry"]) for row in features}
        self.assertEqual(audit["recovered_microstates"], ["XX"])
        self.assertAlmostEqual(by_id["XX"].area, microstate.area, places=8)
        self.assertAlmostEqual(by_id["AA_DETAIL"].intersection(by_id["XX"]).area, 0)

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

    def test_collapsed_canonical_geometry_is_reported_and_required_id_is_guarded(self):
        runtime = {"objects": {"political": {"geometries": [{}]}}}
        primary = topology(feature("AA", "AA", box(0, 0, 2, 2)))
        collapsed = feature("AA_COLLAPSED", "AA", LineString([(0, 0), (1, 1)]))
        decoded = lambda payload, _name: {"features": [collapsed]} if payload is runtime else {
            "features": [feature("AA", "AA", box(0, 0, 2, 2))]}

        with patch.object(rebuild, "topology_object_to_geojson", side_effect=decoded):
            features, audit = rebuild.rebuild_features(runtime, primary, country_sources())
            self.assertEqual(audit["dropped_degenerate_ids"], ["AA_COLLAPSED"])
            self.assertEqual(len(features), 1)
            with self.assertRaisesRegex(ValueError, "AA_COLLAPSED"):
                rebuild.rebuild_features(runtime, primary, country_sources(),
                                        required_ids=("AA_COLLAPSED",))

    def test_lossless_encoding_preserves_tiny_ring_hole_winding_and_neighbors(self):
        hole = Polygon([(0, 0), (2, 0), (2, 2), (0, 2)],
                       holes=[[(0.5, 0.5), (0.5, 1), (1, 1), (1, 0.5)]])
        features = [feature("AA_DETAIL", "AA", hole),
                    feature("BB_DETAIL", "BB", box(2, 0, 3, 2)),
                    feature("RU_ARCTIC", "RU", tiny_arctic_geometry())]

        encoded = rebuild.encode_features(features)

        self.assertNotIn("transform", encoded)
        geometries = encoded["objects"]["political"]["geometries"]
        for original, item in zip(features, geometries):
            restored = _decode_polygon(encoded, item)
            self.assertTrue(restored.is_valid)
            self.assertTrue(restored.equals(shape(original["geometry"])))
            polygons = [restored] if restored.geom_type == "Polygon" else restored.geoms
            self.assertTrue(all(not polygon.exterior.is_ccw for polygon in polygons))
            self.assertTrue(all(ring.is_ccw for polygon in polygons
                                for ring in polygon.interiors))
        self.assertEqual(encoded["objects"]["political"]["computed_neighbors"],
                         [[1], [0], []])

    def test_encoding_recovers_source_coverage_if_topology_collapses_tiny_shell(self):
        features = [feature("AA", "AA", box(0, 0, 2, 2)),
                    feature("RU_ARCTIC", "RU", tiny_arctic_geometry())]
        corrupted = topology(*features)
        items = corrupted["objects"]["political"]["geometries"]
        # Reproduce the observed encoder failure at the library boundary:
        # the tiny shell points at another feature's otherwise valid arcs.
        items[1]["type"] = items[0]["type"]
        items[1]["arcs"] = items[0]["arcs"]

        with patch.object(rebuild.topojson, "Topology",
                          return_value=Mock(to_dict=lambda: corrupted)):
            encoded = rebuild.encode_features(features)

        restored = [_decode_polygon(encoded, item)
                    for item in encoded["objects"]["political"]["geometries"]]
        self.assertTrue(restored[0].equals(shape(features[0]["geometry"])))
        self.assertTrue(restored[1].equals(tiny_arctic_geometry()))
        self.assertEqual(encoded["objects"]["political"]["computed_neighbors"],
                         [[], []])


if __name__ == "__main__":
    unittest.main()


class RebuildLineageTests(unittest.TestCase):
    def test_complete_and_unknown_ids(self):
        manifest = {"hierarchy_overrides": {"feature_splits": {"p": ["a", "b"]}}}
        self.assertEqual(rebuild.resolve_rebuild_lineage(["a", "b", "unknown"], manifest), {"a": "p", "b": "p", "unknown": "unknown"})

    def test_incomplete_duplicate_and_nested_children(self):
        for splits, ids in [({"p": ["a", "b"]}, ["a"]), ({"p": ["a", "a"]}, ["a"]), ({"p": ["a"], "q": ["a"]}, ["a"]), ({"p": ["q"], "q": ["a"]}, ["a", "q"])]:
            with self.assertRaises(ValueError):
                rebuild.resolve_rebuild_lineage(ids, {"hierarchy_overrides": {"feature_splits": splits}})
