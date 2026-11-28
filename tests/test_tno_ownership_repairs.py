from __future__ import annotations

import json
import unittest
from pathlib import Path


from map_builder.political_feature_merge_plans import ordered_plans, plan_scenarios
from tools.patch_tno_1962_bundle import apply_dev_manual_overrides, TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES, apply_tno_feature_assignment_overrides


SCENARIO_DIR = Path(__file__).resolve().parents[1] / "data" / "scenarios" / "tno_1962"


def tno_feature(feature_id: str) -> str:
    """The TNO feature a source parcel ended up in, following every merge plan applied to TNO."""
    for _, plan in ordered_plans(SCENARIO_DIR.parents[1]):
        if "tno_1962" in plan_scenarios(plan):
            for group in plan["groups"]:
                if feature_id in group["member_ids"]:
                    feature_id = group["id"]
    return feature_id


class TnoCityOwnershipRepairTest(unittest.TestCase):
    # Independent city faces were omitted when the surrounding districts moved.
    CITY_OWNERS = {
        "RU_RAY_50074027B5573235052647": "GOR",
        "RU_RAY_50074027B91746933948416": "GOR",
        "RU_RAY_50074027B96019567685522": "BKR",
        "RU_RAY_50074027B26247941998925": "WRS",
        "RU_RAY_50074027B40536112899816": "SAM",
        "RU_RAY_50074027B58613203253678": "RKK",
        "RU_RAY_50074027B47936450781023": "RUR",
        "RU_RAY_50074027B18536602285327": "RUR",
        "RU_RAY_50074027B23063195205268": "KRS",
    }
    CORRECTED_OWNERS = {"RU_RAY_50074027B5573235052647": "TAT", "RU_RAY_50074027B91746933948416": "TAT",
                        "RU_RAY_50074027B96019567685522": "PRM",
                        "RU_RAY_50074027B58613203253678": "RKK"}

    def test_manual_replay_repairs_city_faces_without_absorbing_legitimate_enclaves(self) -> None:
        manual = json.loads((SCENARIO_DIR / "scenario_manual_overrides.json").read_text(encoding="utf-8"))
        old_owners = {fid: "RKM" for fid in self.CITY_OWNERS}
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
            {"assignments": {fid: manual["assignments"][tno_feature(fid)] for fid in self.CITY_OWNERS}}, {},
        )
        for fid, tag in self.CITY_OWNERS.items():
            self.assertEqual(owners["owners"][fid], self.CORRECTED_OWNERS.get(fid, tag))
        for fid, tag in preserved.items():
            self.assertEqual(owners["owners"][fid], tag)
            self.assertEqual(cores["cores"][fid], [tag])

    def test_source_replay_keeps_balkan_and_san_marino_faces_out_of_remote_countries(self) -> None:
        expected = {"RS228": "SER", "XK_ADM1_KOS-5909": "SER",
                    **{f"SM_ADM1_SMR-{n}": "ITA" for n in range(4883, 4892)}}
        expected.update({fid: tag for fid, tag in self.CITY_OWNERS.items()
                         if fid != "RU_RAY_50074027B96019567685522"})
        original = {fid: "RKM" for ids in TNO_1962_FEATURE_ASSIGNMENT_OVERRIDES.values() for fid in ids}
        original.update({fid: "AOI" if fid.startswith("SM_") else "PER"
                         for fid in expected if fid.startswith(("SM_", "RS", "XK_"))})
        owners = {"owners": original}
        cores = {"cores": {fid: [tag] for fid, tag in original.items()}}
        apply_tno_feature_assignment_overrides(owners, {"controllers": dict(original)}, cores)
        published = json.loads((SCENARIO_DIR / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
        south = {"RS228": "BUL", "XK_ADM1_KOS-5909": "ALB",
                 **{f"SM_ADM1_SMR-{n}": "SNM" for n in range(4883, 4892)}}
        for fid, tag in expected.items():
            with self.subTest(feature_id=fid):
                self.assertEqual(owners["owners"][fid], tag)
                self.assertEqual(cores["cores"][fid], [tag])
                self.assertEqual(published[tno_feature(fid)], south.get(fid, self.CORRECTED_OWNERS.get(fid, tag)))


if __name__ == "__main__":
    unittest.main()
