"""Lossless conversion helpers for coarse political GeoJSON chunks."""
from __future__ import annotations

from copy import deepcopy
import math
from typing import Any


def _fail(path: str, reason: str) -> ValueError:
    return ValueError(f"{path}: {reason}")


def _position(value: Any, path: str) -> list[int | float]:
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        raise _fail(path, "expected a coordinate position with at least two ordinates")
    result: list[int | float] = []
    for index, ordinate in enumerate(value):
        if isinstance(ordinate, bool) or not isinstance(ordinate, (int, float)):
            raise _fail(f"{path}[{index}]", "expected a finite number")
        if isinstance(ordinate, float) and not math.isfinite(ordinate):
            raise _fail(f"{path}[{index}]", "expected a finite number")
        result.append(ordinate)
    return result


def _ring(value: Any, path: str) -> list[list[int | float]]:
    if not isinstance(value, (list, tuple)) or len(value) < 4:
        raise _fail(path, "ring must contain at least four positions")
    positions = [_position(position, f"{path}[{index}]") for index, position in enumerate(value)]
    if positions[0] != positions[-1]:
        raise _fail(path, "ring must be closed")
    return positions


def _arc(value: Any, path: str) -> list[list[int | float]]:
    if not isinstance(value, list) or len(value) < 2:
        raise _fail(path, "arc must contain at least two positions")
    return [_position(position, f"{path}[{index}]") for index, position in enumerate(value)]


def _copy_feature_metadata(feature: dict[str, Any], path: str) -> dict[str, Any]:
    allowed = {"type", "id", "bbox", "properties", "geometry"}
    extra = set(feature) - allowed
    if extra:
        raise _fail(path, f"unsupported feature member(s): {', '.join(sorted(extra))}")
    result: dict[str, Any] = {"type": "Feature"}
    for key in ("id", "bbox", "properties"):
        if key in feature:
            result[key] = deepcopy(feature[key])
    return result


def feature_collection_to_topology(payload: Any) -> dict[str, Any]:
    """Encode a strict Polygon/MultiPolygon FeatureCollection as untransformed TopoJSON.

    Each source ring becomes one independent arc. No coordinates are simplified,
    quantized, rounded, or shared by this encoder.
    """
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise _fail("FeatureCollection", "expected type 'FeatureCollection'")
    extra = set(payload) - {"type", "features"}
    if extra:
        raise _fail("FeatureCollection", f"unsupported member(s): {', '.join(sorted(extra))}")
    features = payload.get("features")
    if not isinstance(features, list):
        raise _fail("FeatureCollection.features", "expected an array")

    arcs: list[list[list[int | float]]] = []
    geometries: list[dict[str, Any]] = []
    for feature_index, feature in enumerate(features):
        path = f"features[{feature_index}]"
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise _fail(path, "expected a GeoJSON Feature")
        geometry = feature.get("geometry")
        output = _copy_feature_metadata(feature, path)
        if geometry is None:
            output["type"] = None
            geometries.append(output)
            continue
        if not isinstance(geometry, dict):
            raise _fail(f"{path}.geometry", "expected Polygon, MultiPolygon, or null")
        if set(geometry) != {"type", "coordinates"}:
            raise _fail(f"{path}.geometry", "unsupported geometry members")
        geom_type = geometry.get("type")
        coordinates = geometry.get("coordinates")
        if geom_type not in ("Polygon", "MultiPolygon"):
            raise _fail(f"{path}.geometry.type", "only Polygon and MultiPolygon are supported")

        def encode_rings(rings: Any, ring_path: str) -> list[list[int]]:
            if not isinstance(rings, (list, tuple)) or not rings:
                raise _fail(ring_path, "expected a non-empty ring array")
            refs: list[list[int]] = []
            for ring_index, raw_ring in enumerate(rings):
                ring = _ring(raw_ring, f"{ring_path}[{ring_index}]")
                refs.append([len(arcs)])
                arcs.append(ring)
            return refs

        if geom_type == "Polygon":
            if not isinstance(coordinates, (list, tuple)):
                raise _fail(f"{path}.geometry.coordinates", "expected polygon rings")
            output["type"] = "Polygon"
            output["arcs"] = encode_rings(coordinates, f"{path}.geometry.coordinates")
        else:
            if not isinstance(coordinates, (list, tuple)) or not coordinates:
                raise _fail(f"{path}.geometry.coordinates", "expected a non-empty polygon array")
            output["type"] = "MultiPolygon"
            output["arcs"] = [
                encode_rings(rings, f"{path}.geometry.coordinates[{polygon_index}]")
                for polygon_index, rings in enumerate(coordinates)
            ]
        geometries.append(output)

    return {
        "type": "Topology",
        "arcs": arcs,
        "objects": {"political": {"type": "GeometryCollection", "geometries": geometries}},
    }


def decode_political_chunk(payload: Any) -> Any:
    """Return a GeoJSON political chunk, decoding strict untransformed TopoJSON."""
    if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
        return payload
    if not isinstance(payload, dict) or payload.get("type") != "Topology":
        raise _fail("chunk", "expected a FeatureCollection or Topology")
    if "transform" in payload:
        raise _fail("Topology.transform", "transformed Topology is unsupported")
    objects = payload.get("objects")
    if not isinstance(objects, dict) or set(objects) != {"political"}:
        raise _fail("Topology.objects", "expected exactly the 'political' object")
    political = objects["political"]
    if not isinstance(political, dict) or set(political) != {"type", "geometries"}:
        raise _fail("Topology.objects.political", "expected a GeometryCollection")
    if political.get("type") != "GeometryCollection" or not isinstance(political.get("geometries"), list):
        raise _fail("Topology.objects.political", "expected a GeometryCollection")
    arcs = payload.get("arcs")
    if not isinstance(arcs, list):
        raise _fail("Topology.arcs", "expected an array")
    checked_arcs = [_arc(arc, f"Topology.arcs[{index}]") for index, arc in enumerate(arcs)]

    def decode_ring(refs: Any, path: str) -> list[list[int | float]]:
        if not isinstance(refs, list) or not refs:
            raise _fail(path, "expected a non-empty arc reference array")
        points: list[list[int | float]] = []
        for ref_index, ref in enumerate(refs):
            ref_path = f"{path}[{ref_index}]"
            if isinstance(ref, bool) or not isinstance(ref, int):
                raise _fail(ref_path, "expected an integer arc index")
            arc_index = ref if ref >= 0 else ~ref
            if arc_index < 0 or arc_index >= len(checked_arcs):
                raise _fail(ref_path, f"arc index {ref} is out of range")
            arc = checked_arcs[arc_index]
            if ref < 0:
                arc = list(reversed(arc))
            if points:
                if points[-1] != arc[0]:
                    raise _fail(ref_path, "adjacent arcs do not share a junction")
                points.extend(deepcopy(arc[1:]))
            else:
                points.extend(deepcopy(arc))
        if len(points) < 4 or points[0] != points[-1]:
            raise _fail(path, "decoded ring must contain at least four positions and be closed")
        return points

    features: list[dict[str, Any]] = []
    for feature_index, geometry in enumerate(political["geometries"]):
        path = f"Topology.objects.political.geometries[{feature_index}]"
        if not isinstance(geometry, dict):
            raise _fail(path, "expected a geometry object")
        allowed = {"type", "arcs", "id", "bbox", "properties"}
        extra = set(geometry) - allowed
        if extra:
            raise _fail(path, f"unsupported member(s): {', '.join(sorted(extra))}")
        geom_type = geometry.get("type")
        feature = {"type": "Feature"}
        for key in ("id", "bbox", "properties"):
            if key in geometry:
                feature[key] = deepcopy(geometry[key])
        if geom_type is None and "arcs" not in geometry:
            if set(geometry) - {"type", "id", "bbox", "properties"}:
                raise _fail(path, "invalid null geometry")
            feature["geometry"] = None
        elif geom_type == "Polygon":
            rings = geometry.get("arcs")
            if not isinstance(rings, list) or not rings:
                raise _fail(f"{path}.arcs", "expected polygon ring references")
            feature["geometry"] = {"type": "Polygon", "coordinates": [
                decode_ring(refs, f"{path}.arcs[{ring_index}]") for ring_index, refs in enumerate(rings)
            ]}
        elif geom_type == "MultiPolygon":
            polygons = geometry.get("arcs")
            if not isinstance(polygons, list) or not polygons:
                raise _fail(f"{path}.arcs", "expected multipolygon references")
            decoded_polygons = []
            for polygon_index, rings in enumerate(polygons):
                if not isinstance(rings, list) or not rings:
                    raise _fail(f"{path}.arcs[{polygon_index}]", "expected polygon ring references")
                decoded_polygons.append([
                    decode_ring(refs, f"{path}.arcs[{polygon_index}][{ring_index}]")
                    for ring_index, refs in enumerate(rings)
                ])
            feature["geometry"] = {"type": "MultiPolygon", "coordinates": decoded_polygons}
        else:
            raise _fail(f"{path}.type", "only Polygon, MultiPolygon, or null geometry is supported")
        features.append(feature)
    return {"type": "FeatureCollection", "features": features}
