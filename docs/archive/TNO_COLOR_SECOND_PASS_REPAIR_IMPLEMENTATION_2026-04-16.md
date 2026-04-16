# TNO_COLOR_SECOND_PASS_REPAIR_IMPLEMENTATION_2026-04-16

## 计划
- [x] 把 TNO 最终颜色同步从 blanket audit 改成混合策略。
- [x] 恢复显式特例 `PHI / MAL / LAO / ARM / BRG` 的场景源色。
- [x] 保持 `KAZ / UZB` 和已确认的非洲 palette 对齐条目不变。
- [x] 更新测试，覆盖“特例保留 + palette 优先区继续对齐”。
- [x] 跑定向验证并归档。

## 进度
- [x] 已确认中国军阀主线当前稳定，无需本轮改动。
- [x] 已确认当前被 blanket audit 覆盖错的核心条目集中在菲律宾、中亚两国、以及一批非洲/殖民 scenario_extension。
- [x] 已确认 `PHI / MAL / LAO / ARM / BRG` 存在场景规则或代码显式颜色来源，应保留场景源色。
- [x] 已在 `tools/patch_tno_1962_bundle.py` 加入显式特例跳过集，并把最终同步改为混合策略。
- [x] 已把 `data/scenarios/tno_1962/countries.json` 中 5 个显式特例恢复为场景源色。
- [x] 已补测试：
  - `tests/test_tno_bundle_builder.py`
- [x] 已完成验证：
  - `python -m py_compile tools/patch_tno_1962_bundle.py tests/test_tno_bundle_builder.py`
  - `python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_tno_runtime_country_colors_follow_mixed_palette_policy tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_tno_palette_audit_sync_keeps_explicit_scenario_color_exceptions tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_scenario_manager_keeps_active_scenario_colors_tag_scoped tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_second_wave_runtime_colors_match_tno_audit_targets tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_final_wave_runtime_colors_match_tno_audit_targets tests.test_import_country_palette`
  - 静态复核：`PHI / MAL / LAO / ARM / BRG` 已恢复场景源色
  - 静态复核：`KAZ / UZB / ANG / MZB / RWA / ZAM / ZIM / EGY / TUN / LBA / MAD / MOR` 继续对齐 audit
  - 静态复核：`owners/controllers/cores` SHA 全部保持不变
