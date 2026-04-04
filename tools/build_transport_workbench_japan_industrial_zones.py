from __future__ import annotations

import hashlib
import json
import os
import re
import time
import unicodedata
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

from map_builder.transport_workbench_contracts import finalize_transport_manifest


ROOT = Path(__file__).resolve().parents[1]
RECIPE_PATH = ROOT / "data" / "transport_layers" / "japan_industrial_zones" / "source_recipe.manual.json"
OUTPUT_DIR = ROOT / "data" / "transport_layers" / "japan_industrial_zones"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"
AUDIT_PATH = OUTPUT_DIR / "build_audit.json"
INTERNAL_FULL_OUTPUT_PATH = OUTPUT_DIR / "industrial_zones.internal.geojson"
INTERNAL_PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "industrial_zones.internal.preview.geojson"
OPEN_FULL_OUTPUT_PATH = OUTPUT_DIR / "industrial_zones.open.geojson"
OPEN_PREVIEW_OUTPUT_PATH = OUTPUT_DIR / "industrial_zones.open.preview.geojson"
CARRIER_PATH = ROOT / "data" / "transport_layers" / "japan_corridor" / "carrier.json"
SOURCE_CACHE_DIR = ROOT / ".runtime" / "source-cache" / "transport" / "japan" / "industrial_zones"
L05_ARCHIVE_DIR = SOURCE_CACHE_DIR / "L05"
L05_EXTRACT_DIR = SOURCE_CACHE_DIR / "_extract"
OSM_ARCHIVE_DIR = SOURCE_CACHE_DIR / "osm_geofabrik"
PREFECTURE_CODES = [f"{code:02d}" for code in range(1, 47)]
L05_1_PREFECTURE_CODES = PREFECTURE_CODES
L05_2_PREFECTURE_CODES = [code for code in PREFECTURE_CODES if code not in {"29"}]
L05_BASE_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/L05/L05-09"
OSM_REGION_FILES = {
    "hokkaido": "https://download.geofabrik.de/asia/japan/hokkaido-latest-free.shp.zip",
    "tohoku": "https://download.geofabrik.de/asia/japan/tohoku-latest-free.shp.zip",
    "kanto": "https://download.geofabrik.de/asia/japan/kanto-latest-free.shp.zip",
    "chubu": "https://download.geofabrik.de/asia/japan/chubu-latest-free.shp.zip",
    "kansai": "https://download.geofabrik.de/asia/japan/kansai-latest-free.shp.zip",
    "chugoku": "https://download.geofabrik.de/asia/japan/chugoku-latest-free.shp.zip",
    "shikoku": "https://download.geofabrik.de/asia/japan/shikoku-latest-free.shp.zip",
    "kyushu": "https://download.geofabrik.de/asia/japan/kyushu-latest-free.shp.zip",
}
GEOFABRIK_REQUIRED_MEMBERS = {
    "gis_osm_landuse_a_free_1.shp",
    "gis_osm_landuse_a_free_1.dbf",
    "gis_osm_pois_a_free_1.shp",
    "gis_osm_pois_a_free_1.dbf",
}
OTHER_TAG_RE = re.compile(r'"([^"]+)"=>"((?:[^"\\]|\\.)*)"')
COASTAL_INLAND_LABELS = {
    "1": "coastal",
    "2": "inland",
}
DOWNLOAD_ATTEMPTS = 4
RETRYABLE_HTTP_STATUS = {500, 502, 503, 504}
DOWNLOAD_HEADERS = {
    "User-Agent": "mapcreator/1.0 (+https://github.com/openai/codex)",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> Any:
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


def bundle_sha256(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(path.name.encode("utf-8"))
        digest.update(file_sha256(path).encode("ascii"))
    return digest.hexdigest()


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_match_key(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def parse_other_tags(raw_value: Any) -> dict[str, str]:
    text = str(raw_value or "").strip()
    if not text:
        return {}
    result: dict[str, str] = {}
    for key, value in OTHER_TAG_RE.findall(text):
        result[key] = value.replace('\\"', '"')
    return result


def parse_year(value: Any) -> int | None:
    text = normalize_text(value)
    if not text or text in {"0", "9999"}:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def build_id(*parts: str) -> str:
    digest = hashlib.sha1()
    for part in parts:
        digest.update(part.encode("utf-8"))
    return f"jp-industrial-{digest.hexdigest()[:12]}"


def ensure_required_inputs() -> None:
    missing = [path for path in (RECIPE_PATH, CARRIER_PATH) if not path.exists()]
    if missing:
        joined = ", ".join(str(path.relative_to(ROOT)).replace("\\", "/") for path in missing)
        raise SystemExit(f"Missing required Japan industrial inputs: {joined}")


def ensure_download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 0:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers=DOWNLOAD_HEADERS)
    temp_path = destination.with_suffix(f"{destination.suffix}.part")
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response, temp_path.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
            for replace_attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
                try:
                    temp_path.replace(destination)
                    break
                except PermissionError:
                    if replace_attempt >= DOWNLOAD_ATTEMPTS:
                        raise
                    time.sleep(0.75 * replace_attempt)
            return
        except urllib.error.HTTPError as error:
            if temp_path.exists():
                temp_path.unlink()
            if error.code not in RETRYABLE_HTTP_STATUS or attempt >= DOWNLOAD_ATTEMPTS:
                raise
            time.sleep(1.5 * attempt)
        except urllib.error.URLError:
            if temp_path.exists():
                temp_path.unlink()
            if attempt >= DOWNLOAD_ATTEMPTS:
                raise
            time.sleep(1.5 * attempt)


def ensure_extracted_archive(archive_path: Path, extract_root: Path) -> Path:
    shp_paths = list(extract_root.rglob("*.shp"))
    if shp_paths:
        return shp_paths[0]
    extract_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(extract_root)
    shp_paths = list(extract_root.rglob("*.shp"))
    if not shp_paths:
        raise SystemExit(f"No shapefile found in {archive_path.relative_to(ROOT)}")
    return shp_paths[0]


def unlink_with_retry(path: Path) -> None:
    if not path.exists():
        return
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            path.unlink()
            return
        except PermissionError:
            if attempt >= DOWNLOAD_ATTEMPTS:
                raise
            time.sleep(0.75 * attempt)


def geofabrik_archive_is_complete(archive_path: Path) -> bool:
    if not archive_path.exists() or archive_path.stat().st_size <= 0:
        return False
    if not zipfile.is_zipfile(archive_path):
        return False
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
    return GEOFABRIK_REQUIRED_MEMBERS.issubset(names)


def ensure_geofabrik_archive(url: str, destination: Path) -> Path:
    if geofabrik_archive_is_complete(destination):
        return destination
    recovered_path = destination.with_name(f"{destination.stem}.recovered{destination.suffix}")
    target_path = destination
    if destination.exists():
        try:
            unlink_with_retry(destination)
        except PermissionError:
            target_path = recovered_path
    if target_path.exists():
        unlink_with_retry(target_path)
    ensure_download(url, target_path)
    if not geofabrik_archive_is_complete(target_path):
        raise SystemExit(f"Downloaded Geofabrik archive is incomplete: {target_path.relative_to(ROOT)}")
    return target_path


def load_route_mask():
    carrier = read_json(CARRIER_PATH)
    route_mask = carrier.get("frames", {}).get("main", {}).get("routeMask")
    if not route_mask:
        raise SystemExit("Japan carrier routeMask is missing.")
    return shape(route_mask)


def feature_collection_payload(gdf: gpd.GeoDataFrame) -> dict[str, Any]:
    return json.loads(gdf.to_json(drop_id=True))


def download_l05_archives() -> tuple[list[Path], list[Path]]:
    l05_1_paths = []
    l05_2_paths = []
    for prefecture_code in L05_1_PREFECTURE_CODES:
        l05_1_name = f"L05-1-09_{prefecture_code}_GML.zip"
        l05_1_path = L05_ARCHIVE_DIR / l05_1_name
        ensure_download(f"{L05_BASE_URL}/{l05_1_name}", l05_1_path)
        l05_1_paths.append(l05_1_path)
    for prefecture_code in L05_2_PREFECTURE_CODES:
        l05_2_name = f"L05-2-09_{prefecture_code}_GML.zip"
        l05_2_path = L05_ARCHIVE_DIR / l05_2_name
        ensure_download(f"{L05_BASE_URL}/{l05_2_name}", l05_2_path)
        l05_2_paths.append(l05_2_path)
    return l05_1_paths, l05_2_paths


def read_l05_bundle(zip_paths: list[Path], site_class: str, route_mask) -> tuple[gpd.GeoDataFrame, dict[str, int], dict[str, dict[str, Any]]]:
    frames = []
    excluded_counts: dict[str, int] = {}
    source_signature: dict[str, dict[str, Any]] = {}
    for zip_path in zip_paths:
        extract_root = L05_EXTRACT_DIR / zip_path.stem
        shp_path = ensure_extracted_archive(zip_path, extract_root)
        gdf = gpd.read_file(shp_path, encoding="cp932")
        gdf = gdf.set_crs("EPSG:4326") if gdf.crs is None else gdf.to_crs("EPSG:4326")
        gdf = gdf.loc[gdf.geometry.notnull()].copy()
        raw_count = int(len(gdf))
        gdf = gdf.loc[gdf.geometry.intersects(route_mask)].copy()
        gdf["geometry"] = gdf.geometry.intersection(route_mask)
        gdf = gdf.loc[~gdf.geometry.is_empty].copy()
        excluded_counts[zip_path.name] = raw_count - int(len(gdf))
        source_signature[zip_path.name] = {
            "size_bytes": zip_path.stat().st_size,
            "sha256": file_sha256(zip_path),
        }
        if gdf.empty:
            continue
        rows = []
        for row in gdf.itertuples(index=False):
            rows.append({
                "id": build_id(site_class, normalize_text(getattr(row, "L05_001", "")), zip_path.name),
                "name": normalize_text(getattr(row, "L05_002", "")),
                "match_key": normalize_match_key(getattr(row, "L05_002", "")),
                "site_class": site_class,
                "municipality_code": normalize_text(getattr(row, "L05_003", "")),
                "municipality_name": normalize_text(getattr(row, "L05_004", "")),
                "coastal_inland_code": normalize_text(getattr(row, "L05_005", "")),
                "coastal_inland_label": COASTAL_INLAND_LABELS.get(normalize_text(getattr(row, "L05_005", "")), ""),
                "operator": normalize_text(getattr(row, "L05_008", "")) if site_class == "industrial_complex" else "",
                "completion_year": parse_year(getattr(row, "L05_009", "")) if site_class == "industrial_complex" else None,
                "industry_category": normalize_text(getattr(row, "L05_016", "")) if site_class == "isolated_industrial_site" else "",
                "notes": normalize_text(getattr(row, "L05_006", "")),
                "source_dataset": "mlit_l05_2009",
                "source_member": zip_path.name,
                "geometry": getattr(row, "geometry"),
            })
        frames.append(gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326"))
    columns = [
        "id",
        "name",
        "match_key",
        "site_class",
        "municipality_code",
        "municipality_name",
        "coastal_inland_code",
        "coastal_inland_label",
        "operator",
        "completion_year",
        "industry_category",
        "notes",
        "source_dataset",
        "source_member",
        "geometry",
    ]
    if not frames:
        empty = gpd.GeoDataFrame(columns=columns, geometry="geometry", crs="EPSG:4326")
        return empty, excluded_counts, source_signature
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs="EPSG:4326"), excluded_counts, source_signature


def read_geofabrik_theme(zip_path: Path, member_name: str, route_mask) -> gpd.GeoDataFrame:
    path = f"zip://{zip_path.as_posix()}!{member_name}"
    gdf = gpd.read_file(path, bbox=route_mask.bounds, encoding="utf-8")
    gdf = gdf.set_crs("EPSG:4326") if gdf.crs is None else gdf.to_crs("EPSG:4326")
    return gdf.loc[gdf.geometry.notnull()].copy()


def read_osm_open_variant(route_mask) -> tuple[gpd.GeoDataFrame, int, dict[str, dict[str, Any]]]:
    frames = []
    raw_count = 0
    source_signature: dict[str, dict[str, Any]] = {}
    for region_name, region_url in OSM_REGION_FILES.items():
        archive_name = region_url.rsplit("/", 1)[-1]
        archive_path = ensure_geofabrik_archive(region_url, OSM_ARCHIVE_DIR / archive_name)
        source_signature[archive_path.name] = {
            "size_bytes": archive_path.stat().st_size,
            "sha256": file_sha256(archive_path),
        }

        landuse = read_geofabrik_theme(archive_path, "gis_osm_landuse_a_free_1.shp", route_mask)
        landuse = landuse.loc[landuse["fclass"].map(normalize_text) == "industrial"].copy()
        landuse["site_class"] = "industrial_landuse"
        landuse["landuse"] = "industrial"
        landuse["man_made"] = ""
        raw_count += int(len(landuse))

        pois = read_geofabrik_theme(archive_path, "gis_osm_pois_a_free_1.shp", route_mask)
        pois = pois.loc[pois["fclass"].map(normalize_text) == "works"].copy()
        pois["site_class"] = "works_facility"
        pois["landuse"] = ""
        pois["man_made"] = "works"
        raw_count += int(len(pois))

        for frame, source_member in ((landuse, f"{archive_name}#gis_osm_landuse_a_free_1.shp"), (pois, f"{archive_name}#gis_osm_pois_a_free_1.shp")):
            if frame.empty:
                continue
            frame = frame.loc[frame.geometry.intersects(route_mask)].copy()
            frame["geometry"] = frame.geometry.intersection(route_mask)
            frame = frame.loc[~frame.geometry.is_empty].copy()
            frame["name"] = frame["name"].map(normalize_text)
            frame["match_key"] = frame["name"].map(normalize_match_key)
            frame["industrial_tag"] = ""
            frame["source_dataset"] = f"osm_geofabrik_{region_name}"
            frame["source_member"] = source_member
            frame["id"] = frame["osm_id"].map(lambda value: build_id("osm", str(value)))
            frames.append(frame[[
                "id",
                "name",
                "match_key",
                "site_class",
                "osm_id",
                "landuse",
                "man_made",
                "industrial_tag",
                "source_dataset",
                "source_member",
                "geometry",
            ]].copy())

    if not frames:
        empty = gpd.GeoDataFrame(
            columns=[
                "id",
                "name",
                "match_key",
                "site_class",
                "osm_id",
                "landuse",
                "man_made",
                "industrial_tag",
                "source_dataset",
                "source_member",
                "geometry",
            ],
            geometry="geometry",
            crs="EPSG:4326",
        )
        return empty, raw_count, source_signature
    open_features = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry="geometry", crs="EPSG:4326")
    return open_features, raw_count - int(len(open_features)), source_signature


def main() -> None:
    ensure_required_inputs()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    recipe = read_json(RECIPE_PATH)
    route_mask = load_route_mask()
    l05_1_paths, l05_2_paths = download_l05_archives()
    internal_l05_1, l05_1_excluded, l05_1_signature = read_l05_bundle(l05_1_paths, "industrial_complex", route_mask)
    internal_l05_2, l05_2_excluded, l05_2_signature = read_l05_bundle(l05_2_paths, "isolated_industrial_site", route_mask)
    internal_features = gpd.GeoDataFrame(pd.concat([internal_l05_1, internal_l05_2], ignore_index=True), geometry="geometry", crs="EPSG:4326")
    open_features, open_excluded, osm_signature = read_osm_open_variant(route_mask)
    if internal_features.empty:
        raise SystemExit("No official L05 industrial polygons remained after clipping.")
    if open_features.empty:
        raise SystemExit("No OSM industrial polygons remained after clipping.")

    write_json(INTERNAL_FULL_OUTPUT_PATH, feature_collection_payload(internal_features), compact=False)
    write_json(INTERNAL_PREVIEW_OUTPUT_PATH, feature_collection_payload(internal_features), compact=False)
    write_json(OPEN_FULL_OUTPUT_PATH, feature_collection_payload(open_features), compact=False)
    write_json(OPEN_PREVIEW_OUTPUT_PATH, feature_collection_payload(open_features), compact=False)

    l05_paths = l05_1_paths + l05_2_paths
    source_signature = {
        "l05_official_bundle": {
            "member_count": len(l05_paths),
            "sha256": bundle_sha256(l05_paths),
        },
        "geofabrik_japan_open_variant": {
            "member_count": len(osm_signature),
            "members": osm_signature,
        },
    }
    variants = {
        "internal": {
            "label": "official_core",
            "distribution_tier": "internal_only",
            "license_tier": "review_required",
            "source_set": ["l05_official"],
            "source_policy": "local_source_cache_with_download",
            "paths": {
                "preview": {
                    "industrial_zones": str(INTERNAL_PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
                },
                "full": {
                    "industrial_zones": str(INTERNAL_FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
                },
            },
            "feature_counts": {
                "preview": {"industrial_zones": int(len(internal_features))},
                "full": {"industrial_zones": int(len(internal_features))},
            },
        },
        "open": {
            "label": "open_variant",
            "distribution_tier": "public_publishable_candidate",
            "license_tier": "odbl_attribution_required",
            "source_set": ["osm_industrial"],
            "source_policy": "local_source_cache_only",
            "paths": {
                "preview": {
                    "industrial_zones": str(OPEN_PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
                },
                "full": {
                    "industrial_zones": str(OPEN_FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
                },
            },
            "feature_counts": {
                "preview": {"industrial_zones": int(len(open_features))},
                "full": {"industrial_zones": int(len(open_features))},
            },
        },
    }
    manifest = {
        "adapter_id": "japan_industrial_zones_v2",
        "family": "industrial_zones",
        "geometry_kind": "polygon",
        "country": "Japan",
        "schema_version": 2,
        "generated_at": utc_now(),
        "recipe_path": str(RECIPE_PATH.relative_to(ROOT)).replace("\\", "/"),
        "recipe_version": recipe.get("version", "japan_industrial_zones_sources_v2"),
        "distribution_tier": "dual_track",
        "license_tier": "mixed_by_variant",
        "coverage_scope": "japan_main_islands_v1",
        "source_policy": "local_source_cache_with_download",
        "paths": {
            "preview": {
                "industrial_zones": str(INTERNAL_PREVIEW_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "full": {
                "industrial_zones": str(INTERNAL_FULL_OUTPUT_PATH.relative_to(ROOT)).replace("\\", "/"),
            },
            "build_audit": str(AUDIT_PATH.relative_to(ROOT)).replace("\\", "/"),
        },
        "feature_counts": {
            "preview": {"industrial_zones": int(len(internal_features))},
            "full": {"industrial_zones": int(len(internal_features))},
        },
        "clip_bbox": [round(value, 6) for value in route_mask.bounds],
        "build_command": "python tools/build_transport_workbench_japan_industrial_zones.py",
        "runtime_consumer": "transport_workbench_manifest_preview",
        "source_signature": source_signature,
        "source_members": {
            "l05_official": [str(path.relative_to(ROOT)).replace("\\", "/") for path in l05_paths],
            "osm_industrial": [
                str((OSM_ARCHIVE_DIR / name).relative_to(ROOT)).replace("\\", "/")
                for name in sorted(osm_signature.keys())
            ],
        },
        "source_url": {
            "l05": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-L05.html",
            "osm": list(OSM_REGION_FILES.values()),
        },
        "text_policy": {
            "storage_encoding": "utf-8",
            "display_fields_preserve_original": True,
            "source_fallback_encoding": "cp932",
            "match_key_normalization": "NFKC + whitespace collapse + casefold",
        },
        "excluded_regions": [
            "outside_japan_main_islands_route_mask"
        ],
    }
    manifest = finalize_transport_manifest(
        manifest,
        default_variant="internal",
        variants=variants,
        extension={"variant_axis": "distribution"},
    )
    audit = {
        "generated_at": utc_now(),
        "adapter_id": "japan_industrial_zones_v2",
        "recipe_version": recipe.get("version", "japan_industrial_zones_sources_v2"),
        "source_policy": "local_source_cache_with_download",
        "variants": {
            "internal": {
                "feature_count": int(len(internal_features)),
                "site_class_counts": {
                    site_class: int((internal_features["site_class"] == site_class).sum())
                    for site_class in sorted(set(internal_features["site_class"].tolist()))
                },
                "excluded_outside_mask_count": int(sum(l05_1_excluded.values()) + sum(l05_2_excluded.values())),
                "omitted_source_members": [
                    "L05-2-09_29_GML.zip",
                ],
            },
            "open": {
                "feature_count": int(len(open_features)),
                "site_class_counts": {
                    site_class: int((open_features["site_class"] == site_class).sum())
                    for site_class in sorted(set(open_features["site_class"].tolist()))
                },
                "excluded_outside_mask_count": int(open_excluded),
            },
        },
        "l05_excluded_by_member": {
            **l05_1_excluded,
            **l05_2_excluded,
        },
        "l05_source_signature": {
            **l05_1_signature,
            **l05_2_signature,
        },
        "osm_source_members": [
            str((OSM_ARCHIVE_DIR / name).relative_to(ROOT)).replace("\\", "/")
            for name in sorted(osm_signature.keys())
        ],
        "source_signature": source_signature,
        "notes": [
            "The internal variant uses official L05 polygons only and stays provenance-separated from the open OSM variant.",
            "The open variant intentionally accepts only multipolygon industrial land and works geometries from OSM.",
            "Preview and full outputs are identical for both variants until a reviewed thinning policy exists."
        ],
    }
    write_json(MANIFEST_PATH, manifest, compact=False)
    write_json(AUDIT_PATH, audit, compact=False)
    print("Built Japan industrial zones transport workbench packs.")


if __name__ == "__main__":
    main()
