# 中国能源设施专题研究归档

日期：2026-03-28

## 1. 一句话结论

中国能源设施可以研究，但这条线必须明显拆成 `mainland` 与 `Taiwan` 两种主源策略：`mainland` 缺少顺手的全国官方点位主源，现实上更像 `官方统计/行业口径 + Tier C 公开电厂追踪器`；`Taiwan` 则可以直接建立在台电官方电厂列表和电网分布图上。因此整条线最稳的结论是 `中国整体的一体化官方点位主源缺口成立，但 Taiwan 官方点位主源可用`。

## 2. 研究边界

- 只研究 `点状设施`
- 不研究输油、输气、输电管线
- 优先覆盖发电设施及其他可明确落点的能源设施
- 本文默认同时比较 `mainland` 与 `Taiwan`

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [国家能源局发布2025年1-3月份全国电力工业统计数据](https://www.nea.gov.cn/20250420/ea90b16331c446a1bad218c4b3c0df7d/c.html) | mainland 全国 | 无几何，统计 | 2025-04-20 发布 | 官方统计，可做口径锚点，不是点位主源 | Tier A | 否 | 这是 mainland 最稳的官方统计锚点，但不能直接落盘为设施点层 |
| [Global Energy Monitor 全球煤电厂追踪器](https://globalenergymonitor.org/zh-CN/projects/global-coal-plant-tracker/) | mainland 全国重点电厂 | 点 | 页面持续更新 | 公开项目数据库，需明确 Tier C 降级使用 | Tier C | 是，但只在 mainland 降级情况下成立 | 当 mainland 全国官方点位主源缺失时，这是最现实的点位补缺主轴之一 |
| [台電經營概況 / 台電電廠及電網系統分布圖](https://service.taipower.com.tw/csr/sustainability/intro) | Taiwan 全域 | 点与系统图 | 页面持续更新 | 官方企业公开资料 | Tier B | 是 | 这是 Taiwan 最贴题的电厂点位和系统分布主源 |
| [台電系統電廠及電網分布圖－電廠列表](https://www.taipower.com.tw/2289/59899/59902/) | Taiwan 全域 | 点、名录 | 页面持续更新 | 官方企业公开列表 | Tier B | 是 | 适合作为 Taiwan 电厂清单和主要设施列表 |
| [再生能源發展概況](https://www.taipower.com.tw/2289/2363/2380/2383/) | Taiwan 全域 | 分布图、统计 | 页面持续更新 | 官方企业公开资料 | Tier B | 否，作后备增强 | 适合补充再生能源与储能口径，不是唯一主表 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `mainland`：官方统计主锚点存在，但全国官方点位主源缺口成立
- `Taiwan`：以台电电厂列表和系统分布图为主源

### 4.2 后备源

- `mainland`：`Global Energy Monitor` 及运营方公开资料，用于补点位和项目级对象
- `Taiwan`：`再生能源發展概況` 用于补再生能源与储能口径

### 4.3 排除项

- 油气管线
- 输电线路
- 纯统计而无设施对象的能源消费数据
- 把所有能源项目都强行揉成一张全国官方主表

## 5. 与现有仓库架构的承接判断

这条线仍适合承接为 `energy_facilities` 点层，但中国包需要明确“同一图层、不同子区域主源不同”：

- `mainland`：点层构建更依赖 Tier C 公开项目库与运营方目录
- `Taiwan`：可以用官方列表直接支撑主要电厂点层
- 首版最稳的对象仍然是 `发电设施`，不要把油库、LNG、炼厂一并塞入主层

## 6. 与日本最明显的不同

日本能源试点更像“全国较旧但题对的发电设施锚点”；中国则更明显地分裂成两套：

- `mainland`：官方统计强，官方点位弱
- `Taiwan`：官方点位和名单都更直接

所以中国能源层不是单纯“比日本弱”或“比日本强”，而是跨区不对称更强。

## 7. 风险与下一步建议

1. 最大风险是把 `mainland` 的能源统计误写成“全国官方能源设施点层”。
2. 第二个风险是因为 `Taiwan` 官方电厂列表较清楚，就误以为整个中国包都能按同一标准落地。
3. 如果后续业务要求覆盖私营新能源、储能、电网侧设施，`mainland` 将更依赖 Tier C 项目库和地方公开目录。
4. 建议首版先把中国能源层收敛成 `发电设施`，并在文档里明确写：`mainland` 为“官方统计 + Tier C 点位补全”，`Taiwan` 为“官方点位主源可用”。 

## 8. 关键来源列表

- Tier A: [国家能源局发布2025年1-3月份全国电力工业统计数据](https://www.nea.gov.cn/20250420/ea90b16331c446a1bad218c4b3c0df7d/c.html)
- Tier C: [Global Energy Monitor 全球煤电厂追踪器](https://globalenergymonitor.org/zh-CN/projects/global-coal-plant-tracker/)
- Tier B: [台電經營概況 / 台電電廠及電網系統分布圖](https://service.taipower.com.tw/csr/sustainability/intro)
- Tier B: [台電系統電廠及電網分布圖－電廠列表](https://www.taipower.com.tw/2289/59899/59902/)
- Tier B: [再生能源發展概況](https://www.taipower.com.tw/2289/2363/2380/2383/)
