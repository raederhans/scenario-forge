"""Targeted CZ/SK border-detail refinement for HOI4 1939 scenario overlays."""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from map_builder import config as cfg
from map_builder.geo.utils import ensure_crs
from map_builder.io.fetch import fetch_or_load_geojson


TARGETS_PATH = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "scenario-rules"
    / "targets"
    / "hoi4_1939_cz_sk_targets.json"
)

MAX_AREA_DRIFT_KM2 = 25.0


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
    clean = clean[clean.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    return clean


def _as_feature_id(prefix: str, shape_id: str) -> str:
    return f"{prefix}_{shape_id}"


def _load_targets() -> dict[str, set[str]]:
    payload = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
    targets = payload.get("targets", {}) if isinstance(payload, dict) else {}
    sudeten = {
        str(value).strip()
        for value in (targets.get("sudetenland", {}) or {}).get("feature_ids", [])
        if str(value).strip()
    }
    south_slovakia = {
        str(value).strip()
        for value in (targets.get("south_slovakia", {}) or {}).get("feature_ids", [])
        if str(value).strip()
    }
    if not sudeten or not south_slovakia:
        raise SystemExit("[CZ/SK] Target file is missing sudetenland/south_slovakia feature IDs.")
    return {
        "sudetenland": sudeten,
        "south_slovakia": south_slovakia,
    }


def _load_country_source(country_code: str) -> gpd.GeoDataFrame:
    if country_code == "CZ":
        gdf = fetch_or_load_geojson(
            cfg.CZE_ADM2_URL,
            cfg.CZE_ADM2_FILENAME,
            fallback_urls=cfg.CZE_ADM2_FALLBACK_URLS,
        )
    elif country_code == "SK":
        gdf = fetch_or_load_geojson(
            cfg.SVK_ADM2_URL,
            cfg.SVK_ADM2_FILENAME,
            fallback_urls=cfg.SVK_ADM2_FALLBACK_URLS,
        )
    else:
        raise ValueError(f"Unsupported country for CZ/SK detail loader: {country_code}")

    gdf = _sanitize_polygon_layer(gdf)
    required = {"shapeID", "shapeName"}
    if not required.issubset(set(gdf.columns)):
        raise SystemExit(
            f"[CZ/SK] {country_code} ADM2 source missing required columns {sorted(required)}. "
            f"Available={gdf.columns.tolist()}"
        )
    gdf["shapeID"] = gdf["shapeID"].fillna("").astype(str).str.strip()
    gdf["shapeName"] = gdf["shapeName"].fillna("").astype(str).str.strip()
    gdf = gdf[(gdf["shapeID"] != "") & (gdf["shapeName"] != "")].copy()
    if gdf.empty:
        raise SystemExit(f"[CZ/SK] {country_code} ADM2 source is empty after normalization.")
    if gdf["shapeID"].duplicated().any():
        raise SystemExit(f"[CZ/SK] {country_code} ADM2 source contains duplicate shapeID values.")
    return gdf


def _clip_source_to_shell(source: gpd.GeoDataFrame, shell_geom):
    clipped = ensure_crs(source.copy())
    clipped["geometry"] = clipped.geometry.apply(
        lambda geom: _make_valid_geom(geom.intersection(shell_geom))
        if geom is not None and not geom.is_empty
        else None
    )
    clipped = _sanitize_polygon_layer(clipped)
    if clipped.empty:
        raise SystemExit("[CZ/SK] Clip-to-shell removed all ADM2 geometries.")
    return clipped


def _feature_area_km2(geom) -> float:
    if geom is None or geom.is_empty:
        return 0.0
    tmp = gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4326").to_crs(cfg.AREA_CRS)
    return float(tmp.geometry.area.iloc[0] / 1_000_000.0)


def _country_sym_diff_area_km2(before_geom, after_geom) -> float:
    before = _make_valid_geom(before_geom)
    after = _make_valid_geom(after_geom)
    if before is None or after is None:
        return 0.0
    sym = _make_valid_geom(before.symmetric_difference(after))
    return _feature_area_km2(sym)


def _build_target_features(
    source: gpd.GeoDataFrame,
    *,
    coarse_country: gpd.GeoDataFrame,
    target_shape_ids: set[str],
    country_code: str,
    feature_prefix: str,
) -> gpd.GeoDataFrame:
    selected = source[source["shapeID"].isin(target_shape_ids)].copy()
    missing = sorted(target_shape_ids - set(selected["shapeID"].tolist()))
    if missing:
        raise SystemExit(
            f"[CZ/SK] Missing target shape IDs for {country_code}: {', '.join(missing[:20])}"
        )

    coarse = coarse_country[["id", "name", "geometry"]].copy()
    coarse = _sanitize_polygon_layer(coarse)
    coarse_points = selected.copy()
    coarse_points["geometry"] = coarse_points.geometry.representative_point()
    joined = gpd.sjoin(
        coarse_points,
        coarse,
        how="left",
        predicate="within",
    )
    parent_by_shape_id: dict[str, str] = {}
    for _, row in joined.iterrows():
        shape_id = str(row.get("shapeID", "")).strip()
        parent_id = str(row.get("id_right", "")).strip()
        if shape_id and parent_id and shape_id not in parent_by_shape_id:
            parent_by_shape_id[shape_id] = parent_id

    selected["id"] = selected["shapeID"].apply(lambda value: _as_feature_id(feature_prefix, value))
    selected["name"] = selected["shapeName"]
    selected["cntr_code"] = country_code
    selected["admin1_group"] = selected["shapeID"].apply(lambda value: parent_by_shape_id.get(value, ""))
    selected["detail_tier"] = "adm2_hybrid_frontline_target"

    out = selected[["id", "name", "cntr_code", "admin1_group", "detail_tier", "geometry"]].copy()
    out = _sanitize_polygon_layer(out)
    if out.empty:
        raise SystemExit(f"[CZ/SK] Target split for {country_code} produced no valid geometries.")
    if out["id"].duplicated().any():
        raise SystemExit(f"[CZ/SK] Duplicate generated feature IDs detected for {country_code}.")
    return out


def _subtract_target_union(
    coarse_country: gpd.GeoDataFrame,
    *,
    target_union_geom,
) -> gpd.GeoDataFrame:
    if target_union_geom is None or target_union_geom.is_empty:
        return coarse_country
    out = coarse_country.copy()
    out["geometry"] = out.geometry.apply(
        lambda geom: _make_valid_geom(geom.difference(target_union_geom))
        if geom is not None and not geom.is_empty
        else None
    )
    out = _sanitize_polygon_layer(out)
    if out.empty:
        raise SystemExit("[CZ/SK] Country remainder became empty after target subtraction.")
    return out


def _build_country_refinement(
    main_gdf: gpd.GeoDataFrame,
    *,
    country_code: str,
    target_shape_ids: set[str],
    feature_prefix: str,
) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    country_mask = main_gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip() == country_code
    coarse_country = _sanitize_polygon_layer(main_gdf[country_mask].copy())
    if coarse_country.empty:
        raise SystemExit(f"[CZ/SK] No coarse runtime features found for {country_code}.")

    shell_geom = _make_valid_geom(unary_union(coarse_country.geometry.tolist()))
    if shell_geom is None or shell_geom.is_empty:
        raise SystemExit(f"[CZ/SK] Failed to build coarse shell for {country_code}.")

    source = _load_country_source(country_code)
    source = _clip_source_to_shell(source, shell_geom)
    targets = _build_target_features(
        source,
        coarse_country=coarse_country,
        target_shape_ids=target_shape_ids,
        country_code=country_code,
        feature_prefix=feature_prefix,
    )
    target_union = _make_valid_geom(unary_union(targets.geometry.tolist()))
    remainder = _subtract_target_union(coarse_country, target_union_geom=target_union)

    rebuilt_union = _make_valid_geom(unary_union(pd.concat([remainder, targets], ignore_index=True).geometry.tolist()))
    drift_km2 = _country_sym_diff_area_km2(shell_geom, rebuilt_union)
    if drift_km2 > MAX_AREA_DRIFT_KM2:
        raise SystemExit(
            f"[CZ/SK] Coverage drift too high for {country_code}: {drift_km2:.2f} km^2 "
            f"(limit={MAX_AREA_DRIFT_KM2:.2f})."
        )

    return remainder, targets


def apply_cz_sk_border_detail(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "cntr_code" not in main_gdf.columns:
        print("[CZ/SK] cntr_code missing; skipping targeted border refinement.")
        return main_gdf
    if not TARGETS_PATH.exists():
        print(f"[CZ/SK] Target config missing at {TARGETS_PATH}; skipping refinement.")
        return main_gdf

    normalized = ensure_crs(main_gdf.copy())
    normalized["cntr_code"] = normalized["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    targets = _load_targets()

    cz_remainder, sudeten_features = _build_country_refinement(
        normalized,
        country_code="CZ",
        target_shape_ids=targets["sudetenland"],
        feature_prefix="CZ_ADM2",
    )
    sk_remainder, south_slovakia_features = _build_country_refinement(
        normalized,
        country_code="SK",
        target_shape_ids=targets["south_slovakia"],
        feature_prefix="SK_ADM2",
    )

    base = normalized[~normalized["cntr_code"].isin({"CZ", "SK"})].copy()
    combined = gpd.GeoDataFrame(
        pd.concat(
            [
                base,
                cz_remainder,
                sk_remainder,
                sudeten_features,
                south_slovakia_features,
            ],
            ignore_index=True,
        ),
        crs=normalized.crs or "EPSG:4326",
    )
    combined = _sanitize_polygon_layer(combined)
    print(
        "[CZ/SK] Border-detail refinement complete: "
        f"sudeten_features={len(sudeten_features)}, south_slovakia_features={len(south_slovakia_features)}."
    )
    return combined

