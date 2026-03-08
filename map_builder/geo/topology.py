"""TopoJSON construction helpers."""
from __future__ import annotations

import json
import math
import re
from collections import Counter

import geopandas as gpd
import topojson as tp

from map_builder import config as cfg
from map_builder.geo.utils import round_geometries


def compute_neighbor_graph(gdf: gpd.GeoDataFrame) -> list[list[int]]:
    """Compute spatial adjacency graph from a GeoDataFrame.

    Uses the GeoDataFrame's spatial index to find all pairs of
    geometries that intersect (share a boundary or overlap), then
    returns a list where neighbors[i] is a sorted list of geometry
    indices adjacent to geometry i.
    """
    geoms = list(gdf.geometry)
    n = len(geoms)
    adj = [set() for _ in range(n)]

    sindex = gdf.sindex

    for i in range(n):
        if geoms[i] is None or geoms[i].is_empty:
            continue
        # Query spatial index for candidate geometries
        try:
            candidates = list(sindex.query(geoms[i], predicate="intersects"))
        except TypeError:
            # Older geopandas: sindex.intersection returns bbox matches
            candidates = list(sindex.intersection(geoms[i].bounds))

        for j in candidates:
            j = int(j)
            if j <= i:
                continue  # Process each pair once
            if geoms[j] is None or geoms[j].is_empty:
                continue
            try:
                if geoms[i].intersects(geoms[j]):
                    adj[i].add(j)
                    adj[j].add(i)
            except Exception:
                continue

    return [sorted(s) for s in adj]


def _verify_geometry_order(
    gdf: gpd.GeoDataFrame, geometries: list[dict]
) -> bool:
    """Check that GeoDataFrame row order matches topology geometry order."""
    if "id" not in gdf.columns:
        return True  # Can't verify without IDs
    gdf_ids = list(gdf["id"].astype(str))
    topo_ids = [
        str(g.get("properties", {}).get("id", ""))
        for g in geometries
    ]
    if len(gdf_ids) != len(topo_ids):
        return False
    # Check first and last few entries
    sample_size = min(20, len(gdf_ids))
    return (
        gdf_ids[:sample_size] == topo_ids[:sample_size]
        and gdf_ids[-sample_size:] == topo_ids[-sample_size:]
    )


def _count_arc_sharing(geometries: list[dict]) -> dict:
    """Count arc-level sharing statistics from topology geometries."""
    arc_usage: Counter = Counter()

    def _collect(obj):
        if isinstance(obj, int):
            arc_usage[~obj if obj < 0 else obj] += 1
        elif isinstance(obj, list):
            for item in obj:
                _collect(item)

    for g in geometries:
        _collect(g.get("arcs", []))

    shared = sum(1 for c in arc_usage.values() if c > 1)
    single = sum(1 for c in arc_usage.values() if c == 1)
    return {"shared": shared, "single": single, "total_referenced": len(arc_usage)}


def _extract_country_code_from_id(value: object) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    prefix = text.split("_")[0].split("-")[0]
    if re.fullmatch(r"[A-Z]{2,3}", prefix):
        return prefix
    alpha_prefix = re.match(r"^[A-Z]{2,3}", prefix)
    return alpha_prefix.group(0) if alpha_prefix else ""


def _normalize_country_code(props: dict, stable_id: str) -> str:
    candidates = [
        props.get("cntr_code"),
        props.get("CNTR_CODE"),
        props.get("iso_a2"),
        props.get("ISO_A2"),
        props.get("iso_a2_eh"),
        props.get("ISO_A2_EH"),
        props.get("adm0_a2"),
        props.get("ADM0_A2"),
        _extract_country_code_from_id(stable_id),
    ]
    for candidate in candidates:
        code = str(candidate or "").strip().upper()
        if code in {"", "-99", "NONE", "NULL"}:
            continue
        code = re.sub(r"[^A-Z]", "", code)
        if re.fullmatch(r"[A-Z]{2,3}", code):
            return code
    return "UNK"


def _repair_geometry(geom):
    if geom is None or geom.is_empty:
        return None
    try:
        if geom.is_valid:
            return geom
    except Exception:
        pass
    try:
        if hasattr(geom, "make_valid"):
            geom = geom.make_valid()
        else:
            geom = geom.buffer(0)
    except Exception:
        try:
            geom = geom.buffer(0)
        except Exception:
            return None
    if geom is None or geom.is_empty:
        return None
    return geom


def build_topology(
    political: gpd.GeoDataFrame,
    ocean: gpd.GeoDataFrame,
    land: gpd.GeoDataFrame,
    urban: gpd.GeoDataFrame,
    physical: gpd.GeoDataFrame,
    rivers: gpd.GeoDataFrame,
    output_path,
    special_zones: gpd.GeoDataFrame | None = None,
    water_regions: gpd.GeoDataFrame | None = None,
    quantization: int = cfg.TOPOLOGY_QUANTIZATION,
) -> None:
    print("Building TopoJSON topology...")
    output_path = output_path

    def has_valid_bounds(gdf: gpd.GeoDataFrame) -> bool:
        if gdf.empty:
            return False
        bounds = gdf.total_bounds
        if len(bounds) != 4:
            return False
        minx, miny, maxx, maxy = bounds
        if not all(map(math.isfinite, [minx, miny, maxx, maxy])):
            return False
        if maxx - minx <= 0 or maxy - miny <= 0:
            return False
        return True

    def prune_columns(gdf: gpd.GeoDataFrame, layer_name: str) -> gpd.GeoDataFrame:
        if layer_name == "special_zones":
            keep_cols = ["id", "name", "label", "type", "claimants", "cntr_code", "geometry"]
        elif layer_name == "water_regions":
            keep_cols = [
                "id",
                "name",
                "label",
                "water_type",
                "region_group",
                "parent_id",
                "neighbors",
                "is_chokepoint",
                "interactive",
                "source_standard",
                "geometry",
            ]
        elif layer_name == "urban":
            keep_cols = [
                "id",
                "name",
                "featurecla",
                "FEATURECLA",
                "scalerank",
                "SCALERANK",
                "area_sqkm",
                "AREA_SQKM",
                "min_zoom",
                "MIN_ZOOM",
                "geometry",
            ]
        elif layer_name == "physical":
            keep_cols = [
                "id",
                "name",
                "name_en",
                "NAME",
                "NAME_EN",
                "featurecla",
                "FEATURECLA",
                "region",
                "REGION",
                "subregion",
                "SUBREGION",
                "geometry",
            ]
        elif layer_name == "rivers":
            keep_cols = [
                "id",
                "name",
                "name_en",
                "featurecla",
                "FEATURECLA",
                "scalerank",
                "SCALERANK",
                "min_zoom",
                "MIN_ZOOM",
                "geometry",
            ]
        else:
            # Preserve selected admin context/localized fields when present.
            keep_cols = [
                "id",
                "name",
                "cntr_code",
                "subregion",
                "SUBREGION",
                "region_un",
                "REGION_UN",
                "region_wb",
                "REGION_WB",
                "mapcolor7",
                "MAPCOLOR7",
                "mapcolor8",
                "MAPCOLOR8",
                "mapcolor9",
                "MAPCOLOR9",
                "admin1_group",
                "name_local",
                "constituent_country",
                "adm1_name",
                "detail_tier",
                "claim_status",
                "claimants",
                "partition_scheme",
                "sector_start_lon",
                "sector_end_lon",
                "__source",
                "geometry",
            ]
        existing = [col for col in keep_cols if col in gdf.columns]
        if "geometry" not in existing:
            existing.append("geometry")
        gdf = gdf[existing].copy()
        gdf = gdf.fillna("")
        return gdf

    def scrub_geometry(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        if gdf.empty:
            return gdf
        out = gdf.copy()
        out["geometry"] = out.geometry.apply(_repair_geometry)
        out = out[out.geometry.notna()]
        out = out[~out.geometry.is_empty]
        if hasattr(out.geometry, "is_valid"):
            invalid_mask = ~out.geometry.is_valid
            if invalid_mask.any():
                out.loc[invalid_mask, "geometry"] = out.loc[invalid_mask, "geometry"].apply(
                    _repair_geometry
                )
                out = out[out.geometry.notna()]
                out = out[~out.geometry.is_empty]
                out = out[out.geometry.is_valid]
        return out

    def write_layer_geojson(gdf: gpd.GeoDataFrame | None, layer_name: str) -> None:
        if gdf is None or gdf.empty:
            return
        try:
            out_gdf = gdf.to_crs("EPSG:4326").copy()
            out_gdf = prune_columns(out_gdf, layer_name)
            geojson_path = output_path.with_name(f"{layer_name}.geojson")
            geojson_path.write_text(out_gdf.to_json(drop_id=True), encoding="utf-8")
            print(f"{layer_name} GeoJSON saved to {geojson_path}")
        except Exception as exc:
            print(f"{layer_name} GeoJSON export skipped: {exc}")

    candidates = [("political", political)]
    if special_zones is not None:
        write_layer_geojson(special_zones, "special_zones")
        candidates.append(("special_zones", special_zones))
    if water_regions is not None:
        write_layer_geojson(water_regions, "water_regions")
        candidates.append(("water_regions", water_regions))
    candidates.extend(
        [
            ("ocean", ocean),
            ("land", land),
            ("urban", urban),
            ("physical", physical),
            ("rivers", rivers),
        ]
    )

    layer_names: list[str] = []
    layer_gdfs: list[gpd.GeoDataFrame] = []
    cleaned_political: gpd.GeoDataFrame | None = None

    for name, gdf in candidates:
        gdf = gdf.to_crs("EPSG:4326")
        gdf = prune_columns(gdf, name)
        gdf = scrub_geometry(gdf)
        gdf = round_geometries(gdf)
        # Rounding can create self-intersections on tight rings; scrub again.
        gdf = scrub_geometry(gdf)
        if not has_valid_bounds(gdf):
            if name == "political":
                print("Political layer is empty or invalid; cannot build topology.")
                raise SystemExit(1)
            print(f"Skipping empty/invalid layer: {name}")
            continue
        if name == "political":
            cleaned_political = gdf.reset_index(drop=True)
        layer_names.append(name)
        layer_gdfs.append(gdf)

    # ── Build base topology ──────────────────────────────────────
    def build_topo(prequantize_value):
        return tp.Topology(
            layer_gdfs,
            object_name=layer_names,
            prequantize=prequantize_value,
            topology=True,
            presimplify=False,
            toposimplify=False,
            shared_coords=True,
        ).to_json()

    try:
        topo_json = build_topo(quantization)
        if "NaN" in topo_json:
            raise ValueError("Generated TopoJSON contains NaN")
    except Exception as exc:
        print(f"TopoJSON build failed with quantization; retrying without quantization: {exc}")
        topo_json = build_topo(False)
        if "NaN" in topo_json:
            raise ValueError("Generated TopoJSON contains NaN")

    # ── Post-process: inject neighbor graph + fix IDs ────────────
    topo_dict = json.loads(topo_json)
    political_obj = topo_dict.get("objects", {}).get("political", {})
    geometries = political_obj.get("geometries", [])

    if not geometries:
        print("WARNING: No political geometries in topology output!")
        output_path.write_text(topo_json, encoding="utf-8")
        return

    # 1. Fix geometry IDs + country code normalization
    id_set: set[str] = set()
    for i, geom in enumerate(geometries):
        props = geom.get("properties")
        if not isinstance(props, dict):
            props = {}
            geom["properties"] = props

        stable_id = str(props.get("id", "")).strip() or str(geom.get("id", "")).strip()
        if not stable_id:
            stable_id = f"feature-{i}"
        # Ensure uniqueness
        if stable_id in id_set:
            stable_id = f"{stable_id}__dup{i}"
        id_set.add(stable_id)

        props["id"] = stable_id
        props["cntr_code"] = _normalize_country_code(props, stable_id)
        geom["id"] = stable_id

    # 2. Count arc-level sharing (from the topojson library output)
    arc_stats = _count_arc_sharing(geometries)
    print(f"  - Arc sharing: {arc_stats['shared']} shared, {arc_stats['single']} single-use")

    # 3. Compute spatial neighbor graph from the cleaned political GeoDataFrame
    neighbor_graph: list[list[int]] | None = None
    if cleaned_political is not None and len(cleaned_political) == len(geometries):
        order_ok = _verify_geometry_order(cleaned_political, geometries)
        if not order_ok:
            print("  - WARNING: GeoDataFrame/topology order mismatch; building ID mapping...")
            # Build a mapping from topology index to GeoDataFrame index
            topo_id_to_idx = {}
            for i, geom in enumerate(geometries):
                topo_id_to_idx[str(geom.get("properties", {}).get("id", ""))] = i
            gdf_id_to_idx = {}
            if "id" in cleaned_political.columns:
                for i, fid in enumerate(cleaned_political["id"]):
                    gdf_id_to_idx[str(fid)] = i

            raw_neighbors = compute_neighbor_graph(cleaned_political)

            # Remap indices from GeoDataFrame space to topology space
            neighbor_graph = [[] for _ in range(len(geometries))]
            gdf_ids = list(cleaned_political["id"].astype(str)) if "id" in cleaned_political.columns else []
            for gdf_i, adj_list in enumerate(raw_neighbors):
                gdf_fid = gdf_ids[gdf_i] if gdf_i < len(gdf_ids) else ""
                topo_i = topo_id_to_idx.get(gdf_fid, -1)
                if topo_i < 0:
                    continue
                for gdf_j in adj_list:
                    gdf_fid_j = gdf_ids[gdf_j] if gdf_j < len(gdf_ids) else ""
                    topo_j = topo_id_to_idx.get(gdf_fid_j, -1)
                    if topo_j >= 0:
                        neighbor_graph[topo_i].append(topo_j)
            neighbor_graph = [sorted(adj) for adj in neighbor_graph]
        else:
            print("  - GeoDataFrame/topology order verified OK")
            neighbor_graph = compute_neighbor_graph(cleaned_political)
    else:
        print("  - WARNING: Cannot compute neighbor graph (cleaned political unavailable or size mismatch)")

    if neighbor_graph is not None and len(neighbor_graph) == len(geometries):
        political_obj["computed_neighbors"] = neighbor_graph
        has_neighbors = sum(1 for adj in neighbor_graph if len(adj) > 0)
        total_edges = sum(len(adj) for adj in neighbor_graph) // 2
        print(f"  - Spatial neighbor graph: {has_neighbors}/{len(geometries)} connected, {total_edges} edges")

        # Also compute country-level adjacency for logging
        country_adj: dict[str, set[str]] = {}
        for i, adj_list in enumerate(neighbor_graph):
            cc_i = str(geometries[i].get("properties", {}).get("cntr_code", ""))
            for j in adj_list:
                cc_j = str(geometries[j].get("properties", {}).get("cntr_code", ""))
                if cc_i and cc_j and cc_i != cc_j:
                    country_adj.setdefault(cc_i, set()).add(cc_j)
        print(f"  - Country adjacency: {len(country_adj)} countries with cross-border neighbors")

    # 4. Final validation
    missing_id_count = 0
    missing_code_count = 0
    mismatch_id_count = 0
    for geom in geometries:
        props = geom.get("properties", {})
        pid = str(props.get("id", "")).strip()
        gid = str(geom.get("id", "")).strip()
        code = str(props.get("cntr_code", "")).strip()
        if not pid:
            missing_id_count += 1
        if not code:
            missing_code_count += 1
        if pid != gid:
            mismatch_id_count += 1
    if missing_id_count or missing_code_count or mismatch_id_count:
        raise ValueError(
            "Political topology schema invalid: "
            f"missing id={missing_id_count}, missing cntr_code={missing_code_count}, "
            f"id mismatches={mismatch_id_count}"
        )

    # Verify top-level IDs are strings, not numeric indices
    sample_ids = [g.get("id") for g in geometries[:5]]
    print(f"  - Sample geometry IDs: {sample_ids}")

    # ── Write final output ───────────────────────────────────────
    topo_json = json.dumps(topo_dict, separators=(",", ":"))
    output_path.write_text(topo_json, encoding="utf-8")

    print(f"TopoJSON saved to {output_path}")
    print(f"  - Objects: {list(topo_dict.get('objects', {}).keys())}")
    print(f"  - Total arcs: {len(topo_dict.get('arcs', []))}")
    print(f"  - Political geometries: {len(geometries)}")


def build_named_layer_topology(
    gdf: gpd.GeoDataFrame,
    output_path,
    *,
    object_name: str,
    quantization: int = cfg.TOPOLOGY_QUANTIZATION,
) -> None:
    print(f"Building context TopoJSON layer: {object_name}")
    output_path = output_path

    if gdf is None or gdf.empty:
        topo_dict = {
            "type": "Topology",
            "objects": {
                object_name: {
                    "type": "GeometryCollection",
                    "geometries": [],
                },
            },
            "arcs": [],
        }
        output_path.write_text(json.dumps(topo_dict, separators=(",", ":")), encoding="utf-8")
        print(f"Context TopoJSON saved to {output_path} (empty layer).")
        return

    out = gdf.to_crs("EPSG:4326").copy()
    out["geometry"] = out.geometry.apply(_repair_geometry)
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    if out.empty:
        return build_named_layer_topology(
            gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326"),
            output_path,
            object_name=object_name,
            quantization=quantization,
        )

    non_geometry_cols = [column for column in out.columns if column != "geometry"]
    out = out[non_geometry_cols + ["geometry"]].fillna("")
    out = round_geometries(out)
    out["geometry"] = out.geometry.apply(_repair_geometry)
    out = out[out.geometry.notna() & ~out.geometry.is_empty].copy()
    if out.empty:
        return build_named_layer_topology(
            gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326"),
            output_path,
            object_name=object_name,
            quantization=quantization,
        )

    topo = tp.Topology(
        [out],
        object_name=[object_name],
        prequantize=quantization,
        topology=True,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    ).to_json()
    output_path.write_text(topo, encoding="utf-8")
    print(f"Context TopoJSON saved to {output_path}")


def build_political_only_topology(
    political: gpd.GeoDataFrame,
    output_path,
    quantization: int = cfg.TOPOLOGY_QUANTIZATION,
) -> None:
    empty = gpd.GeoDataFrame(columns=["geometry"], geometry="geometry", crs="EPSG:4326")
    build_topology(
        political=political,
        ocean=empty,
        land=empty,
        urban=empty,
        physical=empty,
        rivers=empty,
        output_path=output_path,
        special_zones=None,
        quantization=quantization,
    )
