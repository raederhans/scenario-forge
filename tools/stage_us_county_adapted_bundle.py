"""Assemble bound historical county patches into an atomic, runtime-only candidate."""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import json
import re
from pathlib import Path
import shutil
import sys
import time
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import geopandas as gpd
import shapely
from map_builder.geo.topology import compute_neighbor_graph
from map_builder.io.writers import write_json_atomic
from map_builder.regional_geometry import (
    _absolute_topology, _encode_exact_coverage, _offset_arcs, _update_bbox,
)
from tools.adapt_us_county_scenarios import check_domain_preservation, source_counties, AREA_ROUNDOFF_LIMIT
from tools.prepare_us_county_adaptation_sidecars import (
    read, digest, build_crosswalk, expand_assignments, adapt_asset, remaining_references,
)
from tools.stage_us_county_scenario import baseline_surface, validate_source_report
from tools.patch_tno_1962_bundle import stable_json_hash
from tools.build_startup_bootstrap_assets import (
    build_bootstrap_runtime_topology, build_startup_locales_payload, build_startup_geo_aliases_payload,
)
from tools.scenario_chunk_assets import build_and_write_scenario_chunk_assets
from tools.scenario_topology_decode import topology_object_to_geojson
from tools.build_tno_russia_precision_assets import finalize_stage, peak_memory
from tools.regional_scenario_assets import _copy_gzip
from tools.precision_build_support import assert_gzip_matches, PhaseRecorder, cached_json_result, hash_json, sha256_file
from tools.pages_artifact_root import resolve_runtime_path

SCENARIOS = {'blank_base', 'hgo_1936', 'hoi4_1936', 'hoi4_1939', 'tno_1962'}
SIDECARS = {'strategic_values.by_feature.json', 'victory_points.json', 'city_overrides.json',
            'capital_hints.json', 'scenario_mutations.json'}
DERIVED = {'audit.json', 'build_snapshot.json', 'runtime_meta.json', 'detail_chunks.manifest.json',
           'context_lod.manifest.json', 'locales.startup.json', 'geo_aliases.startup.json',
           'startup.bundle.en.json', 'startup.bundle.zh.json', 'runtime_topology.bootstrap.topo.json'}


def write(path, payload):
    write_json_atomic(path, payload, indent=None, separators=(',', ':'), allow_nan=False)


def hierarchy_override(value, crosswalk, global_hierarchy=None):
    result = deepcopy(value)
    if result:
        groups = result.get('groups')
        if not isinstance(groups, dict):
            raise ValueError('Unsupported hierarchy override schema')
        for key, members in groups.items():
            if not isinstance(members, list) or any(fid not in crosswalk for fid in members):
                raise ValueError(f'Unsupported hierarchy members: {key}')
            groups[key] = [child for fid in members for child in crosswalk[fid]]
    base_groups = (global_hierarchy or {}).get('groups', {})
    # The runtime merges overrides by entire ISO2 country. Project every existing
    # US group member present in this baseline, not only the replaced subset.
    if 'US' not in result.get('country_codes', []) and any(
        key.startswith('US_') and any(fid in crosswalk and crosswalk[fid] != [fid] for fid in members)
        for key, members in base_groups.items()
    ):
        projected = {key: [child for fid in members if fid in crosswalk for child in crosswalk[fid]]
                     for key, members in base_groups.items() if key.startswith('US_')}
        projected = {key: children for key, children in projected.items() if children}
        flat = [child for children in projected.values() for child in children]
        if len(flat) != len(set(flat)):
            raise ValueError('Ambiguous global US hierarchy membership')
        result.setdefault('country_codes', []).append('US')
        result.setdefault('groups', {}).update(projected)
        labels = (global_hierarchy or {}).get('labels', {})
        result.setdefault('labels', {}).update({key: labels[key] for key in projected if key in labels})
    return result


def project_migration_contract(sid, crosswalk, source_hash, target_hash):
    """Scope importer lookup to reviewed namespaces, including retained identities."""
    if sid not in SCENARIOS or not source_hash or not target_hash or source_hash == target_hash:
        raise ValueError('Migration requires supported scenario and distinct baseline hashes')
    prefixes = ('HGO-',) if sid == 'hgo_1936' else ('US_CNTY_', 'US_ZN_')
    scoped = {}
    for old, children in crosswalk.items():
        if old.startswith(prefixes):
            if not children or any(not child.startswith(prefixes) for child in children):
                raise ValueError(f'Migration child outside reviewed namespace: {old}')
            scoped[old] = children
        elif children != [old]:
            raise ValueError(f'Migration replacement outside reviewed namespace: {old}')
    return {'version': 1, 'scenario_id': sid, 'source_baseline_hash': source_hash,
            'target_baseline_hash': target_hash, 'feature_id_prefixes': list(prefixes),
            'crosswalk': scoped, 'unresolved_ids': []}


def validate_political_ownership(sid, baseline, candidate, original_owners, owners, crosswalk):
    """Allow only unchanged inherited TNO Arctic shells to remain ownerless."""
    missing = [row for row in candidate['objects']['political']['geometries'] if row['properties']['id'] not in owners]
    if not missing:
        return
    old = _absolute_topology(baseline) if baseline.get('transform') else baseline
    old_rows = {row['properties']['id']: row for row in old['objects']['political']['geometries']}

    def arc_ids(value):
        if isinstance(value, list):
            for item in value:
                yield from arc_ids(item)
        else:
            yield value if value >= 0 else ~value

    for row in missing:
        props = row['properties']
        fid = props['id']
        inherited_shell = (
            sid == 'tno_1962' and re.fullmatch(r'RU_ARCTIC_FB_[A-Z0-9]+_[0-9]+', fid)
            and props.get('scenario_helper_kind') == 'shell_fallback'
            and all(isinstance(props.get(key), str) and props[key].strip()
                    for key in ('scenario_shell_owner_hint', 'scenario_shell_controller_hint'))
            and fid not in original_owners and crosswalk.get(fid) == [fid]
            and row == old_rows.get(fid)
        )
        if not inherited_shell or any(candidate['arcs'][index] != old['arcs'][index]
                                      for index in arc_ids(row.get('arcs', []))):
            raise ValueError(f'Missing political ownership outside unchanged inherited Arctic shell: {fid}')


def adapt_authoring_asset(name, payload, crosswalk, geometries):
    """Migrate only known authoring references after inherited labels are verified."""
    value = deepcopy(payload)
    removed = {old for old, children in crosswalk.items() if children != [old]}
    if name == 'capital_defaults.partial.json':
        if not isinstance(value.get('capitals_by_tag'), dict) or not isinstance(value.get('capital_city_hints'), dict):
            raise ValueError('Unsupported capital defaults schema')
        value, unresolved = adapt_asset('capital_hints.json', value, crosswalk, geometries)
        if unresolved:
            raise ValueError(f'Unresolved capital defaults: {unresolved}')
    elif name == 'geo_locale_reviewed_exceptions.json':
        reviewed = value.get('reviewed_collision_feature_ids')
        if (not isinstance(reviewed, list) or any(not isinstance(fid, str) or not fid for fid in reviewed)
                or len(set(reviewed)) != len(reviewed)):
            raise ValueError('Unsupported reviewed locale collision schema')
        # These are existing historical-label reviews, not geometry exceptions.
        # assemble() already requires identical parent/child names and properties.
        value['reviewed_collision_feature_ids'] = [child for fid in reviewed for child in crosswalk.get(fid, [fid])]
    elif name.startswith('geo_locale_patch') or name == 'geo_name_overrides.manual.json':
        if isinstance(value.get('geo'), dict):
            value['geo'] = expand_assignments(value['geo'], crosswalk)
    # Locale audit describes the source checkpoint, not active lookup membership.
    refs = {k: v for k, v in value.items() if k != 'audit'} if name.startswith('geo_locale_patch') else value
    if remaining_references(refs, removed):
        raise ValueError(f'Unsupported replaced-feature references: {name}')
    return value


def neighbor_frame(topology, retained_ids):
    """Use the runtime/chunk decoder's short-ring semantics only for adjacency.

    It closes degenerate rings without repairing or discarding polygon surfaces.
    The original topology is never modified. Existing invalid surfaces remain in
    the graph input and are explicitly reported rather than silently repaired.
    """
    collection = topology_object_to_geojson(topology, 'political')
    frame = gpd.GeoDataFrame.from_features(collection['features'], crs='EPSG:4326')
    invalid, zero_area, empty = [], [], []
    for fid, geometry in zip(frame['id'], frame.geometry):
        if geometry is None or geometry.is_empty:
            empty.append(fid)
        elif geometry.area == 0:
            zero_area.append(fid)
        if geometry is None or geometry.is_empty or not geometry.is_valid:
            if fid not in retained_ids:
                raise ValueError(f'Invalid new neighbor geometry: {fid}')
            if geometry is not None and not geometry.is_empty and geometry.area != 0:
                invalid.append(fid)
    return frame, {'decoder': 'scenario_topology_decode.topology_object_to_geojson',
                   'retained_invalid_nonzero_area_ids': invalid, 'retained_zero_area_ids': zero_area,
                   'retained_empty_ids': empty, 'feature_count': len(frame)}



def cached_neighbor_graph(topology, retained_ids, cache_root):
    """Reuse only an input/toolchain-bound derived graph; never geometry or acceptance."""
    cache_root = resolve_runtime_path(cache_root, label='Adjacency cache', require_directory=True)
    rows = topology['objects']['political']['geometries']
    ids = {row['properties']['id'] for row in rows}
    inputs = {
        'topology_sha256': hash_json(topology), 'retained_ids': sorted(retained_ids),
        'python': list(sys.version_info[:3]), 'shapely': shapely.__version__,
        'geos': shapely.geos_version_string, 'geopandas': gpd.__version__,
        'sources': {name: sha256_file(ROOT / name) for name in (
            'tools/stage_us_county_adapted_bundle.py', 'tools/scenario_topology_decode.py',
            'map_builder/geo/topology.py', 'tools/precision_build_support.py')},
    }

    def validate(value):
        graph, diagnostics = value['graph'], value['diagnostics']
        if not isinstance(graph, list) or len(graph) != len(rows) or diagnostics['feature_count'] != len(rows):
            raise ValueError('Invalid cached graph size')
        if diagnostics['decoder'] != 'scenario_topology_decode.topology_object_to_geojson':
            raise ValueError('Unknown cached adjacency decoder')
        for index, neighbors in enumerate(graph):
            if (not isinstance(neighbors, list) or any(type(n) is not int or n < 0 or n >= len(rows) or n == index for n in neighbors)
                    or neighbors != sorted(set(neighbors))):
                raise ValueError('Invalid cached graph membership')
        sets = [set(neighbors) for neighbors in graph]
        if any(index not in sets[n] for index, neighbors in enumerate(graph) for n in neighbors):
            raise ValueError('Asymmetric cached adjacency graph')
        for field in ('retained_invalid_nonzero_area_ids', 'retained_zero_area_ids', 'retained_empty_ids'):
            values = diagnostics[field]
            if not isinstance(values, list) or len(values) != len(set(values)) or not set(values) <= (ids & set(retained_ids)):
                raise ValueError('Invalid retained geometry diagnostics')

    def build():
        frame, diagnostics = neighbor_frame(topology, retained_ids)
        graph = compute_neighbor_graph(frame)
        return {'graph': graph, 'diagnostics': diagnostics}

    value, receipt = cached_json_result(cache_root, inputs, build, validate)
    return value['graph'], value['diagnostics'], receipt

def assemble(topology, overlay, report, assignments):
    """Validate lineage and preserve untouched topology arcs, properties and object data."""
    result = _absolute_topology(topology)
    rows = result['objects']['political']['geometries']
    old = {row['properties']['id']: row for row in rows}
    if len(old) != len(rows):
        raise ValueError('Duplicate baseline IDs')
    replaced = report['replaced_old_ids']
    if not isinstance(replaced, list) or len(set(replaced)) != len(replaced):
        raise ValueError('Malformed replacement IDs')
    unresolved = report['unresolved_ids_retained_in_baseline']
    if not set(unresolved) <= set(old) or set(unresolved) & set(replaced):
        raise ValueError('Unresolved IDs must remain untouched')
    if report.get('mode') != 'unique_id_all_us_patch':
        raise ValueError('Only unique-ID historical patches are supported')
    crosswalk, geometries = build_crosswalk(old, replaced, overlay['features'])
    for parent in replaced:
        props = old[parent]['properties']
        if props.get('cntr_code') not in {'US', 'USA'} and not parent.startswith(('US_CNTY_', 'US_ZN_')):
            raise ValueError(f'Non-US replacement is forbidden: {parent}')
    groups = {}
    for feature in overlay['features']:
        parent = feature['lineage']['old_feature_id']
        props = deepcopy(old[parent]['properties'])
        props['id'] = feature['properties']['id']
        expected = {key: values[parent] for key, values in assignments.items() if parent in values}
        if feature['properties'] != props or feature['lineage']['assignments'] != expected:
            raise ValueError(f'Changed inherited properties or assignments: {parent}')
        groups.setdefault(parent, []).append(geometries[props['id']])
    checks = report.get('partition_checks', [])
    if len(checks) != len(replaced) or {c['id'] for c in checks} != set(replaced):
        raise ValueError('Partition check coverage differs from replacement IDs')
    if any(c.get('domain_preserved') is not True or c.get('all_pieces_valid') is not True
           or c.get('pieces') != len(crosswalk[c['id']]) for c in checks):
        raise ValueError('Malformed partition checks')
    for parent, pieces in groups.items():
        original, _ = baseline_surface(result, old[parent])
        if original is None or not original.is_valid:
            raise ValueError(f'Invalid replaced baseline: {parent}')
        check_domain_preservation(original, shapely.union_all(pieces))
        overlap = sum(a.intersection(b).area for i, a in enumerate(pieces) for b in pieces[i + 1:])
        if overlap > AREA_ROUNDOFF_LIMIT:
            raise ValueError(f'Overlapping children: {parent}')
    features = overlay['features']
    encoded = _encode_exact_coverage([f['properties']['id'] for f in features], list(geometries.values()))
    offset = len(result['arcs'])
    result['arcs'].extend(encoded['arcs'])
    children = encoded['objects']['political']['geometries']
    for row, feature in zip(children, features):
        row['arcs'] = _offset_arcs(row['arcs'], offset)
        row['properties'] = deepcopy(feature['properties'])
    result['objects']['political']['geometries'] = [r for fid, r in old.items() if fid not in groups] + children
    result['political_precision_feature_ids'] = sorted(set(geometries) | {
        child for fid in result.get('political_precision_feature_ids', []) for child in crosswalk[fid]})
    _update_bbox(result)
    if remaining_references({key: value for key, value in result['objects'].items() if key != 'political'}, set(replaced)):
        raise ValueError('Unsupported topology object references')
    return result, {key: expand_assignments(values, crosswalk) for key, values in assignments.items()}, crosswalk, geometries


def _local(directory, url, sid):
    prefix = f'data/scenarios/{sid}/'
    if not isinstance(url, str) or not url.startswith(prefix):
        raise ValueError(f'Unsupported external scenario asset: {url}')
    path = (directory / url[len(prefix):]).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise ValueError(f'Unsafe scenario asset: {url}')
    return path


def stage(baseline_dir, adaptation_dir, sidecars_dir, county_source, output_dir):
    started = time.monotonic()
    phases = PhaseRecorder(process_peak=peak_memory)
    baseline, adaptation, sidecars, source, output = map(lambda p: Path(p).resolve(),
        (baseline_dir, adaptation_dir, sidecars_dir, county_source, output_dir))
    manifest = read(baseline / 'manifest.json')
    sid = manifest['scenario_id']
    if (sid not in SCENARIOS or output.name != sid or output.exists()
            or not output.is_relative_to((ROOT / '.runtime').resolve())):
        raise ValueError('Output must be a new ROOT/.runtime directory ending in the exact supported scenario_id')
    for input_path in (baseline, adaptation, sidecars, source):
        if output.is_relative_to(input_path) or input_path.is_relative_to(output):
            raise ValueError('Output must be separate from inputs')
    input_paths = [p for directory in (baseline, adaptation, sidecars) for p in directory.rglob('*') if p.is_file()]
    input_paths += [source, source.with_name('source-report.json')]
    hierarchy_path = ROOT / 'data/hierarchy.json'
    input_paths.append(hierarchy_path)
    bindings = {str(path): digest(path) for path in input_paths}
    source_payload = read(source)
    validate_source_report(source, source_payload)
    source_counties(source_payload)
    report = read(adaptation / 'adaptation.report.json')
    plan = read(sidecars / 'sidecars.report.json')
    runtime = _local(baseline, manifest['runtime_topology_url'], sid)
    overlay_path = adaptation / 'county_overlay.geojson'
    expected = {'scenario_id': sid, 'source_sha256': digest(source), 'baseline_sha256': digest(runtime)}
    if any(report.get(k) != v or plan.get(k) != v for k, v in expected.items()):
        raise ValueError('Stale adaptation or sidecar baseline/source binding')
    if (plan.get('overlay_sha256') != digest(overlay_path)
            or plan.get('adaptation_report_sha256') != digest(adaptation / 'adaptation.report.json')
            or plan.get('sidecar_plan_passed') is not True):
        raise ValueError('Stale or unresolved sidecar plan')
    assignments, payloads = {}, {}
    for key in ('owners', 'cores', 'controllers'):
        path = baseline / f'{key}.by_feature.json'
        if manifest.get(f'{key}_url') and _local(baseline, manifest[f'{key}_url'], sid) != path:
            raise ValueError('Unsupported assignment asset location')
        present = path.exists()
        if report.get('assignment_sidecar_present', {}).get(key) is not present:
            raise ValueError(f'Assignment presence mismatch: {key}')
        payloads[key] = read(path) if present else None
        assignments[key] = payloads[key].get(key, payloads[key]) if present else {}
        if key != 'controllers' and not present:
            raise ValueError(f'Missing required assignments: {key}')
    phases.checkpoint("input-validation")
    baseline_topology = read(runtime)
    candidate, expanded, crosswalk, geometries = assemble(baseline_topology, read(overlay_path), report, assignments)
    phases.checkpoint("geometry-assembly")
    ids = {row['properties']['id'] for row in candidate['objects']['political']['geometries']}
    ownerless = (sid == 'blank_base' and manifest.get('map_mode') == 'blank'
                 and manifest.get('scenario_contract_profile') == 'lightweight_base')
    if ownerless and any(expanded.values()):
        raise ValueError('Blank scenario must remain ownerless')
    def object_ids(value):
        if isinstance(value, dict):
            fid = value.get('properties', {}).get('id')
            if isinstance(fid, str):
                yield fid
            for child in value.get('geometries', []):
                yield from object_ids(child)
    auxiliary_ids = {fid for name, obj in candidate['objects'].items() if name != 'political' for fid in object_ids(obj)}
    if not ownerless:
        validate_political_ownership(sid, baseline_topology, candidate, assignments['owners'], expanded['owners'], crosswalk)
    for key, values in expanded.items():
        extras = {fid: value for fid, value in values.items() if fid not in ids}
        original_extras = {fid: value for fid, value in assignments[key].items() if fid not in crosswalk}
        if extras != original_extras or not set(extras) <= auxiliary_ids:
            raise ValueError(f'Unknown or modified auxiliary assignments: {key}')
    for key in assignments:
        expected_patch = {child: value for old, value in assignments[key].items() if old in report['replaced_old_ids']
                          for child in crosswalk[old]}
        if read(adaptation / f'{key}.by_feature.json') != {key: expected_patch}:
            raise ValueError(f'Overlay assignment sidecar mismatch: {key}')
    if read(sidecars / 'crosswalk.json') != {'scenario_id': sid, 'old_to_new': crosswalk}:
        raise ValueError('Sidecar crosswalk mismatch')
    assets = plan.get('assets', [])
    expected_names = {name for name in SIDECARS if (baseline / name).exists()}
    if len(assets) != len(expected_names) or {a['file'] for a in assets} != expected_names:
        raise ValueError('Sidecar inventory mismatch')
    adapted = {}
    for asset in assets:
        name = asset['file']
        value, unresolved = adapt_asset(name, read(baseline / name), crosswalk, geometries)
        if (asset.get('status') != 'adapted' or asset.get('unresolved') != [] or unresolved
                or asset.get('input_sha256') != digest(baseline / name) or read(sidecars / name) != value):
            raise ValueError(f'Unresolved, stale or malformed sidecar: {name}')
        adapted[name] = value
    removed = set(report['replaced_old_ids'])
    manifest['hierarchy_overrides'] = hierarchy_override(
        manifest.get('hierarchy_overrides', {}), crosswalk, read(hierarchy_path))
    if remaining_references(manifest, removed):
        raise ValueError('Unsupported manifest references to replaced IDs')
    # Only schemas with known ID-keyed label semantics are automatically expanded.
    for path in (path for path in baseline.iterdir() if path.suffix in {'.json', '.geojson'}):
        if path.name in DERIVED | SIDECARS | {'manifest.json', 'runtime_topology.topo.json', 'owners.by_feature.json',
                                             'cores.by_feature.json', 'controllers.by_feature.json'}:
            continue
        adapted[path.name] = adapt_authoring_asset(path.name, read(path), crosswalk, geometries)
    old_hash = manifest['baseline_hash']
    manifest['baseline_hash'] = stable_json_hash(
        {'scenario_id': sid, 'feature_ids': sorted(ids)} if ownerless else expanded['owners'])
    manifest.setdefault('summary', {})['feature_count'] = len(ids) if ownerless else len(expanded['owners'])
    manifest['project_feature_migration'] = project_migration_contract(
        sid, crosswalk, old_hash, manifest['baseline_hash'])
    if 'strategic_values.by_feature.json' in adapted:
        adapted['strategic_values.by_feature.json']['baseline_hash'] = manifest['baseline_hash']
    countries = adapted['countries.json']
    counts = Counter(expanded['owners'].values())
    if set(counts) - set(countries['countries']):
        raise ValueError('Unknown owner country')
    for tag, country in countries['countries'].items():
        country['feature_count'] = counts[tag]
    phases.checkpoint("sidecar-and-domain-validation")
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.historical-county-', dir=output.parent) as temp:
        staged = Path(temp) / sid
        shutil.copytree(baseline, staged)
        phases.checkpoint("stage-copy")
        rows = candidate['objects']['political']['geometries']
        graph, neighbor_diagnostics, neighbor_cache = cached_neighbor_graph(candidate,
            {fid for fid, children in crosswalk.items() if children == [fid]},
            ROOT / '.runtime/cache/precision-adjacency')
        candidate['objects']['political']['computed_neighbors'] = graph
        phases.checkpoint("adjacency")
        write(staged / 'runtime_topology.topo.json', candidate)
        candidate_hash = digest(staged / 'runtime_topology.topo.json')
        for key, payload in payloads.items():
            if payload is not None:
                updated = {**payload, key: expanded[key]} if key in payload else expanded[key]
                if 'baseline_hash' in payload:
                    updated['baseline_hash'] = manifest['baseline_hash']
                write(staged / f'{key}.by_feature.json', updated)
        for name, value in adapted.items():
            write(staged / name, value)
        chunked = sid in {'hoi4_1936', 'hoi4_1939', 'tno_1962'}
        if chunked:
            startup = build_bootstrap_runtime_topology(candidate)
            startup_url = f'data/scenarios/{sid}/runtime_topology.bootstrap.topo.json'
            write(staged / 'runtime_topology.bootstrap.topo.json', startup)
            manifest['runtime_bootstrap_topology_url'] = manifest['startup_topology_url'] = startup_url
            layer_payloads = {layer: read(_local(staged, manifest[field], sid)) for layer, field in
                {'water': 'water_regions_url', 'special': 'special_regions_url', 'relief': 'relief_overlays_url', 'cities': 'city_overrides_url'}.items() if manifest.get(field)}
            build_and_write_scenario_chunk_assets(scenario_dir=staged, manifest_payload=manifest,
                runtime_topology_payload=candidate, startup_topology_payload=startup, layer_payloads=layer_payloads,
                startup_topology_url=startup_url, runtime_topology_url=manifest['runtime_topology_url'])
            geo_patch = adapted.get('geo_locale_patch.json', {})
            locales = build_startup_locales_payload(read(ROOT / 'data/locales.json'), read(ROOT / 'data/europe_topology.json'),
                startup, geo_patch, startup_support_whitelist={'locale_keys': [str(row['properties'][key]) for row in rows
                    for key in ('id', 'name') if row['properties'].get(key)]})
            write(staged / 'locales.startup.json', locales)
            write(staged / 'geo_aliases.startup.json', build_startup_geo_aliases_payload(read(ROOT / 'data/geo_aliases.json'), locales))
            whitelist_path = staged / 'derived/startup_support_whitelist.json'
            if whitelist_path.exists():
                whitelist = read(whitelist_path)
                whitelist['locale_keys'] = sorted(set(whitelist.get('locale_keys', [])) | {
                    str(row['properties'][key]) for row in rows for key in ('id', 'name') if row['properties'].get(key)})
                write(whitelist_path, whitelist)
        manifest.setdefault('source', {}).update({'us_county_source_sha256': digest(source),
            'us_county_source_report_sha256': digest(source.with_name('source-report.json')),
            'us_county_adaptation_report_sha256': digest(adaptation / 'adaptation.report.json'),
            'us_county_overlay_sha256': digest(overlay_path), 'us_county_sidecars_report_sha256': digest(sidecars / 'sidecars.report.json'),
            'runtime_topology_sha256': digest(staged / 'runtime_topology.topo.json')})
        if chunked:
            manifest['source']['detail_chunk_manifest_sha256'] = digest(staged / 'detail_chunks.manifest.json')
        write(staged / 'manifest.json', manifest)
        phases.checkpoint("asset-generation")
        finalize_stage(staged)
        phases.checkpoint("finalization")
        # Startup bundle generation narrows source metadata to transport hashes.
        # Restore all bound historical provenance, then synchronize audit/snapshot.
        from tools.check_scenario_contracts import _build_snapshot_for_scenario, _refresh_audit_payload
        finalized = read(staged / 'manifest.json')
        finalized['source'] = {**manifest['source'], **finalized.get('source', {})}
        if chunked:
            for language in ('en', 'zh'):
                startup_path = staged / f'startup.bundle.{language}.json'
                startup_payload = read(startup_path)
                startup_payload['source'].update(finalized['source'])
                startup_payload['manifest_subset']['source'] = deepcopy(finalized['source'])
                write(startup_path, startup_payload)
                _copy_gzip(startup_path)
        snapshot = _build_snapshot_for_scenario(staged, finalized)
        finalized['snapshot_fingerprint'] = snapshot['snapshot_fingerprint']
        write(staged / 'manifest.json', finalized)
        _refresh_audit_payload(staged, finalized, snapshot_payload=snapshot)
        for name in ('manifest.json', 'build_snapshot.json', 'audit.json'):
            if (staged / (name + '.gz')).exists():
                _copy_gzip(staged / name)
        for path in staged.rglob('*.json.gz'):
            assert_gzip_matches(path, path.with_suffix(''))
        phases.checkpoint("binding-restoration-and-streaming-gzip-validation")
        for key, original in payloads.items():
            path = staged / f'{key}.by_feature.json'
            if original is None:
                if path.exists():
                    raise ValueError(f'Finalizer invented absent assignments: {key}')
            else:
                value = read(path)
                if value.get(key, value) != expanded[key]:
                    raise ValueError(f'Finalizer changed assignments: {key}')
        if digest(staged / 'runtime_topology.topo.json') != candidate_hash:
            raise ValueError('Finalizer changed runtime geometry or properties')
        if read(staged / 'countries.json') != countries or finalized['summary']['feature_count'] != manifest['summary']['feature_count']:
            raise ValueError('Finalizer changed country counts or feature summary')
        if any(digest(Path(path)) != value for path, value in bindings.items()):
            raise ValueError('Input changed during build')
        phases.checkpoint("final-contracts")
        result = {'build_phases': phases.phases, 'scenario_id': sid, 'release_ready': False, 'complete_runtime_bundle': True,
                  'chunked': chunked, 'performance_accepted': False,
                  'derived_neighbor_geometry': neighbor_diagnostics,
                  'derived_neighbor_cache': neighbor_cache,
                  'elapsed_seconds': time.monotonic() - started, 'peak_working_set_bytes': peak_memory(),
                  'input_sha256': bindings, 'replaced_old_ids': sorted(removed),
                  'unresolved_ids_retained_in_baseline': report['unresolved_ids_retained_in_baseline'],
                  'candidate_runtime_sha256': digest(staged / 'runtime_topology.topo.json')}
        write(staged / 'us_county_migration.report.json', result)
        staged.rename(output)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline-dir', 'adaptation-dir', 'sidecars-dir', 'county-source', 'output-dir'):
        parser.add_argument('--' + name, type=Path, required=True)
    print(json.dumps(stage(**vars(parser.parse_args())), indent=2))
