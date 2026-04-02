#!/usr/bin/env python3
"""Build a lightweight modern city-lights asset from NASA Black Marble."""

from __future__ import annotations

import argparse
import math
import sys
import urllib.request
import warnings
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit(
        "Pillow is required to build the city lights asset. "
        "Create a venv and install it with: python3 -m venv .venv && .venv/bin/pip install Pillow"
    ) from exc


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "js" / "core" / "city_lights_modern_asset.js"
DEFAULT_SOURCE_URL = (
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/"
    "144000/144897/BlackMarble_2016_3km_gray.jpg"
)
DEFAULT_GRID_WIDTH = 720
DEFAULT_GRID_HEIGHT = 360
DEFAULT_BASE_THRESHOLD = 2
DEFAULT_CORRIDOR_THRESHOLD = 14


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a modern night-lights asset module from NASA Black Marble."
    )
    parser.add_argument(
        "--source-url",
        default=DEFAULT_SOURCE_URL,
        help="Remote grayscale equirectangular source image URL.",
    )
    parser.add_argument(
        "--source-file",
        default="",
        help="Optional local source image path. If provided, download is skipped.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output JS module path.",
    )
    parser.add_argument(
        "--grid-width",
        type=int,
        default=DEFAULT_GRID_WIDTH,
        help="Output grid width in cells.",
    )
    parser.add_argument(
        "--grid-height",
        type=int,
        default=DEFAULT_GRID_HEIGHT,
        help="Output grid height in cells.",
    )
    parser.add_argument(
        "--base-threshold",
        type=int,
        default=DEFAULT_BASE_THRESHOLD,
        help="Recommended runtime base luminance threshold.",
    )
    parser.add_argument(
        "--corridor-threshold",
        type=int,
        default=DEFAULT_CORRIDOR_THRESHOLD,
        help="Recommended runtime corridor threshold.",
    )
    return parser.parse_args()


def fetch_source_image(source_url: str, source_file: str) -> tuple[Path, str]:
    if source_file:
        source_path = Path(source_file).expanduser().resolve()
        if not source_path.exists():
            raise SystemExit(f"Source file not found: {source_path}")
        return source_path, source_path.as_uri()

    build_cache_dir = PROJECT_ROOT / ".runtime" / "tmp" / "city_lights"
    build_cache_dir.mkdir(parents=True, exist_ok=True)
    target_path = build_cache_dir / Path(source_url).name
    if not target_path.exists():
        with urllib.request.urlopen(source_url, timeout=60) as response:
            target_path.write_bytes(response.read())
    return target_path, source_url


def load_grid_values(source_path: Path, width: int, height: int) -> list[int]:
    warnings.simplefilter("ignore", Image.DecompressionBombWarning)
    Image.MAX_IMAGE_PIXELS = None
    image = Image.open(source_path).convert("L")
    source_width, source_height = image.size
    pixels = image.load()
    values: list[int] = []
    for row in range(height):
        y0 = math.floor((row * source_height) / height)
        y1 = math.floor(((row + 1) * source_height) / height)
        if y1 <= y0:
            y1 = min(source_height, y0 + 1)
        for col in range(width):
            x0 = math.floor((col * source_width) / width)
            x1 = math.floor(((col + 1) * source_width) / width)
            if x1 <= x0:
                x1 = min(source_width, x0 + 1)
            cell_max = 0
            cell_sum = 0
            cell_count = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    pixel_value = int(pixels[x, y])
                    cell_sum += pixel_value
                    cell_count += 1
                    if pixel_value > cell_max:
                        cell_max = pixel_value
            cell_mean = (cell_sum / cell_count) if cell_count else 0
            boosted_value = int(round(min(
                255,
                (cell_max * 0.58)
                + (cell_mean * 0.42)
                + max(0.0, cell_max - cell_mean) * 0.12,
            )))
            if boosted_value < 3 and cell_max < 6:
                boosted_value = 0
            values.append(boosted_value)
    return values


def _percentile(sorted_values: list[int], percentile: float) -> int:
    if not sorted_values:
        return 0
    if len(sorted_values) == 1:
        return int(sorted_values[0])
    index = int(round((len(sorted_values) - 1) * percentile))
    index = max(0, min(len(sorted_values) - 1, index))
    return int(sorted_values[index])


def build_stats(values: list[int]) -> dict[str, float | int]:
    nonzero_values = sorted(value for value in values if value > 0)
    nonzero_count = len(nonzero_values)
    nonzero_mean = (sum(nonzero_values) / nonzero_count) if nonzero_count else 0.0
    p50 = _percentile(nonzero_values, 0.50)
    p90 = _percentile(nonzero_values, 0.90)
    p99 = _percentile(nonzero_values, 0.99)
    return {
        "max": max(values) if values else 0,
        "nonzeroCount": nonzero_count,
        "nonzeroMean": round(nonzero_mean, 4),
        "p50": p50,
        "p90": p90,
        "p99": p99,
        "nonzero_count": nonzero_count,
        "nonzero_mean": round(nonzero_mean, 4),
    }


def format_uint8_array(values: list[int], indent: str = "  ", row_size: int = 32) -> str:
    rows = []
    for start in range(0, len(values), row_size):
        row = ", ".join(str(value) for value in values[start:start + row_size])
        rows.append(f"{indent}{row}")
    return ",\n".join(rows)


def write_module(
    output_path: Path,
    *,
    source_ref: str,
    width: int,
    height: int,
    base_threshold: int,
    corridor_threshold: int,
    values: list[int],
    stats: dict[str, float | int],
) -> None:
    step_lon = 360 / width
    step_lat = 180 / height
    module_text = f"""// Generated by tools/build_city_lights_modern_asset.py
// Source: {source_ref}
// NASA Black Marble 2016 grayscale, resampled into a balanced luminance grid.

export const MODERN_CITY_LIGHTS_SOURCE = Object.freeze({{
  name: "NASA Black Marble 2016 (grayscale)",
  url: {source_ref!r},
}});

export const MODERN_CITY_LIGHTS_GRID_WIDTH = {width};
export const MODERN_CITY_LIGHTS_GRID_HEIGHT = {height};
export const MODERN_CITY_LIGHTS_STEP_LON_DEG = {step_lon:.12g};
export const MODERN_CITY_LIGHTS_STEP_LAT_DEG = {step_lat:.12g};
export const MODERN_CITY_LIGHTS_BASE_THRESHOLD = {base_threshold};
export const MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD = {corridor_threshold};
export const MODERN_CITY_LIGHTS_STATS = Object.freeze({{
  max: {stats["max"]},
  nonzeroCount: {stats["nonzeroCount"]},
  nonzeroMean: {stats["nonzeroMean"]},
  p50: {stats["p50"]},
  p90: {stats["p90"]},
  p99: {stats["p99"]},
  nonzero_count: {stats["nonzero_count"]},
  nonzero_mean: {stats["nonzero_mean"]},
}});
export const MODERN_CITY_LIGHTS_GRID = new Uint8Array([
{format_uint8_array(values)}
]);
"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(module_text, encoding="utf-8")


def main() -> int:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    source_path, source_ref = fetch_source_image(args.source_url, args.source_file)
    values = load_grid_values(source_path, args.grid_width, args.grid_height)
    stats = build_stats(values)
    write_module(
        output_path,
        source_ref=source_ref,
        width=args.grid_width,
        height=args.grid_height,
        base_threshold=args.base_threshold,
        corridor_threshold=args.corridor_threshold,
        values=values,
        stats=stats,
    )
    print(
        f"Built modern city lights asset: {output_path} "
        f"(cells={args.grid_width}x{args.grid_height}, source={source_ref}, "
        f"max={stats['max']}, p90={stats['p90']}, nonzero={stats['nonzeroCount']})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
