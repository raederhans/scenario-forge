"""Bounded, lossless repair of missing scenario coverage and duplicate placeholders.

This module does not assign sovereignty. The India geoBoundaries ADM2 record
named DATA NOT AVAILABLE duplicates existing named Natural Earth Pakistan
provinces. Keep those existing province identities and remove only their overlap
from the placeholder. Donor recovery adds only previously unoccupied coverage.
Callers own scenario sidecars, materialization, and publication.
"""
from copy import deepcopy

import shapely

from map_builder.processors.arctic_recovery import (
    AREA_EPSILON, _read, decoded_structure, polygonal,
)
from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs, _encode_exact_coverage, _offset_arcs, _update_bbox,
)
from tools.rebuild_polar_assets import FORBIDDEN_BLANK_PROPERTIES, refresh_neighbors

SOMALIA_IDS = ('SO_ADM1_83879307B13610404434600', 'SO_ADM1_83879307B65026001570916')
GUIANA_ID = 'GF_PRIMARY'
PLACEHOLDER_ID = 'IN_ADM2_76128533B2782141712775'


def _remove_occupied_placeholder(original, peers):
    occupied = shapely.union_all(list(peers.values()))
    rest = polygonal(original.difference(occupied))
    if original.union(occupied).symmetric_difference(rest.union(occupied)).area > AREA_EPSILON:
        raise AssertionError('Placeholder repair lost coverage')
    if rest.intersection(occupied).area > AREA_EPSILON:
        raise AssertionError('Placeholder overlap remains')
    return rest


def repair_placeholder_frame(frame):
    """Apply the same bounded duplicate policy before runtime topology encoding."""
    if 'id' not in frame or PLACEHOLDER_ID not in set(frame['id']):
        return frame
    matches = frame.index[frame['id'] == PLACEHOLDER_ID]
    if len(matches) != 1:
        raise ValueError('Duplicate Kashmir placeholder identity')
    target = matches[0]
    original = polygonal(frame.at[target, 'geometry'])
    province_rows = frame.loc[frame['id'].astype(str).str.startswith('PAK-')]
    peers = {row['id']: polygonal(row.geometry) for _, row in province_rows.iterrows()}
    peers = {fid: geom for fid, geom in peers.items()
             if original.intersection(geom).area > AREA_EPSILON}
    if not peers:
        return frame
    rest = _remove_occupied_placeholder(original, peers)
    result = frame.copy()
    if rest.is_empty:
        return result.drop(index=target).reset_index(drop=True)
    result.at[target, 'geometry'] = rest
    return result


def repair_topology(topology, donor=None, *, restore_ids=(), add_ids=(),
                    clip_placeholder=True, ownerless=False):
    """Return repaired topology and changed identities; never mutate inputs.

    Restore existing identities by adding missing donor coverage, retaining their
    scenario properties. New identities require an explicit add_ids opt-in;
    ownerless additions omit political properties. No unrelated arcs are rounded.
    """
    result = _absolute_topology(topology)
    other_objects = {name: decoded_structure(result, obj)
                     for name, obj in result['objects'].items() if name != 'political'}
    rows = result['objects']['political']['geometries']
    originals = {r['properties']['id']: decoded_structure(result, r) for r in rows}
    index = {r['properties']['id']: r for r in rows}
    geometries = {fid: _read(result, row) for fid, row in index.items()}
    changes, additions, removed = {}, {}, []
    report = {'added_ids': [], 'changed_ids': [], 'removed_ids': [], 'overlap_peer_ids': []}
    if clip_placeholder and PLACEHOLDER_ID in index:
        # The explicit stable ID is the scope boundary; never clip all India.
        original = geometries[PLACEHOLDER_ID]
        peers = {fid: geom for fid, geom in geometries.items()
                 if fid.startswith('PAK-') and original.intersection(geom).area > AREA_EPSILON}
        if peers:
            rest = _remove_occupied_placeholder(original, peers)
            if rest.is_empty:
                removed.append(PLACEHOLDER_ID)
                del geometries[PLACEHOLDER_ID]
            else:
                changes[PLACEHOLDER_ID] = geometries[PLACEHOLDER_ID] = rest
            report['overlap_peer_ids'] = sorted(peers)
    wanted = set(restore_ids) | (set(add_ids) - set(index))
    if wanted:
        if donor is None:
            raise ValueError('Coverage recovery requires a donor topology')
        source = _absolute_topology(donor)
        source_rows = {r['properties']['id']: r for r in source['objects']['political']['geometries']}
        for fid in sorted(wanted):
            if fid not in source_rows:
                raise ValueError(f'Missing donor identity: {fid}')
            if fid in restore_ids and fid not in index:
                raise ValueError(f'Cannot restore absent identity; opt in through add_ids: {fid}')
            donor_geom = _read(source, source_rows[fid])
            candidates = list(geometries.values())
            tree = shapely.STRtree(candidates)
            occupied = shapely.union_all([candidates[int(i)] for i in tree.query(donor_geom, predicate='intersects')])
            extra = polygonal(donor_geom.difference(occupied))
            if extra.is_empty or extra.area <= AREA_EPSILON:
                continue
            if extra.intersection(occupied).area > AREA_EPSILON:
                raise AssertionError(f'Recovery overlaps occupied coverage: {fid}')
            if fid in index:
                repaired = polygonal(geometries[fid].union(extra))
                if geometries[fid].difference(repaired).area > AREA_EPSILON:
                    raise AssertionError(f'Recovery lost original coverage: {fid}')
                changes[fid] = geometries[fid] = repaired
            else:
                props = deepcopy(source_rows[fid]['properties'])
                if ownerless:
                    props = {k: v for k, v in props.items() if k not in FORBIDDEN_BLANK_PROPERTIES}
                additions[fid] = props
                changes[fid] = geometries[fid] = extra
    if not changes and not removed:
        return deepcopy(topology), report
    encoded = _encode_exact_coverage(list(changes), list(changes.values()))
    offset = len(result['arcs'])
    result['arcs'].extend(encoded['arcs'])
    encoded_rows = {r['properties']['id']: r for r in encoded['objects']['political']['geometries']}
    rows[:] = [r for r in rows if r['properties']['id'] not in removed]
    rows.extend({'properties': props} for props in additions.values())
    for row in rows:
        fid = row['properties']['id']
        if fid in changes:
            replacement = encoded_rows[fid]
            row.update(type=replacement['type'], arcs=_offset_arcs(replacement['arcs'], offset))
            if 'bbox' in row:
                row['bbox'] = list(changes[fid].bounds)
    _compact_arcs(result)
    _update_bbox(result)
    for name, obj in result['objects'].items():
        if name != 'political' and decoded_structure(result, obj) != other_objects[name]:
            raise AssertionError(f'Unrelated object changed: {name}')
    for row in rows:
        fid = row['properties']['id']
        if fid in changes and _read(result, row).symmetric_difference(changes[fid]).area > AREA_EPSILON:
            raise AssertionError(f'Encoding changed repaired coverage: {fid}')
        if fid not in changes and decoded_structure(result, row) != originals[fid]:
            raise AssertionError(f'Unrelated coordinates changed: {fid}')
    refresh_neighbors(topology, result, set(changes) | set(removed))
    report.update(added_ids=sorted(additions), changed_ids=sorted(set(changes) - set(additions)), removed_ids=removed)
    return result, report
