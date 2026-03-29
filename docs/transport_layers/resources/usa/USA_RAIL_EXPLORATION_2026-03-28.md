# 美国铁路专题研究归档

日期：2026-03-28

## 1. 一句话结论

如果美国铁路首版的目标仍然是 `铁路线 + 主要车站`，那么当前最稳的结论是 `官方主源 + OSM 补缺`：FRA/BTS 的 `NARN` 足够做全国主线骨架，但 `主要车站` 的全国统一官方口径只能先收敛到 `Amtrak-first`，而生命周期状态仍需要 OSM 补丁。

## 2. 研究边界

- 研究对象固定为：
  - 铁路线
  - 主要车站
- 不研究：
  - 时间轴
  - 班次
  - routing
  - 全量车站
  - 客货流量
  - 城市轨道全量站点体系

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [FRA/BTS `NTAD North American Rail Network (NARN)`](https://rosap.ntl.bts.gov/view/dot/53568) | 美国全国 | 线、节点 | NTAD 持续更新；BTS 2024-05-03 明确春季更新包含 `NARN Lines / Nodes` | 联邦公开数据，适合研究与产品评估；页面未见类似 ODbL 或非商用限制 | Tier A | 是 | 这是美国铁路主线最稳的官方全国骨架 |
| [BTS `Rail Network Spatial Dataset` 说明页](https://www.bts.gov/newsroom/rail-network-spatial-dataset) | 美国全国 | 线、节点 | 说明页 2016-05-13；解释 NARN 组成 | 官方说明页，不是独立数据源 | Tier A | 否 | 价值在于说明 NARN 由 FRA 检测网络与其他政府数据整合而成 |
| [BTS `Amtrak Stations 1996-Present`](https://rosap.ntl.bts.gov/view/dot/55181) | 美国全国 Amtrak 客运站 | 点 | BTS 2024-05-03 明确春季更新时采用 Amtrak 直供站点数据 | 联邦公开归档，可研究与产品评估 | Tier A | `部分适合` | 它适合做全国主要车站的首版锚点，但只覆盖 Amtrak 体系，不等于全部重要铁路站 |
| [BTS Spring 2024 NTAD Update](https://www.bts.gov/newsroom/bts-updates-datasets-national-transportation-atlas-database-spring-2024) | 美国全国 | 说明 | 2024-05-03 | 官方说明页 | Tier A | 否 | 关键价值是确认 `NARN` 和 `Amtrak stations` 都在较新的 NTAD 更新里被维护 |
| [OpenStreetMap / Geofabrik U.S.](https://download.geofabrik.de/north-america/us.html) | 美国全国 | 线、点 | 日更 | ODbL 1.0；发布派生数据库时需注意共享要求 | Tier C | `只能作补缺` | 适合补 `disused / abandoned / construction`，不应覆盖官方现役主网 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 线路主源：`FRA/BTS NARN`
- 主要车站主源：`Amtrak Stations`

这套组合不是“美国铁路完全和日本一样整齐”，而是当前最稳的全国官方口径。

### 4.2 后备源

- `BTS Spring 2024 NTAD Update`
  - 用途：确认当前 NARN 和 Amtrak stations 仍在更新链条内
- `OpenStreetMap / Geofabrik`
  - 用途：只补生命周期状态和官方明显缺失的边缘段

### 4.3 排除项

- 全量地铁、通勤铁路、轻轨车站系统
- 各州或各城自己的轨道站点库直接拼成全国主要车站层
- 企业货站、编组场、工业支线 POI

## 5. 与现有仓库架构的承接判断

美国铁路仍然适合走：

- `railways` 线 pack
- `rail_stations` 点 pack
- 独立 deferred context layer pack

但和日本相比，车站层必须更保守：

- 首版主要车站建议只收 `Amtrak-first`
- 如后续要扩大到 commuter rail / heavy rail / regional rail，应该单独扩专题，不要在首版里硬揉成全国统一主层

## 6. 与日本最明显的不同

美国和日本在铁路上的最大差异，不在线路，而在车站。

- 日本是 `官方主线 + 官方站点` 更整齐。
- 美国是 `官方主线很强`，但 `官方主要车站` 只能先收敛到 Amtrak 体系。
- 日本生命周期状态补丁主要是官方没有的废线、停用线。
- 美国则更明显需要 OSM 来补 `disused / abandoned / construction` 这些非现役状态。

## 7. 风险与下一步建议

1. 最大风险是把 `Amtrak stations` 误写成“美国全国重要铁路站点全集”。
2. 第二个风险是把 OSM 提升为与 FRA/BTS 并列的双主源，这会把官方主网边界弄乱。
3. 首版建议顺序：
   1. 用 `NARN` 固定全国主线骨架
   2. 用 `Amtrak stations` 先做主要车站锚点
   3. 只在生命周期状态上引入 OSM 补丁
4. 如果以后要扩到更完整的客运站层，应单独评估各通勤铁路与城市轨道的全国统一性，而不是现在直接假设有一张现成主表。

## 8. 关键来源列表

- [FRA/BTS NARN 数据集](https://rosap.ntl.bts.gov/view/dot/53568)
- [BTS Rail Network Spatial Dataset 说明](https://www.bts.gov/newsroom/rail-network-spatial-dataset)
- [BTS Amtrak Stations 数据集](https://rosap.ntl.bts.gov/view/dot/55181)
- [BTS Spring 2024 NTAD Update](https://www.bts.gov/newsroom/bts-updates-datasets-national-transportation-atlas-database-spring-2024)
- [OpenStreetMap / Geofabrik U.S.](https://download.geofabrik.de/north-america/us.html)
