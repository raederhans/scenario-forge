from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import init_map_data


class InitMapDataPalettePathsTest(unittest.TestCase):
    def test_build_cross_platform_source_candidates_returns_windows_and_wsl_paths(self) -> None:
        candidates = init_map_data._build_cross_platform_source_candidates(
            r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\1521695605"
        )

        self.assertEqual(
            candidates,
            [
                Path(r"C:\Program Files (x86)\Steam\steamapps\workshop\content\394360\1521695605"),
                Path("/mnt/c/Program Files (x86)/Steam/steamapps/workshop/content/394360/1521695605"),
            ],
        )

    def test_resolve_palette_source_root_hits_existing_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            missing = root / "missing"
            hit = root / "hit"
            (hit / "common" / "country_tags").mkdir(parents=True, exist_ok=True)
            (hit / "common" / "country_tags" / "00_countries.txt").write_text("AAA = countries/AAA.txt", encoding="utf-8")

            resolved = init_map_data._resolve_palette_source_root([missing, hit])

            self.assertEqual(resolved, hit)

    def test_run_palette_imports_strict_reports_all_tried_candidates_for_missing_mod(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            (output_dir / "europe_topology.json").write_text("{}", encoding="utf-8")
            (output_dir / "europe_topology.runtime_political_v1.json").write_text("{}", encoding="utf-8")

            vanilla_root = output_dir / "vanilla"
            (vanilla_root / "common" / "country_tags").mkdir(parents=True, exist_ok=True)
            (vanilla_root / "common" / "country_tags" / "00_countries.txt").write_text("AAA = countries/AAA.txt", encoding="utf-8")

            def fake_resolver(windows_path: str):
                if windows_path.endswith(r"common\Hearts of Iron IV"):
                    return vanilla_root, [vanilla_root]
                return None, init_map_data._build_cross_platform_source_candidates(windows_path)

            with patch.object(init_map_data, "_resolve_palette_job_source_root", side_effect=fake_resolver), patch.object(
                init_map_data.subprocess,
                "run",
                return_value=None,
            ):
                with self.assertRaisesRegex(SystemExit, "Tried: .*1521695605.*Install or sync the mod"):
                    init_map_data.run_palette_imports(output_dir, strict=True)


if __name__ == "__main__":
    unittest.main()
