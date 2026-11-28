from __future__ import annotations

import json
import tempfile
from pathlib import Path
import unittest

from tools.build_hgo_flag_index import build_catalog_index
from tools.build_hgo_flag_png_catalog import build_png_manifest
from tools.build_hgo_name_catalog import build_catalog
from PIL import Image


def write_tga(path: Path, *, size: tuple[int, int] = (4, 3)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", size, (10, 20, 30, 255))
    image.save(path, "TGA")


class HgoCatalogBuilderTest(unittest.TestCase):
    def test_name_catalog_groups_country_suffixes_and_place_kinds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            localisation = root / "localisation"
            localisation.mkdir()
            (localisation / "HGO_countries_l_english.yml").write_text(
                'l_english:\n ABK:0 "Abkhazia"\n ALG:0 "Algeria"\n',
                encoding="utf-8",
            )
            (localisation / "state_names_l_english.yml").write_text(
                'l_english:\n STATE_1:0 "Ajaccio"\n',
                encoding="utf-8",
            )
            (localisation / "strategic_region_names_l_english.yml").write_text(
                'l_english:\n STRATEGICREGION_1:0 "Southern England"\n',
                encoding="utf-8",
            )
            (localisation / "supply_area_names_l_english.yml").write_text(
                'l_english:\n SUPPLYAREA_1:0 "Corsica"\n',
                encoding="utf-8",
            )

            payload = build_catalog(root)

        entries = payload["entries"]
        self.assertEqual(entries["ALG"]["names"]["en"], "Algeria")
        self.assertEqual(entries["STATE_1"]["kind"], "state")
        self.assertEqual(entries["STATE_1"]["names"]["en"], "Ajaccio")
        self.assertEqual(entries["STRATEGICREGION_1"]["kind"], "strategic_region")
        self.assertEqual(entries["SUPPLYAREA_1"]["kind"], "supply_area")

    def test_flag_png_manifest_converts_and_shards_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source_root = root / "source"
            for rel_path in [
                "gfx/flags/ABK.tga",
                "gfx/flags/ABK_SOV.tga",
                "gfx/flags/ABK_ENG.TGA",
                "gfx/flags/medium/ABK.tga",
                "gfx/flags/small/ABK.tga",
            ]:
                write_tga(source_root / rel_path)
            output_root = root / "data" / "hgo_catalogs" / "flags_png"
            manifest_output = root / "data" / "hgo_catalogs" / "hgo_flags.png_manifest.json"

            payload = build_png_manifest(source_root, output_root, manifest_output=manifest_output)
            self.assertEqual(payload["counts"]["files"], 5)
            self.assertEqual(payload["counts"]["files_by_tier"], {"full": 3, "medium": 1, "small": 1})
            base_full = payload["tags"]["ABK"]["base"]["full"]
            self.assertEqual(base_full["source_path"], "gfx/flags/ABK.tga")
            self.assertTrue(base_full["png_path"].endswith("flags_png/full/AB/ABK.png"))
            self.assertTrue(Path(base_full["png_path"]).is_file())
            self.assertTrue(
                payload["tags"]["ABK"]["variants"]["sov"]["full"]["png_path"].endswith(
                    "flags_png/full/AB/ABK_SOV.png"
                )
            )

    def test_catalog_index_records_place_names_and_flags_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            place_names = root / "data" / "hgo_catalogs" / "hgo_place_names.json"
            flags_index = root / "data" / "hgo_catalogs" / "hgo_flags.index.json"
            place_names.parent.mkdir(parents=True)
            place_names.write_text(json.dumps({"counts": {"entries": 12}}), encoding="utf-8")
            flags_payload = {
                "generated_at_utc": "2026-06-02T00:00:00Z",
                "source": {"display_name": "Historic Geographical Overhaul"},
                "counts": {"tags": 3},
            }

            png_manifest = root / "data" / "hgo_catalogs" / "hgo_flags.png_manifest.json"
            png_manifest.write_text(json.dumps({"counts": {"files": 4, "total_png_bytes": 1234}}), encoding="utf-8")

            payload = build_catalog_index(
                flags_payload,
                place_names_path=place_names,
                flags_path=flags_index,
                png_manifest_path=png_manifest,
            )

        self.assertEqual(payload["assets"]["place_names"]["url"], place_names.as_posix())
        self.assertEqual(payload["assets"]["place_names"]["role"], "hgo_place_names")
        self.assertEqual(payload["assets"]["place_names"]["entry_count"], 12)
        self.assertEqual(payload["assets"]["flags_index"]["url"], flags_index.as_posix())
        self.assertEqual(payload["assets"]["flags_index"]["role"], "hgo_flags_index")
        self.assertEqual(payload["assets"]["flags_index"]["tag_count"], 3)
        self.assertEqual(payload["assets"]["flags_png_manifest"]["url"], png_manifest.as_posix())
        self.assertEqual(payload["assets"]["flags_png_manifest"]["role"], "hgo_flags_png_manifest")
        self.assertEqual(payload["assets"]["flags_png_manifest"]["file_count"], 4)
        self.assertEqual(payload["assets"]["flags_png_manifest"]["total_png_bytes"], 1234)


if __name__ == "__main__":
    unittest.main()
