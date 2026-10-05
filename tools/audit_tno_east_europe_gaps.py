"""Read-only, windowed land-coverage diagnostics; never infer a gap's recipient."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import shapely
from pyproj import CRS, Transformer
from shapely.geometry import box, mapping
from shapely.ops import transform

from map_builder.coverage_validation import coverage_is_valid_exact
from map_builder.geo.measurement import densify_for_measurement
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import _absolute_topology, _decode_geometry


MEASUREMENT_SEGMENT_LENGTH_DEGREES = 0.001


def polygon_parts(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        yield geometry
    elif hasattr(geometry, "geoms"):
        for part in geometry.geoms:
            yield from polygon_parts(part)


def require_valid(geometry, label):
    if geometry is None or geometry.is_empty or not geometry.is_valid:
        reason = "missing/empty" if geometry is None else shapely.is_valid_reason(geometry)
        raise ValueError(f"Invalid {label}: {reason}")


def is_shell_helper(fid, row):
    """Match isScenarioShellFeature in political_feature_policy.js."""
    return (str(row.get("scenario_helper_kind") or "").strip().lower() == "shell_fallback"
            or str(fid).strip().upper().startswith("RU_ARCTIC_FB_")
            or "shell fallback" in str(row.get("name") or "").lower())


def metrics(geometry, *, max_segment_length_degrees=MEASUREMENT_SEGMENT_LENGTH_DEGREES):
    """Measure straight lon/lat edges using a densified projection-only copy."""
    point = geometry.representative_point()
    west, south, east, north = geometry.bounds
    lon, lat = (west + east) / 2, (south + north) / 2
    projection = CRS.from_proj4(f"+proj=laea +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m")
    project = Transformer.from_crs(4326, projection, always_xy=True).transform
    metric = transform(project, densify_for_measurement(geometry, max_segment_length_degrees))
    collapsed = metric.is_empty
    width = None if collapsed or not metric.is_valid else float(2 * shapely.maximum_inscribed_circle(metric, tolerance=1).length)
    measurement = {"area_km2": float(metric.area / 1e6),
            "maximum_inscribed_diameter_m": width,
            "width_tolerance_m": 1, "bounds": list(geometry.bounds),
            "representative_point": [point.x, point.y],
            "area_method": "laea_densified_linear_lonlat_edges",
            "measurement_max_segment_length_degrees": max_segment_length_degrees,
            "measurement_projection_center": [lon, lat],
            "densification_scope": "measurement_only",
            "densification_method": "linear_original_vertices_preserved",
            "measurement_valid": bool(metric.is_valid),
            "measurement_collapsed": collapsed}
    if collapsed:
        measurement["source_area_degrees2"] = float(geometry.area)
    return measurement


def load_window(path, bounds, *, surfaces=True):
    """Decode actual runtime coordinates without repair, rounding or buffering."""
    topology = _absolute_topology(json.loads(Path(path).read_text(encoding="utf-8")))
    extent = box(*bounds)
    rows = {}
    for row in topology["objects"]["political"]["geometries"]:
        geometry = _decode_geometry(topology, row)
        props = row["properties"]
        fid = str(props["id"])
        if geometry is None:
            raise ValueError(f"Missing political geometry: {fid}")
        if geometry.is_empty or not geometry.envelope.intersects(extent):
            if geometry.is_empty:
                raise ValueError(f"Empty political geometry: {fid}")
            continue
        require_valid(geometry, fid)
        if not geometry.intersects(extent):
            continue
        if fid in rows:
            raise ValueError(f"Duplicate political ID: {fid}")
        rows[fid] = {"geometry": geometry, "country": props.get("cntr_code", ""),
                     "name": props.get("name", ""),
                     "interactive": props.get("interactive"),
                     "scenario_helper_kind": props.get("scenario_helper_kind", ""),
                     "scenario_shell_owner_hint": props.get("scenario_shell_owner_hint"),
                     "scenario_shell_controller_hint": props.get("scenario_shell_controller_hint")}
    if not surfaces:
        return rows, None
    decoded = {}
    for name in ("land_mask", "scenario_water", "scenario_atlantropa"):
        geometry = _decode_geometry(topology, topology["objects"][name])
        # Empty water overlays are legitimate; invalid overlays are not.
        if geometry is None or not geometry.is_valid:
            raise ValueError(f"Invalid surface: {name}")
        decoded[name] = geometry.intersection(extent)
    allowed = decoded["land_mask"].difference(shapely.union_all([
        decoded["scenario_water"], decoded["scenario_atlantropa"]]))
    return rows, allowed


def audit(rows, allowed, bounds, *, reference=None, min_area_km2=0.001,
          include_geometry=False):
    """A positive land gap is evidence of missing coverage, not permission to fill.

    Reference geometry may be detail or an explicitly assembled mixed-LOD frame.
    A difference proves geometry changed, but cannot identify the responsible
    renderer state without runtime evidence. Clipped window edges are censored.
    """
    if min_area_km2 < 0:
        raise ValueError("Minimum area must be nonnegative")
    extent = box(*bounds)
    require_valid(extent, "extent")
    if allowed is None or not allowed.is_valid:
        raise ValueError("Invalid allowed land surface")
    ids = sorted(rows)
    geometries = [rows[fid]["geometry"] for fid in ids]
    for fid, geometry in zip(ids, geometries):
        require_valid(geometry, fid)
        if geometry.geom_type not in {"Polygon", "MultiPolygon"}:
            raise ValueError(f"Nonpolygon political geometry: {fid}")
    tree = shapely.STRtree(geometries)
    occupied = shapely.union_all(geometries)
    # Clipping creates artificial surface edges. Diagnose only actual allowed
    # surface edges here; window contact is reported separately below.
    surface_boundary = allowed.boundary.difference(extent.boundary)
    # Exact overlay may leave a few floating-point ULPs of line contact. This
    # threshold only interprets the diagnostic; it never changes coordinates.
    contact_tolerance = 64 * math.ulp(max(1.0, *(abs(v) for v in bounds)))
    local_geometries = [shapely.union_all(list(polygon_parts(g.intersection(extent))))
                        for g in geometries]
    reference_union = None
    if reference is not None:
        if set(reference) != set(rows):
            raise ValueError("Comparison requires identical political IDs in the window")
        for fid, row in reference.items():
            require_valid(row["geometry"], f"reference {fid}")
        reference_union = shapely.union_all([row["geometry"] for row in reference.values()])
    findings = []
    collapsed_gap_measurements = []
    for gap in polygon_parts(allowed.intersection(extent).difference(occupied)):
        measurement = metrics(gap)
        if measurement["measurement_collapsed"]:
            collapsed_gap_measurements.append({**measurement,
                **({"geometry": mapping(gap)} if include_geometry else {})})
        if measurement["area_km2"] < min_area_km2:
            continue
        contacts = [ids[int(i)] for i in tree.query(gap, predicate="intersects")
                    if gap.boundary.intersection(geometries[int(i)].boundary).length > 0]
        contacts.sort()
        countries = sorted({rows[fid]["country"] for fid in contacts})
        helper_ids = [fid for fid in contacts if is_shell_helper(fid, rows[fid])]
        interactive_ids = [fid for fid in contacts
                           if fid not in helper_ids and rows[fid].get("interactive") is not False]
        contact_role = ("no_political_contact" if not contacts else
                        "helper_only" if len(helper_ids) == len(contacts) and not interactive_ids else
                        "interactive_and_helper" if interactive_ids and helper_ids else
                        "interactive_only" if len(interactive_ids) == len(contacts) else
                        "noninteractive_only" if not interactive_ids else "mixed_interactivity")
        surface_contact = gap.boundary.intersection(surface_boundary)
        surface_contact_length = float(surface_contact.length)
        touches_surface = surface_contact_length > contact_tolerance
        surface_contact_kind = ("linear" if touches_surface else
                                "numerical_line_contact" if surface_contact_length > 0 else
                                "point_contact" if not surface_contact.is_empty else "none")
        window_censored = gap.intersects(extent.boundary)
        triage = ("window_censored" if window_censored else
                  "surface_boundary_difference" if touches_surface else
                  "helper_boundary_gap" if contact_role == "helper_only" else
                  "enclosed_political_gap" if interactive_ids else
                  "noninteractive_boundary_gap" if contacts else "no_political_contact")
        classification = "real_polygon_coverage_gap"
        reference_fraction = None
        if reference_union is not None:
            intersection = gap.intersection(reference_union)
            reference_fraction = float(intersection.area / gap.area)
            if reference_fraction >= 1 - 1e-9:
                classification = "lod_or_simplification_difference"
            elif reference_fraction > 1e-9:
                classification = "partially_reference_covered_gap"
        finding = {"classification": classification, "feature_ids": contacts,
                   "countries": countries, "internal_country": len(countries) == 1 and len(contacts) >= 2,
                   "triage_category": triage,
                   "interactive_feature_ids": interactive_ids,
                   "helper_feature_ids": helper_ids,
                   "political_contact_role": contact_role,
                   "helper_contacts": [{"feature_id": fid,
                       "name": rows[fid].get("name", ""),
                       "scenario_helper_kind": rows[fid].get("scenario_helper_kind", ""),
                       "interactive_property": rows[fid].get("interactive"),
                       "scenario_shell_owner_hint": rows[fid].get("scenario_shell_owner_hint"),
                       "scenario_shell_controller_hint": rows[fid].get("scenario_shell_controller_hint")}
                       for fid in helper_ids],
                   "contact_kind": ("cross_country" if len(countries) > 1 else
                                    "intra_country_seam" if len(contacts) >= 2 else
                                    "single_feature_boundary" if contacts else "no_political_contact"),
                   "touches_window_edge": window_censored,
                   "window_censored": window_censored,
                   "touches_allowed_surface_boundary": touches_surface,
                   "allowed_surface_boundary_contact_kind": surface_contact_kind,
                   "allowed_surface_boundary_contact_length_degrees": surface_contact_length,
                   "surface_boundary_review_required": touches_surface,
                   "reference_covered_fraction_planar": reference_fraction,
                   "suggested_action": "Review source geometry, true water exclusions and authoritative ownership for the stable feature IDs before considering a repair.",
                   **measurement}
        if classification == "lod_or_simplification_difference":
            finding["suggested_action"] = "Compare detail/coarse and actual mixed-owner frame; retain shared boundary anchors before regenerating LOD assets."
        elif classification == "partially_reference_covered_gap":
            finding["suggested_action"] = "Separate the reference-covered LOD difference from the remaining real gap before assigning any recipient."
        if window_censored:
            finding["suggested_action"] += " Expand the window to establish the full gap boundary."
        if touches_surface:
            finding["suggested_action"] += " Review coastline/mask differences and real water boundaries; surface contact does not establish missing political land."
        if helper_ids:
            finding["suggested_action"] += " Helper properties and shell hints are diagnostic evidence only, not a repair recipient."
        if include_geometry:
            finding["geometry"] = mapping(gap)
        findings.append(finding)
    edge_findings = []
    for i, geometry in enumerate(geometries):
        for raw_j in tree.query(geometry, predicate="intersects"):
            j = int(raw_j)
            if j <= i:
                continue
            shared = geometry.intersection(geometries[j]).intersection(extent)
            if shared.is_empty:
                continue
            if local_geometries[i].is_empty or local_geometries[j].is_empty:
                continue
            if not coverage_is_valid_exact([local_geometries[i], local_geometries[j]]):
                overlap_measurements = []
                for part in polygon_parts(shared):
                    measurement = metrics(part)
                    if measurement["measurement_collapsed"] and include_geometry:
                        measurement["geometry"] = mapping(part)
                    overlap_measurements.append(measurement)
                edge_findings.append({"classification": "adjacent_edge_mismatch",
                    "feature_ids": [ids[i], ids[j]],
                    "overlap_area_km2": sum(m["area_km2"] for m in overlap_measurements),
                    "collapsed_overlap_measurements": [m for m in overlap_measurements if m["measurement_collapsed"]],
                    "suggested_action": "Inspect overlap or unmatched input vertices; rebuild joint shared coverage without independent snapping."})
    findings.sort(key=lambda row: (-row["area_km2"], row["feature_ids"]))
    return {"schema_version": 1, "bounds": list(bounds), "feature_count": len(rows),
            "coverage_valid_exact": coverage_is_valid_exact([g for g in local_geometries if not g.is_empty]),
            "coverage_check_scope": "political polygons clipped to the audit window",
            "gap_minimum_area_km2": min_area_km2, "gaps": findings,
            "edge_findings": edge_findings,
            "collapsed_gap_measurements": collapsed_gap_measurements,
            "classification_counts": dict(Counter(f["classification"] for f in findings + edge_findings)),
            "diagnostic_counts": {
                "triage_category": dict(Counter(f["triage_category"] for f in findings)),
                "political_contact_role": dict(Counter(f["political_contact_role"] for f in findings)),
                "allowed_surface_boundary_contact_kind": dict(Counter(
                    f["allowed_surface_boundary_contact_kind"] for f in findings)),
                "measurement_collapsed": {"gap_components": len(collapsed_gap_measurements),
                    "overlap_components": sum(len(f["collapsed_overlap_measurements"]) for f in edge_findings)},
                "window_censored": sum(f["window_censored"] for f in findings),
                "surface_boundary_review_required": sum(f["surface_boundary_review_required"] for f in findings)},
            "surface_boundary_contact_tolerance_degrees": contact_tolerance,
            "rendering_assessment": "unconfirmed_requires_same_extent_browser_capture",
            "limitations": ["Window-edge gaps are censored, not enclosed repair candidates.",
                "Allowed land is the runtime land mask minus water/Atlantropa; source intent still requires review.",
                "Legacy gap classification describes the geometric subtraction, not a confirmed repair candidate; triage categories are separate diagnostics.",
                "Surface contacts exclude artificial window edges and require linear contact above the reported numerical tolerance; no buffering or snapping is used.",
                "Countries/internal_country/contact_kind use cntr_code, not TNO ownership. No owner sidecars are read or repair recipients inferred.",
                "Shell helpers match renderer shell_fallback kind, RU_ARCTIC_FB_ prefix or legacy shell fallback name and are excluded from interactive contacts even if the raw interactive property is true or absent. Ordinary old rows remain interactive unless explicitly false. Shell hints are not authoritative ownership.",
                "Absence of reported gaps does not prove absence below the area threshold or a renderer hairline.",
                "Area and width use a measurement-only copy preserving every original vertex and linearly densifying lon/lat edges to 0.001 degrees before bbox-centered LAEA projection; raw gap geometry is unchanged. Numerically invalid measurement copies retain ring-integrated area but expose measurement_valid=false and leave width unmeasured.",
                "An empty measurement copy is flagged as collapsed: area 0 is an unresolved accumulation placeholder, not zero source area; width null is unmeasured, not zero width. Original area/bounds and optional geometry are retained even for gaps below the area filter. Edge diagnostics remain reported, and overlap sums omit unresolved positive area through the explicit zero placeholder.",
                "Width is maximum inscribed diameter in a local equal-area projection; it is approximate."],
            "canonical_modified": False}


def checked_runtime_output(path):
    output = Path(path).resolve()
    runtime_root = (ROOT / ".runtime").resolve()
    if output.exists() or output == runtime_root or not output.is_relative_to(runtime_root):
        raise ValueError("output_must_be_new_and_inside_repository_runtime")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topology", type=Path, default=ROOT / "data/scenarios/tno_1962/runtime_topology.topo.json")
    parser.add_argument("--bounds", type=float, nargs=4, required=True, metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--reference-topology", type=Path)
    parser.add_argument("--min-area-km2", type=float, default=0.001)
    parser.add_argument("--include-geometry", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    west, south, east, north = args.bounds
    if not (-180 <= west < east <= 180 and -90 < south < north < 90):
        parser.error("Bounds must be ordered longitude/latitude and cannot cross the antimeridian")
    output = checked_runtime_output(args.output)
    rows, allowed = load_window(args.topology, args.bounds)
    reference = load_window(args.reference_topology, args.bounds, surfaces=False)[0] if args.reference_topology else None
    report = audit(rows, allowed, args.bounds, reference=reference,
                   min_area_km2=args.min_area_km2, include_geometry=args.include_geometry)
    report["topology"] = str(args.topology)
    report["reference_topology"] = str(args.reference_topology) if args.reference_topology else None
    write_json_atomic(output, report, indent=2, ensure_ascii=False, allow_nan=False)
    print(json.dumps({"output": str(output), "feature_count": report["feature_count"],
                      "classification_counts": report["classification_counts"]}))


if __name__ == "__main__":
    main()
