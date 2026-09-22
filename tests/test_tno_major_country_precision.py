from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import json
import hashlib

import geopandas as gpd
from shapely.geometry import box

from tools.prepare_tno_major_country_precision import (
    PROFILES, baseline_overlap_inventory, governed_source, cost_report, coverage_gate, freeze_owner_domains, geographic_target_ids, load_source, map_source, prepare,
)
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.pilot_tno_regional_precision import _assemble_candidate
from tests import test_tno_regional_precision as regional_tests


class MajorCountryPrecisionTests(unittest.TestCase):
    def test_explicit_source_requires_governed_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "external.geojson"
            source.write_bytes(b"governed source")
            ledger = [{"local_path": "data/geoBoundaries-IND-ADM2.geojson",
                       "source_id": "gb_ind_adm2",
                       "current_local_sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]
            (root / "source_ledger.json").write_text(json.dumps(ledger))
            self.assertEqual(governed_source(root, "IN", source)["source_id"], "gb_ind_adm2")
            source.write_bytes(b"different source")
            with self.assertRaisesRegex(ValueError, "digest_mismatch"):
                governed_source(root, "IN", source)

    def test_overlap_inventory_preserves_both_targets_and_foreign_contacts(self):
        ids = ["CN_CITY_a", "CN_CITY_b", "CN_CITY_c", "foreign"]
        geometries = [box(0, 0, 2, 1), box(1, 0, 3, 1), box(4, 0, 5, 1), box(4.5, 0, 6, 1)]
        absolute = {"type": "Topology", "arcs": [list(g.exterior.coords) for g in geometries], "objects": {"political": {
            "type": "GeometryCollection", "geometries": [
                {"type": "Polygon", "arcs": [[i]], "properties": {"id": fid}} for i, fid in enumerate(ids)]}}}
        preserved, overlaps = baseline_overlap_inventory(absolute, ids[:3])
        self.assertEqual(preserved, ids[:3])
        self.assertEqual(len(overlaps), 2)
        same_owner = {fid: "ONE" for fid in ids}
        self.assertEqual(baseline_overlap_inventory(absolute, ids[:3], same_owner)[0], [ids[2]])
        same_owner[ids[1]] = "TWO"
        self.assertEqual(baseline_overlap_inventory(absolute, ids[:3], same_owner)[0], ids[:3])
        absolute["arcs"][1] = list(box(2, 0, 3, 1).exterior.coords)
        self.assertEqual(baseline_overlap_inventory(absolute, ids[:2]), ([], []))

    def fixture(self):
        rows = [{"properties": {"id": fid, "cntr_code": country}}
                for fid, country in [("JP_A", "JP"), ("JP_B", "JP"), ("CN_A", "CN")]]
        source = gpd.GeoDataFrame([
            {"id": "JP_B", "cntr_code": "JP", "geometry": box(1, 0, 2, 1)},
            {"id": "JP_A", "cntr_code": "JP", "geometry": box(0, 0, 1, 1)},
        ], crs=4326)
        return rows, source

    def test_exact_id_mapping_is_order_stable_and_excludes_foreign_country(self):
        rows, source = self.fixture()
        result, lineage = map_source(rows, source, "JP")
        self.assertEqual(result.id.tolist(), ["JP_A", "JP_B"])
        self.assertEqual(result.iloc[0].geometry.bounds, (0, 0, 1, 1))
        self.assertEqual(lineage["mapping"], {"JP_A": ["JP_A"], "JP_B": ["JP_B"]})
        source.loc[0, "cntr_code"] = "CN"
        with self.assertRaisesRegex(ValueError, "country_leakage"):
            map_source(rows, source, "JP")

    def test_missing_duplicate_and_split_lineage_fail_closed(self):
        rows, source = self.fixture()
        with self.assertRaisesRegex(ValueError, "unresolved_lineage"):
            map_source(rows, source.iloc[:1], "JP")
        with self.assertRaisesRegex(ValueError, "split_children"):
            map_source(rows, source, "JP", {"JP_A": ["JP_A"], "JP_B": ["JP_A"]})
        with self.assertRaisesRegex(ValueError, "exact_target_ids"):
            map_source(rows, source, "JP", {"JP_A": ["JP_A"], "CN_A": ["JP_B"]})

    def test_geographic_ids_do_not_follow_mutable_scenario_allegiance(self):
        rows = [{"properties": {"id": "CN_CITY_a", "cntr_code": "CHI"}},
                {"properties": {"id": "CN_CITY_b", "cntr_code": "MAN"}},
                {"properties": {"id": "other", "cntr_code": "CN"}}]
        self.assertEqual(geographic_target_ids(rows, "CN"), ["CN_CITY_a", "CN_CITY_b"])
        source = gpd.GeoDataFrame([
            {"id": "CN_CITY_a", "cntr_code": "CN", "geometry": box(0, 0, 1, 1)},
            {"id": "CN_CITY_b", "cntr_code": "CN", "geometry": box(1, 0, 2, 1)},
        ], crs=4326)
        result, _ = map_source(rows, source, "CN")
        self.assertEqual(result.id.tolist(), ["CN_CITY_a", "CN_CITY_b"])
        self.assertEqual(geographic_target_ids([
            {"properties": {"id": "IN_ADM2_a", "cntr_code": "PAK"}},
            {"properties": {"id": "US_ZN_a", "cntr_code": "JAP"}},
        ], "IN"), ["IN_ADM2_a"])
        self.assertEqual(geographic_target_ids([
            {"properties": {"id": "US_ZN_a", "cntr_code": "JAP"}},
        ], "US"), ["US_ZN_a"])

    def test_coverage_gate_detects_gap_even_when_coverage_is_valid(self):
        old = [box(0, 0, 1, 1), box(1, 0, 2, 1)]
        with self.assertRaisesRegex(ValueError, "surface_changed"):
            coverage_gate(old, [box(0, 0, .9, 1), box(1, 0, 2, 1)])
        with self.assertRaisesRegex(ValueError, "coverage_invalid"):
            coverage_gate(old, [box(0, 0, 1.1, 1), box(1, 0, 2, 1)])
        self.assertEqual(coverage_gate(old, old)["surface_delta_degrees_squared"], 0)

    def test_cost_budget_and_owner_mapping_are_enforced(self):
        _, source = self.fixture()
        owners = {"JP_A": "JAP", "JP_B": "JAP"}
        report = cost_report(source, owners, PROFILES["JP"])
        self.assertTrue(report["budget_pass"])
        self.assertEqual(len(report["estimated_chunks"]), 1)
        self.assertFalse(cost_report(source, owners, {**PROFILES["JP"], "max_coordinates": 1})["budget_pass"])
        with self.assertRaisesRegex(ValueError, "owner_mapping_missing"):
            cost_report(source, {}, PROFILES["JP"])

    def test_missing_source_never_falls_back_or_downloads(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "missing_source"):
                load_source(Path(directory), "IN")

    def test_output_guard_rejects_production_and_existing_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for output in (root, root / "data" / "candidate"):
                with self.assertRaisesRegex(ValueError, "output_root"):
                    prepare(root / "scenario", root / "data", output, ["JP"])
        forbidden = Path(__file__).resolve().parents[1] / "js" / "new-review-output"
        with self.assertRaisesRegex(ValueError, "inside_repository_runtime"):
            prepare(Path("missing-scenario"), Path("missing-data"), forbidden, ["JP"])

    def test_assembler_retains_scenario_semantics(self):
        baseline, replacements = regional_tests.TnoRegionalPrecisionTests().fixture()
        for row in baseline["objects"]["political"]["geometries"]:
            row["properties"].update(controller="CTRL", cores=["CORE"], manual_override=True,
                                     parent_feature_id="historical-parent")
        original = deepcopy(baseline)
        candidate, _ = _assemble_candidate(baseline, replacements, ["DE", "BE", "NL"])
        self.assertEqual(baseline, original)
        self.assertEqual([r["properties"] for r in candidate["objects"]["political"]["geometries"]],
                         [r["properties"] for r in original["objects"]["political"]["geometries"]])

    def test_assembler_explicit_ids_preserve_reassigned_metadata(self):
        baseline, replacements = regional_tests.TnoRegionalPrecisionTests().fixture()
        target_ids = replacements.id.astype(str).tolist()
        for row in baseline["objects"]["political"]["geometries"]:
            if row["properties"]["id"] == target_ids[0]:
                row["properties"]["cntr_code"] = "XX"
        codes = {row["properties"]["id"]: row["properties"]["cntr_code"]
                 for row in baseline["objects"]["political"]["geometries"]}
        replacements = replacements.copy()
        replacements["cntr_code"] = [codes[fid] for fid in replacements.id]
        candidate, _ = _assemble_candidate(
            baseline, replacements, ["DE", "BE", "NL"], target_feature_ids=target_ids,
        )
        props = {row["properties"]["id"]: row["properties"]
                 for row in candidate["objects"]["political"]["geometries"]}
        self.assertEqual(props[target_ids[0]]["cntr_code"], "XX")

    def test_frozen_owner_domains_do_not_move_foreign_allocation(self):
        baseline, replacement = regional_tests.TnoRegionalPrecisionTests().fixture()
        absolute = _absolute_topology(baseline)
        owners = {"DE_A": "ONE", "BE_A": "TWO", "NL_A": "TWO"}
        frozen, diagnostics = freeze_owner_domains(absolute, replacement, owners, .002)
        by_id = dict(zip(frozen.id, frozen.geometry))
        old = {r["properties"]["id"]: _decode_geometry(absolute, r)
               for r in absolute["objects"]["political"]["geometries"]}
        self.assertTrue(by_id["DE_A"].equals(old["DE_A"]))
        self.assertTrue(by_id["BE_A"].union(by_id["NL_A"]).equals(old["BE_A"].union(old["NL_A"])))
        self.assertTrue(all(d["owner_domain_preserved"] for d in diagnostics.values()))

    def test_partial_mode_preserves_failed_domain_and_rejects_nearest_resolution(self):
        from unittest.mock import patch
        baseline, replacement = regional_tests.TnoRegionalPrecisionTests().fixture()
        absolute = _absolute_topology(baseline)
        owners = {"DE_A": "ONE", "BE_A": "TWO", "NL_A": "TWO"}
        from tools.prepare_tno_major_country_precision import constrained_partition
        def partition(old, sources, parents):
            result, diagnostic = constrained_partition(old, sources, parents)
            if "DE_A" in old:
                diagnostic["baseline_overlap_resolutions"] = [{"rule": "nearest"}]
            return result, diagnostic
        with patch("tools.prepare_tno_major_country_precision.constrained_partition", side_effect=partition):
            with self.assertRaisesRegex(ValueError, "nearest_source"):
                freeze_owner_domains(absolute, replacement, owners, .002)
            frozen, diagnostics = freeze_owner_domains(absolute, replacement, owners, .002, preserve_failed_domains=True)
        self.assertEqual(set(frozen.id), {"BE_A", "NL_A"})
        self.assertEqual(diagnostics["ONE"]["preserved_ids"], ["DE_A"])
        self.assertIn("nearest_source", diagnostics["ONE"]["reason"])

    def test_failed_partition_can_upgrade_clean_remainder_without_nearest_fill(self):
        from unittest.mock import patch
        from tools.prepare_tno_major_country_precision import constrained_partition
        baseline, replacement = regional_tests.TnoRegionalPrecisionTests().fixture()
        absolute = _absolute_topology(baseline)
        owners = {"DE_A": "ONE", "BE_A": "TWO", "NL_A": "TWO"}
        def partition(old, sources, parents):
            if len(old) == 2:
                raise ValueError("ambiguous inherited overlap")
            return constrained_partition(old, sources, parents)
        with patch("tools.prepare_tno_major_country_precision.constrained_partition", side_effect=partition), patch(
            "tools.prepare_tno_major_country_precision.baseline_overlap_inventory", return_value=(["BE_A"], [])):
            frozen, diagnostics = freeze_owner_domains(absolute, replacement, owners, .002, preserve_failed_domains=True)
        self.assertEqual(set(frozen.id), {"DE_A", "NL_A"})
        self.assertEqual(diagnostics["TWO"]["preserved_ids"], ["BE_A"])
        self.assertTrue(diagnostics["TWO"]["upgraded"])


if __name__ == "__main__":
    unittest.main()
