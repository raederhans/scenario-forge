from __future__ import annotations

import io
import json
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Geod, Transformer
from scipy.interpolate import LinearNDInterpolator, RBFInterpolator
from scipy.ndimage import binary_erosion
from scipy.spatial import cKDTree
from shapely import contains_xy, get_parts
from shapely.ops import transform

from scenario_builder.hoi4.parser import (
    _extract_assignment_block, _iter_assignment_blocks, _strip_comments,
    parse_definition_csv, parse_states,
)

ROOT = Path(__file__).resolve().parents[1]
TNO_ROOT = Path('C:/Program Files (x86)/Steam/steamapps/workshop/content/394360/2438003901')
REPORT_DIR = ROOT / '.runtime/reports/generated'
AS_OF = '1962.1.1.1'
GEOD = Geod(ellps='WGS84')
TO_AREA = Transformer.from_crs(4326, 6933, always_xy=True)
FROM_AREA = Transformer.from_crs(6933, 4326, always_xy=True)
SCHEMES = ('tps', 'affine')
REGIONS = {
    'west_russia': (27, 48, 55, 85),
    'urals': (55, 48, 65, 85),
    'west_siberia': (65, 48, 90, 85),
    'central_siberia': (90, 48, 120, 85),
    'far_east': (120, 48, 195, 85),
    'europe': (-25, 35, 45, 85),
    'central_asia': (45, 35, 90, 48),
    'east_asia': (90, 20, 180, 48),
    'south_asia': (45, -12, 100, 35),
    'southeast_asia': (100, -12, 180, 20),
    'africa': (-25, -60, 55, 35),
    'north_america': (-180, 15, -25, 85),
    'south_america': (-180, -60, -25, 15),
    'oceania': (55, -60, 180, -12),
    'antarctica': (-180, -90, 180, -60),
}
COAST_WINDOWS = {
    'west_russia': (30, 60, 45, 70), 'urals': (55, 66, 65, 76),
    'west_siberia': (65, 65, 90, 77), 'central_siberia': (90, 68, 120, 79),
    'far_east': (145, 48, 175, 65), 'europe': (-10, 48, 10, 60),
    'central_asia': (48, 35, 55, 47), 'east_asia': (120, 25, 140, 45),
    'south_asia': (68, 5, 90, 25), 'southeast_asia': (100, -10, 125, 15),
    'africa': (-18, 0, 15, 15), 'north_america': (-85, 25, -65, 48),
    'south_america': (-80, -40, -65, 0), 'oceania': (140, -40, 155, -15),
    'antarctica': (-65, -78, -45, -60),
}


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def region_for(lon, lat):
    if lon < -165 and lat >= 48:
        lon += 360
    for name, (west, south, east, north) in REGIONS.items():
        if west <= lon <= east and south <= lat <= north:
            return name
    return 'oceania'


def regions_for(lonlat):
    lonlat = np.asarray(lonlat)
    lon, lat = lonlat[:, 0].copy(), lonlat[:, 1]
    lon[(lon < -165) & (lat >= 48)] += 360
    result = np.full(len(lon), 'oceania', dtype=object)
    for name, (west, south, east, north) in reversed(REGIONS.items()):
        result[(lon >= west) & (lon <= east) & (lat >= south) & (lat <= north)] = name
    return result


def old_britain_owners(states, effects, triggers):
    owners = {sid: record.owner_tag for sid, record in states.items()}
    effect = _extract_assignment_block(_strip_comments(effects), 'ENG_OldBritain_ContentToggleEffect')
    transfers = {}
    for block in _iter_assignment_blocks(effect, 'every_state'):
        target = re.search(r'\btransfer_state_to\s*=\s*(SCO|WAL|CRN)\b', block)
        if not target:
            continue
        tag = target.group(1)
        assert re.fullmatch(r'\s*is_' + tag + r'_state\s*=\s*yes\s*', _extract_assignment_block(block, 'limit'))
        trigger = _extract_assignment_block(_strip_comments(triggers), f'is_{tag}_state')
        ids = [int(sid) for sid in re.findall(r'\bstate\s*=\s*(\d+)', trigger)]
        assert ids
        for sid in ids:
            owners[sid] = tag
            transfers[str(sid)] = tag
    assert set(transfers.values()) == {'SCO', 'WAL', 'CRN'}
    return owners, transfers


class SourceMap:
    def __init__(self, pixels, kinds, owners):
        self.pixels = pixels
        self.kinds = np.asarray(kinds)
        self.owners = np.asarray(owners)
        self.height, self.width = pixels.shape

    def lookup(self, xy):
        xy = np.asarray(xy)
        valid = np.isfinite(xy).all(axis=1)
        valid &= (xy[:, 0] >= 0) & (xy[:, 0] < self.width)
        valid &= (xy[:, 1] >= 0) & (xy[:, 1] < self.height)
        ids = np.zeros(len(xy), dtype=int)
        ids[valid] = self.pixels[np.floor(xy[valid, 1]).astype(int), np.floor(xy[valid, 0]).astype(int)]
        categories = np.full(len(xy), 'invalid', dtype=object)
        categories[valid] = self.kinds[ids[valid]]
        owners = np.full(len(xy), '', dtype=object)
        land = valid & (categories == 'land')
        owners[land] = self.owners[ids[land]]
        return ids, categories, owners


def load_source(root=TNO_ROOT):
    definitions = parse_definition_csv(root / 'map/definition.csv')
    rgb = np.asarray(Image.open(root / 'map/provinces.bmp'), dtype=np.int32)
    keys = rgb[:, :, 0] + (rgb[:, :, 1] << 8) + (rgb[:, :, 2] << 16)
    palette = np.zeros(1 << 24, dtype=np.int32)
    for pid, entry in definitions.items():
        palette[entry.r + (entry.g << 8) + (entry.b << 16)] = pid
    pixels = palette[keys]
    states = parse_states(root / 'history/states', as_of_date=AS_OF)
    state_owners, transfers = old_britain_owners(
        states,
        (root / 'common/scripted_effects/TNO_BRI_OLD_ENG_scripted_effects.txt').read_text(encoding='utf-8-sig'),
        (root / 'common/scripted_triggers/TNO_BRI_OLD_England_scripted_triggers.txt').read_text(encoding='utf-8-sig'),
    )
    size = max(definitions) + 1
    kinds = np.full(size, 'unknown', dtype=object)
    owners = np.full(size, '', dtype=object)
    for pid, entry in definitions.items():
        kinds[pid] = entry.province_type
    for sid, record in states.items():
        owners[record.province_ids] = state_owners[sid]
    return SourceMap(pixels, kinds, owners), states, transfers


def normalized_name(name):
    return ''.join(c for c in unicodedata.normalize('NFKD', name.casefold()) if c.isalnum())


def collect_controls(source, states, root=TNO_ROOT):
    city_index = defaultdict(set)
    cities = {}
    with zipfile.ZipFile(ROOT / 'data/cities15000.zip') as archive:
        for line in io.TextIOWrapper(archive.open('cities15000.txt'), encoding='utf-8'):
            fields = line.rstrip('\n').split('\t')
            city_id = 'geonames:' + fields[0]
            cities[city_id] = dict(city_id=city_id, lon=float(fields[5]), lat=float(fields[4]), city_source='data/cities15000.zip')
            for name in {fields[1], fields[2]}:
                city_index[normalized_name(name)].add(city_id)
    world = json.loads((ROOT / 'data/world_cities.geojson').read_text(encoding='utf-8'))
    for feature in world['features']:
        props = feature['properties']
        city_id = 'geonames:' + str(props['geonamesid']) if props.get('geonamesid') else str(props['city_id'])
        lon, lat = feature['geometry']['coordinates'][:2]
        cities[city_id] = dict(city_id=city_id, lon=lon, lat=lat, city_source='data/world_cities.geojson')
        for name in [props.get(k, '') for k in ('name', 'name_ascii', 'name_en')] + props.get('aliases', []):
            if name:
                city_index[normalized_name(name)].add(city_id)
    labels = defaultdict(set)
    localization = root / 'localisation/english/TNO_victory_points_l_english.yml'
    for pid, name in re.findall(r'^\s*VICTORY_POINTS_(\d+):\d*\s*"([^"]+)"', localization.read_text(encoding='utf-8-sig'), re.M):
        labels[int(pid)].add(normalized_name(name))
    counts = np.bincount(source.pixels.ravel(), minlength=len(source.kinds))
    yy, xx = np.indices(source.pixels.shape)
    sx = np.bincount(source.pixels.ravel(), weights=(xx + .5).ravel(), minlength=len(counts))
    sy = np.bincount(source.pixels.ravel(), weights=(yy + .5).ravel(), minlength=len(counts))
    controls, rejected = [], Counter()
    for sid, state in states.items():
        for pid, value in dict(state.victory_points).items():
            if value <= 0 or pid not in state.province_ids or not counts[pid]:
                rejected['inactive_or_wrong_state'] += 1
                continue
            matches = set().union(*(city_index[name] for name in labels[pid]))
            if len(labels[pid]) != 1 or len(matches) != 1:
                rejected['unmatched_or_ambiguous_name'] += 1
                continue
            city = cities[next(iter(matches))]
            controls.append(dict(city, province_id=pid, state_id=sid, owner=str(source.owners[pid]),
                                 x=float(sx[pid] / counts[pid]), y=float(sy[pid] / counts[pid]),
                                 weight=.25, anchor_source='map/provinces.bmp:province_pixel_centroid',
                                 state_source='history/states/' + state.file_name,
                                 localization_source=str(localization.relative_to(root)), as_of=AS_OF,
                                 supplemental=city['lat'] >= 65 or (city['lon'] >= 120 and city['lat'] >= 48)))
    usage = Counter(c['city_id'] for c in controls)
    rejected['city_used_by_multiple_provinces'] = sum(usage[c['city_id']] > 1 for c in controls)
    controls = [c for c in controls if usage[c['city_id']] == 1]
    for control in controls:
        control['region'] = region_for(control['lon'], control['lat'])
    return controls, dict(rejected)


def spatial_folds(lonlat):
    cells = np.floor((np.asarray(lonlat) + [180, 90]) / [5, 5]).astype(int)
    return (cells[:, 0] + 2 * cells[:, 1]) % 5


class RegionalModel:
    def __init__(self, controls, bounds, scheme, width):
        west, south, east, north = bounds
        self.lon0 = (west + east) / 2
        self.width = width
        crs = f'+proj=aeqd +lat_0={(south + north) / 2} +lon_0={self.lon0} +datum=WGS84 +units=km'
        self.project = Transformer.from_crs(4326, crs, always_xy=True)
        self.unproject = Transformer.from_crs(crs, 4326, always_xy=True)
        lonlat = np.array([[c['lon'], c['lat']] for c in controls])
        ground = np.column_stack(self.project.transform(*lonlat.T))
        pixel = np.array([[c['x'], c['y']] for c in controls])
        if east > 180:
            pixel[pixel[:, 0] < width / 2, 0] += width
        if scheme == 'tps':
            smoothing = np.array([1 / c['weight'] for c in controls])
            self.forward = RBFInterpolator(ground / 100, pixel, kernel='thin_plate_spline', smoothing=smoothing, neighbors=32)
            self.backward = RBFInterpolator(pixel / 10, ground, kernel='thin_plate_spline', smoothing=smoothing, neighbors=32)
        else:
            self.forward = LinearNDInterpolator(ground / 100, pixel)
            self.backward = LinearNDInterpolator(pixel / 10, ground)
        self.wrap = east > 180

    def lonlat_to_pixel(self, lonlat):
        ground = np.column_stack(self.project.transform(*np.asarray(lonlat).T))
        pixel = self.forward(ground / 100)
        if self.wrap:
            pixel[:, 0] %= self.width
        return pixel

    def pixel_to_lonlat(self, pixel):
        pixel = np.array(pixel, copy=True, dtype=float)
        if self.wrap:
            pixel[pixel[:, 0] < self.width / 2, 0] += self.width
        ground = self.backward(pixel / 10)
        return np.column_stack(self.unproject.transform(*ground.T))


def distance_metrics(distances, total):
    distances = np.asarray(distances)
    finite = distances[np.isfinite(distances)]
    return dict(checkpoints=total, valid_checkpoints=len(finite),
                median_km=float(np.median(finite)) if len(finite) else None,
                p90_km=float(np.percentile(finite, 90)) if len(finite) else None,
                p95_km=float(np.percentile(finite, 95)) if len(finite) else None,
                passed=bool(total >= 10 and len(finite) == total and np.median(finite) <= 10
                            and np.percentile(finite, 90) <= 25 and np.percentile(finite, 95) <= 50))


class Registration:
    def __init__(self, controls, width, validate=True):
        self.controls = controls
        self.models, self.metrics = {}, {}
        for region, bounds in REGIONS.items():
            west, south, east, north = bounds
            lon0 = (west + east) / 2
            local = [c for c in controls if west - 12 <= lon0 + ((c['lon'] - lon0 + 180) % 360 - 180) <= east + 12
                     and south - 10 <= c['lat'] <= north + 10]
            core = [c for c in local if c['region'] == region]
            metrics = dict(controls=len(core), support_controls=len(local),
                           supplemental_controls=sum(c['supplemental'] for c in core), schemes={})
            for scheme in SCHEMES:
                if len(local) >= 6:
                    self.models[region, scheme] = RegionalModel(local, bounds, scheme, width)
                if not validate:
                    continue
                errors, checkpoints = [], []
                folds = spatial_folds([[c['lon'], c['lat']] for c in local]) if local else []
                for fold in range(5):
                    train = [c for c, f in zip(local, folds) if f != fold]
                    test = [c for c, f in zip(local, folds) if f == fold and c['region'] == region]
                    if not test:
                        continue
                    predicted = np.full((len(test), 2), np.nan)
                    if len(train) >= 6:
                        model = RegionalModel(train, bounds, scheme, width)
                        predicted = model.pixel_to_lonlat([[c['x'], c['y']] for c in test])
                    _, _, meters = GEOD.inv([c['lon'] for c in test], [c['lat'] for c in test], *predicted.T)
                    for c, km in zip(test, np.asarray(meters) / 1000):
                        errors.append(km)
                        checkpoints.append(dict(city_id=c['city_id'], province_id=c['province_id'],
                                                fold=fold, error_km=float(km) if np.isfinite(km) else None))
                metrics['schemes'][scheme] = dict(distance_metrics(errors, len(core)), checkpoints_detail=checkpoints)
            metrics['passed'] = bool(validate and all(metrics['schemes'][s]['passed'] for s in SCHEMES))
            self.metrics[region] = metrics

    def lonlat_to_pixel(self, lonlat, scheme='tps'):
        lonlat = np.asarray(lonlat)
        regions = regions_for(lonlat)
        result = np.full((len(lonlat), 2), np.nan)
        for region in np.unique(regions):
            mask = regions == region
            if (region, scheme) in self.models:
                result[mask] = self.models[region, scheme].lonlat_to_pixel(lonlat[mask])
        return result


def sample_equal_area(geometry, count, seed=0):
    rng = np.random.default_rng(seed)
    parts = get_parts(geometry)
    projected = [transform(TO_AREA.transform, part) for part in parts]
    areas = np.array([part.area for part in projected])
    strata = (np.arange(count) + rng.random(count)) / count * areas.sum()
    selected = np.searchsorted(np.cumsum(areas), strata)
    samples = []
    for index, needed in zip(*np.unique(selected, return_counts=True)):
        xmin, ymin, xmax, ymax = projected[index].bounds
        fraction = areas[index] / ((xmax - xmin) * (ymax - ymin))
        while needed:
            side = int(np.ceil(np.sqrt(min(65536, max(256, needed / fraction)))))
            cells = rng.permutation(side * side)
            x = xmin + (cells % side + rng.random(len(cells))) / side * (xmax - xmin)
            y = ymin + (cells // side + rng.random(len(cells))) / side * (ymax - ymin)
            lon, lat = FROM_AREA.transform(x, y)
            inside = contains_xy(parts[index], lon, lat)
            accepted = np.column_stack([lon[inside], lat[inside]])[:needed]
            samples.extend(accepted)
            needed -= len(accepted)
    return np.asarray(samples)


def summarize_votes(kinds, owners):
    kinds, owners = np.asarray(kinds), np.asarray(owners)
    land = (kinds == 'land') & (owners != '')
    votes = Counter(owners[land])
    ordered = sorted(votes.items(), key=lambda item: (-item[1], item[0]))
    total, valid = len(kinds), int(land.sum())
    winner, count = ordered[0] if ordered else (None, 0)
    return dict(votes=dict(ordered), total_samples=total, valid_land_samples=valid,
                valid_land_fraction=valid / total, sea_fraction=float(np.mean(kinds == 'sea')),
                lake_fraction=float(np.mean(kinds == 'lake')),
                unowned_land_fraction=float(np.mean((kinds == 'land') & (owners == ''))),
                invalid_fraction=float(np.mean(~np.isin(kinds, ['land', 'sea', 'lake']))),
                mode=winner, mode_land_share=count / valid if valid else 0,
                mode_total_share=count / total,
                tied=len(ordered) > 1 and ordered[0][1] == ordered[1][1])


def sample_feature(geometry, registration, source, seed=0):
    count, target = 400, 400
    while True:
        lonlat = sample_equal_area(geometry, count, seed)
        results = {}
        for scheme in SCHEMES:
            _, kinds, owners = source.lookup(registration.lonlat_to_pixel(lonlat, scheme))
            results[scheme] = summarize_votes(kinds, owners)
        a, b = (results[s] for s in SCHEMES)
        boundary = any(len(r['votes']) > 1 or r['valid_land_fraction'] < 1 for r in results.values()) or a['mode'] != b['mode']
        if boundary:
            target = 1600
        if min(r['valid_land_samples'] for r in results.values()) >= target or count >= 25600:
            break
        count *= 2
    regions = sorted(set(regions_for(lonlat)))
    return dict(schemes=results, regions=regions, boundary=boundary, required_land_samples=target,
                sample_sufficient=all(r['valid_land_samples'] >= target for r in results.values()),
                schemes_agree=bool(a['mode'] and a['mode'] == b['mode'] and not a['tied'] and not b['tied']))


def coast_metrics(registration, source, land_gdf, region, spacing=10000):
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    west, south, east, north = COAST_WINDOWS[region]
    xmin, ymin = TO_AREA.transform(west, south)
    xmax, ymax = TO_AREA.transform(east, north)
    cols, rows = int(np.ceil((xmax - xmin) / spacing)), int(np.ceil((ymax - ymin) / spacing))
    xx, yy = np.meshgrid(xmin + (np.arange(cols) + .5) * spacing, ymax - (np.arange(rows) + .5) * spacing)
    lonlat = np.column_stack(FROM_AREA.transform(xx.ravel(), yy.ravel()))
    candidates = land_gdf.cx[xmin:xmax, ymin:ymax]
    ours = rasterize([(g, 1) for g in candidates.geometry], out_shape=(rows, cols),
                     transform=from_origin(xmin, ymax, spacing, spacing), fill=0).astype(bool)
    metrics = {}
    for scheme in SCHEMES:
        _, kinds, _ = source.lookup(registration.lonlat_to_pixel(lonlat, scheme))
        valid = np.isin(kinds, ['land', 'sea', 'lake']).reshape(rows, cols)
        theirs = (kinds == 'land').reshape(rows, cols)
        union = ((ours | theirs) & valid).sum()
        interior = binary_erosion(valid, border_value=0)
        coast_a = ours & ~binary_erosion(ours, border_value=1) & interior
        coast_b = theirs & ~binary_erosion(theirs, border_value=1) & interior
        distances = []
        for a, b in ((coast_a, coast_b), (coast_b, coast_a)):
            if a.any() and b.any():
                axy = np.column_stack([xx[a], yy[a]])
                bxy = np.column_stack([xx[b], yy[b]])
                nearest = cKDTree(bxy).query(axy)[1]
                alon, alat = FROM_AREA.transform(*axy.T)
                blon, blat = FROM_AREA.transform(*bxy[nearest].T)
                distances.extend(np.asarray(GEOD.inv(alon, alat, blon, blat)[2]) / 1000)
        iou = float((ours & theirs & valid).sum() / union) if union else None
        p50 = float(np.median(distances)) if distances else None
        p90 = float(np.percentile(distances, 90)) if distances else None
        coverage = float(valid.mean())
        metrics[scheme] = dict(iou=iou, p50_km=p50, p90_km=p90, valid_fraction=coverage,
                               passed=bool(coverage >= .99 and iou is not None and iou >= .95 and p90 is not None and p90 <= 10))
    return dict(window=[west, south, east, north], grid_spacing_m=spacing, schemes=metrics)
