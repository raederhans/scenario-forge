from __future__ import annotations

import json
import unittest
from pathlib import Path

from shapely.geometry import box, mapping

from tools.atlantropa_identity import reconcile_island_identity
from tools.patch_tno_1962_bundle import (
    ATLANTROPA_REGION_CONFIGS,
    apply_atlantropa_published_owner,
    apply_dev_manual_overrides,
    normalize_atlantropa_published_owner,
    TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES,
    apply_tno_feature_assignment_overrides,
    ensure_tno_manual_override_countries,
)


SCENARIO_DIR = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "tno_1962"


class TnoIberianAtlantropaOwnershipTest(unittest.TestCase):
    def test_west_med_donor_states_and_balearics_use_iberian_owner(self) -> None:
        west_med = ATLANTROPA_REGION_CONFIGS["west_med"]
        iberian_states = {8446, 8447, 8448, 8452, 8453, 8455, 8456, 8457,
                          8458, 8459, 8460, 8461}
        self.assertEqual({state_id for state_id, owner in west_med["state_owner_overrides"].items()
                          if owner == "IBR"}, iberian_states)
        self.assertEqual(west_med["state_owner_overrides"][8454], "ALC")
        self.assertEqual(next(group for group in west_med["major_island_groups"]
                              if group["id"] == "balearics")["owner_tag"], "IBR")

    def test_old_west_med_spr_cannot_override_iberian_donor(self) -> None:
        row = {"id": "ATLPRV_123", "assigned_owner_tag": "IBR"}
        published_owners = {row["id"]: "SPR"}
        apply_atlantropa_published_owner("west_med", row, published_owners)
        self.assertEqual(row["assigned_owner_tag"], "IBR")
        self.assertEqual(published_owners[row["id"]], "IBR")

        elsewhere = {"id": "ATLPRV_456", "assigned_owner_tag": "IBR"}
        apply_atlantropa_published_owner("aegean", elsewhere, {elsewhere["id"]: "SPR"})
        self.assertEqual(elsewhere["assigned_owner_tag"], "SPR")
        other_owner = {"id": "ATLPRV_789", "assigned_owner_tag": "IBR"}
        apply_atlantropa_published_owner("west_med", other_owner, {other_owner["id"]: "ALC"})
        self.assertEqual(other_owner["assigned_owner_tag"], "ALC")

    def test_old_published_spr_island_lineage_resolves_to_iberian_owner(self) -> None:
        island = box(0, 0, 1, 1)
        row = {"id": "ATLISL_west_med_new", "region_id": "west_med",
               "geometry": island, "donor_province_ids": [123], "assigned_owner_tag": "IBR"}
        published = [{"type": "Feature", "geometry": mapping(island),
                      "properties": {"id": "ATLISL_west_med_old", "donor_province_ids": [123]}}]
        old_owner = normalize_atlantropa_published_owner("west_med", "SPR")
        rows, diagnostics = reconcile_island_identity(
            [row], published, {"ATLISL_west_med_old": old_owner},
            source_support_by_row_id={row["id"]: island},
        )
        self.assertEqual(rows[0]["id"], "ATLISL_west_med_old")
        self.assertEqual(rows[0]["assigned_owner_tag"], "IBR")
        self.assertEqual(diagnostics["lineage"][0]["owner"], "IBR")

    def test_checked_in_manual_repairs_old_owners_and_preserves_spain_identity(self) -> None:
        manual = json.loads((SCENARIO_DIR / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
        mutations = json.loads((SCENARIO_DIR / "scenario_mutations.json").read_text(encoding="utf-8"))
        original_owners = {
            "RU_CITY_ARKHANGELSK": "RKM",
            "RU_RAY_50074027B42720608112791": "RKM",
            "ATLPRV_18160": "SPR",
            "ATLPRV_18167": "SPR",
            "ATLPRV_18216": "SPR",
            "ATLSHL_west_med_5": "SPR",
        }
        expected_owners = {
            "RU_CITY_ARKHANGELSK": "WRS",
            "RU_RAY_50074027B42720608112791": "VOL",
            "ATLPRV_18160": "IBR",
            "ATLPRV_18167": "IBR",
            "ATLPRV_18216": "IBR",
            "ATLSHL_west_med_5": "IBR",
        }
        selected_assignments = {feature_id: manual["assignments"][feature_id]
                                for feature_id in original_owners}
        for feature_id, target_owner in expected_owners.items():
            self.assertEqual(selected_assignments[feature_id]["owner"], target_owner)
            self.assertEqual(selected_assignments[feature_id]["cores"], [target_owner])
            self.assertEqual(mutations["assignments_by_feature_id"][feature_id],
                             selected_assignments[feature_id])
        self.assertTrue(manual["countries"]["SPR"]["hidden_from_country_list"])
        self.assertTrue(mutations["countries"]["SPR"]["hidden_from_country_list"])

        countries = {"countries": {"SPR": {"tag": "SPR", "hidden_from_country_list": False}}}
        owners = {"owners": dict(original_owners)}
        controllers = {"controllers": dict(original_owners)}
        cores = {"cores": {feature_id: [owner] for feature_id, owner in original_owners.items()}}
        apply_dev_manual_overrides(
            countries, owners, controllers, cores,
            {"countries": {"SPR": manual["countries"]["SPR"]},
             "assignments": selected_assignments},
            {},
        )
        self.assertTrue(countries["countries"]["SPR"]["hidden_from_country_list"])
        for feature_id, target_owner in expected_owners.items():
            self.assertEqual(owners["owners"][feature_id], target_owner)
            self.assertEqual(cores["cores"][feature_id], [target_owner])


class TnoCityOwnershipRepairTest(unittest.TestCase):
    # Independent city faces were omitted when the surrounding districts moved.
    CITY_DISTRICT_PAIRS = {
        "RU_RAY_50074027B5573235052647": ("GOR", "RU_RAY_50074027B9066963315534"),
        "RU_RAY_50074027B91746933948416": ("GOR", "RU_RAY_50074027B16961904381699"),
        "RU_RAY_50074027B96019567685522": ("BKR", "RU_RAY_50074027B27866786044045"),
        "RU_RAY_50074027B26247941998925": ("WRS", "RU_RAY_50074027B29183274260449"),
        "RU_RAY_50074027B40536112899816": ("SAM", "RU_RAY_50074027B65580429840420"),
        "RU_RAY_50074027B58613203253678": ("RKK", "RU_RAY_50074027B24471111608761"),
        "RU_RAY_50074027B47936450781023": ("RUR", "RU_RAY_50074027B240190989633"),
        "RU_RAY_50074027B18536602285327": ("RUR", "RU_RAY_50074027B240190989633"),
        "RU_RAY_50074027B23063195205268": ("KRS", "RU_RAY_50074027B3826534840215"),
    }

    def test_reviewed_city_faces_match_the_preserved_district_owners(self) -> None:
        owners = json.loads((SCENARIO_DIR / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
        cores = json.loads((SCENARIO_DIR / "cores.by_feature.json").read_text(encoding="utf-8"))["cores"]
        manual = json.loads((SCENARIO_DIR / "scenario_manual_overrides.json").read_text(encoding="utf-8"))["assignments"]
        mutations = json.loads((SCENARIO_DIR / "scenario_mutations.json").read_text(encoding="utf-8"))["assignments_by_feature_id"]
        for city_id, (owner, district_id) in self.CITY_DISTRICT_PAIRS.items():
            with self.subTest(city_id=city_id):
                self.assertEqual(owners[district_id], owner)
                self.assertEqual(owners[city_id], owner)
                self.assertEqual(cores[city_id], [owner])
                self.assertEqual(manual[city_id], {"owner": owner, "cores": [owner]})
                self.assertEqual(mutations[city_id], manual[city_id])

    def test_manual_replay_repairs_city_faces_without_absorbing_legitimate_enclaves(self) -> None:
        manual = json.loads((SCENARIO_DIR / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
        old_owners = {fid: "RKM" for fid in self.CITY_DISTRICT_PAIRS}
        old_owners["RU_RAY_50074027B96019567685522"] = "ZLT"
        old_owners["RU_RAY_50074027B47936450781023"] = "NOV"
        old_owners["RU_RAY_50074027B18536602285327"] = "NOV"
        old_owners["RU_RAY_50074027B23063195205268"] = "RUR"
        # Qingdao and Musandam are intentional separate territories, not generic holes.
        preserved = {"CN_CITY_17275852B620737032798": "JAP", "OMN-2425": "OMA"}
        old_owners.update(preserved)
        owners = {"owners": dict(old_owners)}
        cores = {"cores": {fid: [tag] for fid, tag in old_owners.items()}}
        apply_dev_manual_overrides(
            {"countries": {}}, owners, {"controllers": dict(old_owners)}, cores,
            {"assignments": {fid: manual["assignments"][fid] for fid in self.CITY_DISTRICT_PAIRS}}, {},
        )
        for fid, (tag, _) in self.CITY_DISTRICT_PAIRS.items():
            self.assertEqual(owners["owners"][fid], tag)
        for fid, tag in preserved.items():
            self.assertEqual(owners["owners"][fid], tag)
            self.assertEqual(cores["cores"][fid], [tag])

    def test_source_replay_keeps_balkan_and_san_marino_faces_out_of_remote_countries(self) -> None:
        expected = {"RS228": "SER", "XK_ADM1_KOS-5909": "SER",
                    **{f"SM_ADM1_SMR-{n}": "ITA" for n in range(4883, 4892)}}
        expected.update({fid: tag for fid, (tag, _) in self.CITY_DISTRICT_PAIRS.items()
                         if fid != "RU_RAY_50074027B96019567685522"})
        original = {fid: "RKM" for ids in TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES.values() for fid in ids}
        original.update({fid: "AOI" if fid.startswith("SM_") else "PER"
                         for fid in expected if fid.startswith(("SM_", "RS", "XK_"))})
        owners = {"owners": original}
        cores = {"cores": {fid: [tag] for fid, tag in original.items()}}
        apply_tno_feature_assignment_overrides(owners, {"controllers": dict(original)}, cores)
        published = json.loads((SCENARIO_DIR / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
        for fid, tag in expected.items():
            with self.subTest(feature_id=fid):
                self.assertEqual(owners["owners"][fid], tag)
                self.assertEqual(cores["cores"][fid], [tag])
                self.assertEqual(published[fid], tag)

    def test_russian_rules_do_not_reintroduce_conflicting_city_assignments(self) -> None:
        rules = json.loads((SCENARIO_DIR.parents[1] / "scenario-rules" /
                            "tno_1962.russia_ownership.manual.json").read_text(encoding="utf-8"))["country_rules"]
        for fid, tag in {"RU_RAY_50074027B96019567685522": "BKR",
                         "RU_RAY_50074027B47936450781023": "RUR",
                         "RU_RAY_50074027B18536602285327": "RUR"}.items():
            self.assertEqual([rule["tag"] for rule in rules if fid in rule.get("include_feature_ids", [])], [tag])

    def test_krasnoyarsk_name_is_restored_by_country_builder(self) -> None:
        countries = {"countries": {"KRS": {"tag": "KRS", "display_name": "Krasnodar"}}}
        ensure_tno_manual_override_countries(countries, {"owners": {"city": "KRS"}})
        entry = countries["countries"]["KRS"]
        self.assertEqual(entry["display_name"], "Krasnoyarsk")
        self.assertEqual(entry["display_name_en"], "Krasnoyarsk")
        self.assertEqual(entry["display_name_zh"], "克拉斯诺亚尔斯克")
        published = json.loads((SCENARIO_DIR / "countries.json").read_text(encoding="utf-8"))["countries"]["KRS"]
        self.assertEqual(published["display_name"], entry["display_name"])
        self.assertEqual(published["display_name_zh"], entry["display_name_zh"])
        for filename in ("capital_defaults.partial.json", "city_overrides.json"):
            hint = json.loads((SCENARIO_DIR / filename).read_text(encoding="utf-8"))["capital_city_hints"]["KRS"]
            self.assertEqual(hint["city_name"], "Krasnoyarsk")
            self.assertEqual(hint["display_name"], "Krasnoyarsk")


if __name__ == "__main__":
    unittest.main()
