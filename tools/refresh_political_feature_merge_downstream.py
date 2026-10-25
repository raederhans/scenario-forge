"""Run the downstream steps of a political feature merge plan for its scenarios only.

After tools/apply_political_feature_merges.py, this rebuilds what the README's
"Afterwards" list names, limited to the plan's scenarios:

1. political ID rasters of the scoped raster scenarios (needs a dev server);
2. Modern World river-paint packs, only when modern_world is in scope;
3. ``scenario.baselineHash`` of the scoped landing sample projects;
4. landing hero maps and the landing map stage, when a scoped scenario is drawn
   there. CI compares these bytes on Linux, so pass ``--landing-python`` with
   the WSL interpreter (e.g. ``"wsl --cd . ~/sfvenv/bin/python"``).
"""
from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.political_feature_merge_plans import plan_scenarios  # noqa: E402
from tools.apply_political_feature_merges import write_like  # noqa: E402

RASTER_SCENARIOS = ("hoi4_1936", "hoi4_1939", "tno_1962")
SAMPLE_PROJECTS = ROOT / "landing/assets/sample-projects"
LANDING_HERO_SCENARIOS = ("blank_base", "hoi4_1936", "hoi4_1939", "tno_1962")
LANDING_STAGE_SCENARIOS = ("hoi4_1936", "hoi4_1939", "tno_1962", "modern_world")


def repin_sample_projects(scenarios: tuple[str, ...]) -> list[str]:
    changed = []
    for path in sorted(SAMPLE_PROJECTS.glob("*.project.json")):
        original = path.read_bytes()
        project = json.loads(original)
        scenario_id = project.get("scenario", {}).get("id")
        if scenario_id not in scenarios:
            continue
        baseline = json.loads((ROOT / f"data/scenarios/{scenario_id}/manifest.json").read_text(encoding="utf-8"))["baseline_hash"]
        if project["scenario"].get("baselineHash") != baseline:
            project["scenario"]["baselineHash"] = baseline
            write_like(path, project, original)
            changed.append(path.relative_to(ROOT).as_posix())
    return changed


def steps(scenarios: tuple[str, ...], base_url: str, landing_python: list[str]) -> list[tuple[str, list[str] | None]]:
    """(description, command) in order; a None command is done in-process."""
    planned: list[tuple[str, list[str] | None]] = []
    for scenario in (s for s in RASTER_SCENARIOS if s in scenarios):
        for extend in ([], ["--extend", "true"]):
            planned.append((f"political ID raster {scenario} {' '.join(extend)}".strip(),
                            ["node", "tools/build_political_id_raster_assets.mjs", "--base-url", base_url, "--scenario", scenario, *extend]))
    if "modern_world" in scenarios:
        planned.append(("Modern World river-paint packs", [sys.executable, "tools/repin_river_partition_packs.py"]))
    planned.append(("landing sample baselines", None))
    if set(scenarios) & set(LANDING_HERO_SCENARIOS):
        planned.append(("landing hero maps", [*landing_python, "tools/build_landing_europe_1936_showcase.py"]))
    if set(scenarios) & set(LANDING_STAGE_SCENARIOS):
        planned.append(("landing map stage", [*landing_python, "tools/build_landing_history_scrubber.py"]))
    return planned


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--base-url", default="", help="Dev server app URL serving this checkout, e.g. http://127.0.0.1:8008/app/")
    parser.add_argument("--landing-python", default=sys.executable, help="Interpreter command for the landing generators.")
    parser.add_argument("--dry-run", action="store_true", help="Only print the steps.")
    args = parser.parse_args()
    scenarios = plan_scenarios(json.loads((ROOT / args.plan).read_text(encoding="utf-8")))
    planned = steps(scenarios, args.base_url, shlex.split(args.landing_python, posix=False))
    if not args.dry_run and not args.base_url and any(s in scenarios for s in RASTER_SCENARIOS):
        parser.error("--base-url is required to rebuild political ID rasters")
    for description, command in planned:
        print(json.dumps({"step": description, "command": command}, ensure_ascii=False), flush=True)
        if args.dry_run:
            continue
        if command is None:
            print(json.dumps({"changed": repin_sample_projects(scenarios)}), flush=True)
        else:
            subprocess.run(command, check=True, cwd=ROOT)


if __name__ == "__main__":
    main()
