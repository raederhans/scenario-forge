# 英国交通专题研究总览

日期：2026-03-28

## 1. 一句话结论

英国这四条线里，当前最适合先试点的是 `公路`：它的官方几何骨架最稳，虽然严格意义上的“单一 UK 全国主源”并不存在，但 `Great Britain + Northern Ireland` 的官方双源拼接路线是清楚的；`港口` 次之，适合先做主要商港节点层；`机场` 研究成熟但许可与点位主源都不够干净；`铁路` 则最明显地存在 UK 级官方全国主源缺口。

## 2. 四条线总体成熟度排序

| 排名 | 线别 | 当前成熟度 | 当前最稳主锚点 | 最关键问题 |
|---|---|---|---|---|
| 1 | 公路 | 高 | [OS Open Roads](https://findtransportdata.dft.gov.uk/dataset/os-open-roads-17825c31f9f) + [OSNI Open Data - 50K Transport lines](https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6) | 没有单一 UK 全国一体化主源，GB 与 NI 仍需分源拼接 |
| 2 | 港口 | 中上 | [DfT Port freight statistics](https://www.gov.uk/government/statistical-data-sets/port-and-domestic-waterborne-freight-statistics-port) + [HMRC UK ports and port codes](https://www.gov.uk/government/collections/uk-ports-and-port-codes) | 官方统计和代码表很强，但官方全国点位主源缺口成立 |
| 3 | 机场 | 中 | [CAA UK certificated aerodromes](https://www.caa.co.uk/commercial-industry/airports/aerodrome-licences/certificates/uk-certificated-aerodromes/) + [CAA UK airport data](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/uk-airport-data-2024/) | 官方名单和流量统计强，但官方全国点位主源缺口成立，且 CAA 统计数据转售限制要显式处理 |
| 4 | 铁路 | 中下 | [ORR station attributes / usage](https://dataportal.orr.gov.uk/statistics/usage/estimates-of-station-usage/) + [Network Rail open data](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/) | ORR 和 Network Rail 主体上覆盖 Great Britain，UK 级统一官方线网主源缺口最明显 |

## 3. 最适合先试点的一条

当前最适合先试点的是 `公路`。

原因很直接：

- 首版只做 `motorway / trunk / primary`，英国现成官方或准官方几何正好最匹配这一口径。
- [OS Open Roads](https://findtransportdata.dft.gov.uk/dataset/os-open-roads-17825c31f9f) 已经直接带出 `PRN` 与 `SRN` 识别思路，天然贴近首版筛选逻辑。
- [National Highways Network Model Public](https://www.data.gov.uk/dataset/a15ee547-8503-4388-a670-ab352ab86f2a/network-model-public) 可以给 England 的 SRN 做官方属性加固。
- `Great Britain` 与 `Northern Ireland` 虽然是两套源，但拼接关系清楚，比铁路和港口那种“名单强、几何弱”更适合产品化落地。

## 4. 和日本最明显的差异

英国和日本最明显的差异不是“官方源更少”，而是 `英国很多国家级公开源实际上只覆盖 Great Britain，而不是完整 United Kingdom`。

- `铁路`：ORR 主站点与使用量口径是 Great Britain；Northern Ireland 不能直接并进同一官方主源链。
- `公路`：OS Open Roads 是 Great Britain；Northern Ireland 要补 [OSNI 50K Transport lines](https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6)。
- `机场`：CAA 口径更接近 UK，但它给的是证书名单和统计，不是干净的全国机场点位产品。
- `港口`：DfT 对“major ports”统计很强，但它本质上是统计口径，不是一个现成 GIS 设施层。

日本更像“全国专题数据产品先在”，英国更像“监管统计、行业清单、国家制图和地区补源并存”。

## 5. 哪些地方必须降级到非官方但可信公开源

### 5.1 铁路

- 如果首版坚持要做 UK 全域 `铁路线` 几何，当前最稳的结论是 `OSM 主几何 + 官方属性加固`。
- 原因不是 OSM 更权威，而是 UK 级单一官方全国线网主源没有找到同等干净的公开产品。
- `disused / abandoned / construction` 这类生命周期状态，更要降级到 OSM 或其他协作源补充。

### 5.2 机场

- CAA 官方名单和统计足够做“哪些机场重要”，但不等于给了可直接装配的全国机场点位主层。
- 如果首版要做稳定点位层，几何仍需要降级到其他可信公开源或逐点核对生成。

### 5.3 港口

- DfT 与 HMRC 可以回答“哪些港口重要、叫什么、代码是什么”，但回答不了一份全国统一港口点几何。
- 如果首版要做主要商港节点点层，点位仍需要降级到其他可信公开源或人工核点。

### 5.4 当前不必降级的地方

- `公路` 首版不必降级到协作源，官方双源拼接已经够用。

## 6. 与现有仓库架构的承接判断

- `railways`
  - 继续走独立 deferred context pack。
  - 英国更适合 `railways` 与 `rail_stations` 拆开加载。
  - 站点重要度可以直接复用 ORR station usage 做筛选。
- `roads`
  - 继续走 `roads` + `road_labels` 双包结构。
  - UK 首版最适合做成 `OS Open Roads (GB) + OSNI (NI)` 的规范化拼接层。
- `airports`
  - 继续走点图层逻辑，复用 `cityPoints` 风格承接。
  - 但要在数据层先明确“官方名单/统计”和“点位几何”不是同一源。
- `ports`
  - 也适合点图层逻辑。
  - 首版应明确写成 `major commercial ports node layer`，不要伪装成完整港口设施系统。

## 7. 风险与下一步建议

1. 最大风险是把 `Great Britain` 数据误写成 `United Kingdom` 数据，这在英国会直接误导产品边界。
2. 第二个风险是把统计源当成几何主源。机场和港口这两条线最容易犯这个错。
3. 第三个风险是低估许可问题。CAA 统计页明写 `No statistical data provided by CAA may be sold on to a third party`，这一点不能在产品判断里省略。
4. 建议的英国交通试点顺序：
   1. `公路`
   2. `港口`
   3. `机场`
   4. `铁路`

## 8. 关键来源

- <https://findtransportdata.dft.gov.uk/dataset/os-open-roads-17825c31f9f>
- <https://www.data.gov.uk/dataset/52bd7329-2ac1-4578-8651-b405178aa0dc/osni-open-data-50k-transport-transport-lines6>
- <https://www.data.gov.uk/dataset/a15ee547-8503-4388-a670-ab352ab86f2a/network-model-public>
- <https://dataportal.orr.gov.uk/statistics/usage/estimates-of-station-usage/>
- <https://www.orr.gov.uk/node/3399>
- <https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/>
- <https://www.caa.co.uk/commercial-industry/airports/aerodrome-licences/certificates/uk-certificated-aerodromes/>
- <https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/uk-airport-data-2024/>
- <https://www.gov.uk/government/statistical-data-sets/port-and-domestic-waterborne-freight-statistics-port>
- <https://www.gov.uk/government/collections/uk-ports-and-port-codes>
