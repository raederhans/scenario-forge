"""Prepare same-ID NE seam repairs; rebuild derived assets separately before use."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from shapely.geometry import box
from map_builder.geo.source_coverage_repair import repair_source_coverage
from map_builder.regional_geometry import _absolute_topology, _decode_geometry, replace_regional_geometry
from map_builder.io.writers import write_json_atomic


def prepare(scenario_dir, source_path, feature_prefix, output):
    scenario_dir, output = Path(scenario_dir).resolve(), Path(output).resolve()
    if output.is_relative_to(scenario_dir):
        raise ValueError("Prepare into a separate candidate path")
    manifest = json.loads((scenario_dir / 'manifest.json').read_text(encoding='utf-8'))
    runtime = scenario_dir / Path(manifest['runtime_topology_url']).name
    original = json.loads(runtime.read_text(encoding='utf-8'))
    absolute = _absolute_topology(original)
    rows = absolute['objects']['political']['geometries']
    selected = {str(g['properties']['id']): g for g in rows if str(g['properties']['id']).startswith(feature_prefix)}
    baseline = {fid: _decode_geometry(absolute, g) for fid, g in selected.items()}
    source_frame = gpd.read_file(source_path).to_crs(4326)
    source_frame = source_frame[source_frame.adm1_code.isin(selected)]
    sources = dict(zip(source_frame.adm1_code, source_frame.geometry))
    if len(source_frame) != len(sources):
        raise ValueError('Duplicate source IDs')
    extent = box(*shapely.union_all(list(baseline.values())).bounds)
    protected = []
    for name in ('political', 'scenario_water', 'scenario_atlantropa'):
        obj = absolute['objects'].get(name, {})
        for g in obj.get('geometries', []):
            if name == 'political' and str(g.get('properties', {}).get('id')) in selected:
                continue
            geom = _decode_geometry(absolute, g)
            if geom is not None and geom.intersects(extent):
                protected.append(geom)
    repaired, report = repair_source_coverage(baseline, sources, protected=shapely.union_all(protected))
    frame = gpd.GeoDataFrame([{'id': fid, 'geometry': g} for fid, g in repaired.items()], crs=4326)
    candidate, diagnostic = replace_regional_geometry(original, frame)
    # The display builder already has a shared-coverage path for these IDs.
    candidate['political_precision_feature_ids'] = sorted(set(candidate.get('political_precision_feature_ids', [])) | set(selected))
    write_json_atomic(output, candidate, indent=None, separators=(',', ':'), allow_nan=False)
    write_json_atomic(output.with_suffix('.report.json'), {**report, **diagnostic, 'source_path': str(source_path),
                      'feature_prefix': feature_prefix}, indent=2, allow_nan=False)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario-dir', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--feature-prefix', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.scenario_dir, args.source, args.feature_prefix, args.output), indent=2))
