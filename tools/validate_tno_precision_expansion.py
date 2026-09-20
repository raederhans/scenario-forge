import argparse, gzip, hashlib, json, sys
from pathlib import Path
import shapely
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from map_builder.regional_geometry import _absolute_topology, _decode_geometry

def read(p):
    return json.loads(p.read_text(encoding='utf-8'))

def fid(g):
    return g['properties']['id']

def meta(g):
    r = {k: v for k, v in g.items() if k not in {'type', 'arcs', 'coordinates', 'geometries'}}
    if 'geometries' in g:
        r['geometries'] = [meta(c) for c in g['geometries']]
    return r

def validate(baseline_dir, candidate_runtime, source_countries, candidate_dir=None):
    if candidate_dir:
        candidate_runtime_expected = candidate_dir / 'runtime_topology.topo.json'
        if not candidate_runtime_expected.exists():
            raise ValueError('candidate_dir provided but missing runtime_topology.topo.json')
        if candidate_runtime_expected.read_bytes() != candidate_runtime.read_bytes():
            raise ValueError('candidate_runtime bytes do not match candidate_dir/runtime_topology.topo.json')
        # Finalizing startup bundles/audit can leave an earlier compressed
        # sibling stale. HTTP clients prefer that sibling over the JSON file.
        for compressed in candidate_dir.rglob('*.json.gz'):
            source = Path(str(compressed)[:-3])
            if not source.exists() or gzip.decompress(compressed.read_bytes()) != source.read_bytes():
                raise ValueError(f'stale compressed stage artifact: {compressed.name}')

    old = _absolute_topology(read(baseline_dir / 'runtime_topology.topo.json'))
    new = _absolute_topology(read(candidate_runtime))
    og = old['objects']['political']['geometries']
    ng = new['objects']['political']['geometries']

    ids = [fid(g) for g in og]
    nids = [fid(g) for g in ng]

    if ids != nids or len(set(ids)) != len(ids):
        raise ValueError('IDs/order mismatch')
    if [meta(g) for g in og] != [meta(g) for g in ng]:
        raise ValueError('metadata mismatch')

    a = {fid(g): _decode_geometry(old, g) for g in og}
    b = {fid(g): _decode_geometry(new, g) for g in ng}

    target_countries = set(source_countries)
    targets = {fid(g) for g in og if g['properties'].get('cntr_code') in target_countries}

    for country in target_countries:
        c_targets = {fid(g) for g in og if g['properties'].get('cntr_code') == country}
        if not c_targets:
            raise ValueError(f'target country {country} has no features')

    untouched = [i for i in ids if i not in targets]

    if not all(a[i].equals_exact(b[i], 0) for i in untouched):
        raise ValueError('untouched geometry changed')

    if set(old['objects']) != set(new['objects']):
        raise ValueError('objects keys mismatch')

    aux = {}
    for name in old['objects']:
        if name == 'political': continue
        is_meta_same = meta(old['objects'][name]) == meta(new['objects'][name])
        is_geom_same = _decode_geometry(old, old['objects'][name]).equals_exact(_decode_geometry(new, new['objects'][name]), 0)
        aux[name] = is_meta_same and is_geom_same
    if len(aux) != 6 or not all(aux.values()):
        raise ValueError('auxiliary objects changed or not exactly 6')

    geoms = {i: b[i] for i in targets}
    for i, g in geoms.items():
        if not (g.geom_type in ['Polygon', 'MultiPolygon']):
            raise ValueError(f'target {i} is not a polygon')
        if not g.is_valid or g.is_empty:
            raise ValueError('invalid target polygon')

    percountry_coverage_baseline = {}
    percountry_coverage_candidate = {}
    for country in sorted(target_countries):
        c_targets = {fid(g) for g in og if g['properties'].get('cntr_code') == country}

        c_geoms_old = [a[i] for i in sorted(c_targets)]
        percountry_coverage_baseline[country] = bool(shapely.coverage_is_valid(c_geoms_old))

        c_geoms_new = [b[i] for i in sorted(c_targets)]
        percountry_coverage_candidate[country] = bool(shapely.coverage_is_valid(c_geoms_new))

    visual_metrics = []
    owners_file = baseline_dir / 'owners.by_feature.json'
    owners = read(owners_file)['owners'] if owners_file.exists() else {}
    for i in sorted(targets):
        sym_diff = a[i].symmetric_difference(b[i])
        orig_area = a[i].area
        ratio = sym_diff.area / orig_area if orig_area > 0 else 0.0
        coords_before = shapely.get_num_coordinates(a[i])
        coords_after = shapely.get_num_coordinates(b[i])

        if not sym_diff.is_empty:
            bnd = sym_diff.bounds
            visual_metrics.append({
                'feature_id': i,
                'owner': owners.get(i),
                'sym_diff_deg2': sym_diff.area,
                'area_ratio': ratio,
                'bbox': list(bnd),
                'coords_before': coords_before,
                'coords_after': coords_after
            })

    changed_chunks = []
    mixed = []

    if candidate_dir:
        for name in ['owners.by_feature.json', 'cores.by_feature.json', 'countries.json']:
            base_file = baseline_dir / name
            cand_file = candidate_dir / name
            if not base_file.exists() or not cand_file.exists():
                raise ValueError(f'missing required stage file {name}')
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
                    if c['lod'] == 'detail' and (i in targets or chunk_changed) and not shape(f['geometry']).equals(b[i]):
                        raise ValueError(f'detail geometry mismatch for {i}')
                    if i not in targets: continue
                    if i in lod[c['lod']]: raise ValueError('duplicate LOD ID')
                    lod[c['lod']][i] = shape(f['geometry'])

        # Owner chunks may be repartitioned by the current size budget. Identity
        # and geometry must remain complete regardless of chunk file names.
        if any(all_lod_ids[level] != set(ids) for level in all_lod_ids):
            raise ValueError('incomplete political IDs in LOD')
        # Check complete target coarse and detail IDs
        if set(lod['coarse'].keys()) != set(targets) or set(lod['detail'].keys()) != set(targets):
            raise ValueError('incomplete target IDs in LOD')

        for i in targets:
            if not lod['detail'][i].equals(b[i]):
                raise ValueError(f'detail chunk geometry for {i} does not match candidate runtime')

        newunion = shapely.union_all(list(geoms.values()))
        tags = sorted({owners[i] for i in targets if i in owners})

        baseline_excess = sum(g.area for g in geoms.values()) - newunion.area

        def check_lod_combo(combo_geoms):
            if not all(g.is_valid for g in combo_geoms):
                return False, 0, 0
            u = shapely.union_all(combo_geoms)
            diff = u.symmetric_difference(newunion)

            multiplicity_excess = sum(g.area for g in combo_geoms) - u.area
            excess_increase = multiplicity_excess - baseline_excess

            ok = diff.area < 1e-10 and excess_increase <= 1e-10
            return ok, diff.area, excess_increase

        for single_tag in tags:
            # owner coarse/detail union same -> per-owner equivalence
            owner_targets = [i for i in targets if owners.get(i) == single_tag]
            owner_coarse_union = shapely.union_all([lod['coarse'][i] for i in owner_targets])
            owner_detail_union = shapely.union_all([lod['detail'][i] for i in owner_targets])
            owner_cand_union = shapely.union_all([b[i] for i in owner_targets])
            if not (owner_coarse_union.equals(owner_cand_union) and owner_detail_union.equals(owner_cand_union)):
                raise ValueError(f'owner union mismatch for {single_tag}')

            gs_1 = [lod['detail' if owners.get(i) == single_tag else 'coarse'][i] for i in sorted(targets)]
            ok1, diff1, exc1 = check_lod_combo(gs_1)
            mixed.append({'detail_owners': [single_tag], 'ok': ok1, 'diff_area': diff1, 'excess_increase': exc1})
            if not ok1: raise ValueError(f"mixed LOD failure for single detail {single_tag}")

            gs_2 = [lod['coarse' if owners.get(i) == single_tag else 'detail'][i] for i in sorted(targets)]
            ok2, diff2, exc2 = check_lod_combo(gs_2)
            mixed.append({'coarse_owners': [single_tag], 'ok': ok2, 'diff_area': diff2, 'excess_increase': exc2})
            if not ok2: raise ValueError(f"mixed LOD failure for single coarse {single_tag}")

        gs_all_coarse = [lod['coarse'][i] for i in sorted(targets)]
        ok_all_c, diff_all_c, exc_all_c = check_lod_combo(gs_all_coarse)
        mixed.append({'detail_owners': [], 'ok': ok_all_c, 'diff_area': diff_all_c, 'excess_increase': exc_all_c})
        if not ok_all_c: raise ValueError('mixed LOD failure for all coarse')

        gs_all_detail = [lod['detail'][i] for i in sorted(targets)]
        ok_all_d, diff_all_d, exc_all_d = check_lod_combo(gs_all_detail)
        mixed.append({'coarse_owners': [], 'ok': ok_all_d, 'diff_area': diff_all_d, 'excess_increase': exc_all_d})
        if not ok_all_d: raise ValueError('mixed LOD failure for all detail')

    total_coords_old = sum(shapely.get_num_coordinates(a[i]) for i in targets)
    total_coords_new = sum(shapely.get_num_coordinates(b[i]) for i in targets)

    # Aggregated symmetric diff
    owner_agg_sym_diff = {}
    for single_tag in {owners[i] for i in targets if i in owners}:
        old_owner_union = shapely.union_all([a[i] for i in targets if owners.get(i) == single_tag])
        new_owner_union = shapely.union_all([b[i] for i in targets if owners.get(i) == single_tag])

        o_sym = old_owner_union.symmetric_difference(new_owner_union)
        o_orig = old_owner_union
        summed_perfeature = sum(a[i].symmetric_difference(b[i]).area for i in targets if owners.get(i) == single_tag)

        if not o_sym.is_empty:
            owner_agg_sym_diff[single_tag] = {
                'area': o_sym.area,
                'ratio': o_sym.area / o_orig.area if o_orig.area > 0 else 0.0,
                'bbox': list(o_sym.bounds),
                'summed_perfeature_area': summed_perfeature
            }

    sizes = {
        'baseline_raw': len((baseline_dir / 'runtime_topology.topo.json').read_bytes()) if (baseline_dir / 'runtime_topology.topo.json').exists() else None,
        'candidate_raw': len(candidate_runtime.read_bytes()) if candidate_runtime.exists() else None,
        'baseline_gz': len((baseline_dir / 'runtime_topology.topo.json.gz').read_bytes()) if (baseline_dir / 'runtime_topology.topo.json.gz').exists() else None,
        'candidate_gz': Path(str(candidate_runtime) + '.gz').stat().st_size if Path(str(candidate_runtime) + '.gz').exists() else None,
    }

    report = {
        'status': 'invariants_pass_visual_review_required' if visual_metrics else 'PASS',
        'visual_accepted': False,
        'target_count': len(targets),
        'total_coords_old': total_coords_old,
        'total_coords_new': total_coords_new,
        'sizes': sizes,
        'percountry_coverage_baseline': percountry_coverage_baseline,
        'percountry_coverage_candidate': percountry_coverage_candidate,
        'visual_metrics': visual_metrics,
        'owner_aggregated_sym_diff': owner_agg_sym_diff,
    }
    if candidate_dir:
        report['changed_chunks'] = changed_chunks
        report['mixed_lod'] = mixed

    return report

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--baseline-dir', type=Path, required=True)
    p.add_argument('--candidate-runtime', type=Path, required=True)
    p.add_argument('--source-countries', type=str, nargs='+', required=True)
    p.add_argument('--output', type=Path, required=False)
    p.add_argument('--candidate-dir', type=Path, required=False, default=None)
    args = p.parse_args()

    try:
        r = validate(args.baseline_dir, args.candidate_runtime, args.source_countries, args.candidate_dir)
    except Exception as e:
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps({'status': 'FAIL', 'error': str(e)}, indent=2))
        print(f"FAIL: {e}")
        sys.exit(1)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(r, indent=2, default=int) + '\n')

    print(json.dumps({k: r[k] for k in ['status', 'target_count', 'percountry_coverage_baseline', 'percountry_coverage_candidate'] if k in r}, default=int))
