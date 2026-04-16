# TNO_BASELINE_COLOR_FIX_2026-04-15

## 计划
- [x] 确认 9 个基线问题的真正取色链和最小修复点。
- [x] 用单一规则收口 TNO baseline 的默认取色，避免继续靠零散白名单。
- [x] 为缺少 palette 直连条目的 baseline 宏观 TAG 补显式 TNO 固定色或 proxy。
- [x] 补单元测试，重建相关产物并复核 9 个问题是否消失。

## 进度
- [x] 已定位主问题在 `tools/patch_tno_1962_bundle.py` 与 `data/releasables/tno_1962.internal.phase1.source.json`。
- [x] 已完成代码修改。
- [x] 已完成测试与 countries-stage 重建，并同步 `data/scenarios/tno_1962/countries.json`。
- [x] 已完成复核与归档。

## 变更点
- `tools/patch_tno_1962_bundle.py`
  - 新增 baseline TNO 颜色补丁集合：`FRA / LIB / MON / SOV`
  - 为独立 `RAJ` 固化显式 TNO 颜色，避免继续冻结旧 subject 派生色
- `data/releasables/tno_1962.internal.phase1.source.json`
  - 把 `JOR / LEB / PAL / SYR` 的 `color_hex_override` 改为 TNO 基线目标色
- `data/scenarios/tno_1962/countries.json`
  - 同步重建后的 9 个基线颜色结果
- `tests/test_tno_bundle_builder.py`
  - 新增 baseline patch 与 RAJ decolonization 保护测试

## 验证
- `python -m py_compile tools/patch_tno_1962_bundle.py tests/test_tno_bundle_builder.py`
- `python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_resolve_tno_palette_color_includes_1962_fixed_overrides tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_patch_tno_palette_defaults_patches_selected_tno_baseline_entries tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_apply_tno_decolonization_metadata_sets_explicit_raj_color`
- 复跑 `.runtime/tmp/tno_color_audit_2026_04_15.py`，9 个基线 TAG 已全部退出 mismatch 清单
