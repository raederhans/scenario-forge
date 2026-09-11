"""Reconcile source-supported generated islands with published island identity."""
from copy import deepcopy
import hashlib
import json

from shapely import normalize
from shapely.geometry import shape
from shapely.ops import unary_union


class IslandIdentityError(ValueError):
    pass


AREA_EPSILON = 1e-14
# Existing builder normalize_polygonal publication floor. Apply only to new
# ownership-cut slivers, never to published IDs or whole raw island components.
MIN_PUBLISH_POLYGON_AREA = 1e-9


def _valid_polygon(geometry, label):
    if (geometry is None or geometry.is_empty or not geometry.is_valid
            or geometry.geom_type not in ("Polygon", "MultiPolygon")):
        raise IslandIdentityError(f"Invalid polygon: {label}")


def _polygonal(geometry):
    if geometry.geom_type in ("Polygon", "MultiPolygon"):
        return geometry
    return unary_union([part for part in getattr(geometry, "geoms", ())
                        if part.geom_type in ("Polygon", "MultiPolygon")])


def reconcile_island_identity(new_rows, published_features, owners, *, source_support_by_row_id,
                              raw_source_by_row_id=None):
    """Return rows and explicit lineage; never infer source support from donor IDs.

    Rows use make_atl_row fields, with Shapely geometry. Published GeoJSON must
    have donor metadata hydrated from a checkpoint whose geometry was verified
    equal by the caller. Supplied support surfaces must precede processing.
    An old ID belongs only to its greatest-overlap child; a merged child keeps
    its greatest-overlap available old ID. Ties use stable IDs.
    """
    result = deepcopy(new_rows)
    published = {}
    for feature in published_features:
        props = feature.get("properties") or {}
        fid = str(props.get("id") or feature.get("id") or "").strip()
        if not fid or fid in published:
            raise IslandIdentityError(f"Missing or duplicate published ID: {fid}")
        geometry = shape(feature["geometry"])
        _valid_polygon(geometry, fid)
        published[fid] = (geometry, set(props.get("donor_province_ids") or []),
                          str(owners.get(fid) or "").strip().upper())
    # A processing merge can cross previously disjoint national footprints.
    # Recover those existing footprints without ranking either country's claim.
    split_rows = []
    split_support = {}
    split_raw = {}
    split_events = []
    discarded = []
    for row in result:
        rid = str(row.get("id") or "").strip()
        geometry = row.get("geometry")
        _valid_polygon(geometry, rid)
        support = source_support_by_row_id.get(rid)
        _valid_polygon(support, f"source support for {rid}")
        raw = raw_source_by_row_id.get(rid) if raw_source_by_row_id is not None else support
        _valid_polygon(raw, f"raw source for {rid}")
        if geometry.difference(support).area > AREA_EPSILON:
            raise IslandIdentityError(f"New island extends beyond proven source support: {rid}")
        parts = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
        if any(part.intersection(raw).area <= AREA_EPSILON for part in parts):
            raise IslandIdentityError(f"Island component has no raw source overlap: {rid}")
        donors = set(row.get("donor_province_ids") or [])
        matches = {fid: entry for fid, entry in published.items()
                   if donors.intersection(entry[1]) and geometry.intersection(entry[0]).area > AREA_EPSILON}
        matched_owners = {entry[2] for entry in matches.values()}
        if "" in matched_owners:
            raise IslandIdentityError(f"Unknown published ownership for {rid}")
        if len(matched_owners) <= 1:
            split_rows.append(row)
            split_support[rid], split_raw[rid] = support, raw
            continue
        old_entries = sorted(matches.items())
        for index, (old_id, (old_geometry, _, old_owner)) in enumerate(old_entries):
            for other_id, (other_geometry, _, other_owner) in old_entries[index + 1:]:
                if old_owner != other_owner and old_geometry.intersection(other_geometry).area > AREA_EPSILON:
                    raise IslandIdentityError(f"Overlapping published ownership for {rid}: {old_id}, {other_id}")
        occupied = unary_union([entry[0] for entry in matches.values()])
        for owner in sorted(matched_owners):
            footprint = unary_union([entry[0] for entry in matches.values() if entry[2] == owner])
            piece = _polygonal(geometry.intersection(footprint))
            child = deepcopy(row)
            child["id"] = f"{rid}__published_{owner}"
            child["geometry"] = piece
            child["assigned_owner_tag"] = owner
            split_rows.append(child)
            split_support[child["id"]], split_raw[child["id"]] = support, raw
        remainder = geometry.difference(occupied)
        remainder_parts = ([remainder] if remainder.geom_type == "Polygon" else list(getattr(remainder, "geoms", ())))
        for index, part in enumerate(sorted(remainder_parts, key=lambda part: (-part.area, part.bounds))):
            if part.is_empty or part.area <= 0:
                continue
            if part.intersection(raw).area <= AREA_EPSILON:
                if raw_source_by_row_id is None:
                    raise IslandIdentityError(f"Unproven ownership remainder for {rid}")
                discarded.append({"source_row_id": rid, "area": part.area,
                                  "reason": "processing_only_remainder_without_raw_overlap"})
                continue
            raw_parts = [raw] if raw.geom_type == "Polygon" else list(raw.geoms)
            contributing_raw_parts = [raw_part for raw_part in raw_parts
                                      if raw_part.intersection(part).area > AREA_EPSILON]
            if (raw_source_by_row_id is not None and part.area < MIN_PUBLISH_POLYGON_AREA
                    and contributing_raw_parts
                    and all(raw_part.difference(part).area > AREA_EPSILON
                            and raw_part.intersection(occupied).area > AREA_EPSILON
                            for raw_part in contributing_raw_parts)):
                discarded.append({
                    "source_row_id": rid, "area": part.area, "bounds": list(part.bounds),
                    "reason": "ownership_split_remainder_below_publish_floor",
                    "publish_min_area": MIN_PUBLISH_POLYGON_AREA,
                    "raw_component_areas": [raw_part.area for raw_part in contributing_raw_parts],
                })
                continue
            child = deepcopy(row)
            child["id"] = f"{rid}__source_remainder_{index}"
            child["geometry"] = part
            split_rows.append(child)
            split_support[child["id"]], split_raw[child["id"]] = support, raw
        split_events.append({"source_row_id": rid, "published_feature_ids": sorted(matches),
                             "owners": sorted(matched_owners)})
    if split_events:
        rows, diagnostics = reconcile_island_identity(
            split_rows, published_features, owners, source_support_by_row_id=split_support,
            raw_source_by_row_id=split_raw,
        )
        diagnostics["published_footprint_splits"] = split_events + diagnostics.get("published_footprint_splits", [])
        diagnostics["discarded_processing_components"] = discarded + diagnostics.get("discarded_processing_components", [])
        return rows, diagnostics
    rows_by_id = {}
    overlaps = {}
    for index, row in enumerate(result):
        rid = str(row.get("id") or "").strip()
        if not rid or rid in rows_by_id:
            raise IslandIdentityError(f"Missing or duplicate new row ID: {rid}")
        geometry = row.get("geometry")
        _valid_polygon(geometry, rid)
        support = source_support_by_row_id.get(rid)
        _valid_polygon(support, f"source support for {rid}")
        if geometry.difference(support).area > AREA_EPSILON:
            raise IslandIdentityError(f"New island extends beyond proven source support: {rid}")
        rows_by_id[rid] = index
        donors = set(row.get("donor_province_ids") or [])
        if not donors:
            raise IslandIdentityError(f"Missing donor identity: {rid}")
        matches = {}
        for old_id, (old_geometry, old_donors, _) in published.items():
            if donors.intersection(old_donors) and geometry.intersects(old_geometry):
                area = geometry.intersection(old_geometry).area
                if area > AREA_EPSILON:
                    matches[old_id] = area
        matched_owners = {published[old_id][2] for old_id in matches}
        if matches and ("" in matched_owners or len(matched_owners) != 1):
            raise IslandIdentityError(f"Ambiguous published ownership for {rid}: {sorted(matches)}")
        if matched_owners:
            row["assigned_owner_tag"] = next(iter(matched_owners))
        elif not str(row.get("assigned_owner_tag") or "").strip():
            raise IslandIdentityError(f"Source-supported new island has no configured owner: {rid}")
        overlaps[rid] = matches
    nominated = {}
    for old_id in sorted(published):
        children = [(matches[old_id], rid) for rid, matches in overlaps.items() if old_id in matches]
        if children:
            nominated[old_id] = min(children, key=lambda item: (-item[0], item[1]))[1]
    reserved = set(published)
    used = set()
    lineage = []
    for rid in sorted(rows_by_id):
        row = result[rows_by_id[rid]]
        matches = overlaps[rid]
        eligible = [old_id for old_id in matches if nominated[old_id] == rid]
        if eligible:
            new_id = min(eligible, key=lambda old_id: (-matches[old_id], old_id))
        else:
            # Geometry content supplies deterministic identity without reusing
            # positional helper numbering or taking an unrelated published ID.
            identity = json.dumps({"region": row.get("region_id", ""),
                                   "donors": sorted(row["donor_province_ids"])}, sort_keys=True).encode()
            digest = hashlib.sha256(identity + normalize(row["geometry"]).wkb).hexdigest()
            new_id = f"ATLISL_{row.get('region_id') or 'source'}_source_{digest}"
            if new_id in reserved:
                raise IslandIdentityError(f"Generated island ID collides with published identity: {new_id}")
        if new_id in used:
            raise IslandIdentityError(f"Duplicate generated island identity: {new_id}")
        used.add(new_id)
        row["id"] = new_id
        row["published_island_lineage"] = sorted(matches)
        lineage.append({"source_row_id": rid, "feature_id": new_id,
                        "old_feature_ids": sorted(matches), "owner": row["assigned_owner_tag"],
                        "overlap_areas": dict(sorted(matches.items()))})
    retired = sorted(set(nominated) - used)
    return result, {"lineage": lineage, "retired_island_ids": retired,
                    "unmatched_published_island_ids": sorted(set(published) - set(nominated)),
                    "published_footprint_splits": [], "discarded_processing_components": [],
                    "retired_to_feature_ids": {old_id: sorted(entry["feature_id"] for entry in lineage
                                                              if old_id in entry["old_feature_ids"])
                                               for old_id in retired}}
