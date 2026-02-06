"""Initialize and prepare NUTS-3 map data for Map Creator."""
from __future__ import annotations

import sys
import subprocess
from pathlib import Path
from typing import Iterable


try:
    from importlib import util as importlib_util
except Exception:  # pragma: no cover - fallback if importlib is shadowed
    import pkgutil

    def find_spec(name: str):
        return pkgutil.find_loader(name)
else:

    def find_spec(name: str):
        return importlib_util.find_spec(name)


def ensure_packages(packages: Iterable[str]) -> None:
    missing = []
    for name in packages:
        if find_spec(name) is None:
            missing.append(name)
    if not missing:
        return

    print(f"Installing missing packages: {', '.join(missing)}")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", *missing])
    except subprocess.CalledProcessError as exc:
        print("Failed to install required packages.")
        raise SystemExit(exc.returncode) from exc


ensure_packages(["geopandas", "matplotlib", "mapclassify", "requests", "shapely", "topojson"])

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import box
from shapely.ops import clip_by_rect

from map_builder import config as cfg
from map_builder.geo.topology import build_topology
from map_builder.geo.utils import (
    clip_to_europe_bounds,
    pick_column,
    smart_island_cull,
)
from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_geojson
from map_builder.io.readers import load_physical, load_rivers, load_urban
from map_builder.processors.admin1 import build_extension_admin1, extract_country_code
from map_builder.processors.china import apply_china_replacement
from map_builder.processors.france import apply_holistic_replacements
from map_builder.processors.poland import apply_poland_replacement
from map_builder.processors.russia_ukraine import apply_russia_ukraine_replacement
from map_builder.processors.south_asia import apply_south_asia_replacement
from map_builder.processors.special_zones import build_special_zones
from map_builder.outputs.save import save_outputs
from tools import generate_hierarchy, translate_manager


LATITUDE_CROP_BOUNDS = (-180.0, -55.0, 180.0, 73.0)
LATITUDE_CROP_BOX = box(*LATITUDE_CROP_BOUNDS)


def crop_to_latitude_band(gdf: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty or "geometry" not in gdf.columns:
        return gdf

    minx, miny, maxx, maxy = LATITUDE_CROP_BOUNDS
    cropped = gdf.to_crs("EPSG:4326").copy()
    try:
        cropped = cropped.cx[minx:maxx, miny:maxy].copy()
    except Exception:
        # If spatial slicing is unavailable, fall back to full geometry clipping.
        pass

    def _clip_geom(geom):
        if geom is None or geom.is_empty:
            return geom
        try:
            return clip_by_rect(geom, minx, miny, maxx, maxy)
        except Exception:
            return geom.intersection(LATITUDE_CROP_BOX)

    cropped["geometry"] = cropped.geometry.apply(_clip_geom)
    before = len(cropped)
    cropped = cropped[cropped.geometry.notna()]
    cropped = cropped[~cropped.geometry.is_empty]
    dropped = before - len(cropped)
    if dropped:
        print(f"Latitude crop ({label}): removed {dropped} empty geometries.")
    return cropped



def fetch_geojson(url: str) -> dict:
    print("Downloading GeoJSON...")
    try:
        response = requests.get(url, timeout=(10, 60))
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"Download failed: {exc}")
        raise SystemExit(1) from exc
    try:
        return response.json()
    except ValueError as exc:
        print("Failed to decode GeoJSON response.")
        raise SystemExit(1) from exc




def build_geodataframe(data: dict) -> gpd.GeoDataFrame:
    print("Parsing GeoJSON into GeoDataFrame...")
    gdf = gpd.GeoDataFrame.from_features(data.get("features", []))
    if gdf.empty:
        print("GeoDataFrame is empty. Check the downloaded data.")
        raise SystemExit(1)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:3035", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def filter_countries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("Filtering NUTS-3 to Europe...")
    filtered = gdf.copy()
    if "NUTS_ID" in filtered.columns:
        mask = ~filtered["NUTS_ID"].str.startswith(cfg.EXCLUDED_NUTS_PREFIXES)
        filtered = filtered[mask]
    else:
        print("Column NUTS_ID not found; overseas prefix filter skipped.")

    try:
        gdf_ll = filtered.to_crs("EPSG:4326")
        reps = gdf_ll.geometry.representative_point()
        geo_mask = (reps.y >= 30) & (reps.x >= -30)
        filtered = filtered.loc[geo_mask].copy()
    except Exception as exc:
        print(f"Geographic filter skipped due to error: {exc}")

    if filtered.empty:
        print("Filtered GeoDataFrame is empty. Check NUTS data scope.")
        raise SystemExit(1)
    return filtered


def build_border_lines() -> gpd.GeoDataFrame:
    border_lines = fetch_ne_zip(cfg.BORDER_LINES_URL, "border_lines")
    border_lines = clip_to_europe_bounds(border_lines, "border lines")
    border_lines = border_lines.copy()
    border_lines["geometry"] = border_lines.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BORDER_LINES, preserve_topology=True
    )
    return border_lines


def despeckle_hybrid(
    gdf: gpd.GeoDataFrame, area_km2: float = 500.0, tolerance: float = cfg.SIMPLIFY_NUTS3
) -> gpd.GeoDataFrame:
    if gdf.empty or "id" not in gdf.columns:
        return gdf

    exploded = gdf.explode(index_parts=False, ignore_index=True)
    if exploded.empty:
        return gdf

    try:
        proj = exploded.to_crs("EPSG:3035")
        areas = proj.geometry.area / 1_000_000.0
        keep = areas >= area_km2
        filtered = exploded.loc[keep].copy()
        dropped = int((~keep).sum())
        kept = int(keep.sum())
        total = int(len(keep))
        print(
            f"Despeckle: dropped {dropped} polygons < {area_km2:.0f} km^2 "
            f"(kept {kept} of {total})."
        )
    except Exception as exc:
        print(f"Despeckle failed, keeping original hybrid: {exc}")
        return gdf

    if filtered.empty:
        print("Despeckle removed all geometries, keeping original hybrid.")
        return gdf

    dissolved = filtered.dissolve(by="id", aggfunc={"name": "first", "cntr_code": "first"})
    dissolved = dissolved.reset_index()
    dissolved = dissolved.set_crs(gdf.crs)
    dissolved["geometry"] = dissolved.geometry.simplify(
        tolerance=tolerance, preserve_topology=True
    )
    return dissolved


def clip_to_land_bounds(gdf: gpd.GeoDataFrame, land: gpd.GeoDataFrame, label: str) -> gpd.GeoDataFrame:
    print(f"Reprojecting and clipping {label}...")
    gdf = gdf.to_crs("EPSG:4326")
    minx, miny, maxx, maxy = land.total_bounds
    bbox_geom = box(minx, miny, maxx, maxy)
    try:
        clipped = gpd.clip(gdf, bbox_geom)
    except Exception as exc:
        print(f"Clip failed for {label}, attempting to fix geometries...")
        try:
            if hasattr(gdf.geometry, "make_valid"):
                gdf = gdf.set_geometry(gdf.geometry.make_valid())
            else:
                gdf = gdf.set_geometry(gdf.geometry.buffer(0))
            clipped = gpd.clip(gdf, bbox_geom)
        except Exception as fix_exc:
            print(f"Failed to clip {label}: {fix_exc}")
            raise SystemExit(1) from fix_exc

    if clipped.empty:
        print(f"Clipped {label} dataset is empty. Check bounds or CRS.")
        raise SystemExit(1)
    return clipped


def clip_to_bounds(gdf: gpd.GeoDataFrame, bounds: Iterable[float], label: str) -> gpd.GeoDataFrame:
    print(f"Reprojecting and clipping {label} to hybrid bounds...")
    gdf = gdf.to_crs("EPSG:4326")
    minx, miny, maxx, maxy = bounds
    bbox_geom = box(minx, miny, maxx, maxy)
    try:
        clipped = gpd.clip(gdf, bbox_geom)
    except Exception as exc:
        print(f"Clip failed for {label}, attempting to fix geometries...")
        try:
            if hasattr(gdf.geometry, "make_valid"):
                gdf = gdf.set_geometry(gdf.geometry.make_valid())
            else:
                gdf = gdf.set_geometry(gdf.geometry.buffer(0))
            clipped = gpd.clip(gdf, bbox_geom)
        except Exception as fix_exc:
            print(f"Failed to clip {label}: {fix_exc}")
            raise SystemExit(1) from fix_exc

    if clipped.empty:
        print(f"Clipped {label} dataset is empty. Check bounds or CRS.")
        raise SystemExit(1)
    return clipped


def clip_borders(gdf: gpd.GeoDataFrame, land: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    print("Clipping national borders to land bounds...")
    return clip_to_land_bounds(gdf, land, "borders")


def build_balkan_fallback(
    existing: gpd.GeoDataFrame, admin0: gpd.GeoDataFrame | None = None
) -> gpd.GeoDataFrame:
    if admin0 is None:
        admin0 = fetch_ne_zip(cfg.BORDERS_URL, "admin0_balkan")
    admin0 = admin0.to_crs("EPSG:4326")
    admin0 = clip_to_europe_bounds(admin0, "balkan fallback")

    iso_col = pick_column(
        admin0,
        ["iso_a2", "ISO_A2", "adm0_a2", "ADM0_A2", "iso_3166_1_", "ISO_3166_1_"],
    )
    name_col = pick_column(admin0, ["ADMIN", "admin", "NAME", "name", "NAME_EN", "name_en"])
    if not iso_col and not name_col:
        print("Admin0 dataset missing ISO/name columns; Balkan fallback skipped.")
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    existing_codes = set()
    if existing is not None and "cntr_code" in existing.columns:
        existing_codes = set(
            existing["cntr_code"]
            .dropna()
            .astype(str)
            .str.upper()
            .unique()
        )

    wanted = {"BA", "XK"}
    missing = wanted - existing_codes
    if not missing:
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    balkan = admin0[admin0[iso_col].isin(missing)].copy() if iso_col else admin0.iloc[0:0].copy()
    if name_col:
        if "XK" in missing:
            kosovo_mask = admin0[name_col].str.contains("Kosovo", case=False, na=False)
            balkan = pd.concat([balkan, admin0[kosovo_mask]], ignore_index=True)
        if "BA" in missing:
            bosnia_mask = admin0[name_col].str.contains("Bosnia", case=False, na=False)
            balkan = pd.concat([balkan, admin0[bosnia_mask]], ignore_index=True)
    if balkan.empty:
        print("Balkan fallback found no matching admin0 features.")
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    def resolve_balkan_code(row: pd.Series) -> str:
        if iso_col:
            raw = str(row.get(iso_col, "")).upper()
            if len(raw) == 2 and raw.isalpha() and raw != "-99":
                return raw
        if name_col:
            name_val = str(row.get(name_col, "")).lower()
            if "kosovo" in name_val:
                return "XK"
            if "bosnia" in name_val:
                return "BA"
        return ""

    balkan["cntr_code"] = balkan.apply(resolve_balkan_code, axis=1)
    balkan = balkan[balkan["cntr_code"].isin(missing)].copy()
    if balkan.empty:
        print("Balkan fallback found no usable BA/XK features.")
        return gpd.GeoDataFrame(columns=["id", "name", "cntr_code", "geometry"], crs="EPSG:4326")

    if name_col:
        balkan["name"] = balkan[name_col].astype(str)
    else:
        balkan["name"] = balkan["cntr_code"]
    balkan["id"] = balkan["cntr_code"].astype(str) + "_" + balkan["name"].astype(str)
    balkan = balkan[["id", "name", "cntr_code", "geometry"]].copy()
    balkan["geometry"] = balkan.geometry.simplify(
        tolerance=cfg.SIMPLIFY_ADMIN1, preserve_topology=True
    )
    return balkan


def load_subdivision_admin1_context(subdivision_codes: set[str]) -> gpd.GeoDataFrame:
    if not subdivision_codes:
        return gpd.GeoDataFrame(
            columns=["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"],
            crs="EPSG:4326",
        )

    admin1 = fetch_ne_zip(cfg.ADMIN1_URL, "admin1_subdivisions")
    admin1 = admin1.to_crs("EPSG:4326")
    admin1 = clip_to_europe_bounds(admin1, "admin1 subdivisions")

    iso_col = pick_column(admin1, ["iso_a2", "adm0_a2", "iso_3166_1_", "ISO_A2", "ADM0_A2"])
    name_col = pick_column(admin1, ["name", "name_en", "gn_name", "NAME", "NAME_EN"])
    name_local_col = pick_column(admin1, ["name_ja", "NAME_JA", "name_local", "NAME_LOCAL"])
    geonunit_col = pick_column(admin1, ["geonunit", "GEONUNIT", "geounit", "GEOUNIT"])

    if not iso_col or not name_col:
        print("[Subdivisions] Admin1 context missing ISO/name columns; enrichment skipped.")
        return gpd.GeoDataFrame(
            columns=["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"],
            crs="EPSG:4326",
        )

    admin1 = admin1.copy()
    admin1["__iso"] = admin1[iso_col].fillna("").astype(str).str.upper().str.strip()
    if "GB" in subdivision_codes:
        wanted = set(subdivision_codes) | {"UK"}
    else:
        wanted = set(subdivision_codes)
    admin1 = admin1[admin1["__iso"].isin(wanted)].copy()
    if admin1.empty:
        print("[Subdivisions] No Admin1 rows matched configured subdivision countries.")
        return gpd.GeoDataFrame(
            columns=["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"],
            crs="EPSG:4326",
        )

    admin1["__admin1_name"] = admin1[name_col].fillna("").astype(str).str.strip()
    admin1 = admin1[admin1["__admin1_name"] != ""].copy()
    admin1["__iso"] = admin1["__iso"].replace({"UK": "GB"})

    admin1["__name_local"] = None
    if name_local_col and name_local_col in admin1.columns:
        admin1["__name_local"] = admin1[name_local_col].fillna("").astype(str).str.strip()
        admin1.loc[admin1["__name_local"] == "", "__name_local"] = None

    admin1["__constituent_country"] = None
    if geonunit_col and geonunit_col in admin1.columns:
        admin1["__constituent_country"] = admin1[geonunit_col].fillna("").astype(str).str.strip()
        admin1.loc[admin1["__constituent_country"] == "", "__constituent_country"] = None

    admin1 = admin1[["__iso", "__admin1_name", "__name_local", "__constituent_country", "geometry"]].copy()
    return gpd.GeoDataFrame(admin1, crs="EPSG:4326")


def apply_config_subdivisions(hybrid: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if hybrid is None or hybrid.empty or "cntr_code" not in hybrid.columns:
        return hybrid

    configured = {
        str(code).upper().strip()
        for code in getattr(cfg, "SUBDIVISIONS", set())
        if str(code).strip()
    }
    if not configured:
        return hybrid

    # These countries already have dedicated replacement processors later in the pipeline.
    protected = {"CN", "RU", "IN", "PL", "FR"}
    subdivision_codes = configured - protected
    if not subdivision_codes:
        return hybrid

    context = load_subdivision_admin1_context(subdivision_codes)
    if context.empty:
        print("[Subdivisions] No Admin1 context features were built.")
        return hybrid

    enriched = hybrid.copy()
    if "admin1_group" not in enriched.columns:
        enriched["admin1_group"] = None
    if "name_local" not in enriched.columns:
        enriched["name_local"] = None
    if "constituent_country" not in enriched.columns:
        enriched["constituent_country"] = None

    country_codes = enriched["cntr_code"].fillna("").astype(str).str.upper().str.strip()

    for iso in sorted(subdivision_codes):
        iso_codes = {"GB", "UK"} if iso == "GB" else {iso}
        detail_mask = country_codes.isin(iso_codes)
        if not detail_mask.any():
            print(f"[Subdivisions] Enrich {iso} skipped: no matching detailed geometries.")
            continue

        iso_context = context[context["__iso"].isin({"GB"} if iso == "GB" else {iso})].copy()
        if iso_context.empty:
            print(f"[Subdivisions] Enrich {iso} skipped: no Admin1 context geometries found.")
            continue

        targets = enriched.loc[detail_mask].copy().to_crs("EPSG:4326")
        targets["geometry"] = targets.geometry.representative_point()
        iso_context = iso_context.to_crs("EPSG:4326")
        try:
            joined = gpd.sjoin(
                targets,
                iso_context,
                how="left",
                predicate="within",
            )
        except Exception as exc:
            print(f"[Subdivisions] Enrich {iso} spatial join failed: {exc}")
            continue

        group_source_col = "__constituent_country" if iso == "GB" else "__admin1_name"
        group_series = joined[group_source_col].groupby(level=0).first()

        missing_groups = group_series.fillna("").astype(str).str.strip().eq("")
        if missing_groups.any():
            try:
                nearest = gpd.sjoin_nearest(
                    targets.loc[missing_groups].copy(),
                    iso_context,
                    how="left",
                    distance_col="distance",
                )
                nearest_groups = nearest[group_source_col].groupby(level=0).first()
                group_series.loc[nearest_groups.index] = nearest_groups
            except Exception as exc:
                print(f"[Subdivisions] Enrich {iso} nearest join fallback failed: {exc}")

        group_series = group_series.fillna("").astype(str).str.strip()
        group_series = group_series[group_series != ""]
        if group_series.empty:
            print(f"[Subdivisions] Enrich {iso} produced no admin1_group assignments.")
            continue

        enriched.loc[group_series.index, "admin1_group"] = group_series

        if iso == "JP":
            local_series = joined["__name_local"].groupby(level=0).first()
            local_series = local_series.fillna("").astype(str).str.strip()
            local_series = local_series[local_series != ""]
            if not local_series.empty:
                enriched.loc[local_series.index, "name_local"] = local_series

        if iso == "GB":
            const_series = joined["__constituent_country"].groupby(level=0).first()
            const_series = const_series.fillna("").astype(str).str.strip()
            const_series = const_series[const_series != ""]
            if not const_series.empty:
                enriched.loc[const_series.index, "constituent_country"] = const_series

        print(
            f"[Subdivisions] Enriched {iso}: mapped {len(group_series)} detailed geometries to admin1_group."
        )

    return enriched


def main() -> None:
    data = fetch_geojson(cfg.URL)
    gdf = build_geodataframe(data)
    gdf = clip_to_europe_bounds(gdf, "nuts")
    filtered = filter_countries(gdf)
    filtered = filtered.copy()
    filtered["geometry"] = filtered.geometry.simplify(
        tolerance=cfg.SIMPLIFY_NUTS3, preserve_topology=True
    )
    rivers_clipped = load_rivers()
    borders = fetch_ne_zip(cfg.BORDERS_URL, "borders")
    borders = clip_to_europe_bounds(borders, "borders")
    border_lines = build_border_lines()
    ocean = fetch_ne_zip(cfg.OCEAN_URL, "ocean")
    ocean = clip_to_europe_bounds(ocean, "ocean")
    ocean_clipped = clip_to_land_bounds(ocean, filtered, "ocean")
    ocean_clipped = ocean_clipped.copy()
    ocean_clipped["geometry"] = ocean_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    land_bg = fetch_ne_zip(cfg.LAND_BG_URL, "land")
    land_bg = clip_to_europe_bounds(land_bg, "land background")
    land_bg_clipped = clip_to_land_bounds(land_bg, filtered, "land background")
    land_bg_clipped = land_bg_clipped.copy()
    land_bg_clipped["geometry"] = land_bg_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_BACKGROUND, preserve_topology=True
    )
    urban_clipped = load_urban()
    # Aggressively simplify urban geometry to reduce render cost
    urban_clipped = urban_clipped.copy()
    urban_clipped["geometry"] = urban_clipped.geometry.simplify(
        tolerance=cfg.SIMPLIFY_URBAN, preserve_topology=True
    )
    physical_filtered = load_physical()
    if physical_filtered.empty:
        print("Physical regions filter returned empty dataset, keeping all clipped features.")
        physical_filtered = fetch_ne_zip(cfg.PHYSICAL_URL, "physical")
        physical_filtered = clip_to_europe_bounds(physical_filtered, "physical")
    # Simplify physical regions to reduce vertex count
    physical_filtered = physical_filtered.copy()
    physical_filtered["geometry"] = physical_filtered.geometry.simplify(
        tolerance=cfg.SIMPLIFY_PHYSICAL, preserve_topology=True
    )
    # Preserve key metadata for styling/labels
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

    # Build hybrid interactive layer (NUTS-3 + Admin-1 extension)
    nuts_name_col = "NUTS_NAME" if "NUTS_NAME" in filtered.columns else "NAME_LATN"
    nuts_hybrid = filtered.rename(
        columns={
            "NUTS_ID": "id",
            nuts_name_col: "name",
            "CNTR_CODE": "cntr_code",
        }
    )[["id", "name", "cntr_code", "geometry"]].copy()

    extension_hybrid = build_extension_admin1(filtered)
    hybrid = gpd.GeoDataFrame(
        pd.concat([nuts_hybrid, extension_hybrid], ignore_index=True),
        crs="EPSG:4326",
    )
    balkan_fallback = build_balkan_fallback(hybrid, admin0=borders)
    if not balkan_fallback.empty:
        hybrid = gpd.GeoDataFrame(
            pd.concat([hybrid, balkan_fallback], ignore_index=True),
            crs="EPSG:4326",
        )
    hybrid = apply_holistic_replacements(hybrid)
    hybrid = apply_russia_ukraine_replacement(hybrid)
    hybrid = apply_poland_replacement(hybrid)
    hybrid = apply_china_replacement(hybrid)
    special_zones = gpd.GeoDataFrame(
        columns=["id", "name", "type", "label", "claimants", "cntr_code", "geometry"],
        crs="EPSG:4326",
    )
    try:
        print("Downloading India ADM2 (raw) for special zones...")
        india_raw = fetch_or_load_geojson(
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
            china_gdf = hybrid[
                hybrid["cntr_code"].astype(str).str.upper() == "CN"
            ].copy()
            special_zones = build_special_zones(china_gdf, india_raw)
            if special_zones.empty:
                print("[Special Zones] No special zones were generated.")
            else:
                print(f"[Special Zones] Generated {len(special_zones)} special zones.")
    except Exception as exc:
        print(f"[Special Zones] Failed to build special zones; continuing without: {exc}")
    hybrid = apply_south_asia_replacement(hybrid, land_bg_clipped)
    final_hybrid = smart_island_cull(hybrid, group_col="id", threshold_km2=1000.0)

    final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("").astype(str).str.strip()
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    missing_mask = final_hybrid["cntr_code"].isna()
    if missing_mask.any() and "id" in final_hybrid.columns:
        final_hybrid.loc[missing_mask, "cntr_code"] = final_hybrid.loc[
            missing_mask, "id"
        ].apply(extract_country_code)
    final_hybrid["cntr_code"] = final_hybrid["cntr_code"].fillna("").astype(str).str.strip()
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None

    missing_mask = final_hybrid["cntr_code"].isna()
    if missing_mask.any():
        borders_ll = borders.to_crs("EPSG:4326")
        code_col = pick_column(
            borders_ll,
            ["iso_a2", "ISO_A2", "adm0_a2", "ADM0_A2", "iso_3166_1_", "ISO_3166_1_"],
        )
        if not code_col:
            print("Borders dataset missing ISO A2 column; spatial join skipped.")
        else:
            try:
                missing = final_hybrid.loc[missing_mask].copy().to_crs("EPSG:4326")
                missing["geometry"] = missing.geometry.representative_point()
                joined = gpd.sjoin(
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
        final_hybrid["cntr_code"]
        .fillna("")
        .astype(str)
        .str.strip()
        .str.upper()
    )
    final_hybrid.loc[final_hybrid["cntr_code"] == "", "cntr_code"] = None
    final_hybrid = apply_config_subdivisions(final_hybrid)

    filtered = crop_to_latitude_band(filtered, "land")
    rivers_clipped = crop_to_latitude_band(rivers_clipped, "rivers")
    border_lines = crop_to_latitude_band(border_lines, "border lines")
    ocean_clipped = crop_to_latitude_band(ocean_clipped, "ocean")
    land_bg_clipped = crop_to_latitude_band(land_bg_clipped, "land background")
    urban_clipped = crop_to_latitude_band(urban_clipped, "urban")
    physical_filtered = crop_to_latitude_band(physical_filtered, "physical")
    hybrid = crop_to_latitude_band(hybrid, "hybrid")
    final_hybrid = crop_to_latitude_band(final_hybrid, "political")
    special_zones = crop_to_latitude_band(special_zones, "special zones")

    script_dir = Path(__file__).resolve().parent
    output_dir = script_dir / "data"
    save_outputs(
        filtered,
        rivers_clipped,
        border_lines,
        ocean_clipped,
        land_bg_clipped,
        urban_clipped,
        physical_filtered,
        hybrid,
        final_hybrid,
        output_dir,
    )

    topology_path = output_dir / "europe_topology.json"
    build_topology(
        political=final_hybrid,
        ocean=ocean_clipped,
        land=land_bg_clipped,
        urban=urban_clipped,
        physical=physical_filtered,
        rivers=rivers_clipped,
        special_zones=special_zones,
        output_path=topology_path,
        quantization=100_000,
    )

    print("[INFO] Generating Hierarchy Data....")
    generate_hierarchy.main()

    print("[INFO] Syncing Translations....")
    translate_manager.main()

    print(f"Features with missing CNTR_CODE: {final_hybrid['cntr_code'].isnull().sum()}")
    print("Done.")


if __name__ == "__main__":
    main()
