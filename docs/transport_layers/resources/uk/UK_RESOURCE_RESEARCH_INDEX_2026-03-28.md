# 英国工业矿产、能源设施、工业区研究总览

日期：2026-03-28

## 1. 一句话结论

如果英国这三条线都按“官方/准官方优先、可直接承接仓库图层”的标准来筛，当前最适合先试点的是 `能源设施`；`工业矿产` 有强官方基础但全国统一性和几何形态不如日本整齐，`工业区` 则基本不存在全国统一的真实园区官方主层，必须明确降级。

## 2. 研究边界

本轮固定边界如下：

- `工业矿产` 只研究 `矿床 / 资源分布`
- `能源设施` 只研究 `点状设施`，不含输油、输气、输电等线状网络
- `工业区` 只研究 `真实园区 / 工业用地`，不先用规划工业分区替代
- 研究顺序固定为 `Tier A -> Tier B -> Tier C`
- 若无足够强的官方全国主源，必须明确写出缺口，而不是拿题不对的代理层补洞

## 3. 三条线总体成熟度判断

| 线别 | 总体成熟度 | 当前最强主锚点 | 全国统一性 | 几何与仓库承接 | 主要问题 | 结论 |
|---|---|---|---|---|---|---|
| 工业矿产 | 中 | BGS `Mineral resources` + MineralsUK / GSNI 矿产资源图系 | 中，英国全国要跨 Great Britain 与 Northern Ireland 拼接 | 官方强源偏 `面`，与既定点层假设有冲突 | 覆盖不完整、许可偏受限、不是日本那种单一全国点数据集 | 能研究，能做 GB 核心骨架，但若坚持 `UK 全国统一 + 点层 + 开放`，当前有缺口 |
| 能源设施 | 中上 | DESNZ `DUKES 5.11 Power stations in the United Kingdom, May 2025` | 高，至少发电设施锚点是 UK 统一 | `点`，最容易接现有 deferred context layer pack | “能源设施”语义大于“发电设施”；其他能源子类仍分裂 | 最适合先试点，但要把首版边界写死为 `以发电设施为主` |
| 工业区 | 低 | 无全国统一 Tier A 真实工业区主层 | 低 | 语义上应是 `面`，但全国主源缺位 | 官方层大多是规划、棕地、就业用地或地方分散数据；真实园区全国层缺口明显 | 不宜先承诺全国主层，必须降级或缩成地方试点 |

## 4. 哪条线最适合先试点

当前最适合英国先试点的是 `能源设施`。

原因很直接：

- 有真正 UK 口径的 Tier A 点数据，且坐标字段明确
- 更新时间比日本能源锚点更近，发电设施可以直接落点层
- `DUKES 5.11` 与 `REPD` 能形成“运营中 + 规划/建设中可再生项目”的双层研究结构
- 不需要先解决工业区那种“全国官方真空”问题

前提也必须写清：

- 首版锚点应被命名为 `能源设施（首版以发电设施为主）`
- 不能把炼油厂、LNG 接收站、天然气终端、储能、变电站等自动视为已经全国统一覆盖

## 5. 和日本最明显的差异

英国与日本最明显的不同，不是“没有数据”，而是 `官方数据的全国统一性明显更弱，且三条线分裂得更厉害`。

- 日本 `工业矿产` 有 GSJ 的全国点状资源分布锚点；英国最强官方矿产源反而是 BGS 的规划型资源范围面，且 Great Britain 与 Northern Ireland 仍分家
- 日本 `能源设施` 虽然也以发电设施为主，但官方产品语义更集中；英国的官方能源点源更实用、更近年，但“全能源设施总层”依然没有一次收口
- 日本 `工业区` 有国土数値情報 `L05 工業用地データ` 这种直接对题的全国官方面层；英国这一块最缺，官方强源多是规划代理或地方零散层

换句话说，日本更像“先有题对的全国官方产品，再讨论承接”；英国更像“先按专题分别拼最强官方链路，再决定哪些国家例外要接受缺口”。

## 6. 哪些地方必须降级到非官方但可信公开源

必须明确降级的地方主要是 `工业区`，其次是 `能源设施` 中除发电设施外的子类。

### 6.1 工业区

- 当前没有看到可直接充当 `英国全国真实工业园区 / 工业用地主层` 的 Tier A / Tier B 数据
- 规划数据如 London `Strategic Industrial Locations`、各地 `Employment Land`、England `Brownfield land` 都不是题目要求的真实工业区全国主层
- 因此若一定要做全国范围面层，只能降级到 Tier C 的 OSM `landuse=industrial` / `industrial=*` 体系，并明确它是协作式近似层，不是官方地籍或法定园区边界

### 6.2 能源设施中的非发电子类

- 发电设施可用 `DUKES 5.11` + `REPD`
- 但天然气终端、LNG 接收站、炼油厂等仍主要依赖 National Gas、企业/行业协会、专题政策附件等分散来源
- 这些来源可研究、可核点，但不应伪装成“一份统一的英国官方能源设施总库”

## 7. 与现有仓库架构的承接判断

按当前仓库方法论，英国三条线的承接判断应写成：

- `energy_facilities`：最适合照日本方法直接走 `独立 deferred context layer pack` + 点层懒加载
- `industrial_zones`：如果以后有可信范围面，应走 `polygon/context layer`；当前不建议先硬落主层
- `mineral_resources`：英国官方强源偏面，和方法论文档里默认的点层假设有冲突；不建议把 BGS 资源面简单图心点化来迁就架构

因此英国并不适合机械复制日本顺序。更稳的顺序应该是：

1. `energy_facilities`
2. `mineral_resources`
3. `industrial_zones`

## 8. 风险与下一步建议

### 8.1 当前主要风险

- 最容易犯的错，是把 `发电设施锚点` 说成 `能源设施全国总层`
- 第二个高风险点，是把 `规划工业地`、`棕地`、`就业地` 说成 `真实工业园区`
- 第三个高风险点，是为了保持跨国 schema 一致，把英国矿产资源范围面粗暴点化

### 8.2 下一步建议

1. 先把英国 `能源设施` 收敛成严格的发电设施主层研究稿，作为产品试点候选
2. 把英国 `工业矿产` 明确标成“官方强源存在，但 UK 全国统一点主层缺口仍在”，不要提前承诺能与日本完全同构
3. 把英国 `工业区` 明确分成两条路线：
   - 路线 A：承认当前无全国官方主层，只写缺口
   - 路线 B：若业务一定要试，可降级到 Tier C OSM 做研究样层，但不把它包装成官方层
4. 如果未来要做跨国统一产品规则，应允许英国在 `mineral_resources` 上保留 country exception，而不是逼所有国家都用点资源集

## 9. 本稿关键来源

- BGS `Mineral resources`：<https://www.bgs.ac.uk/datasets/bgs-mineral-resources/>
- MineralsUK Downloads：<https://www.bgs.ac.uk/mineralsuk/downloads/>
- BGS BritPits 2026 更新说明：<https://www.bgs.ac.uk/news/map-of-bgs-britpits-showing-the-distribution-of-worked-mineral-commodities-across-the-country/>
- DUKES electricity chapter：<https://www.gov.uk/government/statistics/electricity-chapter-5-digest-of-united-kingdom-energy-statistics-dukes>
- REPD quarterly extract：<https://www.gov.uk/government/publications/renewable-energy-planning-database-monthly-extract>
- Scotland `Energy Supply Point Locations - Scotland`：<https://www.data.gov.uk/dataset/9adbe287-fbe4-4db7-b158-255372da2f96/energy-supply-point-locations-scotland>
- Planning Data `Brownfield site`：<https://www.planning.data.gov.uk/dataset/brownfield-site>
- Planning Data `Brownfield land`：<https://www.planning.data.gov.uk/dataset/brownfield-land>
- Brent `Strategic Industrial Locations`：<https://www.data.gov.uk/dataset/329c0a2a-e83b-466d-84bc-5aeb6963b1d1/strategic-industrial-locations>
- Tamworth `Employment Land`：<https://www.data.gov.uk/dataset/46799a50-5f39-42be-9e20-256e9265591d/employment-land2020>
- Geofabrik United Kingdom extract：<https://download.geofabrik.de/europe/united-kingdom.html>
