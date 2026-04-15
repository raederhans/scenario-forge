from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path
from typing import Any

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from map_builder.transport_workbench_contracts import finalize_transport_manifest
from map_builder.overture_transport_common import (
    OVERTURE_RELEASE,
    OVERTURE_TRANSPORT_SEGMENT_PATH,
    feature_collection_payload,
    file_sha256,
    measure_lengths,
    rows_to_geodataframe,
    safe_primary_name,
    simplify_lines,
    stream_transport_segment_rows,
    topojson_from_gdf,
    utc_now,
    write_json,
)

OUTPUT_DIR = ROOT / 'data' / 'transport_layers' / 'global_road'
RECIPE_PATH = OUTPUT_DIR / 'source_recipe.manual.json'

ROAD_CLASSES = ('motorway', 'trunk')
PREVIEW_ROAD_CLASSES = ('motorway', 'trunk')
FULL_MIN_LENGTH_M = {
    'motorway': 0.0,
    'trunk': 3_000.0,
}
PREVIEW_MIN_LENGTH_M = {
    'motorway': 8_000.0,
    'trunk': 22_000.0,
}
SIMPLIFY_METERS = {
    'motorway': 120.0,
    'trunk': 150.0,
}
LABEL_MIN_LENGTH_M = {
    'motorway': 30_000.0,
    'trunk': 45_000.0,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build checked-in global coarse road transport packs from Overture.')
    parser.add_argument('--max-features', type=int, default=0, help='Optional local debug cap before writing output.')
    parser.add_argument('--shard', type=str, default='all', help='Optional longitudinal shard id, or `all` for the whole globe.')
    parser.add_argument('--lon-min', type=float, default=None, help='Optional custom shard west bound in degrees.')
    parser.add_argument('--lon-max', type=float, default=None, help='Optional custom shard east bound in degrees.')
    parser.add_argument('--shard-id', type=str, default='', help='Optional explicit id for custom shard bounds.')
    return parser.parse_args()


def reveal_rank_for_road(road_class: str, length_m: float) -> int:
    if road_class == 'motorway':
        return 1
    if road_class == 'trunk':
        return 1 if length_m >= 120_000 else 2
    return 3


def visual_priority_for_road(road_class: str) -> int:
    return {'motorway': 3, 'trunk': 2, 'primary': 1}.get(road_class, 0)


def log_progress(message: str) -> None:
    print(f'[global-road] {message}', file=sys.stderr, flush=True)


def shard_bbox_center_matches(row_bbox: Any, shard_spec: dict[str, Any] | None) -> bool:
    if not shard_spec:
        return True
    if not isinstance(row_bbox, dict):
        return False
    xmin = row_bbox.get('xmin')
    xmax = row_bbox.get('xmax')
    if xmin is None or xmax is None:
        return False
    try:
        center = (float(xmin) + float(xmax)) / 2.0
    except (TypeError, ValueError):
        return False
    return float(shard_spec['lon_min']) <= center < float(shard_spec['lon_max'])


ROAD_COLUMNS = ['id', 'name', 'ref', 'class', 'source', 'length_m', 'reveal_rank', 'priority', 'geometry']
ROAD_LABEL_COLUMNS = ['id', 'road_id', 'ref', 'class', 'priority', 'geometry']
TARGET_NORMALIZED_CHUNK_ROWS = 5_000


def road_shard(shard_id: str, lon_min: float, lon_max: float) -> dict[str, Any]:
    return {'id': shard_id, 'lon_min': float(lon_min), 'lon_max': float(lon_max)}


ROAD_SHARDS = (
    road_shard('w180_w150', -180.0, -150.0),
    road_shard('w150_w120', -150.0, -120.0),
    road_shard('w120_w090', -120.0, -90.0),
    road_shard('w090_w085', -90.0, -85.0),
    road_shard('w085_w082p5', -85.0, -82.5),
    road_shard('w082p5_w080', -82.5, -80.0),
    road_shard('w080_w075', -80.0, -75.0),
    road_shard('w075_w070', -75.0, -70.0),
    road_shard('w070_w065', -70.0, -65.0),
    road_shard('w065_w060', -65.0, -60.0),
    road_shard('w060_w030', -60.0, -30.0),
    road_shard('w030_w020', -30.0, -20.0),
    road_shard('w020_w010', -20.0, -10.0),
    road_shard('w010_e000', -10.0, 0.0),
    road_shard('e000_e005', 0.0, 5.0),
    road_shard('e005_e010', 5.0, 10.0),
    road_shard('e010_e012', 10.0, 12.0),
    road_shard('e012_e014', 12.0, 14.0),
    road_shard('e014_e016', 14.0, 16.0),
    road_shard('e016_e018', 16.0, 18.0),
    road_shard('e018_e020', 18.0, 20.0),
    road_shard('e020_e025', 20.0, 25.0),
    road_shard('e025_e030', 25.0, 30.0),
    road_shard('e030_e045', 30.0, 45.0),
    road_shard('e045_e060', 45.0, 60.0),
    road_shard('e060_e090', 60.0, 90.0),
    road_shard('e090_e095', 90.0, 95.0),
    road_shard('e095_e100', 95.0, 100.0),
    road_shard('e100_e105', 100.0, 105.0),
    road_shard('e105_e110', 105.0, 110.0),
    road_shard('e110_e115', 110.0, 115.0),
    road_shard('e115_e120', 115.0, 120.0),
    road_shard('e120_e125', 120.0, 125.0),
    road_shard('e125_e130', 125.0, 130.0),
    road_shard('e130_e135', 130.0, 135.0),
    road_shard('e135_e140', 135.0, 140.0),
    road_shard('e140_e145', 140.0, 145.0),
    road_shard('e145_e150', 145.0, 150.0),
    road_shard('e150_e180', 150.0, 180.0),
)


def get_shard_spec(shard_id: str | None) -> dict[str, Any] | None:
    if not shard_id or str(shard_id).strip().lower() in {'', 'all', 'global'}:
        return None
    normalized = str(shard_id).strip().lower()
    for shard in ROAD_SHARDS:
        if shard['id'] == normalized:
            return shard
    valid = ', '.join(shard['id'] for shard in ROAD_SHARDS)
    raise SystemExit(f'Unknown road shard `{shard_id}`. Valid values: all, {valid}')


def get_custom_shard_spec(
    shard_id: str | None,
    lon_min: float | None,
    lon_max: float | None,
) -> dict[str, Any] | None:
    if lon_min is None and lon_max is None:
        return None
    if lon_min is None or lon_max is None:
        raise SystemExit('Custom shard requires both --lon-min and --lon-max.')
    if float(lon_min) >= float(lon_max):
        raise SystemExit('Custom shard requires --lon-min < --lon-max.')
    explicit_id = str(shard_id or '').strip().lower()
    if explicit_id:
        normalized_id = explicit_id
    else:
        west = f"{abs(float(lon_min)):g}".replace('.', 'p')
        east = f"{abs(float(lon_max)):g}".replace('.', 'p')
        west_prefix = 'w' if float(lon_min) < 0 else 'e'
        east_prefix = 'w' if float(lon_max) < 0 else 'e'
        normalized_id = f'{west_prefix}{west}_{east_prefix}{east}'
    return road_shard(normalized_id, float(lon_min), float(lon_max))


def get_output_paths(output_dir: Path) -> dict[str, Path]:
    return {
        'recipe': output_dir / 'source_recipe.manual.json',
        'manifest': output_dir / 'manifest.json',
        'audit': output_dir / 'build_audit.json',
        'roads_full': output_dir / 'roads.topo.json',
        'roads_preview': output_dir / 'roads.preview.topo.json',
        'labels_full': output_dir / 'road_labels.geojson',
        'labels_preview': output_dir / 'road_labels.preview.geojson',
    }


def empty_roads_frame() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=ROAD_COLUMNS, geometry='geometry', crs='EPSG:4326')


def empty_road_labels_frame() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(columns=ROAD_LABEL_COLUMNS, geometry='geometry', crs='EPSG:4326')


def map_batch_rows(batch_rows: list[dict[str, Any]], shard_spec: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in batch_rows:
        road_class = str(row.get('class') or '').strip().lower()
        if road_class not in ROAD_CLASSES:
            continue
        if not shard_bbox_center_matches(row.get('bbox'), shard_spec):
            continue
        rows.append({
            'id': str(row.get('id') or '').strip(),
            'name': safe_primary_name(row.get('names')),
            'ref': '',
            'class': road_class,
            'source': 'Overture',
            'geometry': row.get('geometry'),
        })
    return rows


def normalize_road_batch(batch_rows: list[dict[str, Any]], shard_spec: dict[str, Any] | None = None) -> gpd.GeoDataFrame:
    mapped_rows = map_batch_rows(batch_rows, shard_spec=shard_spec)
    if not mapped_rows:
        return empty_roads_frame()
    gdf = rows_to_geodataframe(mapped_rows)
    if gdf.empty:
        return empty_roads_frame()
    gdf = measure_lengths(gdf)
    min_lengths = gdf['class'].map(FULL_MIN_LENGTH_M).fillna(0.0).astype(float)
    gdf = gdf.loc[gdf['length_m'] >= min_lengths].copy()
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
    normalized_min_lengths = normalized['class'].map(FULL_MIN_LENGTH_M).fillna(0.0).astype(float)
    normalized = normalized.loc[normalized['length_m'] >= normalized_min_lengths].copy()
    if normalized.empty:
        return empty_roads_frame()
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


def build_preview_roads(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return empty_roads_frame()
    preview_lengths = gdf['class'].map(PREVIEW_MIN_LENGTH_M).fillna(0.0).astype(float)
    preview = gdf.loc[
        gdf['class'].isin(PREVIEW_ROAD_CLASSES)
        & (gdf['length_m'] >= preview_lengths)
        & (gdf['reveal_rank'] <= 2)
    ].copy()
    return preview[ROAD_COLUMNS].copy()


def build_full_roads(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.empty:
        return empty_roads_frame()
    return gdf.loc[gdf['class'].isin(('motorway', 'trunk'))].copy()[ROAD_COLUMNS]


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


def build_roads_streaming(temp_root: Path, max_features: int = 0, shard_spec: dict[str, Any] | None = None):
    columns = ['id', 'geometry', 'bbox', 'class', 'names']
    raw_segment_count = 0
    filtered_segment_count = 0
    class_counts = {road_class: 0 for road_class in ROAD_CLASSES}
    road_chunks: list[Path] = []
    pending_frames: list[gpd.GeoDataFrame] = []
    pending_rows = 0
    processed = 0
    chunk_index = 0

    def flush_pending_frames() -> None:
        nonlocal pending_frames, pending_rows, chunk_index
        if not pending_frames:
            return
        combined = gpd.GeoDataFrame(pd.concat(pending_frames, ignore_index=True), geometry='geometry', crs='EPSG:4326')
        road_path = temp_root / f'roads_{chunk_index:05d}.parquet'
        write_chunk_parquet(combined, road_path)
        road_chunks.append(road_path)
        if chunk_index == 0 or (chunk_index + 1) % 10 == 0:
            log_progress(
                f'normalized chunk {chunk_index + 1} flushed; raw_seen={raw_segment_count}; kept={filtered_segment_count}; chunk_rows={len(combined)}; chunks={len(road_chunks)}'
            )
        pending_frames = []
        pending_rows = 0
        chunk_index += 1

    for batch_rows in stream_transport_segment_rows(
        subtype='road',
        allowed_classes=ROAD_CLASSES,
        columns=columns,
        bbox_bounds=(float(shard_spec['lon_min']), float(shard_spec['lon_max'])) if shard_spec else None,
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
        normalized_chunk = normalize_road_batch(batch_rows, shard_spec=shard_spec)
        if normalized_chunk.empty:
            continue
        filtered_segment_count += int(len(normalized_chunk))
        for road_class in ROAD_CLASSES:
            class_counts[road_class] += int((normalized_chunk['class'] == road_class).sum())
        pending_frames.append(normalized_chunk)
        pending_rows += int(len(normalized_chunk))
        if pending_rows >= TARGET_NORMALIZED_CHUNK_ROWS:
            flush_pending_frames()

    flush_pending_frames()

    return {
        'road_chunks': road_chunks,
        'raw_segment_count': raw_segment_count,
        'filtered_segment_count': filtered_segment_count,
        'class_counts': class_counts,
    }


def materialize_roads_from_chunks(chunk_paths: list[Path], builder) -> gpd.GeoDataFrame:
    frames: list[gpd.GeoDataFrame] = []
    for index, path in enumerate(chunk_paths, start=1):
        if not path.exists():
            continue
        chunk = gpd.read_parquet(path)
        built = builder(chunk)
        if not built.empty:
            frames.append(built)
        if index == 1 or index % 25 == 0:
            log_progress(f'materialized {index}/{len(chunk_paths)} chunk(s) for staged output')
    if not frames:
        return empty_roads_frame()
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), geometry='geometry', crs='EPSG:4326')


def write_source_recipe(recipe_path: Path, shard_spec: dict[str, Any] | None = None) -> None:
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
            'reveal_rank_policy': 'motorway=1, long trunk=1, other trunk=2',
            'preview_scope': 'motorway + trunk only',
            'phase_a_scope': 'motorway + trunk backbone only',
            'labels_phase': 'phase_b_pending_ref_sidecar',
        },
    }
    if shard_spec:
        recipe['shard'] = {
            'id': shard_spec['id'],
            'lon_min': float(shard_spec['lon_min']),
            'lon_max': float(shard_spec['lon_max']),
            'assignment_rule': 'bbox_longitude_center',
        }
    write_json(recipe_path, recipe, compact=False)


def main() -> None:
    args = parse_args()
    custom_shard_spec = get_custom_shard_spec(args.shard_id, args.lon_min, args.lon_max)
    if custom_shard_spec and args.shard not in {'', 'all', 'global'}:
        raise SystemExit('Use either --shard or custom --lon-min/--lon-max bounds, not both.')
    shard_spec = custom_shard_spec or get_shard_spec(args.shard)
    output_dir = OUTPUT_DIR / 'shards' / shard_spec['id'] if shard_spec else OUTPUT_DIR
    paths = get_output_paths(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_source_recipe(paths['recipe'], shard_spec=shard_spec)
    build_command = 'python tools/build_global_transport_roads.py'
    if custom_shard_spec:
        build_command = (
            f"{build_command} --lon-min {custom_shard_spec['lon_min']} "
            f"--lon-max {custom_shard_spec['lon_max']} --shard-id {custom_shard_spec['id']}"
        )
    elif shard_spec:
        build_command = f"{build_command} --shard {shard_spec['id']}"
    with tempfile.TemporaryDirectory(prefix='global_transport_roads_') as temp_dir:
        result = build_roads_streaming(Path(temp_dir), args.max_features, shard_spec=shard_spec)
        road_chunks = result['road_chunks']

        log_progress('starting preview backbone assembly')
        preview_roads = materialize_roads_from_chunks(road_chunks, build_preview_roads)
        write_json(paths['roads_preview'], topojson_from_gdf(preview_roads, 'roads'), compact=True)
        log_progress('finished preview backbone assembly')

        log_progress('starting full backbone assembly')
        roads = materialize_roads_from_chunks(road_chunks, build_full_roads)
        write_json(paths['roads_full'], topojson_from_gdf(roads, 'roads'), compact=True)
        log_progress('finished full backbone assembly')

        preview_road_labels = empty_road_labels_frame()
        road_labels = empty_road_labels_frame()
        write_json(paths['labels_preview'], feature_collection_payload(preview_road_labels), compact=True)
        write_json(paths['labels_full'], feature_collection_payload(road_labels), compact=True)
        log_progress('wrote road label placeholders for phase B')

    source_signature = {
        'overture_transport_segment': {
            'release': OVERTURE_RELEASE,
            'remote_path': f's3://{OVERTURE_TRANSPORT_SEGMENT_PATH}',
        },
        'source_recipe': {
            'filename': str(paths['recipe'].relative_to(ROOT)).replace('\\', '/'),
            'size_bytes': paths['recipe'].stat().st_size,
            'sha256': file_sha256(paths['recipe']),
        },
    }
    if shard_spec:
        source_signature['shard'] = {
            'id': shard_spec['id'],
            'lon_min': float(shard_spec['lon_min']),
            'lon_max': float(shard_spec['lon_max']),
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
            'roads_preview': paths['roads_preview'].stat().st_size,
            'roads_full': paths['roads_full'].stat().st_size,
            'labels_preview': paths['labels_preview'].stat().st_size,
            'labels_full': paths['labels_full'].stat().st_size,
        },
        'source_signature': source_signature,
        'phase_status': {
            'backbone': 'ready_for_phase_a_checked_in_outputs',
            'road_labels': 'phase_b_pending_ref_sidecar',
        },
        'runtime_readiness': {
            'transport_overview_road': 'backbone_only_not_ui_ready',
            'road_labels': 'placeholder_only',
        },
        'notes': [
            'Global road coarse v1 uses Overture transportation segments as the only canonical source.',
            'Preview backbone is intentionally limited to motorway and trunk so the first checked-in preview stays lightweight.',
            'Phase A full backbone is currently limited to motorway and trunk so the first checked-in global road pack can be produced reliably.',
            'Rows are filtered, simplified, and spilled to normalized temp parquet chunks before preview/full backbone assembly.',
            'road_labels is emitted as an empty placeholder sidecar until the dedicated ref-label phase is finalized.',
        ],
    }
    if shard_spec:
        audit['notes'].append(f"Shard scope: {shard_spec['id']} ({shard_spec['lon_min']} to {shard_spec['lon_max']} longitude center assignment).")
    write_json(paths['audit'], audit, compact=False)

    manifest = {
        'adapter_id': 'global_road_v1',
        'family': 'road',
        'geometry_kind': 'line',
        'schema_version': 1,
        'generated_at': utc_now(),
        'recipe_path': str(paths['recipe'].relative_to(ROOT)).replace('\\', '/'),
        'recipe_version': 'global_road_sources_v1',
        'distribution_tier': 'single_pack',
        'source_policy': 'overture_only_checked_in_v1',
        'paths': {
            'preview': {
                'roads': str(paths['roads_preview'].relative_to(ROOT)).replace('\\', '/'),
            },
            'full': {
                'roads': str(paths['roads_full'].relative_to(ROOT)).replace('\\', '/'),
            },
            'build_audit': str(paths['audit'].relative_to(ROOT)).replace('\\', '/'),
        },
        'feature_counts': {
            'preview': {
                'roads': int(len(preview_roads)),
            },
            'full': {
                'roads': int(len(roads)),
            },
        },
        'build_command': build_command,
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
        extension={
            'phase_status': audit['phase_status'],
            'runtime_readiness': audit['runtime_readiness'],
            'phase_b_reserved_outputs': ['road_labels'],
            'shard': source_signature.get('shard'),
        },
    )
    write_json(paths['manifest'], manifest, compact=False)
    print(f"Wrote global road packs to {output_dir.relative_to(ROOT)}")


if __name__ == '__main__':
    main()
