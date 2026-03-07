"""Patch detail topology with stable Russia city-level geometries.

Reads a source topology (default: europe_topology.json.bak), injects
Moscow/Saint Petersburg/Volgograd/Arkhangelsk as stable RU city features,
then rebuilds a topology artifact (default: europe_topology.highres.json).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import geopandas as gpd
import pandas as pd
import topojson as tp
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.processors.detail_shell_coverage import repair_shell_coverage
from map_builder.processors.ru_city_overrides import CITY_SPECS, build_ru_city_overrides

DEFAULT_ADMIN1_CANDIDATES = (
    "ne_10m_admin_1_states_provinces.shp",
    "ne_10m_admin_1_states_provinces.geojson",
    "ne_10m_admin_1_states_provinces.json",
    "ne_10m_admin_1_states_provinces.gpkg",
)

LAYER_NAMES = ("political", "special_zones", "ocean", "land", "urban", "physical", "rivers")


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _find_admin1_path(data_dir: Path, explicit_path: Path | None) -> Path:
    if explicit_path:
        if explicit_path.exists():
            return explicit_path
        raise FileNotFoundError(f"Admin1 path not found: {explicit_path}")
    for name in DEFAULT_ADMIN1_CANDIDATES:
        candidate = data_dir / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError("Natural Earth admin1 file not found in data/.")


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


def _apply_city_overrides(
    political: gpd.GeoDataFrame,
    overrides: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    base = political.copy()
    base = _ensure_epsg4326(base)
    base = base[base.geometry.notna() & ~base.geometry.is_empty].copy()

    for col in ("id", "name", "cntr_code"):
        if col not in base.columns:
            base[col] = ""

    base["id"] = base["id"].fillna("").astype(str).str.strip()
    base["name"] = base["name"].fillna("").astype(str).str.strip()
    base["cntr_code"] = base["cntr_code"].fillna("").astype(str).str.upper().str.strip()

    target_ids = set(overrides["id"].astype(str))
    target_names = {str(spec.canonical_name).strip().lower() for spec in CITY_SPECS}

    drop_by_id = base["id"].isin(target_ids)
    drop_by_name = (base["cntr_code"] == "RU") & base["name"].str.lower().isin(target_names)
    cleaned = base[~(drop_by_id | drop_by_name)].copy()

    merged = gpd.GeoDataFrame(
        pd.concat([cleaned, overrides], ignore_index=True),
        crs="EPSG:4326",
    )
    merged = merged[merged.geometry.notna() & ~merged.geometry.is_empty].copy()
    merged["id"] = merged["id"].fillna("").astype(str).str.strip()
    merged = merged[merged["id"] != ""].copy()
    merged = merged.drop_duplicates(subset=["id"], keep="last").reset_index(drop=True)
    return merged


def _assert_city_ids(topology_path: Path) -> None:
    payload = json.loads(topology_path.read_text(encoding="utf-8"))
    geoms = payload.get("objects", {}).get("political", {}).get("geometries", [])
    present = {
        str((geom.get("properties") or {}).get("id", "")).strip()
        for geom in geoms
    }
    required = {spec.stable_id for spec in CITY_SPECS}
    missing = sorted(required - present)
    if missing:
        raise RuntimeError(f"Patched topology missing city IDs: {', '.join(missing)}")


def _build_topology_dict_from_layers(layers: dict[str, gpd.GeoDataFrame]) -> dict:
    object_names: list[str] = []
    object_layers: list[gpd.GeoDataFrame] = []
    for name in LAYER_NAMES:
        gdf = layers.get(name)
        if gdf is None or gdf.empty:
            continue
        object_names.append(name)
        prepared = _ensure_epsg4326(gdf).copy()
        prepared = prepared.fillna("")
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
    parser = argparse.ArgumentParser(description="Inject stable RU city features into detail topology.")
    parser.add_argument(
        "--source-topology",
        type=Path,
        default=Path("data") / "europe_topology.json.bak",
        help="Topology source used as detail base.",
    )
    parser.add_argument(
        "--output-topology",
        type=Path,
        default=Path("data") / "europe_topology.highres.json",
        help="Patched topology output path.",
    )
    parser.add_argument(
        "--ru-adm2",
        type=Path,
        default=Path("data") / cfg.RUS_ADM2_FILENAME,
        help="Russia ADM2 source (geoBoundaries).",
    )
    parser.add_argument(
        "--admin1",
        type=Path,
        default=None,
        help="Optional Natural Earth admin1 source path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_path = args.source_topology
    output_path = args.output_topology
    data_dir = source_path.parent

    print(f"[RU patch] Loading source topology: {source_path}")
    topology_dict = _load_topology(source_path)
    layers = _load_layers_from_topology(topology_dict)
    print(f"[RU patch] Source political features: {len(layers['political'])}")
    primary_topology_path = source_path.with_name("europe_topology.json")
    primary_layers = None
    if primary_topology_path.exists():
        print(f"[RU patch] Loading primary topology shell: {primary_topology_path}")
        primary_topology_dict = _load_topology(primary_topology_path)
        primary_layers = _load_layers_from_topology(primary_topology_dict)

    admin1_path = _find_admin1_path(data_dir, args.admin1)
    ru_adm2_path = args.ru_adm2
    if not ru_adm2_path.exists():
        raise FileNotFoundError(f"RUS ADM2 source not found: {ru_adm2_path}")

    print(f"[RU patch] Reading RU ADM2: {ru_adm2_path}")
    ru_adm2 = _ensure_epsg4326(gpd.read_file(ru_adm2_path))
    print(f"[RU patch] Reading admin1: {admin1_path}")
    admin1 = _ensure_epsg4326(gpd.read_file(admin1_path))

    overrides = build_ru_city_overrides(ru_adm2, admin1, strict=True)
    print(f"[RU patch] Built city overrides: {len(overrides)}")
    print(
        "[RU patch] IDs: "
        + ", ".join(overrides["id"].astype(str).tolist())
    )

    patched_political = _apply_city_overrides(layers["political"], overrides)
    if primary_layers is not None:
        patched_political = repair_shell_coverage(
            patched_political,
            primary_layers["political"],
            log_prefix="[RU patch]",
        )
    print(f"[RU patch] Patched political features: {len(patched_political)}")
    layers["political"] = patched_political

    output_path.parent.mkdir(parents=True, exist_ok=True)
    topology_dict = _build_topology_dict_from_layers(layers)
    _promote_geometry_ids(topology_dict)
    output_path.write_text(
        json.dumps(topology_dict, separators=(",", ":")),
        encoding="utf-8",
    )
    political_count = len(
        topology_dict.get("objects", {}).get("political", {}).get("geometries", [])
    )
    print(f"[RU patch] Output political features: {political_count}")

    _assert_city_ids(output_path)
    print(f"[RU patch] OK: wrote patched detail topology to {output_path}")


if __name__ == "__main__":
    main()
