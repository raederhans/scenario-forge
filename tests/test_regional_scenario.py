import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from shapely.geometry import box, mapping

from map_builder.regional_geometry import _encode_exact_coverage
from tools.build_regional_scenario import build, select_members


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

    def select(self):
        return select_members(self.base, self.base_owners, self.units, self.membership, self.rules)

    def test_membership_union_district_override_and_shells(self):
        owners, _, dropped = self.select()
        self.assertEqual(owners, {"A": "D", "B": "G", "fringe": "F", "neighbor": "N", "east_FB_1": "G"})
        self.assertEqual(dropped, ["bad_FB_1"])

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
                      self.bookmark, self.cities, "2026-11-22T00:00:00Z", "fixture", self.reference)
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


if __name__ == "__main__":
    unittest.main()
