"""Recover legacy Arctic clipping without requantizing unrelated geometry."""
from copy import deepcopy

import shapely
from shapely.geometry import GeometryCollection, box, shape
from shapely.ops import unary_union

from map_builder.regional_geometry import (
    _absolute_topology, _compact_arcs,
    _encode_exact_coverage, _offset_arcs, _update_bbox,
)

# Includes the quantized 73 N seam and Yamal's 72.9467 N legacy boundary.
RECOVERY_SOUTH = 72.9
AREA_EPSILON = 1e-10


def polygonal(geometry):
    """Repair only spatial working copies, never untouched output features."""
    if geometry is None or geometry.is_empty:
        return GeometryCollection()
    if not geometry.is_valid:
        geometry = shapely.make_valid(geometry)
    if geometry.geom_type in {'Polygon', 'MultiPolygon'}:
        return geometry
    return unary_union([polygonal(part) for part in getattr(geometry, 'geoms', [])])


def decoded_structure(topology, item):
    """Lossless coordinate/metadata view, including historically invalid rings."""
    result = deepcopy(item)
    if 'geometries' in item:
        result['geometries'] = [decoded_structure(topology, g) for g in item['geometries']]
    if 'arcs' not in item:
        return result

    def line(indices):
        points = []
        for index in indices:
            segment = topology['arcs'][index if index >= 0 else ~index]
            if index < 0:
                segment = segment[::-1]
            points.extend(segment if not points else segment[1:])
        return points

    kind = item['type']
    arcs = result.pop('arcs')
    if kind == 'LineString':
        coordinates = line(arcs)
    elif kind in {'Polygon', 'MultiLineString'}:
        coordinates = [line(ring) for ring in arcs]
    elif kind == 'MultiPolygon':
        coordinates = [[line(ring) for ring in poly] for poly in arcs]
    else:
        raise ValueError(f'Unsupported arc geometry: {kind}')
    result['coordinates'] = coordinates
    return result


def _read(topology, item):
    decoded = decoded_structure(topology, item)

    def safe_shape(geometry):
        kind = geometry.get('type')
        if kind == 'GeometryCollection':
            return unary_union([safe_shape(g) for g in geometry['geometries']])
        if kind not in {'Polygon', 'MultiPolygon'}:
            return GeometryCollection()
        polygons = [geometry['coordinates']] if kind == 'Polygon' else geometry['coordinates']
        valid = []
        for rings in polygons:
            if not rings or len(set(map(tuple, rings[0]))) < 3:
                continue
            kept = [ring for ring in rings if len(set(map(tuple, ring))) >= 3]
            valid.append(polygonal(shape({'type': 'Polygon', 'coordinates': kept})))
        return polygonal(unary_union(valid))

    return safe_shape(decoded)


def recover_arctic(topology, source, *, land_topology=None, owners=None, controllers=None):
    """Return a local candidate and sidecar assignments; never mutate inputs.

    Only source ADM2s extending beyond 73 N are considered. Additions are bounded
    south at 72.9 N, clipped to published physical land, and exclude all existing
    political coverage except explicit RU_ARCTIC_FB helpers. TNO helper hints
    retain their owner/controller domains, using children where they differ.
    """
    baseline = _absolute_topology(topology)
    result = deepcopy(baseline)
    items = baseline['objects']['political']['geometries']
    by_id = {g['properties']['id']: g for g in items}
    if len(by_id) != len(items):
        raise ValueError('Duplicate political IDs')
    north = box(-180, RECOVERY_SOUTH, 180, 90)
    selected = {}
    for feature in source['features']:
        geom = polygonal(shape(feature['geometry']))
        feature_id = 'RU_RAY_' + feature['properties']['shapeID']
        if geom.bounds and geom.bounds[3] > 73 and feature_id in by_id:
            selected[feature_id] = polygonal(geom.simplify(0.025, preserve_topology=True).intersection(north))
    if not selected:
        raise ValueError('No existing Arctic RU_RAY targets matched the source')
    domain = unary_union(list(selected.values())).envelope
    decoded = {}
    helpers = {}
    occupied = []
    for feature_id, item in by_id.items():
        geom = _read(baseline, item)
        if geom.is_empty or not geom.intersects(domain):
            continue
        decoded[feature_id] = geom
        props = item['properties']
        if feature_id.startswith('RU_ARCTIC_FB_'):
            if owners is not None and (props.get('scenario_helper_kind') != 'shell_fallback' or props.get('interactive') is not False):
                raise ValueError(f'Not a removable Arctic helper: {feature_id}')
            helpers[feature_id] = geom
        else:
            occupied.append(geom.intersection(domain))
    occupied = unary_union(occupied)
    physical = _absolute_topology(land_topology or topology)
    if 'land' not in physical['objects']:
        raise ValueError('Published physical land mask is required')
    land = _read(physical, physical['objects']['land']).intersection(domain)
    replacements = {}
    additions = {}
    assignments = {}
    recovered = []
    measurements = []
    for feature_id, source_geom in sorted(selected.items()):
        original = decoded.get(feature_id)
        if original is None:
            original = _read(baseline, by_id[feature_id])
        extra = polygonal(source_geom.intersection(land).difference(occupied))
        if extra.area <= AREA_EPSILON:
            continue
        pieces = {}
        parent_owner = (owners or {}).get(feature_id)
        parent_controller = (controllers or {}).get(feature_id, parent_owner)
        if owners is not None and not parent_owner:
            raise ValueError(f'Missing parent owner: {feature_id}')
        remaining = extra
        for helper_id, helper in sorted(helpers.items()):
            part = polygonal(extra.intersection(helper))
            if part.area <= AREA_EPSILON:
                continue
            props = by_id[helper_id]['properties']
            owner = props.get('scenario_shell_owner_hint')
            controller = props.get('scenario_shell_controller_hint') or owner
            if owners is not None:
                if not owner:
                    raise ValueError(f'Missing Arctic helper ownership: {helper_id}')
                key = (owner, controller)
                for other_key, other_part in pieces.items():
                    if other_key != key and part.intersection(other_part).area > AREA_EPSILON:
                        raise ValueError(f'Conflicting Arctic ownership domains: {helper_id}')
                pieces[key] = polygonal(unary_union([pieces.get(key, GeometryCollection()), part]))
            remaining = polygonal(remaining.difference(part))
        if owners is None:
            merge = extra
        else:
            parent_key = (parent_owner, parent_controller)
            merge = polygonal(unary_union([remaining, pieces.pop(parent_key, GeometryCollection())]))
            for (owner, controller), part in sorted(pieces.items()):
                index = 1
                child = f'{feature_id}__tno1962_{index}'
                while child in by_id or child in additions:
                    index += 1
                    child = f'{feature_id}__tno1962_{index}'
                props = deepcopy(by_id[feature_id]['properties'])
                props.update(id=child, parent_id=feature_id)
                if 'bbox' in props:
                    props['bbox'] = list(part.bounds)
                additions[child] = (part, props)
                assignments[child] = dict(parent_id=feature_id, owner=owner, controller=controller, cores=[owner])
        if not merge.is_empty:
            replacements[feature_id] = polygonal(original.union(merge))
        recovered.append(extra)
        occupied = polygonal(occupied.union(extra))
        measurements.append(dict(id=feature_id, original_north=original.bounds[3],
                                 recovered_north=extra.bounds[3], added_area_degrees2=extra.area))
    recovery = unary_union(recovered)
    removed = []
    for helper_id, helper in helpers.items():
        if recovery.is_empty or helper.intersection(recovery).area <= AREA_EPSILON:
            continue
        rest = polygonal(helper.difference(recovery))
        if rest.area <= AREA_EPSILON:
            removed.append(helper_id)
        else:
            replacements[helper_id] = rest
    ids = list(replacements) + list(additions)
    if ids:
        encoded = _encode_exact_coverage(ids, list(replacements.values()) + [v[0] for v in additions.values()])
        encoded_by_id = {g['properties']['id']: g for g in encoded['objects']['political']['geometries']}
        offset = len(result['arcs'])
        result['arcs'].extend(encoded['arcs'])
        output = []
        for item in result['objects']['political']['geometries']:
            feature_id = item['properties']['id']
            if feature_id in removed:
                continue
            if feature_id in replacements:
                updated = encoded_by_id[feature_id]
                item.update(type=updated['type'], arcs=_offset_arcs(updated['arcs'], offset))
                if 'bbox' in item:
                    item['bbox'] = list(replacements[feature_id].bounds)
                if 'bbox' in item['properties']:
                    item['properties']['bbox'] = list(replacements[feature_id].bounds)
            output.append(item)
        for feature_id, (_, props) in additions.items():
            item = encoded_by_id[feature_id]
            item['properties'] = props
            item['arcs'] = _offset_arcs(item['arcs'], offset)
            output.append(item)
        result['objects']['political']['geometries'] = output
        _compact_arcs(result)
        _update_bbox(result)
    # Compare lossless decoded coordinates and metadata, including invalid rings.
    changed = set(replacements) | set(removed)
    after = {g['properties']['id']: g for g in result['objects']['political']['geometries']}
    for feature_id in set(by_id) - changed:
        if decoded_structure(baseline, by_id[feature_id]) != decoded_structure(result, after[feature_id]):
            raise AssertionError(f'Unrelated feature changed: {feature_id}')
    for name, obj in baseline['objects'].items():
        if name != 'political' and decoded_structure(baseline, obj) != decoded_structure(result, result['objects'][name]):
            raise AssertionError(f'Nonpolitical object changed: {name}')
    return result, dict(selected_ids=sorted(selected), changed_ids=list(replacements),
                        removed_helper_ids=removed, new_assignments=assignments,
                        measurements=measurements, recovery_south=RECOVERY_SOUTH,
                        non_target_coordinates_preserved=True, nonpolitical_coordinates_preserved=True)
