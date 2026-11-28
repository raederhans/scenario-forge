from __future__ import annotations

import json
import unittest
from pathlib import Path

from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

from tools import build_landing_europe_1936_showcase as europe
from tools import build_landing_japan_preview as japan
from tools import build_landing_work_maps as work_maps


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSETS = REPO_ROOT / "landing" / "assets"


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


class JapanPreviewGeometryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.carrier = read_json(japan.JAPAN_CARRIER)
        cls.frame = make_valid(shape(cls.carrier["frames"]["main"]["fitGeometry"]))
        cls.canvas = japan.Canvas.from_carrier(cls.carrier)

    def test_selected_geometry_is_fully_masked_by_carrier_frame(self) -> None:
        canvas = self.canvas
        frame = self.frame
        numerical_frame = frame.buffer(1e-10)
        line_layers = {
            "roads": japan.select_line_layer(
                japan.JAPAN_ROADS, "roads", canvas, frame, japan.ROAD_LIMIT,
                "japan-road-preview", japan.road_rank, stride=1,
            )[0],
            "rails": japan.select_line_layer(
                japan.JAPAN_RAIL, "railways", canvas, frame, japan.RAIL_LIMIT,
                "japan-rail-preview", japan.rail_rank, stride=1,
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


class WorkMapProjectionTests(unittest.TestCase):
    def test_polygon_holes_are_retained(self) -> None:
        geometry = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)], [[(1, 1), (2, 1), (2, 2), (1, 2)]])
        path = work_maps.polygon_paths(geometry, work_maps.Canvas(400, 400, (0, 0, 4, 4)))[0]
        self.assertEqual(path.count("M"), 2)
        self.assertEqual(path.count("Z"), 2)
        boundary = work_maps.polygon_paths(
            geometry, work_maps.Canvas(400, 400, (0, 0, 4, 4)), include_interiors=False,
        )[0]
        self.assertEqual(boundary.count("M"), 1)


class JapanWorkMapSemanticsTests(unittest.TestCase):
    def test_transport_previews_retain_every_eligible_source_path(self) -> None:
        national = read_json(ASSETS / "japan-preview.json")["counts"]
        self.assertEqual(national["road_lines_rendered"], national["road_eligible_paths"])
        self.assertEqual(national["rail_lines_rendered"], national["rail_eligible_paths"])
        regional = read_json(ASSETS / "work-atlas-japan-corridor.json")["counts"]
        bounds = work_maps.WORK_OUTPUTS["japan_corridor"]["bbox"]
        road_source = work_maps.topology_features(work_maps.JAPAN_TRANSPORT_DIR / "japan_road" / "roads.preview.topo.json", "roads")
        rail_source = work_maps.topology_features(work_maps.JAPAN_TRANSPORT_DIR / "japan_rail" / "railways.preview.topo.json", "railways")
        self.assertEqual(regional["road_lines"], len(work_maps.clipped_features(road_source, bounds)))
        self.assertEqual(regional["rail_lines"], len(work_maps.clipped_features(rail_source, bounds)))


if __name__ == "__main__":
    unittest.main()
