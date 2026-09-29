"""Write an Arctic recovery candidate, never overwrite a source topology."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from map_builder.processors.arctic_recovery import recover_arctic


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--topology', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--land-topology')
    parser.add_argument('--scenario-dir')
    args = parser.parse_args()
    output = Path(args.output)
    if output.resolve() in {Path(p).resolve() for p in [args.topology, args.source, args.land_topology] if p}:
        parser.error('Output must be a new candidate path')
    owners = controllers = None
    if args.scenario_dir:
        directory = Path(args.scenario_dir)
        owners = read(directory / 'owners.by_feature.json')['owners']
        controller_path = directory / 'controllers.by_feature.json'
        controllers = read(controller_path)['controllers'] if controller_path.exists() else owners
    candidate, report = recover_arctic(read(args.topology), read(args.source),
        land_topology=read(args.land_topology) if args.land_topology else None,
        owners=owners, controllers=controllers)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(candidate, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report_path = output.with_suffix(output.suffix + '.report.json')
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
