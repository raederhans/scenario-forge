# 印度交通专题研究总览

日期：2026-03-28

## 1. 一句话结论

印度这四条线里，`机场` 最适合先试点，`港口` 次之，`公路` 可以做但更适合 `OSM 主几何 + 官方属性加固`，`铁路` 也能做但公开官方全国线网主源明显弱于日本，最稳仍是 `OSM 主几何 + 官方属性加固`。

## 2. 四条线总体成熟度判断

| 线别 | 总体成熟度 | 当前最强主锚点 | 几何 | 是否存在全国统一官方主源 | 与日本相比最明显的不同 |
|---|---|---|---|---|---|
| 铁路 | 中 | `OSM / Geofabrik India` + `RailwayStation` + 官方车站分类与地图 | 线 + 点 | 主要车站官方源有，但全国公开线路主几何不足 | 日本铁路更像专题包；印度更像官方站点和分类存在，但线路主几何仍要靠 OSM |
| 公路 | 中上 | `OSM / Geofabrik India` + `NationalHighway` OGD + `MoRTH GIS mapping of all NH` | 线 | 全国官方主干道路开放几何不足，中央源更偏 NH 骨架 | 日本公路更像 OSM 加官方高速加固；印度更明显是“全国骨架 + 邦级补强” |
| 机场 | 中上 | `AAI` 机场名录与流量 + `OSM` 点位补充 | 点 | 官方名单和流量强，干净开放点主源弱 | 日本机场更接近现成全国点层；印度机场更像官方名单/统计先行 |
| 港口 | 中上 | `MoPSW Ports Wing` + `Basic Port Statistics` + `OSM` 点位补充 | 点 | 主要港口名单和统计强，点几何主源弱 | 日本港口更像旧专题地理源；印度更像 major ports 业务名录和统计强、几何弱 |

## 3. 哪条线最适合先试点

当前最适合先试点的是 `机场`。

原因很直接：

- 机场本身就是 `设施本体 + 点图层优先`，最符合现有仓库承接方式。
- `AAI` 已经给出较新的机场名单与流量数据，足以先决定首版“哪些机场该进层、哪些是主要节点”。
- 相比铁路和公路，机场几何简单，噪声更低，首版更容易可读。
- 相比港口，机场的全国口径更统一，不那么受中央/邦级碎片化影响。

## 4. 和日本最明显的差异

印度和日本最明显的不同，不是“没有官方源”，而是 `官方源更容易分裂成业务名单、统计、总图、邦级补充，而不是一份贴近业务对象的全国专题 GIS 包`。

- `铁路`：日本更像官方线网专题包；印度更像官方站点和分类强、线几何弱。
- `公路`：日本有更顺手的官方专题补强链；印度中央层更偏 `National Highways`，超出这层后更自然地落到 `OSM + 邦级补强`。
- `机场`：日本机场更接近全国专题空港数据；印度机场更像 `AAI 名录/流量 + 点位补充`。
- `港口`：日本港口的难点是源旧和许可；印度港口的难点是几何主源缺口与 major/non-major 双体系。

## 5. 哪些地方必须降级到非官方但可信公开源

必须明确降级的地方主要有三类。

### 5.1 铁路线几何

- 目前没有找到足够新的、全国统一、公开可下载、直接适配产品化的印度铁路线路主几何官方源。
- 因此铁路线主几何现实上要降到 `OSM / Geofabrik India`。
- 官方源主要承担站点、车站分类、名称和全国骨架核对。

### 5.2 机场点位

- `AAI` 的机场名单和流量非常有用，但它们不是干净开放的全国机场点包。
- 如果首版要直接出一张全国机场点层，几何仍需降级到 `OSM` 或等价可信公开点源。

### 5.3 港口点位

- `MoPSW` 的 major ports 名录和港口统计足以确定“哪些港口是主节点”。
- 但点位几何仍需 `OSM` 或等价可信公开源补充。
- 对 non-major ports，如果没有州级可靠公开源，不应假装全国点层已经成立。

## 6. 与现有仓库架构的承接判断

- `railways`
  - 仍然适合独立 deferred context pack
  - 线路与主要车站必须分开
  - 印度更适合 `OSM 主几何 + 官方属性加固`
- `roads`
  - 适合 `roads` + `road_labels` 结构
  - 首版默认按 `motorway / trunk / primary`
  - 如果出现中央 + 邦级碎片化，文档里直接写成 `全国骨架 + 邦级补强`
- `airports`
  - 最适合复用现有 `cityPoints` 风格点图层链路
- `ports`
  - 也适合点层承接，但首版必须明确写成 `主要商港/关键港口节点层`

## 7. 风险与下一步建议

1. 最大风险是把印度官方名录、统计和总图误当成已经可直接产品化的全国地理主源。
2. 铁路最容易被误写成“官方铁路体系很大，所以全国开放线路主几何也很强”；这不成立。
3. 公路最容易被误写成“National Highways 就等于全国 trunk/primary 全覆盖”；这也不成立。
4. 港口最容易被误做成“major ports 层已经等于全国港口体系”；首版只能先做主节点层。
5. 建议的首版试点顺序：
   1. `机场`
   2. `港口`
   3. `公路`
   4. `铁路`

## 8. 关键来源

- [RailwayStation | OGD India](https://www.data.gov.in/resource/railwaystation)
- [List of Zone/Category wise Railway station opened for Passenger services in Indian Railway](https://indianrailways.gov.in/Railway_station_zone-category_wise_list.pdf)
- [Indian Railways Time Table | OGD India](https://www.data.gov.in/resource/indian-railways-time-table-trains-available-reservation-03082015)
- [National Highways | OGD India](https://www.data.gov.in/resource/nationalhighway)
- [NATMO National Highways](https://geoportal.natmo.gov.in/dataset/national-highways)
- [GIS mapping of all National Highways | MoRTH](https://morth.nic.in/hi/node/16206)
- [State/UT-wise Details of Length of NHs as on 30-06-2024 | OGD India](https://www.data.gov.in/resource/stateut-wise-details-length-national-highways-nhs-country-30-06-2024)
- [List of Airports cluster wise for the F.Y. 2025-26 | AAI](https://www.aai.aero/en/services/list-airports-cluster-wise-f-y-202526)
- [Air Traffic Report – June 2025 | AAI](https://www.aai.aero/sites/default/files/traffic-news/TRJun2k25.pdf)
- [Ports Wing | Ministry of Ports, Shipping and Waterways](https://shipmin.gov.in/en/division/ports-wing)
- [Basic Port Statistics of India 2023-24](https://www.shipmin.gov.in/en/content/basic-port-statistics-india-2023-24)
- [Traffic Handled at Major Ports in India | OGD India](https://jk.data.gov.in/catalog/traffic-handled-major-ports-india)
- [Monthly Cargo Traffic handled at Non-Major Ports during December 2025](https://shipmin.gov.in/hi/content/monthly-cargo-traffic-handled-non-major-ports-during-december-2025)
- [OpenStreetMap Copyright](https://www.openstreetmap.org/copyright)
