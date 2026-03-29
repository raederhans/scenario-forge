# 英国机场试点探索归档

日期：2026-03-28

## 1. 一句话结论

英国机场这条线更适合写成 `官方名录 + 官方流量统计 + 点位几何补充`：CAA 对公共/民航机场名单和流量统计很强，但当前没有找到一个同样干净、可直接产品化的英国全国机场点位主源，而且 CAA 统计数据本身有明确转售限制。

## 2. 研究边界

- 固定为 `设施本体`
- 固定为 `点图层优先`
- 固定优先收 `主要公共/民航机场`
- 不研究航线
- 不研究机场范围面
- 不研究军用专题设施
- 不研究直升机场专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [CAA UK certificated aerodromes](https://www.caa.co.uk/commercial-industry/airports/aerodrome-licences/certificates/uk-certificated-aerodromes/) | UK certificated aerodromes | 名录，无统一点几何 | 页面当前在线 | 官方名单；适合做首层筛选 | Tier A | 适合作为官方名录主源，不适合作为点位主源 | 名单干净，但没有统一点位 |
| [CAA UK airport data 2024](https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/uk-airport-data-2024/) | CAA reporting airports，覆盖 60+ UK airports | 统计表，无统一点几何 | 2025 年发布 2024 月度/年度数据 | 页面明写 `No statistical data provided by CAA may be sold on to a third party`，且要求引用 CAA | Tier A | 适合作为重要度与筛选源，不适合作为可直接产品化主源 | 对“哪些机场重要”非常强，但许可不能轻描淡写 |
| [CAA aerodrome licences](https://www.caa.co.uk/data-and-analysis/approved-persons-and-organisations/approved-organisations/aerodrome-licences/) | UK licensed aerodromes | 单场许可边界图可查，不是统一全国点层 | 页面当前在线 | 官方监管页面 | Tier A | 只适合作为核对层 | 适合核对个别机场，不适合批量装配首版点层 |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | UK 全域 | 点 | 持续更新 | ODbL | Tier C | 适合作为点位补充 | 如果首版必须快速出全国机场点位，这条线最现实，但必须明确是降级使用 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `机场名单主源`：CAA certificated aerodromes
- `机场重要度主源`：CAA airport data（建议优先看 annual size / passenger tables）

### 4.2 后备源

- CAA aerodrome licence individual pages，用于个别机场核对
- OpenStreetMap，用于点位几何补充

### 4.3 排除项

- 航线和 route network
- 机场边界、多跑道几何和 detailed airside assets
- 军用机场专题
- 直升机场专题

## 5. 与现有仓库架构的承接判断

- 继续按点设施层进入 context layer，复用 `cityPoints` 类承接方式。
- 数据层必须把 `官方名单/重要度` 和 `点位几何` 拆开存，不要假装它们来自同一源。
- 如果后续要做样式分层，最自然的分级是：`hub / major / regional`，其依据来自 CAA passenger / movement 统计，而不是主观阈值。
- 首版更适合先收“主要公共/民航机场”，不要把全部 certificated aerodromes 一次性全塞进去。

## 6. 与日本最明显的不同

- 日本机场更接近“官方专题数据里已经同时有面和点”；英国更像“监管名单与统计很强，但全国几何产品不整齐”。
- 日本首版可以更容易直接选官方点；英国更适合 `官方名单 + 官方统计 + 几何补充`。
- 英国这条线最需要额外写清的是许可问题，而不是分类问题。

## 7. 风险与下一步建议

1. 最大风险是把 CAA 统计数据直接写成“可自由产品化主源”。页面上的转售限制必须明确保留。
2. 第二个风险是把 certificated aerodromes 全量照搬为首版点层，导致图层退化成监管名录。
3. 第三个风险是把机场名单当作点几何主源；它不是。
4. 建议首版如果要真正落地，先分两步：
   1. 用 CAA 官方名录 + 流量统计选出主要机场集合
   2. 再决定点位几何是逐点核定还是显式降级到协作源

## 8. 关键来源列表

- <https://www.caa.co.uk/commercial-industry/airports/aerodrome-licences/certificates/uk-certificated-aerodromes/>
- <https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/uk-airport-data-2024/>
- <https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/uk-airport-data-2024/november-2024/>
- <https://www.caa.co.uk/data-and-analysis/approved-persons-and-organisations/approved-organisations/aerodrome-licences/>
- <https://www.openstreetmap.org/copyright>
