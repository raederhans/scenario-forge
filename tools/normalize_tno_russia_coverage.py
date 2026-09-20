"""Resolve duplicate surfaces without reallocating exclusive scenario territory."""
from map_builder.coverage_validation import coverage_is_valid_exact
import pyproj
import json
import shapely
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union, polygonize, transform
from shapely.strtree import STRtree

def normalize_baseline_overlaps(
    baseline: dict[str, shapely.Geometry],
    sources: dict[str, shapely.Geometry],
    parents: dict[str, str],
    *,
    protected: dict[str, shapely.Geometry] | None = None
) -> tuple[dict[str, shapely.Geometry], dict]:
    """
    Normalize overlaps in baseline coverage using source geometries.
    """
    diagnostics = {
        "tiny_resolutions": [],
        "gap_resolutions": [],
        "source_resolutions": [],
        "protected_losses": [],
        "errors": []
    }

    if not baseline or set(parents) != set(baseline):
        raise ValueError('Nonempty baseline and exact parent keys are required')
    if any(p not in sources for p in parents.values()):
        raise ValueError('Unresolved source parent')
    # Validate before overlay so malformed inputs cannot be partially accepted.
    for k, v in baseline.items():
        if not v.is_valid or v.is_empty or v.geom_type not in {'Polygon', 'MultiPolygon'}:
            raise ValueError(f"Invalid or empty baseline geometry for {k}")
        if k not in parents:
            raise ValueError(f"Baseline {k} missing from parents dictionary")

    for k, v in sources.items():
        if not v.is_valid or v.is_empty or v.geom_type not in {'Polygon', 'MultiPolygon'}:
            raise ValueError(f"Invalid or empty source geometry for {k}")

    protected_union = unary_union(list(protected.values())) if protected else Polygon()
    if not protected_union.is_valid:
        raise ValueError("Invalid protected geometry union")

    # Subtract protected from baselines
    baselines_mod = {}
    for k, v in baseline.items():
        diff = v.difference(protected_union)

        # 7. Record protected losses
        loss_area = v.area - diff.area
        if loss_area > 0:
            diagnostics["protected_losses"].append({"id": k, "loss_area": loss_area})

        # 2. No silently dropping protected-erased or union-empty IDs
        if diff.is_empty:
            raise ValueError(f"Baseline {k} completely erased by protected regions")
        baselines_mod[k] = diff

    geom_list = list(baselines_mod.values())
    keys = list(baselines_mod.keys())
    tree = STRtree(geom_list)

    # Find overlapping areas among baselines
    overlap_geoms = []
    for i, geom in enumerate(geom_list):
        hits = tree.query(geom, predicate="intersects")
        for j in hits:
            if i < j:
                inter = geom.intersection(geom_list[j])
                if not inter.is_empty and inter.area > 0:
                    overlap_geoms.append(inter)

    print(f'Normalization overlap pairs: {len(overlap_geoms)}', flush=True)

    # Collect boundaries for topological faces
    lines = [v.boundary for v in baselines_mod.values()]

    # Include source boundaries clipped to overlap areas
    if overlap_geoms:
        overlap_tree = STRtree(overlap_geoms)
        for src in sources.values():
            local = [overlap_geoms[int(j)] for j in overlap_tree.query(src)]
            if not local:
                continue
            src_bnd_clipped = src.boundary.intersection(unary_union(local))
            if not src_bnd_clipped.is_empty:
                lines.append(src_bnd_clipped)

    union_lines = unary_union(lines)
    faces = [f for f in polygonize(union_lines) if f.area > 0]
    print(f'Normalization faces: {len(faces)}', flush=True)

    face_records = []
    for face in faces:
        pt = face.representative_point()
        idx_hits = tree.query(pt, predicate="intersects")

        # 1. covered_by MUST filter face.intersection(geom).area>0
        covered_by = []
        for idx in idx_hits:
            geom = geom_list[idx]
            if face.intersection(geom).area > 0:
                covered_by.append(keys[idx])

        if covered_by:
            face_records.append({"face": face, "covered_by": covered_by})

    projector = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:6933", always_xy=True).transform

    resolved_faces = {k: [] for k in keys}

    for face_rec in face_records:
        face = face_rec["face"]
        c_ids = face_rec["covered_by"]

        if len(c_ids) == 1:
            resolved_faces[c_ids[0]].append(face)
            continue

        # Overlap resolution
        # 1. Tiny numerical ambiguity
        if face.area <= 1e-10:
            all_covered = True
            for c_id in c_ids:
                boundary = baselines_mod[c_id].boundary
                if not boundary.buffer(1e-9).covers(face):
                    all_covered = False
                    break
            if all_covered:
                winner_id = sorted(c_ids)[0]
                diagnostics["tiny_resolutions"].append({
                    "face_wkt": face.wkt,
                    "claimants": c_ids,
                    "winner": winner_id
                })
                resolved_faces[winner_id].append(face)
                continue

        # 2. Check same-parent split
        c_parents = {c_id: parents[c_id] for c_id in c_ids}
        if len(set(c_parents.values())) < len(c_ids):
            raise ValueError(f"Same-parent split true overlap for claimants {c_ids}")

        # 3. Source coverage
        covering_parents = []
        face_pt = face.representative_point()

        for p in set(c_parents.values()):
            if p not in sources:
                continue
            src = sources[p]

            # 5. source covering use representativepoint plus positivearea filtering
            if src.covers(face_pt) and face.intersection(src).area > 0:
                covering_parents.append(p)

        if len(covering_parents) > 1:
            raise ValueError(f"Ambiguous source support: multiple sources cover overlap for claimants {c_ids}")

        if len(covering_parents) == 1:
            winner_p = covering_parents[0]
            winner_id = [c_id for c_id in c_ids if c_parents[c_id] == winner_p][0]

            # 7. include ledger of source-supported resolutions
            diagnostics["source_resolutions"].append({
                "face_wkt": face.wkt,
                "claimants": c_ids,
                "winner": winner_id,
                "area": face.area,
                "method": "source_coverage"
            })

            resolved_faces[winner_id].append(face)
            continue

        # 4. Source-gap overlap
        distances = []
        try:
            # 6. Source-gap distances must use projected face REPRESENTATIVE POINT
            face_pt_6933 = transform(projector, face_pt)
        except Exception:
            raise ValueError("Projection failed for source-gap overlap")

        for c_id in c_ids:
            p = parents[c_id]
            if p not in sources:
                continue
            source_6933 = transform(projector, sources[p])
            dist = face_pt_6933.distance(source_6933)
            distances.append((dist, c_id))

        if not distances:
            raise ValueError(f"No sources available for source-gap distance calculation for claimants {c_ids}")

        distances.sort(key=lambda x: x[0])
        min_dist, winner_id = distances[0]

        # Treat only numerical equality as a tie. A millimeter-wide tie band
        # incorrectly rejected distinct nearest parents for centimeter source gaps.
        if len(distances) > 1 and abs(distances[0][0] - distances[1][0]) < 1e-7:
            raise ValueError('Tie in source-gap distance: ' + json.dumps({
                'claimants': c_ids, 'distances': distances, 'area': face.area,
                'face_wkt': face.wkt, 'point': list(face_pt.coords[0]),
                'source_intersections': {i: face.intersection(sources[parents[i]]).area for i in c_ids}}))

        if min_dist <= 1000:
            diagnostics["gap_resolutions"].append({
                "face_wkt": face.wkt,
                "claimants": c_ids,
                "winner": winner_id,
                "area": face.area,
                "distance": min_dist
            })
            resolved_faces[winner_id].append(face)
        else:
            raise ValueError(f"Source-gap distance {min_dist} > 1000m for claimants {c_ids}")

    # Reconstruct final geometries
    result = {}
    for k in baseline.keys():
        if resolved_faces.get(k):
            unioned = unary_union(resolved_faces[k])
            # 3. Remove make_valid masking
            if not unioned.is_empty:
                result[k] = unioned
        else:
            # 2. output keys must exactly match baseline. If a geometry has no faces, it means it's empty
            raise ValueError(f"Baseline {k} completely erased after overlap resolution")

    def fail(message):
        error = ValueError(message)
        error.geometries = result
        error.normalization_ledger = diagnostics
        raise error

    # Both the area and boundary-band bounds must hold for numerical residuals.
    def negligible(residual, boundary):
        return residual.is_empty or (residual.area <= 1e-10 and boundary.buffer(1e-9).covers(residual))

    if set(result) != set(baseline):
        raise ValueError('Normalization changed feature identities')
    for k, geom in result.items():
        if not geom.is_valid or geom.is_empty or geom.geom_type not in {'Polygon', 'MultiPolygon'}:
            raise ValueError(f"Validation failed: Invalid geometry for {k}")
    if not coverage_is_valid_exact(list(result.values())):
        from tools.pilot_tno_russia_precision import node_owner_interfaces
        # Dissolving individually assigned faces can leave different subdivisions
        # of the same shared line. Re-node under the existing per-feature surface
        # conservation gate; genuine overlap still fails inside this function.
        edges = shapely.coverage_invalid_edges(list(result.values()))
        diagnostics['pre_noding_invalid_edges'] = {
            fid: edge.wkt for fid, edge in zip(result, edges) if not edge.is_empty}
        diagnostics['interface_noding'] = {}
        result = node_owner_interfaces(result, diagnostics['interface_noding'])

    out_union = unary_union(list(result.values()))
    baseline_union = unary_union(list(baselines_mod.values()))

    # 4. Enforce coverage_is_valid and exclusive-area conservation
    diff_missing = baseline_union.difference(out_union)
    diff_extra = out_union.difference(baseline_union)

    if not negligible(diff_missing, baseline_union.boundary):
        raise ValueError(f"Validation failed: Result union missing area: {diff_missing.area}")

    if not negligible(diff_extra, baseline_union.boundary):
        raise ValueError(f"Validation failed: Result union extra area: {diff_extra.area}")

    for k, geom in result.items():
        orig_geom = baselines_mod[k]
        diff_geom = geom.difference(orig_geom)
        if not negligible(diff_geom, orig_geom.boundary):
            raise ValueError(f"Validation failed: Output {k} expanded: {diff_geom.area}")
        other = [geom_list[int(j)] for j in tree.query(orig_geom, predicate='intersects') if keys[int(j)] != k]
        exclusive = orig_geom.difference(unary_union(other))
        # Difference creates new exclusive-area edges inside the original face.
        # Overlay roundoff must be tested against that exact constrained surface.
        if not negligible(exclusive.difference(geom), exclusive.boundary):
            fail(f'Validation failed: exclusive territory lost from {k}')

    return result, diagnostics
