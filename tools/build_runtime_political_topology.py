"""Build the unified runtime political topology used by dynamic sovereignty."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import time

import geopandas as gpd
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.geo.local_canonicalization import (
    LOCAL_CANONICAL_COUNTRY_CODES,
    canonicalize_country_boundaries,
)
from map_builder.geo.topology import build_political_only_topology
from map_builder.processors.detail_shell_coverage import (
    append_shell_coverage_gap_fragments,
    collect_shell_coverage_gaps,
    repair_shell_coverage,
)

try:
    import resource
except Exception:  # pragma: no cover - unavailable on some platforms
    resource = None

MAX_SHELL_COVERAGE_REPAIR_PASSES = 6


def _get_peak_memory_mb() -> float | None:
    if resource is None:
        return None
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:
        return None
    if sys.platform == "darwin":
        return round(float(usage) / (1024 * 1024), 2)
    return round(float(usage) / 1024, 2)


def _record_timing(timings: dict[str, dict], stage_name: str, start_time: float, **extra: object) -> None:
    payload = {
        "wall_time_sec": round(time.perf_counter() - start_time, 3),
        "peak_memory_mb": _get_peak_memory_mb(),
    }
    payload.update(extra)
    timings[stage_name] = payload


def _write_timings_json(path: Path | None, timings: dict[str, dict]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(timings, indent=2, ensure_ascii=False), encoding="utf-8")


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")


def _ensure_epsg4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs("EPSG:4326", allow_override=True)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs("EPSG:4326")
    return gdf


def _iter_polygonal_parts(geometry) -> list[Polygon]:
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return [part for part in geometry.geoms if not part.is_empty]
    if isinstance(geometry, GeometryCollection):
        parts: list[Polygon] = []
        for part in geometry.geoms:
            parts.extend(_iter_polygonal_parts(part))
        return parts
    return []


def _normalize_polygonal_geometry(geometry):
    if geometry is None or geometry.is_empty:
        return None

    candidate = geometry
    try:
        if not candidate.is_valid:
            candidate = candidate.make_valid()
    except Exception:
        try:
            candidate = geometry.buffer(0)
        except Exception:
            candidate = geometry

    parts: list[Polygon] = []
    for part in _iter_polygonal_parts(candidate):
        normalized = part
        try:
            if not normalized.is_valid:
                normalized = normalized.buffer(0)
        except Exception:
            pass
        if normalized is None or normalized.is_empty:
            continue
        if isinstance(normalized, Polygon):
            parts.append(orient(normalized, sign=-1.0))
        elif isinstance(normalized, MultiPolygon):
            parts.extend(orient(poly, sign=-1.0) for poly in normalized.geoms if not poly.is_empty)

    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def _load_topology(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Topology not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _topology_object_to_gdf(topo_dict: dict, object_name: str) -> gpd.GeoDataFrame:
    source = topo_dict.get("objects", {})
    if object_name not in source:
        return _empty_gdf()
    feature_collection = serialize_as_geojson(topo_dict, objectname=object_name)
    if not isinstance(feature_collection, dict) or not feature_collection.get("features"):
        return _empty_gdf()
    gdf = serialize_as_geodataframe(feature_collection)
    if gdf.empty:
        return _empty_gdf()
    return _ensure_epsg4326(gdf)


def _normalize_country_code(raw_code: object) -> str:
    code = re.sub(r"[^A-Z]", "", str(raw_code or "").strip().upper())
    if not code:
        return ""
    return cfg.COUNTRY_CODE_ALIASES.get(code, code)


def _extract_country_code_from_id(value: object) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    prefix = re.split(r"[-_]", text)[0]
    if re.fullmatch(r"[A-Z]{2,3}", prefix):
        return prefix
    alpha_prefix = re.match(r"^[A-Z]{2,3}", prefix)
    return alpha_prefix.group(0) if alpha_prefix else ""


def _get_feature_id(row: dict, fallback_index: int) -> str:
    for key in ("id", "NUTS_ID"):
        value = str(row.get(key, "")).strip()
        if value:
            return value
    return f"feature-{fallback_index}"


def _get_feature_country_code(row: dict) -> str:
    candidates = (
        row.get("cntr_code"),
        row.get("CNTR_CODE"),
        row.get("iso_a2"),
        row.get("ISO_A2"),
        row.get("iso_a2_eh"),
        row.get("ISO_A2_EH"),
        row.get("adm0_a2"),
        row.get("ADM0_A2"),
        _extract_country_code_from_id(row.get("id")),
    )
    for candidate in candidates:
        code = _normalize_country_code(candidate)
        if re.fullmatch(r"[A-Z]{2,3}", code) and code not in {"ZZ", "XX"}:
            return code
    return ""


def _prune_political_columns(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    keep_cols = [
        "id",
        "name",
        "legacy_name",
        "anchor_county_name",
        "cntr_code",
        "admin1_group",
        "detail_tier",
        "__source",
        "geometry",
    ]
    present = [col for col in keep_cols if col in gdf.columns]
    if "geometry" not in present:
        present.append("geometry")
    out = gdf[present].copy()
    out = out.fillna("")
    return out


def _dedupe_feature_ids(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty or "id" not in gdf.columns:
        return gdf
    out = gdf.copy()
    out["id"] = out["id"].fillna("").astype(str).str.strip()
    seen: dict[str, int] = {}
    deduped = 0
    for index in out.index:
        value = out.at[index, "id"] or f"feature-{index}"
        if value in seen:
            seen[value] += 1
            out.at[index, "id"] = f"{value}__dup{seen[value]}"
            deduped += 1
        else:
            seen[value] = 0
            out.at[index, "id"] = value
    if deduped:
        print(f"[Runtime Political] De-duplicated {deduped} feature ids.")
    return out


def _repair_geometries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf

    out = gdf.copy()
    geom_series = out.geometry.copy()
    repaired = 0
    dropped = 0

    for index in out.index:
        geom = geom_series.loc[index]
        normalized = _normalize_polygonal_geometry(geom)
        if normalized is None:
            geom_series.loc[index] = None
            dropped += 1
            continue
        try:
            changed = not normalized.equals(geom)
        except Exception:
            changed = True
        if changed:
            repaired += 1
        geom_series.loc[index] = normalized

    out = out.set_geometry(geom_series)
    non_empty_mask = out.geometry.apply(lambda geom: geom is not None and not geom.is_empty)
    out = out[non_empty_mask].copy()
    out = out[out.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
    try:
        remaining_invalid = int((~out.geometry.is_valid).sum())
    except Exception:
        remaining_invalid = 0
    if repaired or dropped:
        print(
            f"[Runtime Political] Repaired polygon winding/validity for {repaired} features; "
            f"dropped={dropped}; remaining_invalid={remaining_invalid}."
        )
    return out


def _clip_ru_managed_detail_to_land(
    political_gdf: gpd.GeoDataFrame,
    land_gdf: gpd.GeoDataFrame | None,
) -> gpd.GeoDataFrame:
    if political_gdf.empty or land_gdf is None or land_gdf.empty or "id" not in political_gdf.columns:
        return political_gdf

    land = _ensure_epsg4326(land_gdf.copy())
    land_geometries = [
        normalized
        for normalized in (_normalize_polygonal_geometry(geometry) for geometry in land.geometry.tolist())
        if normalized is not None and not normalized.is_empty
    ]
    if not land_geometries:
        return political_gdf

    land_union = _normalize_polygonal_geometry(unary_union(land_geometries))
    if land_union is None or land_union.is_empty:
        return political_gdf

    out = _ensure_epsg4326(political_gdf.copy())
    feature_ids = out["id"].fillna("").astype(str).str.strip()
    managed_mask = feature_ids.str.startswith(("RU_RAY_", "RU_ARCTIC_FB_", "RU_CITY_"))
    if not managed_mask.any():
        return political_gdf

    clipped = 0
    dropped = 0
    geom_series = out.geometry.copy()

    for index in out.index[managed_mask]:
        geometry = geom_series.loc[index]
        if geometry is None or geometry.is_empty:
            continue
        clipped_geometry = _normalize_polygonal_geometry(geometry.intersection(land_union))
        if clipped_geometry is None:
            geom_series.loc[index] = None
            dropped += 1
            continue
        try:
            changed = not clipped_geometry.equals(geometry)
        except Exception:
            changed = True
        if changed:
            clipped += 1
        geom_series.loc[index] = clipped_geometry

    out = out.set_geometry(geom_series)
    out = out[out.geometry.notnull()].copy()
    out = out[~out.geometry.is_empty].copy()
    if clipped or dropped:
        print(
            f"[Runtime Political] Clipped {clipped} RU managed detail geometries to land; "
            f"dropped={dropped}."
        )
    return out


def _merge_override_features(
    base_features: list[dict],
    override_features: list[dict],
) -> list[dict]:
    ordered_ids: list[str] = []
    feature_by_id: dict[str, dict] = {}

    for index, feature in enumerate(base_features):
        feature_id = _get_feature_id(feature, index)
        if feature_id in feature_by_id:
            continue
        ordered_ids.append(feature_id)
        feature_by_id[feature_id] = feature

    replaced = 0
    injected = 0

    for index, feature in enumerate(override_features):
        if not isinstance(feature, dict) or not feature.get("geometry"):
            continue
        properties = feature.get("properties") or {}
        feature_id = _get_feature_id(properties or feature, index)
        replace_raw = properties.get("replace_ids") or properties.get("replaceIds") or ""
        replace_ids = [
            token
            for token in re.split(r"[,;\n|]+", str(replace_raw))
            if str(token).strip()
        ]
        for replace_id in replace_ids:
            replace_id = str(replace_id).strip()
            if replace_id and replace_id in feature_by_id:
                del feature_by_id[replace_id]
                replaced += 1

        normalized = {
            **feature,
            "properties": {
                **properties,
                "id": feature_id,
                "__source": "ru_override",
            },
        }
        existing = feature_id in feature_by_id
        feature_by_id[feature_id] = normalized
        if not existing:
            ordered_ids.append(feature_id)
        injected += 1

    print(f"[Runtime Political] Applied RU overrides: injected={injected}, replaced={replaced}")
    return [feature_by_id[fid] for fid in ordered_ids if fid in feature_by_id]


def _assign_source(features: list[dict], source_name: str) -> list[dict]:
    normalized: list[dict] = []
    for feature in features:
        properties = dict(feature.get("properties") or {})
        properties["__source"] = source_name
        normalized.append({
            **feature,
            "properties": properties,
        })
    return normalized


def _compose_political_features(
    primary_topology: dict,
    detail_topology: dict | None,
    override_collection: dict | None,
    canonicalize_countries: tuple[str, ...] | list[str] | None = None,
) -> gpd.GeoDataFrame:
    primary_gdf = _topology_object_to_gdf(primary_topology, "political")
    primary_land_gdf = _topology_object_to_gdf(primary_topology, "land")
    if primary_gdf.empty:
        raise ValueError("Primary topology has no political features.")

    primary_fc = json.loads(primary_gdf.to_json(drop_id=True))
    primary_features = primary_fc.get("features", [])

    if detail_topology is None:
        base_features = _assign_source(primary_features, "primary")
    else:
        detail_gdf = _topology_object_to_gdf(detail_topology, "political")
        detail_fc = json.loads(detail_gdf.to_json(drop_id=True))
        detail_features = _assign_source(detail_fc.get("features", []), "detail")
        detail_countries = {
            _get_feature_country_code(feature.get("properties") or {})
            for feature in detail_features
        }
        detail_countries.discard("")
        seen_ids: set[str] = set()
        base_features = []
        for feature in detail_features:
            feature_id = _get_feature_id(feature.get("properties") or {}, len(base_features))
            if feature_id in seen_ids:
                continue
            seen_ids.add(feature_id)
            base_features.append(feature)
        for feature in _assign_source(primary_features, "primary"):
            props = feature.get("properties") or {}
            feature_id = _get_feature_id(props, len(base_features))
            country_code = _get_feature_country_code(props)
            if country_code and country_code in detail_countries:
                continue
            if feature_id in seen_ids:
                continue
            seen_ids.add(feature_id)
            base_features.append(feature)

    override_features = []
    if isinstance(override_collection, dict):
        override_features = override_collection.get("features") or []
    merged_features = (
        _merge_override_features(base_features, override_features)
        if override_features
        else base_features
    )
    runtime_gdf = gpd.GeoDataFrame.from_features(merged_features, crs="EPSG:4326")
    runtime_gdf = _ensure_epsg4326(runtime_gdf)
    if runtime_gdf.empty:
        raise ValueError("Runtime political composition produced zero features.")

    runtime_gdf["id"] = [
        _get_feature_id(row, index)
        for index, row in enumerate(runtime_gdf.to_dict("records"))
    ]
    runtime_gdf["cntr_code"] = [
        _get_feature_country_code(row) or _extract_country_code_from_id(row.get("id")) or "UNK"
        for row in runtime_gdf.to_dict("records")
    ]
    if "name" not in runtime_gdf.columns:
        runtime_gdf["name"] = runtime_gdf["id"]
    runtime_gdf["name"] = runtime_gdf["name"].fillna("").astype(str).str.strip()
    runtime_gdf.loc[runtime_gdf["name"] == "", "name"] = runtime_gdf.loc[
        runtime_gdf["name"] == "", "id"
    ]
    if "admin1_group" not in runtime_gdf.columns:
        runtime_gdf["admin1_group"] = ""
    if "detail_tier" not in runtime_gdf.columns:
        runtime_gdf["detail_tier"] = ""
    if "__source" not in runtime_gdf.columns:
        runtime_gdf["__source"] = "primary"

    runtime_gdf = runtime_gdf[runtime_gdf.geometry.notna() & ~runtime_gdf.geometry.is_empty].copy()
    runtime_gdf = _repair_geometries(runtime_gdf)
    runtime_gdf = _clip_ru_managed_detail_to_land(runtime_gdf, primary_land_gdf)
    runtime_gdf, canonicalize_metrics = canonicalize_country_boundaries(
        runtime_gdf,
        shell_gdf=primary_gdf,
        allowed_area_gdf=primary_land_gdf,
        target_country_codes=canonicalize_countries,
        log_prefix="[Runtime Political canonicalize]",
    )
    if canonicalize_metrics:
        print(
            "[Runtime Political] Local canonicalization countries: "
            + ", ".join(
                sorted(
                    entry["country_code"]
                    for entry in canonicalize_metrics
                    if not entry.get("skipped")
                )
            )
        )
    runtime_gdf = repair_shell_coverage(
        runtime_gdf,
        primary_gdf,
        allowed_area_gdf=primary_land_gdf,
        log_prefix="[Runtime Political]",
    )
    runtime_gdf = _clip_ru_managed_detail_to_land(runtime_gdf, primary_land_gdf)
    runtime_gdf = _prune_political_columns(runtime_gdf)
    runtime_gdf = runtime_gdf.reset_index(drop=True)
    runtime_gdf = _dedupe_feature_ids(runtime_gdf)
    if runtime_gdf["id"].duplicated().any():
        raise ValueError("Runtime political topology still contains duplicate feature ids.")
    return runtime_gdf


def _write_output_topology(
    *,
    output_path: Path,
    political: gpd.GeoDataFrame,
) -> None:
    build_political_only_topology(
        political,
        output_path,
        quantization=cfg.RUNTIME_POLITICAL_TOPOLOGY_QUANTIZATION,
    )


def _parse_country_codes_arg(raw_value: str | None) -> tuple[str, ...]:
    if raw_value is None:
        return LOCAL_CANONICAL_COUNTRY_CODES
    values = tuple(
        str(item).strip().upper()
        for item in str(raw_value).split(",")
        if str(item).strip()
    )
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build runtime political topology.")
    parser.add_argument(
        "--primary-topology",
        type=Path,
        default=Path("data") / "europe_topology.json",
        help="Primary topology path.",
    )
    parser.add_argument(
        "--detail-topology",
        type=Path,
        default=Path("data") / "europe_topology.na_v2.json",
        help="Detail topology path.",
    )
    parser.add_argument(
        "--ru-overrides",
        type=Path,
        default=Path("data") / "ru_city_overrides.geojson",
        help="RU override GeoJSON path.",
    )
    parser.add_argument(
        "--output-topology",
        type=Path,
        default=Path("data") / "europe_topology.runtime_political_v1.json",
        help="Output runtime political topology path.",
    )
    parser.add_argument(
        "--timings-json",
        type=Path,
        default=None,
        help="Optional path to write per-stage wall time and peak memory stats as JSON.",
    )
    parser.add_argument(
        "--canonicalize-countries",
        type=str,
        default=",".join(LOCAL_CANONICAL_COUNTRY_CODES),
        help="Comma-separated country codes for local shared-boundary canonicalization.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stage_timings: dict[str, dict] = {}
    main_start = time.perf_counter()
    canonicalize_countries = _parse_country_codes_arg(args.canonicalize_countries)

    load_start = time.perf_counter()
    primary_topology = _load_topology(args.primary_topology)
    primary_political = _topology_object_to_gdf(primary_topology, "political")
    primary_land = _topology_object_to_gdf(primary_topology, "land")
    detail_topology = _load_topology(args.detail_topology) if args.detail_topology.exists() else None
    override_collection = (
        json.loads(args.ru_overrides.read_text(encoding="utf-8"))
        if args.ru_overrides.exists()
        else None
    )
    _record_timing(
        stage_timings,
        "load_inputs",
        load_start,
        detail_topology_exists=detail_topology is not None,
        overrides_exists=override_collection is not None,
    )

    compose_start = time.perf_counter()
    runtime_political = _compose_political_features(
        primary_topology=primary_topology,
        detail_topology=detail_topology,
        override_collection=override_collection,
        canonicalize_countries=canonicalize_countries,
    )
    _record_timing(
        stage_timings,
        "compose_runtime_political",
        compose_start,
        feature_count=len(runtime_political),
    )
    args.output_topology.parent.mkdir(parents=True, exist_ok=True)

    write_start = time.perf_counter()
    _write_output_topology(
        output_path=args.output_topology,
        political=runtime_political,
    )
    _record_timing(
        stage_timings,
        "initial_write",
        write_start,
        output_path=str(args.output_topology),
    )

    repair_start = time.perf_counter()
    repair_passes = 0
    for repair_pass in range(1, MAX_SHELL_COVERAGE_REPAIR_PASSES + 1):
        output_topology = _load_topology(args.output_topology)
        output_political = _topology_object_to_gdf(output_topology, "political")
        gaps = collect_shell_coverage_gaps(
            output_political,
            primary_political,
            allowed_area_gdf=primary_land,
        )
        if not gaps:
            break
        repair_passes += 1
        gap = gaps[0]
        print(
            f"[Runtime Political] Post-build shell coverage repair pass {repair_pass}: "
            f"{gap['country_code']} fragments={gap['fragment_count']}, "
            f"total_area_km2={gap['total_area_km2']:.1f}"
        )
        runtime_political = append_shell_coverage_gap_fragments(
            runtime_political,
            primary_political,
            gap_source_gdf=output_political,
            allowed_area_gdf=primary_land,
            log_prefix=f"[Runtime Political pass {repair_pass}]",
        )
        runtime_political = _clip_ru_managed_detail_to_land(runtime_political, primary_land)
        runtime_political = _prune_political_columns(runtime_political)
        runtime_political = _dedupe_feature_ids(runtime_political)
        _write_output_topology(
            output_path=args.output_topology,
            political=runtime_political,
        )
    _record_timing(
        stage_timings,
        "shell_coverage_repairs",
        repair_start,
        passes=repair_passes,
    )
    print(
        f"[Runtime Political] OK: wrote {args.output_topology} "
        f"({len(runtime_political)} features)"
    )
    _record_timing(
        stage_timings,
        "total",
        main_start,
        output_features=len(runtime_political),
    )
    _write_timings_json(args.timings_json, stage_timings)


if __name__ == "__main__":
    main()
