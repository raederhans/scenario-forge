# 美国机场专题研究归档

日期：2026-03-28

## 1. 一句话结论

美国机场这条线是四条交通线里最干净的一条：FAA 的 `NASR / Airport Data` 已经足够做全国机场官方点位主源，`FAA Passenger Boarding` 又能直接支撑主要公共机场筛选，首版没有必要退回到 OSM。

## 2. 研究边界

- 只研究 `设施本体`
- 固定为 `点图层优先`
- 固定优先收：
  - 主要公共/民航机场
- 不研究：
  - 航线
  - 机场范围面
  - 军用专题设施
  - 直升机场专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [FAA `28 Day NASR Subscription`](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/) | 美国及领地 | 点（CSV 等） | 当前有效期 `2026-03-19`，预告下一期 `2026-04-16` | 联邦公开航空数据入口，适合研究与产品评估；落地前仍按 FAA 页面条款复核 | Tier A | 是 | 这是当前最现势、最稳定的全国机场点位源 |
| [FAA `Airport Data`](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/Airport_Data/) | 美国及领地 | 点 | 页面最后修改 `2026-02-09` | 官方查询入口，不是批量 GIS 包，但能做权威核对 | Tier A | 否，偏核对层 | 适合逐机场核对属性和状态 |
| [NTAD `Aviation Facilities 1995-Present`](https://rosap.ntl.bts.gov/view/dot/54907) | 美国及领地 | 点 | NTAD 持续更新；数据集为 1995-present | 联邦公开归档，可研究与产品评估 | Tier A | 是，偏工程化主源 | 这是 FAA 机场设施数据的全国 GIS 包装，工程上最容易直接承接 |
| [FAA Passenger Boarding / All-Cargo Data](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/collection) | 美国公共机场 | 无几何，表 | 页面说明：`2025` 年初步数据 2026-06 发布，最终数据 2026-08 发布 | 官方统计入口，可研究与筛选，不是空间主几何 | Tier A | 否，重要度筛选层 | 最适合定义“主要公共机场” |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 空间主源：`FAA NASR / NTAD Aviation Facilities`
- 重要度筛选：`FAA Passenger Boarding`

这条线的结论非常直接：

- `官方点位主源成立`
- `官方名录 + 官方统计就足够首版`
- `OSM 不必进入主链路`

### 4.2 后备源

- `FAA Airport Data`
  - 用途：个别机场属性核对

### 4.3 排除项

- 航线数据
- 机场边界面
- 纯私用机场名录
- 军用机场专题化

## 5. 与现有仓库架构的承接判断

美国机场和日本机场一样，都非常适合：

- `airports` 独立 deferred context pack
- 点图层承接
- 重要度筛选
- 项目保存与恢复

美国比日本更进一步的地方是：

- 官方更新更勤
- 官方重要度筛选也更清楚

## 6. 与日本最明显的不同

美国和日本在机场上的主要差异，是 `美国机场数据更新频率更高，重要度筛选更容易标准化`。

- 日本机场主源也很强，但数据年度更固定。
- 美国可以直接基于 FAA 的 28 天节奏拿到更新点位。
- 日本主要公共机场的筛选更像靠设施类型与人工判断。
- 美国则可以直接借助 FAA 旅客登机数据定义“主要机场”。

## 7. 风险与下一步建议

1. 最大风险不是缺源，而是把“所有官方 operational aerodromes”直接等同于“主要公共机场”。
2. 首版应明确做两步：
   1. 用 `NASR / NTAD Aviation Facilities` 定全国点位
   2. 用 `Passenger Boarding` 定主要机场范围
3. 如果后续要扩到更完整机场层，可以再单独研究：
   - 私用机场
   - 军民合用机场
   - 机场面几何
4. 但在当前首版研究里，没有必要把边界做复杂。

## 8. 关键来源列表

- [FAA 28 Day NASR Subscription](https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/NASR_Subscription/)
- [FAA Airport Data](https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/Airport_Data/)
- [NTAD Aviation Facilities 数据集](https://rosap.ntl.bts.gov/view/dot/54907)
- [FAA Passenger Boarding / All-Cargo Data](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/collection)
