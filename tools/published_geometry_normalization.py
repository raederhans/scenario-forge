from __future__ import annotations

import json
from pathlib import Path
import subprocess

from tools.political_detail_partition import feature_bounds


def round_water_geometry(payload):
    if payload.get("type") == "Topology" and "transform" in payload:
        return

    def rounded(value):
        if isinstance(value, list):
            return [rounded(child) for child in value]
        return (round(value, 6) or 0) if isinstance(value, float) else value

    def visit(node):
        if "bbox" in node:
            node["bbox"] = rounded(node["bbox"])
        kind = node.get("type")
        if kind == "Topology":
            node["arcs"] = rounded(node["arcs"])
            for child in node["objects"].values():
                visit(child)
        elif kind == "FeatureCollection":
            for child in node["features"]:
                visit(child)
        elif kind == "Feature":
            if node.get("geometry"):
                visit(node["geometry"])
        elif kind == "GeometryCollection":
            for child in node["geometries"]:
                visit(child)
        elif "coordinates" in node:
            node["coordinates"] = rounded(node["coordinates"])

    visit(payload)


def _water_features(payload):
    if payload["type"] != "Topology":
        return payload["features"] if payload["type"] == "FeatureCollection" else [payload]

    def decode(geometry):
        kind = geometry["type"]
        if kind == "GeometryCollection":
            return {"type": kind, "geometries": [decode(child) for child in geometry["geometries"]]}
        if "arcs" not in geometry:
            return geometry

        def line(refs):
            points = []
            for ref in refs:
                arc = payload["arcs"][ref if ref >= 0 else ~ref]
                arc = arc if ref >= 0 else arc[::-1]
                points.extend(arc if not points else arc[1:])
            return points

        refs = geometry["arcs"]
        coords = line(refs) if kind == "LineString" else (
            [[line(ring) for ring in polygon] for polygon in refs] if kind == "MultiPolygon"
            else [line(ring) for ring in refs])
        return {"type": kind, "coordinates": coords}

    features = []
    for obj in payload["objects"].values():
        for geometry in obj["geometries"] if obj["type"] == "GeometryCollection" else [obj]:
            features.append({"type": "Feature", "geometry": decode(geometry)})
    return features


def normalize_published_geometry(app_root: Path, *, byte_exact_paths=()):
    app_root = app_root.resolve()
    excluded = {(app_root / path).resolve() for path in byte_exact_paths}
    political = []
    for manifest_path in sorted((app_root / "data/scenarios").glob("*/detail_chunks.manifest.json")):
        if manifest_path.resolve() in excluded:
            continue
        manifest = json.loads(manifest_path.read_bytes())
        updated = False
        for chunk in manifest.get("chunks", []):
            if chunk.get("layer") not in {"water", "political"}:
                continue
            path = (app_root / chunk["url"]).resolve()
            if not path.is_relative_to((manifest_path.parent / "chunks").resolve()):
                raise ValueError("Chunk URL is outside its scenario chunks directory")
            if path in excluded or path.suffix == ".gz":
                continue
            if chunk["layer"] == "political":
                political.append(str(path))
                continue
            payload = json.loads(path.read_bytes())
            if payload.get("type") == "Topology" and "transform" in payload:
                continue
            round_water_geometry(payload)
            path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            # chunk["bounds"] 是切片网格单元的范围，不随要素坐标变化；只有逐要素外包框要按最终 payload 重算。
            if "feature_bounds" in chunk:
                chunk["feature_bounds"] = [feature_bounds(feature) for feature in _water_features(payload)]
                updated = True
        if updated:
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if not political:
        return []
    script = Path(__file__).with_name("orient_published_political_chunks.mjs")
    result = subprocess.run(["node", str(script)], input=json.dumps(political), text=True,
                            capture_output=True, check=True)
    return json.loads(result.stdout)
