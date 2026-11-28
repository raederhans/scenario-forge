from __future__ import annotations

import tempfile
from pathlib import Path
import unittest

from tools.import_country_palette import (
    PaletteEntry,
    build_palette_entries,
    parse_country_tags,
    resolve_mapping_state,
)


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
    def test_parse_country_tags_reads_all_mod_country_tag_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            country_tags = root / "common" / "country_tags"
            country_tags.mkdir(parents=True)
            (country_tags / "HGO_countries.txt").write_text('ABK = "countries/Abkhazia.txt"\n', encoding="utf-8")
            (country_tags / "HGO2_countries.txt").write_text('ALG = "countries/Algeria.txt"\n', encoding="utf-8")
            (country_tags / "my_dynamic_topic_countries.txt").write_text(
                'AIC = "countries/Ainu.txt"\n',
                encoding="utf-8",
            )
            (country_tags / "zz_dynamic_countries.txt").write_text(
                'DYN = "countries/Dynamic.txt"\n',
                encoding="utf-8",
            )

            tags = parse_country_tags(root)

        self.assertEqual(tags["ABK"], ("countries/Abkhazia.txt", False))
        self.assertEqual(tags["ALG"], ("countries/Algeria.txt", False))
        self.assertEqual(tags["AIC"], ("countries/Ainu.txt", False))
        self.assertEqual(tags["DYN"], ("countries/Dynamic.txt", True))

    def test_build_palette_entries_falls_back_ui_hex_to_map_hex(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            country_dir = root / "common" / "countries"
            country_dir.mkdir(parents=True)
            (country_dir / "Abkhazia.txt").write_text("color = { 100 100 150 }\n", encoding="utf-8")

            entries = build_palette_entries(
                root,
                {"ABK": ("countries/Abkhazia.txt", False)},
                {},
                {"ABK": "Abkhazia"},
                {},
                {},
            )

        self.assertEqual(entries["ABK"].map_hex, "#646496")
        self.assertEqual(entries["ABK"].ui_hex, "#646496")
        self.assertEqual(entries["ABK"].ui_source, "map_hex_fallback")

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


if __name__ == "__main__":
    unittest.main()
