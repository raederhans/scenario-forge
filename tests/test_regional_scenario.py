import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import shapely
from shapely.geometry import Point, box, mapping
from shapely.ops import unary_union

from map_builder.regional_geometry import _decode_geometry, _encode_exact_coverage
from tools.build_regional_scenario import (CuttingUnits, apply_masks, build, era_city_overrides, find_fills,
                                           partition, rebuild_split_topology, resolve_capitals, select_members,
                                           split_features)


def unit(name, polygon):
    return {"type": "Feature", "properties": {"prov_ENG": "P", "unit_key": f"P/{name}"},
            "geometry": mapping(polygon)}


def faction(tag, parent=""):
    return {"tag": tag, "parent": parent, "parent_merged": bool(parent), "name_en": tag,
            "name_zh": tag, "capital_city": tag, "alliance": "league",
            "ruling_ideology": "neutrality", "color_hex": "#123456", "base_iso2": "XX"}


class RegionalScenario(unittest.TestCase):
    def setUp(self):
        # A and B share a baseline arc. Their row numbers change after cropping.
        features = {
            "outside": box(12, 0, 13, 1), "A": box(20, 0, 21, 1), "B": box(21, 0, 22, 1),
            "fringe": box(23, 0, 23.2, 1), "far": box(25, 0, 26, 1), "neighbor": box(14, 0, 15, 1),
            "hot_region": box(16, 0, 17, 1), "excluded": box(24, 0, 25, 1),
            "east_FB_1": box(-179, 0, -178, 1), "minority": box(21.9, 1, 23, 1.5),
        }
        self.base = _encode_exact_coverage(list(features), list(features.values()))
        political = self.base["objects"]["political"]
        political["computed_neighbors"] = [[], [2], [1], [], [], [], [], [], [], [], []]
        political["geometries"].append({"type": "Polygon", "properties": {"id": "bad_FB_1"}, "arcs": [[]]})
        self.base_owners = {"A": "N", "neighbor": "N", "hot_region": "N", "fringe": "F", "far": "F"}
        self.units = {"type": "FeatureCollection", "features": [
            unit("one", box(20, 0, 20.6, 2)), unit("two", box(20.6, 0, 22, 2)),
            unit("removed", box(24, 0, 25, 1)), unit("east", box(181, 0, 182, 1)),
        ]}
        self.membership = {
            "excluded_districts": ["P/removed"], "neighbor_tags": ["N"], "border_tags": ["F"],
            "neighbor_exclusion_bounds": {"N": [16, 0, 17, 1]}, "border_distance_km": 150,
            "majority_threshold": 0.5, "central_meridian": 90, "opening_bounds": [15, 0, 30, 5],
            "base_scenario": "base", "base_topology_sha256": "fixture",
        }
        self.rules = {"as_of": "1919-10-15", "provinces": {"P": "G"}, "districts": {"P/one": "D"},
                      "neighbor_owner_map": {"N": "N", "F": "F"}, "excluded_districts": []}
        self.bookmark = {
            "scenario_id": "fixture", "factions": [faction("D", "C"), faction("C"), faction("N"),
                                                  faction("G"), faction("F")],
            "alliances": {"league": {"name_en": "League", "name_zh": "阵营", "color_hex": "#123456"}},
            "featured_tags": ["D", "N", "C"], "default_country": "D",
            "display_name": "Fixture", "bookmark_name": "Fixture", "bookmark_description": "Fixture",
        }
        self.cities = {"features": [
            {"properties": {"city_id": tag, "stable_key": f"id::{tag}", "name_ascii": tag, "country_code": "XX"},
             "geometry": {"type": "Point", "coordinates": [20.5, 0.5]}} for tag in ["D", "N"]
        ]}
        self.reference = {"XX": {"base_iso2": "XX", "continent_id": "continent_asia", "continent_label": "Asia",
                                 "subregion_id": "subregion_central_asia", "subregion_label": "Central Asia"}}
        self.splits = {"subtract": {}, "adm2_partitions": [], "district_partitions": [],
                       "min_area_fraction": .02, "min_area_km2": 150}

    def select(self):
        return select_members(self.base, self.base_owners, self.units, self.membership, self.rules)

    def test_membership_union_district_override_and_shells(self):
        owners, _, dropped = self.select()
        self.assertEqual(owners, {"A": "D", "B": "G", "fringe": "F", "neighbor": "N", "east_FB_1": "G"})
        self.assertEqual(dropped, ["bad_FB_1"])

    def test_membership_excludes_matching_ids(self):
        self.membership["exclude_id_patterns"] = ["east_FB_*", "neighbor"]
        self.assertEqual(set(self.select()[0]), {"A", "B", "fringe"})

    def test_masks_split_majority_and_province_filter(self):
        shapes = {"A": box(0, 0, 4, 2), "B": box(4, 0, 5, 2)}
        owners = dict.fromkeys(shapes, "G")
        districts = CuttingUnits([unit("one", shapes["A"])])
        masks = [{"id": "strip", "owner": "M", "within_provinces": ["P"],
                  "polygon": mapping(box(3, 0, 5, 2))["coordinates"]},
                 {"id": "point", "owner": "N", "points": [[4.5, 1]]}]
        replacements = {}
        assigned = {"A": districts.rows[0]}
        audit = apply_masks(masks, shapes, owners, districts, assigned, self.rules, self.splits, replacements,
                            {"A": "A", "B": "B"})
        self.assertEqual(audit["strip"]["split_parents"], ["A"])
        self.assertEqual(audit["strip"]["hit_count"], 1)
        self.assertEqual(owners, {"A__RCW_strip": "M", "A__RCW_strip_OUT": "D", "B": "N"})
        self.assertTrue(shapes["A__RCW_strip"].equals(box(3, 0, 4, 2)))
        masks.append({"id": "second", "owner": "G", "points": [[4.75, 1]]})
        with self.assertRaisesRegex(ValueError, "Conflicting mask owners.*B"):
            apply_masks(masks, shapes, owners, districts, assigned, self.rules, self.splits, replacements, {})

    def test_only_enclosed_land_is_filled_and_shares_arcs(self):
        hole = box(1, 1, 2, 2)
        outer = box(0, 0, 4, 4).difference(hole).difference(box(2.5, 1, 3.5, 2))
        county = unit("one", box(0, 0, 4, 4))
        county["properties"]["Name_ENG"] = "One"
        fills, audit = find_fills({"A": outer}, shapely.STRtree([hole]), shapely.STRtree([]), CuttingUnits([county]))
        self.assertEqual(len(audit), 1)
        fid, name, geom = fills[0]
        self.assertEqual((fid, name), ("RCW_FILL_P_one", "One"))
        self.assertTrue(geom.equals(hole))
        base = _encode_exact_coverage(["A"], [outer])
        base["bbox"] = list(outer.bounds)
        topo = rebuild_split_topology(base, {}, fills)
        rows = topo["objects"]["political"]["geometries"]
        refs = lambda ring: {i if i >= 0 else ~i for i in ring}
        self.assertIn(refs(rows[1]["arcs"][0]), [refs(ring) for ring in rows[0]["arcs"][1:]])

    def test_mask_splits_when_minority_intersections_cover_most_of_mask(self):
        shapes = {"small": box(0, 0, 1, 1), "large": box(1, 0, 7, 1)}
        owners = dict.fromkeys(shapes, "G")
        mask = {"id": "front", "owner": "M", "polygon": mapping(box(0, 0, 3, 1))["coordinates"]}
        audit = apply_masks([mask], shapes, owners, CuttingUnits([]), {}, self.rules, self.splits, {},
                            {fid: fid for fid in shapes})
        self.assertEqual(audit["front"]["split_parents"], ["large"])
        self.assertEqual({fid for fid, owner in owners.items() if owner == "M"}, {"small", "large__RCW_front"})

    def test_local_capital_and_era_name_aliases(self):
        coords = {"name_en": "Local", "name_zh": "地方", "lon": 21.5, "lat": .5}
        owners = {"A": "D", "B": "N"}
        shapes = {"A": box(20, 0, 21, 1), "B": box(21, 0, 22, 1)}
        factions = [faction("D"), {**faction("N"), "capital_coordinates": coords}]
        city = self.cities["features"][0]
        city["properties"].update(name_en="D", aliases=["Modern"])
        hints, unresolved, additions, _ = resolve_capitals(factions, self.cities, shapes, owners, 90)
        self.assertFalse(unresolved)
        rules = {"Modern": {"en": "Era", "zh": "古称"}, "Absent": {"en": "Other", "zh": "其他"}}
        overrides, missing = era_city_overrides(rules, self.cities, shapes, 90, hints, additions)
        self.assertEqual(missing, {"Absent": []})
        self.assertEqual(hints["D"]["city_name"], "Era")
        self.assertIn("Modern", overrides["D"]["aliases"])
        local = overrides[hints["N"]["city_id"]]
        self.assertTrue(local["add_city"])
        self.assertEqual((local["host_feature_id"], local["lon"], local["lat"]), ("B", 21.5, .5))

    def test_unassigned_members_are_reported_together(self):
        self.rules["provinces"] = {}
        with self.assertRaises(ValueError) as caught:
            self.select()
        for fid in ["B", "east_FB_1"]:
            self.assertIn(f'"{fid}"', str(caught.exception))

    def test_majority_uses_the_union_and_counts_overlaps_only_once(self):
        self.units["features"] = [unit("one", box(20, 0, 20.4, 1)), unit("two", box(20.4, 0, 20.7, 1))]
        self.assertEqual(self.select()[0]["A"], "D")
        self.units["features"][1] = unit("two", box(20.1, 0, 20.4, 1))
        self.assertEqual(self.select()[0]["A"], "N")

    def test_each_build_reproduces_all_files_and_preserves_shared_geometry(self):
        self.bookmark["factions"][0]["capital_city"] = ["Absent", "Outside", "Earlier alias", "N"]
        self.cities["features"][0]["properties"]["aliases"] = ["Earlier alias"]
        self.cities["features"].append({"properties": {"name": "Outside"},
                                        "geometry": {"type": "Point", "coordinates": [14.5, 0.5]}})
        with TemporaryDirectory() as tmp:
            copies = []
            for number in ["first", "second"]:
                out = Path(tmp, number, "fixture")
                build(out, self.base, self.base_owners, self.units, self.membership, self.rules,
                      self.bookmark, self.cities, "2026-11-22T00:00:00Z", "fixture", self.reference,
                      self.splits, {"features": []})
                copies.append({p.name: p.read_bytes() for p in out.iterdir()})
        self.assertEqual(copies[0], copies[1])
        products = {k: json.loads(v) for k, v in copies[0].items()}
        countries = products["countries.json"]["countries"]
        self.assertEqual((countries["C"]["entry_kind"], countries["C"]["feature_count"]), ("scenario_container", 0))
        self.assertEqual(countries["D"]["parent_owner_tags"], ["C"])
        self.assertEqual(countries["D"]["presentation"], "parent_merged")
        for key, value in self.reference["XX"].items():
            self.assertEqual(countries["D"][key], value)
        self.assertEqual(products["cores.by_feature.json"]["cores"]["B"], ["G"])
        manifest = products["manifest.json"]
        self.assertEqual(manifest["region"]["bounds"], [14, 0, -178, 1])
        self.assertEqual(manifest["featured_tags"], ["D"])
        self.assertEqual(products["special_zone_layers.json"], {
            "version": 1, "layers": [], "activeLayerId": "", "diagnostics": [],
            "topologyFingerprint": manifest["baseline_hash"],
        })
        self.assertEqual(products["city_overrides.json"]["capitals_by_tag"], {"D": "D"})
        self.assertEqual(products["city_overrides.json"]["capital_city_hints"]["D"]["city_name"], "Earlier alias")
        self.assertEqual(products["audit.json"]["unresolved_capitals"]["N"]["reason"], "outside_owned_land")
        topology = products["runtime_topology.topo.json"]
        political = topology["objects"]["political"]
        self.assertEqual(political["computed_neighbors"], [[1], [0], [], [], []])
        a, b = [row["arcs"][0] for row in political["geometries"][:2]]
        self.assertTrue(any(~arc in b for arc in a))
        self.assertLess(len(topology["arcs"]), len(self.base["arcs"]))
        self.assertTrue(all(arc in self.base["arcs"] for arc in topology["arcs"]))
        self.assertEqual(topology["bbox"], [-179, 0, 23.2, 1])

    def test_sliver_joins_longest_shared_edge(self):
        parent = box(0, 0, 4, 4)
        sliver = box(1, 1, 1.02, 2)
        left = box(0, 0, 1, 1.5)
        right = parent.difference(unary_union([left, sliver]))
        cuts = CuttingUnits([unit("a", left), unit("b", right), unit("c", sliver)])
        pieces, count = partition(parent, cuts, .02, 0)
        self.assertEqual(count, 1)
        self.assertTrue(pieces["P/b"].covers(sliver))
        self.assertTrue(unary_union(list(pieces.values())).equals(parent))
        self.assertEqual(pieces["P/a"].intersection(pieces["P/b"]).area, 0)
        one = CuttingUnits([unit("thin", box(0, 0, .01, 4)), unit("wide", box(.01, 0, 4, 4))])
        self.assertEqual(partition(parent, one, .02, 0), ({}, 1))

    def test_two_complete_builds_with_cuts(self):
        for row in self.base["objects"]["political"]["geometries"]:
            row["properties"]["name"] = row["properties"]["id"]
        results = []
        with TemporaryDirectory() as tmp:
            for n in ("a", "b"):
                out = Path(tmp, n, "fixture")
                build(out, self.base, self.base_owners, self.units, self.membership, self.rules,
                      self.bookmark, self.cities, "2026-11-22T00:00:00Z", "fixture", self.reference,
                      {**self.splits, "district_partitions": ["P"]}, {"features": []})
                results.append({p.name: p.read_bytes() for p in out.iterdir()})
        self.assertEqual(results[0], results[1])
        self.assertEqual(json.loads(results[0]["audit.json"])["geometry_splits"]["children_by_parent"]["A"],
                         ["A__RCW_P_one", "A__RCW_P_two"])

    def test_uncovered_child_inherits_prototype_owner(self):
        self.units["features"] = [unit("one", box(20, 0, 20.6, 1))]
        for row in self.base["objects"]["political"]["geometries"]:
            row["properties"]["name"] = row["properties"]["id"]
        with TemporaryDirectory() as tmp:
            out = Path(tmp, "fixture")
            build(out, self.base, self.base_owners, self.units, self.membership, self.rules,
                  self.bookmark, self.cities, "2026-11-22T00:00:00Z", "fixture", self.reference,
                  {**self.splits, "district_partitions": ["P"]}, {"features": []})
            cid = "A__RCW_REMAINDER"
            self.assertEqual(json.loads((out/"owners.by_feature.json").read_bytes())["owners"][cid], "D")
            entry = json.loads((out/"audit.json").read_bytes())["geometry_splits"]["zero_intersection_inheritance"][cid]
            self.assertEqual((entry["parent_id"], entry["owner"]), ("A", "D"))
            self.assertGreater(entry["area_km2"], 0)

    def test_trace_county_overlap_inherits_parent_and_is_audited(self):
        parent = box(20, 0, 21, 1)
        noise = box(21 - 1e-9, 0, 21, 1)
        historical = {"features": [unit("one", box(20, 0, 20.6, 1)), unit("noise", noise)]}
        topo = _encode_exact_coverage(["A"], [parent])
        topo["objects"]["political"]["geometries"][0]["properties"]["name"] = "A"
        shapes, owners = {"A": parent}, {"A": "D"}
        _, audit = split_features(topo, shapes, owners, historical, {"features": []},
                                  {**self.splits, "district_partitions": ["P"]}, self.rules)
        cid = "A__RCW_REMAINDER"
        overlap = shapes[cid].intersection(noise).area
        self.assertGreater(overlap, 0)
        self.assertLess(overlap, shapes[cid].area * 1e-6)
        self.assertEqual(owners[cid], "D")
        inherited = audit["zero_intersection_inheritance"][cid]
        self.assertEqual((inherited["parent_id"], inherited["owner"]), ("A", "D"))

    def test_mask_children_but_not_fills_enter_manifest_splits(self):
        extent = box(20, 0, 24, 4)
        hole = box(21, 1, 23, 3)
        water = box(21, 1, 21.4, 3)
        historic = box(20.8, 1.5, 21.6, 2.5)
        excluded = box(22, 1, 23, 3)
        base = _encode_exact_coverage(["parent", "lake__SPLIT_ARAL"], [extent.difference(hole), excluded])
        base["objects"]["political"]["computed_neighbors"] = [[], []]
        county = unit("one", extent)
        county["properties"]["Name_ENG"] = "One"
        mask = {"id": "west", "owner": "D", "polygon": mapping(box(20, 0, 20.7, 4))["coordinates"]}
        with TemporaryDirectory() as tmp:
            out = Path(tmp, "fixture")
            build(out, base, {}, {"features": [county]}, {**self.membership, "exclude_id_patterns": ["*__SPLIT_ARAL*"]},
                  {**self.rules, "masks": [mask]}, self.bookmark, self.cities, "fixed", "fixture", self.reference,
                  self.splits, {"features": []}, public_land=shapely.STRtree([extent]),
                  public_water=shapely.STRtree([water]), historic_water=historic)
            splits = json.loads((out / "manifest.json").read_bytes())["hierarchy_overrides"]["feature_splits"]
            self.assertEqual(set(splits), {"parent"})
            self.assertCountEqual(splits["parent"], ["parent__RCW_west", "parent__RCW_west_OUT"])
            topology = json.loads((out / "runtime_topology.topo.json").read_bytes())
            fill = next(r for r in topology["objects"]["political"]["geometries"] if r["id"].startswith("RCW_FILL_"))
            self.assertTrue(_decode_geometry(topology, fill).equals(hole.difference(water.union(excluded).union(historic))))
            for row in topology["objects"]["political"]["geometries"]:
                self.assertEqual(_decode_geometry(topology, row).intersection(historic).area, 0)

    def test_mask_point_on_shared_boundary_reports_both_hosts(self):
        shapes = {"A": box(20, 0, 21, 1), "B": box(21, 0, 22, 1)}
        with self.assertRaisesRegex(ValueError, r"boundary.*21.*'A'.*'B'"):
            apply_masks([{"id": "boundary", "owner": "D", "points": [[21, .5]]}], shapes,
                        dict.fromkeys(shapes, "G"), CuttingUnits([]), {}, self.rules, self.splits, {}, {})

    def test_custom_capital_outside_moves_to_nearest_owned_edge(self):
        coord = {"name_en": "D", "name_zh": "D", "lon": 20.5, "lat": 2, "add_city": True}
        hints, _, additions, offsets = resolve_capitals([{**faction("D"), "capital_coordinates": coord}],
            self.cities, {"A": box(20, 0, 21, 1)}, {"A": "D"}, 90)
        self.assertEqual(hints["D"]["city_id"], "RCW_CITY_D")
        self.assertEqual([additions["RCW_CITY_D"][key] for key in ("lon", "lat")], [20.5, 1])
        self.assertAlmostEqual(offsets["D"]["distance_km"], 110.58, places=2)

    def test_era_names_require_unique_maximum_population_within_members(self):
        for city, population in zip(self.cities["features"], [10, 20]):
            city["properties"].update(name_en="Modern", population=population)
        rules = {"Modern": {"en": "Era", "zh": "旧称"}}
        shapes = {"A": box(20, 0, 21, 1)}
        overrides, missing = era_city_overrides(rules, self.cities, shapes, 90, {}, {})
        self.assertEqual((list(overrides), missing), (["N"], {}))
        self.cities["features"][0]["properties"]["population"] = 20
        overrides, missing = era_city_overrides(rules, self.cities, shapes, 90, {}, {})
        self.assertEqual((overrides, missing), ({}, {"Modern": ["D", "N"]}))

    def test_subtraction_preserves_city_and_single_piece_ids(self):
        polygons = [box(20, 0, 22, 1), box(21.5, .25, 22.5, .75)]
        ids = ["district", "city"]
        t = _encode_exact_coverage(ids, polygons)
        t["bbox"] = [20, 0, 22.5, 1]
        for row in t["objects"]["political"]["geometries"]:
            row["properties"]["name"] = row["properties"]["id"]
        rules = {**self.splits, "subtract": {"district": "city"}, "district_partitions": ["P"]}
        r, audit = split_features(t, dict(zip(ids, polygons)), dict.fromkeys(ids, "G"),
                                  {"features": [unit("one", box(0, 0, 25, 5))]}, {"features": []},
                                  rules, self.rules)
        result = rebuild_split_topology(t, r)
        restored = {row["properties"]["id"]: _decode_geometry(result, row)
                    for row in result["objects"]["political"]["geometries"]}
        self.assertEqual(set(restored), set(ids))
        self.assertEqual(audit["children_by_parent"], {})
        self.assertEqual([k for k, g in restored.items() if g.covers(Point(21.75, .5))], ["city"])
        self.assertTrue(restored["city"].equals(polygons[1]))
        self.assertTrue(restored["district"].equals(polygons[0].difference(polygons[1])))

    def test_split_ids_shared_arcs_and_neighbors(self):
        ids = ["parent", "neighbor"]
        polygons = [box(20, 0, 22, 1), box(22, 0, 23, 1)]
        t = _encode_exact_coverage(ids, polygons)
        t["bbox"] = [20, 0, 23, 1]
        for row in t["objects"]["political"]["geometries"]:
            row["properties"]["name"] = row["properties"]["id"]
        features = [unit("one", box(20, 0, 22, .4)), unit("two", box(20, .4, 22, 1))]
        copies = []
        for units in (features, features[::-1]):
            r, audit = split_features(t, dict(zip(ids, polygons)), dict.fromkeys(ids, "G"),
                                      {"features": units}, {"features": []},
                                      {**self.splits, "district_partitions": ["P"]}, self.rules)
            copies.append(rebuild_split_topology(t, r))
            self.assertEqual(audit["children_by_parent"]["parent"], ["parent__RCW_P_one", "parent__RCW_P_two"])
            self.assertEqual(audit["residual_km2_by_parent"]["parent"], 0)
        self.assertEqual(copies[0], copies[1])
        political = copies[0]["objects"]["political"]
        refs = [{ref if ref >= 0 else ~ref for ref in row["arcs"][0]} for row in political["geometries"]]
        self.assertTrue(refs[0] & refs[1] and refs[1] & refs[2] and refs[0] & refs[2])
        self.assertEqual(political["computed_neighbors"], [[1, 2], [0, 2], [0, 1]])


class HierarchyOverridesTest(unittest.TestCase):
    def test_base_overrides_project_onto_regional_leaves(self):
        from tools.build_regional_scenario import hierarchy_overrides
        base = {
            "feature_splits": {"A": ["A__X", "A__Y"], "OUT": ["OUT__1"], "B": ["B__KEEP", "B__GONE"]},
            "feature_merges": {"M1": ["P", "Q"], "M2": ["R", "S"], "M_OUT": ["T", "U"]},
        }
        members = {"A__X__RCW_1", "A__X__RCW_2", "A__Y", "B__KEEP", "C__RCW_1", "C__RCW_2", "M1", "M2__RCW_1", "M2__RCW_2"}
        children = {"A__X": ["A__X__RCW_1", "A__X__RCW_2"], "C": ["C__RCW_1", "C__RCW_2"],
                    "M2": ["M2__RCW_1", "M2__RCW_2"]}
        result = hierarchy_overrides(base, members, children)
        self.assertEqual(result["feature_splits"], {
            "A": ["A__X__RCW_1", "A__X__RCW_2", "A__Y"], "B": ["B__KEEP"],
            "C": ["C__RCW_1", "C__RCW_2"], "M2": ["M2__RCW_1", "M2__RCW_2"],
        })
        self.assertEqual(result["feature_merges"], {"M1": ["P", "Q"], "M2": ["R", "S"]})
        self.assertEqual(hierarchy_overrides(None, members, {}), {"feature_merges": {}, "feature_splits": {}})


if __name__ == "__main__":
    unittest.main()
