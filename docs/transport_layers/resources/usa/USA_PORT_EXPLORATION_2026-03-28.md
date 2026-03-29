# 美国港口专题研究归档

日期：2026-03-28

## 1. 一句话结论

如果美国港口首版只研究 `主要商港/关键港口节点` 且坚持 `点图层优先`，那么官方主源是成立的：BTS/USACE 的 `NTAD Principal Ports` 足够做主要商港节点层，但它不等于完整港区、港口设施体系或全部港口名录。

## 2. 研究边界

- 只研究 `设施本体`
- 固定为 `点图层优先`
- 固定优先收：
  - 主要商港
  - 关键港口节点
- 不研究：
  - 航路
  - 港域界
  - 港湾区域线
  - 渔港专题
  - 码头/泊位级设施全量图层

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [NTAD `Principal Ports 2013-Present`](https://rosap.ntl.bts.gov/view/dot/56578) | 美国全国主要商港 | 点 | 2013-present；BTS 2026 交通地图仍按 `2023 tonnage` 定 principal ports | 联邦公开归档，可研究与产品评估 | Tier A | 是 | 这是美国主要商港节点层最稳的官方主源 |
| [BTS `Transportation Geography of the U.S. 2026`](https://www.bts.gov/geography/geospatial-2/transportation-geography-united-states-2026) | 美国全国 | 说明 | 2026 版地图说明 | 官方说明页 | Tier A | 否 | 价值在于确认当前 BTS 仍以 `2023 tonnage` 口径展示 principal ports 与 major airports |
| [USACE `Ports and Port Stat Areas - Process Description`](https://www.iwr.usace.army.mil/Media/News-Stories/Article/3994727/ports-and-port-stat-areas-process-description/) | 美国全国统计港口边界 | 面 | 2024-12-11 | 官方说明页，偏边界与统计说明 | Tier A | 否，偏增强层 | 适合解释港口边界和统计口径，不适合替代首版点层 |
| [USACE `WCSC Navigation Infrastructure`](https://www.iwr.usace.army.mil/About/Technical-Centers/WCSC-Waterborne-Commerce-Statistics-Center/WCSC-Navigation-Infrastructure/) | 美国全国港口与航运设施 | 点、线、面混合 | 当前在线说明 | 官方说明入口 | Tier A | `部分适合` | 它证明官方还有更细设施库，但对象层级更复杂，首版不应直接把它全部并入 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `NTAD Principal Ports 2013-Present`

这条线必须写清：

- 主源成立的是 `主要商港节点层`
- 不是 `全部港口`
- 更不是 `完整港区/泊位/码头设施系统`

### 4.2 后备源

- `USACE Port and Port Statistical Areas`
  - 用途：如果以后需要多边形港区统计边界
- `USACE WCSC Navigation Infrastructure`
  - 用途：如果以后要扩到码头、设施、港区更细对象

### 4.3 排除项

- 航路
- 港区边界全量首版
- 码头/泊位级设施一次性并入
- 把 `Principal Ports` 误说成“美国全国全部港口官方名录”

## 5. 与现有仓库架构的承接判断

美国港口首版很适合：

- `ports` 独立 deferred context pack
- 点图层承接
- 主要节点优先

但产品命名必须更克制：

- 最稳的写法是 `主要商港节点层`
- 不要直接写成“美国港口全量图层”

## 6. 与日本最明显的不同

美国和日本在港口上的最大差异，是 `美国更适合先做“主要商港点层”，而日本更像“旧但更接近全国港湾分类层”`。

- 日本港口源更容易带出分类口径碎、数据旧、非商用风险。
- 美国 `Principal Ports` 在“主要商港点层”这个目标上更清楚。
- 但美国这条线天然收得更窄，只对 `principal ports` 特别强。

## 7. 风险与下一步建议

1. 最大风险是把 `Principal Ports` 当成港口全量主层。
2. 第二个风险是把统计港口边界、港口点、码头设施库混成一个层。
3. 首版建议：
   1. 明确只做 `主要商港节点层`
   2. 用 `Principal Ports` 做官方主点层
   3. 把 `Port and Port Statistical Areas` 保留为未来边界增强层
   4. 把 `WCSC Navigation Infrastructure` 保留为未来更细设施层
4. 如果后续必须做更完整港口体系，应单独立项，不要在当前首版里偷偷扩边界。

## 8. 关键来源列表

- [NTAD Principal Ports 数据集](https://rosap.ntl.bts.gov/view/dot/56578)
- [BTS Transportation Geography of the U.S. 2026](https://www.bts.gov/geography/geospatial-2/transportation-geography-united-states-2026)
- [USACE Ports and Port Stat Areas 说明](https://www.iwr.usace.army.mil/Media/News-Stories/Article/3994727/ports-and-port-stat-areas-process-description/)
- [USACE WCSC Navigation Infrastructure](https://www.iwr.usace.army.mil/About/Technical-Centers/WCSC-Waterborne-Commerce-Statistics-Center/WCSC-Navigation-Infrastructure/)
