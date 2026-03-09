"""Russia/Ukraine hybrid replacement processor."""
from __future__ import annotations

import geopandas as gpd
import pandas as pd
from shapely.geometry import box
from shapely.ops import unary_union

from map_builder import config as cfg
from map_builder.io.fetch import fetch_or_load_geojson


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def _make_valid(geom):
    if geom is None or geom.is_empty:
        return None
    try:
        if hasattr(geom, "make_valid"):
            geom = geom.make_valid()
        else:
            geom = geom.buffer(0)
    except Exception:
        try:
            geom = geom.buffer(0)
        except Exception:
            return None
    if geom is None or geom.is_empty:
        return None
    return geom


def _sanitize_polygons(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    clean = _ensure_epsg4326(gdf.copy())
    clean["geometry"] = clean.geometry.apply(_make_valid)
    clean = clean[clean.geometry.notna() & ~clean.geometry.is_empty].copy()
    if clean.empty:
        return clean
    clean = clean[clean.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    return clean


def _clip_features_to_shell(
    detail_gdf: gpd.GeoDataFrame,
    shell_gdf: gpd.GeoDataFrame,
    *,
    label: str,
) -> gpd.GeoDataFrame:
    if detail_gdf.empty or shell_gdf.empty:
        return detail_gdf

    shell = _sanitize_polygons(shell_gdf)
    if shell.empty:
        return detail_gdf
    shell_union = _make_valid(unary_union(shell.geometry.tolist()))
    if shell_union is None or shell_union.is_empty:
        return detail_gdf

    clipped = _sanitize_polygons(detail_gdf)
    if clipped.empty:
        return detail_gdf
    clipped["geometry"] = clipped.geometry.apply(
        lambda geom: _make_valid(geom.intersection(shell_union)) if geom is not None else None
    )
    clipped = clipped[clipped.geometry.notna() & ~clipped.geometry.is_empty].copy()
    if clipped.empty:
        print(f"[RU/UA] {label} shell clip produced empty result; keeping original detail.")
        return detail_gdf
    return clipped


def _restore_missing_shell_fragments(
    detail_gdf: gpd.GeoDataFrame,
    shell_gdf: gpd.GeoDataFrame,
    *,
    country_code: str,
    id_prefix: str,
    name_prefix: str,
    simplify_tolerance: float,
) -> gpd.GeoDataFrame:
    if detail_gdf.empty or shell_gdf.empty:
        return detail_gdf

    detail = _sanitize_polygons(detail_gdf)
    shell = _sanitize_polygons(shell_gdf)
    if detail.empty or shell.empty:
        return detail_gdf

    shell_union = _make_valid(unary_union(shell.geometry.tolist()))
    detail_union = _make_valid(unary_union(detail.geometry.tolist()))
    if shell_union is None or shell_union.is_empty or detail_union is None or detail_union.is_empty:
        return detail_gdf

    missing = _make_valid(shell_union.difference(detail_union))
    if missing is None or missing.is_empty:
        return detail_gdf

    fallback = gpd.GeoDataFrame(geometry=[missing], crs="EPSG:4326")
    fallback = fallback.explode(index_parts=False, ignore_index=True)
    fallback["geometry"] = fallback.geometry.apply(_make_valid)
    fallback = fallback[fallback.geometry.notna() & ~fallback.geometry.is_empty].copy()
    if fallback.empty:
        return detail_gdf
    fallback = fallback[fallback.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if fallback.empty:
        return detail_gdf

    try:
        projected = fallback.to_crs(cfg.AREA_CRS)
        fallback["__area_km2"] = projected.geometry.area / 1_000_000.0
        fallback = fallback[fallback["__area_km2"] >= cfg.MIN_VISIBLE_AREA_KM2].copy()
    except Exception:
        fallback["__area_km2"] = None
    if fallback.empty:
        return detail_gdf

    fallback["id"] = [f"{id_prefix}_{idx:03d}" for idx in range(1, len(fallback) + 1)]
    fallback["name"] = [f"{name_prefix} {idx}" for idx in range(1, len(fallback) + 1)]
    fallback["cntr_code"] = country_code
    fallback["geometry"] = fallback.geometry.simplify(
        tolerance=simplify_tolerance,
        preserve_topology=True,
    )
    fallback = fallback[["id", "name", "cntr_code", "geometry"]].copy()

    merged = gpd.GeoDataFrame(pd.concat([detail_gdf, fallback], ignore_index=True), crs="EPSG:4326")
    print(f"[RU/UA] Restored {len(fallback)} {country_code} shell fallback fragment(s).")
    return merged


def apply_russia_ukraine_replacement(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "cntr_code" not in main_gdf.columns:
        print("[RU/UA] cntr_code missing; skipping replacement.")
        return main_gdf

    base = main_gdf[
        ~main_gdf["cntr_code"].astype(str).str.upper().isin({"RU", "UA"})
    ].copy()

    # Russia: replace the country with full ADM2 coverage, then re-apply city overrides.
    ru_all = main_gdf[main_gdf["cntr_code"].astype(str).str.upper() == "RU"].copy()
    ru_shell = ru_all.copy()
    if "id" not in ru_all.columns:
        ru_all["id"] = ""
    ru_all["id"] = ru_all["id"].fillna("").astype(str).str.strip()
    city_mask = ru_all["id"].str.startswith("RU_CITY_")
    ru_city_overrides = ru_all[city_mask].copy()

    print("Downloading Russia ADM2 (geoBoundaries)...")
    ru_gdf = fetch_or_load_geojson(
        cfg.RUS_ADM2_URL,
        cfg.RUS_ADM2_FILENAME,
        fallback_urls=cfg.RUS_ADM2_FALLBACK_URLS,
    )
    if ru_gdf.empty:
        print("Russia ADM2 GeoDataFrame is empty.")
        raise SystemExit(1)
    if ru_gdf.crs is None:
        ru_gdf = ru_gdf.set_crs("EPSG:4326", allow_override=True)
    if ru_gdf.crs.to_epsg() != 4326:
        ru_gdf = ru_gdf.to_crs("EPSG:4326")
    # Clip to prevent dateline wrapping artifacts (keep Russia in Eastern Hemisphere)
    clip_box = box(-20.0, 0.0, 179.99, 90.0)
    try:
        ru_gdf = gpd.clip(ru_gdf, clip_box)
    except Exception as exc:
        print(f"RU ADM2 clip failed; continuing without clip: {exc}")
    if "shapeID" not in ru_gdf.columns or "shapeName" not in ru_gdf.columns:
        raise ValueError(
            "Russia ADM2 dataset missing expected columns: shapeID/shapeName. "
            f"Available: {ru_gdf.columns.tolist()}"
        )
    ru_gdf = ru_gdf.copy()
    ru_gdf["id"] = "RU_RAY_" + ru_gdf["shapeID"].astype(str)
    ru_gdf["name"] = ru_gdf["shapeName"].astype(str)
    ru_gdf["cntr_code"] = "RU"
    ru_gdf = ru_gdf[["id", "name", "cntr_code", "geometry"]].copy()
    ru_gdf["geometry"] = ru_gdf.geometry.simplify(
        tolerance=cfg.SIMPLIFY_RU_UA, preserve_topology=True
    )
    ru_combined = gpd.GeoDataFrame(
        pd.concat([ru_gdf, ru_city_overrides], ignore_index=True),
        crs=main_gdf.crs,
    )
    ru_combined = _clip_features_to_shell(ru_combined, ru_shell, label="Russia")
    ru_combined = _restore_missing_shell_fragments(
        ru_combined,
        ru_shell,
        country_code="RU",
        id_prefix="RU_ARCTIC_FB",
        name_prefix="Russia Arctic Fallback",
        simplify_tolerance=cfg.SIMPLIFY_RU_UA,
    )

    # Ukraine: full ADM2 replacement
    print("Downloading Ukraine ADM2 (geoBoundaries)...")
    ua_gdf = fetch_or_load_geojson(
        cfg.UKR_ADM2_URL,
        cfg.UKR_ADM2_FILENAME,
        fallback_urls=cfg.UKR_ADM2_FALLBACK_URLS,
    )
    if ua_gdf.empty:
        print("Ukraine ADM2 GeoDataFrame is empty.")
        raise SystemExit(1)
    if ua_gdf.crs is None:
        ua_gdf = ua_gdf.set_crs("EPSG:4326", allow_override=True)
    if ua_gdf.crs.to_epsg() != 4326:
        ua_gdf = ua_gdf.to_crs("EPSG:4326")
    if "shapeID" not in ua_gdf.columns or "shapeName" not in ua_gdf.columns:
        raise ValueError(
            "Ukraine ADM2 dataset missing expected columns: shapeID/shapeName. "
            f"Available: {ua_gdf.columns.tolist()}"
        )
    ua_gdf = ua_gdf.copy()
    ua_gdf["id"] = "UA_RAY_" + ua_gdf["shapeID"].astype(str)
    ua_gdf["name"] = ua_gdf["shapeName"].astype(str)
    ua_gdf["cntr_code"] = "UA"
    ua_gdf = ua_gdf[["id", "name", "cntr_code", "geometry"]].copy()
    ua_gdf["geometry"] = ua_gdf.geometry.simplify(
        tolerance=cfg.SIMPLIFY_RU_UA, preserve_topology=True
    )

    combined = pd.concat([base, ru_combined, ua_gdf], ignore_index=True)
    print(
        f"[RU/UA] Replacement: RU full ADM2 {len(ru_gdf)}, RU cities {len(ru_city_overrides)}, "
        f"RU final {len(ru_combined)}, UA ADM2 {len(ua_gdf)}."
    )
    return gpd.GeoDataFrame(combined, crs=main_gdf.crs)
