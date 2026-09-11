"""Convert D3 spherical physical masks into planar EPSG:4326 clipping geometry.

Only use for masks whose edges already have D3 spherical semantics. Named-water
source geometry uses planar edges and must never pass through this adapter.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import subprocess

from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]

_STREAM_MASK = r"""
const fs = require('fs'), vm = require('vm');
const sandbox = {}; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), sandbox);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const polygons = []; let rings, ring;
const sink = {
 polygonStart() { rings = []; },
 polygonEnd() { polygons.push(rings); },
 lineStart() { ring = []; },
 lineEnd() { if (ring.length >= 3) rings.push(ring); },
 point(x, y) { ring.push([Math.max(-180, Math.min(180, x)), Math.max(-90, Math.min(90, y))]); },
 sphere() { throw new Error('Projection must clip the sphere before output'); }
};
const projection = sandbox.d3.geoEquirectangular().scale(180 / Math.PI)
 .translate([0, 0]).reflectY(true).precision(input.precision);
sandbox.d3.geoStream(input.geometry, projection.stream(sink));
process.stdout.write(JSON.stringify(polygons));
"""


def _polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        if not geometry.is_empty and geometry.area:
            yield geometry
    elif isinstance(geometry, (MultiPolygon, GeometryCollection)):
        for child in geometry.geoms:
            yield from _polygon_parts(child)


def physical_mask_to_planar_geometry(mask, *, precision_degrees=0.001):
    """Stream a spherical GeoJSON mask through D3's native seam/pole clipper.

    Returns Shapely Polygon/MultiPolygon in lon/lat. Precision bounds adaptive
    projected chord error in degrees; it does not change any runtime topology.
    Input may be a polygon geometry, Feature or FeatureCollection.
    """
    if not math.isfinite(precision_degrees) or precision_degrees <= 0:
        raise ValueError('precision_degrees must be finite and positive.')
    completed = subprocess.run(
        ['node', '-e', _STREAM_MASK, str(ROOT / 'vendor/d3.v7.min.js')],
        input=json.dumps({'geometry': mask, 'precision': precision_degrees}),
        text=True, encoding='utf-8', capture_output=True, cwd=ROOT, timeout=60,
    )
    if completed.returncode:
        raise RuntimeError(f'D3 physical mask conversion failed: {completed.stderr.strip()}')
    groups = json.loads(completed.stdout)
    result = []
    for rings in groups:
        ring_polygons = [Polygon(ring) for ring in rings]
        ring_polygons = [ring for ring in ring_polygons if not ring.is_empty and ring.area > 1e-15]
        if not ring_polygons:
            continue
        # Polygonize the clipped ring network, then retain faces with nonzero
        # winding. This also handles native clipper self-contacts and tiny holes
        # that touch/cross a quantized coastline without guessing shell owners.
        supports = [ring if ring.is_valid else make_valid(ring) for ring in ring_polygons]
        weights = [1 if ring.exterior.is_ccw else -1 for ring in ring_polygons]
        tree = STRtree(supports)
        faces = polygonize(unary_union([ring.boundary for ring in ring_polygons]))
        for face in faces:
            point = face.representative_point()
            winding = sum(weights[int(index)] for index in tree.query(point)
                          if supports[int(index)].covers(point))
            if winding:
                result.append(face)
    return unary_union(result) if result else MultiPolygon([])

def inherit_physical_water_masks(topology, primary_topology, *, object_names=("land", "ocean")):
    """Copy authoritative spherical masks with exact decoded coordinate identity.

    Quantized topologies can have incompatible grids. Decode the target once
    instead of re-quantizing either geometry: all unrelated target features keep
    their decoded coordinates, and donor masks retain original great-circle
    edges. Only referenced donor mask arcs are copied. Inputs are not mutated.
    """
    from copy import deepcopy

    if topology.get("type") != "Topology" or primary_topology.get("type") != "Topology":
        raise ValueError("Physical mask inheritance requires two Topology objects.")
    names = tuple(dict.fromkeys(object_names))
    for name in names:
        if name not in primary_topology.get("objects", {}):
            raise ValueError(f"Primary physical mask is missing: {name}")

    def decode_arc(arc, transform):
        if not transform:
            return deepcopy(arc)
        sx, sy = transform["scale"]
        tx, ty = transform["translate"]
        x = y = 0
        decoded = []
        for coordinate in arc:
            x += coordinate[0]
            y += coordinate[1]
            decoded.append([x * sx + tx, y * sy + ty, *coordinate[2:]])
        return decoded

    def decode_points(geometry, transform):
        if transform:
            sx, sy = transform["scale"]
            tx, ty = transform["translate"]
            def point(coordinates):
                return [coordinates[0] * sx + tx, coordinates[1] * sy + ty, *coordinates[2:]]
            if geometry.get("type") == "Point":
                geometry["coordinates"] = point(geometry["coordinates"])
            elif geometry.get("type") == "MultiPoint":
                geometry["coordinates"] = [point(value) for value in geometry["coordinates"]]
        for child in geometry.get("geometries", []):
            decode_points(child, transform)

    def arc_indices(value):
        if isinstance(value, list):
            for child in value:
                yield from arc_indices(child)
        else:
            yield value if value >= 0 else ~value

    def references(geometry):
        yield from arc_indices(geometry.get("arcs", []))
        for child in geometry.get("geometries", []):
            yield from references(child)

    def rewrite_values(value, remap):
        if isinstance(value, list):
            return [rewrite_values(child, remap) for child in value]
        return remap[value] if value >= 0 else ~remap[~value]

    def rewrite(geometry, remap):
        if "arcs" in geometry:
            geometry["arcs"] = rewrite_values(geometry["arcs"], remap)
        for child in geometry.get("geometries", []):
            rewrite(child, remap)

    result = deepcopy(topology)
    transform = result.pop("transform", None)
    result["arcs"] = [decode_arc(arc, transform) for arc in result.get("arcs", [])]
    for geometry in result.get("objects", {}).values():
        decode_points(geometry, transform)
    donor_objects = {name: deepcopy(primary_topology["objects"][name]) for name in names}
    donor_indices = sorted({index for geometry in donor_objects.values() for index in references(geometry)})
    donor_remap = {old: len(result["arcs"]) + new for new, old in enumerate(donor_indices)}
    donor_transform = primary_topology.get("transform")
    result["arcs"].extend(decode_arc(primary_topology["arcs"][index], donor_transform) for index in donor_indices)
    for name, geometry in donor_objects.items():
        decode_points(geometry, donor_transform)
        rewrite(geometry, donor_remap)
        result["objects"][name] = geometry
    referenced = sorted({index for geometry in result["objects"].values() for index in references(geometry)})
    remap = {old: new for new, old in enumerate(referenced)}
    for geometry in result["objects"].values():
        rewrite(geometry, remap)
    result["arcs"] = [result["arcs"][index] for index in referenced]
    result.pop("bbox", None)
    return result
