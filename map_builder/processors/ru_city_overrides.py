"""Build stable city-level overrides for key Russian urban areas."""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable

import geopandas as gpd
from shapely.geometry import Point

AREA_CRS = "EPSG:6933"

RU_CITY_GROUP_BY_ID = {
    "RU_CITY_MOSCOW": "RU_Moscow",
    "RU_CITY_SAINT_PETERSBURG": "RU_Saint_Petersburg",
    "RU_CITY_VOLGOGRAD": "RU_Volgograd",
    "RU_CITY_ARKHANGELSK": "RU_Arkhangelsk",
}


@dataclass(frozen=True)
class RuCitySpec:
    stable_id: str
    canonical_name: str
    lon: float
    lat: float
    preferred_source: str
    keywords: tuple[str, ...]


CITY_SPECS: tuple[RuCitySpec, ...] = (
    RuCitySpec(
        stable_id="RU_CITY_MOSCOW",
        canonical_name="Moscow",
        lon=37.6173,
        lat=55.7558,
        preferred_source="admin1",
        keywords=("moskva", "moscow"),
    ),
    RuCitySpec(
        stable_id="RU_CITY_SAINT_PETERSBURG",
        canonical_name="Saint Petersburg",
        lon=30.3351,
        lat=59.9343,
        preferred_source="admin1",
        keywords=(
            "st petersburg",
            "st petersburg city",
            "city of st petersburg",
            "saint petersburg",
            "sankt peterburg",
        ),
    ),
    RuCitySpec(
        stable_id="RU_CITY_VOLGOGRAD",
        canonical_name="Volgograd",
        lon=44.5169,
        lat=48.7071,
        preferred_source="adm2",
        keywords=("volgograd", "\u0432\u043e\u043b\u0433\u043e\u0433\u0440\u0430\u0434"),
    ),
    RuCitySpec(
        stable_id="RU_CITY_ARKHANGELSK",
        canonical_name="Arkhangelsk",
        lon=40.5158,
        lat=64.5399,
        preferred_source="adm2",
        keywords=("arkhangelsk", "\u0430\u0440\u0445\u0430\u043d\u0433\u0435\u043b\u044c\u0441"),
    ),
)

ADMIN1_NAME_COLUMNS = (
    "name",
    "name_en",
    "gn_name",
    "name_long",
    "name_local",
    "name_ja",
    "NAME",
    "NAME_EN",
)
ADMIN1_ISO_COLUMNS = ("iso_a2", "adm0_a2", "iso_3166_1_", "ISO_A2", "ADM0_A2")
ADM2_NAME_COLUMNS = ("shapeName", "name", "name_en", "NAME")
ADM2_GROUP_COLUMNS = ("shapeGroup", "shapeISO", "shapeType")


def _to_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _normalize(text: object) -> str:
    value = str(text or "").strip().lower()
    if not value:
        return ""
    value = value.replace("st.", "st ")
    value = re.sub(r"[^a-z0-9\u0400-\u04ff]+", " ", value)
    return " ".join(value.split())


def _pick_columns(gdf: gpd.GeoDataFrame, candidates: Iterable[str]) -> list[str]:
    return [col for col in candidates if col in gdf.columns]


def _filter_ru_admin1(admin1: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    filtered = admin1.copy()
    iso_cols = _pick_columns(filtered, ADMIN1_ISO_COLUMNS)
    if not iso_cols:
        return filtered
    iso_values = filtered[iso_cols].fillna("").astype(str).apply(lambda s: s.str.upper().str.strip())
    mask = iso_values.isin({"RU", "RUS"}).any(axis=1)
    filtered = filtered[mask].copy()
    return filtered


def _filter_ru_adm2(adm2: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    filtered = adm2.copy()
    group_cols = _pick_columns(filtered, ADM2_GROUP_COLUMNS)
    if not group_cols:
        return filtered
    values = filtered[group_cols].fillna("").astype(str).apply(lambda s: s.str.upper().str.strip())
    mask = values.isin({"RU", "RUS"}).any(axis=1)
    filtered = filtered[mask].copy()
    return filtered


def _with_area_metric(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    projected = gdf.to_crs(AREA_CRS)
    scored = gdf.copy()
    scored["__area_metric"] = projected.geometry.area.abs()
    return scored


def _best_by_anchor(gdf: gpd.GeoDataFrame, spec: RuCitySpec) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    point = Point(spec.lon, spec.lat)
    contained = gdf[gdf.geometry.contains(point)].copy()
    if contained.empty:
        return contained
    contained = _with_area_metric(contained)
    return contained.nsmallest(1, "__area_metric")


def _best_by_keyword(
    gdf: gpd.GeoDataFrame,
    keyword_values: tuple[str, ...],
    candidate_name_cols: list[str],
) -> gpd.GeoDataFrame:
    if gdf.empty or not candidate_name_cols:
        return gdf.iloc[0:0].copy()

    normalized_keywords = tuple(_normalize(value) for value in keyword_values if _normalize(value))
    if not normalized_keywords:
        return gdf.iloc[0:0].copy()

    def row_matches(row) -> bool:
        for col in candidate_name_cols:
            value = _normalize(row.get(col, ""))
            if not value:
                continue
            if any(key in value for key in normalized_keywords):
                return True
        return False

    matched = gdf[gdf.apply(row_matches, axis=1)].copy()
    if matched.empty:
        return matched
    matched = _with_area_metric(matched)
    return matched.nsmallest(1, "__area_metric")


def _select_city_feature(
    spec: RuCitySpec,
    adm2_ru: gpd.GeoDataFrame,
    admin1_ru: gpd.GeoDataFrame,
) -> tuple[gpd.GeoDataFrame, str]:
    admin1_name_cols = _pick_columns(admin1_ru, ADMIN1_NAME_COLUMNS)
    adm2_name_cols = _pick_columns(adm2_ru, ADM2_NAME_COLUMNS)

    source_order = ("admin1", "adm2") if spec.preferred_source == "admin1" else ("adm2", "admin1")

    for source in source_order:
        source_gdf = admin1_ru if source == "admin1" else adm2_ru
        name_cols = admin1_name_cols if source == "admin1" else adm2_name_cols
        anchored = _best_by_anchor(source_gdf, spec)
        if not anchored.empty:
            return anchored, source

        matched = _best_by_keyword(source_gdf, spec.keywords, name_cols)
        if not matched.empty:
            return matched, source

    return adm2_ru.iloc[0:0].copy(), ""


def build_ru_city_overrides(
    ru_adm2: gpd.GeoDataFrame,
    ru_admin1: gpd.GeoDataFrame,
    *,
    strict: bool = True,
) -> gpd.GeoDataFrame:
    """Return standardized city-level RU overrides with stable IDs."""
    adm2 = _to_epsg4326(ru_adm2.copy())
    adm2 = adm2[adm2.geometry.notna() & ~adm2.geometry.is_empty].copy()
    adm2 = _filter_ru_adm2(adm2)

    admin1 = _to_epsg4326(ru_admin1.copy())
    admin1 = admin1[admin1.geometry.notna() & ~admin1.geometry.is_empty].copy()
    admin1 = _filter_ru_admin1(admin1)

    rows = []
    missing = []
    for spec in CITY_SPECS:
        selected, source = _select_city_feature(spec, adm2, admin1)
        if selected.empty:
            missing.append(spec.stable_id)
            continue

        row = selected.iloc[0]
        rows.append(
            {
                "id": spec.stable_id,
                "name": spec.canonical_name,
                "cntr_code": "RU",
                "city_source": source,
                "geometry": row.geometry,
            }
        )

    if missing and strict:
        raise ValueError(f"Missing RU city overrides for: {', '.join(missing)}")

    if not rows:
        return gpd.GeoDataFrame(
            columns=["id", "name", "cntr_code", "city_source", "geometry"],
            crs="EPSG:4326",
        )

    overrides = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    overrides = overrides[overrides.geometry.notna() & ~overrides.geometry.is_empty].copy()
    return overrides

