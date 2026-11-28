import json

import geopandas as gpd
import pytest
from shapely.geometry import MultiPolygon, Polygon
from topojson.utils import serialize_as_geojson

from map_builder.geo import spherical_safety
from map_builder.geo.spherical_safety import (
    PRIMARY_POLAR_WATER_IDS,
    prepare_primary_polar_water_regions,
    validate_primary_polar_water_feature_collection,
    validate_primary_polar_water_topology,
)
from map_builder.geo.topology import build_topology


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def test_topology_builder_inherits_physical_authority_before_clipping_water(tmp_path):
    authority = {
        "type": "Topology",
        "arcs": [
            [[-10, -10], [-10, 10], [10, 10], [10, -10], [-10, -10]],
            [[30, 0], [30, 5], [35, 5], [35, 0], [30, 0]],
        ],
        "objects": {
            "ocean": {"type": "Polygon", "arcs": [[0]]},
            "land": {"type": "Polygon", "arcs": [[1]]},
        },
    }
    water = gpd.GeoDataFrame([{
        "id": "test_ocean", "water_type": "ocean", "region_group": "ocean_macro",
        "geometry": Polygon([[-5, -5], [-5, 5], [5, 5], [5, -5], [-5, -5]]),
    }], crs="EPSG:4326")
    output = tmp_path / "detail.json"
    source_path = tmp_path / "water_regions.geojson"
    source_path.write_text('{"owner":"primary"}', encoding="utf-8")
    build_topology(political=_political_gdf(), ocean=_empty_gdf(), land=_empty_gdf(),
                   urban=_empty_gdf(), physical=_empty_gdf(), rivers=_empty_gdf(),
                   water_regions=water, output_path=output, physical_authority_topology=authority)
    actual = json.loads(output.read_text(encoding="utf-8"))
    assert json.loads(source_path.read_text(encoding="utf-8")) == {"owner": "primary"}
    for name in ("land", "ocean"):
        assert spherical_safety._topology_feature_collection(actual, name, "test.actual") == \
            spherical_safety._topology_feature_collection(authority, name, "test.authority")


def _ring(min_x: float, min_y: float, max_x: float, max_y: float) -> Polygon:
    return Polygon([
        (min_x, min_y),
        (max_x, min_y),
        (max_x, max_y),
        (min_x, max_y),
        (min_x, min_y),
    ])


def _polar_water_gdf() -> gpd.GeoDataFrame:
    arctic = "marine_arctic_ocean"
    southern = "marine_southern_ocean"
    return gpd.GeoDataFrame([
        {"id": arctic, "neighbors": southern, "source_standard": "natural_earth",
         "geometry": MultiPolygon([_ring(150, 70, 179.5, 84), _ring(-179.5, 70, -150, 84)])},
        {"id": southern, "neighbors": arctic, "source_standard": "natural_earth",
         "geometry": MultiPolygon([_ring(145, -82, 179.5, -60), _ring(-179.5, -82, -145, -60)])},
    ], geometry="geometry", crs="EPSG:4326")


def _political_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        [{"id": "TEST", "name": "Test", "cntr_code": "TT", "geometry": _ring(0, 0, 2, 2)}],
        geometry="geometry",
        crs="EPSG:4326",
    )


def _polar_cap_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        [
            {
                "id": "marine_arctic_ocean",
                "geometry": Polygon([(-180, 80), (180, 80), (180, 90), (-180, 90), (-180, 80)]),
            },
            {
                "id": "marine_southern_ocean",
                "geometry": Polygon([(-180, -90), (180, -90), (180, -80), (-180, -80), (-180, -90)]),
            },
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )


def test_prepare_primary_polar_water_regions_rewinds_antimeridian_parts_without_drift() -> None:
    source = _polar_water_gdf()
    source_properties = source.drop(columns="geometry").to_dict("records")
    source_areas = [float(geometry.area) for geometry in source.geometry]

    prepared = prepare_primary_polar_water_regions(source)

    assert prepared.drop(columns="geometry").to_dict("records") == source_properties
    assert [float(geometry.area) for geometry in prepared.geometry] == pytest.approx(source_areas, rel=0, abs=1e-12)
    assert set(prepared["id"]) == PRIMARY_POLAR_WATER_IDS
    for geometry in prepared.geometry:
        assert all(not part.exterior.is_ccw for part in geometry.geoms)
    prepared_again = prepare_primary_polar_water_regions(prepared)
    assert all(
        repeated.equals(original)
        for repeated, original in zip(prepared_again.geometry, prepared.geometry)
    )
    validate_primary_polar_water_feature_collection(
        json.loads(prepared.to_json(drop_id=True)),
        require_all=True,
        stage_label="unit.prepared",
    )


def test_prepare_primary_polar_caps_closes_at_poles_and_antimeridian() -> None:
    prepared = prepare_primary_polar_water_regions(_polar_cap_gdf())

    assert all(geometry.is_valid for geometry in prepared.geometry)
    # Continuous caps stay valid polygons; artificial longitude bands used to
    # require epsilon gaps to avoid touching MultiPolygon components.
    assert all(geometry.geom_type == "Polygon" for geometry in prepared.geometry)
    assert all(original.equals(compiled) for original, compiled in zip(_polar_cap_gdf().geometry, prepared.geometry))
    validate_primary_polar_water_feature_collection(
        json.loads(prepared.to_json(drop_id=True)),
        require_all=True,
        stage_label="unit.polar_caps",
    )


def test_primary_topology_round_trip_keeps_polar_ids_properties_and_spherical_safety(tmp_path) -> None:
    output_path = tmp_path / "primary.json"
    build_topology(
        political=_political_gdf(),
        ocean=_empty_gdf(),
        land=_empty_gdf(),
        urban=_empty_gdf(),
        physical=_empty_gdf(),
        rivers=_empty_gdf(),
        water_regions=_polar_water_gdf(),
        output_path=output_path,
        quantization=100_000,
    )

    topology = json.loads(output_path.read_text(encoding="utf-8"))
    validate_primary_polar_water_topology(
        topology,
        require_all=True,
        stage_label="unit.round_trip",
    )
    feature_collection = serialize_as_geojson(topology, objectname="water_regions")
    features_by_id = {
        feature["properties"]["id"]: feature
        for feature in feature_collection["features"]
    }
    assert set(features_by_id) == PRIMARY_POLAR_WATER_IDS
    assert features_by_id["marine_arctic_ocean"]["properties"]["source_standard"] == "natural_earth"
    assert features_by_id["marine_southern_ocean"]["properties"]["neighbors"] == "marine_arctic_ocean"
    sidecar = json.loads(output_path.with_name("water_regions.geojson").read_text(encoding="utf-8"))
    validate_primary_polar_water_feature_collection(
        sidecar,
        require_all=True,
        stage_label="unit.sidecar_round_trip",
    )
    sidecar_by_id = {feature["properties"]["id"]: feature for feature in sidecar["features"]}
    assert sidecar_by_id["marine_arctic_ocean"]["properties"]["source_standard"] == "natural_earth"
    assert sidecar_by_id["marine_southern_ocean"]["properties"]["neighbors"] == "marine_arctic_ocean"
