"""Download authoritative GHSL counts and build the global spatial layer.

Usage: python tools/build_population_spatial.py --download --workers 16
Requires requests, numpy, rasterio, shapely, pyproj and exactextract>=0.3.0.
Source archives and resumable chunks stay under .runtime/source-cache/thematic/ghsl.
"""
from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from map_builder.population_spatial import (build_population_pack, download_source, extract_raster, read_json, source_url)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--resolution", type=int, choices=(1000,), default=1000)
    parser.add_argument("--raster", type=Path)
    parser.add_argument("--source-ledger", type=Path)
    args = parser.parse_args()
    cache = ROOT / ".runtime/source-cache/thematic/ghsl"
    if args.download:
        archive, ledger = download_source(source_url(args.resolution), cache, args.workers, chunk_bytes=262144)
        raster = extract_raster(archive, cache)
    else:
        product = f"GHS_POP_E2020_GLOBE_R2023A_54009_{args.resolution}_V1_0"
        raster = args.raster or cache / (product + ".tif")
        ledger = read_json(args.source_ledger or cache / (product + ".source.json"))
    if not args.download_only:
        build_population_pack(ROOT, raster, ledger, args.resolution)


if __name__ == "__main__":
    main()
