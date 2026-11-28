import pytest
import shapely
from shapely.geometry import Polygon, box, LineString

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


def test_rejection_protected_water_non_land():
    gap = box(0, 0, 4, 2)
    receivers = {'R1': box(0, -2, 2, 0), 'R2': box(2, -2, 4, 0)}
    fixed_boundary = LineString([(0, 2), (4, 2)])
    allowed_surface = box(0, 0, 3, 2)

    with pytest.raises(ValueError, match="protected water or non-land"):
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
