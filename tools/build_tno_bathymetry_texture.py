import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import bounds as geometry_bounds, rasterize
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from scipy import ndimage, sparse
from scipy.sparse.linalg import cg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.build_bathymetry_texture import encode_depth, write_png
from tools.scenario_topology_decode import topology_object_to_geojson

SOURCE_PATH = "data/ETOPO_2022_v1_60s_N90W180_surface.tif"
GEOMETRY_PATH = "data/scenarios/tno_1962/scenario_atlantropa.topo.json"
OUTPUT_PATH = "data/scenarios/tno_1962/bathymetry_texture"
RESOLUTION = 1 / 60
PADDING_DEGREES = 0.5
KM_PER_ARCMIN = 1.853
D_WEST = 100
D_EAST = 200
SPLIT_LON = 11.0
CORRECTION_LENGTH_KM = 15
COAST_DEPTH_M = 5
FLOOR_BASE_M = 4
FLOOR_PER_KM = 1.2
FLOOR_MAX_M = 60
FLOOR_SMOOTH_SIGMA_PX = 4
SMOOTH_SIGMA_PX = 1


def assign_basin_drops(water_mask, longitudes):
    labels, count = ndimage.label(water_mask, structure=np.ones((3, 3)))
    longitude_grid = np.broadcast_to(longitudes, water_mask.shape)
    drops = np.zeros(water_mask.shape, dtype=np.float32)
    for label, window in enumerate(ndimage.find_objects(labels), start=1):
        component = labels[window] == label
        median_lon = np.median(longitude_grid[window][component])
        drops[window][component] = D_WEST if median_lon < SPLIT_LON else D_EAST
    return drops, count


def screened_poisson_correction(raw_depth, water_mask, latitudes):
    rows, cols = np.nonzero(water_mask)
    count = len(rows)
    indices = np.full(water_mask.shape, -1, dtype=np.int64)
    indices[water_mask] = np.arange(count)
    dx = KM_PER_ARCMIN * np.cos(np.deg2rad(latitudes))
    horizontal = 1 / dx[rows] ** 2
    vertical = np.full(count, 1 / KM_PER_ARCMIN ** 2)
    diagonal = 2 * horizontal + 2 * vertical + 1 / CORRECTION_LENGTH_KM ** 2
    boundary = COAST_DEPTH_M - raw_depth[water_mask]
    rhs = np.zeros(count)
    matrix_rows = [np.arange(count)]
    matrix_cols = [np.arange(count)]
    matrix_values = [diagonal]
    for dr, dc, weight in ((0, -1, horizontal), (0, 1, horizontal),
                           (-1, 0, vertical), (1, 0, vertical)):
        neighbor_rows, neighbor_cols = rows + dr, cols + dc
        inside = ((neighbor_rows >= 0) & (neighbor_rows < water_mask.shape[0]) &
                  (neighbor_cols >= 0) & (neighbor_cols < water_mask.shape[1]))
        neighbors = np.full(count, -1, dtype=np.int64)
        neighbors[inside] = indices[neighbor_rows[inside], neighbor_cols[inside]]
        connected = neighbors >= 0
        matrix_rows.append(np.flatnonzero(connected))
        matrix_cols.append(neighbors[connected])
        matrix_values.append(-weight[connected])
        rhs[~connected] += weight[~connected] * boundary[~connected]
    matrix = sparse.coo_matrix(
        (np.concatenate(matrix_values),
         (np.concatenate(matrix_rows), np.concatenate(matrix_cols))),
        shape=(count, count)).tocsr()
    solution, info = cg(matrix, rhs, M=sparse.diags(1 / diagonal), rtol=1e-6)
    if info != 0:
        raise RuntimeError(f"Screened Poisson solver did not converge: {info}")
    correction = np.zeros(water_mask.shape)
    correction[water_mask] = solution
    return correction


def floor_limit(distance_km):
    return np.minimum(FLOOR_BASE_M + FLOOR_PER_KM * distance_km, FLOOR_MAX_M)


def masked_gaussian(depth, water_mask, sigma=SMOOTH_SIGMA_PX):
    weights = ndimage.gaussian_filter(water_mask.astype(float), sigma=sigma)
    totals = ndimage.gaussian_filter(np.where(water_mask, depth, 0.0), sigma=sigma)
    result = np.zeros_like(totals)
    np.divide(totals, weights, out=result, where=water_mask)
    return result


def encode_overlay(depth, water_mask, land_mask):
    encoded = encode_depth(depth, water_mask)
    encoded[land_mask & ~water_mask] = 1
    return encoded


def build_depth(elevation, water_mask, longitudes, latitudes):
    drops, count = assign_basin_drops(water_mask, longitudes)
    distance = ndimage.distance_transform_edt(
        water_mask, sampling=(KM_PER_ARCMIN,
                              KM_PER_ARCMIN * np.cos(np.deg2rad(np.mean(latitudes)))))
    raw = -elevation - drops
    correction = screened_poisson_correction(raw, water_mask, latitudes)
    corrected = raw + correction
    floor = masked_gaussian(floor_limit(distance), water_mask, sigma=FLOOR_SMOOTH_SIGMA_PX)
    depth = masked_gaussian(np.maximum(np.maximum(corrected, floor), 0), water_mask)
    stats = {
        "water_px": int(water_mask.sum()),
        "components": count,
        "west_px": int(np.count_nonzero(drops == D_WEST)),
        "east_px": int(np.count_nonzero(drops == D_EAST)),
        "floor_limited_ratio": float(np.mean((corrected < floor)[water_mask])),
        "mean_abs_correction_m": float(np.mean(np.abs(correction[water_mask]))),
        "corrected_ratio": float(np.mean(np.abs(correction[water_mask]) > 50)),
        "max_depth_m": float(depth[water_mask].max()),
    }
    return depth, stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-raster", type=Path, default=ROOT / SOURCE_PATH)
    args = parser.parse_args()
    started = time.perf_counter()
    topology = json.loads((ROOT / GEOMETRY_PATH).read_text(encoding="utf-8"))
    features = topology_object_to_geojson(topology, "scenario_atlantropa")["features"]
    water = [f["geometry"] for f in features if f["properties"]["atl_render_layer"] == "water"]
    land = [f["geometry"] for f in features if f["properties"]["atl_render_layer"] in ("land", "shoal")]
    extents = np.array([geometry_bounds(geometry) for geometry in water])
    west, south = np.floor((extents[:, :2].min(axis=0) - PADDING_DEGREES) / RESOLUTION).astype(int)
    east, north = np.ceil((extents[:, 2:].max(axis=0) + PADDING_DEGREES) / RESOLUTION).astype(int)
    width, height = int(east - west), int(north - south)
    bounds = [float(value * RESOLUTION) for value in (west, south, east, north)]
    transform = from_origin(bounds[0], bounds[3], RESOLUTION, RESOLUTION)
    land_mask = rasterize(land, out_shape=(height, width), transform=transform,
                          all_touched=False).astype(bool)
    water_mask = rasterize(water, out_shape=(height, width), transform=transform,
                           all_touched=False).astype(bool) & ~land_mask
    with rasterio.open(args.source_raster) as source:
        elevation = source.read(1, window=from_bounds(*bounds, source.transform),
                                out_shape=(height, width), out_dtype="float32")
    longitudes = bounds[0] + (np.arange(width) + 0.5) * RESOLUTION
    latitudes = bounds[3] - (np.arange(height) + 0.5) * RESOLUTION
    depth, stats = build_depth(elevation, water_mask, longitudes, latitudes)
    output = ROOT / OUTPUT_PATH
    output.mkdir(parents=True, exist_ok=True)
    write_png(output / "overlay.png", encode_overlay(depth, water_mask, land_mask))
    global_manifest = json.loads((ROOT / "data/bathymetry/global/manifest.json").read_text(encoding="utf-8"))
    manifest = {
        "version": 1,
        "kind": "bathymetry_depth_overlay",
        "bounds": bounds,
        "registration": "area",
        "encoding": global_manifest["encoding"],
        "overlay": {"url": OUTPUT_PATH + "/overlay.png", "width": width, "height": height},
        "coverage_value_semantics": "0 = fall back to global; 1..255 = scenario depth (exposed land encoded as 1)",
        "basins": {"west": {"drop_m": D_WEST, "split_lon": SPLIT_LON}, "east": {"drop_m": D_EAST}},
        "constraints": {"correction": {"type": "screened_poisson",
                                       "length_km": CORRECTION_LENGTH_KM,
                                       "coast_depth_m": COAST_DEPTH_M},
                        "floor": {"base_m": FLOOR_BASE_M, "per_km": FLOOR_PER_KM,
                                  "max_m": FLOOR_MAX_M, "smooth_sigma_px": FLOOR_SMOOTH_SIGMA_PX},
                        "smooth_sigma_px": SMOOTH_SIGMA_PX},
        "source": {"geometry": GEOMETRY_PATH + "#scenario_atlantropa", "relief": SOURCE_PATH},
        "stats": stats,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"width": width, "height": height,
                      "bytes": (output / "overlay.png").stat().st_size,
                      "stats": stats, "elapsed_seconds": time.perf_counter() - started}))


if __name__ == "__main__":
    main()
