# TNO_SECOND_WAVE_COLOR_FIX_2026-04-15

## 计划
- [x] 修复 5 个颜色仍不一致的 TAG：`KOR / GNG / MAG / ONG / GAY`。
- [x] 把 25 个 `RU` 锚点 TAG 推进到 reviewed 映射层。
- [x] 重生成 `tno.map.json / tno.audit.json`，并确认剩余 `present_unmapped` 只剩 5 个专题项。
- [x] 补测试并做启动健康复核。

## 进度
- [x] 已修改 5 个 TAG 的 canonical 颜色来源。
- [x] 已更新 `data/palette-maps/tno.manual.json`，新增第二波 30 个 verified 映射和 `non_default_runtime_tags`。
- [x] 已重生成 `data/palette-maps/tno.map.json` 与 `data/palette-maps/tno.audit.json`。
- [x] 已同步 `data/scenarios/tno_1962/countries.json` 的 5 个颜色差异修复值。
- [x] 已完成测试与启动自检。

## 变更点
- `tools/patch_tno_1962_bundle.py`
  - `KOR` 颜色改为 `#009163`
- `data/scenario-rules/tno_1962.east_asia_ownership.manual.json`
  - `GNG` 颜色改为 `#7A2E41`
- `data/scenarios/tno_1962/scenario_manual_overrides.json`
  - `MAG` 颜色改为 `#cac6b2`
  - `ONG` 颜色改为 `#51875b`
  - 新增 `GAY` canonical create 条目，颜色为 `#4b4150`
- `data/palette-maps/tno.manual.json`
  - 新增 `KOR / GNG / MAG / ONG / GAY`
  - 新增 25 个 `RU` 锚点 reviewed 映射
- `tests/test_import_country_palette.py`
  - 新增第二波 30 个 TAG 的映射契约断言
- `tests/test_tno_bundle_builder.py`
  - 新增第二波 canonical 颜色来源断言
  - 新增 runtime `countries.json.color_hex == tno.audit.map_hex` 断言

## 验证
- `python -m py_compile tools/import_country_palette.py scenario_builder/hoi4/crosswalk.py tests/test_import_country_palette.py tests/test_tno_bundle_builder.py tools/patch_tno_1962_bundle.py`
- `python -m unittest tests.test_import_country_palette tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_resolve_tno_palette_color_includes_1962_fixed_overrides tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_patch_tno_palette_defaults_patches_selected_tno_baseline_entries tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_apply_tno_decolonization_metadata_sets_explicit_raj_color tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_second_wave_color_sources_match_expected_targets tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_second_wave_runtime_colors_match_tno_audit_targets`
- 静态复核：`tno.map.json.mapped` 已从 131 增到 161
- 静态复核：剩余 `present_unmapped` 已缩到 5 个：`PRC / SIC / SIK / TIB / XIK`
- 启动探针：`activeScenarioId=tno_1962`，`bootError=''`
