import json
import pytest
from pathlib import Path
import sys
import geopandas as gpd
from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.prepare_tno_eastern_precision_sources import main, process_belarus

@pytest.fixture
def dummy_baseline():
    return {"BY_CITY_MINSK", "BY_HIST_POL_MINSK_WEST", "BY_INT_BREST"}

@pytest.fixture
def valid_by_source(tmp_path):
    # We create a dummy source file
    p1 = Polygon([(0, 0), (0, 1), (1, 1), (1, 0)])
    p2 = Polygon([(1, 1), (1, 2), (2, 2), (2, 1)])
    gdf = gpd.GeoDataFrame({
        "shapeID": ["67162791B52564132020414", "123"],
        "shapeName": ["Krasnapolle", "Minsk City"],
        "geometry": [p1, p2]
    }, crs="EPSG:4326")
    p = tmp_path / "by_source.geojson"
    gdf.to_file(p, driver="GeoJSON")
    return p

@pytest.fixture
def valid_coarse_source(tmp_path):
    p2 = Polygon([(0, 0), (0, 3), (3, 3), (3, 0)])
    gdf = gpd.GeoDataFrame({
        "cntr_code": ["BY"],
        "name": ["Brest"],
        "geometry": [p2]
    }, crs="EPSG:4326")
    p = tmp_path / "coarse.json"
    gdf.to_file(p, driver="GeoJSON")
    return p

def test_eastern_precision_sources(tmp_path):
    out_dir = tmp_path / "eastern-v3"
    argv = [
        "--baseline", "data/scenarios/tno_1962/runtime_topology.topo.json",
        "--pl-source", "data/poland_powiaty.geojson",
        "--ua-source", "data/geoBoundaries-UKR-ADM2.geojson",
        "--by-source", "data/geoBoundaries-BLR-ADM2.geojson",
        "--coarse", "data/europe_topology.highres.json",
        "--output-dir", str(out_dir)
    ]

    ret = main(argv)
    assert ret == 0

def test_missing_historical_member(tmp_path, dummy_baseline, valid_coarse_source):
    # This will fail because Minsk City is there but historical members are missing
    source_path = tmp_path / "by_source.geojson"
    gdf = gpd.GeoDataFrame({
        "shapeID": ["123", "67162791B52564132020414"],
        "shapeName": ["Minsk City", "Krasnapolle"],
        "geometry": [Polygon([(0,0),(0,1),(1,1),(1,0)])]*2
    }, crs="EPSG:4326")
    gdf.to_file(source_path, driver="GeoJSON")

    with pytest.raises(ValueError, match="CRITICAL: Missing historical members"):
        process_belarus(source_path, valid_coarse_source, dummy_baseline)

def test_duplicate_raw_ids(tmp_path, dummy_baseline, valid_coarse_source):
    source_path = tmp_path / "by_source.geojson"
    gdf = gpd.GeoDataFrame({
        "shapeID": ["123", "123"],
        "shapeName": ["Minsk City", "Minsk City"],
        "geometry": [Polygon([(0,0),(0,1),(1,1),(1,0)])]*2
    }, crs="EPSG:4326")
    gdf.to_file(source_path, driver="GeoJSON")

    with pytest.raises(ValueError, match="CRITICAL: Belarus source contains duplicate shapeIDs."):
        process_belarus(source_path, valid_coarse_source, dummy_baseline)

def test_ambiguous_oblast_mapping(tmp_path, dummy_baseline):
    source_path = tmp_path / "by_source.geojson"
    gdf = gpd.GeoDataFrame({
        "shapeID": ["123", "67162791B52564132020414"],
        "shapeName": ["Minsk City", "Krasnapolle"],
        "geometry": [Polygon([(0,0),(0,1),(1,1),(1,0)])]*2
    }, crs="EPSG:4326")
    gdf.to_file(source_path, driver="GeoJSON")

    # Coarse without coverage
    coarse_path = tmp_path / "coarse.json"
    coarse_gdf = gpd.GeoDataFrame({
        "cntr_code": ["BY"],
        "name": ["Brest"],
        "geometry": [Polygon([(10,10),(10,11),(11,11),(11,10)])]
    }, crs="EPSG:4326")
    coarse_gdf.to_file(coarse_path, driver="GeoJSON")

    with pytest.raises(ValueError, match="CRITICAL: sjoin failed to find an oblast match for one or more source shapes."):
        process_belarus(source_path, coarse_path, dummy_baseline)

def test_excluded_krasnapolle_in_baseline(tmp_path, dummy_baseline, valid_coarse_source):
    source_path = tmp_path / "by_source.geojson"
    gdf = gpd.GeoDataFrame({
        "shapeID": ["123", "67162791B52564132020414"],
        "shapeName": ["Minsk City", "Krasnapolle"],
        "geometry": [Polygon([(0,0),(0,1),(1,1),(1,0)])]*2
    }, crs="EPSG:4326")
    gdf.to_file(source_path, driver="GeoJSON")

    dummy_baseline.add("BY_RAY_67162791B52564132020414")

    with pytest.raises(ValueError, match="is in the baseline! Cannot safely exclude."):
        process_belarus(source_path, valid_coarse_source, dummy_baseline)
