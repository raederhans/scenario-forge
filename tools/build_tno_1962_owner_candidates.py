from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
from shapely.geometry import Point
from topojson.utils import serialize_as_geojson

from tools.tno_1962_registration import (
    AS_OF, REPORT_DIR, SCHEMES, Registration, coast_metrics,
    collect_controls, load_source, sample_feature, write_json,
)


def build_candidates():
    source, states, transfers = load_source()
    controls, rejected = collect_controls(source, states)
    registration = Registration(controls, source.width)
    scenario = ROOT / 'data/scenarios/tno_1962'
    topology = json.loads((scenario / 'runtime_topology.topo.json').read_text(encoding='utf-8'))
    political = gpd.GeoDataFrame.from_features(serialize_as_geojson(topology, objectname='political'), crs=4326)
    land = gpd.GeoDataFrame.from_features(serialize_as_geojson(topology, objectname='land_mask'), crs=4326).to_crs(6933)
    owners = json.loads((scenario / 'owners.by_feature.json').read_text(encoding='utf-8'))['owners']
    for region, metrics in registration.metrics.items():
        metrics['coast'] = coast_metrics(registration, source, land, region)
        metrics['passed'] &= all(metrics['coast']['schemes'][s]['passed'] for s in SCHEMES)
        for scheme in SCHEMES:
            check = metrics['schemes'][scheme]
            coast = metrics['coast']['schemes'][scheme]
            print(f"{region}/{scheme}: n={check['valid_checkpoints']}/{check['checkpoints']} "
                  f"median/p90/p95_km={check['median_km']}/{check['p90_km']}/{check['p95_km']} "
                  f"coast_IoU={coast['iou']} coast_p50/p90_km={coast['p50_km']}/{coast['p90_km']} "
                  f"region_passed={metrics['passed']}", flush=True)
    anchor_points = gpd.GeoSeries([Point(c['lon'], c['lat']) for c in controls], crs=4326)
    areas = political.to_crs(6933).area / 1e6
    rows = []
    for index, feature in enumerate(political.itertuples()):
        fid = str(feature.id)
        geometry = feature.geometry
        if geometry is None or geometry.is_empty:
            rows.append(dict(fid=fid, current_owner=owners.get(fid), status='empty_geometry'))
            continue
        candidate = sample_feature(geometry, registration, source, index)
        contained = anchor_points.sindex.query(geometry, predicate='intersects')
        anchors = [controls[int(i)] for i in contained]
        conflicts = [dict(city_id=c['city_id'], province_id=c['province_id'], state_id=c['state_id'], owner=c['owner'])
                     for c in anchors if any(candidate['schemes'][s]['mode'] != c['owner'] for s in SCHEMES)]
        representative = geometry.representative_point()
        rows.append(dict(candidate, fid=fid, current_owner=owners.get(fid),
                         sample_seed=index,
                         country_code=str(feature.cntr_code), name=str(getattr(feature, 'name', '')),
                         area_km2=float(areas.iloc[index]), lon=representative.x, lat=representative.y,
                         registration_passed=all(registration.metrics[r]['passed'] for r in candidate['regions']),
                         city_anchors=[c['city_id'] for c in anchors],
                         city_anchor_owners=[dict(city_id=c['city_id'], province_id=c['province_id'],
                                                 state_id=c['state_id'], owner=c['owner']) for c in anchors],
                         city_conflicts=conflicts, status='sampled'))
    report = dict(schema_version=2, source_version='TNO 1.10.0b', as_of=AS_OF, britain_rule='BRITAIN_OLD',
                  old_britain_transfers=transfers, control_points=controls, rejected_controls=rejected,
                  validation=dict(spatial_block_degrees=5, folds=5, direction='pixel_to_lonlat',
                                  minimum_checkpoints=10, median_km=10, p90_km=25, p95_km=50,
                                  coast_iou=.95, coast_p90_km=10, maximum_samples=25600),
                  regions=registration.metrics, rows=rows)
    write_json(REPORT_DIR / 'tno_1962_owner_candidates.json', report)
    summary = dict(schema_version=1, source_version=report['source_version'], as_of=AS_OF,
                   britain_rule='BRITAIN_OLD', features=len(rows), controls=len(controls),
                   uncertain_regions=[r for r, m in registration.metrics.items() if not m['passed']],
                   insufficient_samples=sum(not r.get('sample_sufficient', False) for r in rows),
                   city_conflicts=sum(bool(r.get('city_conflicts')) for r in rows),
                   regions={r: {k: v for k, v in m.items() if k != 'schemes'} | {
                       'schemes': {s: {k: v for k, v in sm.items() if k != 'checkpoints_detail'}
                                   for s, sm in m['schemes'].items()}}
                            for r, m in registration.metrics.items()})
    write_json(REPORT_DIR / 'tno_1962_owner_candidates.summary.json', summary)
    print(json.dumps({k: v for k, v in summary.items() if k != 'regions'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    build_candidates()
