"""Scope the water rebuild without carrying unsafe old topology fragments."""
from copy import deepcopy

from shapely.geometry import MultiPolygon, box, mapping

from map_builder.geo.water_geometry import D3_MIN_COMPONENT_AREA_DEGREES2
from tools.rebuild_water_geometry import _prepare_tno_marine_additions, _select_tno_water_rebuild_scope


def _feature(feature_id, geometry):
    return {"type": "Feature", "properties": {"id": feature_id}, "geometry": mapping(geometry)}


def test_refine_marine_recompiles_only_changed_or_subprecision_water():
    healthy = _feature("healthy", box(0, 0, 1, 1))
    tiny = box(3, 0, 3.000001, 0.000001)
    unsafe = _feature("unsafe", MultiPolygon([box(2, 0, 3, 1), tiny]))
    modified = _feature("modified", box(4, 0, 5, 1))
    originals = {feature["properties"]["id"]: deepcopy(feature)
                 for feature in (healthy, unsafe, modified)}
    modified["geometry"] = mapping(box(4, 0, 6, 1))

    assert tiny.area < D3_MIN_COMPONENT_AREA_DEGREES2
    changed, preserved = _select_tno_water_rebuild_scope(
        [healthy, unsafe, modified], originals)

    assert [feature["properties"]["id"] for feature in changed] == ["unsafe", "modified"]
    assert preserved == {"healthy"}


def test_broad_new_coastal_source_does_not_erase_established_detail():
    from shapely.geometry import shape

    salish = _feature("tno_salish_sea", box(1, 1, 2, 2))
    broad = _feature("tno_coastal_waters_of_southeast_alaska_and_british_columbia", box(0, 0, 3, 3))
    originals = {salish["properties"]["id"]: deepcopy(salish)}
    prepared = _prepare_tno_marine_additions([broad], originals)
    cut = shape(prepared[0]["geometry"])
    detail = shape(salish["geometry"])
    assert cut.intersection(detail).area == 0
    assert cut.union(detail).equals(box(0, 0, 3, 3))
    assert detail.difference(cut).equals(detail)
    assert originals[salish["properties"]["id"]] == salish
    assert broad["geometry"] == mapping(box(0, 0, 3, 3))
