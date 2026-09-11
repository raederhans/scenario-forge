"""Primary topology build stage owner for init_map_data.

The legacy entrypoint stays in init_map_data.py for orchestrator compatibility;
this module owns the stage flow and keeps the large transaction grouped by
source download, cleaning, topology merge, and export boundaries.
"""
from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any

from map_builder.geo.water_region_authority import WATER_SOURCE_SIMPLIFY_DEGREES


def run_primary_topology_bundle(
    script_dir: Path,
    output_dir: Path,
    *,
    stage_timings: dict[str, dict] | None = None,
    build_stage_cache: dict[str, dict] | None = None,
    timings_root: Path | None = None,
    stage_ops: Any,
) -> dict[str, object]:
    del script_dir, build_stage_cache, timings_root

    # Match the legacy entrypoint's timing boundary: the primary stage timer
    # starts after the Natural Earth borders source is available.
    borders = _download_border_source(stage_ops)
    primary_pipeline_start = time.perf_counter()

    filtered = _clean_political_source(stage_ops, borders)
    downloaded = _download_topology_sources(stage_ops)
    background = _clean_background_sources(stage_ops, downloaded)
    merged = _merge_political_layers(
        stage_ops,
        filtered=filtered,
        borders=borders,
        land_bg_clipped=background["land_bg_clipped"],
    )
    topology_layers = _clean_topology_layers(
        stage_ops,
        filtered=filtered,
        borders=borders,
        rivers_clipped=downloaded["rivers_clipped"],
        border_lines=downloaded["border_lines"],
        background=background,
        output_dir=output_dir,
        hybrid=merged["hybrid"],
        final_hybrid=merged["final_hybrid"],
        special_zones=merged["special_zones"],
    )
    world_cities = _export_primary_outputs(
        stage_ops,
        output_dir=output_dir,
        stage_timings=stage_timings,
        filtered=topology_layers["filtered"],
        rivers_clipped=topology_layers["rivers_clipped"],
        border_lines=topology_layers["border_lines"],
        ocean_clipped=topology_layers["ocean_clipped"],
        water_regions=topology_layers["water_regions"],
        land_bg_clipped=topology_layers["land_bg_clipped"],
        urban_clipped=topology_layers["urban_clipped"],
        physical_filtered=topology_layers["physical_filtered"],
        hybrid=topology_layers["hybrid"],
        final_hybrid=topology_layers["final_hybrid"],
        special_zones=topology_layers["special_zones"],
    )

    if stage_timings is not None:
        stage_ops._record_stage_timing(stage_timings, "primary_topology_bundle", primary_pipeline_start)
    return {
        "final_hybrid": topology_layers["final_hybrid"],
        "world_cities": world_cities,
        "missing_cntr_code_count": int(topology_layers["final_hybrid"]["cntr_code"].isnull().sum()),
    }


# download

def _download_border_source(stage_ops: Any) -> Any:
    cfg = stage_ops.cfg
    borders = stage_ops.fetch_ne_zip(cfg.BORDERS_URL, "borders")
    return stage_ops.clip_to_map_bounds(borders, "borders")


def _download_topology_sources(stage_ops: Any) -> dict[str, Any]:
    cfg = stage_ops.cfg
    rivers_clipped = stage_ops.load_rivers()
    border_lines = stage_ops.build_border_lines()
    ocean = stage_ops.fetch_ne_zip(cfg.OCEAN_URL, "ocean")
    ocean = stage_ops.clip_to_map_bounds(ocean, "ocean")
    marine_polys = stage_ops.fetch_ne_zip(cfg.MARINE_POLYS_URL, "marine polygons")
    marine_polys = stage_ops.clip_to_map_bounds(marine_polys, "marine polygons")
    lakes = stage_ops.fetch_ne_zip(cfg.LAKES_URL, "lakes")
    lakes = stage_ops.clip_to_map_bounds(lakes, "lakes")
    land_bg = stage_ops.fetch_ne_zip(cfg.LAND_BG_URL, "land")
    land_bg = stage_ops.clip_to_map_bounds(land_bg, "land background")
    ocean = stage_ops.ensure_ocean_coverage(
        ocean,
        land_bg,
        target_bounds=getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS),
        stage_label="initial",
    )
    return {
        "rivers_clipped": rivers_clipped,
        "border_lines": border_lines,
        "ocean": ocean,
        "marine_polys": marine_polys,
        "lakes": lakes,
        "land_bg": land_bg,
    }


def _clean_political_source(stage_ops: Any, borders: Any) -> Any:
    cfg = stage_ops.cfg
    if getattr(cfg, "GLOBAL_SKELETON_MODE", False):
        filtered = stage_ops.filter_countries(borders)
        filtered = filtered.copy()
        filtered["geometry"] = filtered.geometry.simplify(
            tolerance=cfg.SIMPLIFY_BORDERS, preserve_topology=True
        )
    else:
        data = stage_ops.fetch_geojson(cfg.URL)
        gdf = stage_ops.build_geodataframe(data)
        gdf = stage_ops.clip_to_map_bounds(gdf, "nuts")
        filtered = stage_ops.filter_countries(gdf)
        filtered = filtered.copy()
        filtered["geometry"] = filtered.geometry.simplify(
            tolerance=cfg.SIMPLIFY_NUTS3, preserve_topology=True
        )
    filtered = stage_ops.build_antarctic_sectors(filtered)
    stage_ops.validate_political_schema(filtered, "Political Filter")
    return filtered


# clean

def _clean_background_sources(stage_ops: Any, downloaded: dict[str, Any]) -> dict[str, Any]:
    cfg = stage_ops.cfg
    ocean_clipped = downloaded["ocean"].copy()
    ocean_clipped["geometry"] = ocean_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    land_bg_clipped = downloaded["land_bg"].copy()
    land_bg_clipped["geometry"] = land_bg_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    water_regions = stage_ops.build_water_regions(downloaded["marine_polys"], downloaded["lakes"])
    water_regions["geometry"] = water_regions.geometry.simplify(
        tolerance=WATER_SOURCE_SIMPLIFY_DEGREES, preserve_topology=True
    )
    urban_clipped = stage_ops.load_urban()
    urban_clipped = urban_clipped.copy()
    urban_clipped["geometry"] = urban_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_URBAN, preserve_topology=True
    )
    physical_filtered = stage_ops.load_physical()
    if physical_filtered.empty:
        print("Physical regions filter returned empty dataset, keeping all clipped features.")
        physical_filtered = stage_ops.fetch_ne_zip(cfg.PHYSICAL_URL, "physical")
        physical_filtered = stage_ops.clip_to_map_bounds(physical_filtered, "physical")
    physical_filtered = physical_filtered.copy()
    physical_filtered["geometry"] = physical_filtered.geometry.simplify(
        tolerance=cfg.SIMPLIFY_PHYSICAL, preserve_topology=True
    )
    keep_cols = [
        "name",
        "name_en",
        "NAME",
        "NAME_EN",
        "featurecla",
        "FEATURECLA",
        "geometry",
    ]
    physical_filtered = physical_filtered[[col for col in keep_cols if col in physical_filtered.columns]]
    return {
        "ocean_clipped": ocean_clipped,
        "land_bg_clipped": land_bg_clipped,
        "water_regions": water_regions,
        "urban_clipped": urban_clipped,
        "physical_filtered": physical_filtered,
    }


# merge

def _merge_political_layers(
    stage_ops: Any,
    *,
    filtered: Any,
    borders: Any,
    land_bg_clipped: Any,
) -> dict[str, Any]:
    cfg = stage_ops.cfg
    nuts_hybrid = filtered.copy()
    special_zones = stage_ops.gpd.GeoDataFrame(
        columns=["id", "name", "type", "label", "claimants", "cntr_code", "geometry"],
        crs="EPSG:4326",
    )
    hybrid = nuts_hybrid.copy()

    if not getattr(cfg, "GLOBAL_SKELETON_MODE", False):
        extension_hybrid = stage_ops.build_extension_admin1(filtered)
        hybrid = stage_ops.gpd.GeoDataFrame(
            stage_ops.pd.concat([nuts_hybrid, extension_hybrid], ignore_index=True),
            crs="EPSG:4326",
        )
        balkan_fallback = stage_ops.build_balkan_fallback(hybrid, admin0=borders)
        if not balkan_fallback.empty:
            hybrid = stage_ops.gpd.GeoDataFrame(
                stage_ops.pd.concat([hybrid, balkan_fallback], ignore_index=True),
                crs="EPSG:4326",
            )
        hybrid = stage_ops.apply_holistic_replacements(hybrid)
        hybrid = stage_ops.apply_denmark_border_detail(hybrid)
        hybrid = stage_ops.apply_russia_ukraine_replacement(hybrid)
        hybrid = stage_ops.apply_poland_replacement(hybrid)
        hybrid = stage_ops.apply_china_replacement(hybrid)
        hybrid = stage_ops.apply_south_asia_replacement(hybrid, land_bg_clipped)
        hybrid = stage_ops.apply_north_america_replacement(hybrid)

    try:
        print("Downloading India ADM2 (raw) for special zones...")
        india_raw = stage_ops.fetch_or_load_geojson(
            cfg.IND_ADM2_URL,
            cfg.IND_ADM2_FILENAME,
            fallback_urls=cfg.IND_ADM2_FALLBACK_URLS,
        )
        if india_raw.empty:
            print("[Special Zones] India ADM2 GeoDataFrame is empty; skipping disputed zone.")
        else:
            if india_raw.crs is None:
                india_raw = india_raw.set_crs("EPSG:4326", allow_override=True)
            if india_raw.crs.to_epsg() != 4326:
                india_raw = india_raw.to_crs("EPSG:4326")
            china_gdf = hybrid[hybrid["cntr_code"].astype(str).str.upper() == "CN"].copy()
            special_zones = stage_ops.build_special_zones(china_gdf, india_raw)
            if special_zones.empty:
                print("[Special Zones] No special zones were generated.")
            else:
                print(f"[Special Zones] Generated {len(special_zones)} special zones.")
    except Exception as exc:
        print(f"[Special Zones] Failed to build special zones; continuing without: {exc}")

    final_hybrid = _fill_country_codes(stage_ops, hybrid.copy(), borders)
    if getattr(cfg, "ENABLE_SUBDIVISION_ENRICHMENT", False):
        final_hybrid = stage_ops.apply_config_subdivisions(final_hybrid)
    return {"hybrid": hybrid, "final_hybrid": final_hybrid, "special_zones": special_zones}


def _fill_country_codes(stage_ops: Any, final_hybrid: Any, borders: Any) -> Any:
    final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("").astype(str).str.strip()
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    missing_mask = final_hybrid["cntr_code"].isna()
    if missing_mask.any() and "id" in final_hybrid.columns:
        final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[missing_mask, "id"].apply(
            stage_ops.extract_country_code
        )
    final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("").astype(str).str.strip()
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None

    missing_mask = final_hybrid["cntr_code"].isna()
    if missing_mask.any():
        borders_ll = borders.to_crs("EPSG:4326")
        code_col = stage_ops.pick_column(
            borders_ll,
            ["iso_a2", "ISO_A2", "adm0_a2", "ADM0_A2", "iso_3166_1_", "ISO_3166_1_"],
        )
        if not code_col:
            print("Borders dataset missing ISO A2 column; spatial join skipped.")
        else:
            try:
                missing = final_hybrid.loc[missing_mask].copy().to_crs("EPSG:4326")
                missing["geometry"] = missing.geometry.representative_point()
                joined = stage_ops.gpd.sjoin(
                    missing,
                    borders_ll[[code_col, "geometry"]],
                    how="left",
                    predicate="within",
                )
                filled = joined[code_col]
                filled = filled.where(~filled.isin(["-99", "", None]))
                filled = filled.groupby(level=0).first()
                final_hybrid.loc[filled.index, "cntr_code"] = filled
            except Exception as exc:
                print(f"Spatial join failed: {exc}")

    final_hybrid["cntr_code"] = (
        final_hybrid["cntr_code"].fillna("").astype(str).str.strip().str.upper()
    )
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    return final_hybrid


# topology

def _clean_topology_layers(
    stage_ops: Any,
    *,
    filtered: Any,
    borders: Any,
    rivers_clipped: Any,
    border_lines: Any,
    background: dict[str, Any],
    output_dir: Path,
    hybrid: Any,
    final_hybrid: Any,
    special_zones: Any,
) -> dict[str, Any]:
    cfg = stage_ops.cfg
    ocean_clipped = background["ocean_clipped"]
    land_bg_clipped = background["land_bg_clipped"]
    water_regions = background["water_regions"]
    urban_clipped = background["urban_clipped"]
    physical_filtered = background["physical_filtered"]

    try:
        hybrid_bounds = final_hybrid.to_crs("EPSG:4326").total_bounds
        if (
            len(hybrid_bounds) == 4
            and all(math.isfinite(v) for v in hybrid_bounds)
            and hybrid_bounds[2] > hybrid_bounds[0]
            and hybrid_bounds[3] > hybrid_bounds[1]
        ):
            ocean_clipped = stage_ops.clip_to_bounds(ocean_clipped, hybrid_bounds, "ocean")
            land_bg_clipped = stage_ops.clip_to_bounds(land_bg_clipped, hybrid_bounds, "land background")
            water_regions = stage_ops.clip_to_bounds(water_regions, hybrid_bounds, "water regions")
    except Exception as exc:
        print(f"Background layer clip-to-political-bounds skipped: {exc}")

    ocean_clipped = stage_ops.ensure_ocean_coverage(
        ocean_clipped,
        land_bg_clipped,
        target_bounds=getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS),
        stage_label="pre-topology",
    )

    filtered_group_col = "id" if "id" in filtered.columns else "NUTS_ID"
    filtered = stage_ops.cull_small_geometries(filtered, "land", group_col=filtered_group_col)
    ocean_clipped = stage_ops.cull_small_geometries(ocean_clipped, "ocean")
    land_bg_clipped = stage_ops.cull_small_geometries(land_bg_clipped, "land background")
    water_regions = stage_ops.cull_small_geometries(water_regions, "water regions", group_col="id")
    urban_clipped = stage_ops.cull_small_geometries(urban_clipped, "urban")
    physical_filtered = stage_ops.cull_small_geometries(physical_filtered, "physical")
    hybrid = stage_ops.cull_small_geometries(hybrid, "hybrid", group_col="id")
    final_hybrid = stage_ops.cull_small_geometries(final_hybrid, "political", group_col="id")
    special_zones = stage_ops.cull_small_geometries(special_zones, "special zones", group_col="id")
    urban_clipped = stage_ops.assign_stable_urban_area_ids(urban_clipped)
    urban_clipped = stage_ops.assign_urban_country_owners(urban_clipped, final_hybrid)

    target_bounds = getattr(cfg, "MAP_BOUNDS", cfg.GLOBAL_BOUNDS)
    stage_ops.log_layer_coverage("political", final_hybrid, target_bounds)
    stage_ops.log_layer_coverage("ocean", ocean_clipped, target_bounds)
    stage_ops.log_layer_coverage("land", land_bg_clipped, target_bounds)
    stage_ops.log_layer_coverage("water_regions", water_regions, target_bounds)
    stage_ops.log_layer_coverage("urban", urban_clipped, target_bounds)
    stage_ops.log_layer_coverage("physical", physical_filtered, target_bounds)
    stage_ops.log_layer_coverage("rivers", rivers_clipped, target_bounds)
    stage_ops.log_layer_coverage("special_zones", special_zones, target_bounds)

    print("[INFO] Building derived physical atlas semantics and contour assets....")
    physical_semantics, contour_major, contour_minor = stage_ops.build_and_save_physical_context_layers(
        physical_filtered,
        output_dir,
    )
    stage_ops.log_layer_coverage("physical_semantics", physical_semantics, target_bounds)
    stage_ops.log_layer_coverage("contours_major", contour_major, target_bounds)
    stage_ops.log_layer_coverage("contours_minor", contour_minor, target_bounds)

    final_hybrid = _normalize_feature_ids(final_hybrid)
    return {
        "filtered": filtered,
        "rivers_clipped": rivers_clipped,
        "border_lines": border_lines,
        "ocean_clipped": ocean_clipped,
        "water_regions": water_regions,
        "land_bg_clipped": land_bg_clipped,
        "urban_clipped": urban_clipped,
        "physical_filtered": physical_filtered,
        "hybrid": hybrid,
        "final_hybrid": final_hybrid,
        "special_zones": special_zones,
    }


def _normalize_feature_ids(final_hybrid: Any) -> Any:
    if "id" in final_hybrid.columns:
        final_hybrid["id"] = final_hybrid["id"].fillna("").astype(str).str.strip()
        empty_id_mask = final_hybrid["id"] == ""
        if empty_id_mask.any():
            for idx in final_hybrid.index[empty_id_mask]:
                cc = str(final_hybrid.loc[idx, "cntr_code"] or "UNK").upper()
                final_hybrid.loc[idx, "id"] = f"{cc}_{idx}"
            print(f"[ID Fix] Filled {empty_id_mask.sum()} empty IDs")
        seen: dict[str, int] = {}
        dup_count = 0
        for idx in final_hybrid.index:
            fid = final_hybrid.loc[idx, "id"]
            if fid in seen:
                seen[fid] += 1
                final_hybrid.loc[idx, "id"] = f"{fid}__d{seen[fid]}"
                dup_count += 1
            else:
                seen[fid] = 0
        if dup_count:
            print(f"[ID Fix] De-duplicated {dup_count} IDs")
        print(f"[ID Validation] {len(final_hybrid)} features, {final_hybrid['id'].nunique()} unique IDs")
    else:
        print("[ID Validation] WARNING: 'id' column missing from final_hybrid!")
    return final_hybrid


# export

def _export_primary_outputs(
    stage_ops: Any,
    *,
    output_dir: Path,
    stage_timings: dict[str, dict] | None,
    filtered: Any,
    rivers_clipped: Any,
    border_lines: Any,
    ocean_clipped: Any,
    water_regions: Any,
    land_bg_clipped: Any,
    urban_clipped: Any,
    physical_filtered: Any,
    hybrid: Any,
    final_hybrid: Any,
    special_zones: Any,
) -> Any:
    world_cities_start = time.perf_counter()
    print("[INFO] Building global city assets....")
    world_cities = stage_ops.build_world_cities(
        political=final_hybrid,
        urban=urban_clipped,
    )
    city_aliases = stage_ops.build_city_aliases_payload(world_cities)
    if stage_timings is not None:
        stage_ops._record_stage_timing(
            stage_timings,
            "world_cities",
            world_cities_start,
            city_count=len(world_cities),
            alias_count=city_aliases.get("alias_count"),
        )

    stage_ops.save_outputs(
        filtered,
        rivers_clipped,
        border_lines,
        ocean_clipped,
        water_regions,
        land_bg_clipped,
        urban_clipped,
        physical_filtered,
        hybrid,
        final_hybrid,
        world_cities,
        city_aliases,
        output_dir,
    )

    city_lights_assets_start = time.perf_counter()
    stage_ops.build_city_lights_assets(output_dir)
    if stage_timings is not None:
        stage_ops._record_stage_timing(stage_timings, "city_lights_assets", city_lights_assets_start)

    topology_path = output_dir / "europe_topology.json"
    stage_ops.build_topology(
        political=final_hybrid,
        ocean=ocean_clipped,
        land=land_bg_clipped,
        urban=urban_clipped,
        physical=physical_filtered,
        rivers=rivers_clipped,
        special_zones=special_zones,
        water_regions=water_regions,
        output_path=topology_path,
        quantization=stage_ops.cfg.TOPOLOGY_QUANTIZATION,
    )
    return world_cities
