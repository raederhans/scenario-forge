"""Belarus hybrid replacement processor.

This keeps modern external-border rayons visible while reserving a western
historical strip for HOI4 1936 scenario ownership.
"""
from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from map_builder import config as cfg
from map_builder.geo.utils import ensure_crs, pick_column, smart_island_cull
from map_builder.io.fetch import fetch_ne_zip, fetch_or_load_geojson


BORDER_NEIGHBOR_CODES = ("PL", "LT", "LV", "RU")
BELARUS_TARGET_FEATURE_COUNT_RANGE = range(35, 38)
CITY_OF_MINSK_NAME = "Minsk City"
MISSING_FRAGMENT_RESTORE_MIN_KM2 = 1.0
MISSING_FRAGMENT_VALIDATE_MAX_KM2 = 50.0

HISTORICAL_GROUPS = {
    "BY_HIST_POL_MINSK_WEST": {
        "name": "Western Minsk Kresy",
        "admin1_group": "Minsk",
        "members": [
            "Kletsk",
            "Nyasvizh",
            "Valozhyn",
            "Stowbtsy",
            "Maladzyechna",
            "Myadzyel",
            "Vileyka",
        ],
    },
    "BY_HIST_POL_VITEBSK_WEST": {
        "name": "Western Vitebsk Kresy",
        "admin1_group": "Vitebsk",
        "members": [
            "Dokshytsy",
            "Hlybokaye",
            "Miory",
            "Sharkawshchyna",
            "Ushachy",
        ],
    },
}

INTERIOR_GROUP_IDS = {
    "Brest": "BY_INT_BREST",
    "Gomel": "BY_INT_GOMEL",
    "Mogilev": "BY_INT_MOGILEV",
    "Vitebsk": "BY_INT_VITEBSK",
    "Grodno": "BY_INT_GRODNO",
    "Minsk": "BY_INT_MINSK",
}


def _data_dir() -> Path:
    path = Path(__file__).resolve().parents[2] / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


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


def _load_admin0_countries() -> gpd.GeoDataFrame:
    local_path = _data_dir() / "ne_50m_admin_0_countries.zip"
    if local_path.exists():
        gdf = gpd.read_file(local_path)
    else:
        gdf = fetch_ne_zip(cfg.BORDERS_URL, "belarus_admin0")
    return ensure_crs(gdf)


def _get_admin0_shell(admin0: gpd.GeoDataFrame, iso_code: str):
    iso_col = pick_column(admin0, ["ISO_A2", "iso_a2", "ADM0_A3_US", "adm0_a3_us"])
    if not iso_col:
        raise SystemExit("[Belarus] Admin0 source missing ISO country columns.")
    subset = admin0[
        admin0[iso_col].fillna("").astype(str).str.upper().str.strip() == iso_code
    ].copy()
    subset = _sanitize_polygon_layer(subset)
    if subset.empty:
        raise SystemExit(f"[Belarus] Admin0 source returned no rows for {iso_code}.")
    shell = _make_valid_geom(unary_union(subset.geometry.tolist()))
    if shell is None or shell.is_empty:
        raise SystemExit(f"[Belarus] Unable to build shell for {iso_code}.")
    return shell


def _clip_source_to_shell(source: gpd.GeoDataFrame, shell_geom) -> gpd.GeoDataFrame:
    clipped = ensure_crs(source.copy())
    clipped["geometry"] = clipped.geometry.apply(
        lambda geom: _make_valid_geom(geom.intersection(shell_geom))
        if geom is not None and not geom.is_empty
        else None
    )
    clipped = _sanitize_polygon_layer(clipped)
    if clipped.empty:
        raise SystemExit("[Belarus] Shell clip removed all Belarus ADM2 geometries.")
    clipped = smart_island_cull(
        clipped,
        group_col="shapeID",
        threshold_km2=cfg.MIN_VISIBLE_AREA_KM2,
    )
    clipped = _sanitize_polygon_layer(clipped)
    if clipped.empty:
        raise SystemExit("[Belarus] Belarus ADM2 geometries were fully culled after shell clip.")
    return clipped


def _assign_oblast_names(source: gpd.GeoDataFrame, coarse_shells: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    rep_points = source.copy()
    rep_points["geometry"] = rep_points.geometry.representative_point()
    joined = gpd.sjoin(
        rep_points,
        coarse_shells[["name", "geometry"]],
        how="left",
        predicate="within",
    )
    if joined["name"].isna().any():
        missing_mask = joined["name"].isna()
        nearest = gpd.sjoin_nearest(
            rep_points.loc[missing_mask].to_crs(cfg.AREA_CRS),
            coarse_shells[["name", "geometry"]].to_crs(cfg.AREA_CRS),
            how="left",
            distance_col="distance",
        )
        joined.loc[missing_mask, "name"] = nearest["name"].values
    out = source.copy()
    out["oblast_name"] = joined["name"].fillna("").astype(str).str.strip().values
    if (out["oblast_name"] == "").any():
        missing = sorted(out.loc[out["oblast_name"] == "", "shapeName"].astype(str).tolist())
        raise SystemExit(
            "[Belarus] Failed to assign oblast names to Belarus ADM2 rows: "
            + ", ".join(missing[:12])
        )
    return out


def _neighbor_border_mask(source: gpd.GeoDataFrame, admin0: gpd.GeoDataFrame) -> pd.Series:
    mask = pd.Series(False, index=source.index, dtype=bool)
    for iso_code in BORDER_NEIGHBOR_CODES:
        shell = _get_admin0_shell(admin0, iso_code)
        boundary = _make_valid_geom(shell.boundary.buffer(1e-9))
        if boundary is None or boundary.is_empty:
            continue
        touches = source.geometry.apply(
            lambda geom: bool(
                geom is not None
                and not geom.is_empty
                and (
                    geom.touches(shell)
                    or geom.intersects(boundary)
                )
            )
        )
        mask = mask | touches
    return mask


def _build_union_feature(
    source: gpd.GeoDataFrame,
    *,
    feature_id: str,
    name: str,
    admin1_group: str,
    detail_tier: str,
) -> gpd.GeoDataFrame:
    geometry = _make_valid_geom(unary_union(source.geometry.tolist()))
    if geometry is None or geometry.is_empty:
        raise SystemExit(f"[Belarus] Unable to build geometry for {feature_id}.")
    feature = gpd.GeoDataFrame(
        [
            {
                "id": feature_id,
                "name": name,
                "cntr_code": "BY",
                "admin1_group": admin1_group,
                "detail_tier": detail_tier,
                "geometry": geometry,
            }
        ],
        geometry="geometry",
        crs="EPSG:4326",
    )
    return _sanitize_polygon_layer(feature)


def _simplify_output(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    out = gdf.copy()
    out["geometry"] = out.geometry.simplify(
        cfg.SIMPLIFY_BLR_HYBRID,
        preserve_topology=True,
    )
    out = _sanitize_polygon_layer(out)
    if out.empty:
        raise SystemExit("[Belarus] Simplification removed all Belarus hybrid geometries.")
    return out


def _restore_missing_shell_fragments(
    output: gpd.GeoDataFrame,
    *,
    shell_geom,
    coarse_shells: gpd.GeoDataFrame,
) -> gpd.GeoDataFrame:
    restored = output.copy()
    output_union = _make_valid_geom(unary_union(restored.geometry.tolist()))
    shell_union = _make_valid_geom(shell_geom)
    if output_union is None or output_union.is_empty or shell_union is None or shell_union.is_empty:
        return restored

    missing = _make_valid_geom(shell_union.difference(output_union))
    if missing is None or missing.is_empty:
        return restored

    fragments = gpd.GeoDataFrame(geometry=[missing], crs="EPSG:4326")
    fragments = fragments.explode(index_parts=False, ignore_index=True)
    fragments = _sanitize_polygon_layer(fragments)
    if fragments.empty:
        return restored

    projected = fragments.to_crs(cfg.AREA_CRS)
    fragments["__area_km2"] = projected.geometry.area / 1_000_000.0
    fragments = fragments[fragments["__area_km2"] >= MISSING_FRAGMENT_RESTORE_MIN_KM2].copy()
    if fragments.empty:
        return restored

    rep_points = fragments.copy()
    rep_points["geometry"] = rep_points.geometry.representative_point()
    joined = gpd.sjoin(
        rep_points,
        coarse_shells[["name", "geometry"]],
        how="left",
        predicate="within",
    )
    joined_names = joined["name"].groupby(level=0).first()
    if joined["name"].isna().any():
        missing_indexes = [index for index in rep_points.index if index not in joined_names.index or pd.isna(joined_names.get(index))]
        missing_mask = rep_points.index.isin(missing_indexes)
        nearest = gpd.sjoin_nearest(
            rep_points.loc[missing_mask].to_crs(cfg.AREA_CRS),
            coarse_shells[["name", "geometry"]].to_crs(cfg.AREA_CRS),
            how="left",
            distance_col="distance",
        )
        nearest_names = nearest["name"].groupby(level=0).first()
        for index, name in nearest_names.items():
            joined_names.loc[index] = name
    fragments["__oblast_name"] = fragments.index.to_series().map(joined_names).fillna("").astype(str).str.strip().values

    restored = restored.reset_index(drop=True)
    for _, fragment in fragments.iterrows():
        oblast_name = str(fragment["__oblast_name"]).strip()
        candidate_indexes = restored.index[restored["admin1_group"] == oblast_name].tolist()
        if not candidate_indexes:
            continue
        target_index = None
        for index in candidate_indexes:
            if restored.at[index, "detail_tier"] == "adm2_hybrid_interior":
                target_index = index
                break
        if target_index is None:
            target_index = candidate_indexes[0]
        merged = _make_valid_geom(
            unary_union([restored.at[target_index, "geometry"], fragment["geometry"]])
        )
        if merged is None or merged.is_empty:
            continue
        restored.at[target_index, "geometry"] = merged

    return _sanitize_polygon_layer(restored)


def _validate_output(
    output: gpd.GeoDataFrame,
    *,
    source: gpd.GeoDataFrame,
    shell_geom,
) -> None:
    count = int(len(output))
    if count not in BELARUS_TARGET_FEATURE_COUNT_RANGE:
        raise SystemExit(
            "[Belarus] Hybrid feature count mismatch: "
            f"expected 35-37, got {count}."
        )

    output_ids = output["id"].fillna("").astype(str).tolist()
    if len(output_ids) != len(set(output_ids)):
        raise SystemExit("[Belarus] Duplicate Belarus hybrid feature ids detected.")

    for feature_id in HISTORICAL_GROUPS:
        if feature_id not in set(output_ids):
            raise SystemExit(f"[Belarus] Missing required historical feature: {feature_id}.")

    output_union = _make_valid_geom(unary_union(output.geometry.tolist()))
    shell_union = _make_valid_geom(shell_geom)
    if output_union is None or output_union.is_empty or shell_union is None or shell_union.is_empty:
        raise SystemExit("[Belarus] Unable to validate Belarus shell coverage.")

    missing = _make_valid_geom(shell_union.difference(output_union))
    if missing is not None and not missing.is_empty:
        missing_gdf = gpd.GeoDataFrame(geometry=[missing], crs="EPSG:4326").to_crs(cfg.AREA_CRS)
        missing_area_km2 = float(missing_gdf.geometry.area.iloc[0] / 1_000_000.0)
        if missing_area_km2 > MISSING_FRAGMENT_VALIDATE_MAX_KM2:
            raise SystemExit(
                "[Belarus] Belarus hybrid output leaves visible shell gaps: "
                f"{missing_area_km2:.2f} km^2."
            )

    consumed_shape_ids = set(source["shapeID"].astype(str).tolist())
    if len(consumed_shape_ids) != len(source):
        raise SystemExit("[Belarus] Belarus ADM2 source contains duplicate shapeID values.")


def apply_belarus_replacement(main_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if main_gdf.empty:
        return main_gdf
    if "cntr_code" not in main_gdf.columns:
        print("[Belarus] cntr_code missing; skipping replacement.")
        return main_gdf

    normalized_codes = main_gdf["cntr_code"].fillna("").astype(str).str.upper().str.strip()
    coarse_by = _sanitize_polygon_layer(main_gdf[normalized_codes == "BY"].copy())
    if coarse_by.empty:
        print("[Belarus] No existing Belarus features found; skipping replacement.")
        return main_gdf

    print("[Belarus] Downloading Belarus ADM2 (geoBoundaries)...")
    source = fetch_or_load_geojson(
        cfg.BLR_ADM2_URL,
        cfg.BLR_ADM2_FILENAME,
        fallback_urls=cfg.BLR_ADM2_FALLBACK_URLS,
    )
    source = ensure_crs(source)
    if source.empty:
        raise SystemExit("[Belarus] Belarus ADM2 source is empty.")
    if "shapeID" not in source.columns or "shapeName" not in source.columns:
        raise SystemExit(
            "[Belarus] Belarus ADM2 missing required shapeID/shapeName columns. "
            f"Available: {source.columns.tolist()}"
        )

    shell_geom = _make_valid_geom(unary_union(coarse_by.geometry.tolist()))
    if shell_geom is None or shell_geom.is_empty:
        raise SystemExit("[Belarus] Unable to derive Belarus shell from current detail topology.")

    source = _sanitize_polygon_layer(source)
    source = _clip_source_to_shell(source, shell_geom)
    source["shapeID"] = source["shapeID"].fillna("").astype(str).str.strip()
    source["shapeName"] = source["shapeName"].fillna("").astype(str).str.strip()
    source = source[(source["shapeID"] != "") & (source["shapeName"] != "")].copy()
    source = _assign_oblast_names(source, coarse_by)

    consumed_ids: set[str] = set()
    outputs: list[gpd.GeoDataFrame] = []

    city_rows = source[source["shapeName"] == CITY_OF_MINSK_NAME].copy()
    if len(city_rows) != 1:
        raise SystemExit(
            f"[Belarus] Expected exactly one `{CITY_OF_MINSK_NAME}` row, got {len(city_rows)}."
        )
    outputs.append(
        _build_union_feature(
            city_rows,
            feature_id="BY_CITY_MINSK",
            name=CITY_OF_MINSK_NAME,
            admin1_group="City of Minsk",
            detail_tier="adm2_hybrid_interior",
        )
    )
    consumed_ids.update(city_rows["shapeID"].tolist())

    for feature_id, spec in HISTORICAL_GROUPS.items():
        rows = source[source["shapeName"].isin(spec["members"])].copy()
        found_names = set(rows["shapeName"].astype(str).tolist())
        missing_names = [name for name in spec["members"] if name not in found_names]
        if missing_names:
            raise SystemExit(
                f"[Belarus] Missing required historical members for {feature_id}: "
                + ", ".join(missing_names)
            )
        if consumed_ids.intersection(rows["shapeID"].tolist()):
            raise SystemExit(f"[Belarus] Historical group {feature_id} overlaps with another Belarus bucket.")
        outputs.append(
            _build_union_feature(
                rows,
                feature_id=feature_id,
                name=str(spec["name"]),
                admin1_group=str(spec["admin1_group"]),
                detail_tier="adm2_hybrid_historical",
            )
        )
        consumed_ids.update(rows["shapeID"].tolist())

    remaining = source[~source["shapeID"].isin(consumed_ids)].copy()
    admin0 = _load_admin0_countries()
    border_mask = _neighbor_border_mask(remaining, admin0)
    border_rows = remaining.loc[border_mask].copy()
    for _, row in border_rows.iterrows():
        outputs.append(
            gpd.GeoDataFrame(
                [
                    {
                        "id": f"BY_RAY_{row['shapeID']}",
                        "name": str(row["shapeName"]).strip(),
                        "cntr_code": "BY",
                        "admin1_group": str(row["oblast_name"]).strip(),
                        "detail_tier": "adm2_hybrid_border",
                        "geometry": row["geometry"],
                    }
                ],
                geometry="geometry",
                crs="EPSG:4326",
            )
        )
    consumed_ids.update(border_rows["shapeID"].tolist())

    interior_rows = source[~source["shapeID"].isin(consumed_ids)].copy()
    for oblast_name, feature_id in INTERIOR_GROUP_IDS.items():
        rows = interior_rows[interior_rows["oblast_name"] == oblast_name].copy()
        if rows.empty:
            raise SystemExit(f"[Belarus] Interior group {oblast_name} has no remaining Belarus ADM2 rows.")
        outputs.append(
            _build_union_feature(
                rows,
                feature_id=feature_id,
                name=f"{oblast_name} Interior",
                admin1_group=oblast_name,
                detail_tier="adm2_hybrid_interior",
            )
        )
        consumed_ids.update(rows["shapeID"].tolist())

    if len(consumed_ids) != len(source):
        unconsumed = sorted(set(source["shapeID"].tolist()) - consumed_ids)
        raise SystemExit(
            "[Belarus] Some Belarus ADM2 rows were not consumed: "
            + ", ".join(unconsumed[:12])
        )

    belarus_output = gpd.GeoDataFrame(
        pd.concat(outputs, ignore_index=True),
        crs="EPSG:4326",
    )
    belarus_output = _simplify_output(belarus_output)
    belarus_output = _restore_missing_shell_fragments(
        belarus_output,
        shell_geom=shell_geom,
        coarse_shells=coarse_by,
    )
    _validate_output(
        belarus_output,
        source=source,
        shell_geom=shell_geom,
    )

    base = main_gdf[normalized_codes != "BY"].copy()
    combined = gpd.GeoDataFrame(
        pd.concat([base, belarus_output], ignore_index=True),
        crs=main_gdf.crs or "EPSG:4326",
    )
    print(
        "[Belarus] Replacement complete: "
        f"features={len(belarus_output)}, border={int((belarus_output['detail_tier'] == 'adm2_hybrid_border').sum())}, "
        f"historical={int((belarus_output['detail_tier'] == 'adm2_hybrid_historical').sum())}, "
        f"interior={int((belarus_output['detail_tier'] == 'adm2_hybrid_interior').sum())}."
    )
    return combined
