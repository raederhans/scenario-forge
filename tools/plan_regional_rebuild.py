from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.regional_rebuild_plan import plan_regional_rebuild


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan a regional political topology rebuild without writing assets.")
    parser.add_argument("--baseline-topology", required=True, type=Path)
    parser.add_argument("--candidate-topology", type=Path, help="Omit for selector-only preview.")
    parser.add_argument("--source-countries", default="", help="Comma-separated political property/id country codes.")
    parser.add_argument("--feature-ids-file", type=Path)
    parser.add_argument("--scenario-dir", action="append", type=Path, default=[])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    feature_ids = []
    if args.feature_ids_file:
        payload = json.loads(args.feature_ids_file.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise SystemExit("--feature-ids-file must contain a JSON array")
        feature_ids = [str(value) for value in payload]
    result = plan_regional_rebuild(
        baseline_topology=args.baseline_topology,
        candidate_topology=args.candidate_topology,
        source_countries=[v for v in args.source_countries.split(",") if v.strip()],
        feature_ids=feature_ids,
        scenario_dirs=args.scenario_dir,
    )
    text = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        inputs = [args.baseline_topology, args.candidate_topology, args.feature_ids_file]
        if any(path is not None and (args.output.resolve() == path.resolve()
               or args.output.exists() and path.exists() and args.output.samefile(path)) for path in inputs):
            parser.error("Report output cannot overwrite an input")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
