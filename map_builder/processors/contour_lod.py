"""Reusable physical contour LOD derivation used by the data pipeline."""
from __future__ import annotations
import json
from pathlib import Path
import geopandas as gpd
from shapely.geometry import LineString, MultiLineString
from topojson import Topology

def decode_topology(payload: dict, object_name: str) -> gpd.GeoDataFrame:
    scale, translate = payload["transform"]["scale"], payload["transform"]["translate"]
    arcs = []
    for arc in payload.get("arcs", []):
        x = y = 0; points = []
        for dx, dy in arc:
            x += dx; y += dy; points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        arcs.append(points)
    def line(ref):
        points = arcs[ref if ref >= 0 else ~ref]
        return points if ref >= 0 else list(reversed(points))
    def join(refs):
        points = []
        for ref in refs:
            segment = line(ref); points.extend(segment[1:] if points else segment)
        return points
    def geometry(item):
        refs = item.get("arcs", [])
        if item["type"] == "LineString": return LineString(join(refs))
        if item["type"] == "MultiLineString": return MultiLineString([join(chain) for chain in refs])
        raise ValueError(item["type"])
    rows = [{**item.get("properties", {}), "geometry": geometry(item)} for item in payload["objects"][object_name]["geometries"]]
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")

def build_lod(source: Path, output: Path, tolerance: float, elevation_step: int) -> dict:
    gdf = decode_topology(json.loads(source.read_text(encoding="utf-8")), "contours")
    gdf = gdf[gdf["elevation_m"].astype(int) % elevation_step == 0].copy()
    gdf["geometry"] = gdf.geometry.simplify(tolerance, preserve_topology=False)
    def usable(geom):
        if geom is None or geom.is_empty or not geom.is_valid or geom.length <= 0: return False
        if geom.geom_type == "LineString" and geom.is_ring and len(geom.coords) < 4: return False
        return True
    gdf = gdf[gdf.geometry.map(usable)].copy()
    topo = Topology(gdf, object_name="contours", topology=True, prequantize=10_000, topoquantize=False,
                    presimplify=False, toposimplify=False, shared_coords=False)
    output.write_text(json.dumps(topo.to_dict(), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"features": len(gdf), "bytes": output.stat().st_size, "tolerance_degrees": tolerance, "elevation_step_m": elevation_step}

def build_lod_assets(data_dir: Path) -> dict:
    sources = {"major": data_dir / "global_contours.major.topo.json", "minor": data_dir / "global_contours.minor.topo.json"}
    stats = {"low_major": build_lod(sources["major"], data_dir / "global_contours.low.major.topo.json", .10, 1000),
             "mid_major": build_lod(sources["major"], data_dir / "global_contours.mid.major.topo.json", .045, 500),
             "mid_minor": build_lod(sources["minor"], data_dir / "global_contours.mid.minor.topo.json", .045, 200)}
    (data_dir / "global_contours.lod.provenance.json").write_text(json.dumps({"source": {k: str(v.name) for k,v in sources.items()}, "assets": stats}, indent=2), encoding="utf-8")
    return stats
