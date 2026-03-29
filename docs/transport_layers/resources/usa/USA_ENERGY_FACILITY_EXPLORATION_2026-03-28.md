# 美国能源设施研究草稿

日期：2026-03-28

## 一句话结论

美国 `能源设施` 这条线最强的官方落点其实是 `发电设施`：EIA-860 已足够支撑全国点层；但如果名称仍然叫 `energy_facilities`，就必须明确写出“炼厂、LNG 等子类只有分散官方源，没有一张联邦统一主层”。

## 研究边界

- 研究对象是 `点状能源设施`
- 不研究输电网、油气管线、成品油管线、天然气管网
- 首版优先保证全国统一口径
- 接受“主层以 power plants 为主，其他子类按是否有稳定官方源再扩”

## 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [EIA-860 / Annual Electric Generator Report](https://www.eia.gov/electricity/data/eia860/) | 全美发电厂与机组，含现役、计划、退役状态字段 | 点 | 页面显示 `Release Date: September 9, 2025`，对应 2024 年数据 | EIA 为联邦机构，公开数据可研究与再利用；但应按表结构使用，不要把 plant 与 generator 级字段混用 | Tier A | 是，但准确说应作为 `发电设施主源` | 这是美国最强、最新、最全国统一的能源设施官方点源 |
| [EIA Refinery Capacity Report](https://www.eia.gov/petroleum/refinerycapacity/) | 全美炼厂 | 点位可由单厂记录稳定映射，报告本体以表为主 | 页面显示 `June 20, 2025`，统计口径 `as of January 1, 2025` | 联邦公开资料，可用于研究与目录；但它不是现成统一 GIS 面层，首版更适合作为炼厂子类补充源 | Tier A | 不能单独当整个 energy 主源 | 对炼厂子类很强，但只覆盖炼厂，不解决全能源设施收口 |
| [FERC LNG facilities](https://www.ferc.gov/industries-data/natural-gas/liquefied-natural-gas) | 现役、在建、获批等 LNG 终端项目 | 点/项目目录 | 页面更新时间 `April 22, 2025` | 更像监管目录与项目图，而不是标准化全国 GIS 主层；适合做 LNG 子类研究，不适合直接充当总层 | Tier A | 只能做子类后备源 | 官方权威，但粒度和发布形态更接近监管清单 |
| [DOE LNG export applications summary](https://www.energy.gov/fecm/articles/summary-lng-export-applications-lower-48-states) | 美国本土 LNG 出口申请与状态 | 点/项目目录 | 页面更新时间 `March 4, 2026` | 适合核对项目状态，不适合直接当统一 GIS 主层 | Tier A | 否 | 适合补充 FERC，不能替代全国能源设施主源 |
| [EIA maps / U.S. Energy Atlas](https://www.eia.gov/maps/) | 多种能源设施地图入口，包括 power plants、refining、processing、LNG 等 | 点/线/面混合 | 持续更新，页面未给统一单次发布日期 | 联邦地图入口，可用于核对位置和发现子类源；但它更像分发界面，不是单一 source of record | Tier A | 否 | 更适合当官方地图入口和核点工具，而不是数据治理主表 |

## 主源 / 后备源 / 排除项

### 主源

- 如果首版允许明确写成 `以发电设施为主`，那主源就是 `EIA-860`

### 后备源

- 炼厂：`EIA Refinery Capacity Report`
- LNG：`FERC LNG` 与 `DOE LNG export applications summary`
- 位置核对：`EIA maps / U.S. Energy Atlas`
- Tier B 本轮没有出现能取代 EIA Tier A 主体判断的全国统一候选

### 明确缺口结论

- 美国当前没有一张联邦统一、开放、点状、跨发电/炼厂/LNG/油库/变电站等多子类的 `energy_facilities` 主层。
- 所以这条线要么首版收窄成 `power_plants-first`，要么就必须接受“总层有缺口、子类分开建设”。

### 排除项

- 油气管线、输电线路、配电网络
- 用排放点、公司地址或工业设施 POI 反推能源设施总层
- 用单一行业目录冒充“全能源设施统一主层”

## 与现有仓库架构的承接判断

这条线仍然适合先走点图层。

- `EIA-860` 是天然的点设施数据，和现有点层承接几乎完全一致。
- 工程上应先把 `facility_subtype` 做成一级字段，至少区分 `power_plant`、`refinery`、`lng_terminal`。
- 但不要一开始就把不同官方子源强行压成一个“看似统一、实际口径混杂”的总表。

## 与日本最明显的不同

和日本相比，美国在发电设施这一支上明显更强，也更新得多。

- 日本现有可用主源偏旧，但主题集中，容易把“能源设施”先收敛成“发电设施”。
- 美国 `power plants` 官方数据更完整、更新，但一旦把范围放大到炼厂、LNG、处理设施，联邦层马上变成“强子类、弱总层”。
- 所以美国的难点不是发电设施本身，而是大类命名和边界控制。

## 风险与下一步建议

1. 最大风险是产品名字叫 `energy_facilities`，用户却自然理解成“已覆盖全部能源节点”。
2. 最短路径不是去拼一个虚假的大全层，而是：
   1. 先用 `EIA-860` 上线 `发电设施主层`
   2. 在文案里写清 `首版以发电设施为主`
   3. 再按子类分别研究炼厂与 LNG 是否值得进入二期
3. 如果坚持首版必须覆盖多子类，那也应采用“子类分表 + 统一样式字段”的方式，不应伪装成一张来源口径完全一致的联邦总层。
