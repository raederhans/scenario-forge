# 英国工业矿产探索归档

日期：2026-03-28

## 1. 一句话结论

如果英国这条线的目标是 `矿床 / 资源分布`，而不是“现役采场”，那么当前最强的 Tier A 不是像日本那样一份全国统一点资源集，而是 BGS 的 `Mineral resources` 规划型资源范围面加上 MineralsUK / GSNI 的分区矿产资源图系；它们足够支撑研究，但还不等于一份可以无条件直落的 `UK 全国统一点主层`。

## 2. 研究边界

本轮固定边界如下：

- 研究对象是 `矿床 / 资源分布`
- 不把现役矿山、产量、企业经营状态当成主语义
- 不先承诺 UK 全国统一的资源区面产品层
- 只接受题对的官方地调 / 矿产资源信息，不用新闻、招商、企业名录偷换

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 / 时间口径 | 许可 / 使用边界 | Tier | 适合作为主源吗 | 判断 |
|---|---|---|---|---|---|---|---|
| BGS [`Mineral resources`](https://www.bgs.ac.uk/datasets/bgs-mineral-resources/) | England、Wales、Scotland central belt | 面（GIS polygon） | 产品页未给单一年度；页面显示现行产品，相关图系主要出自 1990s-2010s 规划系列 | 免费样本数据可在 OGL 下获取，但完整数据为 `Licensed` 付费产品 | Tier A | `部分适合` | 是 Great Britain 核心资源分布最强官方锚点，但并不覆盖整个 UK，也不是点数据 |
| MineralsUK [`Downloads`](https://www.bgs.ac.uk/mineralsuk/downloads/) 中的 Northern Ireland / Scotland / Wales 矿产资源图系 | Northern Ireland 分县；Scotland、Wales 分区域 | 以图件 / 报告为主，本质是资源范围面，但多为 PDF / 报告而非现成统一 GIS | Northern Ireland 与 Scotland 图系主要为 1990s-2010s 发布 | 页面未给统一开放许可；多数下载是报告 / 地图产品，复用边界需逐项核对 NERC / BGS 条款 | Tier A | `不适合作为单一主源` | 能补齐 NI 与 Scotland/Wales 的官方依据，但碎片化，机器可用性弱 |
| BGS [`BritPits` 2026 更新说明](https://www.bgs.ac.uk/news/map-of-bgs-britpits-showing-the-distribution-of-worked-mineral-commodities-across-the-country/) | Great Britain、Northern Ireland、Isle of Man、Channel Islands | 点 / WMS 索引 | 年更；最新版本 2026-02 发布 | 开放索引包为 OGL；全量库分层授权 | Tier A | `不适合` | 题目不对。它是矿山 / 采场 / 工业矿产作业点，不是矿床资源分布 |
| MineralsUK `United Kingdom Minerals Yearbook 2024`（见 [Downloads 页](https://www.bgs.ac.uk/mineralsuk/downloads/)） | UK | 无几何 | 年报，2024 | 统计出版物可引用，但不提供统一 GIS 几何 | Tier A | `不适合` | 适合做矿种与区域分布的统计校验，不适合直接成图 |

## 4. 为什么英国主源不像日本那样干净

日本这条线可以直接落在 GSJ 的全国点状资源数据集上，几何和产品语义几乎天然对齐。

英国最明显不同在于：

- 最强官方源是 `规划型矿产资源范围面`，不是全国点状矿床目录
- Great Britain 与 Northern Ireland 仍要跨 BGS / GSNI 体系拼接
- 完整可用数据有明显许可门槛，开放部分往往只是样本或索引

所以英国矿产线真正的第一性问题不是“有没有矿产数据”，而是：

`有没有一份题对、全国统一、机器可用、许可清晰、还能保持点层承接的官方主源？`

当前答案是否定的。

## 5. 英国主源 / 后备源 / 排除项

### 5.1 主源

- Great Britain 核心：BGS `Mineral resources`
- Northern Ireland 佐证：MineralsUK / GSNI `Mineral resource maps, Northern Ireland`

这里必须写清：这不是一份已经现成统一好的 `UK 全国主层`，而是一组最强 Tier A 资源图系。

### 5.2 后备增强

- BGS `BritPits`：仅用于核对哪些矿产带确实存在采掘活动、历史工作点和矿种名称
- `United Kingdom Minerals Yearbook 2024`：仅用于矿种与区域统计校验，不参与几何定义

### 5.3 当前排除

- 现役矿山 / quarry / mine 名录直接替代矿床资源分布
- 企业采场、矿权、经营主体目录
- 以地方规划许可或历史采矿许可边界替代矿产资源范围

## 6. 与日本相比最明显的不同

这条线与日本最明显的不同是：

`日本是“全国点资源集先在”，英国是“分区域资源范围图先在”。`

具体来说：

- 日本主源几何是点；英国最强官方几何是面
- 日本主源全国统一；英国官方资源图在 UK 口径下仍有 Great Britain / Northern Ireland 拼接问题
- 日本主源题目本身就是资源分布；英国公开可见、更新更勤的 BritPits 反而更接近采场活动点，不应偷换成资源层

## 7. 与现有仓库架构的承接判断

这里必须老实写：英国官方矿产主源与当前仓库里 `mineral_resources` 默认点层承接是有冲突的。

最稳的判断是：

- 不建议把 BGS `Mineral resources` 的资源范围面图心点化，再强行塞进 `cityPoints` 风格链路
- 如果产品必须坚持英国也走点层，那么当前应判定为 `主源缺口仍在`
- 如果允许国家例外，英国矿产更适合在研究阶段保留为 `polygon/context layer` 候选，而不是先求 schema 对齐

因此本专题对仓库的承接建议应写成：

- `mineral_resources` 在英国不宜直接照搬日本点层实现
- 若后续真要落产品，应先单独决策：接受英国 country exception，还是接受当前不落首版

## 8. 风险与下一步建议

### 8.1 当前主要风险

- 最容易误判的是把 `BritPits` 当成英国矿产资源主源；它题不对
- 第二个风险是因为架构偏好点层，就把官方资源范围面粗暴点化
- 第三个风险是误以为 BGS `Mineral resources` 已经完整覆盖整个 UK

### 8.2 下一步建议

1. 如果目标是 `研究归档`，当前证据已足够：英国矿产线有强 Tier A，但不是单一 UK 点主层
2. 如果目标是 `Great Britain 先试`，可进一步评估 BGS `Mineral resources` 授权条件与字段结构
3. 如果目标是 `UK 全国统一首版`，应先补 Northern Ireland 的机器可用几何获取路径，否则保留明确缺口
4. 如果业务坚持点层，只能继续找新的官方点状矿床目录；在找到前不要做启发式图心补丁

## 9. 本稿关键来源

- BGS `Mineral resources`：<https://www.bgs.ac.uk/datasets/bgs-mineral-resources/>
- MineralsUK Downloads：<https://www.bgs.ac.uk/mineralsuk/downloads/>
- BGS BritPits 2026 更新说明：<https://www.bgs.ac.uk/news/map-of-bgs-britpits-showing-the-distribution-of-worked-mineral-commodities-across-the-country/>
