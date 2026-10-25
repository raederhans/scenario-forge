"""Applied political feature merge plans, in their explicit application order."""
from __future__ import annotations

import json
from pathlib import Path

ORDER_FILE = "political_feature_merges/apply_order.json"
SCENARIOS = ("blank_base", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962")


def plan_scenarios(plan: dict) -> tuple[str, ...]:
    return tuple(plan["scenarios"]) if "scenarios" in plan else SCENARIOS


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
        scenarios = set(plan_scenarios(plan))
        for group in plan["groups"]:
            for member in group["member_ids"]:
                if "_MRG_" in member and not scenarios <= produced.get(member, set()):
                    raise ValueError(f"{name}: {member} is not produced earlier in every scenario of this plan")
            produced[group["id"]] = scenarios
        plans.append((name, plan))
    return plans


def register_plan(data_dir: Path, name: str) -> None:
    """Append a new plan file name to the application order."""
    path = data_dir / ORDER_FILE
    payload = json.loads(path.read_text(encoding="utf-8"))
    if name not in payload["plans"]:
        payload["plans"].append(name)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
