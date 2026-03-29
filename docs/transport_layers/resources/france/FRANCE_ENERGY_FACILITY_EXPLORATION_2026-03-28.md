# 法国能源设施试点探索归档

日期：2026-03-28

## 1. 一句话结论

如果法国这条线要求先有一个 `全国统一、可持续更新、官方可复用` 的能源设施锚点，那么最稳的起点不是“全部能源设施总表”，而是 `全国电力生产与储能设施登记`；它可以构成首版主源，但首版边界必须明确写成“以电力生产/储能设施为主”。

## 2. 研究边界

本轮固定边界如下：

- 研究对象是 `点状能源设施`
- 明确排除输油、输气、输电等线状网络
- 优先保证全国统一口径
- 允许主锚点先覆盖电力生产与储能
- 不把统计口径数据直接当空间设施图层

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可 / 使用边界 | Tier | 适不适合当主源 | 判断 |
|---|---|---|---|---|---|---|---|
| `Registre national des installations de production et de stockage d'électricité` | 法国全国，含法国本土与 ZNI | 设施级记录为点状对象逻辑；但 `<36kW` 只公开到 IRIS 聚合，不是精确点 | 数据截面 2026-01-31；data.gouv 元数据 2026-03-19 更新 | Open Licence 2.0 | Tier A | `是，但仅限电力生产/储能主层` | 当前最稳、最新、最全国统一的国家级能源设施入口 |
| `Grandes Infrastructures gazières en France` | 法国全国 | 点、线、面混合；其中终端与储气库可抽点，管线必须排除 | 2019-11-29 | Open Licence 2.0 | Tier B | `否，最多作后备` | 语义过宽且含管线，更新明显偏旧 |
| `Evolution quotidienne des stocks de GNL des principaux terminaux méthaniers en France` | 法国 4 个主要 LNG 终端 | 终端级设施清单 / 统计表 | data.gouv 页面可核到 2019-10-21 版本快照 | Open Licence 2.0 | Tier B | `否` | 很适合确认 LNG 终端名单，但现有公开快照偏旧，不适合当全国能源设施母表 |
| 炼油厂官方 PDF / 部门公告 | 全国但通常是名录或统计 | 多为无标准 GIS 几何的表或 PDF | 不定期 | 多数可引用但不总是机器可复用地理层 | Tier A | `否` | 可用于核名，不适合直接当空间主源 |
| ODRÉ / 企业公开地图、行业目录 | 全国或子行业 | 点 / 线 / 面混合 | 不一 | 需按站点或平台条款确认 | Tier B / C | `否` | 可做补缺，但不能抢主源位置 |
| 危险工业装置、污染风险站点数据库 | 全国 | 点或面 | 持续更新 | 各自条款单列 | Tier A | `否` | 语义不是能源设施，不应混用 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `Registre national des installations de production et de stockage d'électricité`

它最强的地方有四点：

- 国家法定登记，RTE 负责汇总
- 覆盖法国本土和 ZNI
- 更新频率明显好于很多传统底库
- 许可清楚，是 Open Licence 2.0

但它不是“法国全部能源设施总表”。

必须同步写清的限制：

- 对 `<36kW` 装置，公开到 IRIS 聚合，不给精确点
- 主题中心是 `électricité production + stockage`
- 不能自动外推为炼油厂、LNG、油库、热电联产以外的一切能源节点总层

### 4.2 后备源

- `Grandes Infrastructures gazières en France`
  - 可补：储气库、终端、互联点的国家级骨架
  - 不可直接并入：管线部分
  - 问题：2019 年版本偏旧，且对象集合过宽
- `Evolution quotidienne des stocks de GNL des principaux terminaux méthaniers en France`
  - 可补：法国 4 个主要 LNG 终端的正式名单
  - 问题：公开页面可核版本偏旧，且更偏运营统计，不是国家空间母表

### 4.3 排除项

- 任何输气 / 输电 / 输油线网数据
- 仅有国家统计、没有设施空间对象的年度能源报表
- 把危险工业设施数据库直接替代能源设施总表

## 5. 为什么法国能源线不应假装已经全国一体化完成

法国能源线最容易犯的错误，是把“有一个很强的全国电力设施登记”误说成“法国已经有一个全国统一能源设施总表”。

实际上两者不是一回事：

- 电力生产与储能设施：有强官方全国登记
- 燃气大基础设施：有国家级数据，但混入线网且明显偏旧
- LNG 终端：可以补，但子类很窄
- 炼油厂、油库等：常能找到权威名录，但未必有稳定的全国 GIS 主层

所以最稳的做法不是硬凑“全能源总层”，而是：

- 首版先把 `power_generation_and_storage` 做实
- 其余子类单列为后续研究扩展

## 6. 与日本最明显的不同

和日本相比，法国能源线的最明显不同有两点：

### 6.1 法国主源更新更近，但公开精度对小装置做了法定聚合

- 日本样例主层较旧，但整体就是一个全国电站锚点
- 法国主层更新更近，却明确规定小型装置只能到 IRIS 聚合
- 这意味着法国首版更现代，但也更需要写清几何精度边界

### 6.2 法国没有一个自然覆盖“所有能源设施子类”的官方国家级总层

- 日本样例更容易先把“发电设施”直接讲明白
- 法国如果继续用“能源设施”这个大标题，必须在正文里主动降语义，不然会误导成“炼油、LNG、油库、储气库、变电站都已齐”

## 7. 与现有仓库架构的承接判断

建议承接方式如下：

- 逻辑层名称：`energy_facilities`
- 首版实际对象：`national electricity production and storage facilities`
- 几何：
  - 对大多数登记设施按点对象承接
  - 对 `<36kW` 聚合部分不强行点化，可单独做统计补充或暂不入主层
- 最小字段集建议：
  - `name`
  - `facility_subtype`
  - `operator`
  - `commissioning_status`
  - `capacity_mw`
  - `source_update`
  - `precision_class`

`precision_class` 很重要，因为法国这里天然存在“精确设施记录”和“IRIS 聚合记录”的差别。

## 8. 风险与下一步建议

### 8.1 风险

- 如果图层名称只写“能源设施”，用户会自然误解为已经覆盖所有子类
- 小型分布式装置公开精度受法规约束，不能用想当然方式补成精确点
- 若把 2019 的燃气大基础设施数据直接并入主层，会同时引入旧数据和线网污染
- 炼油厂等子类如果没有统一官方 GIS，后续很容易滑向 Tier C 补点

### 8.2 下一步建议

1. 首版只落 `全国电力生产与储能设施`。
2. 把 `<36kW` 单独视为聚合统计对象，不与精确设施点混表。
3. 另开一个扩展研究表，专门评估：
   - LNG 终端
   - 储气库
   - 炼油厂
   - 油库
4. 在没有统一官方 GIS 主源前，不把这些扩展子类硬塞进首版主层。

## 9. 试点判断

`能源设施` 在法国是可以做试点的，但不适合当第一优先。

它的最佳角色是：

- 作为第二顺位试点
- 用来验证“国家登记型设施数据”如何承接
- 同时建立仓库里对 `precision_class` 和 `scope_note` 的字段习惯

## 10. 关键来源

- 全国电力生产与储能设施登记：https://www.data.gouv.fr/datasets/registre-national-des-installations-de-production-et-de-stockage-delectricite-au-31-01-2026
- 法国大燃气基础设施数据：https://www.data.gouv.fr/datasets/grandes-infrastructures-gazieres-en-france
- 法国主要 LNG 终端日度库存数据：https://www.data.gouv.fr/datasets/evolution-quotidienne-des-stocks-de-gnl-des-principaux-terminaux-methaniers-en-france/
