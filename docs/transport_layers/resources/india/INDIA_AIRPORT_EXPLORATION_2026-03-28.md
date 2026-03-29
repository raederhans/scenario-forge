# 印度机场专题研究归档

日期：2026-03-28

## 1. 一句话结论

印度机场这条线当前最稳的判断是 `官方名录 + 官方流量统计 + 点位几何补充`：`AAI` 已经能较好支撑对象范围和重要度排序，但干净开放的全国机场点主源仍然偏弱，几何更适合用 `OSM` 做补充。

## 2. 研究边界

- 只研究 `设施本体`
- 只做 `点图层优先`
- 只优先收 `主要公共/民航机场`
- 不研究航线
- 不研究机场范围面
- 不研究军用专题设施
- 不研究直升机场专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [List of Airports cluster wise for the F.Y. 2025-26 | AAI](https://www.aai.aero/en/services/list-airports-cluster-wise-f-y-202526) | 印度公共/民航机场名单 | 名录 | Last Updated On 2025-05-21 | 官方网站内容，非典型开放数据包，复用边界需单独核对 | Tier A | 是，作为对象范围主源 | 对机场对象范围和聚类很有价值，但不是全国点包 |
| [Air Traffic Report – June 2025 | AAI](https://www.aai.aero/sites/default/files/traffic-news/TRJun2k25.pdf) | 印度全国运营机场流量 | 统计 | 2025-06 月报 | 官方 PDF 统计，适合作重要度判断 | Tier A | 否，适合作排序补强 | 适合决定“主要公共/民航机场”首版名单 |
| [List of Airports (Cluster-1) PDF](https://www.aai.aero/sites/default/files/List_of_AAI_Non_Major_Airports-Cluster_wise.pdf) | 印度非 major 机场分级 | 名录 | 2024-25 口径 PDF | 官方 PDF | Tier A | 否，适合作补强 | 有助于筛选非 metro 但流量高的机场 |
| [AIM India eAIP / GEN 3.1](https://aim-india.aai.aero/eaip-v2-02-2025/eAIP/IN-GEN%203.1-en-GB.html) | 印度航空资料体系 | 文本、航空资料入口 | 2025 期次 | 官方航空资料站，使用边界不等于开放 GIS 点包 | Tier A | 否 | 证明官方航空资料体系存在，但不直接解决点主源 |
| [OpenStreetMap / Geofabrik India](https://download.geofabrik.de/asia/india.html) | 印度全国 | 点、面 | 频繁更新 | ODbL | Tier C | 是，但只适合作几何补充 | 当前最现实的全国点位补充源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 对象范围主源：`AAI List of Airports cluster wise for the F.Y. 2025-26`
- 重要度主源：`AAI Air Traffic Report`
- 点位几何：`OSM / Geofabrik India`

### 4.2 后备源

- `Cluster-1 / non-major airport` PDF：补高价值机场筛选
- `AIM India eAIP`：核对机场属性与航空资料体系

### 4.3 排除项

- 航线网络
- 机场范围面
- 军用专题设施
- 直升机场专题
- 把 AAI 名录直接误写成已带精确点位的开放 GIS 主源

## 5. 与现有仓库架构的承接判断

- 继续沿用 `airports` 独立点图层 pack。
- 构建期先确定“哪些机场是首版主要公共/民航机场”，再绑定点位，不要在前端做动态筛选。
- 对印度来说，最稳的结构是：
  - 官方名录负责对象范围
  - 官方流量负责重要度
  - OSM 负责点位几何
- 这条线很适合先跑通，因为不需要先解决大规模线几何去重。

## 6. 与日本最明显的不同

- 日本机场更接近国家专题 GIS 包；印度机场更像官方名录和流量统计很强，但全国点主源不够整齐。
- 日本更像“官方点层先在”；印度更像“官方名单/统计先在，点位要补”。
- 这意味着印度机场并不难做，但必须老实承认几何层有补充依赖。

## 7. 风险与下一步建议

1. 最大风险是把 `AAI` 名录和流量统计误写成已经自带干净开放点层。
2. 第二个风险是把大量低流量或特殊用途机场一次性并入首版，破坏点层可读性。
3. 第三个风险是忽视非 AAI 体系的公共机场，导致对象范围过窄。
4. 建议首版先按 `官方名录 + 官方流量 + OSM 点位` 收口，优先覆盖主要公共/民航机场。

## 8. 关键来源列表

- <https://www.aai.aero/en/services/list-airports-cluster-wise-f-y-202526>
- <https://www.aai.aero/sites/default/files/traffic-news/TRJun2k25.pdf>
- <https://www.aai.aero/sites/default/files/List_of_AAI_Non_Major_Airports-Cluster_wise.pdf>
- <https://aim-india.aai.aero/eaip-v2-02-2025/eAIP/IN-GEN%203.1-en-GB.html>
- <https://download.geofabrik.de/asia/india.html>
