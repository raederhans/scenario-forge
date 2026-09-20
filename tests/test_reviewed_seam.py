import pytest
import shapely
from shapely.geometry import Polygon, box, LineString, Point

from map_builder.geo.reviewed_seam import partition_reviewed_seam


def test_partition_two_receivers_basic():
    gap = box(0, 0, 4, 2)
    receivers = {
        'R1': box(0, -2, 2, 0),
        'R2': box(2, -2, 4, 0)
    }
    fixed_boundary = LineString([(0, 2), (4, 2)])
    allowed_surface = box(-5, -5, 5, 5)

    additions, diag = partition_reviewed_seam(gap, receivers, fixed_boundary, allowed_surface=allowed_surface)

    assert 'R1' in additions
    assert 'R2' in additions
    assert additions['R1'].equals(Polygon([(0,0), (2,0), (0,2)]))
    assert additions['R2'].equals(Polygon([(2,0), (4,0), (4,2), (0,2)]))

    union = shapely.union_all(list(additions.values()))
    assert union.equals(gap)
    assert additions['R1'].intersection(additions['R2']).area == 0


def test_deterministic_insertion_order():
    gap = box(0, 0, 4, 2)
    receivers1 = {'R1': box(0, -2, 2, 0), 'R2': box(2, -2, 4, 0)}
    receivers2 = {'R2': box(2, -2, 4, 0), 'R1': box(0, -2, 2, 0)}
    fixed_boundary = LineString([(0, 2), (4, 2)])
    allowed_surface = box(-5, -5, 5, 5)

    add1, _ = partition_reviewed_seam(gap, receivers1, fixed_boundary, allowed_surface=allowed_surface)
    add2, _ = partition_reviewed_seam(gap, receivers2, fixed_boundary, allowed_surface=allowed_surface)

    assert add1['R1'].equals(add2['R1'])
    assert add1['R2'].equals(add2['R2'])


def test_nearest_vertex_on_receiver_edge_must_not_skip_partition():
    # The southern PL/UA sliver exposed this: the closest fixed endpoint
    # follows the existing UA border and therefore does not divide the gap.
    gap = Polygon([(0, 0), (0, 1), (0, 2), (3, .1)])
    receivers = {
        'south': Polygon([(0, 0), (3, .1), (4, .1), (4, -1), (0, -1)]),
        'north': Polygon([(0, 2), (4, 2), (4, .1), (3, .1)]),
    }
    originals = {fid: geometry.wkb for fid, geometry in receivers.items()}
    additions, diagnostic = partition_reviewed_seam(
        gap, receivers, LineString([(0, 0), (0, 1), (0, 2)]),
        allowed_surface=box(-1, -2, 5, 3))
    assert diagnostic['bridges'] == [[(3.0, .1), (0.0, 1.0)]]
    assert shapely.union_all(list(additions.values())).equals(gap)
    assert additions['south'].intersection(additions['north']).area == 0
    for fid, original in receivers.items():
        assert original.wkb == originals[fid]
        extended = original.union(additions[fid])
        assert extended.covers(original)
        assert extended.is_valid


def test_rejection_protected_water_non_land():
    gap = box(0, 0, 4, 2)
    receivers = {'R1': box(0, -2, 2, 0), 'R2': box(2, -2, 4, 0)}
    fixed_boundary = LineString([(0, 2), (4, 2)])
    allowed_surface = box(0, 0, 3, 2)

    with pytest.raises(ValueError, match="protected water or non-land"):
        partition_reviewed_seam(gap, receivers, fixed_boundary, allowed_surface=allowed_surface)


def test_rejection_occupied_gap():
    gap = box(0, 0, 4, 2)
    receivers = {'R1': box(0, -2, 2, 1), 'R2': box(2, -2, 4, 0)}
    fixed_boundary = LineString([(0, 2), (4, 2)])
    allowed_surface = box(-5, -5, 5, 5)

    with pytest.raises(ValueError, match="Reviewed gap is not empty"):
        partition_reviewed_seam(gap, receivers, fixed_boundary, allowed_surface=allowed_surface)


def test_ambiguous_support_fail_closed():
    gap = box(0, 0, 4, 2)
    receivers = {
        'R1': box(0, -2, 1, 0),
        'R2': box(3, -2, 4, 0)
    }
    fixed_boundary = LineString([(0, 2), (4, 2)])
    allowed_surface = box(-5, -5, 5, 5)
    with pytest.raises(ValueError, match="ambiguous receiver support"):
        partition_reviewed_seam(gap, receivers, fixed_boundary, allowed_surface=allowed_surface)


def test_concave_bridge_route():
    gap_coords = [
        (0,0), (5,0), (5,5), (0,5),
        (0,4), (4,4), (4,1), (0,1)
    ]
    gap = Polygon(gap_coords)
    receivers = {
        'R1': box(0, -1, 2, 0),
        'R2': box(2, -1, 5, 0)
    }
    fixed_boundary = LineString([(0, 4), (0, 5)])
    allowed_surface = box(-5, -5, 10, 10)

    additions, diag = partition_reviewed_seam(gap, receivers, fixed_boundary, allowed_surface=allowed_surface)

    assert len(additions) == 2
    bridges = diag['bridges']
    assert len(bridges) == 1
    coords = bridges[0]

    # Path should not be a straight line (which would cross the concave hole)
    assert len(coords) > 2
    assert (4.0, 1.0) in coords or (4.0, 4.0) in coords
