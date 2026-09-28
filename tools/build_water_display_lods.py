"""Build a diagnostic, display-only water LOD. Never replaces source assets.

The candidate is intentionally fail-closed: topology preservation for one polygon
does not establish that independently simplified water polygons still meet, or
that the aggregate coastline still matches land. The report records both tests.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from time import perf_counter

from shapely import coverage_is_valid, hausdorff_distance
from shapely.geometry import LineString, shape, mapping
from shapely.ops import unary_union


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = REPO_ROOT / "data/scenarios/tno_1962/chunks/water.coarse.r0c0.json"
DEFAULT_OUTPUT = REPO_ROOT / ".runtime/reports/generated/water-display-lod"


def feature_id(feature):
    return str((feature.get("properties") or {}).get("id") or feature.get("id") or "")


def polygon_parts(geometry):
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if kind == "Polygon":
        return [coordinates]
    if kind == "MultiPolygon":
        return coordinates
    raise ValueError(f"Water geometry must be Polygon or MultiPolygon, got {kind}")


def rings(geometry):
    return [ring for part in polygon_parts(geometry) for ring in part]


def topology_signature(geometry):
    parts = polygon_parts(geometry)
    return len(parts), tuple(len(part) - 1 for part in parts)


def point_count(geometry):
    return sum(len(ring) for ring in rings(geometry))


def signed_area(ring):
    origin_x, origin_y = ring[0][:2]
    return math.fsum((a[0] - origin_x) * (b[1] - origin_y)
                     - (b[0] - origin_x) * (a[1] - origin_y)
                     for a, b in zip(ring, ring[1:]))


def winding_signature(geometry):
    areas = (signed_area(ring) for ring in rings(geometry))
    return tuple(math.copysign(1, area) if area else 0 for area in areas)


def ring_correspondence_preserved(source, candidate, tolerance_degrees):
    """Fail closed if Shapely reordered parts/rings before index-wise comparison."""
    if topology_signature(source) != topology_signature(candidate):
        return False
    for before, after in zip(rings(source), rings(candidate)):
        if len(before) == len(after) and all(tuple(a) == tuple(b) for a, b in zip(before, after)):
            continue
        bounds = lambda ring: (min(p[0] for p in ring), min(p[1] for p in ring),
                               max(p[0] for p in ring), max(p[1] for p in ring))
        if max(abs(a - b) for a, b in zip(bounds(before), bounds(after))) > tolerance_degrees * 2:
            return False
    return True


def equal_earth(lon_lat, scale, zoom):
    """D3 Equal Earth raw projection in CSS px, before translation/y inversion."""
    lon, lat = map(math.radians, lon_lat[:2])
    theta = math.asin(math.sqrt(3) / 2 * math.sin(lat))
    theta2 = theta * theta
    theta6 = theta2 ** 3
    a1, a2, a3, a4 = 1.340264, -0.081106, 0.000893, 0.003796
    x = lon * math.cos(theta) / (math.sqrt(3) / 2 * (a1 + 3 * a2 * theta2 + theta6 * (7 * a3 + 9 * a4 * theta2)))
    y = theta * (a1 + a2 * theta2 + theta6 * (a3 + a4 * theta2))
    return x * scale * zoom, y * scale * zoom


def projected_boundary_error(source, candidate, scale, zoom):
    """Densified polyline Hausdorff distance; not a bound on D3 clip/resample."""
    worst = 0.0
    for before, after in zip(rings(source), rings(candidate)):
        if len(before) == len(after) and all(tuple(a) == tuple(b) for a, b in zip(before, after)):
            continue
        first = LineString([equal_earth(point, scale, zoom) for point in before])
        second = LineString([equal_earth(point, scale, zoom) for point in after])
        worst = max(worst, float(hausdorff_distance(first, second, densify=0.1)))
    return worst


def build_candidate(payload, *, tolerance_degrees=0.01, scale=210, zoom=2,
                    max_error_css_px=0.25):
    if any(not math.isfinite(v) or v <= 0 for v in (tolerance_degrees, scale, zoom, max_error_css_px)):
        raise ValueError("Tolerance, projection scale, zoom, and pixel budget must be positive and finite")
    features = payload.get("features")
    if payload.get("type") != "FeatureCollection" or not isinstance(features, list) or not features:
        raise ValueError("Expected a nonempty FeatureCollection")
    ids = [feature_id(feature) for feature in features]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError("Water features require distinct nonempty IDs")

    started = perf_counter()
    originals = [shape(feature["geometry"]) for feature in features]
    if any(geometry.is_empty or not geometry.is_valid for geometry in originals):
        raise ValueError("Source water includes empty or invalid geometry")
    candidates = [geometry.simplify(tolerance_degrees, preserve_topology=True) for geometry in originals]
    result = {**payload, "features": [
        {**feature, "geometry": mapping(candidate)}
        for feature, candidate in zip(features, candidates)
    ]}
    input_points = sum(point_count(feature["geometry"]) for feature in features)
    output_points = sum(point_count(feature["geometry"]) for feature in result["features"])

    topology_ok = all(topology_signature(before["geometry"]) == topology_signature(after["geometry"])
                      for before, after in zip(features, result["features"]))
    ring_correspondence_ok = all(ring_correspondence_preserved(before["geometry"], after["geometry"], tolerance_degrees)
                                 for before, after in zip(features, result["features"]))
    winding_mismatch_ids = [feature_id(before) for before, after in zip(features, result["features"])
                            if winding_signature(before["geometry"]) != winding_signature(after["geometry"])]
    winding_ok = not winding_mismatch_ids
    candidate_valid = all(not geometry.is_empty and geometry.is_valid for geometry in candidates)
    errors_by_feature = sorted((projected_boundary_error(before["geometry"], after["geometry"], scale, zoom),
                                feature_id(before)) for before, after in zip(features, result["features"])) if ring_correspondence_ok else []
    max_error = errors_by_feature[-1][0] if errors_by_feature else None

    # Exact union equality is the cross-layer guard: unchanged land geometry
    # then sees exactly the same aggregate water footprint and holes.
    source_union = unary_union(originals)
    candidate_union = unary_union(candidates)
    union_equal = bool(source_union.equals(candidate_union))
    source_coverage_valid = bool(coverage_is_valid(originals))
    candidate_coverage_valid = bool(coverage_is_valid(candidates))
    checks = {
        "ids_preserved": [feature_id(feature) for feature in result["features"]] == ids,
        "part_and_hole_counts_preserved": topology_ok,
        "ring_correspondence_preserved": ring_correspondence_ok,
        "winding_preserved": winding_ok,
        "candidate_geometries_valid": candidate_valid,
        "projected_boundary_within_budget": max_error is not None and max_error <= max_error_css_px,
        "aggregate_water_footprint_exact": union_equal,
        "source_water_coverage_valid": source_coverage_valid,
        "candidate_water_coverage_valid": candidate_coverage_valid,
    }
    # Baseline-invalid coverage cannot prove that a changed internal water/water
    # edge introduces no new gaps or overlaps. Do not waive this on TNO.
    candidate_passes = all(checks.values()) and output_points < input_points
    report = {
        "candidate_status": "PASS" if candidate_passes else "NO-GO",
        "adoption_status": "NOT_EVALUATED" if candidate_passes else "NO-GO",
        "purpose": "display-only diagnostic; never use for editing or authoritative geometry",
        "feature_count": len(features), "input_points": input_points,
        "output_points": output_points,
        "point_reduction_fraction": round(1 - output_points / input_points, 6),
        "tolerance_degrees": tolerance_degrees,
        "projection": {"name": "EqualEarth", "scale": scale, "zoom": zoom},
        "max_error_css_px": max_error_css_px,
        "measured_unclipped_projected_polyline_hausdorff_css_px": max_error,
        "worst_boundary_features": [
            {"id": feature_id, "error_css_px": round(error, 6)}
            for error, feature_id in reversed(errors_by_feature[-5:])
        ],
        "winding_mismatch_count": len(winding_mismatch_ids),
        "winding_mismatch_sample_ids": winding_mismatch_ids[:10],
        "screen_error_scope": "densified projected polygon polylines only; D3 antimeridian clipping, great-circle interpolation, and adaptive resampling unverified; this is not a final visible-pixel bound",
        "checks": checks, "build_seconds": round(perf_counter() - started, 3),
    }
    return result, report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--tolerance-degrees", type=float, default=0.01)
    parser.add_argument("--scale", type=float, default=210)
    parser.add_argument("--zoom", type=float, default=2)
    parser.add_argument("--max-error-css-px", type=float, default=0.25)
    args = parser.parse_args(argv)
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    candidate, report = build_candidate(payload, tolerance_degrees=args.tolerance_degrees,
        scale=args.scale, zoom=args.zoom, max_error_css_px=args.max_error_css_px)
    report["source"] = str(args.input.resolve())
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "water.display-candidate.geojson").write_text(
        json.dumps(candidate, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (args.output_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
