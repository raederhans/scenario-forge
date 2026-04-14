# TNO 1962 Stage 0 海域热修执行文档

## 目标

在后续大 sweep 之前，先对全部 `marine_macro` 做异常审计，并热修会出现“矩形底座压住国家填色”的海域。

## 范围

- 全量审计对象：`marine_macro`
- 当前首批确认异常：
  - `tno_gulf_of_alaska`
  - `tno_labrador_sea`
  - `tno_tasman_sea`
- 联动验证对象：
  - `tno_gulf_of_st_lawrence`

## 实施清单

### 1. 海域定义与构建
- [ ] 移除异常 macro 的整盆地级 `supplement_bboxes`
- [ ] 保留官方 source，不回退 clone
- [ ] 必要时补最小 `subtract_named_ids`
- [ ] 让 named-water snapshot 保持原始官方 source，不能混入 supplement

### 2. 回归护栏
- [ ] 给 `marine_macro` 增加 land-overlap 审计
- [ ] 给带 supplement 的 macro 增加 raw/final 面积膨胀审计
- [ ] 保持关键 seam / non-overlap 检查

### 3. 产物与验证
- [ ] 重建 water/runtime/chunks/manifest/startup bundle 产物
- [ ] 跑定向 Python 测试与 validator
- [ ] 做一次 review / 查 bug / 第一性原理复核
- [ ] 如有新的重大教训，补到 `lessons learned.md`

## 进度记录

- 2026-04-12：已完成静态审计，确认当前最明显异常来自 `tno_gulf_of_alaska` / `tno_labrador_sea` / `tno_tasman_sea` 的过大 `supplement_bboxes`；`tno_gulf_of_st_lawrence` 更像被 `tno_labrador_sea` 连带影响。
- 2026-04-12：已完成第一轮代码改动：	ools/patch_tno_1962_bundle.py 已移除 Labrador / Tasman 的整盆地 supplement，Gulf of Alaska 改成最小 seam patch，并让 named-water snapshot 保持 raw official source；	ests/test_tno_water_geometries.py 与 	ools/validate_tno_water_geometries.py 已补 marine_macro land-overlap / snapshot inflation 护栏。
- 2026-04-12：已完成 Stage 0 产物刷新：checkpoint 里先修 raw snapshot 与 named water seed，再重跑 runtime_topology / startup_assets / write_bundle / chunk_assets；scenario shipped artifacts 已更新，Alaska / Labrador / Tasman 的海域范围已回到官方 source 附近。
- 2026-04-12：验证结果：新增的 macro land-overlap / snapshot inflation 护栏通过；`tools/validate_tno_water_geometries.py` 仍剩 4 个旧 probe miss（Poole Bay / Cardigan Bay / Greenland Sea / Ross Sea）和 1 个旧 seam fail（Barents Sea ↔ Western Arctic Ocean），未因本轮热修新增失败项。
- 2026-04-13：根据 review 第二轮修正：不再用过小桥接补丁硬切 Gulf of Alaska / Labrador Sea / Tasman Sea，而是改成“raw official source + late supplement（先减 land，再按 spec 级 subtract 约束）”。成品数据里 review 指出的 4 个 sample 点都重新回到正确海域，且 Labrador↔St. Lawrence、三组 macro↔open-ocean 关系都回到 distance=0 / overlap=0。
