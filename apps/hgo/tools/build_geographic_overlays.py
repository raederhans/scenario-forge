#!/usr/bin/env python3
"""Warp modern reference geography into the native HGO pixel plane.

The georeference is empirical, piecewise affine and deliberately partial.  City
province anchors are not survey points.  No extrapolation is made beyond valid
triangles.  Native terrain is an independent coarse cross-check, never the
replacement for the modern physical semantics or river sources.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import unicodedata

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import Delaunay, cKDTree
from scipy.ndimage import distance_transform_edt
from build_localization import make_simplifier


ROOT = Path(__file__).resolve().parents[3]
WIDTH, HEIGHT = 5120, 2560
MAX_EDGE_DEGREES = 35.0
CLASSES = ['basin_lowlands', 'mountain_high_relief', 'mountain_hills',
           'plains_lowlands', 'upland_plateau', 'wetlands_delta', 'desert_bare',
           'forest_temperate', 'grassland_steppe', 'rainforest_tropical', 'tundra_ice', 'badlands_canyon']
CLASS_LABELS_ZH = ['盆地低地', '高山', '山地丘陵', '平原低地', '高原台地', '湿地三角洲',
                   '荒漠裸地', '温带森林', '草原', '热带雨林', '苔原冰雪', '恶地峡谷']
NATIVE_CLASS_NAMES = CLASSES + ['urban']
NATIVE_TERRAIN_CLASS = {0:'plains_lowlands',1:'forest_temperate',2:'mountain_hills',3:'desert_bare',
    4:'forest_temperate',5:'plains_lowlands',6:'mountain_high_relief',7:'desert_bare',8:'desert_bare',
    9:'wetlands_delta',10:'mountain_high_relief',11:'mountain_high_relief',12:'desert_bare',13:'urban',
    16:'tundra_ice',17:'mountain_hills',18:'mountain_high_relief',19:'tundra_ice',20:'mountain_high_relief',
    21:'rainforest_tropical',22:'rainforest_tropical',27:'mountain_high_relief',31:'mountain_high_relief'}
# Explicit, conservative *control-matching* context, not a statistical join.
# Colonial territory under an imperial owner is omitted when its modern country
# differs.  Country aliases do not assign an ISO identity to a project country.
CONTROL_COUNTRIES = {
    'USA':'US', 'GER':'DE', 'AST':'AU', 'RUS':'RU', 'SPR':'ES', 'ENG':'GB',
    'RAJ':'IN', 'FRA':'FR', 'ITA':'IT', 'TUR':'TR', 'POL':'PL', 'ROM':'RO',
    'JAP':'JP', 'GRE':'GR', 'BRA':'BR', 'SWI':'CH', 'CAN':'CA', 'NZL':'NZ',
    'BEL':'BE', 'AUS':'AT', 'HUN':'HU', 'POR':'PT', 'HOL':'NL', 'SWE':'SE',
    'NOR':'NO', 'DEN':'DK', 'FIN':'FI', 'BUL':'BG', 'CZE':'CZ', 'CHI':'CN',
    'CHL':'CL', 'ARG':'AR', 'BOL':'BO', 'COL':'CO', 'ECU':'EC', 'VEN':'VE',
    'MEX':'MX', 'SAF':'ZA', 'EGY':'EG', 'SIA':'TH', 'IRQ':'IQ', 'PER':'IR',
    'AFG':'AF', 'IRE':'IE', 'ALB':'AL', 'ETH':'ET', 'NEP':'NP', 'BHU':'BT',
    'LUX':'LU', 'LIT':'LT', 'LAT':'LV', 'EST':'EE', 'MAL':'MY', 'CUB':'CU',
    'DOM':'DO', 'HAI':'HT', 'NIC':'NI', 'COS':'CR', 'HON':'HN', 'GUA':'GT',
    'PAN':'PA', 'ELS':'SV', 'URG':'UY', 'PAR':'PY', 'PHI':'PH',
}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def read_json(path):
    return json.loads(Path(path).read_bytes())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def norm(value):
    ascii_name = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return re.sub('[^a-z0-9]', '', ascii_name.lower())


def match_controls(places, cities):
    index = {}
    for feature in cities:
        prop = feature['properties']
        names = [prop.get(k, '') for k in ('name', 'name_en', 'name_ascii')]
        names += prop.get('aliases', [])
        for name in set(map(norm, names)):
            if name:
                index.setdefault((prop.get('country_code'), name), {})[prop['id']] = feature
    pairs, omitted = [], {'no_country_context': 0, 'unmatched': 0, 'ambiguous': 0}
    for place in sorted(places, key=lambda p: p['id']):
        country = CONTROL_COUNTRIES.get(place['entityTag'])
        if not country:
            omitted['no_country_context'] += 1
            continue
        matches = list(index.get((country, norm(place['name'])), {}).values())
        if len(matches) != 1:
            omitted['ambiguous' if matches else 'unmatched'] += 1
            continue
        city = matches[0]
        lon, lat = city['geometry']['coordinates']
        pairs.append(dict(id=place['id'], name=place['name'], entityTag=place['entityTag'],
                          countryCode=country, cityId=city['properties']['id'],
                          lon=lon, lat=lat, x=place['x'], y=place['y']))
    return pairs, omitted


def design(lonlat, projection='equirectangular', degree=1):
    x, lat = lonlat[:, 0] / 180, lonlat[:, 1]
    if projection == 'mercator':
        y = np.log(np.tan(np.pi / 4 + np.deg2rad(np.clip(lat, -85, 85)) / 2))
    elif projection == 'miller':
        y = 1.25 * np.log(np.tan(np.pi / 4 + .4 * np.deg2rad(lat)))
    else:
        y = lat / 90
    columns = [np.ones(len(x)), x, y]
    if degree >= 2:
        columns += [x*x, x*y, y*y]
    if degree >= 3:
        columns += [x**3, x*x*y, x*y*y, y**3]
    return np.array(columns).T


def robust_fit(matrix, target, eligible):
    good = eligible.copy()
    for _ in range(4):
        coefficients = np.linalg.lstsq(matrix[good], target[good], rcond=None)[0]
        error = np.linalg.norm(matrix @ coefficients - target, axis=1)
        good = eligible & (error < max(40, np.median(error[eligible]) * 3))
    return coefficients


def error_summary(errors):
    errors = np.asarray(errors)
    errors = errors[np.isfinite(errors)]
    if not len(errors):
        return {'count': 0}
    return dict(count=len(errors), medianPx=round(float(np.median(errors)), 4),
                p90Px=round(float(np.percentile(errors, 90)), 4),
                p95Px=round(float(np.percentile(errors, 95)), 4),
                maxPx=round(float(np.max(errors)), 4))


def cross2(a, b):
    return a[..., 0]*b[..., 1] - a[..., 1]*b[..., 0]


def triangulate(lonlat, native):
    delaunay = Delaunay(lonlat)
    triangles = delaunay.simplices
    geo, pixel = lonlat[triangles], native[triangles]
    geo_area = cross2(geo[:, 1]-geo[:, 0], geo[:, 2]-geo[:, 0])
    pixel_area = cross2(pixel[:, 1]-pixel[:, 0], pixel[:, 2]-pixel[:, 0])
    max_edge = np.max(np.linalg.norm(geo-np.roll(geo, 1, axis=1), axis=2), axis=1)
    # Latitude is north-up; native y is down. A positive product is a fold.
    valid = (geo_area*pixel_area < 0) & (np.abs(pixel_area) >= 1) & (max_edge <= MAX_EDGE_DEGREES)
    return delaunay, triangles, valid, max_edge


def transform_points(lonlat, native, delaunay, triangles, valid, points):
    """Forward map N×2 longitude/latitude points; unsupported results are NaN."""
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    simplex = delaunay.find_simplex(points)
    ok = simplex >= 0
    ok &= valid[np.maximum(simplex, 0)]
    output = np.full(points.shape, np.nan)
    if ok.any():
        s = simplex[ok]
        transform = delaunay.transform[s]
        bary = np.einsum('nij,nj->ni', transform[:, :2], points[ok]-transform[:, 2])
        bary = np.column_stack((bary, 1-bary.sum(axis=1)))
        output[ok] = np.einsum('ni,nij->nj', bary, native[triangles[s]])
    return output


def raster_inverse(model, width=512, height=256):
    """Shared-triangle inverse, sampled at native-aligned output pixel centers.

    Returns float32 [longitude,latitude] and uint8 confidence. Unsupported or
    conflicting overlap samples are NaN/0.  This is NOT an equirectangular grid.
    """
    control = model['controlPoints']
    geo = np.array([[p['lon'], p['lat']] for p in control])
    native = np.array([[p['x'], p['y']] for p in control])
    triangles = np.array(model['triangles'], dtype=int)
    result = np.full((height, width, 2), np.nan, dtype=np.float32)
    confidence = np.zeros((height, width), dtype=np.uint8)
    conflicts = np.zeros((height, width), dtype=bool)
    for number, tri in enumerate(triangles):
        if not model['validTriangles'][number]:
            continue
        pixel = native[tri] * [width / WIDTH, height / HEIGHT]
        x0, y0 = np.maximum(0, np.floor(pixel.min(axis=0)).astype(int))
        x1, y1 = np.minimum([width, height], np.ceil(pixel.max(axis=0)).astype(int))
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        matrix = np.column_stack((pixel[0]-pixel[2], pixel[1]-pixel[2]))
        bary = np.stack((xx+.5-pixel[2, 0], yy+.5-pixel[2, 1]), axis=-1) @ np.linalg.inv(matrix).T
        bary = np.dstack((bary, 1-bary.sum(axis=-1)))
        inside = (bary >= -1e-7).all(axis=-1)
        values = bary @ geo[tri]
        target = result[y0:y1, x0:x1]
        conf = confidence[y0:y1, x0:x1]
        overlap = inside & (conf > 0)
        conflict = overlap & (np.linalg.norm(target-values, axis=-1) > .001)
        conflicts[y0:y1, x0:x1] |= conflict
        target[inside] = values[inside]
        # Confidence encodes support, not a probability of geographic accuracy.
        edge = model['triangleMaxEdgeDegrees'][number]
        conf[inside] = 255 if edge <= 18 else 180
    result[conflicts] = np.nan
    confidence[conflicts] = 0
    return result, confidence


def fit_rbf(inputs, targets, smoothing=.001):
    """Explicit thin-plate coefficients, with an affine tail and fixed scaling."""
    delta = inputs[:, None, :]-inputs[None, :, :]
    radius2 = np.sum(delta*delta, axis=-1)
    kernel = .5*radius2*np.log(np.maximum(radius2, 1e-300))
    polynomial = np.column_stack((np.ones(len(inputs)), inputs))
    matrix = np.block([[kernel+np.eye(len(inputs))*smoothing, polynomial],
                       [polynomial.T, np.zeros((3,3))]])
    result = np.linalg.solve(matrix, np.vstack((targets, np.zeros((3,2)))))
    return dict(centers=inputs.tolist(), weights=result[:-3].tolist(), affine=result[-3:].tolist(), smoothing=smoothing)


def evaluate_rbf(model, points, gradient=False):
    points = np.asarray(points).reshape(-1, 2)
    centers, weights, affine = (np.asarray(model[k]) for k in ('centers','weights','affine'))
    result = np.empty(points.shape)
    derivatives = np.empty((len(points),2,2)) if gradient else None
    for start in range(0,len(points),1024):
        p = points[start:start+1024]
        delta = p[:, None, :]-centers
        radius2 = np.sum(delta*delta, axis=-1)
        log_radius2 = np.log(np.maximum(radius2,1e-300))
        result[start:start+len(p)] = (.5*radius2*log_radius2)@weights + np.column_stack((np.ones(len(p)),p))@affine
        if gradient:
            derivatives[start:start+len(p)] = np.einsum('nci,co->noi',delta*(log_radius2+1)[...,None],weights)+affine[1:].T
    return (result, derivatives) if gradient else result


def smooth_inverse_grid(forward, seed_inverse, width=512, height=256):
    yy,xx = np.mgrid[:height,:width]
    target = np.column_stack(((xx.ravel()+.5)*WIDTH/width,(yy.ravel()+.5)*HEIGHT/height))
    coordinates = evaluate_rbf(seed_inverse,target/[WIDTH,HEIGHT])
    for _ in range(4):
        predicted, jacobian = evaluate_rbf(forward,coordinates/[180,90],True)
        jacobian /= np.array([180,90])
        delta = predicted-target
        determinant = cross2(jacobian[:,0],jacobian[:,1])
        safe = np.abs(determinant)>1e-8
        correction = np.zeros_like(delta)
        correction[safe,0] = (jacobian[safe,1,1]*delta[safe,0]-jacobian[safe,0,1]*delta[safe,1])/determinant[safe]
        correction[safe,1] = (-jacobian[safe,1,0]*delta[safe,0]+jacobian[safe,0,0]*delta[safe,1])/determinant[safe]
        coordinates -= np.clip(correction,-10,10)
    predicted,jacobian = evaluate_rbf(forward,coordinates/[180,90],True)
    jacobian /= np.array([180,90])
    error = np.linalg.norm(predicted-target,axis=1)
    # Broad illumination is allowed farther than reference lines/points. It is
    # explicitly approximate and cannot establish a night-light city's location.
    valid = (error<.25)&(cross2(jacobian[:,0],jacobian[:,1])<0)
    valid &= (np.abs(coordinates[:,0])<=180)&(coordinates[:,1]>=-60)&(coordinates[:,1]<=85)
    coordinates[~valid] = np.nan
    return coordinates.astype('<f4').reshape(height,width,2),valid.reshape(height,width)


def add_smooth_registration(model):
    controls = model['controlPoints']
    a = np.array([[p[k]for k in ('lon','lat','x','y')] for p in controls])
    # Confirm the selected smoothing on a different deterministic city split.
    # Every fifth id at offset 0 was used for comparing candidate models.
    confirm = np.arange(len(a))%5 == 1
    confirm_forward = fit_rbf(a[~confirm,:2]/[180,90],a[~confirm,2:])
    prediction = evaluate_rbf(confirm_forward,a[confirm,:2]/[180,90])
    error = np.linalg.norm(prediction-a[confirm,2:],axis=1)
    confirmed = error_summary(error)
    if confirmed['p95Px']>25 or confirmed['maxPx']>60:
        raise ValueError(f'Smooth registration confirmation failed: {confirmed}')
    forward = fit_rbf(a[:,:2]/[180,90],a[:,2:])
    seed = fit_rbf(a[:,2:]/[WIDTH,HEIGHT],a[:,:2])
    inverse, broad_valid = smooth_inverse_grid(forward,seed)
    safe = np.nan_to_num(inverse.reshape(-1,2))
    native_y,native_x = np.mgrid[:256,:512]
    native_grid = np.column_stack(((native_x.ravel()+.5)*10,(native_y.ravel()+.5)*10))
    distance = cKDTree(a[:,2:]).query(native_grid)[0].reshape(256,512)
    hull = Delaunay(a[:,:2]).find_simplex(safe).reshape(256,512)>=0
    # A 500px nearest-control limit permits the smooth supported continuation
    # where a single long Delaunay edge was overly restrictive. Remote domains
    # are kept for the broad solar effect only, or native reference fallback.
    reference_valid = broad_valid & (distance<=500)
    confidence = np.where(reference_valid,np.where(hull & (distance<=200),255,180),0).astype(np.uint8)
    broad_confidence = np.where(broad_valid,np.where(reference_valid,180,96),0).astype(np.uint8)
    reference_inverse = inverse.copy()
    reference_inverse[~reference_valid] = np.nan
    sample_lon,sample_lat = np.meshgrid(np.linspace(-180,180,73),np.linspace(-60,85,30))
    samples = np.column_stack((sample_lon.ravel(),sample_lat.ravel()))
    _,derivative = evaluate_rbf(forward,samples/[180,90],True)
    folded = cross2(derivative[:,0],derivative[:,1])>=0
    model['smoothRegistration'] = dict(method='thin-plate-spline-affine-tail',normalization=[180,90],
        forward=forward, inverseSeed=seed, inverseSeedNormalization=[WIDTH,HEIGHT],
        inverseMethod='seed plus four Newton iterations; forward residual <=0.25 native pixels',
        confirmation=dict(split='sorted accepted city ids: every fifth at offset one held out',metrics=confirmed,
                          points=[dict(controls[i],errorPx=round(float(e),4)) for i,e in zip(np.flatnonzero(confirm),error)]),
        jacobianCheck=dict(sampleCount=len(samples),foldCount=int(folded.sum()),domain=[-180,-60,180,85]),
        confidencePolicy={'255':'inside control hull and within 200 native px of a control',
                          '180':'smooth modern reference within 500 native px of a control',
                          '96':'broad solar approximation only; modern point/line layers excluded',
                          '0':'unsupported, invalid inverse or fold'},
        limitation='City anchors and smooth extrapolation are approximate; no local surveyed accuracy claim outside controls.')
    model['format']='hgo-city-georeference'
    model['strictTriangleMethod']=model['method']
    model['method']='thin-plate-spline-affine-tail'
    model['trianglesPurpose']='Strict shared-triangle diagnostic baseline; active forward mapping is smoothRegistration.'
    model['unsupportedPolicy']='Modern reference uses the smooth inverse within 500 native pixels of city controls. Broad solar approximation permits bounded smooth continuation over lon [-180,180], lat [-60,85]. Invalid inverse solutions and local folds are excluded; confidence distinguishes these domains.'
    return reference_inverse,confidence,inverse,broad_confidence


def region(lon, lat):
    if lon < -25:
        return 'north_america' if lat >= 12 else 'south_america'
    if lon >= 110 and lat < -10:
        return 'oceania'
    if -20 < lon < 55 and lat < 36:
        return 'africa'
    if lon < 45 and lat >= 36:
        return 'europe'
    return 'asia'


def build_georeference(places, cities):
    pairs, omitted = match_controls(places, cities)
    a = np.array([[p[k] for k in ('lon', 'lat', 'x', 'y')] for p in pairs])
    train = np.array([i % 5 != 0 for i in range(len(a))])
    candidates = []
    for projection in ('equirectangular', 'mercator', 'miller'):
        for degree in (1, 2, 3):
            matrix = design(a[:, :2], projection, degree)
            coeff = robust_fit(matrix, a[:, 2:], train)
            error = np.linalg.norm(matrix @ coeff-a[:, 2:], axis=1)
            candidates.append(dict(projection=projection, degree=degree,
                                   holdout=error_summary(error[~train])))
    # Gross name collisions (e.g. historical colonial Rodi vs modern Italian
    # Rodi) are audited, not silently absorbed into a local correction.
    matrix = design(a[:, :2], 'miller', 3)
    coarse = robust_fit(matrix, a[:, 2:], train)
    gross_error = np.linalg.norm(matrix @ coarse-a[:, 2:], axis=1)
    accepted = gross_error <= WIDTH * .035
    rejected = [dict(p, coarseResidualPx=round(float(e), 3), reason='gross-name-match-discrepancy')
                for p, e, ok in zip(pairs, gross_error, accepted) if not ok]
    fitting = train & accepted
    dt, tt, vv, _ = triangulate(a[fitting, :2], a[fitting, 2:])
    prediction = transform_points(a[fitting, :2], a[fitting, 2:], dt, tt, vv, a[~train & accepted, :2])
    errors = np.linalg.norm(prediction-a[~train & accepted, 2:], axis=1)
    validation_rows = []
    for point, predicted, error in zip([p for p, tr, ac in zip(pairs, train, accepted) if not tr and ac], prediction, errors):
        validation_rows.append(dict(point, region=region(point['lon'], point['lat']), supported=bool(np.isfinite(error)),
                                    errorPx=round(float(error), 4) if np.isfinite(error) else None,
                                    predicted=predicted.tolist() if np.isfinite(error) else None))
    validation = dict(split='sort native place id; every fifth city held out before fitting',
                      candidateCount=len(pairs), rejectedMatches=rejected, omittedMatching=omitted,
                      lowOrderCandidates=candidates, holdoutCount=len(validation_rows),
                      supportedHoldout=error_summary(errors),
                      byRegion={r:error_summary([p['errorPx'] for p in validation_rows if p['region']==r and p['supported']])
                                for r in sorted({p['region'] for p in validation_rows})},
                      holdoutPoints=validation_rows)
    stats = validation['supportedHoldout']
    if stats['count'] < len(validation_rows)*.75 or stats['p95Px'] > 20 or stats['maxPx'] > 30:
        raise ValueError(f'Georeference holdout quality gate failed: {stats}')
    controls = [p for p, ok in zip(pairs, accepted) if ok]
    a = a[accepted]
    dt, triangles, valid, edges = triangulate(a[:, :2], a[:, 2:])
    model = dict(format='hgo-city-triangulated-georeference', schemaVersion=1,
                 nativeSize=[WIDTH, HEIGHT], coordinateSpace='hgo-pixel-top-left',
                 geographicSpace='longitude-latitude-degrees', method='shared-triangle-piecewise-affine',
                 maxTriangleEdgeDegrees=MAX_EDGE_DEGREES, controlPoints=controls,
                 triangles=triangles.tolist(), validTriangles=valid.tolist(),
                 triangleMaxEdgeDegrees=np.round(edges, 6).tolist(),
                 interpretation='Approximate modern-reference alignment to native province anchors; not a surveyed CRS.',
                 unsupportedPolicy='No extrapolation; reject inverted, degenerate, overlong and conflicting triangles.',
                 validation=validation)
    return model, (a[:, :2], a[:, 2:], dt, triangles, valid)


def native_water(dataset):
    core = read_json(dataset/'core.json')
    ids = np.frombuffer(gzip.decompress((dataset/'ids.u16.gz').read_bytes()), dtype='<u2').reshape(HEIGHT, WIDTH)
    tags = {s['id']:s['entityTag'] for s in core['states']}
    water = np.array([False] + [tags.get(s)=='WTR' for s in core['provinceStateIds'][1:]])
    return water[ids]


def sample_native(array, width, height):
    ys = np.minimum(HEIGHT-1, ((np.arange(height)+.5)*HEIGHT/height).astype(int))
    xs = np.minimum(WIDTH-1, ((np.arange(width)+.5)*WIDTH/width).astype(int))
    return array[ys[:, None], xs]


def decode_topology(topology):
    scale, translate = topology['transform']['scale'], topology['transform']['translate']
    arcs = []
    for arc in topology['arcs']:
        points = np.cumsum(np.asarray(arc), axis=0)*scale + translate
        arcs.append(points.tolist())
    def ring(indices):
        result = []
        for index in indices:
            segment = arcs[index] if index >= 0 else arcs[~index][::-1]
            result.extend(segment if not result else segment[1:])
        return result
    return [(geometry['properties'], [ring(indices) for indices in geometry['arcs']])
            for geometry in topology['objects']['physical_semantics']['geometries']]


def physical_source_raster(topology, width=4096, height=2048):
    image = Image.new('L', (width, height))
    polygons = decode_topology(topology)
    polygons.sort(key=lambda item: item[0]['atlas_layer'] != 'relief_base')
    for prop, rings in polygons:
        # Separate polygon mask prevents holes erasing previously drawn layers.
        mask = Image.new('1', image.size)
        draw = ImageDraw.Draw(mask)
        outer_center = None
        for index, ring in enumerate(rings):
            coords = np.asarray(ring)
            # Unwrap each source ring before drawing periodic copies. A raw
            # +179 -> -179 segment must cross the seam, not the whole map.
            longitude = np.rad2deg(np.unwrap(np.deg2rad(coords[:, 0])))
            center = float((longitude.min()+longitude.max())/2)
            if outer_center is None:
                longitude -= 360*round(center/360)
                outer_center = float((longitude.min()+longitude.max())/2)
            else:
                longitude += 360*round((outer_center-center)/360)
            points = np.column_stack(((longitude+180)*width/360, (90-coords[:, 1])*height/180))
            for shift in (-width, 0, width):
                draw.polygon([(x+shift, y) for x,y in points], fill=1 if index==0 else 0)
        image.paste(CLASSES.index(prop['atlas_class'])+1, mask=mask)
    return np.asarray(image)


def warp_physical(source, lonlat, confidence, water):
    valid = confidence > 0
    safe = np.nan_to_num(lonlat)
    x = np.clip(((safe[..., 0]+180)*source.shape[1]/360).astype(int), 0, source.shape[1]-1)
    y = np.clip(((90-safe[..., 1])*source.shape[0]/180).astype(int), 0, source.shape[0]-1)
    result = source[y, x].copy()
    result[~valid | water] = 0
    return result


def geographic_lines(geometry):
    return geometry['coordinates'] if geometry['type']=='MultiLineString' else [geometry['coordinates']]


def river_raster(features, transform, water, reference_confidence=None, native_rivers=None):
    image = Image.new('L', (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    count, supported, source_points = 0, 0, 0
    for feature in features:
        if feature['properties'].get('featurecla') != 'River':
            continue
        count += 1
        for line in geographic_lines(feature['geometry']):
            points = []
            for a, b in zip(line, line[1:]):
                a, b = np.asarray(a[:2]), np.asarray(b[:2])
                if abs(b[0]-a[0]) > 180:
                    continue
                length = max(1, int(np.ceil(np.linalg.norm(b-a)/.12)))
                points.extend(a+(b-a)*np.arange(length)[:, None]/length)
            if not points:
                continue
            points.append(np.asarray(line[-1][:2]))
            mapped = transform(np.array(points)) if callable(transform) else transform_points(*transform, np.array(points))
            if reference_confidence is not None:
                pixels = np.nan_to_num(mapped).astype(int)
                in_bounds = (pixels[:,0]>=0)&(pixels[:,0]<WIDTH)&(pixels[:,1]>=0)&(pixels[:,1]<HEIGHT)
                supported_region = np.zeros(len(pixels),dtype=bool)
                supported_region[in_bounds] = reference_confidence[pixels[in_bounds,1]//10,pixels[in_bounds,0]//10]>0
                mapped[~supported_region] = np.nan
            source_points += len(mapped)
            supported += int(np.isfinite(mapped[:, 0]).sum())
            run = []
            for point in mapped:
                if not np.isfinite(point).all() or (run and np.linalg.norm(point-run[-1]) > 40):
                    if len(run)>1:
                        draw.line(run, fill=255, width=2)
                    run = []
                if np.isfinite(point).all():
                    run.append(tuple(point))
            if len(run)>1:
                draw.line(run, fill=255, width=2)
    result = np.asarray(image).copy()
    result[water] = 0
    modern_pixels = int(np.count_nonzero(result))
    native_pixels = 0
    if native_rivers is not None:
        from PIL import ImageFilter
        # Source indices 0/1 are endpoint/junction markers; 2..11 are line
        # classes. Keep source linework only, suppress duplicates within 3px
        # of an already painted modern reference centerline.
        nearby_modern = np.asarray(Image.fromarray(result).filter(ImageFilter.MaxFilter(7)))>0
        supplement = np.isin(native_rivers,np.arange(2,12)) & ~water & ~nearby_modern
        result[supplement] = 128
        native_pixels = int(supplement.sum())
    return result, dict(sourceRiverCount=count, densifiedPointCount=source_points,
                        supportedPointCount=supported, paintedPixels=int(np.count_nonzero(result)),
                        modernPaintedPixels=modern_pixels,nativeSupplementPixels=native_pixels,
                        values={'255':'modern Natural Earth River centerline','128':'native mod river linework supplement'},
                        interpretation='Modern river centerlines plus native mod linework; lake centerlines omitted; native WTR clipped; native supplement is not modern hydrographic validation.')


def enlarge_geographic_grid(lonlat, confidence, width, height):
    mask = (confidence>0).astype(np.float32)
    weight = np.asarray(Image.fromarray(mask).resize((width,height),Image.Resampling.BILINEAR))
    result = np.empty((height,width,2),dtype=np.float32)
    for channel in range(2):
        source = np.nan_to_num(lonlat[...,channel])*mask
        summed = np.asarray(Image.fromarray(source).resize((width,height),Image.Resampling.BILINEAR))
        result[...,channel] = summed/np.maximum(weight,1e-8)
    conf = np.asarray(Image.fromarray(confidence).resize((width,height),Image.Resampling.NEAREST)).copy()
    conf[weight<.999] = 0
    result[conf==0] = np.nan
    return result,conf


def put_gzip(output, name, array, encoding):
    raw = np.ascontiguousarray(array).tobytes()
    stream = io.BytesIO()
    with gzip.GzipFile(fileobj=stream, mode='wb', filename='', mtime=0, compresslevel=9) as handle:
        handle.write(raw)
    data = stream.getvalue()
    (output/name).write_bytes(data)
    return dict(url=name, encoding=encoding, byteLength=len(data), decodedByteLength=len(raw), sha256=digest(data),
                width=array.shape[1], height=array.shape[0],channels=array.shape[2] if array.ndim>2 else 1)


def categorical_nearest_2x2(values):
    """Select an existing packed class; averaging would invent source classes."""
    if values.ndim!=2 or any(size%2 for size in values.shape):
        raise ValueError('Categorical 2x downsampling requires even 2D dimensions')
    return values[1::2,1::2].copy()


def maximum_2x2(values):
    """Keep single-pixel rivers and the 255-modern > 128-native provenance."""
    if values.ndim!=2 or any(size%2 for size in values.shape):
        raise ValueError('River 2x downsampling requires even 2D dimensions')
    height,width=values.shape
    return values.reshape(height//2,2,width//2,2).max(axis=(1,3))


def river_distance_field(values):
    """R8 signed distance to the raster boundary, in this texture's texels.

    A half-texel boundary offset keeps single-texel branches at width .5.
    Both provenance values describe linework; provenance remains in the
    original mask, while the distance field has uniform visual opacity.
    Padding makes image edges real boundaries rather than EDT's implicit
    background behavior. Empty input must stay wholly outside.
    """
    inside = np.pad(values > 0, 1)
    if not inside.any():
        return np.zeros(values.shape, dtype=np.uint8)
    distance = distance_transform_edt(inside)
    outside_distance = distance_transform_edt(~inside)
    distance = np.where(inside, distance-.5, .5-outside_distance)[1:-1, 1:-1]
    return np.clip(np.rint(128+16*distance), 0, 255).astype(np.uint8)


def river_distance_assets(output, rivers, balanced):
    assets = {}
    for key, filename, source, values in (
            ('riversDistance', 'rivers-distance.u8.gz', 'rivers', rivers),
            ('riversDistanceBalanced', 'rivers-distance-balanced.u8.gz', 'riversBalanced', balanced)):
        asset = put_gzip(output, filename, river_distance_field(values), 'gzip-u8')
        asset.update(derivedFrom=source, distanceField=dict(version=1, zero=128, unitsPerTexel=16),
                     distanceEncoding='(value - 128) / 16 texture texels; positive inside; clamped signed Euclidean boundary distance',
                     widthControl='Relative edge adjustment: (width - 1) / 2 texture texels per side; not CSS pixels or a proportional width multiplier',
                     provenance='Original 128/255 source values retained in source mask; uniform opacity in distance rendering',
                     coastline='Renderer clips every fragment against native WTR after distance expansion')
        assets[key] = asset
    return assets


def build_river_distance_only(root=ROOT, output=None):
    """Derive render fields without rebuilding or modifying source linework."""
    output = Path(output or Path(root)/'apps/hgo/assets/overlays/geography')
    manifest = read_json(output/'manifest.json')
    values = []
    for key in ('rivers', 'riversBalanced'):
        asset = manifest['assets'][key]
        data = (output/asset['url']).read_bytes()
        if len(data) != asset['byteLength'] or digest(data) != asset['sha256']:
            raise ValueError(f'River source identity mismatch: {key}')
        raw = gzip.decompress(data)
        if len(raw) != asset['decodedByteLength']:
            raise ValueError(f'River source decoded size mismatch: {key}')
        values.append(np.frombuffer(raw, dtype=np.uint8).reshape(asset['height'], asset['width']))
    manifest['assets'].update(river_distance_assets(output, *values))
    (output/'manifest.json').write_bytes(encoded(manifest))
    return manifest


def prepare_label_names(root, labels):
    """Normalize source spelling offline, with ID-bound reviewed exceptions."""
    root = Path(root)
    paths = ['data/physical_region_labels.geojson',
             'apps/hgo/assets/overlays/geography/name_reviews.json',
             'apps/hgo/assets/overlays/localization/TSPhrases.txt',
             'apps/hgo/assets/overlays/localization/TSCharacters.txt']
    raw = [(root/path).read_bytes() for path in paths]
    source = {feature['properties']['id']: feature['properties']
              for feature in json.loads(raw[0])['features']}
    reviews = json.loads(raw[1])
    if reviews.get('schemaVersion') != 1 or not isinstance(reviews.get('entries'), list):
        raise ValueError('Invalid landform name review schema')
    reviewed = {}
    for row in reviews['entries']:
        identity = row['id']
        original = source.get(identity)
        if identity in reviewed or not original or row.get('originalEn') != original.get('name_en') or row.get('originalZh') != original.get('name_zh', ''):
            raise ValueError(f'Landform name review source changed: {identity}')
        if not isinstance(row.get('proposedZh'), str) or not row.get('reason') or not row.get('source'):
            raise ValueError(f'Invalid landform name evidence: {identity}')
        if 'proposedEn' in row and (not isinstance(row['proposedEn'], str) or not row['proposedEn'].strip()):
            raise ValueError(f'Invalid reviewed English landform name: {identity}')
        reviewed[identity] = row
    simplify = make_simplifier(*(value.decode('utf8') for value in raw[2:]))
    normalized = []
    for label in labels:
        original = source.get(label['id'])
        review = reviewed.get(label['id'], {})
        en = review.get('proposedEn', original['name_en'] if original else '')
        if not original or label['nameEn'] not in (original['name_en'], en):
            raise ValueError(f'Landform source identity changed: {label["id"]}')
        zh = review.get('proposedZh', original.get('name_zh', ''))
        normalized.append({**label, 'nameEn': en, 'nameZh': simplify(zh)})
    return normalized, dict(
        policy='ID/original bilingual value-bound corrections; uncertain Chinese falls back to English. Pinned OpenCC 1.1.9 longest phrase then character, first target.',
        reviewedCount=len(reviewed),
        sources=[dict(path=path, sha256=digest(value)) for path, value in zip(paths, raw)])


def build_label_names_only(root=ROOT, output=None):
    """Refresh text only; preserve registered coordinates and every raster."""
    output = Path(output or Path(root)/'apps/hgo/assets/overlays/geography')
    manifest = read_json(output/'manifest.json')
    source = manifest['assets']['labels']
    raw = (output/source['url']).read_bytes()
    if len(raw) != source['byteLength'] or digest(raw) != source['sha256']:
        raise ValueError('Registered label integrity mismatch')
    value = json.loads(raw)
    value['labels'], manifest['labelNames'] = prepare_label_names(root, value['labels'])
    payload = encoded(value)
    (output/source['url']).write_bytes(payload)
    source.update(byteLength=len(payload), sha256=digest(payload))
    (output/'manifest.json').write_bytes(encoded(manifest))
    return manifest


def balanced_assets(output,physical,rivers,water):
    terrain=categorical_nearest_2x2(physical)
    river=maximum_2x2(rivers)
    for values in (terrain,river):
        values[sample_native(water,values.shape[1],values.shape[0])]=0
    physical_asset=put_gzip(output,'physical-balanced.u8.gz',terrain,'gzip-u8')
    physical_asset.update(derivedFrom='physical',downsampling='2x2 nearest categorical (bottom-right tie); never average packed class codes')
    river_asset=put_gzip(output,'rivers-balanced.u8.gz',river,'gzip-u8')
    river_asset.update(derivedFrom='rivers',downsampling='2x2 maximum pooling before native WTR center mask; 255 modern takes precedence over 128 native')
    return {'physicalBalanced':physical_asset,'riversBalanced':river_asset,
            **river_distance_assets(output,rivers,river)}


def quality_descriptors():
    return dict(default='balanced',
                balanced={'physical':'physicalBalanced','rivers':'riversBalanced'},
                fine={'physical':'physical','rivers':'rivers'},
                projection='Geographic registration and reprojection are baked offline into both quality levels; sampling uses the native HGO plane.',
                textureEdges='Whole-map textures use CLAMP_TO_EDGE; no tiles or stitching gutters/padding are required.',
                coastline='Downsampled cells are masked at their native WTR center. Renderer must additionally clip terrain/river effects per original native WTR fragment to prevent coarse cells extending into adjacent water.',
                categoricalSampling='Terrain requires NEAREST GPU sampling; interpolation of packed high/low class nibbles invents categories.')


def build_balanced_only(root=ROOT,output=None):
    """Derive quality variants without rewriting registration or inverse assets."""
    root=Path(root)
    output=Path(output or root/'apps/hgo/assets/overlays/geography')
    manifest=read_json(output/'manifest.json')
    rasters={}
    for key in ('physical','rivers'):
        asset=manifest['assets'][key]
        data=(output/asset['url']).read_bytes()
        if len(data)!=asset['byteLength'] or digest(data)!=asset['sha256']:
            raise ValueError(f'Fine source identity mismatch: {key}')
        raw=gzip.decompress(data)
        if len(raw)!=asset['decodedByteLength']:
            raise ValueError(f'Fine source decoded size mismatch: {key}')
        rasters[key]=np.frombuffer(raw,dtype=np.uint8).reshape(asset['height'],asset['width'])
    manifest['assets'].update(balanced_assets(output,rasters['physical'],rasters['rivers'],native_water(root/'apps/hgo/assets/default')))
    manifest['qualityLevels']=quality_descriptors()
    (output/'manifest.json').write_bytes(encoded(manifest))
    return manifest


def build(root=ROOT, source_root=None, output=None):
    root = Path(root)
    output = Path(output or root/'apps/hgo/assets/overlays/geography')
    dataset = root/'apps/hgo/assets/default'
    source_root = Path(source_root) if source_root else root/'historic geographic overhaul'
    source_paths = ['apps/hgo/assets/default/places.json', 'apps/hgo/assets/default/manifest.json',
                    'data/world_cities.geojson', 'data/global_physical_semantics.topo.json',
                    'data/global_rivers.geojson', 'data/physical_region_labels.geojson', 'js/core/state_defaults.js']
    model, strict_transform = build_georeference(read_json(dataset/'places.json')['places'],
                                         read_json(root/'data/world_cities.geojson')['features'])
    water = native_water(dataset)
    strict_inverse, strict_confidence = raster_inverse(model)
    inverse,confidence,broad_inverse,broad_confidence = add_smooth_registration(model)
    forward = lambda points:evaluate_rbf(model['smoothRegistration']['forward'],np.asarray(points)/[180,90])
    land = ~sample_native(water, 512, 256)
    model['coverage'] = dict(inverseGridSize=[512, 256], nativeLandSampleCount=int(land.sum()),
                            supportedNativeLandSamples=int(((confidence>0)&land).sum()),
                            supportedNativeLandFraction=round(float(((confidence>0)&land).sum()/land.sum()), 6),
                            supportedMapFraction=round(float((confidence>0).mean()), 6),
                            strictTriangulatedLandFraction=round(float(((strict_confidence>0)&land).sum()/land.sum()),6),
                            broadIlluminationLandFraction=round(float(((broad_confidence>0)&land).sum()/land.sum()),6),
                            broadIlluminationMapFraction=round(float((broad_confidence>0).mean()),6),
                            sampleMethod='native-aligned 10-pixel center grid, WTR excluded for land fraction',
                            unsupported='Reference: farther than 500 native px from city controls or failed inverse. Broad illumination: outside lon +/-180, lat [-60,85], failed inverse or fold. Polar and remote domains remain approximate or unsupported.')
    physical_inverse, physical_confidence = enlarge_geographic_grid(inverse,confidence,2560,1280)
    modern_physical = warp_physical(physical_source_raster(read_json(root/'data/global_physical_semantics.topo.json')),
                             physical_inverse, physical_confidence, sample_native(water, 2560, 1280))
    terrain_path = source_root/'map/terrain.bmp'
    native_terrain = native_rivers = None
    if terrain_path.exists():
        with Image.open(terrain_path) as image:
            native_terrain = np.asarray(image).copy()
        if native_terrain.shape != water.shape:
            raise ValueError('Native terrain dimensions differ from province raster')
    river_path = source_root/'map/rivers.bmp'
    if river_path.exists():
        with Image.open(river_path) as image:
            native_rivers = np.asarray(image).copy()
        if native_rivers.shape != water.shape:
            raise ValueError('Native river dimensions differ from province raster')
    native_class = np.zeros((1280,2560),dtype=np.uint8)
    if native_terrain is not None:
        lookup = np.zeros(256,dtype=np.uint8)
        for index,name in NATIVE_TERRAIN_CLASS.items():
            lookup[index] = NATIVE_CLASS_NAMES.index(name)+1
        native_class = lookup[sample_native(native_terrain,2560,1280)]
        native_class[sample_native(water,2560,1280)] = 0
    physical = (native_class<<4) | modern_physical
    rivers, river_stats = river_raster(read_json(root/'data/global_rivers.geojson')['features'], forward, water,
                                      confidence,native_rivers)
    label_features = read_json(root/'data/physical_region_labels.geojson')['features']
    labels = []
    for feature in label_features:
        if feature['geometry']['type'] != 'Point':
            continue
        point = forward([feature['geometry']['coordinates'][:2]])[0]
        x,y = point
        if (np.isfinite(point).all() and 0<=x<WIDTH and 0<=y<HEIGHT and
                confidence[int(y)//10,int(x)//10] and not water[int(y),int(x)]):
            prop = feature['properties']
            labels.append(dict(id=prop['id'], nameEn=prop['name_en'], nameZh=prop.get('name_zh', ''),
                               x=round(float(point[0]), 3), y=round(float(point[1]), 3),
                               classId=CLASSES.index(prop['atlas_class'])+1,
                               rank=prop.get('rank', 3), minZoom=prop.get('min_zoom', 2)))
    # Coarse independent native class sanity check, not class-by-class equivalence.
    native_crosscheck = {'status':'source-not-provided'}
    if native_terrain is not None:
        terrain = native_terrain[::8, ::8]
        water_samples = water[::8, ::8]
        native_crosscheck = dict(sampleStride=8, sampleCount=terrain.size,
                                 nativeWaterTerrainMismatchCount=int((np.isin(terrain, [14,15]) != water_samples).sum()),
                                 terrainSourceSha256=digest(terrain_path.read_bytes()),
                                 modernClassNativeIndexCounts={name:{str(int(index)):int(count) for index,count in
                                    zip(*np.unique(sample_native(native_terrain,2560,1280)[modern_physical==i+1],return_counts=True))}
                                    for i,name in enumerate(CLASSES)},
                                 interpretation='Native terrain index 14/15 water vs native WTR; this does not validate modern land-cover categories.')
    output.mkdir(parents=True, exist_ok=True)
    assets = {
        'inverseLonLat':put_gzip(output, 'inverse-lonlat.f32.gz', inverse.astype('<f4'), 'gzip-f32le-x2'),
        'inverseConfidence':put_gzip(output, 'inverse-confidence.u8.gz', confidence, 'gzip-u8'),
        'broadInverseLonLat':put_gzip(output, 'broad-inverse-lonlat.f32.gz', broad_inverse.astype('<f4'), 'gzip-f32le-x2'),
        'broadInverseConfidence':put_gzip(output, 'broad-inverse-confidence.u8.gz', broad_confidence, 'gzip-u8'),
        'physical':put_gzip(output, 'physical.u8.gz', physical, 'gzip-u8'),
        'rivers':put_gzip(output, 'rivers.u8.gz', rivers, 'gzip-u8'),
    }
    assets.update(balanced_assets(output,physical,rivers,water))
    model['inverseGrid'] = dict(width=512, height=256, samplePosition='pixel-center',
                                nativePixelStep=[10,10], channels=['longitude','latitude'],
                                model='smoothRegistration; reference 500px nearest-control domain; broad variant only for solar shading',
                                invalid='NaN; inverseConfidence=0; never interpolate across invalid samples')
    model['coverage']['nativeTerrainLandFraction']=round(float(((native_class>0)&~sample_native(water,2560,1280)).sum()/max(1,(~sample_native(water,2560,1280)).sum())),6)
    georef_bytes = encoded(model)
    (output/'georeference.json').write_bytes(georef_bytes)
    labels, label_names = prepare_label_names(root, labels)
    label_bytes = encoded(dict(schemaVersion=1, coordinateSpace='hgo-pixel', labels=labels))
    (output/'labels.json').write_bytes(label_bytes)
    assets['georeference'] = dict(url='georeference.json', encoding='json', byteLength=len(georef_bytes), sha256=digest(georef_bytes))
    assets['labels'] = dict(url='labels.json', encoding='json', byteLength=len(label_bytes), sha256=digest(label_bytes))
    palette_text = (root/'js/core/state_defaults.js').read_text(encoding='utf-8')
    palette_body = re.search(r'const PHYSICAL_ATLAS_PALETTE = \{(.*?)\};', palette_text, re.S).group(1)
    colors = dict(re.findall(r'([a-z_]+):\s*"(#[0-9a-fA-F]{6})"', palette_body))
    colors['urban'] = '#b8a58c'
    palette=[]
    for native in range(len(NATIVE_CLASS_NAMES)+1):
        for modern in range(len(CLASSES)+1):
            if not native and not modern:
                continue
            native_name=NATIVE_CLASS_NAMES[native-1] if native else None
            modern_name=CLASSES[modern-1] if modern else None
            name=modern_name or native_name
            modern_zh=CLASS_LABELS_ZH[modern-1] if modern else None
            native_zh=(CLASS_LABELS_ZH+['城市地表'])[native-1] if native else None
            palette.append(dict(code=native*16+modern,id=name,nativeClassId=native_name,modernClassId=modern_name,
                                nativeCode=native,modernCode=modern,color=colors[name],
                                baseColor=colors[native_name] if native_name else None,
                                modernColor=colors[modern_name] if modern_name else None,
                                label={'zh':modern_zh or native_zh,'en':name.replace('_',' ').title()},
                                nativeLabel={'zh':native_zh,'en':native_name.replace('_',' ').title()} if native_name else None,
                                modernLabel={'zh':modern_zh,'en':modern_name.replace('_',' ').title()} if modern_name else None))
    manifest = dict(format='hgo-geographic-overlays', schemaVersion=1,
                    datasetRevision=read_json(dataset/'manifest.json')['revision'], nativeSize=[WIDTH,HEIGHT],
                    coordinateSpace='hgo-pixel-top-left', assets=assets,
                    qualityLevels=quality_descriptors(), labelNames=label_names,
                    classes=[dict(code=i+1, id=name) for i,name in enumerate(CLASSES)],
                    palette=palette,
                    physicalEncoding={'nativeClass':'high nibble (value >> 4)','modernClass':'low nibble (value & 15)',
                                      'nativeClasses':NATIVE_CLASS_NAMES,'modernClasses':CLASSES},
                    noDataCode=0, physicalInterpretation='Native terrain base plus optional modern physical reference classification in separate nibbles; native WTR mask; classes retain separate sources.',
                    rivers=river_stats, nativeCrosscheck=native_crosscheck, coverage=model['coverage'],
                    temporalPolicy='Modern physical reference, not a measured 1936 surface or a game simulation.',
                    hillshade={'status':'deferred', 'reason':'Native heightmap has only two values; no trustworthy registered DEM in this build.'},
                    sources=[dict(path=path, sha256=digest((root/path).read_bytes())) for path in source_paths])
    for source_path in ('map/terrain.bmp','map/rivers.bmp','common/terrain/00_terrain.txt'):
        source_file=source_root/source_path
        if source_file.exists():
            manifest['sources'].append(dict(path='hgo_mod_2241701657:'+source_path,sha256=digest(source_file.read_bytes())))
    (output/'manifest.json').write_bytes(encoded(manifest))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--balanced-only',action='store_true',help='Only derive balanced textures from locked fine assets; leave registration identities unchanged')
    parser.add_argument('--river-distance-only',action='store_true',help='Only derive signed-distance river textures from locked fine/balanced masks')
    parser.add_argument('--label-names-only',action='store_true',help='Only refresh reviewed/simplified names; preserve registered anchors and rasters')
    args = parser.parse_args()
    if sum([args.balanced_only, args.river_distance_only, args.label_names_only]) > 1:
        parser.error('Choose only one partial build mode')
    result = (build_label_names_only(args.root,args.output) if args.label_names_only else
              build_river_distance_only(args.root,args.output) if args.river_distance_only else
              build_balanced_only(args.root,args.output) if args.balanced_only else build(args.root, args.source_root, args.output))
    print(json.dumps(dict(coverage=result['coverage'], rivers=result['rivers'], assets={k:v['byteLength'] for k,v in result['assets'].items()})))
