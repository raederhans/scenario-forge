from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
import pyogrio
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point, box, shape
from shapely.ops import linemerge, unary_union
from topojson import Topology

from map_builder.transport_workbench_contracts import finalize_transport_manifest


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CACHE_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "road"
PBF_PATH = SOURCE_CACHE_DIR / "japan-latest.osm.pbf"
N06_GEOJSON_PATH = SOURCE_CACHE_DIR / "N06-24_GML" / "UTF-8" / "N06-24_HighwaySection.geojson"
N06_FALLBACK_SHP_PATH = SOURCE_CACHE_DIR / "N06-24_GML" / "Shift-JIS" / "N06-24_HighwaySection.shp"
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_road" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_road"
ROADS_TOPO_PATH = OUTPUT_DIR / "roads.topo.json"
ROAD_LABELS_PATH = OUTPUT_DIR / "road_labels.geojson"
PREVIEW_ROADS_TOPO_PATH = OUTPUT_DIR / "roads.preview.topo.json"
PREVIEW_ROAD_LABELS_PATH = OUTPUT_DIR / "road_labels.preview.geojson"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"

ROAD_HIGHWAY_VALUES = (
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
)

ROAD_CLASSES = ("motorway", "trunk", "primary")
LABEL_MIN_LENGTH_METERS = {
    "motorway": 7_000.0,
    "trunk": 9_000.0,
    "primary": 12_000.0,
}
PREVIEW_MIN_LENGTH_METERS = {
    "motorway": 4_000.0,
    "trunk": 9_000.0,
    "primary": 16_000.0,
}
CLASS_PRIORITY = {"motorway": 3, "trunk": 2, "primary": 1}
SIMPLIFY_METERS = 18.0
N06_MATCH_DISTANCE_METERS = 450.0
MERGE_CRS = "EPSG:3857"
TOPO_PREQUANTIZE = 1_000_000
QUERY = "highway IN ('motorway','motorway_link','trunk','trunk_link','primary','primary_link')"
TOKYO_METRO_BOX = box(138.75, 35.15, 140.35, 36.2)
OSAKA_METRO_BOX = box(134.55, 34.2, 136.05, 35.15)
OTHER_TAG_RE = re.compile(r'"([^"]+)"=>"((?:[^"\\]|\\.)*)"')


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def ensure_sources_exist() -> None:
    missing = [path for path in (PBF_PATH, RECIPE_PATH) if not path.exists()]
    if missing:
        joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(f"Missing required Japan road source inputs: {joined}")
    if not N06_GEOJSON_PATH.exists() and not N06_FALLBACK_SHP_PATH.exists():
        raise SystemExit(
            "Missing N06 extracted source. Expected either "
            f"{N06_GEOJSON_PATH.relative_to(ROOT)} or {N06_FALLBACK_SHP_PATH.relative_to(ROOT)}."
        )


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    if compact:
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    else:
        text = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    path.write_text(text, encoding="utf-8")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_n06_source_info() -> dict[str, Any]:
    if N06_GEOJSON_PATH.exists():
        path = N06_GEOJSON_PATH
        return {
            "path": path,
            "member": "UTF-8/N06-24_HighwaySection.geojson",
            "encoding": "utf-8",
        }
    return {
        "path": N06_FALLBACK_SHP_PATH,
        "member": "Shift-JIS/N06-24_HighwaySection.shp",
        "encoding": "cp932",
    }


def parse_other_tags(raw_value: Any) -> dict[str, str]:
    text = str(raw_value or "").strip()
    if not text:
        return {}
    result: dict[str, str] = {}
    for key, value in OTHER_TAG_RE.findall(text):
        result[key] = value.replace('\\"', '"')
    return result


def normalize_display_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def normalize_match_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def iter_lines(geom):
    if geom is None or geom.is_empty:
        return
    if isinstance(geom, LineString):
        yield geom
        return
    if isinstance(geom, MultiLineString):
        for line in geom.geoms:
            if line and not line.is_empty:
                yield line
        return
    if isinstance(geom, GeometryCollection):
        for part in geom.geoms:
            yield from iter_lines(part)


def project_length_meters(geom) -> float:
    return float(gpd.GeoSeries([geom], crs="EPSG:4326").to_crs(MERGE_CRS).length.iloc[0])


def simplify_linestring(geom):
    simplified = gpd.GeoSeries([geom], crs="EPSG:4326").to_crs(MERGE_CRS).simplify(
        SIMPLIFY_METERS,
        preserve_topology=False,
    ).to_crs("EPSG:4326").iloc[0]
    return simplified if simplified and not simplified.is_empty else geom


def read_n06_sections(route_mask) -> gpd.GeoDataFrame:
    source_info = get_n06_source_info()
    path = source_info["path"]
    encoding = source_info["encoding"]
    n06 = gpd.read_file(path, encoding=encoding)
    source_member = str(path.relative_to(ROOT)).replace("\\", "/")
    if n06.crs is None:
        n06 = n06.set_crs("EPSG:4326")
    else:
        n06 = n06.to_crs("EPSG:4326")
    n06 = n06.loc[n06.geometry.notnull()].copy()
    n06 = n06.loc[n06.geometry.intersects(route_mask)].copy()
    n06["geometry"] = n06.geometry.intersection(route_mask)
    n06 = n06.loc[~n06.geometry.is_empty].copy()
    n06["n06_official_name"] = n06["N06_007"].map(normalize_display_text)
    n06["n06_official_name_key"] = n06["n06_official_name"].map(normalize_match_key)
    n06["n06_road_type_code"] = n06["N06_008"].astype(str).str.strip()
    n06["n06_service_status_code"] = n06["N06_009"].astype(str).str.strip()
    n06["n06_source_member"] = source_member
    return n06[[
        "n06_official_name",
        "n06_official_name_key",
        "n06_road_type_code",
        "n06_service_status_code",
        "n06_source_member",
        "geometry",
    ]]


def read_osm_roads(route_mask) -> gpd.GeoDataFrame:
    os.environ["OSM_USE_CUSTOM_INDEXING"] = "NO"
    roads = pyogrio.read_dataframe(
        PBF_PATH,
        layer="lines",
        where=QUERY,
        bbox=route_mask.bounds,
        columns=["osm_id", "name", "highway", "other_tags", "z_order"],
    )
    if roads.crs is None:
        roads = roads.set_crs("EPSG:4326")
    else:
        roads = roads.to_crs("EPSG:4326")
    roads = roads.loc[roads.geometry.notnull()].copy()
    roads = roads.loc[roads.geometry.intersects(route_mask)].copy()
    roads["geometry"] = roads.geometry.intersection(route_mask)
    roads = roads.loc[~roads.geometry.is_empty].copy()

    parsed_tags = roads["other_tags"].map(parse_other_tags)
    roads["name_ja"] = parsed_tags.map(lambda tags: normalize_display_text(tags.get("name:ja")))
    roads["ref"] = parsed_tags.map(
        lambda tags: normalize_display_text(tags.get("ref")) or normalize_display_text(tags.get("int_ref"))
    )
    roads["int_ref"] = parsed_tags.map(lambda tags: normalize_display_text(tags.get("int_ref")))
    roads["name"] = roads["name_ja"].where(roads["name_ja"].notna(), roads["name"].map(normalize_display_text))
    roads["name_key"] = roads["name"].map(normalize_match_key)
    roads["ref_key"] = roads["ref"].map(normalize_match_key)
    roads["road_class"] = roads["highway"].astype(str).str.replace("_link", "", regex=False)
    roads["is_link"] = roads["highway"].astype(str).str.endswith("_link")
    roads["dense_metro"] = roads.geometry.intersects(TOKYO_METRO_BOX) | roads.geometry.intersects(OSAKA_METRO_BOX)
    roads["source"] = "osm_jp"
    roads["official_name"] = None
    roads["official_ref"] = None
    roads["n06_match_distance_m"] = None
    return roads[[
        "osm_id",
        "name",
        "name_key",
        "ref",
        "ref_key",
        "int_ref",
        "highway",
        "road_class",
        "is_link",
        "dense_metro",
        "source",
        "official_name",
        "official_ref",
        "n06_match_distance_m",
        "geometry",
    ]]


def apply_n06_hardening(osm_roads: gpd.GeoDataFrame, n06_sections: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if osm_roads.empty or n06_sections.empty:
        osm_roads["source_flags"] = osm_roads.apply(
            lambda row: ["default_filtered"] if row["is_link"] else [],
            axis=1,
        )
        return osm_roads

    motorways = osm_roads.loc[osm_roads["road_class"] == "motorway"].copy()
    if motorways.empty:
        osm_roads["source_flags"] = osm_roads.apply(
            lambda row: ["default_filtered"] if row["is_link"] else [],
            axis=1,
        )
        return osm_roads

    motorway_lines = motorways.to_crs(MERGE_CRS)
    motorway_points = motorway_lines.copy()
    motorway_points["geometry"] = motorway_lines.geometry.interpolate(0.5, normalized=True)
    n06_proj = n06_sections.to_crs(MERGE_CRS)
    joined = gpd.sjoin_nearest(
        motorway_points,
        n06_proj,
        how="left",
        max_distance=N06_MATCH_DISTANCE_METERS,
        distance_col="match_distance_m",
    )
    joined = joined[[
        "osm_id",
        "n06_official_name",
        "n06_official_name_key",
        "n06_road_type_code",
        "n06_service_status_code",
        "n06_source_member",
        "match_distance_m",
    ]]
    joined = joined.rename(columns={"match_distance_m": "n06_match_distance_m"})
    motorways = motorways.merge(joined, on="osm_id", how="left")

    official_name = motorways["n06_official_name"].where(motorways["n06_official_name"].notna(), motorways["official_name"])
    motorways["official_name"] = official_name.map(normalize_display_text)
    motorways["source"] = motorways["official_name"].notna().map(
        lambda matched: "osm_jp_n06_hardened" if matched else "osm_jp"
    )
    motorways["name_conflict"] = (
        motorways["official_name"].map(normalize_match_key) != motorways["name_key"]
    ) & motorways["official_name"].notna() & motorways["name"].notna()
    motorways.loc[motorways["name_conflict"], "source"] = "osm_jp_n06_conflict"
    motorways["official_ref"] = motorways["ref"].where(motorways["official_name"].notna(), None)
    motorways["source_flags"] = motorways.apply(
        lambda row: sorted(
            {
                *(["default_filtered"] if row["is_link"] else []),
                *(["n06_matched"] if row["official_name"] else []),
                *(["name_conflict"] if row["name_conflict"] else []),
            }
        ),
        axis=1,
    )

    base = osm_roads.loc[osm_roads["road_class"] != "motorway"].copy()
    base["source_flags"] = base.apply(
        lambda row: ["default_filtered"] if row["is_link"] else [],
        axis=1,
    )
    combined = pd.concat([
        base,
        motorways[base.columns.tolist() + ["source_flags"]] if "source_flags" not in base.columns else motorways,
    ], ignore_index=True, sort=False)
    combined["official_name"] = combined["official_name"].map(normalize_display_text)
    combined["official_ref"] = combined["official_ref"].map(normalize_display_text)
    combined["source_flags"] = combined["source_flags"].apply(lambda value: value if isinstance(value, list) else [])
    return gpd.GeoDataFrame(combined, geometry="geometry", crs="EPSG:4326")


def explode_merged_lines(geom):
    merged = linemerge(unary_union([geom]))
    return [line for line in iter_lines(merged) if line and not line.is_empty]


def merge_roads(roads: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, int]:
    grouped_rows: list[dict[str, Any]] = []
    merge_before_count = int(len(roads))
    working = roads.copy()
    working["source_flags_key"] = working["source_flags"].apply(lambda flags: "|".join(sorted(flags)))
    group_columns = [
        "road_class",
        "is_link",
        "dense_metro",
        "name",
        "ref",
        "official_name",
        "official_ref",
        "source",
        "source_flags_key",
    ]
    for group_key, group in working.groupby(group_columns, dropna=False, sort=False):
        projected = gpd.GeoSeries(group.geometry.tolist(), crs="EPSG:4326").to_crs(MERGE_CRS)
        merged = unary_union(projected.tolist())
        if not isinstance(merged, LineString):
          merged = linemerge(merged)
        for line in iter_lines(merged):
            simplified = gpd.GeoSeries([line], crs=MERGE_CRS).simplify(
                SIMPLIFY_METERS,
                preserve_topology=False,
            ).to_crs("EPSG:4326").iloc[0]
            if simplified.is_empty:
                continue
            flags = [flag for flag in str(group_key[-1]).split("|") if flag]
            row = dict(zip(group_columns, group_key))
            row.update({
                "id": f"road::{len(grouped_rows) + 1}",
                "source_flags": flags,
                "n06_match_distance_m": float(group["n06_match_distance_m"].min()) if group["n06_match_distance_m"].notna().any() else None,
                "length_m": float(gpd.GeoSeries([simplified], crs="EPSG:4326").to_crs(MERGE_CRS).length.iloc[0]),
                "geometry": simplified,
            })
            grouped_rows.append(row)
    merged_roads = gpd.GeoDataFrame(grouped_rows, geometry="geometry", crs="EPSG:4326")
    merged_roads["priority"] = merged_roads["road_class"].map(CLASS_PRIORITY).fillna(0).astype(int)
    return merged_roads, merge_before_count


def build_label_candidates(roads: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    rows: list[dict[str, Any]] = []
    for road in roads.itertuples(index=False):
        if not getattr(road, "ref", None):
            continue
        if getattr(road, "is_link", False):
            continue
        min_length = LABEL_MIN_LENGTH_METERS.get(getattr(road, "road_class", ""), 10_000.0)
        if float(getattr(road, "length_m", 0.0)) < min_length:
            continue
        point: Point = road.geometry.interpolate(0.5, normalized=True)
        rows.append({
            "id": f"road_label::{len(rows) + 1}",
            "road_id": road.id,
            "ref": road.ref,
            "road_class": road.road_class,
            "source": road.source,
            "priority": road.priority,
            "geometry": point,
        })
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def build_preview_roads(roads: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if roads.empty:
        return roads.copy()
    preview = roads.loc[roads["road_class"].isin(PREVIEW_MIN_LENGTH_METERS.keys())].copy()
    preview["preview_min_length_m"] = preview["road_class"].map(PREVIEW_MIN_LENGTH_METERS).fillna(0.0)
    preview = preview.loc[preview["length_m"] >= preview["preview_min_length_m"]].copy()
    preview = preview.loc[
        (preview["road_class"] != "primary")
        | (~preview["dense_metro"])
    ].copy()
    return gpd.GeoDataFrame(
        preview.drop(columns=["preview_min_length_m"]),
        geometry="geometry",
        crs=roads.crs,
    )


def build_topology_payload(roads: gpd.GeoDataFrame) -> dict[str, Any]:
    safe_roads = roads.copy()
    for column in safe_roads.columns:
        if column == "geometry":
            continue
        safe_roads[column] = safe_roads[column].astype(object).where(pd.notna(safe_roads[column]), None)
    topo = Topology(
        safe_roads,
        object_name="roads",
        topology=True,
        prequantize=TOPO_PREQUANTIZE,
        topoquantize=False,
        presimplify=False,
        toposimplify=False,
        shared_coords=True,
    )
    return topo.to_dict()


def feature_collection(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json(drop_id=True, ensure_ascii=False))


def count_region_features(gdf: gpd.GeoDataFrame, region_geom) -> int:
    return int(gdf.geometry.intersects(region_geom).sum())


def main() -> None:
    ensure_sources_exist()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    recipe = read_json(RECIPE_PATH)
    route_mask = load_route_mask()
    osm_raw = read_osm_roads(route_mask)
    n06 = read_n06_sections(route_mask)
    hardened = apply_n06_hardening(osm_raw, n06)
    merged_roads, merge_before_count = merge_roads(hardened)
    road_labels = build_label_candidates(merged_roads)
    preview_roads = build_preview_roads(merged_roads)
    preview_road_labels = build_label_candidates(preview_roads)

    roads_topology = build_topology_payload(merged_roads[[
        "id",
        "name",
        "ref",
        "official_name",
        "official_ref",
        "road_class",
        "is_link",
        "dense_metro",
        "priority",
        "source",
        "source_flags",
        "n06_match_distance_m",
        "length_m",
        "geometry",
    ]])
    preview_roads_topology = build_topology_payload(preview_roads[[
        "id",
        "name",
        "ref",
        "official_name",
        "official_ref",
        "road_class",
        "is_link",
        "dense_metro",
        "priority",
        "source",
        "source_flags",
        "n06_match_distance_m",
        "length_m",
        "geometry",
    ]])
    write_json(ROADS_TOPO_PATH, roads_topology, compact=True)
    write_json(ROAD_LABELS_PATH, feature_collection(road_labels), compact=True)
    write_json(PREVIEW_ROADS_TOPO_PATH, preview_roads_topology, compact=True)
    write_json(PREVIEW_ROAD_LABELS_PATH, feature_collection(preview_road_labels), compact=True)

    n06_source_info = get_n06_source_info()
    n06_source_path = n06_source_info["path"]
    source_signature = {
        "geofabrik_japan_osm_pbf": {
            "filename": PBF_PATH.name,
            "size_bytes": PBF_PATH.stat().st_size,
            "sha256": file_sha256(PBF_PATH),
        },
        "mlit_n06_2024": {
            "filename": n06_source_path.name,
            "size_bytes": n06_source_path.stat().st_size,
            "sha256": file_sha256(n06_source_path),
        },
    }

    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_road_v1",
        "raw_osm_segment_count": int(len(osm_raw)),
        "clipped_osm_segment_count": int(len(hardened)),
        "included_by_class": {
            road_class: int((hardened["road_class"] == road_class).sum())
            for road_class in ROAD_CLASSES
        },
        "link_segment_count": int(hardened["is_link"].sum()),
        "dense_metro_segment_count": int(hardened["dense_metro"].sum()),
        "n06_feature_count": int(len(n06)),
        "n06_matched_count": int(hardened["source_flags"].apply(lambda flags: "n06_matched" in flags).sum()),
        "name_conflict_count": int(hardened["source_flags"].apply(lambda flags: "name_conflict" in flags).sum()),
        "merge_before_count": merge_before_count,
        "merge_after_count": int(len(merged_roads)),
        "label_candidate_count": int(len(road_labels)),
        "preview_feature_count": int(len(preview_roads)),
        "preview_label_candidate_count": int(len(preview_road_labels)),
        "regional_sample_counts": {
            "kanto": count_region_features(merged_roads, TOKYO_METRO_BOX),
            "kansai": count_region_features(merged_roads, OSAKA_METRO_BOX),
        },
        "preview_thresholds_m": PREVIEW_MIN_LENGTH_METERS,
        "recipe_version": recipe["version"],
        "source_policy": "local_source_cache_only",
        "n06_source_member": n06_source_info["member"],
        "n06_encoding": n06_source_info["encoding"],
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "source_signature": source_signature,
        "notes": [
            "Only motorway, trunk, primary and their *_link variants are ingested into this first preview pack.",
            "Service-like roads remain out of the pack and therefore cannot be toggled live yet.",
            "N06 hardening is applied conservatively to motorway segments using nearest official alignment within a fixed distance threshold."
        ],
    }
    write_json(AUDIT_PATH, audit)

    manifest = {
        "adapter_id": "japan_road_v1",
        "family": "road",
        "geometry_kind": "line",
        "country": "Japan",
        "schema_version": 1,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "distribution_tier": "single_pack",
        "paths": {
            "preview": {
                "roads": str(PREVIEW_ROADS_TOPO_PATH.relative_to(ROOT)).replace("\\", "/"),
                "road_labels": str(PREVIEW_ROAD_LABELS_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "roads": str(ROADS_TOPO_PATH.relative_to(ROOT)).replace("\\", "/"),
                "road_labels": str(ROAD_LABELS_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "source_signature": source_signature,
        "recipe_version": recipe["version"],
        "feature_counts": {
            "preview": {
                "roads": int(len(preview_roads)),
                "road_labels": int(len(preview_road_labels)),
            },
            "full": {
                "roads": int(len(merged_roads)),
                "road_labels": int(len(road_labels)),
            },
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_roads.py",
        "runtime_consumer": "transport_workbench_road_preview",
        "source_policy": "local_source_cache_only",
        "n06_source_member": n06_source_info["member"],
        "n06_encoding": n06_source_info["encoding"],
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
    }
    manifest = finalize_transport_manifest(
        manifest,
        default_variant="default",
        variants={
            "default": {
                "label": "default",
                "distribution_tier": manifest["distribution_tier"],
                "paths": manifest["paths"],
                "feature_counts": manifest["feature_counts"],
            }
        },
    )
    write_json(MANIFEST_PATH, manifest)
    print(
        f"Wrote {PREVIEW_ROADS_TOPO_PATH.relative_to(ROOT)} ({len(preview_roads)} roads), "
        f"{ROADS_TOPO_PATH.relative_to(ROOT)} ({len(merged_roads)} roads), "
        f"{PREVIEW_ROAD_LABELS_PATH.relative_to(ROOT)} ({len(preview_road_labels)} labels), and "
        f"{ROAD_LABELS_PATH.relative_to(ROOT)} ({len(road_labels)} labels)."
    )


if __name__ == "__main__":
    main()
