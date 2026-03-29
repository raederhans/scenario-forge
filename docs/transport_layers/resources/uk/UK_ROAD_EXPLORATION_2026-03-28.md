# 英国公路试点探索归档

日期：2026-03-28

## 1. 一句话结论

英国公路这条线当前最稳：`motorway / trunk / primary` 首版可以直接建立在官方双源拼接上，即 `OS Open Roads (Great Britain) + OSNI 50K Transport lines (Northern Ireland)`；如果严格要求单一 UK 全国主源，那这个缺口成立，但它不妨碍首版落地。

## 2. 研究边界

- 固定只研究 `最新快照`
- 固定只看 `motorway / trunk / primary`
- 不研究历史回溯
- 不研究 routing
- 不研究 `secondary` 及以下道路
- 不研究复杂节点体系和收费、限速、施工专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [OS Open Roads](https://findtransportdata.dft.gov.uk/dataset/os-open-roads-17825c31f9f) | Great Britain | 线 | 页面显示 2025-04-16 更新 | UK Open Government Licence / OS OpenData 路线 | Tier A | 适合作为 GB 主几何主源 | 最适合承接 `motorway / trunk / primary` 首版，且带 PRN/SRN 识别思路 |
| [OSNI Open Data - 50K Transport lines](https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6) | Northern Ireland | 线 | 2024-09-28 | OGL / LPS Open Government Data License | Tier A | 适合作为 NI 主几何主源 | 能补齐 UK 范围内最明显的 GB/NI 缺口 |
| [National Highways Network Model Public](https://www.data.gov.uk/dataset/a15ee547-8503-4388-a670-ab352ab86f2a/network-model-public) | England Strategic Road Network | 线 | 2025-02-11 | OGL | Tier A | 适合作为属性加固，不适合作为全国主源 | 适合校正 England SRN 身份、名称和开放状态，但它只覆盖 England SRN |
| [Road lengths in Great Britain: 2024](https://www.gov.uk/government/statistics/road-lengths-in-great-britain-2024/road-lengths-in-great-britain-2024) | Great Britain | 统计，无独立几何 | 2024 版 | OGL | Tier A | 不适合作为几何主源 | 适合校验 trunk / motorway 口径，不适合当图层几何 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | UK 全域 | 线 | 持续更新 | ODbL | Tier C | 只适合作为后备源 | 当前首版不需要把 OSM 升格为道路主源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `Great Britain 主几何`：OS Open Roads
- `Northern Ireland 主几何`：OSNI 50K Transport lines
- `England SRN 加固`：National Highways Network Model Public

### 4.2 后备源

- Great Britain road lengths 统计，用于交叉核对 trunk / motorway 范围
- OpenStreetMap，仅在边缘命名或缺段核对时补充

### 4.3 排除项

- 历史道路演变
- 次级道路与地方道路全量
- 复杂节点、收费站、施工、桥梁专题
- 交通流、AADF 等动态交通数据

## 5. 与现有仓库架构的承接判断

- 继续沿用日本公路的 `roads` + `road_labels` 双包结构。
- 数据层要显式记录 `source_region = GB / NI`，但前端仍呈现为一个 UK 图层。
- 首版编号只建议显示 `motorway` 和主 `A road` 编号，不要过早放开更细颗粒度。
- `OS Open Roads` 已经很贴近首版功能分级，前端可以直接围绕 `motorway / trunk / primary` 做缩放控制，而不必先发明一套复杂英国法定道路映射体系。

## 6. 与日本最明显的不同

- 日本公路首版更像 `OSM 主几何 + 官方高速加固`；英国公路更适合 `官方双源拼接 + England SRN 官方加固`。
- 日本的难点在高速体系与其他主干公路的产品映射；英国更大的难点是 `Great Britain` 与 `Northern Ireland` 的国家边界拼接。
- 英国这条线的许可边界反而比机场和港口更清楚，因此更适合直接进入产品试点。

## 7. 风险与下一步建议

1. 最大风险是把 GB 源误当成 UK 全国主源，导致 Northern Ireland 被静默丢失。
2. 第二个风险是把 National Highways 的 England SRN 数据误当成全英国 trunk / motorway 主源。
3. 第三个风险是首版过早放开 secondary 或复杂节点，导致项目重新掉进高噪声路网。
4. 建议首版直接按这个顺序做：
   1. 先拼接 `OS Open Roads + OSNI`
   2. 只保留 `motorway / trunk / primary`
   3. 再用 National Highways 给 England SRN 做加固

## 8. 关键来源列表

- <https://findtransportdata.dft.gov.uk/dataset/os-open-roads-17825c31f9f>
- <https://www.data.gov.uk/dataset/65bf62c8-eae0-4475-9c16-a2e81afcbdb0/os-open-roads1>
- <https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6>
- <https://www.data.gov.uk/dataset/a15ee547-8503-4388-a670-ab352ab86f2a/network-model-public>
- <https://www.gov.uk/government/statistics/road-lengths-in-great-britain-2024/road-lengths-in-great-britain-2024>
- <https://www.openstreetmap.org/copyright>
