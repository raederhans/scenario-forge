"""Unit tests for bounded source processor registry."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import geopandas as gpd
from shapely.geometry import Polygon

from map_builder.regional_processors import (
    EXPLICIT_UNSUPPORTED_BROAD_SCOPE_PROCESSORS,
    REGIONAL_PROCESSOR_UNITS,
    SUPPORTED_COUNTRY_CODES,
    apply_selected_processors,
    apply_with_subset_guard,
    get_supported_country_codes,
    get_supported_coverage_limits,
    resolve_processor_units,
)


def _make_dummy_gdf() -> gpd.GeoDataFrame:
    """Create a clean multi-country GeoDataFrame for unit tests."""
    records = [
        {"id": "FR_01", "cntr_code": "FR", "name": "France Unit", "geometry": Polygon([(0, 0), (1, 0), (1, 1), (0, 0)])},
        {"id": "DE_01", "cntr_code": "DE", "name": "Germany Unit", "geometry": Polygon([(2, 0), (3, 0), (3, 1), (2, 0)])},
        {"id": "RU_01", "cntr_code": "RU", "name": "Russia Unit", "geometry": Polygon([(4, 0), (5, 0), (5, 1), (4, 0)])},
        {"id": "UA_01", "cntr_code": "UA", "name": "Ukraine Unit", "geometry": Polygon([(6, 0), (7, 0), (7, 1), (6, 0)])},
        {"id": "DK_01", "cntr_code": "DK", "name": "Denmark Unit", "geometry": Polygon([(8, 0), (9, 0), (9, 1), (8, 0)])},
    ]
    return gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")


class RegionalProcessorsRegistryTests(unittest.TestCase):
    def test_supported_coverage_limits(self) -> None:
        supported = get_supported_country_codes()
        expected = set(SUPPORTED_COUNTRY_CODES)
        self.assertEqual(supported, expected)
        self.assertEqual(SUPPORTED_COUNTRY_CODES, expected)

        limits = get_supported_coverage_limits()
        self.assertEqual(set(limits["supported_countries"]), expected)
        self.assertIn("RU", limits["coupled_expansions"])
        self.assertEqual(limits["coupled_expansions"]["RU"], ["RU", "UA"])
        self.assertEqual(limits["coupled_expansions"]["CZ"], ["CZ", "SK"])
        self.assertEqual(limits["coupled_expansions"]["US"], ["CA", "MX", "US"])
        self.assertEqual(
            limits["unsupported_broad_scope_processors"],
            list(EXPLICIT_UNSUPPORTED_BROAD_SCOPE_PROCESSORS),
        )
        self.assertIn("explicit replacement GeoJSON", limits["policy"])

    def test_resolve_france_master_precision(self) -> None:
        units = resolve_processor_units(["FR"])
        self.assertEqual(len(units), 1)
        fr_unit = units[0]
        self.assertEqual(fr_unit["name"], "france_master_precision")
        self.assertEqual(fr_unit["countries"], ["FR"])
        self.assertEqual(
            fr_unit["callable"],
            "map_builder.processors.france:apply_france_master_precision",
        )
        self.assertIn("France", fr_unit["reason"])

    def test_resolve_ru_expansion(self) -> None:
        # Selecting RU alone expands to RU+UA
        units_ru = resolve_processor_units(["RU"])
        self.assertEqual(len(units_ru), 1)
        self.assertEqual(units_ru[0]["name"], "russia_ukraine")
        self.assertEqual(units_ru[0]["countries"], ["RU", "UA"])

        # Selecting UA alone expands to RU+UA
        units_ua = resolve_processor_units(["UA"])
        self.assertEqual(len(units_ua), 1)
        self.assertEqual(units_ua[0]["name"], "russia_ukraine")
        self.assertEqual(units_ua[0]["countries"], ["RU", "UA"])

        # Selecting both RU and UA yields single deduplicated unit
        units_both = resolve_processor_units(["RU", "UA"])
        self.assertEqual(len(units_both), 1)
        self.assertEqual(units_both[0]["name"], "russia_ukraine")

    def test_resolve_cz_sk_expansion(self) -> None:
        units_cz = resolve_processor_units(["CZ"])
        self.assertEqual(len(units_cz), 1)
        self.assertEqual(units_cz[0]["name"], "cz_sk_border_detail")
        self.assertEqual(units_cz[0]["countries"], ["CZ", "SK"])

        units_sk = resolve_processor_units(["SK"])
        self.assertEqual(len(units_sk), 1)
        self.assertEqual(units_sk[0]["name"], "cz_sk_border_detail")
        self.assertEqual(units_sk[0]["countries"], ["CZ", "SK"])

    def test_resolve_north_america_expansion(self) -> None:
        for code in ("US", "CA", "MX"):
            units = resolve_processor_units([code])
            self.assertEqual(len(units), 1)
            self.assertEqual(units[0]["name"], "north_america")
            self.assertEqual(units[0]["countries"], ["CA", "MX", "US"])

        units_all = resolve_processor_units(["US", "CA", "MX"])
        self.assertEqual(len(units_all), 1)
        self.assertEqual(units_all[0]["name"], "north_america")

    def test_resolve_multiple_countries_canonical_order(self) -> None:
        # Provide multiple countries in non-canonical order
        units = resolve_processor_units(["AU", "DK", "FR", "RU"])
        names = [u["name"] for u in units]
        self.assertEqual(
            names,
            ["france_master_precision", "denmark_border_detail", "russia_ukraine", "au_city_overrides"],
        )

    def test_alias_owner_confusion_rejected(self) -> None:
        # ISO3 scenario owners and tags must be rejected
        for invalid_owner in ("RUS", "FRA", "USA", "SOV", "GER", "POL", "CZE"):
            with self.assertRaises(ValueError) as ctx:
                resolve_processor_units([invalid_owner])
            err_msg = str(ctx.exception)
            self.assertIn("Alias or scenario owner", err_msg)
            self.assertIn("Explicit replacement GeoJSON required", err_msg)

    def test_unknown_and_broad_scope_codes_rejected(self) -> None:
        # Global basic countries and unknown codes raise actionable ValueError
        for code in ("DE", "ZZ"):
            with self.assertRaises(ValueError) as ctx:
                resolve_processor_units([code])
            err_msg = str(ctx.exception)
            self.assertIn("Unsupported source country code", err_msg)
            self.assertIn("explicit replacement GeoJSON", err_msg)

    def test_invalid_formats_rejected(self) -> None:
        for bad_val in ("", " ", "U", "12", "R1", None, 123):
            with self.assertRaises(ValueError) as ctx:
                resolve_processor_units([bad_val])  # type: ignore[list-item]
            self.assertIn("Explicit replacement GeoJSON required", str(ctx.exception))

    def test_apply_selected_processors_ru_expansion_no_mutation_to_nonselected(self) -> None:
        master = _make_dummy_gdf()
        original_fr_geom = master.loc[master["cntr_code"] == "FR", "geometry"].iloc[0]
        original_de_geom = master.loc[master["cntr_code"] == "DE", "geometry"].iloc[0]

        # Mock russia_ukraine processor that replaces RU and UA geometries
        def mock_ru_ua_proc(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
            base = gdf[~gdf["cntr_code"].isin({"RU", "UA"})].copy()
            new_ru = gpd.GeoDataFrame([
                {
                    "id": "RU_NEW_01",
                    "cntr_code": "RU",
                    "name": "Russia Replaced",
                    "geometry": Polygon([(4.1, 0.1), (5.1, 0.1), (5.1, 1.1), (4.1, 0.1)]),
                }
            ], geometry="geometry", crs="EPSG:4326")
            new_ua = gpd.GeoDataFrame([
                {
                    "id": "UA_NEW_01",
                    "cntr_code": "UA",
                    "name": "Ukraine Replaced",
                    "geometry": Polygon([(6.1, 0.1), (7.1, 0.1), (7.1, 1.1), (6.1, 0.1)]),
                }
            ], geometry="geometry", crs="EPSG:4326")
            import pandas as pd
            return gpd.GeoDataFrame(
                pd.concat([base, new_ru, new_ua], ignore_index=True),
                crs="EPSG:4326",
            )

        # Apply processor for RU alone (which expands to RU+UA)
        result = apply_selected_processors(
            master,
            ["RU"],
            processor_overrides={"russia_ukraine": mock_ru_ua_proc},
        )

        # Check RU and UA were updated
        self.assertIn("RU_NEW_01", result["id"].tolist())
        self.assertIn("UA_NEW_01", result["id"].tolist())
        self.assertNotIn("RU_01", result["id"].tolist())
        self.assertNotIn("UA_01", result["id"].tolist())

        # Check nonselected countries FR and DE have exact same geometries
        res_fr_geom = result.loc[result["cntr_code"] == "FR", "geometry"].iloc[0]
        res_de_geom = result.loc[result["cntr_code"] == "DE", "geometry"].iloc[0]
        self.assertTrue(original_fr_geom.equals(res_fr_geom))
        self.assertTrue(original_de_geom.equals(res_de_geom))

    def test_apply_selected_processors_preserves_nonselected_even_if_rogue_processor_touches_them(self) -> None:
        master = _make_dummy_gdf()
        original_de_geom = master.loc[master["cntr_code"] == "DE", "geometry"].iloc[0]
        original_fr_geom = master.loc[master["cntr_code"] == "FR", "geometry"].iloc[0]

        # Rogue processor that illegally alters DE and FR while processing RU
        def rogue_ru_proc(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
            altered = gdf.copy()
            # Mutate everything
            altered["geometry"] = Polygon([(99, 99), (100, 99), (100, 100), (99, 99)])
            altered["id"] = "CORRUPTED"
            return altered

        result = apply_selected_processors(
            master,
            ["RU"],
            processor_overrides={"russia_ukraine": rogue_ru_proc},
        )

        # Nonselected country DE and FR must be protected from mutation
        res_de_geom = result.loc[result["cntr_code"] == "DE", "geometry"].iloc[0]
        res_fr_geom = result.loc[result["cntr_code"] == "FR", "geometry"].iloc[0]
        self.assertTrue(original_de_geom.equals(res_de_geom))
        self.assertTrue(original_fr_geom.equals(res_fr_geom))
        self.assertEqual(result.loc[result["cntr_code"] == "DE", "id"].iloc[0], "DE_01")
        self.assertEqual(result.loc[result["cntr_code"] == "FR", "id"].iloc[0], "FR_01")

    def test_apply_selected_processors_empty_codes_returns_copy(self) -> None:
        master = _make_dummy_gdf()
        result = apply_selected_processors(master, [])
        self.assertEqual(len(result), len(master))
        self.assertTrue(result.equals(master))

    def test_apply_with_subset_guard(self) -> None:
        master = _make_dummy_gdf()
        original_fr_geom = master.loc[master["cntr_code"] == "FR", "geometry"].iloc[0]

        def modifying_proc(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
            out = gdf.copy()
            out.loc[out["cntr_code"] == "RU", "geometry"] = Polygon([(10, 10), (11, 10), (11, 11), (10, 10)])
            out.loc[out["cntr_code"] == "FR", "geometry"] = Polygon([(20, 20), (21, 20), (21, 21), (20, 20)])
            return out

        guarded = apply_with_subset_guard(modifying_proc, master, ["RU"])
        # Target RU was updated
        ru_geom = guarded.loc[guarded["cntr_code"] == "RU", "geometry"].iloc[0]
        self.assertTrue(ru_geom.equals(Polygon([(10, 10), (11, 10), (11, 11), (10, 10)])))
        # Non-target FR was protected
        fr_geom = guarded.loc[guarded["cntr_code"] == "FR", "geometry"].iloc[0]
        self.assertTrue(fr_geom.equals(original_fr_geom))

    def test_apply_selected_processors_dynamic_import_call(self) -> None:
        master = _make_dummy_gdf()
        mock_proc = MagicMock(return_value=master)
        with patch("map_builder.regional_processors._load_callable", return_value=mock_proc):
            result = apply_selected_processors(master, ["FR"])
            self.assertEqual(len(result), len(master))
            mock_proc.assert_called_once()

    def test_apply_selected_processors_batches_africa_basic_units(self) -> None:
        master = _make_dummy_gdf()
        calls = []

        def batch(gdf, *, country_codes):
            calls.append(set(country_codes))
            return gdf

        with patch("map_builder.regional_processors._load_callable", return_value=batch):
            apply_selected_processors(master, ["AO", "BJ"])
        self.assertEqual(calls, [{"AO", "BJ"}])

    def test_apply_selected_processors_batches_global_basic_units(self) -> None:
        master = _make_dummy_gdf()
        calls = []

        def batch(gdf, *, country_codes):
            calls.append(set(country_codes))
            return gdf

        with patch("map_builder.regional_processors._load_callable", return_value=batch):
            apply_selected_processors(master, ["AR", "BR"])
        self.assertEqual(calls, [{"AR", "BR"}])


if __name__ == "__main__":
    unittest.main()
