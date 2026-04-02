import json

import geopandas as gpd
import pytest
from shapely.geometry import Polygon

from map_builder.geo.topology import build_topology


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def _polygon(min_x: float, min_y: float, max_x: float, max_y: float) -> Polygon:
    return Polygon(
        [
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ]
    )


def _political_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        [
            {
                "id": "TEST_COUNTRY",
                "name": "Test Country",
                "cntr_code": "TC",
                "geometry": _polygon(10, 10, 12, 12),
            }
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )


def _urban_gdf(*, owner_id: str = "TEST_COUNTRY", feature_id: str = "urban::alpha", geometry: Polygon | None = None) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        [
            {
                "id": feature_id,
                "name": "Alpha",
                "country_owner_id": owner_id,
                "country_owner_code": "TC",
                "country_owner_method": "unit-test",
                "featurecla": "Urban area",
                "scalerank": 1,
                "area_sqkm": 42.0,
                "min_zoom": 0,
                "geometry": geometry or _polygon(10.2, 10.2, 10.8, 10.8),
            }
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )


def test_build_topology_rejects_urban_without_owner_metadata(tmp_path):
    output_path = tmp_path / "invalid_missing_owner.json"
    invalid_urban = _urban_gdf(owner_id="")

    with pytest.raises(ValueError, match="missing country_owner_id=1"):
        build_topology(
            political=_political_gdf(),
            ocean=_empty_gdf(),
            land=_empty_gdf(),
            urban=invalid_urban,
            physical=_empty_gdf(),
            rivers=_empty_gdf(),
            output_path=output_path,
        )


def test_build_topology_rejects_world_spanning_urban_geometry(tmp_path):
    output_path = tmp_path / "invalid_world_bounds.json"
    invalid_urban = _urban_gdf(
        geometry=_polygon(-180, -90, 180, 90),
    )

    with pytest.raises(ValueError, match="corrupt world-spanning features=1"):
        build_topology(
            political=_political_gdf(),
            ocean=_empty_gdf(),
            land=_empty_gdf(),
            urban=invalid_urban,
            physical=_empty_gdf(),
            rivers=_empty_gdf(),
            output_path=output_path,
        )


def test_build_topology_preserves_urban_ids_and_owner_metadata(tmp_path):
    output_path = tmp_path / "valid_urban_topology.json"
    build_topology(
        political=_political_gdf(),
        ocean=_empty_gdf(),
        land=_empty_gdf(),
        urban=_urban_gdf(),
        physical=_empty_gdf(),
        rivers=_empty_gdf(),
        output_path=output_path,
    )

    payload = json.loads(output_path.read_text(encoding="utf-8"))
    urban_geometries = payload["objects"]["urban"]["geometries"]
    assert len(urban_geometries) == 1
    urban_geom = urban_geometries[0]
    assert urban_geom["id"] == "urban::alpha"
    assert urban_geom["properties"]["id"] == "urban::alpha"
    assert urban_geom["properties"]["country_owner_id"] == "TEST_COUNTRY"
