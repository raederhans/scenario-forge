import json
from pathlib import Path
import pytest
import gzip
import hashlib
import sys
from shapely.geometry import Polygon, mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.validate_tno_russia_precision import validate

def create_mock_topo(features, aux_objects=None, political_precision_feature_ids=None):
    geometries = []
    arcs = []
    political_geometries = []
    arc_idx = 0
    for fid, geom, props in features:
        coords = list(geom.exterior.coords)
        arcs.append(coords)
        political_geometries.append({
            'type': 'Polygon',
            'arcs': [[arc_idx]],
            'properties': {'id': fid, **props}
        })
        arc_idx += 1

    topo = {
        'type': 'Topology',
        'objects': {
            'political': {
                'type': 'GeometryCollection',
                'geometries': political_geometries
            }
        },
        'arcs': arcs
    }
    if aux_objects:
        for k, v in aux_objects.items():
            topo['objects'][k] = v

    if political_precision_feature_ids is not None:
        topo['political_precision_feature_ids'] = political_precision_feature_ids

    return topo

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

    return baseline, cand, base_topo, features, aux

def test_validation_pass(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ['RU_RAY_1', 'RU_RAY_2'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    res = validate(baseline, cand_runtime)
    assert res['status'] == 'PASS'
    assert res['target_count'] == 1

def test_removed_declaration(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ['RU_RAY_2'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    with pytest.raises(ValueError, match="old declarations not preserved"):
        validate(baseline, cand_runtime)

def test_bogus_id(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ['RU_RAY_1', 'BOGUS_1'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    with pytest.raises(ValueError, match="non-RU_RAY IDs in selection|targets do not exist in both runtimes"):
        validate(baseline, cand_runtime)

def test_overlap_with_unchanged_union(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
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

def test_malformed_gzip(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ['RU_RAY_1', 'RU_RAY_2'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    cand_stage = cand / 'stage'
    cand_stage.mkdir()
    (cand_stage / 'runtime_topology.topo.json').write_text(json.dumps(cand_topo))
    (cand_stage / 'runtime_topology.topo.json.gz').write_bytes(b'badgzip')

    with pytest.raises(gzip.BadGzipFile):
        validate(baseline, cand_runtime, cand_stage)

def test_detail_metadata_corruption(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ['RU_RAY_1', 'RU_RAY_2'])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))

    cand_stage = cand / 'stage'
    cand_stage.mkdir()
    (cand_stage / 'runtime_topology.topo.json').write_text(json.dumps(cand_topo))
    raw_topo = json.dumps(cand_topo).encode('utf-8')
    (cand_stage / 'runtime_topology.topo.json.gz').write_bytes(gzip.compress(raw_topo))

    for name in ['controllers.by_feature.json', 'cores.by_feature.json', 'countries.json', 'scenario_manual_overrides.json', 'scenario_mutations.json']:
        (baseline / name).write_text("{}")
        (cand_stage / name).write_text("{}")

    (baseline / 'owners.by_feature.json').write_text(json.dumps({'owners': {'RU_RAY_1': 'owner1', 'RU_RAY_2': 'owner2'}}))
    (cand_stage / 'owners.by_feature.json').write_text(json.dumps({'owners': {'RU_RAY_1': 'owner1', 'RU_RAY_2': 'owner2'}}))

    # write a valid chunk with corrupted metadata
    # We need a chunk with ID 'RU_RAY_2'
    chunk_id = 'chunk_1'
    manifest = {
        'scenario_id': 'tno',
        'chunks': [
            {
                'id': chunk_id,
                'layer': 'political',
                'lod': 'detail',
                'url': 'data/scenarios/tno/chunk_1.geojson',
                'byte_size': 0,
                'sha256': ''
            }
        ]
    }

    # baseline manifest and chunks
    (baseline / 'manifest.json').write_text(json.dumps({'scenario_id': 'tno'}))

    # Create actual chunk data. The geometries in our feature list are Polygons.
    # In chunk features, coordinates are standard GeoJSON.
    f2_geom = mapping(features[1][1])
    chunk_data = {
        'type': 'FeatureCollection',
        'features': [
            {
                'type': 'Feature',
                'properties': {'id': 'RU_RAY_2', 'cntr_code': 'WRONG'}, # corrupted metadata
                'geometry': f2_geom
            }
        ]
    }
    chunk_bytes = json.dumps(chunk_data).encode('utf-8')
    manifest['chunks'][0]['byte_size'] = len(chunk_bytes)
    manifest['chunks'][0]['sha256'] = hashlib.sha256(chunk_bytes).hexdigest()

    (baseline / 'detail_chunks.manifest.json').write_text(json.dumps(manifest))
    (cand_stage / 'detail_chunks.manifest.json').write_text(json.dumps(manifest))

    chunk_path = cand_stage / 'chunk_1.geojson'
    chunk_path.write_bytes(chunk_bytes)
    (cand_stage / 'chunk_1.geojson.gz').write_bytes(gzip.compress(chunk_bytes))

    baseline_chunk = baseline / 'chunk_1.geojson'
    baseline_chunk.write_bytes(chunk_bytes)

    with pytest.raises(ValueError, match="detail metadata mismatch for RU_RAY_2"):
        validate(baseline, cand_runtime, cand_stage)

def test_malformed_declarations_null(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, None)
    cand_topo['political_precision_feature_ids'] = None
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))
    with pytest.raises(ValueError, match="invalid political_precision_feature_ids format"):
        validate(baseline, cand_runtime)

def test_malformed_declarations_string(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, "RU_RAY_1")
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))
    with pytest.raises(ValueError, match="invalid political_precision_feature_ids format"):
        validate(baseline, cand_runtime)

def test_malformed_declarations_blank(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ["RU_RAY_1", ""])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))
    with pytest.raises(ValueError, match="invalid political_precision_feature_ids format"):
        validate(baseline, cand_runtime)

def test_malformed_declarations_padded(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ["RU_RAY_1 ", "RU_RAY_2"])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))
    with pytest.raises(ValueError, match="invalid political_precision_feature_ids format"):
        validate(baseline, cand_runtime)

def test_malformed_declarations_duplicate(base_scenario):
    baseline, cand, base_topo, features, aux = base_scenario
    cand_topo = create_mock_topo(features, aux, ["RU_RAY_1", "RU_RAY_1"])
    cand_runtime = cand / 'runtime_topology.topo.json'
    cand_runtime.write_text(json.dumps(cand_topo))
    with pytest.raises(ValueError, match="duplicate political_precision_feature_ids"):
        validate(baseline, cand_runtime)


def complete_stage(base_scenario, inherited_invalid=False, change_invalid=False):
    baseline, cand, _, features, aux = base_scenario
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
            if inherited_invalid and level == 'coarse':
                extent = 11 if directory == cand and change_invalid else 10
                fs[0]['geometry'] = mapping(Polygon([(0, 0), (extent, 10), (0, 10), (10, 0), (0, 0)]))
            raw = json.dumps({'type': 'FeatureCollection', 'features': fs}).encode()
            name = f'{level}.json'
            (directory / name).write_bytes(raw)
            (directory / (name + '.gz')).write_bytes(gzip.compress(raw))
            manifests[directory].append({'id': level, 'layer': 'political', 'lod': level,
                'url': f'data/scenarios/tno/{name}', 'byte_size': len(raw),
                'sha256': hashlib.sha256(raw).hexdigest()})
        (directory / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': manifests[directory]}))
    return baseline, runtime, cand


def test_complete_stage_passes(base_scenario):
    result = validate(*complete_stage(base_scenario))
    assert result['status'] == 'PASS'
    assert result['nonselected_coarse_seam_limitations'] == []


def test_inherited_invalid_coarse_is_reported_only_when_unchanged(base_scenario):
    result = validate(*complete_stage(base_scenario, inherited_invalid=True))
    limitations = result['nonselected_coarse_seam_limitations']
    assert len(limitations) == 1
    assert limitations[0]['id'] == 'RU_RAY_1'
    assert 'inherited invalid geometry' in limitations[0]['reason']


def test_changed_invalid_coarse_rejected(base_scenario):
    with pytest.raises(ValueError, match='new or changed invalid nonselected coarse geometry'):
        validate(*complete_stage(base_scenario, inherited_invalid=True, change_invalid=True))


@pytest.mark.parametrize('bad', [None, 'RU_RAY_1', [''], ['RU_RAY_1 '], ['RU_RAY_1', 'RU_RAY_1']])
def test_malformed_baseline_declaration_rejected(base_scenario, bad):
    baseline, cand, topo, features, aux = base_scenario
    topo['political_precision_feature_ids'] = bad
    (baseline / 'runtime_topology.topo.json').write_text(json.dumps(topo))
    runtime = cand / 'runtime_topology.topo.json'
    runtime.write_text(json.dumps(create_mock_topo(features, aux, ['RU_RAY_1', 'RU_RAY_2'])))
    with pytest.raises(ValueError, match='political_precision_feature_ids'):
        validate(baseline, runtime)
