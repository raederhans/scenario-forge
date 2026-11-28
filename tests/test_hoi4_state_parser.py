from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scenario_builder.hoi4.parser import parse_state_file


class Hoi4StateParserStrategicValuesTest(unittest.TestCase):
    def parse_fixture(self, body: str, *, as_of_date: str | None = None):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "1-Test.txt"
            path.write_text(body, encoding="utf-8")
            return parse_state_file(path, as_of_date=as_of_date)

    def test_parses_victory_point_pairs_resources_and_province_buildings(self) -> None:
        record = self.parse_fixture(
            """
            state = {
              id = 1
              manpower = 100000
              resources = { steel = 6 oil = 1.5 }
              state_category = town
              provinces = { 10 11 12 }
              history = {
                owner = FRA
                add_core_of = FRA
                victory_points = { 10 5 11 1 }
                buildings = {
                  infrastructure = 6
                  arms_factory = 2
                  10 = {
                    naval_base = 3
                    naval_headquarters = { level = 1 allowed = { always = yes } }
                  }
                }
              }
            }
            """
        )

        assert record is not None
        self.assertEqual(record.victory_points, [(10, 5), (11, 1)])
        self.assertEqual(record.resources, {"steel": 6.0, "oil": 1.5})
        self.assertEqual(record.buildings, {"infrastructure": 6, "arms_factory": 2})
        self.assertEqual(record.province_buildings, {10: {"naval_base": 3}})

    def test_dated_buildings_override_base_values_by_as_of_date(self) -> None:
        body = """
            state = {
              id = 2
              manpower = 200000
              state_category = city
              provinces = { 20 }
              history = {
                owner = ENG
                buildings = {
                  infrastructure = 8
                  arms_factory = 3
                  20 = { industrial_complex = 1 }
                }
                1939.1.1 = {
                  buildings = {
                    arms_factory = 4
                    20 = { industrial_complex = 2 }
                  }
                }
              }
            }
            """
        record_1936 = self.parse_fixture(body, as_of_date="1936.1.1.12")
        record_1939 = self.parse_fixture(body, as_of_date="1939.1.1.12")

        assert record_1936 is not None
        assert record_1939 is not None
        self.assertEqual(record_1936.buildings["arms_factory"], 3)
        self.assertEqual(record_1936.province_buildings[20]["industrial_complex"], 1)
        self.assertEqual(record_1939.buildings["arms_factory"], 4)
        self.assertEqual(record_1939.province_buildings[20]["industrial_complex"], 2)
        self.assertEqual(record_1939.buildings["infrastructure"], 8)

    def test_comments_do_not_pollute_numbers_or_owner_semantics(self) -> None:
        record = self.parse_fixture(
            """
            state = {
              id = 3
              manpower = 300000 # was: 400000
              resources = { tungsten = 2 # was: 8
              }
              state_category = rural
              provinces = { 30 31 }
              history = {
                owner = POL # was: GER
                add_core_of = POL
                victory_points = { 30 10 # was: 25
                }
              }
            }
            """
        )

        assert record is not None
        self.assertEqual(record.owner_tag, "POL")
        self.assertEqual(record.manpower, 300000)
        self.assertEqual(record.resources, {"tungsten": 2.0})
        self.assertEqual(record.victory_points, [(30, 10)])


if __name__ == "__main__":
    unittest.main()
