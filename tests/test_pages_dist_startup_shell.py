from __future__ import annotations

import os
import base64
import re
import subprocess
import unittest
import gzip
import hashlib
import json
import struct
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from tools import build_pages_dist
from tools.pages_artifact_root import resolve_pages_artifact_root
from tools.scenario_contract_paths import TNO_COVERAGE_REPORT_PATHS


REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIST_ROOT = resolve_pages_artifact_root(repo_root=REPO_ROOT)
LANDING_INDEX = REPO_ROOT / "landing" / "index.html"
LANDING_APP_JS = REPO_ROOT / "landing" / "app.js"
LANDING_ASSETS = REPO_ROOT / "landing" / "assets"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
DRAW_CANVAS_ORCHESTRATION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "draw_canvas_orchestration_owner.js"
CACHED_PASS_COMPOSITOR_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "cached_pass_compositor_owner.js"
DIST_ROOT_INDEX = PAGES_DIST_ROOT / "index.html"
DIST_APP_JS = PAGES_DIST_ROOT / "app.js"
EDITOR_INDEX = REPO_ROOT / "index.html"
DIST_APP_INDEX = PAGES_DIST_ROOT / "app" / "index.html"
DIST_APP_JS_ROOT = PAGES_DIST_ROOT / "app" / "js"
DIST_MANIFEST = PAGES_DIST_ROOT / "pages-dist-manifest.json"
VERIFY_SHARED_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "verify-shared.yml"
HERO_SCENARIO_ASSETS = (
    ("blank", "blank_base", "hero-blank.svg", "hero-blank.json"),
    ("hoi4-1936", "hoi4_1936", "hero-hoi4-1936.svg", "hero-hoi4-1936.json"),
    ("hoi4-1939", "hoi4_1939", "hero-hoi4-1939.svg", "hero-hoi4-1939.json"),
    ("tno-1962", "tno_1962", "hero-tno-1962.svg", "hero-tno-1962.json"),
)


def import_landing_builder(module_name: str):
    try:
        module = __import__(f"tools.{module_name}", fromlist=[module_name])
    except ModuleNotFoundError as exc:
        missing_name = exc.name or ""
        if missing_name.split(".", 1)[0] in {"shapely", "topojson", "PIL"}:
            raise unittest.SkipTest(f"landing asset builder dependency is unavailable: {missing_name}") from exc
        raise
    return module


class PagesDistStartupShellTest(unittest.TestCase):
    def test_runtime_copy_publishes_global_and_scenario_depth_textures(self):
        from unittest.mock import patch
        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            root = Path(temporary)
            app = root / "output/app"
            files = {
                "data/scenarios/index.json": b'{"scenarios":[]}',
                "data/bathymetry/global/manifest.json": b'{"kind":"bathymetry_depth_texture"}',
                "data/bathymetry/global/overview.png": b'overview',
                "data/bathymetry/global/tiles/0_0.png": b'tile',
                "data/scenarios/tno_1962/manifest.json": b'{"bathymetry_texture_url":"data/scenarios/tno_1962/bathymetry_texture/manifest.json"}',
                "data/scenarios/tno_1962/bathymetry_texture/manifest.json": b'{"kind":"bathymetry_depth_overlay"}',
                "data/scenarios/tno_1962/bathymetry_texture/overlay.png": b'overlay',
            }
            for relative, payload in files.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(payload)
            with patch.object(build_pages_dist, "ROOT", root), patch.object(build_pages_dist, "APP_DIST_ROOT", app):
                build_pages_dist.copy_runtime_data()
            for relative, payload in files.items():
                with self.subTest(path=relative):
                    copied = app / relative
                    self.assertTrue(copied.is_file())
                    if copied.suffix == ".png":
                        self.assertEqual(copied.read_bytes(), payload)
            self.assertEqual(json.loads((app / "data/scenarios/tno_1962/manifest.json").read_text())["bathymetry_texture_url"],
                             "data/scenarios/tno_1962/bathymetry_texture/manifest.json")

    def test_scenario_copy_skips_stale_chunks_with_identical_packed_artifact(self):
        from unittest.mock import patch
        from tools.runtime_json_packing import pack_published_runtime_data
        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            root = Path(temporary)
            source = root / "data/scenarios"
            scenario = source / "sample"
            chunks = scenario / "chunks"
            chunks.mkdir(parents=True)
            raw = b'{ "type": "FeatureCollection", "features": [] }'
            (chunks / "live.json").write_bytes(raw)
            (chunks / "encoded.json.gz").write_bytes(gzip.compress(raw, mtime=0))
            (chunks / "stale.json").write_bytes(raw)
            (chunks / "stale.json.gz").write_bytes(gzip.compress(raw, mtime=0))
            (chunks / "license.txt").write_text("keep provenance", encoding="utf-8")
            (chunks / "nested").mkdir()
            (chunks / "nested/local.json").write_bytes(raw)
            offline = source / "offline/chunks"
            offline.mkdir(parents=True)
            (offline / "local.json").write_bytes(raw)
            detail_url = "data/scenarios/sample/detail_chunks.manifest.json"
            (scenario / "manifest.json").write_text(json.dumps({"detail_chunk_manifest_url": detail_url}), encoding="utf-8")
            whole_owner_id = "political.detail.country.fra"
            feature_tokens = [b'{"type":"Feature","properties":{"id":"F' + str(i).encode() + b'"},"geometry":{"type":"Point","coordinates":[' + str(i).encode() + b',1.234567890123456789]}}' for i in [3, 1, 2, 0]]
            (chunks / (whole_owner_id + ".json")).write_bytes(
                b'{"type":"FeatureCollection","features":[' + b','.join(feature_tokens) + b']}')
            (scenario / "detail_chunks.manifest.json").write_text(json.dumps({"chunks": [
                {"id": "live", "url": "data/scenarios/sample/chunks/live.json"},
                {"id": "encoded", "url": "data/scenarios/sample/chunks/encoded.json.gz", "encoding": "gzip"},
                {"id": whole_owner_id, "layer": "political", "lod": "detail", "country_codes": ["FRA"],
                 "url": f"data/scenarios/sample/chunks/{whole_owner_id}.json"},
            ]}), encoding="utf-8")
            (scenario / "context_lod.manifest.json").write_text(json.dumps({"layers": {"political": [{"chunk_ids": [whole_owner_id]}]}}), encoding="utf-8")
            (scenario / "runtime_meta.json").write_text("{}", encoding="utf-8")
            original_source = {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()}
            artifacts = []
            copied = []
            real_copy = build_pages_dist.shutil.copy2
            for optimized in (False, True):
                app = root / ("new" if optimized else "old")
                with patch.object(build_pages_dist, "ROOT", root), patch.object(build_pages_dist, "APP_DIST_ROOT", app):
                    with patch.object(build_pages_dist.shutil, "copy2", wraps=real_copy) as copy:
                        if optimized:
                            build_pages_dist.copy_scenario_runtime_data()
                        else:
                            policy = build_pages_dist.build_pages_production_publication_policy(source)
                            build_pages_dist.copy_tree_filtered(source, app / "data/scenarios",
                                lambda _relative, p: policy.allows(p.relative_to(root)))
                            build_pages_dist.strip_scenario_publish_audit_urls(app / "data/scenarios")
                        copied.append([Path(call.args[0]).relative_to(source) for call in copy.call_args_list])
                    with patch("tools.political_detail_partition.POLITICAL_DETAIL_SHARD_MAX_PATH_COST", 24):
                        pack_published_runtime_data(app)
                    manifest = json.loads((app / detail_url).read_bytes())
                    political_chunks = [chunk for chunk in manifest["chunks"] if chunk.get("layer") == "political"]
                    self.assertEqual(len(political_chunks), 2)
                    decoded = [gzip.decompress((app / chunk["url"]).read_bytes()) for chunk in political_chunks]
                    self.assertEqual(sum(len(json.loads(part)["features"]) for part in decoded), 4)
                    for token in feature_tokens:
                        self.assertEqual(sum(token in part for part in decoded), 1)
                    context = json.loads((app / "data/scenarios/sample/context_lod.manifest.json").read_bytes())
                    self.assertEqual(context["layers"]["political"][0]["chunk_ids"], [chunk["id"] for chunk in political_chunks])
                    meta = json.loads((app / "data/scenarios/sample/runtime_meta.json").read_bytes())
                    self.assertEqual(meta["total_chunk_count"], len(manifest["chunks"]))
                    self.assertEqual(meta["political_chunk_count"], 2)
                    self.assertFalse((app / f"data/scenarios/sample/chunks/{whole_owner_id}.json").exists())
                artifacts.append({p.relative_to(app): p.read_bytes() for p in app.rglob("*") if p.is_file()})
            self.assertEqual(artifacts[0], artifacts[1])
            self.assertEqual(set(copied[0]) - set(copied[1]), {Path("sample/chunks/stale.json"), Path("sample/chunks/stale.json.gz")})
            self.assertEqual(len(copied[0]) - len(copied[1]), 2)
            for path in ("sample/chunks/license.txt", "sample/chunks/nested/local.json", "offline/chunks/local.json"):
                self.assertIn(Path(path), copied[1])
            self.assertEqual(original_source, {p.relative_to(source): p.read_bytes() for p in source.rglob("*") if p.is_file()})

    def test_scenario_chunk_copy_filter_rejects_invalid_or_escaping_manifest(self):
        from unittest.mock import patch
        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            root = Path(temporary)
            source = root / "data/scenarios"
            scenario = source / "sample"
            scenario.mkdir(parents=True)
            manifest = scenario / "detail_chunks.manifest.json"
            with patch.object(build_pages_dist, "ROOT", root):
                for payload in ([], {"chunks": {}}, {"chunks": [None]}, {"chunks": [{"url": "data/scenarios/other/chunks/x.json"}]}):
                    with self.subTest(payload=payload):
                        manifest.write_text(json.dumps(payload), encoding="utf-8")
                        with self.assertRaises(ValueError):
                            build_pages_dist.unreferenced_scenario_chunk_paths(source)
                manifest.write_text("{broken", encoding="utf-8")
                with self.assertRaises(json.JSONDecodeError):
                    build_pages_dist.unreferenced_scenario_chunk_paths(source)

    def test_native_hgo_has_closed_assets_and_separate_navigation(self):
        native = PAGES_DIST_ROOT / "hgo"
        self.assertTrue((native / "index.html").is_file())
        self.assertIn('href="../app/"', (native / "index.html").read_text(encoding="utf-8"))
        self.assertIn('href="../hgo/"', DIST_APP_INDEX.read_text(encoding="utf-8"))
        self.assertIn('href="./hgo/"', DIST_ROOT_INDEX.read_text(encoding="utf-8"))
        dataset = json.loads((native / "assets/default/manifest.json").read_bytes())
        self.assertEqual(dataset["format"], "hgo-native-dataset")
        self.assertEqual(dataset["coordinateSpace"]["kind"], "pixel")
        for asset in dataset["assets"].values():
            data = (native / "assets/default" / asset["url"]).read_bytes()
            self.assertEqual(len(data), asset["byteLength"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), asset["sha256"])
        self.assertFalse((native / "tools").exists())
        self.assertFalse((native / "tests").exists())
        self.assertFalse((PAGES_DIST_ROOT / "app/data/hgo_runtime").exists())
        self.assertFalse((PAGES_DIST_ROOT / "app/data/scenarios/hgo_1936").exists())

    def test_native_and_main_module_graphs_do_not_import_each_other(self):
        manifest = json.loads(DIST_MANIFEST.read_bytes())
        inventory = manifest["reachability_inventory"]
        graph = inventory["module_graph"]
        self.assertIn("hgo", [entry["id"] for entry in graph["entrypoints"]])
        self.assertEqual(graph["unresolved_references"], [])
        native_nodes = [node for node in graph["nodes"] if node["path"].startswith("hgo/")]
        self.assertTrue(native_nodes)
        for node in graph["nodes"]:
            for reference in node["static_imports"] + node["dynamic_imports"] + node["resource_references"]:
                if node["path"].startswith("hgo/"):
                    self.assertTrue(reference.startswith("hgo/"), (node["path"], reference))
                elif node["path"].startswith("app/js/"):
                    self.assertFalse(reference.startswith("hgo/"), (node["path"], reference))
        native_rule = next(rule for rule in inventory["product_inventory"]["registry_rules"]
                           if rule["id"] == "hgo-native-editor")
        self.assertEqual(native_rule["category"], "on-demand-product")
        self.assertEqual(native_rule["owner"], "hgo-native-editor")

    def test_chunked_gzip_runtime_exclusion_and_unpublished_url_stripping(self) -> None:
        from unittest.mock import patch
        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app = Path(temporary)
            scenarios = app / "data/scenarios"
            scenario = scenarios / "gzip_fixture"
            scenario.mkdir(parents=True)
            runtime_url = "data/scenarios/gzip_fixture/runtime_topology.topo.json.gz"
            payload = {"detail_chunk_manifest_url": "data/scenarios/gzip_fixture/detail_chunks.manifest.json", "runtime_topology_url": runtime_url}
            (scenario / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
            bundle = scenario / "startup.bundle.en.json"
            bundle.write_text(json.dumps({"manifest_subset": payload}), encoding="utf-8")
            bundle.with_suffix(".json.gz").write_bytes(gzip.compress(bundle.read_bytes(), mtime=0))
            policy = build_pages_dist.build_pages_production_publication_policy(scenarios)
            for path in (runtime_url, runtime_url.removesuffix(".gz")):
                self.assertFalse(policy.allows(path))
                self.assertFalse(policy.allows("app/" + path))
            self.assertTrue(policy.allows("data/scenarios/gzip_fixture/runtime_topology.bootstrap.topo.json"))
            with patch.object(build_pages_dist, "APP_DIST_ROOT", app):
                build_pages_dist.strip_scenario_publish_audit_urls(scenarios)
            self.assertNotIn("runtime_topology_url", json.loads((scenario / "manifest.json").read_text(encoding="utf-8")))
            self.assertNotIn("runtime_topology_url", json.loads(bundle.read_text(encoding="utf-8"))["manifest_subset"])
            self.assertEqual(json.loads(gzip.decompress(bundle.with_suffix(".json.gz").read_bytes())), json.loads(bundle.read_bytes()))

    def test_all_registered_river_packs_are_published_with_registry_entries(self):
        source_registry = json.loads((REPO_ROOT / "data/runtime_asset_registry.json").read_text(encoding="utf-8"))
        published_registry = json.loads((PAGES_DIST_ROOT / "app/data/runtime_asset_registry.json").read_text(encoding="utf-8"))
        packs = {key: asset for key, asset in source_registry["assets"].items() if key.startswith("river_partitions:")}
        self.assertTrue(packs)
        for key, asset in packs.items():
            with self.subTest(asset=key):
                self.assertIn(key, published_registry["assets"])
                source = REPO_ROOT / asset["url"]
                published = PAGES_DIST_ROOT / "app" / asset["url"]
                self.assertTrue(published.is_file(), f"Missing published river pack: {key}")
                self.assertEqual(json.loads(source.read_text(encoding="utf-8")), json.loads(published.read_text(encoding="utf-8")))

    def test_published_modern_world_keeps_renderable_runtime_topology(self):
        app_root = PAGES_DIST_ROOT / "app"
        manifest = json.loads((app_root / "data/scenarios/modern_world/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["runtime_topology_url"], "data/scenarios/modern_world/runtime_topology.topo.json")
        topology = json.loads((app_root / manifest["runtime_topology_url"]).read_text(encoding="utf-8"))
        geometries = topology["objects"]["political"]["geometries"]
        self.assertTrue(any(item.get("type") in {"Polygon", "MultiPolygon"} and item.get("arcs")
                            for item in geometries))


    def test_landing_social_preview_contract(self) -> None:
        svg_path = LANDING_ASSETS / "social-preview.svg"
        png_path = LANDING_ASSETS / "social-preview.png"
        svg_text = svg_path.read_text(encoding="utf-8")
        svg_root = ET.fromstring(svg_text)
        self.assertEqual(svg_root.attrib.get("viewBox"), "0 0 1200 630")
        self.assertEqual(svg_root.attrib.get("data-social-preview"), "scenario-forge")
        self.assertIn("Scenario Forge", " ".join(svg_root.itertext()))
        for brand_color in ("#f6f3eb", "#232b29", "#47654b"):
            with self.subTest(brand_color=brand_color):
                self.assertIn(brand_color, svg_text)

        workspace_image = svg_root.find("{http://www.w3.org/2000/svg}image")
        self.assertIsNotNone(workspace_image)
        image_uri = workspace_image.attrib["{http://www.w3.org/1999/xlink}href"]
        self.assertTrue(image_uri.startswith("data:image/png;base64,"))
        embedded_image = base64.b64decode(image_uri.split(",", 1)[1], validate=True)
        self.assertEqual(embedded_image[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", embedded_image[16:24]), (3200, 1800))

        png_bytes = png_path.read_bytes()
        self.assertEqual(png_bytes[:8], b"\x89PNG\r\n\x1a\n")
        self.assertGreaterEqual(len(png_bytes), 24)
        self.assertEqual(struct.unpack(">II", png_bytes[16:24]), (1200, 630))

        from tools import rasterize_landing_assets

        for source, output, *_ in rasterize_landing_assets.RASTER_TARGETS:
            with self.subTest(source=source):
                self.assertTrue((LANDING_ASSETS / source).exists(), f"raster source {source} is missing")
                self.assertTrue(output.endswith(".webp"))
        self.assertEqual(
            rasterize_landing_assets.PNG_RASTER_TARGETS,
            (("social-preview.svg", "social-preview.png", 1200, 630, 100),),
        )
        self.assertEqual(
            rasterize_landing_assets.ALL_RASTER_TARGETS,
            rasterize_landing_assets.RASTER_TARGETS + rasterize_landing_assets.PNG_RASTER_TARGETS,
        )

    def test_landing_japan_preview_metadata_uses_checked_in_sources(self) -> None:
        metadata_path = LANDING_ASSETS / "japan-preview.json"
        self.assertTrue(metadata_path.exists(), "Japan preview metadata should be checked in")
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        expected_sources = {
            "data/transport_layers/japan_corridor/carrier.json",
            "data/transport_layers/japan_road/roads.preview.topo.json",
            "data/transport_layers/japan_rail/railways.preview.topo.json",
            "data/transport_layers/japan_rail/rail_stations_major.preview.geojson",
            "data/world_cities.geojson",
            "data/global_contours.major.topo.json",
            "data/global_contours.minor.topo.json",
            "data/global_rivers.geojson",
            "data/global_bathymetry.topo.json",
            "js/core/city_lights_modern_asset.js",
            "data/city_lights/historical_1930_entries.json",
        }
        self.assertEqual(set(payload["sources"]), expected_sources)
        self.assertEqual(payload["scope"]["profile"], "Japan main-islands preview")
        self.assertIn("Okinawa is outside this frame", payload["scope"]["note"])
        self.assertEqual(
            payload["carrier_binding"],
            {
                "cross_mask_policy": "caller-must-provide-frame-for-lines-and-polygons",
                "fit_geometry_type": "MultiPolygon",
                "frame_id": "main",
                "frame_label": "Japan four islands",
                "source_file": "data/transport_layers/japan_corridor/carrier.json",
            },
        )
        self.assertEqual(payload["projection"]["name"], "geoConicConformal")
        self.assertEqual(payload["projection"]["center"], [136.5, 35.0])
        self.assertEqual(payload["projection"]["parallels"], [33.0, 37.0])
        self.assertGreater(payload["projection"]["fit_scale"], 0)
        self.assertEqual(payload["projection"]["scale_semantics"], "projection fit from carrier coordinates to SVG pixels")
        self.assertEqual(payload["ui_zoom"]["ownership"], "landing/app.js consumer")
        self.assertEqual(payload["selection_policy"]["road_limit"], 4000)
        self.assertEqual(payload["selection_policy"]["rail_limit"], 300)
        self.assertEqual(payload["selection_policy"]["main_corridor_limit"], 1)
        self.assertEqual(payload["selection_policy"]["main_corridor_role"], "highlighted motorway")
        self.assertEqual(payload["selection_policy"]["highlighted_motorway_ref"], "C4")
        self.assertEqual(
            payload["selection_policy"]["clip_frame"],
            "carrier.frames.main.fitGeometry for lines, polygons, and points",
        )
        self.assertEqual(payload["selection_policy"]["city_limit"], 32)
        self.assertEqual(payload["selection_policy"]["focus_city_names"], ["Tokyo", "Osaka", "Nagoya"])
        self.assertEqual(payload["counts"]["road_source_features"], 4794)
        self.assertEqual(payload["counts"]["rail_source_features"], 1105)
        for network in ("road", "rail"):
            self.assertEqual(payload["counts"][f"{network}_eligible_paths"], payload["counts"][f"{network}_lines_rendered"])
            self.assertGreaterEqual(payload["selection_policy"][f"{network}_limit"], payload["counts"][f"{network}_eligible_paths"])
        self.assertEqual(payload["counts"]["road_lines_rendered"], 3673)
        self.assertEqual(payload["counts"]["rail_lines_rendered"], 226)
        self.assertEqual(payload["counts"]["main_corridor_paths_rendered"], 1)
        self.assertEqual(payload["counts"]["main_corridor_titles"], ["首都圏中央連絡自動車道 / C4"])
        self.assertGreater(payload["counts"]["city_source_features"], payload["counts"]["city_points_rendered"])
        self.assertGreater(payload["counts"]["city_eligible_points"], payload["counts"]["city_points_rendered"])
        self.assertEqual(payload["counts"]["city_points_rendered"], 32)
        self.assertEqual(payload["counts"]["focus_city_points_rendered"], 3)
        self.assertEqual(payload["counts"]["focus_city_titles"], ["Tokyo", "Osaka", "Nagoya · Aichi"])
        self.assertEqual(payload["counts"]["night_points_rendered"], 88)
        self.assertEqual(payload["counts"]["bathymetry_source_features"], 800)
        self.assertEqual(payload["counts"]["bathymetry_eligible_paths"], 0)
        self.assertEqual(payload["counts"]["bathymetry_lines_rendered"], 0)
        self.assertEqual(
            len(payload["counts"]["selected_city_titles"]),
            payload["counts"]["city_points_rendered"],
        )
        self.assertEqual(
            len(set(payload["counts"]["selected_city_titles"])),
            payload["counts"]["city_points_rendered"],
        )
        self.assertNotIn("Sendai", payload["counts"]["selected_city_titles"])
        self.assertIn("Sendai · Miyagi", payload["counts"]["selected_city_titles"])
        self.assertGreater(payload["counts"]["carrier_paths"], 40)
        self.assertGreater(payload["counts"]["terrain_major_lines_rendered"], 0)
        self.assertGreater(payload["counts"]["terrain_minor_lines_rendered"], 0)
        self.assertGreater(payload["counts"]["river_lines_rendered"], 0)

    def test_landing_hero_scenario_metadata_uses_real_sources(self) -> None:
        for mode, scenario_id, svg_name, metadata_name in HERO_SCENARIO_ASSETS:
            with self.subTest(mode=mode):
                svg_text = (LANDING_ASSETS / svg_name).read_text(encoding="utf-8")
                ET.fromstring(svg_text)
                payload = json.loads((LANDING_ASSETS / metadata_name).read_text(encoding="utf-8"))
                self.assertEqual(payload["asset_type"], "landing_hero_scenario_map")
                self.assertEqual(payload["mode"], mode)
                self.assertEqual(payload["scenario_id"], scenario_id)
                self.assertEqual(payload["viewport"]["bbox"], [-10.0, 34.0, 39.0, 65.0])
                self.assertEqual(payload["viewport"]["canvas_padding"], 18)
                self.assertEqual(payload["viewport"]["canvas_width"], 980)
                self.assertEqual(payload["viewport"]["canvas_height"], 680)
                self.assertGreater(len(payload["source_files"]), 1)
                self.assertIsInstance(payload["feature_counts"], dict)
                self.assertEqual(payload["counts"], payload["feature_counts"])
                if mode == "blank":
                    self.assertIn("data/scenarios/blank_base/manifest.json", payload["source_files"])
                    self.assertIn("data/scenarios/blank_base/runtime_topology.topo.json", payload["source_files"])
                    self.assertNotIn("data/europe_topology.runtime_political_v1.json", payload["source_files"])
                    self.assertIn("data/europe_land_bg.geojson", payload["source_files"])
                    self.assertTrue(payload["selection_policy"]["blank_canvas"])
                    self.assertEqual(
                        payload["selection_policy"]["runtime_topology_source"],
                        "data/scenarios/blank_base/runtime_topology.topo.json",
                    )
                    self.assertEqual(payload["selection_policy"]["land_simplify_tolerance"], 0.08)
                    self.assertEqual(payload["selection_policy"]["land_path_limit"], 8600)
                    self.assertEqual(payload["selection_policy"]["coastline_path_limit"], 1000)
                    self.assertEqual(payload["selection_policy"]["blank_internal_stroke_width"], 0.25)
                    self.assertEqual(payload["selection_policy"]["coastline_stroke_width"], 0.5)
                    self.assertGreater(payload["feature_counts"]["land_paths"], 0)
                    self.assertGreater(payload["feature_counts"]["coastline_paths"], 0)
                    self.assertEqual(payload["feature_counts"]["land_path_limit"], 8600)
                    self.assertEqual(
                        payload["feature_counts"]["land_paths"],
                        min(
                            payload["feature_counts"]["land_paths_available"],
                            payload["feature_counts"]["land_path_limit"],
                        ),
                    )
                    self.assertEqual(payload["feature_counts"]["coastline_path_limit"], 1000)
                    self.assertEqual(
                        payload["feature_counts"]["coastline_paths"],
                        min(payload["feature_counts"]["coastline_paths_available"], 1000),
                    )
                    self.assertEqual(
                        payload["feature_counts"]["coastline_paths_dropped"],
                        max(0, payload["feature_counts"]["coastline_paths_available"] - 1000),
                    )
                    self.assertEqual(
                        payload["feature_counts"]["land_paths_dropped"],
                        max(
                            0,
                            payload["feature_counts"]["land_paths_available"]
                            - payload["feature_counts"]["land_path_limit"],
                        ),
                    )
                    self.assertEqual(payload["territory_tags"], [])
                else:
                    self.assertIn(f"data/scenarios/{scenario_id}/manifest.json", payload["source_files"])
                    scenario_manifest = json.loads((REPO_ROOT / "data/scenarios" / scenario_id / "manifest.json").read_text(encoding="utf-8"))
                    self.assertIn(scenario_manifest["runtime_topology_url"], payload["source_files"])
                    self.assertIn(f"data/scenarios/{scenario_id}/owners.by_feature.json", payload["source_files"])
                    self.assertIn(f"data/scenarios/{scenario_id}/countries.json", payload["source_files"])
                    self.assertFalse(payload["selection_policy"]["blank_canvas"])
                    expected_capital_limit = 9 if mode == "tno-1962" else 8
                    self.assertEqual(payload["selection_policy"]["capital_limit"], expected_capital_limit)
                    self.assertEqual(payload["selection_policy"]["territory_path_limit_per_tag"], 48)
                    self.assertGreater(payload["feature_counts"]["territories"], 20)
                    self.assertGreater(payload["feature_counts"]["political_features"], payload["feature_counts"]["territories"])
                    self.assertGreaterEqual(payload["feature_counts"]["capitals"], 6)
                    self.assertLessEqual(payload["feature_counts"]["capitals"], expected_capital_limit)
                    self.assertEqual(len(re.findall(r'class="city-label"', svg_text)), payload["feature_counts"]["capitals"])
                    self.assertNotIn("territory--scenario-only", svg_text)
                    self.assertNotIn("stroke-dasharray: 5 4", svg_text)
                    self.assertNotIn('class="capital-code"', svg_text)
                    self.assertNotIn('class="country-label"', svg_text)
                if mode == "tno-1962":
                    self.assertIn("data/scenarios/tno_1962/capital_defaults.partial.json", payload["source_files"])
                    self.assertIn("data/scenarios/tno_1962/scenario_atlantropa.topo.json", payload["source_files"])
                    self.assertNotIn("data/scenarios/tno_1962/scenario_atlantropa_metadata.json", payload["source_files"])
                    self.assertIn("data/europe_topology.runtime_political_v1.json", payload["source_files"])
                    self.assertIn("data/europe_land_bg.geojson", payload["source_files"])
                    self.assertEqual(
                        payload["selection_policy"]["hero_geometry_source"],
                        "runtime_topology political ownership crop",
                    )
                    self.assertEqual(
                        payload["selection_policy"]["atlantropa_overlay"],
                        "source water, reclaimed land, and shoal geometry",
                    )
                    self.assertEqual(
                        payload["selection_policy"]["base_underlay"],
                        "Mediterranean island fragments only",
                    )
                    self.assertEqual(
                        payload["selection_policy"]["hero_capital_tags"],
                        ["ENG", "FRA", "GER", "ITA", "IBR", "RKU", "SOV", "WRS", "BRG"],
                    )
                    self.assertEqual(
                        payload["selection_policy"]["hero_capital_label_overrides"],
                        {"BRG": "Nanzig"},
                    )
                    self.assertEqual(
                        payload["selection_policy"]["hero_capital_point_overrides"],
                        {"BRG": [6.18496, 48.68439]},
                    )
                    self.assertNotIn("SOV", payload["capital_tags"])
                    self.assertNotIn("WRS", payload["capital_tags"])
                    for city_name in ("Madrid", "Kyiv", "Nanzig"):
                        self.assertIn(f">{city_name}</text>", svg_text)
                    for replaced_name in ("Moskau", "Warshau", "Zagreb", "Bucharest", "Sofia", "Brussels"):
                        self.assertNotIn(f">{replaced_name}</text>", svg_text)
                    self.assertEqual(payload["selection_policy"]["base_underlay_path_limit"], 360)
                    self.assertEqual(payload["selection_policy"]["base_underlay_coastline_limit"], 360)
                    self.assertGreater(payload["feature_counts"]["base_land_paths"], 0)
                    self.assertLessEqual(payload["feature_counts"]["base_land_paths"], 420)
                    self.assertGreater(payload["feature_counts"]["base_mediterranean_island_paths"], 0)
                    self.assertEqual(payload["feature_counts"]["base_coastline_paths"], 0)
                    self.assertLessEqual(payload["feature_counts"]["base_coastline_paths"], 360)
                    self.assertIn('class="base-land"', svg_text)
                    self.assertNotIn('class="base-coastline"', svg_text)
                    for layer in ("water", "land", "shoal"):
                        self.assertGreater(payload["feature_counts"][f"atlantropa_{layer}_paths"], 0)
                        self.assertIn(f'data-atlantropa-layer="{layer}"', svg_text)

    def test_blank_hero_ring_start_is_independent_of_geos_rotation(self) -> None:
        builder = import_landing_builder("build_landing_europe_1936_showcase")

        class IdentityCanvas:
            @staticmethod
            def project(x: float, y: float) -> tuple[float, float]:
                return x, y

        vertices = [(2.0, 1.0), (1.0, 1.0), (1.0, 2.0)]
        expected = "M1 1 L1 2 L2 1 L1 1 Z"
        for start in range(len(vertices)):
            rotated = vertices[start:] + vertices[:start]
            with self.subTest(start=start):
                self.assertEqual(
                    builder.ring_path(rotated + [rotated[0]], IdentityCanvas(), canonical_start=True),
                    expected,
                )

    def test_landing_hero_scenario_assets_match_builder_output(self) -> None:
        build_landing_europe_1936_showcase = import_landing_builder("build_landing_europe_1936_showcase")
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            build_landing_europe_1936_showcase.build_hero_scenario_maps(output_dir=tmp_root)
            for _mode, _scenario_id, svg_name, metadata_name in HERO_SCENARIO_ASSETS:
                with self.subTest(svg_name=svg_name):
                    generated_svg = tmp_root / svg_name
                    generated_metadata = tmp_root / metadata_name
                    ET.fromstring(generated_svg.read_text(encoding="utf-8"))
                    self.assertEqual(generated_svg.read_bytes(), (LANDING_ASSETS / svg_name).read_bytes())
                    self.assertEqual(generated_metadata.read_bytes(), (LANDING_ASSETS / metadata_name).read_bytes())

    def test_landing_japan_preview_assets_match_builder_output(self) -> None:
        build_landing_japan_preview = import_landing_builder("build_landing_japan_preview")
        previous_svg_paths = build_landing_japan_preview.JAPAN_PREVIEW_SVGS
        previous_metadata_path = build_landing_japan_preview.JAPAN_PREVIEW_METADATA
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            build_landing_japan_preview.JAPAN_PREVIEW_SVGS = {
                mode: tmp_root / f"japan-preview-{mode}.svg"
                for mode in ("transport", "cities", "terrain", "night")
            }
            build_landing_japan_preview.JAPAN_PREVIEW_METADATA = tmp_root / "japan-preview.json"
            try:
                build_landing_japan_preview.build_preview()
                self.assertEqual(
                    build_landing_japan_preview.JAPAN_PREVIEW_METADATA.read_bytes(),
                    (LANDING_ASSETS / "japan-preview.json").read_bytes(),
                )
                for mode, generated_path in build_landing_japan_preview.JAPAN_PREVIEW_SVGS.items():
                    with self.subTest(mode=mode):
                        generated_text = generated_path.read_text(encoding="utf-8")
                        ET.fromstring(generated_text)
                        self.assertTrue(any(
                            "main-corridor" in element.get("class", "").split()
                            for element in ET.fromstring(generated_text).iter()
                        ), f"{mode} should retain the highlighted corridor")
                        self.assertIn('class="focus-city"', generated_text)
                        self.assertIn('data-source="japan-main-corridor"', generated_text)
                        self.assertIn('data-source="world-cities-japan-focus"', generated_text)
                        self.assertIn("<title>Tokyo</title>", generated_text)
                        self.assertIn("<title>Osaka</title>", generated_text)
                        self.assertIn("<title>Nagoya · Aichi</title>", generated_text)
                        if mode == "cities":
                            self.assertIn("<title>Sendai · Miyagi</title>", generated_text)
                            self.assertIsNone(
                                re.search(r'<circle class="city"[^>]*><title>Sendai</title></circle>', generated_text)
                            )
                        self.assertEqual(
                            generated_path.read_bytes(),
                            (LANDING_ASSETS / f"japan-preview-{mode}.svg").read_bytes(),
                        )
            finally:
                build_landing_japan_preview.JAPAN_PREVIEW_SVGS = previous_svg_paths
                build_landing_japan_preview.JAPAN_PREVIEW_METADATA = previous_metadata_path

    def test_pages_dist_generated_text_writes_use_lf(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "generated.json"
            build_pages_dist.write_text_lf(path, "{\n  \"ok\": true\n}\n")
            self.assertEqual(path.read_bytes(), b'{\n  "ok": true\n}\n')
            crlf_path = Path(tmpdir) / "copied.js"
            crlf_path.write_bytes(b"const ok = true;\r\n")
            build_pages_dist.normalize_dist_text_file_lf(crlf_path)
            self.assertEqual(crlf_path.read_bytes(), b"const ok = true;\n")

        original_dist_root = build_pages_dist.DIST_ROOT
        with tempfile.TemporaryDirectory() as tmpdir:
            build_pages_dist.DIST_ROOT = Path(tmpdir)
            try:
                for relative_path in (Path("index.html"), Path("app.js"), Path("styles.css")):
                    root_dist_path = Path(tmpdir) / relative_path
                    root_dist_path.write_bytes(b"line 1\r\nline 2\r\n")
                    build_pages_dist.normalize_dist_text_file_lf(root_dist_path)
                    self.assertEqual(root_dist_path.read_bytes(), b"line 1\nline 2\n")
                root_asset_path = Path(tmpdir) / "assets" / "work-alt-history-med.json"
                root_asset_path.parent.mkdir(parents=True, exist_ok=True)
                root_asset_path.write_bytes(b"{\r\n  \"ok\": true\r\n}\r\n")
                build_pages_dist.normalize_dist_text_file_lf(root_asset_path)
                self.assertEqual(root_asset_path.read_bytes(), b'{\n  "ok": true\n}\n')
                for relative_path in (
                    Path("app") / "css" / "style.css",
                    Path("app") / "data" / "world_cities.geojson",
                    Path("app") / "index.html",
                    Path("app") / "vendor" / "textures" / "README.md",
                    Path("app") / "vendor" / "textures" / "paper_vintage_01.svg",
                    Path("app") / "vendor" / "fflate.LICENSE.txt",
                ):
                    app_dist_path = Path(tmpdir) / relative_path
                    app_dist_path.parent.mkdir(parents=True, exist_ok=True)
                    app_dist_path.write_bytes(b"line 1\r\nline 2\r\n")
                    build_pages_dist.normalize_dist_text_file_lf(app_dist_path)
                    self.assertEqual(app_dist_path.read_bytes(), b"line 1\nline 2\n")
                if build_pages_dist.BYTE_EXACT_APP_DATA_PATHS:
                    for relative_path in build_pages_dist.BYTE_EXACT_APP_DATA_PATHS:
                        with self.subTest(relative_path=relative_path.as_posix()):
                            exact_json_path = Path(tmpdir) / relative_path
                            exact_json_path.parent.mkdir(parents=True, exist_ok=True)
                            exact_json_path.write_bytes(b"{\r\n}\r\n")
                            build_pages_dist.normalize_dist_text_file_lf(exact_json_path)
                            self.assertEqual(exact_json_path.read_bytes(), b"{\r\n}\r\n")
                else:
                    generated_json_path = Path(tmpdir) / "app" / "data" / "generated.json"
                    generated_json_path.parent.mkdir(parents=True, exist_ok=True)
                    generated_json_path.write_bytes(b"{\r\n}\r\n")
                    build_pages_dist.normalize_dist_text_file_lf(generated_json_path)
                    self.assertEqual(generated_json_path.read_bytes(), b"{\n}\n")
            finally:
                build_pages_dist.DIST_ROOT = original_dist_root

    def test_pages_dist_reset_clears_previous_output_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir) / "dist"
            old_file = tmp_root / "app" / "data" / "hgo_catalogs" / "flags_png" / "medium" / "AA" / "AAA.png"
            old_file.parent.mkdir(parents=True)
            old_file.write_bytes(b"old")
            previous_dist_root = build_pages_dist.DIST_ROOT
            previous_app_dist_root = build_pages_dist.APP_DIST_ROOT
            build_pages_dist.DIST_ROOT = tmp_root
            build_pages_dist.APP_DIST_ROOT = tmp_root / "app"
            try:
                build_pages_dist.reset_dist()
                self.assertTrue(build_pages_dist.APP_DIST_ROOT.is_dir())
                self.assertFalse(old_file.exists())
            finally:
                build_pages_dist.DIST_ROOT = previous_dist_root
                build_pages_dist.APP_DIST_ROOT = previous_app_dist_root

    def test_pages_dist_manifest_scan_retries_after_vanishing_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            stable_path = tmp_root / "app" / "stable.json"
            stable_path.parent.mkdir(parents=True)
            stable_path.write_text("{}", encoding="utf-8")
            vanished_path = tmp_root / "app" / "vanished.json"
            previous_dist_root = build_pages_dist.DIST_ROOT
            previous_iter_dist_files = build_pages_dist.iter_dist_files
            previous_sleep = build_pages_dist.time.sleep
            calls = {"count": 0}

            def fake_iter_dist_files():
                calls["count"] += 1
                return [vanished_path, stable_path] if calls["count"] == 1 else [stable_path]

            build_pages_dist.DIST_ROOT = tmp_root
            build_pages_dist.iter_dist_files = fake_iter_dist_files
            build_pages_dist.time.sleep = lambda _seconds: None
            try:
                records, total_bytes = build_pages_dist.get_dist_file_records()
                self.assertEqual(records, [{"path": "app/stable.json", "size_bytes": 2, "source_kind": "dist"}])
                self.assertEqual(total_bytes, 2)
            finally:
                build_pages_dist.DIST_ROOT = previous_dist_root
                build_pages_dist.iter_dist_files = previous_iter_dist_files
                build_pages_dist.time.sleep = previous_sleep

    def test_pages_dist_manifest_scan_uses_posix_path_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            for relative_path in (
                Path("app") / "data" / "hgo_catalogs" / "flags_png" / "medium" / "AD" / "ADN_communism.png",
                Path("app") / "data" / "hgo_catalogs" / "flags_png" / "medium" / "AD" / "ADN_ENG.png",
            ):
                path = tmp_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"flag")
            previous_dist_root = build_pages_dist.DIST_ROOT
            build_pages_dist.DIST_ROOT = tmp_root
            try:
                self.assertEqual(
                    [path.relative_to(tmp_root).as_posix() for path in build_pages_dist.iter_dist_files()],
                    [
                        "app/data/hgo_catalogs/flags_png/medium/AD/ADN_ENG.png",
                        "app/data/hgo_catalogs/flags_png/medium/AD/ADN_communism.png",
                    ],
                )
            finally:
                build_pages_dist.DIST_ROOT = previous_dist_root

    def test_pages_dist_reachability_inventory_rebuilds_from_manifest_records(self) -> None:
        manifest_payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        records = manifest_payload["files"]
        available_paths = {record["path"] for record in records}
        module_graph = build_pages_dist.build_pages_module_graph(
            dist_root=PAGES_DIST_ROOT,
            available_paths=available_paths,
        )
        rebuilt_payload = build_pages_dist.build_dist_manifest_payload(
            records,
            manifest_payload["total_bytes"],
            module_graph=module_graph,
        )
        inventory = rebuilt_payload["reachability_inventory"]
        admission = inventory["admission"]
        reachability = inventory["reachability_evidence"]
        product_inventory = inventory["product_inventory"]

        self.assertEqual(rebuilt_payload["schema_version"], 2)
        self.assertEqual(inventory["schema_version"], build_pages_dist.PAGES_REACHABILITY_SCHEMA_VERSION)
        self.assertEqual(
            inventory["category_ids"],
            list(build_pages_dist.STARTUP_REACHABILITY_CATEGORIES),
        )
        self.assertEqual(
            set(inventory["classification_axes"]),
            {"product_category", "reachability_status"},
        )
        self.assertEqual(admission["status"], "complete")
        self.assertEqual(inventory["graph_scan_status"], "complete")
        self.assertEqual(inventory["publication_ownership_status"], "complete")
        self.assertGreater(inventory["untraversed_owned_file_count"], 0)
        self.assertEqual(admission["graph_scan_status"], "complete")
        self.assertEqual(admission["publication_ownership_status"], "complete")
        self.assertEqual(
            admission["untraversed_owned_file_count"],
            inventory["untraversed_owned_file_count"],
        )
        self.assertEqual(admission["blocking_unknown_file_count"], 0)
        self.assertEqual(admission["blocking_unresolved_reference_count"], 0)
        self.assertEqual(reachability["status"], "complete")
        self.assertEqual(reachability["graph_scan_status"], "complete")
        self.assertEqual(reachability["total_file_count"], len(records))
        self.assertGreater(reachability["untraversed_file_count"], 0)
        self.assertEqual(
            reachability["traversed_file_count"] + reachability["untraversed_file_count"],
            len(records),
        )
        self.assertEqual(reachability["unresolved_reference_count"], 0)
        self.assertEqual(reachability["unresolved_dynamic_expression_count"], 0)
        self.assertEqual(reachability["registry_resolved_dynamic_expression_count"], 1)
        self.assertEqual(product_inventory["status"], "complete")
        self.assertEqual(product_inventory["publication_ownership_status"], "complete")
        self.assertEqual(product_inventory["classified_file_count"], len(records))
        self.assertEqual(product_inventory["unknown_file_count"], 0)
        self.assertEqual(product_inventory["unknown_paths"], [])
        graph_summary = inventory["module_graph"]["summary"]
        self.assertEqual(
            inventory["module_graph"]["byte_measurement"],
            "published-uncompressed-file-bytes",
        )
        self.assertGreaterEqual(graph_summary["initial_script_count"], graph_summary["initial_module_count"])
        self.assertGreaterEqual(graph_summary["initial_graph_bytes"], graph_summary["initial_script_bytes"])
        self.assertEqual(
            sum(category["file_count"] for category in inventory["categories"]),
            len(records),
        )
        self.assertEqual(
            sum(category["size_bytes"] for category in inventory["categories"]),
            manifest_payload["total_bytes"],
        )

        def group_matches_path(group: dict, path: str) -> bool:
            return any(path.startswith(record["prefix"]) for record in group["path_prefixes"]) or any(
                path == record["path"] for record in group["path_exceptions"]
            )

        for group in inventory["ownership_groups"]:
            self.assertNotIn("paths", group)
            self.assertEqual(
                sum(record["file_count"] for record in group["path_prefixes"])
                + len(group["path_exceptions"]),
                group["file_count"],
            )
            self.assertEqual(
                sum(record["size_bytes"] for record in group["path_prefixes"])
                + sum(record["size_bytes"] for record in group["path_exceptions"]),
                group["size_bytes"],
            )
        self.assertLess(
            sum(len(group["path_exceptions"]) for group in inventory["ownership_groups"]),
            len(records) // 2,
        )

        classified_by_path = {}
        for record in records:
            path = record["path"]
            matching_groups = [
                group
                for group in inventory["ownership_groups"]
                if group_matches_path(group, path)
            ]
            self.assertEqual(len(matching_groups), 1, path)
            group = matching_groups[0]
            classified_by_path[path] = (group["category"], group["owner"], group["basis"])
        expected_classifications = {
            "app/js/main.js": ("startup-critical", "editor-startup", "startup-module-graph"),
            "app/js/ui/toolbar.js": (
                "startup-deferred-runtime",
                "editor-deferred-features",
                "deferred-module-graph",
            ),
            "app/js/bootstrap/startup_scenario_boot.js": (
                "scenario-specific",
                "scenario-runtime",
                "product-registry:scenario-modules",
            ),
            "app/js/ui/toolbar/export_workbench_controller.js": (
                "export-only",
                "export-capability",
                "product-registry:export-modules",
            ),
            "app/js/bootstrap/ui_shell_debug_seed.js": (
                "developer-only",
                "development-tools",
                "product-registry:developer-modules",
            ),
        }
        for path, expected in expected_classifications.items():
            with self.subTest(path=path):
                self.assertEqual(classified_by_path[path], expected)

    def test_pages_module_graph_tracks_owner_declared_dynamic_and_worker_edges(self) -> None:
        manifest_payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        graph = build_pages_dist.build_pages_module_graph(
            dist_root=PAGES_DIST_ROOT,
            available_paths={record["path"] for record in manifest_payload["files"]},
        )
        nodes_by_path = {node["path"]: node for node in graph["nodes"]}

        self.assertEqual(graph["module_entrypoint"], "app/js/main.js")
        self.assertEqual(graph["unresolved_references"], [])
        self.assertEqual(graph["summary"]["registry_resolved_dynamic_expression_count"], 1)
        self.assertEqual(
            graph["summary"]["module_count"],
            sum(
                graph["summary"][field_name]
                for field_name in (
                    "initial_module_count",
                    "deferred_module_count",
                    "untraversed_module_count",
                )
            ),
        )
        self.assertEqual(
            nodes_by_path["app/js/bootstrap/deferred_ui_bootstrap.js"]["dynamic_imports"],
            [
                "app/js/ui/scenario_controls.js",
                "app/js/ui/shortcuts.js",
                "app/js/ui/sidebar.js",
                "app/js/ui/styled_selects.js",
                "app/js/ui/toolbar.js",
            ],
        )
        deferred_ui_expressions = nodes_by_path["app/js/bootstrap/deferred_ui_bootstrap.js"][
            "dynamic_import_expressions"
        ]
        # Literal import() calls resolve directly; no registry entry is needed any more.
        self.assertEqual(
            [record for record in deferred_ui_expressions if record["kind"] == "unresolved_dynamic_expression"],
            [],
        )
        data_service_expressions = nodes_by_path["app/js/core/data_service.js"]["dynamic_import_expressions"]
        self.assertEqual(
            [record["registry_id"] for record in data_service_expressions if record["kind"] == "unresolved_dynamic_expression"],
            ["data-service-runtime-modules"],
        )
        data_service_binding = nodes_by_path["app/js/core/data_service.js"]["source_bindings"][0]
        self.assertEqual(
            {key: data_service_binding[key] for key in ("name", "status", "targets")},
            {
                "name": "ALLOWED_RUNTIME_MODULE_PATHS",
                "status": "literal-string-collection",
                "targets": [
                    "js/core/city_lights_historical_1930_asset.js",
                    "js/core/city_lights_modern_asset.js",
                ],
            },
        )
        self.assertGreater(data_service_binding["line"], 0)
        self.assertGreater(data_service_binding["column"], 0)
        self.assertTrue(
            all(
                resolution["registry_targets"] == resolution["runtime_targets"]
                and resolution["source_binding_status"] == "literal-string-collection"
                for resolution in graph["dynamic_import_registry"]["resolutions"]
            )
        )
        self.assertEqual(
            nodes_by_path["app/js/core/startup_worker_client.js"]["resource_references"],
            ["app/js/workers/startup_boot.worker.js"],
        )
        self.assertEqual(
            nodes_by_path["app/js/workers/startup_boot.worker.js"]["resource_references"],
            ["app/js/core/feature_identity_shared.js", "app/js/core/geometry_transfer_codec_shared.js", "app/js/core/json_resource_decoder_shared.js", "app/js/core/scenario_chunk_format_shared.js", "app/js/core/startup_topology_codec_shared.js", "app/vendor/d3.v7.min.js", "app/vendor/topojson-client.min.js"],
        )

    def test_pages_module_graph_uses_acorn_for_imports_exports_templates_comments_and_regex(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
                "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                "hgo/src/main.js": "export const native = true;",
                "index.html": '<script type="module" src="./app/js/main.js"></script>',
                "app/index.html": '<script type="module" src="./js/main.js"></script>',
                "app/js/main.js": r'''
                    import /* comment-separated */ "./commented-static.js";
                    export { named } from "./named.js";
                    export * from "./all.js";
                    const fakeImportText = /import\("\.\/regex-fake\.js"\)/;
                    export const loadOuter = () => import(`./${import("./nested.js")}.js`);
                    export const loadCommented = () => import /* comment-separated */ ("./commented.js");
                    export const workerUrl = new URL("./worker.js", import.meta.url);
                ''',
                "app/js/commented-static.js": "export const commentedStatic = true;",
                "app/js/named.js": "export const named = true;",
                "app/js/all.js": "export const all = true;",
                "app/js/nested.js": "export const nested = true;",
                "app/js/commented.js": "export const commented = true;",
                "app/js/worker.js": "export const worker = true;",
            }
            for relative_path, source_text in source_paths.items():
                path = dist_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source_text, encoding="utf-8")

            graph = build_pages_dist.build_pages_module_graph(
                dist_root=dist_root,
                available_paths=set(source_paths),
                dynamic_import_registry=(),
            )

        self.assertEqual(
            graph["javascript_extractor"],
            {
                "parser": "acorn",
                "parser_version": "8.17.0",
                "walker": "acorn-walk",
                "walker_version": "8.3.5",
                "location_columns": "one-based",
            },
        )
        main_node = next(node for node in graph["nodes"] if node["path"] == "app/js/main.js")
        self.assertEqual(
            main_node["static_imports"],
            [
                "app/js/all.js",
                "app/js/commented-static.js",
                "app/js/named.js",
            ],
        )
        self.assertEqual(
            main_node["dynamic_imports"],
            ["app/js/commented.js", "app/js/nested.js"],
        )
        self.assertEqual(main_node["resource_references"], ["app/js/worker.js"])
        self.assertTrue(
            all(
                record["line"] > 0 and record["column"] > 0
                for records in main_node["reference_locations"].values()
                for record in records
            )
        )
        unresolved_dynamic = [
            record
            for record in graph["unresolved_references"]
            if record["kind"] == "unresolved_dynamic_expression"
        ]
        self.assertEqual(
            [record["expression"] for record in unresolved_dynamic],
            ['`./${import("./nested.js")}.js`'],
        )
        serialized_graph = json.dumps(graph, sort_keys=True)
        self.assertNotIn("regex-fake.js", serialized_graph)

    def test_pages_html_resource_parser_requires_exact_src_and_href_attributes(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
                "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                "hgo/src/main.js": "export const native = true;",
                "index.html": '<script type="module" src="./app/js/main.js"></script>',
                "app/index.html": '''
                    <script data-src="./js/data-only.js" src="./js/main.js"></script>
                    <link data-href="./css/data-only.css" href="./css/real.css">
                    <img data-src="./images/data-only.png"
                         srcset="./images/srcset-only.png 1x"
                         src="./images/real.png">
                ''',
                "app/js/main.js": "export const main = true;",
                "app/js/data-only.js": "export const dataOnly = true;",
                "app/css/real.css": "body {}",
                "app/css/data-only.css": "body {}",
                "app/images/real.png": "real",
                "app/images/data-only.png": "data-only",
                "app/images/srcset-only.png": "srcset-only",
            }
            for relative_path, source_text in source_paths.items():
                path = dist_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source_text, encoding="utf-8")

            graph = build_pages_dist.build_pages_module_graph(
                dist_root=dist_root,
                available_paths=set(source_paths),
                dynamic_import_registry=(),
            )

        editor_entrypoint = next(item for item in graph["entrypoints"] if item["id"] == "editor")
        self.assertEqual(
            editor_entrypoint["resource_references"],
            ["app/css/real.css", "app/images/real.png", "app/js/main.js"],
        )
        self.assertEqual(graph["unresolved_references"], [])

    def test_pages_module_graph_reports_unregistered_dynamic_expressions(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
                "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                "hgo/src/main.js": "export const native = true;",
                "index.html": '<script type="module" src="./app/js/main.js"></script>',
                "app/index.html": '<script type="module" src="./js/main.js"></script>',
                "app/js/main.js": """
                    const specifier = './feature.js';
                    const name = 'feature';
                    export const load = () => Promise.all([
                      import(specifier),
                      import(`./${name}.js`),
                    ]);
                """,
                "app/js/feature.js": "export const feature = true;",
            }
            for relative_path, source_text in source_paths.items():
                path = dist_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source_text, encoding="utf-8")

            graph = build_pages_dist.build_pages_module_graph(
                dist_root=dist_root,
                available_paths=set(source_paths),
                dynamic_import_registry=(),
            )

        unresolved_dynamic = [
            record
            for record in graph["unresolved_references"]
            if record["kind"] == "unresolved_dynamic_expression"
        ]
        self.assertEqual([record["expression"] for record in unresolved_dynamic], ["specifier", "`./${name}.js`"])
        self.assertEqual([record["expression_index"] for record in unresolved_dynamic], [0, 1])
        self.assertTrue(all(record["reason"] == "no-declarative-registry-entry" for record in unresolved_dynamic))
        self.assertTrue(all(record["line"] > 0 and record["column"] > 0 for record in unresolved_dynamic))
        records = [
            {"path": path, "size_bytes": len(source_paths[path].encode("utf-8")), "source_kind": "dist"}
            for path in ("index.html", "app/index.html", "app/js/main.js", "hgo/index.html", "hgo/src/main.js")
        ]
        with self.assertRaisesRegex(
            ValueError,
            "unknown_files=0, unresolved_references=2",
        ):
            build_pages_dist.build_dist_manifest_payload(
                records,
                sum(record["size_bytes"] for record in records),
                module_graph=graph,
            )

    def test_pages_dynamic_import_registry_survives_deferred_list_rename(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            deferred_source = """
                const RENAMED_RUNTIME_TARGETS = Object.freeze(['../ui/first.js', '../ui/second.js']);
                export const boot = (loadModule = (target) => import(target)) =>
                  Promise.all(RENAMED_RUNTIME_TARGETS.map((target) => loadModule(target)));
            """
            source_paths = {
                "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                "hgo/src/main.js": "export const native = true;",
                "index.html": '<script type="module" src="./app/js/main.js"></script>',
                "app/index.html": '<script type="module" src="./js/main.js"></script>',
                "app/js/main.js": 'import "./bootstrap/deferred_ui_bootstrap.js";',
                "app/js/bootstrap/deferred_ui_bootstrap.js": deferred_source,
                "app/js/ui/first.js": "export const first = true;",
                "app/js/ui/second.js": "export const second = true;",
            }
            for relative_path, source_text in source_paths.items():
                path = dist_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source_text, encoding="utf-8")
            registry = (
                {
                    "id": "renamed-deferred-list",
                    "source": "app/js/bootstrap/deferred_ui_bootstrap.js",
                    "expression_index": 0,
                    "expected_expression": "target",
                    "source_binding": "RENAMED_RUNTIME_TARGETS",
                    "source_binding_resolution": "module-relative",
                    "targets": ("app/js/ui/first.js", "app/js/ui/second.js"),
                },
            )
            graph = build_pages_dist.build_pages_module_graph(
                dist_root=dist_root,
                available_paths=set(source_paths),
                dynamic_import_registry=registry,
            )

        self.assertNotIn("DEFERRED_UI_MODULE_PATHS", deferred_source)
        self.assertEqual(graph["unresolved_references"], [])
        node = next(
            node
            for node in graph["nodes"]
            if node["path"] == "app/js/bootstrap/deferred_ui_bootstrap.js"
        )
        self.assertEqual(node["dynamic_imports"], ["app/js/ui/first.js", "app/js/ui/second.js"])
        self.assertEqual(
            [record["resolution"] for record in node["dynamic_import_expressions"]],
            ["declarative-registry"],
        )

    def test_pages_dynamic_import_registry_requires_runtime_binding_exact_set(self) -> None:
        cases = (
            {
                "name": "runtime-typo",
                "runtime_literals": ("../ui/first.js", "../ui/typo.js"),
                "published_modules": ("first.js", "second.js"),
                "missing_from_registry": ["app/js/ui/typo.js"],
                "missing_from_runtime_binding": ["app/js/ui/second.js"],
                "unpublished_targets": ["app/js/ui/typo.js"],
            },
            {
                "name": "existing-module-added-without-registry-update",
                "runtime_literals": ("../ui/first.js", "../ui/second.js", "../ui/third.js"),
                "published_modules": ("first.js", "second.js", "third.js"),
                "missing_from_registry": ["app/js/ui/third.js"],
                "missing_from_runtime_binding": [],
                "unpublished_targets": [],
            },
        )
        for case in cases:
            with self.subTest(case=case["name"]), tempfile.TemporaryDirectory() as tmpdir:
                dist_root = Path(tmpdir)
                runtime_literal_source = ", ".join(json.dumps(value) for value in case["runtime_literals"])
                source_paths = {
                    "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                    "hgo/src/main.js": "export const native = true;",
                    "index.html": '<script type="module" src="./app/js/main.js"></script>',
                    "app/index.html": '<script type="module" src="./js/main.js"></script>',
                    "app/js/main.js": 'import "./bootstrap/deferred_ui_bootstrap.js";',
                    "app/js/bootstrap/deferred_ui_bootstrap.js": f'''
                        const RUNTIME_TARGETS = Object.freeze([{runtime_literal_source}]);
                        export const boot = (loadModule = (target) => import(target)) =>
                          Promise.all(RUNTIME_TARGETS.map((target) => loadModule(target)));
                    ''',
                }
                for module_name in case["published_modules"]:
                    source_paths[f"app/js/ui/{module_name}"] = "export const loaded = true;"
                for relative_path, source_text in source_paths.items():
                    path = dist_root / relative_path
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(source_text, encoding="utf-8")
                registry = (
                    {
                        "id": "runtime-binding-exact-set",
                        "source": "app/js/bootstrap/deferred_ui_bootstrap.js",
                        "expression_index": 0,
                        "expected_expression": "target",
                        "source_binding": "RUNTIME_TARGETS",
                        "source_binding_resolution": "module-relative",
                        "targets": ("app/js/ui/first.js", "app/js/ui/second.js"),
                    },
                )

                graph = build_pages_dist.build_pages_module_graph(
                    dist_root=dist_root,
                    available_paths=set(source_paths),
                    dynamic_import_registry=registry,
                )

                mismatch = next(
                    record
                    for record in graph["unresolved_references"]
                    if record["kind"] == "dynamic_import_registry_target_set_mismatch"
                )
                self.assertEqual(mismatch["source_binding"], "RUNTIME_TARGETS")
                self.assertEqual(mismatch["source_binding_status"], "literal-string-collection")
                self.assertEqual(mismatch["missing_from_registry"], case["missing_from_registry"])
                self.assertEqual(
                    mismatch["missing_from_runtime_binding"],
                    case["missing_from_runtime_binding"],
                )
                resolution = graph["dynamic_import_registry"]["resolutions"][0]
                self.assertEqual(resolution["status"], "target-set-mismatch")
                self.assertEqual(resolution["unpublished_targets"], case["unpublished_targets"])
                node = next(
                    node
                    for node in graph["nodes"]
                    if node["path"] == "app/js/bootstrap/deferred_ui_bootstrap.js"
                )
                self.assertEqual(node["dynamic_imports"], [])

    def test_map_label_fonts_have_exact_on_demand_vendor_inventory_ownership(self) -> None:
        font_paths = (
            "app/vendor/fonts/README.md",
            "app/vendor/fonts/ebgaramond/EBGaramond-500.woff2",
            "app/vendor/fonts/ebgaramond/OFL.txt",
            "app/vendor/fonts/notoserifsc/NotoSerifSC-400.woff2",
            "app/vendor/fonts/notoserifsc/OFL.txt",
        )
        css_path = "app/css/map-label-fonts.css"
        graph = {
            "entrypoints": [{"path": "app/index.html", "resource_references": [css_path]}],
            "summary": {},
            "initial_resource_paths": [css_path],
            "deferred_resource_paths": [],
            "nodes": [],
            "unresolved_references": [],
        }
        records = [{"path": path, "size_bytes": 1} for path in (*font_paths, css_path)]
        inventory = build_pages_dist.build_pages_reachability_inventory(records, module_graph=graph)
        self.assertEqual(inventory["admission"]["status"], "complete")
        self.assertEqual(inventory["product_inventory"]["unknown_file_count"], 0)
        self.assertEqual(inventory["untraversed_owned_file_count"], 5)
        self.assertEqual(
            next(item for item in inventory["categories"] if item["id"] == "on-demand-product")["file_count"],
            5,
        )
        for path in font_paths:
            with self.subTest(path=path):
                self.assertEqual(
                    build_pages_dist._classify_pages_dist_path(path, graph),
                    ("on-demand-product", "editor-vendor", "product-registry:editor-vendor-product"),
                )
        self.assertEqual(
            build_pages_dist._classify_pages_dist_path(css_path, graph),
            ("startup-critical", "editor-startup", "startup-resource-graph"),
        )
        self.assertEqual(
            build_pages_dist._classify_pages_dist_path("app/vendor/fonts/unregistered.woff2", graph),
            ("unknown", "unclassified", "no-declarative-owner"),
            "the exact font list must not admit arbitrary files in the fonts directory",
        )

    def test_pages_dist_inventory_rejects_orphan_and_typo_counterexamples(self) -> None:
        empty_graph = {
            "schema_version": build_pages_dist.PAGES_REACHABILITY_SCHEMA_VERSION,
            "module_entrypoint": build_pages_dist.PAGES_MODULE_ENTRYPOINT,
            "entrypoints": [],
            "summary": {},
            "initial_resource_paths": [],
            "deferred_resource_paths": [],
            "nodes": [],
            "unresolved_references": [],
        }
        records = [
            {"path": path, "size_bytes": 1, "source_kind": "dist"}
            for path in (
                "app/js/orphan.js",
                "app/js/core/scenario_typo.js",
                "app/js/ui/dev_workspace/orphan.js",
                "app/js/ui/toolbar/export_typo.js",
                "app/data/typo.json",
                "app/vendor/unused.bin",
                "assets/unused.webp",
                "app/data/scenarios/new_scenario/runtime.json",
                "app/data/scenarios/modern_world/runtime_topology.topo.json",
            )
        ]
        inventory = build_pages_dist.build_pages_reachability_inventory(records, module_graph=empty_graph)
        self.assertEqual(inventory["admission"]["status"], "incomplete")
        self.assertEqual(inventory["graph_scan_status"], "complete")
        self.assertEqual(inventory["publication_ownership_status"], "incomplete")
        self.assertEqual(inventory["reachability_evidence"]["untraversed_file_count"], 9)
        self.assertEqual(inventory["untraversed_owned_file_count"], 2)
        self.assertEqual(inventory["product_inventory"]["unknown_file_count"], 7)
        unknown_paths = {
            record["path"]
            for record in records
            if record["path"] not in {"app/data/scenarios/new_scenario/runtime.json",
                                      "app/data/scenarios/modern_world/runtime_topology.topo.json"}
        }
        self.assertEqual(
            inventory["product_inventory"]["unknown_paths"],
            sorted(unknown_paths),
        )
        self.assertNotIn(
            "app/data/scenarios/modern_world/runtime_topology.topo.json",
            inventory["product_inventory"]["exact_exclusions"],
        )
        self.assertEqual(
            next(item for item in inventory["categories"] if item["id"] == "unknown")["file_count"],
            7,
        )
        self.assertFalse(
            [
                prefix
                for rule in build_pages_dist.PAGES_PRODUCT_INVENTORY_RULES
                for prefix in rule.get("prefixes", ())
                # Source JS is classified by graph reachability; only the compiled
                # esbuild output is declared, because the source graph does not scan it.
                if prefix.startswith("app/js/") and prefix != build_pages_dist.EDITOR_BUNDLE_PREFIX
            ]
        )
        with self.assertRaisesRegex(ValueError, "unknown_files=7"):
            build_pages_dist.build_dist_manifest_payload(
                records,
                9,
                module_graph=empty_graph,
            )

    def test_city_lights_pages_publication_allowlist_is_exact(self) -> None:
        empty_graph = {
            "schema_version": build_pages_dist.PAGES_REACHABILITY_SCHEMA_VERSION,
            "module_entrypoint": build_pages_dist.PAGES_MODULE_ENTRYPOINT,
            "entrypoints": [],
            "summary": {},
            "initial_resource_paths": [],
            "deferred_resource_paths": [],
            "nodes": [],
            "unresolved_references": [],
        }
        published_path = "app/data/city_lights/historical_1930_entries.json"
        excluded_paths = (
            "app/data/city_lights/modern_source_descriptor.json",
            "app/data/city_lights/.gitattributes",
            "tests/fixtures/city_lights/modern_source_fixture_descriptor.json",
            "tests/fixtures/city_lights/modern_source_fixture.pgm",
        )
        records = [
            {"path": path, "size_bytes": 1, "source_kind": "generated_ignored"}
            for path in (published_path, *excluded_paths)
        ]

        self.assertIn("city_lights/historical_1930_entries.json", build_pages_dist.DATA_RUNTIME_FILES)
        self.assertNotIn("city_lights", build_pages_dist.DATA_RUNTIME_DIRS)
        inventory = build_pages_dist.build_pages_reachability_inventory(records, module_graph=empty_graph)
        self.assertEqual(inventory["admission"]["status"], "incomplete")
        self.assertEqual(inventory["admission"]["blocking_unknown_file_count"], len(excluded_paths))
        self.assertEqual(inventory["product_inventory"]["unknown_paths"], sorted(excluded_paths))
        editor_data_rule = next(
            rule
            for rule in inventory["product_inventory"]["registry_rules"]
            if rule["id"] == "editor-product-data"
        )
        self.assertIn(published_path, editor_data_rule["match"]["exact_paths"])
        self.assertNotIn("app/data/city_lights/", editor_data_rule["match"]["prefixes"])
        with self.assertRaisesRegex(ValueError, f"unknown_files={len(excluded_paths)}"):
            build_pages_dist.build_dist_manifest_payload(
                records,
                len(records),
                module_graph=empty_graph,
            )

    def test_shared_production_publication_policy_rejects_scenario_and_transport_nonproducts(self) -> None:
        empty_graph = {
            "schema_version": build_pages_dist.PAGES_REACHABILITY_SCHEMA_VERSION,
            "module_entrypoint": build_pages_dist.PAGES_MODULE_ENTRYPOINT,
            "entrypoints": [],
            "summary": {},
            "initial_resource_paths": [],
            "deferred_resource_paths": [],
            "nodes": [],
            "unresolved_references": [],
        }
        policy = build_pages_dist.PagesProductionPublicationPolicy(frozenset({
            Path("tno_1962") / "runtime_topology.topo.json",
        }))
        rejected_repo_paths = (
            "data/scenarios/tno_1962/audit.json",
            "data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson",
            "data/scenarios/hgo_1936/manifest.json",
            "data/scenarios/hgo_1936/runtime_topology.topo.json.gz",
            "data/scenarios/tno_1962/runtime_topology.topo.json",
            "data/transport_layers/japan_industrial_zones/industrial_zones.open.geojson",
            "data/transport_layers/global_road/shards/w120_w090/roads.topo.json",
        )
        rejected_dist_paths = tuple(f"app/{path}" for path in rejected_repo_paths)
        for path in (*rejected_repo_paths, *rejected_dist_paths):
            with self.subTest(rejected_path=path):
                self.assertFalse(
                    build_pages_dist.is_pages_production_publication_path(path, policy=policy)
                )

        self.assertFalse(
            build_pages_dist.is_pages_production_publication_path(
                r"app\data\scenarios\tno_1962\audit.json",
                policy=policy,
            )
        )

        for path in (
            "hgo/index.html",
            "hgo/src/main.js",
            "hgo/assets/default/manifest.json",
            "data/scenarios/tno_1962/derived/atlantropa_donor_ledger.json",
            "data/scenarios/tno_1962/derived/geometry_drop_audit.json",
            "data/transport_layers/global_road/catalog.json",
            "data/transport_layers/japan_road/roads.preview.topo.json",
            "data/transport_layers/global_airport/airports.geojson",
            "data/transport_layers/japan_road/overrides/manual.json",
        ):
            with self.subTest(published_path=path):
                self.assertTrue(
                    build_pages_dist.is_pages_production_publication_path(path, policy=policy)
                )

        records = [
            {"path": path, "size_bytes": 1, "source_kind": "dist"}
            for path in rejected_dist_paths
        ]
        inventory = build_pages_dist.build_pages_reachability_inventory(
            records,
            module_graph=empty_graph,
            publication_policy=policy,
        )
        self.assertEqual(
            inventory["product_inventory"]["exact_exclusions"],
            sorted(rejected_dist_paths),
        )
        self.assertEqual(
            inventory["product_inventory"]["unknown_paths"],
            sorted(rejected_dist_paths),
        )

    def test_pages_scenario_index_excludes_retired_scenarios_without_preview_label(self) -> None:
        from unittest.mock import patch

        runtime = REPO_ROOT / ".runtime/tmp"
        runtime.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as temporary:
            app_root = Path(temporary)
            scenarios = app_root / "data/scenarios"
            scenarios.mkdir(parents=True)
            index_path = scenarios / "index.json"
            index_path.write_text(json.dumps({"scenarios": [
                {"scenario_id": "hgo_1936", "manifest_url": "data/scenarios/hgo_1936/manifest.json"},
                {"scenario_id": "modern_world", "manifest_url": "data/scenarios/modern_world/manifest.json"},
            ]}), encoding="utf-8")
            with patch.object(build_pages_dist, "APP_DIST_ROOT", app_root):
                build_pages_dist.strip_scenario_publish_audit_urls(scenarios)
            payload = json.loads(index_path.read_text(encoding="utf-8"))

        self.assertEqual([entry["scenario_id"] for entry in payload["scenarios"]], ["modern_world"])
        self.assertEqual(payload["pages_dist_policy"]["local_preview_scenario_ids"], [])

    def test_pages_dist_manifest_payload_rejects_missing_static_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
                "hgo/index.html": '<script type="module" src="./src/main.js"></script>',
                "hgo/src/main.js": "export const native = true;",
                "index.html": '<script type="module" src="./app/js/main.js"></script>',
                "app/index.html": '<script type="module" src="./js/main.js"></script>',
                "app/js/main.js": 'import "./missing.js";',
            }
            for relative_path, source_text in source_paths.items():
                path = dist_root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source_text, encoding="utf-8")
            unresolved_graph = build_pages_dist.build_pages_module_graph(
                dist_root=dist_root,
                available_paths=set(source_paths),
                dynamic_import_registry=(),
            )
        records = [
            {"path": path, "size_bytes": len(source_text.encode("utf-8")), "source_kind": "dist"}
            for path, source_text in source_paths.items()
        ]
        with self.assertRaisesRegex(ValueError, "unresolved_references=1"):
            build_pages_dist.build_dist_manifest_payload(
                records,
                sum(record["size_bytes"] for record in records),
                module_graph=unresolved_graph,
            )

    def test_pages_dist_manifest_self_record_stabilizes_deterministically(self) -> None:
        graph = {
            "schema_version": build_pages_dist.PAGES_REACHABILITY_SCHEMA_VERSION,
            "module_entrypoint": build_pages_dist.PAGES_MODULE_ENTRYPOINT,
            "entrypoints": [
                {"id": "landing", "path": "index.html", "resource_references": []},
                {"id": "editor", "path": "app/index.html", "resource_references": []},
            ],
            "summary": {
                "module_count": 1,
                "initial_module_count": 1,
                "deferred_module_count": 0,
                "untraversed_module_count": 0,
                "initial_resource_count": 0,
                "deferred_resource_count": 0,
                "unresolved_dynamic_expression_count": 0,
                "registry_resolved_dynamic_expression_count": 0,
            },
            "initial_resource_paths": [],
            "deferred_resource_paths": [],
            "nodes": [
                {
                    "path": "app/js/main.js",
                    "static_imports": [],
                    "dynamic_imports": [],
                    "resource_references": [],
                    "dynamic_import_expressions": [],
                    "load_phase": "initial",
                }
            ],
            "dynamic_import_registry": {"declarations": [], "resolutions": []},
            "unresolved_references": [],
        }

        def stabilize(starting_self_size: int | None) -> str:
            records = [
                {"path": ".nojekyll", "size_bytes": 0, "source_kind": "dist"},
                {"path": "app/index.html", "size_bytes": 10, "source_kind": "dist"},
                {"path": "app/js/main.js", "size_bytes": 20, "source_kind": "dist"},
                {"path": "index.html", "size_bytes": 10, "source_kind": "dist"},
            ]
            if starting_self_size is not None:
                records.append({
                    "path": "pages-dist-manifest.json",
                    "size_bytes": starting_self_size,
                    "source_kind": "dist",
                })
            for _ in range(40):
                total_bytes = sum(record["size_bytes"] for record in records)
                payload = build_pages_dist.build_dist_manifest_payload(
                    list(reversed(records)),
                    total_bytes,
                    module_graph=graph,
                )
                manifest_text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
                next_size = len(manifest_text.encode("utf-8"))
                self_record = next(
                    (record for record in records if record["path"] == "pages-dist-manifest.json"),
                    None,
                )
                if self_record is not None and self_record["size_bytes"] == next_size:
                    return manifest_text
                if self_record is None:
                    records.append({
                        "path": "pages-dist-manifest.json",
                        "size_bytes": next_size,
                        "source_kind": "dist",
                    })
                else:
                    self_record["size_bytes"] = next_size
            self.fail("self manifest size did not stabilize")

        self.assertEqual(stabilize(None), stabilize(0))
        self.assertEqual(stabilize(0), stabilize(999_999))


    def test_landing_copy_stays_user_facing(self) -> None:
        sources = {
            "landing/index.html": LANDING_INDEX.read_text(encoding="utf-8"),
            "landing/app.js": LANDING_APP_JS.read_text(encoding="utf-8"),
        }
        if DIST_ROOT_INDEX.exists():
            sources["dist/index.html"] = DIST_ROOT_INDEX.read_text(encoding="utf-8")
        if DIST_APP_JS.exists():
            sources["dist/app.js"] = DIST_APP_JS.read_text(encoding="utf-8")

        stale_fragments = (
            "Every source claim below is tied to checked-in manifests",
            "The Japan transport pack is the strongest current sample",
            "Use the checked-in Japan transport manifests",
            "Source ledgers, asset catalogs",
            "Source signatures and build audits",
            "Transport packs with manifests",
            "Cataloged, reproducible, and inspectable",
            "source ledgers, transport manifests",
            "manifest review",
            "manifest-led pipeline",
            "已入库",
            "入库清单",
            "来源台账",
            "构建审计",
            "清单驱动流水线",
            "数据入库基础",
        )

        for source_name, source in sources.items():
            for stale_fragment in stale_fragments:
                with self.subTest(source=source_name, stale_fragment=stale_fragment):
                    self.assertNotIn(stale_fragment, source)


    def test_dist_app_index_keeps_pages_startup_contract(self) -> None:
        if not DIST_APP_INDEX.exists():
            self.skipTest("dist/app/index.html is only available after build_pages_dist runs")
        html = DIST_APP_INDEX.read_text(encoding="utf-8")

        self.assertIn('<meta name="default-scenario" content="tno_1962" />', html)
        self.assertIn('<meta name="robots" content="noindex,nofollow" />', html)
        self.assertIn('<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml" />', html)
        self.assertIn('<link rel="alternate icon" href="../assets/favicon.png" type="image/png" />', html)
        # The published editor loads the esbuild bundle (tools/build_editor_bundle.mjs).
        self.assertIn('<link rel="modulepreload" href="js/bundle/main.js" />', html)
        self.assertIn('<script type="module" src="js/bundle/main.js"></script>', html)
        self.assertTrue((DIST_APP_INDEX.parent / "js" / "bundle" / "main.js").is_file())
        self.assertIn('<link rel="preload" href="data/scenarios/index.json" as="fetch" crossorigin />', html)
        self.assertNotIn('data-startup-bundle-preload', html)
        self.assertNotIn('startup.bundle.${language}', html)
        self.assertNotIn('<link rel="preload" href="data/europe_topology.json" as="fetch" crossorigin />', html)
        self.assertNotIn('href="data/locales.startup.json"', html)
        self.assertNotIn('href="data/geo_aliases.startup.json"', html)

    def test_dist_size_warning_is_advisory_until_the_hard_limit(self) -> None:
        warning = build_pages_dist.PAGES_DIST_WARNING_BYTES
        hard_limit = build_pages_dist.MAX_PAGES_DIST_BYTES
        for total_bytes, warning_status in (
            (warning, "within_warning"),
            (warning + 1, "over_warning"),
            (hard_limit, "over_warning"),
        ):
            with self.subTest(total_bytes=total_bytes):
                gate = build_pages_dist.get_dist_size_gate(total_bytes)
                self.assertEqual(gate["status"], "within_limit")
                self.assertEqual(gate["warning_status"], warning_status)
                build_pages_dist.enforce_dist_size(total_bytes)
        self.assertEqual(build_pages_dist.get_dist_size_gate(hard_limit + 1)["status"], "over_limit")
        with self.assertRaisesRegex(SystemExit, "exceeds"):
            build_pages_dist.enforce_dist_size(hard_limit + 1)

    def test_dist_manifest_keeps_pages_size_and_required_files_contract(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(payload.get("schema_version"), build_pages_dist.PAGES_DIST_MANIFEST_SCHEMA_VERSION)
        self.assertIsInstance(payload.get("files"), list)
        self.assertGreater(len(payload["files"]), 0)
        paths = {record["path"] for record in payload["files"]}
        records_by_path = {record["path"]: record for record in payload["files"]}
        required_files = set(payload.get("required_files", []))
        size_gate = payload.get("size_gate", {})
        largest_files = payload.get("largest_files", [])
        top_level_directories = payload.get("top_level_directories", [])

        for record in payload["files"]:
            manifest_path = record["path"]
            with self.subTest(manifest_path=manifest_path):
                expected_source_kind = "generated_ignored" if manifest_path.startswith("app/data/") else "dist"
                self.assertEqual(record.get("source_kind"), expected_source_kind)
                dist_path = PAGES_DIST_ROOT / manifest_path
                self.assertTrue(dist_path.exists())
                self.assertEqual(record["size_bytes"], dist_path.stat().st_size)

        self.assertEqual(
            payload["total_bytes"],
            sum((PAGES_DIST_ROOT / record["path"]).stat().st_size for record in payload["files"]),
        )
        self.assertEqual(payload["max_allowed_bytes"], build_pages_dist.MAX_PAGES_DIST_BYTES)
        self.assertEqual(build_pages_dist.MAX_PAGES_DIST_BYTES, build_pages_dist.GITHUB_PAGES_HARD_MAX_BYTES)
        self.assertEqual(payload["max_allowed_bytes"], 1024 * 1024 * 1024)
        self.assertEqual(build_pages_dist.PAGES_DIST_WARNING_BYTES, 950 * 1024 * 1024)
        self.assertLessEqual(payload["max_allowed_bytes"], 1024 * 1024 * 1024)
        expected_over_by_bytes = max(payload["total_bytes"] - payload["max_allowed_bytes"], 0)
        expected_status = "over_limit" if expected_over_by_bytes else "within_limit"
        expected_warning_over_by_bytes = max(payload["total_bytes"] - build_pages_dist.PAGES_DIST_WARNING_BYTES, 0)
        expected_warning_status = "over_warning" if expected_warning_over_by_bytes else "within_warning"
        self.assertEqual(size_gate.get("status"), expected_status)
        self.assertEqual(size_gate.get("over_by_bytes"), expected_over_by_bytes)
        self.assertEqual(size_gate.get("warning_bytes"), build_pages_dist.PAGES_DIST_WARNING_BYTES)
        self.assertEqual(size_gate.get("warning_status"), expected_warning_status)
        self.assertEqual(size_gate.get("warning_over_by_bytes"), expected_warning_over_by_bytes)
        self.assertEqual(size_gate.get("status"), "within_limit")
        self.assertLessEqual(payload["total_bytes"], payload["max_allowed_bytes"])
        # The warning remains visible in the manifest; only the hard limit blocks publication.
        self.assertEqual(
            records_by_path["pages-dist-manifest.json"]["size_bytes"],
            DIST_MANIFEST.stat().st_size,
        )
        for manifest_section in (size_gate, largest_files, top_level_directories):
            self.assertIsInstance(json.dumps(manifest_section, sort_keys=True), str)
        self.assertIsInstance(largest_files, list)
        self.assertGreater(len(largest_files), 0)
        self.assertLessEqual(len(largest_files), build_pages_dist.DIST_MANIFEST_LARGEST_FILE_LIMIT)
        self.assertEqual(
            largest_files,
            sorted(largest_files, key=lambda record: (-int(record["size_bytes"]), str(record["path"]))),
        )
        self.assertEqual(
            largest_files[0],
            sorted(payload["files"], key=lambda record: (-int(record["size_bytes"]), str(record["path"])))[0],
        )
        self.assertIsInstance(top_level_directories, list)
        self.assertGreater(len(top_level_directories), 0)
        self.assertEqual(
            payload["total_bytes"],
            sum(record["size_bytes"] for record in top_level_directories),
        )
        self.assertEqual(
            len(payload["files"]),
            sum(record["file_count"] for record in top_level_directories),
        )
        self.assertEqual(
            top_level_directories,
            sorted(top_level_directories, key=lambda record: (-int(record["size_bytes"]), str(record["path"]))),
        )
        self.assertIn("app/data/CATALOG.json", required_files)
        self.assertFalse(any(path.startswith("app/data/hgo_runtime/") for path in required_files))
        expected_landing_asset_paths = (
            "app.js",
            "i18n.js",
            "styles.css",
            "assets/history-scrubber.json",
            "assets/hgo-zoom.json",
            "assets/hgo-world.webp",
            "assets/hgo-europe.webp",
            "assets/product-workspace.webp",
            "assets/hero-blank.svg",
            "assets/hero-blank.webp",
            "assets/hero-blank.json",
            "assets/hero-hoi4-1936.svg",
            "assets/hero-hoi4-1936.webp",
            "assets/hero-hoi4-1936.json",
            "assets/hero-hoi4-1939.svg",
            "assets/hero-hoi4-1939.webp",
            "assets/hero-hoi4-1939.json",
            "assets/hero-tno-1962.svg",
            "assets/hero-tno-1962.webp",
            "assets/hero-tno-1962.json",
            "assets/work-alt-history-med.svg",
            "assets/work-alt-history-med.webp",
            "assets/work-alt-history-med.json",
            "assets/work-scenario-switch-europe.svg",
            "assets/work-scenario-switch-europe.webp",
            "assets/work-scenario-switch-europe.json",
            "assets/work-atlas-japan-corridor.svg",
            "assets/work-atlas-japan-corridor.webp",
            "assets/work-atlas-japan-corridor.json",
            "assets/social-preview.svg",
            "assets/social-preview.png",
            "assets/sample-runs.json",
            "assets/sample-projects/blank-base-starter.project.json",
            "assets/sample-projects/modern-world-japan-corridor.project.json",
            "assets/sample-projects/hoi4-1936-europe-briefing.project.json",
            "assets/sample-projects/hoi4-1939-europe-switch.project.json",
            "assets/sample-projects/tno-1962-atlantropa-briefing.project.json",
            "assets/japan-preview-transport.svg",
            "assets/japan-preview-transport.webp",
            "assets/japan-preview-cities.svg",
            "assets/japan-preview-cities.webp",
            "assets/japan-preview-terrain.svg",
            "assets/japan-preview-terrain.webp",
            "assets/japan-preview-night.svg",
            "assets/japan-preview-night.webp",
            "assets/japan-preview.json",
        )
        for expected_path in (
            "index.html",
            *expected_landing_asset_paths,
            "app/index.html",
            ".nojekyll",
            "app/js/main.js",
            "app/js/api/backend_client.js",
            "app/js/ui/sidebar/project_support_diagnostics_controller.js",
            "app/data/CATALOG.json",
            "app/data/scenarios/index.json",
            "app/data/runtime_asset_registry.json",
            "app/data/thematic_layers/index.json",
            "app/data/thematic_layers/political/wgi_state_capacity_v1/manifest.json",
            "app/data/country_feature_policies.json",
            "app/data/hgo_catalogs/index.json",
            "app/data/hgo_catalogs/hgo_place_names.json",
            "app/data/hgo_catalogs/hgo_flags.png_manifest.json",
            "app/data/hgo_catalogs/hgo_identity_aliases.json",
            "app/data/hgo_catalogs/flags_png/small/AB/ABK.png",
            "app/data/hgo_catalogs/flags_png/medium/AB/ABK.png",
            "app/data/city_lights/historical_1930_entries.json",
            "app/data/scenarios/tno_1962/startup.bundle.en.json",
            "app/data/scenarios/tno_1962/derived/atlantropa_donor_ledger.json",
            "app/data/scenarios/tno_1962/derived/geometry_drop_audit.json",
            "app/data/scenarios/tno_1962/chunks/political.coarse.r0c0.json.gz",
            "app/data/europe_topology.na_v2.json",
            "app/data/transport_layers/global_road/catalog.json",
            "app/data/transport_layers/global_rail/catalog.json",
            "app/data/transport_layers/global_rail/regions/south_america/shards/sa_w082_w058/manifest.json",
            "app/data/transport_layers/global_rail/regions/south_america/shards/sa_w082_w058/build_audit.json",
            "app/data/transport_layers/global_rail/regions/south_america/shards/sa_w082_w058/railways.preview.topo.json",
            "app/data/transport_layers/global_airport/airports.geojson",
            "app/data/transport_layers/global_port/ports.geojson",
            "app/data/transport_layers/japan_airport/airports.geojson",
            "app/data/transport_layers/japan_port/ports.core.geojson",
            "app/data/transport_layers/japan_port/ports.expanded.geojson",
            "app/data/transport_layers/japan_port/ports.geojson",
            "app/data/transport_layers/japan_corridor/carrier.json",
            "app/data/transport_layers/japan_road/roads.preview.topo.json",
            "app/data/transport_layers/japan_road/manifest.json",
            "app/data/transport_layers/japan_rail/railways.preview.topo.json",
            "app/data/transport_layers/japan_rail/rail_stations_major.preview.geojson",
            "app/data/transport_layers/japan_rail/manifest.json",
            "app/data/global_contours.major.topo.json",
            "app/data/global_contours.minor.topo.json",
            "app/data/global_rivers.geojson",
            "app/data/bathymetry/global/manifest.json",
            "app/data/bathymetry/global/overview.png",
            "app/data/bathymetry/global/tiles/0_0.png",
            "app/data/scenarios/tno_1962/bathymetry_texture/manifest.json",
            "app/data/scenarios/tno_1962/bathymetry_texture/overlay.png",
        ):
            with self.subTest(expected_path=expected_path):
                self.assertIn(expected_path, paths)

        # The vector bathymetry topology only feeds the landing generator now.
        self.assertNotIn("app/data/global_bathymetry.topo.json", paths)

        city_lights_entries_path = "app/data/city_lights/historical_1930_entries.json"
        self.assertEqual(
            json.loads((PAGES_DIST_ROOT / city_lights_entries_path).read_text(encoding="utf-8")),
            json.loads(
                (REPO_ROOT / "data" / "city_lights" / "historical_1930_entries.json").read_text(encoding="utf-8")
            ),
        )

        for expected_path in expected_landing_asset_paths:
            with self.subTest(asset_copy=expected_path):
                self.assertEqual(
                    (PAGES_DIST_ROOT / expected_path).read_bytes(),
                    (REPO_ROOT / "landing" / expected_path).read_bytes(),
                )

        for relative_path in ("index.html", "app.js", "styles.css"):
            with self.subTest(root_copy=relative_path):
                self.assertEqual(
                    (PAGES_DIST_ROOT / relative_path).read_text(encoding="utf-8").replace("\r\n", "\n"),
                    (REPO_ROOT / "landing" / relative_path).read_text(encoding="utf-8").replace("\r\n", "\n"),
                )

        for dist_js_path in sorted(DIST_APP_JS_ROOT.rglob("*.js")):
            if dist_js_path.is_relative_to(DIST_APP_JS_ROOT / "bundle"):
                continue  # esbuild output, not a mirror of one source file
            source_relative_path = Path("js") / dist_js_path.relative_to(DIST_APP_JS_ROOT)
            source_path = REPO_ROOT / source_relative_path
            with self.subTest(app_js_mirror=str(source_relative_path).replace("\\", "/")):
                self.assertTrue(source_path.exists(), f"{source_relative_path} should be the source for {dist_js_path}")
                self.assertEqual(
                    dist_js_path.read_text(encoding="utf-8").replace("\r\n", "\n"),
                    source_path.read_text(encoding="utf-8").replace("\r\n", "\n"),
                )

        for excluded_path in (
            "app/data/PROBAV_LC100_global_v3.0.1_2019_discrete.tif",
            "app/data/ETOPO_2022_v1_60s_N90W180_surface.tif",
            "app/data/scenarios/tno_1962/derived/marine_regions_named_waters.snapshot.geojson",
            "app/data/scenarios/tno_1962/audit.json",
            "app/data/i18n/locales_baseline.json",
            "app/data/transport_layers/global_road/shards/w120_w090/roads.topo.json",
            "app/data/transport_layers/global_rail/regions/south_america/shards/sa_w082_w058/railways.topo.json",
            "app/data/transport_layers/japan_road/roads.topo.json",
            "app/data/transport_layers/japan_industrial_zones/industrial_zones.open.geojson",
            "app/data/transport_layers/japan_industrial_zones/industrial_zones.internal.preview.geojson",
            "app/data/transport_layers/japan_industrial_zones/industrial_zones.open.preview.geojson",
            "app/data/hgo_runtime/manifest.json",
            "app/data/hgo_runtime/seed.json",
            "app/data/hgo_runtime/provinces.bmp",
            "app/data/scenarios/hgo_1936/manifest.json",
            "app/data/scenarios/hgo_1936/runtime_topology.topo.json",
            "app/data/hgo_catalogs/hgo_flags.index.json",
            "app/data/hgo_catalogs/flags_png/full/AB/ABK.png",
            "app/data/europe_topology.highres.json",
            "app/data/europe_topology.json.bak",
            "app/data/europe_topology.na_v1.json",
            "app/data/city_lights/modern_source_descriptor.json",
            "app/data/city_lights/.gitattributes",
            "tests/fixtures/city_lights/modern_source_fixture_descriptor.json",
            "tests/fixtures/city_lights/modern_source_fixture.pgm",
            "app/js/ui/dev_workspace/scenario_country_color_editor.js",
        ):
            with self.subTest(excluded_path=excluded_path):
                self.assertNotIn(excluded_path, paths)

    def test_tno_coverage_ledgers_are_published_with_runtime_metadata_hashes(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        paths = {record["path"] for record in payload["files"]}
        ledger_files = {
            "atlantropa_donor_ledger": "derived/atlantropa_donor_ledger.json",
            "geometry_drop_audit": "derived/geometry_drop_audit.json",
        }
        expected_ledger_paths = {
            key: f"data/scenarios/tno_1962/{relative_path}"
            for key, relative_path in ledger_files.items()
        }
        expected_report_paths = dict(TNO_COVERAGE_REPORT_PATHS)
        dist_scenario_dir = PAGES_DIST_ROOT / "app" / "data" / "scenarios" / "tno_1962"
        source_scenario_dir = REPO_ROOT / "data" / "scenarios" / "tno_1962"
        runtime_meta = json.loads((dist_scenario_dir / "runtime_meta.json").read_text(encoding="utf-8"))
        build_snapshot = json.loads((dist_scenario_dir / "build_snapshot.json").read_text(encoding="utf-8"))

        for ledger_key, ledger_relative_path in ledger_files.items():
            dist_manifest_path = f"app/data/scenarios/tno_1962/{ledger_relative_path}"
            source_path = source_scenario_dir / ledger_relative_path
            dist_path = dist_scenario_dir / ledger_relative_path
            expected_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
            with self.subTest(ledger_key=ledger_key):
                self.assertIn(dist_manifest_path, paths)
                self.assertTrue(dist_path.is_file())
                self.assertEqual(hashlib.sha256(dist_path.read_bytes()).hexdigest(), expected_hash)
                self.assertEqual(runtime_meta["coverage_ledger_hashes"][ledger_key], expected_hash)
                self.assertEqual(build_snapshot["output_sha"][ledger_relative_path], expected_hash)

        self.assertEqual(runtime_meta["coverage_ledger_paths"], expected_ledger_paths)
        self.assertEqual(runtime_meta["coverage_report_paths"], expected_report_paths)

    def test_dist_hgo_png_manifest_references_only_published_assets(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        hgo_manifest_path = PAGES_DIST_ROOT / "app" / "data" / "hgo_catalogs" / "hgo_flags.png_manifest.json"
        hgo_manifest = json.loads(hgo_manifest_path.read_text(encoding="utf-8"))
        seen_paths: set[str] = set()
        allowed_tiers = set(build_pages_dist.HGO_IDENTITY_FLAG_TIERS)

        def assert_record_published(tier: str, record: dict) -> None:
            self.assertIn(tier, allowed_tiers)
            png_path = record["png_path"]
            self.assertIn(f"app/{png_path}", dist_paths)
            seen_paths.add(png_path)

        for tag, tag_entry in hgo_manifest["tags"].items():
            with self.subTest(tag=tag):
                for tier, record in tag_entry.get("base", {}).items():
                    assert_record_published(tier, record)
                for variant_key, variants in tag_entry.get("variants", {}).items():
                    for tier, record in variants.items():
                        with self.subTest(variant_key=variant_key, tier=tier):
                            assert_record_published(tier, record)

        counts = hgo_manifest["counts"]
        self.assertGreater(len(seen_paths), 0)
        self.assertEqual(counts["files"], len(seen_paths))
        self.assertEqual(counts["tags"], len(hgo_manifest["tags"]))
        self.assertEqual(set(counts["files_by_tier"].keys()), allowed_tiers)
        self.assertNotIn("data/hgo_catalogs/flags_png/full/DK/DKU.png", seen_paths)

        source_hgo_manifest = json.loads(
            (REPO_ROOT / "data" / "hgo_catalogs" / "hgo_flags.png_manifest.json").read_text(encoding="utf-8")
        )
        expected_published_tags: set[str] = set()
        full_only_tags: set[str] = set()
        for tag, tag_entry in source_hgo_manifest["tags"].items():
            source_tiers = set(tag_entry.get("base", {}).keys())
            for variants in tag_entry.get("variants", {}).values():
                source_tiers.update(variants.keys())
            if source_tiers.intersection(allowed_tiers):
                expected_published_tags.add(tag)
            else:
                full_only_tags.add(tag)

        self.assertGreater(len(full_only_tags), 0)
        self.assertEqual(set(hgo_manifest["tags"].keys()), expected_published_tags)
        self.assertEqual(set(source_hgo_manifest["tags"].keys()) - set(hgo_manifest["tags"].keys()), full_only_tags)

    def test_dist_runtime_registry_excludes_unpublished_payloads(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        registry_path = PAGES_DIST_ROOT / "app" / "data" / "runtime_asset_registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        data_manifest = json.loads((PAGES_DIST_ROOT / "app" / "data" / "manifest.json").read_text(encoding="utf-8"))
        local_preview_assets = {
            "hgo_runtime_manifest": "data/hgo_runtime/manifest.json",
            "hgo_runtime_seed": "data/hgo_runtime/seed.json",
            "hgo_runtime_provinces_bmp": "data/hgo_runtime/provinces.bmp",
        }
        unpublished_assets = {
            **local_preview_assets,
            "city_lights:modern:source_descriptor": "data/city_lights/modern_source_descriptor.json",
        }
        local_preview_outputs = {
            "hgo_runtime/manifest.json",
            "hgo_runtime/provinces.bmp",
            "hgo_runtime/seed.json",
        }

        for key, url in unpublished_assets.items():
            with self.subTest(key=key):
                self.assertNotIn(key, registry.get("assets", {}))
                self.assertNotIn(key, data_manifest.get("runtime_asset_registry", {}).get("assets", {}))
                self.assertNotIn(f"app/{url}", dist_paths)
                self.assertFalse((PAGES_DIST_ROOT / "app" / url).exists())

        self.assertEqual(
            registry.get("pages_dist_policy", {}).get("removed_unpublished_asset_keys"),
            ["city_lights:modern:source_descriptor"],
        )
        self.assertEqual(
            data_manifest.get("runtime_asset_registry", {}).get("pages_dist_policy", {}).get("removed_unpublished_asset_keys"),
            ["city_lights:modern:source_descriptor"],
        )
        for output_key in local_preview_outputs:
            with self.subTest(output_key=output_key):
                self.assertNotIn(output_key, data_manifest.get("outputs", {}))
        self.assertTrue(
            local_preview_outputs.isdisjoint(
                set(data_manifest.get("pages_dist_policy", {}).get("removed_unpublished_output_keys", []))
            )
        )

        catalog = json.loads((PAGES_DIST_ROOT / "app" / "data" / "CATALOG.json").read_text(encoding="utf-8"))
        catalog_entries = {entry["key"]: entry for entry in catalog.get("entries") or []}
        for key in unpublished_assets:
            with self.subTest(catalog_key=key):
                self.assertNotIn(key, catalog_entries)

    def test_dist_data_manifest_outputs_reference_only_published_files(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        data_manifest = json.loads((PAGES_DIST_ROOT / "app" / "data" / "manifest.json").read_text(encoding="utf-8"))
        missing = []

        for output_key in data_manifest.get("outputs", {}):
            relative_path = Path(str(output_key).replace("\\", "/"))
            if relative_path.is_absolute() or ".." in relative_path.parts:
                missing.append(f"{output_key} -> invalid path")
                continue
            dist_path = (
                PAGES_DIST_ROOT / "app" / relative_path
                if relative_path.parts and relative_path.parts[0] == "js"
                else PAGES_DIST_ROOT / "app" / "data" / relative_path
            )
            if not dist_path.is_file():
                missing.append(f"{output_key} -> {dist_path.relative_to(REPO_ROOT)}")

        self.assertFalse(missing[:20], missing[:20])

    def test_dist_runtime_registry_references_only_published_files(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        registry_path = PAGES_DIST_ROOT / "app" / "data" / "runtime_asset_registry.json"
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        missing: list[str] = []

        for asset_key, asset in (registry.get("assets") or {}).items():
            runtime_url = asset.get("url") if isinstance(asset, dict) else None
            if isinstance(runtime_url, str) and runtime_url.startswith("data/"):
                dist_path = f"app/{runtime_url}"
                if dist_path not in dist_paths or not (PAGES_DIST_ROOT / dist_path).is_file():
                    missing.append(f"{asset_key} -> {runtime_url}")

        self.assertFalse(missing[:20], missing[:20])

    def test_dist_city_aliases_uses_reduced_pages_subset(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        source_path = REPO_ROOT / "data" / "city_aliases.json"
        dist_path = PAGES_DIST_ROOT / "app" / "data" / "city_aliases.json"
        source_payload = json.loads(source_path.read_text(encoding="utf-8"))
        dist_payload = json.loads(dist_path.read_text(encoding="utf-8"))
        policy = dist_payload.get("pages_dist_policy", {})
        source_alias_map = source_payload.get("alias_to_stable_key", {})
        dist_alias_map = dist_payload.get("alias_to_stable_key", {})
        source_stable_keys = {
            str(entry.get("stable_key") or entry.get("locale_key") or entry.get("city_id") or "").strip()
            for entry in source_payload.get("entries", [])
            if isinstance(entry, dict)
        }
        source_stable_keys.discard("")

        self.assertTrue(dist_path.is_file())
        self.assertLess(dist_path.stat().st_size, source_path.stat().st_size)
        self.assertLess(dist_path.stat().st_size, 5 * 1024 * 1024)
        self.assertEqual(policy.get("policy"), "reduced_alias_subset")
        self.assertEqual(
            policy.get("alias_mapping_source"),
            "source_alias_to_stable_key_filtered_by_selected_stable_keys",
        )
        self.assertEqual(policy.get("entry_alias_generation"), "disabled")
        self.assertEqual(policy.get("priority_source"), "data/world_cities.geojson")
        self.assertEqual(
            policy.get("stable_key_selection"),
            "world_city_capital_tier_population_priority",
        )
        self.assertEqual(policy.get("stable_key_limit"), build_pages_dist.PAGES_CITY_ALIAS_STABLE_KEY_LIMIT)
        self.assertEqual(policy.get("source_entry_count"), source_payload.get("entry_count"))
        self.assertEqual(policy.get("source_alias_count"), source_payload.get("alias_count"))
        self.assertEqual(policy.get("source_stable_key_count"), len(source_stable_keys))
        self.assertGreaterEqual(policy.get("priority_stable_key_count"), policy.get("selected_stable_key_count"))
        self.assertEqual(
            policy.get("selected_stable_key_count"),
            build_pages_dist.PAGES_CITY_ALIAS_STABLE_KEY_LIMIT,
        )
        self.assertEqual(dist_payload.get("entries"), [])
        self.assertEqual(dist_payload.get("entry_count"), len(dist_payload.get("entries") or []))
        self.assertLess(dist_payload.get("alias_count"), source_payload.get("alias_count"))
        self.assertEqual(dist_payload.get("alias_count"), len(dist_alias_map))
        self.assertIsInstance(dist_alias_map, dict)
        self.assertGreater(len(dist_alias_map), 0)
        for expected_alias in ("Tokyo", "Shanghai", "New York", "Berlin"):
            with self.subTest(expected_alias=expected_alias):
                self.assertEqual(dist_alias_map.get(expected_alias), source_alias_map.get(expected_alias))
                self.assertIn(dist_alias_map[expected_alias], dist_payload.get("geo", {}))
        data_manifest_path = PAGES_DIST_ROOT / "app" / "data" / "manifest.json"
        data_manifest = json.loads(data_manifest_path.read_text(encoding="utf-8"))
        city_manifest_record = data_manifest.get("outputs", {}).get("city_aliases.json", {})
        dist_bytes = dist_path.read_bytes()
        self.assertEqual(city_manifest_record.get("size_bytes"), len(dist_bytes))
        self.assertEqual(city_manifest_record.get("sha256"), hashlib.sha256(dist_bytes).hexdigest())
        self.assertEqual(city_manifest_record.get("entry_count"), dist_payload.get("entry_count"))
        self.assertEqual(city_manifest_record.get("alias_count"), dist_payload.get("alias_count"))
        self.assertEqual(
            city_manifest_record.get("ambiguous_alias_count"),
            dist_payload.get("ambiguous_alias_count"),
        )
        self.assertEqual(city_manifest_record.get("pages_dist_policy"), policy)
        catalog = json.loads((PAGES_DIST_ROOT / "app" / "data" / "CATALOG.json").read_text(encoding="utf-8"))
        city_catalog_entry = next(
            entry
            for entry in catalog.get("entries", [])
            if entry.get("url") == "data/city_aliases.json"
        )
        self.assertEqual(
            city_catalog_entry.get("hashRef"),
            "data/manifest.json::outputs::city_aliases.json::sha256",
        )
        for ambiguous_alias in ("Khanabad", "Hrazdan", "25 de Mayo"):
            with self.subTest(ambiguous_alias=ambiguous_alias):
                self.assertNotIn(ambiguous_alias, source_alias_map)
                self.assertNotIn(ambiguous_alias, dist_alias_map)

    def test_dist_pages_scenario_index_keeps_public_policy_without_hgo_manifest(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        index_path = PAGES_DIST_ROOT / "app" / "data" / "scenarios" / "index.json"
        scenario_index = json.loads(index_path.read_text(encoding="utf-8"))
        public_baseline_ids = ["blank_base", "modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"]
        scenario_ids = [entry.get("scenario_id") for entry in scenario_index.get("scenarios", [])]

        self.assertEqual(scenario_index.get("public_baseline_ids"), public_baseline_ids)
        self.assertEqual(scenario_index.get("developer_preview_ids"), [])
        self.assertEqual(sorted(scenario_ids), sorted(public_baseline_ids))
        self.assertNotIn("hgo_1936", scenario_ids)
        self.assertEqual(
            scenario_index.get("pages_dist_policy", {}).get("local_preview_scenario_ids"),
            [],
        )
        for entry in scenario_index.get("scenarios", []):
            manifest_url = entry.get("manifest_url")
            with self.subTest(scenario_id=entry.get("scenario_id")):
                self.assertIn(f"app/{manifest_url}", dist_paths)

    def test_dist_manifest_keeps_japan_point_workbench_full_pack_targets(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}

        for manifest_relative_path in (
            "data/transport_layers/japan_airport/manifest.json",
            "data/transport_layers/japan_port/manifest.json",
        ):
            manifest = json.loads((REPO_ROOT / manifest_relative_path).read_text(encoding="utf-8"))
            path_sections = [manifest.get("paths", {})]
            variants = manifest.get("variants", {})
            if isinstance(variants, dict):
                path_sections.extend(
                    variant.get("paths", {}) for variant in variants.values() if isinstance(variant, dict)
                )

            for path_section in path_sections:
                full_paths = path_section.get("full", {})
                if not isinstance(full_paths, dict):
                    continue
                for runtime_path in full_paths.values():
                    with self.subTest(manifest=manifest_relative_path, runtime_path=runtime_path):
                        self.assertIn(f"app/{runtime_path}", dist_paths)

    def test_dist_transport_manifests_reference_only_published_pack_files(self) -> None:
        transport_root = PAGES_DIST_ROOT / "app" / "data" / "transport_layers"
        if not transport_root.exists():
            self.skipTest("dist transport layers are only available after build_pages_dist runs")
        missing: list[str] = []
        for manifest_path in transport_root.rglob("manifest.json"):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            path_sections = [manifest.get("paths", {})]
            variants = manifest.get("variants", {})
            if isinstance(variants, dict):
                path_sections.extend(
                    variant.get("paths", {}) for variant in variants.values() if isinstance(variant, dict)
                )
            for path_section in path_sections:
                if not isinstance(path_section, dict):
                    continue
                for mode in ("preview", "full"):
                    mode_paths = path_section.get(mode, {})
                    if not isinstance(mode_paths, dict):
                        continue
                    for runtime_path in mode_paths.values():
                        if isinstance(runtime_path, str) and runtime_path.startswith("data/transport_layers/"):
                            if not (PAGES_DIST_ROOT / "app" / runtime_path).is_file():
                                missing.append(f"{manifest_path.relative_to(transport_root)} -> {runtime_path}")

        self.assertFalse(missing[:20], missing[:20])

    def test_dist_japan_industrial_manifest_prunes_local_preview_payload(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        source_manifest_path = REPO_ROOT / "data" / "transport_layers" / "japan_industrial_zones" / "manifest.json"
        dist_manifest_path = PAGES_DIST_ROOT / "app" / "data" / "transport_layers" / "japan_industrial_zones" / "manifest.json"
        source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
        dist_manifest = json.loads(dist_manifest_path.read_text(encoding="utf-8"))
        local_preview_paths = {
            "data/transport_layers/japan_industrial_zones/industrial_zones.internal.preview.geojson",
            "data/transport_layers/japan_industrial_zones/industrial_zones.open.preview.geojson",
        }

        self.assertTrue(local_preview_paths.issubset({
            source_manifest.get("paths", {}).get("preview", {}).get("industrial_zones"),
            source_manifest.get("variants", {}).get("open", {}).get("paths", {}).get("preview", {}).get("industrial_zones"),
        }))
        for runtime_path in local_preview_paths:
            with self.subTest(runtime_path=runtime_path):
                self.assertNotIn(f"app/{runtime_path}", dist_paths)
                self.assertFalse((PAGES_DIST_ROOT / "app" / runtime_path).exists())

        path_sections = [dist_manifest.get("paths", {})]
        variants = dist_manifest.get("variants", {})
        if isinstance(variants, dict):
            path_sections.extend(
                variant.get("paths", {}) for variant in variants.values() if isinstance(variant, dict)
            )
        for path_section in path_sections:
            if not isinstance(path_section, dict):
                continue
            preview_paths = path_section.get("preview")
            if isinstance(preview_paths, dict):
                self.assertNotIn("industrial_zones", preview_paths)

    def test_dist_catalog_references_only_published_files(self) -> None:
        catalog_path = PAGES_DIST_ROOT / "app" / "data" / "CATALOG.json"
        if not catalog_path.exists():
            self.skipTest("dist catalog is only available after build_pages_dist runs")
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
        missing: list[str] = []
        entries = payload.get("entries") or []
        for entry in entries:
            runtime_path = entry.get("url") if isinstance(entry, dict) else None
            if isinstance(runtime_path, str) and runtime_path.startswith("data/"):
                if not (PAGES_DIST_ROOT / "app" / runtime_path).is_file():
                    missing.append(f"{entry.get('key', '<unknown>')} -> {runtime_path}")

        self.assertEqual(payload.get("counts", {}).get("entries"), len(entries))
        self.assertFalse(missing[:20], missing[:20])

    def test_dist_transport_manifests_do_not_alias_full_paths_to_preview(self) -> None:
        transport_root = PAGES_DIST_ROOT / "app" / "data" / "transport_layers"
        if not transport_root.exists():
            self.skipTest("dist transport layers are only available after build_pages_dist runs")
        aliased: list[str] = []
        orphaned_counts: list[str] = []
        for manifest_path in transport_root.rglob("manifest.json"):
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            sections = [(manifest.get("paths", {}), manifest.get("feature_counts", {}), manifest_path)]
            variants = manifest.get("variants", {})
            if isinstance(variants, dict):
                sections.extend(
                    (variant.get("paths", {}), variant.get("feature_counts", {}), manifest_path)
                    for variant in variants.values()
                    if isinstance(variant, dict)
                )
            for path_section, count_section, source_path in sections:
                if not isinstance(path_section, dict):
                    continue
                preview_paths = path_section.get("preview") if isinstance(path_section.get("preview"), dict) else {}
                full_paths = path_section.get("full") if isinstance(path_section.get("full"), dict) else {}
                if isinstance(count_section, dict):
                    for mode, counts in count_section.items():
                        mode_paths = path_section.get(mode)
                        if isinstance(counts, dict) and isinstance(mode_paths, dict):
                            missing_count_keys = set(counts).difference(mode_paths)
                            orphaned_counts.extend(
                                f"{source_path.relative_to(transport_root)}:{mode}:{key}"
                                for key in sorted(missing_count_keys)
                            )
                for key, runtime_path in full_paths.items():
                    if preview_paths.get(key) == runtime_path:
                        aliased.append(f"{source_path.relative_to(transport_root)}:{key}:{runtime_path}")

        self.assertFalse(aliased[:20], aliased[:20])
        self.assertFalse(orphaned_counts[:20], orphaned_counts[:20])

    def test_dist_uk_industrial_manifest_uses_preview_only_reduced_contract(self) -> None:
        source_manifest_path = REPO_ROOT / "data" / "transport_layers" / "uk_industrial_zones" / "manifest.json"
        dist_manifest_path = PAGES_DIST_ROOT / "app" / "data" / "transport_layers" / "uk_industrial_zones" / "manifest.json"
        if not dist_manifest_path.exists():
            self.skipTest("dist transport layers are only available after build_pages_dist runs")

        source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
        dist_manifest = json.loads(dist_manifest_path.read_text(encoding="utf-8"))
        self.assertIn("full", source_manifest.get("paths", {}))
        self.assertIn("preview", dist_manifest.get("paths", {}))
        self.assertNotIn("full", dist_manifest.get("paths", {}))

        variants = dist_manifest.get("variants", {})
        self.assertIsInstance(variants, dict)
        for variant in variants.values():
            if not isinstance(variant, dict):
                continue
            with self.subTest(variant=variant.get("label") or "default"):
                self.assertIn("preview", variant.get("paths", {}))
                self.assertNotIn("full", variant.get("paths", {}))

    def test_dist_scenario_manifests_reference_only_published_runtime_files(self) -> None:
        if not DIST_MANIFEST.exists():
            self.skipTest("dist/pages-dist-manifest.json is only available after build_pages_dist runs")
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        dist_paths = {record["path"] for record in payload["files"]}
        scenario_manifest_paths = sorted(
            path for path in dist_paths
            if path.startswith("app/data/scenarios/") and path.endswith("/manifest.json")
        )
        self.assertGreater(len(scenario_manifest_paths), 0)
        checked_urls = 0
        for manifest_path in scenario_manifest_paths:
            manifest = json.loads((PAGES_DIST_ROOT / manifest_path).read_text(encoding="utf-8"))
            with self.subTest(manifest_path=manifest_path):
                for key, value in manifest.items():
                    if key.endswith("_url") and isinstance(value, str) and value.startswith("data/scenarios/"):
                        checked_urls += 1
                        self.assertIn(f"app/{value}", dist_paths)
                detail_manifest_url = manifest.get("detail_chunk_manifest_url")
                if isinstance(detail_manifest_url, str) and detail_manifest_url:
                    detail_manifest = json.loads((PAGES_DIST_ROOT / "app" / detail_manifest_url).read_text(encoding="utf-8"))
                    for chunk in detail_manifest.get("chunks", []):
                        chunk_url = chunk.get("url") if isinstance(chunk, dict) else ""
                        if isinstance(chunk_url, str) and chunk_url:
                            checked_urls += 1
                            self.assertIn(f"app/{chunk_url}", dist_paths)
                for language in ("en", "zh"):
                    bundle_url = manifest.get(f"startup_bundle_url_{language}")
                    if not isinstance(bundle_url, str) or not bundle_url:
                        continue
                    bundle = json.loads((PAGES_DIST_ROOT / "app" / bundle_url).read_text(encoding="utf-8"))
                    manifest_subset = bundle.get("manifest_subset")
                    self.assertIsInstance(manifest_subset, dict)
                    for key, value in manifest_subset.items():
                        if key.endswith("_url") and isinstance(value, str) and value.startswith("data/scenarios/"):
                            checked_urls += 1
                            self.assertIn(f"app/{value}", dist_paths)
        self.assertGreater(checked_urls, 0)

    def test_pages_scenario_metadata_strips_unpublished_audit_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            scenarios_dir = Path(tmp_dir) / "data" / "scenarios"
            scenario_dir = scenarios_dir / "sample_scenario"
            scenario_dir.mkdir(parents=True)
            (scenarios_dir / "index.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "scenarios": [
                            {
                                "scenario_id": "sample_scenario",
                                "manifest_url": "data/scenarios/sample_scenario/manifest.json",
                                "audit_url": "data/scenarios/sample_scenario/audit.json",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            (scenario_dir / "manifest.json").write_text(
                json.dumps(
                    {
                        "scenario_id": "sample_scenario",
                        "audit_url": "data/scenarios/sample_scenario/audit.json",
                        "countries_url": "data/scenarios/sample_scenario/countries.json",
                        "controllers_url": "data/scenarios/sample_scenario/controllers.by_feature.json",
                        "runtime_topology_url": "data/scenarios/sample_scenario/runtime_topology.topo.json",
                    }
                ),
                encoding="utf-8",
            )
            bundle_payload = {
                "scenario_id": "sample_scenario",
                "manifest_subset": {
                    "scenario_id": "sample_scenario",
                    "audit_url": "data/scenarios/sample_scenario/audit.json",
                    "controllers_url": "data/scenarios/sample_scenario/controllers.by_feature.json",
                    "runtime_topology_url": "data/scenarios/sample_scenario/runtime_topology.topo.json",
                    "countries_url": "data/scenarios/sample_scenario/countries.json",
                },
            }
            bundle_path = scenario_dir / "startup.bundle.en.json"
            bundle_bytes = json.dumps(bundle_payload, separators=(",", ":")).encode("utf-8")
            bundle_path.write_bytes(bundle_bytes)
            (scenario_dir / "startup.bundle.en.json.gz").write_bytes(gzip.compress(bundle_bytes, mtime=0))

            build_pages_dist.strip_scenario_publish_audit_urls(scenarios_dir)

            index_payload = json.loads((scenarios_dir / "index.json").read_text(encoding="utf-8"))
            manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
            bundle_payload = json.loads(bundle_path.read_text(encoding="utf-8"))
            gzip_bundle_payload = json.loads(gzip.decompress((scenario_dir / "startup.bundle.en.json.gz").read_bytes()))

            self.assertNotIn("audit_url", index_payload["scenarios"][0])
            self.assertNotIn("audit_url", manifest_payload)
            self.assertNotIn("controllers_url", manifest_payload)
            self.assertNotIn("runtime_topology_url", manifest_payload)
            self.assertEqual(manifest_payload["countries_url"], "data/scenarios/sample_scenario/countries.json")
            self.assertNotIn("audit_url", bundle_payload["manifest_subset"])
            self.assertNotIn("controllers_url", bundle_payload["manifest_subset"])
            self.assertNotIn("runtime_topology_url", bundle_payload["manifest_subset"])
            self.assertEqual(
                bundle_payload["manifest_subset"]["countries_url"],
                "data/scenarios/sample_scenario/countries.json",
            )
            self.assertEqual(gzip_bundle_payload, bundle_payload)

    def test_pages_scenario_metadata_preserves_published_controllers_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            previous_app_dist_root = build_pages_dist.APP_DIST_ROOT
            app_dist_root = Path(tmp_dir)
            scenarios_dir = app_dist_root / "data" / "scenarios"
            scenario_dir = scenarios_dir / "sample_scenario"
            scenario_dir.mkdir(parents=True)
            build_pages_dist.APP_DIST_ROOT = app_dist_root
            try:
                controllers_url = "data/scenarios/sample_scenario/controllers.by_feature.json"
                (scenario_dir / "controllers.by_feature.json").write_text("{}", encoding="utf-8")
                (scenario_dir / "manifest.json").write_text(
                    json.dumps(
                        {
                            "scenario_id": "sample_scenario",
                            "controllers_url": controllers_url,
                        }
                    ),
                    encoding="utf-8",
                )
                bundle_payload = {
                    "scenario_id": "sample_scenario",
                    "manifest_subset": {
                        "scenario_id": "sample_scenario",
                        "controllers_url": controllers_url,
                    },
                }
                bundle_path = scenario_dir / "startup.bundle.en.json"
                bundle_bytes = json.dumps(bundle_payload, separators=(",", ":")).encode("utf-8")
                bundle_path.write_bytes(bundle_bytes)
                (scenario_dir / "startup.bundle.en.json.gz").write_bytes(gzip.compress(bundle_bytes, mtime=0))

                build_pages_dist.strip_scenario_publish_audit_urls(scenarios_dir)

                manifest_payload = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
                bundle_payload = json.loads(bundle_path.read_text(encoding="utf-8"))
                gzip_bundle_payload = json.loads(
                    gzip.decompress((scenario_dir / "startup.bundle.en.json.gz").read_bytes())
                )
                self.assertEqual(manifest_payload["controllers_url"], controllers_url)
                self.assertEqual(bundle_payload["manifest_subset"]["controllers_url"], controllers_url)
                self.assertEqual(gzip_bundle_payload, bundle_payload)
            finally:
                build_pages_dist.APP_DIST_ROOT = previous_app_dist_root

    def test_pages_dist_binary_writer_recreates_missing_parent_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target_path = Path(tmp_dir) / "dist" / "app" / "data" / "scenarios" / "sample" / "startup.bundle.en.json"

            build_pages_dist.write_bytes_with_parent(target_path, b'{"ok":true}')

            self.assertEqual(target_path.read_bytes(), b'{"ok":true}')

    def test_pages_dist_path_guard_treats_windows_extended_prefix_as_same_root(self) -> None:
        if os.name != "nt":
            self.skipTest("Windows extended-path normalization is only active on Windows.")

        root_path = Path("C:/repo/dist/app")
        normal_path = root_path / "data" / "scenarios" / "sample" / "chunks" / "political.detail.country.swe.json"
        extended_path = Path("\\\\?\\C:\\repo\\dist\\app\\data\\scenarios\\sample\\chunks\\political.detail.country.swe.json")
        unc_path = Path("\\\\server\\share\\repo\\dist\\app\\data\\scenarios\\sample\\manifest.json")
        extended_unc_path = Path("\\\\?\\UNC\\server\\share\\repo\\dist\\app\\data\\scenarios\\sample\\manifest.json")

        self.assertEqual(
            build_pages_dist.normalize_windows_path_text(normal_path),
            build_pages_dist.normalize_windows_path_text(extended_path),
        )
        self.assertEqual(
            build_pages_dist.normalize_windows_path_text(unc_path),
            build_pages_dist.normalize_windows_path_text(extended_unc_path),
        )

    def test_pages_dist_path_guard_rejects_parent_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            previous_app_dist_root = build_pages_dist.APP_DIST_ROOT
            build_pages_dist.APP_DIST_ROOT = Path(tmp_dir) / "dist" / "app"
            try:
                with self.assertRaises(ValueError):
                    build_pages_dist._dist_path_for_app_url("../outside.json")
            finally:
                build_pages_dist.APP_DIST_ROOT = previous_app_dist_root

    def test_pages_dist_lf_normalizer_fails_when_scanned_file_disappears(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            previous_dist_root = build_pages_dist.DIST_ROOT
            tmp_root = Path(tmp_dir) / "dist"
            removed_path = tmp_root / "app" / "data" / "hgo_catalogs" / "hgo_flags.png_manifest.json"
            build_pages_dist.DIST_ROOT = tmp_root
            try:
                with self.assertRaises(FileNotFoundError):
                    build_pages_dist.normalize_dist_text_file_lf(removed_path)
            finally:
                build_pages_dist.DIST_ROOT = previous_dist_root

    def test_pages_dist_lf_normalizer_can_skip_explicit_optional_missing_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            previous_dist_root = build_pages_dist.DIST_ROOT
            tmp_root = Path(tmp_dir) / "dist"
            removed_path = tmp_root / "app" / "data" / "hgo_catalogs" / "hgo_flags.png_manifest.json"
            build_pages_dist.DIST_ROOT = tmp_root
            try:
                build_pages_dist.normalize_dist_text_file_lf(removed_path, allow_missing=True)
            finally:
                build_pages_dist.DIST_ROOT = previous_dist_root

    def test_political_raster_dist_checks_payloads_and_rejects_corruption(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            previous = build_pages_dist.APP_DIST_ROOT
            build_pages_dist.APP_DIST_ROOT = Path(directory)
            try:
                payload = b"political raster fixture"
                digest = hashlib.sha256(payload).hexdigest()
                tile_path = Path(directory) / f"{digest}.pidr.gz"
                compressed = gzip.compress(payload, mtime=0)
                tile_path.write_bytes(compressed)
                tile = {"identity": "political-id-raster:v1:" + "0" * 64,
                        "url": f"./{digest}.pidr.gz", "compression": "gzip", "sha256": digest,
                        "byteLength": len(payload), "compressedByteLength": len(compressed)}
                manifest_path = Path(directory) / "manifest.json"
                manifest = {"schemaVersion": 1, "scenarioId": "sample", "tiles": [tile]}
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "other")
                tile["byteLength"] -= 1
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                tile["byteLength"] += 1
                tile["url"] = "../outside.pidr.gz"
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                tile["url"] = f"./{digest}.pidr.gz"
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
                tile_path.write_bytes(compressed[:-1])
                with self.assertRaises(ValueError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
                tile_path.unlink()
                with self.assertRaises(FileNotFoundError):
                    build_pages_dist.validate_dist_political_id_raster_manifest("manifest.json", "sample")
            finally:
                build_pages_dist.APP_DIST_ROOT = previous

    def test_pages_scenario_url_probe_rejects_empty_manifest_url(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            previous_app_dist_root = build_pages_dist.APP_DIST_ROOT
            app_dist_root = Path(tmp_dir) / "app"
            scenarios_dir = app_dist_root / "data" / "scenarios"
            scenarios_dir.mkdir(parents=True)
            (scenarios_dir / "index.json").write_text(
                json.dumps({"version": 1, "scenarios": [{"scenario_id": "broken", "manifest_url": ""}]}),
                encoding="utf-8",
            )
            build_pages_dist.APP_DIST_ROOT = app_dist_root
            try:
                with self.assertRaises(FileNotFoundError) as raised:
                    build_pages_dist.validate_dist_scenario_startup_urls()
            finally:
                build_pages_dist.APP_DIST_ROOT = previous_app_dist_root

            self.assertIn("broken.manifest_url: <empty>", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
