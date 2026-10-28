from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import numpy as np
from topojson.utils import serialize_as_geojson

from tools.tno_1962_registration import (
    GEOD, REPORT_DIR, SCHEMES, Registration, load_source,
    sample_equal_area, summarize_votes, write_json,
)


RUSSIAN_REGIONS = {'west_russia', 'urals', 'west_siberia', 'central_siberia', 'far_east'}

def is_russian(row):
    return bool(RUSSIAN_REGIONS.intersection(row.get('regions', [])))

def normalize_current(current, identity):
    migration = identity['conflict_migrations'].get(current)
    if migration is not None:
        return migration['new_tag'] or current
    project_tags = {tag for entry in identity['original_to_project'].values() for tag in entry['project_tags']}
    if current in project_tags:
        return current
    entry = identity['original_to_project'].get(current)
    return entry['default_project_tag'] if entry else current


def represented_originals(candidates, identity):
    current = {normalize_current(row['current_owner'], identity) for row in candidates['rows'] if row['current_owner']}
    return {tag for tag, entry in identity['original_to_project'].items() if current.intersection(entry['project_tags'])}


def resolve_identity(original, current, identity, country_code=None, represented=None, fid=''):
    entry = identity['original_to_project'].get(original)
    if entry is None:
        return None
    normalized = normalize_current(current, identity)
    china = (country_code in identity['china_policy']['country_codes']
             or fid.startswith(tuple(identity['china_policy']['feature_id_prefixes'])))
    if china and original in represented:
        return normalized
    if entry['policy'] == 'preserve_custom' and normalized in entry['project_tags']:
        return normalized
    return entry['default_project_tag']


def in_scope(row, identity):
    if row.get('current_owner') in identity['scope']['excluded_owners'] or row.get('country_code') == 'GL':
        return False
    return (row.get('country_code') in identity['scope']['country_codes']
            or row['fid'].startswith(tuple(identity['scope']['feature_id_prefixes']))
            or row.get('current_owner') in identity['scope']['project_owners'])


def perturbation_radius(row, regions, min_radius=30, max_radius=120,
                        russian_min_radius=20, russian_max_radius=60, russian_error_stat='median_km'):
    statistic = 'p90_km'
    if is_russian(row):
        statistic = russian_error_stat
        min_radius, max_radius = russian_min_radius, russian_max_radius
    errors = [regions[r]['schemes'][s][statistic] for r in row['regions'] for s in SCHEMES]
    if not errors or any(error is None for error in errors):
        return None
    return float(np.clip(max(errors), min_radius, max_radius))


def project_votes(votes, valid_land_samples, row, identity, represented):
    mapped = Counter()
    for original, count in votes.items():
        target = resolve_identity(original, row['current_owner'], identity, row['country_code'], represented, row['fid'])
        mapped[target if target is not None else f'<unresolved:{original}>'] += count
    ordered = sorted(mapped.items(), key=lambda item: (-item[1], item[0]))
    target, count = ordered[0] if ordered else (None, 0)
    if target is not None and target.startswith('<unresolved:'):
        target = None
    return dict(project_votes=dict(ordered), project_mode=target,
                project_share=count / valid_land_samples if valid_land_samples else 0,
                project_tied=len(ordered) > 1 and ordered[0][1] == ordered[1][1])


def evaluate_robustness(row, geometry, registration, source, regions, identity, represented,
                        min_radius=30, max_radius=120, russian_min_radius=20, russian_max_radius=60,
                        russian_error_stat='median_km'):
    radius = perturbation_radius(row, regions, min_radius, max_radius,
                                 russian_min_radius, russian_max_radius, russian_error_stat)
    if radius is None:
        return dict(radius_km=None, cases=[], city_conflicts=[], missing_radius=True)
    points = sample_equal_area(geometry, row['schemes']['tps']['total_samples'], row['sample_seed'])
    bearings = [None, *range(0, 360, 45)]
    shifted = [points]
    for bearing in bearings[1:]:
        lon, lat, _ = GEOD.fwd(points[:, 0], points[:, 1], np.full(len(points), bearing),
                               np.full(len(points), radius * 1000))
        shifted.append(np.column_stack([lon, lat]))
    all_points = np.concatenate(shifted)
    samples = {scheme: source.lookup(registration.lonlat_to_pixel(all_points, scheme)) for scheme in SCHEMES}
    cases = []
    for index, bearing in enumerate(bearings):
        section = slice(index * len(points), (index + 1) * len(points))
        for scheme in SCHEMES:
            _, kinds, owners = samples[scheme]
            stats = summarize_votes(kinds[section], owners[section])
            mapped = project_votes(stats['votes'], stats['valid_land_samples'], row, identity, represented)
            cases.append(dict(scheme=scheme, bearing_degrees=bearing, radius_km=0 if bearing is None else radius,
                              **stats, **mapped))
    targets = {case['project_mode'] for case in cases}
    conflicts = []
    for anchor in row['city_anchor_owners']:
        target = resolve_identity(anchor['owner'], row['current_owner'], identity, row['country_code'], represented, row['fid'])
        if target is None or targets != {target}:
            conflicts.append(dict(anchor, project_owner=target))
    return dict(radius_km=radius, cases=cases, city_conflicts=conflicts, missing_radius=False)


def approval_reasons(row, robustness, min_share=.70, min_land=.8):
    if row['status'] != 'sampled':
        return ['empty_geometry']
    reasons = []
    if not row['current_owner']:
        reasons.append('no_runtime_owner')
    if robustness['missing_radius']:
        return reasons + ['missing_holdout_error']
    cases = robustness['cases']
    if len(cases) != 18:
        reasons.append('incomplete_perturbations')
    targets = {case['project_mode'] for case in cases}
    if None in targets:
        reasons.append('unresolved_identity_or_no_land')
    if len(targets) != 1 or any(case['project_tied'] for case in cases):
        reasons.append('unstable_owner')
    if any(case['project_share'] < min_share for case in cases):
        reasons.append('share_below_threshold')
    if any(case['valid_land_fraction'] < min_land for case in cases):
        reasons.append('land_below_threshold')
    if robustness['city_conflicts']:
        reasons.append('city_anchor_conflict')
    return reasons


def russian_summary(approved, review, identity):
    groups = {
        'west_urals': {'BKR', 'VYT', 'ZLT', 'TAT', 'PRM', 'GAY', 'URL', 'ORE', 'MGN', 'DRL', 'OUR', 'ORS', 'SAM'},
        'central_siberia': {'SBA', 'IRK', 'RUR', 'KEM', 'KRS', 'ALT'},
        'north': {'WRS', 'VOR', 'VOK', 'KOM', 'VOL'},
        'far_east': {'YAK', 'AMR', 'FIC', 'PFC', 'RSF', 'KMC'},
        'RFA_split': {'RFA'},
    }
    result = {}
    for group, tags in groups.items():
        normalized_tags = {normalize_current(tag, identity) for tag in tags}
        def belongs(row):
            if group == 'RFA_split':
                return row['current_owner'] == 'RFA'
            targets = {case['project_mode'] for case in row['robustness']['cases']}
            return (row['current_owner'] in tags
                    or bool(normalized_tags.intersection(targets | {row['normalized_current_owner']})))
        rows = [row for row in approved if belongs(row)]
        pending = [row for row in review if belongs(row)]
        matrix = defaultdict(lambda: dict(count=0, area_km2=0.0))
        for row in rows:
            item = matrix[f"{row['current_owner']}->{row['project_owner']}"]
            item['count'] += 1
            item['area_km2'] += row['area_km2']
        result[group] = dict(approved=len(rows), area_km2=sum(row['area_km2'] for row in rows),
                             manual_review=len(pending),
                             manual_review_area_km2=sum(row['area_km2'] for row in pending),
                             change_matrix=dict(sorted(matrix.items(), key=lambda item: (-item[1]['area_km2'], item[0]))))
    return result


def build_assignments(candidates, identity, robustness_by_fid, min_share=.70, min_land=.8, russian_min_share=.60):
    assignments, review, approved_rows = {}, [], []
    excluded, unchanged = 0, 0
    matrix = defaultdict(lambda: dict(count=0, area_km2=0.0))
    reasons_count = Counter()
    for row in candidates['rows']:
        if not in_scope(row, identity):
            excluded += 1
            continue
        robustness = robustness_by_fid[row['fid']]
        reasons = approval_reasons(row, robustness, russian_min_share if is_russian(row) else min_share, min_land)
        targets = {case['project_mode'] for case in robustness['cases']}
        target = next(iter(targets)) if len(targets) == 1 else None
        if target in identity['scope']['excluded_owners']:
            excluded += 1
            continue
        normalized = normalize_current(row['current_owner'], identity)
        record = dict(fid=row['fid'], current_owner=row['current_owner'], normalized_current_owner=normalized,
                      country_code=row.get('country_code'), project_owner=target,
                      area_km2=row.get('area_km2', 0), reasons=reasons, robustness=robustness)
        if reasons:
            review.append(record)
            reasons_count.update(reasons)
        elif normalized == target:
            unchanged += 1
        else:
            assignments[row['fid']] = target
            approved_rows.append(record)
            key = f"{row['current_owner']}->{target}"
            matrix[key]['count'] += 1
            matrix[key]['area_km2'] += row['area_km2']
    summary = dict(approved=len(assignments), approved_area_km2=sum(r['area_km2'] for r in approved_rows),
                   manual_review=len(review), manual_review_area_km2=sum(r['area_km2'] for r in review),
                   robust_unchanged=unchanged, excluded=excluded, review_reasons=dict(reasons_count),
                   change_matrix=dict(sorted(matrix.items(), key=lambda item: (-item[1]['area_km2'], item[0]))),
                   russia=russian_summary(approved_rows, review, identity))
    return dict(schema_version=2, assignments=assignments, approved=approved_rows, summary=summary), review


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidates', type=Path, default=REPORT_DIR / 'tno_1962_owner_candidates.json')
    parser.add_argument('--identity-map', type=Path, default=ROOT / 'data/scenario-rules/tno_1962.identity_map.json')
    parser.add_argument('--min-share', type=float, default=.70)
    parser.add_argument('--min-land', type=float, default=.8)
    parser.add_argument('--min-radius-km', type=float, default=30)
    parser.add_argument('--max-radius-km', type=float, default=120)
    parser.add_argument('--russian-min-share', type=float, default=.60)
    parser.add_argument('--russian-min-radius-km', type=float, default=20)
    parser.add_argument('--russian-max-radius-km', type=float, default=60)
    parser.add_argument('--russian-error-stat', choices=['median_km', 'p90_km'], default='median_km')
    args = parser.parse_args()
    candidates = json.loads(args.candidates.read_text(encoding='utf-8'))
    identity = json.loads(args.identity_map.read_text(encoding='utf-8'))
    source, _, _ = load_source()
    registration = Registration(candidates['control_points'], source.width, validate=False)
    topology = json.loads((ROOT / 'data/scenarios/tno_1962/runtime_topology.topo.json').read_text(encoding='utf-8'))
    political = gpd.GeoDataFrame.from_features(serialize_as_geojson(topology, objectname='political'), crs=4326)
    geometries = dict(zip(political['id'].astype(str), political.geometry))
    represented = represented_originals(candidates, identity)
    robustness = {}
    for row in candidates['rows']:
        if not in_scope(row, identity):
            continue
        robustness[row['fid']] = (evaluate_robustness(
            row, geometries[row['fid']], registration, source, candidates['regions'], identity, represented,
            args.min_radius_km, args.max_radius_km, args.russian_min_radius_km,
            args.russian_max_radius_km, args.russian_error_stat) if row['status'] == 'sampled'
            else dict(radius_km=None, cases=[], city_conflicts=[], missing_radius=True))
    approved, review = build_assignments(candidates, identity, robustness, args.min_share, args.min_land, args.russian_min_share)
    approved['source'] = dict(candidates=str(args.candidates), identity_map=str(args.identity_map),
                              as_of=candidates['as_of'], britain_rule=candidates['britain_rule'])
    approved['thresholds'] = dict(min_share=args.min_share, min_land=args.min_land,
                                   min_radius_km=args.min_radius_km, max_radius_km=args.max_radius_km,
                                   directions=8, cases=18, error_stat='p90_km',
                                   russia=dict(regions=sorted(RUSSIAN_REGIONS), min_share=args.russian_min_share,
                                               min_radius_km=args.russian_min_radius_km,
                                               max_radius_km=args.russian_max_radius_km,
                                               error_stat=args.russian_error_stat))
    approved['summary']['thresholds'] = approved['thresholds']
    write_json(REPORT_DIR / 'tno_1962_approved_assignments.json', approved)
    write_json(REPORT_DIR / 'tno_1962_manual_review.json', dict(source=approved['source'], rows=review))
    printed = dict(approved['summary'])
    printed['change_matrix'] = dict(list(printed['change_matrix'].items())[:40])
    print(json.dumps(printed, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
