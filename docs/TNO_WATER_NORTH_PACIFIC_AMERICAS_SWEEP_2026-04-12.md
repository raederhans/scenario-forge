# TNO 1962 北太平洋高纬 + 美洲海链海域细化执行文档

## 目标

一次推进两条主线的 macro officialization：

1. 北太平洋高纬线
2. 美洲海链

本轮只做高价值 macro，不顺手拆大量 child。

## 本轮目标海域

- 北太平洋高纬
  - `tno_bering_sea`
  - `tno_gulf_of_alaska`
  - `tno_beaufort_sea`
  - `tno_labrador_sea`
- 美洲海链
  - `tno_gulf_of_st_lawrence`
  - `tno_hudson_bay`
  - `tno_caribbean_sea`
  - `tno_gulf_of_mexico`

## 实施清单

### 1. 海域定义

- [ ] 把 8 个目标海域统一切到 Marine Regions 官方源
- [ ] 为 clone 转官方的海域补 `exclude_base_ids`
- [ ] 保持 macro-only，不新增 child
- [ ] 只在必要处补 `subtract_named_ids`
- [ ] 同步确认 `clip_open_ocean_ids`

### 2. 测试

- [ ] contract 补 6 个新增 macro 合同
- [ ] geometry / validator 纳入 8 个 macro probe
- [ ] 补关键 `non-overlap` / `seam` pair
- [ ] 扩 water inspector metadata smoke

### 3. 产物

- [ ] 刷新 `water_regions.geojson`
- [ ] 刷新 `runtime_topology.topo.json`
- [ ] 刷新 `runtime_topology.bootstrap.topo.json`
- [ ] 刷新 `chunks/water.*.json`
- [ ] 刷新 `detail_chunks.manifest.json` / `context_lod.manifest.json`
- [ ] 刷新 `manifest.json` / `audit.json`
- [ ] 刷新 `startup.bundle.{en,zh}.json`
- [ ] 刷新 `startup.bundle.{en,zh}.json.gz`

## 进度记录

- 2026-04-12：已确认本轮目标海域与最小测试集；已查到官方源候选，开始实现。
- 2026-04-12：已完成第一轮代码改动：
  - `tno_gulf_of_alaska` / `tno_beaufort_sea` / `tno_labrador_sea` / `tno_hudson_bay` / `tno_caribbean_sea` / `tno_gulf_of_mexico` 已切到 Marine Regions IHO 官方源
  - 北太平洋高纬 + 美洲海链的 contract / probe / seam / e2e smoke 已补入测试
  - 正在后台重建 shipped artifacts
- 2026-04-12：下一阶段推进策略已收敛：
  - 北大西洋-北冰洋与南半球余量线优先做 macro officialization
  - 欧洲第二层 detail 本轮只做最稳的 grouped source：`English Channel` 与 `Irish Sea`
  - `Skagerrak/Kattegat` 与 `Bay of Biscay` 因没有同样干净的 grouped 候选，本轮延期
