from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd
import geopandas as gpd
from shapely.geometry import LineString

from tools import download_transport_country_sources as source_downloader
from tools.build_transport_country_real_packs import build_osm_gpkg_road_pack, extract_7z_member_flat, should_keep_camino_mineral_title


class TransportCountrySourceContractsTest(unittest.TestCase):
    def test_osm_gpkg_road_builder_filters_and_writes_standard_pack_keys(self) -> None:
        line_source = gpd.GeoDataFrame(
            [
                {
                    "osm_id": "1",
                    "name": "M1",
                    "fclass": "motorway",
                    "ref": "M1",
                    "geometry": LineString([(0, 0), (1, 1)]),
                },
                {
                    "osm_id": "2",
                    "name": "Farm track",
                    "fclass": "track",
                    "ref": "",
                    "geometry": LineString([(0, 1), (1, 2)]),
                },
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        captured: dict = {}

        def fake_write_pack(*args, **kwargs):
            captured["args"] = args
            captured["kwargs"] = kwargs

        with mock.patch("tools.build_transport_country_real_packs.geofabrik_gpkg_paths", return_value=[("geofabrik_gpkg_fixture", Path("fixture.gpkg"))]):
            with mock.patch("tools.build_transport_country_real_packs.read_geofabrik_gpkg_layer", return_value=line_source):
                with mock.patch("tools.build_transport_country_real_packs.clip_to_carrier", side_effect=lambda gdf, *_args, **_kwargs: gdf):
                    with mock.patch("tools.build_transport_country_real_packs.filter_lines_to_carrier_or_empty", side_effect=lambda gdf, *_args, **_kwargs: gdf):
                        with mock.patch("tools.build_transport_country_real_packs.source_recipe_for", return_value=({}, {})):
                            with mock.patch("tools.build_transport_country_real_packs.write_pack", side_effect=fake_write_pack):
                                build_osm_gpkg_road_pack("china_road", "china", full_limit=10, preview_limit=10)

        preview = captured["args"][3]
        full = captured["args"][4]
        self.assertEqual(captured["args"][:3], ("china_road", "road", "line"))
        self.assertEqual(set(preview), {"roads", "road_labels"})
        self.assertEqual(set(full), {"roads", "road_labels"})
        self.assertEqual(full["roads"]["road_class"].tolist(), ["motorway"])
        self.assertEqual(preview["roads"]["ref"].tolist(), ["M1"])

    def test_bdcarto_member_extract_marker_is_bound_to_archive_signature(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            archive = root / "source.7z"
            output_dir = root / "out"
            archive.write_bytes(b"first-source")
            output_dir.mkdir()
            (output_dir / "troncon_de_route.gpkg").write_bytes(b"stale")
            (output_dir / "troncon_de_route.gpkg.extract-complete").write_text("{}\n", encoding="utf-8")
            calls: list[list[str]] = []

            def fake_run(args, **kwargs):
                calls.append([str(arg) for arg in args])
                (output_dir / "troncon_de_route.gpkg").write_bytes(b"fresh")
                return mock.Mock(returncode=0, stdout="", stderr="")

            with mock.patch("tools.build_transport_country_real_packs.find_7z_executable", return_value="7z"):
                with mock.patch("tools.build_transport_country_real_packs.subprocess.run", side_effect=fake_run):
                    result = extract_7z_member_flat(archive, output_dir, "troncon_de_route.gpkg")

            self.assertEqual(result.read_bytes(), b"fresh")
            self.assertTrue(calls)
            marker = json.loads((output_dir / "troncon_de_route.gpkg.extract-complete").read_text(encoding="utf-8"))
            self.assertEqual(marker["archive"]["size_bytes"], len(b"first-source"))
            self.assertEqual(marker["member_filename"], "troncon_de_route.gpkg")

    def test_arcgis_downloader_uses_count_instead_of_short_page_as_stop_signal(self) -> None:
        class FakeResponse:
            def __init__(self, payload: dict):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return self._payload

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "arcgis.geojson"
            calls: list[dict] = []
            payloads = [
                {"count": 2},
                {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"id": 1}, "geometry": None}]},
                {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"id": 2}, "geometry": None}]},
            ]

            def fake_get(*args, **kwargs):
                calls.append(kwargs.get("params") or {})
                return FakeResponse(payloads.pop(0))

            with mock.patch.object(source_downloader.requests, "get", side_effect=fake_get):
                result = source_downloader.download_arcgis_geojson(
                    "https://example.test/FeatureServer/0",
                    target,
                    {"where": "1=1", "outFields": "id", "returnGeometry": "true", "f": "geojson", "resultRecordCount": "2"},
                )

            payload = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(result["feature_count"], 2)
            self.assertEqual(len(payload["features"]), 2)
            self.assertEqual([call.get("resultOffset") for call in calls[1:]], ["0", "1"])

    def test_wfs_downloader_uses_number_matched_instead_of_short_page_as_stop_signal(self) -> None:
        class FakeResponse:
            def __init__(self, payload: dict):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return self._payload

        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "wfs.geojson"
            calls: list[dict] = []
            payloads = [
                {"type": "FeatureCollection", "numberMatched": 2, "features": [{"type": "Feature", "properties": {"id": 1}, "geometry": None}]},
                {"type": "FeatureCollection", "numberMatched": 2, "features": [{"type": "Feature", "properties": {"id": 2}, "geometry": None}]},
            ]

            def fake_get(*args, **kwargs):
                calls.append(kwargs.get("params") or {})
                return FakeResponse(payloads.pop(0))

            with mock.patch.object(source_downloader.requests, "get", side_effect=fake_get):
                result = source_downloader.download_wfs_geojson(
                    "https://example.test/wfs",
                    target,
                    {"SERVICE": "WFS", "REQUEST": "GetFeature", "COUNT": "2"},
                )

            payload = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(result["feature_count"], 2)
            self.assertEqual(len(payload["features"]), 2)
            self.assertEqual([call.get("STARTINDEX") for call in calls], ["0", "1"])

    def test_france_mineral_filter_keeps_mining_titles_only(self) -> None:
        rows = [
            pd.Series({"domaine": "Minéraux et métaux", "type": "Concession"}),
            pd.Series({"domaine": "Carrières", "type": "Autorisation"}),
            pd.Series({"domaine": "Géothermie", "type": "Permis"}),
            pd.Series({"domaine": "Hydrocarbures liquides ou gazeux", "type": "Permis"}),
        ]

        self.assertEqual([should_keep_camino_mineral_title(row) for row in rows], [True, True, False, False])


if __name__ == "__main__":
    unittest.main()
