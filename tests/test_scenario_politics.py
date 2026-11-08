import json
from pathlib import Path
import unittest

from scenario_builder.hoi4.politics import annotate_countries, evaluate_histories
from tools.apply_scenario_politics import replace_bundle, compact


class PoliticsTests(unittest.TestCase):
    def evaluate(self, text, cutoff="1936.1.1.12"):
        return evaluate_histories({"GER": text}, cutoff)

    def test_top_level_and_dates(self):
        text = '''
        1939.1.1 = { set_politics = { ruling_party = democracy } }
        1936.1.1 = { set_politics = { ruling_party = fascism } }
        1935.1.1 = { set_politics = { ruling_party = communism } }
        set_politics = { ruling_party = neutrality } # ignored comment
        '''
        for cutoff, expected in (("1934.1.1", "neutrality"), ("1936.1.1.12", "fascism"), ("1939.1.1", "democracy")):
            with self.subTest(cutoff=cutoff):
                politics, _, _ = self.evaluate(text, cutoff)
                self.assertEqual(politics["GER"]["ruling_ideology"], expected)

    def test_dlc_conditions(self):
        for condition, expected in (( 'has_dlc = "A"', "neutrality"), ('NOT = { has_dlc = "A" }', "fascism"), ('not = { has_dlc = "A" }', "fascism")):
            with self.subTest(condition=condition):
                politics, _, audit = self.evaluate('IF = { limit = { ' + condition + ' } set_politics = { ruling_party = fascism } } else = { set_politics = { ruling_party = neutrality } }')
                self.assertEqual(politics["GER"]["ruling_ideology"], expected)
                self.assertEqual(audit["unresolved_if_count"], 0)

    def test_unknown_condition_skips_else(self):
        politics, _, audit = self.evaluate('''
        set_politics = { ruling_party = neutrality }
        if = { limit = { has_dlc = "A" NOT = { tag = GER } }
            set_politics = { ruling_party = fascism } }
        else = { set_politics = { ruling_party = democracy } }
        ''')
        self.assertEqual(politics["GER"]["ruling_ideology"], "neutrality")
        self.assertEqual(audit["unresolved_if_count"], 1)

    def test_nested_else(self):
        for condition, expected in (
            ('has_dlc = "A"', "neutrality"),
            ('nOt = { has_dlc = "A" }', "fascism"),
        ):
            with self.subTest(condition=condition):
                politics, _, audit = self.evaluate('IF = { LIMIT = { ' + condition + ' } set_politics = { ruling_party = fascism } ELSE = { set_politics = { ruling_party = neutrality } } }')
                self.assertEqual(politics["GER"]["ruling_ideology"], expected)
                self.assertEqual(audit["unresolved_if_count"], 0)

    def test_alias_history_and_membership(self):
        payload = {"countries": {"RAJ": {}, "SIA": {}, "SUB": {"parent_owner_tag": "SIA"}}}
        histories = {
            "IND": "set_politics = { ruling_party = democratic } create_faction = Allies add_to_faction = THA",
            "THA": "set_politics = { ruling_party = neutrality }",
        }
        result, audit = annotate_countries(payload, histories, "1962.1.1", game_tag_aliases={"RAJ": "IND", "SIA": "THA"})
        for tag, game in (("RAJ", "IND"), ("SIA", "THA")):
            self.assertEqual(result["countries"][tag]["ruling_ideology_source"], f"game_history:{game}")
            self.assertEqual(result["countries"][tag]["alliance_source"], f"game_history:{game}")
            self.assertEqual(result["countries"][tag]["alliance"], "allies")
        self.assertEqual(result["countries"]["SIA"]["ruling_ideology"], "neutrality")
        self.assertEqual(result["countries"]["SUB"]["alliance_source"], "inherited:SIA")
        self.assertEqual(result["alliances"]["allies"]["leader"], "RAJ")
        self.assertEqual(result["alliances"]["allies"]["member_count"], 3)
        self.assertEqual(audit["alliance_members"]["allies"], ["RAJ", "SIA", "SUB"])
        self.assertEqual(audit["unmatched_members"], [])

    def test_faction_forms(self):
        for statement, expected in (("create_faction_from_template = faction_template_allies", "allies"), ("create_faction_from_template = { name = Japanese_Co-Prosperity_Sphere template = ignored }", "japanese_co_prosperity_sphere"), ('create_faction = "Organization_of_Free_Nations"', "organization_of_free_nations")):
            with self.subTest(statement=statement):
                politics, alliances, _ = self.evaluate(statement)
                self.assertEqual(politics["GER"]["alliance"], expected)
                self.assertEqual(alliances[expected]["leader"], "GER")

    def test_members_and_scopes(self):
        histories = {
            "ITA": "GER = { add_to_faction = PREV }",
            "GER": "create_faction = Axis add_to_faction = JAP ITA = { PREV = { add_to_faction = HUN } }",
            "ENG": "add_to_faction = FRA",
        }
        politics, _, audit = evaluate_histories(histories, "1936.1.1")
        for tag in ("GER", "ITA", "JAP", "HUN"):
            self.assertEqual(politics[tag]["alliance"], "axis")
        self.assertEqual(audit["unmatched_members"], [{"scope": "ENG", "member": "FRA", "reason": "scope_without_alliance"}])
        self.assertEqual(evaluate_histories(dict(reversed(list(histories.items()))), "1936.1.1"), (politics, _, audit))

    def test_inheritance_and_subject(self):
        payload = {"countries": {"CHD": {"parent_owner_tag": "MID"}, "MID": {"parent_owner_tag": "GER"}, "SUB": {"parent_owner_tag": "GER"}, "GER": {}, "ZZZ": {}}}
        histories = {"GER": "set_politics = { ruling_party = fascism } create_faction = Axis add_to_faction = ABS", "SUB": "set_politics = { ruling_party = neutrality }"}
        result, audit = annotate_countries(payload, histories, "1936.1.1")
        self.assertNotIn("alliance", payload["countries"]["GER"])
        for field in ("ruling_ideology", "alliance"):
            self.assertEqual(result["countries"]["CHD"][field + "_source"], "inherited:MID")
            self.assertEqual(result["countries"]["MID"][field + "_source"], "inherited:GER")
        self.assertEqual(result["countries"]["SUB"]["ruling_ideology"], "neutrality")
        self.assertEqual(result["countries"]["SUB"]["ruling_ideology_source"], "game_history")
        self.assertEqual(result["countries"]["SUB"]["alliance_source"], "inherited:GER")
        self.assertEqual(result["alliances"]["axis"]["member_count"], 4)
        self.assertEqual(audit["empty_tags"], ["ZZZ"])
        self.assertIn({"scope": "GER", "member": "ABS", "reason": "absent_from_scenario"}, audit["unmatched_members"])

    def test_unknown_alliance(self):
        with self.assertRaisesRegex(ValueError, "Unknown alliance id"):
            self.evaluate('create_faction = "Unknown"')

    def test_bundle_replacement(self):
        old = {"countries": {"GER": {}}}
        new = {"countries": {"GER": {"alliance": "axis"}}}
        text = '{"number":0.0000678190865961596,"scenario":{"countries":' + compact(old) + '},"source":{"countries_sha256":"old"}}\n'
        updated = replace_bundle(text, old, new, "old", "new")
        self.assertEqual(updated, text.replace(compact(old), compact(new)).replace('"old"', '"new"'))
        with self.assertRaises(AssertionError):
            replace_bundle(text, old, new, "wrong", "new")
        with self.assertRaises(AssertionError):
            replace_bundle(text + compact(old), old, new, "old", "new")

    def test_real_scenario_fields(self):
        root = Path(__file__).resolve().parents[1] / "data/scenarios"
        for scenario in ("hoi4_1936", "hoi4_1939", "tno_1962"):
            with self.subTest(scenario=scenario):
                payload = json.loads((root / scenario / "countries.json").read_bytes())
                for country in payload["countries"].values():
                    for field in ("ruling_ideology", "ruling_ideology_source", "alliance", "alliance_source"):
                        self.assertIsInstance(country[field], str)
                for alliance in payload["alliances"].values():
                    self.assertIn(alliance["leader"], payload["countries"])


if __name__ == "__main__":
    unittest.main()
