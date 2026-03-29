# 英国工业区探索归档

日期：2026-03-28

## 1. 一句话结论

如果英国这条线要求的是 `真实园区 / 工业用地`，而不是“工业规划分区”或“棕地开发候选地”，那么当前没有看到可直接充当 `英国全国官方主层` 的 Tier A 数据；这条线必须先承认缺口，不能拿规划或棕地代理层冒充真实工业区。

## 2. 研究边界

本轮固定边界如下：

- 研究对象是 `真实工业园区 / 工业用地`
- 首版几何应是 `面`
- 不用规划工业分区直接替代真实工业区
- 不把 brownfield、employment land、招商目录、政策园区名单混成一层

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 / 时间口径 | 许可 / 使用边界 | Tier | 适合作为主源吗 | 判断 |
|---|---|---|---|---|---|---|---|
| Planning Data England [`Brownfield land`](https://www.planning.data.gov.uk/dataset/brownfield-land) | England | 面（GeoJSON / JSON / CSV） | Collector 2026-03-28；新数据至 2026-03-26 | 明确 OGL v3.0 | Tier A | `否` | 题目不对。它是可开发棕地注册，不是工业园区主层 |
| Planning Data England [`Brownfield site`](https://www.planning.data.gov.uk/dataset/brownfield-site) | England，但页面明确“不完整” | 面 | Collector 2026-03-28；新数据至 2025-12-19 | 明确 OGL v3.0 | Tier A | `否` | 仍是棕地边界实验库，不是工业区 |
| Brent / London [`Strategic Industrial Locations`](https://www.data.gov.uk/dataset/329c0a2a-e83b-466d-84bc-5aeb6963b1d1/strategic-industrial-locations) | Brent / London 局部 | 面（WMS / INSPIRE 服务） | data.gov.uk 页面 2016-02-10 更新；资源参考日期 2010-07-16 | Other Licence，附 PSMA / INSPIRE 约束 | Tier A | `否` | 它是规划指定工业地，不是全国真实园区层；只能当排除项示例 |
| Tamworth [`Employment Land`](https://www.data.gov.uk/dataset/46799a50-5f39-42be-9e20-256e9265591d/employment-land2020) | Tamworth 地方级 | 面（WMS / WFS） | 2020-11-13 | Other (Non-Commercial) | Tier A | `否` | 地方级、许可碎片化，而且语义是就业用地，不等于真实工业园区 |
| OSM / Geofabrik [`United Kingdom extract`](https://download.geofabrik.de/europe/united-kingdom.html) | UK | 面 / 点 / 线混合；可提取 `landuse=industrial` 等要素 | 近乎日更；页面示例为 2026-03-10 数据，2026-03-11 文件更新 | 明确 ODbL 1.0 | Tier C | `只能作降级后备` | 当前最可行的全国级真实工业用地近似层，但它是协作数据，不是官方主源 |

## 4. 为什么英国工业区必须先承认主源缺口

这条线不能靠“找个最像的官方面层”糊过去，因为几个最常见候选都不对题：

- `Brownfield land / Brownfield site`：语义是可开发的既有开发地，不是工业区
- `Strategic Industrial Locations`：语义是规划指定工业地，不是已形成的全国真实工业园区
- `Employment Land`：语义更宽，而且通常是地方级规划 / 用地管理数据

真正符合题目的，是“真实工业园区 / 工业用地范围面”。当前英国没有看到全国统一的 Tier A / Tier B 主层。

所以这条线最重要的研究结论不是“找到一个次优代理”，而是：

`当前全国官方真主层缺口明确存在。`

## 5. 英国主源 / 后备源 / 排除项

### 5.1 主源

- 当前无可接受的 `英国全国 Tier A / Tier B 真实工业区主源`

这是本专题必须保留的缺口结论，不能省略。

### 5.2 后备增强

- 若业务一定要做全国研究样层，可降级到 Tier C：
  - OSM / Geofabrik UK extract 中的 `landuse=industrial`、`industrial=*`、部分 `man_made=works`
- 若只做地方试点，可针对特定城市单独引用地方级 employment land / industrial estate 数据，但必须保留地方许可和语义差异说明

### 5.3 当前排除

- `Brownfield land` / `Brownfield site`
- London `Strategic Industrial Locations`
- 地方级 `Employment Land`
- 招商目录、企业园区名单、政策园区清单

## 6. 与日本相比最明显的不同

这条线与日本最明显的不同是：

`日本有题对的全国官方工业用地面层，英国没有。`

具体来说：

- 日本可以用 `L05 工業用地データ` 直接承接“真实工业园区 / 工业用地”
- 英国当前能找到的官方强源大多是规划、棕地、就业用地或地方碎片化数据
- 因此日本工业区能优先试点，英国工业区反而最不适合先落

这是英国与日本在三条线里差异最大的一条。

## 7. 与现有仓库架构的承接判断

如果以后英国工业区真的要做，这条线仍然应该走：

- `industrial_zones` 独立 deferred context layer pack
- `polygon/context layer` 渲染模式
- 面对象承载 `name`、`zone_type`、`coastal_inland`、`operator`

但当前阶段更重要的承接判断是：

- 不要为了照顾架构而先塞一个题不对的官方代理层
- 也不要为了全国覆盖而直接宣称 OSM 就是正式主源
- 这条线在英国应先停留在研究层，或退到局部地方试点层

## 8. 风险与下一步建议

### 8.1 当前主要风险

- 把棕地、规划工业地、就业地误说成真实工业区
- 因为想做全国层，就把 OSM 协作面层包装成“官方工业园区数据”
- 为了尽快承接仓库图层，牺牲题目语义

### 8.2 下一步建议

1. 把这条线明确标注为 `全国官方主层缺口`
2. 如果业务接受 Tier C 研究层，可单独立项评估 OSM `landuse=industrial` 的噪声、缺口和边界质量
3. 如果业务坚持官方源，建议把英国工业区从首批产品候选中移除，不先落主层
4. 若后续要做地方试点，应按城市 / council 单独核许可与语义，不做全国统一承诺

## 9. 本稿关键来源

- Planning Data `Brownfield land`：<https://www.planning.data.gov.uk/dataset/brownfield-land>
- Planning Data `Brownfield site`：<https://www.planning.data.gov.uk/dataset/brownfield-site>
- Brent `Strategic Industrial Locations`：<https://www.data.gov.uk/dataset/329c0a2a-e83b-466d-84bc-5aeb6963b1d1/strategic-industrial-locations>
- Tamworth `Employment Land`：<https://www.data.gov.uk/dataset/46799a50-5f39-42be-9e20-256e9265591d/employment-land2020>
- Geofabrik United Kingdom extract：<https://download.geofabrik.de/europe/united-kingdom.html>
