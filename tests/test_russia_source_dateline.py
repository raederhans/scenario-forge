from unittest.mock import patch

import geopandas as gpd
import pytest
from shapely.geometry import MultiPolygon, Polygon, box

from map_builder.processors.russia_ukraine import _validate_russia_longitudes, apply_russia_ukraine_replacement


def test_replacement_retains_both_dateline_sides():
    east, west = box(170, 60, 180, 65), box(-180, 60, -170, 65)
    ukraine = box(30, 45, 32, 47)
    main = gpd.GeoDataFrame({'id': ['RU', 'UA'], 'name': ['Russia', 'Ukraine'], 'cntr_code': ['RU', 'UA']},
                           geometry=[MultiPolygon([east, west]), ukraine], crs=4326)
    ru = gpd.GeoDataFrame({'shapeID': ['east', 'west'], 'shapeName': ['East', 'West']},
                         geometry=[east, west], crs=4326)
    ua = gpd.GeoDataFrame({'shapeID': ['ua'], 'shapeName': ['Ukraine']}, geometry=[ukraine], crs=4326)
    with patch('map_builder.processors.russia_ukraine.fetch_or_load_geojson', side_effect=[ru, ua]):
        result = apply_russia_ukraine_replacement(main)
    by_id = result.set_index('id')
    assert by_id.loc['RU_RAY_west'].geometry.equals(west)
    assert by_id.loc['RU_RAY_east'].geometry.equals(east)


def test_split_multipolygon_is_valid_without_longitude_translation():
    source = gpd.GeoDataFrame(geometry=[MultiPolygon([box(179, 60, 180, 61), box(-180, 60, -179, 61)])], crs=4326)
    original = source.geometry.iloc[0].wkb
    _validate_russia_longitudes(source)
    assert source.geometry.iloc[0].wkb == original


@pytest.mark.parametrize('geometry, message', [
    (Polygon([(179, 60), (-179, 60), (-179, 61), (179, 61)]), 'unsplit dateline'),
    (box(181, 60, 182, 61), 'invalid WGS84'),
])
def test_bad_dateline_input_fails_instead_of_losing_features(geometry, message):
    with pytest.raises(ValueError, match=message):
        _validate_russia_longitudes(gpd.GeoDataFrame(geometry=[geometry], crs=4326))
