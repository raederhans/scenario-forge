"""Publication guards must inspect exact decoded geometry, even below a pixel."""
import pytest

from map_builder.geo.water_validation import validate_water_runtime


def test_final_validator_rejects_subpixel_self_intersection():
    topology = {
        "type": "Topology",
        "objects": {"water_regions": {"type": "GeometryCollection", "geometries": [
            {"type": "Polygon", "arcs": [[0]], "properties": {"id": "tiny-crossing"}},
        ]}},
        "arcs": [[[9, 55], [9.00000001, 55.00000001],
                  [9, 55.00000001], [9.00000001, 55], [9, 55]]],
    }
    with pytest.raises(ValueError, match="decoded planar geometry.*tiny-crossing"):
        validate_water_runtime(topology)
