"""Patch an existing europe_topology.json to embed computed_neighbors and fix IDs.

Extracts political geometries directly from the topology (via topojson→GeoJSON
conversion), computes a spatial neighbor graph using geopandas STRtree, then
injects the graph back as objects.political.computed_neighbors.

Also fixes top-level geometry IDs from numeric indices to stable string IDs.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import topojson as tp
from shapely.geometry import shape

# Add project root to path so we can import map_builder
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from map_builder.geo.topology import compute_neighbor_graph


def topology_to_geodataframe(topo_dict: dict, object_name: str) -> gpd.GeoDataFrame:
    """Convert a topology object to a GeoDataFrame using the topojson library."""
    # Use the topojson library to convert back to GeoJSON features
    topology = tp.Topology(topo_dict)
    geojson = topology.to_geojson(object_name)
    gdf = gpd.read_file(geojson, driver="GeoJSON")
    return gdf


def topology_to_geodataframe_manual(topo_dict: dict, object_name: str) -> gpd.GeoDataFrame:
    """Manual fallback: decode quantized arcs and build GeoDataFrame."""
    arcs_raw = topo_dict.get("arcs", [])
    transform = topo_dict.get("transform")

    # Decode quantized arcs
    decoded_arcs = []
    for arc in arcs_raw:
        coords = []
        x, y = 0.0, 0.0
        for point in arc:
            if len(point) < 2:
                continue
            x += point[0]
            y += point[1]
            if transform:
                sx, sy = transform.get("scale", [1.0, 1.0])
                tx, ty = transform.get("translate", [0.0, 0.0])
                coords.append((x * sx + tx, y * sy + ty))
            else:
                coords.append((x, y))
        decoded_arcs.append(coords)

    def decode_arc_ref(ref):
        if ref < 0:
            return list(reversed(decoded_arcs[~ref]))
        return decoded_arcs[ref]

    def decode_ring(ring_refs):
        coords = []
        for ref in ring_refs:
            arc_coords = decode_arc_ref(ref)
            if coords:
                coords.extend(arc_coords[1:])  # skip duplicate start point
            else:
                coords.extend(arc_coords)
        return coords

    def decode_geometry(geom):
        gtype = geom.get("type", "")
        arcs = geom.get("arcs", [])

        if gtype == "Polygon":
            rings = [decode_ring(ring) for ring in arcs]
            return {"type": "Polygon", "coordinates": rings}
        elif gtype == "MultiPolygon":
            polygons = []
            for polygon_arcs in arcs:
                rings = [decode_ring(ring) for ring in polygon_arcs]
                polygons.append(rings)
            return {"type": "MultiPolygon", "coordinates": polygons}
        elif gtype == "LineString":
            return {"type": "LineString", "coordinates": decode_ring(arcs)}
        elif gtype == "MultiLineString":
            lines = [decode_ring(line) for line in arcs]
            return {"type": "MultiLineString", "coordinates": lines}
        elif gtype == "Point":
            coords = geom.get("coordinates", [0, 0])
            if transform:
                sx, sy = transform.get("scale", [1.0, 1.0])
                tx, ty = transform.get("translate", [0.0, 0.0])
                coords = [coords[0] * sx + tx, coords[1] * sy + ty]
            return {"type": "Point", "coordinates": coords}
        else:
            return None

    political_obj = topo_dict.get("objects", {}).get(object_name, {})
    geometries = political_obj.get("geometries", [])

    features = []
    for geom in geometries:
        decoded = decode_geometry(geom)
        if decoded is None:
            continue
        try:
            shapely_geom = shape(decoded)
            if shapely_geom.is_empty:
                continue
        except Exception:
            continue
        features.append({
            "geometry": shapely_geom,
            **(geom.get("properties", {}))
        })

    gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")
    return gdf


def main():
    data_dir = project_root / "data"
    topo_path = data_dir / "europe_topology.json"

    # Restore from backup if exists (in case of re-run)
    backup_path = topo_path.with_suffix(".json.bak")
    if backup_path.exists():
        print(f"Restoring from backup: {backup_path}")
        topo_text = backup_path.read_text(encoding="utf-8")
    elif topo_path.exists():
        topo_text = topo_path.read_text(encoding="utf-8")
    else:
        raise SystemExit(f"Missing topology: {topo_path}")

    # Load topology
    print(f"Loading topology...")
    topo = json.loads(topo_text)

    political_obj = topo.get("objects", {}).get("political", {})
    geometries = political_obj.get("geometries", [])
    if not geometries:
        raise SystemExit("No political geometries in topology")

    print(f"  Political geometries: {len(geometries)}")
    print(f"  Total arcs: {len(topo.get('arcs', []))}")

    # Fix top-level IDs: promote properties.id to geometry.id
    print("\n-- Fixing top-level geometry IDs --")
    id_set: set[str] = set()
    fixed_count = 0
    for i, geom in enumerate(geometries):
        props = geom.get("properties", {})
        stable_id = str(props.get("id", "")).strip()
        if not stable_id:
            stable_id = f"feature-{i}"
            props["id"] = stable_id
        if stable_id in id_set:
            stable_id = f"{stable_id}__dup{i}"
            props["id"] = stable_id
        id_set.add(stable_id)
        old_id = geom.get("id")
        if old_id != stable_id:
            fixed_count += 1
        geom["id"] = stable_id

    print(f"  Fixed {fixed_count} top-level IDs (numeric -> string)")
    print(f"  Sample IDs: {[g.get('id') for g in geometries[:5]]}")

    # Extract political geometries as GeoDataFrame from the topology itself
    print("\n-- Extracting political geometries from topology --")
    try:
        gdf = topology_to_geodataframe_manual(topo, "political")
        print(f"  Extracted {len(gdf)} geometries (manual decoder)")
    except Exception as exc:
        print(f"  Manual extraction failed: {exc}")
        raise SystemExit("Cannot extract geometries from topology")

    if len(gdf) != len(geometries):
        print(f"  WARNING: Extracted {len(gdf)} but topology has {len(geometries)}")
        print(f"  Only computing neighbors for {len(gdf)} geometries")

    # Compute spatial neighbor graph
    print("\n-- Computing spatial neighbor graph --")
    neighbor_graph = compute_neighbor_graph(gdf)

    # Pad to topology size if needed
    while len(neighbor_graph) < len(geometries):
        neighbor_graph.append([])

    has_neighbors = sum(1 for adj in neighbor_graph if len(adj) > 0)
    total_edges = sum(len(adj) for adj in neighbor_graph) // 2
    max_degree = max((len(adj) for adj in neighbor_graph), default=0)
    print(f"  Connected geometries: {has_neighbors}/{len(geometries)}")
    print(f"  Total edges: {total_edges}")
    print(f"  Max degree: {max_degree}")

    # Embed neighbor graph
    political_obj["computed_neighbors"] = neighbor_graph

    # Country-level adjacency stats
    country_adj: dict[str, set[str]] = {}
    for i, adj_list in enumerate(neighbor_graph):
        cc_i = str(geometries[i].get("properties", {}).get("cntr_code", ""))
        for j in adj_list:
            if j >= len(geometries):
                continue
            cc_j = str(geometries[j].get("properties", {}).get("cntr_code", ""))
            if cc_i and cc_j and cc_i != cc_j:
                country_adj.setdefault(cc_i, set()).add(cc_j)
    all_codes = {str(g.get("properties", {}).get("cntr_code", "")) for g in geometries} - {""}
    no_adj = all_codes - set(country_adj.keys())
    print(f"  Countries with cross-border adjacency: {len(country_adj)}/{len(all_codes)}")
    if no_adj:
        print(f"  Countries WITHOUT adjacency: {sorted(no_adj)}")

    # Write patched topology
    print("\n-- Saving patched topology --")
    if not backup_path.exists():
        # Save original as backup
        topo_path.rename(backup_path)
        print(f"  Backup saved: {backup_path}")
    else:
        print(f"  Backup already exists: {backup_path}")

    patched_json = json.dumps(topo, separators=(",", ":"))
    topo_path.write_text(patched_json, encoding="utf-8")
    print(f"  Saved: {topo_path}")
    print(f"  Size: {len(patched_json):,} bytes")
    print("\nDone! Run tools/debug_topology.py to validate.")


if __name__ == "__main__":
    main()
