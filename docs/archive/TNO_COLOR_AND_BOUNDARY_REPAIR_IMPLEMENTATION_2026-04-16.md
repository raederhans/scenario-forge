# TNO_COLOR_AND_BOUNDARY_REPAIR_IMPLEMENTATION_2026-04-16

## 计划
- [x] 确认运行时颜色桥误用点，并把 active scenario 颜色恢复为按 tag 显示。
- [x] 修正 TNO 静态颜色同步逻辑，让 countries.json 优先对齐 tno.audit.json 的 map_hex。
- [x] 补回归测试，覆盖运行时颜色桥与静态颜色一致性。
- [x] 跑定向验证，复核 owners/controllers/cores 未被改动。
- [x] 完成 review 后归档本文件。

## 进度
- [x] 已确认边界数据文件 `owners.by_feature.json`、`controllers.by_feature.json` 在颜色修复提交前后保持同一 SHA。
- [x] 已确认 active scenario 误把 ISO2 runtime default bridge 用到了 scenario tag 颜色，导致 94 个 tag 被错误改色。
- [x] 已把 `js/core/scenario_manager.js` 收回到按 tag 读取场景显式颜色，移除 active scenario 对 runtime bridge 的依赖。
- [x] 已在 `tools/patch_tno_1962_bundle.py` 增加最终 palette audit 颜色同步步骤。
- [x] 已把 `data/scenarios/tno_1962/countries.json` 中 18 个静态颜色差异同步到 `tno.audit.json`。
- [x] 已补测试：
  - `tests/test_tno_bundle_builder.py`
- [x] 已完成验证：
  - `python -m py_compile tools/patch_tno_1962_bundle.py tests/test_tno_bundle_builder.py`
  - `node --check js/core/scenario_manager.js`
  - `node --test tests/palette_runtime_bridge.node.test.mjs`
  - `python -m unittest tests.test_import_country_palette tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_tno_runtime_country_colors_match_palette_audit_when_map_hex_exists tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_scenario_manager_keeps_active_scenario_colors_tag_scoped tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_second_wave_runtime_colors_match_tno_audit_targets tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_final_wave_runtime_colors_match_tno_audit_targets`
  - 静态复核：`countries_vs_audit_mismatch_count = 0`
  - 静态复核：`owners/controllers/cores` SHA 全部保持不变
