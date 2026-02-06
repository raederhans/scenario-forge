"""TopoJSON construction helpers."""
from __future__ import annotations

import json
import math

import geopandas as gpd
import topojson as tp

from map_builder.geo.utils import round_geometries


def build_topology(
    political: gpd.GeoDataFrame,
    ocean: gpd.GeoDataFrame,
    land: gpd.GeoDataFrame,
    urban: gpd.GeoDataFrame,
    physical: gpd.GeoDataFrame,
    rivers: gpd.GeoDataFrame,
    output_path,
    special_zones: gpd.GeoDataFrame | None = None,
    quantization: int = 100_000,
) -> None:
    print("Building TopoJSON topology...")

    def has_valid_bounds(gdf: gpd.GeoDataFrame) -> bool:
        if gdf.empty:
            return False
        bounds = gdf.total_bounds
        if len(bounds) != 4:
            return False
        minx, miny, maxx, maxy = bounds
        if not all(map(math.isfinite, [minx, miny, maxx, maxy])):
            return False
        if maxx - minx <= 0 or maxy - miny <= 0:
            return False
        return True

    def prune_columns(gdf: gpd.GeoDataFrame, layer_name: str) -> gpd.GeoDataFrame:
        if layer_name == "special_zones":
            keep_cols = ["id", "name", "label", "type", "claimants", "cntr_code", "geometry"]
        else:
            # Preserve selected admin context/localized fields when present.
            keep_cols = [
                "id",
                "name",
                "cntr_code",
                "admin1_group",
                "name_local",
                "constituent_country",
                "adm1_name",
                "geometry",
            ]
        existing = [col for col in keep_cols if col in gdf.columns]
        if "geometry" not in existing:
            existing.append("geometry")
        gdf = gdf[existing].copy()
        gdf = gdf.fillna("")
        return gdf

    def scrub_geometry(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        if gdf.empty:
            return gdf
        gdf = gdf[gdf.geometry.notna()]
        gdf = gdf[~gdf.geometry.is_empty]
        if hasattr(gdf.geometry, "is_valid"):
            gdf = gdf[gdf.geometry.is_valid]
        return gdf

    candidates = [("political", political)]
    if special_zones is not None:
        candidates.append(("special_zones", special_zones))
    candidates.extend(
        [
            ("ocean", ocean),
            ("land", land),
            ("urban", urban),
            ("physical", physical),
            ("rivers", rivers),
        ]
    )

    layer_names: list[str] = []
    layer_gdfs: list[gpd.GeoDataFrame] = []
    for name, gdf in candidates:
        gdf = gdf.to_crs("EPSG:4326")
        gdf = prune_columns(gdf, name)
        gdf = scrub_geometry(gdf)
        gdf = round_geometries(gdf)
        if not has_valid_bounds(gdf):
            if name == "political":
                print("Political layer is empty or invalid; cannot build topology.")
                raise SystemExit(1)
            print(f"Skipping empty/invalid layer: {name}")
            continue
        layer_names.append(name)
        layer_gdfs.append(gdf)

    def build_topo(prequantize_value):
        return tp.Topology(
            layer_gdfs,
            object_name=layer_names,
            prequantize=prequantize_value,
            topology=True,
            presimplify=False,
            toposimplify=False,
            shared_coords=True,
        ).to_json()

    try:
        topo_json = build_topo(quantization)
        if "NaN" in topo_json:
            raise ValueError("Generated TopoJSON contains NaN")
    except Exception as exc:
        print(f"TopoJSON build failed with quantization; retrying without quantization: {exc}")
        topo_json = build_topo(False)
        if "NaN" in topo_json:
            raise ValueError("Generated TopoJSON contains NaN")

    output_path.write_text(topo_json, encoding="utf-8")

    try:
        topo_dict = json.loads(topo_json)
        political_obj = topo_dict.get("objects", {}).get("political", {})
        geometries = political_obj.get("geometries", [])
        if geometries:
            sample = geometries[0].get("properties", {})
            missing = [key for key in ("id", "cntr_code") if key not in sample]
            if missing:
                print(f"WARNING: TopoJSON missing properties: {missing}")
        print(f"TopoJSON saved to {output_path}")
        print(f"  - Objects: {list(topo_dict.get('objects', {}).keys())}")
        print(f"  - Total arcs: {len(topo_dict.get('arcs', []))}")
    except Exception as exc:
        print(f"TopoJSON saved to {output_path}")
        print(f"TopoJSON validation skipped: {exc}")
