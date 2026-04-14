# 海洋计划实施记录 2026-04-12

## 目标
- 先修当前海洋计划的系统性缺口，不只盯单个海域。
- 第一波落地 Baltic / Celtic-Irish / North Sea 三组 basin。
- 同步补 coverage / seam 测试，避免以后再靠肉眼发现。

## 计划
- [x] 读取 lessons learned、现有 agent/skill、现有水域链路
- [x] 梳理第一波 basin 的数据源与拼装规则改动点
- [x] 实现代码改动
- [x] 补覆盖点与无细缝测试、增强静态 validator
- [x] 更新场景水域源文件、runtime topology、water chunks
- [x] 修正 ocean macro validator 误报
- [x] 刷新 shipped startup artifacts（manifest / audit / startup bundles）
- [x] 串行验证并复核
- [x] 更新 lessons learned
- [x] 归档本文档

## 进度日志
- 已确认问题主因在数据源与场景拼装层，不是前端渲染层。
- 已确认全局 `water_regions.geojson` 只提供很粗的 `marine_macro` 基底，TNO 场景大量直接 clone。
- 已确认 Baltic 在现有数据里缺 Gulf of Riga / Gulf of Bothnia 方向覆盖；Celtic/Bristol 一带存在边界过粗与细缝风险。
- 已在 `tools/patch_tno_1962_bundle.py` 补第一波 detail waters：Gulf of Riga、Bothnian Sea、Bay of Bothnia、Gulf of Finland、St. George's Channel、Severn Estuary。
- 已把 `tno_baltic_sea` / `tno_celtic_sea` / `tno_irish_sea` / `tno_bristol_channel` 的 subtract 关系同步收口，并移除统一 0.0005 度裁切缓冲。
- 已在 `tests/test_tno_water_geometries.py` 增加第一波 detail contract、coverage probe、无细缝断言，并增加 bootstrap topology / startup bundle 对齐断言。
- 已在 `tools/validate_tno_water_geometries.py` 增加同类静态报告项，并把 `ocean_macro` 校验改为 pairwise overlap 真错误检查。
- 已刷新 `marine_regions_named_waters.snapshot.geojson`、`water_regions.provenance.json`、`water_regions.geojson`、`runtime_topology*.json`、`water.*.json` chunks、`manifest.json`、`audit.json`、`startup.bundle.{en,zh}.json(.gz)`。
- 最终验证：
  - `tools/validate_tno_water_geometries.py` 通过
  - `tests/test_tno_water_geometries.py` 通过
  - startup bundle 内的 `runtime_bootstrap_topology_sha256` 与 shipped bootstrap topology 对齐
  - manifest / audit / startup bundle 的 `tno_water_region_count=77`、`tno_named_marginal_water_count=56` 已同步
