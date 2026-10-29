from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.json_source import read_json_source
from map_builder.scenario_context import write_json_transaction
from map_builder.scenario_political_materialization_support import build_country_entry_from_mutation
from tools.apply_tno_1962_identity_migrations import SCENARIO_DIR, IDENTITY_PATH, read_json
from tools.build_tno_1962_approved_assignments import (
    in_scope, is_russian, project_votes, represented_originals, resolve_identity,
)
from tools.materialize_polar_scenarios import refresh_scenario
from tools.tno_1962_registration import REPORT_DIR, write_json

INPUT_DIR = Path('C:/Users/raede/Desktop/dev/mapcreator-tno/.runtime/reports/generated')
NEW_COUNTRIES = {
    'AMR': ('Amur', '阿穆尔', 'RU'),
    'CLL': ('Colombian Revolutionary Union', '哥伦比亚革命联盟', 'CO'),
    'FAV': ('Free Aviators', '自由飞行员', 'RU'),
    'NRL': ('Norilsk', '诺里尔斯克', 'RU'),
    'OMO': ('Omolon', '奥莫隆', 'RU'),
    'TNS': ('Transnistria Governorate', '德涅斯特河沿岸总督区', 'MD'),
}
REGION_TAGS = {
    'west_urals': {'BKR', 'VYT', 'ZLT', 'TAT', 'PRM', 'GAY', 'URL', 'ORN', 'MGN', 'OUR', 'ORS', 'SAM'},
    'central_siberia': {'SBA', 'IRK', 'RUR', 'KRS', 'ALT', 'TOM', 'NOV', 'NRL'},
    'north': {'WRS', 'VOK', 'KOM', 'VOL', 'ONG'},
    'far_east': {'YAK', 'AMR', 'FIC', 'PFC', 'MAG', 'OMO', 'BRY', 'CHT'},
}


def best_effort_owner(row, identity, represented):
    if (not row['current_owner'] or not in_scope(row, identity)
            or not is_russian(row) or row['status'] != 'sampled'):
        return None
    cases = [project_votes(row['schemes'][scheme]['votes'],
                           row['schemes'][scheme]['valid_land_samples'], row, identity, represented)
             for scheme in ('tps', 'affine')]
    target = cases[0]['project_mode']
    if (target is None or target in identity['scope']['excluded_owners']
            or any(case['project_mode'] != target or case['project_share'] < .50
                   or case['project_tied'] for case in cases)):
        return None
    if any(resolve_identity(anchor['owner'], row['current_owner'], identity,
                            row['country_code'], represented, row['fid']) != target
           for anchor in row['city_anchor_owners']):
        return None
    return target


def select_corrections(candidates, approved, manual_review, identity):
    by_id = {row['fid']: row for row in candidates['rows']}
    selected = {row['fid']: {**row, 'method': 'approved'} for row in approved['approved']}
    represented = represented_originals(candidates, identity)
    for row in manual_review['rows']:
        target = best_effort_owner(by_id[row['fid']], identity, represented)
        if target is not None and target != row['normalized_current_owner']:
            selected[row['fid']] = {**row, 'project_owner': target, 'method': 'best_effort'}
    return selected


def political_neighbors(topology):
    """Runtime feature ID -> IDs that share at least one arc with it."""
    by_arc = defaultdict(set)
    geometries = topology['objects']['political']['geometries']

    def arcs_of(geometry):
        rings = geometry.get('arcs') or []
        if geometry.get('type') == 'Polygon':
            rings = [rings]
        return (arc if arc >= 0 else ~arc for polygon in rings for ring in polygon for arc in ring)

    for geometry in geometries:
        fid = geometry.get('properties', {}).get('id')
        for arc in arcs_of(geometry):
            by_arc[arc].add(fid)
    neighbors = defaultdict(set)
    for fids in by_arc.values():
        for fid in fids:
            neighbors[fid] |= fids - {fid}
    return neighbors


def projected_modes(candidates, identity, represented):
    """Feature ID -> owner its TPS sample votes for, whether or not it passed the gates."""
    modes = {}
    for row in candidates['rows']:
        if row['current_owner'] and row['status'] == 'sampled':
            scheme = row['schemes']['tps']
            modes[row['fid']] = project_votes(scheme['votes'], scheme['valid_land_samples'],
                                              row, identity, represented)['project_mode']
    return modes


def drop_small_enclaves(selected, owners, neighbors, projected=None, max_area_km2=2000.0):
    """Keep a small parcel with its surroundings when its correction would leave it as an enclave.

    Sampling can flip a city face to the original owner while the district around it stays,
    which only makes a speck. When a neighbor also votes for the new owner, the neighbor is the
    one that missed the gates (Perm, Kirov), so the change stays. Dropping one change can isolate
    another, so repeat until stable.
    """
    projected = projected or {}
    kept = dict(selected)
    while True:
        final = {**owners, **{fid: row['project_owner'] for fid, row in kept.items()}}
        dropped = [fid for fid, row in kept.items()
                   if row['area_km2'] < max_area_km2 and neighbors.get(fid)
                   and all(final.get(other) != row['project_owner']
                           and projected.get(other) != row['project_owner'] for other in neighbors[fid])]
        if not dropped:
            return kept, sorted(set(selected) - set(kept))
        for fid in dropped:
            del kept[fid]


def change_matrix(rows):
    matrix = defaultdict(lambda: dict(count=0, area_km2=0.0))
    for row in rows:
        item = matrix[f"{row['normalized_current_owner']}->{row['project_owner']}"]
        item['count'] += 1
        item['area_km2'] += row['area_km2']
    return dict(sorted(matrix.items()))


def apply_corrections(input_dir=INPUT_DIR, scenario_dir=SCENARIO_DIR):
    identity = read_json(IDENTITY_PATH)
    candidates = read_json(input_dir / 'tno_1962_owner_candidates.json')
    approved = read_json(input_dir / 'tno_1962_approved_assignments.json')
    review = read_json(input_dir / 'tno_1962_manual_review.json')
    selected = select_corrections(candidates, approved, review, identity)
    owners = read_json(scenario_dir / 'owners.by_feature.json')['owners']
    neighbors = political_neighbors(read_json_source(scenario_dir / 'runtime_topology.topo.json'))
    projected = projected_modes(candidates, identity, represented_originals(candidates, identity))
    selected, dropped_enclaves = drop_small_enclaves(selected, owners, neighbors, projected)
    cores = read_json(scenario_dir / 'cores.by_feature.json')['cores']
    mutations = read_json(scenario_dir / 'scenario_mutations.json')
    city_path = scenario_dir / 'city_overrides.json'
    city_overrides = read_json(city_path)
    fic_hint = dict(tag='FIC', city_id='', resolution_method='no_capital')
    capital_changed = city_overrides['capital_city_hints'].get('FIC') != fic_hint
    city_overrides['capitals_by_tag'].pop('FIC', None)
    city_overrides['capital_city_hints']['FIC'] = fic_hint
    mutations['capitals']['FIC'] = dict(city_id='', capital_state_id=None, city_override_entry=fic_hint)
    countries_payload = read_json(scenario_dir / 'countries.json')
    countries = countries_payload['countries']
    assignments = {fid: dict(parent_id=fid, owner=row['project_owner'],
                             controller=row['project_owner'], cores=[row['project_owner']])
                   for fid, row in selected.items()}
    changed = {fid: assignment for fid, assignment in assignments.items()
               if owners[fid] != assignment['owner'] or cores[fid] != assignment['cores']
               or mutations['assignments_by_feature_id'].get(fid) !=
               {key: assignment[key] for key in ('owner', 'controller', 'cores')}}
    palette = read_json(ROOT / 'data/palettes/tno.palette.json')['entries']
    new_tags = sorted({row['owner'] for row in assignments.values()} - countries.keys())
    for tag in new_tags:
        en, zh, iso = NEW_COUNTRIES[tag]
        mutation = dict(mode='create', display_name=en, display_name_en=en,
                        display_name_zh=zh, color_hex=palette[tag]['map_hex'], color_policy='palette')
        if iso == 'RU':
            mutation.update(inspector_group_id='scenario_group_russia_region',
                            inspector_group_label='Russia Region', inspector_group_anchor_id='continent_europe')
        mutations['countries'][tag] = mutation
        entry = build_country_entry_from_mutation({'scenarioId': 'tno_1962'}, tag, mutation,
                                                  existing_entry=None)
        entry.update(base_iso2=iso, lookup_iso2=iso, provenance_iso2=iso)
        countries[tag] = entry
    for fid, assignment in assignments.items():
        mutations['assignments_by_feature_id'][fid] = {
            key: assignment[key] for key in ('owner', 'controller', 'cores')}
    manifest = read_json(scenario_dir / 'manifest.json')
    needs_refresh = bool(changed or new_tags or manifest.get('corrections_version') != 1)
    if needs_refresh or capital_changed:
        manual = read_json(scenario_dir / 'scenario_manual_overrides.json')
        for tag in new_tags:
            manual['countries'][tag] = countries[tag]
        write_json_transaction([(scenario_dir / 'countries.json', countries_payload),
                                (scenario_dir / 'scenario_mutations.json', mutations),
                                (scenario_dir / 'scenario_manual_overrides.json', manual),
                                (city_path, city_overrides)])
    if needs_refresh:
        refresh_scenario(scenario_dir, assignments)
        manifest = read_json(scenario_dir / 'manifest.json')
        manifest['corrections_version'] = 1
        write_json_transaction([(scenario_dir / 'manifest.json', manifest)])
    countries = read_json(scenario_dir / 'countries.json')['countries']
    regions = {region: change_matrix(row for row in selected.values()
                                    if row['normalized_current_owner'] in tags or row['project_owner'] in tags)
               for region, tags in REGION_TAGS.items()}
    regions['RFA_split'] = change_matrix(row for row in selected.values() if row['current_owner'] == 'RFA')
    report = dict(approved_count=len(approved['approved']), manual_review_count=len(review['rows']),
                  best_effort_count=sum(row['method'] == 'best_effort' for row in selected.values()),
                  selected_count=len(selected), changed_count=len(changed), new_tags=new_tags,
                  dropped_enclaves=dropped_enclaves,
                  change_matrix=change_matrix(selected.values()), regions=regions,
                  zero_territory_tags=sorted(tag for tag, country in countries.items() if not country['feature_count']),
                  retirement_policy='保留零领土国家条目；不自动新增可释放目录或领土预设。旧 PRC/ANG 身份由迁移工具退役。',
                  assignments={fid: {key: row[key] for key in ('normalized_current_owner', 'project_owner', 'method', 'area_km2')}
                               for fid, row in selected.items()})
    write_json(REPORT_DIR / 'tno_1962_corrections.json', report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', type=Path, default=INPUT_DIR)
    args = parser.parse_args()
    report = apply_corrections(args.input_dir)
    print(json.dumps({key: report[key] for key in
                      ('approved_count', 'best_effort_count', 'selected_count', 'changed_count', 'new_tags')}, ensure_ascii=False))
