"""Build stable city-level overrides for key Australian urban areas."""
from __future__ import annotations

from dataclasses import dataclass
import re

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from map_builder import config as cfg
from map_builder.geo.utils import ensure_crs
from map_builder.io.fetch import fetch_or_load_vector_archive

AREA_CRS = getattr(cfg, "AREA_CRS", "EPSG:6933")
ABS_SUA_INNER_GLOB = "SUA_2021_AUST_GDA94.shp"

AU_CITY_GROUP_BY_ID = {
    "AU_CITY_SYDNEY": "AU_New_South_Wales",
    "AU_CITY_PERTH": "AU_Western_Australia",
}


@dataclass(frozen=True)
class AuCitySpec:
    stable_id: str
    canonical_name: str
    parent_feature_id: str
    parent_group_name: str
    anchor_lon: float
    anchor_lat: float
    keywords: tuple[str, ...]


CITY_SPECS: tuple[AuCitySpec, ...] = (
    AuCitySpec(
        stable_id="AU_CITY_SYDNEY",
        canonical_name="Sydney",
        parent_feature_id="AU_ADM1_AUS-2654",
        parent_group_name="New South Wales",
        anchor_lon=151.2093,
        anchor_lat=-33.8688,
        keywords=("sydney", "greater sydney"),
    ),
    AuCitySpec(
        stable_id="AU_CITY_PERTH",
        canonical_name="Perth",
        parent_feature_id="AU_ADM1_AUS-2651",
        parent_group_name="Western Australia",
        anchor_lon=115.8605,
        anchor_lat=-31.9505,
        keywords=("perth", "greater perth"),
    ),
)

NAME_COLUMNS = ("SUA_NAME21", "SUA_NAME", "name")


def _normalize(text: object) -> str:
    value = str(text or "").strip().lower()
    if not value:
        return ""
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def _make_valid_geom(geom):
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


def _sanitize_polygon_layer(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    clean = ensure_crs(gdf.copy())
    clean["geometry"] = clean.geometry.apply(_make_valid_geom)
    clean = clean[clean.geometry.notna() & ~clean.geometry.is_empty].copy()
    if clean.empty:
        return clean
    clean = clean[clean.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    return clean


def _with_area_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    projected = gdf.to_crs(AREA_CRS)
    scored = gdf.copy()
    scored["__area_metric"] = projected.geometry.area.abs()
    return scored


def _sua_name_column(gdf: gpd.GeoDataFrame) -> str:
    for column in NAME_COLUMNS:
        if column in gdf.columns:
            return column
    raise ValueError(f"ABS SUA source missing name column. Available columns: {gdf.columns.tolist()}")


def _load_abs_sua_boundaries() -> gpd.GeoDataFrame:
    source = fetch_or_load_vector_archive(
        cfg.ABS_SUA_2021_GDA94_URL,
        cfg.ABS_SUA_2021_GDA94_FILENAME,
        fallback_urls=list(getattr(cfg, "ABS_SUA_2021_GDA94_FALLBACK_URLS", []) or []),
        inner_glob=ABS_SUA_INNER_GLOB,
    )
    source = ensure_crs(source)
    source = _sanitize_polygon_layer(source)
    if source.empty:
        raise ValueError("ABS SUA source is empty after sanitize.")
    return source


def _select_city_geometry(source: gpd.GeoDataFrame, spec: AuCitySpec) -> object:
    name_col = _sua_name_column(source)
    normalized_name = source[name_col].fillna("").astype(str).map(_normalize)

    exact = source[normalized_name == _normalize(spec.canonical_name)].copy()
    if exact.empty:
        keywords = tuple(_normalize(keyword) for keyword in spec.keywords if _normalize(keyword))
        exact = source[
            normalized_name.map(
                lambda value: any(keyword in value for keyword in keywords) if value else False
            )
        ].copy()
    if exact.empty:
        raise ValueError(f"ABS SUA source has no row for {spec.canonical_name}.")

    anchor = Point(spec.anchor_lon, spec.anchor_lat)
    anchored = exact[exact.geometry.apply(lambda geom: bool(geom is not None and geom.covers(anchor)))].copy()
    candidates = anchored if not anchored.empty else exact
    candidates = _with_area_metric(candidates)
    selected = candidates.nsmallest(1, "__area_metric")
    geometry = _make_valid_geom(selected.geometry.iloc[0])
    if geometry is None or geometry.is_empty:
        raise ValueError(f"ABS SUA geometry is invalid for {spec.canonical_name}.")
    return geometry


def apply_au_city_overrides(detail_gdf: gpd.GeoDataFrame, *, strict: bool = True) -> gpd.GeoDataFrame:
    if detail_gdf.empty:
        return detail_gdf
    if "id" not in detail_gdf.columns or "cntr_code" not in detail_gdf.columns:
        return detail_gdf

    source = ensure_crs(detail_gdf.copy())
    country_codes = source["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    au_mask = country_codes == "AU"
    if not au_mask.any():
        return source

    working = source.loc[au_mask].copy().reset_index(drop=True)
    other = source.loc[~au_mask].copy()
    if working.empty:
        return source

    sua = _load_abs_sua_boundaries()
    new_rows = []
    missing: list[str] = []

    for spec in CITY_SPECS:
        parent_mask = working["id"].fillna("").astype(str).str.strip() == spec.parent_feature_id
        if not parent_mask.any():
            missing.append(spec.parent_feature_id)
            continue

        parent_index = working[parent_mask].index[0]
        parent_row = working.loc[parent_index].copy()
        parent_geom = _make_valid_geom(parent_row.geometry)
        if parent_geom is None or parent_geom.is_empty:
            raise ValueError(f"Parent geometry is invalid for {spec.parent_feature_id}.")

        city_geom = _select_city_geometry(sua, spec)
        city_geom = _make_valid_geom(city_geom.intersection(parent_geom))
        if city_geom is None or city_geom.is_empty:
            raise ValueError(f"{spec.canonical_name} does not intersect parent feature {spec.parent_feature_id}.")

        remainder_geom = _make_valid_geom(parent_geom.difference(city_geom))
        if remainder_geom is None or remainder_geom.is_empty:
            raise ValueError(f"{spec.parent_feature_id} remainder is empty after carving {spec.canonical_name}.")

        working.at[parent_index, "geometry"] = remainder_geom
        city_row = parent_row.copy()
        city_row["id"] = spec.stable_id
        city_row["name"] = spec.canonical_name
        city_row["admin1_group"] = spec.parent_group_name
        city_row["detail_tier"] = "city_override"
        city_row["geometry"] = city_geom
        new_rows.append(city_row)

    if missing and strict:
        raise ValueError(f"Missing AU parent features for city overrides: {', '.join(missing)}")

    working = _sanitize_polygon_layer(working)
    additions = (
        gpd.GeoDataFrame(new_rows, geometry="geometry", crs="EPSG:4326")
        if new_rows
        else gpd.GeoDataFrame(columns=working.columns, geometry="geometry", crs="EPSG:4326")
    )
    additions = _sanitize_polygon_layer(additions)
    if strict and len(additions) != len(CITY_SPECS):
        raise ValueError(
            f"AU city override count mismatch: expected {len(CITY_SPECS)}, got {len(additions)}"
        )

    combined = gpd.GeoDataFrame(pd.concat([other, working, additions], ignore_index=True), crs="EPSG:4326")
    if combined["id"].duplicated().any():
        duplicates = combined.loc[combined["id"].duplicated(), "id"].astype(str).tolist()[:10]
        raise ValueError(f"Duplicate IDs detected after AU city overrides: {duplicates}")
    return combined
