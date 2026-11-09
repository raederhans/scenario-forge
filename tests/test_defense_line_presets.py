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

    def test_hoi4_lines(self):
        scenarios = self.payload["scenarios"]
        early = {line["id"]: line for line in scenarios["hoi4_1936"]}
        late = {line["id"]: line for line in scenarios["hoi4_1939"]}
        self.assertEqual(set(early), {"maginot", "mannerheim", "stalin", "stalin_karelia"})
        self.assertEqual(set(late), set(early) | {"siegfried", "metaxas"})
        self.assertGreater(len(late["stalin"]["points"]), len(early["stalin"]["points"]))

    def test_coordinates(self):
        self.assertEqual(self.payload["version"], 1)
        for lines in self.payload["scenarios"].values():
            for line in lines:
                with self.subTest(line=line["id"]):
                    self.assertGreaterEqual(len(line["points"]), 2)
                    for lon, lat in line["points"]:
                        self.assertTrue(-180 <= lon <= 180)
                        self.assertTrue(-90 <= lat <= 90)

    def test_aa_line(self):
        line, = self.payload["scenarios"]["tno_1962"]
        self.assertEqual(line["id"], "aa_line")
        self.assertEqual(line["derivation"], "scenario-ownership")
        points = line["points"]
        self.assertGreater(points[0][1], 60)
        self.assertLess(points[-1][1], 52)
        self.assertTrue(100 <= len(points) <= 400)
        self.assertTrue(all(b[1] - a[1] <= 0.3 for a, b in zip(points, points[1:])))


if __name__ == "__main__":
    unittest.main()
