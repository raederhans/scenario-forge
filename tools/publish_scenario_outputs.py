from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.scenario_publish_service import publish_scenario_outputs


def run_publish_scenario_outputs(
    scenario_id: str,
    *,
    target: str,
    root: Path = ROOT,
    checkpoint_dir: Path | None = None,
) -> dict[str, object]:
    return publish_scenario_outputs(
        str(scenario_id or "").strip(),
        target=str(target or "").strip().lower(),
        root=root,
        checkpoint_dir=checkpoint_dir,
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish scenario outputs from existing materialized artifacts.",
        allow_abbrev=False,
    )
    parser.add_argument("--scenario-id", required=True)
    parser.add_argument(
        "--target",
        choices=("geo-locale", "startup-support-assets", "startup-bundle-assets", "startup-assets", "chunk-assets", "all"),
        required=True,
    )
    parser.add_argument("--root", default=str(ROOT))
    parser.add_argument("--checkpoint-dir", default="")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    checkpoint_dir = Path(args.checkpoint_dir).resolve() if str(args.checkpoint_dir or "").strip() else None
    result = run_publish_scenario_outputs(
        args.scenario_id,
        target=args.target,
        root=Path(args.root).resolve(),
        checkpoint_dir=checkpoint_dir,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
