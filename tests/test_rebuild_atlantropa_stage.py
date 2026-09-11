import unittest
import json
import tempfile
from pathlib import Path

from tools.rebuild_atlantropa_stage import reconcile_feature_map, merge_atlantropa_bathymetry
from tools.check_scenario_contracts import _load_chunk_feature_index, _atlantropa_feature_row, _collect_snapshot_inputs, _sha256_path


class AtlantropaStageTests(unittest.TestCase):
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
