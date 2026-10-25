"""Applied political feature merge plans, in their explicit application order."""
from __future__ import annotations

import json
from pathlib import Path

ORDER_FILE = "political_feature_merges/apply_order.json"
SCENARIOS = ("blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962")


# Scenarios that share one assignment source; a scoped plan covers all of them or none.
SCENARIO_FAMILIES = (("hoi4_1936", "hoi4_1939"),)


def plan_scenarios(plan: dict) -> tuple[str, ...]:
    return tuple(plan["scenarios"]) if "scenarios" in plan else SCENARIOS


def validate_scope(scenarios: tuple[str, ...]) -> None:
    if not scenarios or not set(scenarios) <= set(SCENARIOS):
        raise ValueError(f"Unknown or empty scenario scope: {scenarios}")
    for family in SCENARIO_FAMILIES:
        if 0 < len(set(family) & set(scenarios)) < len(family):
            raise ValueError(f"Scenario scope must include all or none of {family}: {scenarios}")


def consumed_members(data_dir: Path, scenarios: tuple[str, ...]) -> dict[str, str]:
    """Feature ID -> applied plan that already merged it away in any of these scenarios."""
    return {member: name for name, plan in ordered_plans(data_dir) if set(plan_scenarios(plan)) & set(scenarios)
            for group in plan["groups"] for member in group["member_ids"]}


def ordered_plans(data_dir: Path) -> list[tuple[str, dict]]:
    """(file name, plan) in apply_order.json order.

    Every plan file must be listed once, and a merged member (``*_MRG_*``) must
    come from an earlier plan that applies to every scenario this plan does.
    """
    plan_dir = data_dir / "political_feature_merges"
    order = json.loads((data_dir / ORDER_FILE).read_text(encoding="utf-8"))["plans"]
    files = sorted(path.name for path in plan_dir.glob("*.v[0-9]*.json"))
    if len(order) != len(set(order)) or sorted(order) != files:
        raise ValueError(f"{ORDER_FILE} must list every plan exactly once: {sorted(set(files) ^ set(order))}")
    plans, produced = [], {}
    for name in order:
        plan = json.loads((plan_dir / name).read_text(encoding="utf-8"))
        validate_scope(plan_scenarios(plan))
        scenarios = set(plan_scenarios(plan))
        for group in plan["groups"]:
            for member in group["member_ids"]:
                if "_MRG_" in member and not scenarios <= produced.get(member, set()):
                    raise ValueError(f"{name}: {member} is not produced earlier in every scenario of this plan")
            produced[group["id"]] = scenarios
        plans.append((name, plan))
    return plans


LINEAGE_FILE = "feature-migrations/political_feature_merges.v1.json"


def lineage_payload(data_dir: Path) -> dict:
    """Runtime merge lineage for saved-project migration (js/core/feature_merge_migration.js)."""
    return {
        "version": 1,
        "plans": [{"plan": name, "scenarios": list(plan["scenarios"]) if "scenarios" in plan else None,
                   "groups": {group["id"]: group["member_ids"] for group in plan["groups"]}}
                  for name, plan in ordered_plans(data_dir)],
    }


def write_lineage(data_dir: Path) -> bool:
    path = data_dir / LINEAGE_FILE
    text = json.dumps(lineage_payload(data_dir), ensure_ascii=False, separators=(",", ":")) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8", newline="\n")
    return True


def register_plan(data_dir: Path, name: str) -> None:
    """Append a new plan file name to the application order."""
    path = data_dir / ORDER_FILE
    payload = json.loads(path.read_text(encoding="utf-8"))
    if name not in payload["plans"]:
        payload["plans"].append(name)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
