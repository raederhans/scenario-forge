"""Build the default enriched detail topology artifact."""
from __future__ import annotations

import argparse
from collections import deque
import json
from pathlib import Path
import sys
import time

import geopandas as gpd
import pandas as pd
import topojson as tp
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

try:
    from init_map_data import apply_config_subdivisions
    APPLY_CONFIG_SUBDIVISIONS_IMPORT_ERROR = None
except BaseException as exc:  # pragma: no cover - optional build-time dependency chain
    apply_config_subdivisions = None
    APPLY_CONFIG_SUBDIVISIONS_IMPORT_ERROR = exc

try:
    import resource
except Exception:  # pragma: no cover - unavailable on some platforms
    resource = None

LAYER_NAMES = ("political", "special_zones", "water_regions", "ocean", "land", "urban", "physical", "rivers")
SPECIAL_NAME_FALLBACKS = {
    "RUS+99?": "Russia Special Region",
}
MAX_SHELL_COVERAGE_REPAIR_PASSES = 6
FEATURE_MIGRATION_PATH = PROJECT_ROOT / "data" / "feature-migrations" / "by_hybrid_v1.json"
US_MIGRATION_AUDIT_PATH = PROJECT_ROOT / ".runtime" / "reports" / "generated" / "us_topology_migration_audit.json"
US_OVERLAP_RATIO_THRESHOLD = 1e-4
US_ABSOLUTE_OVERLAP_AREA_M2 = 1000.0


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


def _load_existing_output_political(output_path: Path) -> gpd.GeoDataFrame:
    if not output_path.exists():
        return _empty_gdf()
    try:
        output_dict = _load_topology(output_path)
        return _repair_political_geometries(_topology_object_to_gdf(output_dict, "political"))
    except Exception as exc:
        try:
            output_dict = json.loads(output_path.read_text(encoding="utf-8-sig"))
            return _repair_political_geometries(_topology_object_to_gdf(output_dict, "political"))
        except Exception:
            print(
                "[Detail patch] Failed to load existing output topology for US ID reconciliation: "
                f"{exc}"
            )
            return _empty_gdf()


def _us_feature_mask(gdf: gpd.GeoDataFrame) -> gpd.Series:
    if gdf.empty or "cntr_code" not in gdf.columns:
        return pd.Series([], dtype=bool)
    return gdf["cntr_code"].fillna("").astype(str).str.upper() == "US"


def _us_coarse_feature_mask(gdf: gpd.GeoDataFrame) -> gpd.Series:
    if gdf.empty:
        return pd.Series([], dtype=bool)
    if "detail_tier" not in gdf.columns:
        return pd.Series([False] * len(gdf), index=gdf.index)
    return _us_feature_mask(gdf) & (gdf["detail_tier"].fillna("").astype(str) == "coarse")


def _feature_state_key(row: dict | pd.Series) -> str:
    return str((row.get("admin1_group") if hasattr(row, "get") else "") or "").strip()


def _sort_local_feature_indices(metric_gdf: gpd.GeoDataFrame, indices: list[int]) -> list[int]:
    if metric_gdf.empty or not indices:
        return []
    reps = metric_gdf.geometry.representative_point()
    return sorted(
        indices,
        key=lambda idx: (
            float(reps.iloc[idx].x),
            float(reps.iloc[idx].y),
            idx,
        ),
    )


def _alpha_suffix(index: int) -> str:
    cursor = index + 1
    letters: list[str] = []
    while cursor > 0:
        cursor, remainder = divmod(cursor - 1, 26)
        letters.append(chr(ord("A") + remainder))
    return "".join(reversed(letters))


def _make_unique_id(base_id: str, used_ids: set[str]) -> str:
    candidate = str(base_id).strip()
    if candidate and candidate not in used_ids:
        return candidate
    stem = candidate or "US_FEATURE"
    counter = 1
    while True:
        candidate = f"{stem}{counter}"
        if candidate not in used_ids:
            return candidate
        counter += 1


def _make_split_child_id(base_id: str, child_index: int, used_ids: set[str]) -> str:
    candidate = f"{base_id}__{_alpha_suffix(child_index)}"
    if candidate not in used_ids:
        return candidate
    return _make_unique_id(f"{candidate}__R", used_ids)


def _build_state_overlap_matrix(
    old_state: gpd.GeoDataFrame,
    new_state: gpd.GeoDataFrame,
) -> dict[tuple[int, int], float]:
    if old_state.empty or new_state.empty:
        return {}

    old_metric = _ensure_epsg4326(old_state).to_crs(cfg.AREA_CRS).reset_index(drop=True)
    new_metric = _ensure_epsg4326(new_state).to_crs(cfg.AREA_CRS).reset_index(drop=True)
    old_areas = old_metric.geometry.area.astype(float).tolist()
    new_areas = new_metric.geometry.area.astype(float).tolist()
    overlaps: dict[tuple[int, int], float] = {}

    for old_idx, old_geom in enumerate(old_metric.geometry):
        if old_geom is None or old_geom.is_empty:
            continue
        old_area = max(old_areas[old_idx], 1.0)
        for new_idx, new_geom in enumerate(new_metric.geometry):
            if new_geom is None or new_geom.is_empty:
                continue
            new_area = max(new_areas[new_idx], 1.0)
            intersection = old_geom.intersection(new_geom)
            if intersection is None or intersection.is_empty:
                continue
            area = float(intersection.area)
            if area <= 0.0:
                continue
            if area < US_ABSOLUTE_OVERLAP_AREA_M2:
                ratio_old = area / old_area
                ratio_new = area / new_area
                if max(ratio_old, ratio_new) < US_OVERLAP_RATIO_THRESHOLD:
                    continue
            overlaps[(old_idx, new_idx)] = area
    return overlaps


def _build_us_overlap_components(
    old_count: int,
    new_count: int,
    overlaps: dict[tuple[int, int], float],
) -> list[tuple[list[int], list[int]]]:
    if not overlaps:
        return []

    old_neighbors = {idx: set() for idx in range(old_count)}
    new_neighbors = {idx: set() for idx in range(new_count)}
    for (old_idx, new_idx), _ in overlaps.items():
        old_neighbors.setdefault(old_idx, set()).add(new_idx)
        new_neighbors.setdefault(new_idx, set()).add(old_idx)

    visited_old: set[int] = set()
    visited_new: set[int] = set()
    components: list[tuple[list[int], list[int]]] = []

    for seed_old in sorted(idx for idx, neighbors in old_neighbors.items() if neighbors):
        if seed_old in visited_old:
            continue
        queue = deque([("old", seed_old)])
        comp_old: set[int] = set()
        comp_new: set[int] = set()
        while queue:
            side, idx = queue.popleft()
            if side == "old":
                if idx in visited_old:
                    continue
                visited_old.add(idx)
                comp_old.add(idx)
                for new_idx in sorted(old_neighbors.get(idx, set())):
                    if new_idx not in visited_new:
                        queue.append(("new", new_idx))
            else:
                if idx in visited_new:
                    continue
                visited_new.add(idx)
                comp_new.add(idx)
                for old_idx in sorted(new_neighbors.get(idx, set())):
                    if old_idx not in visited_old:
                        queue.append(("old", old_idx))
        if comp_old or comp_new:
            components.append((sorted(comp_old), sorted(comp_new)))
    return components


def _reconcile_us_feature_ids(
    previous_political: gpd.GeoDataFrame,
    political_gdf: gpd.GeoDataFrame,
) -> tuple[gpd.GeoDataFrame, dict[str, int]]:
    metrics = {
        "reused_old_ids": 0,
        "split_child_ids": 0,
        "renamed_recomposed_ids": 0,
    }
    if previous_political.empty or political_gdf.empty:
        return political_gdf, metrics

    work = political_gdf.copy()
    us_coarse_mask = _us_coarse_feature_mask(work)
    if not bool(us_coarse_mask.any()):
        return work, metrics

    previous_us_coarse = previous_political[_us_coarse_feature_mask(previous_political)].copy()
    if previous_us_coarse.empty:
        return work, metrics

    used_ids = set(work.loc[~us_coarse_mask, "id"].fillna("").astype(str))
    state_names = sorted(
        set(previous_us_coarse.get("admin1_group", pd.Series(dtype=str)).fillna("").astype(str))
        | set(work.loc[us_coarse_mask, "admin1_group"].fillna("").astype(str))
    )

    for state_name in state_names:
        old_state = (
            previous_us_coarse[previous_us_coarse["admin1_group"].fillna("").astype(str) == state_name]
            .copy()
            .reset_index(drop=True)
        )
        new_state = (
            work[us_coarse_mask & (work["admin1_group"].fillna("").astype(str) == state_name)]
            .copy()
            .reset_index()
            .rename(columns={"index": "__global_index"})
        )
        if new_state.empty:
            continue

        assigned_new: set[int] = set()
        exact_old_matches: set[int] = set()

        if not old_state.empty:
            for new_local_idx in range(len(new_state)):
                new_geom = new_state.iloc[new_local_idx].geometry
                if new_geom is None or new_geom.is_empty:
                    continue
                matched_old: int | None = None
                for old_local_idx in range(len(old_state)):
                    if old_local_idx in exact_old_matches:
                        continue
                    old_geom = old_state.iloc[old_local_idx].geometry
                    if old_geom is None or old_geom.is_empty:
                        continue
                    try:
                        if new_geom.equals(old_geom):
                            matched_old = old_local_idx
                            break
                    except Exception:
                        continue
                if matched_old is None:
                    continue
                old_id = str(old_state.iloc[matched_old].get("id", "")).strip()
                if not old_id:
                    continue
                row_index = int(new_state.iloc[new_local_idx]["__global_index"])
                work.at[row_index, "id"] = old_id
                used_ids.add(old_id)
                assigned_new.add(new_local_idx)
                exact_old_matches.add(matched_old)
                metrics["reused_old_ids"] += 1

        remaining_old = [idx for idx in range(len(old_state)) if idx not in exact_old_matches]
        remaining_new = [idx for idx in range(len(new_state)) if idx not in assigned_new]
        if not remaining_new:
            continue

        old_state = old_state.iloc[remaining_old].copy().reset_index(drop=True)
        new_state = new_state.iloc[remaining_new].copy().reset_index(drop=True)
        state_old_ids = set(old_state["id"].fillna("").astype(str)) if not old_state.empty else set()
        new_metric = _ensure_epsg4326(new_state).to_crs(cfg.AREA_CRS).reset_index(drop=True)
        overlaps = _build_state_overlap_matrix(old_state, new_state)
        components = _build_us_overlap_components(len(old_state), len(new_state), overlaps)

        for comp_old, comp_new in components:
            ordered_new = _sort_local_feature_indices(new_metric, comp_new)
            if len(comp_old) == 1 and len(comp_new) == 1:
                old_id = str(old_state.iloc[comp_old[0]].get("id", "")).strip()
                if old_id:
                    row_index = int(new_state.iloc[comp_new[0]]["__global_index"])
                    work.at[row_index, "id"] = old_id
                    used_ids.add(old_id)
                    assigned_new.add(comp_new[0])
                    metrics["reused_old_ids"] += 1
                continue

            if len(comp_old) == 1 and len(comp_new) > 1:
                base_id = str(old_state.iloc[comp_old[0]].get("id", "")).strip()
                if base_id:
                    for child_index, new_local_idx in enumerate(ordered_new):
                        row_index = int(new_state.iloc[new_local_idx]["__global_index"])
                        child_id = _make_split_child_id(base_id, child_index, used_ids)
                        work.at[row_index, "id"] = child_id
                        used_ids.add(child_id)
                        assigned_new.add(new_local_idx)
                        metrics["split_child_ids"] += 1
                continue

            for new_local_idx in ordered_new:
                row_index = int(new_state.iloc[new_local_idx]["__global_index"])
                current_id = str(new_state.iloc[new_local_idx].get("id", "")).strip()
                candidate_id = current_id
                if not candidate_id or candidate_id in state_old_ids or candidate_id in used_ids:
                    candidate_id = _make_unique_id(f"{current_id}__R", used_ids)
                    metrics["renamed_recomposed_ids"] += 1
                work.at[row_index, "id"] = candidate_id
                used_ids.add(candidate_id)
                assigned_new.add(new_local_idx)

        unassigned_new = [idx for idx in range(len(new_state)) if idx not in assigned_new]
        for new_local_idx in _sort_local_feature_indices(new_metric, unassigned_new):
            row_index = int(new_state.iloc[new_local_idx]["__global_index"])
            current_id = str(new_state.iloc[new_local_idx].get("id", "")).strip()
            candidate_id = current_id
            if not candidate_id or candidate_id in state_old_ids or candidate_id in used_ids:
                candidate_id = _make_unique_id(f"{current_id}__R", used_ids)
                metrics["renamed_recomposed_ids"] += 1
            work.at[row_index, "id"] = candidate_id
            used_ids.add(candidate_id)

    return work, metrics


def _update_us_feature_migration_asset(
    previous_political: gpd.GeoDataFrame,
    current_political: gpd.GeoDataFrame,
    migration_path: Path = FEATURE_MIGRATION_PATH,
) -> dict[str, int]:
    metrics = {
        "us_migration_entries": 0,
        "us_migration_expansions": 0,
    }
    if previous_political.empty or current_political.empty:
        return metrics

    previous_us = previous_political[_us_feature_mask(previous_political)].copy()
    current_us = current_political[_us_feature_mask(current_political)].copy()
    if previous_us.empty or current_us.empty:
        return metrics

    new_ids = set(current_us["id"].fillna("").astype(str))
    migration_payload: dict[str, list[str]] = {}
    audit_rows: list[dict[str, object]] = []
    state_names = sorted(
        set(previous_us.get("admin1_group", pd.Series(dtype=str)).fillna("").astype(str))
        | set(current_us.get("admin1_group", pd.Series(dtype=str)).fillna("").astype(str))
    )

    for state_name in state_names:
        old_state = (
            previous_us[previous_us["admin1_group"].fillna("").astype(str) == state_name]
            .copy()
            .reset_index(drop=True)
        )
        new_state = (
            current_us[current_us["admin1_group"].fillna("").astype(str) == state_name]
            .copy()
            .reset_index(drop=True)
        )
        if old_state.empty:
            continue

        overlaps = _build_state_overlap_matrix(old_state, new_state)
        old_metric = _ensure_epsg4326(old_state).to_crs(cfg.AREA_CRS).reset_index(drop=True)
        new_metric = _ensure_epsg4326(new_state).to_crs(cfg.AREA_CRS).reset_index(drop=True)
        new_centroids = (
            new_metric.geometry.representative_point().reset_index(drop=True)
            if not new_state.empty
            else None
        )
        old_centroids = old_metric.geometry.representative_point().reset_index(drop=True)

        for old_idx in range(len(old_state)):
            old_id = str(old_state.iloc[old_idx].get("id", "")).strip()
            if not old_id or old_id in new_ids:
                continue

            successor_scores: dict[str, float] = {}
            for (edge_old_idx, edge_new_idx), area in overlaps.items():
                if edge_old_idx != old_idx:
                    continue
                successor_id = str(new_state.iloc[edge_new_idx].get("id", "")).strip()
                if not successor_id:
                    continue
                successor_scores[successor_id] = max(successor_scores.get(successor_id, 0.0), float(area))

            successors = [
                successor_id
                for successor_id, _ in sorted(
                    successor_scores.items(),
                    key=lambda item: (-item[1], item[0]),
                )
            ]

            if not successors and not new_state.empty and new_centroids is not None:
                old_centroid = old_centroids.iloc[old_idx]
                nearest_new_idx = min(
                    range(len(new_state)),
                    key=lambda idx: float(old_centroid.distance(new_centroids.iloc[idx])),
                )
                fallback_id = str(new_state.iloc[nearest_new_idx].get("id", "")).strip()
                if fallback_id:
                    successors = [fallback_id]

            if not successors:
                continue

            migration_payload[old_id] = successors
            audit_rows.append(
                {
                    "state": state_name,
                    "source_id": old_id,
                    "successors": successors,
                }
            )

    if new_ids:
        migration_payload["US"] = sorted(new_ids)
        audit_rows.append(
            {
                "state": "US",
                "source_id": "US",
                "successors": migration_payload["US"],
            }
        )

    existing_payload: dict[str, list[str]] = {}
    if migration_path.exists():
        existing_payload = json.loads(migration_path.read_text(encoding="utf-8"))

    next_payload = {
        key: value
        for key, value in existing_payload.items()
        if not str(key).startswith("US_")
    }
    next_payload.update(dict(sorted(migration_payload.items())))
    migration_path.parent.mkdir(parents=True, exist_ok=True)
    migration_path.write_text(
        json.dumps(next_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    metrics["us_migration_entries"] = len(migration_payload)
    metrics["us_migration_expansions"] = sum(
        1 for successors in migration_payload.values() if len(successors) > 1
    )
    audit_payload = {
        "previous_us_feature_count": int(len(previous_us)),
        "current_us_feature_count": int(len(current_us)),
        "migration_entry_count": int(metrics["us_migration_entries"]),
        "expanded_entry_count": int(metrics["us_migration_expansions"]),
        "entries": audit_rows,
    }
    US_MIGRATION_AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    US_MIGRATION_AUDIT_PATH.write_text(
        json.dumps(audit_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        "[Detail patch] Updated US feature migration asset: "
        f"entries={metrics['us_migration_entries']}, "
        f"expanded={metrics['us_migration_expansions']}"
    )
    return metrics


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


def _safe_polygonal_intersection(left, right):
    left_geom = _normalize_polygonal_geometry(left)
    right_geom = _normalize_polygonal_geometry(right)
    if left_geom is None or right_geom is None:
        return None

    candidates = (
        (left_geom, right_geom),
        (_normalize_polygonal_geometry(left_geom.buffer(0)), right_geom),
        (left_geom, _normalize_polygonal_geometry(right_geom.buffer(0))),
        (
            _normalize_polygonal_geometry(left_geom.buffer(0)),
            _normalize_polygonal_geometry(right_geom.buffer(0)),
        ),
    )
    for candidate_left, candidate_right in candidates:
        if candidate_left is None or candidate_right is None:
            continue
        try:
            return _normalize_polygonal_geometry(candidate_left.intersection(candidate_right))
        except Exception:
            continue
    return None


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
        clipped_geometry = _safe_polygonal_intersection(geometry, land_union)
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
        "--previous-output-topology",
        type=Path,
        default=None,
        help="Optional previous detail topology used for ID reconciliation and migration generation.",
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
    source_path = args.source_topology
    output_path = args.output_topology
    canonicalize_countries = _parse_country_codes_arg(args.canonicalize_countries)
    previous_output_path = args.previous_output_topology or output_path
    previous_output_political = _load_existing_output_political(previous_output_path)

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
        if callable(apply_config_subdivisions):
            patched_political = apply_config_subdivisions(patched_political)
        else:
            print(
                "[Detail patch] Subdivision enrichment skipped: "
                f"{APPLY_CONFIG_SUBDIVISIONS_IMPORT_ERROR}"
            )
    patched_political = _repair_political_metadata(patched_political)
    patched_political = _repair_political_geometries(patched_political)
    canonicalize_start = time.perf_counter()
    patched_political, canonicalize_metrics = canonicalize_country_boundaries(
        patched_political,
        shell_gdf=primary_layers["political"] if primary_layers is not None else None,
        allowed_area_gdf=primary_layers.get("land") if primary_layers is not None else layers.get("land"),
        target_country_codes=canonicalize_countries,
        log_prefix="[Detail patch canonicalize]",
    )
    _record_timing(
        stage_timings,
        "local_country_canonicalization",
        canonicalize_start,
        countries=[entry["country_code"] for entry in canonicalize_metrics if not entry.get("skipped")],
    )
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
    reconcile_start = time.perf_counter()
    roundtrip_political, us_id_metrics = _reconcile_us_feature_ids(
        previous_output_political,
        roundtrip_political,
    )
    roundtrip_political["computed_neighbors"] = compute_neighbor_graph(
        _ensure_epsg4326(roundtrip_political.copy()).reset_index(drop=True)
    )
    layers["political"] = roundtrip_political
    _record_timing(
        stage_timings,
        "us_id_reconciliation",
        reconcile_start,
        **us_id_metrics,
    )
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
        for repair_pass in range(1, MAX_SHELL_COVERAGE_REPAIR_PASSES + 1):
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
            roundtrip_political["computed_neighbors"] = compute_neighbor_graph(
                _ensure_epsg4326(roundtrip_political.copy()).reset_index(drop=True)
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
    final_political = _repair_political_geometries(_topology_object_to_gdf(output_dict, "political"))
    migration_start = time.perf_counter()
    migration_metrics = _update_us_feature_migration_asset(
        previous_output_political,
        final_political,
    )
    _record_timing(
        stage_timings,
        "us_feature_migration",
        migration_start,
        **migration_metrics,
    )
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
