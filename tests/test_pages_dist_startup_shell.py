from __future__ import annotations

import os
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
LANDING_STYLES_CSS = REPO_ROOT / "landing" / "styles.css"
LANDING_ASSETS = REPO_ROOT / "landing" / "assets"
MAP_RENDERER_JS = REPO_ROOT / "js" / "core" / "map_renderer.js"
DRAW_CANVAS_ORCHESTRATION_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "draw_canvas_orchestration_owner.js"
CACHED_PASS_COMPOSITOR_OWNER_JS = REPO_ROOT / "js" / "core" / "renderer" / "cached_pass_compositor_owner.js"
HGO_RUNTIME_PREVIEW_RENDER_OWNER_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "hgo_runtime_preview_render_owner.js"
HGO_RUNTIME_PREVIEW_FRAME_COMMIT_JS = REPO_ROOT / "js" / "core" / "map_renderer" / "hgo_runtime_preview_frame_commit.js"
DIST_ROOT_INDEX = PAGES_DIST_ROOT / "index.html"
DIST_APP_JS = PAGES_DIST_ROOT / "app.js"
DIST_STYLES_CSS = PAGES_DIST_ROOT / "styles.css"
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


def assert_css_block_avoids_viewport_font_scaling(
    test_case: unittest.TestCase,
    styles_css: str,
    selector: str,
) -> None:
    match = re.search(rf"{re.escape(selector)}\s*\{{(?P<body>[^}}]*)\}}", styles_css, re.S)
    test_case.assertIsNotNone(match)
    body = match.group("body")
    test_case.assertIn("font-size:", body)
    test_case.assertNotIn("clamp(", body)
    test_case.assertNotIn("vw", body)


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
    def test_published_modern_world_keeps_renderable_runtime_topology(self):
        app_root = PAGES_DIST_ROOT / "app"
        manifest = json.loads((app_root / "data/scenarios/modern_world/manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["runtime_topology_url"], "data/scenarios/modern_world/runtime_topology.topo.json")
        topology = json.loads((app_root / manifest["runtime_topology_url"]).read_text(encoding="utf-8"))
        geometries = topology["objects"]["political"]["geometries"]
        self.assertTrue(any(item.get("type") in {"Polygon", "MultiPolygon"} and item.get("arcs")
                            for item in geometries))


    def test_checked_in_pages_dist_manifest_exists(self) -> None:
        self.assertTrue(
            DIST_MANIFEST.exists(),
            "dist/pages-dist-manifest.json is a checked-in Pages dist contract",
        )
        payload = json.loads(DIST_MANIFEST.read_text(encoding="utf-8"))
        self.assertEqual(payload.get("schema_version"), build_pages_dist.PAGES_DIST_MANIFEST_SCHEMA_VERSION)
        self.assertIsInstance(payload.get("files"), list)
        self.assertGreater(len(payload.get("files", [])), 0)
        for field_name in ("total_bytes", "max_allowed_bytes", "size_gate", "required_files"):
            with self.subTest(field_name=field_name):
                self.assertIn(field_name, payload)

    def test_pages_dist_drift_guard_covers_tracked_dist_outputs(self) -> None:
        try:
            result = subprocess.run(
                ["git", "ls-files", "dist"],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
        except (FileNotFoundError, subprocess.CalledProcessError) as exc:
            raise unittest.SkipTest(f"git tracked dist list unavailable: {exc}") from exc

        pathspecs = (
            "dist/.nojekyll",
            "dist/app.js",
            "dist/index.html",
            "dist/styles.css",
            "dist/assets",
            "dist/app/index.html",
            "dist/app/js",
            "dist/app/css",
            "dist/app/vendor",
            "dist/pages-dist-manifest.json",
        )
        tracked_paths = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        uncovered = [
            path
            for path in tracked_paths
            if not any(path == spec or path.startswith(f"{spec}/") for spec in pathspecs)
        ]
        self.assertEqual([], uncovered)

        package_text = (REPO_ROOT / "package.json").read_text(encoding="utf-8")
        workflow_text = VERIFY_SHARED_WORKFLOW.read_text(encoding="utf-8")
        for spec in pathspecs:
            with self.subTest(spec=spec):
                self.assertIn(spec, package_text)
                self.assertIn(spec, workflow_text)

    def test_landing_generated_cartography_assets_exist(self) -> None:
        source_svg_assets = (
            "hero-cartography.svg",
            "hero-blank.svg",
            "hero-hoi4-1936.svg",
            "hero-hoi4-1939.svg",
            "hero-tno-1962.svg",
            "showcase-final-map.svg",
            "europe-1936-showcase.svg",
            "japan-preview-transport.svg",
            "japan-preview-cities.svg",
            "japan-preview-terrain.svg",
            "japan-preview-night.svg",
            "template-blank.svg",
            "template-modern.svg",
            "template-hoi4.svg",
            "template-tno.svg",
        )
        webp_delivery_assets = (
            "hero-blank.webp",
            "hero-hoi4-1936.webp",
            "hero-hoi4-1939.webp",
            "hero-tno-1962.webp",
            "showcase-final-map.webp",
            "japan-preview-transport.webp",
            "japan-preview-cities.webp",
            "japan-preview-terrain.webp",
            "japan-preview-night.webp",
            "template-blank.webp",
            "template-modern.webp",
            "template-hoi4.webp",
            "template-tno.webp",
        )
        for asset_name in source_svg_assets:
            with self.subTest(asset_name=asset_name):
                asset = LANDING_ASSETS / asset_name
                self.assertTrue(asset.exists(), f"{asset_name} should be checked in for Pages")
                text = asset.read_text(encoding="utf-8")
                self.assertIn("<svg", text)
                self.assertIn("viewBox", text)
                self.assertIn("<path", text)
                ET.fromstring(text)
                if asset_name == "hero-blank.svg":
                    size_limit = 1_350_000
                elif asset_name.startswith("japan-preview-"):
                    size_limit = 340_000
                elif asset_name.startswith("hero-") and asset_name != "hero-cartography.svg":
                    size_limit = 320_000
                else:
                    size_limit = 520_000 if asset_name == "europe-1936-showcase.svg" else 220_000
                self.assertLess(asset.stat().st_size, size_limit)
                if asset_name == "europe-1936-showcase.svg":
                    self.assertIn('data-showcase-viewport="true"', text)
                    self.assertIn('data-layer="context-land"', text)
                    self.assertIn('data-layer="urban"', text)
                    self.assertIn('data-layer="rivers"', text)
                    self.assertIn('data-layer="country-labels"', text)
                    self.assertIn('data-layer="day-night"', text)
                    self.assertIn('class="territory-context territory-context--egy"', text)
                    self.assertIn('class="territory-context territory-context--syr"', text)
                    self.assertIn('class="map-edge-fog"', text)
                    self.assertRegex(text, r"\.map-edge-fog (?:>|&gt;) \*")
                    self.assertIn("softEdgeBlur", text)
                    self.assertIn("railGlow", text)
                    self.assertIn('data-showcase-city-detail="base"', text)
                    self.assertIn('class="urban-area"', text)
                    self.assertIn('class="river-line"', text)
                    self.assertIn('class="country-label"', text)
                    self.assertIn('class="city-label"', text)
                    self.assertIn('class="ambient-night-light', text)
                    self.assertIn("ambientLightGlow", text)
                    self.assertIn("nightCycleGradient", text)
                    self.assertIn("nightShadowGradient", text)
                    self.assertIn("nightTexture", text)
                    self.assertIn("night-light-belt", text)
                    self.assertIn("night-light-smear", text)
                    self.assertIn("day-night-shade", text)
                    self.assertIn("nightActivityClip", text)
                    self.assertIn("nightCycleGradient", text)
                    self.assertIn("animateTransform", text)
                    self.assertNotIn("data-showcase-viewport transform=", text)
                    self.assertNotIn('data-layer="scenario"', text)
                if asset_name.startswith("hero-") and asset_name != "hero-cartography.svg":
                    expected_mode = asset_name.removeprefix("hero-").removesuffix(".svg")
                    self.assertIn(f'data-hero-scenario="{expected_mode}"', text)
                    self.assertIn('data-layer="political"', text)
                    if asset_name == "hero-blank.svg":
                        self.assertIn('class="blank-coastline"', text)
                        self.assertIn("stroke-width: .25", text)
                        self.assertIn("stroke-width: .5", text)
                if asset_name.startswith("japan-preview-"):
                    self.assertIn('data-preview-map="japan"', text)
                    self.assertIn('data-source="japan-corridor-carrier"', text)
                    self.assertIn('data-source="japan-road-preview"', text)
                    self.assertIn('data-source="japan-main-corridor"', text)
                    self.assertIn('data-source="japan-rail-preview"', text)
                    self.assertIn('data-source="world-cities-japan-focus"', text)
                    self.assertIn('data-source="global-contours-major"', text)
                    self.assertIn('data-source="nasa-black-marble-2016"', text)
                    self.assertIn('class="main-corridor"', text)
                    self.assertIn('class="focus-city"', text)
                    self.assertIn("corridorGlow", text)
                    self.assertIn("cityGlow", text)
                    self.assertIn("<title>Tokyo</title>", text)
                    self.assertIn("<title>Osaka</title>", text)
                    self.assertIn("<title>Nagoya · Aichi</title>", text)

        for asset_name in webp_delivery_assets:
            with self.subTest(asset_name=asset_name):
                asset = LANDING_ASSETS / asset_name
                self.assertTrue(asset.exists(), f"{asset_name} should be checked in for Pages delivery")
                self.assertLess(asset.stat().st_size, 120_000)

    def test_landing_social_preview_contract(self) -> None:
        svg_path = LANDING_ASSETS / "social-preview.svg"
        png_path = LANDING_ASSETS / "social-preview.png"
        svg_text = svg_path.read_text(encoding="utf-8")
        svg_root = ET.fromstring(svg_text)
        self.assertEqual(svg_root.attrib.get("viewBox"), "0 0 1200 630")
        self.assertEqual(svg_root.attrib.get("data-social-preview"), "scenario-forge")
        self.assertIn("Scenario Forge", " ".join(svg_root.itertext()))
        for brand_color in ("#07111f", "#147f77", "#d99a45"):
            with self.subTest(brand_color=brand_color):
                self.assertIn(brand_color, svg_text)

        png_bytes = png_path.read_bytes()
        self.assertEqual(png_bytes[:8], b"\x89PNG\r\n\x1a\n")
        self.assertGreaterEqual(len(png_bytes), 24)
        self.assertEqual(struct.unpack(">II", png_bytes[16:24]), (1200, 630))

        from tools import rasterize_landing_assets

        self.assertEqual(len(rasterize_landing_assets.RASTER_TARGETS), 16)
        self.assertTrue(all(output.endswith(".webp") for _, output, *_ in rasterize_landing_assets.RASTER_TARGETS))
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
        self.assertEqual(payload["selection_policy"]["road_limit"], 260)
        self.assertEqual(payload["selection_policy"]["rail_limit"], 160)
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
        self.assertGreater(payload["counts"]["road_eligible_paths"], payload["counts"]["road_lines_rendered"])
        self.assertGreater(payload["counts"]["rail_eligible_paths"], payload["counts"]["rail_lines_rendered"])
        self.assertEqual(payload["counts"]["road_lines_rendered"], 260)
        self.assertEqual(payload["counts"]["rail_lines_rendered"], 160)
        self.assertEqual(payload["counts"]["main_corridor_paths_rendered"], 1)
        self.assertEqual(payload["counts"]["main_corridor_titles"], ["首都圏中央連絡自動車道 / C4"])
        self.assertGreater(payload["counts"]["city_source_features"], payload["counts"]["city_points_rendered"])
        self.assertGreater(payload["counts"]["city_eligible_points"], payload["counts"]["city_points_rendered"])
        self.assertEqual(payload["counts"]["city_points_rendered"], 32)
        self.assertEqual(payload["counts"]["focus_city_points_rendered"], 3)
        self.assertEqual(payload["counts"]["focus_city_titles"], ["Tokyo", "Osaka", "Nagoya · Aichi"])
        self.assertEqual(payload["counts"]["night_points_rendered"], 88)
        self.assertEqual(payload["counts"]["bathymetry_source_features"], 6)
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

    def test_landing_europe_1936_showcase_metadata_uses_checked_in_sources(self) -> None:
        metadata_path = LANDING_ASSETS / "europe-1936-showcase.json"
        self.assertTrue(metadata_path.exists(), "Europe 1936 showcase metadata should be checked in")
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        scenario_manifest = json.loads((REPO_ROOT / "data" / "scenarios" / "hoi4_1936" / "manifest.json").read_text(encoding="utf-8"))
        rail_catalog = json.loads((REPO_ROOT / "data" / "transport_layers" / "global_rail" / "catalog.json").read_text(encoding="utf-8"))
        expected_scenario_sources = {
            "data/scenarios/hoi4_1936/manifest.json",
            scenario_manifest["runtime_topology_url"],
            scenario_manifest["countries_url"],
            scenario_manifest["owners_url"],
            scenario_manifest["capital_hints_url"],
        }
        expected_rail_sources = {"data/transport_layers/global_rail/catalog.json"}
        expected_context_sources = {
            "data/europe_urban.geojson",
            "data/europe_rivers.geojson",
            "data/world_cities.geojson",
        }
        for entry in rail_catalog["entries"]:
            if entry.get("region_id") != "europe":
                continue
            manifest_path = entry["manifest_path"]
            manifest = json.loads((REPO_ROOT / manifest_path).read_text(encoding="utf-8"))
            expected_rail_sources.add(manifest["paths"]["full"]["railways"])

        self.assertEqual(payload["scenario_id"], "hoi4_1936")
        self.assertEqual([layer["id"] for layer in payload["layers"]], ["political", "rail", "cities", "day-night"])
        self.assertEqual(payload["projection"]["name"], "lambert_azimuthal_equal_area")
        self.assertEqual(payload["projection"]["center_lon"], 10.0)
        self.assertEqual(payload["projection"]["center_lat"], 52.0)
        self.assertEqual(payload["projection"]["canvas_width"], 980)
        self.assertEqual(payload["projection"]["canvas_height"], 620)
        self.assertEqual(payload["projection"]["canvas_padding"], 36)
        self.assertEqual(payload["bbox"], [-14.0, 29.0, 44.0, 72.5])
        self.assertEqual(payload["detail_bbox"], [-12.5, 34.0, 41.5, 72.5])
        self.assertEqual(set(payload["sources"]), expected_scenario_sources | expected_rail_sources | expected_context_sources)
        self.assertEqual(payload["selection_policy"]["transregional_tags"], ["TUR"])
        self.assertEqual(
            payload["selection_policy"]["context_tags"],
            ["ALG", "EGY", "IRQ", "JOR", "LBA", "LEB", "MOR", "PAL", "SAU", "SYR", "TUN"],
        )
        self.assertIn("low-detail background color", payload["selection_policy"]["context_layer"])
        self.assertEqual(payload["selection_policy"]["capital_limit"], 22)
        self.assertEqual(payload["selection_policy"]["rail_source"], "full")
        self.assertEqual(payload["selection_policy"]["rail_limit"], 220)
        self.assertEqual(payload["selection_policy"]["rail_min_lines_per_shard"], 55)
        self.assertEqual(payload["selection_policy"]["rail_min_projected_px"], 8.0)
        self.assertEqual(payload["selection_policy"]["rail_dedupe_pixel_grid"], 2.0)
        self.assertEqual(payload["selection_policy"]["rail_ranking_key"], "clipped_projected_length_px")
        self.assertEqual(payload["selection_policy"]["rail_dedupe_key"], "projected_path_grid_or_reverse")
        self.assertEqual(payload["selection_policy"]["urban_area_limit"], 96)
        self.assertEqual(payload["selection_policy"]["river_line_limit"], 82)
        self.assertEqual(payload["selection_policy"]["night_light_limit"], 72)
        self.assertEqual(payload["selection_policy"]["night_light_belt_limit"], 54)
        self.assertIn("animated curved night mask", payload["selection_policy"]["day_night_visual_policy"])
        self.assertEqual(payload["selection_policy"]["city_label_source"], "scenario capital hints plus world_cities major populated places")
        self.assertEqual(payload["selection_policy"]["city_label_tier_limits"], [8, 16, 26, 34])
        self.assertEqual(payload["selection_policy"]["city_label_tier_min_distance_px"], [44.0, 36.0, 30.0, 24.0])
        self.assertEqual(payload["selection_policy"]["country_label_source"], "territory representative points")
        self.assertEqual(payload["selection_policy"]["country_label_limit"], 8)
        self.assertEqual(
            payload["selection_policy"]["country_label_tags"],
            ["ENG", "FRA", "GER", "ITA", "POL", "ROM", "SOV", "YUG"],
        )
        self.assertEqual(payload["counts"]["territories"], len(payload["territory_tags"]))
        self.assertEqual(payload["counts"]["context_territories"], len(payload["context_territory_tags"]))
        self.assertEqual(
            payload["context_territory_tags"],
            ["ALG", "EGY", "IRQ", "JOR", "LBA", "LEB", "MOR", "PAL", "SAU", "SYR", "TUN"],
        )
        self.assertEqual(payload["counts"]["capitals"], len(payload["capital_tags"]))
        for expected_tag in ("ALB", "EST", "IRE", "LAT", "LIT", "LUX", "SWI", "TUR"):
            with self.subTest(expected_tag=expected_tag):
                self.assertIn(expected_tag, payload["territory_tags"])
        self.assertEqual(payload["focus_tags"], ["CZE", "ENG", "FRA", "GER", "ITA", "POL", "ROM", "SOV", "YUG"])
        self.assertGreaterEqual(payload["counts"]["political_features"], 6000)
        self.assertGreaterEqual(payload["counts"]["capitals"], 12)
        self.assertEqual(payload["counts"]["rail_lines_selected"], 220)
        self.assertGreater(payload["counts"]["rail_lines_candidates"], payload["counts"]["rail_lines_selected"])
        self.assertEqual(payload["counts"]["urban_areas_rendered"], 96)
        self.assertGreater(payload["counts"]["urban_paths_candidates"], payload["counts"]["urban_areas_rendered"])
        self.assertEqual(payload["counts"]["river_lines_rendered"], 82)
        self.assertGreater(payload["counts"]["river_paths_candidates"], payload["counts"]["river_lines_rendered"])
        self.assertEqual(payload["counts"]["night_light_points_rendered"], 72)
        self.assertGreater(payload["counts"]["city_light_candidates"], payload["counts"]["night_light_points_rendered"])
        self.assertEqual(payload["counts"]["city_labels_rendered"], 34)
        self.assertEqual(payload["counts"]["city_label_tier_counts"], {"0": 8, "1": 8, "2": 10, "3": 8})
        self.assertIn("Milan", payload["city_label_names"])
        self.assertIn("Hamburg", payload["city_label_names"])
        self.assertEqual(payload["counts"]["country_labels_rendered"], 8)
        self.assertEqual(set(payload["rail_selected_by_shard"]), {"eu_e010_e025", "eu_e025_e045", "eu_w012_e010"})
        for shard_id, selected_count in payload["rail_selected_by_shard"].items():
            with self.subTest(shard_id=shard_id):
                self.assertGreaterEqual(selected_count, 55)

    def test_landing_europe_1936_showcase_assets_match_builder_output(self) -> None:
        build_landing_europe_1936_showcase = import_landing_builder("build_landing_europe_1936_showcase")
        previous_svg = build_landing_europe_1936_showcase.SHOWCASE_SVG
        previous_metadata = build_landing_europe_1936_showcase.SHOWCASE_METADATA
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            build_landing_europe_1936_showcase.SHOWCASE_SVG = tmp_root / "europe-1936-showcase.svg"
            build_landing_europe_1936_showcase.SHOWCASE_METADATA = tmp_root / "europe-1936-showcase.json"
            try:
                build_landing_europe_1936_showcase.build_showcase()
                generated_text = build_landing_europe_1936_showcase.SHOWCASE_SVG.read_text(encoding="utf-8")
                ET.fromstring(generated_text)
                self.assertEqual(len(re.findall(r'class="country-label"', generated_text)), 8)
                self.assertIn('data-layer="context-land"', generated_text)
                self.assertIn('class="territory-context territory-context--egy"', generated_text)
                self.assertIn('class="map-edge-fog"', generated_text)
                self.assertIn(".map-edge-fog > *", generated_text)
                self.assertIn('.country-label { fill: rgba(255,255,255,.82);', generated_text)
                self.assertIn('opacity: .62;', generated_text)
                self.assertIn('svg[data-active-layer="political"] .layer-cities { opacity: 0; }', generated_text)
                self.assertIn('svg[data-active-layer="rail"] .rail-line { opacity: .96; stroke: #ffc66d; stroke-width: 1.75; }', generated_text)
                self.assertIn('svg[data-active-layer="rail"] .layer-country-labels { opacity: 0; }', generated_text)
                self.assertIn('svg[data-active-layer="rail"] .layer-cities { opacity: 0; }', generated_text)
                self.assertIn("nightShadowGradient", generated_text)
                self.assertIn("nightTexture", generated_text)
                self.assertIn("nightActivityClip", generated_text)
                self.assertIn('class="night-shadow-core"', generated_text)
                self.assertIn('class="night-light-belt night-light-belt--core"', generated_text)
                self.assertIn('class="night-light-smear', generated_text)
                self.assertIn('data-showcase-city-detail="base"', generated_text)
                self.assertIn('class="showcase-city showcase-city--tier-0 showcase-city--capital', generated_text)
                self.assertIn('class="showcase-city showcase-city--tier-3', generated_text)
                self.assertIn('svg[data-active-layer="cities"][data-showcase-city-detail="dense"] .showcase-city--tier-3 { opacity: 1; }', generated_text)
                self.assertEqual(
                    build_landing_europe_1936_showcase.SHOWCASE_METADATA.read_bytes(),
                    (LANDING_ASSETS / "europe-1936-showcase.json").read_bytes(),
                )
            finally:
                build_landing_europe_1936_showcase.SHOWCASE_SVG = previous_svg
                build_landing_europe_1936_showcase.SHOWCASE_METADATA = previous_metadata

    def test_landing_hero_scenario_metadata_uses_real_sources(self) -> None:
        for mode, scenario_id, svg_name, metadata_name in HERO_SCENARIO_ASSETS:
            with self.subTest(mode=mode):
                svg_text = (LANDING_ASSETS / svg_name).read_text(encoding="utf-8")
                ET.fromstring(svg_text)
                payload = json.loads((LANDING_ASSETS / metadata_name).read_text(encoding="utf-8"))
                self.assertEqual(payload["asset_type"], "landing_hero_scenario_map")
                self.assertEqual(payload["mode"], mode)
                self.assertEqual(payload["scenario_id"], scenario_id)
                self.assertEqual(payload["viewport"]["bbox"], [-12.5, 34.0, 41.5, 72.5])
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
                    self.assertEqual(payload["feature_counts"]["coastline_paths"], 1000)
                    self.assertGreater(
                        payload["feature_counts"]["coastline_paths_available"],
                        payload["feature_counts"]["coastline_paths"],
                    )
                    self.assertGreater(payload["feature_counts"]["coastline_paths_dropped"], 0)
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
                    self.assertIn(f"data/scenarios/{scenario_id}/runtime_topology.topo.json", payload["source_files"])
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
                    self.assertNotIn("data/scenarios/tno_1962/scenario_atlantropa.topo.json", payload["source_files"])
                    self.assertNotIn("data/scenarios/tno_1962/scenario_atlantropa_metadata.json", payload["source_files"])
                    self.assertIn("data/europe_topology.runtime_political_v1.json", payload["source_files"])
                    self.assertIn("data/europe_land_bg.geojson", payload["source_files"])
                    self.assertEqual(
                        payload["selection_policy"]["hero_geometry_source"],
                        "runtime_topology political ownership crop",
                    )
                    self.assertEqual(
                        payload["selection_policy"]["atlantropa_overlay"],
                        "omitted_from_political_ownership_crop",
                    )
                    self.assertEqual(
                        payload["selection_policy"]["base_underlay"],
                        "original Europe land and coastline for small Mediterranean islands",
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
                    self.assertIn("WRS", payload["capital_tags"])
                    for city_name in ("Madrid", "Kyiv", "Severodvinsk", "Nanzig"):
                        self.assertIn(f">{city_name}</text>", svg_text)
                    for replaced_name in ("Moskau", "Warshau", "Zagreb", "Bucharest", "Sofia", "Brussels"):
                        self.assertNotIn(f">{replaced_name}</text>", svg_text)
                    self.assertEqual(payload["selection_policy"]["base_underlay_path_limit"], 360)
                    self.assertEqual(payload["selection_policy"]["base_underlay_coastline_limit"], 360)
                    self.assertGreater(payload["feature_counts"]["base_land_paths"], 0)
                    self.assertLessEqual(payload["feature_counts"]["base_land_paths"], 420)
                    self.assertGreater(payload["feature_counts"]["base_mediterranean_island_paths"], 0)
                    self.assertGreater(payload["feature_counts"]["base_coastline_paths"], 0)
                    self.assertLessEqual(payload["feature_counts"]["base_coastline_paths"], 360)
                    self.assertIn('class="base-land"', svg_text)
                    self.assertIn('class="base-coastline"', svg_text)
                    self.assertNotIn("atlantropa_paths", payload["feature_counts"])
                    self.assertNotIn("atlantropa", svg_text)

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
                        self.assertIn('class="main-corridor"', generated_text)
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
        source = (REPO_ROOT / "tools" / "build_pages_dist.py").read_text(encoding="utf-8")
        self.assertIn('def write_text_lf(path: Path, text: str) -> None:', source)
        self.assertIn('def normalize_dist_text_files_lf() -> None:', source)
        self.assertIn("LF_NORMALIZED_ROOT_DIST_PATHS", source)
        self.assertIn("LF_NORMALIZED_ROOT_ASSET_SUFFIXES", source)
        self.assertIn('".css"', source)
        self.assertIn('".geojson"', source)
        self.assertIn('".svg"', source)
        self.assertIn('".md"', source)
        self.assertIn('".txt"', source)
        self.assertIn('newline="\\n"', source)
        self.assertIn("Landing assets are committed delivery inputs here.", source)
        self.assertNotIn("build_landing_hero_cartography()", source)
        self.assertNotIn("build_landing_europe_1936_showcase()", source)
        self.assertNotIn("build_landing_japan_preview()", source)
        self.assertNotIn("rasterize_landing_assets()", source)
        self.assertNotIn(".write_text(", source)
        self.assertNotIn("n" + "px", Path(__file__).read_text(encoding="utf-8"))
        self.assertLess(
            source.index("normalize_dist_text_files_lf()"),
            source.index("total_bytes = write_dist_manifest()"),
        )
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

    def test_landing_hero_cartography_builder_keeps_checked_in_assets_current(self) -> None:
        build_landing_hero_cartography = import_landing_builder("build_landing_hero_cartography")
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            previous_assets_dir = build_landing_hero_cartography.LANDING_ASSETS
            try:
                build_landing_hero_cartography.LANDING_ASSETS = tmp_root
                build_landing_hero_cartography.main()
                for asset_name in (
                    "hero-cartography.svg",
                    "showcase-final-map.svg",
                    "template-blank.svg",
                    "template-modern.svg",
                    "template-hoi4.svg",
                    "template-tno.svg",
                ):
                    with self.subTest(asset_name=asset_name):
                        generated_path = tmp_root / asset_name
                        self.assertEqual(generated_path.read_bytes(), (LANDING_ASSETS / asset_name).read_bytes())
            finally:
                build_landing_hero_cartography.LANDING_ASSETS = previous_assets_dir

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
        self.assertEqual(reachability["registry_resolved_dynamic_expression_count"], 2)
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
        self.assertEqual(graph["summary"]["registry_resolved_dynamic_expression_count"], 2)
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
        self.assertEqual(
            [record["registry_id"] for record in deferred_ui_expressions if record["kind"] == "unresolved_dynamic_expression"],
            ["deferred-ui-bootstrap"],
        )
        self.assertEqual(
            [record["resolution"] for record in deferred_ui_expressions if record["kind"] == "unresolved_dynamic_expression"],
            ["declarative-registry"],
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
            ["app/js/core/feature_identity_shared.js", "app/vendor/topojson-client.min.js"],
        )

    def test_pages_module_graph_uses_acorn_for_imports_exports_templates_comments_and_regex(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
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
            for path in ("index.html", "app/index.html", "app/js/main.js")
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
                if prefix.startswith("app/js/")
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

    def test_appearance_transport_contract_modules_have_exact_product_ownership(self) -> None:
        reachable_graph = {
            "schema_version": build_pages_dist.PAGES_REACHABILITY_SCHEMA_VERSION,
            "module_entrypoint": build_pages_dist.PAGES_MODULE_ENTRYPOINT,
            "entrypoints": [],
            "summary": {},
            "initial_resource_paths": [],
            "deferred_resource_paths": [],
            "nodes": [
                {
                    "path": "app/js/core/appearance_transport_change_set.js",
                    "load_phase": "initial",
                },
                {
                    "path": "app/js/core/appearance_transport_change_set_contract.js",
                    "load_phase": "deferred-runtime",
                },
                {
                    "path": "app/js/core/appearance_transport_operation.js",
                    "load_phase": "deferred-runtime",
                },
            ],
            "unresolved_references": [],
        }
        expected_paths = {
            "app/js/core/appearance_transport_change_set.js",
            "app/js/core/appearance_transport_change_set_contract.js",
            "app/js/core/appearance_transport_operation.js",
        }
        rule = next(
            rule
            for rule in build_pages_dist.PAGES_PRODUCT_INVENTORY_RULES
            if rule["id"] == "appearance-transport-contract-modules"
        )
        self.assertEqual(set(rule["paths"]), expected_paths)
        self.assertEqual(rule["category"], "on-demand-product")
        self.assertEqual(rule["owner"], "appearance-transport-contract")
        self.assertTrue(rule["override_reachability"])

        for path in sorted(expected_paths):
            with self.subTest(path=path):
                self.assertEqual(
                    build_pages_dist._classify_pages_dist_path(path, reachable_graph),
                    (
                        "on-demand-product",
                        "appearance-transport-contract",
                        "product-registry:appearance-transport-contract-modules",
                    ),
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

    def test_pages_dist_manifest_payload_rejects_missing_static_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            dist_root = Path(tmpdir)
            source_paths = {
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

    def test_landing_source_keeps_landing_contract(self) -> None:
        html = LANDING_INDEX.read_text(encoding="utf-8")
        app_js = LANDING_APP_JS.read_text(encoding="utf-8")
        styles_css = LANDING_STYLES_CSS.read_text(encoding="utf-8")

        self.assertEqual(
            re.findall(r'<section id="([^"]+)"', html),
            ["hero", "sample-runs", "story", "features", "data", "faq"],
        )

        for expected_fragment in (
            './styles.css',
            './app.js',
            './app/?view=guide',
            'data-i18n="heroTitle"',
            'data-i18n="heroTitleAccent"',
            'data-i18n="productStageLabel"',
            'class="brandmark__logo"',
            './assets/favicon.svg',
            '<a href="#sample-runs" data-i18n="navWorks">Outputs</a>',
            './assets/hero-hoi4-1936.webp',
            'data-hero-map',
            'data-hero-chip="blank"',
            'data-hero-chip="hoi4-1936"',
            'data-hero-chip="hoi4-1939"',
            'data-hero-chip="tno-1962"',
            'data-stat-value="21338"',
            '<meta name="robots" content="index,follow" />',
            '<link rel="canonical" href="https://raederhans.github.io/scenario-forge/" />',
            '<meta property="og:image" content="https://raederhans.github.io/scenario-forge/assets/social-preview.png" />',
            '<meta name="twitter:card" content="summary_large_image" />',
            'data-i18n="showcaseEyebrow"',
            './assets/europe-1936-showcase.svg',
            'data-showcase-root',
            'data-showcase-object',
            'data-showcase-object tabindex="0"',
            'id="showcase-map-object"',
            'role="tabpanel"',
            'id="showcase-layer-panel"',
            'aria-controls="showcase-layer-panel"',
            'data-showcase-layer-tab="political"',
            'data-showcase-layer-tab="rail"',
            'data-showcase-layer-tab="cities"',
            'data-showcase-layer-tab="day-night"',
            'data-i18n="showcaseLayerPoliticalTitle"',
            'data-i18n="previewEyebrow"',
            'data-preview-root',
            'data-preview-surface',
            'data-preview-viewport',
            'data-preview-image="transport"',
            'class="mini-map__controls"',
            'data-preview-zoom="1"',
            'data-preview-zoom="-1"',
            'data-preview-zoom="reset"',
            'data-i18n-aria-label="previewZoomIn"',
            'data-i18n-aria-label="previewZoomOut"',
            'data-i18n-aria-label="previewZoomReset"',
            'role="tablist"',
            'data-preview-status role="status" aria-live="polite" hidden',
            'data-i18n="dataEyebrow"',
            'data-i18n="editionsEyebrow"',
            'data-i18n="faqEyebrow"',
            'class="footer__brand"',
            'class="footer__sources"',
            'class="footer__actions"',
            'data-i18n-aria-label="productPreviewLabel"',
            'data-i18n-aria-label="brandHomeLabel"',
            'data-i18n-aria-label="primaryNavLabel"',
            'data-i18n-aria-label="languageSwitcherLabel"',
            'data-i18n-alt="productPreviewAlt"',
            'data-i18n-alt="workOneAlt"',
            'data-i18n-alt="workTwoAlt"',
            'data-i18n-alt="workThreeAlt"',
            'id="sample-runs"',
            'data-sample-runs-root',
            'data-sample-runs-manifest="./assets/sample-runs.json"',
            'data-sample-run-filter="scenario"',
            'data-sample-run-filter="transport"',
            'data-sample-run-filter="atlas"',
            'data-sample-run-filter="evidence"',
            'data-sample-run-card',
            'data-sample-run-id="tno-atlantropa-mediterranean"',
            'data-sample-run-id="hoi4-europe-comparison"',
            'data-sample-run-id="japan-tokaido-corridor"',
            'data-sample-scenario="tno_1962"',
            'data-sample-scenario="hoi4_1936"',
            'data-sample-scenario="modern_world"',
            'data-sample-project="./assets/sample-projects/tno-1962-atlantropa-briefing.project.json"',
            'data-sample-project="./assets/sample-projects/hoi4-1936-europe-briefing.project.json"',
            'data-sample-project="./assets/sample-projects/modern-world-japan-corridor.project.json"',
            'data-sample-metadata="./assets/work-alt-history-med.json"',
            'data-sample-evidence-source="landing/assets/work-alt-history-med.json:counts.rendered_atlantropa_features"',
            'data-sample-evidence-source="landing/assets/work-scenario-switch-europe.json:counts.hoi4_1936_political_features"',
            'data-sample-evidence-source="landing/assets/work-atlas-japan-corridor.json:counts.road_lines+counts.rail_lines"',
            'data-i18n="sampleFilterScenario"',
            'data-i18n="sampleRecipeLabel"',
            'data-i18n="sampleEvidenceLabel"',
            'data-sample-project-downloads',
            'data-sample-project-list-link',
            'data-sample-project-id="blank-base-starter"',
            'data-sample-project-id="modern-world-japan-corridor"',
            'data-sample-project-id="hoi4-1936-europe-briefing"',
            'data-sample-project-id="hoi4-1939-europe-switch"',
            'data-sample-project-id="tno-1962-atlantropa-briefing"',
            './app/?sample=tno-1962-atlantropa-briefing&view=guide',
            './app/?sample=hoi4-1936-europe-briefing&view=guide',
            './app/?sample=modern-world-japan-corridor&view=guide',
            './assets/sample-projects/blank-base-starter.project.json',
            './assets/sample-projects/hoi4-1939-europe-switch.project.json',
            'data-i18n-aria-label="sampleProjectActionsLabel"',
            'data-sample-project-open-link',
            'data-i18n="sampleProjectDownloadsTitle"',
            'data-i18n="sampleProjectDownloadsBody"',
            'data-i18n="sampleProjectBlank"',
            'data-i18n="sampleProjectModern"',
            'data-i18n="sampleProjectHoi41936"',
            'data-i18n="sampleProjectHoi41939"',
            'data-i18n="sampleProjectTno"',
            'data-sample-project-link',
            'data-sample-manifest-link',
            'data-i18n="sampleProjectOpen"',
            'data-i18n="sampleProjectDownload"',
            'data-i18n="sampleRecipeManifest"',
            './assets/work-alt-history-med.webp',
            './assets/work-scenario-switch-europe.webp',
            './assets/work-atlas-japan-corridor.webp',
            './assets/sample-runs.json',
            './assets/sample-projects/tno-1962-atlantropa-briefing.project.json',
            './assets/sample-projects/hoi4-1936-europe-briefing.project.json',
            './assets/sample-projects/modern-world-japan-corridor.project.json',
            'id="story"',
            'data-story-root',
            'data-story-stage-image',
            'data-story-step-button="baseline"',
            'data-story-step-button="scenario"',
            'data-story-step-button="transport"',
            'data-story-step-button="evidence"',
            'data-story-step-button="export"',
            'data-story-compare="hoi4-1939"',
            'data-story-evidence-source="data/scenarios/index.json:public_baseline_ids.length"',
            'data-showcase-status role="status" aria-live="polite" hidden',
            'data-i18n="storyEyebrow"',
            'data-i18n-aria-label="storyStageLabel"',
            'data-i18n="chipBlank"',
            'data-i18n="chipHoi41936"',
            'data-i18n="chipHoi41939"',
            'data-i18n="chipTno1962"',
            'data-reveal',
            'footer',
            'data-lang="zh"',
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, html)

        self.assertNotIn('class="hero__metrics"', html)
        self.assertNotIn('data-i18n-aria-label="heroMetricsLabel"', html)

        for expected_fragment in (
            "scenario_forge_landing_lang",
            "heroTitleAccent",
            "formatMetricNumbers",
            "statsLabel",
            "worksEyebrow",
            "featuresEyebrow",
            "dataEyebrow",
            "faqEyebrow",
            "showcaseEyebrow",
            "showcaseLayerPoliticalTitle",
            "showcaseLayerRailTitle",
            "showcaseLayerCitiesTitle",
            "showcaseLayerDayNightTitle",
            "initShowcaseLayers",
            "SHOWCASE_METADATA_URL",
            "getShowcaseLayerIds",
            "resolveShowcaseLayer",
            "loadShowcaseMetadata",
            "showcaseLayerError",
            "setShowcaseSvgLayer",
            "SHOWCASE_VIEW_SCALES",
            "data-showcase-viewport",
            "showcaseViewZoomed",
            "clampShowcaseViewPosition",
            "applyShowcaseViewState",
            "isModifiedZoomWheelEvent",
            "onKeyDown",
            "initShowcaseView",
            "PREVIEW_VIEW_SCALES",
            "clampPreviewViewPosition",
            "applyPreviewViewState",
            "initPreviewView",
            "previewZoomed",
            "previewDragging",
            "pointerdown",
            "wheel",
            "dblclick",
            "initPreviewTabs",
            "initHeroMap",
            "DEFAULT_HERO_MODE",
            "HERO_SCENARIO_ASSETS",
            "initSampleRunsGallery",
            "SAMPLE_RUN_FILTERS",
            "resolveSampleRunFilter",
            "syncSampleRunsFromDom",
            "sampleFilterScenario",
            "sampleEvidenceLabel",
            "sampleProjectActionsLabel",
            "sampleProjectDownload",
            "sampleRecipeManifest",
            "sampleProjectDownloadsTitle",
            "sampleProjectDownloadsBody",
            "sampleProjectBlank",
            "sampleProjectModern",
            "sampleProjectHoi41936",
            "sampleProjectHoi41939",
            "sampleProjectTno",
            "initProductStory",
            "PRODUCT_STORY_STEPS",
            "PRODUCT_STORY_COMPARISON_ASSETS",
            "storyStageTitleBaseline",
            "storyStageTitleExport",
            "syncProductStoryFromDom",
            "hero-hoi4-1936.json",
            "hero-hoi4-1939.webp",
            "hero-tno-1962.webp",
            "syncHeroMap",
            "initMetricCountUp",
            "previewPanelTransportTitle",
            "previewImageFallback",
            "showcaseMetadataFallback",
            "dataCardOneTitle",
            "editionOneTitle",
            "faqOneQuestion",
            "productPreviewLabel",
            "productStageLabel",
            "heroChipsLabel",
            "brandHomeLabel",
            "languageSwitcherLabel",
            "productPreviewAlt",
            "heroAltHoi41936",
            "heroAltHoi41939",
            "heroAltTno1962",
            "data-i18n-alt",
            "data-i18n-aria-label",
            "metaTitle",
            "metaDescription",
            "metaOgDescription",
            "zh:",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, app_js)

        self.assertIn("prefers-reduced-motion", styles_css)
        self.assertIn('html[data-reveal="enabled"]', styles_css)
        self.assertIn(".is-revealed", styles_css)
        self.assertIn("min-height: 126px", styles_css)
        self.assertIn("height: 48px", styles_css)
        self.assertIn("height: 46px", styles_css)
        self.assertIn("height: 44px", styles_css)
        self.assertIn("min-height: 44px", styles_css)
        self.assertIn("line-height: 1.1", styles_css)
        self.assertIn("overflow-wrap: anywhere", styles_css)
        self.assertIn(".hero-cartography", styles_css)
        self.assertIn("translateY(-8px) perspective(1200px)", styles_css)
        hero_chips_style = re.search(r"\.hero__chips\s*\{(?P<body>[^}]*)\}", styles_css, re.S)
        self.assertIsNotNone(hero_chips_style)
        self.assertNotIn("position: absolute", hero_chips_style.group("body"))
        self.assertIn(".brandmark__logo", styles_css)
        self.assertNotIn(".brandmark__dot", styles_css)
        self.assertIn('[data-hero-transition="loading"]', styles_css)
        self.assertIn('[data-hero-mode="blank"]', styles_css)
        self.assertIn('[data-hero-mode="hoi4-1936"]', styles_css)
        self.assertIn('[data-hero-mode="hoi4-1939"]', styles_css)
        self.assertIn('[data-hero-mode="tno-1962"]', styles_css)
        self.assertIn(".showcase-layer-tabs", styles_css)
        self.assertIn('[data-showcase-view-zoomed="true"]', styles_css)
        self.assertIn(".product-story__grid", styles_css)
        self.assertIn(".sample-runs__filters", styles_css)
        self.assertIn(".sample-run-filter[aria-pressed=\"true\"]", styles_css)
        self.assertIn(".sample-run-card__recipe", styles_css)
        self.assertIn(".sample-run-card__proof", styles_css)
        self.assertIn(".sample-run-card__actions", styles_css)
        self.assertIn(".sample-project-downloads", styles_css)
        self.assertIn(".sample-project-downloads__grid", styles_css)
        self.assertIn(".story-stage", styles_css)
        self.assertIn("position: sticky", styles_css)
        self.assertIn(".story-evidence", styles_css)
        self.assertIn('.story-step[aria-pressed="true"]', styles_css)
        for selector in (".story-stage__hud strong", ".story-step__copy strong"):
            with self.subTest(story_font_selector=selector):
                assert_css_block_avoids_viewport_font_scaling(self, styles_css, selector)
        self.assertIn("[data-showcase-object]", app_js)
        self.assertNotIn("SHOWCASE_LAYER_COPY_KEYS[layer] || SHOWCASE_LAYER_COPY_KEYS.political", app_js)
        self.assertIn("height: 44px", styles_css)
        self.assertIn(".showcase-map__viewport", styles_css)
        self.assertIn(".showcase-map__viewport::after", styles_css)
        self.assertIn("radial-gradient(ellipse at center", styles_css)
        self.assertIn("inset 0 0 112px", styles_css)
        self.assertIn(".showcase-map__object", styles_css)
        self.assertIn(".showcase-map__object:focus-visible", styles_css)
        self.assertIn("[data-preview-image=\"transport\"]", styles_css)
        self.assertIn("--preview-scale", styles_css)
        self.assertIn(".mini-map__viewport", styles_css)
        self.assertIn(".mini-map__controls", styles_css)
        self.assertIn('[data-preview-zoomed="true"]', styles_css)
        self.assertIn('[data-preview-dragging="true"]', styles_css)
        self.assertIn(".showcase-section", styles_css)
        self.assertNotIn("data-showcase-view-controls", html)
        self.assertNotIn("data-showcase-view-action", html)
        self.assertNotIn("SHOWCASE_VIEW_PAN_STEP", app_js)
        self.assertNotIn(".showcase-map__controls", styles_css)
        self.assertNotIn('data-showcase-layer-tab="scenario"', html)
        self.assertRegex(
            styles_css,
            re.compile(r"\.work-card__media img\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;", re.S),
        )
        self.assertRegex(
            styles_css,
            re.compile(r"\.work-card__media\s*\{[^}]*aspect-ratio:\s*16\s*/\s*9;", re.S),
        )

    def test_hgo_runtime_preview_renders_through_dedicated_pass(self) -> None:
        source = MAP_RENDERER_JS.read_text(encoding="utf-8")
        draw_canvas_owner_source = DRAW_CANVAS_ORCHESTRATION_OWNER_JS.read_text(encoding="utf-8")
        hgo_preview_owner_source = HGO_RUNTIME_PREVIEW_RENDER_OWNER_JS.read_text(encoding="utf-8")
        hgo_preview_commit_source = HGO_RUNTIME_PREVIEW_FRAME_COMMIT_JS.read_text(encoding="utf-8")
        start = source.index("function drawCanvas(")
        end = source.index("function readRenderPerfMetricDuration", start)
        body = source[start:end]
        pass_start = hgo_preview_owner_source.index("function drawPreviewPass(")
        pass_end = hgo_preview_owner_source.index("function normalizeHitPayload(", pass_start)
        pass_body = hgo_preview_owner_source[pass_start:pass_end]

        # Pages 构建会复制源码 drawCanvas；这里把 HGO preview pass 合同纳入 Pages shell 验证。
        self.assertNotIn("preferLastGoodFrameForHgoPreview", body)
        self.assertNotIn('renderHgoRuntimePreviewIfReady("draw-canvas")', body)
        self.assertIn("return frameCommitter.drawPreviewPass();", pass_body)
        self.assertIn('renderFrame: (targetCanvas) => renderIfReady("hgo-preview-pass", {', hgo_preview_owner_source)
        self.assertIn("const rendered = renderFrame(targetCanvas);", hgo_preview_commit_source)
        self.assertIn("low-resolved-pixel-ratio", hgo_preview_commit_source)
        self.assertIn("resetCanvasContext(targetContext, targetCanvas.width, targetCanvas.height);", hgo_preview_commit_source)
        self.assertIn("targetContext.putImageData(imageData, 0, 0);", hgo_preview_commit_source)
        self.assertNotIn("projectionTransform: null,", pass_body)
        self.assertIn('const HGO_RUNTIME_PREVIEW_RENDER_PASS_NAMES = Object.freeze([\n  "hgoPreview",\n]);', hgo_preview_owner_source)
        self.assertIn("return getHgoRuntimePreviewRenderOwner().getActiveRenderPassNames();", source)
        self.assertIn(
            "return isReady() ? HGO_RUNTIME_PREVIEW_RENDER_PASS_NAMES : vectorRenderPassNames;",
            hgo_preview_owner_source,
        )
        self.assertIn("const activeRenderPassNames = getActiveRenderPassNames();", draw_canvas_owner_source)
        self.assertIn(
            "ensureIdleRenderPasses(frameTimings, activeRenderPassNames);",
            draw_canvas_owner_source,
        )
        self.assertIn(
            "getRenderPipelinePassesOwner().ensureIdleRenderPasses(frameTimings, activeRenderPassNames);",
            source,
        )
        self.assertIn("drewExactFrame = !!composeCachedPasses(activeRenderPassNames);", draw_canvas_owner_source)

    def test_cached_pass_compositor_owner_is_in_the_pages_module_graph(self) -> None:
        renderer_source = MAP_RENDERER_JS.read_text(encoding="utf-8").replace("\r\n", "\n")
        owner_source = CACHED_PASS_COMPOSITOR_OWNER_JS.read_text(encoding="utf-8").replace("\r\n", "\n")
        dist_renderer = (DIST_APP_JS_ROOT / "core" / "map_renderer.js").read_text(encoding="utf-8").replace("\r\n", "\n")
        dist_owner_path = DIST_APP_JS_ROOT / "core" / "renderer" / "cached_pass_compositor_owner.js"
        self.assertTrue(dist_owner_path.exists())
        self.assertEqual(dist_owner_path.read_text(encoding="utf-8").replace("\r\n", "\n"), owner_source)
        import_token = 'import { createCachedPassCompositorOwner } from "./renderer/cached_pass_compositor_owner.js";'
        self.assertIn(import_token, renderer_source)
        self.assertIn(import_token, dist_renderer)
        self.assertIn("return getCachedPassCompositorOwner().drawTransformedPass(", renderer_source)
        self.assertIn("return getCachedPassCompositorOwner().composeRenderPassesToTarget(", renderer_source)

    def test_landing_i18n_table_keeps_english_and_chinese_values_separate(self) -> None:
        app_js = LANDING_APP_JS.read_text(encoding="utf-8")
        en_start = app_js.index("  en: {")
        zh_start = app_js.index("  zh: {")
        en_table = app_js[en_start:zh_start]
        zh_table = app_js[zh_start:]

        for expected_fragment in (
            "navWorks:",
            "worksTitle:",
            "sampleProjectDownloadsTitle:",
            "featureGroupOneTitle:",
            "featureGroupTwoTitle:",
            "featureGroupThreeTitle:",
            "featureGroupFourTitle:",
            "featurePointPalettes:",
            'previewPanelTransportTitle:',
            "dataTitle:",
            "faqOneQuestion:",
            "faqSixQuestion:",
            "editionsTitle:",
            "showcaseTitle:",
            "showcaseLayerPoliticalTitle:",
            "showcaseLayerRailTitle:",
            "showcaseLayerCitiesTitle:",
            "showcaseLayerDayNightTitle:",
            "previewSurfaceLabel:",
            "previewZoomControlsLabel:",
            "previewZoomIn:",
            "previewZoomOut:",
            "previewZoomReset:",
            "previewImageFallback:",
            "showcaseMetadataFallback:",
            "storyTitle:",
            "storyStepBaselineTitle:",
            "storyStepExportProof:",
            "storyStageTitleExport:",
            "chipHoi41936:",
            "chipHoi41939:",
            "chipTno1962:",
            "heroAltBlank:",
            "heroAltHoi41936:",
            "heroAltHoi41939:",
            "heroAltTno1962:",
            "ctaTitle:",
            "metaTitle:",
            "metaDescription:",
            "metaOgDescription:",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, en_table)

        for expected_fragment in (
            "navWorks:",
            "worksTitle:",
            "sampleProjectDownloadsTitle:",
            "featureGroupOneTitle:",
            "featureGroupTwoTitle:",
            "featureGroupThreeTitle:",
            "featureGroupFourTitle:",
            "featurePointPalettes:",
            "previewPanelTransportTitle:",
            "dataTitle:",
            "faqOneQuestion:",
            "faqSixQuestion:",
            "editionsTitle:",
            "ctaBody:",
            "showcaseTitle:",
            "showcaseLayerPoliticalTitle:",
            "showcaseLayerRailTitle:",
            "showcaseLayerCitiesTitle:",
            "showcaseLayerDayNightTitle:",
            "previewImageFallback:",
            "showcaseMetadataFallback:",
            "storyTitle:",
            "storyStepBaselineTitle:",
            "storyStepExportProof:",
            "storyStageTitleExport:",
            "chipHoi41936:",
            "chipHoi41939:",
            "chipTno1962:",
            "heroAltBlank:",
            "heroAltHoi41936:",
            "heroAltHoi41939:",
            "heroAltTno1962:",
            'metaTitle: "Scenario Forge — 场景优先政治地图工作台"',
            "metaDescription:",
            "metaOgDescription:",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, zh_table)

        for stale_fragment in (
            'featureGroupOneTitle: "Scenario baselines"',
            'featureGroupTwoTitle: "Political editing"',
            'featureGroupThreeTitle: "Presentation layers"',
            'featureGroupFourTitle: "Project and export"',
            'featuresTitle: "Organized around tasks, not just panels."',
        ):
            with self.subTest(stale_fragment=stale_fragment):
                self.assertNotIn(stale_fragment, zh_table)

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

    def test_dist_root_index_keeps_landing_startup_contract(self) -> None:
        if not DIST_ROOT_INDEX.exists():
            self.skipTest("dist/index.html is only available after build_pages_dist runs")
        html = DIST_ROOT_INDEX.read_text(encoding="utf-8")

        self.assertEqual(
            re.findall(r'<section id="([^"]+)"', html),
            ["hero", "sample-runs", "story", "features", "data", "faq"],
        )

        for expected_fragment in (
            "./styles.css",
            "./app.js",
            "./app/?view=guide",
            'data-i18n="heroTitle"',
            'data-i18n="heroTitleAccent"',
            'data-i18n="productStageLabel"',
            'class="brandmark__logo"',
            './assets/favicon.svg',
            './assets/hero-hoi4-1936.webp',
            'data-hero-map',
            'data-hero-chip="blank"',
            'data-hero-chip="hoi4-1936"',
            'data-hero-chip="hoi4-1939"',
            'data-hero-chip="tno-1962"',
            'data-stat-value="21338"',
            '<meta name="robots" content="index,follow" />',
            '<link rel="canonical" href="https://raederhans.github.io/scenario-forge/" />',
            '<meta property="og:image" content="https://raederhans.github.io/scenario-forge/assets/social-preview.png" />',
            '<meta name="twitter:card" content="summary_large_image" />',
            'data-i18n="showcaseEyebrow"',
            './assets/europe-1936-showcase.svg',
            'data-showcase-root',
            'data-showcase-object',
            'data-showcase-layer-tab="political"',
            'data-showcase-layer-tab="rail"',
            'data-showcase-layer-tab="cities"',
            'data-showcase-layer-tab="day-night"',
            'data-i18n="previewEyebrow"',
            'data-preview-root',
            'data-preview-surface',
            'data-preview-viewport',
            'data-preview-image="transport"',
            'class="mini-map__controls"',
            'data-preview-zoom="1"',
            'data-preview-zoom="-1"',
            'data-preview-zoom="reset"',
            'data-i18n-aria-label="previewZoomIn"',
            'data-i18n-aria-label="previewZoomOut"',
            'data-i18n-aria-label="previewZoomReset"',
            'role="tablist"',
            'data-preview-status role="status" aria-live="polite" hidden',
            'data-i18n="dataEyebrow"',
            'data-i18n="editionsEyebrow"',
            'data-i18n="faqEyebrow"',
            'data-showcase-status role="status" aria-live="polite" hidden',
            'data-i18n-aria-label="productPreviewLabel"',
            'data-i18n-aria-label="brandHomeLabel"',
            'data-i18n-aria-label="primaryNavLabel"',
            'data-i18n-aria-label="languageSwitcherLabel"',
            'data-i18n-alt="productPreviewAlt"',
            'data-i18n-alt="workOneAlt"',
            'data-i18n="workOneTitle"',
            '<a href="#sample-runs" data-i18n="navWorks">Outputs</a>',
            'id="sample-runs"',
            'data-sample-runs-root',
            'data-sample-runs-manifest="./assets/sample-runs.json"',
            'data-sample-run-filter="scenario"',
            'data-sample-run-card',
            'data-sample-run-id="japan-tokaido-corridor"',
            'data-sample-scenario="modern_world"',
            'data-sample-project="./assets/sample-projects/modern-world-japan-corridor.project.json"',
            'data-sample-evidence-source="landing/assets/work-atlas-japan-corridor.json:counts.road_lines+counts.rail_lines"',
            'data-i18n="sampleFilterEvidence"',
            'data-i18n="sampleEvidenceLabel"',
            'data-sample-project-downloads',
            'data-sample-project-list-link',
            'data-sample-project-id="blank-base-starter"',
            'data-sample-project-id="hoi4-1939-europe-switch"',
            './app/?sample=tno-1962-atlantropa-briefing&view=guide',
            './app/?sample=hoi4-1936-europe-briefing&view=guide',
            './app/?sample=modern-world-japan-corridor&view=guide',
            'data-i18n-aria-label="sampleProjectActionsLabel"',
            'data-sample-project-open-link',
            'data-i18n="sampleProjectDownloadsTitle"',
            'data-i18n="sampleProjectDownloadsBody"',
            'data-i18n="sampleProjectBlank"',
            'data-i18n="sampleProjectModern"',
            'data-i18n="sampleProjectHoi41936"',
            'data-i18n="sampleProjectHoi41939"',
            'data-i18n="sampleProjectTno"',
            'data-sample-project-link',
            'data-sample-manifest-link',
            'data-i18n="sampleProjectOpen"',
            'data-i18n="sampleProjectDownload"',
            'data-i18n="sampleRecipeManifest"',
            'data-i18n="ctaPrimary"',
            "data-reveal",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, html)

        self.assertNotIn('class="hero__metrics"', html)
        self.assertNotIn('data-i18n-aria-label="heroMetricsLabel"', html)
        self.assertNotIn('data-showcase-layer-tab="scenario"', html)

    def test_dist_app_js_keeps_landing_i18n_contract(self) -> None:
        if not DIST_APP_JS.exists():
            self.skipTest("dist/app.js is only available after build_pages_dist runs")
        app_js = DIST_APP_JS.read_text(encoding="utf-8")

        for expected_fragment in (
            "scenario_forge_landing_lang",
            "heroTitle",
            "heroTitleAccent",
            "formatMetricNumbers",
            "statsLabel",
            "worksEyebrow",
            "featuresEyebrow",
            "dataEyebrow",
            "faqEyebrow",
            "showcaseEyebrow",
            "showcaseLayerPoliticalTitle",
            "showcaseLayerRailTitle",
            "showcaseLayerCitiesTitle",
            "showcaseLayerDayNightTitle",
            "initShowcaseLayers",
            "initShowcaseView",
            "SHOWCASE_VIEW_SCALES",
            "showcaseViewZoomed",
            "clampShowcaseViewPosition",
            "dblclick",
            "PREVIEW_VIEW_SCALES",
            "clampPreviewViewPosition",
            "applyPreviewViewState",
            "initPreviewView",
            "previewZoomed",
            "previewDragging",
            "initPreviewTabs",
            "initHeroMap",
            "initSampleRunsGallery",
            "SAMPLE_RUN_FILTERS",
            "syncSampleRunsFromDom",
            "sampleFilterScenario",
            "sampleEvidenceLabel",
            "sampleProjectActionsLabel",
            "sampleProjectOpen",
            "sampleProjectDownload",
            "sampleRecipeManifest",
            "sampleProjectDownloadsTitle",
            "sampleProjectDownloadsBody",
            "sampleProjectBlank",
            "sampleProjectModern",
            "sampleProjectHoi41936",
            "sampleProjectHoi41939",
            "sampleProjectTno",
            "initProductStory",
            "initMetricCountUp",
            "PRODUCT_STORY_STEPS",
            "PRODUCT_STORY_COMPARISON_ASSETS",
            "storyStageTitleBaseline",
            "storyStageTitleExport",
            "syncProductStoryFromDom",
            "previewPanelTransportTitle",
            "previewImageFallback",
            "showcaseMetadataFallback",
            "dataCardOneTitle",
            "faqOneQuestion",
            "editionsEyebrow",
            "productPreviewLabel",
            "productStageLabel",
            "heroChipsLabel",
            "brandHomeLabel",
            "languageSwitcherLabel",
            "productPreviewAlt",
            "DEFAULT_HERO_MODE",
            "HERO_SCENARIO_ASSETS",
            "hero-hoi4-1936.json",
            "hero-hoi4-1939.webp",
            "hero-tno-1962.webp",
            "syncHeroMap",
            "heroAltHoi41936",
            "heroAltHoi41939",
            "heroAltTno1962",
            "data-i18n-alt",
            "metaTitle",
            "metaDescription",
            "metaOgDescription",
            "zh:",
        ):
            with self.subTest(expected_fragment=expected_fragment):
                self.assertIn(expected_fragment, app_js)

    def test_dist_styles_keeps_reveal_and_motion_contract(self) -> None:
        if not DIST_STYLES_CSS.exists():
            self.skipTest("dist/styles.css is only available after build_pages_dist runs")
        styles_css = DIST_STYLES_CSS.read_text(encoding="utf-8")

        self.assertIn("prefers-reduced-motion", styles_css)
        self.assertRegex(styles_css, re.compile(r'\[data-reveal(?:=["\']enabled["\'])?\]'))
        self.assertIn(".is-revealed", styles_css)
        self.assertIn(".hero-cartography", styles_css)
        self.assertIn("translateY(-8px) perspective(1200px)", styles_css)
        hero_chips_style = re.search(r"\.hero__chips\s*\{(?P<body>[^}]*)\}", styles_css, re.S)
        self.assertIsNotNone(hero_chips_style)
        self.assertNotIn("position: absolute", hero_chips_style.group("body"))
        self.assertIn(".brandmark__logo", styles_css)
        self.assertNotIn(".brandmark__dot", styles_css)
        self.assertIn('[data-hero-transition="loading"]', styles_css)
        self.assertIn('[data-hero-mode="blank"]', styles_css)
        self.assertIn('[data-hero-mode="hoi4-1936"]', styles_css)
        self.assertIn('[data-hero-mode="hoi4-1939"]', styles_css)
        self.assertIn('[data-hero-mode="tno-1962"]', styles_css)
        self.assertIn(".showcase-layer-tabs", styles_css)
        self.assertIn('[data-showcase-view-zoomed="true"]', styles_css)
        self.assertIn(".sample-runs__filters", styles_css)
        self.assertIn(".sample-run-filter[aria-pressed=\"true\"]", styles_css)
        self.assertIn(".sample-run-card__recipe", styles_css)
        self.assertIn(".sample-run-card__proof", styles_css)
        self.assertIn(".sample-run-card__actions", styles_css)
        self.assertIn(".sample-project-downloads", styles_css)
        self.assertIn(".sample-project-downloads__grid", styles_css)
        self.assertIn(".product-story__grid", styles_css)
        self.assertIn(".story-stage", styles_css)
        self.assertIn("position: sticky", styles_css)
        self.assertIn(".story-evidence", styles_css)
        self.assertIn('.story-step[aria-pressed="true"]', styles_css)
        for selector in (".story-stage__hud strong", ".story-step__copy strong"):
            with self.subTest(story_font_selector=selector):
                assert_css_block_avoids_viewport_font_scaling(self, styles_css, selector)
        self.assertIn(".showcase-map__viewport", styles_css)
        self.assertIn(".showcase-map__viewport::after", styles_css)
        self.assertIn("radial-gradient(ellipse at center", styles_css)
        self.assertIn("inset 0 0 112px", styles_css)
        self.assertIn(".showcase-map__object", styles_css)
        self.assertNotIn(".showcase-map__controls", styles_css)
        self.assertIn("[data-preview-image=\"transport\"]", styles_css)
        self.assertIn("--preview-scale", styles_css)
        self.assertIn(".mini-map__viewport", styles_css)
        self.assertIn(".mini-map__controls", styles_css)
        self.assertIn('[data-preview-zoomed="true"]', styles_css)
        self.assertIn('[data-preview-dragging="true"]', styles_css)
        self.assertIn(".showcase-section", styles_css)
        self.assertRegex(
            styles_css,
            re.compile(r"\.work-card__media img\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;", re.S),
        )
        self.assertRegex(
            styles_css,
            re.compile(r"\.work-card__media\s*\{[^}]*aspect-ratio:\s*16\s*/\s*9;", re.S),
        )

    def test_editor_source_index_keeps_pages_startup_contract(self) -> None:
        html = EDITOR_INDEX.read_text(encoding="utf-8")

        self.assertIn('<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml" />', html)
        self.assertIn('<link rel="alternate icon" href="../assets/favicon.png" type="image/png" />', html)
        self.assertIn('<link rel="modulepreload" href="js/main.js" />', html)
        self.assertIn('<link rel="preload" href="data/scenarios/index.json" as="fetch" crossorigin />', html)
        self.assertNotIn('data-startup-bundle-preload', html)
        self.assertNotIn('startup.bundle.${language}', html)

    def test_dist_app_index_keeps_pages_startup_contract(self) -> None:
        if not DIST_APP_INDEX.exists():
            self.skipTest("dist/app/index.html is only available after build_pages_dist runs")
        html = DIST_APP_INDEX.read_text(encoding="utf-8")

        self.assertIn('<meta name="default-scenario" content="tno_1962" />', html)
        self.assertIn('<meta name="robots" content="noindex,nofollow" />', html)
        self.assertIn('<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml" />', html)
        self.assertIn('<link rel="alternate icon" href="../assets/favicon.png" type="image/png" />', html)
        self.assertIn('<link rel="modulepreload" href="js/main.js" />', html)
        self.assertIn('<link rel="preload" href="data/scenarios/index.json" as="fetch" crossorigin />', html)
        self.assertNotIn('data-startup-bundle-preload', html)
        self.assertNotIn('startup.bundle.${language}', html)
        self.assertNotIn('<link rel="preload" href="data/europe_topology.json" as="fetch" crossorigin />', html)
        self.assertNotIn('href="data/locales.startup.json"', html)
        self.assertNotIn('href="data/geo_aliases.startup.json"', html)

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
        self.assertEqual(size_gate.get("warning_status"), "within_warning")
        self.assertLess(payload["total_bytes"], build_pages_dist.PAGES_DIST_WARNING_BYTES)
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
        expected_hgo_runtime_paths = tuple(
            f"app/data/hgo_runtime/{file_name}" for file_name in build_pages_dist.PAGES_HGO_RUNTIME_FILES
        )
        expected_landing_asset_paths = (
            "assets/hero-cartography.svg",
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
            "assets/showcase-final-map.svg",
            "assets/showcase-final-map.webp",
            "assets/europe-1936-showcase.svg",
            "assets/europe-1936-showcase.json",
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
            "assets/template-blank.svg",
            "assets/template-blank.webp",
            "assets/template-modern.svg",
            "assets/template-modern.webp",
            "assets/template-hoi4.svg",
            "assets/template-hoi4.webp",
            "assets/template-tno.svg",
            "assets/template-tno.webp",
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
            *expected_hgo_runtime_paths,
            "app/data/hgo_catalogs/flags_png/small/AB/ABK.png",
            "app/data/hgo_catalogs/flags_png/medium/AB/ABK.png",
            "app/data/city_lights/historical_1930_entries.json",
            "app/data/scenarios/tno_1962/startup.bundle.en.json",
            "app/data/scenarios/tno_1962/derived/atlantropa_donor_ledger.json",
            "app/data/scenarios/tno_1962/derived/geometry_drop_audit.json",
            "app/data/scenarios/tno_1962/chunks/political.coarse.r0c0.json",
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
            "app/data/global_bathymetry.topo.json",
        ):
            with self.subTest(expected_path=expected_path):
                self.assertIn(expected_path, paths)

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
            sorted(unpublished_assets),
        )
        self.assertEqual(
            data_manifest.get("runtime_asset_registry", {}).get("pages_dist_policy", {}).get("removed_unpublished_asset_keys"),
            sorted(unpublished_assets),
        )
        for output_key in local_preview_outputs:
            with self.subTest(output_key=output_key):
                self.assertNotIn(output_key, data_manifest.get("outputs", {}))
        self.assertTrue(
            local_preview_outputs.issubset(
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
        self.assertEqual(scenario_index.get("developer_preview_ids"), ["hgo_1936"])
        self.assertEqual(sorted(scenario_ids), sorted(public_baseline_ids))
        self.assertNotIn("hgo_1936", scenario_ids)
        self.assertEqual(
            scenario_index.get("pages_dist_policy", {}).get("local_preview_scenario_ids"),
            ["hgo_1936"],
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

    def test_deploy_dist_artifact_preserves_nojekyll(self) -> None:
        workflow_lines = VERIFY_SHARED_WORKFLOW.read_text(encoding="utf-8").splitlines()
        upload_block_start = workflow_lines.index("          name: deploy-dist")
        upload_block = "\n".join(workflow_lines[upload_block_start : upload_block_start + 4])

        self.assertIn(
            "path: ${{ inputs.pages-artifact-only && '.runtime/pages-release/dist' || 'dist' }}",
            upload_block,
        )
        self.assertIn("include-hidden-files: true", upload_block)


if __name__ == "__main__":
    unittest.main()
