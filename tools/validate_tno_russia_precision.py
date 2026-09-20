import argparse, gzip, hashlib, json, sys
from pathlib import Path
import shapely
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.regional_geometry import _absolute_topology, _decode_geometry

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def fid(g):
    return g['properties']['id']

def meta(g):
    r = {k: v for k, v in g.items() if k not in {'type', 'arcs', 'coordinates', 'geometries', 'geometry'}}
    if 'geometries' in g:
        r['geometries'] = [meta(c) for c in g['geometries']]
    return r

def boundary_equal(left, right):
    residual = left.symmetric_difference(right)
    return residual.is_empty or (residual.area <= 1e-10 and left.boundary.buffer(1e-9).covers(residual))


def lod_coordinates_identical(runtime, lods):
    """Prove every mixed selection retains exactly the same nodes and edges.

    Surface equality alone is insufficient: removing a collinear vertex on one
    side can break mixed-LOD noding. Normalize ring order, then compare every
    coordinate with zero tolerance. Coverage is checked separately by validate.
    """
    canonical = {i: shapely.normalize(g) for i, g in runtime.items()}
    return all(set(lod) == set(runtime) and all(
        shapely.normalize(g).equals_exact(canonical[i], 0) for i, g in lod.items()
    ) for lod in lods.values())

def validate(baseline_dir, candidate_runtime, candidate_dir=None):
    if candidate_dir:
        candidate_runtime_expected = candidate_dir / 'runtime_topology.topo.json'
        if not candidate_runtime_expected.exists():
            raise ValueError('candidate_dir provided but missing runtime_topology.topo.json')
        if candidate_runtime_expected.read_bytes() != candidate_runtime.read_bytes():
            raise ValueError('candidate_runtime bytes do not match candidate_dir/runtime_topology.topo.json')
        for compressed in candidate_dir.rglob('*.json.gz'):
            source = Path(str(compressed)[:-3])
            if not source.exists() or gzip.decompress(compressed.read_bytes()) != source.read_bytes():
                raise ValueError(f'stale compressed stage artifact: {compressed.name}')

    old_raw = read(baseline_dir / 'runtime_topology.topo.json')
    new_raw = read(candidate_runtime)

    prev_ids_list = old_raw.get('political_precision_feature_ids', [])
    curr_ids_list = new_raw.get('political_precision_feature_ids', [])
    for declaration in (prev_ids_list, curr_ids_list):
        if not isinstance(declaration, list) or any(
            not isinstance(i, str) or not i or i != i.strip() for i in declaration
        ):
            raise ValueError("invalid political_precision_feature_ids format")
        if len(set(declaration)) != len(declaration):
            raise ValueError("duplicate political_precision_feature_ids")
    if not curr_ids_list:
        raise ValueError("political_precision_feature_ids missing or empty")

    prev_ids = set(prev_ids_list)
    curr_ids = set(curr_ids_list)
    if not prev_ids.issubset(curr_ids):
        raise ValueError("old declarations not preserved")

    targets = curr_ids - prev_ids
    if not targets:
        targets = {i for i in curr_ids if i.startswith('RU_RAY_')}
    if not targets:
        raise ValueError("empty targets")
    if not all(i.startswith('RU_RAY_') for i in targets):
        raise ValueError("non-RU_RAY IDs in selection")
    old = _absolute_topology(old_raw)
    new = _absolute_topology(new_raw)
    og = old['objects']['political']['geometries']
    ng = new['objects']['political']['geometries']

    ids = [fid(g) for g in og]
    nids = [fid(g) for g in ng]

    if not targets.issubset(set(ids)) or not targets.issubset(set(nids)):
        raise ValueError("targets do not exist in both runtimes")

    if ids != nids or len(set(ids)) != len(ids):
        raise ValueError('IDs/order mismatch')
    if [meta(g) for g in og] != [meta(g) for g in ng]:
        raise ValueError('metadata mismatch')

    a = {fid(g): _decode_geometry(old, g) for g in og}
    b = {fid(g): _decode_geometry(new, g) for g in ng}

    untouched = [i for i in ids if i not in targets]
    if not all(a[i].equals_exact(b[i], 0) for i in untouched):
        raise ValueError('untouched geometry changed')

    for name in old['objects']:
        if name == 'political': continue
        is_meta_same = meta(old['objects'][name]) == meta(new['objects'][name])
        is_geom_same = _decode_geometry(old, old['objects'][name]).equals_exact(_decode_geometry(new, new['objects'][name]), 0)
        if not (is_meta_same and is_geom_same):
            raise ValueError(f'auxiliary object {name} changed')
    if set(old['objects']) != set(new['objects']):
        raise ValueError('objects keys mismatch')

    geoms = []
    for i in targets:
        g = b[i]
        if not isinstance(g, (shapely.Polygon, shapely.MultiPolygon)):
            raise ValueError(f"Target {i} is not a polygon")
        if g.is_empty or not g.is_valid:
            raise ValueError(f"Target {i} is empty or invalid")
        geoms.append(g)

    coverage_verification = {}
    if not coverage_is_valid_exact(geoms, coverage_verification):
        raise ValueError('invalid selected coverage')

    owners_file = baseline_dir / 'owners.by_feature.json'
    if not owners_file.exists():
        raise ValueError('missing owners file')
    owners = read(owners_file)['owners']

    missing_owner = [i for i in targets if i not in owners or not owners[i]]
    if missing_owner:
        raise ValueError('missing owner for selected IDs')

    owner_groups = {}
    for i in targets:
        owner_groups.setdefault(owners[i], []).append(i)

    for owner, o_ids in owner_groups.items():
        o_old_union = shapely.union_all([a[i] for i in o_ids])
        o_new_union = shapely.union_all([b[i] for i in o_ids])
        if not boundary_equal(o_old_union, o_new_union):
            raise ValueError(f'owner union mismatch for {owner}')

    coords_before = sum(shapely.get_num_coordinates(a[i]) for i in targets)
    coords_after = sum(shapely.get_num_coordinates(b[i]) for i in targets)
    owner_counts = {owner: len(o_ids) for owner, o_ids in owner_groups.items()}
    source_label_anomalies = [i for i in targets if meta(ng[ids.index(i)])['properties'].get('cntr_code') != 'RU']

    report = {
        'status': 'PASS',
        'target_count': len(targets),
        'owner_counts': owner_counts,
        'source_label_anomalies': source_label_anomalies,
        'coords_before': coords_before,
        'coords_after': coords_after,
        'coverage_verification': coverage_verification,
    }

    changed_chunks = []
    mixed = []
    nonselected_coarse_seam_limitations = []

    if candidate_dir:
        for name in ['owners.by_feature.json', 'controllers.by_feature.json', 'cores.by_feature.json', 'countries.json', 'scenario_manual_overrides.json', 'scenario_mutations.json', 'cities.json', 'shells.json']:
            base_file = baseline_dir / name
            cand_file = candidate_dir / name
            if base_file.exists():
                if not cand_file.exists():
                    if name not in ['shells.json', 'cities.json']:
                        raise ValueError(f'missing required stage file {name}')
                else:
                    if base_file.read_bytes() != cand_file.read_bytes():
                        raise ValueError(f'{name} changed')

        chunks_file = candidate_dir / 'detail_chunks.manifest.json'
        old_chunks_file = baseline_dir / 'detail_chunks.manifest.json'
        if not chunks_file.exists() or not old_chunks_file.exists():
            raise ValueError('missing chunks manifest')

        chunks = read(chunks_file)['chunks']
        oldchunks = read(old_chunks_file)['chunks']
        if len({c['id'] for c in chunks}) != len(chunks):
            raise ValueError('duplicate chunk IDs')
        old_context = {c['id']: c for c in oldchunks if c['layer'] != 'political'}
        new_context = {c['id']: c for c in chunks if c['layer'] != 'political'}
        if old_context != new_context:
            raise ValueError('non-political chunk manifest changed')

        sid = read(baseline_dir / 'manifest.json')['scenario_id']
        prefix = f'data/scenarios/{sid}/'
        lod = {'coarse': {}, 'detail': {}}
        all_lod_ids = {'coarse': set(), 'detail': set()}

        for c in chunks:
            old_coarse_features = None
            if not c['url'].startswith(prefix):
                raise ValueError(f"URL {c['url']} bad prefix")
            rel = c['url'][len(prefix):]
            p = (candidate_dir / rel).resolve()
            if not p.is_relative_to(candidate_dir.resolve()):
                raise ValueError(f"chunk path escaped candidate_dir: {p}")
            if not p.exists():
                raise ValueError(f"chunk missing: {p}")

            raw = p.read_bytes()
            if len(raw) != c['byte_size'] or hashlib.sha256(raw).hexdigest() != c['sha256']:
                raise ValueError(f"Chunk {c['id']} hash mismatch")

            gz = Path(str(p)+'.gz')
            if not gz.exists() or gzip.decompress(gz.read_bytes()) != raw:
                raise ValueError(f"Chunk {c['id']} gzip mismatch")

            baseline_chunk = baseline_dir / rel
            chunk_changed = not baseline_chunk.exists() or raw != baseline_chunk.read_bytes()
            if chunk_changed:
                changed_chunks.append(c['id'])

            if c['layer'] == 'political' and c['lod'] in lod:
                for f in json.loads(raw)['features']:
                    i = fid(f)
                    if i in all_lod_ids[c['lod']] or i not in b:
                        raise ValueError('duplicate or unknown political LOD ID')
                    all_lod_ids[c['lod']].add(i)
                    if c['lod'] == 'detail':
                        if not shape(f['geometry']).equals(b[i]):
                            raise ValueError(f'detail geometry mismatch for {i}')
                        if meta(f) != meta(ng[nids.index(i)]):
                            raise ValueError(f'detail metadata mismatch for {i}')
                    if i not in targets:
                        if c['lod'] == 'coarse':
                            cg = shape(f['geometry'])
                            if not cg.is_valid or not b[i].is_valid:
                                if old_coarse_features is None:
                                    old_coarse_features = {
                                        fid(feature): feature for feature in read(baseline_chunk)['features']
                                    }
                                previous = old_coarse_features.get(i)
                                if previous is None or previous['geometry'] != f['geometry']:
                                    raise ValueError(f'new or changed invalid nonselected coarse geometry: {i}')
                                nonselected_coarse_seam_limitations.append({
                                    'id': i, 'reason': 'inherited invalid geometry; baseline coarse coordinates unchanged',
                                    'coarse_validity': shapely.is_valid_reason(cg),
                                    'runtime_validity': shapely.is_valid_reason(b[i]),
                                })
                                continue
                            if not cg.equals(b[i]):
                                diff = cg.symmetric_difference(b[i])
                                if diff.area > 1e-10:
                                    nonselected_coarse_seam_limitations.append({'id': i, 'diff_area': diff.area})
                        continue
                    if i in lod[c['lod']]: raise ValueError('duplicate LOD ID')
                    lod[c['lod']][i] = shape(f['geometry'])

        if any(all_lod_ids[level] != set(ids) for level in all_lod_ids):
            raise ValueError('incomplete political IDs in LOD')
        if set(lod['coarse'].keys()) != set(targets) or set(lod['detail'].keys()) != set(targets):
            raise ValueError('incomplete target IDs in LOD')

        gs_all_coarse = [lod['coarse'][i] for i in sorted(targets)]
        if not coverage_is_valid_exact(gs_all_coarse):
            raise ValueError("All coarse coverage invalid")
        gs_all_detail = [lod['detail'][i] for i in sorted(targets)]
        if not coverage_is_valid_exact(gs_all_detail):
            raise ValueError("All detail coverage invalid")

        u_all_coarse = shapely.union_all(gs_all_coarse)
        u_all_detail = shapely.union_all(gs_all_detail)
        u_cand = shapely.union_all([b[i] for i in sorted(targets)])

        if not boundary_equal(u_all_coarse, u_cand):
            raise ValueError("All coarse union mismatch")
        if not boundary_equal(u_all_detail, u_cand):
            raise ValueError("All detail union mismatch")

        coordinate_identity = lod_coordinates_identical({i: b[i] for i in targets}, lod)
        report['mixed_lod_coordinate_identity_proof'] = coordinate_identity
        owner_polygons_cand = ({} if coordinate_identity else {
            owner: shapely.union_all([b[i] for i in o_ids]) for owner, o_ids in owner_groups.items()})
        owners_list = list(owner_groups.keys())
        for i in range(len(owners_list)):
            for j in range(i+1, len(owners_list)):
                o1, o2 = owners_list[i], owners_list[j]
                if coordinate_identity:
                    # Any coarse/detail mixture is the exact already-validated
                    # runtime coverage. Include even nonadjacent owner pairs.
                    for l1 in ['coarse', 'detail']:
                        for l2 in ['coarse', 'detail']:
                            mixed.append({'owners': [o1, o2], 'states': [l1, l2],
                                          'ok': True, 'diff_area': 0,
                                          'proof': 'exact coordinate identity with valid runtime coverage'})
                    continue
                if owner_polygons_cand[o1].distance(owner_polygons_cand[o2]) < 1e-6:
                    pair_cand = shapely.union_all([owner_polygons_cand[o1], owner_polygons_cand[o2]])
                    for l1 in ['coarse', 'detail']:
                        for l2 in ['coarse', 'detail']:
                            gs = [lod[l1][fid] for fid in owner_groups[o1]] + [lod[l2][fid] for fid in owner_groups[o2]]
                            if not coverage_is_valid_exact(gs):
                                raise ValueError(f"mixed LOD coverage invalid for {o1}({l1}) + {o2}({l2})")
                            u = shapely.union_all(gs)
                            ok = boundary_equal(u, pair_cand)
                            mixed.append({
                                'owners': [o1, o2],
                                'states': [l1, l2],
                                'ok': ok,
                                'diff_area': u.symmetric_difference(pair_cand).area
                            })
                            if not ok:
                                raise ValueError(f"mixed LOD union failure for {o1}({l1}) and {o2}({l2})")

        report['changed_chunks'] = changed_chunks
        report['mixed_lod'] = mixed
        report['nonselected_coarse_seam_limitations'] = nonselected_coarse_seam_limitations

    return report

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--baseline-dir', type=Path, required=True)
    p.add_argument('--candidate-runtime', type=Path, required=True)
    p.add_argument('--candidate-dir', type=Path, required=False, default=None)
    p.add_argument('--report', type=Path, required=True)
    args = p.parse_args()

    root = Path(__file__).resolve().parents[1]
    args.report = args.report.resolve()
    if args.report.exists() or any(args.report.is_relative_to(root / name) for name in ('data', 'dist')):
        print("FAIL: report must be outside data/dist")
        sys.exit(1)

    try:
        r = validate(args.baseline_dir, args.candidate_runtime, args.candidate_dir)
    except Exception as e:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps({'status': 'FAIL', 'error': str(e)}, indent=2))
        print(f"FAIL: {e}")
        sys.exit(1)

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(r, indent=2, default=int) + '\n')
    print(json.dumps({k: r[k] for k in ['status', 'target_count'] if k in r}, default=int))
