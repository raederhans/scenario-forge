from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest

from scenario_builder.hoi4.crosswalk import build_iso2_to_mapped_tag
from tools.import_country_palette import PaletteEntry, resolve_mapping_state


def _entry(tag: str, *, localized_name: str) -> PaletteEntry:
    return PaletteEntry(
        tag=tag,
        localized_name=localized_name,
        name_source="manual",
        country_file_label=localized_name,
        country_file="countries/test.txt",
        country_file_is_shared_template=False,
        map_hex="#123456",
        map_source="test",
        ui_hex="#123456",
        ui_source="test",
        country_file_hex="",
        country_file_source="",
        dynamic=False,
    )


class ImportCountryPaletteTest(unittest.TestCase):
    def test_resolve_mapping_state_marks_non_default_runtime_tags(self) -> None:
        entries = {
            "MAN": _entry("MAN", localized_name="Manchuria"),
            "CHI": _entry("CHI", localized_name="China"),
        }
        manual = {
            "verified_exact_tag_to_iso2": {
                "MAN": "CN",
                "CHI": "CN",
            },
            "non_default_runtime_tags": ["MAN"],
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            manual_path = Path(tmp_dir) / "tno.manual.json"
            manual_path.write_text("{}", encoding="utf-8")
            mapped, unmapped, audit_entries = resolve_mapping_state(
                entries,
                manual,
                manual_path,
                runtime_country_codes={"CN"},
                primary_name_to_iso2={"manchuria": "CN", "china": "CN"},
            )

        self.assertEqual(unmapped, {})
        self.assertEqual(mapped["MAN"]["iso2"], "CN")
        self.assertFalse(mapped["MAN"]["expose_as_runtime_default"])
        self.assertNotIn("expose_as_runtime_default", mapped["CHI"])
        self.assertEqual(audit_entries["MAN"]["status"], "mapped")

    def test_resolve_mapping_state_rejects_non_default_runtime_tags_without_verified_mapping(self) -> None:
        entries = {
            "MAN": _entry("MAN", localized_name="Manchuria"),
        }
        manual = {
            "non_default_runtime_tags": ["MAN"],
        }

        with tempfile.TemporaryDirectory() as tmp_dir:
            manual_path = Path(tmp_dir) / "tno.manual.json"
            manual_path.write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(SystemExit, "non_default_runtime_tags entries require verified mappings"):
                resolve_mapping_state(
                    entries,
                    manual,
                    manual_path,
                    runtime_country_codes={"CN"},
                    primary_name_to_iso2={"manchuria": "CN"},
                )

    def test_build_iso2_to_mapped_tag_skips_non_default_runtime_entries(self) -> None:
        palette_map = {
            "mapped": {
                "MAN": {
                    "iso2": "CN",
                    "match_kind": "manual_exact",
                    "decision_source": "manual_verified",
                    "expose_as_runtime_default": False,
                },
                "CHI": {
                    "iso2": "CN",
                    "match_kind": "manual_exact",
                    "decision_source": "manual_verified",
                },
                "VIN": {
                    "iso2": "VN",
                    "match_kind": "manual_exact",
                    "decision_source": "manual_verified",
                    "expose_as_runtime_default": False,
                },
            }
        }

        self.assertEqual(
            build_iso2_to_mapped_tag(palette_map),
            {
                "CN": "CHI",
            },
        )

    def test_tno_manual_second_wave_tags_are_verified_and_non_default(self) -> None:
        payload = json.loads(Path("data/palette-maps/tno.manual.json").read_text(encoding="utf-8"))
        verified = payload.get("verified_exact_tag_to_iso2") or {}
        non_default = set(payload.get("non_default_runtime_tags") or [])
        expected = {
            "KOR": "KR",
            "GNG": "CN",
            "MAG": "RU",
            "ONG": "RU",
            "GAY": "RU",
            "SVR": "RU",
            "SAM": "RU",
            "VYT": "RU",
            "NOV": "RU",
            "GOR": "RU",
            "TYM": "RU",
            "WRS": "RU",
            "CHT": "RU",
            "VOL": "RU",
            "BRY": "RU",
            "BKR": "RU",
            "SBA": "RU",
            "ZLT": "RU",
            "TAN": "RU",
            "KOM": "RU",
            "IRK": "RU",
            "KRS": "RU",
            "TOM": "RU",
            "YAK": "RU",
            "OMS": "RU",
            "ALT": "RU",
            "PRM": "RU",
            "ORE": "RU",
            "URL": "RU",
            "VOR": "RU",
        }

        for tag, iso2 in expected.items():
            self.assertEqual(verified.get(tag), iso2)
            self.assertIn(tag, non_default)

    def test_tno_manual_final_wave_tags_are_verified_and_non_default(self) -> None:
        payload = json.loads(Path("data/palette-maps/tno.manual.json").read_text(encoding="utf-8"))
        verified = payload.get("verified_exact_tag_to_iso2") or {}
        non_default = set(payload.get("non_default_runtime_tags") or [])
        expected = {
            "PRC": "CN",
            "SIC": "CN",
        }

        for tag, iso2 in expected.items():
            self.assertEqual(verified.get(tag), iso2)
            self.assertIn(tag, non_default)

        for tag in ["SIK", "TIB", "XIK"]:
            self.assertNotIn(tag, verified)
            self.assertNotIn(tag, non_default)

    def test_tno_generated_map_and_audit_final_wave_tags_match_topic_status(self) -> None:
        payload_map = json.loads(Path("data/palette-maps/tno.map.json").read_text(encoding="utf-8"))
        payload_audit = json.loads(Path("data/palette-maps/tno.audit.json").read_text(encoding="utf-8"))["entries"]

        expected_mapped = {
            "PRC": "CN",
            "SIC": "CN",
        }
        expected_unmapped = {
            "SIK": "unsupported_runtime_country",
            "TIB": "unsupported_runtime_country",
            "XIK": "unreviewed",
        }

        for tag, iso2 in expected_mapped.items():
            self.assertIn(tag, payload_map["mapped"])
            self.assertNotIn(tag, payload_map["unmapped"])
            self.assertEqual(payload_map["mapped"][tag]["iso2"], iso2)
            self.assertFalse(payload_map["mapped"][tag]["expose_as_runtime_default"])
            self.assertEqual(payload_audit[tag]["status"], "mapped")
            self.assertEqual(payload_audit[tag]["mapped_iso2"], iso2)

        for tag, reason in expected_unmapped.items():
            self.assertNotIn(tag, payload_map["mapped"])
            self.assertIn(tag, payload_map["unmapped"])
            self.assertEqual(payload_map["unmapped"][tag]["reason"], reason)
            self.assertEqual(payload_audit[tag]["status"], "unmapped")
            self.assertEqual(payload_audit[tag]["reason"], reason)


if __name__ == "__main__":
    unittest.main()
