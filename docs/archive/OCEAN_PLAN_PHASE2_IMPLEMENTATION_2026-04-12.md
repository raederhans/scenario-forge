# 海洋计划第二轮实施记录 2026-04-12

## 目标
- 补命名边缘海契约测试与 runtime/e2e 测试。
- 对 Baltic / Celtic-Irish / North Sea 三个 family 按更细尺度继续细化。
- 审计第一轮之外未细化的其他海洋 family，形成下一波候选清单。
- 把 Water Inspector 升级为可编辑工作台。

## 计划
- [x] 读取 lessons learned 与相关技能/现有实现
- [x] 梳理三组 family 的新增候选与 Inspector 升级边界
- [x] 实现三组 family 细化与全局审计输出
- [x] 实现命名海域契约测试与 runtime/e2e 测试
- [x] 升级 Water Inspector 为可编辑工作台
- [x] 修复 review 指出的 Inspector 选择逻辑与 macro/detail overlap 问题
- [x] 刷新 shipped artifacts 并串行验证
- [x] 更新 lessons learned
- [x] 归档本文档

## 进度日志
- 已基于第二轮目标继续扩展 `TNO_NAMED_MARGINAL_WATER_SPECS`。
- Baltic family 本轮新增：Central Baltic Sea、The Sound、Storebaelt、Lillebaelt。
- Celtic-Irish family 本轮新增：St. Brides Bay、Bay of Brest、Swansea Bay、Carmarthen Bay、Bridgwater Bay、Barnstaple/Bideford Bay。
- North Sea family 本轮新增：Wadden Sea、Thames Estuary、Blackwater Estuary、The Wash、Humber Estuary、Firth of Forth、Moray Firth、Pentland Firth。
- 已新增 `tests/test_tno_named_marginal_water_contract.py`，专门锁定命名边缘海存在性与 subtraction / overlap 契约。
- 已扩展 `tests/test_tno_water_geometries.py`，覆盖 source/runtime/bootstrap/chunk/shipped startup bundle 一致性，以及第二轮 probe/seam 校验。
- 已新增 `tests/e2e/tno_named_water_rendering.spec.js`，覆盖命名海域在 Inspector 中的选择、family 级批量改色和 parent/child 导航；本轮完成语法检查，未完成全量 Playwright 执行。
- 已升级 Water Inspector：增加 type/group/source/override 过滤、排序、结果计数、详情元数据、parent 跳转、children 列表，以及 scope 级批量 apply/clear。
- 已把 open ocean 交互拆成 selection / paint 两条线，并保持 hover 继续关闭。
- 已针对 review 修复：
  - paint-only 模式下不再在 Inspector 中显示 open ocean 项
  - `tno_kattegat` 现在 subtract `tno_central_baltic_sea`
  - `tno_irish_sea` 现在 subtract `tno_st_brides_bay`
  - `tno_bay_of_biscay` 现在 subtract `tno_bay_of_brest`
- 已刷新 `water_regions.geojson`、`runtime_topology*.json`、`water.*.json` chunks、`manifest.json`、`audit.json`、`startup.bundle.{en,zh}.json(.gz)`。
- 已生成 `.runtime/reports/generated/ocean_family_refine_audit.json`，当前共有 50 个 marine_macro，其中 4 个 family 已有 detail children，46 个仍是 macro-only 候选。
- 最终验证：
  - `python tools/validate_tno_water_geometries.py` 通过
  - `./.venv/bin/python -m pytest tests/test_tno_named_marginal_water_contract.py tests/test_tno_water_geometries.py -q` 通过（13 passed）
  - `node --check` 通过：`js/ui/sidebar.js`、`js/core/map_renderer.js`、`js/core/file_manager.js`、`js/core/interaction_funnel.js`、`js/ui/toolbar.js`、`tests/e2e/tno_named_water_rendering.spec.js`
  - startup bundle / manifest / audit 已同步到 `tno_water_region_count=95`、`tno_named_marginal_water_count=74`
