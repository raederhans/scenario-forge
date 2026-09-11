"""Build a coastline surface from canonical land, not administrative fragments."""

from shapely import make_valid
from shapely.geometry import Polygon, box, shape
from shapely.ops import unary_union


def build_atlantropa_land_reference(canonical_land_geometry, political_geometries, aoi_bboxes):
    """Unify the land actually drawn near Atlantropa with the global coast.

    AOIs select whole political geometries; they never clip geometry or add a
    buffered strip. Canonical lake holes remain water, including when political
    geometry covers them. Callers apply scenario-specific water/island cuts.
    """
    if canonical_land_geometry is None or canonical_land_geometry.is_empty or not canonical_land_geometry.is_valid:
        raise ValueError("Land reference requires a nonempty valid canonical surface")
    aoi = unary_union([box(*bounds) for bounds in aoi_bboxes])

    def polygon_parts(geometry):
        if geometry.geom_type == "Polygon":
            yield geometry
        elif hasattr(geometry, "geoms"):
            for part in geometry.geoms:
                yield from polygon_parts(part)

    selected = [canonical_land_geometry]
    for geometry in political_geometries:
        if geometry is None or geometry.is_empty or not geometry.intersects(aoi):
            continue
        selected.extend(polygon_parts(geometry if geometry.is_valid else make_valid(geometry)))
    result = unary_union(selected)
    canonical_holes = [Polygon(ring) for part in polygon_parts(canonical_land_geometry) for ring in part.interiors]
    if canonical_holes:
        # A canonical lake may itself contain canonical land islands. Preserve
        # those islands while removing only the original water from the union.
        protected_water = unary_union(canonical_holes).difference(canonical_land_geometry)
        result = result.difference(protected_water)
    # GEOS can retain zero-area boundary segments after subtracting touching
    # lake rings. They are not land; keep every polygon without buffering it.
    if result.geom_type == "GeometryCollection":
        result = unary_union(list(polygon_parts(result)))
    if result.is_empty or not result.is_valid or result.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError("Land reference union is empty, invalid or non-polygonal")
    return result


def build_scenario_coastline_geometry(
    base_land_geometry, atlantropa_features, *, removed_land_geometry=None
):
    """Keep canonical islands/lakes and apply explicit land additions/removals.

    The caller supplies the canonical physical land surface and scenario cuts
    (such as Congo Lake and replaced donor islands). Water, shoals and relief
    are deliberately excluded from the added land.
    """
    if base_land_geometry is None or base_land_geometry.is_empty or not base_land_geometry.is_valid:
        raise ValueError("Coastline requires a nonempty valid canonical land surface")
    base = base_land_geometry
    if removed_land_geometry is not None and not removed_land_geometry.is_empty:
        base = base.difference(removed_land_geometry)
    land = []
    for feature in atlantropa_features:
        if feature.get("properties", {}).get("atl_render_layer") != "land":
            continue
        geometry = shape(feature["geometry"])
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or not geometry.is_valid:
            raise ValueError("Atlantropa coastline land must be valid polygonal geometry")
        if not geometry.is_empty:
            land.append(geometry)
    result = unary_union([base, *land])
    if result.is_empty or not result.is_valid or result.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError("Scenario coastline surface is empty, invalid or non-polygonal")
    return result
