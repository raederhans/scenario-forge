#!/usr/bin/env python3
"""Build a native HGO resource and building sidecar for the 1936 start."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re

from build_dataset import MISSING_FINAL_BRACE, Source
from source_parser import Block, history_at, parse

SCHEMA = 1
FORMAT = 'hgo-native-metrics'
AS_OF = (1936, 1, 1)
AS_OF_TEXT = '1936.1.1'
RESOURCE_TYPES = ('steel', 'oil', 'aluminium', 'tungsten', 'chromium', 'rubber')
BUILDING_TYPES = (
    'infrastructure', 'industrial_complex', 'arms_factory', 'dockyard', 'air_base',
    'naval_base', 'coastal_bunker', 'bunker', 'anti_air_building', 'radar_station',
    'synthetic_refinery',
)
INTEGER = re.compile(r'^\d+$')
NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def number(value, context):
    if not isinstance(value, str) or not NUMBER.fullmatch(value):
        raise ValueError(f'{context}: expected a numeric native value')
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError(f'{context}: value must be finite and non-negative')
    return int(result) if result.is_integer() else result


def read_base_dataset(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if (manifest.get('format') != 'hgo-native-dataset' or manifest.get('schemaVersion') != 1
            or not isinstance(manifest.get('id'), str)
            or not re.fullmatch(r'[a-f0-9]{64}', str(manifest.get('revision', '')))):
        raise ValueError('Invalid native base dataset manifest')
    if manifest.get('source', {}).get('asOf') != AS_OF_TEXT:
        raise ValueError(f'Base dataset is not aligned to {AS_OF_TEXT}')
    asset = manifest.get('assets', {}).get('core')
    if not isinstance(asset, dict) or not isinstance(asset.get('url'), str):
        raise ValueError('Base dataset has no core metadata asset')
    core_path = (manifest_path.parent / asset['url']).resolve()
    if not core_path.is_relative_to(manifest_path.parent):
        raise ValueError('Base core asset escapes dataset directory')
    core_bytes = core_path.read_bytes()
    if (len(core_bytes) != asset.get('byteLength') or sha(core_bytes) != asset.get('sha256')):
        raise ValueError('Base core asset integrity mismatch')
    core = json.loads(core_bytes)
    if core.get('schemaVersion') != 1 or not isinstance(core.get('states'), list):
        raise ValueError('Invalid base core metadata')
    state_by_id = {}
    for state in core['states']:
        sid = state.get('id')
        if not isinstance(sid, int) or isinstance(sid, bool) or sid in state_by_id:
            raise ValueError('Base core contains duplicate or invalid state IDs')
        province_ids = state.get('provinceIds')
        if not isinstance(province_ids, list) or any(not isinstance(pid, int) or isinstance(pid, bool) for pid in province_ids):
            raise ValueError(f'Base core has invalid province membership for state {sid}')
        state_by_id[sid] = set(province_ids)
    province_state_by_id = {}
    ids, state_ids = core.get('provinceIds'), core.get('provinceStateIds')
    if not isinstance(ids, list) or not isinstance(state_ids, list) or len(ids) != len(state_ids):
        raise ValueError('Base core has invalid province index')
    for pid, sid in zip(ids[1:], state_ids[1:]):
        if isinstance(pid, int) and not isinstance(pid, bool):
            province_state_by_id[pid] = sid
    return manifest, state_by_id, province_state_by_id


def _entries(block, context):
    if block is None:
        return []
    if not isinstance(block, Block):
        raise ValueError(f'{context}: expected a block')
    return block.entries


def _collect_resources(state, effective_history, path):
    values = {}
    blocks = [state.get('resources'), *effective_history.all('resources')]
    for block in blocks:
        for key, value in _entries(block, f'{path.name}: resources'):
            if key is None or isinstance(value, Block):
                raise ValueError(f'{path.name}: invalid resource entry')
            values[key] = number(value, f'{path.name}: resources.{key}')
    unknown = sorted(set(values) - set(RESOURCE_TYPES))
    if unknown:
        raise ValueError(f'{path.name}: unsupported native resources: {unknown}')
    return {kind: values.get(kind) for kind in RESOURCE_TYPES}


def _collect_buildings(state, effective_history, path):
    state_buildings = {}
    province_buildings = {}
    # A state-level block, if present, is the initial value. The selected
    # history blocks then apply in source order, with later assignments winning.
    blocks = [state.get('buildings'), *effective_history.all('buildings')]
    for block in blocks:
        for key, value in _entries(block, f'{path.name}: buildings'):
            if key is None:
                raise ValueError(f'{path.name}: unkeyed building entry')
            if isinstance(value, Block):
                if not INTEGER.fullmatch(key):
                    raise ValueError(f'{path.name}: province building key is not an integer: {key}')
                province_id = int(key)
                target = province_buildings.setdefault(province_id, {})
                for building, level in value.entries:
                    if building is None or isinstance(level, Block):
                        raise ValueError(f'{path.name}: invalid province building entry')
                    target[building] = number(level, f'{path.name}: province {province_id} {building}')
            else:
                state_buildings[key] = number(value, f'{path.name}: buildings.{key}')
    return state_buildings, province_buildings


def _read_source_states(source):
    states = {}
    diagnostics = []
    for path in sorted((source.root / 'history/states').glob('*.txt'), key=lambda p: p.name):
        relative = path.relative_to(source.root).as_posix()
        text = source.text(path)
        if source.files[relative] == MISSING_FINAL_BRACE.get(relative):
            text += '\n}'
            diagnostics.append(dict(kind='source-syntax-correction', file=relative,
                                    correction='append final state closing brace'))
        try:
            state = parse(text).get('state')
            if not isinstance(state, Block):
                raise ValueError('Missing state block')
            sid_value = state.get('id')
            if not isinstance(sid_value, str) or not INTEGER.fullmatch(sid_value):
                raise ValueError('Missing or invalid state ID')
            sid = int(sid_value)
            if sid in states:
                raise ValueError(f'Duplicate state ID {sid}')
            province_block = state.get('provinces', Block([]))
            province_ids = []
            for value in province_block.values() if isinstance(province_block, Block) else []:
                if not isinstance(value, str) or not INTEGER.fullmatch(value):
                    raise ValueError('Invalid state province ID')
                province_ids.append(int(value))
            if not province_ids:
                raise ValueError('State has no provinces')
            if len(set(province_ids)) != len(province_ids):
                raise ValueError('Duplicate state province ID')
            effective_history = history_at(state.get('history', Block([])), AS_OF)
            resources = _collect_resources(state, effective_history, path)
            state_buildings, province_buildings = _collect_buildings(state, effective_history, path)
            states[sid] = dict(sourceFile=relative, provinceIds=sorted(province_ids),
                               resources=resources, stateBuildings=state_buildings,
                               provinceBuildings=province_buildings)
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError(f'{path.name}: {error}') from error
    if not states:
        raise ValueError('No native states found')
    return dict(sorted(states.items())), diagnostics


def _metric_values(raw, building_types, diagnostics):
    values = {f'resource_{kind}': raw['resources'][kind] for kind in RESOURCE_TYPES}
    direct = raw['stateBuildings']
    province_records = raw['provinceBuildings']
    for kind in building_types:
        if kind == 'infrastructure':
            # A state-level infrastructure level is a distinct native field.
            # Province infrastructure remains in provinceBuildings.
            values[kind] = direct.get(kind)
            continue
        if kind in direct:
            values[kind] = direct[kind]
            if any(kind in buildings for buildings in province_records.values()):
                diagnostics.append(dict(kind='state-province-building-overlap', stateId=raw['stateId'],
                                        building=kind, chosenScope='state',
                                        provinceValueSum=sum(buildings[kind] for buildings in province_records.values()
                                                             if kind in buildings)))
        else:
            recorded = [buildings[kind] for buildings in province_records.values() if kind in buildings]
            values[kind] = sum(recorded) if recorded else None
    return values


def build(source_root, base_manifest_path, output):
    manifest, base_states, base_province_state = read_base_dataset(base_manifest_path)
    source = Source(source_root)
    source_states, diagnostics = _read_source_states(source)
    source_ids, base_ids = set(source_states), set(base_states)
    if source_ids != base_ids:
        raise ValueError(f'Source/base state mismatch: missing={sorted(base_ids - source_ids)[:8]}, '
                         f'extra={sorted(source_ids - base_ids)[:8]}')

    # Verify state membership before resolving any province-level data. This
    # keeps source IDs attached to the exact native base revision.
    for sid, raw in source_states.items():
        if set(raw['provinceIds']) != base_states[sid]:
            raise ValueError(f'Source/base province membership mismatch for state {sid}')

    for sid, raw in source_states.items():
        valid_provinces = {}
        for pid, buildings in sorted(raw['provinceBuildings'].items()):
            base_owner = base_province_state.get(pid)
            if pid not in base_states[sid] or base_owner != sid:
                reason = 'unknown-to-base-dataset' if pid not in base_province_state else 'outside-source-state'
                diagnostics.append(dict(kind='stale-province-building-reference', file=raw['sourceFile'],
                                        stateId=sid, provinceId=pid, reason=reason,
                                        buildings=buildings))
                continue
            valid_provinces[str(pid)] = dict(sorted(buildings.items()))
        raw['provinceBuildings'] = valid_provinces
        raw['stateId'] = sid
        raw.pop('sourceFile')

    building_types = sorted(set(BUILDING_TYPES) | {
        kind for raw in source_states.values()
        for kind in (set(raw['stateBuildings']) |
                     {building for record in raw['provinceBuildings'].values()
                      for building in record})
    })
    metrics_states = {}
    aggregate_diagnostics = []
    for sid, raw in source_states.items():
        values = _metric_values(raw, building_types, aggregate_diagnostics)
        metrics_states[str(sid)] = dict(resources=raw['resources'],
                                        stateBuildings=dict(sorted(raw['stateBuildings'].items())),
                                        provinceBuildings=raw['provinceBuildings'],
                                        values=values)

    diagnostics.extend(aggregate_diagnostics)
    input_provenance = dict(id=manifest.get('source', {}).get('id', 'hgo_mod_2241701657'),
                            asOf=AS_OF_TEXT, files=dict(sorted(source.files.items())))
    fingerprint = sha(encoded(input_provenance))
    metrics = dict(format=FORMAT, schemaVersion=SCHEMA,
                   baseDataset=dict(id=manifest['id'], revision=manifest['revision']),
                   asOf=AS_OF_TEXT, valueBasis='native-game-configuration',
                   resourceTypes=list(RESOURCE_TYPES), buildingTypes=building_types,
                   aggregationPolicy=dict(
                       infrastructure='state value only; province values remain separately recorded',
                       otherBuildings='explicit state value wins; otherwise sum valid recorded province values',
                       owner='current owner aggregation is computed by the consumer'),
                   source=dict(id=input_provenance['id'], fingerprint=fingerprint,
                               provenanceUrl='provenance.json'),
                   states=metrics_states)
    provenance = dict(id=input_provenance['id'], asOf=AS_OF_TEXT,
                      baseDataset=metrics['baseDataset'],
                      interpretation=dict(
                          resources='Only explicitly recorded values are numeric; absent values are null, not zero.',
                          manpower='Not included; source manpower is not treated as measured population.',
                          infrastructure='State and province scopes are kept separate; state metric uses state scope only.',
                          buildings='State and province scopes are retained. For non-infrastructure state values, an explicit state value takes precedence; otherwise valid province values are summed.',
                          staleProvinceReferences='Reported with source IDs and values, omitted from usable province records, and assigned no coordinates.'),
                      fingerprint=fingerprint, files=dict(sorted(source.files.items())),
                      diagnostics=sorted(diagnostics, key=lambda d: (d.get('kind', ''), d.get('stateId', -1),
                                                                      d.get('provinceId', -1), d.get('file', ''))))
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'metrics.json').write_bytes(encoded(metrics))
    (output / 'provenance.json').write_bytes(encoded(provenance))
    return dict(baseDataset=metrics['baseDataset'], stateCount=len(metrics_states),
                sourceFileCount=len(source.files), diagnosticCount=len(diagnostics),
                metricsBytes=(output / 'metrics.json').stat().st_size,
                provenanceBytes=(output / 'provenance.json').stat().st_size)


def main():
    here = Path(__file__).resolve()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True, type=Path)
    parser.add_argument('--base-manifest', type=Path,
                        default=here.parents[1] / 'assets/default/manifest.json')
    parser.add_argument('--output', type=Path,
                        default=here.parents[1] / 'assets/overlays/metrics')
    args = parser.parse_args()
    print(json.dumps(build(args.source_root, args.base_manifest, args.output), sort_keys=True))


if __name__ == '__main__':
    main()
