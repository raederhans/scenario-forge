import unittest
import json
import tempfile
from copy import deepcopy
from pathlib import Path

from shapely.geometry import MultiPolygon, box, mapping, shape

from tools import patch_tno_1962_bundle as b
from tools.rebuild_atlantropa_stage import (
    clip_new_atlantropa_land_from_named_water, merge_atlantropa_bathymetry,
    preserve_identical_atl_helper_assignments, preserve_political_chunks_for_unchanged_source,
    reconcile_feature_map,
)
from tools.check_scenario_contracts import _load_chunk_feature_index, _atlantropa_feature_row, _collect_snapshot_inputs, _sha256_path


class AtlantropaStageTests(unittest.TestCase):
    def test_helper_occupied_id_chain_restores_old_ids_and_moves_only_new_source(self):
        def shoal(number, province, left, owner):
            return {"type": "Feature", "properties": {
                "id": f"ATLSHL_west_med_{number}", "name": f"West Mediterranean Shore Seal {number}",
                "owner_tag": owner, "synthetic_owner": owner == "ATL",
                "assignment_source": "atl_default" if owner == "ATL" else "state_owner_override",
                "region_id": "west_med", "atl_geometry_role": "shore_seal", "atl_join_mode": "gap_fill",
                "source_standard": "hgo_donor_province_georef", "donor_state_ids": [province],
                "donor_state_names": [f"State {province}"], "donor_province_ids": [province],
            }, "geometry": mapping(box(left, 0, left + 0.5, 0.5))}
        old = [shoal(2, 18153, 0, "IAL"), shoal(3, 18154, 1, "IAL"),
               shoal(5, 18216, 2, "IBR"), shoal(6, 18160, 3, "ATL")]
        new = [shoal(2, 18332, 4, "IAL"), shoal(4, 18153, 0, "ALC"),
               shoal(5, 18154, 1, "ALC"), shoal(7, 18216, 2, "IAL"),
               shoal(6, 18160, 3, "IBR")]
        renames, reallocations = {}, {}
        matched = preserve_identical_atl_helper_assignments(
            old, new, renamed_ids=renames, reallocated_ids=reallocations)
        self.assertEqual(matched, {feature["properties"]["id"] for feature in old})
        self.assertEqual(renames, {"ATLSHL_west_med_4": "ATLSHL_west_med_2",
                                   "ATLSHL_west_med_5": "ATLSHL_west_med_3",
                                   "ATLSHL_west_med_7": "ATLSHL_west_med_5"})
        self.assertEqual(reallocations, {"ATLSHL_west_med_2": "ATLSHL_west_med_8"})
        self.assertEqual([feature["properties"]["id"] for feature in new],
                         ["ATLSHL_west_med_8", "ATLSHL_west_med_2", "ATLSHL_west_med_3",
                          "ATLSHL_west_med_5", "ATLSHL_west_med_6"])
        self.assertEqual(new[0]["properties"]["name"], "West Mediterranean Shore Seal 8")
        for previous, current in zip(old, new[1:]):
            self.assertEqual(current["properties"]["owner_tag"], previous["properties"]["owner_tag"])
            self.assertEqual(current["properties"]["name"], previous["properties"]["name"])
        old_owners = {feature["properties"]["id"]: feature["properties"]["owner_tag"] for feature in old}
        owners = reconcile_feature_map({"owners": old_owners}, "owners", set(old_owners), new,
                                       identical_helper_ids=matched)["owners"]
        self.assertEqual({key: owners[key] for key in old_owners}, old_owners)
        self.assertEqual(owners["ATLSHL_west_med_8"], "IAL")

        ambiguous = [old[0], deepcopy(old[0])]
        ambiguous[1]["properties"]["id"] = "ATLSHL_west_med_9"
        with self.assertRaisesRegex(ValueError, "Ambiguous Atlantropa helper identity"):
            preserve_identical_atl_helper_assignments(ambiguous, [shoal(4, 18153, 0, "IAL")])

    def test_unchanged_political_source_preserves_all_old_chunk_bytes_despite_new_lod_geometry(self):
        with tempfile.TemporaryDirectory() as directory:
            source, stage = Path(directory) / "source", Path(directory) / "stage"
            for root in (source, stage):
                (root / "chunks").mkdir(parents=True)
            features = [{"type": "Feature", "properties": {"id": feature_id, "owner": "A"},
                         "geometry": mapping(box(index, 0, index + 1, 1))}
                        for index, feature_id in enumerate(("A", "B"))]
            political = {"type": "FeatureCollection", "features": features}
            same_id, changed_id = "political.detail.same", "political.detail.changed"
            def entry(chunk_id, marker):
                return {"id": chunk_id, "layer": "political", "lod": "detail",
                        "url": f"data/scenarios/tno_1962/chunks/{chunk_id}.json", "sha256": marker}
            old_entries = [entry(same_id, "old-same"), entry(changed_id, "old-changed")]
            new_entries = [entry(same_id, "new-same"), entry(changed_id, "new-changed")]
            (source / "detail_chunks.manifest.json").write_text(
                json.dumps({"chunks": old_entries}), encoding="utf-8")
            (stage / "detail_chunks.manifest.json").write_text(
                json.dumps({"chunks": new_entries}), encoding="utf-8")
            for root in (source, stage):
                (root / "owners.by_feature.json").write_text(json.dumps({"owners": {"A": "ALC"}}), encoding="utf-8")
                (root / "cores.by_feature.json").write_text(json.dumps({"cores": {"A": ["ALC"]}}), encoding="utf-8")
            old_bytes = json.dumps(political, indent=2).encode()
            reversed_bytes = json.dumps({"type": "FeatureCollection", "features": list(reversed(features))}).encode()
            changed_features = deepcopy(features)
            changed_features[0]["geometry"] = mapping(box(0, 0, 0.5, 1))
            changed_bytes = json.dumps({"type": "FeatureCollection", "features": changed_features}).encode()
            for chunk_id in (same_id, changed_id):
                (source / "chunks" / f"{chunk_id}.json").write_bytes(old_bytes)
            (stage / "chunks" / f"{same_id}.json").write_bytes(reversed_bytes)
            (stage / "chunks" / f"{changed_id}.json").write_bytes(changed_bytes)

            mesh = {"meshes": {"borders": [[1, 2], [3, 4]]}}
            (source / "mesh_pack.json").write_text(json.dumps(mesh, indent=2), encoding="utf-8")
            (stage / "mesh_pack.json").write_text(json.dumps(mesh), encoding="utf-8")
            retained = preserve_political_chunks_for_unchanged_source(source, stage, political, deepcopy(political))
            self.assertEqual((source / "mesh_pack.json").read_bytes(), (stage / "mesh_pack.json").read_bytes())
            self.assertEqual(retained, [same_id, changed_id])
            self.assertEqual((stage / "chunks" / f"{same_id}.json").read_bytes(), old_bytes)
            self.assertEqual((stage / "chunks" / f"{changed_id}.json").read_bytes(), old_bytes)
            descriptors = b.load_json(stage / "detail_chunks.manifest.json")["chunks"]
            self.assertEqual(descriptors[0], old_entries[0])
            self.assertEqual(descriptors[1], old_entries[1])

            (stage / "owners.by_feature.json").write_text(json.dumps({"owners": {"A": "IBR"}}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Political assignment map changed"):
                preserve_political_chunks_for_unchanged_source(source, stage, political, political)
            (stage / "owners.by_feature.json").write_text(json.dumps({"owners": {"A": "ALC"}}), encoding="utf-8")
            wrong_url = deepcopy(b.load_json(stage / "detail_chunks.manifest.json"))
            wrong_url["chunks"][0]["url"] = "data/scenarios/tno_1962/chunks/other.json"
            (stage / "detail_chunks.manifest.json").write_text(json.dumps(wrong_url), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Political chunk ID/URL manifest changed"):
                preserve_political_chunks_for_unchanged_source(source, stage, political, political)
            with self.assertRaisesRegex(ValueError, "Political source features changed"):
                preserve_political_chunks_for_unchanged_source(source, stage, political,
                                                               {"type": "FeatureCollection", "features": []})

    def test_identical_shoal_keeps_published_owner_and_core_but_reused_id_does_not(self):
        props = {"id": "ATLSHL_west_med_6", "region_id": "west_med", "atl_geometry_role": "shore_seal",
                 "atl_join_mode": "gap_fill", "atl_render_layer": "shoal",
                 "source_standard": "hgo_donor_province_georef", "donor_state_ids": [8446, 8449],
                 "donor_state_names": ["Ceuta Alantropa Zone", "Gibraltar Dam Site"],
                 "donor_province_ids": [18160, 18164], "owner_tag": "ATL",
                 "synthetic_owner": True, "assignment_source": "atl_default"}
        old = {"type": "Feature", "properties": deepcopy(props), "geometry": mapping(box(0, 0, 1, 1))}
        regenerated = deepcopy(old)
        regenerated["properties"].update(owner_tag="IBR", synthetic_owner=False,
                                          assignment_source="state_owner_override")
        matching = preserve_identical_atl_helper_assignments([old], [regenerated])
        self.assertEqual(matching, {props["id"]})
        self.assertEqual(regenerated["properties"], old["properties"])
        for key, value in (("owners", "ATL"), ("controllers", "ATL"), ("cores", ["ATL"])):
            result = reconcile_feature_map({key: {props["id"]: value}}, key, {props["id"]},
                                           [regenerated], identical_helper_ids=matching)
            self.assertEqual(result[key][props["id"]], value)

        changed = deepcopy(regenerated)
        changed["properties"]["owner_tag"] = "IBR"
        changed["geometry"] = mapping(box(0, 0, 2, 1))
        self.assertEqual(preserve_identical_atl_helper_assignments([old], [changed]), set())
        result = reconcile_feature_map({"owners": {props["id"]: "ATL"}}, "owners", {props["id"]}, [changed])
        self.assertEqual(result["owners"][props["id"]], "IBR")
        changed["geometry"] = old["geometry"]
        changed["properties"]["donor_province_ids"] = [18160, 18165]
        self.assertEqual(preserve_identical_atl_helper_assignments([old], [changed]), set())

    def test_unique_renumbered_helper_restores_old_id_name_and_maps(self):
        old = {"type": "Feature", "properties": {
            "id": "ATLWLD_aegean_88", "name": "Old Weld 88", "owner_tag": "ATL",
            "synthetic_owner": True, "assignment_source": "atl_default",
            "region_id": "aegean", "atl_geometry_role": "boolean_weld", "atl_join_mode": "boolean_weld",
            "atl_render_layer": "land", "source_standard": "hgo_donor_province_georef",
            "donor_state_ids": [1], "donor_state_names": ["Donor"], "donor_province_ids": [2],
        }, "geometry": mapping(box(0, 0, 1, 1))}
        new = deepcopy(old)
        new["properties"].update(id="ATLWLD_aegean_89", name="New Weld 89", owner_tag="IBR",
                                  synthetic_owner=False, assignment_source="state_owner_override")
        new["properties"].pop("atl_render_layer")  # normalized donor stage is not runtime-classified yet
        renamed = {}
        matched = preserve_identical_atl_helper_assignments([old], [new], renamed_ids=renamed)
        self.assertEqual(renamed, {"ATLWLD_aegean_89": "ATLWLD_aegean_88"})
        self.assertEqual(matched, {"ATLWLD_aegean_88"})
        self.assertEqual(new["properties"]["name"], "Old Weld 88")
        self.assertEqual(new["properties"]["owner_tag"], "ATL")
        for key, value in (("owners", "ATL"), ("cores", ["ATL"])):
            result = reconcile_feature_map({key: {"ATLWLD_aegean_88": value}}, key,
                                           {"ATLWLD_aegean_88"}, [new], identical_helper_ids=matched)
            self.assertEqual(result[key], {"ATLWLD_aegean_88": value})

        different_lineage = deepcopy(new)
        different_lineage["properties"].update(id="ATLWLD_aegean_89", donor_province_ids=[3])
        self.assertEqual(preserve_identical_atl_helper_assignments([old], [different_lineage]), set())
        self.assertEqual(different_lineage["properties"]["id"], "ATLWLD_aegean_89")

    @staticmethod
    def _water_fixture(*, invalid=False):
        water = [
            {"type": "Feature", "properties": {"id": "tno_sea_of_marmara", "name": "Marmara", "water_type": "sea"},
             "geometry": mapping(MultiPolygon([box(0, 0, 4, 2), box(8, 0, 8.00001, 0.000005)]))},
            {"type": "Feature", "properties": {"id": "tno_bosporus_dardanelles", "name": "Straits", "water_type": "chokepoint"},
             "geometry": mapping(box(4, 0, 6, 2))},
            {"type": "Feature", "properties": {"id": "congo_lake", "name": "Unrelated", "water_type": "lake"},
             "geometry": mapping(box(10, 0, 12, 2))},
        ]
        if invalid:
            water[0]["geometry"] = {"type": "Polygon", "coordinates": [[
                [0, 0], [4, 2], [0, 2], [4, 0], [0, 0],
            ]]}
        topology = {"type": "Topology", "objects": {"scenario_water": {
            "type": "GeometryCollection", "geometries": [],
        }}, "arcs": []}
        for index, feature in enumerate(water):
            geometry = b._geometry_to_topology_geometry(topology, {
                "id": index, "properties": deepcopy(feature["properties"]),
            }, shape(feature["geometry"]))
            topology["objects"]["scenario_water"]["geometries"].append(geometry)
        return topology, {"type": "FeatureCollection", "features": water}

    @staticmethod
    def _atl(geom):
        return [{"type": "Feature", "properties": {"id": "ATLPRV_1", "atl_render_layer": "land"},
                 "geometry": mapping(geom)}]

    def test_new_land_clips_only_intersecting_named_water_and_preserves_metadata_and_island(self):
        topology, water = self._water_fixture()
        original_topology = deepcopy(topology)
        original_water = deepcopy(water)
        old_atl = self._atl(box(0.5, 0.5, 1, 1))
        new_atl = self._atl(MultiPolygon([box(0.5, 0.5, 1, 1), box(2, 0.5, 5, 1.5)]))
        updated, diagnostics = clip_new_atlantropa_land_from_named_water(topology, water, old_atl, new_atl)
        self.assertEqual(diagnostics["changed_water_ids"], ["tno_sea_of_marmara", "tno_bosporus_dardanelles"])
        self.assertAlmostEqual(diagnostics["removed_area_degrees2"], 3)
        runtime = {f["properties"]["id"]: f for f in b.topology_object_to_feature_collection(topology, "scenario_water")["features"]}
        for before, after in zip(original_water["features"], updated["features"]):
            feature_id = before["properties"]["id"]
            self.assertEqual(after["properties"], before["properties"])
            self.assertTrue(shape(after["geometry"]).equals(shape(runtime[feature_id]["geometry"])))
            expected = shape(before["geometry"]).difference(box(2, 0.5, 5, 1.5))
            self.assertLess(shape(after["geometry"]).symmetric_difference(expected).area, 1e-12)
        self.assertEqual(updated["features"][2], original_water["features"][2])
        self.assertEqual(topology["objects"]["scenario_water"]["geometries"][2],
                         original_topology["objects"]["scenario_water"]["geometries"][2])
        self.assertEqual(len(shape(updated["features"][0]["geometry"]).geoms), 2)
        self.assertTrue(all(not part.exterior.is_ccw for part in
                            b.iter_polygon_parts(shape(updated["features"][0]["geometry"]))))
        self.assertEqual(water, original_water)

        second_topology = deepcopy(topology)
        again, no_change = clip_new_atlantropa_land_from_named_water(topology, updated, old_atl, new_atl)
        self.assertIsNone(again)
        self.assertEqual(no_change["changed_water_ids"], [])
        self.assertEqual(topology, second_topology)

    def test_no_added_atl_land_does_not_touch_water(self):
        topology, water = self._water_fixture()
        before = deepcopy(topology)
        same = self._atl(box(1, 0, 2, 1))
        updated, diagnostics = clip_new_atlantropa_land_from_named_water(topology, water, same, same)
        self.assertIsNone(updated)
        self.assertEqual(diagnostics["removed_area_degrees2"], 0)
        self.assertEqual(topology, before)

    def test_unsupported_or_invalid_intersecting_water_fails_without_mutation(self):
        topology, water = self._water_fixture()
        before = deepcopy(topology)
        with self.assertRaisesRegex(ValueError, "Unsupported scenario_water.*congo_lake"):
            clip_new_atlantropa_land_from_named_water(topology, water, [], self._atl(box(10.5, 0.5, 11, 1)))
        self.assertEqual(topology, before)

        topology, water = self._water_fixture(invalid=True)
        before = deepcopy(topology)
        with self.assertRaisesRegex(ValueError, "Invalid intersecting scenario_water.*tno_sea_of_marmara"):
            clip_new_atlantropa_land_from_named_water(topology, water, [], self._atl(box(1, 0.5, 2, 1)))
        self.assertEqual(topology, before)

    def test_island_merge_preserves_all_existing_cores_and_rejects_conflicting_control(self):
        features = [{"properties": {"id": "ATLISL_new", "owner_tag": "GRE"}}]
        lineage = {"ATLISL_new": ["ATLISL_old1", "ATLISL_old2"]}
        cores = {"cores": {"ATLISL_old1": ["GRE"], "ATLISL_old2": ["GRE", "ITA"]}}
        result = reconcile_feature_map(cores, "cores", set(cores["cores"]), features, merged_lineage=lineage)
        self.assertEqual(result["cores"], {"ATLISL_new": ["GRE", "ITA"]})
        control = {"controllers": {"ATLISL_old1": "GRE", "ATLISL_old2": "ITA"}}
        with self.assertRaisesRegex(ValueError, "conflicting controllers"):
            reconcile_feature_map(control, "controllers", set(control["controllers"]), features, merged_lineage=lineage)

    def test_staged_snapshot_hashes_staged_overlay_instead_of_canonical(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory) / "tno_1962"
            stage.mkdir()
            overlay = stage / "scenario_atlantropa.topo.json"
            overlay.write_text('{"type":"Topology","staged":true}', encoding="utf-8")
            inputs = _collect_snapshot_inputs(stage, {
                "scenario_atlantropa_topology_url": "data/scenarios/tno_1962/scenario_atlantropa.topo.json",
            })
            self.assertEqual(inputs["scenario_atlantropa.topo.json"], _sha256_path(overlay))

    def test_ledger_never_infers_donor_province_from_enumerated_island_number(self):
        row = _atlantropa_feature_row({"properties": {"id": "ATLISL_adriatica_CRO_1", "cntr_code": "ATL"}}, None)
        self.assertEqual(row["donor_province_ids"], [])
        self.assertEqual(row["donor_state"], "")
        self.assertEqual(row["donor_provenance"], "unknown")
        row = _atlantropa_feature_row({"properties": {"id": "ATLISL_adriatica_CRO_1",
                                    "donor_province_ids": [18259], "donor_state_ids": [8496]}}, None)
        self.assertEqual(row["donor_province"], "18259")
        self.assertEqual(row["donor_state"], "8496")
        self.assertEqual(row["donor_provenance"], "donor_metadata")
        province = _atlantropa_feature_row({"properties": {"id": "ATLPRV_18259"}}, None)
        self.assertEqual(province["donor_province_ids"], [18259])

    def test_staged_coverage_reads_staged_chunks_using_public_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory) / "tno_1962"
            (stage / "chunks").mkdir(parents=True)
            (stage / "detail_chunks.manifest.json").write_text(json.dumps({"chunks": [{
                "id": "test", "lod": "detail", "layer": "scenario_atlantropa",
                "url": "data/scenarios/tno_1962/chunks/test.json",
            }]}), encoding="utf-8")
            (stage / "chunks/test.json").write_text(json.dumps({"features": [{
                "type": "Feature", "properties": {"id": "ATLPRV_staged_only"},
                "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 1], [0, 0]]]},
            }]}), encoding="utf-8")
            self.assertEqual(set(_load_chunk_feature_index(stage, layer_name="scenario_atlantropa")),
                             {"ATLPRV_staged_only"})

    def test_verified_island_lineage_follows_source_not_enumerated_id(self):
        old = {"owners": {"ATLISL_x_1": "ITA", "ATLISL_x_2": "CRO"}}
        features = [{"properties": {"id": "ATLISL_x_2", "owner_tag": "ITA"}}]
        result = reconcile_feature_map(old, "owners", set(old["owners"]), features, {"ATLISL_x_2": "ATLISL_x_1"})
        self.assertEqual(result["owners"], {"ATLISL_x_2": "ITA"})

    def test_bathymetry_preserves_unrelated_geometry_and_properties(self):
        old = {"type": "Topology", "objects": {"bathymetry_contours": {"type": "GeometryCollection", "geometries": [
            {"type": "LineString", "arcs": [0], "properties": {"id": "manual", "region_id": "other"}},
            {"type": "LineString", "arcs": [1], "properties": {"id": "old", "region_id": "adriatica"}}]}},
            "arcs": [[[1, 2], [3, 4]], [[0, 0], [1, 1]]]}
        new = {"type": "Topology", "objects": {"bathymetry_contours": {"type": "GeometryCollection", "geometries": [
            {"type": "LineString", "arcs": [0], "properties": {"id": "new", "region_id": "adriatica"}}]}},
            "arcs": [[[5, 6], [7, 8]]]}
        result = merge_atlantropa_bathymetry(old, new)
        geometries = result["objects"]["bathymetry_contours"]["geometries"]
        self.assertEqual(geometries[0], old["objects"]["bathymetry_contours"]["geometries"][0])
        self.assertEqual(result["arcs"][0], old["arcs"][0])
        self.assertEqual(geometries[1]["properties"]["id"], "new")

    def test_only_stable_land_inherits_old_manual_assignments(self):
        old = {"owners": {"FR-1": "FRA", "ATLPRV_1": "ITA", "ATLWLD_1": "FRA", "ATLWLD_2": "ITA"}}
        features = [{"properties": {"id": "ATLPRV_1", "owner_tag": "ATL"}},
                    {"properties": {"id": "ATLWLD_1", "owner_tag": "CRO"}}]
        result = reconcile_feature_map(old, "owners", {"ATLPRV_1", "ATLWLD_1", "ATLWLD_2"}, features)
        self.assertEqual(result["owners"], {"FR-1": "FRA", "ATLPRV_1": "ITA", "ATLWLD_1": "CRO"})
        self.assertEqual(old["owners"]["ATLWLD_1"], "FRA")

    def test_core_map_keeps_non_atl_and_stable_manual_cores(self):
        old = {"cores": {"FR-1": ["FRA"], "ATLPRV_1": ["ITA", "FRA"]}}
        features = [{"properties": {"id": "ATLPRV_1", "owner_tag": "ITA"}},
                    {"properties": {"id": "ATLWLD_1", "owner_tag": "CRO"}}]
        result = reconcile_feature_map(old, "cores", {"ATLPRV_1"}, features)
        self.assertEqual(result["cores"], {"FR-1": ["FRA"], "ATLPRV_1": ["ITA", "FRA"], "ATLWLD_1": ["CRO"]})


if __name__ == "__main__":
    unittest.main()
