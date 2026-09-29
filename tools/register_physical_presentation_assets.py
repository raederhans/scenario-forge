"""Register already-built physical detail/presentation assets without rebuilding scenarios."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
ASSETS = [
    ('physical_semantics_detail', 'global_physical_semantics.detail.topo.json', 'physical_semantics', 'Alps 2019 land-cover detail; overview elsewhere', [4, 20]),
    ('physical_hillshade', 'physical_hillshade.alps.topo.json', 'physical_hillshade', 'Alps ETOPO 2022 DEM illumination pilot, opt-in', [4, 20]),
    ('physical_region_labels', 'physical_region_labels.geojson', None, 'Natural Earth bilingual physical reference labels', [2, 20]),
]


def register():
    manifest_path = ROOT / 'data/manifest.json'
    registry_path = ROOT / 'data/runtime_asset_registry.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    registry = json.loads(registry_path.read_text(encoding='utf-8'))
    overview = ROOT / 'data/global_physical_semantics.topo.json'
    overview_spec = manifest['outputs'][overview.name]
    overview_spec.update(size_bytes=overview.stat().st_size, sha256=hashlib.sha256(overview.read_bytes()).hexdigest())
    for key, filename, object_name, description, zoom in ASSETS:
        path = ROOT / 'data' / filename
        payload = json.loads(path.read_text(encoding='utf-8'))
        spec = {
            'role': key, 'artifact_class': 'publish', 'owner': 'tools.build_physical_presentation' if key != 'physical_semantics_detail' else 'tools.build_physical_detail',
            'description': description, 'size_bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'schema_ref': 'schema://topojson/topology/v1' if object_name else 'schema://geojson/feature_collection/point/v1',
            'target_zoom_range': zoom, 'type': 'topology' if object_name else 'geojson',
        }
        if object_name:
            spec.update(object_names=[object_name], arc_count=len(payload['arcs']), arc_point_count=sum(len(a) for a in payload['arcs']))
        else:
            spec['feature_count'] = len(payload['features'])
        manifest['outputs'][filename] = spec
        registry['assets'][f'context_layer:{key}'] = {'url': f'data/{filename}', 'role': 'context_layer', 'family_id': key, 'description': description}
    for path, payload in [(manifest_path, manifest), (registry_path, registry)]:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    register()
