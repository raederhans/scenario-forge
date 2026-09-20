import json
import pytest
import shutil
import hashlib
import gzip
from pathlib import Path
from tempfile import TemporaryDirectory
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.validate_tno_precision_expansion import validate

def create_mock_topojson():
    return {
        'type': 'Topology',
        'objects': {
            'political': {
                'type': 'GeometryCollection',
                'geometries': [
                    {'id': 0, 'properties': {'id': 'GB1', 'cntr_code': 'GB'}, 'type': 'Polygon', 'arcs': [[0]]},
                    {'id': 1, 'properties': {'id': 'FR1', 'cntr_code': 'FR'}, 'type': 'Polygon', 'arcs': [[1]]}
                ]
            },
            'aux1': {
                'type': 'GeometryCollection', 'geometries': [{'id': 2, 'properties': {'id': 'A'}, 'type': 'Polygon', 'arcs': [[0]]}]
            },
            'aux2': {'type': 'GeometryCollection', 'geometries': []},
            'aux3': {'type': 'GeometryCollection', 'geometries': []},
            'aux4': {'type': 'GeometryCollection', 'geometries': []},
            'aux5': {'type': 'GeometryCollection', 'geometries': []},
            'aux6': {'type': 'GeometryCollection', 'geometries': []},
        },
        'arcs': [
            [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]],
            [[2, 0], [0, 1], [1, 0], [0, -1], [-1, 0]]
        ],
        'transform': {'scale': [1, 1], 'translate': [0, 0]}
    }

def create_valid_env(d):
    base = Path(d) / 'base'
    cand = Path(d) / 'cand'
    base.mkdir()
    cand.mkdir()
    topo = create_mock_topojson()
    (base / 'runtime_topology.topo.json').write_text(json.dumps(topo))
    (cand / 'runtime_topology.topo.json').write_text(json.dumps(topo))
    (base / 'owners.by_feature.json').write_text(json.dumps({'owners': {'GB1': 'GB'}}))
    (cand / 'owners.by_feature.json').write_text(json.dumps({'owners': {'GB1': 'GB'}}))
    (base / 'cores.by_feature.json').write_bytes(b'{}')
    (cand / 'cores.by_feature.json').write_bytes(b'{}')
    (base / 'countries.json').write_bytes(b'{}')
    (cand / 'countries.json').write_bytes(b'{}')

    (base / 'manifest.json').write_text(json.dumps({'scenario_id': 'test'}))

    chunk1 = {'id': 'c1', 'url': 'data/scenarios/test/c1.json', 'byte_size': 0, 'sha256': '', 'layer': 'political', 'lod': 'coarse'}
    chunk2 = {'id': 'c2', 'url': 'data/scenarios/test/c2.json', 'byte_size': 0, 'sha256': '', 'layer': 'political', 'lod': 'detail'}
    c1_content = json.dumps({'features': [{'properties': {'id': 'GB1'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}, {'properties': {'id': 'FR1'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[2,0],[2,1],[3,1],[3,0],[2,0]]]}}]}).encode()

    chunk1['byte_size'] = len(c1_content)
    chunk1['sha256'] = hashlib.sha256(c1_content).hexdigest()
    chunk2['byte_size'] = len(c1_content)
    chunk2['sha256'] = hashlib.sha256(c1_content).hexdigest()

    (cand / 'c1.json').write_bytes(c1_content)
    (cand / 'c2.json').write_bytes(c1_content)
    (base / 'c1.json').write_bytes(c1_content)
    (base / 'c2.json').write_bytes(c1_content)

    (cand / 'c1.json.gz').write_bytes(gzip.compress(c1_content))
    (cand / 'c2.json.gz').write_bytes(gzip.compress(c1_content))
    (base / 'c1.json.gz').write_bytes(gzip.compress(c1_content))
    (base / 'c2.json.gz').write_bytes(gzip.compress(c1_content))

    (base / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': [chunk1, chunk2]}))
    (cand / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': [chunk1, chunk2]}))

    return base, cand

def test_validation_success():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        result = validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)
        assert result['status'] == 'PASS'
        assert result['target_count'] == 1
        assert result['percountry_coverage_candidate']['GB'] is True

def test_missing_stage_file():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        (cand / 'owners.by_feature.json').unlink()
        with pytest.raises(ValueError, match='missing required stage file'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)

def test_escaped_chunk_path():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        chunks = json.loads((cand / 'detail_chunks.manifest.json').read_text())
        chunks['chunks'][0]['url'] = 'data/scenarios/test/../escaped.json'
        (cand / 'detail_chunks.manifest.json').write_text(json.dumps(chunks))
        with pytest.raises(ValueError, match='chunk path escaped candidate_dir'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)

def test_missing_target_country():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        with pytest.raises(ValueError, match='target country LU has no features'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB', 'LU'], cand)

def test_lod_omissions():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        # c2 has LOD detail. Remove feature GB1 from it.
        c2_bad = json.dumps({'features': []}).encode()
        chunks = json.loads((cand / 'detail_chunks.manifest.json').read_text())
        chunks['chunks'][1]['byte_size'] = len(c2_bad)
        chunks['chunks'][1]['sha256'] = hashlib.sha256(c2_bad).hexdigest()
        (cand / 'detail_chunks.manifest.json').write_text(json.dumps(chunks))
        (cand / 'c2.json').write_bytes(c2_bad)
        (cand / 'c2.json.gz').write_bytes(gzip.compress(c2_bad))

        with pytest.raises(ValueError, match='incomplete political IDs in LOD'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)

def test_foreign_geom_change():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        topo2 = create_mock_topojson()
        topo2['arcs'][1] = [[2, 0], [0, 2], [1, 0], [0, -2], [-1, 0]]
        (cand / 'runtime_topology.topo.json').write_text(json.dumps(topo2))
        with pytest.raises(ValueError, match='untouched geometry changed'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)

def test_owner_drift_mixed_lod_failure():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        # Create a tiny drift in candidate owner coarse chunk
        coarse = json.loads((cand / 'c1.json').read_text())
        coarse['features'][0]['geometry']['coordinates'][0][1][1] = 1.0001
        c1_bad = json.dumps(coarse).encode()
        chunks = json.loads((cand / 'detail_chunks.manifest.json').read_text())
        chunks['chunks'][0]['byte_size'] = len(c1_bad)
        chunks['chunks'][0]['sha256'] = hashlib.sha256(c1_bad).hexdigest()
        (cand / 'detail_chunks.manifest.json').write_text(json.dumps(chunks))
        (cand / 'c1.json').write_bytes(c1_bad)
        (cand / 'c1.json.gz').write_bytes(gzip.compress(c1_bad))
        with pytest.raises(ValueError, match='owner union mismatch for GB'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)


def test_adversarial_overlap_mixed_lod():
    with TemporaryDirectory() as d:
        base = Path(d) / 'base'
        cand = Path(d) / 'cand'
        base.mkdir()
        cand.mkdir()

        topo = {
            'type': 'Topology',
            'objects': {
                'political': {
                    'type': 'GeometryCollection',
                    'geometries': [
                        {'id': 0, 'properties': {'id': 'GB1', 'cntr_code': 'GB'}, 'type': 'Polygon', 'arcs': [[0]]},
                        {'id': 1, 'properties': {'id': 'GB2', 'cntr_code': 'GB'}, 'type': 'Polygon', 'arcs': [[1]]}
                    ]
                },
                'aux1': {'type': 'GeometryCollection', 'geometries': [{'id': 2, 'properties': {'id': 'A'}, 'type': 'Polygon', 'arcs': [[0]]}]},
                'aux2': {'type': 'GeometryCollection', 'geometries': []},
                'aux3': {'type': 'GeometryCollection', 'geometries': []},
                'aux4': {'type': 'GeometryCollection', 'geometries': []},
                'aux5': {'type': 'GeometryCollection', 'geometries': []},
                'aux6': {'type': 'GeometryCollection', 'geometries': []},
            },
            'arcs': [
                [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]],
                [[1, 0], [0, 1], [1, 0], [0, -1], [-1, 0]]
            ],
            'transform': {'scale': [1, 1], 'translate': [0, 0]}
        }

        (base / 'runtime_topology.topo.json').write_text(json.dumps(topo))
        (cand / 'runtime_topology.topo.json').write_text(json.dumps(topo))
        (base / 'owners.by_feature.json').write_text(json.dumps({'owners': {'GB1': 'GB', 'GB2': 'GB'}}))
        (cand / 'owners.by_feature.json').write_text(json.dumps({'owners': {'GB1': 'GB', 'GB2': 'GB'}}))
        (base / 'cores.by_feature.json').write_bytes(b'{}')
        (cand / 'cores.by_feature.json').write_bytes(b'{}')
        (base / 'countries.json').write_bytes(b'{}')
        (cand / 'countries.json').write_bytes(b'{}')

        (base / 'manifest.json').write_text(json.dumps({'scenario_id': 'test'}))

        chunk1 = {'id': 'c1', 'url': 'data/scenarios/test/c1.json', 'byte_size': 0, 'sha256': '', 'layer': 'political', 'lod': 'coarse'}
        chunk2 = {'id': 'c2', 'url': 'data/scenarios/test/c2.json', 'byte_size': 0, 'sha256': '', 'layer': 'political', 'lod': 'detail'}

        c2_content = json.dumps({'features': [
            {'properties': {'id': 'GB1'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0,0],[0,1],[1,1],[1,0],[0,0]]]}},
            {'properties': {'id': 'GB2'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[1,0],[1,1],[2,1],[2,0],[1,0]]]}}
        ]}).encode()

        c1_content = json.dumps({'features': [
            {'properties': {'id': 'GB1'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0,0],[0,1],[1.5,1],[1.5,0],[0,0]]]}},
            {'properties': {'id': 'GB2'}, 'geometry': {'type': 'Polygon', 'coordinates': [[[0.5,0],[0.5,1],[2,1],[2,0],[0.5,0]]]}}
        ]}).encode()

        chunk1['byte_size'] = len(c1_content)
        chunk1['sha256'] = hashlib.sha256(c1_content).hexdigest()
        chunk2['byte_size'] = len(c2_content)
        chunk2['sha256'] = hashlib.sha256(c2_content).hexdigest()

        (cand / 'c1.json').write_bytes(c1_content)
        (cand / 'c2.json').write_bytes(c2_content)
        (base / 'c1.json').write_bytes(c1_content)
        (base / 'c2.json').write_bytes(c2_content)

        (cand / 'c1.json.gz').write_bytes(gzip.compress(c1_content))
        (cand / 'c2.json.gz').write_bytes(gzip.compress(c2_content))
        (base / 'c1.json.gz').write_bytes(gzip.compress(c1_content))
        (base / 'c2.json.gz').write_bytes(gzip.compress(c2_content))

        (base / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': [chunk1, chunk2]}))
        (cand / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': [chunk1, chunk2]}))

        with pytest.raises(ValueError, match='mixed LOD failure'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)


def test_detail_repartition_preserves_all_identities(tmp_path):
    base, cand = create_valid_env(tmp_path)
    manifest = json.loads((cand / 'detail_chunks.manifest.json').read_text())
    old = manifest['chunks'].pop()
    features = json.loads((cand / 'c2.json').read_text())['features']
    for index, feature in enumerate(features):
        raw = json.dumps({'features': [feature]}).encode()
        name = f'detail.part.{index}.json'
        (cand / name).write_bytes(raw)
        (cand / (name + '.gz')).write_bytes(gzip.compress(raw))
        manifest['chunks'].append({**old, 'id': f'detail.part.{index}',
            'url': f'data/scenarios/test/{name}', 'byte_size': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest()})
    (cand / 'detail_chunks.manifest.json').write_text(json.dumps(manifest))
    assert validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)['target_count'] == 1
    # A valid hash must not make an omitted foreign feature acceptable.
    manifest['chunks'].pop()
    (cand / 'detail_chunks.manifest.json').write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='incomplete political IDs'):
        validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)


def test_stale_compressed_startup_rejected(tmp_path):
    base, cand = create_valid_env(tmp_path)
    (cand / 'startup.bundle.en.json').write_bytes(b'{"generation":2}')
    (cand / 'startup.bundle.en.json.gz').write_bytes(gzip.compress(b'{"generation":1}'))
    with pytest.raises(ValueError, match='stale compressed stage artifact'):
        validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)
