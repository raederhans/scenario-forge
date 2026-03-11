"""Local shared-boundary canonicalization for managed detail countries."""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
import topojson as tp
from shapely.ops import transform, unary_union
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

from map_builder.processors.detail_shell_coverage import (
    DEFAULT_SHELL_COVERAGE_SPECS,
    collect_shell_coverage_gaps,
)


LOCAL_CANONICAL_COUNTRY_CODES: tuple[str, ...] = ("RU", "UA", "DE", "GB", "CZ")
LOCAL_CANONICAL_SNAP_PRECISION = 6
TARGET_COUNTRY_CODES: tuple[str, ...] = LOCAL_CANONICAL_COUNTRY_CODES
COUNTRY_GAP_TARGET_KM2 = 1.0
STRICT_GAP_TARGET_COUNTRIES: tuple[str, ...] = ("DE", "GB", "CZ")
ORDER_OF_MAGNITUDE_IMPROVEMENT_COUNTRIES: tuple[str, ...] = ("RU", "UA")


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
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


def _round_geometry(geom, precision: int):
    if geom is None or geom.is_empty:
        return None

    def _rounder(x, y, z=None):
        rx = round(x, precision)
        ry = round(y, precision)
        if z is None:
            return (rx, ry)
        return (rx, ry, round(z, precision))

    try:
        return transform(_rounder, geom)
    except Exception:
        return geom


def _normalize_country_code(raw_code: object) -> str:
    return str(raw_code or "").strip().upper()


def _extract_country_code_from_id(value: object) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    prefix = text.split("-", 1)[0].split("_", 1)[0]
    alpha = "".join(ch for ch in prefix if ch.isalpha())
    return alpha[:3]


def _prepare_political_gdf(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf is None or gdf.empty:
        return _empty_gdf()
    out = _ensure_epsg4326(gdf.copy())
    if "id" not in out.columns:
        out["id"] = ""
    if "cntr_code" not in out.columns:
        out["cntr_code"] = [
            _extract_country_code_from_id(value)
            for value in out["id"]
        ]
    out["id"] = out["id"].fillna("").astype(str).str.strip()
    out["cntr_code"] = out["cntr_code"].apply(_normalize_country_code)
    out["geometry"] = out.geometry.apply(_make_valid)
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    if out.empty:
        return _empty_gdf()
    out = out[out.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    if out.empty:
        return _empty_gdf()
    return out.reset_index(drop=True)


def _country_union_geometry(gdf: gpd.GeoDataFrame | None, country_code: str):
    prepared = _prepare_political_gdf(gdf) if gdf is not None else _empty_gdf()
    if prepared.empty:
        return None
    if "cntr_code" not in prepared.columns or not prepared["cntr_code"].astype(str).str.strip().any():
        subset = prepared.copy()
    else:
        subset = prepared[prepared["cntr_code"] == country_code].copy()
        if subset.empty:
            subset = prepared.copy()
    if subset.empty:
        return None
    union_geom = _make_valid(unary_union(subset.geometry.tolist()))
    if union_geom is None or union_geom.is_empty:
        return None
    return union_geom


def _topology_object_to_gdf(topo_dict: dict, object_name: str) -> gpd.GeoDataFrame:
    source = topo_dict.get("objects", {})
    if object_name not in source:
        return _empty_gdf()
    try:
        feature_collection = serialize_as_geojson(topo_dict, objectname=object_name)
    except Exception:
        return _empty_gdf()
    if not isinstance(feature_collection, dict) or not feature_collection.get("features"):
        return _empty_gdf()
    gdf = serialize_as_geodataframe(feature_collection)
    if gdf.empty:
        return _empty_gdf()
    return _ensure_epsg4326(gdf)


def _normalize_arc_index(value: int) -> int:
    return value if value >= 0 else ~value


def _iter_arc_indices(node):
    if isinstance(node, int):
        yield _normalize_arc_index(node)
        return
    if isinstance(node, list):
        for item in node:
            yield from _iter_arc_indices(item)


def _build_country_subset_topology(country_gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    prepared = _prepare_political_gdf(country_gdf)
    if prepared.empty:
        return _empty_gdf()
    topology_dict = tp.Topology(
        [prepared.fillna("")],
        object_name=["political"],
        prequantize=False,
        topology=True,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    ).to_dict()
    roundtrip = _topology_object_to_gdf(topology_dict, "political")
    if roundtrip.empty:
        return _empty_gdf()
    if "id" not in roundtrip.columns:
        return _empty_gdf()
    roundtrip["id"] = roundtrip["id"].fillna("").astype(str).str.strip()
    roundtrip = roundtrip[roundtrip["id"] != ""].copy()
    if roundtrip.empty:
        return _empty_gdf()
    roundtrip["geometry"] = roundtrip.geometry.apply(_make_valid)
    roundtrip = roundtrip[roundtrip.geometry.notna() & ~roundtrip.geometry.is_empty].copy()
    if roundtrip.empty:
        return _empty_gdf()
    base_cols = [col for col in prepared.columns if col != "geometry"]
    merged = prepared[base_cols].merge(
        roundtrip[["id", "geometry"]],
        on="id",
        how="inner",
        validate="one_to_one",
    )
    if merged.empty:
        return _empty_gdf()
    return gpd.GeoDataFrame(merged, geometry="geometry", crs="EPSG:4326")


def canonicalize_country_boundaries(
    political_gdf: gpd.GeoDataFrame,
    *,
    shell_gdf: gpd.GeoDataFrame | None = None,
    allowed_area_gdf: gpd.GeoDataFrame | None = None,
    target_country_codes: tuple[str, ...] | list[str] | None = None,
    snap_precision: int = LOCAL_CANONICAL_SNAP_PRECISION,
    log_prefix: str = "[Canonicalize]",
) -> tuple[gpd.GeoDataFrame, list[dict[str, object]]]:
    target_codes = tuple(
        _normalize_country_code(code)
        for code in (target_country_codes or LOCAL_CANONICAL_COUNTRY_CODES)
        if _normalize_country_code(code)
    )
    out = _prepare_political_gdf(political_gdf)
    out["__row_order"] = list(range(len(out)))
    reports: list[dict[str, object]] = []
    if out.empty or not target_codes:
        return out, reports

    for country_code in target_codes:
        subset = out[out["cntr_code"] == country_code].copy()
        if subset.empty:
            continue

        clip_geom = _country_union_geometry(shell_gdf, country_code)
        allowed_geom = _country_union_geometry(allowed_area_gdf, country_code)
        if clip_geom is not None and allowed_geom is not None:
            clip_geom = _make_valid(clip_geom.intersection(allowed_geom))
        elif allowed_geom is not None:
            clip_geom = allowed_geom

        before_count = len(subset)
        original_ids = set(subset["id"].astype(str))
        subset["geometry"] = subset.geometry.apply(
            lambda geom: _round_geometry(_make_valid(geom), snap_precision)
        )
        if clip_geom is not None:
            subset["geometry"] = subset.geometry.apply(
                lambda geom: _make_valid(geom.intersection(clip_geom)) if geom is not None else None
            )
        subset = _prepare_political_gdf(subset)
        if subset.empty:
            reports.append(
                {
                    "country_code": country_code,
                    "before_feature_count": before_count,
                    "after_feature_count": 0,
                    "changed": False,
                    "skipped": True,
                    "reason": "empty-after-clean",
                }
            )
            continue

        try:
            canonicalized = _build_country_subset_topology(subset)
        except Exception as exc:
            reports.append(
                {
                    "country_code": country_code,
                    "before_feature_count": before_count,
                    "after_feature_count": len(subset),
                    "changed": False,
                    "skipped": True,
                    "reason": f"topology-error:{exc}",
                }
            )
            print(f"{log_prefix} {country_code}: local topology rebuild skipped: {exc}")
            continue

        canonical_ids = set(canonicalized["id"].astype(str)) if not canonicalized.empty else set()
        if canonicalized.empty or canonical_ids != original_ids:
            reports.append(
                {
                    "country_code": country_code,
                    "before_feature_count": before_count,
                    "after_feature_count": len(canonicalized),
                    "changed": False,
                    "skipped": True,
                    "reason": "id-drift",
                }
            )
            print(
                f"{log_prefix} {country_code}: local topology rebuild skipped due to id drift "
                f"(before={len(original_ids)}, after={len(canonical_ids)})"
            )
            continue

        canonicalized["geometry"] = canonicalized.geometry.apply(
            lambda geom: _round_geometry(_make_valid(geom), snap_precision)
        )
        canonicalized = _prepare_political_gdf(canonicalized)
        if "__row_order" not in canonicalized.columns and "__row_order" in subset.columns:
            canonicalized = subset.drop(columns=["geometry"]).merge(
                canonicalized[["id", "geometry"]],
                on="id",
                how="inner",
                validate="one_to_one",
            )
            canonicalized = gpd.GeoDataFrame(canonicalized, geometry="geometry", crs="EPSG:4326")
            canonicalized = _prepare_political_gdf(canonicalized)
        changed = not canonicalized.geometry.equals(subset.geometry)
        out = pd.concat([out[out["cntr_code"] != country_code], canonicalized], ignore_index=True)
        if "__row_order" in out.columns:
            out["__row_order"] = out["__row_order"].fillna(len(out)).astype(int)
            out = out.sort_values("__row_order", kind="stable").reset_index(drop=True)
        reports.append(
            {
                "country_code": country_code,
                "before_feature_count": before_count,
                "after_feature_count": len(canonicalized),
                "changed": bool(changed),
                "skipped": False,
            }
        )
        print(
            f"{log_prefix} {country_code}: canonicalized "
            f"features={before_count}->{len(canonicalized)}, changed={bool(changed)}"
        )

    if "__row_order" in out.columns:
        out = out.drop(columns=["__row_order"])
    return _prepare_political_gdf(out), reports


def collect_topology_country_metrics(
    topology_path_or_dict: Path | dict,
    *,
    shell_gdf: gpd.GeoDataFrame | None = None,
    allowed_area_gdf: gpd.GeoDataFrame | None = None,
    target_country_codes: tuple[str, ...] | list[str] | None = None,
) -> dict[str, dict[str, float | int]]:
    target_codes = tuple(
        _normalize_country_code(code)
        for code in (target_country_codes or LOCAL_CANONICAL_COUNTRY_CODES)
        if _normalize_country_code(code)
    )
    topo_dict = (
        topology_path_or_dict
        if isinstance(topology_path_or_dict, dict)
        else json.loads(Path(topology_path_or_dict).read_text(encoding="utf-8"))
    )
    political_gdf = _topology_object_to_gdf(topo_dict, "political")
    political_gdf = _prepare_political_gdf(political_gdf)
    metrics: dict[str, dict[str, float | int]] = {
        code: {
            "feature_count": 0,
            "fragment_count": 0,
            "total_area_km2": 0.0,
            "max_fragment_area_km2": 0.0,
            "shared_arc_ratio": 0.0,
        }
        for code in target_codes
    }

    if political_gdf.empty:
        return metrics

    for code in target_codes:
        subset = political_gdf[political_gdf["cntr_code"] == code]
        metrics[code]["feature_count"] = int(len(subset))

    coverage_specs = {
        code: spec
        for code, spec in DEFAULT_SHELL_COVERAGE_SPECS.items()
        if code in target_codes
    }
    if shell_gdf is not None and coverage_specs:
        gaps = collect_shell_coverage_gaps(
            political_gdf,
            shell_gdf,
            coverage_specs,
            exclude_managed_fragments=False,
            allowed_area_gdf=allowed_area_gdf,
        )
        for gap in gaps:
            code = str(gap.get("country_code") or "").strip().upper()
            if code not in metrics:
                continue
            metrics[code]["fragment_count"] = int(gap.get("fragment_count", 0))
            metrics[code]["total_area_km2"] = round(float(gap.get("total_area_km2", 0.0)), 3)
            metrics[code]["max_fragment_area_km2"] = round(
                float(gap.get("max_fragment_area_km2", 0.0)),
                3,
            )

    political_obj = topo_dict.get("objects", {}).get("political", {})
    geometries = political_obj.get("geometries", []) if isinstance(political_obj, dict) else []
    country_arc_refs: dict[str, Counter[int]] = {code: Counter() for code in target_codes}
    for geom in geometries if isinstance(geometries, list) else []:
        props = geom.get("properties", {}) or {}
        country_code = _normalize_country_code(
            props.get("cntr_code") or _extract_country_code_from_id(props.get("id") or geom.get("id"))
        )
        if country_code not in country_arc_refs:
            continue
        country_arc_refs[country_code].update(_iter_arc_indices(geom.get("arcs")))

    for code, counter in country_arc_refs.items():
        total_refs = sum(counter.values())
        shared_refs = sum(count for count in counter.values() if count > 1)
        metrics[code]["shared_arc_ratio"] = round(
            (shared_refs / total_refs) if total_refs else 0.0,
            4,
        )

    return metrics


def canonicalize_local_country_boundaries(
    political_gdf: gpd.GeoDataFrame,
    *,
    shell_gdf: gpd.GeoDataFrame | None = None,
    allowed_area_gdf: gpd.GeoDataFrame | None = None,
    target_country_codes: tuple[str, ...] | list[str] | None = None,
    snap_precision: int = LOCAL_CANONICAL_SNAP_PRECISION,
    log_prefix: str = "[Canonicalize]",
) -> tuple[gpd.GeoDataFrame, dict[str, dict[str, object]]]:
    out, reports = canonicalize_country_boundaries(
        political_gdf,
        shell_gdf=shell_gdf,
        allowed_area_gdf=allowed_area_gdf,
        target_country_codes=target_country_codes,
        snap_precision=snap_precision,
        log_prefix=log_prefix,
    )
    report_map = {
        str(row.get("country_code") or "").strip().upper(): row
        for row in reports
        if str(row.get("country_code") or "").strip()
    }
    return out, report_map


def collect_country_gate_metrics(
    topology_path: Path,
    *,
    primary_shell_path: Path,
    target_country_codes: tuple[str, ...] | list[str] | None = None,
) -> dict[str, dict[str, float | int]]:
    shell_gdf = _topology_object_to_gdf(json.loads(Path(primary_shell_path).read_text(encoding="utf-8")), "political")
    allowed_area_gdf = _topology_object_to_gdf(json.loads(Path(primary_shell_path).read_text(encoding="utf-8")), "land")
    return collect_topology_country_metrics(
        topology_path,
        shell_gdf=shell_gdf,
        allowed_area_gdf=allowed_area_gdf,
        target_country_codes=target_country_codes,
    )


def evaluate_country_gate_metrics(
    baseline_metrics: dict[str, dict[str, float | int]] | None,
    candidate_metrics: dict[str, dict[str, float | int]],
    *,
    target_country_codes: tuple[str, ...] | list[str] | None = None,
) -> list[str]:
    target_codes = tuple(
        _normalize_country_code(code)
        for code in (target_country_codes or LOCAL_CANONICAL_COUNTRY_CODES)
        if _normalize_country_code(code)
    )
    previous = baseline_metrics or {}
    problems: list[str] = []

    for code in target_codes:
        baseline = previous.get(code, {})
        candidate = candidate_metrics.get(code, {})

        base_feature_count = int(baseline.get("feature_count", 0) or 0)
        cand_feature_count = int(candidate.get("feature_count", 0) or 0)
        if cand_feature_count < base_feature_count:
            problems.append(f"{code}: feature_count regressed {base_feature_count} -> {cand_feature_count}")

        base_gap = float(baseline.get("total_area_km2", 0.0) or 0.0)
        cand_gap = float(candidate.get("total_area_km2", 0.0) or 0.0)
        if cand_gap > base_gap + 0.001:
            problems.append(f"{code}: shell gap worsened {base_gap:.3f} -> {cand_gap:.3f} km^2")

        base_fragment = float(baseline.get("max_fragment_area_km2", 0.0) or 0.0)
        cand_fragment = float(candidate.get("max_fragment_area_km2", 0.0) or 0.0)
        if cand_fragment > base_fragment + 0.001:
            problems.append(
                f"{code}: max shell fragment worsened {base_fragment:.3f} -> {cand_fragment:.3f} km^2"
            )

        base_arc_ratio = float(baseline.get("shared_arc_ratio", 0.0) or 0.0)
        cand_arc_ratio = float(candidate.get("shared_arc_ratio", 0.0) or 0.0)
        if cand_arc_ratio + 0.0001 < base_arc_ratio:
            problems.append(f"{code}: arc sharing regressed {base_arc_ratio:.4f} -> {cand_arc_ratio:.4f}")

        if code in STRICT_GAP_TARGET_COUNTRIES and cand_gap >= COUNTRY_GAP_TARGET_KM2:
            problems.append(
                f"{code}: shell gap target missed {cand_gap:.3f} km^2 >= {COUNTRY_GAP_TARGET_KM2:.1f}"
            )

        if code in ORDER_OF_MAGNITUDE_IMPROVEMENT_COUNTRIES and base_gap > 0.0:
            target_gap = max(base_gap / 10.0, COUNTRY_GAP_TARGET_KM2)
            if cand_gap > target_gap:
                problems.append(
                    f"{code}: expected order-of-magnitude improvement from {base_gap:.3f} km^2, "
                    f"got {cand_gap:.3f} km^2"
                )

    return problems
