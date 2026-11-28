from __future__ import annotations

import json
from collections import Counter

import numpy as np
from shapely.geometry import box

from tools import build_tno_state_districts as builder


def published():
    return builder.read_json(builder.SCENARIO / 'district_groups.manual.json')['tags']


def test_new_tags_have_named_disjoint_owned_members_and_explicit_coverage():
    owners = builder.read_json(builder.SCENARIO / 'owners.by_feature.json')['owners']
    spec = builder.read_json(builder.districts.DEFAULT_SPEC)['tags']
    added = {tag: record for tag, record in published().items() if tag not in builder.MANUAL_TAGS}
    assert added
    for tag, record in added.items():
        assert len(record['districts']) >= 2
        assigned = Counter()
        for district_id, district in record['districts'].items():
            assert district_id.startswith('state_')
            assert district['name_en'].strip()
            assert district['name_zh'].strip()
            assert district['feature_ids']
            assigned.update(district['feature_ids'])
            assert all(owners[fid] == tag for fid in district['feature_ids'])
        assert set(assigned.values()) == {1}
        assert len(assigned) >= 6
        assert set(assigned) == {fid for fid, owner in owners.items() if owner == tag}
        explicit = {fid for group in spec[tag]['districts'] for clause in group['match'] for fid in clause['id']}
        assert explicit == set(assigned)
    assert not {'OE00', 'OE01', 'OE02', 'OE03'} & added.keys()


def test_votes_count_only_mapped_land():
    result = builder.vote_summary(np.array([1, 1, 2, 3, 4, 0]),
                                  np.array(['land', 'land', 'land', 'sea', 'land', 'invalid']),
                                  np.array([0, 17, 18, 19, 0]))
    assert result['winner'] == 17
    assert result['votes'] == {17: 2, 18: 1}
    assert result['valid_land_fraction'] == .5
    assert result['winner_share'] == 2 / 3


def test_connectivity_moves_small_mainland_component_and_retains_island():
    geometries = {'a': box(0, 0, 1, 2), 'b': box(1, 0, 2, 1),
                  'c': box(2, 0, 3, 1), 'island': box(8, 0, 8.1, .1)}
    assigned = {'a': 10, 'b': 20, 'c': 10, 'island': 10}
    changes = builder.repair_connectivity(assigned, builder.adjacency(geometries), geometries)
    assert assigned == {'a': 10, 'b': 20, 'c': 20, 'island': 10}
    assert changes == [dict(feature_ids=['c'], from_state=10, to_state=20)]


def test_no_trusted_state_does_not_invent_a_group():
    result = builder.group_tag({'a': box(0, 0, 1, 1)}, {'a': dict(trusted=False)}, set())
    assert not result['groups']
    assert result['unresolved'] == ['a']
    assert result['untrusted'][0]['destination'] is None


def test_append_preserves_existing_bytes_and_is_idempotent():
    original = b'{\r\n  "version": 1,\r\n  "tags": {\r\n    "AAA": {"old": true}\r\n  },\r\n  "tail": [ 1 ]\r\n}\r\n'
    additions = {'BBB': {'name': '新组'}}
    changed = builder.append_tags_bytes(original, 'tags', additions)
    assert b'    "AAA": {"old": true},\r\n' in changed
    assert changed.endswith(b'  },\r\n  "tail": [ 1 ]\r\n}\r\n')
    assert json.loads(changed)['tags'] == {'AAA': {'old': True}, **additions}
    assert builder.append_tags_bytes(changed, 'tags', additions) == changed
