# 德国公路专题研究归档

日期：2026-03-28

## 1. 一句话结论

德国公路这条线最清晰，当前可以直接按 `官方主源可用` 来做：全国级官方开放几何主源可用，适合支撑 `motorway / trunk / primary` 的上下文公路层；如果后续想做更细的编号、匝道和导航级连通性，再单独补 `OSM` 或更细官方受限产品。

## 2. 研究边界

- 只研究 `最新快照`
- 只研究 `motorway / trunk / primary`
- 不研究历史回溯
- 不研究 routing、匝道体系、收费、交通流量和复杂节点
- 不研究 `secondary` 及以下道路

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [BKG Open Data / DLM250](https://www.bkg.bund.de/DE/Produkte-und-Dienste/GDZ/OpenData/OpenData.html) | 德国全国 | 线 | BKG 公开说明为持续维护的全国开源基础地理数据；DLM250 为 1:250,000 级别 | BKG 开源数据，适用 `Datenlizenz Deutschland – Namensnennung – Version 2.0` | Tier A | 是 | 对当前项目这种全国上下文道路层来说已经足够稳，是最适合的官方全国几何主源 |
| [BKG 产品目录 / 基础地理产品体系](https://www.bkg.bund.de/SharedDocs/Downloads/BKG/DE/Publikationen/Downloads-DE-Flyer/BKG-Produktkatalog-Bund.pdf?__blob=publicationFile&v=51) | 德国全国 | 线 | 持续维护 | 产品体系包含更细基础模型，但公开层级与使用边界需要区分 | Tier A | 否，更多是佐证 | 说明德国道路官方基础地理体系完整，但对当前公开可直接用的主层，仍以 `DLM250` 最稳 |
| [Geofabrik Germany / OpenStreetMap](https://download.geofabrik.de/europe/germany.html) | 德国全国 | 线 | 频繁更新 | ODbL；衍生使用需遵守 OSM 规则 | Tier C | 是，但只适合补充属性和细分类 | 如果后续要补 `ref`、更细等级或更接近导航级表达，OSM 是现实补充，但不需要在首版抢主位 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `BKG DLM250`

当前最稳的做法是直接把德国公路定义成“全国主干道路上下文层”，而不是“精细路由网”。在这个定义下，`DLM250` 已经满足：

- 全国覆盖
- 官方开放
- 能稳定承接主干道路骨架

### 4.2 后备源

- `OSM / Geofabrik Germany`：只在需要更细 `ref`、更接近 `motorway / trunk / primary` 业务级分类，或需要补官方泛化层细节时使用

### 4.3 排除项

- routing 数据
- 匝道、收费站、服务区等复杂节点体系
- `secondary` 及以下道路
- 把受限或更细官方产品误写成已经公开可直接产品化的全国主源

## 5. 与现有仓库架构的承接判断

德国公路可以直接复用日本公路方案：

- 产物形态仍是 `roads` 线包
- 默认只承接 `motorway / trunk / primary`
- 继续走 `deferred context pack`，不进主拓扑，不进 scenario chunk

最稳的实现口径是：

- `motorway`：优先映射 Autobahn
- `trunk / primary`：按德国官方主干道路层级做稳定映射，必要时在构建期再用 OSM 做细分校正

## 6. 与日本最明显的不同

日本公路试点更自然地落在 `OSM 主几何 + 官方高速加固` 这种组合上；德国则更适合先用官方基础地理产品起骨架。

- 日本更像“官方专题高速层很有价值，但全国主干路整体还是 OSM 更顺手”
- 德国更像“官方全国开放道路骨架已经够稳，OSM 只在想做得更细时才需要补”

## 7. 风险与下一步建议

### 7.1 风险

1. `DLM250` 的尺度决定了它不适合被包装成导航级公路网。
2. 如果团队后续把目标偷换成“编号、连通性、匝道都要完整”，那当前研究结论就必须重新分层，不能继续只靠 `DLM250`。
3. 德国道路官方体系完整，不等于公开层就自动适配所有业务粒度。

### 7.2 下一步建议

1. 首版德国公路直接以 `DLM250` 跑通全国主干道路层。
2. 只有在出现明确的编号、分类、线位精度需求时，再单独补 `OSM`。
3. 文档和产品描述里始终写清楚：这是“主干公路上下文层”，不是导航或工程级路网。

## 8. 关键来源列表

- Tier A: [BKG Open Data](https://www.bkg.bund.de/DE/Produkte-und-Dienste/GDZ/OpenData/OpenData.html)
- Tier A: [BKG 产品目录](https://www.bkg.bund.de/SharedDocs/Downloads/BKG/DE/Publikationen/Downloads-DE-Flyer/BKG-Produktkatalog-Bund.pdf?__blob=publicationFile&v=51)
- Tier C: [Geofabrik Germany](https://download.geofabrik.de/europe/germany.html)
