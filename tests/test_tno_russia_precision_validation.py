import json
from pathlib import Path
import pytest
import gzip
import hashlib
import sys
from shapely.geometry import Polygon, mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.validate_tno_russia_precision import validate

def create_mock_topo(features, aux, precision_ids):
    rows = [{'type': 'Polygon', 'arcs': [[i]], 'properties': {'id': fid, **props}}
            for i, (fid, _, props) in enumerate(features)]
    return {'type': 'Topology', 'arcs': [list(geom.exterior.coords) for _, geom, _ in features],
            'objects': {**aux, 'political': {'type': 'GeometryCollection', 'geometries': rows}},
            'political_precision_feature_ids': precision_ids}


@pytest.fixture
def base_scenario(tmp_path):
    baseline = tmp_path / 'baseline'
    baseline.mkdir()
    cand = tmp_path / 'cand'
    cand.mkdir()

    p1 = Polygon([(0, 0), (0, 10), (10, 10), (10, 0), (0, 0)])
    p2 = Polygon([(10, 0), (10, 10), (20, 10), (20, 0), (10, 0)])

    features = [
        ('RU_RAY_1', p1, {'cntr_code': 'RU'}),
        ('RU_RAY_2', p2, {'cntr_code': 'RU'})
    ]

    aux = {
        'scenario_water': {'type': 'GeometryCollection', 'geometries': []}
    }

    base_topo = create_mock_topo(features, aux, ['RU_RAY_1'])
    (baseline / 'runtime_topology.topo.json').write_text(json.dumps(base_topo))
    (baseline / 'owners.by_feature.json').write_text(json.dumps({'owners': {'RU_RAY_1': 'owner1', 'RU_RAY_2': 'owner2'}}))

    return baseline, cand, features, aux


def test_bogus_id(base_scenario):
    baseline, cand, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ['RU_RAY_1', 'BOGUS_1'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    with pytest.raises(ValueError, match="non-RU_RAY IDs in selection|targets do not exist in both runtimes"):
        validate(baseline, cand_runtime)

def test_overlap_with_unchanged_union(base_scenario):
    baseline, cand, features, aux = base_scenario
    p1 = Polygon([(0, 0), (0, 10), (12, 10), (12, 0), (0, 0)])
    p2 = Polygon([(12, 0), (12, 10), (20, 10), (20, 0), (12, 0)])

    features_drift = [
        ('RU_RAY_1', p1, {'cntr_code': 'RU'}),
        ('RU_RAY_2', p2, {'cntr_code': 'RU'})
    ]
    cand_topo = create_mock_topo(features_drift, aux, ['RU_RAY_1', 'RU_RAY_2'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    with pytest.raises(ValueError, match='untouched geometry changed|owner union mismatch for owner1'):
        validate(baseline, cand_runtime)


def test_detail_metadata_corruption(base_scenario):
    baseline, runtime, stage = complete_stage(base_scenario, corrupt_detail=True)
    with pytest.raises(ValueError, match="detail metadata mismatch for RU_RAY_2"):
        validate(baseline, runtime, stage)


def complete_stage(base_scenario, corrupt_detail=False):
    baseline, cand, features, aux = base_scenario
    topo = create_mock_topo(features, aux, ['RU_RAY_1', 'RU_RAY_2'])
    runtime = cand / 'runtime_topology.topo.json'
    runtime.write_text(json.dumps(topo))
    (cand / 'owners.by_feature.json').write_bytes((baseline / 'owners.by_feature.json').read_bytes())
    (baseline / 'manifest.json').write_text(json.dumps({'scenario_id': 'tno'}))
    manifests = {baseline: [], cand: []}
    for directory in manifests:
        for level in ('coarse', 'detail'):
            fs = [{'type': 'Feature', 'properties': {'id': i, **props}, 'geometry': mapping(geom)}
                  for i, geom, props in features]
            if corrupt_detail and directory == cand and level == 'detail':
                fs[1]['properties']['cntr_code'] = 'WRONG'
            raw = json.dumps({'type': 'FeatureCollection', 'features': fs}).encode()
            name = f'{level}.json'
            (directory / name).write_bytes(raw)
            (directory / (name + '.gz')).write_bytes(gzip.compress(raw))
            manifests[directory].append({'id': level, 'layer': 'political', 'lod': level,
                'url': f'data/scenarios/tno/{name}', 'byte_size': len(raw),
                'sha256': hashlib.sha256(raw).hexdigest()})
        (directory / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': manifests[directory]}))
    return baseline, runtime, cand


def test_complete_stage_accepts_gzip_only_runtime_topology(base_scenario):
    baseline, runtime, candidate_dir = complete_stage(base_scenario)
    raw = runtime.read_bytes()
    runtime.unlink()
    runtime.with_name(runtime.name + '.gz').write_bytes(gzip.compress(raw))

    result = validate(baseline, runtime, candidate_dir)

    assert result['status'] == 'PASS'
