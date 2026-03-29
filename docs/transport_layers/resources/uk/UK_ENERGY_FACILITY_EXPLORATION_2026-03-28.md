# 英国能源设施探索归档

日期：2026-03-28

## 1. 一句话结论

如果英国这条线要求先有一个 `UK 全国统一口径` 的点状能源设施锚点，那么 DESNZ 的 `Power stations in the United Kingdom, May 2025 (DUKES 5.11)` 已经足够构成首版主源；但它更准确地说是 `发电设施主锚点`，还不是“英国所有能源设施都已经被统一覆盖”。

## 2. 研究边界

本轮固定边界如下：

- 研究对象是 `点状能源设施`
- 不研究输油、输气、输电等线状网络
- 优先保证 `UK 全国统一口径`
- 首版允许主锚点以发电设施为主
- 炼油厂、LNG 接收站、天然气终端、储能、变电站等子类，只有在找到同等级全国主源后才单独扩层

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 / 时间口径 | 许可 / 使用边界 | Tier | 适合作为主源吗 | 判断 |
|---|---|---|---|---|---|---|---|
| DESNZ / GOV.UK [`Power stations in the United Kingdom, May 2025 (DUKES 5.11)`](https://www.gov.uk/government/statistics/electricity-chapter-5-digest-of-united-kingdom-energy-statistics-dukes) | UK | 点（表内含 `X-Coordinate`、`Y-Coordinate`） | 运营中电站，时点为 2025-05 末；页面 2025-07-31 更新 | GOV.UK 页面适用 OGL v3.0，除非附件另有说明 | Tier A | `是，但范围要写窄` | 当前最稳的 UK 统一点锚点，适合做 `发电设施主层` |
| DESNZ [`Renewable Energy Planning Database (REPD)`](https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract) | UK | 点（字段含 `X-coordinate`、`Y-coordinate`） | 季度更新；当前页面 2026-02-09 发布 Q4 2025 / Jan 2026 版本 | 页面明确 OGL v3.0 | Tier A | `仅作后备增强` | 适合补可再生项目的规划 / 在建 / 运营状态，但不是完整能源设施总表 |
| Scottish Government / data.gov.uk [`Energy Supply Point Locations - Scotland`](https://www.data.gov.uk/dataset/9adbe287-fbe4-4db7-b158-255372da2f96/energy-supply-point-locations-scotland) | Scotland | 点 | data.gov.uk 页面显示 2025-02-11 更新 | 页面为 OGL；但仅 Scotland，且是区域综合库 | Tier A | `不适合作为 UK 主源` | 可作 Scotland 区域增强与字段参考，不应替代 UK 主源 |
| National Gas [`Gas terminals`](https://www.nationalgas.com/our-businesses/gas-terminals) | Great Britain | 网页点名录，无现成 GIS | 页面正文写明“at the time of writing (June 2024)” | 企业网页，未见统一开放 GIS 许可 | Tier B | `否` | 适合确认 St Fergus、Bacton 及 LNG 入口节点的存在，但不构成统一数据层 |
| 官方 / 企业专题附件，如英国炼油与油品体系说明 | UK 或 Great Britain | 多为 PDF / 网页示意图 | 多为专题出版年份口径 | 复用边界不统一，多数不是直接 GIS 开放数据 | Tier B / C | `否` | 适合做核点或专题补充，不适合首版主层 |

## 4. 为什么 DUKES 5.11 可以当英国能源首锚点

它的优势不是“能源范围最全”，而是它满足了首版最关键的四件事：

- UK 口径统一
- 几何就是点
- 更新时间足够近
- 属性足够支撑产品字段映射

实际核对表结构后，`DUKES 5.11` 至少稳定承接：

- `name`
- `facility_subtype`（Technology / Type）
- `operator`（Company Name）
- `status`（运营中）
- `country / region`
- `x / y`

这比“从各类企业官网、行业协会名录、专题 PDF 地图拼接能源节点”稳得多。

## 5. 英国主源 / 后备源 / 排除项

### 5.1 主源

- DESNZ `DUKES 5.11 Power stations in the United Kingdom, May 2025`

### 5.2 后备增强

- DESNZ `REPD`：补充可再生能源项目的规划、在建、运营状态
- Scotland `Energy Supply Point Locations - Scotland`：供区域试点时做字段与覆盖比对
- National Gas 终端页面：仅用于天然气终端核点

### 5.3 当前排除

- 把企业官网、行业协会列表拼成全国能源设施总库
- 把管线、互联输送网络并进点状设施层
- 在没有同等级全国官方主源前，把炼油厂、LNG 接收站、终端、储能、变电站硬并进同一主层

## 6. 与日本相比最明显的不同

这条线与日本最明显的不同是：

`英国的官方发电设施锚点比日本更新、更像产品可用库，但“能源设施”这个总类同样没有被一次性官方收口。`

具体看：

- 日本主锚点也是发电设施，但时间口径更旧
- 英国 `DUKES 5.11` 已经是 2025 时点，且字段更产品化
- 但英国一旦想从“发电设施”扩到“能源设施总层”，仍会立刻掉回分散来源问题

所以英国能源线看起来比日本更容易先落地，但边界控制同样关键。

## 7. 与现有仓库架构的承接判断

这条线与仓库现有方法论是最对齐的。

推荐承接方式固定为：

- `energy_facilities` 独立 deferred context layer pack
- 点图层懒加载
- 首版产品命名明确为 `能源设施（首版以发电设施为主）`
- 以 `facility_subtype` 做前端筛选，不把所有能源子类默认塞进来

如果以后扩层，最稳方式也不是做一个“大能源总层”，而是：

1. 先把 `power_plants` 跑通
2. 再逐个判断 `refineries`、`gas_terminals`、`lng_terminals`、`storage_sites` 是否各自拥有足够稳的 UK 级数据源

## 8. 风险与下一步建议

### 8.1 当前主要风险

- 把 `DUKES 5.11` 误说成英国所有能源设施的全国总库
- 用 `REPD` 替代全能源主源，忽略它只覆盖可再生电力项目且含规划状态
- 为了“看起来更全”而把炼油厂、终端、储能、变电站混成一个未经验证的大层

### 8.2 下一步建议

1. 英国首批试点若只选一条，这条最值得先落
2. 先做 `DUKES 5.11` 主层研究，再用 `REPD` 评估是否要做可再生项目扩展层
3. 后续若要扩天然气终端、LNG、炼油厂，必须先逐子类单独做全国源核验
4. 在没有更多同等级源前，保持首版叙述严格收敛到 `发电设施主锚点`

## 9. 本稿关键来源

- DUKES electricity chapter：<https://www.gov.uk/government/statistics/electricity-chapter-5-digest-of-united-kingdom-energy-statistics-dukes>
- REPD quarterly extract：<https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract>
- Scotland `Energy Supply Point Locations - Scotland`：<https://www.data.gov.uk/dataset/9adbe287-fbe4-4db7-b158-255372da2f96/energy-supply-point-locations-scotland>
- National Gas `Gas terminals`：<https://www.nationalgas.com/our-businesses/gas-terminals>
