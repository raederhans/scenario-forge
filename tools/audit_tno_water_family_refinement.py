from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_WATER_PATH = ROOT / 'data' / 'scenarios' / 'tno_1962' / 'water_regions.geojson'
OUTPUT_PATH = ROOT / '.runtime' / 'reports' / 'generated' / 'ocean_family_refine_audit.json'


def main() -> int:
    payload = json.loads(SCENARIO_WATER_PATH.read_text(encoding='utf-8'))
    features = payload.get('features', []) or []
    children_by_parent: dict[str, list[dict]] = {}
    macros: list[dict] = []

    for feature in features:
        props = feature.get('properties', {}) or {}
        parent_id = str(props.get('parent_id') or '').strip()
        if parent_id:
            children_by_parent.setdefault(parent_id, []).append({
                'id': str(props.get('id') or '').strip(),
                'name': str(props.get('name') or '').strip(),
                'water_type': str(props.get('water_type') or '').strip(),
                'source_standard': str(props.get('source_standard') or '').strip(),
            })
        if str(props.get('region_group') or '').strip() == 'marine_macro':
            macros.append(feature)

    family_rows = []
    unrefined = []
    for feature in sorted(macros, key=lambda item: str((item.get('properties') or {}).get('name') or '')):
        props = feature.get('properties', {}) or {}
        feature_id = str(props.get('id') or '').strip()
        children = sorted(children_by_parent.get(feature_id, []), key=lambda item: item['name'])
        row = {
            'id': feature_id,
            'name': str(props.get('name') or '').strip(),
            'water_type': str(props.get('water_type') or '').strip(),
            'source_standard': str(props.get('source_standard') or '').strip(),
            'child_count': len(children),
            'children': children,
            'refinement_status': 'detailed' if children else 'macro_only',
        }
        family_rows.append(row)
        if not children:
            unrefined.append({
                'id': feature_id,
                'name': row['name'],
                'source_standard': row['source_standard'],
                'reason': 'no marine_detail children yet',
                'suggested_priority': 'high' if row['source_standard'] == 'tno_cloned_from_global_water_regions' else 'medium',
            })

    report = {
        'generated_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        'scenario_id': 'tno_1962',
        'summary': {
            'marine_macro_count': len(family_rows),
            'marine_macro_with_children_count': sum(1 for row in family_rows if row['child_count'] > 0),
            'marine_macro_without_children_count': len(unrefined),
        },
        'families': family_rows,
        'unrefined_candidates': sorted(unrefined, key=lambda item: (item['suggested_priority'], item['name'])),
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['summary'], ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
