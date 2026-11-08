from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from .models import RuntimeFeatureRecord, StateRecord


RESOURCE_KEYS = ("steel", "oil", "aluminium", "rubber", "tungsten", "chromium", "coal")
BUILDING_METRIC_KEYS = (
    "infrastructure",
    "military_factories",
    "civilian_factories",
    "factories_total",
)
STRATEGIC_METRIC_KEYS = ("manpower", *RESOURCE_KEYS, *BUILDING_METRIC_KEYS)
HOI4_BUILDING_TO_METRIC = {
    "arms_factory": "military_factories",
    "industrial_complex": "civilian_factories",
}


def normalize_name_key(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    ascii_text = "".join(char for char in text if not unicodedata.combining(char))
    ascii_text = re.sub(r"[^0-9A-Za-z]+", " ", ascii_text)
    return " ".join(ascii_text.casefold().strip().split())


def parse_victory_point_localisation(path: Path) -> dict[int, list[str]]:
    if not path.exists():
        return {}
    mapping: dict[int, list[str]] = defaultdict(list)
    pattern = re.compile(
        r'\b(?:[A-Z0-9]+_)?VICTORY_POINTS_(?P<province>\d+)(?:_[A-Z0-9]+)?\s*:\d*\s*"(?P<name>[^"]+)"'
    )
    for line in path.read_text(encoding="utf-8-sig", errors="ignore").splitlines():
        match = pattern.search(line)
        if not match:
            continue
        province_id = int(match.group("province"))
        name = match.group("name").strip()
        if name and name not in mapping[province_id]:
            mapping[province_id].append(name)
    return dict(mapping)


def _as_list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        return [item.strip() for item in value.split(";") if item.strip()]
    return []


def _as_float(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def load_world_city_index(path: Path | None = None, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if payload is None:
        if path is None or not path.exists():
            return {"cities": [], "by_name": {}}
        payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features") if isinstance(payload, dict) else []
    cities: list[dict[str, Any]] = []
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for index, feature in enumerate(features if isinstance(features, list) else []):
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else {}
        coords = geometry.get("coordinates") if isinstance(geometry.get("coordinates"), list) else []
        lon = _as_float(props.get("lon") or props.get("longitude"))
        lat = _as_float(props.get("lat") or props.get("latitude"))
        if (lon is None or lat is None) and len(coords) >= 2:
            lon = _as_float(coords[0])
            lat = _as_float(coords[1])
        if lon is None or lat is None:
            continue
        city = {
            "city_id": str(props.get("city_id") or props.get("cityId") or props.get("id") or feature.get("id") or f"city:{index + 1}").strip(),
            "stable_key": str(props.get("stable_key") or props.get("stableKey") or "").strip(),
            "host_feature_id": str(props.get("host_feature_id") or props.get("hostFeatureId") or "").strip(),
            "name": str(props.get("name") or props.get("name_ascii") or props.get("name_en") or "").strip(),
            "lon": lon,
            "lat": lat,
            "population": _as_float(props.get("population")) or 0.0,
            "aliases": [],
        }
        names = [
            props.get("name"),
            props.get("name_ascii"),
            props.get("name_en"),
            props.get("label"),
            *_as_list(props.get("aliases")),
        ]
        normalized_aliases = []
        for raw_name in names:
            name_key = normalize_name_key(raw_name)
            if name_key and name_key not in normalized_aliases:
                normalized_aliases.append(name_key)
                by_name[name_key].append(city)
        city["aliases"] = normalized_aliases
        cities.append(city)
    return {"cities": cities, "by_name": dict(by_name)}


def decode_runtime_feature_centroids(topology_payload: dict[str, Any], object_name: str = "political") -> dict[str, tuple[float, float]]:
    """返回每个地块的经纬度代表点（保证落在地块内部）。

    复用 map_builder.population_spatial.decode_topology 的拓扑解码：它同时处理带 transform 的
    增量弧线和不带 transform 的绝对坐标弧线。旧实现总是按增量取整累加，遇到当前运行时拓扑的
    绝对浮点弧线会算出非经纬度的结果。
    """
    from map_builder.population_spatial import decode_topology

    if not isinstance(topology_payload, dict) or object_name not in topology_payload.get("objects", {}):
        return {}
    centroids: dict[str, tuple[float, float]] = {}
    for feature in decode_topology(topology_payload, object_name):
        geometry = feature.get("geometry")
        if geometry is None or geometry.is_empty:
            continue
        point = geometry.representative_point()
        centroids[feature["id"]] = (float(point.x), float(point.y))
    return centroids


def _assignment_owner_tag(assignment: object) -> str:
    if isinstance(assignment, str):
        return assignment.strip().upper()
    if isinstance(assignment, dict):
        return str(assignment.get("owner_tag") or assignment.get("owner") or "").strip().upper()
    return str(getattr(assignment, "owner_tag", "") or "").strip().upper()


def _owner_by_feature(assignments: dict[str, object]) -> dict[str, str]:
    return {
        str(feature_id): owner_tag
        for feature_id, assignment in assignments.items()
        for owner_tag in [_assignment_owner_tag(assignment)]
        if owner_tag
    }


def _choose_city(candidates: Iterable[dict[str, Any]], owner_tag: str, owner_by_feature_id: dict[str, str]) -> tuple[dict[str, Any] | None, bool]:
    owner_matches: list[dict[str, Any]] = []
    all_candidates: list[dict[str, Any]] = []
    for city in candidates:
        all_candidates.append(city)
        if owner_by_feature_id.get(str(city.get("host_feature_id") or "")) == owner_tag:
            owner_matches.append(city)
    pool = owner_matches or all_candidates
    if not pool:
        return None, False
    return max(pool, key=lambda city: float(city.get("population") or 0)), bool(owner_matches)


def resolve_victory_point_cities(
    *,
    states_by_id: dict[int, StateRecord],
    vp_localisation: dict[int, list[str]],
    city_index: dict[str, Any],
    owner_by_feature_id: dict[str, str],
) -> list[dict[str, Any]]:
    by_name = city_index.get("by_name") if isinstance(city_index.get("by_name"), dict) else {}
    results: list[dict[str, Any]] = []
    for state_id, state in sorted(states_by_id.items()):
        for province_id, value in state.victory_points:
            names = vp_localisation.get(province_id) or []
            selected_city = None
            selected_name = names[0] if names else ""
            owner_match = False
            for name in names:
                selected_name = name
                city, matched_owner = _choose_city(by_name.get(normalize_name_key(name), []), state.owner_tag, owner_by_feature_id)
                if city is not None:
                    selected_city = city
                    owner_match = matched_owner
                    break
            if selected_city is None:
                results.append(
                    {
                        "province_id": province_id,
                        "value": value,
                        "state_id": state_id,
                        "owner_tag": state.owner_tag,
                        "name": selected_name,
                        "match_method": "unmatched",
                        "confidence": "none",
                    }
                )
                continue
            match_method = "name_owner_match" if owner_match else "name_match"
            results.append(
                {
                    "province_id": province_id,
                    "value": value,
                    "state_id": state_id,
                    "owner_tag": state.owner_tag,
                    "name": selected_name or selected_city.get("name", ""),
                    "city_id": selected_city.get("city_id", ""),
                    "stable_key": selected_city.get("stable_key", ""),
                    "host_feature_id": selected_city.get("host_feature_id", ""),
                    "lon": selected_city.get("lon"),
                    "lat": selected_city.get("lat"),
                    "match_method": match_method,
                    "confidence": "high" if owner_match else "low",
                }
            )
    return results


def _state_metric_values(state: StateRecord) -> dict[str, float]:
    values: dict[str, float] = {key: 0.0 for key in STRATEGIC_METRIC_KEYS}
    values["manpower"] = float(state.manpower or 0)
    for resource_key in RESOURCE_KEYS:
        values[resource_key] = float(state.resources.get(resource_key, 0.0))
    values["infrastructure"] = float(state.buildings.get("infrastructure", 0))
    for building_key, metric_key in HOI4_BUILDING_TO_METRIC.items():
        total = float(state.buildings.get(building_key, 0))
        for province_buildings in state.province_buildings.values():
            total += float(province_buildings.get(building_key, 0))
        values[metric_key] = total
    values["factories_total"] = values["military_factories"] + values["civilian_factories"]
    return values


def _add_metrics(target: dict[str, float], source: dict[str, float]) -> None:
    for key in STRATEGIC_METRIC_KEYS:
        if key == "infrastructure":
            target[key] = max(float(target.get(key, 0.0)), float(source.get(key, 0.0)))
        else:
            target[key] = float(target.get(key, 0.0)) + float(source.get(key, 0.0))


def _haversine_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = math.radians(a[0]), math.radians(a[1])
    lon2, lat2 = math.radians(b[0]), math.radians(b[1])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _state_anchors(victory_points: list[dict[str, Any]]) -> dict[int, tuple[float, float]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for entry in victory_points:
        if _as_float(entry.get("lon")) is None or _as_float(entry.get("lat")) is None:
            continue
        grouped[int(entry["state_id"])].append(entry)
    anchors: dict[int, tuple[float, float]] = {}
    for state_id, entries in grouped.items():
        total_weight = sum(max(1, int(entry.get("value") or 0)) for entry in entries)
        lon = sum(float(entry["lon"]) * max(1, int(entry.get("value") or 0)) for entry in entries) / total_weight
        lat = sum(float(entry["lat"]) * max(1, int(entry.get("value") or 0)) for entry in entries) / total_weight
        anchors[state_id] = (lon, lat)
    return anchors


def attribute_features_to_state_buckets(
    *,
    states_by_id: dict[int, StateRecord],
    owner_by_feature_id: dict[str, str],
    feature_centroids: dict[str, tuple[float, float]],
    state_anchors: dict[int, tuple[float, float]],
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    state_buckets: dict[str, dict[str, Any]] = {}
    pool_buckets: dict[str, dict[str, Any]] = {}
    bucket_by_feature: dict[str, str] = {}
    states_by_owner: dict[str, list[StateRecord]] = defaultdict(list)
    for state in states_by_id.values():
        states_by_owner[state.owner_tag].append(state)
        if state.state_id in state_anchors:
            bucket_id = f"s{state.state_id}"
            state_buckets[bucket_id] = {
                "state_id": state.state_id,
                "owner_tag": state.owner_tag,
                "attribution": "vp_anchor",
                **_state_metric_values(state),
            }
        else:
            pool_id = f"pool:{state.owner_tag}"
            bucket = pool_buckets.setdefault(
                pool_id,
                {
                    "owner_tag": state.owner_tag,
                    "attribution": "country_pooled",
                    **{key: 0.0 for key in STRATEGIC_METRIC_KEYS},
                },
            )
            _add_metrics(bucket, _state_metric_values(state))

    anchors_by_owner: dict[str, list[tuple[int, tuple[float, float]]]] = defaultdict(list)
    for state_id, anchor in state_anchors.items():
        state = states_by_id.get(state_id)
        if state is not None:
            anchors_by_owner[state.owner_tag].append((state_id, anchor))

    for feature_id, owner_tag in sorted(owner_by_feature_id.items()):
        centroid = feature_centroids.get(feature_id)
        owner_anchors = anchors_by_owner.get(owner_tag, [])
        if centroid and owner_anchors:
            nearest_state_id, _ = min(
                owner_anchors,
                key=lambda item: _haversine_distance(centroid, item[1]),
            )
            bucket_by_feature[feature_id] = f"s{nearest_state_id}"
        else:
            pool_id = f"pool:{owner_tag}"
            pool_buckets.setdefault(
                pool_id,
                {
                    "owner_tag": owner_tag,
                    "attribution": "country_pooled",
                    **{key: 0.0 for key in STRATEGIC_METRIC_KEYS},
                },
            )
            bucket_by_feature[feature_id] = pool_id

    buckets = {**state_buckets, **pool_buckets}
    return buckets, bucket_by_feature


def _metric_summary(buckets: dict[str, dict[str, Any]]) -> dict[str, dict[str, float | str]]:
    metrics: dict[str, dict[str, float | str]] = {}
    for key in STRATEGIC_METRIC_KEYS:
        values = sorted(float(bucket.get(key, 0.0)) for bucket in buckets.values())
        max_value = values[-1] if values else 0.0
        percentile_index = min(len(values) - 1, max(0, math.ceil(len(values) * 0.95) - 1)) if values else 0
        metrics[key] = {
            "kind": "level" if key == "infrastructure" else "additive",
            "min": 0,
            "max": max_value,
            "p95": values[percentile_index] if values else 0.0,
        }
    return metrics


def _resource_tier(amount: float, max_amount: float) -> int:
    if max_amount <= 0:
        return 1
    ratio = amount / max_amount
    if ratio >= 0.66:
        return 3
    if ratio >= 0.33:
        return 2
    return 1


def _feature_centroid_anchor(feature_ids: list[str], feature_centroids: dict[str, tuple[float, float]]) -> tuple[float, float] | None:
    points = [feature_centroids[feature_id] for feature_id in feature_ids if feature_id in feature_centroids]
    if not points:
        return None
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def _build_resource_points(
    *,
    states_by_id: dict[int, StateRecord],
    victory_points: list[dict[str, Any]],
    bucket_by_feature: dict[str, str],
    feature_centroids: dict[str, tuple[float, float]],
) -> dict[str, Any]:
    vp_by_state: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for entry in victory_points:
        if _as_float(entry.get("lon")) is not None and _as_float(entry.get("lat")) is not None:
            vp_by_state[int(entry["state_id"])].append(entry)
    features_by_bucket: dict[str, list[str]] = defaultdict(list)
    features_by_owner: dict[str, list[str]] = defaultdict(list)
    for feature_id, bucket_id in bucket_by_feature.items():
        features_by_bucket[bucket_id].append(feature_id)
        owner_tag = ""
        if bucket_id.startswith("pool:"):
            owner_tag = bucket_id.split(":", 1)[1]
        elif bucket_id.startswith("s") and bucket_id[1:].isdigit():
            state = states_by_id.get(int(bucket_id[1:]))
            owner_tag = state.owner_tag if state is not None else ""
        if owner_tag:
            features_by_owner[owner_tag].append(feature_id)
    state_resource_entries: list[dict[str, Any]] = []
    pooled_resources_by_owner: dict[str, dict[str, float]] = defaultdict(lambda: {key: 0.0 for key in RESOURCE_KEYS})
    pooled_state_ids_by_owner: dict[str, set[int]] = defaultdict(set)
    for state_id, state in sorted(states_by_id.items()):
        best_vp = max(vp_by_state.get(state_id, []), key=lambda entry: int(entry.get("value") or 0), default=None)
        anchor_kind = "vp_city"
        lon = _as_float(best_vp.get("lon")) if best_vp else None
        lat = _as_float(best_vp.get("lat")) if best_vp else None
        if lon is None or lat is None:
            centroid = _feature_centroid_anchor(features_by_bucket.get(f"s{state_id}", []), feature_centroids)
            if centroid is None:
                for resource_key in RESOURCE_KEYS:
                    amount = float(state.resources.get(resource_key, 0.0))
                    if amount > 0:
                        pooled_resources_by_owner[state.owner_tag][resource_key] += amount
                        pooled_state_ids_by_owner[state.owner_tag].add(state_id)
                continue
            lon, lat = centroid
            anchor_kind = "feature_centroid"
        for resource_key in RESOURCE_KEYS:
            amount = float(state.resources.get(resource_key, 0.0))
            if amount <= 0:
                continue
            state_resource_entries.append(
                {
                    "resource": resource_key,
                    "amount": amount,
                    "lon": lon,
                    "lat": lat,
                    "state_id": state_id,
                    "owner_tag": state.owner_tag,
                    "anchor_kind": anchor_kind,
                }
            )
    pooled_resource_entries: list[dict[str, Any]] = []
    for owner_tag, resources in sorted(pooled_resources_by_owner.items()):
        centroid = _feature_centroid_anchor(
            sorted(set(features_by_owner.get(owner_tag, []))),
            feature_centroids,
        )
        if centroid is None:
            continue
        lon, lat = centroid
        state_ids = sorted(pooled_state_ids_by_owner.get(owner_tag, set()))
        for resource_key in RESOURCE_KEYS:
            amount = float(resources.get(resource_key, 0.0))
            if amount <= 0:
                continue
            pooled_resource_entries.append(
                {
                    "resource": resource_key,
                    "amount": amount,
                    "lon": lon,
                    "lat": lat,
                    "state_ids": state_ids,
                    "owner_tag": owner_tag,
                    "anchor_kind": "owner_feature_centroid",
                    "attribution": "country_pooled",
                }
            )
    max_by_resource = {
        resource_key: max(
            (
                float(entry.get("amount", 0.0))
                for entry in [*state_resource_entries, *pooled_resource_entries]
                if entry.get("resource") == resource_key
            ),
            default=0.0,
        )
        for resource_key in RESOURCE_KEYS
    }
    features: list[dict[str, Any]] = []
    for entry in [*state_resource_entries, *pooled_resource_entries]:
        resource_key = str(entry["resource"])
        amount = float(entry["amount"])
        properties = {
            "resource": resource_key,
            "amount": amount,
        }
        if entry.get("state_id") is not None:
            properties["state_id"] = entry["state_id"]
        properties["owner_tag"] = entry["owner_tag"]
        properties["anchor_kind"] = entry["anchor_kind"]
        properties["tier"] = _resource_tier(amount, max_by_resource.get(resource_key, 0.0))
        if entry.get("attribution") is not None:
            properties["attribution"] = entry["attribution"]
        if entry.get("state_ids"):
            properties["state_ids"] = entry["state_ids"]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [entry["lon"], entry["lat"]]},
                "properties": properties,
            }
        )
    return {"type": "FeatureCollection", "features": features}


def build_strategic_values_payload(
    *,
    scenario_id: str,
    baseline_hash: str,
    as_of_date: str,
    states_by_id: dict[int, StateRecord],
    runtime_features: list[RuntimeFeatureRecord],
    assignments: dict[str, object],
    runtime_topology_payload: dict[str, Any],
    vp_localisation: dict[int, list[str]],
    world_cities_payload: dict[str, Any] | None = None,
    world_cities_path: Path | None = None,
) -> dict[str, Any]:
    owner_by_feature_id = _owner_by_feature(assignments)
    city_index = load_world_city_index(world_cities_path, world_cities_payload)
    victory_points = resolve_victory_point_cities(
        states_by_id=states_by_id,
        vp_localisation=vp_localisation,
        city_index=city_index,
        owner_by_feature_id=owner_by_feature_id,
    )
    feature_centroids = decode_runtime_feature_centroids(runtime_topology_payload)
    state_anchors = _state_anchors(victory_points)
    buckets, bucket_by_feature = attribute_features_to_state_buckets(
        states_by_id=states_by_id,
        owner_by_feature_id=owner_by_feature_id,
        feature_centroids=feature_centroids,
        state_anchors=state_anchors,
    )
    resource_points = _build_resource_points(
        states_by_id=states_by_id,
        victory_points=victory_points,
        bucket_by_feature=bucket_by_feature,
        feature_centroids=feature_centroids,
    )
    unmatched = [entry for entry in victory_points if entry.get("match_method") == "unmatched"]
    diagnostics = {
        "vp_total": len(victory_points),
        "vp_matched": len(victory_points) - len(unmatched),
        "states_anchored": len(state_anchors),
        "states_pooled": sum(1 for state_id in states_by_id if state_id not in state_anchors),
        "feature_centroid_count": len(feature_centroids),
        "resource_point_count": len(resource_points.get("features", [])),
        "unmatched_vp_sample": unmatched[:20],
    }
    return {
        "version": 1,
        "scenario_id": scenario_id,
        "baseline_hash": baseline_hash,
        "as_of_date": as_of_date,
        "metrics": _metric_summary(buckets),
        "buckets": buckets,
        "bucket_by_feature": bucket_by_feature,
        "victory_points": victory_points,
        "resource_points": resource_points,
        "diagnostics": diagnostics,
    }
