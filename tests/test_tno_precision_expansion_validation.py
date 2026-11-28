import json
import pytest
import hashlib
import gzip
from pathlib import Path
from tempfile import TemporaryDirectory
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.validate_tno_precision_expansion import validate
from tools.scenario_chunk_format import feature_collection_to_topology

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

def create_valid_env(d, mixed_overlap=False):
    base = Path(d) / 'base'
    cand = Path(d) / 'cand'
    base.mkdir()
    cand.mkdir()
    topo = create_mock_topojson()
    second_id, second_code, x = ('GB2', 'GB', 1) if mixed_overlap else ('FR1', 'FR', 2)
    topo['objects']['political']['geometries'][1]['properties'].update(id=second_id, cntr_code=second_code)
    topo['arcs'][1][0][0] = x
    owners = {'owners': {'GB1': 'GB', second_id: second_code}}
    (base / 'manifest.json').write_text(json.dumps({'scenario_id': 'test'}))
    for folder in (base, cand):
        (folder / 'runtime_topology.topo.json').write_text(json.dumps(topo))
        (folder / 'owners.by_feature.json').write_text(json.dumps(owners))
        for name in ('cores.by_feature.json', 'countries.json'):
            (folder / name).write_bytes(b'{}')
        chunks = []
        for chunk_id, lod in [('c1', 'coarse'), ('c2', 'detail')]:
            overlap = 0.5 if mixed_overlap and lod == 'coarse' else 0
            features = []
            for fid, left, right in [('GB1', 0, 1 + overlap), (second_id, x - overlap, x + 1)]:
                ring = [[left, 0], [left, 1], [right, 1], [right, 0], [left, 0]]
                features.append({'properties': {'id': fid}, 'geometry': {'type': 'Polygon', 'coordinates': [ring]}})
            raw = json.dumps({'features': features}).encode()
            filename = f'{chunk_id}.json'
            (folder / filename).write_bytes(raw)
            (folder / (filename + '.gz')).write_bytes(gzip.compress(raw))
            chunks.append({'id': chunk_id, 'layer': 'political', 'lod': lod, 'url': f'data/scenarios/test/{filename}',
                           'byte_size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        (folder / 'detail_chunks.manifest.json').write_text(json.dumps({'chunks': chunks}))

    return base, cand


def test_validation_decodes_topojson_political_coarse_chunk():
    runtime_tmp = Path(__file__).resolve().parents[1] / '.runtime' / 'tmp'
    runtime_tmp.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=runtime_tmp) as d:
        base, cand = create_valid_env(d)
        manifest_path = cand / 'detail_chunks.manifest.json'
        manifest = json.loads(manifest_path.read_text())
        coarse_entry = manifest['chunks'][0]
        coarse_path = cand / 'c1.json'
        collection = json.loads(coarse_path.read_text())
        collection['type'] = 'FeatureCollection'
        for feature in collection['features']:
            feature['type'] = 'Feature'
        raw = json.dumps(feature_collection_to_topology(collection)).encode()
        coarse_path.write_bytes(raw)
        (cand / 'c1.json.gz').write_bytes(gzip.compress(raw))
        coarse_entry['byte_size'] = len(raw)
        coarse_entry['sha256'] = hashlib.sha256(raw).hexdigest()
        coarse_entry['data_format'] = 'topojson'
        manifest_path.write_text(json.dumps(manifest))

        result = validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)
        assert result['status'] == 'PASS'


def test_missing_target_country():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        with pytest.raises(ValueError, match='target country LU has no features'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB', 'LU'], cand)


def test_foreign_geom_change():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d)
        topo2 = create_mock_topojson()
        topo2['arcs'][1] = [[2, 0], [0, 2], [1, 0], [0, -2], [-1, 0]]
        (cand / 'runtime_topology.topo.json').write_text(json.dumps(topo2))
        with pytest.raises(ValueError, match='untouched geometry changed'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)


def test_adversarial_overlap_mixed_lod():
    with TemporaryDirectory() as d:
        base, cand = create_valid_env(d, mixed_overlap=True)
        with pytest.raises(ValueError, match='mixed LOD failure'):
            validate(base, cand / 'runtime_topology.topo.json', ['GB'], cand)
