# QA-052 HOI4 1939 Regression Hotfix (2026-03-05)

## Incident
- 1939 scenario regressed to modern-like fallback ownership in multiple regions (Germany/China/Africa).
- Controller/frontline layer was effectively disabled.

## Root Cause
- 1939 bundle was rebuilt with only `hoi4_1939.manual.json` owner rules, dropping the required 1936 baseline rule pack.
- `data/scenario-rules/hoi4_1939.controller.manual.json` had been emptied (`rules: []`).
- Expectation file had drifted to custom assertions (`NCP`/`RGC`) that no longer matched intended owner semantics.

## Fix Applied
1. Restored and corrected 1939 owner/controller rule packs:
   - [hoi4_1939.manual.json](/Users/raede/Desktop/dev/mapcreator/data/scenario-rules/hoi4_1939.manual.json)
   - [hoi4_1939.controller.manual.json](/Users/raede/Desktop/dev/mapcreator/data/scenario-rules/hoi4_1939.controller.manual.json)
2. Kept CZ/SK targeted refinement semantics:
   - Sudetenland split features -> `GER`
   - South Slovakia split features -> `HUN`
   - Czech remainder (excluding Sudetenland) -> `BOM`
3. Rebuilt 1939 using rule stacking:
   - `1936 baseline + 1939 delta + 1939 controller`
4. Updated 1939 expectation to align with intended controller-enabled scenario:
   - [hoi4_1939.expectation.json](/Users/raede/Desktop/dev/mapcreator/data/scenarios/expectations/hoi4_1939.expectation.json)

## Build Command Used
```bash
python tools/build_hoi4_scenario.py \
  --scenario-id hoi4_1939 \
  --display-name "HOI4 1939" \
  --source-root "C:\Program Files (x86)\Steam\steamapps\common\Hearts of Iron IV" \
  --bookmark-file common/bookmarks/blitzkrieg.txt \
  --as-of-date 1939.8.14.12 \
  --manual-rules "data/scenario-rules/hoi4_1936.manual.json,data/scenario-rules/hoi4_1939.manual.json" \
  --controller-rules "data/scenario-rules/hoi4_1939.controller.manual.json" \
  --scenario-output-dir data/scenarios/hoi4_1939 \
  --report-dir reports/generated/scenarios/hoi4_1939
```

## Validation
- Scenario check:
  - `python tools/check_hoi4_scenario_bundle.py --scenario-dir data/scenarios/hoi4_1939 --report-dir reports/generated/scenarios/hoi4_1939 --expectation data/scenarios/expectations/hoi4_1939.expectation.json`
  - Result: `OK`
- Key signals:
  - `source_counts = { direct_active_owner: 5239, manual_rule: 5965, fallback_mapped_tag: 18 }`
  - `owner_controller_split_feature_count = 24`
  - `controller_rule_count = 3`
  - `blocker_count = 0`
- Spot checks:
  - Sudeten sample features -> `GER`
  - South Slovakia sample features -> `HUN`
  - BOM anchors (`CZ010/CZ020/CZ063`) -> `BOM`
  - Hebei-Chahar sample -> `owner=CHI`, `controller=MEN`
  - Hainan sample -> `owner=CHI`, `controller=JAP`

## Note
- During local verification, `tools/dev_server.py` reported port `8000` occupied and auto-tried `8001`.
