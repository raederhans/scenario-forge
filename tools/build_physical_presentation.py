"""Build physical reference labels and a bounded ETOPO Alps hillshade pilot.

Inputs stay local; supply the official Natural Earth physical-label areas zip.
The output is cartographic reference, not scenario-specific historical terrain.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import shapes
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from shapely.geometry import shape, mapping

from map_builder.geo.topology import build_named_layer_topology
from tools.build_physical_detail import ALPS_BOUNDS

LABEL_CLASSES = {
    'Range/mtn': 'mountain_high_relief', 'Foothills': 'mountain_hills',
    'Plateau': 'upland_plateau', 'Gorge': 'badlands_canyon',
    'Plain': 'plains_lowlands', 'Lowland': 'plains_lowlands',
    'Basin': 'basin_lowlands', 'Depression': 'basin_lowlands',
    'Delta': 'wetlands_delta', 'Wetlands': 'wetlands_delta',
    'Desert': 'desert_bare', 'Tundra': 'tundra_ice',
}


def hillshade_anomaly(elevation, cell_degrees, north, azimuth=315, altitude=45):
    """Metric surface normals, NW illumination; flat terrain is exactly zero."""
    latitudes = north - (np.arange(elevation.shape[0]) + 0.5) * cell_degrees
    dy = cell_degrees * 111_320
    dx = dy * np.cos(np.deg2rad(latitudes))[:, None]
    east_slope = np.gradient(elevation, axis=1) / dx
    north_slope = -np.gradient(elevation, axis=0) / dy
    azimuth, altitude = np.deg2rad([azimuth, altitude])
    light = np.array([np.sin(azimuth) * np.cos(altitude), np.cos(azimuth) * np.cos(altitude), np.sin(altitude)])
    illumination = (-east_slope * light[0] - north_slope * light[1] + light[2]) / np.sqrt(1 + east_slope**2 + north_slope**2)
    return np.clip((illumination - light[2]) / light[2], -1, 1)


def build_hillshade(output_dir):
    cell = 0.025
    west, south, east, north = ALPS_BOUNDS
    width, height = round((east-west)/cell), round((north-south)/cell)
    source = ROOT / 'data/ETOPO_2022_v1_60s_N90W180_surface.tif'
    with rasterio.open(source) as dataset:
        elevation = dataset.read(1, window=window_from_bounds(*ALPS_BOUNDS, transform=dataset.transform), out_shape=(height, width), resampling=Resampling.average).astype(float)
    anomaly = hillshade_anomaly(elevation, cell, north)
    # Fade the geographic pilot boundary over 0.3 degrees; omit sea and flat land.
    rows, columns = np.indices(elevation.shape)
    edge_distance = np.minimum.reduce([rows + 0.5, height - rows - 0.5, columns + 0.5, width - columns - 0.5])
    fade = np.clip(edge_distance * cell / 0.3, 0, 1)
    values = np.rint(anomaly * fade * 6).astype(np.int16)
    values[elevation <= 0] = 0
    transform = from_bounds(*ALPS_BOUNDS, width, height)
    records = []
    for geometry, value in shapes(values, mask=values != 0, transform=transform):
        polygon = shape(geometry).simplify(0.004, preserve_topology=True)
        if polygon.is_empty or not polygon.is_valid:
            raise ValueError('Invalid hillshade polygon')
        records.append({'id': f'alps-shade-{len(records)}', 'shade': round(value / 6, 4), 'geometry': polygon})
    path = output_dir / 'physical_hillshade.alps.topo.json'
    build_named_layer_topology(gpd.GeoDataFrame(records, crs='EPSG:4326'), path, object_name='physical_hillshade', quantization=1_000_000)
    payload = json.loads(path.read_text(encoding='utf-8'))
    payload['metadata'] = {'source': 'ETOPO 2022 v1 60s surface', 'bounds': list(ALPS_BOUNDS), 'cell_degrees': cell,
        'azimuth_degrees': 315, 'altitude_degrees': 45, 'vertical_exaggeration': 1, 'edge_fade_degrees': 0.3,
        'method': 'metric surface normal illumination relative to flat terrain; six signed levels', 'source_path': source.name}
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    if path.stat().st_size > 2_000_000:
        raise ValueError('Hillshade pilot exceeded 2 MB raw budget')
    return {'file': path.name, 'features': len(records), 'bytes': path.stat().st_size}


def build_labels(source, output_dir):
    frame = gpd.read_file(source, encoding='utf-8')
    # Natural Earth splits four named regions into multiple records with the
    # same NE_ID. One stable label per named region, anchored in its largest part.
    frame = frame[frame.FEATURECLA.isin(LABEL_CLASSES)].dissolve(by='NE_ID', aggfunc='first').reset_index()
    records = []
    for _, row in frame.sort_values(['SCALERANK', 'NE_ID']).iterrows():
        geometry = row.geometry
        if geometry.geom_type == 'MultiPolygon':
            geometry = max(geometry.geoms, key=lambda value: value.area)
        name = str(row.NAME_EN or row.NAME)
        zh = row.NAME_ZH if isinstance(row.NAME_ZH, str) else ''
        records.append({'type': 'Feature', 'geometry': mapping(geometry.representative_point()), 'properties': {
            'id': f'ne-physical-{int(row.NE_ID)}', 'name_en': name, 'name_zh': zh,
            'atlas_class': LABEL_CLASSES[row.FEATURECLA], 'min_zoom': round(max(2, 2 ** ((float(row.MIN_LABEL) - 2) / 2)), 2),
            'rank': int(row.SCALERANK), 'source': 'Natural Earth 1:10m physical label areas v5.0.0'}})
    payload = {'type': 'FeatureCollection', 'features': records, 'metadata': {
        'source_url': 'https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_geography_regions_polys.zip',
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'anchor': 'representative point of largest polygon',
        'source_note': 'Cartographic label areas, not surveyed terrain boundaries'}}
    path = output_dir / 'physical_region_labels.geojson'
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return {'file': path.name, 'features': len(records), 'bytes': path.stat().st_size}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--labels-source', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(json.dumps([build_labels(args.labels_source, args.output_dir), build_hillshade(args.output_dir)]))
