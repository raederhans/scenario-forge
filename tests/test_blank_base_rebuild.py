from copy import deepcopy
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import geopandas as gpd
import shapely
from shapely.geometry import box, shape

from map_builder.processors.arctic_recovery import decoded_structure
from map_builder.json_source import write_runtime_topology_source
from map_builder.processors.south_asia import exclude_deferred_island_districts
from map_builder.regional_geometry import _absolute_topology
from tools import build_blank_base_scenario as subject


def topology(ids):
    result = {"type": "Topology", "arcs": [], "objects": {
        "political": {"type": "GeometryCollection", "geometries": [],
                      "computed_neighbors": [[] for _ in ids]}
    }}
    for i, fid in enumerate(ids):
        result["arcs"].append([[i, 0], [i + .987654321, 0], [i + .987654321, 1], [i, 1], [i, 0]])
        result["objects"]["political"]["geometries"].append({
            "type": "Polygon", "arcs": [[i]], "properties": {"id": fid, "name": fid}
        })
    return result


class BlankBaseRebuildTest(unittest.TestCase):
    def test_udupi_is_retained_while_reviewed_island_districts_are_deferred(self):
        districts = gpd.GeoDataFrame({
            "shapeID": ["76128533B4839184447445", "76128533B28397307540277", "76128533B22587307937261",
                        "76128533B33103505211400", "76128533B41477629049356"],
            "shapeName": ["Udupi", "North & Middle Andaman", "South Andaman", "Nicobars", "Lakshadweep"],
            "geometry": [box(74.58, 13.13, 75.2, 13.98)] * 5,
        }, crs=4326)
        self.assertEqual(exclude_deferred_island_districts(districts)["shapeName"].tolist(), ["Udupi"])

    def test_inventory_restores_source_land_without_water_or_existing_overlap(self):
        source = topology(["old"])
        raw = box(.95, 0, 3, 1)
        land, lake = box(0, 0, 2.8, 1), box(2, 0, 2.4, 1)
        restoration, report = subject.inventory_missing_land(source, [
            ("IN_ADM2_udupi", "Udupi", "india_adm2", raw),
            ("BLANK_SOURCE_NE_duplicate", "Same footprint", "ne_admin1", raw),
        ], [land], [lake])
        self.assertEqual(report["candidate_count"], 1)
        self.assertLess(report["candidates"][0]["existing_coverage_ratio"], .05)
        added = shape(restoration["features"][0]["geometry"])
        original = shape(decoded_structure(source, source["objects"]["political"]["geometries"][0]))
        self.assertEqual(added.intersection(original).area, 0)
        self.assertEqual(added.intersection(lake).area, 0)
        self.assertEqual(added.difference(land).area, 0)
        restoration["features"][0]["properties"]["cntr_code"] = "IN"
        rebuilt = subject.rebuild_topology(source, source, restoration)
        old = rebuilt["objects"]["political"]["geometries"][0]
        self.assertEqual(decoded_structure(source, source["objects"]["political"]["geometries"][0]),
                         decoded_structure(rebuilt, old))
        self.assertNotIn("cntr_code", rebuilt["objects"]["political"]["geometries"][1]["properties"])
        self.assertEqual(len(rebuilt["objects"]["political"]["computed_neighbors"]), 2)
        # New source identities survive a repeated rebuild as well.
        self.assertEqual(subject.rebuild_topology(source, rebuilt, restoration), rebuilt)

    def test_missing_source_is_restored_even_when_its_representative_point_is_covered(self):
        source = topology(["old"])
        source["arcs"][0] = [[1.49, .49], [1.51, .49], [1.51, .51], [1.49, .51], [1.49, .49]]
        raw = box(1, 0, 2, 1)
        restoration, report = subject.inventory_missing_land(source,
            [("missing", "Missing", "ne_admin1", raw)], [raw], [])
        self.assertEqual(report["candidate_count"], 1)
        self.assertAlmostEqual(report["candidates"][0]["existing_coverage_ratio"], .0004)
        self.assertAlmostEqual(shape(restoration["features"][0]["geometry"]).area, .9996)

    def test_missing_local_restoration_source_stops_before_scanning(self):
        path = subject.ROOT / ".runtime/tmp/does-not-exist-source.geojson"
        with self.assertRaisesRegex(FileNotFoundError, "Required blank restoration source"):
            subject.load_restoration_inputs(path, path, path, path)

    def test_copy_preserves_old_ids_geometry_and_source(self):
        source = topology(["old", "new"])
        source["objects"]["water"] = deepcopy(source["objects"]["political"])
        original = deepcopy(source)
        output = subject.rebuild_topology(source, topology(["old"]))
        self.assertEqual(output, source)
        self.assertEqual(source, original)
        self.assertIsNot(output["arcs"], source["arcs"])
        self.assertEqual([r["properties"]["id"] for r in output["objects"]["political"]["geometries"]],
                         ["old", "new"])

    def test_strips_all_assignment_fields_and_keeps_geography(self):
        source = topology(["old"])
        props = source["objects"]["political"]["geometries"][0]["properties"]
        props.update({key: "occupied" for key in (
            "cntr_code", "country_code", "owner", "controller", "core", "cores",
            "scenario_owner", "scenario_controller", "color", "color_hex",
            "admin1_group", "legacy_name", "anchor_county_name",
        )})
        props.update(claim_status="sector", sector_start_lon=0)
        output = subject.rebuild_topology(source, topology(["old"]))
        self.assertEqual(output["objects"]["political"]["geometries"][0]["properties"], {
            "id": "old", "name": "old", "claim_status": "sector", "sector_start_lon": 0
        })
        self.assertEqual(output["arcs"], source["arcs"])

    def test_rejects_loss_of_existing_id(self):
        with self.assertRaisesRegex(ValueError, "missing existing blank IDs.*old"):
            subject.rebuild_topology(topology(["new"]), topology(["old"]))

    def test_rejects_empty_duplicate_and_missing_ids(self):
        for bad in (topology([]), topology(["old", "old"]), topology([""])):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                subject.rebuild_topology(bad, topology(["old"]))
        with self.assertRaisesRegex(ValueError, "unique"):
            subject.rebuild_topology(topology(["old"]), topology(["old", "old"]))

    def test_rejects_degenerate_holes_invalid_and_empty_polygons(self):
        mutations = [
            lambda t: t["arcs"].__setitem__(0, [[0, 0], [1, 1]]),
            lambda t: t["arcs"].__setitem__(0, [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]),
            lambda t: t["objects"]["political"]["geometries"][0].__setitem__("arcs", []),
            lambda t: t["objects"]["political"]["geometries"][0].__setitem__("arcs", [[99]]),
        ]
        for mutate in mutations:
            bad = topology(["old"])
            mutate(bad)
            with self.subTest(mutate=mutate), self.assertRaisesRegex(ValueError, "source geometry old"):
                subject.rebuild_topology(bad, topology(["old"]))
        bad = topology(["old"])
        bad["arcs"].append([[.1, .1], [.2, .2]])
        bad["objects"]["political"]["geometries"][0]["arcs"].append([1])
        with self.assertRaisesRegex(ValueError, "degenerate"):
            subject.rebuild_topology(bad, topology(["old"]))

    def test_source_replaces_a_corrupt_previous_ring(self):
        previous = topology(["old"])
        previous["arcs"][0] = [[0, 0], [1, 1]]
        self.assertEqual(subject.rebuild_topology(topology(["old"]), previous), topology(["old"]))

    def test_quantized_source_and_reversed_arc_remain_exact(self):
        source = topology(["old"])
        source["transform"] = {"scale": [.000123456789, .000987654321], "translate": [12.123456789, 45.987654321]}
        source["arcs"] = [[[0, 0], [4, 0], [0, 4], [-4, 0], [0, -4]]]
        source["objects"]["political"]["geometries"][0]["arcs"] = [[-1]]
        self.assertEqual(subject.rebuild_topology(source, topology(["old"])), source)

    def test_materializer_receives_only_blank_and_provenance_hashes_source_bytes(self):
        temporary_root = subject.ROOT / ".runtime/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
            root = Path(temporary)
            target = root / "blank_base"
            target.mkdir()
            source = root / "source.json"
            source_bytes = (json.dumps(topology(["old", "new"]), indent=2) + "\n\n").encode()
            source.write_bytes(source_bytes)
            (target / "runtime_topology.topo.json").write_text(json.dumps(topology(["old"])), encoding="utf-8")
            (target / "runtime_topology.topo.json.gz").write_bytes(gzip.compress(b"stale"))
            (target / "manifest.json").write_text(json.dumps({
                "scenario_id": "blank_base", "map_mode": "blank", "baseline_hash": "new-baseline",
                "summary": {"feature_count": 2}
            }), encoding="utf-8")
            (target / "audit.json").write_text(json.dumps({
                "snapshot_fingerprint": "snapshot", "diagnostics": {
                    "baseline_hash": "old-baseline", "detail_topology_feature_count": 1, "note": "preserve"
                }
            }), encoding="utf-8")
            for name, key in (("owners", "owners"), ("cores", "cores"), ("controllers", "controllers")):
                (target / f"{name}.by_feature.json").write_text(json.dumps({key: {}}), encoding="utf-8")
            with patch.object(subject, "refresh_scenario", return_value=["snapshot"]) as refresh:
                report = subject.build_blank_base_scenario(source, target)
            refresh.assert_called_once_with(target, {})
            self.assertEqual(report["feature_count"], 2)
            self.assertEqual(report["preserved_feature_count"], 1)
            expected = hashlib.sha256(source_bytes).hexdigest()
            self.assertEqual(report["source_sha256"], expected)
            self.assertEqual(subject.read(target / "manifest.json")["source"]["ownerless_topology_source_sha256"], expected)
            audit = subject.read(target / "audit.json")
            self.assertEqual(audit["snapshot_fingerprint"], "snapshot")
            self.assertEqual(audit["diagnostics"], {
                "baseline_hash": "new-baseline", "ownerless_source_feature_count": 2, "note": "preserve"
            })
            self.assertFalse((target / "runtime_topology.topo.json.gz").exists())
            manifest = subject.read(target / "manifest.json")
            self.assertEqual(manifest["runtime_topology_url"],
                             (target / "runtime_topology.topo.json").relative_to(subject.ROOT).as_posix())
            self.assertEqual(manifest["source"]["runtime_topology_sha256"],
                             hashlib.sha256((target / "runtime_topology.topo.json").read_bytes()).hexdigest())
            # Missing old IDs must fail before changing the target or manifest.
            source.write_text(json.dumps(topology(["new"])), encoding="utf-8")
            baseline = {path: path.read_bytes() for path in target.iterdir()}
            with self.assertRaisesRegex(ValueError, "missing existing blank IDs"):
                subject.build_blank_base_scenario(source, target)
            self.assertEqual(baseline, {path: path.read_bytes() for path in target.iterdir()})

    def test_compressed_source_and_target_use_one_canonical_representation(self):
        temporary_root = subject.ROOT / ".runtime/tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as temporary:
            root = Path(temporary)
            target, source = root / "blank_base", root / "modern_world"
            target.mkdir()
            source.mkdir()
            payload = topology(["old", "new"])
            for row in payload["objects"]["political"]["geometries"]:
                row["properties"]["name"] = "Geographic name " * 100
            stored_source = write_runtime_topology_source(source, payload, max_bytes=512)
            self.assertEqual(stored_source.suffix, ".gz")
            (target / "runtime_topology.topo.json").write_text(json.dumps(topology(["old"])), encoding="utf-8")
            subject.write_json(target / "manifest.json", {
                "scenario_id": "blank_base", "map_mode": "blank", "baseline_hash": "baseline",
                "summary": {"feature_count": 2},
            })
            subject.write_json(target / "audit.json", {})
            for name in ("owners", "cores", "controllers"):
                subject.write_json(target / f"{name}.by_feature.json", {name: {}})
            with patch.object(subject, "refresh_scenario", return_value=[]), patch.object(
                subject, "write_runtime_topology_source",
                side_effect=lambda directory, result: write_runtime_topology_source(directory, result, max_bytes=512),
            ):
                report = subject.build_blank_base_scenario(source / "runtime_topology.topo.json", target)
            compressed_target = target / "runtime_topology.topo.json.gz"
            self.assertFalse((target / "runtime_topology.topo.json").exists())
            self.assertEqual(subject.read(target / "runtime_topology.topo.json"), payload)
            manifest = subject.read(target / "manifest.json")
            self.assertEqual(manifest["runtime_topology_url"], compressed_target.relative_to(subject.ROOT).as_posix())
            self.assertEqual(report["source_sha256"], hashlib.sha256(stored_source.read_bytes()).hexdigest())
            self.assertEqual(manifest["source"]["runtime_topology_sha256"],
                             hashlib.sha256(compressed_target.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError, "source topology must differ"):
                subject.build_blank_base_scenario(compressed_target, target)


class CheckedInBlankCoverageTest(unittest.TestCase):
    def test_blank_preserves_modern_geometry_and_adds_only_verified_source_land(self):
        source = subject.read(subject.ROOT / "data/scenarios/modern_world/runtime_topology.topo.json")
        blank = subject.read(subject.ROOT / "data/scenarios/blank_base/runtime_topology.topo.json")
        blank_ids = {r["properties"]["id"] for r in subject.political_rows(blank, "blank")}
        source_ids = {r["properties"]["id"] for r in subject.political_rows(source, "source")}
        missing = sorted(source_ids - blank_ids)
        self.assertFalse(missing, f"Blank is missing {len(missing)} Modern World identities: {missing[:5]}")
        expected = subject.rebuild_topology(source, source)
        absolute_source, absolute_blank = _absolute_topology(expected), _absolute_topology(blank)
        source_rows = {row["properties"]["id"]: row for row in subject.political_rows(absolute_source, "source")}
        additions = []
        for row in subject.political_rows(absolute_blank, "blank"):
            fid = row["properties"]["id"]
            self.assertFalse(subject.FORBIDDEN_BLANK_PROPERTIES.intersection(row["properties"]), fid)
            if fid in source_rows:
                self.assertEqual(decoded_structure(absolute_source, source_rows[fid]),
                                 decoded_structure(absolute_blank, row), fid)
            else:
                self.assertTrue(row["properties"].get("__source", "").startswith("blank_source_recovery:"), fid)
                additions.append(row)
        self.assertIn("IN_ADM2_76128533B4839184447445", blank_ids, "Missing mainland Udupi source district")

    def test_added_geometry_stays_within_local_sources_and_excludes_existing_land_and_lakes(self):
        input_paths = (
            subject.ROOT / "data/ne_10m_admin_1_states_provinces.shp",
            subject.ROOT / "data/geoBoundaries-IND-ADM2.geojson",
            subject.ROOT / "data/europe_topology.json", subject.ROOT / "data/global_lakes.geojson",
        )
        missing = [path.name for path in input_paths if not path.is_file()]
        if missing:
            self.skipTest(f"Local restoration source caches are unavailable: {missing}")
        source = subject.read(subject.ROOT / "data/scenarios/modern_world/runtime_topology.topo.json")
        blank = subject.read(subject.ROOT / "data/scenarios/blank_base/runtime_topology.topo.json")
        absolute_source, absolute_blank = _absolute_topology(source), _absolute_topology(blank)
        source_rows = {row["properties"]["id"]: row for row in subject.political_rows(absolute_source, "source")}
        additions = [row for row in subject.political_rows(absolute_blank, "blank")
                     if row["properties"]["id"] not in source_rows]
        units, land, lakes = subject.load_restoration_inputs(
            *input_paths)
        raw_by_id = {fid: subject.polygonal(geometry) for fid, _, _, geometry in units}
        modern_shapes = [shape(decoded_structure(absolute_source, row)) for row in source_rows.values()]
        modern_tree, land_tree, lake_tree = map(shapely.STRtree, (modern_shapes, land, lakes))
        added_shapes = [shape(decoded_structure(absolute_blank, row)) for row in additions]
        addition_tree = shapely.STRtree(added_shapes)
        for index, (row, added) in enumerate(zip(additions, added_shapes)):
            fid = row["properties"]["id"]
            self.assertTrue(added.is_valid and not added.is_empty, fid)
            self.assertLessEqual(added.difference(raw_by_id[fid]).area, 1e-10, fid)
            physical = shapely.union_all([land[int(i)] for i in land_tree.query(added, predicate="intersects")])
            water = shapely.union_all([lakes[int(i)] for i in lake_tree.query(added, predicate="intersects")])
            occupied = shapely.union_all([modern_shapes[int(i)] for i in modern_tree.query(added, predicate="intersects")])
            self.assertLessEqual(added.difference(physical).area, 1e-10, fid)
            self.assertLessEqual(added.intersection(water).area, 1e-10, fid)
            self.assertLessEqual(added.intersection(occupied).area, 1e-10, fid)
            peers = shapely.union_all([added_shapes[int(i)] for i in addition_tree.query(added, predicate="intersects")
                                       if int(i) != index])
            self.assertLessEqual(added.intersection(peers).area, 1e-10, fid)


if __name__ == "__main__":
    unittest.main()
