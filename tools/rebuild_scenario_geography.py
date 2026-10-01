"""Materialize the reviewed Guiana, Somalia, Kashmir and Canadian seam repairs.

Only the caller running this command owns canonical data writes. Use
--geometry-only before reviewing geometry and --materialize-only to resume the
existing scenario builders. Reports live under .runtime, never source data.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tools.rebuild_polar_assets import read, write, refresh_base_manifest
from tools.repair_scenario_geography import repair_topology, SOMALIA_IDS, GUIANA_ID

SCENARIOS = ('blank_base', 'hoi4_1936', 'hoi4_1939', 'modern_world', 'tno_1962')
REPORT_ROOT = ROOT / '.runtime/reports/generated/scenario-geography-repair'


def materialize():
    from tools.materialize_polar_scenarios import refresh_scenario
    refresh_base_manifest()
    for sid in SCENARIOS:
        report = read(REPORT_ROOT / f'{sid}.json')
        print(f'[geography] {sid}: materializing', flush=True)
        refresh_scenario(ROOT / 'data/scenarios' / sid, report['assignments'],
                         removed_ids=report['removed_ids'])
        print(f'[geography] {sid}: materialized', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--geometry-only', action='store_true')
    mode.add_argument('--materialize-only', action='store_true')
    args = parser.parse_args()
    if args.materialize_only:
        materialize()
        return
    from tools.scenario_chunk_assets import normalize_canada_topology
    donor_path = ROOT / 'data/europe_topology.runtime_political_v1.json'
    donor = read(donor_path)
    targets = [('runtime', donor_path)] + [
        (sid, ROOT / 'data/scenarios' / sid / 'runtime_topology.topo.json')
        for sid in SCENARIOS]
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    for sid, path in targets:
        print(f'[geography] {sid}: geometry', flush=True)
        before = read(path)
        restore = sid in {'tno_1962', 'blank_base'}
        candidate, report = repair_topology(
            before, donor, restore_ids=SOMALIA_IDS if restore else (),
            add_ids=[GUIANA_ID] if restore else (), ownerless=sid == 'blank_base')
        candidate = normalize_canada_topology(candidate)
        # GUY in the recorded TNO source (states310/687, workshop3583339918)
        # is the existing GY identity in this scenario, not modern France.
        report['assignments'] = ({GUIANA_ID: dict(owner='GY', controller='GY', cores=['GY'])}
                                 if sid == 'tno_1962' else {})
        write(path, candidate)
        write(REPORT_ROOT / f'{sid}.json', report)
        print(f'[geography] {sid}: {json.dumps(report, sort_keys=True)}', flush=True)
    if not args.geometry_only:
        materialize()


if __name__ == '__main__':
    main()
