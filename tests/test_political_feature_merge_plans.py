from __future__ import annotations
import json
import tempfile
import unittest
from pathlib import Path

from map_builder.political_feature_merge_plans import ordered_plans, register_plan


def write_plans(data_dir: Path, plans: dict[str, dict], order: list[str]) -> None:
    plan_dir = data_dir / "political_feature_merges"
    plan_dir.mkdir(parents=True)
    for name, plan in plans.items():
        (plan_dir / name).write_text(json.dumps(plan), encoding="utf-8")
    (plan_dir / "apply_order.json").write_text(json.dumps({"plans": order}), encoding="utf-8")


def plan(*groups: tuple[str, list[str]], scenarios: list[str] | None = None) -> dict:
    return {"groups": [{"id": gid, "member_ids": members} for gid, members in groups],
            **({} if scenarios is None else {"scenarios": scenarios})}


class OrderedPlansTest(unittest.TestCase):
    def check(self, plans: dict[str, dict], order: list[str]):
        with tempfile.TemporaryDirectory() as directory:
            write_plans(Path(directory), plans, order)
            return [name for name, _ in ordered_plans(Path(directory))]

    def test_chained_merges_follow_the_listed_order(self):
        plans = {"b_first.v1.json": plan(("DE_MRG_1", ["DE1", "DE2"])),
                 "a_second.v1.json": plan(("DE_MRG_2", ["DE_MRG_1", "DE3"]))}
        self.assertEqual(self.check(plans, ["b_first.v1.json", "a_second.v1.json"]), ["b_first.v1.json", "a_second.v1.json"])
        with self.assertRaisesRegex(ValueError, "DE_MRG_1 is not produced earlier"):
            self.check(plans, ["a_second.v1.json", "b_first.v1.json"])

    def test_every_plan_is_listed_once(self):
        plans = {"one.v1.json": plan(("DE_MRG_1", ["DE1", "DE2"])), "two.v1.json": plan(("DE_MRG_2", ["DE3", "DE4"]))}
        for order in (["one.v1.json"], ["one.v1.json", "two.v1.json", "two.v1.json"]):
            with self.assertRaisesRegex(ValueError, "exactly once"):
                self.check(plans, order)

    def test_a_scoped_merge_feeds_only_plans_within_its_scenarios(self):
        scoped = plan(("RU_MRG_1", ["RU1", "RU2"]), scenarios=["tno_1962"])
        self.check({"a.v1.json": scoped, "b.v1.json": plan(("RU_MRG_2", ["RU_MRG_1", "RU3"]), scenarios=["tno_1962"])},
                   ["a.v1.json", "b.v1.json"])
        with self.assertRaisesRegex(ValueError, "RU_MRG_1 is not produced earlier"):
            self.check({"a.v1.json": scoped, "b.v1.json": plan(("RU_MRG_2", ["RU_MRG_1", "RU3"]))}, ["a.v1.json", "b.v1.json"])

    def test_register_appends_new_plans_once(self):
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            write_plans(data_dir, {}, ["one.v1.json"])
            register_plan(data_dir, "two.v1.json")
            register_plan(data_dir, "two.v1.json")
            order = json.loads((data_dir / "political_feature_merges/apply_order.json").read_text(encoding="utf-8"))["plans"]
            self.assertEqual(order, ["one.v1.json", "two.v1.json"])


if __name__ == "__main__":
    unittest.main()
