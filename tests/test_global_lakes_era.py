import json
from pathlib import Path
import unittest


class GlobalLakesEraTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "data" / "global_lakes.geojson"
        collection = json.loads(path.read_text(encoding="utf-8"))
        cls.by_ne_id = {str(f["properties"].get("ne_id")): f["properties"]
                        for f in collection["features"]}

    def test_nasser_construction_year(self):
        year = self.by_ne_id["1159125095"]["year_built"]
        self.assertIsInstance(year, int)
        self.assertGreaterEqual(year, 1960)
        self.assertLessEqual(year, 1971)

    def test_kakhovka_removal_year(self):
        self.assertEqual(self.by_ne_id["1159124989"]["year_removed"], 2023)

    def test_mjosa_is_not_a_new_reservoir(self):
        self.assertNotIn("year_built", self.by_ne_id["1159123435"])

    def test_regulated_natural_lakes_have_no_construction_year(self):
        for ne_id in ("1159123091", "1159123217", "1159123281"):
            with self.subTest(ne_id=ne_id):
                self.assertNotIn("year_built", self.by_ne_id[ne_id])


if __name__ == "__main__":
    unittest.main()
