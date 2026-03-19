"""Refresh only US political features in detail and runtime topologies.

This avoids the full global rebuild path when unrelated shell-repair or
canonicalization work would otherwise block materializing the latest US
hybrid-zone builder output.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import sys

import geopandas as gpd
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.io.readers import read_json_strict
from map_builder.io.writers import write_json_atomic
from map_builder.processors.north_america import (
    _US_TERRITORY_CODES,
    _build_adjacency,
    _build_us_zones,
    _connected_components,
    _read_zip_layer,
)
from tools.build_na_detail_topology import (
    FEATURE_MIGRATION_PATH,
    LAYER_NAMES,
    _load_existing_output_political,
    _reconcile_us_feature_ids,
    _repair_political_geometries,
    _update_us_feature_migration_asset,
    _write_output_topology as _write_detail_output_topology,
)
from tools.build_runtime_political_topology import (
    _dedupe_feature_ids,
    _ensure_epsg4326,
    _load_topology as _load_runtime_topology,
    _prune_political_columns,
    _repair_geometries,
    _topology_object_to_gdf,
    _write_output_topology as _write_runtime_output_topology,
)

DEFAULT_PREVIOUS_DETAIL_PATH = (
    PROJECT_ROOT / ".runtime" / "tmp" / "europe_topology.na_v2.pre_us_rebuild.nobom.json"
)
DEFAULT_REPORT_PATH = (
    PROJECT_ROOT / ".runtime" / "reports" / "generated" / "us_topology_refresh_metrics.json"
)
def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh only US detail/runtime topology artifacts.")
    parser.add_argument(
        "--detail-topology",
        type=Path,
        default=PROJECT_ROOT / "data" / "europe_topology.na_v2.json",
        help="Detail topology to rewrite in place.",
    )
    parser.add_argument(
        "--runtime-topology",
        type=Path,
        default=PROJECT_ROOT / "data" / "europe_topology.runtime_political_v1.json",
        help="Runtime political topology to rewrite in place.",
    )
    parser.add_argument(
        "--previous-detail-topology",
        type=Path,
        default=DEFAULT_PREVIOUS_DETAIL_PATH,
        help="Previous detail topology used for US ID reconciliation and migration generation.",
    )
    parser.add_argument(
        "--migration-path",
        type=Path,
        default=FEATURE_MIGRATION_PATH,
        help="Feature migration asset to update.",
    )
    parser.add_argument(
        "--report-path",
        type=Path,
        default=DEFAULT_REPORT_PATH,
        help="Optional JSON report output path.",
    )
    return parser.parse_args()


def _load_topology_dict(path: Path) -> dict:
    payload = read_json_strict(path)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object in {path}, found {type(payload).__name__}.")
    return payload


def _load_detail_layers(path: Path) -> dict[str, gpd.GeoDataFrame]:
    topology = _load_topology_dict(path)
    layers: dict[str, gpd.GeoDataFrame] = {}
    for layer_name in LAYER_NAMES:
        layers[layer_name] = _topology_object_to_gdf(topology, layer_name)
    return layers


def _country_mask(gdf: gpd.GeoDataFrame, country_code: str) -> pd.Series:
    if gdf.empty or "cntr_code" not in gdf.columns:
        return pd.Series([False] * len(gdf), index=gdf.index)
    return gdf["cntr_code"].fillna("").astype(str).str.upper() == str(country_code).upper()


def _replace_country_features(
    base_gdf: gpd.GeoDataFrame,
    replacement_gdf: gpd.GeoDataFrame,
    country_code: str,
) -> gpd.GeoDataFrame:
    if base_gdf.empty:
        return _ensure_epsg4326(replacement_gdf.copy())

    keep = base_gdf.loc[~_country_mask(base_gdf, country_code)].copy()
    replacement = _ensure_epsg4326(replacement_gdf.copy())
    all_columns: list[str] = []
    for frame in (keep, replacement):
        for column in frame.columns:
            if column not in all_columns:
                all_columns.append(column)
    if "geometry" in all_columns:
        all_columns = [column for column in all_columns if column != "geometry"] + ["geometry"]

    keep = keep.reindex(columns=all_columns)
    replacement = replacement.reindex(columns=all_columns)
    combined = pd.concat([keep, replacement], ignore_index=True, sort=False)
    return _ensure_epsg4326(gpd.GeoDataFrame(combined, geometry="geometry", crs="EPSG:4326"))


def _load_us_counties() -> gpd.GeoDataFrame:
    counties = _read_zip_layer(
        cfg.US_COUNTY_2024_500K_URL,
        cfg.US_COUNTY_2024_500K_FILENAME,
        "US counties 2024 (500k)",
    ).copy()
    states = _read_zip_layer(
        cfg.US_STATE_2024_500K_URL,
        cfg.US_STATE_2024_500K_FILENAME,
        "US states 2024 (500k)",
    ).copy()

    counties["STATEFP"] = counties["STATEFP"].astype(str).str.zfill(2)
    counties["COUNTYFP"] = counties["COUNTYFP"].astype(str).str.zfill(3)
    counties["GEOID"] = counties["STATEFP"] + counties["COUNTYFP"]
    counties["STUSPS"] = counties["STUSPS"].astype(str).str.upper().str.strip()
    counties = counties[~counties["STUSPS"].isin(_US_TERRITORY_CODES)].copy()
    counties = counties[counties.geometry.notna() & ~counties.geometry.is_empty].copy()

    states["STUSPS"] = states["STUSPS"].astype(str).str.upper().str.strip()
    states = states[~states["STUSPS"].isin(_US_TERRITORY_CODES)].copy()
    state_name_map = {
        str(row.STUSPS).upper(): str(row.NAME).strip()
        for row in states.itertuples(index=False)
        if str(row.STUSPS).strip()
    }
    counties["state_name"] = counties["STUSPS"].map(state_name_map).fillna(counties["STUSPS"])
    return _ensure_epsg4326(counties)


def _count_us_coarse_connectivity_violations(us_gdf: gpd.GeoDataFrame) -> tuple[int, list[dict[str, object]]]:
    coarse_mask = us_gdf.get("detail_tier", "").fillna("").astype(str) == "coarse"
    coarse = us_gdf.loc[coarse_mask].copy()
    if coarse.empty:
        return 0, []

    counties = _load_us_counties()
    counties_metric = counties.to_crs(cfg.AREA_CRS)
    coarse_metric = _ensure_epsg4326(coarse).to_crs(cfg.AREA_CRS)
    violations: list[dict[str, object]] = []

    for state_name, state_counties_metric in counties_metric.groupby("state_name", sort=True):
        state_coarse_metric = coarse_metric[
            coarse_metric["admin1_group"].fillna("").astype(str) == str(state_name)
        ].copy()
        if state_coarse_metric.empty:
            continue
        state_counties_metric = state_counties_metric.reset_index(drop=True)
        adjacency = _build_adjacency(state_counties_metric)
        rep_points = gpd.GeoDataFrame(
            {"county_index": list(range(len(state_counties_metric)))},
            geometry=state_counties_metric.geometry.representative_point(),
            crs=state_counties_metric.crs,
        )
        rep_sindex = rep_points.sindex

        for row in state_coarse_metric.itertuples(index=False):
            try:
                candidate_indices = list(rep_sindex.query(row.geometry, predicate="intersects"))
            except TypeError:
                candidate_indices = list(rep_sindex.intersection(row.geometry.bounds))
            members = [
                int(rep_points.iloc[candidate_idx]["county_index"])
                for candidate_idx in candidate_indices
                if row.geometry.covers(rep_points.geometry.iloc[candidate_idx])
            ]
            if not members:
                violations.append(
                    {
                        "id": str(row.id),
                        "state": str(state_name),
                        "component_count": 0,
                    }
                )
                continue

            components = _connected_components(set(members), adjacency)
            if len(components) > 1:
                violations.append(
                    {
                        "id": str(row.id),
                        "state": str(state_name),
                        "component_count": len(components),
                    }
                )

    return len(violations), violations


def _neighbors_ok(path: Path) -> bool:
    topology = _load_topology_dict(path)
    political = topology.get("objects", {}).get("political", {})
    geometries = political.get("geometries", [])
    neighbors = political.get("computed_neighbors", [])
    return isinstance(neighbors, list) and len(neighbors) == len(geometries)


def _refresh_detail_topology(
    detail_path: Path,
    previous_detail_path: Path,
    migration_path: Path,
) -> tuple[gpd.GeoDataFrame, dict[str, object]]:
    print(f"[US refresh] Loading detail topology: {detail_path}")
    layers = _load_detail_layers(detail_path)
    current_political = _ensure_epsg4326(layers["political"].copy())
    previous_political = _load_existing_output_political(previous_detail_path)
    print("[US refresh] Building fresh US zones")
    fresh_us = _repair_political_geometries(_build_us_zones())

    print("[US refresh] Validating fresh US coarse connectivity")
    builder_violations, builder_violation_rows = _count_us_coarse_connectivity_violations(fresh_us)
    if builder_violations:
        raise ValueError(f"US builder output still has {builder_violations} coarse connectivity violations.")

    combined = _replace_country_features(current_political, fresh_us, "US")
    combined = _repair_political_geometries(combined)
    combined, id_metrics = _reconcile_us_feature_ids(previous_political, combined)
    layers["political"] = combined
    detail_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[US refresh] Writing detail topology: {detail_path}")
    _write_detail_output_topology(output_path=detail_path, political=combined, layers=layers)

    print("[US refresh] Reloading detail topology and updating migration asset")
    final_layers = _load_detail_layers(detail_path)
    final_political = _repair_political_geometries(final_layers["political"])
    migration_metrics = _update_us_feature_migration_asset(
        previous_political,
        final_political,
        migration_path=migration_path,
    )
    final_us = final_political.loc[_country_mask(final_political, "US")].copy()
    print("[US refresh] Validating final detail US coarse connectivity")
    final_violations, final_violation_rows = _count_us_coarse_connectivity_violations(final_us)

    detail_tiers = final_us.get("detail_tier", pd.Series("", index=final_us.index)).fillna("").astype(str)
    metrics = {
        "detail_total_features": int(len(final_political)),
        "detail_us_features": int(len(final_us)),
        "detail_us_coarse_features": int((detail_tiers == "coarse").sum()),
        "detail_us_fine_features": int((detail_tiers == "fine").sum()),
        "detail_us_duplicate_ids": int(final_us["id"].fillna("").astype(str).duplicated().sum()),
        "detail_neighbors_ok": _neighbors_ok(detail_path),
        "builder_us_coarse_connectivity_violations": int(builder_violations),
        "final_us_coarse_connectivity_violations": int(final_violations),
        "builder_us_coarse_connectivity_violation_rows": builder_violation_rows,
        "final_us_coarse_connectivity_violation_rows": final_violation_rows,
    }
    metrics.update({f"detail_{key}": value for key, value in id_metrics.items()})
    metrics.update({f"detail_{key}": value for key, value in migration_metrics.items()})
    return final_political, metrics


def _refresh_runtime_topology(
    runtime_path: Path,
    detail_political: gpd.GeoDataFrame,
) -> tuple[gpd.GeoDataFrame, dict[str, object]]:
    print(f"[US refresh] Loading runtime topology: {runtime_path}")
    runtime_topology = _load_runtime_topology(runtime_path)
    runtime_political = _topology_object_to_gdf(runtime_topology, "political")
    detail_us = detail_political.loc[_country_mask(detail_political, "US")].copy()
    detail_us["__source"] = "detail"

    combined = _replace_country_features(runtime_political, detail_us, "US")
    combined = _repair_geometries(combined)
    combined = _prune_political_columns(combined)
    combined = _dedupe_feature_ids(combined)
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"[US refresh] Writing runtime topology: {runtime_path}")
    _write_runtime_output_topology(output_path=runtime_path, political=combined)

    final_runtime = _topology_object_to_gdf(_load_runtime_topology(runtime_path), "political")
    final_us = final_runtime.loc[_country_mask(final_runtime, "US")].copy()
    metrics = {
        "runtime_total_features": int(len(final_runtime)),
        "runtime_us_features": int(len(final_us)),
        "runtime_us_duplicate_ids": int(final_us["id"].fillna("").astype(str).duplicated().sum()),
        "runtime_neighbors_ok": _neighbors_ok(runtime_path),
        "runtime_us_ids_match_detail": sorted(final_us["id"].astype(str))
        == sorted(detail_us["id"].astype(str)),
    }
    return final_runtime, metrics


def main() -> None:
    args = _parse_args()
    previous_detail_path = args.previous_detail_topology
    if not previous_detail_path.exists():
        previous_detail_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.detail_topology, previous_detail_path)
        print(f"[US refresh] Created previous detail snapshot: {previous_detail_path}")

    detail_political, detail_metrics = _refresh_detail_topology(
        detail_path=args.detail_topology,
        previous_detail_path=previous_detail_path,
        migration_path=args.migration_path,
    )
    _, runtime_metrics = _refresh_runtime_topology(
        runtime_path=args.runtime_topology,
        detail_political=detail_political,
    )

    report = {
        "detail_topology": str(args.detail_topology),
        "runtime_topology": str(args.runtime_topology),
        "previous_detail_topology": str(previous_detail_path),
        **detail_metrics,
        **runtime_metrics,
    }
    write_json_atomic(
        args.report_path,
        report,
        ensure_ascii=False,
        indent=2,
        trailing_newline=True,
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
