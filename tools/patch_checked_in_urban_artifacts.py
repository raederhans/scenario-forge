"""Repair checked-in urban GeoJSON against runtime political feature ids."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import geopandas as gpd
from shapely.errors import GEOSException
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

from map_builder.cities import assign_stable_urban_area_ids
from map_builder.geo.topology import _repair_geometry
from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_geojson_atomic

OWNER_FALLBACK_MAX_DISTANCE_M = 40_000.0


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _normalize_polygon_frame(gdf: gpd.GeoDataFrame | None) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty:
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    out = _ensure_epsg4326(gdf.copy())
    out["geometry"] = out.geometry.apply(_repair_geometry)
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    return out


def load_political_shell_from_topology(path: Path) -> gpd.GeoDataFrame:
    payload = read_json_strict(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, found {type(payload).__name__}.")
    feature_collection = serialize_as_geojson(payload, objectname="political")
    if not isinstance(feature_collection, dict) or not feature_collection.get("features"):
        raise ValueError(f"Political layer missing in {path}.")
    gdf = serialize_as_geodataframe(feature_collection)
    return _ensure_epsg4326(gdf)


def load_runtime_political_owner_shell(data_dir: Path) -> gpd.GeoDataFrame:
    runtime_topology_path = data_dir / "europe_topology.runtime_political_v1.json"
    if not runtime_topology_path.exists():
        raise FileNotFoundError(f"Runtime political topology not found: {runtime_topology_path}")
    return load_political_shell_from_topology(runtime_topology_path)


def _repair_for_intersection(geom):
    repaired = _repair_geometry(geom)
    if repaired is None or repaired.is_empty:
        return None
    return repaired


def _safe_overlap_area(geom_a, geom_b) -> float:
    if geom_a is None or geom_b is None or geom_a.is_empty or geom_b.is_empty:
        return 0.0
    try:
        overlap = geom_a.intersection(geom_b)
    except GEOSException:
        geom_a = _repair_for_intersection(geom_a)
        geom_b = _repair_for_intersection(geom_b)
        if geom_a is None or geom_b is None:
            return 0.0
        try:
            overlap = geom_a.intersection(geom_b)
        except GEOSException:
            return 0.0
    if overlap is None or overlap.is_empty:
        return 0.0
    return float(overlap.area or 0.0)


def rebuild_urban_layer(
    urban_gdf: gpd.GeoDataFrame,
    political_owner_shell: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    urban = _normalize_polygon_frame(urban_gdf)
    if urban.empty:
        return urban
    urban = assign_stable_urban_area_ids(urban)
    for column in ("country_owner_id", "country_owner_code", "country_owner_method"):
        if column not in urban.columns:
            urban[column] = ""
        urban[column] = urban[column].fillna("").astype(str)

    political = _normalize_polygon_frame(political_owner_shell)
    if political.empty:
        raise ValueError("Political owner shell is empty; cannot rebuild urban owner metadata.")
    for column in ("id", "cntr_code"):
        if column not in political.columns:
            political[column] = ""
    political["id"] = political["id"].fillna("").astype(str).str.strip()
    political["cntr_code"] = political["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    political = political[political["id"] != ""].copy()
    if political.empty:
        raise ValueError("Political owner shell has no stable ids; cannot rebuild urban owner metadata.")

    urban_projected = urban.to_crs("EPSG:6933")
    political_projected = political.to_crs("EPSG:6933")
    urban_projected["geometry"] = urban_projected.geometry.apply(_repair_for_intersection)
    political_projected["geometry"] = political_projected.geometry.apply(_repair_for_intersection)
    urban_projected = urban_projected[urban_projected.geometry.notna() & ~urban_projected.geometry.is_empty].copy()
    political_projected = political_projected[
        political_projected.geometry.notna() & ~political_projected.geometry.is_empty
    ].copy()
    political_sindex = political_projected.sindex

    for urban_idx, urban_row in urban_projected.iterrows():
        geom = urban_row.geometry
        if geom is None or geom.is_empty:
            continue
        candidate_positions = list(political_sindex.query(geom, predicate="intersects"))
        best_owner_id = ""
        best_owner_code = ""
        best_area = 0.0
        for candidate_position in candidate_positions:
            candidate = political_projected.iloc[int(candidate_position)]
            overlap_area = _safe_overlap_area(geom, candidate.geometry)
            if overlap_area <= best_area:
                continue
            best_area = overlap_area
            best_owner_id = str(candidate.get("id") or "").strip()
            best_owner_code = str(candidate.get("cntr_code") or "").strip().upper()
        if not best_owner_id:
            centroid = geom.centroid
            distances = political_projected.distance(centroid)
            if not distances.empty:
                nearest_index = distances.sort_values().index[0]
                nearest_distance_m = float(distances.loc[nearest_index])
                if nearest_distance_m <= OWNER_FALLBACK_MAX_DISTANCE_M:
                    nearest = political_projected.loc[nearest_index]
                    best_owner_id = str(nearest.get("id") or "").strip()
                    best_owner_code = str(nearest.get("cntr_code") or "").strip().upper()
                    urban.loc[urban_idx, "country_owner_method"] = "nearest_gap_fallback"
        if not best_owner_id:
            continue
        urban.loc[urban_idx, "country_owner_id"] = best_owner_id
        urban.loc[urban_idx, "country_owner_code"] = best_owner_code
        if not str(urban.loc[urban_idx, "country_owner_method"]).strip():
            urban.loc[urban_idx, "country_owner_method"] = "max_overlap"

    missing_id_count = int((urban["id"].fillna("").astype(str).str.strip() == "").sum())
    missing_owner_count = int((urban["country_owner_id"].fillna("").astype(str).str.strip() == "").sum())
    if missing_id_count or missing_owner_count:
        raise ValueError(
            "Urban layer rebuild incomplete: "
            f"missing id={missing_id_count}, missing country_owner_id={missing_owner_count}"
        )
    return urban


def refresh_manifest(data_dir: Path) -> None:
    from init_map_data import write_data_manifest

    write_data_manifest(data_dir)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Patch checked-in urban artifacts against runtime political feature ids.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("data"),
        help="Data directory containing checked-in urban/topology artifacts.",
    )
    parser.add_argument(
        "--skip-manifest",
        action="store_true",
        help="Skip manifest refresh after patching files.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data_dir = args.data_dir
    owner_shell = load_runtime_political_owner_shell(data_dir)

    urban_geojson_path = data_dir / "europe_urban.geojson"
    if not urban_geojson_path.exists():
        raise FileNotFoundError(f"Urban GeoJSON not found: {urban_geojson_path}")
    rebuilt_external_urban = rebuild_urban_layer(gpd.read_file(urban_geojson_path), owner_shell)
    write_geojson_atomic(urban_geojson_path, rebuilt_external_urban)

    if not args.skip_manifest:
        refresh_manifest(data_dir)

    print("[Urban patch] OK: europe_urban.geojson repaired against runtime political feature ids.")


if __name__ == "__main__":
    main()
