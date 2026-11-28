import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DefenseLinePresetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads((ROOT / "data/operational_presets/defense_lines.json").read_text(encoding="utf-8"))

    def test_generated_file_matches(self):
        subprocess.run([sys.executable, str(ROOT / "tools/build_defense_line_presets.py"), "--check"],
                       cwd=ROOT, check=True)

    def test_coordinates(self):
        self.assertEqual(self.payload["version"], 1)
        for lines in self.payload["scenarios"].values():
            for line in lines:
                with self.subTest(line=line["id"]):
                    self.assertGreaterEqual(len(line["points"]), 2)
                    for lon, lat in line["points"]:
                        self.assertTrue(-180 <= lon <= 180)
                        self.assertTrue(-90 <= lat <= 90)


if __name__ == "__main__":
    unittest.main()
