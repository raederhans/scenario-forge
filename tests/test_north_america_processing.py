"""Replacement behavior with local geometries and no downloads."""
from unittest.mock import patch

import geopandas as gpd
from shapely.geometry import box

from map_builder.processors import north_america as processor


def frame(code, identity, geometry):
    return gpd.GeoDataFrame([{"cntr_code": code, "id": identity, "geometry": geometry}], crs=4326)


def test_replacement_preserves_other_countries_and_clips_new_detail():
    import pandas as pd

    original = gpd.GeoDataFrame(pd.concat([
        frame("ZZ", "untouched", box(20, 0, 21, 1)),
        *[frame(code, code + "_old", box(i * 3, 0, i * 3 + 1, 1))
          for i, code in enumerate(["US", "CA", "MX"])]], ignore_index=True), crs=4326)
    shells = {code: original[original.cntr_code == code] for code in ["US", "CA", "MX"]}
    with patch.object(processor, "_load_admin0_country", side_effect=lambda code, _: shells[code]), \
         patch.object(processor, "_build_us_zones", return_value=frame("US", "US_new", box(-1, -1, 2, 2))), \
         patch.object(processor, "_build_canada_fed", return_value=frame("CA", "CA_new", box(2, -1, 5, 2))), \
         patch.object(processor, "_build_mexico_zones", return_value=frame("MX", "MX_new", box(5, -1, 8, 2))):
        result = processor.apply_north_america_replacement(original)
    assert set(result.id) == {"untouched", "US_new", "CA_new", "MX_new"}
    assert result[result.id == "untouched"].geometry.iloc[0].equals(box(20, 0, 21, 1))
    for code, shell in shells.items():
        assert result[result.cntr_code == code].geometry.iloc[0].equals(shell.geometry.iloc[0])
    assert result.crs.to_epsg() == 4326
    assert set(original.id) == {"untouched", "US_old", "CA_old", "MX_old"}


def test_missing_crs_is_assigned_and_projected_crs_is_reprojected():
    source = frame("CA", "point", box(-80, 40, -79, 41))
    projected = source.to_crs(3857)
    restored = processor._ensure_epsg4326(projected)
    assert restored.crs.to_epsg() == 4326
    assert restored.geometry.iloc[0].hausdorff_distance(source.geometry.iloc[0]) < 1e-8
    unlabelled = source.set_crs(None, allow_override=True)
    assert processor._ensure_epsg4326(unlabelled).crs.to_epsg() == 4326
