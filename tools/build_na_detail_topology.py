"""Build the default enriched detail topology artifact."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

import geopandas as gpd
import topojson as tp
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from topojson.utils import serialize_as_geodataframe, serialize_as_geojson

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from map_builder import config as cfg
from map_builder.geo.topology import build_topology, compute_neighbor_graph
from map_builder.processors.detail_shell_coverage import (
    append_shell_coverage_gap_fragments,
    collect_shell_coverage_gaps,
    repair_shell_coverage,
)
from map_builder.processors.africa_admin1 import apply_africa_admin1_replacement
from map_builder.processors.au_city_overrides import apply_au_city_overrides
from map_builder.processors.belarus import apply_belarus_replacement
from map_builder.processors.cz_sk_border_detail import apply_cz_sk_border_detail
from map_builder.processors.denmark_border_detail import apply_denmark_border_detail
from map_builder.processors.global_basic_admin1 import apply_global_basic_admin1_replacement
from map_builder.processors.north_america import apply_north_america_replacement
from map_builder.processors.russia_ukraine import apply_russia_ukraine_replacement
from init_map_data import apply_config_subdivisions

try:
    import resource
except Exception:  # pragma: no cover - unavailable on some platforms
    resource = None

LAYER_NAMES = ("political", "special_zones", "water_regions", "ocean", "land", "urban", "physical", "rivers")
SPECIAL_NAME_FALLBACKS = {
    "RUS+99?": "Russia Special Region",
}


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


def _load_layers_from_topology(topology_dict: dict) -> dict[str, gpd.GeoDataFrame]:
    layers: dict[str, gpd.GeoDataFrame] = {}
    for layer_name in LAYER_NAMES:
        layers[layer_name] = _topology_object_to_gdf(topology_dict, layer_name)
    if layers["political"].empty:
        raise ValueError("Source topology has no political layer to patch.")
    return layers


def _build_topology_dict_from_layers(layers: dict[str, gpd.GeoDataFrame]) -> dict:
    object_names: list[str] = []
    object_layers: list[gpd.GeoDataFrame] = []
    for name in LAYER_NAMES:
        gdf = layers.get(name)
        if gdf is None or gdf.empty:
            continue
        object_names.append(name)
        prepared = _ensure_epsg4326(gdf).copy().fillna("")
        object_layers.append(prepared)

    if "political" not in object_names:
        raise ValueError("Patched layers missing political object.")

    topology = tp.Topology(
        object_layers,
        object_name=object_names,
        prequantize=cfg.DETAIL_OUTPUT_TOPOLOGY_QUANTIZATION,
        topology=True,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    ).to_dict()
    return topology


def _promote_geometry_ids(topology_dict: dict) -> None:
    objects = topology_dict.get("objects", {})
    if not isinstance(objects, dict):
        return
    for object_name, obj in objects.items():
        geometries = obj.get("geometries", [])
        seen: set[str] = set()
        for index, geom in enumerate(geometries):
            props = geom.get("properties")
            if not isinstance(props, dict):
                props = {}
                geom["properties"] = props

            preferred = str(props.get("id", "")).strip()
            candidate = preferred or str(geom.get("id", "")).strip() or f"{object_name}-{index}"
            if candidate in seen:
                candidate = f"{candidate}__dup{index}"
            seen.add(candidate)
            geom["id"] = candidate
            if preferred and "id" not in props:
                props["id"] = preferred


def _clean_text(value: object) -> str:
    text = "" if value is None else str(value).strip()
    if text.lower() in {"none", "nan", "null"}:
        return ""
    return text


def _derive_name_fallback(row: dict) -> str:
    feature_id = _clean_text(row.get("id"))
    if feature_id in SPECIAL_NAME_FALLBACKS:
        return SPECIAL_NAME_FALLBACKS[feature_id]

    for key in ("admin1_group", "adm1_name", "constituent_country", "name_local"):
        fallback = _clean_text(row.get(key))
        if fallback:
            return fallback

    if feature_id.startswith("CN_CITY_"):
        return f"CN ADM2 {feature_id.replace('CN_CITY_', '', 1)}"
    if feature_id:
        return feature_id
    return "Unnamed Region"


def _repair_political_metadata(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    out = _ensure_epsg4326(gdf.copy())
    repaired_names = []
    for row in out.to_dict("records"):
        name = _clean_text(row.get("name"))
        if not name:
            name = _derive_name_fallback(row)
        repaired_names.append(name)
    out["name"] = repaired_names
    return out


def _repair_political_geometries(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf

    out = _ensure_epsg4326(gdf.copy())
    geom_series = out.geometry.copy()
    repaired = 0
    dropped = 0

    for index in out.index:
        geometry = geom_series.loc[index]
        normalized = _normalize_polygonal_geometry(geometry)
        if normalized is None:
            geom_series.loc[index] = None
            dropped += 1
            continue
        try:
            changed = not normalized.equals(geometry)
        except Exception:
            changed = True
        if changed:
            repaired += 1
        geom_series.loc[index] = normalized

    out = out.set_geometry(geom_series)
    out = out[out.geometry.notnull()].copy()
    out = out[~out.geometry.is_empty].copy()
    if repaired or dropped:
        print(
            f"[Detail patch] Repaired polygon winding/validity for {repaired} features; "
            f"dropped={dropped}."
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
        print(f"[Detail patch] Clipped {clipped} RU managed detail geometries to land; dropped={dropped}.")
    return out


def _inject_computed_neighbors(topology_dict: dict, political_gdf: gpd.GeoDataFrame) -> None:
    objects = topology_dict.get("objects", {})
    political = objects.get("political", {}) if isinstance(objects, dict) else {}
    geometries = political.get("geometries", []) if isinstance(political, dict) else []
    if not isinstance(geometries, list) or not geometries:
        return

    clean = _ensure_epsg4326(political_gdf.copy()).reset_index(drop=True)
    if len(clean) != len(geometries):
        print(
            "[Detail patch] Skipped computed_neighbors injection: "
            f"gdf={len(clean)} topo={len(geometries)}"
        )
        return

    political["computed_neighbors"] = compute_neighbor_graph(clean)


def _write_output_topology(
    *,
    output_path: Path,
    political: gpd.GeoDataFrame,
    layers: dict[str, gpd.GeoDataFrame],
) -> None:
    build_topology(
        political=political,
        ocean=layers.get("ocean", _empty_gdf()),
        land=layers.get("land", _empty_gdf()),
        urban=layers.get("urban", _empty_gdf()),
        physical=layers.get("physical", _empty_gdf()),
        rivers=layers.get("rivers", _empty_gdf()),
        special_zones=layers.get("special_zones"),
        water_regions=layers.get("water_regions"),
        output_path=output_path,
        quantization=cfg.DETAIL_OUTPUT_TOPOLOGY_QUANTIZATION,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the enriched detail topology bundle.")
    parser.add_argument(
        "--source-topology",
        type=Path,
        default=Path("data") / "europe_topology.highres.json",
        help="Topology source used as detail base.",
    )
    parser.add_argument(
        "--output-topology",
        type=Path,
        default=Path("data") / "europe_topology.na_v2.json",
        help="Patched topology output path.",
    )
    parser.add_argument(
        "--timings-json",
        type=Path,
        default=None,
        help="Optional path to write per-stage wall time and peak memory stats as JSON.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stage_timings: dict[str, dict] = {}
    main_start = time.perf_counter()
    source_path = args.source_topology
    output_path = args.output_topology

    load_start = time.perf_counter()
    print(f"[Detail patch] Loading source topology: {source_path}")
    topology_dict = _load_topology(source_path)
    layers = _load_layers_from_topology(topology_dict)
    print(f"[Detail patch] Source political features: {len(layers['political'])}")
    primary_topology_path = source_path.with_name("europe_topology.json")
    primary_layers = None
    if primary_topology_path.exists():
        print(f"[Detail patch] Loading primary topology shell: {primary_topology_path}")
        primary_layers = _load_layers_from_topology(_load_topology(primary_topology_path))
        for layer_name in LAYER_NAMES:
            if layer_name == "political":
                continue
            if layers.get(layer_name) is None or layers[layer_name].empty:
                primary_layer = primary_layers.get(layer_name)
                if primary_layer is not None and not primary_layer.empty:
                    layers[layer_name] = primary_layer.copy()
    _record_timing(
        stage_timings,
        "load_inputs",
        load_start,
        primary_shell_exists=primary_layers is not None,
    )

    patch_start = time.perf_counter()
    patched_political = apply_north_america_replacement(layers["political"])
    patched_political = apply_africa_admin1_replacement(patched_political)
    patched_political = apply_global_basic_admin1_replacement(patched_political)
    patched_political = apply_denmark_border_detail(patched_political)
    patched_political = apply_cz_sk_border_detail(patched_political)
    patched_political = apply_belarus_replacement(patched_political)
    patched_political = apply_russia_ukraine_replacement(patched_political)
    patched_political = apply_au_city_overrides(patched_political)
    patched_political = _clip_ru_managed_detail_to_land(
        patched_political,
        layers.get("land"),
    )
    if getattr(cfg, "ENABLE_SUBDIVISION_ENRICHMENT", False):
        patched_political = apply_config_subdivisions(patched_political)
    patched_political = _repair_political_metadata(patched_political)
    patched_political = _repair_political_geometries(patched_political)
    layers["political"] = patched_political
    print(f"[Detail patch] Patched political features: {len(patched_political)}")
    _record_timing(
        stage_timings,
        "apply_political_patches",
        patch_start,
        feature_count=len(patched_political),
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    staging_start = time.perf_counter()
    staging_dict = _build_topology_dict_from_layers(layers)
    _promote_geometry_ids(staging_dict)
    _inject_computed_neighbors(staging_dict, patched_political)

    roundtrip_political = _topology_object_to_gdf(staging_dict, "political")
    roundtrip_political = _repair_political_geometries(roundtrip_political)
    roundtrip_political = _clip_ru_managed_detail_to_land(
        roundtrip_political,
        primary_layers.get("land") if primary_layers is not None else layers.get("land"),
    )
    if roundtrip_political.empty:
        raise ValueError("Detail topology round-trip repair removed all political geometries.")
    if len(roundtrip_political) != len(patched_political):
        print(
            "[Detail patch] Round-trip topology repair adjusted political feature count: "
            f"before={len(patched_political)}, after={len(roundtrip_political)}"
        )
    if primary_layers is not None:
        roundtrip_political = repair_shell_coverage(
            roundtrip_political,
            primary_layers["political"],
            allowed_area_gdf=primary_layers.get("land"),
            log_prefix="[Detail patch]",
        )
        roundtrip_political = _clip_ru_managed_detail_to_land(
            roundtrip_political,
            primary_layers.get("land"),
        )
    layers["political"] = roundtrip_political
    _record_timing(
        stage_timings,
        "topology_roundtrip_prepare",
        staging_start,
        roundtrip_feature_count=len(roundtrip_political),
    )

    write_start = time.perf_counter()
    _write_output_topology(
        output_path=output_path,
        political=roundtrip_political,
        layers=layers,
    )
    _record_timing(
        stage_timings,
        "initial_write",
        write_start,
        output_path=str(output_path),
    )
    if primary_layers is not None:
        repair_start = time.perf_counter()
        repair_passes = 0
        for repair_pass in range(1, 4):
            output_dict = _load_topology(output_path)
            output_political = _topology_object_to_gdf(output_dict, "political")
            gaps = collect_shell_coverage_gaps(
                output_political,
                primary_layers["political"],
                allowed_area_gdf=primary_layers.get("land"),
            )
            if not gaps:
                break
            repair_passes += 1
            gap = gaps[0]
            print(
                f"[Detail patch] Post-build shell coverage repair pass {repair_pass}: "
                f"{gap['country_code']} fragments={gap['fragment_count']}, "
                f"total_area_km2={gap['total_area_km2']:.1f}"
            )
            roundtrip_political = append_shell_coverage_gap_fragments(
                output_political,
                primary_layers["political"],
                allowed_area_gdf=primary_layers.get("land"),
                log_prefix=f"[Detail patch pass {repair_pass}]",
            )
            roundtrip_political = _clip_ru_managed_detail_to_land(
                roundtrip_political,
                primary_layers.get("land"),
            )
            layers["political"] = roundtrip_political
            _write_output_topology(
                output_path=output_path,
                political=roundtrip_political,
                layers=layers,
            )
        _record_timing(
            stage_timings,
            "shell_coverage_repairs",
            repair_start,
            passes=repair_passes,
        )
    output_dict = _load_topology(output_path)
    count = len(output_dict.get("objects", {}).get("political", {}).get("geometries", []))
    print(f"[Detail patch] Output political features: {count}")
    print(f"[Detail patch] OK: wrote {output_path}")
    _record_timing(
        stage_timings,
        "total",
        main_start,
        output_features=count,
    )
    _write_timings_json(args.timings_json, stage_timings)


if __name__ == "__main__":
    main()
