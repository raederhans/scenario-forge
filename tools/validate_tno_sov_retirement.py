"""Check reviewed SOV reassignment, protected geometry and complete local assets."""
from pathlib import Path
import argparse
import gzip
import hashlib
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.prepare_tno_russia_precision import read
from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from map_builder.io.writers import write_json_atomic
from tools.patch_tno_1962_bundle import retire_sov_helper_properties, stable_json_hash


def validate(baseline, candidate, rules):
    before = read(baseline / 'owners.by_feature.json')['owners']
    after = read(candidate / 'owners.by_feature.json')['owners']
    rule_payload = read(rules)
    mapping = {fid: rule['tag'] for rule in rule_payload['country_rules'] for fid in rule['include_feature_ids']}
    expected = {i: mapping[i] if tag == 'SOV' else tag for i,tag in before.items()}
    if after != expected or 'SOV' in after.values(): raise ValueError('Unexpected ownership change')
    if read(candidate/'manifest.json').get('baseline_hash') != stable_json_hash(after):
        raise ValueError('Stale owner baseline cache identity')
    old_core = read(baseline / 'cores.by_feature.json')['cores']
    new_core = read(candidate / 'cores.by_feature.json')['cores']
    expected_core = {i: ([tag for tag in tags if tag != 'SOV'] or [after[i]]) for i,tags in old_core.items()}
    if new_core != expected_core: raise ValueError('Unexpected core change')
    countries = read(candidate / 'countries.json')['countries']
    if 'SOV' in countries: raise ValueError('SOV still registered')
    for tag, row in read(baseline / 'countries.json')['countries'].items():
        if tag == 'SOV': continue
        if {k:v for k,v in row.items() if k not in {'feature_count','controller_feature_count'}} != {
            k:v for k,v in countries[tag].items() if k not in {'feature_count','controller_feature_count'}}:
            raise ValueError(f'Unrelated country metadata changed: {tag}')
        if countries[tag]['feature_count'] != sum(t == tag for t in after.values()):
            raise ValueError(f'Country count mismatch: {tag}')
    old, new = [_absolute_topology(read(d / 'runtime_topology.topo.json')) for d in (baseline,candidate)]
    if set(old['objects']) != set(new['objects']): raise ValueError('Runtime object set changed')
    for key in old['objects']:
        if not _decode_geometry(old,old['objects'][key]).equals_exact(_decode_geometry(new,new['objects'][key]),0):
            raise ValueError(f'Geometry changed: {key}')
    op = [f['properties'] for f in old['objects']['political']['geometries']]
    np = [f['properties'] for f in new['objects']['political']['geometries']]
    for properties in op:
        retire_sov_helper_properties(properties, rule_payload)
    if op != np: raise ValueError('Runtime IDs/properties changed')
    for name,key in [('scenario_manual_overrides.json','assignments'),('scenario_mutations.json','assignments_by_feature_id')]:
        expected_payload = read(baseline/name)
        for fid, a in expected_payload.get(key,{}).items():
            if 'SOV' in a.get('cores',[]): a['cores']=[t for t in a['cores'] if t!='SOV'] or [after[fid]]
        if read(candidate/name) != expected_payload: raise ValueError(f'Unexpected authoring changes: {name}')
    for compressed in candidate.rglob('*.json.gz'):
        if gzip.decompress(compressed.read_bytes()) != Path(str(compressed)[:-3]).read_bytes():
            raise ValueError(f'Gzip mismatch: {compressed.name}')
    chunks = read(candidate/'detail_chunks.manifest.json')['chunks']
    detail = {}
    for c in chunks:
        prefix='data/scenarios/tno_1962/'
        if not c['url'].startswith(prefix): raise ValueError('Chunk URL escaped scenario')
        p=(candidate/c['url'][len(prefix):]).resolve()
        if not p.is_relative_to(candidate.resolve()): raise ValueError('Chunk path escaped scenario')
        raw=p.read_bytes()
        if len(raw)!=c['byte_size'] or hashlib.sha256(raw).hexdigest()!=c['sha256']: raise ValueError('Chunk hash mismatch')
        if c['layer']=='political' and c['lod']=='detail':
            if 'SOV' in c['country_codes']: raise ValueError('SOV chunk remains')
            for f in read(p)['features']:
                fid=f['properties']['id']
                if fid in detail: raise ValueError('Duplicate detail ID')
                detail[fid]=c['country_codes']
    for fid, tag in after.items():
        if fid in detail and detail[fid] != [tag]: raise ValueError(f'Detail owner mismatch: {fid}')
    if set(detail) != {p['id'] for p in op}: raise ValueError('Incomplete detail coverage')
    if list((candidate/'chunks').glob('*country.sov*')): raise ValueError('Orphan SOV chunk remains')
    return {'status':'PASS','changed_owner_count':sum(before[i]!=after[i] for i in before),
            'changed_core_count':sum(old_core[i]!=new_core[i] for i in old_core),
            'geometry_unchanged':True,'political_detail_ids':len(detail),'chunk_count':len(chunks)}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('baseline-dir','candidate-dir','report'):
        p.add_argument('--'+key,type=Path,required=True)
    a=p.parse_args()
    if a.report.exists() or any(a.report.resolve().is_relative_to(ROOT/k) for k in ('data','dist')):
        raise ValueError('Use a new nonproduction report')
    result=validate(a.baseline_dir,a.candidate_dir,ROOT/'data/scenario-rules/tno_1962.sov_residuals.manual.json')
    write_json_atomic(a.report,result,indent=2)
    print(result)
