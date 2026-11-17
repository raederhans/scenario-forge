from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.scenario_context import ensure_path_within_allowed_bases
from map_builder.scenario_bundle_publish_service import (
    SCENARIO_ID,
    build_tno_publish_service_kwargs,
    publish_scenario_build_in_locked_session,
    resolve_tno_checkpoint_dir,
)
from map_builder.scenario_locks import checkpoint_build_lock, scenario_build_lock
from map_builder.contracts import MANUAL_SYNC_POLICY_CHOICES, SCENARIO_PUBLISH_SCOPES


def _resolve_input_path(value: str, *, root: Path) -> Path:
    raw_path = Path(str(value or "").strip())
    if not raw_path.is_absolute():
        raw_path = root / raw_path
    return raw_path.resolve()


def _resolve_allowed_scenario_dir(value: str, *, root: Path) -> Path:
    return ensure_path_within_allowed_bases(
        _resolve_input_path(value, root=root),
        allowed_bases=(root / "data" / "scenarios",),
        label="scenario-dir",
        root=root,
        error_cls=ValueError,
    )


def _resolve_allowed_checkpoint_dir(value: str, *, root: Path) -> Path:
    return ensure_path_within_allowed_bases(
        _resolve_input_path(value, root=root),
        allowed_bases=(root / ".runtime",),
        label="checkpoint-dir",
        root=root,
        error_cls=ValueError,
    )


def run_publish_scenario_build(
    scenario_dir: Path,
    checkpoint_dir: Path,
    *,
    publish_scope: str,
    manual_sync_policy: str,
) -> dict[str, object]:
    if not scenario_dir.exists():
        raise FileNotFoundError(f"Missing scenario directory: {scenario_dir}")
    if not checkpoint_dir.exists():
        raise FileNotFoundError(f"Missing checkpoint directory: {checkpoint_dir}")
    with scenario_build_lock(
        root=ROOT, scenario_id=SCENARIO_ID, scenario_dir=scenario_dir, holder="patch_tno_1962_bundle",
    ):
        with checkpoint_build_lock(checkpoint_dir, stage="write_bundle"):
            return publish_scenario_build_in_locked_session(
                scenario_dir,
                checkpoint_dir,
                **build_tno_publish_service_kwargs(
                    publish_scope=publish_scope,
                    manual_sync_policy=manual_sync_policy,
                ),
            )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Publish a scenario bundle from existing checkpoint outputs.",
        allow_abbrev=False,
    )
    parser.add_argument("--scenario-dir", required=True)
    parser.add_argument("--checkpoint-dir", default="")
    parser.add_argument("--publish-scope", choices=SCENARIO_PUBLISH_SCOPES, required=True)
    parser.add_argument("--manual-sync-policy", choices=MANUAL_SYNC_POLICY_CHOICES, required=True)
    parser.add_argument("--root", default=str(ROOT))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    scenario_dir = _resolve_allowed_scenario_dir(args.scenario_dir, root=root)
    checkpoint_dir = (
        _resolve_allowed_checkpoint_dir(args.checkpoint_dir, root=root)
        if str(args.checkpoint_dir or "").strip()
        else ensure_path_within_allowed_bases(
            resolve_tno_checkpoint_dir(scenario_dir),
            allowed_bases=(root / ".runtime",),
            label="checkpoint-dir",
            root=root,
            error_cls=ValueError,
        )
    )
    result = run_publish_scenario_build(
        scenario_dir,
        checkpoint_dir,
        publish_scope=args.publish_scope,
        manual_sync_policy=args.manual_sync_policy,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
