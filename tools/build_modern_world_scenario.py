"""Rebuild Modern World from the complete canonical political map.

Detached primary islands are retained using the runtime builder's existing
overlap policy. Interior holes/coastal slivers are not inferred to be land.
The output keeps source feature IDs and uses lossless shared TopoJSON arcs so
small countries and repaired rings cannot collapse during quantization.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
import topojson

from map_builder.contracts import sha256_json_stable
from map_builder.geo.france_topology_precision import _compact_arcs, _decode_polygon
from map_builder.geo.topology import compute_neighbor_graph
from tools.build_runtime_political_topology import (
    _normalize_polygonal_geometry as normalize,
    _retain_primary_gap_components,
)
from tools.check_scenario_contracts import _build_snapshot_for_scenario, _refresh_audit_payload, _sha256_path as sha256_path
from tools.scenario_topology_decode import topology_object_to_geojson


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value, *, compact=False):
    Path(path).write_text(json.dumps(value, ensure_ascii=False,
                                   indent=None if compact else 2,
                                   separators=(",", ":") if compact else None,
                                   allow_nan=False) + "\n", encoding="utf-8")


def load_country_sources(path):
    # The checked-in Europe source uses EPSG:3035, unlike runtime TopoJSON.
    return gpd.read_file(path).to_crs("EPSG:4326").__geo_interface__


def restore_reviewed_source_islands(features, island_sources, world):
    """Restore the reviewed PM island missing from both canonical topologies.

    Only detached source components with under 5% existing coverage qualify.
    Keep the existing feature/owner and never replace its mainland coastline.
    """
    restored = []
    for source in island_sources.get("features", []):
        code = source.get("properties", {}).get("ISO_A2")
        if code != "PM":
            continue
        targets = [f for f in features if f["properties"].get("cntr_code") == code]
        if len(targets) != 1:
            raise ValueError("Reviewed PM island recovery requires one existing PM feature")
        source_geometry = normalize(shape(source["geometry"]))
        if source_geometry is None:
            raise ValueError("Empty PM island source")
        parts = [source_geometry] if source_geometry.geom_type == "Polygon" else source_geometry.geoms
        for part in parts:
            if part.intersection(world).area / part.area >= 0.05:
                continue
            addition = normalize(part.difference(world))
            if addition is None:
                continue
            target = targets[0]
            target["geometry"] = mapping(shape(target["geometry"]).union(addition))
            world = world.union(addition)
            restored.append({"feature_id": target["properties"]["id"], "country_code": code,
                             "source": "ne_50m_admin_0_countries", "bounds": list(addition.bounds)})
    return restored


def rebuild_features(runtime, primary, country_sources, required_ids=(), island_sources=None):
    """Keep canonical detail, restore detached islands and collapsed microstates."""
    features = []
    geometries = []
    dropped, repaired = [], []
    for feature in topology_object_to_geojson(runtime, "political")["features"]:
        feature = deepcopy(feature)
        fid = feature["properties"]["id"]
        original = shape(feature["geometry"])
        geometry = normalize(original)
        if geometry is None:
            dropped.append(fid)
            continue
        if not original.is_valid:
            repaired.append(fid)
        if not geometry.is_valid:
            raise ValueError(f"Unrepaired canonical geometry: {fid}")
        if feature["properties"].get("cntr_code") == "AQ":
            # Source claim sectors are hidden by the renderer. Modern World
            # paints their unchanged footprints as the neutral AQ map region.
            feature["properties"]["detail_tier"] = ""
        feature["geometry"] = mapping(geometry)
        features.append(feature)
        geometries.append(geometry)

    # Country-level unions avoid one huge quadratic union of small shell fragments.
    by_country = defaultdict(list)
    for feature, geometry in zip(features, geometries):
        by_country[feature["properties"]["cntr_code"]].append(geometry)
    country_unions = {code: unary_union(parts) for code, parts in by_country.items()}
    world = unary_union(list(country_unions.values()))
    source_by_code = {f["properties"].get("ISO_A2"): f for f in country_sources["features"]}
    primary_features = topology_object_to_geojson(primary, "political")["features"]
    primary_codes = {f["properties"]["cntr_code"] for f in primary_features}
    recovered_microstates = []
    for code in sorted(primary_codes - set(by_country)):
        source = source_by_code.get(code)
        if source is None:
            continue
        geometry = normalize(shape(source["geometry"]))
        if geometry is None:
            raise ValueError(f"Empty original country source: {code}")
        # A quantized microstate may have disappeared into a neighbor. Restore
        # its authoritative source outline and cut that footprint out first.
        for index, existing in enumerate(geometries):
            if existing.intersects(geometry):
                replacement = normalize(existing.difference(geometry))
                if replacement is None:
                    raise ValueError(f"Microstate recovery would remove {features[index]['properties']['id']}")
                geometries[index] = replacement
                features[index]["geometry"] = mapping(replacement)
        features.append({"type": "Feature", "properties": {
            "id": code, "cntr_code": code, "name": source["properties"].get("NAME", code),
            "detail_tier": "primary_gap", "__source": "unquantized_country_source",
        }, "geometry": mapping(geometry)})
        geometries.append(geometry)
        recovered_microstates.append(code)
        world = world.union(geometry)

    retained = []
    for feature in primary_features:
        code = feature["properties"]["cntr_code"]
        additions = []
        for candidate in _retain_primary_gap_components(feature, code, world):
            geometry = normalize(shape(candidate["geometry"]).difference(world))
            if geometry is None:
                continue
            candidate["geometry"] = mapping(geometry)
            features.append(candidate)
            geometries.append(geometry)
            additions.append(geometry)
            retained.append(candidate["properties"]["id"])
        # The primary map already partitions countries. Updating coverage also
        # prevents duplicate components if the source repeats an island.
        if additions:
            world = world.union(unary_union(additions))
    restored_source_islands = restore_reviewed_source_islands(features, island_sources or {}, world)
    ids = [f["properties"]["id"] for f in features]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate feature IDs in rebuilt modern map")
    removed = set(required_ids) - set(ids)
    if removed:
        raise ValueError(f"Rebuild would remove existing feature IDs: {sorted(removed)[:20]}")
    return features, {
        "canonical_source_feature_count": len(runtime["objects"]["political"]["geometries"]),
        "repaired_geometry_count": len(repaired), "dropped_degenerate_ids": dropped,
        "retained_primary_component_ids": retained,
        "recovered_microstates": recovered_microstates,
        "restored_source_islands": restored_source_islands,
        "neutral_antarctic_feature_ids": [f["properties"]["id"] for f in features
                                          if f["properties"]["cntr_code"] == "AQ"],
        "retention_policy": "canonical runtime plus primary detached components with <5% existing coverage; preserve interior holes",
    }


def encode_features(features):
    for feature in features:
        bounds = shape(feature["geometry"]).bounds
        if (bounds[0] < -180.00000001 or bounds[2] > 180.00000001
                or bounds[1] < -90.00000001 or bounds[3] > 90.00000001):
            raise ValueError(f"Expected longitude/latitude geometry: {feature['properties']['id']}")
    encoded = topojson.Topology(
        {"type": "FeatureCollection", "features": features},
        prequantize=False, topoquantize=False, presimplify=False, toposimplify=False,
        shared_coords=True, winding_order="CW_CCW", object_name="political",
    ).to_dict()
    originals = {f["properties"]["id"]: shape(f["geometry"]) for f in features}
    restored = []
    for item in encoded["objects"]["political"]["geometries"]:
        geometry = _decode_polygon(encoded, item)
        original = originals[item["properties"]["id"]]
        if geometry.is_empty or not geometry.is_valid or not original.equals(geometry):
            # The topology library can collapse a near-collinear, microscopic
            # shell fragment even with quantization disabled. Keep that valid
            # original ring verbatim; ordinary shared arcs remain untouched.
            polygons = [original] if original.geom_type == "Polygon" else original.geoms
            replacement = []
            for polygon in polygons:
                rings = []
                for ring in [polygon.exterior, *polygon.interiors]:
                    rings.append([len(encoded["arcs"])])
                    encoded["arcs"].append([list(point) for point in ring.coords])
                replacement.append(rings)
            item["type"] = original.geom_type
            item["arcs"] = replacement[0] if original.geom_type == "Polygon" else replacement
            geometry = _decode_polygon(encoded, item)
            if not geometry.is_valid or not original.equals(geometry):
                raise ValueError(f"Encoding changed coverage: {item['properties']['id']}")
        # Robust ring orientation also handles tiny islands near the dateline.
        polygons = [geometry] if geometry.geom_type == "Polygon" else geometry.geoms
        polygon_arcs = [item["arcs"]] if item["type"] == "Polygon" else item["arcs"]
        for polygon, rings in zip(polygons, polygon_arcs):
            for index, ring in enumerate([polygon.exterior, *polygon.interiors]):
                if ring.is_ccw != (index > 0):
                    rings[index] = [~arc for arc in reversed(rings[index])]
        restored.append(geometry)
    _compact_arcs(encoded)
    frame = gpd.GeoDataFrame(geometry=restored, crs="EPSG:4326")
    encoded["objects"]["political"]["computed_neighbors"] = compute_neighbor_graph(frame)
    return encoded


def update_country_records(payload, features, primary, hierarchy, palette, palette_map):
    counts = Counter(f["properties"]["cntr_code"] for f in features)
    names = {g["properties"]["cntr_code"]: g["properties"]["name"]
             for g in primary["objects"]["political"]["geometries"]}
    for f in features:
        names.setdefault(f["properties"]["cntr_code"], f["properties"].get("name", ""))
    names["AQ"] = "Antarctica"
    groups = {}
    for continent in hierarchy["country_groups"]["continents"]:
        for region in continent["subregions"]:
            for code in region["countries"]:
                groups[code] = {"continent_id": continent["id"], "continent_label": continent["label"],
                                "subregion_id": region["id"], "subregion_label": region["label"]}
    colors = {row["iso2"]: palette["entries"][tag]["map_hex"]
              for tag, row in palette_map["mapped"].items() if tag in palette["entries"]}
    template = payload["countries"]["AD"]
    for code, count in sorted(counts.items()):
        if code not in payload["countries"]:
            row = deepcopy(template)
            row.update(tag=code, display_name=names[code], base_iso2=code, lookup_iso2=code,
                       provenance_iso2=code, color_hex=colors.get(code, "#8b929c"), featured=False)
            row.update(groups.get(code, {"continent_id": "continent_unclassified", "continent_label": "Unclassified",
                                         "subregion_id": "subregion_unclassified", "subregion_label": "Unclassified"}))
            payload["countries"][code] = row
        payload["countries"][code]["feature_count"] = count
    payload["countries"]["AQ"]["color_hex"] = "#e8edf2"
    payload["countries"]["AQ"]["notes"] = "Neutral Antarctic map region; sector claims do not assign sovereignty."
    payload["countries"]["AQ"].update(continent_id="continent_antarctica", continent_label="Antarctica",
                                      subregion_id="subregion_antarctica", subregion_label="Antarctica")
    payload["countries"] = dict(sorted(payload["countries"].items()))
    source = payload.get("color_source", {})
    source["unmatched"] = sorted(set(counts) - set(source.get("matched", {})) - set(source.get("inherited", {})))
    return payload


def update_capitals(hints, overrides, countries, features, city_collection):
    """Extend existing capital defaults using the project's canonical city catalog."""
    from map_builder.cities import _build_capital_catalog
    from map_builder.scenario_capital_placement import place_capital_markers
    from map_builder.scenario_capital_rules import apply_reviewed_capitals

    catalog = _build_capital_catalog(gpd.GeoDataFrame.from_features(city_collection["features"]))
    by_tag = {entry["tag"]: entry for entry in hints["entries"]}
    additions = {"capitals_by_tag": {}, "capital_city_hints": {}}
    for code in sorted(set(countries) - set(by_tag)):
        city = catalog.get(code)
        if code == "AQ":
            by_tag[code] = {"tag": code, "city_id": "", "resolution_method": "no_capital"}
        elif city:
            entry = {key: city.get(key) for key in (
                "country_code", "host_feature_id", "urban_match_id", "lon", "lat",
                "population", "base_tier", "source", "capital_kind", "name_ascii")}
            entry.update(tag=code, display_name=countries[code]["display_name"],
                         city_id=city["id"], stable_key=f"id::{city['id']}", city_name=city["name"],
                         lookup_iso2=code, base_iso2=code, capital_state_id=None,
                         resolution_method="controlled_city_fallback", confidence="high", candidate_count=1)
            additions["capitals_by_tag"][code] = city["id"]
            additions["capital_city_hints"][code] = entry
    owners = {f["properties"]["id"]: f["properties"]["cntr_code"] for f in features}
    conflicts = place_capital_markers(additions, countries, owners, features)
    if conflicts:
        raise ValueError(f"New capital territory conflicts: {conflicts}")
    by_tag.update(additions["capital_city_hints"])
    for key in additions:
        overrides.setdefault(key, {}).update(additions[key])
    city_rows = {feature["properties"]["id"]: feature["properties"]
                 for feature in city_collection["features"]}
    overrides = apply_reviewed_capitals(overrides, countries, city_rows, scenario_id="modern_world")
    conflicts = place_capital_markers(overrides, countries, owners, features)
    if conflicts:
        raise ValueError(f"Reviewed capital territory conflicts: {conflicts}")
    by_tag.update(overrides["capital_city_hints"])
    hints["entries"] = [by_tag[tag] for tag in sorted(by_tag)]
    hints["entry_count"] = len(by_tag)
    hints["missing_tags"] = sorted(set(countries) - set(by_tag))
    hints["missing_tag_count"] = len(hints["missing_tags"])
    overrides.setdefault("capital_city_hints", {}).update({"AQ": by_tag["AQ"]})
    audit = overrides.setdefault("audit", {})
    audit.update(default_capital_missing_tag_count=hints["missing_tag_count"],
                 default_capital_missing_tags=hints["missing_tags"],
                 capital_hint_count=len(overrides["capital_city_hints"]),
                 default_capital_entry_count=len(overrides.get("capitals_by_tag", {})))
    return hints, overrides


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/scenarios/modern_world")
    args = parser.parse_args()
    baseline = ROOT / "data/scenarios/modern_world"
    output = args.output_dir.resolve()
    runtime_path = ROOT / "data/europe_topology.runtime_political_v1.json"
    primary_path = ROOT / "data/europe_topology.json"
    countries_path = ROOT / "data/europe_countries.geojson"
    island_source_path = ROOT / "data/ne_50m_admin_0_countries.zip"
    manifest, countries = read(baseline / "manifest.json"), read(baseline / "countries.json")
    previous_owners = read(baseline / "owners.by_feature.json")["owners"]
    runtime, primary = read(runtime_path), read(primary_path)
    print("Restore canonical detail and detached primary islands", flush=True)
    country_sources = load_country_sources(countries_path)
    island_sources = load_country_sources(island_source_path)
    features, report = rebuild_features(runtime, primary, country_sources, previous_owners, island_sources)
    print(f"Encode and validate {len(features)} features without quantization", flush=True)
    topology = encode_features(features)
    countries = update_country_records(countries, features, primary, read(ROOT / "data/hierarchy.json"),
                                       read(ROOT / "data/palettes/hoi4_vanilla.palette.json"),
                                       read(ROOT / "data/palette-maps/hoi4_vanilla.map.json"))
    hints, overrides = update_capitals(read(baseline / "capital_hints.json"), read(baseline / "city_overrides.json"),
                                      countries["countries"], features, read(ROOT / "data/world_cities.geojson"))
    owners = {f["properties"]["id"]: f["properties"]["cntr_code"] for f in features}
    if any(owners[fid] != owner for fid, owner in previous_owners.items()):
        raise ValueError("Canonical ownership changed for an existing feature")
    if output != baseline:
        if output.exists():
            raise ValueError("Staging output must not already exist")
        shutil.copytree(baseline, output)
    generated = datetime.now(timezone.utc).isoformat()
    countries["generated_at"] = manifest["generated_at"] = generated
    hints["generated_at"] = overrides["generated_at"] = generated
    write(output / "runtime_topology.topo.json", topology, compact=True)
    write(output / "owners.by_feature.json", {"owners": dict(sorted(owners.items()))})
    write(output / "cores.by_feature.json", {"cores": {fid: [owner] for fid, owner in sorted(owners.items())}})
    write(output / "countries.json", countries)
    write(output / "capital_hints.json", hints)
    write(output / "city_overrides.json", overrides)
    manifest["baseline_hash"] = sha256_json_stable(owners)
    manifest["source"] = {"base_topology_sha256": sha256_path(primary_path),
                          "canonical_runtime_topology_sha256": sha256_path(runtime_path),
                          "unquantized_country_source_sha256": sha256_path(countries_path),
                          "reviewed_island_source_sha256": sha256_path(island_source_path),
                          "runtime_topology_sha256": sha256_path(output / "runtime_topology.topo.json")}
    summary = manifest["summary"]
    summary.update(feature_count=len(owners), owner_count=len(countries["countries"]),
                   controller_count=len(countries["countries"]),
                   quality_counts={"direct_country_copy": len(owners)},
                   source_counts={"canonical_baseline": len(owners)})
    snapshot = _build_snapshot_for_scenario(output, manifest)
    manifest["snapshot_fingerprint"] = snapshot["snapshot_fingerprint"]
    write(output / "manifest.json", manifest)
    audit = _refresh_audit_payload(output, manifest, snapshot_payload=snapshot)
    audit["diagnostics"].update(baseline_hash=manifest["baseline_hash"], canonical_country_count=len(countries["countries"]),
                               detail_topology_feature_count=len(owners), geometry_rebuild=report)
    write(output / "audit.json", audit)
    print(json.dumps({"features": len(owners), "countries": len(countries["countries"]),
                      "preserved_previous_ids": len(previous_owners), "output": str(output)}, indent=2))


if __name__ == "__main__":
    main()
