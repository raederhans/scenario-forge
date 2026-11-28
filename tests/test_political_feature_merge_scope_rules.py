from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tools.apply_political_feature_merges as apply_tool


VANILLA = "releasables/hoi4_vanilla.internal.phase1.catalog.json"
TNO = "releasables/tno_1962.internal.phase1.catalog.json"
POLICIES = "country_feature_policies.json"


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


class FrontendProjectedListTest(unittest.TestCase):
    """Presets and releasable preset sources keep the members of a scoped plan for the frontend."""

    def projected(self, files: dict[str, dict], scenarios: list[str]) -> list[str]:
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            for name, payload in files.items():
                (data / name).parent.mkdir(parents=True, exist_ok=True)
                (data / name).write_text(json.dumps(payload), encoding="utf-8")
            with patch.object(apply_tool, "DATA", data), patch.object(apply_tool, "GLOBAL_PROJECTED", tuple(files)):
                return [path.relative_to(data).as_posix() for path in apply_tool.global_projected_paths(merges(scenarios))]

    def test_whole_preset_and_releasable_lists_keep_their_members(self):
        files = {
            POLICIES: {"display": {"presets": {"DE": [{"name": "Bavaria", "ids": ["DE1", "DE2", "DE3"]}]}}},
            VANILLA: {"entries": [{"preset_source": {"feature_ids": ["DE1", "DE2"]},
                                   "boundary_variants": [{"preset_source": {"exclude_feature_ids": ["DE1", "DE2"]}}]}]},
        }
        self.assertEqual(self.projected(files, ["tno_1962"]), [])
        self.assertEqual(self.projected(files, ["hoi4_1936", "hoi4_1939"]), [])

    def test_a_list_naming_part_of_a_group_is_refused(self):
        partial = {POLICIES: {"display": {"presets": {"DE": [{"name": "Bavaria", "ids": ["DE1", "DE3"]}]}}}}
        with self.assertRaisesRegex(ValueError, "only part of a merged feature.*DE_MRG_1"):
            self.projected(partial, ["tno_1962"])
        variant = {VANILLA: {"entries": [{"boundary_variants": [{"preset_source": {"feature_ids": ["DE2"]}}]}]}}
        with self.assertRaisesRegex(ValueError, "only part of a merged feature.*DE_MRG_1"):
            self.projected(variant, ["modern_world"])


if __name__ == "__main__":
    unittest.main()
