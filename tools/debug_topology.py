"""Validate a generated europe_topology.json for neighbor graph, IDs, and geometry quality."""
import json
import sys
from collections import Counter
from pathlib import Path


def load_topology(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def bbox_area(bounds):
    (minx, miny, maxx, maxy) = bounds
    return max(0.0, maxx - minx) * max(0.0, maxy - miny)


def _arc_bbox(arc, transform):
    sx, sy = (1.0, 1.0)
    tx, ty = (0.0, 0.0)
    if transform:
        sx, sy = transform.get("scale", [1.0, 1.0])
        tx, ty = transform.get("translate", [0.0, 0.0])
    x = 0.0
    y = 0.0
    minx = float("inf")
    miny = float("inf")
    maxx = float("-inf")
    maxy = float("-inf")
    for point in arc:
        if len(point) < 2:
            continue
        dx, dy = point[0], point[1]
        x += dx
        y += dy
        fx = x * sx + tx
        fy = y * sy + ty
        if fx < minx:
            minx = fx
        if fy < miny:
            miny = fy
        if fx > maxx:
            maxx = fx
        if fy > maxy:
            maxy = fy
    if minx == float("inf"):
        return None
    return (minx, miny, maxx, maxy)


def _iter_arc_indices(arcs):
    if isinstance(arcs, int):
        yield arcs
    elif isinstance(arcs, list):
        for item in arcs:
            yield from _iter_arc_indices(item)


def _geometry_bbox(geom, arc_bboxes):
    arcs = geom.get("arcs")
    if arcs is None:
        return None
    minx = float("inf")
    miny = float("inf")
    maxx = float("-inf")
    maxy = float("-inf")
    for arc_idx in _iter_arc_indices(arcs):
        if not isinstance(arc_idx, int):
            continue
        if arc_idx < 0:
            arc_idx = ~arc_idx
        if arc_idx < 0 or arc_idx >= len(arc_bboxes):
            continue
        bbox = arc_bboxes[arc_idx]
        if not bbox:
            continue
        bx0, by0, bx1, by1 = bbox
        if bx0 < minx:
            minx = bx0
        if by0 < miny:
            miny = by0
        if bx1 > maxx:
            maxx = bx1
        if by1 > maxy:
            maxy = by1
    if minx == float("inf"):
        return None
    return (minx, miny, maxx, maxy)


def check_arc_sharing(geoms):
    """Replicate topojson.neighbors() logic to compute arc-based neighbor graph."""
    arc_usage = Counter()

    def collect(obj):
        if isinstance(obj, int):
            arc_usage[~obj if obj < 0 else obj] += 1
        elif isinstance(obj, list):
            for item in obj:
                collect(item)

    for g in geoms:
        collect(g.get("arcs", []))

    shared = sum(1 for c in arc_usage.values() if c > 1)
    single = sum(1 for c in arc_usage.values() if c == 1)
    return shared, single, len(arc_usage)


def compute_arc_neighbor_graph(geoms):
    """Compute neighbor graph by simulating topojson.neighbors()."""
    n = len(geoms)
    arc_to_geoms = {}

    def collect(obj, geom_idx):
        if isinstance(obj, int):
            key = ~obj if obj < 0 else obj
            arc_to_geoms.setdefault(key, set()).add(geom_idx)
        elif isinstance(obj, list):
            for item in obj:
                collect(item, geom_idx)

    for i, g in enumerate(geoms):
        collect(g.get("arcs", []), i)

    neighbors = [set() for _ in range(n)]
    for geom_set in arc_to_geoms.values():
        geom_list = list(geom_set)
        for a in range(len(geom_list)):
            for b in range(a + 1, len(geom_list)):
                neighbors[geom_list[a]].add(geom_list[b])
                neighbors[geom_list[b]].add(geom_list[a])

    return [sorted(s) for s in neighbors]


def main():
    base = Path(__file__).resolve().parents[1]
    topo_path = base / "data" / "europe_topology.json"
    if not topo_path.exists():
        raise SystemExit(f"Missing topology: {topo_path}")

    topo = load_topology(topo_path)
    objects = topo.get("objects", {})
    political = objects.get("political")
    if not political or political.get("type") != "GeometryCollection":
        raise SystemExit("Missing or invalid political object in topology")

    geoms = political.get("geometries", [])
    if not geoms:
        raise SystemExit("No political geometries found")

    arcs = topo.get("arcs", [])
    transform = topo.get("transform")
    arc_bboxes = [_arc_bbox(arc, transform) for arc in arcs]
    has_quantization = "transform" in topo

    print("=" * 60)
    print("TOPOLOGY VALIDATION REPORT")
    print("=" * 60)
    print(f"  File: {topo_path}")
    print(f"  Objects: {list(objects.keys())}")
    print(f"  Total arcs: {len(arcs)}")
    print(f"  Quantized: {has_quantization}")
    if has_quantization:
        print(f"    Scale: {topo['transform'].get('scale')}")
        print(f"    Translate: {topo['transform'].get('translate')}")
    print(f"  Political geometries: {len(geoms)}")

    # ── CHECK 1: IDs ────────────────────────────────────────────
    print("\n── ID VALIDATION ──")
    ids = []
    top_level_ids = []
    missing_id = 0
    empty_id = 0
    missing_cntr = 0
    for i, g in enumerate(geoms):
        props = g.get("properties", {})
        fid = props.get("id", "")
        cc = props.get("cntr_code", "")
        tid = g.get("id")
        ids.append(fid)
        top_level_ids.append(tid)
        if not fid:
            missing_id += 1
        if fid == "":
            empty_id += 1
        if not cc:
            missing_cntr += 1

    id_counts = Counter(ids)
    dups = {k: v for k, v in id_counts.items() if v > 1 and k}
    unique_count = len(set(ids) - {""})

    print(f"  properties.id present: {len(geoms) - missing_id}/{len(geoms)}")
    print(f"  properties.id empty string: {empty_id}")
    print(f"  cntr_code present: {len(geoms) - missing_cntr}/{len(geoms)}")
    print(f"  Unique IDs: {unique_count}")
    print(f"  Duplicate IDs: {len(dups)}")
    if dups:
        for k, v in sorted(dups.items(), key=lambda x: -x[1])[:10]:
            print(f"    '{k}' appears {v} times")

    # Check top-level IDs
    numeric_top_ids = sum(1 for tid in top_level_ids if isinstance(tid, (int, float)))
    string_top_ids = sum(1 for tid in top_level_ids if isinstance(tid, str))
    print(f"  Top-level ID type: {string_top_ids} string, {numeric_top_ids} numeric")
    print(f"  Sample top-level IDs: {top_level_ids[:5]}")
    print(f"  Sample properties.id: {ids[:5]}")
    if numeric_top_ids > 0:
        print("  WARNING: Top-level IDs should be string (properties.id), not numeric indices!")

    # ── CHECK 2: Arc Sharing ────────────────────────────────────
    print("\n── ARC SHARING ──")
    shared, single, total_ref = check_arc_sharing(geoms)
    print(f"  Arcs referenced by political layer: {total_ref}")
    print(f"  Shared arcs (used by >1 geometry): {shared}")
    print(f"  Single-use arcs: {single}")
    if shared == 0:
        print("  CRITICAL: No shared arcs! topojson.neighbors() will return empty arrays!")
    elif shared < total_ref * 0.1:
        print(f"  WARNING: Only {shared/total_ref*100:.1f}% arcs shared — limited neighbor detection")
    else:
        print(f"  OK: {shared/total_ref*100:.1f}% arcs shared")

    # ── CHECK 3: Arc-based Neighbor Graph ───────────────────────
    print("\n── ARC-BASED NEIGHBOR GRAPH (simulates topojson.neighbors()) ──")
    arc_neighbors = compute_arc_neighbor_graph(geoms)
    has_arc_neighbors = sum(1 for adj in arc_neighbors if adj)
    arc_edges = sum(len(adj) for adj in arc_neighbors) // 2
    max_degree = max(len(adj) for adj in arc_neighbors)
    isolated = len(geoms) - has_arc_neighbors
    print(f"  Connected geometries: {has_arc_neighbors}/{len(geoms)}")
    print(f"  Isolated geometries: {isolated}")
    print(f"  Total edges: {arc_edges}")
    print(f"  Max degree: {max_degree}")

    if has_arc_neighbors == 0:
        print("  CRITICAL: topojson.neighbors() will find ZERO neighbors!")
    else:
        # Country-level adjacency from arc sharing
        country_adj = {}
        for i, adj_list in enumerate(arc_neighbors):
            cc_i = geoms[i].get("properties", {}).get("cntr_code", "")
            for j in adj_list:
                cc_j = geoms[j].get("properties", {}).get("cntr_code", "")
                if cc_i and cc_j and cc_i != cc_j:
                    country_adj.setdefault(cc_i, set()).add(cc_j)
        all_codes = {g.get("properties", {}).get("cntr_code", "") for g in geoms} - {""}
        no_adj = all_codes - set(country_adj.keys())
        print(f"  Countries with cross-border adjacency: {len(country_adj)}/{len(all_codes)}")
        if no_adj:
            print(f"  Countries WITHOUT adjacency: {sorted(no_adj)}")

    # ── CHECK 4: Embedded Neighbor Graph ────────────────────────
    print("\n── EMBEDDED NEIGHBOR GRAPH (computed_neighbors) ──")
    embedded = political.get("computed_neighbors")
    if embedded is None:
        print("  NOT PRESENT — frontend will rely solely on topojson.neighbors()")
    elif not isinstance(embedded, list):
        print(f"  INVALID type: {type(embedded)}")
    elif len(embedded) != len(geoms):
        print(f"  SIZE MISMATCH: {len(embedded)} entries vs {len(geoms)} geometries")
    else:
        has_emb = sum(1 for adj in embedded if adj)
        emb_edges = sum(len(adj) for adj in embedded) // 2
        print(f"  Connected geometries: {has_emb}/{len(geoms)}")
        print(f"  Total edges: {emb_edges}")

        # Country adjacency from embedded graph
        country_adj_emb = {}
        for i, adj_list in enumerate(embedded):
            cc_i = geoms[i].get("properties", {}).get("cntr_code", "")
            for j in adj_list:
                cc_j = geoms[j].get("properties", {}).get("cntr_code", "")
                if cc_i and cc_j and cc_i != cc_j:
                    country_adj_emb.setdefault(cc_i, set()).add(cc_j)
        all_codes = {g.get("properties", {}).get("cntr_code", "") for g in geoms} - {""}
        no_adj_emb = all_codes - set(country_adj_emb.keys())
        print(f"  Countries with cross-border adjacency: {len(country_adj_emb)}/{len(all_codes)}")
        if no_adj_emb:
            print(f"  Countries WITHOUT adjacency: {sorted(no_adj_emb)}")

        # Compare embedded vs arc-based
        if has_arc_neighbors > 0:
            extra_embedded = has_emb - has_arc_neighbors
            extra_edges = emb_edges - arc_edges
            print(f"  vs arc-based: {extra_embedded:+d} connected geometries, {extra_edges:+d} edges")

    # ── CHECK 5: Geometry Quality ───────────────────────────────
    print("\n── GEOMETRY QUALITY ──")
    suspicious = []
    all_bounds = []
    for g in geoms:
        bbox = _geometry_bbox(g, arc_bboxes)
        if bbox:
            all_bounds.append(bbox)

    if all_bounds:
        minx = min(b[0] for b in all_bounds)
        miny = min(b[1] for b in all_bounds)
        maxx = max(b[2] for b in all_bounds)
        maxy = max(b[3] for b in all_bounds)
        full_area = bbox_area((minx, miny, maxx, maxy))
        print(f"  Extent: ({minx:.2f}, {miny:.2f}) to ({maxx:.2f}, {maxy:.2f})")

        for g in geoms:
            bbox = _geometry_bbox(g, arc_bboxes)
            if bbox and full_area > 0 and bbox_area(bbox) / full_area > 0.5:
                props = g.get("properties", {})
                suspicious.append(f"{props.get('id')} ({props.get('cntr_code')})")

        if suspicious:
            print(f"  Giant artifacts (>50% extent): {suspicious[:5]}")
        else:
            print("  Giant artifacts: none")

    # Country code distribution
    cc_counts = Counter(g.get("properties", {}).get("cntr_code", "") for g in geoms)
    cc_counts.pop("", None)
    print(f"  Unique country codes: {len(cc_counts)}")
    print(f"  Top 10 countries by feature count:")
    for cc, cnt in cc_counts.most_common(10):
        print(f"    {cc}: {cnt}")

    # ── SUMMARY ─────────────────────────────────────────────────
    print("\n" + "=" * 60)
    issues = []
    if missing_id > 0:
        issues.append(f"{missing_id} features missing properties.id")
    if missing_cntr > 0:
        issues.append(f"{missing_cntr} features missing cntr_code")
    if dups:
        issues.append(f"{len(dups)} duplicate IDs")
    if numeric_top_ids > 0:
        issues.append("Top-level IDs are numeric (should be string)")
    if shared == 0 and embedded is None:
        issues.append("CRITICAL: No shared arcs AND no embedded neighbor graph!")
    elif shared == 0:
        issues.append("No shared arcs (embedded graph available as fallback)")

    if issues:
        print("ISSUES FOUND:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("ALL CHECKS PASSED")
    print("=" * 60)


if __name__ == "__main__":
    main()
