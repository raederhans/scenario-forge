"""Build the default enriched detail topology artifact."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import geopandas as gpd
import topojson as tp
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.processors.africa_admin1 import apply_africa_admin1_replacement
from map_builder.processors.global_basic_admin1 import apply_global_basic_admin1_replacement
from map_builder.processors.north_america import apply_north_america_replacement

LAYER_NAMES = ("political", "special_zones", "ocean", "land", "urban", "physical", "rivers")


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _load_topology(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Topology not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _topology_object_to_gdf(topo_dict: dict, object_name: str) -> gpd.GeoDataFrame:
    source = topo_dict.get("objects", {})
    if object_name not in source:
        return _empty_gdf()
    try:
        feature_collection = serialize_as_geojson(topo_dict, objectname=object_name)
    except Exception:
        return _empty_gdf()
    if not isinstance(feature_collection, dict) or not feature_collection.get("features"):
        return _empty_gdf()
    gdf = serialize_as_geodataframe(feature_collection)
    if gdf.empty:
        return _empty_gdf()
    return _ensure_epsg4326(gdf)


def _load_layers_from_topology(topology_dict: dict) -> dict[str, gpd.GeoDataFrame]:
    layers: dict[str, gpd.GeoDataFrame] = {}
    for layer_name in LAYER_NAMES:
        layers[layer_name] = _topology_object_to_gdf(topology_dict, layer_name)
    if layers["political"].empty:
        raise ValueError("Source topology has no political layer to patch.")
    return layers


def _build_topology_dict_from_layers(layers: dict[str, gpd.GeoDataFrame]) -> dict:
    object_names: list[str] = []
    object_layers: list[gpd.GeoDataFrame] = []
    for name in LAYER_NAMES:
        gdf = layers.get(name)
        if gdf is None or gdf.empty:
            continue
        object_names.append(name)
        prepared = _ensure_epsg4326(gdf).copy().fillna("")
        object_layers.append(prepared)

    if "political" not in object_names:
        raise ValueError("Patched layers missing political object.")

    topology = tp.Topology(
        object_layers,
        object_name=object_names,
        prequantize=cfg.TOPOLOGY_QUANTIZATION,
        topology=True,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    ).to_dict()
    return topology


def _promote_geometry_ids(topology_dict: dict) -> None:
    objects = topology_dict.get("objects", {})
    if not isinstance(objects, dict):
        return
    for object_name, obj in objects.items():
        geometries = obj.get("geometries", [])
        seen: set[str] = set()
        for index, geom in enumerate(geometries):
            props = geom.get("properties")
            if not isinstance(props, dict):
                props = {}
                geom["properties"] = props

            preferred = str(props.get("id", "")).strip()
            candidate = preferred or str(geom.get("id", "")).strip() or f"{object_name}-{index}"
            if candidate in seen:
                candidate = f"{candidate}__dup{index}"
            seen.add(candidate)
            geom["id"] = candidate
            if preferred and "id" not in props:
                props["id"] = preferred


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the enriched detail topology bundle.")
    parser.add_argument(
        "--source-topology",
        type=Path,
        default=Path("data") / "europe_topology.highres.json",
        help="Topology source used as detail base.",
    )
    parser.add_argument(
        "--output-topology",
        type=Path,
        default=Path("data") / "europe_topology.na_v2.json",
        help="Patched topology output path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = args.source_topology
    output_path = args.output_topology

    print(f"[Detail patch] Loading source topology: {source_path}")
    topology_dict = _load_topology(source_path)
    layers = _load_layers_from_topology(topology_dict)
    print(f"[Detail patch] Source political features: {len(layers['political'])}")

    patched_political = apply_north_america_replacement(layers["political"])
    patched_political = apply_africa_admin1_replacement(patched_political)
    patched_political = apply_global_basic_admin1_replacement(patched_political)
    layers["political"] = patched_political
    print(f"[Detail patch] Patched political features: {len(patched_political)}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    out_dict = _build_topology_dict_from_layers(layers)
    _promote_geometry_ids(out_dict)
    output_path.write_text(
        json.dumps(out_dict, separators=(",", ":")),
        encoding="utf-8",
    )
    count = len(out_dict.get("objects", {}).get("political", {}).get("geometries", []))
    print(f"[Detail patch] Output political features: {count}")
    print(f"[Detail patch] OK: wrote {output_path}")


if __name__ == "__main__":
    main()
