from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely import contains_xy, get_parts
from shapely.geometry import Point, shape
from shapely.ops import transform
from shapely.strtree import STRtree
from topojson.utils import serialize_as_geojson

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'apps/hgo/tools'))
from build_geographic_overlays import evaluate_rbf, match_controls
from source_parser import Block, color_hex, history_at, parse
from tools.tno_1962_registration import FROM_AREA, TO_AREA

# The mod is not tracked; worktrees pass the main checkout's copy with --source-root.
SOURCE = ROOT / 'historic geographic overhaul'
ASSETS = ROOT / 'apps/hgo/assets/default'
OUTPUT = ROOT / '.runtime/reports/generated'
REGIONS = {
    '南亚': [(60, 0, 90, 38)],
    '中东': [(25, 12, 60, 43)],
    '东南亚': [(90, -12, 141, 24)],
    '中国西南与川蜀': [(90, 24, 110, 35)],
    '非洲': [(-20, -36, 55, 37)],
    '加勒比/太平洋': [(-90, 5, -58, 28), (130, -60, 180, 30), (-180, -60, -100, 30)],
}
EFFECTS = {'set_autonomy', 'puppet', 'create_dominion', 'create_colony'}
SAMPLE_BATCH_SIZES = (256,) + (1024,) * 24 + (768,)


def read_json(path):
    return json.loads(Path(path).read_bytes())


class Registration:
    def __init__(self, model):
        self.model = model['smoothRegistration']['forward']
        self.controls = cKDTree([[p['x'], p['y']] for p in model['controlPoints']])

    def lookup(self, lonlat):
        points = np.asarray(lonlat)
        pixels = np.full(points.shape, np.nan)
        valid = (np.abs(points[:, 0]) <= 180) & (points[:, 1] >= -60) & (points[:, 1] <= 85)
        if valid.any():
            indices = np.flatnonzero(valid)
            mapped, jacobian = evaluate_rbf(self.model, points[valid] / [180, 90], True)
            supported = (self.controls.query(mapped)[0] <= 500) & (np.linalg.det(jacobian) < 0)
            pixels[indices[supported]] = mapped[supported]
            valid[indices[~supported]] = False
        return pixels, valid


class Raster:
    def __init__(self, ids, province_states, states):
        self.ids = ids
        self.province_states = np.array([s or 0 for s in province_states])
        self.states = states
        self.land = np.zeros(max(states) + 1, dtype=bool)
        for sid, state in states.items():
            self.land[sid] = state['entityTag'] != 'WTR'

    def lookup(self, pixels):
        height, width = self.ids.shape
        valid = np.isfinite(pixels).all(axis=1)
        valid &= (pixels[:, 0] >= 0) & (pixels[:, 0] < width) & (pixels[:, 1] >= 0) & (pixels[:, 1] < height)
        result = np.zeros(len(pixels), dtype=int)
        xy = pixels[valid].astype(int)
        result[valid] = self.province_states[self.ids[xy[:, 1], xy[:, 0]]]
        result[~self.land[result]] = 0
        return result


def summarize_samples(state_ids, states):
    counts = Counter(int(s) for s in state_ids if s)
    owners = Counter()
    controllers = Counter()
    for sid, count in counts.items():
        owners[states[sid]['entityTag']] += count
        controllers[states[sid]['controllerTag']] += count
    total = sum(counts.values())
    ordered = sorted(owners.items(), key=lambda pair: (-pair[1], pair[0]))
    winner = ordered[0][0] if ordered else None
    return dict(hgo_owner=winner, share=ordered[0][1] / total if total else None,
                valid_land_samples=total, tied=len(ordered) > 1 and ordered[0][1] == ordered[1][1],
                mix=[dict(owner=tag, count=n, share=n / total) for tag, n in ordered],
                controllers=[dict(tag=tag, count=n, share=n / total) for tag, n in sorted(controllers.items())],
                states=[dict(id=sid, name=states[sid]['name'], owner=states[sid]['entityTag'],
                             controller=states[sid]['controllerTag'], count=n, share=n / total)
                        for sid, n in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))])


def sample_equal_area(geometry, count, seed=0, max_attempts=32):
    rng = np.random.default_rng(seed)
    parts = get_parts(geometry)
    projected = [transform(TO_AREA.transform, part) for part in parts]
    areas = np.array([part.area for part in projected])
    if not geometry.is_valid or not len(areas) or not np.isfinite(areas).all() or np.any(areas <= 0):
        return np.empty((0, 2))
    strata = (np.arange(count) + rng.random(count)) / count * areas.sum()
    selected = np.searchsorted(np.cumsum(areas), strata)
    samples = []
    for index, needed in zip(*np.unique(selected, return_counts=True)):
        xmin, ymin, xmax, ymax = projected[index].bounds
        fraction = areas[index] / ((xmax - xmin) * (ymax - ymin))
        for _ in range(max_attempts):
            side = int(np.ceil(np.sqrt(min(65536, max(256, needed / fraction)))))
            cells = rng.permutation(side * side)
            x = xmin + (cells % side + rng.random(len(cells))) / side * (xmax - xmin)
            y = ymin + (cells // side + rng.random(len(cells))) / side * (ymax - ymin)
            lon, lat = FROM_AREA.transform(x, y)
            inside = contains_xy(parts[index], lon, lat)
            accepted = np.column_stack([lon[inside], lat[inside]])[:needed]
            samples.extend(accepted)
            needed -= len(accepted)
            if not needed:
                break
        if needed:
            break
    return np.asarray(samples).reshape(-1, 2)


def sample_feature(geometry, registration, raster, seed):
    area = transform(TO_AREA.transform, geometry).area
    if geometry.is_empty or not geometry.is_valid or not np.isfinite(area) or area <= 0:
        return dict(summarize_samples([], raster.states), status='invalid_geometry', total_samples=0,
                    supported_samples=0, supported_fraction=0, land_fraction=0, required_land_samples=200)
    collected = []
    total = supported = land = 0
    exhausted = False
    for batch, size in enumerate(SAMPLE_BATCH_SIZES):
        points = sample_equal_area(geometry, size, seed * len(SAMPLE_BATCH_SIZES) + batch)
        if len(points) != size:
            exhausted = True
            break
        pixels, valid = registration.lookup(points)
        ids = raster.lookup(pixels)
        collected.extend(ids[ids > 0].tolist())
        total += len(points)
        supported += int(valid.sum())
        land += int(np.count_nonzero(ids))
        if land >= 200:
            break
        if batch >= 1 and supported == 0:
            break
    status = ('insufficient_samples' if exhausted else 'sampled' if land >= 200
              else 'unsupported' if supported == 0 else 'insufficient_samples')
    return dict(summarize_samples(collected, raster.states), status=status, total_samples=total,
                supported_samples=supported, supported_fraction=supported / total if total else 0,
                land_fraction=land / total if total else 0, required_land_samples=200)


def block_json(value):
    if isinstance(value, Block):
        return [[k, block_json(v)] for k, v in value.entries]
    return value


def no_dlc_condition(block):
    results = []
    for key, value in block.entries:
        if key == 'has_dlc':
            results.append(False)
        elif key == 'always':
            results.append(value == 'yes')
        elif key in ('NOT', 'AND', 'OR'):
            children = [no_dlc_condition(Block([(k, v)])) for k, v in value.entries]
            results.append(not any(children) if key == 'NOT' else any(children) if key == 'OR' else all(children))
        else:
            raise ValueError(f'Unresolved opening subject condition: {key}')
    return all(results)


def subject_effects(block, scope, source, active=True, conditions=()):
    result = []
    previous = None
    for key, value in history_at(block).entries:
        if key == 'if':
            limit = value.get('limit', Block([]))
            previous = no_dlc_condition(limit)
            body = Block([(k, v) for k, v in value.entries if k != 'else'])
            result.extend(subject_effects(body, scope, source, active and previous,
                                          conditions + (dict(branch='if', limit=block_json(limit)),)))
            for otherwise in value.all('else'):
                result.extend(subject_effects(otherwise, scope, source, active and not previous,
                                              conditions + (dict(branch='else', limit=block_json(limit)),)))
        elif key == 'else':
            result.extend(subject_effects(value, scope, source, active and not previous,
                                          conditions + (dict(branch='else'),)))
        elif key in EFFECTS:
            target = value.get('target') if isinstance(value, Block) else value
            autonomy = value.get('autonomous_state') if key == 'set_autonomy' else {
                'puppet': 'autonomy_puppet', 'create_dominion': 'autonomy_dominion',
                'create_colony': 'autonomy_colony'}[key]
            result.append(dict(subject=target, overlord=scope, autonomy=autonomy, effect=key,
                               active_by_default=active, conditional=bool(conditions),
                               conditions=list(conditions), source=source))
        elif isinstance(key, str) and re.fullmatch(r'[A-Z0-9]{3}', key) and isinstance(value, Block):
            result.extend(subject_effects(value, key, source, active, conditions))
    return result


def localization(language):
    names = {}
    paths = sorted((SOURCE / 'localisation').rglob(f'*_l_{language}.yml'),
                   key=lambda p: ('replace' in p.parts, str(p)))
    for path in paths:
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            match = re.match(r'^\s*([^\s:#]+):\d*\s+"(.*)"\s*(?:#.*)?$', line)
            if match:
                names[match[1]] = re.sub(r'§.', '', match[2]).replace('\\"', '"')
    for _ in range(5):
        names = {key: re.sub(r'\$([^$]+)\$', lambda m: names.get(m[1], m[0]), value)
                 for key, value in names.items()}
    return names


def tag_metadata(core):
    english, chinese = localization('english'), localization('simp_chinese')
    definitions = {}
    for path in sorted((SOURCE / 'common/country_tags').glob('HGO*_countries.txt')):
        definitions.update(parse(path.read_text(encoding='utf-8-sig')).entries)
    entities = {e['tag']: e for e in core['entities']}
    overrides = parse((SOURCE / 'common/countries/colors.txt').read_text(encoding='utf-8-sig'))
    capitals, relations = {}, []
    for path in sorted((SOURCE / 'history/countries').glob('*.txt')):
        text = path.read_text(encoding='utf-8-sig')
        text = '\n'.join(line.split('#')[0] for line in text.splitlines())
        tag = path.name.split(' ', 1)[0]
        capital = re.search(r'(?m)^capital\s*=\s*(\d+)', text)
        if capital:
            capitals[tag] = int(capital[1])
        if re.search(r'\b(set_autonomy|puppet|create_dominion|create_colony)\s*=', text):
            relations.extend(subject_effects(parse(text), tag, path.relative_to(SOURCE).as_posix()))
    autonomy = {}
    for path in sorted((SOURCE / 'common/autonomous_states').glob('*.txt')):
        for block in parse(path.read_text(encoding='utf-8-sig')).all('autonomy_state'):
            autonomy[block.get('id')] = dict(is_puppet=block.get('is_puppet') == 'yes',
                                            source=path.relative_to(SOURCE).as_posix())
    tags = {}
    for tag in sorted(set(definitions) | set(entities)):
        entity = entities.get(tag, {})
        color = entity.get('color')
        if tag in definitions:
            body = parse((SOURCE / 'common' / definitions[tag]).read_text(encoding='utf-8-sig'))
            color = color_hex(overrides.get(tag, Block([])).get('color')) or color_hex(body.get('color'))
        effects = [r for r in relations if r['subject'] == tag]
        active = [r for r in effects if r['active_by_default']]
        relation = active[-1] if active else None
        tags[tag] = dict(name_en=english.get(tag, ''), name_zh=chinese.get(tag, ''), color=color,
                         starting_land=bool(entity and tag != 'WTR' and entity.get('pixelCount', 0)),
                         capital_state_id=capitals.get(tag),
                         overlord=relation['overlord'] if relation else None,
                         autonomy=relation['autonomy'] if relation else None, conditional=effects)
    return tags, autonomy


def region_for(lon, lat):
    for name, windows in REGIONS.items():
        if any(w <= lon <= e and s <= lat <= n for w, s, e, n in windows):
            return name
    return '其他'


def capital_checks(core, places, georef, geometries, rows, raster, registration):
    cities = read_json(ROOT / 'data/world_cities.geojson')['features']
    matches, _ = match_controls(places, cities)
    capitals = {e['tag']: e.get('capitalStateId') for e in core['entities']}
    by_place = {p['id']: p for p in places}
    candidates = [c for c in matches if by_place[c['id']]['stateId'] == capitals.get(c['entityTag'])]
    candidates.sort(key=lambda c: (-by_place[c['id']]['importance'], c['entityTag'], c['id']))
    selected, seen = [], set()
    for c in candidates:
        if c['entityTag'] not in seen:
            selected.append(c)
            seen.add(c['entityTag'])
        if len(selected) == 20:
            break
    assert len(selected) == 20
    tree = STRtree(geometries)
    checks = []
    for city in selected:
        indices = tree.query(Point(city['lon'], city['lat']), predicate='intersects')
        indices = sorted((int(i) for i in indices if rows[int(i)]['status'] != 'invalid_geometry'),
                         key=lambda i: (rows[i]['area_km2'], rows[i]['fid']))
        row = rows[indices[0]] if indices else None
        pixels, supported = registration.lookup(np.array([[city['lon'], city['lat']]]))
        sid = int(raster.lookup(pixels)[0])
        expected = raster.states[capitals[city['entityTag']]]['entityTag']
        checks.append(dict(city=city['name'], tag=city['entityTag'], lon=city['lon'], lat=city['lat'],
                           capital_state_id=capitals[city['entityTag']], expected_owner=expected,
                           fid=row['fid'] if row else None, parcel_owner=row['hgo_owner'] if row else None,
                           parcel_status=row['status'] if row else None,
                           agrees=bool(row and row['status'] == 'sampled' and row['hgo_owner'] == expected),
                           point_owner=raster.states[sid]['entityTag'] if sid else None,
                           error_px=float(np.linalg.norm(pixels[0] - [city['x'], city['y']])) if supported[0] else None,
                           used_as_control=city['id'] in {c['id'] for c in georef['controlPoints']}))
    return dict(count=20, matches=sum(c['agrees'] for c in checks),
                agreement=sum(c['agrees'] for c in checks) / 20, checks=checks)


def write_summary(report):
    rows, tags = report['features'], report['tags']
    counts = dict(Counter(r['status'] for r in rows))
    lines = ['# HGO 1936 参考归属', '', f'地块状态：{counts}。',
             '采用 HGO 现有 TPS；纬度 [-60,85]、距控制点 ≤500 像素且局部无折叠。',
             'EPSG:6933 等面积采样；每块至少 200 个有效 HGO 陆地样本，最多 25600 个候选点。',
             '每个子多边形的等面积拒绝采样最多尝试 32 轮，HGO 陆地采样最多 26 批。',
             'unsupported 表示探测点无配准覆盖；insufficient_samples 表示达到尝试上限但有效样本不足，不能作为确定归属。',
             'invalid_geometry 表示空、零面积、非有限面积或无效多边形；不采样，归属为空，不参与归属统计。',
             '占比分母为有效 HGO 陆地样本数；差异面积是整块地块面积，不是精确边界转移面积。',
             '区域按地块内部代表点与下列经纬度窗口匹配，重叠按列出顺序归类。',
             '开局持地名单来自原生州的像素锚点经 TPS 逆解定位，不以目标地块众数是否保留小国为条件。',
             '宗主关系按不启用 DLC 解析；conditional 保留所有有效条件分支及默认生效标记，注释不计入。', '',
             f"配准留出城市误差：{report['registration']['holdout_metrics']}。",
             f"20 个首都所在地块归属一致：{report['capital_validation']['matches']}/20。", '']
    for region, windows in REGIONS.items():
        subset = [r for r in rows if r['region'] == region]
        held = report['regional_starting_tags'][region]
        lines += [f'## {region}', '', f'经纬度窗口：{windows}；地块状态：{dict(Counter(r["status"] for r in subset))}。', '',
                  '开局持地政权：' + '、'.join(f'{tag} ({tags[tag]["name_en"]})' for tag in held) + '。', '',
                  '| 当前 owner → HGO owner | 块数 | 整块面积 km² |', '|---|---:|---:|']
        matrix = defaultdict(lambda: [0, 0.0])
        direct, subjects = defaultdict(list), defaultdict(list)
        for row in subset:
            if row['status'] != 'sampled':
                continue
            tag = row['hgo_owner']
            if row['current_owner'] != tag:
                item = matrix[row['current_owner'], tag]
                item[0] += 1
                item[1] += row['area_km2']
            if tag in ('ENG', 'FRA', 'POR', 'HOL', 'BEL', 'ITA', 'SPR', 'USA', 'JAP', 'AST', 'NZL'):
                direct[tag].append(row['fid'])
            if tags[tag]['overlord']:
                subjects[tag].append(row['fid'])
        for (before, after), (count, area) in sorted(matrix.items(), key=lambda item: -item[1][1]):
            lines.append(f'| {before} → {after} | {count} | {area:.2f} |')
        lines += ['', '宗主国/海外殖民国家直接持有的地块（按 owner 字面值筛选，不推断法律地位；太平洋窗口含澳新本土）：', '']
        lines += [f'- {tag}：{len(fids)} 块；' + '、'.join(fids) for tag, fids in sorted(direct.items())]
        lines += ['', '默认规则下实际附庸 tag：', '']
        lines += [f'- {tag} → {tags[tag]["overlord"]} / {tags[tag]["autonomy"]}：{len(fids)} 块。' for tag, fids in sorted(subjects.items())] or ['- 无。']
        lines += ['']
    lines += ['## 不可采样地块', '']
    for status in ('invalid_geometry', 'unsupported', 'insufficient_samples'):
        fids = [r['fid'] for r in rows if r['status'] == status]
        lines += [f'### {status}（{len(fids)} 块）', '', '、'.join(fids) or '无', '']
    lines += ['## 首都抽查', '', '| 城市 | 首都州 owner | 地块 | 投影 owner | 一致 | 点误差 px |', '|---|---|---|---|---|---:|']
    for c in report['capital_validation']['checks']:
        lines.append(f'| {c["city"]} | {c["expected_owner"]} | {c["fid"]} | {c["parcel_owner"]} | {c["agrees"]} | {c["error_px"]} |')
    lines += ['', '首都抽查可能包含拟合控制点，不能替代独立留出误差；城市点 owner 与地块众数分别保存在 JSON 中。']
    (OUTPUT / 'hgo_1936_reference_summary.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    core = read_json(ASSETS / 'core.json')
    georef = read_json(ROOT / 'apps/hgo/assets/overlays/geography/georeference.json')
    manifest = read_json(ASSETS / 'manifest.json')
    ids = np.frombuffer(gzip.decompress((ASSETS / 'ids.u16.gz').read_bytes()), dtype='<u2').reshape(2560, 5120)
    states = {s['id']: s for s in core['states']}
    raster = Raster(ids, core['provinceStateIds'], states)
    registration = Registration(georef)
    tags, autonomy = tag_metadata(core)
    scenario = ROOT / 'data/scenarios/hoi4_1936'
    topology = read_json(scenario / 'runtime_topology.topo.json')
    features = serialize_as_geojson(topology, objectname='political')['features']
    owners = read_json(scenario / 'owners.by_feature.json')['owners']
    geometries = [shape(f['geometry']) for f in features]
    rows = []
    for index, (feature, geometry) in enumerate(zip(features, geometries)):
        fid = str(feature['properties']['id'])
        point = geometry.representative_point()
        row = sample_feature(geometry, registration, raster, index)
        rows.append(dict(row, fid=fid, current_owner=owners[fid], region=region_for(point.x, point.y) if not point.is_empty else '其他',
                         area_km2=transform(TO_AREA.transform, geometry).area / 1e6))
    regional_tags = {region: set() for region in REGIONS}
    native = np.array([s['anchor'] for s in core['states']])
    geographic = evaluate_rbf(georef['smoothRegistration']['inverseSeed'], native / [5120, 2560])
    for _ in range(4):
        predicted, jacobian = evaluate_rbf(registration.model, geographic / [180, 90], True)
        jacobian /= np.array([180, 90])
        geographic -= np.clip(np.linalg.solve(jacobian, (predicted - native)[..., None])[..., 0], -10, 10)
    for state, point in zip(core['states'], geographic):
        region = region_for(*point)
        if state['entityTag'] != 'WTR' and region in regional_tags:
            regional_tags[region].add(state['entityTag'])
    capital_validation = capital_checks(core, read_json(ASSETS / 'places.json')['places'], georef,
                                        geometries, rows, raster, registration)
    report = dict(as_of='1936.1.1', source_root=str(SOURCE), dataset_source=manifest['source'],
                  registration=dict(method=georef['method'], source='apps/hgo/assets/overlays/geography/georeference.json',
                                    holdout_metrics=georef['smoothRegistration']['confirmation']['metrics']),
                  tags=tags, autonomy_types=autonomy, features=rows,
                  status_counts=dict(Counter(r['status'] for r in rows)),
                  invalid_geometry_ids=[r['fid'] for r in rows if r['status'] == 'invalid_geometry'],
                  regional_starting_tags={r: sorted(v) for r, v in regional_tags.items()},
                  capital_validation=capital_validation)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'hgo_1936_reference_owners.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    write_summary(report)
    print(json.dumps(dict(status_counts=dict(Counter(r['status'] for r in rows)), capital_validation=capital_validation), ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, default=SOURCE)
    SOURCE = parser.parse_args().source_root
    main()
