from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tools.apply_political_feature_merges as apply_tool
import tools.build_political_feature_merge_plan as plan_tool

VANILLA = "releasables/hoi4_vanilla.internal.phase1.catalog.json"
TNO = "releasables/tno_1962.internal.phase1.catalog.json"


def merges(scenarios: list[str]) -> apply_tool.Merges:
    return apply_tool.Merges({"scenarios": scenarios, "groups": [{"id": "DE_MRG_1", "member_ids": ["DE1", "DE2"]}]})


class SharedFileScopeTest(unittest.TestCase):
    """A scoped plan projects a shared file only when it covers every reader."""

    def projected(self, scenarios: list[str]) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            for name in (VANILLA, TNO):
                (data / name).parent.mkdir(parents=True, exist_ok=True)
                (data / name).write_text(json.dumps({"entries": [{"feature_ids": ["DE1", "DE2"]}]}), encoding="utf-8")
            with patch.object(apply_tool, "DATA", data), patch.object(apply_tool, "GLOBAL_PROJECTED", (VANILLA, TNO)):
                return [path.relative_to(data).as_posix() for path in apply_tool.global_projected_paths(merges(scenarios))]

    def test_tno_scope_leaves_the_vanilla_catalog_to_its_own_readers(self):
        self.assertEqual(self.projected(["tno_1962"]), [TNO])

    def test_all_vanilla_readers_project_the_vanilla_catalog(self):
        self.assertEqual(self.projected(["blank_base", "hoi4_1936", "hoi4_1939", "modern_world"]), [VANILLA])

    def test_a_partial_reader_scope_is_refused(self):
        with self.assertRaisesRegex(ValueError, "read by scenarios outside"):
            self.projected(["hoi4_1936", "hoi4_1939"])


class RiverPackScopeTest(unittest.TestCase):
    """River-paint packs protect their parcels only for plans that rewrite the pack's scenario."""

    def protected(self, scenarios):
        with tempfile.TemporaryDirectory() as directory:
            packs = Path(directory)
            (packs / "modern_world_pilot.json").write_text(json.dumps(
                {"sceneId": "modern_world", "parents": [{"parentId": "DE1"}], "support": [{"parentId": "DE2"}]}), encoding="utf-8")
            (packs / "modern_world_pilot.transport.json").write_text("{}", encoding="utf-8")
            with patch.object(plan_tool, "RIVER_PARTITIONS", packs):
                return plan_tool.river_paint_feature_ids(scenarios)

    def test_global_and_modern_scopes_protect_pack_parcels(self):
        self.assertEqual(self.protected(None), {"DE1", "DE2"})
        self.assertEqual(self.protected(("blank_base", "hoi4_1936", "hoi4_1939", "modern_world")), {"DE1", "DE2"})

    def test_other_scopes_do_not(self):
        self.assertEqual(self.protected(("tno_1962",)), set())


class MemberPropertiesTest(unittest.TestCase):
    """Members that disagree on a non-name topology property get different signatures."""

    def signatures(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            scenario = data / "scenarios/tno_1962"
            scenario.mkdir(parents=True)
            for kind in ("owners", "cores"):
                (scenario / f"{kind}.by_feature.json").write_text(json.dumps({kind: {}}), encoding="utf-8")
            topology = scenario / "runtime_topology.topo.json"
            topology.write_text(json.dumps({"objects": {"political": {"geometries": [
                {"properties": {"id": "RU1", "name": "A", "cntr_code": "RU"}},
                {"properties": {"id": "RU2", "name": "B", "cntr_code": "RU"}},
                {"properties": {"id": "RU3", "name": "C", "cntr_code": "SVR"}},
            ]}}}), encoding="utf-8")
            with patch.object(plan_tool, "DATA", data), patch.object(plan_tool, "china_prefectures", lambda: {}),                     patch.object(plan_tool, "rewritten_topologies", lambda scenarios: (topology,)):
                tables = plan_tool.load_assignment_tables(("tno_1962",))
            return {fid: plan_tool.assignment_signature(fid, tables, {}) for fid in ("RU1", "RU2", "RU3")}

    def test_differing_country_codes_do_not_share_a_signature(self):
        signatures = self.signatures()
        self.assertEqual(signatures["RU1"], signatures["RU2"])
        self.assertNotEqual(signatures["RU1"], signatures["RU3"])


if __name__ == "__main__":
    unittest.main()
