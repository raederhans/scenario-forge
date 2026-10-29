from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from map_builder.scenario_context import write_json_transaction

MIGRATION_VERSION = 1
SCENARIO_DIR = ROOT / 'data/scenarios/tno_1962'
IDENTITY_PATH = ROOT / 'data/scenario-rules/tno_1962.identity_map.json'
SOURCE_FILES = (
    'countries.json', 'owners.by_feature.json', 'cores.by_feature.json',
    'controllers.by_feature.json', 'scenario_mutations.json',
    'scenario_manual_overrides.json', 'city_overrides.json', 'city_assets.partial.json',
    'capital_defaults.partial.json', 'capital_hints.json', 'district_groups.manual.json',
    'geo_locale_patch.json', 'geo_locale_patch.en.json', 'geo_locale_patch.zh.json',
    'geo_name_overrides.manual.json', 'geo_locale_reviewed_exceptions.json',
    'releasable_catalog.manual.json', 'audit.json',
)


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def migration_map(identity):
    return {tag: entry['new_tag'] or entry['split_targets'][0]
            for tag, entry in identity['conflict_migrations'].items()}


def migrate_references(value, mapping):
    if isinstance(value, dict) and 'scenario_ids' in value and 'tno_1962' not in value['scenario_ids']:
        return value
    if isinstance(value, str):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [migrate_references(item, mapping) for item in value
                if not (isinstance(item, dict) and item.get('tag') in {'PRC', 'ANG'}
                        and ('scenario_ids' not in item or 'tno_1962' in item['scenario_ids']))]
    if isinstance(value, dict):
        return {mapping.get(key, key): migrate_references(item, mapping)
                for key, item in value.items() if key not in {'PRC', 'ANG'}}
    return value


def apply_identity_migrations(scenario_dir=SCENARIO_DIR, identity_path=IDENTITY_PATH,
                              releasable_paths=None):
    scenario_dir = Path(scenario_dir)
    manifest_path = scenario_dir / 'manifest.json'
    manifest = read_json(manifest_path)
    if manifest.get('tag_migration_version', 0) >= MIGRATION_VERSION:
        return []
    mapping = migration_map(read_json(identity_path))
    if releasable_paths is None:
        releasable_paths = [ROOT / f'data/releasables/tno_1962.internal.phase1.{kind}.json'
                            for kind in ('catalog', 'source')]
    paths = [scenario_dir / name for name in SOURCE_FILES] + list(releasable_paths)
    changes = []
    for path in paths:
        if not path.exists():
            continue
        original = read_json(path)
        migrated = migrate_references(original, mapping)
        if migrated != original:
            changes.append((path, migrated))
    migrated_manifest = migrate_references(manifest, mapping)
    migrated_manifest['tag_migration_version'] = MIGRATION_VERSION
    changes.append((manifest_path, migrated_manifest))
    write_json_transaction(changes)
    return [str(path) for path, _ in changes]


if __name__ == '__main__':
    changed = apply_identity_migrations()
    print(json.dumps({'changed_files': len(changed), 'paths': changed}, ensure_ascii=False))
