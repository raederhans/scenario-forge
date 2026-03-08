"""Output writers for the map pipeline."""
from __future__ import annotations

import json
import os
from pathlib import Path

import geopandas as gpd
import matplotlib.pyplot as plt

from map_builder import config as cfg
from map_builder.geo.utils import round_geometries


def save_outputs(
    land: gpd.GeoDataFrame,
    rivers: gpd.GeoDataFrame,
    border_lines: gpd.GeoDataFrame,
    ocean: gpd.GeoDataFrame,
    water_regions: gpd.GeoDataFrame | None,
    land_bg: gpd.GeoDataFrame,
    urban: gpd.GeoDataFrame,
    physical: gpd.GeoDataFrame,
    hybrid: gpd.GeoDataFrame,
    final: gpd.GeoDataFrame,
    output_dir: Path | None = None,
) -> None:
    if output_dir is None:
        output_dir = Path(__file__).resolve().parents[2] / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_path = output_dir / "preview.png"

    land_out = round_geometries(land)
    rivers_out = round_geometries(rivers)
    borders_out = round_geometries(border_lines)
    ocean_out = round_geometries(ocean)
    water_regions_out = round_geometries(water_regions) if water_regions is not None else None
    land_bg_out = round_geometries(land_bg)
    urban_out = round_geometries(urban)
    physical_out = round_geometries(physical)

    print(f"Saving preview image to {preview_path}...")
    fig, ax = plt.subplots(figsize=(8, 8))
    ocean_out.plot(ax=ax, color="#b3d9ff")
    land_bg_out.plot(ax=ax, linewidth=0, color="#e0e0e0")
    if water_regions_out is not None and not water_regions_out.empty:
        water_regions_out.plot(ax=ax, linewidth=0.3, edgecolor="#5f7797", color="#8bc7ff")
    physical_out.plot(ax=ax, linewidth=0.6, edgecolor="#5c4033", facecolor="none")
    urban_out.plot(ax=ax, linewidth=0, color="#333333", alpha=0.2)
    land_out.plot(ax=ax, linewidth=0.3, edgecolor="#999999", color="#d0d0d0")
    borders_out.plot(ax=ax, linewidth=1.2, edgecolor="#000000", facecolor="none")
    rivers_out.plot(ax=ax, linewidth=0.8, color="#3498db")
    ax.set_axis_off()
    fig.savefig(preview_path, dpi=200, bbox_inches="tight")
    plt.close(fig)
