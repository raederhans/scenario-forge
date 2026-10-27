import argparse
import json
import time
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = "data/ETOPO_2022_v1_60s_N90W180_surface.tif"
MARINE_EXTRA_SEEDS = ((34.0, 43.0),)
MAX_DEPTH_M = 11000


def marine_mask(elevation, seeds_rc=()):
    labels, count = ndimage.label(
        np.isfinite(elevation) & (elevation < 0), structure=np.ones((3, 3))
    )
    parent = np.arange(count + 1)

    def find(label):
        while parent[label] != label:
            parent[label] = parent[parent[label]]
            label = parent[label]
        return label

    for left, right in zip(labels[:, 0], labels[:, -1]):
        if left and right:
            parent[find(right)] = find(left)
    roots = np.array([find(label) for label in range(count + 1)])
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    merged_sizes = np.bincount(roots, weights=sizes, minlength=count + 1)
    merged_sizes[0] = 0
    keep = np.zeros(count + 1, dtype=bool)
    if count:
        keep[merged_sizes.argmax()] = True
    for row, col in seeds_rc:
        label = labels[row, col]
        if label:
            keep[roots[label]] = True
    return keep[roots][labels]


def block_mean_depth(depth, ocean, factor):
    height, width = depth.shape
    shape = (height // factor, factor, width // factor, factor)
    counts = ocean.reshape(shape).sum(axis=(1, 3))
    totals = np.where(ocean, depth, 0).reshape(shape).sum(axis=(1, 3), dtype=np.float64)
    mean = np.zeros_like(totals)
    np.divide(totals, counts, out=mean, where=counts > 0)
    return mean, counts > 0


def encode_depth(depth, ocean):
    depth = np.asarray(depth)
    valid = np.asarray(ocean) & np.isfinite(depth)
    values = 1 + np.rint(254 * np.sqrt(np.clip(np.where(valid, depth, 0), 0, MAX_DEPTH_M) / MAX_DEPTH_M))
    return np.where(valid, values, 0).astype(np.uint8)


def decode_depth(values):
    values = np.asarray(values, dtype=np.float64)
    return np.where(values > 0, MAX_DEPTH_M * ((values - 1) / 254) ** 2, 0)


def split_tiles(encoded, tile_pixels=600):
    height, width = encoded.shape
    tiles = {}
    for col in range(width // tile_pixels):
        for row in range(height // tile_pixels):
            tile = encoded[row * tile_pixels:(row + 1) * tile_pixels,
                           col * tile_pixels:(col + 1) * tile_pixels]
            if np.any(tile):
                tiles[f"{col}_{row}"] = tile
    return tiles


def write_png(path, values):
    Image.fromarray(values).save(path, optimize=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-raster", type=Path, default=ROOT / SOURCE_PATH)
    args = parser.parse_args()
    started = time.perf_counter()
    with rasterio.open(args.source_raster) as source:
        elevation = source.read(1, masked=True).filled(np.nan)
        seeds_rc = [source.index(lon, lat) for lon, lat in MARINE_EXTRA_SEEDS]
    ocean = marine_mask(elevation, seeds_rc)
    depth = np.where(ocean, -elevation, 0)
    del elevation
    output = ROOT / "data/bathymetry/global"
    tile_dir = output / "tiles"
    tile_dir.mkdir(parents=True, exist_ok=True)
    overview = encode_depth(*block_mean_depth(depth, ocean, 5))
    write_png(output / "overview.png", overview)
    encoded = encode_depth(*block_mean_depth(depth, ocean, 2))
    tiles = split_tiles(encoded)
    for path in tile_dir.glob("*.png"):
        if path.stem not in tiles:
            path.unlink()
    for name, tile in tiles.items():
        write_png(tile_dir / f"{name}.png", tile)
    stats = {
        "overview_bytes": (output / "overview.png").stat().st_size,
        "tiles_bytes": sum((tile_dir / f"{name}.png").stat().st_size for name in tiles),
        "tile_count": len(tiles),
    }
    manifest = {
        "version": 1,
        "kind": "bathymetry_depth_texture",
        "bounds": [-180, -90, 180, 90],
        "registration": "area",
        "encoding": {"type": "sqrt", "max_depth_m": MAX_DEPTH_M, "land_value": 0,
                     "min_ocean_value": 1, "max_value": 255},
        "overview": {"url": "data/bathymetry/global/overview.png", "width": 4320, "height": 2160},
        "tiles": {"url_template": "data/bathymetry/global/tiles/{col}_{row}.png",
                  "tile_degrees": 20, "tile_pixels": 600, "cols": 18, "rows": 9,
                  "present": list(tiles)},
        "source": {"name": "ETOPO 2022", "path": SOURCE_PATH, "resolution_arcsec": 60,
                   "license_note": "NOAA public domain relief model"},
        "marine_extra_seeds": MARINE_EXTRA_SEEDS,
        "stats": stats,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({**stats, "elapsed_seconds": time.perf_counter() - started}))


if __name__ == "__main__":
    main()
