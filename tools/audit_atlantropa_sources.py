"""Read-only, region-bounded HGO source inventory for TNO Atlantropa.

This is a candidate index, not an adoption decision. Run from the repository root:
python tools/audit_atlantropa_sources.py --output-dir .runtime/tmp/atlantropa-expansion-20260926/inventory
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely.geometry import box

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import patch_tno_1962_bundle as builder


DEFAULT_BASELINE = ROOT / "data/scenarios/tno_1962"
DEFAULT_OUTPUT = ROOT / ".runtime/tmp/atlantropa-expansion-20260926/inventory"
ADJACENCY_DEGREES = 0.35
BLACK_SEA_SOURCE_STATE_IDS = [8444, 8630, *range(8632, 8645)]


def attribution_ids(properties: dict, singular: str, plural: str) -> set[int]:
    """Read both published scalar and list lineage without counting nulls."""
    values = properties.get(plural) or []
    if not isinstance(values, (list, tuple, set)):
        values = [values]
    values = [*values, properties.get(singular)]
    result = set()
    for value in values:
        try:
            if value is not None and str(value).strip():
                result.add(int(value))
        except (TypeError, ValueError):
            pass
    return result


def current_attribution_index(topology: dict) -> tuple[dict[int, set[str]], dict[int, set[str]], dict[int, set[str]]]:
    by_province: dict[int, set[str]] = defaultdict(set)
    by_state: dict[int, set[str]] = defaultdict(set)
    land_by_province: dict[int, set[str]] = defaultdict(set)
    for feature in topology["objects"]["scenario_atlantropa"]["geometries"]:
        props = feature.get("properties") or {}
        feature_id = str(props.get("id") or "")
        for province_id in attribution_ids(props, "donor_province_id", "donor_province_ids"):
            by_province[province_id].add(feature_id)
            if props.get("atl_render_layer") == "land":
                land_by_province[province_id].add(feature_id)
        for state_id in attribution_ids(props, "donor_state_id", "donor_state_ids"):
            by_state[state_id].add(feature_id)
    return by_province, by_state, land_by_province


def anchor_coefficients_by_province(config: dict, island_coeffs: dict[int, tuple[float, ...]]) -> dict[int, tuple[float, ...]]:
    """Give original unnamed island provinces the alignment of their anchor."""
    result = {}
    for group in config.get("major_island_groups", []):
        for anchor in group.get("source_island_anchors", []):
            anchor_states = list(map(int, anchor.get("donor_state_ids", [])))
            if not anchor_states:
                continue
            coefficient = island_coeffs[anchor_states[0]]
            for province_id in anchor.get("source_province_ids", []):
                result[int(province_id)] = coefficient
    return result


def province_projection(province_id: int, state_ids: list[int], region_coeffs: tuple[float, ...],
                        island_coeffs: dict[int, tuple[float, ...]],
                        anchor_coeffs: dict[int, tuple[float, ...]]) -> tuple[tuple[float, ...], str]:
    if province_id in anchor_coeffs:
        return anchor_coeffs[province_id], "source_island_anchor"
    for state_id in state_ids:
        if state_id in island_coeffs:
            return island_coeffs[state_id], "source_island_anchor"
    return region_coeffs, "region_affine"


def inverse_aoi_pixel_keys(context: dict, coeffs: tuple[float, ...], bbox: tuple[float, ...],
                           margin: float = ADJACENCY_DEGREES) -> tuple[set[int], set[int], dict]:
    """Inspect only a raster window that encloses the inverse-projected AOI."""
    ax, bx, cx, ay, by, cy = coeffs
    matrix = np.array([[ax, bx], [ay, by]], dtype=float)
    if abs(float(np.linalg.det(matrix))) < 1e-12:
        raise ValueError("Region affine is singular")
    inverse = np.linalg.inv(matrix)
    minx, miny, maxx, maxy = bbox
    corners = np.array([(x, y) for x in (minx - margin, maxx + margin)
                        for y in (miny - margin, maxy + margin)], dtype=float)
    raw = (corners - np.array([cx, cy])) @ inverse.T
    image = context["key_image"]
    height, width = image.shape
    transform = context["raw_transform"]
    x0 = max(0, int(np.floor((raw[:, 0].min() - transform.c) / transform.a)) - 1)
    x1 = min(width, int(np.ceil((raw[:, 0].max() - transform.c) / transform.a)) + 2)
    y0 = max(0, int(np.floor((raw[:, 1].max() - transform.f) / transform.e)) - 1)
    y1 = min(height, int(np.ceil((raw[:, 1].min() - transform.f) / transform.e)) + 2)
    if x0 >= x1 or y0 >= y1:
        return set(), set(), {"pixel_window": [x0, y0, x1, y1], "pixel_count": 0}
    yy, xx = np.mgrid[y0:y1, x0:x1]
    raw_x = transform.c + (xx + 0.5) * transform.a
    raw_y = transform.f + (yy + 0.5) * transform.e
    lon = ax * raw_x + bx * raw_y + cx
    lat = ay * raw_x + by * raw_y + cy
    inside = (lon >= minx) & (lon <= maxx) & (lat >= miny) & (lat <= maxy)
    near = (lon >= minx - margin) & (lon <= maxx + margin) & (lat >= miny - margin) & (lat <= maxy + margin)
    keys = image[y0:y1, x0:x1]
    return (set(map(int, np.unique(keys[inside]))), set(map(int, np.unique(keys[near]))),
            {"pixel_window": [x0, y0, x1, y1], "pixel_count": int(near.sum())})


def classify_candidate(*, configured_role: str | None, spatial_relation: str,
                       province_feature_ids: set[str], source_geom, baseline_land,
                       current_land) -> tuple[str, dict]:
    if configured_role == "excluded":
        return "explicitly_excluded", {}
    if province_feature_ids:
        return "represented", {}
    if spatial_relation == "outside_aoi":
        return "outside_aoi", {}
    if source_geom is None or source_geom.is_empty:
        return "unresolved", {"reason": "no_projected_source_geometry"}
    area = float(source_geom.area)
    if area <= 0:
        return "unresolved", {"reason": "empty_projected_source_geometry"}
    baseline_remainder = source_geom.difference(baseline_land)
    current_remainder = baseline_remainder.difference(current_land)
    baseline_residual = float(baseline_remainder.area)
    combined_residual = float(current_remainder.area)
    tolerance = max(1e-10, area * 1e-6)
    evidence = {"source_area_deg2": round(area, 10),
                "baseline_uncovered_area_deg2": round(baseline_residual, 10),
                "current_surface_uncovered_area_deg2": round(combined_residual, 10),
                "coverage_tolerance_deg2": tolerance}
    if baseline_residual <= tolerance:
        return "baseline_covered", evidence
    if combined_residual <= tolerance:
        return "covered_by_current_surface", evidence
    return "unresolved", evidence


def build_inventory(context: dict, baseline_dir: Path) -> dict:
    topology = builder.load_json(baseline_dir / "runtime_topology.topo.json")
    by_province, by_state, land_by_province = current_attribution_index(topology)
    # The frozen scenario political layer has retired original island IDs.
    # Use the same global source as the builder for island anchors and the
    # pre-Atlantropa shoreline reference.
    political = builder.load_runtime_political_gdf()
    baseline_land = builder.load_atlantropa_land_reference(political)
    atl = builder.topology_object_to_gdf(topology, "scenario_atlantropa")
    atl = atl.loc[atl["atl_render_layer"] == "land"]
    current_land = builder.safe_unary_union(atl.geometry.tolist())
    if current_land is None:
        raise ValueError("Frozen baseline has no Atlantropa land surface")

    province_states: dict[int, set[int]] = defaultdict(set)
    for state_id in sorted(context["state_path_index"]):
        for province_id in builder.get_state_province_ids(context, state_id):
            province_states[province_id].add(state_id)
    regions = []
    for region_id, config in builder.ATLANTROPA_REGION_CONFIGS.items():
        coeffs, controls = builder.build_region_affine_coeffs(config, context)
        inside_keys, near_keys, scan = inverse_aoi_pixel_keys(context, coeffs, config["aoi_bbox"])
        key_to_id = context["rgb_key_to_id"]
        inside_ids = {key_to_id[key] for key in inside_keys if key in key_to_id}
        near_ids = {key_to_id[key] for key in near_keys if key in key_to_id}
        spatial_near_ids = set(near_ids)
        island_coeffs, _ = builder.prepare_source_aligned_island_groups(config, context, political)
        anchor_coeff_by_province = anchor_coefficients_by_province(config, island_coeffs)
        configured_land = set(map(int, config.get("land_state_ids", [])))
        configured_water = set(map(int, config.get("water_state_ids", [])))
        configured_excluded = set(map(int, config.get("causeway_drop_state_ids", [])))
        for state_id in configured_land | configured_water | configured_excluded:
            near_ids.update(builder.get_state_province_ids(context, state_id))
        # Anchored islands can have a separate source alignment; retain their
        # IDs even if the general region fit places them outside its AOI.
        anchored = set()
        for group in config.get("major_island_groups", []):
            for anchor in group.get("source_island_anchors", []):
                anchored.update(map(int, anchor.get("source_province_ids", [])))
        near_ids.update(anchored)
        rows = []
        aoi = box(*config["aoi_bbox"])
        for province_id in sorted(near_ids):
            states = sorted(province_states.get(province_id, set()))
            role = ("excluded" if any(s in configured_excluded for s in states)
                    else "land" if any(s in configured_land for s in states)
                    else "water" if any(s in configured_water for s in states) else None)
            relation = ("inside_aoi" if province_id in inside_ids else
                        "adjacent" if province_id in spatial_near_ids else
                        "anchor_or_configured_only")
            source_geom = None
            geometry_error = None
            projection, alignment = province_projection(
                province_id, states, coeffs, island_coeffs, anchor_coeff_by_province)
            direct_features = (by_province if role == "water" else land_by_province).get(province_id, set())
            geometry_needed = (not direct_features and role != "excluded" and
                               (bool(states) or context["province_type_by_id"].get(province_id) == "land"))
            if geometry_needed:
                try:
                    raw_geom = builder.extract_province_geometry_raw(context, province_id)
                    projected = builder.apply_affine_to_geometry(raw_geom, projection)
                    source_geom = projected.intersection(aoi) if projected is not None else None
                    if source_geom is None or source_geom.is_empty:
                        relation = "outside_aoi"
                    elif alignment == "source_island_anchor":
                        relation = "source_aligned_island"
                except (KeyError, ValueError) as exc:
                    geometry_error = str(exc)
            status, evidence = classify_candidate(
                configured_role=role, spatial_relation=relation,
                province_feature_ids=direct_features,
                source_geom=source_geom, baseline_land=baseline_land, current_land=current_land)
            if geometry_error:
                evidence["geometry_error"] = geometry_error
            if not geometry_needed and not direct_features and role != "excluded":
                evidence["reason"] = "unassigned_water_province_retained_for_review"
            rows.append({"province_id": province_id, "province_type": context["province_type_by_id"].get(province_id),
                         "state_ids": states, "state_names": [builder.get_state_name(context, s) for s in states],
                         "configured_role": role or "spatial_candidate", "spatial_relation": relation,
                         "alignment": alignment,
                         "current_feature_ids": sorted(by_province.get(province_id, set())),
                         "current_land_feature_ids": sorted(land_by_province.get(province_id, set())),
                         "state_attribution_feature_ids": sorted(set().union(*(by_state.get(s, set()) for s in states))),
                         "classification": status, **evidence})
        regions.append({"region_id": region_id, "aoi_bbox": list(config["aoi_bbox"]),
                        "adjacency_degrees": ADJACENCY_DEGREES, "affine_coeffs": list(coeffs),
                        "control_count": len(controls), "scan": scan, "candidates": rows})
    black_sea = [{"state_id": state_id, "state_name": builder.get_state_name(context, state_id),
                  "exists": state_id in context["state_path_index"],
                  "province_ids": builder.get_state_province_ids(context, state_id)
                  if state_id in context["state_path_index"] else []}
                 for state_id in BLACK_SEA_SOURCE_STATE_IDS]
    return {"version": 1, "source_root": str(context["root"]), "baseline_dir": str(baseline_dir),
            "interpretation": "Candidate inventory only; absent feature IDs do not prove missing land. "
                              "Donor water type is not an automatic exclusion from reclaimed land.",
            "baseline_reference": "canonical physical land plus original global runtime political geometries, as in builder; no scenario ATL surface",
            "regions": regions,
            "full_black_sea": {"status": "not_georeferenced_not_spatially_scanned",
                               "note": "Eight configured AOIs reach only the Black Sea mouth. This is a non-spatial source index; state 8631 is ordinary and intentionally omitted.",
                               "source_states": black_sea}}


def write_inventory(payload: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "source_inventory.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["Atlantropa HGO source candidates (read-only)", payload["interpretation"],
             f"Baseline: {payload['baseline_dir']}", ""]
    for region in payload["regions"]:
        rows = region["candidates"]
        counts = {status: sum(row["classification"] == status for row in rows)
                  for status in sorted({row["classification"] for row in rows})}
        lines.append(f"{region['region_id']} AOI {region['aoi_bbox']} | {len(rows)} provinces | {counts}")
        for row in rows:
            if row["classification"] in {"represented", "baseline_covered"}:
                continue
            lines.append(f"  {row['classification']:27} province {row['province_id']:>6} "
                         f"state {','.join(map(str, row['state_ids'])) or '?':12} "
                         f"{row['spatial_relation']:12} {row['configured_role']:17} "
                         f"{','.join(row['state_names'])[:60]}")
        lines.append("")
    black = payload["full_black_sea"]
    lines.append(f"full_black_sea: {black['status']} — {black['note']}")
    lines.append("Source state index: " + ", ".join(str(row["state_id"]) for row in black["source_states"]))
    (output_dir / "source_inventory.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-dir", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--hgo-root", type=Path)
    args = parser.parse_args()
    root = args.hgo_root or builder.resolve_hgo_root()
    payload = build_inventory(builder.load_hgo_context(root), args.baseline_dir)
    write_inventory(payload, args.output_dir)
    print(f"Wrote {args.output_dir / 'source_inventory.json'} and source_inventory.txt")


if __name__ == "__main__":
    main()
