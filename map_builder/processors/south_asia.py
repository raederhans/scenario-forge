"""South Asia expansion processor (India ADM2 + extensions)."""
from __future__ import annotations

import geopandas as gpd
import pandas as pd

from map_builder import config as cfg
from map_builder.geo.utils import pick_column
from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_geojson


DEFERRED_ISLAND_SHAPE_IDS = {
    "76128533B28397307540277",  # North & Middle Andaman
    "76128533B22587307937261",  # South Andaman
    "76128533B33103505211400",  # Nicobars
    "76128533B41477629049356",  # Lakshadweep
}


def exclude_deferred_island_districts(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Exclude the reviewed source island districts without culling mainland."""
    return gdf.loc[~gdf["shapeID"].astype(str).isin(DEFERRED_ISLAND_SHAPE_IDS)].copy()


def apply_south_asia_replacement(hybrid_gdf: gpd.GeoDataFrame, land_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if hybrid_gdf.empty:
        return hybrid_gdf
    if "cntr_code" not in hybrid_gdf.columns:
        print("[South Asia] cntr_code missing; skipping replacement.")
        return hybrid_gdf

    base = hybrid_gdf[hybrid_gdf["cntr_code"].astype(str).str.upper() != "IN"].copy()

    print("Downloading India ADM2 (geoBoundaries)...")
    ind_gdf = fetch_or_load_geojson(
        cfg.IND_ADM2_URL,
        cfg.IND_ADM2_FILENAME,
        fallback_urls=cfg.IND_ADM2_FALLBACK_URLS,
    )

    if ind_gdf.empty:
        print("India ADM2 GeoDataFrame is empty.")
        raise SystemExit(1)

    if ind_gdf.crs is None:
        ind_gdf = ind_gdf.set_crs("EPSG:4326", allow_override=True)
    if ind_gdf.crs.to_epsg() != 4326:
        ind_gdf = ind_gdf.to_crs("EPSG:4326")

    if "shapeID" not in ind_gdf.columns or "shapeName" not in ind_gdf.columns:
        raise ValueError(
            "India ADM2 dataset missing expected columns: shapeID/shapeName. "
            f"Available: {ind_gdf.columns.tolist()}"
        )

    ind_gdf["adm1_name"] = ""

    ind_gdf = exclude_deferred_island_districts(ind_gdf)

    # Spatial join ADM2 -> ADM1 to derive state names
    try:
        print("[South Asia] Loading India ADM1 for hierarchy names...")
        adm1 = fetch_ne_zip(cfg.ADMIN1_URL, "admin1_india")
        if not adm1.empty:
            adm1 = adm1.to_crs("EPSG:4326")
            iso_col = pick_column(adm1, ["iso_a2", "adm0_a2", "iso_3166_1_", "iso_3166_1_alpha_2"])
            name_col = pick_column(
                adm1,
                ["name", "name_en", "name_long", "name_local", "gn_name", "namealt"],
            )
            admin_col = pick_column(adm1, ["admin", "adm0_name", "admin0_name"])

            if name_col:
                if iso_col:
                    adm1 = adm1[adm1[iso_col] == "IN"].copy()
                elif admin_col:
                    adm1 = adm1[adm1[admin_col].str.contains("India", case=False, na=False)].copy()

                if not adm1.empty:
                    adm1 = adm1[[name_col, "geometry"]].copy()
                    joined = gpd.sjoin(ind_gdf, adm1, how="left", predicate="intersects")
                    if name_col in joined.columns and not joined[name_col].isna().all():
                        name_map = joined[name_col].groupby(level=0).first()
                        ind_gdf["adm1_name"] = (
                            ind_gdf.index.to_series().map(name_map).fillna(ind_gdf["adm1_name"])
                        )
                    else:
                        print("[South Asia] ADM1 join returned no matches; adm1_name left empty.")
                else:
                    print("[South Asia] ADM1 filter returned empty; adm1_name left empty.")
            else:
                print("[South Asia] ADM1 name column missing; adm1_name left empty.")
        else:
            print("[South Asia] ADM1 GeoDataFrame empty; adm1_name left empty.")
    except Exception as exc:
        print(f"[South Asia] ADM1 join failed; adm1_name left empty: {exc}")

    # Clip India against China geometry to avoid overlaps
    china_geom = None
    try:
        china = hybrid_gdf[hybrid_gdf["cntr_code"].astype(str).str.upper() == "CN"]
        if not china.empty:
            china_geom = china.unary_union
    except Exception:
        china_geom = None

    if china_geom is not None and not china_geom.is_empty:
        try:
            ind_gdf["geometry"] = ind_gdf.geometry.apply(lambda geom: geom.difference(china_geom))
        except Exception as exc:
            print(f"[South Asia] China clip failed; continuing without: {exc}")

    # Simplify India ADM2
    ind_gdf = ind_gdf[ind_gdf.geometry.notna() & ~ind_gdf.geometry.is_empty].copy()
    ind_gdf["geometry"] = ind_gdf.geometry.simplify(
        tolerance=cfg.SIMPLIFY_INDIA, preserve_topology=True
    )

    ind_gdf["id"] = "IN_ADM2_" + ind_gdf["shapeID"].astype(str)
    ind_gdf["name"] = ind_gdf["shapeName"].astype(str)
    ind_gdf["cntr_code"] = "IN"
    ind_gdf = ind_gdf[["id", "name", "cntr_code", "adm1_name", "geometry"]].copy()

    combined = pd.concat([base, ind_gdf], ignore_index=True)
    print(f"[South Asia] India ADM2 loaded: {len(ind_gdf)} features.")
    return gpd.GeoDataFrame(combined, crs=hybrid_gdf.crs)
