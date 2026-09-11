import json
from unittest.mock import patch

import geopandas as gpd
import pytest
from shapely.geometry import MultiPolygon, Polygon
from topojson.utils import serialize_as_geojson

import init_map_data
from map_builder.geo import spherical_safety
from map_builder.geo import topology as topology_module
from map_builder.geo.spherical_safety import (
    NODE_VALIDATION_TIMEOUT_SECONDS,
    PRIMARY_POLAR_WATER_IDS,
    prepare_primary_polar_water_regions,
    repair_primary_polar_water_topology_orientation,
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
    return gpd.GeoDataFrame(
        [
            {
                "id": "marine_arctic_ocean",
                "name": "Arctic Ocean",
                "label": "Arctic Ocean",
                "water_type": "ocean",
                "region_group": "ocean_macro",
                "parent_id": "",
                "neighbors": "marine_southern_ocean",
                "is_chokepoint": False,
                "interactive": False,
                "source_standard": "natural_earth",
                "geometry": MultiPolygon([
                    _ring(150.0, 70.0, 179.5, 84.0),
                    _ring(-179.5, 70.0, -150.0, 84.0),
                ]),
            },
            {
                "id": "marine_southern_ocean",
                "name": "Southern Ocean",
                "label": "Southern Ocean",
                "water_type": "ocean",
                "region_group": "ocean_macro",
                "parent_id": "",
                "neighbors": "marine_arctic_ocean",
                "is_chokepoint": False,
                "interactive": False,
                "source_standard": "natural_earth",
                "geometry": MultiPolygon([
                    _ring(145.0, -82.0, 179.5, -60.0),
                    _ring(-179.5, -82.0, -145.0, -60.0),
                ]),
            },
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )


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


def _topology_repair_fixture() -> dict:
    return {
        "type": "Topology",
        "objects": {
            "water_regions": {
                "type": "GeometryCollection",
                "geometries": [
                    {
                        "type": "Polygon",
                        "id": "marine_arctic_ocean",
                        "properties": {"id": "marine_arctic_ocean"},
                        "arcs": [[1, 0, 2]],
                    },
                    {
                        "type": "Polygon",
                        "id": "marine_other",
                        "properties": {"id": "marine_other"},
                        "arcs": [[-1, 3]],
                    },
                ],
            },
        },
        "arcs": [
            [[10, 70], [10, 80]],
            [[0, 70], [10, 70]],
            [[10, 80], [0, 80], [0, 70]],
            [[10, 70], [20, 70], [20, 80], [10, 80]],
        ],
    }


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


def test_build_water_regions_emits_exact_polar_ids_and_retains_source_properties() -> None:
    source = _polar_water_gdf().rename(columns={"name": "name_en"})[["name_en", "geometry"]]

    built = init_map_data.build_water_regions(source, _empty_gdf())

    polar = built[built["id"].isin(PRIMARY_POLAR_WATER_IDS)].sort_values("id").reset_index(drop=True)
    assert polar["id"].tolist() == sorted(PRIMARY_POLAR_WATER_IDS)
    assert polar["source_standard"].tolist() == ["natural_earth", "natural_earth"]
    assert polar["region_group"].tolist() == ["ocean_macro", "ocean_macro"]
    assert polar["interactive"].tolist() == [False, False]
    validate_primary_polar_water_feature_collection(
        json.loads(polar.to_json(drop_id=True)),
        require_all=True,
        stage_label="unit.generator",
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


def test_topology_orientation_repair_changes_only_invalid_target_part_refs() -> None:
    topology = _topology_repair_fixture()
    original_arcs = json.loads(json.dumps(topology["arcs"]))
    original_non_target_refs = json.loads(json.dumps(
        topology["objects"]["water_regions"]["geometries"][1]["arcs"]
    ))
    assert original_non_target_refs[0][0] == ~0
    original_feature_collection = serialize_as_geojson(topology, objectname="water_regions")
    original_non_target_geometry = next(
        feature["geometry"]
        for feature in original_feature_collection["features"]
        if feature["properties"]["id"] == "marine_other"
    )

    with pytest.raises(ValueError, match=r"(excessive spherical area|world bounds)"):
        validate_primary_polar_water_topology(
            topology,
            require_all=False,
            stage_label="unit.repair_fixture_before",
        )

    modified_part_count = repair_primary_polar_water_topology_orientation(topology)

    assert modified_part_count == 1
    assert topology["arcs"] == original_arcs
    geometries = topology["objects"]["water_regions"]["geometries"]
    assert geometries[0]["arcs"] == [[-3, -1, -2]]
    assert geometries[1]["arcs"] == original_non_target_refs
    repaired_feature_collection = serialize_as_geojson(topology, objectname="water_regions")
    repaired_non_target_geometry = next(
        feature["geometry"]
        for feature in repaired_feature_collection["features"]
        if feature["properties"]["id"] == "marine_other"
    )
    assert repaired_non_target_geometry == original_non_target_geometry
    validate_primary_polar_water_topology(
        topology,
        require_all=False,
        stage_label="unit.repair_fixture_after",
    )


def test_primary_topology_rethrows_initial_validation_error_when_repair_changes_zero_parts(tmp_path) -> None:
    output_path = tmp_path / "primary.json"
    original_error = ValueError("initial polar topology validation failed")

    with (
        patch.object(topology_module, "validate_primary_polar_water_topology", side_effect=original_error) as validate_mock,
        patch.object(topology_module, "repair_primary_polar_water_topology_orientation", return_value=0) as repair_mock,
        pytest.raises(ValueError, match="initial polar topology validation failed") as exc_info,
    ):
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

    assert exc_info.value is original_error
    validate_mock.assert_called_once()
    repair_mock.assert_called_once()


def test_polar_validator_requires_both_exact_primary_ids() -> None:
    prepared = prepare_primary_polar_water_regions(_polar_water_gdf().iloc[[0]].copy())

    with pytest.raises(ValueError, match="expected ids"):
        validate_primary_polar_water_feature_collection(
            json.loads(prepared.to_json(drop_id=True)),
            require_all=True,
            stage_label="unit.missing_peer",
        )


def test_d3_node_start_failure_reports_stage_purpose_and_timeout() -> None:
    feature_collection = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"id": "marine_arctic_ocean"},
            "geometry": _ring(-30.0, 70.0, 30.0, 85.0).__geo_interface__,
        }],
    }
    with patch.object(spherical_safety.subprocess, "run", side_effect=OSError("node unavailable")) as run_mock:
        with pytest.raises(
            RuntimeError,
            match=r"D3 spherical diagnostics could not start Node at unit\.d3_start: node unavailable",
        ):
            validate_primary_polar_water_feature_collection(
                feature_collection,
                require_all=False,
                stage_label="unit.d3_start",
            )
    assert run_mock.call_args.kwargs["timeout"] == NODE_VALIDATION_TIMEOUT_SECONDS


def test_topojson_node_start_failure_reports_stage_purpose_and_timeout() -> None:
    with patch.object(spherical_safety.subprocess, "run", side_effect=OSError("node unavailable")) as run_mock:
        with pytest.raises(
            RuntimeError,
            match=r"TopoJSON round-trip decoding could not start Node at unit\.topology_start.*node unavailable",
        ):
            validate_primary_polar_water_topology(
                _topology_repair_fixture(),
                require_all=False,
                stage_label="unit.topology_start",
            )
    assert run_mock.call_args.kwargs["timeout"] == NODE_VALIDATION_TIMEOUT_SECONDS


@pytest.mark.parametrize(
    "feature_id,geometry",
    [
        ("marine_arctic_ocean", _ring(-30.0, 70.0, 30.0, 85.0)),
        ("marine_southern_ocean", _ring(-30.0, -85.0, 30.0, -60.0)),
    ],
)
def test_polar_validator_fails_closed_for_world_bounds_or_excessive_area(feature_id, geometry) -> None:
    feature_collection = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"id": feature_id},
            "geometry": geometry.__geo_interface__,
        }],
    }

    with pytest.raises(ValueError, match=r"(excessive spherical area|world bounds)"):
        validate_primary_polar_water_feature_collection(
            feature_collection,
            expected_ids=[feature_id],
            require_all=True,
            stage_label="unit.invalid",
        )
