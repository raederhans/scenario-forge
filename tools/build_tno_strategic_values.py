from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys

import numpy as np
from scipy.spatial import cKDTree
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import Point, box
from shapely.ops import transform

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from map_builder.population_spatial import decode_topology
from scenario_builder.hoi4 import strategic
from scenario_builder.hoi4.strategic import parse_victory_point_localisation
from tools import tno_1962_registration as registration


EXTRA_CITY_NAMES = {
    # TNO VICTORY_POINTS_6521 explicitly names Berlin-Germania; override calls it Germania.
    "CITY::ne::1159151529": ["Berlin-Germania"],
    # TNO provinces 6332 and 9503 use the German names of Kaliningrad and Strasbourg.
    "CITY::ne::1159149527": ["Königsberg"],
    "CITY::ne::1159147229": ["Straßburg"],
    # TNO provinces 957 and 4401 use Vladivostok's Japanese name and Saigon's former name.
    "CITY::ne::1159150739": ["Urajio"],
    "CITY::ne::1159151253": ["Saigon"],
    # TNO provinces 12040/11977 and 7214/11959 use Japanese names for these Korean/Taiwanese cities.
    "CITY::ne::1159149125": ["Jinsen"],
    "CITY::ne::1159137925": ["Zenshū"],
    "CITY::ne::1159146175": ["Shinchiku"],
    "CITY::ne::1159150461": ["Taichū"],
    # TNO province 7763 uses Blagoveshchensk's Chinese name on the Amur.
    "CITY::ne::1159149625": ["Hailanpao"],
}


def relocate_cities(cities: dict, topology: dict, owners: dict) -> None:
    features = [feature for feature in decode_topology(topology) if feature["id"] in owners]
    shapes = [feature["geometry"] for feature in features]
    tree = STRtree(shapes)
    for feature in cities["features"]:
        props = feature["properties"]
        lon, lat = props["lon"], props["lat"]
        point = Point(lon, lat)
        hits = tree.query(point, predicate="intersects")
        host = ""
        if len(hits):
            host = min(features[index]["id"] for index in hits)
        else:
            latitude_radius = 25 / 110.5
            longitude_radius = latitude_radius / math.cos(math.radians(abs(lat) + latitude_radius))
            candidates = set()
            for offset in (-360, 0, 360):
                candidates.update(tree.query(box(lon + offset - longitude_radius, lat - latitude_radius,
                                                  lon + offset + longitude_radius, lat + latitude_radius)))
            if candidates:
                project = Transformer.from_crs("EPSG:4326", f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m", always_xy=True).transform
                distance, candidate_id = min(
                    (transform(project, shapes[index]).distance(Point(0, 0)), features[index]["id"])
                    for index in candidates
                )
                if distance <= 25000:
                    host = candidate_id
        props["host_feature_id"] = host


def province_geometry(source, states, controls, fitted):
    province_states = np.zeros(len(source.kinds), dtype=int)
    for sid, state in states.items():
        province_states[state.province_ids] = sid
    counts = np.bincount(source.pixels.ravel(), minlength=len(source.kinds))
    sx, sy = np.zeros(len(counts)), np.zeros(len(counts))
    x = np.arange(source.width) + .5
    adjacency = set()
    previous = None
    stride = max(states) + 1
    for y, row in enumerate(source.pixels):
        row_counts = np.bincount(row, minlength=len(counts))
        sx += np.bincount(row, weights=x, minlength=len(counts))
        sy += row_counts * (y + .5)
        state_row = province_states[row]
        pairs = [(state_row, np.roll(state_row, 1))]
        if previous is not None:
            pairs.append((state_row, previous))
        for left, right in pairs:
            border = (left != right) & (left != 0) & (right != 0)
            adjacency.update(np.unique(np.minimum(left[border], right[border]) * stride
                                       + np.maximum(left[border], right[border])).tolist())
        previous = state_row
    province_ids = np.flatnonzero(counts)
    pixels = np.column_stack((sx[province_ids], sy[province_ids])) / counts[province_ids, None]
    nearest = cKDTree([[c['x'], c['y']] for c in controls]).query(pixels)[1]
    regions = np.array([controls[index]['region'] for index in nearest])
    centers = np.full((len(counts), 2), np.nan)
    for region in np.unique(regions):
        selected = regions == region
        centers[province_ids[selected]] = fitted.models[region, 'tps'].pixel_to_lonlat(pixels[selected])
    return province_states, centers, adjacency, stride


def resolve_spatial_matches(states, names, city_index, owners, source, fitted,
                            province_states, centers, adjacency, stride, decisions):
    cities = city_index['cities']
    city_provinces, _, _ = source.lookup(fitted.lonlat_to_pixel([[c['lon'], c['lat']] for c in cities]))
    city_states = {city['city_id']: int(province_states[pid]) for city, pid in zip(cities, city_provinces)}
    points = []
    for sid, state in sorted(states.items()):
        for pid, value in state.victory_points:
            labels = names.get(pid, [])
            point = dict(province_id=pid, value=value, state_id=sid, owner_tag=state.owner_tag,
                         name=labels[0] if labels else '', match_method='unmatched', confidence='none')
            candidates = {}
            for name in labels:
                for city in city_index['by_name'].get(strategic.normalize_name_key(name), []):
                    candidates.setdefault(city['city_id'], (name, city))
            accepted, rejected = [], []
            for name, city in candidates.values():
                city_state = city_states[city['city_id']]
                distance = float(registration.GEOD.inv(*centers[pid], city['lon'], city['lat'])[2] / 1000)
                same_state = city_state == sid
                adjacent = min(sid, city_state) * stride + max(sid, city_state) in adjacency
                # 配准误差约数十公里，沿海城市常落在无州像素上；同名城市距胜利点省份 80 km 内也视为同一地点。
                spatial_match = same_state or (adjacent and distance <= 60) or distance <= 80
                if city['host_feature_id'] and spatial_match:
                    accepted.append((not same_state, distance, city['city_id'], name, city))
                else:
                    rejected.append(dict(name=name, value=value, province_id=pid, city_id=city['city_id'],
                                         city_name=city['name'], city_state=city_state, state_id=sid,
                                         spatial_rejected=not spatial_match,
                                         distance_km=distance if math.isfinite(distance) else None))
            if accepted:
                _, _, _, name, city = min(accepted)
                owner_match = owners[city['host_feature_id']] == state.owner_tag
                point.update(name=name, city_id=city['city_id'], stable_key=city['stable_key'],
                             host_feature_id=city['host_feature_id'], lon=city['lon'], lat=city['lat'],
                             match_method='name_owner_match' if owner_match else 'name_match',
                             confidence='high' if owner_match else 'low')
            elif rejected and decisions is not None:
                decisions.append(min(rejected, key=lambda row: (row['distance_km'] if row['distance_km'] is not None else math.inf, row['city_id'])))
            points.append(point)
    return points


def build_payload(tno_root: Path, decisions: list | None = None) -> dict:
    scenario_dir = PROJECT_ROOT / "data/scenarios/tno_1962"
    manifest = json.loads((scenario_dir / "manifest.json").read_text(encoding="utf-8"))
    owners = json.loads((scenario_dir / "owners.by_feature.json").read_text(encoding="utf-8"))["owners"]
    topology_path = PROJECT_ROOT / manifest["runtime_topology_url"]
    topology = json.loads(topology_path.read_text(encoding="utf-8"))
    localisation_dir = tno_root / "localisation/english"
    names = parse_victory_point_localisation(localisation_dir / "victory_points_l_english.yml")
    for province_id, tno_names in parse_victory_point_localisation(
        localisation_dir / "TNO_victory_points_l_english.yml"
    ).items():
        names[province_id] = list(dict.fromkeys(tno_names + names.get(province_id, [])))
    cities = json.loads((PROJECT_ROOT / "data/world_cities.geojson").read_text(encoding="utf-8"))
    overrides = json.loads((scenario_dir / "city_overrides.json").read_text(encoding="utf-8"))["cities"]
    for feature in cities["features"]:
        props = feature["properties"]
        override = overrides.get(props["city_id"], {})
        props["aliases"] = list(dict.fromkeys([
            *props.get("aliases", []),
            override.get("display_name", {}).get("en", ""),
            *override.get("aliases", []),
            *EXTRA_CITY_NAMES.get(props["city_id"], []),
        ]))
    relocate_cities(cities, topology, owners)
    city_index = strategic.load_world_city_index(payload=cities)
    source, states, _ = registration.load_source(tno_root)
    controls, _ = registration.collect_controls(source, states, tno_root)
    fitted = registration.Registration(controls, source.width, validate=False)
    province_states, centers, adjacency, stride = province_geometry(source, states, controls, fitted)
    points = resolve_spatial_matches(states, names, city_index, owners, source, fitted,
                                     province_states, centers, adjacency, stride, decisions)
    centroids = strategic.decode_runtime_feature_centroids(topology)
    anchors = strategic._state_anchors(points)
    buckets, bucket_by_feature = strategic.attribute_features_to_state_buckets(
        states_by_id=states, owner_by_feature_id=owners, feature_centroids=centroids, state_anchors=anchors,
    )
    resources = strategic._build_resource_points(
        states_by_id=states, victory_points=points, bucket_by_feature=bucket_by_feature, feature_centroids=centroids,
    )
    unmatched = [point for point in points if point["match_method"] == "unmatched"]
    return {
        "version": 1, "scenario_id": "tno_1962", "baseline_hash": manifest["baseline_hash"],
        "as_of_date": "1962-01-01", "metrics": strategic._metric_summary(buckets), "buckets": buckets,
        "bucket_by_feature": bucket_by_feature, "victory_points": points, "resource_points": resources,
        "diagnostics": {
            "vp_total": len(points), "vp_matched": len(points) - len(unmatched),
            "states_anchored": len(anchors), "states_pooled": len(states) - len(anchors),
            "feature_centroid_count": len(centroids), "resource_point_count": len(resources["features"]),
            "unmatched_vp_sample": unmatched[:20],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tno-root", type=Path, default=Path(
        "C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901"
    ))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    payload = build_payload(args.tno_root)
    output = PROJECT_ROOT / "data/scenarios/tno_1962/strategic_values.by_feature.json"
    if args.check:
        return int(not output.exists() or json.loads(output.read_text(encoding="utf-8")) != payload)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
