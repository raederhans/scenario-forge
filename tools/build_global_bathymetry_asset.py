import json
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
from shapely.ops import unary_union
from topojson import Topology


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SOURCE_RASTER_PATH = DATA_DIR / "ETOPO_2022_v1_60s_N90W180_surface.tif"
EUROPE_OCEAN_PATH = DATA_DIR / "europe_ocean.geojson"
WATER_REGIONS_PATH = DATA_DIR / "water_regions.geojson"
OUTPUT_TOPOLOGY_PATH = DATA_DIR / "global_bathymetry.topo.json"
OUTPUT_PROVENANCE_PATH = DATA_DIR / "global_bathymetry.provenance.json"

DEPTH_BANDS = (
    (0, -50),
    (-50, -100),
    (-100, -200),
    (-200, -500),
    (-500, -1000),
    (-1000, -2000),
    (-2000, -4000),
    (-4000, -6000),
)
CONTOUR_DEPTHS = (-100, -200, -500, -1000, -2000, -4000)
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
        depth_geoms = [row["geometry"] for row in band_rows if row["depth_max_m"] <= depth]
        if not depth_geoms:
            continue
        merged = normalize_polygonal(unary_union(depth_geoms))
        if merged is None:
            continue
        contour = normalize_linear(merged.boundary.difference(coastline_buffer))
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
    band_gdf = gpd.GeoDataFrame(band_rows, geometry="geometry", crs="EPSG:4326")
    contour_gdf = gpd.GeoDataFrame(contour_rows, geometry="geometry", crs="EPSG:4326")
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


def write_outputs(payload, coverage_bounds, band_count, contour_count):
    OUTPUT_TOPOLOGY_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    provenance = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "asset_path": str(OUTPUT_TOPOLOGY_PATH.relative_to(ROOT)).replace("\\", "/"),
        "coverage_bbox": [round(value, 4) for value in coverage_bounds],
        "band_thresholds_m": [list(item) for item in DEPTH_BANDS],
        "contour_thresholds_m": list(CONTOUR_DEPTHS),
        "band_feature_count": int(band_count),
        "contour_feature_count": int(contour_count),
        "source": {
            "name": "ETOPO 2022",
            "version": "2022 v1 60s local cache",
            "path": str(SOURCE_RASTER_PATH.relative_to(ROOT)).replace("\\", "/"),
            "license_note": "Publicly available NOAA relief model used as the local raster source for this generated asset.",
        },
        "water_mask_sources": [
            str(EUROPE_OCEAN_PATH.relative_to(ROOT)).replace("\\", "/"),
            str(WATER_REGIONS_PATH.relative_to(ROOT)).replace("\\", "/"),
        ],
        "coverage_note": "Europe/TNO-focused bathymetry asset for current map extent; excludes lakes from the global ocean bathymetry layer.",
    }
    OUTPUT_PROVENANCE_PATH.write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    water_union = collect_water_mask()
    raster_data, transform, coverage_bounds = build_subset_raster(water_union)
    band_rows = build_band_rows(raster_data, transform, water_union)
    contour_rows = build_contour_rows(band_rows, water_union)
    payload = build_topology_payload(band_rows, contour_rows)
    write_outputs(payload, coverage_bounds, len(band_rows), len(contour_rows))
    print(
        f"Wrote {OUTPUT_TOPOLOGY_PATH} with {len(band_rows)} band features and "
        f"{len(contour_rows)} contour features."
    )


if __name__ == "__main__":
    main()
