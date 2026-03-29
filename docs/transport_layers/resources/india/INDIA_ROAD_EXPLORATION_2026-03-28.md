# 印度公路专题研究归档

日期：2026-03-28

## 1. 一句话结论

印度公路这条线当前最稳的判断是 `OSM 主几何 + 官方属性加固`：中央官方源能较好支撑 `National Highways` 全国骨架，但对首版要求的 `motorway / trunk / primary` 来说，仍然需要 `OSM / Geofabrik India` 作为主几何，并明确写成 `全国骨架 + 邦级补强`。

## 2. 研究边界

- 只研究 `最新快照`
- 只研究 `motorway / trunk / primary`
- 不研究历史回溯
- 不研究 routing
- 不研究 `secondary` 及以下道路
- 不研究复杂节点体系和收费、限速、施工专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [NationalHighway | OGD India](https://www.data.gov.in/resource/nationalhighway) | 印度全国 National Highways | 线 | 发布/更新显示 2021-11-18 | Government Open Data License - India | Tier A | 适合作为中央 NH 骨架参考，不适合作为完整主源 | 题对但偏旧，且只覆盖 NH 口径 |
| [NATMO National Highways](https://geoportal.natmo.gov.in/dataset/national-highways) | 印度全国 | 线 | Modified 2021-08-14；Mapping Year 2014，Digitizing Year 2019 | Metadata 标示 Unrestricted；1:14,000,000 级别 | Tier A | 不适合作为产品主几何 | 是官方全国总图，但比例尺过粗，更适合核对骨架 |
| [GIS mapping of all National Highways | MoRTH](https://morth.nic.in/hi/node/16206) | 印度全国 National Highways | GIS mapping / PDF | 页面日期 2022-08-11；网站最近修改 2026-01-14 | 官方网站内容，可核对 NH 覆盖，但不是干净开放产品主层 | Tier A | 否，适合作属性校验 | 适合核对 NH 身份与范围，不适合作线主源 |
| [State/UT-wise Details of Length of NHs as on 30-06-2024 | OGD India](https://www.data.gov.in/resource/stateut-wise-details-length-national-highways-nhs-country-30-06-2024) | 印度全国 | 统计，无独立几何 | 页面抓取显示 2024 口径 | Government Open Data License - India | Tier A | 否 | 适合交叉核对全国和州级 NH 口径 |
| [OpenStreetMap / Geofabrik India](https://download.geofabrik.de/asia/india.html) | 印度全国 | 线 | 频繁更新 | ODbL | Tier C | 是 | 当前最现实的主几何来源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `OSM / Geofabrik India` 作为首版 `motorway / trunk / primary` 主几何
- `NationalHighway` OGD + `MoRTH GIS mapping` 作为 NH 身份和名称校验

### 4.2 后备源

- `NATMO National Highways`：全国骨架核对
- NH 长度统计：州级口径核对
- 如果出现高价值邦级干线缺口，再引入邦级公开道路门户做补强

### 4.3 排除项

- 历史道路演变
- 地方道路与次级道路全量
- 复杂互通、收费站、施工、限速和路况专题
- 把中央 NH 骨架误写成已经覆盖 `motorway / trunk / primary` 全层

## 5. 与现有仓库架构的承接判断

- 继续沿用 `roads` + `road_labels` 双包结构。
- 首版在产品上仍只显示 `motorway / trunk / primary`。
- 数据口径要显式写成 `全国骨架 + 邦级补强`：
  - 中央层负责 NH 和 expressway 级别的官方核对
  - 超出中央层覆盖的高价值主干线，必要时由邦级公开源或 OSM 承担
- 当前不建议为印度道路单独发明新的多层体系，先复用日本/英国的 road context pack 思路。

## 6. 与日本最明显的不同

- 日本公路更像 `OSM 主几何 + 官方高速加固`；印度公路更进一步地依赖 `中央 NH 骨架 + OSM 主几何 + 邦级补强`。
- 日本的国家专题补强更接近完整交通主题；印度中央官方道路公开源更偏 `National Highways` 本身。
- 因此印度道路首版比日本更需要提前承认“单一完美官方主源不存在”。

## 7. 风险与下一步建议

1. 最大风险是把 NH 官方源误当成 `motorway / trunk / primary` 的完整全国主层。
2. 第二个风险是为了追求“官方纯净”而迟迟不落地，错过更现实的 `OSM 主几何 + 官方加固` 路线。
3. 第三个风险是没有提前写清邦级补强，导致用户误以为全国外观均匀但实际覆盖不均。
4. 建议首版直接按 `OSM 主几何 + 中央官方 NH 加固 + 必要时邦级补强` 收口，不等单一完美主源。

## 8. 关键来源列表

- <https://www.data.gov.in/resource/nationalhighway>
- <https://geoportal.natmo.gov.in/dataset/national-highways>
- <https://morth.nic.in/hi/node/16206>
- <https://www.data.gov.in/resource/stateut-wise-details-length-national-highways-nhs-country-30-06-2024>
- <https://download.geofabrik.de/asia/india.html>
