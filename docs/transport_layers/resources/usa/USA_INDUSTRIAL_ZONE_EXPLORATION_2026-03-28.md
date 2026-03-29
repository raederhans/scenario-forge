# 美国产业工业区研究草稿

日期：2026-03-28

## 一句话结论

美国这条 `工业区` 线当前没有可接受的全国统一官方主源；联邦级公开数据大多只能提供土地覆被、就业密度或其他代理指标，所以首版要么明确写“官方主源缺失”，要么就只能降级到 Tier C 的可信公开协作面源做 provisional geometry。

## 研究边界

- 研究对象是 `真实工业园区 / 工业用地 / industrial land`
- 首版几何必须是 `面`
- 不用规划工业分区、土地用途分区、统计代理区替代真实工业区
- 不把单个工厂 POI、企业地址、招商园区名录直接当工业区面

## 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Annual NLCD / MRLC](https://www.mrlc.gov/data) | 全美土地覆被 | 栅格 | 现行年度产品已覆盖到 2024 | MRLC / USGS 联邦公开数据，可研究与再利用 | Tier A | 否 | 它能表达开发强度，但不能稳定分出“真实工业园区/工业用地”；而且 `Developed, High Intensity` 也不是工业专类 |
| [EPA Smart Location Database](https://www.epa.gov/smartgrowth/smart-location-mapping) | 全美普查街区组属性 | 面，但本体是统计单元 | 页面更新时间 `2021-05-11` | EPA 公开研究资料，可研究与派生分析 | Tier A | 否 | 这是可达性、就业和建成环境指标库，不是真实工业园区边界层 |
| [OpenStreetMap / Geofabrik U.S. extract](https://download.geofabrik.de/north-america/us.html) | 全美，社区协作覆盖 | 面/点混合 | Geofabrik 提示 `OpenStreetMap data updated daily` | ODbL 1.0；如果发布派生数据库需遵守共享相同方式等要求 | Tier C | 只能做后备，不应当官方主源 | 它是当前最现实的全国统一开放工业用地几何后备，但语义一致性和命名质量不够官方 |

## 主源 / 后备源 / 排除项

### 主源

- `无可接受的全国统一主源`

这是这条线最重要的研究结论，必须直接写出来，不能回避。

### 后备源

- 全国统一 provisional geometry：`OpenStreetMap / Geofabrik` 的工业用地与工业园区相关对象
- 试点核对：具体州、市、港区或地方开发机构公开园区边界和园区名录
- Tier B 本轮没有找到全国统一、贴题、可直接落成工业区面的可信主候选

### 排除项

- `NLCD` 这类土地覆被产品
- `EPA Smart Location Database` 这类统计代理层
- zoning / land use planning layers
- 企业地址、工厂 POI、招商网页园区名录

## 与现有仓库架构的承接判断

这条线必须走 polygon/context layer，不能点化。

- 工业区的产品价值在范围，而不是中心点。
- 如果先用点凑，会把“真实工业用地”做成“工业地标”，语义直接错位。
- 如果后续真要落这条线，最稳的工程方式是：
  - 把 `industrial_zones` 作为独立 polygon layer pack
  - 允许首版只在若干试点州或都市圈验证
  - 把 `provenance_tier`、`geometry_source`、`name_verified` 这类字段预留出来，方便后续替换 provisional geometry

## 与日本最明显的不同

这条线是美国和日本差异最大的地方。

- 日本至少有 `真实工业用地` 取向的全国官方层可作为主源，即使数据较旧也仍然贴题。
- 美国联邦公开层在这一题上更多给的是代理指标，而不是工业园区本体。
- 所以日本的问题更像“旧但准”，美国的问题更像“新但不对题”。

## 风险与下一步建议

1. 最大风险是为了赶进度，用 NLCD、就业密度或 zoning 代理偷偷替代真实工业区。
2. 如果必须先做一版，可接受的最小诚实方案只有两种：
   1. 先只交研究结论，不上线全国工业区图层
   2. 或者明确标注 `Tier C provisional geometry`，只把 OSM 当临时全国底图
3. 真正可落地的推进方式应是：
   1. 先选 2 到 4 个工业州做试点
   2. 用地方官方园区边界核对 OSM 面
   3. 确认命名、边界、园区类型的最小规则
   4. 再决定要不要逐州扩展
