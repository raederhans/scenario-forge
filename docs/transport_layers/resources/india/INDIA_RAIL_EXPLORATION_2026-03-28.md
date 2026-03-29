# 印度铁路专题研究归档

日期：2026-03-28

## 1. 一句话结论

印度铁路这条线当前最稳的判断是 `OSM 主几何 + 官方属性加固`：官方全国主要车站和车站分类资料能拿到，但全国公开铁路线路主几何明显弱于日本，首版更适合让 `OSM / Geofabrik India` 承担线几何主源。

## 2. 研究边界

- 只研究 `铁路线 + 主要车站`
- 不研究时间轴
- 不研究班次、routing、运行图和容量
- 不研究全量小站和站场细部

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [RailwayStation | OGD India](https://www.data.gov.in/resource/railwaystation) | 印度全国 | 点 | 发布/更新均显示 2021-12-07 | Government Open Data License - India | Tier A | 适合作为站点骨架 | 官方全国站点源可用，但不解决全国线几何 |
| [List of Zone/Category wise Railway station opened for Passenger services in Indian Railway](https://indianrailways.gov.in/Railway_station_zone-category_wise_list.pdf) | 印度全国客运站 | 点、分类名录 | 文档口径为 2022-12-01 | 官方 PDF，复用边界需按站点网站条款理解 | Tier A | 适合作为主要车站筛选和重要度主源 | 对“主要车站”口径很关键，但它不是线路主几何 |
| [Railway Map of India 2023](https://nr.indianrailways.gov.in/uploads/files/1689335330175-IR%20MAP%202023.pdf) | 印度全国 | 线，总图 | 2023 版地图 | 官方总图，适合作参考核对，不是开放 GIS 线主源 | Tier A | 不适合作为产品主几何 | 能证明全国骨架存在，但不适合作为可直接构建的线包 |
| [Indian Railways Time Table | OGD India](https://www.data.gov.in/resource/indian-railways-time-table-trains-available-reservation-03082015) | 印度全国 | 车次-站点关系，无独立线几何 | 数据页面仍为旧版 | Government Open Data License - India | Tier A | 不适合作为几何主源 | 更适合作官方属性和站点关系补充 |
| [OpenStreetMap / Geofabrik India](https://download.geofabrik.de/asia/india.html) | 印度全国 | 线、点 | 频繁更新 | ODbL | Tier C | 是 | 当前最现实的全国线几何主源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 线几何主源：`OSM / Geofabrik India`
- 主要车站主源：`RailwayStation` + `Zone/Category wise station list`

### 4.2 后备源

- `Railway Map of India 2023`：官方全国骨架核对
- `Indian Railways Time Table`：站点关系与命名补充

### 4.3 排除项

- 班次、运行图、路径规划
- 货运线细分类和站场细部
- 把官方总图 PDF 误当成可直接构建的全国 GIS 主源
- 把全量客运站一次性塞进首版主要车站层

## 5. 与现有仓库架构的承接判断

- 继续沿用 `railways` 线层 + `rail_stations` 点层的 deferred pack 结构。
- `railways` 先以 OSM 线几何落地，再在构建期用官方站点名称、站点分类和官方总图做校验。
- `rail_stations` 应优先收敛到官方分类里更高等级、客运重要度更高的站点，而不是全站点。
- 如果后续出现中央 + 区域铁路系统差异，先在构建层处理，不在前端图层上分裂成多套印度铁路。

## 6. 与日本最明显的不同

- 日本铁路更接近“官方专题包直接做主底座”；印度铁路更像“官方站点和分类强，但公开线路主几何明显不足”。
- 日本能更自然地落在 `官方主源 + OSM 补缺`；印度更稳的是 `OSM 主几何 + 官方属性加固`。
- 印度铁路全国数据的公开形式更偏 PDF、目录、总图和表格，不像日本那样贴近直接产品化的 GIS 包。

## 7. 风险与下一步建议

1. 最大风险是把官方铁路系统的“存在感”误写成“全国开放线路主源已经成立”。
2. 第二个风险是把车站分类表直接当成“主要车站层已天然完成”，而不做缩放和密度控制。
3. 第三个风险是把官方总图 PDF 过度解读成可直接用于构建的线几何源。
4. 建议首版先明确写成 `OSM 主几何 + 官方属性加固`，不要试图在印度铁路上强行复制日本铁路的数据链。

## 8. 关键来源列表

- <https://www.data.gov.in/resource/railwaystation>
- <https://indianrailways.gov.in/Railway_station_zone-category_wise_list.pdf>
- <https://www.data.gov.in/resource/indian-railways-time-table-trains-available-reservation-03082015>
- <https://nr.indianrailways.gov.in/uploads/files/1689335330175-IR%20MAP%202023.pdf>
- <https://www.data.gov.in/sector/railways>
- <https://download.geofabrik.de/asia/india.html>
