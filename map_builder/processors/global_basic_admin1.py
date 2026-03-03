"""Global basic-detail replacement for remaining non-island countries."""
from __future__ import annotations

import json
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

from map_builder import config as cfg
from map_builder.geo.utils import ensure_crs, pick_column, smart_island_cull
from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_geojson


def _data_dir() -> Path:
    path = Path(__file__).resolve().parents[2] / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _slugify(text: object) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", str(text or "").strip())
    return cleaned.strip("_") or "unit"


def _coalesce_text_columns(gdf: gpd.GeoDataFrame, candidates: list[str]) -> pd.Series:
    series = pd.Series([""] * len(gdf), index=gdf.index, dtype="object")
    for col in candidates:
        if col not in gdf.columns:
            continue
        values = gdf[col].fillna("").astype(str).str.strip()
        series = series.where(series != "", values)
    return series.fillna("").astype(str).str.strip()


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


def _load_ne_admin1() -> gpd.GeoDataFrame:
    local_path = _data_dir() / "ne_10m_admin_1_states_provinces.shp"
    if local_path.exists():
        gdf = gpd.read_file(local_path)
    else:
        gdf = fetch_ne_zip(cfg.ADMIN1_URL, "admin1_global_basic")
    return ensure_crs(gdf)


def _topology_object_to_gdf(path: Path, object_name: str = "political") -> gpd.GeoDataFrame:
    if not path.exists():
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    topo_dict = json.loads(path.read_text(encoding="utf-8"))
    objects = topo_dict.get("objects", {})
    if object_name not in objects:
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    feature_collection = serialize_as_geojson(topo_dict, objectname=object_name)
    if not isinstance(feature_collection, dict) or not feature_collection.get("features"):
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    gdf = serialize_as_geodataframe(feature_collection)
    if gdf.empty:
        return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    return ensure_crs(gdf)


def _load_primary_political_shells() -> gpd.GeoDataFrame:
    return _topology_object_to_gdf(_data_dir() / "europe_topology.json", "political")


def _buffer_geometry_meters(geom, distance_m: float):
    if geom is None or geom.is_empty:
        return geom
    shell_gdf = gpd.GeoDataFrame(geometry=[geom], crs="EPSG:4326")
    buffered = shell_gdf.to_crs(cfg.AREA_CRS)
    buffered["geometry"] = buffered.geometry.buffer(distance_m)
    return buffered.to_crs("EPSG:4326").geometry.iloc[0]


def _get_country_shell(source_gdf: gpd.GeoDataFrame, iso_code: str, *, label: str):
    codes = source_gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    subset = source_gdf[codes == iso_code].copy()
    subset = _sanitize_polygon_layer(subset)
    if subset.empty:
        return None
    shell = _make_valid_geom(unary_union(subset.geometry.tolist()))
    if shell is None or shell.is_empty:
        return None
    if label == "primary":
        shell = _buffer_geometry_meters(shell, 50_000.0)
        shell = _make_valid_geom(shell)
    print(f"[Global Basic] Using {label} shell for {iso_code}.")
    return shell


def _clip_features_to_shell(
    source_gdf: gpd.GeoDataFrame,
    shell_geom,
    *,
    iso_code: str,
    tolerance: float,
) -> gpd.GeoDataFrame:
    if source_gdf.empty:
        raise SystemExit(f"[Global Basic] {iso_code} source layer is empty before clip.")

    clipped = ensure_crs(source_gdf.copy())
    shell_shape = shell_geom
    disjoint = clipped[~clipped.geometry.intersects(shell_shape)].copy()
    if not disjoint.empty:
        extra_shell = _make_valid_geom(unary_union(disjoint.geometry.tolist()))
        shell_shape = _make_valid_geom(unary_union([shell_shape, extra_shell]))
        print(
            f"[Global Basic] {iso_code} shell augmented with {len(disjoint)} disjoint source feature(s)."
        )
    clipped["geometry"] = clipped.geometry.apply(
        lambda geom: _make_valid_geom(geom.intersection(shell_shape))
        if geom is not None and not geom.is_empty
        else None
    )
    clipped = _sanitize_polygon_layer(clipped)
    if clipped.empty:
        raise SystemExit(f"[Global Basic] {iso_code} clip-to-shell removed all geometries.")

    clipped = smart_island_cull(
        clipped,
        group_col="id",
        threshold_km2=cfg.MIN_VISIBLE_AREA_KM2,
    )
    clipped = _sanitize_polygon_layer(clipped)
    if clipped.empty:
        raise SystemExit(f"[Global Basic] {iso_code} culling removed all geometries.")

    clipped["geometry"] = clipped.geometry.simplify(
        tolerance,
        preserve_topology=True,
    )
    clipped = _sanitize_polygon_layer(clipped)
    if clipped.empty:
        raise SystemExit(f"[Global Basic] {iso_code} simplify step removed all geometries.")
    return clipped


def _ensure_unique_ids(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    out = gdf.copy()
    seen: dict[str, int] = {}
    ids: list[str] = []
    for raw in out["id"].fillna("").astype(str).tolist():
        key = raw.strip()
        if key in seen:
            seen[key] += 1
            key = f"{key}__dup{seen[key]}"
        else:
            seen[key] = 0
        ids.append(key)
    out["id"] = ids
    return out


def _validate_count(gdf: gpd.GeoDataFrame, iso_code: str, expected_count: int) -> None:
    actual = int(len(gdf))
    if actual != int(expected_count):
        raise SystemExit(
            f"[Global Basic] {iso_code} feature count mismatch: expected {expected_count}, got {actual}."
        )


def _finalize_country(
    source_gdf: gpd.GeoDataFrame,
    *,
    iso_code: str,
    expected_count: int,
    shell_geom,
    tolerance: float,
    require_group: bool = True,
) -> gpd.GeoDataFrame:
    out = ensure_crs(source_gdf)
    out = out[["id", "name", "cntr_code", "admin1_group", "detail_tier", "geometry"]].copy()
    out["id"] = out["id"].fillna("").astype(str).str.strip()
    out["name"] = out["name"].fillna("").astype(str).str.strip()
    out["admin1_group"] = out["admin1_group"].fillna("").astype(str).str.strip()
    out = out[(out["id"] != "") & (out["name"] != "")].copy()
    if require_group:
        out = out[out["admin1_group"] != ""].copy()
    out = _ensure_unique_ids(out)
    out = _clip_features_to_shell(out, shell_geom, iso_code=iso_code, tolerance=tolerance)
    _validate_count(out, iso_code, expected_count)
    return out


def _normalize_ne_country_rule(rule: dict | int) -> dict:
    if isinstance(rule, int):
        return {
            "source_type": "ne_admin1",
            "expected_count": int(rule),
            "include_adm1_codes": [],
            "merge_minor_adm1_to_parent": {},
            "preserve_primary_features": [],
            "rename_map": {},
            "detail_tier": "adm1_basic",
        }
    normalized = dict(rule or {})
    normalized.setdefault("source_type", "ne_admin1")
    normalized.setdefault("expected_count", 0)
    normalized.setdefault("include_adm1_codes", [])
    normalized.setdefault("merge_minor_adm1_to_parent", {})
    normalized.setdefault("preserve_primary_features", [])
    normalized.setdefault("rename_map", {})
    normalized.setdefault("detail_tier", "adm1_basic")
    return normalized


def _collapse_ne_rows(source: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if source.empty:
        return source
    rows = []
    for source_code, group in source.groupby("__source_code", dropna=False):
        geometries = [
            geom for geom in group.geometry.tolist()
            if geom is not None and not geom.is_empty
        ]
        geometry = _make_valid_geom(unary_union(geometries)) if geometries else None
        if geometry is None or geometry.is_empty:
            continue
        row = group.iloc[0].copy()
        row["geometry"] = geometry
        row["__source_code"] = str(source_code or "").strip()
        rows.append(row)
    if not rows:
        return gpd.GeoDataFrame(columns=list(source.columns), geometry="geometry", crs="EPSG:4326")
    collapsed = gpd.GeoDataFrame(rows, geometry="geometry", crs=source.crs or "EPSG:4326")
    return ensure_crs(collapsed)


def _merge_minor_units(source: gpd.GeoDataFrame, merge_map: dict[str, str], iso_code: str) -> gpd.GeoDataFrame:
    if source.empty or not merge_map:
        return source

    out = source.copy().set_index("__source_code", drop=False)
    missing_children = [minor for minor in merge_map if minor not in out.index]
    missing_parents = [parent for parent in merge_map.values() if parent not in out.index]
    if missing_children or missing_parents:
        details = []
        if missing_children:
            details.append(f"missing merge children={missing_children}")
        if missing_parents:
            details.append(f"missing merge parents={missing_parents}")
        raise SystemExit(f"[Global Basic] {iso_code} merge map invalid: {'; '.join(details)}")

    for minor_code, parent_code in merge_map.items():
        parent_geom = out.at[parent_code, "geometry"]
        minor_geom = out.at[minor_code, "geometry"]
        merged_geom = _make_valid_geom(unary_union([parent_geom, minor_geom]))
        if merged_geom is None or merged_geom.is_empty:
            raise SystemExit(
                f"[Global Basic] {iso_code} merge produced empty geometry for {parent_code} <- {minor_code}."
            )
        out.at[parent_code, "geometry"] = merged_geom

    out = out[~out.index.isin(set(merge_map.keys()))].copy()
    return gpd.GeoDataFrame(out.reset_index(drop=True), geometry="geometry", crs="EPSG:4326")


def _build_preserved_primary_features(
    primary_shell_source: gpd.GeoDataFrame,
    ne_admin1: gpd.GeoDataFrame,
    iso_code: str,
    preserve_specs: list[dict],
    shell_geom,
) -> gpd.GeoDataFrame:
    if not preserve_specs:
        return gpd.GeoDataFrame(
            columns=["id", "name", "cntr_code", "admin1_group", "detail_tier", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )

    if "id" not in primary_shell_source.columns:
        raise SystemExit("[Global Basic] Primary topology is missing feature IDs for passthrough copy.")

    primary = ensure_crs(primary_shell_source.copy())
    source_ids = primary["id"].fillna("").astype(str).str.strip()
    ne_iso_col = pick_column(ne_admin1, ["iso_a2", "adm0_a2", "iso_3166_1_"])
    ne_id_col = pick_column(ne_admin1, ["adm1_code", "iso_3166_2", "gn_id", "id"])
    rows = []
    for spec in preserve_specs:
        source_id = str(spec.get("source_id", "")).strip()
        target_id = str(spec.get("target_id", "")).strip()
        target_name = str(spec.get("target_name", "")).strip()
        detail_tier = str(spec.get("detail_tier", "admin0_passthrough")).strip() or "admin0_passthrough"
        fallback_ne_code = str(spec.get("fallback_ne_code", "")).strip()
        if not source_id or not target_id or not target_name:
            raise SystemExit(f"[Global Basic] {iso_code} preserve_primary_features entry is incomplete: {spec}")
        matched = primary[source_ids == source_id].copy()
        geometry = _make_valid_geom(matched.geometry.iloc[0]) if not matched.empty else None
        if (geometry is None or geometry.is_empty) and fallback_ne_code:
            if not ne_iso_col or not ne_id_col:
                raise SystemExit(
                    f"[Global Basic] {iso_code} missing Natural Earth columns for fallback passthrough geometry."
                )
            fallback_source = ne_admin1[
                ne_admin1[ne_iso_col].fillna("").astype(str).str.upper().str.strip() == iso_code
            ].copy()
            fallback_source = fallback_source[
                fallback_source[ne_id_col].fillna("").astype(str).str.strip() == fallback_ne_code
            ].copy()
            if not fallback_source.empty:
                geometry = _make_valid_geom(unary_union(fallback_source.geometry.tolist()))
        if geometry is None or geometry.is_empty:
            if matched.empty:
                raise SystemExit(
                    f"[Global Basic] {iso_code} missing primary passthrough source feature: {source_id}"
                )
            raise SystemExit(
                f"[Global Basic] {iso_code} passthrough source feature has invalid geometry: {source_id}"
            )
        try:
            clipped = _make_valid_geom(geometry.intersection(shell_geom))
            if clipped is not None and not clipped.is_empty:
                geometry = clipped
        except Exception:
            pass
        rows.append(
            {
                "id": target_id,
                "name": target_name,
                "cntr_code": iso_code,
                "admin1_group": "",
                "detail_tier": detail_tier,
                "geometry": geometry,
            }
        )

    out = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    out = _sanitize_polygon_layer(out)
    if len(out) != len(preserve_specs):
        raise SystemExit(
            f"[Global Basic] {iso_code} preserved primary features dropped during sanitize: "
            f"expected {len(preserve_specs)}, got {len(out)}"
        )
    return out


def _build_ne_country_features(
    ne_admin1: gpd.GeoDataFrame,
    iso_code: str,
    rule: dict | int,
    shell_geom,
    primary_shell_source: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    spec = _normalize_ne_country_rule(rule)
    iso_col = pick_column(ne_admin1, ["iso_a2", "adm0_a2", "iso_3166_1_"])
    if not iso_col:
        raise SystemExit("[Global Basic] Natural Earth admin1 missing ISO country column.")

    source = ne_admin1[
        ne_admin1[iso_col].fillna("").astype(str).str.upper().str.strip() == iso_code
    ].copy()
    if source.empty:
        raise SystemExit(f"[Global Basic] Natural Earth admin1 has no rows for {iso_code}.")

    id_col = pick_column(source, ["adm1_code", "iso_3166_2", "gn_id", "id"])
    name_candidates = ["name_en", "name", "gn_name", "woe_name", "name_local"]
    if not any(col in source.columns for col in name_candidates):
        raise SystemExit(
            f"[Global Basic] Natural Earth admin1 missing name columns for {iso_code}. "
            f"Available: {source.columns.tolist()}"
        )

    source = source.copy()
    source["name"] = _coalesce_text_columns(source, name_candidates)
    source["__source_code"] = ""
    if id_col:
        source["__source_code"] = (
            source[id_col]
            .fillna("")
            .astype(str)
            .str.strip()
        )
    source["__source_code"] = (
        source["__source_code"]
        .replace("", pd.NA)
        .fillna(source["name"].map(_slugify).replace("", pd.NA).fillna("unit"))
        .astype(str)
        .str.strip()
    )

    include_codes = {
        str(code).strip()
        for code in spec.get("include_adm1_codes", [])
        if str(code).strip()
    }
    merge_map = {
        str(child).strip(): str(parent).strip()
        for child, parent in dict(spec.get("merge_minor_adm1_to_parent", {})).items()
        if str(child).strip() and str(parent).strip()
    }
    relevant_codes = include_codes | set(merge_map.keys()) | set(merge_map.values())
    if relevant_codes:
        source = source[source["__source_code"].isin(relevant_codes)].copy()
        if source.empty:
            raise SystemExit(
                f"[Global Basic] Natural Earth admin1 filter removed all rows for {iso_code}."
            )

    source = _collapse_ne_rows(source)
    source = _merge_minor_units(source, merge_map, iso_code)
    if include_codes:
        source = source[source["__source_code"].isin(include_codes)].copy()
        if source.empty:
            raise SystemExit(
                f"[Global Basic] Natural Earth admin1 include list produced zero rows for {iso_code}."
            )

    rename_map = {
        str(key).strip(): str(value).strip()
        for key, value in dict(spec.get("rename_map", {})).items()
        if str(key).strip() and str(value).strip()
    }
    if rename_map:
        source["name"] = [
            rename_map.get(
                str(row.get("__source_code", "")).strip(),
                rename_map.get(str(row.get("name", "")).strip(), str(row.get("name", "")).strip()),
            )
            for row in source.to_dict("records")
        ]

    source["id"] = iso_code + "_ADM1_" + source["__source_code"].astype(str).str.strip()
    missing_name = source["name"] == ""
    if missing_name.any():
        source.loc[missing_name, "name"] = (
            source.loc[missing_name, "__source_code"]
            .astype(str)
            .str.replace("_", " ", regex=False)
            .str.strip()
        )
    source["cntr_code"] = iso_code
    source["admin1_group"] = source["name"]
    source["detail_tier"] = str(spec.get("detail_tier", "adm1_basic")).strip() or "adm1_basic"

    preserve_specs = list(spec.get("preserve_primary_features") or [])
    expected_total = int(spec.get("expected_count", 0))
    core_expected = expected_total - len(preserve_specs)
    if core_expected < 0:
        raise SystemExit(
            f"[Global Basic] {iso_code} expected_count is smaller than preserved feature count."
        )

    core = _finalize_country(
        source,
        iso_code=iso_code,
        expected_count=core_expected,
        shell_geom=shell_geom,
        tolerance=cfg.SIMPLIFY_GLOBAL_BASIC_ADMIN1,
    )
    preserved = _build_preserved_primary_features(
        primary_shell_source,
        ne_admin1,
        iso_code,
        preserve_specs,
        shell_geom,
    )
    if preserved.empty:
        combined = core
    else:
        combined = gpd.GeoDataFrame(pd.concat([core, preserved], ignore_index=True), crs="EPSG:4326")
    if combined["id"].duplicated().any():
        dupes = combined.loc[combined["id"].duplicated(), "id"].astype(str).tolist()[:10]
        raise SystemExit(f"[Global Basic] Duplicate IDs detected for {iso_code}: {dupes}")
    _validate_count(combined, iso_code, expected_total)
    return combined


def _build_geo_boundaries_features(
    iso_code: str,
    spec: dict,
    shell_geom,
) -> gpd.GeoDataFrame:
    source = fetch_or_load_geojson(
        spec["url"],
        spec["filename"],
        fallback_urls=list(spec.get("fallback_urls") or []),
    )
    source = ensure_crs(source)
    if source.empty:
        raise SystemExit(f"[Global Basic] geoBoundaries source is empty for {iso_code}.")

    id_col = pick_column(source, ["shapeID", "id", "ID"])
    name_col = pick_column(source, ["shapeName", "name", "NAME"])
    if not id_col or not name_col:
        raise SystemExit(
            f"[Global Basic] geoBoundaries missing id/name columns for {iso_code}. "
            f"Available: {source.columns.tolist()}"
        )

    source["id"] = iso_code + "_ADM1_" + source[id_col].fillna("").astype(str).str.strip()
    source["name"] = source[name_col].fillna("").astype(str).str.strip()
    source["cntr_code"] = iso_code
    source["admin1_group"] = source["name"]
    source["detail_tier"] = "adm1_basic"
    return _finalize_country(
        source,
        iso_code=iso_code,
        expected_count=int(spec["expected_count"]),
        shell_geom=shell_geom,
        tolerance=cfg.SIMPLIFY_GLOBAL_BASIC_ADMIN1,
    )


def _build_gb_nuts1_features(spec: dict, shell_geom) -> gpd.GeoDataFrame:
    source = fetch_or_load_geojson(
        spec["url"],
        spec["filename"],
        fallback_urls=list(spec.get("fallback_urls") or []),
    )
    source = ensure_crs(source)
    if source.empty:
        raise SystemExit("[Global Basic] GISCO NUTS1 source is empty for GB.")

    code_col = pick_column(source, ["CNTR_CODE", "cntr_code"])
    id_col = pick_column(source, ["NUTS_ID", "nuts_id"])
    name_col = pick_column(source, ["NUTS_NAME", "NAME_LATN", "name"])
    if not code_col or not id_col or not name_col:
        raise SystemExit(
            "[Global Basic] GISCO NUTS1 missing code/id/name columns for GB. "
            f"Available: {source.columns.tolist()}"
        )

    source = source[source[code_col].fillna("").astype(str).str.upper().str.strip() == "UK"].copy()
    if source.empty:
        raise SystemExit("[Global Basic] GISCO NUTS1 returned no UK rows.")

    source["id"] = "GB_NUTS1_" + source[id_col].fillna("").astype(str).str.strip()
    source["name"] = source[name_col].fillna("").astype(str).str.strip()
    source["cntr_code"] = "GB"
    source["admin1_group"] = source["name"]
    source["detail_tier"] = "nuts1_basic"
    return _finalize_country(
        source,
        iso_code="GB",
        expected_count=int(spec["expected_count"]),
        shell_geom=shell_geom,
        tolerance=cfg.SIMPLIFY_GB_NUTS1,
    )


def _build_passthrough_feature(primary_shell_source: gpd.GeoDataFrame, iso_code: str) -> gpd.GeoDataFrame:
    shell = _get_country_shell(primary_shell_source, iso_code, label="admin0")
    if shell is None:
        raise SystemExit(f"[Global Basic] Missing admin0 shell for passthrough country {iso_code}.")

    subset = primary_shell_source[
        primary_shell_source["cntr_code"].fillna("").astype(str).str.upper().str.strip() == iso_code
    ].copy()
    name = ""
    if not subset.empty and "name" in subset.columns:
        name = str(subset["name"].iloc[0]).strip()
    name = name or iso_code
    out = gpd.GeoDataFrame(
        [
            {
                "id": f"{iso_code}_ADMIN0_PASSTHROUGH",
                "name": name,
                "cntr_code": iso_code,
                "admin1_group": "",
                "detail_tier": "admin0_passthrough",
                "geometry": shell,
            }
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )
    out = _sanitize_polygon_layer(out)
    _validate_count(out, iso_code, 1)
    return out


def apply_global_basic_admin1_replacement(detail_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if detail_gdf.empty:
        return detail_gdf
    if "cntr_code" not in detail_gdf.columns:
        print("[Global Basic] cntr_code missing; skipping replacement.")
        return detail_gdf

    target_codes = (
        set(cfg.GLOBAL_BASIC_NE_COUNTRY_RULES.keys())
        | set(cfg.GLOBAL_BASIC_SPECIAL_SOURCES.keys())
        | set(cfg.GLOBAL_BASIC_PASSTHROUGH_COUNTRIES)
    )
    normalized_codes = detail_gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    base = detail_gdf[~normalized_codes.isin(target_codes)].copy()
    base = ensure_crs(base)

    primary_shell_source = _load_primary_political_shells()
    shells: dict[str, object] = {}
    for code in sorted(target_codes):
        if code in cfg.GLOBAL_BASIC_PASSTHROUGH_COUNTRIES:
            continue
        shell = _get_country_shell(detail_gdf, code, label="detail")
        if shell is None and not primary_shell_source.empty:
            shell = _get_country_shell(primary_shell_source, code, label="primary")
        if shell is None:
            raise SystemExit(f"[Global Basic] Missing detail and primary shell for {code}.")
        shells[code] = shell

    ne_admin1 = _load_ne_admin1()
    outputs: list[gpd.GeoDataFrame] = [base]

    for iso_code, rule in cfg.GLOBAL_BASIC_NE_COUNTRY_RULES.items():
        print(f"[Global Basic] Building Natural Earth admin1 detail for {iso_code}...")
        country_gdf = _build_ne_country_features(
            ne_admin1,
            iso_code,
            rule,
            shells[iso_code],
            primary_shell_source,
        )
        print(f"[Global Basic] {iso_code} features: {len(country_gdf)}")
        outputs.append(country_gdf)

    for iso_code, spec in cfg.GLOBAL_BASIC_SPECIAL_SOURCES.items():
        source_type = str(spec.get("source_type", "")).strip()
        print(f"[Global Basic] Building special-source detail for {iso_code} ({source_type})...")
        if source_type == "gisco_nuts1":
            country_gdf = _build_gb_nuts1_features(spec, shells[iso_code])
        elif source_type == "geoBoundaries_adm1":
            country_gdf = _build_geo_boundaries_features(iso_code, spec, shells[iso_code])
        else:
            raise SystemExit(f"[Global Basic] Unsupported source_type for {iso_code}: {source_type}")
        print(f"[Global Basic] {iso_code} features: {len(country_gdf)}")
        outputs.append(country_gdf)

    for iso_code in sorted(cfg.GLOBAL_BASIC_PASSTHROUGH_COUNTRIES):
        print(f"[Global Basic] Building admin0 passthrough detail for {iso_code}...")
        country_gdf = _build_passthrough_feature(primary_shell_source, iso_code)
        outputs.append(country_gdf)

    combined = gpd.GeoDataFrame(pd.concat(outputs, ignore_index=True), crs="EPSG:4326")
    if combined["id"].duplicated().any():
        dupes = combined.loc[combined["id"].duplicated(), "id"].astype(str).tolist()[:10]
        raise SystemExit(f"[Global Basic] Duplicate IDs detected after replacement: {dupes}")
    print(
        "[Global Basic] Replacement complete: "
        f"countries={len(target_codes)}, total={len(combined)}"
    )
    return combined
