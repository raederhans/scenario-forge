import unittest

from scenario_builder.hoi4.politics import annotate_countries, evaluate_histories


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


if __name__ == "__main__":
    unittest.main()
