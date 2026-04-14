from __future__ import annotations

import argparse
import tempfile
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from map_builder.transport_workbench_contracts import finalize_transport_manifest
from map_builder.overture_transport_common import (
    OVERTURE_RELEASE,
    OVERTURE_TRANSPORT_SEGMENT_PATH,
    feature_collection_payload,
    file_sha256,
    first_route_ref,
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
OUTPUT_DIR = ROOT / 'data' / 'transport_layers' / 'global_road'
RECIPE_PATH = OUTPUT_DIR / 'source_recipe.manual.json'
MANIFEST_PATH = OUTPUT_DIR / 'manifest.json'
AUDIT_PATH = OUTPUT_DIR / 'build_audit.json'
ROADS_TOPO_PATH = OUTPUT_DIR / 'roads.topo.json'
ROADS_PREVIEW_TOPO_PATH = OUTPUT_DIR / 'roads.preview.topo.json'
ROAD_LABELS_PATH = OUTPUT_DIR / 'road_labels.geojson'
ROAD_LABELS_PREVIEW_PATH = OUTPUT_DIR / 'road_labels.preview.geojson'

ROAD_CLASSES = ('motorway', 'trunk', 'primary')
FULL_MIN_LENGTH_M = {
    'motorway': 0.0,
    'trunk': 3_000.0,
    'primary': 12_000.0,
}
PREVIEW_MIN_LENGTH_M = {
    'motorway': 8_000.0,
    'trunk': 22_000.0,
    'primary': 60_000.0,
}
SIMPLIFY_METERS = {
    'motorway': 120.0,
    'trunk': 150.0,
    'primary': 180.0,
}
LABEL_MIN_LENGTH_M = {
    'motorway': 30_000.0,
    'trunk': 45_000.0,
    'primary': 80_000.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build checked-in global coarse road transport packs from Overture.')
    parser.add_argument('--max-features', type=int, default=0, help='Optional local debug cap before writing output.')
    return parser.parse_args()


def reveal_rank_for_road(road_class: str, length_m: float) -> int:
    if road_class == 'motorway':
        return 1
    if road_class == 'trunk':
        return 1 if length_m >= 120_000 else 2
    return 2 if length_m >= 80_000 else 3


def visual_priority_for_road(road_class: str) -> int:
    return {'motorway': 3, 'trunk': 2, 'primary': 1}.get(road_class, 0)


ROAD_COLUMNS = ['id', 'name', 'ref', 'class', 'source', 'length_m', 'reveal_rank', 'priority', 'geometry']
ROAD_LABEL_COLUMNS = ['id', 'road_id', 'ref', 'class', 'priority', 'geometry']


def empty_roads_frame() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=ROAD_COLUMNS, geometry='geometry', crs='EPSG:4326')


def empty_road_labels_frame() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=ROAD_LABEL_COLUMNS, geometry='geometry', crs='EPSG:4326')


def map_batch_rows(batch_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in batch_rows:
        road_class = str(row.get('class') or '').strip().lower()
        if road_class not in ROAD_CLASSES:
            continue
        rows.append({
            'id': str(row.get('id') or '').strip(),
            'name': safe_primary_name(row.get('names')),
            'ref': first_route_ref(row.get('routes')),
            'class': road_class,
            'source': first_source_dataset(row.get('sources')) or 'Overture',
            'geometry': row.get('geometry'),
        })
    return rows


def normalize_road_batch(batch_rows: list[dict[str, Any]]) -> gpd.GeoDataFrame:
    mapped_rows = map_batch_rows(batch_rows)
    if not mapped_rows:
        return empty_roads_frame()
    gdf = rows_to_geodataframe(mapped_rows)
    if gdf.empty:
        return empty_roads_frame()
    gdf = measure_lengths(gdf)
    gdf = gdf.loc[
        gdf.apply(lambda row: float(row['length_m']) >= FULL_MIN_LENGTH_M.get(str(row['class']), 0.0), axis=1)
    ].copy()
    if gdf.empty:
        return empty_roads_frame()
    pieces = []
    for road_class in ROAD_CLASSES:
        subset = gdf.loc[gdf['class'] == road_class].copy()
        if subset.empty:
            continue
        simplified = simplify_lines(subset, SIMPLIFY_METERS[road_class])
        if not simplified.empty:
            pieces.append(simplified)
    if not pieces:
        return empty_roads_frame()
    normalized = gpd.GeoDataFrame(pd.concat(pieces, ignore_index=True), geometry='geometry', crs='EPSG:4326')
    normalized = measure_lengths(normalized)
    normalized['reveal_rank'] = normalized.apply(
        lambda row: reveal_rank_for_road(str(row['class']), float(row['length_m'])),
        axis=1,
    )
    normalized['priority'] = normalized['class'].map(visual_priority_for_road).fillna(0).astype(int)
    return normalized[ROAD_COLUMNS].copy()


def write_chunk_parquet(gdf: gpd.GeoDataFrame, path: Path) -> None:
    if gdf.empty:
        return
    gdf.to_parquet(path, index=False)


def read_chunk_parquet(paths: list[Path], empty_factory) -> gpd.GeoDataFrame:
    frames = [gpd.read_parquet(path) for path in paths if path.exists()]
    if not frames:
        return empty_factory()
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry='geometry', crs='EPSG:4326')


def build_preview_roads(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return empty_roads_frame()
    preview = gdf.loc[gdf.apply(lambda row: float(row['length_m']) >= PREVIEW_MIN_LENGTH_M.get(str(row['class']), 0.0), axis=1)].copy()
    return preview.loc[preview['reveal_rank'] <= 2].copy()


def build_label_candidates(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    rows: list[dict[str, Any]] = []
    for row in gdf.itertuples(index=False):
        ref = str(getattr(row, 'ref', '') or '').strip()
        if not ref:
            continue
        road_class = str(getattr(row, 'class', '') or '').strip().lower()
        length_m = float(getattr(row, 'length_m', 0.0) or 0.0)
        if length_m < LABEL_MIN_LENGTH_M.get(road_class, 50_000.0):
            continue
        point = row.geometry.interpolate(0.5, normalized=True)
        rows.append({
            'id': f'road_label::{len(rows) + 1}',
            'road_id': row.id,
            'ref': ref,
            'class': road_class,
            'priority': int(getattr(row, 'priority', 0) or 0),
            'geometry': point,
        })
    if not rows:
        return empty_road_labels_frame()
    return gpd.GeoDataFrame(rows, geometry='geometry', crs='EPSG:4326')


def reindex_label_ids(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return empty_road_labels_frame()
    gdf = gdf.copy()
    gdf['id'] = [f'road_label::{index + 1}' for index in range(len(gdf))]
    return gdf[ROAD_LABEL_COLUMNS].copy()


def build_roads_streaming(max_features: int = 0):
    columns = ['id', 'geometry', 'class', 'names', 'routes', 'sources']
    raw_segment_count = 0
    filtered_segment_count = 0
    class_counts = {road_class: 0 for road_class in ROAD_CLASSES}
    with tempfile.TemporaryDirectory(prefix='global_transport_roads_') as temp_dir:
        temp_root = Path(temp_dir)
        road_chunks: list[Path] = []
        preview_chunks: list[Path] = []
        label_chunks: list[Path] = []
        preview_label_chunks: list[Path] = []
        processed = 0
        chunk_index = 0
        for batch_rows in stream_transport_segment_rows(
            subtype='road',
            allowed_classes=ROAD_CLASSES,
            columns=columns,
        ):
            if max_features:
                remaining = max_features - processed
                if remaining <= 0:
                    break
                batch_rows = batch_rows[:remaining]
            if not batch_rows:
                continue
            processed += len(batch_rows)
            raw_segment_count += len(batch_rows)
            normalized_chunk = normalize_road_batch(batch_rows)
            if normalized_chunk.empty:
                continue
            filtered_segment_count += int(len(normalized_chunk))
            for road_class in ROAD_CLASSES:
                class_counts[road_class] += int((normalized_chunk['class'] == road_class).sum())
            preview_chunk = build_preview_roads(normalized_chunk)
            labels_chunk = build_label_candidates(normalized_chunk)
            preview_labels_chunk = build_label_candidates(preview_chunk)

            road_path = temp_root / f'roads_{chunk_index:05d}.parquet'
            write_chunk_parquet(normalized_chunk, road_path)
            road_chunks.append(road_path)
            if not preview_chunk.empty:
                preview_path = temp_root / f'roads_preview_{chunk_index:05d}.parquet'
                write_chunk_parquet(preview_chunk, preview_path)
                preview_chunks.append(preview_path)
            if not labels_chunk.empty:
                labels_path = temp_root / f'road_labels_{chunk_index:05d}.parquet'
                write_chunk_parquet(labels_chunk, labels_path)
                label_chunks.append(labels_path)
            if not preview_labels_chunk.empty:
                preview_labels_path = temp_root / f'road_labels_preview_{chunk_index:05d}.parquet'
                write_chunk_parquet(preview_labels_chunk, preview_labels_path)
                preview_label_chunks.append(preview_labels_path)
            chunk_index += 1

        roads = read_chunk_parquet(road_chunks, empty_roads_frame)
        preview_roads = read_chunk_parquet(preview_chunks, empty_roads_frame)
        road_labels = reindex_label_ids(read_chunk_parquet(label_chunks, empty_road_labels_frame))
        preview_road_labels = reindex_label_ids(read_chunk_parquet(preview_label_chunks, empty_road_labels_frame))
        return {
            'roads': roads,
            'preview_roads': preview_roads,
            'road_labels': road_labels,
            'preview_road_labels': preview_road_labels,
            'raw_segment_count': raw_segment_count,
            'filtered_segment_count': filtered_segment_count,
            'class_counts': class_counts,
        }


def write_source_recipe() -> None:
    recipe = {
        'version': 'global_road_sources_v1',
        'family': 'road',
        'source_policy': 'overture_only_checked_in_v1',
        'primary_source': {
            'provider': 'Overture Maps Foundation',
            'release': OVERTURE_RELEASE,
            'theme': 'transportation',
            'type': 'segment',
            'subtype': 'road',
            'classes': list(ROAD_CLASSES),
            'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
            'license': 'ODbL-1.0',
        },
        'product_rules': {
            'full_min_length_m': FULL_MIN_LENGTH_M,
            'preview_min_length_m': PREVIEW_MIN_LENGTH_M,
            'label_min_length_m': LABEL_MIN_LENGTH_M,
            'simplify_meters': SIMPLIFY_METERS,
            'reveal_rank_policy': 'motorway=1, long trunk=1, other trunk=2, long primary=2, other primary=3',
        },
    }
    write_json(RECIPE_PATH, recipe, compact=False)


def main() -> None:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_source_recipe()

    result = build_roads_streaming(args.max_features)
    roads = result['roads']
    preview_roads = result['preview_roads']
    road_labels = result['road_labels']
    preview_road_labels = result['preview_road_labels']

    write_json(ROADS_TOPO_PATH, topojson_from_gdf(roads, 'roads'), compact=True)
    write_json(ROADS_PREVIEW_TOPO_PATH, topojson_from_gdf(preview_roads, 'roads'), compact=True)
    write_json(ROAD_LABELS_PATH, feature_collection_payload(road_labels), compact=True)
    write_json(ROAD_LABELS_PREVIEW_PATH, feature_collection_payload(preview_road_labels), compact=True)

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
        'adapter_id': 'global_road_v1',
        'recipe_version': 'global_road_sources_v1',
        'source_policy': 'overture_only_checked_in_v1',
        'raw_segment_count': int(result['raw_segment_count']),
        'filtered_segment_count': int(result['filtered_segment_count']),
        'preview_feature_count': int(len(preview_roads)),
        'label_candidate_count': int(len(road_labels)),
        'preview_label_candidate_count': int(len(preview_road_labels)),
        'class_counts': result['class_counts'],
        'preview_thresholds_m': PREVIEW_MIN_LENGTH_M,
        'output_size_bytes': {
            'roads_preview': ROADS_PREVIEW_TOPO_PATH.stat().st_size,
            'roads_full': ROADS_TOPO_PATH.stat().st_size,
            'labels_preview': ROAD_LABELS_PREVIEW_PATH.stat().st_size,
            'labels_full': ROAD_LABELS_PATH.stat().st_size,
        },
        'source_signature': source_signature,
        'notes': [
            'Global road coarse v1 uses Overture transportation segments as the only canonical source.',
            'Only motorway, trunk, and primary are retained in phase A.',
            'Rows are filtered, simplified, and spilled to temp parquet chunks before final TopoJSON/GeoJSON assembly.',
            'road_labels stays a separate sidecar for later label-budget control.',
        ],
    }
    write_json(AUDIT_PATH, audit, compact=False)

    manifest = {
        'adapter_id': 'global_road_v1',
        'family': 'road',
        'geometry_kind': 'line',
        'schema_version': 1,
        'generated_at': utc_now(),
        'recipe_path': str(RECIPE_PATH.relative_to(ROOT)).replace('\\', '/'),
        'recipe_version': 'global_road_sources_v1',
        'distribution_tier': 'single_pack',
        'source_policy': 'overture_only_checked_in_v1',
        'paths': {
            'preview': {
                'roads': str(ROADS_PREVIEW_TOPO_PATH.relative_to(ROOT)).replace('\\', '/'),
                'road_labels': str(ROAD_LABELS_PREVIEW_PATH.relative_to(ROOT)).replace('\\', '/'),
            },
            'full': {
                'roads': str(ROADS_TOPO_PATH.relative_to(ROOT)).replace('\\', '/'),
                'road_labels': str(ROAD_LABELS_PATH.relative_to(ROOT)).replace('\\', '/'),
            },
            'build_audit': str(AUDIT_PATH.relative_to(ROOT)).replace('\\', '/'),
        },
        'feature_counts': {
            'preview': {
                'roads': int(len(preview_roads)),
                'road_labels': int(len(preview_road_labels)),
            },
            'full': {
                'roads': int(len(roads)),
                'road_labels': int(len(road_labels)),
            },
        },
        'build_command': 'python tools/build_global_transport_roads.py',
        'runtime_consumer': 'transport_overview_road',
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
    print(f'Wrote global road packs to {OUTPUT_DIR.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
