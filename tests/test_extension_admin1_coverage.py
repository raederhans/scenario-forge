"""Shared-edge simplification in the Natural Earth admin-1 extension."""
from unittest.mock import patch

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import Polygon, box

from map_builder.processors.admin1 import (
    _simplify_country_coverages,
    build_extension_admin1,
)


def _source():
    shared = [(1, 0), (1.01, .25), (.99, .5), (1.01, .75), (1, 1)]
    return gpd.GeoDataFrame([
        {"adm1_code": "DZA-1", "name": "West", "admin": "Algeria", "iso_a2": "DZ",
         "geometry": Polygon([(0, 0), *shared, (0, 1)])},
        {"adm1_code": "DZA-2", "name": "East", "admin": "Algeria", "iso_a2": "DZ",
         "geometry": Polygon([*shared, (2, 1), (2, 0)])},
        {"adm1_code": "MAR-1", "name": "Other", "admin": "Morocco", "iso_a2": "MA",
         "geometry": box(3, 0, 4, 1)},
    ], geometry="geometry", crs="EPSG:4326")


def test_build_extension_admin1_keeps_shared_edges_outlines_and_properties():
    source = _source()
    with (patch("map_builder.processors.admin1.fetch_ne_zip", return_value=source),
          patch("map_builder.processors.admin1.clip_to_map_bounds", side_effect=lambda frame, _: frame),
          patch("map_builder.processors.admin1.cfg.SIMPLIFY_ADMIN1", .1)):
        result = build_extension_admin1(gpd.GeoDataFrame(geometry=[], crs="EPSG:4326"))

    assert result["id"].tolist() == ["DZA-1", "DZA-2", "MAR-1"]
    assert result["name"].tolist() == ["West", "East", "Other"]
    assert result["cntr_code"].tolist() == ["DZ", "DZ", "MA"]
    before = source.geometry.iloc[:2].tolist()
    after = result.geometry.iloc[:2].tolist()
    assert shapely.coverage_is_valid(after)
    assert shapely.union_all(after).equals(shapely.union_all(before))
    assert sum(map(shapely.get_num_coordinates, after)) < sum(map(shapely.get_num_coordinates, before))
    assert result.geometry.iloc[2].equals(source.geometry.iloc[2])


def test_invalid_country_coverage_fails_before_simplification():
    frame = gpd.GeoDataFrame({
        "cntr_code": ["DZ", "DZ"],
        "geometry": [box(0, 0, 1, 1), box(.9, 0, 2, 1)],
    }, crs="EPSG:4326")
    with patch("map_builder.processors.admin1.shapely.coverage_simplify") as simplify:
        with pytest.raises(ValueError, match="DZ.*valid coverage"):
            _simplify_country_coverages(frame)
    simplify.assert_not_called()
