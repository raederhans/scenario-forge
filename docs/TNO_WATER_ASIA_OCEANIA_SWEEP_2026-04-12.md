# TNO 1962 亚洲与大洋洲海域 sweep 执行文档

## 目标

一次完成以下三段海链的海域细化，并把 source → runtime → startup bundle → chunk assets → 测试链路一起收口：

1. 西亚-印度洋线
2. 菲律宾-西太平洋线
3. 澳大利亚近海线

## 本轮边界

- 不新增 Inspector 功能
- 不新增菲律宾更碎的 micro-strait
- 只处理本轮明确列出的海域 id
- shipped artifacts 必须同轮刷新
- 只走最短路径，不顺手扩 scope

## 实施清单

### 1. 海域定义

- [ ] 印度洋线 clone-only 宏海域切到 SeaVoX 官方源，并补齐 `exclude_base_ids` / `subtract_named_ids` / `clip_open_ocean_ids`
- [ ] 菲律宾-西太平洋线 clone-only 宏海域切到 SeaVoX 官方源，并补齐 sibling seam 规则
- [ ] 澳洲线新增 `tno_gulf_of_carpentaria` / `tno_arafura_sea` / `tno_timor_sea`
- [ ] 给 `tno_coral_sea` / `tno_tasman_sea` 增加本轮 children 与 subtract

### 2. 测试

- [ ] 扩展 named marginal water contract non-overlap pairs
- [ ] 扩展 water geometry probe / seam / chunk coverage 断言
- [ ] 扩展 validate_tno_water_geometries probe / seam 报告
- [ ] 在现有 Playwright smoke 里补 3 个区域的 metadata 检查

### 3. 产物刷新

- [ ] 刷新 `water_regions.geojson`
- [ ] 刷新 `runtime_topology.topo.json`
- [ ] 刷新 `runtime_topology.bootstrap.topo.json`
- [ ] 刷新 `chunks/water.*.json`
- [ ] 刷新 `detail_chunks.manifest.json` / `context_lod.manifest.json`
- [ ] 刷新 `manifest.json` / `audit.json`
- [ ] 刷新 `startup.bundle.{en,zh}.json(.gz)`

### 4. 验证与收尾

- [ ] 跑定向 Python 测试
- [ ] 跑定向 e2e smoke
- [ ] 做一次 review / 查 bug / 第一性原理复核
- [ ] 如有新的重大教训，补到 `lessons learned.md`

## 进度记录

- 2026-04-12：已确认方案并开始执行；已完成仓库现状核对，确认本轮目标海域大多仍是 `marine_macro` 无 children 状态，`tno_coral_sea` 已是官方源，本轮只需要补 children 与 subtract，不需要重做 source。
- 2026-04-12：已完成第一轮代码改动：
  - `tools/patch_tno_1962_bundle.py` 已补印度洋 / 菲律宾 / 澳大利亚近海的 source、children、subtract、clip 规则
  - 合同测试、probe/seam 测试、validator、e2e smoke 已扩到本轮目标海域
  - 正在后台重建 scenario shipped artifacts
