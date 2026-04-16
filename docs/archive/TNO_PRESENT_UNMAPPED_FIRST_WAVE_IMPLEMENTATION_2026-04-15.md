# TNO_PRESENT_UNMAPPED_FIRST_WAVE_IMPLEMENTATION_2026-04-15

## 计划
- [x] 为第一批 13 个 TAG 落地 reviewed 映射。
- [x] 增加 `expose_as_runtime_default` 契约，拆开“已审核映射”和“runtime 默认色桥”。
- [x] 更新 map/audit 产物并补测试。
- [x] 复核剩余 present_unmapped 清单。

## 进度
- [x] 已修改 `data/palette-maps/tno.manual.json`，补 13 个 verified 映射和 `non_default_runtime_tags`。
- [x] 已修改 `tools/import_country_palette.py`，支持 `non_default_runtime_tags` 并输出 `mapped[tag].expose_as_runtime_default=false`。
- [x] 已修改 `scenario_builder/hoi4/crosswalk.py` 与 `js/core/palette_manager.js`，让这些 reviewed alt TAG 不再接管 runtime 默认桥。
- [x] 已新增 `tests/test_import_country_palette.py`。
- [x] 已重生成 `data/palette-maps/tno.map.json` 与 `data/palette-maps/tno.audit.json`。
- [x] 已复核剩余 `present_unmapped` 从 48 降到 35。

## 验证
- `python -m py_compile tools/import_country_palette.py scenario_builder/hoi4/crosswalk.py tests/test_import_country_palette.py`
- `python -m unittest tests.test_import_country_palette tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_resolve_tno_palette_color_includes_1962_fixed_overrides tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_patch_tno_palette_defaults_patches_selected_tno_baseline_entries tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_apply_tno_decolonization_metadata_sets_explicit_raj_color`
- `node --check js/core/palette_manager.js`
- 静态复核：13 个目标 TAG 已进入 `tno.map.json.mapped`，并且全部带 `expose_as_runtime_default: false`
