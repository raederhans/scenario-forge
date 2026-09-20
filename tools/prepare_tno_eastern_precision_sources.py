import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import geopandas as gpd
import pandas as pd
import shapely
from shapely.ops import unary_union

from map_builder.processors.belarus import CITY_OF_MINSK_NAME, HISTORICAL_GROUPS, INTERIOR_GROUP_IDS
from map_builder.regional_geometry import _absolute_topology, _decode_geometry

def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def _load_provenance(path: Path) -> dict:
    prov_path = path.with_name(path.name.replace(".geojson", ".provenance.json"))
    if prov_path.exists():
        with open(prov_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def _check_validity(gdf: gpd.GeoDataFrame, name: str):
    if gdf.empty:
        raise ValueError(f"CRITICAL: {name} source is empty.")

    geom = gdf.geometry
    if geom.isna().any():
        raise ValueError(f"CRITICAL: {name} contains null geometries.")

    empty_mask = geom.is_empty
    if empty_mask.any():
        raise ValueError(f"CRITICAL: {name} contains empty geometries.")

    invalid_mask = ~geom.is_valid
    if invalid_mask.any():
        raise ValueError(f"CRITICAL: {name} contains invalid geometries.")

    non_polygon = ~geom.geom_type.isin(["Polygon", "MultiPolygon"])
    if non_polygon.any():
        raise ValueError(f"CRITICAL: {name} contains non-polygon geometries.")

def _check_coverage(geometries, name: str):
    if not shapely.coverage_is_valid(geometries):
        raise ValueError(f"CRITICAL: {name} coverage is invalid.")

def _ensure_epsg4326(gdf: gpd.GeoDataFrame, name: str) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        raise ValueError(f"CRITICAL: {name} has no CRS.")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf

def process_poland(source_path: Path, baseline_pl: set) -> tuple[gpd.GeoDataFrame, dict]:
    pl = gpd.read_file(source_path)
    _check_validity(pl, "Poland")
    pl = _ensure_epsg4326(pl, "Poland")

    raw_coords = shapely.get_num_coordinates(pl.geometry).sum()

    if "terc" not in pl.columns:
        raise ValueError("CRITICAL: Poland source missing terc column.")

    if pl["terc"].isna().any():
        raise ValueError("Poland source contains null terc values")
    pl["terc"] = pl["terc"].astype(str).str.strip()
    if (pl["terc"] == "").any():
        raise ValueError("CRITICAL: Poland source contains empty terc values.")
    if pl["terc"].duplicated().any():
        raise ValueError("CRITICAL: Poland source contains duplicate terc values.")

    pl["id"] = "PL_POW_" + pl["terc"]
    pl["cntr_code"] = "PL"

    all_raw_ids = set(pl["id"])
    excluded_ids = all_raw_ids - baseline_pl
    pl = pl[pl["id"].isin(baseline_pl)].copy()

    pl_missing = baseline_pl - set(pl["id"])
    if pl_missing:
        raise ValueError(f"CRITICAL: Missing PL IDs from baseline: {pl_missing}")
    if pl.empty:
        raise ValueError("CRITICAL: Output for PL is empty.")
    if pl["id"].duplicated().any():
        raise ValueError("CRITICAL: Duplicate IDs in Poland output.")

    _check_coverage(pl.geometry.tolist(), "Poland")

    output_coords = shapely.get_num_coordinates(pl.geometry).sum()

    membership = {row["id"]: [str(row["terc"])] for _, row in pl.iterrows()}

    return pl[["id", "cntr_code", "geometry"]], {
        "features": len(pl),
        "raw_coordinates": int(raw_coords),
        "output_coordinates": int(output_coords),
        "membership": membership,
        "excluded_raw_ids": sorted(excluded_ids),
        "source_path": str(source_path.resolve()),
        "hash": _file_sha256(source_path),
        "provenance": _load_provenance(source_path)
    }

def process_ukraine(source_path: Path, baseline_ua: set) -> tuple[gpd.GeoDataFrame, dict]:
    ua = gpd.read_file(source_path)
    _check_validity(ua, "Ukraine")
    ua = _ensure_epsg4326(ua, "Ukraine")

    raw_coords = shapely.get_num_coordinates(ua.geometry).sum()

    if "shapeID" not in ua.columns:
        raise ValueError("CRITICAL: Ukraine source missing shapeID column.")

    if ua["shapeID"].isna().any():
        raise ValueError("Ukraine source contains null shapeID values")
    ua["shapeID"] = ua["shapeID"].astype(str).str.strip()
    if (ua["shapeID"] == "").any():
        raise ValueError("CRITICAL: Ukraine source contains empty shapeID values.")
    if ua["shapeID"].duplicated().any():
        raise ValueError("CRITICAL: Ukraine source contains duplicate shapeIDs.")

    ua["id"] = "UA_RAY_" + ua["shapeID"]
    ua["cntr_code"] = "UA"

    all_raw_ids = set(ua["id"])
    excluded_ids = all_raw_ids - baseline_ua
    ua = ua[ua["id"].isin(baseline_ua)].copy()

    ua_missing = baseline_ua - set(ua["id"])
    if ua_missing:
        raise ValueError(f"CRITICAL: Missing UA IDs from baseline: {ua_missing}")
    if ua.empty:
        raise ValueError("CRITICAL: Output for UA is empty.")
    if ua["id"].duplicated().any():
        raise ValueError("CRITICAL: Duplicate IDs in Ukraine output.")

    _check_coverage(ua.geometry.tolist(), "Ukraine")

    output_coords = shapely.get_num_coordinates(ua.geometry).sum()

    membership = {row["id"]: [str(row["shapeID"])] for _, row in ua.iterrows()}

    return ua[["id", "cntr_code", "geometry"]], {
        "features": len(ua),
        "raw_coordinates": int(raw_coords),
        "output_coordinates": int(output_coords),
        "membership": membership,
        "excluded_raw_ids": sorted(excluded_ids),
        "source_path": str(source_path.resolve()),
        "hash": _file_sha256(source_path),
        "provenance": _load_provenance(source_path)
    }

def process_belarus(source_path: Path, coarse_path: Path, baseline_by: set) -> tuple[gpd.GeoDataFrame, dict]:
    by = gpd.read_file(source_path)
    _check_validity(by, "Belarus")
    by = _ensure_epsg4326(by, "Belarus")

    raw_coords = shapely.get_num_coordinates(by.geometry).sum()

    if "shapeID" not in by.columns or "shapeName" not in by.columns:
        raise ValueError("CRITICAL: Belarus source missing shapeID/shapeName columns.")

    if by["shapeID"].isna().any():
        raise ValueError("Belarus source contains null shapeID values")
    by["shapeID"] = by["shapeID"].astype(str).str.strip()
    if (by["shapeID"] == "").any():
        raise ValueError("CRITICAL: Belarus source contains empty shapeID values.")
    if by["shapeID"].duplicated().any():
        raise ValueError("CRITICAL: Belarus source contains duplicate shapeIDs.")

    all_raw_ids = set(by["shapeID"])

    exclude_shape_id = "67162791B52564132020414"
    krasnapolle_fid = f"BY_RAY_{exclude_shape_id}"
    if krasnapolle_fid in baseline_by:
        raise ValueError(f"CRITICAL: Krasnapolle ({krasnapolle_fid}) is in the baseline! Cannot safely exclude.")

    by_active = by[by["shapeID"] != exclude_shape_id].copy()
    excluded_ids = all_raw_ids - set(by_active["shapeID"])
    if exclude_shape_id not in excluded_ids:
        raise ValueError("CRITICAL: Krasnapolle ID not found in source, nothing was excluded!")

    try:
        coarse = gpd.read_file(coarse_path, layer="political")
    except Exception:
        coarse = gpd.read_file(coarse_path)

    if coarse.crs is None:
        coarse.set_crs("EPSG:4326", inplace=True)
    elif coarse.crs.to_epsg() != 4326:
        coarse = coarse.to_crs("EPSG:4326")

    coarse = coarse[coarse["cntr_code"] == "BY"].copy()
    _check_validity(coarse, "Belarus Coarse")

    rep_points = by_active.copy()
    rep_points["geometry"] = rep_points.geometry.representative_point()

    joined = gpd.sjoin(rep_points, coarse[["name", "geometry"]], how="left", predicate="within")

    if joined.index.duplicated().any():
        raise ValueError("CRITICAL: sjoin matched multiple coarse oblasts for a single source index.")
    if joined["name"].isna().any():
        raise ValueError("CRITICAL: sjoin failed to find an oblast match for one or more source shapes.")

    by_active["oblast_name"] = joined["name"].astype(str)

    outputs = []
    consumed_ids = set()
    membership = {}

    def _add_feature(fid, rows):
        if rows.empty:
            raise ValueError(f"CRITICAL: No rows provided for feature {fid}.")
        ids_to_consume = rows["shapeID"].tolist()
        overlap = consumed_ids.intersection(ids_to_consume)
        if overlap:
            raise ValueError(f"CRITICAL: Duplicate consumption of shapeIDs {overlap} for feature {fid}.")

        outputs.append({
            "id": fid,
            "cntr_code": "BY",
            "geometry": unary_union(rows.geometry)
        })
        consumed_ids.update(ids_to_consume)
        membership[fid] = ids_to_consume

    # 1. Minsk City
    city = by_active[by_active["shapeName"] == CITY_OF_MINSK_NAME]
    if len(city) != 1:
        raise ValueError(f"CRITICAL: Expected exactly 1 Minsk City, found {len(city)}.")
    _add_feature("BY_CITY_MINSK", city)

    # 2. Historical Groups
    for fid, spec in HISTORICAL_GROUPS.items():
        members = spec["members"]
        rows = by_active[by_active["shapeName"].isin(members)]
        found_names = set(rows["shapeName"])
        missing_names = set(members) - found_names
        if missing_names:
            raise ValueError(f"CRITICAL: Missing historical members for {fid}: {missing_names}")
        _add_feature(fid, rows)

    # 3. Border Rays
    explicit_ray_ids = sorted([fid for fid in baseline_by if fid.startswith("BY_RAY_")])
    for fid in explicit_ray_ids:
        shape_id = fid.replace("BY_RAY_", "")
        row = by_active[by_active["shapeID"] == shape_id]
        if row.empty:
            raise ValueError(f"CRITICAL: Missing explicit ray source for {fid}.")
        _add_feature(fid, row)

    # 4. Interior Groups
    remaining = by_active[~by_active["shapeID"].isin(consumed_ids)]
    for oblast, fid in INTERIOR_GROUP_IDS.items():
        rows = remaining[remaining["oblast_name"] == oblast]
        if rows.empty:
            raise ValueError(f"CRITICAL: Interior group {fid} ({oblast}) has no remaining shapes.")
        _add_feature(fid, rows)

    partition_check = consumed_ids.union(excluded_ids)
    if partition_check != all_raw_ids:
        raise ValueError(f"CRITICAL: Consumed and excluded IDs do not perfectly partition all raw IDs. Missing/Extra: {partition_check ^ all_raw_ids}")

    out_by = gpd.GeoDataFrame(outputs, crs="EPSG:4326")
    if out_by.empty:
        raise ValueError("CRITICAL: Output for BY is empty.")
    if out_by["id"].duplicated().any():
        raise ValueError("CRITICAL: Duplicate IDs in Belarus output.")

    by_missing = baseline_by - set(out_by["id"])
    if by_missing:
        raise ValueError(f"CRITICAL: Missing BY IDs from baseline: {by_missing}")
    by_extra = set(out_by["id"]) - baseline_by
    if by_extra:
        raise ValueError(f"CRITICAL: Extra BY IDs not in baseline: {by_extra}")

    _check_coverage(out_by.geometry.tolist(), "Belarus")

    output_coords = shapely.get_num_coordinates(out_by.geometry).sum()

    return out_by[["id", "cntr_code", "geometry"]], {
        "features": len(out_by),
        "raw_coordinates": int(raw_coords),
        "output_coordinates": int(output_coords),
        "membership": membership,
        "excluded_raw_ids": sorted(excluded_ids),
        "source_path": str(source_path.resolve()),
        "hash": _file_sha256(source_path),
        "provenance": _load_provenance(source_path),
        "coarse_path": str(coarse_path.resolve()),
        "coarse_hash": _file_sha256(coarse_path)
    }

def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--pl-source", required=True, type=Path)
    parser.add_argument("--ua-source", required=True, type=Path)
    parser.add_argument("--by-source", required=True, type=Path)
    parser.add_argument("--coarse", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)

    for path in (args.baseline, args.pl_source, args.ua_source, args.by_source, args.coarse):
        if not path.exists():
            raise FileNotFoundError(f"Input file not found: {path}")

    out_dir = args.output_dir.resolve()

    root_dir = Path(__file__).resolve().parents[1]
    data_dir = (root_dir / "data").resolve()
    dist_dir = (root_dir / "dist").resolve()

    if out_dir.is_relative_to(data_dir) or out_dir.is_relative_to(dist_dir) or out_dir.is_relative_to(args.baseline.parent.resolve()):
        raise ValueError("CRITICAL: Output directory must be outside data, dist, and input directories.")

    if out_dir.exists():
        raise ValueError(f"CRITICAL: Output directory {out_dir} already exists. Must specify a NEW directory.")

    with open(args.baseline, encoding="utf-8") as f:
        topo = json.load(f)

    baseline_ids = {"PL": set(), "UA": set(), "BY": set()}
    baseline_coords = {"PL": 0, "UA": 0, "BY": 0}

    abs_topo = _absolute_topology(topo)

    seen_baseline_ids = set()

    for item in topo["objects"]["political"]["geometries"]:
        props = item.get("properties", {})
        cntr = props.get("cntr_code")
        fid = props.get("id")

        if fid is None or str(fid).strip() == "":
            raise ValueError("CRITICAL: Baseline contains blank or missing ID.")
        fid = str(fid).strip()

        if fid in seen_baseline_ids:
            raise ValueError(f"CRITICAL: Baseline contains duplicate ID: {fid}")
        seen_baseline_ids.add(fid)

        if cntr in baseline_ids:
            baseline_ids[cntr].add(fid)

            geom = _decode_geometry(abs_topo, item)
            if geom is not None:
                baseline_coords[cntr] += int(shapely.get_num_coordinates(geom))

    pl_gdf, pl_report = process_poland(args.pl_source, baseline_ids["PL"])
    ua_gdf, ua_report = process_ukraine(args.ua_source, baseline_ids["UA"])
    by_gdf, by_report = process_belarus(args.by_source, args.coarse, baseline_ids["BY"])

    pl_report["baseline_coordinates"] = baseline_coords["PL"]
    ua_report["baseline_coordinates"] = baseline_coords["UA"]
    by_report["baseline_coordinates"] = baseline_coords["BY"]

    out_dir.mkdir(parents=True, exist_ok=False)

    pl_gdf.to_file(out_dir / "pl.geojson", driver="GeoJSON")
    ua_gdf.to_file(out_dir / "ua.geojson", driver="GeoJSON")
    by_gdf.to_file(out_dir / "by.geojson", driver="GeoJSON")

    report = {
        "PL": pl_report,
        "UA": ua_report,
        "BY": by_report
    }

    with open(out_dir / "report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))

    return 0

if __name__ == "__main__":
    sys.exit(main())
