from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tools import migrate_tno_shared_editing_inputs


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class MigrateTnoSharedEditingInputsTest(unittest.TestCase):
    def test_run_uses_existing_partial_inputs_without_legacy_capital_hints(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            scenario_dir = root / "data" / "scenarios" / "tno_1962"
            _write_json(
                scenario_dir / "scenario_manual_overrides.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "manual-pass",
                    "countries": {
                        "AAA": {
                            "mode": "create",
                            "display_name_en": "Alpha",
                            "display_name_zh": "阿尔法",
                        }
                    },
                    "assignments": {
                        "AAA-1": {
                            "owner": "AAA",
                            "controller": "AAA",
                            "cores": ["AAA"],
                        }
                    },
                },
            )
            _write_json(
                scenario_dir / "city_overrides.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "city-pass",
                    "capitals_by_tag": {"AAA": "CITY::alpha"},
                    "capital_city_hints": {
                        "AAA": {
                            "tag": "AAA",
                            "city_id": "CITY::alpha",
                            "resolution_method": "manual_override",
                            "host_feature_id": "AAA-1",
                        }
                    },
                    "cities": {},
                    "audit": {},
                },
            )
            _write_json(
                scenario_dir / "city_assets.partial.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "partial-pass",
                    "cities": {
                        "CITY::alpha": {
                            "display_name": {"en": "Alpha City", "zh": "阿尔法城"},
                        }
                    },
                    "audit": {
                        "renamed_city_count": 1,
                        "name_conflict_count": 0,
                        "unresolved_city_rename_count": 0,
                        "name_conflicts": [],
                        "unresolved_city_renames": [],
                    },
                },
            )
            _write_json(
                scenario_dir / "capital_defaults.partial.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "capital-partial-pass",
                    "capitals_by_tag": {"AAA": "CITY::alpha"},
                    "capital_city_hints": {
                        "AAA": {
                            "tag": "AAA",
                            "city_id": "CITY::alpha",
                            "host_feature_id": "AAA-1",
                            "resolution_method": "manual_override",
                        }
                    },
                    "audit": {"source": "existing-partial"},
                },
            )
            _write_json(
                scenario_dir / "geo_name_overrides.manual.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "geo-pass",
                    "geo": {"AAA-1": {"en": "Alpha One", "zh": "阿尔法一"}},
                },
            )
            _write_json(
                scenario_dir / "district_groups.manual.json",
                {
                    "version": 1,
                    "scenario_id": "tno_1962",
                    "generated_at": "district-pass",
                    "tags": {
                        "AAA": {
                            "tag": "AAA",
                            "districts": {
                                "north": {
                                    "district_id": "north",
                                    "name_en": "North",
                                    "name_zh": "北区",
                                    "feature_ids": ["AAA-1"],
                                }
                            },
                        }
                    },
                },
            )

            with (
                mock.patch.object(migrate_tno_shared_editing_inputs, "ROOT", root),
                mock.patch.object(migrate_tno_shared_editing_inputs, "SCENARIO_DIR", scenario_dir),
            ):
                result = migrate_tno_shared_editing_inputs.run(delete_legacy_capital_hints=True)

            mutations_payload = json.loads((scenario_dir / "scenario_mutations.json").read_text(encoding="utf-8"))
            city_assets_payload = json.loads((scenario_dir / "city_assets.partial.json").read_text(encoding="utf-8"))
            capital_defaults_payload = json.loads(
                (scenario_dir / "capital_defaults.partial.json").read_text(encoding="utf-8")
            )

            self.assertFalse(result["legacyCapitalHintsExisted"])
            self.assertFalse(result["deletedLegacyCapitalHints"])
            self.assertEqual(mutations_payload["countries"]["AAA"]["display_name_en"], "Alpha")
            self.assertEqual(mutations_payload["capitals"]["AAA"]["city_id"], "CITY::alpha")
            self.assertEqual(mutations_payload["geo_locale"]["AAA-1"]["en"], "Alpha One")
            self.assertIn("AAA", mutations_payload["district_groups"])
            self.assertEqual(city_assets_payload["cities"]["CITY::alpha"]["display_name"]["en"], "Alpha City")
            self.assertEqual(capital_defaults_payload["capitals_by_tag"]["AAA"], "CITY::alpha")
            self.assertEqual(capital_defaults_payload["audit"]["source"], "existing-partial")


if __name__ == "__main__":
    unittest.main()
