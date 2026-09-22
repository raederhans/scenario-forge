from __future__ import annotations

import copy
import json
import re
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

from shapely.geometry import GeometryCollection, LineString, Point, Polygon, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from tools import build_landing_europe_1936_showcase as europe
from tools import build_landing_japan_preview as japan
from tools import build_landing_work_maps as work_maps
from tools import rasterize_landing_assets as raster_assets


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSETS = REPO_ROOT / "landing" / "assets"


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def assert_files_equal(test: unittest.TestCase, actual: Path, expected: Path) -> None:
    test.assertEqual(
        actual.read_bytes(),
        expected.read_bytes(),
        f"{expected.relative_to(REPO_ROOT)} is stale; regenerate it with its canonical generator",
    )


def parse_label_box(value: str) -> tuple[float, float, float, float]:
    numbers = [float(part) for part in re.findall(r"-?(?:\d+(?:\.\d*)?|\.\d+)", value)]
    if len(numbers) != 4:
        raise AssertionError(f"data-label-box must contain x0,y0,x1,y1; found {value!r}")
    x0, y0, x1, y1 = numbers
    if x1 <= x0 or y1 <= y0:
        raise AssertionError(f"data-label-box bounds must be ordered; found {value!r}")
    return x0, y0, x1, y1


def boxes_intersect(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> bool:
    left_x0, left_y0, left_x1, left_y1 = left
    right_x0, right_y0, right_x1, right_y1 = right
    return (
        max(left_x0, right_x0) < min(left_x1, right_x1)
        and max(left_y0, right_y0) < min(left_y1, right_y1)
    )


def assert_pairwise_disjoint(
    test: unittest.TestCase,
    labelled_boxes: list[tuple[str, tuple[float, float, float, float]]],
) -> None:
    test.assertGreater(len(labelled_boxes), 1, "label-box contract must cover multiple labels")
    for index, (left_name, left_box) in enumerate(labelled_boxes):
        for right_name, right_box in labelled_boxes[index + 1 :]:
            test.assertFalse(
                boxes_intersect(left_box, right_box),
                f"label boxes overlap: {left_name!r} {left_box} and {right_name!r} {right_box}",
            )


def svg_label_boxes(path: Path, *, tier_zero_only: bool) -> list[tuple[str, tuple[float, float, float, float]]]:
    root = ET.parse(path).getroot()
    boxes: list[tuple[str, tuple[float, float, float, float]]] = []
    for element in root.iter():
        value = element.attrib.get("data-label-box")
        if value is None:
            continue
        class_name = element.attrib.get("class", "")
        tier = element.attrib.get("data-label-tier")
        if tier_zero_only and tier != "0" and "tier-0" not in class_name:
            continue
        label = element.attrib.get("data-label") or element.attrib.get("data-tag")
        if not label:
            label = " ".join(text.strip() for text in element.itertext() if text.strip())
        boxes.append((label or "unlabelled", parse_label_box(value)))
    return boxes


class LandingMapGeneratorParityTests(unittest.TestCase):
    def test_europe_generator_matches_checked_in_svg_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            with (
                mock.patch.object(europe, "SHOWCASE_SVG", output_dir / europe.SHOWCASE_SVG.name),
                mock.patch.object(europe, "SHOWCASE_METADATA", output_dir / europe.SHOWCASE_METADATA.name),
            ):
                europe.build_showcase()
                europe.build_hero_scenario_maps(output_dir)
            raster_assets.optimize_svg_file(output_dir / europe.SHOWCASE_SVG.name)

            expected_names = [europe.SHOWCASE_SVG.name, europe.SHOWCASE_METADATA.name]
            for output in europe.HERO_SCENARIO_OUTPUTS.values():
                expected_names.extend([output["svg"].name, output["metadata"].name])
            for name in expected_names:
                assert_files_equal(self, output_dir / name, ASSETS / name)

    def test_japan_preview_generator_matches_checked_in_svg_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            generated_svgs = {mode: output_dir / path.name for mode, path in japan.JAPAN_PREVIEW_SVGS.items()}
            generated_metadata = output_dir / japan.JAPAN_PREVIEW_METADATA.name
            japan.build_preview(output_dir)

            assert_files_equal(self, generated_metadata, ASSETS / generated_metadata.name)
            for path in generated_svgs.values():
                assert_files_equal(self, path, ASSETS / path.name)

    def test_work_map_generator_matches_checked_in_svg_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_dir = Path(temporary_directory)
            generated_outputs = copy.deepcopy(work_maps.WORK_OUTPUTS)
            for output in generated_outputs.values():
                output["svg"] = output_dir / output["svg"].name
                output["metadata"] = output_dir / output["metadata"].name
            with mock.patch.object(work_maps, "WORK_OUTPUTS", generated_outputs):
                work_maps.main()
            for output in generated_outputs.values():
                raster_assets.optimize_svg_file(output["svg"])

            for output in generated_outputs.values():
                assert_files_equal(self, output["svg"], ASSETS / output["svg"].name)
                assert_files_equal(self, output["metadata"], ASSETS / output["metadata"].name)


class JapanPreviewGeometryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.carrier = read_json(japan.JAPAN_CARRIER)
        cls.frame = make_valid(shape(cls.carrier["frames"]["main"]["fitGeometry"]))
        cls.canvas = japan.Canvas.from_carrier(cls.carrier)

    def test_metadata_projection_fit_is_bound_to_carrier(self) -> None:
        metadata = read_json(japan.JAPAN_PREVIEW_METADATA)
        projection = metadata["projection"]
        expected_projection = self.carrier["projection"]

        self.assertEqual(metadata["scope"]["bbox"], [round(value, 6) for value in self.frame.bounds])
        self.assertEqual(projection["name"], expected_projection["type"])
        self.assertEqual(projection["center"], expected_projection["center"])
        self.assertEqual(projection["parallels"], expected_projection["parallels"])
        self.assertAlmostEqual(projection["fit_scale"], self.canvas.scale, places=12)
        self.assertAlmostEqual(projection["offset_x"], self.canvas.offset_x, places=12)
        self.assertAlmostEqual(projection["offset_y"], self.canvas.offset_y, places=12)
        self.assertIn("projection fit", projection["scale_semantics"])
        self.assertEqual(metadata["ui_zoom"]["ownership"], "landing/app.js consumer")
        self.assertIn("after projection fit", metadata["ui_zoom"]["semantics"])

        serialized = json.dumps(metadata, sort_keys=True).lower()
        self.assertNotIn("initial_ui_scale", serialized)
        self.assertNotIn("ui_zoom_steps", serialized)
        self.assertNotIn("consumer_zoom", serialized)
        self.assertNotIn("\"scale\":", json.dumps(projection, sort_keys=True).lower())

    def test_selected_geometry_is_fully_masked_by_carrier_frame(self) -> None:
        canvas = self.canvas
        frame = self.frame
        numerical_frame = frame.buffer(1e-10)
        line_layers = {
            "roads": japan.select_line_layer(
                japan.JAPAN_ROADS, "roads", canvas, frame, japan.ROAD_LIMIT,
                "japan-road-preview", japan.road_rank, stride=5,
            )[0],
            "rails": japan.select_line_layer(
                japan.JAPAN_RAIL, "railways", canvas, frame, japan.RAIL_LIMIT,
                "japan-rail-preview", japan.rail_rank, stride=4,
            )[0],
            "highlighted_motorway": japan.select_main_corridor_path(canvas, frame),
            "terrain_major": japan.select_topology_lines(
                japan.CONTOURS_MAJOR, "contours", canvas, frame, japan.MAJOR_CONTOUR_LIMIT,
                "global-contours-major", stride=8,
            )[0],
            "terrain_minor": japan.select_topology_lines(
                japan.CONTOURS_MINOR, "contours", canvas, frame, japan.MINOR_CONTOUR_LIMIT,
                "global-contours-minor", stride=12,
            )[0],
            "rivers": japan.select_geojson_lines(
                japan.GLOBAL_RIVERS, canvas, frame, japan.RIVER_LIMIT, "global-rivers", stride=4,
            )[0],
            "bathymetry": japan.select_topology_lines(
                japan.GLOBAL_BATHYMETRY, "bathymetry_contours", canvas, frame,
                japan.BATHYMETRY_LIMIT, "global-bathymetry-contours", stride=4,
            )[0],
        }
        for layer_name, entries in line_layers.items():
            for entry in entries:
                geometry = getattr(entry, "source_geometry", None)
                self.assertIsNotNone(geometry, f"{layer_name} PathEntry must retain its clipped source geometry")
                self.assertTrue(
                    numerical_frame.covers(geometry),
                    f"{layer_name} contains geometry outside carrier frames.main.fitGeometry",
                )

        point_layers = {
            "cities": japan.select_cities(canvas, frame)[0],
            "focus_cities": japan.select_focus_cities(canvas, frame),
            "stations": japan.select_station_points(canvas, frame, limit=20),
            "night": japan.select_night_points(canvas, frame)[0],
        }
        for layer_name, entries in point_layers.items():
            for entry in entries:
                lon = getattr(entry, "lon", None)
                lat = getattr(entry, "lat", None)
                self.assertIsNotNone(lon, f"{layer_name} PointEntry must retain source longitude")
                self.assertIsNotNone(lat, f"{layer_name} PointEntry must retain source latitude")
                self.assertTrue(frame.covers(Point(float(lon), float(lat))), f"{layer_name} point lies outside carrier frame")


class EuropePoliticalAndLabelContractTests(unittest.TestCase):
    def test_tno_capitals_are_inside_their_owner_geometry(self) -> None:
        metadata = read_json(ASSETS / "hero-tno-1962.json")
        capital_entries = metadata.get("capital_points")
        self.assertIsInstance(capital_entries, list)
        capital_points = {
            entry["tag"]: [entry["lon"], entry["lat"]]
            for entry in capital_entries
        }
        self.assertEqual(len(capital_points), len(capital_entries), "capital_points tags must be unique")
        self.assertEqual(set(capital_points), set(metadata["capital_tags"]))

        manifest = read_json(REPO_ROOT / "data" / "scenarios" / "tno_1962" / "manifest.json")
        topology_path = REPO_ROOT / manifest["runtime_topology_url"]
        owners_path = REPO_ROOT / manifest["owners_url"]
        owners = read_json(owners_path)["owners"]
        needed_tags = set(capital_points)
        geometries_by_tag: dict[str, list] = {tag: [] for tag in needed_tags}
        for feature in europe.topology_features(topology_path, "political"):
            properties = feature.get("properties") or {}
            feature_id = str(properties.get("id") or feature.get("id") or "")
            owner = owners.get(feature_id)
            geometry_payload = feature.get("geometry")
            if owner in needed_tags and geometry_payload:
                geometries_by_tag[owner].append(make_valid(shape(geometry_payload)))

        for tag, coordinates in capital_points.items():
            self.assertEqual(len(coordinates), 2, f"capital_points[{tag!r}] must be [lon, lat]")
            self.assertTrue(geometries_by_tag[tag], f"no owner geometry found for capital tag {tag}")
            owner_geometry = unary_union(geometries_by_tag[tag])
            self.assertTrue(
                owner_geometry.covers(Point(float(coordinates[0]), float(coordinates[1]))),
                f"capital {tag} at {coordinates} lies outside its owners.by_feature geometry",
            )

    def test_showcase_label_boxes_do_not_overlap_at_any_visible_density(self) -> None:
        boxes = svg_label_boxes(ASSETS / "europe-1936-showcase.svg", tier_zero_only=False)
        assert_pairwise_disjoint(self, boxes)

    def test_nonblank_hero_capital_label_boxes_do_not_overlap(self) -> None:
        for filename in ("hero-hoi4-1936.svg", "hero-hoi4-1939.svg", "hero-tno-1962.svg"):
            with self.subTest(filename=filename):
                boxes = svg_label_boxes(ASSETS / filename, tier_zero_only=False)
                assert_pairwise_disjoint(self, boxes)

    def test_blank_hero_runtime_topology_matches_manifest(self) -> None:
        manifest = read_json(REPO_ROOT / "data" / "scenarios" / "blank_base" / "manifest.json")
        metadata = read_json(ASSETS / "hero-blank.json")
        expected_runtime = manifest["runtime_topology_url"]
        runtime_sources = [
            source for source in metadata["source_files"] if source.endswith("/runtime_topology.topo.json")
        ]
        self.assertEqual(runtime_sources, [expected_runtime])


class WorkMapProjectionTests(unittest.TestCase):
    def test_regional_projection_preserves_local_shape_and_fits_extent(self) -> None:
        import math

        for output in work_maps.WORK_OUTPUTS.values():
            canvas = work_maps.Canvas(output["width"], output["height"], output["bbox"])
            west, south, east, north = canvas.bbox
            lon, lat = (west + east) / 2, (south + north) / 2
            x, y = canvas.project(lon, lat)
            east_x, _ = canvas.project(lon + .001 / math.cos(math.radians(lat)), lat)
            _, north_y = canvas.project(lon, lat + .001)
            self.assertAlmostEqual((east_x - x) / (y - north_y), 1, places=4)
            for corner_lon in (west, east):
                for corner_lat in (south, north):
                    x, y = canvas.project(corner_lon, corner_lat)
                    self.assertGreaterEqual(x + 1e-8, canvas.padding)
                    self.assertLessEqual(x, canvas.width - canvas.padding + 1e-8)
                    self.assertGreaterEqual(y + 1e-8, canvas.padding)
                    self.assertLessEqual(y, canvas.height - canvas.padding + 1e-8)

    def test_polygon_holes_are_retained(self) -> None:
        geometry = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (2, 1), (2, 2), (1, 2)]])
        path = work_maps.polygon_paths(geometry, work_maps.Canvas(400, 400, (0, 0, 4, 4)))[0]
        self.assertEqual(path.count("M"), 2)
        self.assertEqual(path.count("Z"), 2)
        boundary = work_maps.polygon_paths(
            geometry, work_maps.Canvas(400, 400, (0, 0, 4, 4)), include_interiors=False,
        )[0]
        self.assertEqual(boundary.count("M"), 1)

    def test_scenario_comparison_has_no_decorative_route(self) -> None:
        svg = (ASSETS / "work-scenario-switch-europe.svg").read_text(encoding="utf-8")
        self.assertNotIn("M72 344", svg)
        self.assertNotIn("C156 286", svg)

    def test_country_border_ignores_nonpolygon_remnants(self) -> None:
        polygon = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)])
        geometry = GeometryCollection([polygon, LineString([(5, 5), (6, 6)])])
        self.assertTrue(work_maps.polygon_boundary(geometry).equals(polygon.boundary))


class JapanWorkMapSemanticsTests(unittest.TestCase):
    def test_local_atlas_has_no_undisclosed_corridor_path(self) -> None:
        svg = (ASSETS / "work-atlas-japan-corridor.svg").read_text(encoding="utf-8")
        metadata = read_json(ASSETS / "work-atlas-japan-corridor.json")
        self.assertNotIn("M80 346 C184 284 292 260 392 200 C484 146 562 104 628 58", svg)

        title_and_note = f"{metadata['title']} {metadata['selection_policy']['note']}".lower()
        self.assertIn("local", title_and_note)
        self.assertIn("road", title_and_note)
        self.assertIn("rail", title_and_note)
        self.assertNotIn("corridor atlas", title_and_note)
        self.assertNotIn("corridor output", title_and_note)
        self.assertIn("no singled-out corridor geometry", metadata["selection_policy"]["note"].lower())
        self.assertNotIn("tokaido", title_and_note)
        self.assertNotIn("tokaido", svg.lower())
        self.assertGreater(metadata["counts"]["urban_anchor_points"], 0)
        self.assertNotIn("city_light_points", metadata["counts"])
        self.assertIn("data/world_cities.geojson", metadata["sources"])
        self.assertIn('class="urban-anchors"', svg)
        self.assertIn('class="land"', svg)
        self.assertIn("data/transport_layers/japan_corridor/carrier.json", metadata["sources"])
        self.assertNotIn('class="night-lights"', svg)
        self.assertIn(">CENTRAL JAPAN TRANSPORT ATLAS</text>", svg)


if __name__ == "__main__":
    unittest.main()
