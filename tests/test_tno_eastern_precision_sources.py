import pytest
from pathlib import Path
import sys
import geopandas as gpd
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.prepare_tno_eastern_precision_sources import process_belarus

def coarse_source(tmp_path, *, offset=0):
    polygon = Polygon([(offset, offset), (offset, offset + 3),
                       (offset + 3, offset + 3), (offset + 3, offset)])
    path = tmp_path / "coarse.json"
    gpd.GeoDataFrame({"cntr_code": ["BY"], "name": ["Brest"], "geometry": [polygon]},
                     crs="EPSG:4326").to_file(path, driver="GeoJSON")
    return path


def belarus_source(tmp_path, ids):
    polygon = Polygon([(0, 0), (0, 1), (1, 1), (1, 0)])
    path = tmp_path / "by_source.geojson"
    gpd.GeoDataFrame({"shapeID": ids, "shapeName": ["Minsk City", "Krasnapolle"],
                      "geometry": [polygon, polygon]}, crs="EPSG:4326").to_file(path, driver="GeoJSON")
    return path


@pytest.fixture
def dummy_baseline():
    return {"BY_CITY_MINSK", "BY_HIST_POL_MINSK_WEST", "BY_INT_BREST"}


def test_missing_or_invalid_historical_members(tmp_path, dummy_baseline):
    coarse = coarse_source(tmp_path)
    source = belarus_source(tmp_path, ["123", "67162791B52564132020414"])
    with pytest.raises(ValueError, match="CRITICAL: Missing historical members"):
        process_belarus(source, coarse, dummy_baseline)
    with pytest.raises(ValueError, match="is in the baseline! Cannot safely exclude."):
        process_belarus(source, coarse, dummy_baseline | {"BY_RAY_67162791B52564132020414"})
    duplicate = belarus_source(tmp_path, ["123", "123"])
    with pytest.raises(ValueError, match="CRITICAL: Belarus source contains duplicate shapeIDs."):
        process_belarus(duplicate, coarse, dummy_baseline)


def test_ambiguous_oblast_mapping(tmp_path, dummy_baseline):
    source_path = belarus_source(tmp_path, ["123", "67162791B52564132020414"])
    coarse_path = coarse_source(tmp_path, offset=10)
    with pytest.raises(ValueError, match="CRITICAL: sjoin failed to find an oblast match for one or more source shapes."):
        process_belarus(source_path, coarse_path, dummy_baseline)
