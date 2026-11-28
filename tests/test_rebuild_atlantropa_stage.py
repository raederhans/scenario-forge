import unittest
import json
import tempfile
from copy import deepcopy
from pathlib import Path

from shapely.geometry import box, mapping, shape

from tools import patch_tno_1962_bundle as b
from tools.rebuild_atlantropa_stage import (
    preserve_identical_atl_helper_assignments,
    preserve_political_chunks_for_unchanged_source,
    reconcile_feature_map,
    restore_published_land_welds,
)


class AtlantropaStageTests(unittest.TestCase):
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

    def test_published_weld_footprint_is_carved_from_larger_same_source_shoal(self):
        old = {"type": "Feature", "properties": {
            "id": "ATLWLD_aegean_90", "name": "Published Weld 90", "owner_tag": "GRE",
            "region_id": "aegean", "atl_geometry_role": "shore_seal", "atl_join_mode": "boolean_weld",
            "atl_render_layer": "land", "source_standard": "hgo_donor_province_georef",
            "donor_state_ids": [8519], "donor_state_names": ["Poros"], "donor_province_ids": [18182],
        }, "geometry": mapping(box(0, 0, 1, 1))}
        generated = deepcopy(old)
        generated["properties"].update(id="ATLSHL_aegean_32", atl_join_mode="gap_fill", atl_render_layer="shoal")
        generated["geometry"] = mapping(box(0, 0, 2, 1))
        full_shoal = deepcopy(generated)
        new_land = [generated]
        self.assertEqual(restore_published_land_welds([old], new_land), ["ATLWLD_aegean_90"])
        self.assertEqual([feature["properties"]["id"] for feature in new_land],
                         ["ATLSHL_aegean_32", "ATLWLD_aegean_90"])
        self.assertEqual(shape(new_land[1]["geometry"]), shape(old["geometry"]))
        self.assertEqual(shape(new_land[0]["geometry"]).intersection(shape(old["geometry"])).area, 0)
        self.assertAlmostEqual(shape(new_land[0]["geometry"]).area, 1)
        self.assertEqual(preserve_identical_atl_helper_assignments([old], new_land), {"ATLWLD_aegean_90"})

        for change in [{"owner_tag": "TUR"}, {"source_standard": "other"},
                       {"donor_province_ids": [100]}, {"donor_state_ids": []}]:
            candidate = deepcopy(full_shoal)
            candidate["properties"].update(change)
            self.assertEqual(restore_published_land_welds([old], [candidate]), [])
        partial = deepcopy(full_shoal)
        partial["geometry"] = mapping(box(0.5, 0, 2, 1))
        self.assertEqual(restore_published_land_welds([old], [partial]), [])

        duplicate = deepcopy(full_shoal)
        duplicate["properties"]["id"] = "ATLSHL_aegean_33"
        with self.assertRaisesRegex(ValueError, "Ambiguous Atlantropa land weld restoration"):
            restore_published_land_welds([old], [deepcopy(full_shoal), duplicate])
        occupying = deepcopy(old)
        occupying["properties"]["id"] = "ATLPRV_999"
        with self.assertRaisesRegex(ValueError, "occupied by new land"):
            restore_published_land_welds([old], [deepcopy(full_shoal), occupying])


if __name__ == "__main__":
    unittest.main()
