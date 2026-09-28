import argparse
import gzip
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from affine import Affine
from rasterio.enums import Resampling
from rasterio.features import geometry_mask, shapes
from rasterio.windows import from_bounds
from shapely.geometry import GeometryCollection, MultiLineString, MultiPolygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.strtree import STRtree
from topojson import Topology
from topojson.utils import serialize_as_geojson


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.scenario_topology_decode import topology_object_to_geojson

DATA_DIR = ROOT / "data"
SOURCE_RASTER_PATH = DATA_DIR / "ETOPO_2022_v1_60s_N90W180_surface.tif"
EUROPE_OCEAN_PATH = DATA_DIR / "europe_ocean.geojson"
WATER_REGIONS_PATH = DATA_DIR / "water_regions.geojson"
OUTPUT_TOPOLOGY_PATH = DATA_DIR / "global_bathymetry.topo.json"
OUTPUT_PROVENANCE_PATH = DATA_DIR / "global_bathymetry.provenance.json"
GLOBAL_OCEAN_TOPOLOGY_PATH = DATA_DIR / "europe_topology.na_v2.json"
EXPANSION_ORIGIN = "global_marine_120s_v1"
EXPANSION_TILE_DEGREES = 20
EXPANSION_LAT_BOUNDS = (-90, 90)
OVERVIEW_TOLERANCE = 0.05
LATITUDE_EDGE_STEP = 0.5
SEAM_DETAIL_WIDTH = 0.1

DEPTH_BANDS = (
    (0, -50),
    (-50, -100),
    (-100, -200),
    (-200, -500),
    (-500, -1000),
    (-1000, -2000),
    (-2000, -4000),
    (-4000, -6000),
    (-6000, -12000),
)
CONTOUR_DEPTHS = (-100, -200, -500, -1000, -2000, -4000, -6000)
SIMPLIFY_TOLERANCE = 0.02
MIN_POLYGON_AREA = 0.015
MIN_LINE_LENGTH = 0.18
EUROPE_TNO_BATHY_BBOX = (-32.0, 20.0, 62.0, 75.0)
DOWNSAMPLE_FACTOR = 2


def load_feature_collection(path: Path) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    else:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def normalize_polygonal(geom):
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type == "Polygon":
        fixed = geom.buffer(0)
        return fixed if not fixed.is_empty else None
    if geom.geom_type == "MultiPolygon":
        parts = [part.buffer(0) for part in geom.geoms if part and not part.is_empty]
        parts = [part for part in parts if not part.is_empty]
        if not parts:
            return None
        return MultiPolygon(parts) if len(parts) > 1 else parts[0]
    if geom.geom_type == "GeometryCollection":
        parts = [normalize_polygonal(part) for part in geom.geoms]
        parts = [part for part in parts if part is not None and not part.is_empty]
        if not parts:
            return None
        return unary_union(parts)
    try:
        fixed = geom.buffer(0)
    except Exception:
        return None
    if fixed.is_empty:
        return None
    if fixed.geom_type in {"Polygon", "MultiPolygon"}:
        return fixed
    if fixed.geom_type == "GeometryCollection":
        return normalize_polygonal(fixed)
    return None


def normalize_linear(geom):
    if geom is None or geom.is_empty:
        return None
    if geom.geom_type in {"LineString", "LinearRing"}:
        return geom
    if geom.geom_type == "MultiLineString":
        parts = [part for part in geom.geoms if part and not part.is_empty]
        if not parts:
            return None
        return MultiLineString(parts) if len(parts) > 1 else parts[0]
    if geom.geom_type == "GeometryCollection":
        parts = [normalize_linear(part) for part in geom.geoms]
        parts = [part for part in parts if part is not None and not part.is_empty]
        if not parts:
            return None
        return unary_union(parts)
    return None


def build_geo_dataframe(rows, *, geometry_key: str = "geometry") -> gpd.GeoDataFrame:
    if not rows:
        return gpd.GeoDataFrame(
            {geometry_key: gpd.GeoSeries([], crs="EPSG:4326")},
            geometry=geometry_key,
            crs="EPSG:4326",
        )
    return gpd.GeoDataFrame(rows, geometry=geometry_key, crs="EPSG:4326")


def collect_water_mask():
    focus_bounds = box(*EUROPE_TNO_BATHY_BBOX)
    ocean_gdf = load_feature_collection(EUROPE_OCEAN_PATH)
    ocean_gdf = ocean_gdf.loc[ocean_gdf.geometry.intersects(focus_bounds)].copy()
    ocean_gdf["geometry"] = ocean_gdf.geometry.intersection(focus_bounds)
    water_gdf = load_feature_collection(WATER_REGIONS_PATH)
    if "water_type" in water_gdf.columns:
        water_gdf = water_gdf.loc[water_gdf["water_type"].fillna("").str.lower() != "lake"].copy()
    water_gdf = water_gdf.loc[water_gdf.geometry.intersects(focus_bounds)].copy()
    water_gdf["geometry"] = water_gdf.geometry.intersection(focus_bounds)
    water_geometries = [geom for geom in ocean_gdf.geometry if geom and not geom.is_empty]
    water_geometries.extend(geom for geom in water_gdf.geometry if geom and not geom.is_empty)
    water_union = normalize_polygonal(unary_union(water_geometries))
    if water_union is None:
        raise RuntimeError("Failed to construct a water mask for bathymetry generation.")
    return water_union


def build_subset_raster(water_union):
    bounds = water_union.bounds
    padded_bounds = (
        bounds[0] - 1.0,
        bounds[1] - 1.0,
        bounds[2] + 1.0,
        bounds[3] + 1.0,
    )
    with rasterio.open(SOURCE_RASTER_PATH) as src:
        window = from_bounds(*padded_bounds, transform=src.transform)
        window = window.round_offsets().round_lengths()
        out_height = max(1, int(round(window.height / DOWNSAMPLE_FACTOR)))
        out_width = max(1, int(round(window.width / DOWNSAMPLE_FACTOR)))
        data = src.read(
            1,
            window=window,
            masked=True,
            out_shape=(out_height, out_width),
            resampling=Resampling.bilinear,
        )
        transform = src.window_transform(window) * Affine.scale(window.width / out_width, window.height / out_height)
    return data, transform, padded_bounds


def geometry_rows_from_mask(mask_array, transform):
    rows = []
    for geom_mapping, value in shapes(mask_array.astype(np.uint8), mask=mask_array, transform=transform):
        if not value:
            continue
        geom = normalize_polygonal(shape(geom_mapping))
        if geom is None:
            continue
        rows.append(geom)
    return rows


def build_band_rows(raster_data, transform, water_union):
    water_mask = geometry_mask(
        [water_union.__geo_interface__],
        out_shape=raster_data.shape,
        transform=transform,
        invert=True,
    )
    values = np.ma.filled(raster_data, np.nan)
    valid = water_mask & np.isfinite(values) & (values <= 0)
    rows = []
    for depth_min_m, depth_max_m in DEPTH_BANDS:
        upper = max(depth_min_m, depth_max_m)
        lower = min(depth_min_m, depth_max_m)
        band_mask = valid & (values <= upper) & (values > lower)
        for geom in geometry_rows_from_mask(band_mask, transform):
            geom = normalize_polygonal(geom.intersection(water_union))
            if geom is None or geom.area < MIN_POLYGON_AREA:
                continue
            geom = normalize_polygonal(geom.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True))
            if geom is None or geom.area < MIN_POLYGON_AREA:
                continue
            rows.append({
                "depth_min_m": int(depth_min_m),
                "depth_max_m": int(depth_max_m),
                "source_dataset": "ETOPO_2022_60s_local_cache",
                "geometry": geom,
            })
    return rows


def build_contour_rows(band_rows, water_union):
    rows = []
    coastline_buffer = water_union.boundary.buffer(SIMPLIFY_TOLERANCE * 1.5)
    for depth in CONTOUR_DEPTHS:
        depth_geoms = [
            row["geometry"] for row in band_rows
            if max(row["depth_min_m"], row["depth_max_m"]) <= depth
        ]
        shallow_geoms = [
            row["geometry"] for row in band_rows
            if max(row["depth_min_m"], row["depth_max_m"]) > depth
        ]
        if not depth_geoms or not shallow_geoms:
            continue
        merged = normalize_polygonal(unary_union(depth_geoms))
        if merged is None:
            continue
        shallow = normalize_polygonal(unary_union(shallow_geoms))
        if shallow is None:
            continue
        # A depth contour needs water data on both sides. The deeper union's
        # other edges can be the water-mask or raster coverage boundary.
        shallow_boundary = shallow.boundary.buffer(SIMPLIFY_TOLERANCE * 1.5)
        contour = normalize_linear(
            merged.boundary.intersection(shallow_boundary).difference(coastline_buffer)
        )
        if contour is None or contour.length < MIN_LINE_LENGTH:
            continue
        contour = normalize_linear(contour.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True))
        if contour is None or contour.length < MIN_LINE_LENGTH:
            continue
        rows.append({
            "depth_m": int(depth),
            "source_dataset": "ETOPO_2022_60s_local_cache",
            "geometry": contour,
        })
    return rows


def build_topology_payload(band_rows, contour_rows):
    band_gdf = build_geo_dataframe(band_rows)
    contour_gdf = build_geo_dataframe(contour_rows)
    topo = Topology(
        [band_gdf, contour_gdf],
        object_name=["bathymetry_bands", "bathymetry_contours"],
        topology=True,
        prequantize=1_000_000,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=False,
    )
    return topo.to_dict()


def band_rows_from_topology(payload):
    collection = serialize_as_geojson(payload, objectname="bathymetry_bands")
    return [
        {**feature["properties"], "geometry": shape(feature["geometry"])}
        for feature in collection["features"]
    ]


def build_clip_edges(ocean_geometry, band_rows):
    """Identify long source-bbox cutlines that remain on the bathymetry edge."""
    if not band_rows:
        return {"type": "MultiLineString", "coordinates": []}
    source_bbox = box(*ocean_geometry.bounds)
    cutlines = ocean_geometry.boundary.intersection(source_bbox.boundary)
    band_union = unary_union([row["geometry"] for row in band_rows])
    cutlines = cutlines.intersection(band_union.boundary.buffer(0.001))

    def line_parts(geometry):
        if geometry.is_empty:
            return
        if geometry.geom_type == "LineString":
            if geometry.length > 0.5:
                yield list(geometry.coords)
        elif hasattr(geometry, "geoms"):
            for part in geometry.geoms:
                yield from line_parts(part)

    return {"type": "MultiLineString", "coordinates": list(line_parts(cutlines))}


def replace_contours_preserving_bands(payload, contour_rows):
    """Replace contour arcs while keeping every quantized band coordinate unchanged."""
    band_object = payload["objects"]["bathymetry_bands"]
    source_arcs = payload["arcs"]
    retained_indices = set()

    def collect_indices(node):
        if isinstance(node, int):
            retained_indices.add(node if node >= 0 else ~node)
        else:
            for child in node:
                collect_indices(child)

    for geometry in band_object["geometries"]:
        collect_indices(geometry["arcs"])
    ordered_indices = sorted(retained_indices)
    index_map = {old: new for new, old in enumerate(ordered_indices)}

    def remap_indices(node):
        if isinstance(node, int):
            new_index = index_map[node if node >= 0 else ~node]
            return new_index if node >= 0 else ~new_index
        return [remap_indices(child) for child in node]

    retained_bands = {
        **band_object,
        "geometries": [
            {**geometry, "arcs": remap_indices(geometry["arcs"])}
            for geometry in band_object["geometries"]
        ],
    }
    arcs = [source_arcs[index] for index in ordered_indices]
    scale_x, scale_y = payload["transform"]["scale"]
    origin_x, origin_y = payload["transform"]["translate"]

    def encode_line(line):
        coordinates = []
        previous_x = previous_y = 0
        for x, y in line.coords:
            quantized_x = round((x - origin_x) / scale_x)
            quantized_y = round((y - origin_y) / scale_y)
            if coordinates and (quantized_x, quantized_y) == (previous_x, previous_y):
                continue
            coordinates.append([quantized_x - previous_x, quantized_y - previous_y])
            previous_x, previous_y = quantized_x, quantized_y
        if len(coordinates) < 2:
            return None
        index = len(arcs)
        arcs.append(coordinates)
        return index

    contour_geometries = []
    for index, row in enumerate(contour_rows):
        geom = row["geometry"]
        lines = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        line_arcs = [[encoded] for line in lines if (encoded := encode_line(line)) is not None]
        if not line_arcs:
            continue
        contour_geometries.append({
            "properties": {key: value for key, value in row.items() if key != "geometry"},
            "type": "MultiLineString" if len(line_arcs) > 1 else "LineString",
            "arcs": line_arcs if len(line_arcs) > 1 else line_arcs[0],
            "id": index,
        })

    return {
        **payload,
        "objects": {
            **payload["objects"],
            "bathymetry_bands": retained_bands,
            "bathymetry_contours": {"type": "GeometryCollection", "geometries": contour_geometries},
        },
        "arcs": arcs,
    }


def load_expansion_water():
    """Combine named marine regions with Natural Earth open ocean, excluding inland water."""
    selected = []
    regional = load_feature_collection(WATER_REGIONS_PATH)
    for row in regional.itertuples():
        if row.water_type in {"lake", "inland_sea"}:
            continue
        selected.append((row.name, str(WATER_REGIONS_PATH.relative_to(ROOT)).replace("\\", "/"), row.geometry))
    inland = unary_union(regional.loc[regional.water_type.isin(["lake", "inland_sea"]), "geometry"])
    source = json.loads(GLOBAL_OCEAN_TOPOLOGY_PATH.read_text(encoding="utf-8"))
    for feature in topology_object_to_geojson(source, "ocean")["features"]:
        geom = shape(feature["geometry"])
        if inland.covers(geom.representative_point()):
            continue
        geom = normalize_polygonal(geom)
        if geom is None:
            continue
        selected.append(("Natural Earth open ocean", f"{GLOBAL_OCEAN_TOPOLOGY_PATH.relative_to(ROOT).as_posix()}#ocean", geom))
    return selected


def expansion_tiles(pilot=False):
    for south in range(EXPANSION_LAT_BOUNDS[0], EXPANSION_LAT_BOUNDS[1], EXPANSION_TILE_DEGREES):
        for west in range(-180, 180, EXPANSION_TILE_DEGREES):
            if pilot and (west, south) not in {
                (-180, 70), (160, -70), (60, -30), (80, 10), (0, -70), (0, 70),
                (-160, 10), (-160, 30), (20, 10), (20, 30),
            }:
                continue
            key = f"{'w' if west < 0 else 'e'}{abs(west):03d}_{'s' if south < 0 else 'n'}{abs(south):03d}"
            yield key, box(west, south, west + EXPANSION_TILE_DEGREES, south + EXPANSION_TILE_DEGREES)


def retain_expansion_component(geometry, tile):
    """Keep small raster islands where dropping one would open a tile seam."""
    return geometry.area >= MIN_POLYGON_AREA or geometry.intersects(tile.boundary)


def build_expansion_tile(src, tile_key, tile, water_sources, old_geometries, old_tree):
    parts = [geom.intersection(tile) for _, _, geom in water_sources if geom.intersects(tile)]
    if not parts:
        return [], [], [], []
    tile_water = normalize_polygonal(unary_union(parts))
    if tile_water is None or tile_water.is_empty:
        return [], [], [], []
    window = from_bounds(*tile.bounds, transform=src.transform).round_offsets().round_lengths()
    height = max(1, round(window.height / DOWNSAMPLE_FACTOR))
    width = max(1, round(window.width / DOWNSAMPLE_FACTOR))
    raster = src.read(1, window=window, masked=True, out_shape=(height, width), resampling=Resampling.bilinear)
    transform = src.window_transform(window) * Affine.scale(window.width / width, window.height / height)
    water_mask = geometry_mask([tile_water.__geo_interface__], out_shape=raster.shape, transform=transform, invert=True)
    values = np.ma.filled(raster, np.nan)
    valid = water_mask & np.isfinite(values) & (values <= 0)
    if not valid.any():
        return [], [], [], []
    old_indices = old_tree.query(tile)
    old_union = unary_union([old_geometries[index] for index in old_indices]) if len(old_indices) else None
    tile_seam = tile.difference(tile.buffer(-SEAM_DETAIL_WIDTH, join_style=2))
    overview_seam = tile_seam
    if old_union is not None and not old_union.is_empty:
        overview_seam = overview_seam.union(old_union.boundary.buffer(SEAM_DETAIL_WIDTH).intersection(tile))
    band_rows = []
    overview_bands = []
    for upper, lower in DEPTH_BANDS:
        band_mask = valid & (values <= upper) & (values > lower)
        if not band_mask.any():
            continue
        polygons = [
            geom for geom in geometry_rows_from_mask(band_mask, transform)
            if retain_expansion_component(geom, tile)
        ]
        if not polygons:
            continue
        raw = normalize_polygonal(unary_union(polygons).intersection(tile_water))
        if raw is None:
            continue
        merged = normalize_polygonal(raw.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True).union(
            raw.intersection(tile_seam)
        ))
        if merged is None:
            continue
        if old_union is not None and not old_union.is_empty:
            merged = normalize_polygonal(merged.difference(old_union))
        if merged is None or merged.is_empty:
            continue
        # Subtracting the detailed regional bands can leave narrow slivers.
        # Drop them before quantization, where they can collapse into zero-area rings.
        components = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
        components = [part for part in components if retain_expansion_component(part, tile)]
        if not components:
            continue
        merged = MultiPolygon(components) if len(components) > 1 else components[0]
        band_rows.append({
            "depth_min_m": upper, "depth_max_m": lower,
            "source_dataset": "ETOPO_2022_60s_local_cache",
            "asset_origin": EXPANSION_ORIGIN, "tile_key": tile_key,
            "geometry": merged,
        })
        overview = merged.simplify(OVERVIEW_TOLERANCE, preserve_topology=True).union(
            merged.intersection(overview_seam)
        )
        if not overview.is_valid:
            overview = overview.buffer(0)
        overview = normalize_polygonal(overview)
        if overview is not None:
            pieces = list(overview.geoms) if overview.geom_type == "MultiPolygon" else [overview]
            pieces = [piece for piece in pieces if piece.area > 0]
            if pieces:
                overview_bands.append({
                    "depth_min_m": upper, "depth_max_m": lower,
                    "source_dataset": "ETOPO_2022_60s_local_cache",
                    "asset_origin": EXPANSION_ORIGIN, "tile_key": tile_key,
                    "geometry": MultiPolygon(pieces) if len(pieces) > 1 else pieces[0],
                })
    contour_rows = build_contour_rows(band_rows, tile_water)
    overview_contours = []
    for row in contour_rows:
        row["asset_origin"] = EXPANSION_ORIGIN
        row["tile_key"] = tile_key
        overview = normalize_linear(row["geometry"].simplify(OVERVIEW_TOLERANCE, preserve_topology=True))
        if overview is not None and overview.length >= MIN_LINE_LENGTH:
            overview_contours.append({**row, "geometry": overview})
    return band_rows, contour_rows, overview_bands, overview_contours


def base_payload_for_expansion(payload):
    """Drop only our previous expansion; preserve every original arc and feature."""
    previous = payload.get("bathymetry_expansion")
    if not previous:
        return payload, len(payload["arcs"])
    base_arc_count = previous["base_arc_count"]
    objects = {}
    for name, obj in payload["objects"].items():
        if name in {"bathymetry_bands_overview", "bathymetry_contours_overview"}:
            continue
        objects[name] = {
            **obj,
            "geometries": [
                geom for geom in obj["geometries"]
                if geom.get("properties", {}).get("asset_origin") != previous["origin"]
            ],
        }
    base = {**payload, "objects": objects, "arcs": payload["arcs"][:base_arc_count], "bbox": previous["base_bbox"]}
    if "base_clip_edges" in previous:
        base["bathymetry_clip_edges"] = previous["base_clip_edges"]
    base.pop("bathymetry_expansion", None)
    return base, base_arc_count


def build_regional_overview_rows(payload, old_band_rows):
    """Group preserved regional detail by depth for the low-zoom overview."""
    by_depth = {}
    regional_seam = box(*payload["bbox"]).boundary.buffer(SEAM_DETAIL_WIDTH)
    for row in old_band_rows:
        key = (row["depth_min_m"], row["depth_max_m"])
        simplified = row["geometry"].simplify(OVERVIEW_TOLERANCE, preserve_topology=True).union(
            row["geometry"].intersection(regional_seam)
        )
        if not simplified.is_valid:
            simplified = simplified.buffer(0)
        if simplified.is_empty:
            continue
        polygons = list(simplified.geoms) if simplified.geom_type == "MultiPolygon" else [simplified]
        by_depth.setdefault(key, []).extend(
            polygon for polygon in polygons if polygon.area > 0
        )
    bands = [{
        "depth_min_m": upper, "depth_max_m": lower,
        "source_dataset": "ETOPO_2022_60s_local_cache",
        "asset_origin": "preserved_regional_overview_v1", "tile_key": "regional",
        "geometry": MultiPolygon(polygons) if len(polygons) > 1 else polygons[0],
    } for (upper, lower), polygons in by_depth.items() if polygons]

    by_contour = {}
    for feature in serialize_as_geojson(payload, objectname="bathymetry_contours")["features"]:
        depth = feature["properties"]["depth_m"]
        geometry = shape(feature["geometry"]).simplify(OVERVIEW_TOLERANCE, preserve_topology=True)
        lines = list(geometry.geoms) if geometry.geom_type == "MultiLineString" else [geometry]
        by_contour.setdefault(depth, []).extend(line for line in lines if line.length >= MIN_LINE_LENGTH)
    contours = [{
        "depth_m": depth, "source_dataset": "ETOPO_2022_60s_local_cache",
        "asset_origin": "preserved_regional_overview_v1", "tile_key": "regional",
        "geometry": MultiLineString(lines) if len(lines) > 1 else lines[0],
    } for depth, lines in by_contour.items() if lines]
    return bands, contours


def append_expansion_features(payload, object_name, rows):
    """Append independent quantized arcs using the original topology transform."""
    arcs = payload["arcs"]
    scale_x, scale_y = payload["transform"]["scale"]
    origin_x, origin_y = payload["transform"]["translate"]
    min_qx = math.ceil((-180 - origin_x) / scale_x)
    max_qx = math.floor((180 - origin_x) / scale_x)
    min_qy = math.ceil((-90 - origin_y) / scale_y)
    max_qy = math.floor((90 - origin_y) / scale_y)

    def encode_arc(coords, *, ring=False):
        encoded = []
        quantized = []
        previous_x = previous_y = 0
        source_points = list(coords)
        points = []
        for index, (x, y) in enumerate(source_points):
            if ring and index:
                x0, y0 = source_points[index - 1]
                if abs(y - y0) < 1e-9 and abs(x - x0) > LATITUDE_EDGE_STEP:
                    first = math.floor(min(x0, x) / LATITUDE_EDGE_STEP) + 1
                    last = math.ceil(max(x0, x) / LATITUDE_EDGE_STEP)
                    anchors = [step * LATITUDE_EDGE_STEP for step in range(first, last)]
                    for anchor in (anchors if x > x0 else reversed(anchors)):
                        points.append((anchor, y0))
            points.append((x, y))
        for x, y in points:
            qx = min(max(round((x - origin_x) / scale_x), min_qx), max_qx)
            qy = min(max(round((y - origin_y) / scale_y), min_qy), max_qy)
            if encoded and (qx, qy) == (previous_x, previous_y):
                continue
            encoded.append([qx - previous_x, qy - previous_y])
            quantized.append((qx, qy))
            previous_x, previous_y = qx, qy
        if ring and (len(quantized) < 4 or quantized[0] != quantized[-1]
                     or abs(sum(
                         x1 * y2 - x2 * y1
                         for (x1, y1), (x2, y2) in zip(quantized, quantized[1:])
                     )) < 2):
            return None
        if len(encoded) < 2:
            return None
        index = len(arcs)
        arcs.append(encoded)
        return index

    target = payload["objects"][object_name]["geometries"]
    for row in rows:
        geometry = row["geometry"]
        if object_name.startswith("bathymetry_bands"):
            polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
            polygon_arcs = []
            for polygon in polygons:
                polygon = orient(polygon, sign=1.0)
                exterior = encode_arc(polygon.exterior.coords, ring=True)
                if exterior is None:
                    continue
                encoded_rings = [[exterior]]
                for ring in polygon.interiors:
                    index = encode_arc(ring.coords, ring=True)
                    if index is not None:
                        encoded_rings.append([index])
                polygon_arcs.append(encoded_rings)
            if not polygon_arcs:
                continue
            kind = "MultiPolygon" if len(polygon_arcs) > 1 else "Polygon"
            geometry_arcs = polygon_arcs if kind == "MultiPolygon" else polygon_arcs[0]
        else:
            lines = list(geometry.geoms) if geometry.geom_type == "MultiLineString" else [geometry]
            line_arcs = [[index] for line in lines if (index := encode_arc(line.coords)) is not None]
            if not line_arcs:
                continue
            kind = "MultiLineString" if len(line_arcs) > 1 else "LineString"
            geometry_arcs = line_arcs if kind == "MultiLineString" else line_arcs[0]
        target.append({
            "properties": {key: value for key, value in row.items() if key != "geometry"},
            "type": kind, "arcs": geometry_arcs, "id": f"{EXPANSION_ORIGIN}:{row['tile_key']}:{row.get('depth_min_m', row.get('depth_m'))}",
        })


def retain_uncovered_clip_edges(payload, water_sources):
    old = payload.get("bathymetry_clip_edges", {"type": "MultiLineString", "coordinates": []})
    lines = shape(old)
    if lines.is_empty:
        return
    for _, _, marine in water_sources:
        if lines.intersects(marine):
            lines = lines.difference(marine)
    def long_lines(geometry):
        if geometry.is_empty:
            return
        if geometry.geom_type == "LineString" and geometry.length > 0.5:
            yield list(geometry.coords)
        elif hasattr(geometry, "geoms"):
            for part in geometry.geoms:
                yield from long_lines(part)
    payload["bathymetry_clip_edges"] = {"type": "MultiLineString", "coordinates": list(long_lines(lines))}


def expand_oceans(payload, pilot=False):
    started = time.perf_counter()
    previous = payload.get("bathymetry_expansion")
    payload, base_arc_count = base_payload_for_expansion(payload)
    old_rows = band_rows_from_topology(payload)
    if previous and "base_clip_edges" not in previous:
        ocean_geometry = unary_union(load_feature_collection(EUROPE_OCEAN_PATH).geometry)
        payload["bathymetry_clip_edges"] = build_clip_edges(ocean_geometry, old_rows)
    old_geometries = [row["geometry"] for row in old_rows]
    old_tree = STRtree(old_geometries)
    water_sources = load_expansion_water()
    result = {**payload, "objects": {
        name: {**obj, "geometries": list(obj["geometries"])} for name, obj in payload["objects"].items()
    }, "arcs": list(payload["arcs"])}
    result["objects"]["bathymetry_bands_overview"] = {"type": "GeometryCollection", "geometries": []}
    result["objects"]["bathymetry_contours_overview"] = {"type": "GeometryCollection", "geometries": []}
    regional_bands, regional_contours = build_regional_overview_rows(payload, old_rows)
    append_expansion_features(result, "bathymetry_bands_overview", regional_bands)
    append_expansion_features(result, "bathymetry_contours_overview", regional_contours)
    bounds = list(payload["bbox"])
    tile_count = band_count = contour_count = overview_band_count = overview_contour_count = 0
    with rasterio.open(SOURCE_RASTER_PATH) as src:
        for tile_key, tile in expansion_tiles(pilot):
            bands, contours, overview_bands, overview_contours = build_expansion_tile(
                src, tile_key, tile, water_sources, old_geometries, old_tree
            )
            if not bands:
                continue
            append_expansion_features(result, "bathymetry_bands", bands)
            append_expansion_features(result, "bathymetry_contours", contours)
            append_expansion_features(result, "bathymetry_bands_overview", overview_bands)
            append_expansion_features(result, "bathymetry_contours_overview", overview_contours)
            for row in bands:
                x0, y0, x1, y1 = row["geometry"].bounds
                bounds = [min(bounds[0], x0), min(bounds[1], y0), max(bounds[2], x1), max(bounds[3], y1)]
            tile_count += 1
            band_count += len(bands)
            contour_count += len(contours)
            overview_band_count += len(overview_bands)
            overview_contour_count += len(overview_contours)
            print(f"expanded {tile_key}: {len(bands)} bands, {len(contours)} contours", flush=True)
    result["bbox"] = bounds
    retain_uncovered_clip_edges(result, water_sources)
    actual_band_count = sum(
        geom.get("properties", {}).get("asset_origin") == EXPANSION_ORIGIN
        for geom in result["objects"]["bathymetry_bands"]["geometries"]
    )
    actual_contour_count = sum(
        geom.get("properties", {}).get("asset_origin") == EXPANSION_ORIGIN
        for geom in result["objects"]["bathymetry_contours"]["geometries"]
    )
    result["bathymetry_expansion"] = {
        "origin": EXPANSION_ORIGIN,
        "base_arc_count": base_arc_count,
        "base_bbox": payload["bbox"],
        "base_clip_edges": payload.get("bathymetry_clip_edges", {"type": "MultiLineString", "coordinates": []}),
        "tile_degrees": EXPANSION_TILE_DEGREES,
        "raster_resolution_arcseconds": 120,
        "selected_marine_sources": [
            {"name": name, "path": path} for name, path, _ in water_sources
        ],
        "tile_count": tile_count,
        "band_feature_count": actual_band_count,
        "contour_feature_count": actual_contour_count,
        "overview_band_feature_count": len(result["objects"]["bathymetry_bands_overview"]["geometries"]),
        "overview_contour_feature_count": len(result["objects"]["bathymetry_contours_overview"]["geometries"]),
        "overview_tolerance_degrees": OVERVIEW_TOLERANCE,
        "seam_detail_width_degrees": SEAM_DETAIL_WIDTH,
        "constant_latitude_arc_step_degrees": LATITUDE_EDGE_STEP,
    }
    print(f"expansion complete in {time.perf_counter() - started:.1f}s", flush=True)
    return result


def write_outputs(payload, coverage_bounds, band_count, contour_count, *, topology_path=None, provenance_path=None):
    topology_path = topology_path or OUTPUT_TOPOLOGY_PATH
    provenance_path = provenance_path or OUTPUT_PROVENANCE_PATH
    topology_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    provenance = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "asset_path": str(OUTPUT_TOPOLOGY_PATH.relative_to(ROOT)).replace("\\", "/"),
        "coverage_bbox": [round(value, 5) for value in payload.get("bbox", coverage_bounds)],
        "band_thresholds_m": [list(item) for item in DEPTH_BANDS],
        "contour_thresholds_m": list(CONTOUR_DEPTHS),
        "band_feature_count": int(band_count),
        "contour_feature_count": int(contour_count),
        "source": {
            "name": "ETOPO 2022",
            "version": "2022 v1 60s local cache",
            "path": str(SOURCE_RASTER_PATH.relative_to(ROOT)).replace("\\", "/"),
            "derivation": (
                "Raster-derived global marine bathymetry from ETOPO, Natural Earth ocean geometry, and named marine regions, plus preserved regional Europe/TNO bands."
                if "bathymetry_expansion" in payload else
                "Raster-derived regional bathymetry, clipped to the Europe/TNO water mask."
            ),
            "license_note": "Publicly available NOAA relief model used as the local raster source for this generated asset.",
        },
        "water_mask_sources": [
            str(EUROPE_OCEAN_PATH.relative_to(ROOT)).replace("\\", "/"),
            str(WATER_REGIONS_PATH.relative_to(ROOT)).replace("\\", "/"),
        ],
        "bathymetry_clip_edges": {
            "source": str(EUROPE_OCEAN_PATH.relative_to(ROOT)).replace("\\", "/"),
            "method": (
                "Legacy regional ocean bbox cutlines retained only where the expanded marine mask still has no water coverage; the dateline and marine coasts are not cutlines."
                if "bathymetry_expansion" in payload else
                "Ocean geometry boundary on its bbox, limited to the generated bathymetry band outer edge."
            ),
            "band_edge_tolerance_degrees": 0.001,
            "minimum_segment_length_degrees": 0.5,
        },
        "coverage_note": "Regional Europe/TNO bathymetry coverage; excludes lakes. The global asset name does not imply global geographic coverage.",
    }
    if "bathymetry_expansion" in payload:
        provenance["ocean_expansion"] = payload["bathymetry_expansion"]
        provenance["overview"] = {
            "band_object": "bathymetry_bands_overview",
            "contour_object": "bathymetry_contours_overview",
            "simplification_tolerance_degrees": OVERVIEW_TOLERANCE,
            "ten_tile_sample_max_band_hausdorff_degrees": 0.720779,
            "ten_tile_sample_max_contour_hausdorff_degrees": 0.726008,
            "ten_tile_sample_band_point_reduction_percent": 59.05,
            "ten_tile_sample_contour_point_reduction_percent": 62.93,
            "note": "Final ten-tile sample after TopoJSON quantization; isolated subquantum polygon/line parts can be dropped by encoding and dominate Hausdorff distance. This is not a strict global bound. Detail objects retain full geometry for higher zoom.",
        }
        provenance["coverage_note"] = "Global connected marine coverage from Natural Earth ocean geometry and named seas, plus preserved regional Europe/TNO bathymetry. The new expansion excludes lakes and inland seas; preserved regional features are unchanged."
    provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Build the regional bathymetry asset.")
    parser.add_argument("--reuse-bands", action="store_true", help="Rebuild contours from the existing band geometry without rereading the raster.")
    parser.add_argument("--expand-oceans", action="store_true", help="Expand global marine bathymetry from local raster and ocean masks.")
    parser.add_argument("--pilot", action="store_true", help="With --expand-oceans, build Indian, Southern, and Arctic test tiles under .runtime/tmp.")
    parser.add_argument("--stage-only", action="store_true", help="Stage full expansion under .runtime/tmp for validation before publishing.")
    args = parser.parse_args()
    if args.pilot and not args.expand_oceans:
        parser.error("--pilot requires --expand-oceans")
    if args.stage_only and not args.expand_oceans:
        parser.error("--stage-only requires --expand-oceans")
    if args.expand_oceans:
        if args.reuse_bands:
            parser.error("--expand-oceans and --reuse-bands are separate operations")
        original_payload = json.loads(OUTPUT_TOPOLOGY_PATH.read_text(encoding="utf-8"))
        payload = expand_oceans(original_payload, pilot=args.pilot)
        stage_dir = ROOT / ".runtime" / "tmp" / "bathymetry-global"
        stage_dir.mkdir(parents=True, exist_ok=True)
        stage_topology = stage_dir / ("pilot.topo.json" if args.pilot else "candidate.topo.json")
        stage_provenance = stage_dir / ("pilot.provenance.json" if args.pilot else "candidate.provenance.json")
        write_outputs(
            payload, payload["bbox"],
            len(payload["objects"]["bathymetry_bands"]["geometries"]),
            len(payload["objects"]["bathymetry_contours"]["geometries"]),
            topology_path=stage_topology, provenance_path=stage_provenance,
        )
        json.loads(stage_topology.read_text(encoding="utf-8"))
        print(f"staged {stage_topology} ({stage_topology.stat().st_size} bytes; gzip estimate {len(gzip.compress(stage_topology.read_bytes()))} bytes)", flush=True)
        if not args.pilot and not args.stage_only:
            stage_topology.replace(OUTPUT_TOPOLOGY_PATH)
            stage_provenance.replace(OUTPUT_PROVENANCE_PATH)
            print(f"published {OUTPUT_TOPOLOGY_PATH}", flush=True)
        return
    if OUTPUT_TOPOLOGY_PATH.exists():
        current = json.loads(OUTPUT_TOPOLOGY_PATH.read_text(encoding="utf-8"))
        if "bathymetry_expansion" in current:
            parser.error("Expanded asset exists; use --expand-oceans to regenerate without dropping it")
    water_union = collect_water_mask()
    if args.reuse_bands:
        original_payload = json.loads(OUTPUT_TOPOLOGY_PATH.read_text(encoding="utf-8"))
        band_rows = band_rows_from_topology(original_payload)
        coverage_bounds = json.loads(OUTPUT_PROVENANCE_PATH.read_text(encoding="utf-8"))["coverage_bbox"]
    else:
        raster_data, transform, coverage_bounds = build_subset_raster(water_union)
        band_rows = build_band_rows(raster_data, transform, water_union)
    contour_rows = build_contour_rows(band_rows, water_union)
    payload = (
        replace_contours_preserving_bands(original_payload, contour_rows)
        if args.reuse_bands else build_topology_payload(band_rows, contour_rows)
    )
    ocean_geometry = unary_union(load_feature_collection(EUROPE_OCEAN_PATH).geometry)
    payload["bathymetry_clip_edges"] = build_clip_edges(ocean_geometry, band_rows)
    write_outputs(payload, coverage_bounds, len(band_rows), len(contour_rows))
    print(
        f"Wrote {OUTPUT_TOPOLOGY_PATH} with {len(band_rows)} band features and "
        f"{len(contour_rows)} contour features."
    )


if __name__ == "__main__":
    main()
