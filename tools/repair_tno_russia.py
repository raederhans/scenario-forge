from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shapely.geometry import mapping

from map_builder.regional_geometry import _absolute_topology, _decode_geometry
from tools.apply_tno_split_overlay import rebuild_districts
from tools.check_scenario_contracts import write_json
from tools.materialize_polar_scenarios import refresh_scenario, synchronize_scenario_snapshot
from tools.rebuild_polar_assets import read, write
from tools.repair_tno_shell_hints import repair_shells, remove_unreferenced_chunks, migration_map

SCENARIO_DIR = ROOT / 'data/scenarios/tno_1962'
COLORS = {'URL': '#b4b3da', 'AMR': '#ba9e9e', 'FAV': '#b86378',
          'OUR': '#8d87bd', 'FIC': '#987b68', 'URA': '#8f405f',
          'NRL': '#9aa5b1', 'OMO': '#c0b3a1'}
USER_REASSIGNMENTS = {'BY_INT_GOMEL': {'from': 'RKO', 'to': 'RKO'},
 'BY_INT_BREST': {'from': 'RKU', 'to': 'RKO'},
 'RU_MRG_56d7f2c40815': {'from': 'RKO', 'to': 'RKM'},
 'RU_MRG_e85ce6b2cbb5': {'from': 'RKO', 'to': 'RKM'},
 'RU_MRG_baef030e052d': {'from': 'RKO', 'to': 'RKM'},
 'RU_RAY_50074027B40310096212326': {'from': 'RKO', 'to': 'RKM'},
 'RU_RAY_50074027B24884281398381': {'from': 'RKO', 'to': 'RKM'},
 'RU_MRG_9630c25ee3c6': {'from': 'RKO', 'to': 'RKM'},
 'RU_MRG_6f87652d4746': {'from': 'RKO', 'to': 'RKM'},
 'RU_RAY_50074027B72539224473791': {'from': 'VOL', 'to': 'KOM'},
 'RU_MRG_3bf1b1438247': {'from': 'VOL', 'to': 'KOM'},
 'RU_MRG_48dc139f3c1a': {'from': 'VOL', 'to': 'WRS'},
 'RU_RAY_50074027B62324973885793': {'from': 'VOL', 'to': 'WRS'},
 'RU_RAY_50074027B44706978372394': {'from': 'VOL', 'to': 'WRS'},
 'RU_RAY_50074027B45493241507504': {'from': 'ONG', 'to': 'WRS'},
 'RU_MRG_72b0f3ba03bc': {'from': 'TAT', 'to': 'VYT'},
 'RU_MRG_da0982e025af': {'from': 'TAT', 'to': 'VYT'},
 'RU_RAY_50074027B83221615215133': {'from': 'PRM', 'to': 'VOK'},
 'RU_RAY_50074027B56678877765671': {'from': 'WRS', 'to': 'VOK'},
 'RU_RAY_50074027B96103137717036': {'from': 'WRS', 'to': 'WRS'},
 'RU_RAY_50074027B52153292155727': {'from': 'WRS', 'to': 'WRS'},
 'RU_RAY_50074027B94648571764089': {'from': 'WRS', 'to': 'VOK'},
 'RU_RAY_50074027B13808999174668': {'from': 'WRS', 'to': 'WRS'},
 'RU_MRG_f3d2b13e0b30': {'from': 'BKR', 'to': 'PRM'},
 'RU_MRG_ab652814dff4': {'from': 'RKM', 'to': 'TAT'},
 'RU_MRG_dfe6c1e5f415': {'from': 'RKM', 'to': 'GOR'},
 'RU_MRG_7f673bbbcb21': {'from': 'RKM', 'to': 'GOR'},
 'RU_RAY_50074027B44365109797977': {'from': 'RKM', 'to': 'GOR'},
 'RU_RAY_50074027B23799547406598': {'from': 'TOM', 'to': 'FAV'},
 'RU_MRG_d7ef4389d36f': {'from': 'TYM', 'to': 'SVR'},
 'RU_RAY_50074027B32599021943629': {'from': 'TYM', 'to': 'SVR'},
 'RU_RAY_50074027B34454529298169': {'from': 'RFA', 'to': 'OMO'},
 'RU_MRG_565e6f7cc145': {'from': 'RKM', 'to': 'VOL'},
 'RU_MRG_975a1a106b2a': {'from': 'RKM', 'to': 'VOL'},
 'RU_MRG_46291296feb9': {'from': 'RKM', 'to': 'VOL'},
 'RU_RAY_50074027B60606739466906': {'from': 'ONG', 'to': 'RKM'},
 'RU_RAY_50074027B62612106128387': {'from': 'RKM', 'to': 'RKM'},
 'RU_RAY_50074027B82590027772677': {'from': 'VOK', 'to': 'WRS'},
 'MNG-3320': {'from': 'MEN', 'to': 'MON'},
 'MNG-3318': {'from': 'MEN', 'to': 'MON'},
 'MNG-3322': {'from': 'MEN', 'to': 'MON'},
 'MNG-3321': {'from': 'MEN', 'to': 'MON'},
 'MNG-3316': {'from': 'MEN', 'to': 'MON'},
 'MNG-3329': {'from': 'MEN', 'to': 'MON'},
 'MNG-3327': {'from': 'MEN', 'to': 'MON'},
 'MNG-3323': {'from': 'MEN', 'to': 'MON'},
 'MNG-3326': {'from': 'MEN', 'to': 'MON'},
 'MNG-3328': {'from': 'MEN', 'to': 'MON'},
 'MNG-3324': {'from': 'MEN', 'to': 'MON'},
 'RU_RAY_50074027B8579713719118': {'from': 'BRY', 'to': 'CHT'},
 'RU_MRG_f38bf2291525': {'from': 'BRY', 'to': 'CHT'},
 'RU_RAY_50074027B90244452662579': {'from': 'FIC', 'to': 'AMR'},
 'RU_RAY_50074027B88724749460683': {'from': 'MAN', 'to': 'AMR'},
 'RU_MRG_eb6edd92ee8d': {'from': 'MAN', 'to': 'AMR'}}
CITY_REASSIGNMENTS = {
    'RU_RAY_50074027B23262720042196': {'from': 'RFA', 'to': 'FAV'},
    'RU_RAY_50074027B63935727212307': {'from': 'RFA', 'to': 'NRL'},
}


def corrected_assignments(owners, cores):
    rules = {**CITY_REASSIGNMENTS, **USER_REASSIGNMENTS}
    assignments = {}
    for fid, rule in rules.items():
        old, new = rule['from'], rule['to']
        if old == new:
            continue
        replacement = [new] if cores[fid] == [old] else cores[fid]
        if owners[fid] != new or cores[fid] != replacement:
            assignments[fid] = {'parent_id': fid, 'owner': new, 'controller': new, 'cores': replacement}
    return assignments


def run_scenario(scenario_dir=SCENARIO_DIR):
    owners = read(scenario_dir / 'owners.by_feature.json')['owners']
    cores = read(scenario_dir / 'cores.by_feature.json')['cores']
    assignments = corrected_assignments(owners, cores)
    paths = [scenario_dir / name for name in (
        'countries.json', 'scenario_manual_overrides.json', 'scenario_mutations.json')]
    documents = [read(path) for path in paths]
    countries = documents[0]['countries']
    before = Counter(owners.values())
    result_owners = {**owners, **{fid: row['owner'] for fid, row in assignments.items()}}
    result_cores = {**cores, **{fid: row['cores'] for fid, row in assignments.items()}}
    after = Counter(result_owners.values())
    manifest_path = scenario_dir / 'manifest.json'
    manifest = read(manifest_path)
    protected = {core for values in result_cores.values() for core in values}
    protected.update(country.get('parent_owner_tag') for country in countries.values())
    protected.add(manifest['default_country'])
    retired = {tag for tag in countries if before[tag] and not after[tag] and tag not in protected}
    if retired:
        manifest['featured_tags'] = [tag for tag in manifest['featured_tags'] if tag not in retired]
        write_json(manifest_path, manifest)
    changed = bool(retired)
    for index, document in enumerate(documents):
        for tag in retired:
            document['countries'].pop(tag, None)
        for tag, color in COLORS.items():
            if tag not in countries:
                continue
            entry = document['countries'].setdefault(tag, {'mode': 'override'} if index == 2 else {})
            changed |= entry.get('color_hex') != color or entry.get('color_policy') != 'locked'
            entry.update(color_hex=color, color_policy='locked')
    mutations = documents[2]
    for tag in retired | {'VOR'}:
        changed |= tag in mutations['capitals']
        mutations['capitals'].pop(tag, None)
    if changed:
        for path, document in zip(paths, documents):
            write_json(path, document)
    for name in ('city_overrides.json', 'capital_defaults.partial.json'):
        path = scenario_dir / name
        document = read(path)
        removed = False
        for key in ('capitals_by_tag', 'capital_city_hints'):
            for tag in retired:
                removed |= tag in document[key]
                document[key].pop(tag, None)
        if removed:
            write_json(path, document)
            changed = True
    identities = migration_map(read(ROOT / 'data/scenario-rules/tno_1962.identity_map.json'))
    identities.update({row['from']: row['to'] for row in USER_REASSIGNMENTS.values() if row['from'] in retired})
    topology_path = scenario_dir / 'runtime_topology.topo.json'
    topology, shells = repair_shells(read(topology_path), result_owners, countries, identities)
    if shells['changed']:
        write(topology_path, topology)
    water_path = scenario_dir / 'water_regions.geojson'
    water = read(water_path)
    absolute = _absolute_topology(topology)
    water_rows = {row['properties']['id']: row for row in absolute['objects']['scenario_water']['geometries']}
    water_changed = 0
    for feature in water['features']:
        geometry = json.loads(json.dumps(mapping(_decode_geometry(absolute, water_rows[feature['properties']['id']]))))
        if feature['geometry'] != geometry:
            feature['geometry'] = geometry
            water_changed += 1
    if water_changed:
        write(water_path, water)
    if changed or assignments or shells['changed'] or water_changed:
        refresh_scenario(scenario_dir, assignments, removed_ids=shells['removed_ids'])
        rebuild_districts(scenario_dir)
        synchronize_scenario_snapshot(scenario_dir)
    shells['deleted_chunks'] = remove_unreferenced_chunks(scenario_dir)
    report = {'changed': len(assignments) + int(changed) + shells['changed'] + int(water_changed),
              'changed_assignments': len(assignments), 'assignments': assignments,
              'retired_tags': sorted(retired), 'shells': shells, 'water_changed': water_changed,
              'colors': {tag: countries[tag]['color_hex'] for tag in COLORS if tag in countries},
              'rfa_features': sorted(fid for fid, tag in result_owners.items() if tag == 'RFA')}
    if report['changed'] or shells['deleted_chunks']:
        write_json(ROOT / '.runtime/reports/generated/tno-russia-whole-feature-repair.json', report)
    return report


if __name__ == '__main__':
    print(json.dumps(run_scenario(), ensure_ascii=False, indent=2))
