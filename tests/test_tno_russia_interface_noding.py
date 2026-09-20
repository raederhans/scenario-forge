import json
from pathlib import Path

import pytest
import shapely
from shapely.geometry import box, shape
from shapely.ops import polygonize

from tools.pilot_tno_russia_precision import boundary_equal, node_owner_interfaces


@pytest.mark.parametrize("other", [box(.5, 0, 1.5, 1), box(.5, .5, .500001, .500001)])
def test_genuine_overlap_rejected_even_if_very_small(other):
    with pytest.raises(ValueError, match="true overlap"):
        node_owner_interfaces({"A": box(0, 0, 1, 1), "B": other})


def test_real_tat_junction_reproduces_point_hit_error_and_preserves_surfaces():
    payload = json.loads((Path(__file__).parent / "fixtures/tno_russia_tat_junction.json").read_text())
    geometries = {i: shape(g) for i, g in payload["geometries"].items()}
    values = list(geometries.values())
    false_faces = []
    for face in polygonize(shapely.union_all([g.boundary for g in values])):
        hits = [g for g in values if g.covers(face.representative_point())]
        positive = [g for g in hits if face.intersection(g).area > 0]
        # This is exactly the old overlap rejection condition, with a proven
        # zero-area third hit. No mocked GEOS methods or expanded tolerances.
        if len(hits) > 1 and face.area <= 1e-10 and not all(g.boundary.buffer(1e-9).covers(face) for g in hits):
            assert len(positive) < len(hits)
            assert positive
            assert all(g.boundary.buffer(1e-9).covers(face) for g in positive)
            false_faces.append(face)
    assert false_faces
    result = node_owner_interfaces(geometries)
    assert set(result) == set(geometries)
    assert shapely.coverage_is_valid(list(result.values()))
    for fid in result:
        assert result[fid].is_valid and not result[fid].is_empty
        assert boundary_equal(geometries[fid], result[fid])
    assert boundary_equal(shapely.union_all(values), shapely.union_all(list(result.values())))
