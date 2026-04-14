from __future__ import annotations

import json
import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
GLOBAL_ROAD_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_road' / 'source_recipe.manual.json'
GLOBAL_RAIL_RECIPE = REPO_ROOT / 'data' / 'transport_layers' / 'global_rail' / 'source_recipe.manual.json'
ROAD_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_roads.py'
RAIL_BUILDER = REPO_ROOT / 'tools' / 'build_global_transport_rail.py'
COMMON_HELPER = REPO_ROOT / 'map_builder' / 'overture_transport_common.py'


class GlobalTransportBuilderContractsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pyarrow_available = importlib.util.find_spec("pyarrow") is not None

    def test_new_global_transport_files_exist(self) -> None:
        for path in (GLOBAL_ROAD_RECIPE, GLOBAL_RAIL_RECIPE, ROAD_BUILDER, RAIL_BUILDER, COMMON_HELPER):
            self.assertTrue(path.exists(), path.as_posix())

    def test_global_road_recipe_uses_overture_single_source_policy(self) -> None:
        payload = json.loads(GLOBAL_ROAD_RECIPE.read_text(encoding='utf-8'))
        self.assertEqual(payload.get('source_policy'), 'overture_only_checked_in_v1')
        self.assertEqual(payload.get('family'), 'road')
        self.assertEqual(payload.get('primary_source', {}).get('provider'), 'Overture Maps Foundation')
        self.assertEqual(payload.get('primary_source', {}).get('subtype'), 'road')

    def test_global_rail_recipe_uses_overture_single_source_policy(self) -> None:
        payload = json.loads(GLOBAL_RAIL_RECIPE.read_text(encoding='utf-8'))
        self.assertEqual(payload.get('source_policy'), 'overture_only_checked_in_v1')
        self.assertEqual(payload.get('family'), 'rail')
        self.assertEqual(payload.get('primary_source', {}).get('provider'), 'Overture Maps Foundation')
        self.assertEqual(payload.get('primary_source', {}).get('subtype'), 'rail')

    def test_builders_emit_checked_in_manifest_contract(self) -> None:
        for builder in (ROAD_BUILDER, RAIL_BUILDER):
            content = builder.read_text(encoding='utf-8')
            self.assertIn('finalize_transport_manifest', content)
            self.assertIn('distribution_tier', content)
            self.assertIn('feature_counts', content)
            self.assertIn('build_audit', content)

    def test_road_label_builder_handles_empty_input(self) -> None:
        if not self.pyarrow_available:
            self.skipTest("pyarrow is required to import transport builder helpers in this environment.")
        from tools.build_global_transport_roads import build_label_candidates, empty_roads_frame

        labels = build_label_candidates(empty_roads_frame())
        self.assertEqual(len(labels), 0)
        self.assertIn('geometry', labels.columns)


if __name__ == '__main__':
    unittest.main()
