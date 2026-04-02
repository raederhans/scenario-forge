"""City asset generation helpers for the map build pipeline."""
from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
import zipfile
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from map_builder import config as cfg
from map_builder.io.fetch import fetch_or_cache_binary
from map_builder.io.readers import load_populated_places, read_json_optional
from map_builder.io.writers import write_json_atomic


GEONAMES_COLUMNS = [
    "geonameid",
    "name",
    "asciiname",
    "alternatenames",
    "latitude",
    "longitude",
    "feature_class",
    "feature_code",
    "country_code",
    "cc2",
    "admin1_code",
    "admin2_code",
    "admin3_code",
    "admin4_code",
    "population",
    "elevation",
    "dem",
    "timezone",
    "modification_date",
]

COUNTRY_CAPITAL_CODES = {"PPLC"}
ADMIN_CAPITAL_CODES = {"PPLA", "PPLA2", "PPLA3", "PPLA4"}
ALIAS_LIMIT = 24
ALIAS_SAMPLE_LIMIT = 200
CITY_TIER_WEIGHT = {"minor": 1, "regional": 2, "major": 3}
CITY_SOURCE_PRIORITY = {"merged": 0, "natural_earth": 1, "geonames": 2}
# Deprecated: use SCENARIO_MANUAL_CAPITALS instead.
TNO_MANUAL_CAPITALS = {
    "GER": "Berlin",
    "USA": "Washington, D.C.",
    "RKM": "Moscow",
    "SAM": "Samara",
    "OMS": "Omsk",
    "PRM": "Perm",
    "NOV": "Novosibirsk",
    "TOM": "Tomsk",
    "TYM": "Tyumen",
    "ORE": "Orenburg",
    "KOM": "Syktyvkar",
    "SBA": "Novosibirsk",
}
# Deprecated: use SCENARIO_CITY_RENAMES instead.
TNO_CITY_RENAMES = {
    "Saint Petersburg": {
        "display_name": {"en": "Leningrad", "zh": "列宁格勒"},
        "aliases": ["Leningrad"],
        "tier": "major",
        "hidden": False,
    },
    "Nizhniy Novgorod": {
        "display_name": {"en": "Gorky", "zh": "高尔基"},
        "aliases": ["Gorky"],
        "tier": "regional",
        "hidden": False,
    },
    "Yekaterinburg": {
        "display_name": {"en": "Sverdlovsk", "zh": "斯维尔德洛夫斯克"},
        "aliases": ["Sverdlovsk"],
        "tier": "regional",
        "hidden": False,
    },
}


SCENARIO_MANUAL_CAPITALS = {
    "tno_1962": {
        "GER": "Berlin",
        "USA": "Washington, D.C.",
        "RKM": "Moscow",
        "SAM": "Samara",
        "OMS": "Omsk",
        "PRM": "Perm",
        "NOV": "Novosibirsk",
        "TOM": "Tomsk",
        "TYM": "Tyumen",
        "ORE": "Orenburg",
        "OUR": "Orenburg",
        "KOM": "Syktyvkar",
        "SBA": "Novosibirsk",
        "RUR": "Kemerovo",
        "RKP": "Warsaw",
        "RKNO": "Oslo",
        "AST": "Canberra",
        "SAF": "Pretoria",
        "HOL": "Paramaribo",
        "GEA": "Dar es Salaam",
        "GCO": "Kinshasa",
        "GSW": "Windhoek",
        "ARE": "Abu Dhabi",
        "BHR": "Manama",
        "QAT": "Doha",
        "PAK": "Islamabad",
        "RSF": "Magadan",
        "PFC": "Petropavlovsk-Kamchatsky",
        "FIC": "Tynda",
    },
}
SOVIET_ERA_CITY_RENAMES = {
    "Saint Petersburg": {
        "display_name": {"en": "Leningrad", "zh": "列宁格勒"},
        "aliases": ["Leningrad"],
        "tier": "major",
        "hidden": False,
    },
    "Nizhniy Novgorod": {
        "display_name": {"en": "Gorky", "zh": "高尔基"},
        "aliases": ["Gorky"],
        "tier": "regional",
        "hidden": False,
    },
    "Yekaterinburg": {
        "display_name": {"en": "Sverdlovsk", "zh": "斯维尔德洛夫斯克"},
        "aliases": ["Sverdlovsk"],
        "tier": "regional",
        "hidden": False,
    },
    "Volgograd": {
        "display_name": {"en": "Stalingrad", "zh": "斯大林格勒"},
        "aliases": ["Stalingrad"],
        "tier": "major",
        "hidden": False,
    },
}
SCENARIO_CITY_RENAMES = {
    "hoi4_1936": SOVIET_ERA_CITY_RENAMES,
    "hoi4_1939": SOVIET_ERA_CITY_RENAMES,
}


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    try:
        if bool(pd.isna(value)):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value or "").strip()


def _normalize_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", _clean_text(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold()
    text = re.sub(r"[\u2018\u2019]", "'", text)
    text = re.sub(r"[^a-z0-9']+", " ", text)
    return " ".join(text.split())


def _split_alias_field(raw_value: object) -> list[str]:
    text = _clean_text(raw_value)
    if not text:
        return []
    parts = re.split(r"[|,;/]+", text)
    return [part.strip() for part in parts if part and part.strip()]


def _coerce_text_list(raw_value: object) -> list[str]:
    if raw_value is None:
        return []
    if isinstance(raw_value, str):
        return [raw_value]
    try:
        if bool(pd.isna(raw_value)):
            return []
    except (TypeError, ValueError):
        pass
    if isinstance(raw_value, (list, tuple, set)):
        return [_clean_text(value) for value in raw_value if _clean_text(value)]
    if hasattr(raw_value, "tolist"):
        converted = raw_value.tolist()
        if isinstance(converted, list):
            return [_clean_text(value) for value in converted if _clean_text(value)]
    clean = _clean_text(raw_value)
    return [clean] if clean else []


def _trim_aliases(values: list[str], primary_name: str, ascii_name: str) -> list[str]:
    prioritized = []
    if primary_name:
        prioritized.append(primary_name)
    if ascii_name and ascii_name != primary_name:
        prioritized.append(ascii_name)
    prioritized.extend(values)

    trimmed: list[str] = []
    normalized_seen: set[str] = set()
    for value in prioritized:
        clean = _clean_text(value)
        if not clean or len(clean) > 96:
            continue
        normalized = _normalize_text(clean)
        if not normalized or normalized in normalized_seen:
            continue
        normalized_seen.add(normalized)
        trimmed.append(clean)
        if len(trimmed) >= ALIAS_LIMIT:
            break
    return trimmed


def _capital_kind_from_geonames(feature_code: str) -> str:
    code = _clean_text(feature_code).upper()
    if code in COUNTRY_CAPITAL_CODES:
        return "country_capital"
    if code in ADMIN_CAPITAL_CODES:
        return "admin_capital"
    return "place"


def _capital_kind_from_natural_earth(featurecla: str) -> str:
    value = _clean_text(featurecla).casefold()
    if value in {"admin-0 capital", "admin-0 capital alt"}:
        return "country_capital"
    if "capital" in value:
        return "admin_capital"
    return "place"


def _capital_score(capital_kind: object) -> int:
    value = _clean_text(capital_kind)
    if value == "country_capital":
        return 3
    if value == "admin_capital":
        return 2
    return 1


def _guess_base_tier(
    *,
    population: int,
    capital_kind: object,
    is_world_city: bool,
) -> str:
    capital_score = _capital_score(capital_kind)
    if capital_score >= 3 or population >= 1_500_000 or is_world_city:
        return "major"
    if capital_score >= 2 or population >= 350_000:
        return "regional"
    return "minor"


def _guess_min_zoom(base_tier: str, capital_kind: object) -> float:
    if _capital_score(capital_kind) >= 3 or base_tier == "major":
        return 0.8
    if base_tier == "regional":
        return 1.6
    return 2.9


def _build_city_id(source: str, token: object) -> str:
    normalized_source = "gn" if _clean_text(source).lower().startswith("geo") else "ne"
    cleaned_token = _clean_text(token)
    return f"CITY::{normalized_source}::{cleaned_token}"


def _stable_key_for_city(city_id: str) -> str:
    return f"id::{city_id}"


def _pick_zh_name(*values: object) -> str:
    for value in values:
        text = _clean_text(value)
        if re.search(r"[\u3400-\u9fff]", text):
            return text
    return ""


def _safe_int(value: object) -> int:
    try:
        if value is None or value == "":
            return 0
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _safe_float(value: object) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _stable_hash(*values: object, length: int = 12) -> str:
    payload = "|".join(_clean_text(value) for value in values)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:length].upper()


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius_km = 6371.0088
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def _record_name_keys(record: dict[str, object]) -> set[str]:
    keys: set[str] = set()
    for value in record.get("aliases", []):
        normalized = _normalize_text(value)
        if normalized:
            keys.add(normalized)
    return keys


def load_geonames_frame(zip_path: Path) -> pd.DataFrame:
    with zipfile.ZipFile(zip_path) as archive:
        member = next(
            (name for name in archive.namelist() if name.lower().endswith(".txt")),
            "",
        )
        if not member:
            raise ValueError(f"GeoNames archive missing text payload: {zip_path}")
        with archive.open(member) as handle:
            frame = pd.read_csv(
                handle,
                sep="\t",
                names=GEONAMES_COLUMNS,
                dtype=str,
                na_filter=False,
                low_memory=False,
            )
    return frame


def _load_geonames_source(zip_path: Path | None = None) -> pd.DataFrame:
    if zip_path is None:
        zip_path = fetch_or_cache_binary(
            cfg.GEONAMES_CITIES15000_URL,
            cfg.GEONAMES_CITIES15000_FILENAME,
            min_size_bytes=64 * 1024,
        )
    return load_geonames_frame(Path(zip_path))


def _normalize_geonames(frame: pd.DataFrame) -> gpd.GeoDataFrame:
    rows: list[dict[str, object]] = []
    for raw in frame.to_dict(orient="records"):
        country_code = _clean_text(raw.get("country_code")).upper()
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            continue
        population = _safe_int(raw.get("population"))
        if population < cfg.WORLD_CITY_MIN_POPULATION:
            continue
        lon = _safe_float(raw.get("longitude"))
        lat = _safe_float(raw.get("latitude"))
        if lon is None or lat is None:
            continue
        primary_name = _clean_text(raw.get("name"))
        ascii_name = _clean_text(raw.get("asciiname")) or primary_name
        aliases = _trim_aliases(
            _split_alias_field(raw.get("alternatenames")),
            primary_name=primary_name,
            ascii_name=ascii_name,
        )
        capital_kind = _capital_kind_from_geonames(_clean_text(raw.get("feature_code")))
        city_id = _build_city_id("geonames", _clean_text(raw.get("geonameid")))
        stable_key = _stable_key_for_city(city_id)
        name_zh = _pick_zh_name(*aliases)
        base_tier = _guess_base_tier(
            population=population,
            capital_kind=capital_kind,
            is_world_city=False,
        )
        rows.append(
            {
                "id": city_id,
                "city_id": city_id,
                "stable_key": stable_key,
                "name": primary_name,
                "name_ascii": ascii_name,
                "name_en": ascii_name or primary_name,
                "name_zh": name_zh or ascii_name or primary_name,
                "country_code": country_code,
                "admin1_code": _clean_text(raw.get("admin1_code")),
                "admin1_name": "",
                "population": population,
                "capital_kind": capital_kind,
                "is_country_capital": capital_kind == "country_capital",
                "is_admin_capital": capital_kind == "admin_capital",
                "is_world_city": False,
                "timezone": _clean_text(raw.get("timezone")),
                "wikidataid": "",
                "geonamesid": _clean_text(raw.get("geonameid")),
                "natural_earth_name": "",
                "source": "geonames",
                "sources": ["geonames"],
                "feature_code": _clean_text(raw.get("feature_code")).upper(),
                "feature_class": _clean_text(raw.get("feature_class")).upper(),
                "featurecla": _clean_text(raw.get("feature_code")).upper(),
                "base_tier": base_tier,
                "min_zoom": _guess_min_zoom(base_tier, capital_kind),
                "aliases": aliases,
                "lon": lon,
                "lat": lat,
                "geometry": Point(lon, lat),
            }
        )

    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _normalize_natural_earth() -> gpd.GeoDataFrame:
    source = _ensure_epsg4326(load_populated_places())
    rows: list[dict[str, object]] = []
    allowed_feature_classes = {
        "admin-0 capital",
        "admin-0 capital alt",
        "admin-0 region capital",
        "admin-1 capital",
        "admin-1 region capital",
        "populated place",
    }
    for raw in source.to_dict(orient="records"):
        country_code = _clean_text(raw.get("ISO_A2")).upper()
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            continue
        featurecla = _clean_text(raw.get("FEATURECLA"))
        if featurecla.casefold() not in allowed_feature_classes:
            continue
        lon = _safe_float(raw.get("LONGITUDE"))
        lat = _safe_float(raw.get("LATITUDE"))
        geometry = raw.get("geometry")
        if (lon is None or lat is None) and geometry is not None and not geometry.is_empty:
            lon = float(geometry.x)
            lat = float(geometry.y)
        if lon is None or lat is None:
            continue
        primary_name = _clean_text(raw.get("NAME"))
        ascii_name = _clean_text(raw.get("NAMEASCII")) or primary_name
        aliases = _trim_aliases(
            _split_alias_field(raw.get("NAMEPAR")) + _split_alias_field(raw.get("NAMEALT")),
            primary_name=primary_name,
            ascii_name=ascii_name,
        )
        capital_kind = _capital_kind_from_natural_earth(featurecla)
        ne_id = _safe_int(raw.get("NE_ID"))
        natural_earth_token = ne_id or _stable_hash(
            country_code,
            ascii_name or primary_name,
            f"{lon:.5f}",
            f"{lat:.5f}",
        )
        city_id = _build_city_id("natural_earth", natural_earth_token)
        stable_key = _stable_key_for_city(city_id)
        name_zh = _pick_zh_name(raw.get("NAME_ZH"), *aliases)
        is_world_city = _safe_int(raw.get("WORLDCITY")) > 0 or _safe_int(raw.get("MEGACITY")) > 0
        base_tier = _guess_base_tier(
            population=_safe_int(raw.get("POP_MAX")),
            capital_kind=capital_kind,
            is_world_city=is_world_city,
        )
        rows.append(
            {
                "id": city_id,
                "city_id": city_id,
                "stable_key": stable_key,
                "name": primary_name,
                "name_ascii": ascii_name,
                "name_en": _clean_text(raw.get("NAME_EN")) or ascii_name or primary_name,
                "name_zh": name_zh or ascii_name or primary_name,
                "country_code": country_code,
                "admin1_code": "",
                "admin1_name": _clean_text(raw.get("ADM1NAME")),
                "population": _safe_int(raw.get("POP_MAX")),
                "capital_kind": capital_kind,
                "is_country_capital": capital_kind == "country_capital",
                "is_admin_capital": capital_kind == "admin_capital",
                "is_world_city": is_world_city,
                "timezone": _clean_text(raw.get("TIMEZONE")),
                "wikidataid": _clean_text(raw.get("WIKIDATAID")),
                "geonamesid": "",
                "natural_earth_name": primary_name,
                "source": "natural_earth",
                "sources": ["natural_earth"],
                "feature_code": featurecla,
                "feature_class": featurecla,
                "featurecla": featurecla,
                "base_tier": base_tier,
                "min_zoom": _guess_min_zoom(base_tier, capital_kind),
                "aliases": aliases,
                "lon": lon,
                "lat": lat,
                "geometry": Point(lon, lat),
            }
        )

    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


def _build_ne_candidate_index(ne_gdf: gpd.GeoDataFrame) -> dict[tuple[str, str], set[int]]:
    index: dict[tuple[str, str], set[int]] = {}
    for idx, row in ne_gdf.iterrows():
        country_code = _clean_text(row.get("country_code")).upper()
        aliases = _coerce_text_list(row.get("aliases"))
        for alias in aliases:
            key = _normalize_text(alias)
            if not key:
                continue
            index.setdefault((country_code, key), set()).add(int(idx))
    return index


def _merge_city_rows(geonames_row: dict[str, object], ne_row: dict[str, object] | None) -> dict[str, object]:
    merged = dict(geonames_row)
    if not ne_row:
        merged["sources"] = ["geonames"]
        return merged

    aliases = _trim_aliases(
        list(geonames_row.get("aliases", [])) + list(ne_row.get("aliases", [])),
        primary_name=_clean_text(geonames_row.get("name")) or _clean_text(ne_row.get("name")),
        ascii_name=_clean_text(geonames_row.get("name_ascii")) or _clean_text(ne_row.get("name_ascii")),
    )
    population = max(_safe_int(geonames_row.get("population")), _safe_int(ne_row.get("population")))
    capital_kind = geonames_row.get("capital_kind")
    if _capital_score(ne_row.get("capital_kind")) > _capital_score(capital_kind):
        capital_kind = ne_row.get("capital_kind")
    is_world_city = bool(geonames_row.get("is_world_city")) or bool(ne_row.get("is_world_city"))
    base_tier = _guess_base_tier(
        population=population,
        capital_kind=capital_kind,
        is_world_city=is_world_city,
    )

    merged.update(
        {
            "id": _clean_text(ne_row.get("id")) or _clean_text(geonames_row.get("id")),
            "city_id": _clean_text(ne_row.get("city_id")) or _clean_text(geonames_row.get("city_id")),
            "stable_key": _clean_text(ne_row.get("stable_key")) or _clean_text(geonames_row.get("stable_key")),
            "name": _clean_text(ne_row.get("name")) or _clean_text(geonames_row.get("name")),
            "name_ascii": _clean_text(geonames_row.get("name_ascii")) or _clean_text(ne_row.get("name_ascii")),
            "name_en": _clean_text(ne_row.get("name_en")) or _clean_text(geonames_row.get("name_en")),
            "name_zh": _clean_text(ne_row.get("name_zh")) or _clean_text(geonames_row.get("name_zh")),
            "admin1_name": _clean_text(ne_row.get("admin1_name")) or _clean_text(geonames_row.get("admin1_name")),
            "population": population,
            "capital_kind": capital_kind,
            "is_country_capital": bool(geonames_row.get("is_country_capital")) or bool(ne_row.get("is_country_capital")),
            "is_admin_capital": bool(geonames_row.get("is_admin_capital")) or bool(ne_row.get("is_admin_capital")),
            "is_world_city": is_world_city,
            "timezone": _clean_text(geonames_row.get("timezone")) or _clean_text(ne_row.get("timezone")),
            "wikidataid": _clean_text(ne_row.get("wikidataid")) or _clean_text(geonames_row.get("wikidataid")),
            "natural_earth_name": _clean_text(ne_row.get("name")),
            "source": "merged",
            "sources": ["geonames", "natural_earth"],
            "feature_code": _clean_text(geonames_row.get("feature_code")) or _clean_text(ne_row.get("feature_code")),
            "feature_class": _clean_text(ne_row.get("feature_class")) or _clean_text(geonames_row.get("feature_class")),
            "featurecla": _clean_text(ne_row.get("featurecla")) or _clean_text(geonames_row.get("featurecla")),
            "base_tier": base_tier,
            "min_zoom": _guess_min_zoom(base_tier, capital_kind),
            "aliases": aliases,
        }
    )
    return merged


def merge_world_cities(geonames_gdf: gpd.GeoDataFrame, natural_earth_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if geonames_gdf.empty and natural_earth_gdf.empty:
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    ne_index = _build_ne_candidate_index(natural_earth_gdf)
    used_ne_indices: set[int] = set()
    rows: list[dict[str, object]] = []

    for geo_row in geonames_gdf.to_dict(orient="records"):
        country_code = _clean_text(geo_row.get("country_code")).upper()
        candidate_indices: set[int] = set()
        for key in _record_name_keys(geo_row):
            candidate_indices.update(ne_index.get((country_code, key), set()))
        best_idx: int | None = None
        best_score: tuple[float, int, int] | None = None
        for idx in candidate_indices:
            ne_row = natural_earth_gdf.iloc[idx]
            distance_km = _haversine_km(
                float(geo_row["lon"]),
                float(geo_row["lat"]),
                float(ne_row["lon"]),
                float(ne_row["lat"]),
            )
            if distance_km > cfg.WORLD_CITY_MATCH_MAX_DISTANCE_KM:
                continue
            score = (
                distance_km,
                -_capital_score(ne_row.get("capital_kind")),
                -_safe_int(ne_row.get("population")),
            )
            if best_score is None or score < best_score:
                best_score = score
                best_idx = idx

        match_row = None
        if best_idx is not None:
            used_ne_indices.add(best_idx)
            match_row = natural_earth_gdf.iloc[best_idx].to_dict()
        rows.append(_merge_city_rows(geo_row, match_row))

    for idx, ne_row in natural_earth_gdf.iterrows():
        if int(idx) in used_ne_indices:
            continue
        rows.append(dict(ne_row))

    merged = gpd.GeoDataFrame(rows, crs="EPSG:4326")
    merged = merged.sort_values(
        by=["country_code", "name_ascii", "population", "id"],
        ascending=[True, True, False, True],
        kind="stable",
    ).reset_index(drop=True)
    return merged


def _city_source_priority(source: object) -> int:
    return CITY_SOURCE_PRIORITY.get(_clean_text(source).casefold(), 9)


def _country_city_name_dedupe_key(row: dict[str, object]) -> tuple[object, ...]:
    return (
        _city_source_priority(row.get("source")),
        -_safe_int(row.get("population")),
        -_capital_score(row.get("capital_kind")),
        _clean_text(row.get("name_ascii")) or _clean_text(row.get("name")) or _clean_text(row.get("id")),
        _clean_text(row.get("id")),
    )


def _country_city_rank_key(row: dict[str, object]) -> tuple[object, ...]:
    return (
        -_safe_int(row.get("population")),
        -_capital_score(row.get("capital_kind")),
        _clean_text(row.get("name")) or _clean_text(row.get("name_ascii")) or _clean_text(row.get("id")),
        _clean_text(row.get("id")),
    )


def build_merged_world_city_dataset(
    *,
    geonames_frame: pd.DataFrame | None = None,
    natural_earth_gdf: gpd.GeoDataFrame | None = None,
) -> gpd.GeoDataFrame:
    geonames = _normalize_geonames(geonames_frame if geonames_frame is not None else _load_geonames_source())
    natural_earth = _normalize_natural_earth() if natural_earth_gdf is None else _ensure_epsg4326(natural_earth_gdf)
    return merge_world_cities(geonames, natural_earth)


@lru_cache(maxsize=1)
def _load_merged_world_city_dataset() -> gpd.GeoDataFrame:
    return build_merged_world_city_dataset()


@lru_cache(maxsize=16)
def _build_country_city_catalog_cached(country_code: str) -> gpd.GeoDataFrame:
    normalized_country = _clean_text(country_code).upper()
    if not re.fullmatch(r"[A-Z]{2}", normalized_country):
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    merged = _load_merged_world_city_dataset()
    catalog = merged[
        merged["country_code"].fillna("").astype(str).str.upper() == normalized_country
    ].copy()
    if catalog.empty:
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    deduped_by_name: dict[str, dict[str, object]] = {}
    for row in catalog.to_dict(orient="records"):
        normalized_name = _normalize_text(row.get("name_ascii") or row.get("name"))
        if not normalized_name:
            continue
        incumbent = deduped_by_name.get(normalized_name)
        if incumbent is None or _country_city_name_dedupe_key(row) < _country_city_name_dedupe_key(incumbent):
            deduped_by_name[normalized_name] = row

    rows = sorted(deduped_by_name.values(), key=_country_city_rank_key)
    if not rows:
        return gpd.GeoDataFrame(columns=["id", "name", "country_code", "geometry"], crs="EPSG:4326")

    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326").reset_index(drop=True)


def build_country_city_catalog(country_code: str, *, top_n: int | None = None) -> gpd.GeoDataFrame:
    """Return a reusable pre-attachment city catalog for one country."""
    catalog = _build_country_city_catalog_cached(country_code).copy()
    if top_n is not None:
        try:
            limit = max(0, int(top_n))
        except (TypeError, ValueError):
            limit = 0
        if limit:
            catalog = catalog.head(limit).copy()
        else:
            catalog = catalog.iloc[0:0].copy()
    return gpd.GeoDataFrame(catalog, geometry="geometry", crs="EPSG:4326")


def assign_stable_urban_area_ids(urban_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    urban = _ensure_epsg4326(urban_gdf.copy())
    if urban.empty:
        if "id" not in urban.columns:
            urban["id"] = pd.Series(dtype=str)
        return urban

    ids: list[str] = []
    seen: dict[str, int] = {}
    for geom in urban.geometry:
        if geom is None or geom.is_empty:
            base_id = "UA_EMPTY"
        else:
            base_id = f"UA_{hashlib.sha1(geom.wkb).hexdigest()[:12].upper()}"
        duplicate_index = seen.get(base_id, 0)
        seen[base_id] = duplicate_index + 1
        if duplicate_index:
            base_id = f"{base_id}_{duplicate_index}"
        ids.append(base_id)
    urban["id"] = ids
    return urban


def assign_urban_country_owners(
    urban_gdf: gpd.GeoDataFrame,
    political_gdf: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    urban = _ensure_epsg4326(urban_gdf.copy())
    if "country_owner_id" not in urban.columns:
        urban["country_owner_id"] = pd.Series(dtype=str)
    if "country_owner_code" not in urban.columns:
        urban["country_owner_code"] = pd.Series(dtype=str)
    if "country_owner_method" not in urban.columns:
        urban["country_owner_method"] = pd.Series(dtype=str)
    urban["country_owner_id"] = urban["country_owner_id"].fillna("").astype(str)
    urban["country_owner_code"] = urban["country_owner_code"].fillna("").astype(str)
    urban["country_owner_method"] = urban["country_owner_method"].fillna("").astype(str)

    if urban.empty or political_gdf is None or political_gdf.empty:
        return urban

    political = _ensure_epsg4326(
        political_gdf[["id", "cntr_code", "geometry"]].copy()
    )
    political = political[political.geometry.notna() & ~political.geometry.is_empty].copy()
    if political.empty:
        return urban

    urban_valid = urban[urban.geometry.notna() & ~urban.geometry.is_empty].copy()
    if urban_valid.empty:
        return urban

    urban_projected = urban_valid.to_crs("EPSG:6933")
    political_projected = political.to_crs("EPSG:6933")
    political_sindex = political_projected.sindex

    for urban_idx, urban_row in urban_projected.iterrows():
        geom = urban_row.geometry
        if geom is None or geom.is_empty:
            continue
        candidate_positions = list(political_sindex.query(geom, predicate="intersects"))
        if not candidate_positions:
            continue

        best_owner_id = ""
        best_owner_code = ""
        best_area = 0.0
        for candidate_position in candidate_positions:
            candidate = political_projected.iloc[int(candidate_position)]
            candidate_geom = candidate.geometry
            if candidate_geom is None or candidate_geom.is_empty:
                continue
            overlap = geom.intersection(candidate_geom)
            if overlap is None or overlap.is_empty:
                continue
            overlap_area = float(overlap.area or 0.0)
            if overlap_area <= best_area:
                continue
            best_area = overlap_area
            best_owner_id = str(candidate.get("id") or "").strip()
            best_owner_code = str(candidate.get("cntr_code") or "").strip().upper()

        if not best_owner_id:
            continue
        urban.loc[urban_idx, "country_owner_id"] = best_owner_id
        urban.loc[urban_idx, "country_owner_code"] = best_owner_code
        urban.loc[urban_idx, "country_owner_method"] = "max_overlap"

    return urban


def _attach_within(
    points: gpd.GeoDataFrame,
    polygons: gpd.GeoDataFrame,
    target_id_col: str,
    target_name_col: str = "",
    target_country_col: str = "",
) -> pd.DataFrame:
    if points.empty or polygons.empty:
        return pd.DataFrame(columns=["id", target_id_col, target_name_col, target_country_col, "__distance_m"])

    join_columns = [target_id_col, "geometry"]
    for optional in (target_name_col, target_country_col):
        if optional and optional not in join_columns and optional in polygons.columns:
            join_columns.append(optional)

    joined = gpd.sjoin(
        points[["id", "geometry"]],
        polygons[join_columns],
        how="left",
        predicate="within",
    )
    joined["__distance_m"] = 0.0
    return joined.reset_index(drop=True)


def _attach_nearest(
    points: gpd.GeoDataFrame,
    polygons: gpd.GeoDataFrame,
    *,
    target_id_col: str,
    target_name_col: str = "",
    target_country_col: str = "",
    max_distance_km: float,
) -> pd.DataFrame:
    if points.empty or polygons.empty:
        return pd.DataFrame(columns=["id", target_id_col, target_name_col, target_country_col, "__distance_m"])

    join_columns = [target_id_col, "geometry"]
    for optional in (target_name_col, target_country_col):
        if optional and optional not in join_columns and optional in polygons.columns:
            join_columns.append(optional)

    points_projected = points[["id", "geometry"]].to_crs("EPSG:3857")
    polygons_projected = polygons[join_columns].to_crs("EPSG:3857")
    joined = gpd.sjoin_nearest(
        points_projected,
        polygons_projected,
        how="left",
        max_distance=max_distance_km * 1000.0,
        distance_col="__distance_m",
    )
    return joined.reset_index(drop=True)


def _attach_cities_to_political(cities: gpd.GeoDataFrame, political: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    attached = cities.copy()
    attached["political_feature_id"] = ""
    attached["political_feature_name"] = ""
    attached["political_match_method"] = ""

    if attached.empty or political.empty:
        return attached

    political_ref = _ensure_epsg4326(
        political[["id", "name", "cntr_code", "geometry"]].copy()
    )
    within = _attach_within(
        attached,
        political_ref,
        target_id_col="id",
        target_name_col="name",
        target_country_col="cntr_code",
    )
    within = within.rename(
        columns={
            "id_left": "city_id",
            "id_right": "political_feature_id",
            "name": "political_feature_name",
            "cntr_code": "political_country_code",
        }
    )
    if within.empty:
        within = pd.DataFrame(columns=["city_id", "political_feature_id", "political_feature_name", "political_country_code"])
    best_within = within.groupby("city_id", dropna=False).first()

    attached["__city_id"] = attached["id"]
    attached["political_feature_id"] = attached["__city_id"].map(best_within.get("political_feature_id", pd.Series(dtype=object))).fillna("")
    attached["political_feature_name"] = attached["__city_id"].map(best_within.get("political_feature_name", pd.Series(dtype=object))).fillna("")
    matched_mask = attached["political_feature_id"] != ""
    attached.loc[matched_mask, "political_match_method"] = "within"

    missing = attached.loc[~matched_mask].copy()
    if missing.empty:
        return attached.drop(columns="__city_id")

    fallback_frames: list[pd.DataFrame] = []
    for country_code, subset in missing.groupby(missing["country_code"].fillna("").astype(str).str.upper(), sort=False):
        candidate_polygons = political_ref
        match_method = "nearest_any"
        if re.fullmatch(r"[A-Z]{2}", country_code):
            country_polygons = political_ref[
                political_ref["cntr_code"].fillna("").astype(str).str.upper() == country_code
            ].copy()
            if not country_polygons.empty:
                candidate_polygons = country_polygons
                match_method = "nearest_same_country"
        nearest = _attach_nearest(
            subset,
            candidate_polygons,
            target_id_col="id",
            target_name_col="name",
            target_country_col="cntr_code",
            max_distance_km=cfg.WORLD_CITY_POLITICAL_ATTACH_MAX_DISTANCE_KM,
        )
        if nearest.empty:
            continue
        nearest = nearest.rename(
            columns={
                "id_left": "city_id",
                "id_right": "political_feature_id",
                "name": "political_feature_name",
                "cntr_code": "political_country_code",
            }
        )
        nearest["political_match_method"] = match_method
        fallback_frames.append(nearest)

    if fallback_frames:
        fallback = pd.concat(fallback_frames, ignore_index=True)
        fallback = fallback.groupby("city_id", dropna=False).first()
        fallback_ids = attached["__city_id"].map(fallback.get("political_feature_id", pd.Series(dtype=object))).fillna("")
        fallback_names = attached["__city_id"].map(fallback.get("political_feature_name", pd.Series(dtype=object))).fillna("")
        fallback_methods = attached["__city_id"].map(fallback.get("political_match_method", pd.Series(dtype=object))).fillna("")
        missing_mask = attached["political_feature_id"] == ""
        attached.loc[missing_mask, "political_feature_id"] = fallback_ids.loc[missing_mask]
        attached.loc[missing_mask, "political_feature_name"] = fallback_names.loc[missing_mask]
        attached.loc[missing_mask, "political_match_method"] = fallback_methods.loc[missing_mask]

    return attached.drop(columns="__city_id")


def _attach_cities_to_urban(cities: gpd.GeoDataFrame, urban: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    attached = cities.copy()
    attached["urban_area_id"] = ""
    attached["urban_match_method"] = ""

    if attached.empty or urban.empty:
        return attached

    urban_ref = _ensure_epsg4326(urban[["id", "area_sqkm", "geometry"]].copy())
    within = _attach_within(
        attached,
        urban_ref,
        target_id_col="id",
    )
    within = within.rename(columns={"id_left": "city_id", "id_right": "urban_area_id"})
    if not within.empty and "area_sqkm" in urban_ref.columns:
        area_lookup = urban_ref.set_index("id")["area_sqkm"]
        within["__area_sqkm"] = within["urban_area_id"].map(area_lookup).fillna(float("inf"))
        within = within.sort_values(
            by=["city_id", "__area_sqkm", "__distance_m"],
            ascending=[True, True, True],
            kind="stable",
        )
    best_within = within.groupby("city_id", dropna=False).first() if not within.empty else pd.DataFrame()

    attached["__city_id"] = attached["id"]
    attached["urban_area_id"] = attached["__city_id"].map(best_within.get("urban_area_id", pd.Series(dtype=object))).fillna("")
    matched_mask = attached["urban_area_id"] != ""
    attached.loc[matched_mask, "urban_match_method"] = "within"

    missing = attached.loc[~matched_mask].copy()
    if missing.empty:
        return attached.drop(columns="__city_id")

    nearest = _attach_nearest(
        missing,
        urban_ref,
        target_id_col="id",
        max_distance_km=cfg.WORLD_CITY_URBAN_ATTACH_MAX_DISTANCE_KM,
    )
    if not nearest.empty:
        nearest = nearest.rename(columns={"id_left": "city_id", "id_right": "urban_area_id"})
        nearest = nearest.groupby("city_id", dropna=False).first()
        fallback_ids = attached["__city_id"].map(nearest.get("urban_area_id", pd.Series(dtype=object))).fillna("")
        missing_mask = attached["urban_area_id"] == ""
        attached.loc[missing_mask, "urban_area_id"] = fallback_ids.loc[missing_mask]
        attached.loc[missing_mask & (fallback_ids != ""), "urban_match_method"] = "nearest"

    return attached.drop(columns="__city_id")


def build_world_cities(
    *,
    political: gpd.GeoDataFrame,
    urban: gpd.GeoDataFrame,
    merged_city_dataset: gpd.GeoDataFrame | None = None,
) -> gpd.GeoDataFrame:
    merged = (merged_city_dataset.copy() if merged_city_dataset is not None else _load_merged_world_city_dataset().copy())
    merged = _attach_cities_to_political(merged, political)
    merged = _attach_cities_to_urban(merged, urban)
    geonames_mask = merged["source"].fillna("").astype(str).str.casefold() == "geonames"
    urban_match_mask = merged["urban_area_id"].fillna("").astype(str) != ""
    capital_keep_mask = (
        merged["is_country_capital"].fillna(False)
        | merged["is_admin_capital"].fillna(False)
        | (merged["capital_kind"].fillna("").astype(str) != "place")
    )
    tier_keep_mask = merged["base_tier"].fillna("").astype(str).isin(["regional", "major"])
    population_keep_mask = merged["population"].apply(_safe_int) >= 120_000
    keep_mask = (~geonames_mask) | urban_match_mask | capital_keep_mask | tier_keep_mask | population_keep_mask
    merged = merged.loc[keep_mask].copy()
    merged["capital_score"] = merged["capital_kind"].apply(_capital_score)
    merged = merged.sort_values(
        by=["country_code", "capital_score", "population", "name_ascii", "id"],
        ascending=[True, False, False, True, True],
        kind="stable",
    ).reset_index(drop=True)
    merged = merged.drop(columns=["capital_score"], errors="ignore")
    merged["host_feature_id"] = merged["political_feature_id"].fillna("").astype(str)
    merged["urban_match_id"] = merged["urban_area_id"].fillna("").astype(str)
    merged["is_capital"] = merged["capital_kind"].fillna("").astype(str) != "place"
    return gpd.GeoDataFrame(merged, crs="EPSG:4326")


def build_city_aliases_payload(world_cities: gpd.GeoDataFrame) -> dict[str, object]:
    alias_to_city_ids: dict[str, set[str]] = {}
    alias_to_stable_keys: dict[str, set[str]] = {}
    entries: list[dict[str, object]] = []
    geo: dict[str, dict[str, str]] = {}

    for row in world_cities.to_dict(orient="records"):
        city_id = _clean_text(row.get("id"))
        stable_key = _clean_text(row.get("stable_key")) or _stable_key_for_city(city_id)
        country_code = _clean_text(row.get("country_code")).upper()
        primary_name = _clean_text(row.get("name"))
        ascii_name = _clean_text(row.get("name_ascii"))
        name_en = _clean_text(row.get("name_en")) or ascii_name or primary_name or city_id
        name_zh = _clean_text(row.get("name_zh")) or name_en
        aliases = _trim_aliases(
            [
                city_id,
                stable_key,
                *_coerce_text_list(row.get("aliases")),
            ],
            primary_name=primary_name,
            ascii_name=ascii_name,
        )
        if primary_name and country_code:
            aliases = _trim_aliases(
                aliases + [f"{primary_name} ({country_code})"],
                primary_name=primary_name,
                ascii_name=ascii_name,
            )
        for alias in aliases:
            alias_to_city_ids.setdefault(alias, set()).add(city_id)
            alias_to_stable_keys.setdefault(alias, set()).add(stable_key)

        geo[stable_key] = {
            "en": name_en,
            "zh": name_zh,
        }

        entries.append(
            {
                "city_id": city_id,
                "stable_key": stable_key,
                "country_code": country_code,
                "primary_name": primary_name,
                "name": primary_name,
                "name_ascii": ascii_name,
                "name_en": name_en,
                "name_zh": name_zh,
                "aliases": aliases,
            }
        )

    unique_aliases = {
        alias: next(iter(city_ids))
        for alias, city_ids in sorted(alias_to_city_ids.items())
        if len(city_ids) == 1
    }
    unique_stable_aliases = {
        alias: next(iter(stable_keys))
        for alias, stable_keys in sorted(alias_to_stable_keys.items())
        if len(stable_keys) == 1
    }
    ambiguous_aliases = [
        {
            "alias": alias,
            "city_ids": sorted(city_ids),
            "stable_keys": sorted(alias_to_stable_keys.get(alias, set())),
        }
        for alias, city_ids in sorted(alias_to_city_ids.items())
        if len(city_ids) > 1
    ]

    return {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entry_count": len(entries),
        "alias_count": len(unique_aliases),
        "ambiguous_alias_count": len(ambiguous_aliases),
        "conflict_count": 0,
        "conflicts": [],
        "ambiguous_aliases_sample": ambiguous_aliases[:ALIAS_SAMPLE_LIMIT],
        "geo": geo,
        "entries": entries,
        "alias_to_city_id": unique_aliases,
        "alias_to_stable_key": unique_stable_aliases,
    }


def _build_capital_catalog(world_cities: gpd.GeoDataFrame) -> dict[str, dict[str, object]]:
    capitals = world_cities.copy()
    capitals = capitals[
        (capitals["country_code"].fillna("") != "")
        & (
            capitals["is_country_capital"].fillna(False)
            | capitals["is_admin_capital"].fillna(False)
            | (capitals["capital_kind"].fillna("") == "country_capital")
        )
    ].copy()
    if capitals.empty:
        return {}

    capitals["source_rank"] = capitals["source"].map({"merged": 0, "natural_earth": 1, "geonames": 2}).fillna(3)
    capitals["capital_score"] = capitals["capital_kind"].apply(_capital_score)
    capitals = capitals.sort_values(
        by=["country_code", "capital_score", "is_country_capital", "source_rank", "population", "id"],
        ascending=[True, False, False, True, False, True],
        kind="stable",
    )

    catalog: dict[str, dict[str, object]] = {}
    for row in capitals.to_dict(orient="records"):
        country_code = _clean_text(row.get("country_code")).upper()
        if country_code and country_code not in catalog:
            catalog[country_code] = row
    return catalog


def _city_resolution_sort_key(row: dict[str, object], preferred_country_codes: tuple[str, ...] = ()) -> tuple[object, ...]:
    preferred = tuple(code for code in preferred_country_codes if re.fullmatch(r"[A-Z]{2}", _clean_text(code).upper()))
    country_code = _clean_text(row.get("country_code")).upper()
    tier = _clean_text(row.get("base_tier")).lower()
    return (
        0 if (not preferred or country_code in preferred) else 1,
        -_capital_score(row.get("capital_kind")),
        -int(bool(row.get("is_country_capital"))),
        -int(bool(row.get("is_admin_capital"))),
        -CITY_TIER_WEIGHT.get(tier, 0),
        -_safe_int(row.get("population")),
        _clean_text(row.get("name_ascii")) or _clean_text(row.get("name")) or _clean_text(row.get("id")),
        _clean_text(row.get("id")),
    )


def _dedupe_city_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for row in rows:
        city_id = _clean_text(row.get("id"))
        if city_id and city_id not in deduped:
            deduped[city_id] = row
    return list(deduped.values())


def _build_city_lookup(world_cities: gpd.GeoDataFrame) -> dict[str, object]:
    rows = world_cities.to_dict(orient="records")
    by_id: dict[str, dict[str, object]] = {}
    by_stable_key: dict[str, dict[str, object]] = {}
    by_alias: dict[str, list[dict[str, object]]] = {}
    by_country_alias: dict[tuple[str, str], list[dict[str, object]]] = {}

    for row in rows:
        city_id = _clean_text(row.get("id"))
        stable_key = _clean_text(row.get("stable_key"))
        country_code = _clean_text(row.get("country_code")).upper()
        if city_id:
            by_id[city_id] = row
        if stable_key:
            by_stable_key[stable_key] = row

        normalized_tokens: set[str] = set()
        for raw_value in [
            city_id,
            stable_key,
            row.get("name"),
            row.get("name_ascii"),
            row.get("name_en"),
            row.get("name_zh"),
            *_coerce_text_list(row.get("aliases")),
        ]:
            normalized = _normalize_text(raw_value)
            if normalized:
                normalized_tokens.add(normalized)

        for token in normalized_tokens:
            by_alias.setdefault(token, []).append(row)
            if country_code:
                by_country_alias.setdefault((country_code, token), []).append(row)

    return {
        "rows": rows,
        "by_id": by_id,
        "by_stable_key": by_stable_key,
        "by_alias": by_alias,
        "by_country_alias": by_country_alias,
    }


def _resolve_city_reference(
    reference: object,
    lookup: dict[str, object],
    *,
    preferred_country_codes: tuple[str, ...] = (),
) -> dict[str, object] | None:
    text = _clean_text(reference)
    if not text:
        return None
    direct = lookup["by_id"].get(text) or lookup["by_stable_key"].get(text)
    if direct:
        return direct

    normalized = _normalize_text(text)
    if not normalized:
        return None

    candidates: list[dict[str, object]] = []
    for country_code in preferred_country_codes:
        normalized_country = _clean_text(country_code).upper()
        if not normalized_country:
            continue
        candidates.extend(lookup["by_country_alias"].get((normalized_country, normalized), []))
    if not candidates:
        candidates.extend(lookup["by_alias"].get(normalized, []))
    if not candidates:
        return None

    deduped = _dedupe_city_rows(candidates)
    deduped.sort(key=lambda row: _city_resolution_sort_key(row, preferred_country_codes))
    return deduped[0] if deduped else None


def _read_json_payload(path: Path) -> dict[str, object]:
    payload = read_json_optional(path, default={})
    return payload if isinstance(payload, dict) else {}


def _extract_assignment_map(path: Path, primary_key: str) -> dict[str, str]:
    payload = _read_json_payload(path)
    candidate = payload.get(primary_key, payload)
    if not isinstance(candidate, dict):
        return {}
    extracted: dict[str, str] = {}
    for raw_feature_id, raw_tag in candidate.items():
        feature_id = _clean_text(raw_feature_id)
        tag = _clean_text(raw_tag).upper()
        if feature_id and tag:
            extracted[feature_id] = tag
    return extracted


def _build_tag_city_index(
    world_cities: gpd.GeoDataFrame,
    *,
    owners_by_feature: dict[str, str],
    controllers_by_feature: dict[str, str],
) -> dict[str, list[dict[str, object]]]:
    index: dict[str, list[dict[str, object]]] = {}
    for row in world_cities.to_dict(orient="records"):
        host_feature_id = _clean_text(row.get("host_feature_id") or row.get("political_feature_id"))
        if not host_feature_id:
            continue
        tag = _clean_text(controllers_by_feature.get(host_feature_id) or owners_by_feature.get(host_feature_id)).upper()
        if not tag:
            continue
        index.setdefault(tag, []).append(row)
    return index


def _capital_confidence(
    row: dict[str, object] | None,
    *,
    preferred_country_codes: tuple[str, ...],
    candidate_count: int,
) -> str:
    if not row:
        return ""
    capital_score = _capital_score(row.get("capital_kind"))
    tier = _clean_text(row.get("base_tier")).lower()
    country_code = _clean_text(row.get("country_code")).upper()
    preferred = {code for code in preferred_country_codes if re.fullmatch(r"[A-Z]{2}", _clean_text(code).upper())}
    country_match = not preferred or country_code in preferred
    if country_match and capital_score >= 3:
        return "high"
    if country_match and (capital_score >= 2 or tier == "major"):
        return "medium"
    if country_match and candidate_count == 1:
        return "medium"
    if country_match and tier == "regional":
        return "low"
    if capital_score >= 2 or tier == "major":
        return "low"
    return ""


def _build_capital_entry(
    *,
    tag: str,
    country_record: dict[str, object],
    city_row: dict[str, object],
    resolution_method: str,
    confidence: str,
    candidate_count: int = 0,
) -> dict[str, object]:
    return {
        "tag": tag,
        "display_name": _clean_text(country_record.get("display_name")),
        "lookup_iso2": _clean_text(country_record.get("lookup_iso2")).upper(),
        "base_iso2": _clean_text(country_record.get("base_iso2")).upper(),
        "capital_state_id": country_record.get("capital_state_id"),
        "city_id": _clean_text(city_row.get("id")),
        "stable_key": _clean_text(city_row.get("stable_key")),
        "city_name": _clean_text(city_row.get("name")),
        "name_ascii": _clean_text(city_row.get("name_ascii")),
        "capital_kind": _clean_text(city_row.get("capital_kind")),
        "base_tier": _clean_text(city_row.get("base_tier")),
        "population": _safe_int(city_row.get("population")),
        "country_code": _clean_text(city_row.get("country_code")).upper(),
        "host_feature_id": _clean_text(city_row.get("host_feature_id")),
        "urban_match_id": _clean_text(city_row.get("urban_match_id")),
        "lon": _safe_float(city_row.get("lon")),
        "lat": _safe_float(city_row.get("lat")),
        "source": _clean_text(city_row.get("source")),
        "resolution_method": resolution_method,
        "confidence": confidence,
        "candidate_count": candidate_count,
    }


def _append_unique_capital_entry(
    accepted_entries: dict[str, dict[str, object]],
    *,
    tag: str,
    entry: dict[str, object],
) -> None:
    if tag and tag not in accepted_entries:
        accepted_entries[tag] = entry


def emit_default_scenario_city_assets(output_dir: Path, world_cities: gpd.GeoDataFrame) -> None:
    scenarios_root = output_dir / "scenarios"
    if not scenarios_root.exists():
        return

    city_lookup = _build_city_lookup(world_cities)
    generated_at = datetime.now(timezone.utc).isoformat()

    for scenario_dir in sorted(
        path
        for path in scenarios_root.iterdir()
        if path.is_dir() and (path / "manifest.json").exists()
    ):
        scenario_id = scenario_dir.name
        manifest = _read_json_payload(scenario_dir / "manifest.json")
        countries_payload = _read_json_payload(scenario_dir / "countries.json")
        countries = countries_payload.get("countries", {}) if isinstance(countries_payload, dict) else {}
        if not isinstance(countries, dict):
            countries = {}
        featured_tags = {
            _clean_text(raw_tag).upper()
            for raw_tag in (manifest.get("featured_tags", []) if isinstance(manifest, dict) else [])
            if _clean_text(raw_tag)
        }

        owners_by_feature = _extract_assignment_map(scenario_dir / "owners.by_feature.json", "owners")
        controllers_by_feature = _extract_assignment_map(scenario_dir / "controllers.by_feature.json", "controllers")
        tag_city_index = _build_tag_city_index(
            world_cities,
            owners_by_feature=owners_by_feature,
            controllers_by_feature=controllers_by_feature,
        )

        capitals_by_tag: dict[str, str] = {}
        capital_city_hints: dict[str, dict[str, object]] = {}
        city_overrides: dict[str, dict[str, object]] = {}
        accepted_capital_entries: dict[str, dict[str, object]] = {}
        rejected_capital_entries: list[dict[str, object]] = []
        unresolved_capitals: list[dict[str, object]] = []
        unresolved_manual_capitals: list[dict[str, object]] = []
        unresolved_city_renames: list[dict[str, object]] = []
        name_conflicts: list[dict[str, object]] = []

        manual_capitals = SCENARIO_MANUAL_CAPITALS.get(scenario_id, {})
        for raw_name, override in SCENARIO_CITY_RENAMES.get(scenario_id, {}).items():
            resolved = _resolve_city_reference(raw_name, city_lookup)
            if not resolved:
                unresolved_city_renames.append(
                    {
                        "reference": raw_name,
                        "reason": "city_not_found",
                    }
                )
                continue
            city_id = _clean_text(resolved.get("id"))
            if not city_id:
                continue
            stable_key = _clean_text(resolved.get("stable_key")) or _stable_key_for_city(city_id)
            existing_aliases = list(city_overrides.get(city_id, {}).get("aliases", []))
            override_aliases = _trim_aliases(
                existing_aliases + list(override.get("aliases", [])),
                primary_name=_clean_text(override.get("display_name", {}).get("en")) or _clean_text(resolved.get("name")),
                ascii_name=_clean_text(resolved.get("name_ascii")),
            )
            city_overrides[city_id] = {
                "stable_key": stable_key,
                "display_name": override.get("display_name", {}),
                "aliases": override_aliases,
                "tier": _clean_text(override.get("tier")) or _clean_text(resolved.get("base_tier")),
                "hidden": bool(override.get("hidden", False)),
            }
            base_name = _clean_text(resolved.get("name"))
            scenario_name_en = _clean_text(override.get("display_name", {}).get("en"))
            scenario_name_zh = _clean_text(override.get("display_name", {}).get("zh"))
            if scenario_name_en and scenario_name_en.casefold() != base_name.casefold():
                name_conflicts.append(
                    {
                        "city_id": city_id,
                        "host_feature_id": _clean_text(resolved.get("host_feature_id")),
                        "stable_key": stable_key,
                        "base_name": {
                            "en": base_name,
                            "zh": _clean_text(resolved.get("name_zh")) or base_name,
                        },
                        "scenario_name": {
                            "en": scenario_name_en,
                            "zh": scenario_name_zh or scenario_name_en,
                        },
                        "resolution": "scenario_city_override",
                    }
                )

        for raw_tag, raw_record in sorted(countries.items()):
            if not isinstance(raw_record, dict):
                continue
            tag = _clean_text(raw_tag).upper()
            if not tag:
                continue

            preferred_country_codes = tuple(
                code
                for code in [
                    _clean_text(raw_record.get("lookup_iso2")).upper(),
                    _clean_text(raw_record.get("base_iso2")).upper(),
                ]
                if re.fullmatch(r"[A-Z]{2}", code)
            )
            manual_reference = _clean_text(manual_capitals.get(tag))
            manual_city = _resolve_city_reference(
                manual_reference,
                city_lookup,
                preferred_country_codes=preferred_country_codes,
            ) if manual_reference else None
            if manual_reference and not manual_city:
                unresolved_manual_capitals.append(
                    {
                        "tag": tag,
                        "reference": manual_reference,
                        "display_name": _clean_text(raw_record.get("display_name")),
                    }
                )
            if manual_city:
                capitals_by_tag[tag] = _clean_text(manual_city.get("id"))
                manual_entry = _build_capital_entry(
                    tag=tag,
                    country_record=raw_record,
                    city_row=manual_city,
                    resolution_method="manual_override",
                    confidence="high",
                    candidate_count=1,
                )
                _append_unique_capital_entry(accepted_capital_entries, tag=tag, entry=manual_entry)

            candidate_rows = _dedupe_city_rows(tag_city_index.get(tag, []))
            candidate_rows.sort(key=lambda row: _city_resolution_sort_key(row, preferred_country_codes))
            best_candidate = candidate_rows[0] if candidate_rows else None
            confidence = _capital_confidence(
                best_candidate,
                preferred_country_codes=preferred_country_codes,
                candidate_count=len(candidate_rows),
            )
            capital_state_id = raw_record.get("capital_state_id")
            has_capital_state_hint = capital_state_id not in (None, "", 0, "0")

            candidate_entry = None
            if best_candidate:
                candidate_entry = _build_capital_entry(
                    tag=tag,
                    country_record=raw_record,
                    city_row=best_candidate,
                    resolution_method="capital_state_fallback" if has_capital_state_hint else "controlled_city_fallback",
                    confidence=confidence or "low",
                    candidate_count=len(candidate_rows),
                )

            should_accept_candidate = bool(best_candidate) and (
                confidence in {"high", "medium"} or len(candidate_rows) == 1
            )
            accepted_resolution_method = (
                "capital_state_fallback" if has_capital_state_hint else "controlled_city_fallback"
            )
            if should_accept_candidate:
                accepted_entry = _build_capital_entry(
                    tag=tag,
                    country_record=raw_record,
                    city_row=best_candidate,
                    resolution_method=accepted_resolution_method,
                    confidence=confidence or "medium",
                    candidate_count=len(candidate_rows),
                )
                capital_city_hints[tag] = accepted_entry
                _append_unique_capital_entry(accepted_capital_entries, tag=tag, entry=accepted_entry)
            elif candidate_entry and tag not in accepted_capital_entries:
                rejected_capital_entries.append(candidate_entry)
            elif not manual_city and not best_candidate:
                unresolved_capitals.append(
                    {
                        "tag": tag,
                        "display_name": _clean_text(raw_record.get("display_name")),
                        "lookup_iso2": _clean_text(raw_record.get("lookup_iso2")).upper(),
                        "base_iso2": _clean_text(raw_record.get("base_iso2")).upper(),
                        "capital_state_id": capital_state_id,
                        "reason": "no_controlled_city_candidates",
                    }
                )
            elif not manual_city and best_candidate and confidence not in {"high", "medium"} and len(candidate_rows) > 1:
                unresolved_capitals.append(
                    {
                        "tag": tag,
                        "display_name": _clean_text(raw_record.get("display_name")),
                        "lookup_iso2": _clean_text(raw_record.get("lookup_iso2")).upper(),
                        "base_iso2": _clean_text(raw_record.get("base_iso2")).upper(),
                        "capital_state_id": capital_state_id,
                        "reason": (
                            "capital_hint_low_confidence"
                            if has_capital_state_hint
                            else "controlled_city_low_confidence"
                        ),
                        "candidate_city_id": _clean_text(best_candidate.get("id")),
                    }
                )

        featured_runtime_missing = [
            tag
            for tag in sorted(featured_tags)
            if tag not in capitals_by_tag and tag not in capital_city_hints
        ]
        overrides_payload = {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": generated_at,
            "capitals_by_tag": capitals_by_tag,
            "capital_city_hints": capital_city_hints,
            "cities": city_overrides,
            "audit": {
                "manual_capital_count": len(capitals_by_tag),
                "capital_hint_count": len(capital_city_hints),
                "renamed_city_count": len(city_overrides),
                "name_conflict_count": len(name_conflicts),
                "unresolved_capital_count": len(unresolved_capitals),
                "unresolved_manual_capital_count": len(unresolved_manual_capitals),
                "unresolved_city_rename_count": len(unresolved_city_renames),
                "featured_runtime_missing_count": len(featured_runtime_missing),
                "featured_runtime_missing_tags": featured_runtime_missing,
                "name_conflicts": name_conflicts,
                "unresolved_capitals": unresolved_capitals,
                "unresolved_manual_capitals": unresolved_manual_capitals,
                "unresolved_city_renames": unresolved_city_renames,
            },
        }
        overrides_path = scenario_dir / cfg.SCENARIO_CITY_OVERRIDES_FILENAME
        write_json_atomic(overrides_path, overrides_payload, ensure_ascii=False, indent=2)

        capital_hints_payload = {
            "version": 1,
            "scenario_id": scenario_id,
            "generated_at": generated_at,
            "entry_count": len(accepted_capital_entries),
            "missing_tag_count": len(unresolved_capitals),
            "missing_tags": [entry["tag"] for entry in unresolved_capitals],
            "entries": [accepted_capital_entries[tag] for tag in sorted(accepted_capital_entries)],
            "audit": {
                "rejected_candidate_count": len(rejected_capital_entries),
                "rejected_candidates": rejected_capital_entries,
                "featured_runtime_missing_count": len(featured_runtime_missing),
                "featured_runtime_missing_tags": featured_runtime_missing,
            },
        }
        capital_hints_path = scenario_dir / cfg.SCENARIO_CAPITAL_HINTS_FILENAME
        write_json_atomic(capital_hints_path, capital_hints_payload, ensure_ascii=False, indent=2)

        manifest_path = scenario_dir / "manifest.json"
        if manifest_path.exists() and isinstance(manifest, dict):
            manifest["city_overrides_url"] = f"data/scenarios/{scenario_id}/{cfg.SCENARIO_CITY_OVERRIDES_FILENAME}"
            manifest["capital_hints_url"] = f"data/scenarios/{scenario_id}/{cfg.SCENARIO_CAPITAL_HINTS_FILENAME}"
            write_json_atomic(manifest_path, manifest, ensure_ascii=False, indent=2)
