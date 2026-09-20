from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from shapely.geometry import box, mapping
from topojson import Topology

from tools.regional_scenario_assets import build_regional_scenario_assets
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets


def _runtime(features):
    return Topology({"type": "FeatureCollection", "features": features}, object_name="political", prequantize=False).to_dict()


def _f(fid, x, kind="regular", interactive=True):
    props = {"id": fid, "cntr_code": "RU"}
    if kind != "regular":
        props["scenario_helper_kind"] = kind
    if not interactive:
        props["interactive"] = False
    return {"type": "Feature", "properties": props, "geometry": mapping(box(x, 0, x + 1, 1))}


class RegionalScenarioAssetMembershipTest(unittest.TestCase):
    def _fixture(self, root: Path, old_features, new_features, old_owners_dict, new_owners_dict=None):
        baseline = root / "baseline"
        baseline.mkdir(parents=True)
        (baseline / "chunks").mkdir(parents=True)
        runtime_rel = Path("runtime_topology.topo.json")

        old_runtime = _runtime(old_features)
        new_runtime = _runtime(new_features)

        (baseline / runtime_rel).write_text(json.dumps(old_runtime), encoding="utf-8")
        candidate = root / "candidate.json"
        candidate.write_text(json.dumps(new_runtime), encoding="utf-8")

        (baseline / "manifest.json").write_text(json.dumps({"scenario_id": "demo", "runtime_topology_url": "data/scenarios/demo/runtime_topology.topo.json"}), encoding="utf-8")

        (baseline / "owners.by_feature.json").write_text(json.dumps({"owners": old_owners_dict}), encoding="utf-8")
        (baseline / "countries.json").write_text(json.dumps({
            'countries': {tag: {'display_name': tag} for tag in ('RU', 'NEW_OWNER')}
        }), encoding='utf-8')

        (baseline / "detail_chunks.manifest.json").write_text(json.dumps({"chunks": []}), encoding="utf-8")

        candidate_owners_path = None
        if new_owners_dict is not None:
            candidate_owners_path = root / "new_owners.json"
            candidate_owners_path.write_text(json.dumps({"owners": new_owners_dict}), encoding="utf-8")

        return baseline, candidate, candidate_owners_path

    def test_default_behavior_preserves_same_id_guard(self):
        with tempfile.TemporaryDirectory() as d:
            f1 = _f("RU_A", 0)
            baseline, candidate, _ = self._fixture(Path(d), [f1], [f1, _f("RU_B", 1)], {"RU_A": "OLD"})
            with self.assertRaisesRegex(ValueError, "candidate political IDs differ"):
                build_regional_scenario_assets(baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out")

    def test_successful_addition_and_removal(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_removed = _f("RU_ARCTIC_FB_1", 1, kind="shell_fallback", interactive=False)
            f_new = _f("RU_A", 0)
            f_added = _f("RU_RAY_1", 2)

            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old, f_removed],
                [f_new, f_added],
                {"RU_A": "RU", "RU_ARCTIC_FB_1": "RU"},
                {"RU_A": "RU", "RU_RAY_1": "NEW_OWNER"}
            )

            report = build_regional_scenario_assets(
                baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                candidate_owners_path=candidate_owners_path,
                added_feature_ids=("RU_RAY_1",),
                removed_helper_ids=("RU_ARCTIC_FB_1",)
            )
            self.assertEqual(report["added_ids"], ["RU_RAY_1"])
            self.assertEqual(report["removed_ids"], ["RU_ARCTIC_FB_1"])

    def test_removal_refusal_if_interactive(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_removed = _f("RU_ARCTIC_FB_1", 1, kind="shell_fallback", interactive=True)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old, f_removed],
                [f_old],
                {"RU_A": "RU", "RU_ARCTIC_FB_1": "RU"},
                {"RU_A": "RU"}
            )
            with self.assertRaisesRegex(ValueError, "Removal RU_ARCTIC_FB_1 is not interactive=False"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    removed_helper_ids=("RU_ARCTIC_FB_1",)
                )

    def test_removal_refusal_if_not_shell_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_removed = _f("RU_ARCTIC_FB_1", 1, kind="other", interactive=False)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old, f_removed],
                [f_old],
                {"RU_A": "RU", "RU_ARCTIC_FB_1": "RU"},
                {"RU_A": "RU"}
            )
            with self.assertRaisesRegex(ValueError, "Removal RU_ARCTIC_FB_1 is not shell_fallback"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    removed_helper_ids=("RU_ARCTIC_FB_1",)
                )

    def test_malformed_addition_wrong_id_prefix(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_added = _f("RU_WRONG_1", 2)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old],
                [f_old, f_added],
                {"RU_A": "RU"},
                {"RU_A": "RU", "RU_WRONG_1": "RU"}
            )
            with self.assertRaisesRegex(ValueError, "Addition RU_WRONG_1 is not a valid RU_RAY_\\* id"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    added_feature_ids=("RU_WRONG_1",)
                )

    def test_malformed_addition_not_interactive(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_added = _f("RU_RAY_1", 2, interactive=False)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old],
                [f_old, f_added],
                {"RU_A": "RU"},
                {"RU_A": "RU", "RU_RAY_1": "RU"}
            )
            with self.assertRaisesRegex(ValueError, "Addition RU_RAY_1 has interactive=False"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    added_feature_ids=("RU_RAY_1",)
                )

    def test_addition_requires_non_sov_owner(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_added = _f("RU_RAY_1", 2)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old],
                [f_old, f_added],
                {"RU_A": "RU"},
                {"RU_A": "RU", "RU_RAY_1": "SOV"}
            )
            with self.assertRaisesRegex(ValueError, "Addition RU_RAY_1 must have registered country non-SOV owner"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    added_feature_ids=("RU_RAY_1",)
                )

    def test_duplicates_in_parameters(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old],
                [f_old],
                {"RU_A": "RU"},
                {"RU_A": "RU"}
            )
            with self.assertRaisesRegex(ValueError, "Duplicate added_feature_ids declared"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    added_feature_ids=("RU_RAY_1", "RU_RAY_1")
                )

    def test_unknown_owner_is_not_a_registered_country(self):
        with tempfile.TemporaryDirectory() as d:
            f = _f('RU_A', 0)
            baseline, candidate, owners = self._fixture(
                Path(d), [f], [f, _f('RU_RAY_1', 2)], {'RU_A': 'RU'},
                {'RU_A': 'RU', 'RU_RAY_1': 'UNREGISTERED'})
            with self.assertRaisesRegex(ValueError, 'registered country'):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate,
                    candidate_owners_path=owners, added_feature_ids=('RU_RAY_1',),
                    output_dir=Path(d) / 'out')

    def test_mismatched_runtime_declarations(self):
        with tempfile.TemporaryDirectory() as d:
            f_old = _f("RU_A", 0)
            f_added = _f("RU_RAY_1", 2)
            baseline, candidate, candidate_owners_path = self._fixture(
                Path(d),
                [f_old],
                [f_old, f_added],
                {"RU_A": "RU"},
                {"RU_A": "RU", "RU_RAY_1": "NEW"}
            )
            # Add something that is not actually in the new topology
            with self.assertRaisesRegex(ValueError, "Runtime new minus old does not equal explicitly declared additions"):
                build_regional_scenario_assets(
                    baseline_dir=baseline, candidate_runtime_path=candidate, output_dir=Path(d) / "out",
                    candidate_owners_path=candidate_owners_path,
                    added_feature_ids=("RU_RAY_1", "RU_RAY_2")
                )

if __name__ == "__main__":
    unittest.main()
