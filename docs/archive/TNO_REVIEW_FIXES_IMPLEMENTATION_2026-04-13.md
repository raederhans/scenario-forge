# TNO review 回归修复记录 2026-04-13

## 目标
- 修复 `political.coarse` 字段裁剪过头导致的低缩放交互回归
- 修复 derived named-water snapshot/provenance 没被 publish 到干净场景目录的问题
- 修复 legacy root snapshot 不能自动回填到 `derived/` 的兼容缺口

## 实施清单
- [x] 恢复 `political.coarse` 最小安全字段集
- [x] 把 snapshot/provenance checkpoint 常量切到 `derived/...`
- [x] 重新加入 `scenario_data/all` publish scope
- [x] 补 snapshot legacy root -> derived fallback
- [x] 更新定向测试并重建受影响产物

## 进度记录
- 2026-04-13：`map_builder/contracts.py` 已把 named-water snapshot/provenance 的 checkpoint filename 常量切到 `derived/...`，并重新加入 `scenario_data/all` publish scope，这样 checkpoint -> publish -> 干净场景目录 -> 下次 water rebuild 这条链不会再缺支撑文件。
- 2026-04-13：`tools/patch_tno_1962_bundle.py` 已补 legacy root snapshot -> `derived/...` 自动回填，和已有 provenance fallback 收到同一个 helper 里。
- 2026-04-13：`tools/scenario_chunk_assets.py` 已恢复 `political.coarse` 的最小安全字段集：`id/name/cntr_code/__source/interactive/detail_tier/admin1_group/render_as_base_geography/scenario_helper_kind/atl_geometry_role/atl_join_mode`。
- 2026-04-13：已重跑 `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/tno_1962`，让 checked-in `political.coarse` 与 `water.coarse` 都对齐当前生成逻辑。

## 本轮验证
- `python -m py_compile map_builder/contracts.py tools/patch_tno_1962_bundle.py tools/scenario_chunk_assets.py tests/test_scenario_chunk_assets.py tests/test_tno_bundle_builder.py tests/test_scenario_bundle_platform.py tests/test_scenario_rebuild_planner.py`
- `python -m unittest tests.test_scenario_chunk_assets tests.test_tno_bundle_builder tests.test_scenario_bundle_platform tests.test_scenario_rebuild_planner -q`
- `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/tno_1962`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 结论
- 这轮 review 里提到的 3 个真实回归已经收口：低缩放 political helper 语义恢复、derived support files 会继续随 publish 落到场景目录、legacy root snapshot 也会自动迁到 `derived/...`。
