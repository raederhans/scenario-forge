"""Prepare staged full county geometry; never assigns scenario ownership.

TIGER supplies internal boundaries. The union of CB counties in each state
supplies a fixed display footprint, including its holes. CB county boundaries
are deliberately not used as individual county masks.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import mapping
from shapely.ops import polygonize

ROOT = Path(__file__).resolve().parents[1]
STATE_CODES = dict(zip(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(),
    "01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56".split()))
STATE_NAMES = dict(zip(STATE_CODES.values(),
    "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming".split("|")))


def selected_states(value=None):
    if not value:
        return set(STATE_CODES.values())
    codes = {STATE_CODES.get(s.strip().upper(), s.strip()) for s in value.split(",")}
    if not codes or not codes <= set(STATE_CODES.values()):
        raise ValueError("states_must_be_50_states_or_dc")
    return codes


def validate_frame(frame, states, label):
    if frame.crs is None:
        raise ValueError(f"{label}: source_crs_missing")
    if not {"GEOID", "STATEFP"} <= set(frame.columns):
        raise ValueError(f"{label}: county_identifiers_missing")
    frame = frame.to_crs(4326).copy()
    ids = frame.GEOID.astype(str)
    if not ids.str.fullmatch(r"\d{5}").all() or not (ids.str[:2] == frame.STATEFP.astype(str)).all():
        raise ValueError(f"{label}: invalid_county_identifiers")
    if ids.duplicated().any():
        raise ValueError(f"{label}: duplicate_county_identifiers")
    frame = frame[frame.STATEFP.isin(states)].copy()
    if set(frame.STATEFP) != states:
        raise ValueError(f"{label}: selected_states_missing")
    if (frame.geometry.isna().any() or frame.geometry.is_empty.any()
            or not frame.geometry.is_valid.all()
            or not frame.geometry.geom_type.isin(["Polygon", "MultiPolygon"]).all()):
        raise ValueError(f"{label}: invalid_polygon_geometry")
    return frame.sort_values("GEOID")


def area_km2(geometry):
    # Equal-area measure; geometry operations remain on the source lon/lat grid.
    if geometry.is_empty:
        return 0.0
    return float(gpd.GeoSeries([geometry], crs=4326).to_crs(6933).area.iloc[0] / 1e6)


def repair_clip_overlap_from_source(displayed, originals):
    """Remove overlay artifacts only where the original source excludes them.

    No area threshold: source coverage must be valid and exactly one original
    county must have positive-area intersection with the overlap. The other
    county excludes that area. The displayed union must remain exactly equal.
    """
    if shapely.coverage_is_valid(displayed):
        return displayed, []
    if not shapely.coverage_is_valid(originals):
        return displayed, []
    values = list(displayed)
    before = shapely.union_all(values)
    tree = shapely.STRtree(values)
    repairs = []
    for i, geometry in enumerate(values):
        for j in tree.query(geometry, predicate="intersects"):
            j = int(j)
            if j <= i:
                continue
            overlap = values[i].intersection(values[j])
            if overlap.area == 0:
                continue
            areas = [overlap.intersection(originals[k]).area for k in (i, j)]
            if sum(area > 0 for area in areas) != 1:
                continue
            loser = (i, j)[areas.index(0.0)]
            changed = values[loser].difference(overlap)
            if changed.is_empty or not changed.is_valid:
                raise ValueError("clip_repair_invalid_geometry")
            values[loser] = changed
            repairs.append({"indices": [i, j], "removed_from_index": loser,
                            "overlap_area_degrees2": overlap.area,
                            "original_source_intersection_areas_degrees2": areas})
    if repairs and not shapely.union_all(values).equals(before):
        raise ValueError("clip_repair_changed_display_union")
    # Independently computed mask intersections can also leave a zero-area
    # junction mismatch. Node just the flagged pairs, retaining only faces with
    # an unambiguous positive-area intersection with one original county.
    invalid = shapely.coverage_invalid_edges(values)
    flagged = {i for i, edge in enumerate(invalid) if not edge.is_empty}
    for i in sorted(flagged):
        for j in tree.query(values[i], predicate="intersects"):
            j = int(j)
            if j <= i or j not in flagged:
                continue
            faces = list(polygonize(shapely.union_all([values[i].boundary, values[j].boundary])))
            assigned = {i: [], j: []}
            for face in faces:
                hits = [k for k in (i, j) if face.intersection(originals[k]).area > 0]
                if len(hits) != 1:
                    break
                assigned[hits[0]].append(face)
            else:
                noded = [shapely.union_all(assigned[k]) for k in (i, j)]
                if (any(g.is_empty or not g.is_valid for g in noded)
                        or not shapely.union_all(noded).equals(shapely.union_all([values[i], values[j]]))):
                    continue
                values[i], values[j] = noded
                repairs.append({"indices": [i, j], "method": "joint_boundary_noding_unique_original_source_faces",
                                "faces": len(faces), "union_difference_area_degrees2": 0.0})
    if repairs and not shapely.union_all(values).equals(before):
        raise ValueError("clip_noding_changed_display_union")
    return values, repairs


def prepare_frames(tiger, cartographic, states, simplify_tolerance=0.0):
    if not 0 <= simplify_tolerance < 1:
        raise ValueError("invalid_simplify_tolerance")
    source_crs = {"tiger": str(tiger.crs), "cartographic": str(cartographic.crs)}
    tiger = validate_frame(tiger, states, "tiger")
    cartographic = validate_frame(cartographic, states, "cartographic")
    features, reports, all_displayed = [], [], []
    for state in sorted(states):
        raw = tiger[tiger.STATEFP == state]
        cb = cartographic[cartographic.STATEFP == state]
        mask = shapely.union_all(cb.geometry.to_numpy())
        source_union = shapely.union_all(raw.geometry.to_numpy())
        displayed = []
        display_originals = []
        empty_ids = []
        for row in raw.itertuples():
            geometry = row.geometry.intersection(mask)
            # A boundary-only contact must not create line features.
            if geometry.geom_type == "GeometryCollection":
                geometry = shapely.union_all([part for part in geometry.geoms
                                             if part.geom_type in {"Polygon", "MultiPolygon"}])
            if geometry.is_empty or geometry.area == 0:
                empty_ids.append("US_CNTY_" + row.GEOID)
                continue
            if not geometry.is_valid or geometry.geom_type not in {"Polygon", "MultiPolygon"}:
                raise ValueError(f"invalid_display_geometry: {row.GEOID}")
            displayed.append(geometry)
            display_originals.append(row.geometry)
            features.append({"type": "Feature", "id": "US_CNTY_" + row.GEOID,
                             "properties": {"id": "US_CNTY_" + row.GEOID, "GEOID": row.GEOID,
                                            "STATEFP": state, "name": str(getattr(row, "NAMELSAD", None) or getattr(row, "NAME", row.GEOID)),
                                            "cntr_code": "US", "admin1_group": STATE_NAMES[state], "detail_tier": "fine",
                                            "source_members": [row.GEOID]},
                             "geometry": mapping(geometry)})
        displayed, clip_repairs = repair_clip_overlap_from_source(displayed, display_originals)
        for feature, geometry in zip(features[-len(displayed):], displayed):
            feature["geometry"] = mapping(geometry)
        clipped_coordinates = int(sum(shapely.get_num_coordinates(g) for g in displayed))
        display_union = shapely.union_all(displayed)
        coverage_valid = bool(shapely.coverage_is_valid(displayed))
        invalid_edges = shapely.coverage_invalid_edges(displayed) if not coverage_valid else []
        if simplify_tolerance:
            if not coverage_valid:
                raise ValueError(f"simplification_requires_valid_coverage: {state}")
            simplified = list(shapely.coverage_simplify(displayed, simplify_tolerance, simplify_boundary=False))
            if (not all(g.is_valid and not g.is_empty for g in simplified)
                    or not shapely.coverage_is_valid(simplified)
                    or not shapely.union_all(simplified).equals(display_union)):
                raise ValueError(f"simplification_changed_coverage: {state}")
            for feature, geometry in zip(features[-len(displayed):], simplified):
                feature["geometry"] = mapping(geometry)
            displayed = simplified
        all_displayed.extend(displayed)
        overlap = max(0.0, sum(g.area for g in displayed) - display_union.area)
        reports.append({"statefp": state, "source_counties": len(raw), "display_counties": len(displayed),
                        "source_geoids": sorted(raw.GEOID.tolist()),
                        "display_geoids": sorted(feature["properties"]["GEOID"] for feature in features if feature["properties"]["STATEFP"] == state),
                        "empty_display_ids": empty_ids,
                        "tiger_only_geoids": sorted(set(raw.GEOID) - set(cb.GEOID)),
                        "cb_only_geoids": sorted(set(cb.GEOID) - set(raw.GEOID)),
                        "unassigned_mask_area_km2": area_km2(mask.difference(display_union)),
                        "source_outside_display_mask_km2": area_km2(source_union.difference(mask)),
                        "display_overlap_area_degrees2": overlap,
                        "geometry_invalid_count": 0,
                        "clip_overlap_repairs": clip_repairs,
                        "coverage_valid": coverage_valid,
                        "coverage_invalid_edge_count": sum(not edge.is_empty for edge in invalid_edges),
                        "clipped_coordinates": clipped_coordinates,
                        "source_coordinates": int(shapely.get_num_coordinates(raw.geometry.to_numpy()).sum()),
                        "display_coordinates": int(sum(shapely.get_num_coordinates(g) for g in displayed))})
    global_coverage_valid = bool(shapely.coverage_is_valid(all_displayed))
    global_invalid_count = (0 if global_coverage_valid else
                            sum(not e.is_empty for e in shapely.coverage_invalid_edges(all_displayed)))
    if simplify_tolerance and not global_coverage_valid:
        raise ValueError("simplification_requires_valid_cross_state_coverage")
    return {"type": "FeatureCollection", "features": features}, {
        "status": "candidate_requires_coverage_and_scenario_review",
        "crs": "EPSG:4326", "states": reports,
        "global_coverage_valid": global_coverage_valid,
        "global_coverage_invalid_edge_count": global_invalid_count,
        "source_crs": source_crs,
        "crs_policy": "GeoPandas/PROJ standard to_crs(EPSG:4326); no explicit datum grid supplied for NAD83 inputs; no sub-meter datum accuracy claim.",
        "landmask_policy": "Per-state union of all cartographic counties; preserves CB holes and coastline, not an independently verified land-only mask. TIGER internal county boundaries intersect this fixed footprint. No nearest assignment or aggregation.",
        "simplify_tolerance_degrees": simplify_tolerance,
        "simplification_policy": "Optional coverage_simplify with simplify_boundary=False; requires valid coverage and unchanged union.",
        "raw_geometry_policy": "Original TIGER geometries remain in the hashed input archive; output contains display geometries only.",
        "source_counties": len(tiger), "display_counties": len(features),
        "source_coordinates": sum(r["source_coordinates"] for r in reports),
        "clipped_coordinates": sum(r["clipped_coordinates"] for r in reports),
        "display_coordinates": sum(r["display_coordinates"] for r in reports)}


def safe_output_directory(path, root=ROOT):
    path = Path(path).resolve()
    runtime = (Path(root) / ".runtime").resolve()
    if path == runtime or not path.is_relative_to(runtime):
        raise ValueError("output_must_be_subdirectory_of_runtime")
    return path


def source_record(path, product, vintage):
    path = Path(path).resolve()
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": str(path), "product": product, "declared_vintage": vintage,
            "sha256": digest, "bytes": path.stat().st_size}


def bind_display_bytes(report, data):
    """Bind the source/coverage report to the exact serialized display artifact."""
    report["display_geojson_bytes"] = len(data)
    report["display_geojson_sha256"] = hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiger-counties", required=True)
    parser.add_argument("--cartographic-counties", required=True)
    parser.add_argument("--states", help="Comma-separated postal codes or state FIPS; default 50 states + DC")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--tiger-vintage", default="2025")
    parser.add_argument("--cartographic-vintage", default="2024")
    parser.add_argument("--simplify-tolerance", type=float, default=0.0)
    args = parser.parse_args()
    output = safe_output_directory(args.output_dir)
    if any((output / name).exists() for name in ("counties.geojson", "source-report.json")):
        raise ValueError("output_candidate_already_exists")
    states = selected_states(args.states)
    sources = [source_record(args.tiger_counties, "Census TIGER/Line county", args.tiger_vintage),
               source_record(args.cartographic_counties, "Census Cartographic Boundary county", args.cartographic_vintage)]
    collection, report = prepare_frames(gpd.read_file(args.tiger_counties),
                                        gpd.read_file(args.cartographic_counties), states, args.simplify_tolerance)
    report["sources"] = sources
    data = json.dumps(collection, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    bind_display_bytes(report, data)
    output.mkdir(parents=True, exist_ok=True)
    # Recheck in case another process populated the output during the build.
    if any((output / name).exists() for name in ("counties.geojson", "source-report.json")):
        raise ValueError("output_candidate_already_exists")
    (output / "counties.geojson").write_bytes(data)
    (output / "source-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "counties": len(collection["features"])}))


if __name__ == "__main__":
    main()
