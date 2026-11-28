import json

import geopandas as gpd
from shapely.geometry import Point

from map_builder import config as cfg
from map_builder.cities import emit_default_scenario_city_assets


def write_scenario(root, scenario, *, countries, owners, controllers, featured_tags):
    directory = root / "scenarios" / scenario
    directory.mkdir(parents=True)
    files = {
        "manifest.json": {"scenario_id": scenario, "featured_tags": featured_tags},
        "countries.json": {"countries": countries},
        "owners.by_feature.json": {"owners": owners},
        "controllers.by_feature.json": {"controllers": controllers},
    }
    for name, payload in files.items():
        (directory / name).write_text(json.dumps(payload), encoding="utf-8")
    return directory


def test_soviet_era_renames_apply_only_to_hoi4_1936(tmp_path):
    empty = dict(countries={}, owners={}, controllers={}, featured_tags=[])
    tno = write_scenario(tmp_path, "tno_1962", **empty)
    hoi4 = write_scenario(tmp_path, "hoi4_1936", **empty)
    cities = gpd.GeoDataFrame([{
        "id": "CITY::saint-petersburg", "stable_key": "id::CITY::saint-petersburg",
        "country_code": "RU", "name": "Saint Petersburg", "aliases": ["Saint Petersburg", "Leningrad"],
        "host_feature_id": "RU_CITY_SAINT_PETERSBURG", "geometry": Point(30.3351, 59.9343),
    }], crs="EPSG:4326")
    emit_default_scenario_city_assets(tmp_path, cities)

    payload = json.loads((tno / "city_overrides.json").read_bytes())
    assert payload["cities"] == {}
    assert payload["audit"]["renamed_city_count"] == 0
    payload = json.loads((hoi4 / "city_overrides.json").read_bytes())
    assert payload["cities"]["CITY::saint-petersburg"]["display_name"] == {"en": "Leningrad", "zh": "列宁格勒"}
    assert payload["audit"]["renamed_city_count"] == 1


def test_emit_default_scenario_city_assets_accepts_high_confidence_controlled_capital_without_state_hint(tmp_path):
    directory = write_scenario(
        tmp_path, "modern_world", featured_tags=["US"],
        countries={"US": {"display_name": "United States of America", "lookup_iso2": "US",
                          "base_iso2": "US", "capital_state_id": None}},
        owners={"US_CNTY_11001": "US"}, controllers={"US_CNTY_11001": "STALE"},
    )
    cities = gpd.GeoDataFrame([{
        "id": "CITY::washington", "stable_key": "US::washington-dc", "country_code": "US",
        "name": "Washington, D.C.", "name_ascii": "Washington", "name_en": "Washington, D.C.",
        "name_zh": "华盛顿", "aliases": ["Washington", "Washington, D.C."],
        "host_feature_id": "US_CNTY_11001", "political_feature_id": "US_CNTY_11001",
        "capital_kind": "country_capital", "is_country_capital": True, "population": 4338000,
        "lon": -77.0365, "lat": 38.8977, "geometry": Point(-77.0365, 38.8977),
    }], crs="EPSG:4326")
    emit_default_scenario_city_assets(tmp_path, cities)

    payload = json.loads((directory / "city_overrides.json").read_bytes())
    hint = payload["capital_city_hints"]["US"]
    assert hint["city_id"] == "CITY::washington"
    assert hint["resolution_method"] == "controlled_city_fallback"
    assert payload["audit"]["featured_runtime_missing_tags"] == []
    defaults = json.loads((directory / cfg.SCENARIO_CAPITAL_DEFAULTS_PARTIAL_FILENAME).read_bytes())
    assert defaults["capitals_by_tag"]["US"] == "CITY::washington"
    assert defaults["capital_city_hints"]["US"]["city_id"] == "CITY::washington"
