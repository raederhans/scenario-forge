# 英国铁路试点探索归档

日期：2026-03-28

## 1. 一句话结论

英国铁路这条线当前最稳的判断是 `OSM 主几何 + 官方属性加固`：ORR 与 Network Rail 足够强，可以稳定支撑 `主要车站` 和 `Great Britain 主网属性`，但面向完整 UK 的公开全国线网主源仍然缺口成立。

## 2. 研究边界

- 研究对象固定为 `铁路线 + 主要车站`
- 不研究时间轴
- 不研究班次、routing、运行图
- 不研究全量车站设施系统
- 不研究地铁、轻轨、heritage rail 的完整专题化并表

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [ORR Table 6329: Station attributes for all mainline stations in Great Britain](https://www.orr.gov.uk/node/3399) | Great Britain mainline stations | 点 | ORR 2023/24 基准，公开页面当前可下载 | 官方公开统计配套表；落地前仍应复核 ORR 重用条款 | Tier A | 适合作为主站点主源 | 车站坐标、行政归属、owner 都够稳，但只到 Great Britain |
| [ORR Estimates of station usage](https://dataportal.orr.gov.uk/statistics/usage/estimates-of-station-usage/) | Great Britain mainline stations | 无独立几何，按站点表关联 | 2025-12-04 发布 2024/25 统计 | 官方统计公开；用于重要度筛选很合适 | Tier A | 适合作为重要度主源 | 最适合做“主要车站”筛选，不适合直接当几何源 |
| [Network Rail open data feeds](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/) / [Our information and data](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/our-information-and-data/) | Great Britain Network Rail 网络主体 | 多为运营/参考数据，不是现成全国 GIS 线层 | 持续更新 | 页面说明按 OGL 提供，但不是现成产品级全国线网图层 | Tier A | 不适合作为首版几何主源 | 适合做属性、命名和业务背景加固，不适合直接当首版线几何 |
| [OS Rail](https://www.data.gov.uk/dataset/5fa93846-ebda-44b7-b478-4fe0ee3c8595/rail4) | Great Britain | 线 | data.gov 页面显示 2024-12-20 更新 | data.gov 页面未清晰标出可直接产品化的开源许可句式，需回源复核 OS 条款 | Tier B | 只适合作为后备核对 | 是国家制图源，但许可边界在当前研究里不够干净 |
| [OSNI Open Data - 50K Transport lines](https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6) | Northern Ireland | 线 | 2024-09-28 | OGL / LPS Open Government Data License | Tier A | 适合作为 NI 补充源 | 能补 Northern Ireland，但不能把它误写成 UK 全国主源 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | UK 全域 | 线、点 | 持续更新 | ODbL | Tier C | 适合作为首版主几何 | 在 UK 全域层面最稳，因为官方公开源在 GB/NI 与几何产品化上都不整齐 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `铁路线主几何`：OpenStreetMap
- `主要车站主源`：ORR Table 6329
- `主要车站重要度`：ORR Estimates of station usage

### 4.2 后备源

- Network Rail open data / network information，用于线路命名、网络边界和业务口径核对
- OSNI 50K Transport lines，用于 Northern Ireland 线网核对
- OS Rail，用于 Great Britain 线位和命名核对，但不直接承诺为首版主源

### 4.3 排除项

- 完整班次、时刻表和 routing
- 全量车站设施属性
- London Underground、tram、heritage rail 全量并表
- 铁路生命周期的强官方全国完整层

## 5. 与现有仓库架构的承接判断

- 继续走 `railways` + `rail_stations` 两个 deferred context pack。
- `rail_stations` 最适合直接复用日本铁路的“主要车站优先”逻辑，但重要度筛选改用 ORR station usage。
- `railways` 应先只做 `active` 主网，不要在英国首版里强行承诺官方完整生命周期。
- 如果后续要把 Northern Ireland 并入同一层，建议在规范化阶段就显式加 `source_region = GB / NI`，避免把监管口径混成一个假全国源。

## 6. 与日本最明显的不同

- 日本铁路更接近“全国专题产品先在”；英国更像“监管统计强、网络运营数据强，但公开全国 GIS 主图层不整齐”。
- 日本可以自然走 `官方主源 + OSM 补缺`；英国在严格 UK 口径下更适合 `OSM 主几何 + 官方属性加固`。
- 日本主要车站的全国专题化更自然；英国的“主要车站”更适合直接用 ORR usage 做硬筛选。
- 英国最大的不连续点不是数据质量，而是 `Great Britain` 与 `Northern Ireland` 的制度边界。

## 7. 风险与下一步建议

1. 最大风险是把 ORR/Network Rail 的 Great Britain 口径误写成 UK 全国口径。
2. 第二个风险是把 OS Rail 当成已经明确可直接产品化的全国开源主层；当前许可边界还不够干净，不能轻写。
3. 第三个风险是把主要车站做成全量站点名录，导致点密度失控。
4. 建议首版先接受这个硬结论：`铁路线用 OSM 主几何，车站与重要度用 ORR 官方源`。这比继续深挖一个并不存在的 UK 单一官方线网主源更稳。

## 8. 关键来源列表

- <https://dataportal.orr.gov.uk/statistics/usage/estimates-of-station-usage/>
- <https://www.orr.gov.uk/node/3399>
- <https://www.orr.gov.uk/search-news/elizabeth-line-dominates-great-britains-top-10-stations>
- <https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/>
- <https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/our-information-and-data/>
- <https://www.data.gov.uk/dataset/5fa93846-ebda-44b7-b478-4fe0ee3c8595/rail4>
- <https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6>
- <https://www.openstreetmap.org/copyright>
