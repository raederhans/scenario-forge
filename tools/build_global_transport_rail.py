from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd

from map_builder.transport_workbench_contracts import finalize_transport_manifest
from map_builder.overture_transport_common import (
    OVERTURE_RELEASE,
    OVERTURE_TRANSPORT_SEGMENT_PATH,
    feature_collection_payload,
    file_sha256,
    first_source_dataset,
    measure_lengths,
    rows_to_geodataframe,
    safe_primary_name,
    simplify_lines,
    stream_transport_segment_rows,
    topojson_from_gdf,
    utc_now,
    write_json,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / 'data' / 'transport_layers' / 'global_rail'
RECIPE_PATH = OUTPUT_DIR / 'source_recipe.manual.json'
MANIFEST_PATH = OUTPUT_DIR / 'manifest.json'
AUDIT_PATH = OUTPUT_DIR / 'build_audit.json'
RAILWAYS_TOPO_PATH = OUTPUT_DIR / 'railways.topo.json'
RAILWAYS_PREVIEW_TOPO_PATH = OUTPUT_DIR / 'railways.preview.topo.json'
MAJOR_STATIONS_PATH = OUTPUT_DIR / 'rail_stations_major.geojson'
MAJOR_STATIONS_PREVIEW_PATH = OUTPUT_DIR / 'rail_stations_major.preview.geojson'

RAIL_CLASSES = ('standard_gauge', 'unknown')
FULL_MIN_LENGTH_M = {
    'standard_gauge': 8_000.0,
    'unknown': 20_000.0,
}
PREVIEW_MIN_LENGTH_M = {
    'standard_gauge': 35_000.0,
    'unknown': 90_000.0,
}
SIMPLIFY_METERS = {
    'standard_gauge': 120.0,
    'unknown': 160.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build checked-in global coarse rail transport packs from Overture.')
    parser.add_argument('--max-features', type=int, default=0, help='Optional local debug cap before writing output.')
    return parser.parse_args()


def line_class_for_row(raw_class: str, length_m: float, name: str) -> str:
    normalized = str(raw_class or '').strip().lower()
    if normalized == 'standard_gauge' and length_m >= 160_000:
        return 'mainline'
    if normalized == 'standard_gauge':
        return 'regional'
    if name and length_m >= 100_000:
        return 'regional'
    return 'secondary'


def reveal_rank_for_row(raw_class: str, length_m: float, name: str) -> int:
    line_class = line_class_for_row(raw_class, length_m, name)
    if line_class == 'mainline':
        return 1
    if line_class == 'regional':
        return 2
    return 3


def build_rows(max_features: int = 0) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    columns = ['id', 'geometry', 'class', 'names', 'sources']
    for batch_rows in stream_transport_segment_rows(
        subtype='rail',
        allowed_classes=RAIL_CLASSES,
        columns=columns,
    ):
        for row in batch_rows:
            raw_class = str(row.get('class') or '').strip().lower()
            if raw_class not in RAIL_CLASSES:
                continue
            rows.append({
                'id': str(row.get('id') or '').strip(),
                'name': safe_primary_name(row.get('names')),
                'overture_class': raw_class,
                'source': first_source_dataset(row.get('sources')) or 'Overture',
                'geometry': row.get('geometry'),
            })
            if max_features and len(rows) >= max_features:
                return rows
    return rows


def normalize_railways(max_features: int = 0) -> gpd.GeoDataFrame:
    gdf = rows_to_geodataframe(build_rows(max_features))
    if gdf.empty:
        return gdf
    gdf = measure_lengths(gdf)
    gdf = gdf.loc[gdf.apply(lambda row: float(row['length_m']) >= FULL_MIN_LENGTH_M.get(str(row['overture_class']), 0.0), axis=1)].copy()
    pieces = []
    for raw_class in RAIL_CLASSES:
        subset = gdf.loc[gdf['overture_class'] == raw_class].copy()
        if subset.empty:
            continue
        pieces.append(simplify_lines(subset, SIMPLIFY_METERS[raw_class]))
    if not pieces:
        return gpd.GeoDataFrame(columns=['id', 'name', 'class', 'source', 'length_m', 'reveal_rank', 'geometry'], geometry='geometry', crs='EPSG:4326')
    normalized = gpd.GeoDataFrame(pd.concat(pieces, ignore_index=True), geometry='geometry', crs='EPSG:4326')
    normalized = measure_lengths(normalized)
    normalized['class'] = normalized.apply(lambda row: line_class_for_row(str(row['overture_class']), float(row['length_m']), str(row['name'] or '')), axis=1)
    normalized['reveal_rank'] = normalized.apply(lambda row: reveal_rank_for_row(str(row['overture_class']), float(row['length_m']), str(row['name'] or '')), axis=1)
    return normalized[['id', 'name', 'class', 'source', 'length_m', 'reveal_rank', 'geometry']].copy()


def build_preview_railways(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf.copy()
    preview = gdf.loc[gdf.apply(lambda row: float(row['length_m']) >= PREVIEW_MIN_LENGTH_M.get('standard_gauge' if row['class'] in ('mainline','regional') else 'unknown', 0.0), axis=1)].copy()
    return preview.loc[preview['reveal_rank'] <= 2].copy()


def empty_station_collection() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        columns=['id', 'name', 'city_key', 'importance', 'importance_rank', 'source', 'geometry'],
        geometry='geometry',
        crs='EPSG:4326',
    )


def write_source_recipe() -> None:
    recipe = {
        'version': 'global_rail_sources_v1',
        'family': 'rail',
        'source_policy': 'overture_only_checked_in_v1',
        'primary_source': {
            'provider': 'Overture Maps Foundation',
            'release': OVERTURE_RELEASE,
            'theme': 'transportation',
            'type': 'segment',
            'subtype': 'rail',
            'classes': list(RAIL_CLASSES),
            'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
            'license': 'ODbL-1.0',
        },
        'product_rules': {
            'full_min_length_m': FULL_MIN_LENGTH_M,
            'preview_min_length_m': PREVIEW_MIN_LENGTH_M,
            'simplify_meters': SIMPLIFY_METERS,
            'line_class_policy': 'standard_gauge long segments => mainline, other standard_gauge => regional, remaining => secondary',
            'stations_phase': 'phase_b_pending_major_station_source',
        },
    }
    write_json(RECIPE_PATH, recipe, compact=False)


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_source_recipe()

    railways = normalize_railways(args.max_features)
    preview_railways = build_preview_railways(railways)
    major_stations = empty_station_collection()

    write_json(RAILWAYS_TOPO_PATH, topojson_from_gdf(railways, 'railways'), compact=True)
    write_json(RAILWAYS_PREVIEW_TOPO_PATH, topojson_from_gdf(preview_railways, 'railways'), compact=True)
    write_json(MAJOR_STATIONS_PATH, feature_collection_payload(major_stations), compact=False)
    write_json(MAJOR_STATIONS_PREVIEW_PATH, feature_collection_payload(major_stations), compact=False)

    source_signature = {
        'overture_transport_segment': {
            'release': OVERTURE_RELEASE,
            'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
        },
        'source_recipe': {
            'filename': str(RECIPE_PATH.relative_to(ROOT)).replace('\\', '/'),
            'size_bytes': RECIPE_PATH.stat().st_size,
            'sha256': file_sha256(RECIPE_PATH),
        },
    }

    audit = {
        'generated_at': utc_now(),
        'adapter_id': 'global_rail_v1',
        'recipe_version': 'global_rail_sources_v1',
        'source_policy': 'overture_only_checked_in_v1',
        'raw_line_count': int(len(railways)),
        'filtered_line_count': int(len(railways)),
        'preview_line_count': int(len(preview_railways)),
        'major_station_count': int(len(major_stations)),
        'line_class_counts': {line_class: int((railways['class'] == line_class).sum()) for line_class in ('mainline', 'regional', 'secondary')},
        'preview_thresholds_m': PREVIEW_MIN_LENGTH_M,
        'output_size_bytes': {
            'railways_preview': RAILWAYS_PREVIEW_TOPO_PATH.stat().st_size,
            'railways_full': RAILWAYS_TOPO_PATH.stat().st_size,
            'stations_preview': MAJOR_STATIONS_PREVIEW_PATH.stat().st_size,
            'stations_full': MAJOR_STATIONS_PATH.stat().st_size,
        },
        'source_signature': source_signature,
        'notes': [
            'Global rail coarse v1 uses Overture transportation segments as the only canonical source.',
            'Phase A delivers backbone railways now and leaves major station enrichment to phase B.',
            'rail_stations_major is emitted as an empty checked-in placeholder until the dedicated major-station source is finalized.',
        ],
    }
    write_json(AUDIT_PATH, audit, compact=False)

    manifest = {
        'adapter_id': 'global_rail_v1',
        'family': 'rail',
        'geometry_kind': 'line',
        'schema_version': 1,
        'generated_at': utc_now(),
        'recipe_path': str(RECIPE_PATH.relative_to(ROOT)).replace('\\', '/'),
        'recipe_version': 'global_rail_sources_v1',
        'distribution_tier': 'single_pack',
        'source_policy': 'overture_only_checked_in_v1',
        'paths': {
            'preview': {
                'railways': str(RAILWAYS_PREVIEW_TOPO_PATH.relative_to(ROOT)).replace('\\', '/'),
                'rail_stations_major': str(MAJOR_STATIONS_PREVIEW_PATH.relative_to(ROOT)).replace('\\', '/'),
            },
            'full': {
                'railways': str(RAILWAYS_TOPO_PATH.relative_to(ROOT)).replace('\\', '/'),
                'rail_stations_major': str(MAJOR_STATIONS_PATH.relative_to(ROOT)).replace('\\', '/'),
            },
            'build_audit': str(AUDIT_PATH.relative_to(ROOT)).replace('\\', '/'),
        },
        'feature_counts': {
            'preview': {
                'railways': int(len(preview_railways)),
                'rail_stations_major': int(len(major_stations)),
            },
            'full': {
                'railways': int(len(railways)),
                'rail_stations_major': int(len(major_stations)),
            },
        },
        'build_command': 'python tools/build_global_transport_rail.py',
        'runtime_consumer': 'transport_overview_rail',
        'source_signature': source_signature,
    }
    manifest = finalize_transport_manifest(
        manifest,
        default_variant='default',
        variants={
            'default': {
                'label': 'default',
                'distribution_tier': manifest['distribution_tier'],
                'paths': manifest['paths'],
                'feature_counts': manifest['feature_counts'],
            }
        },
    )
    write_json(MANIFEST_PATH, manifest, compact=False)
    print(f'Wrote global rail packs to {OUTPUT_DIR.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
