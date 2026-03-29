# 美国公路专题研究归档

日期：2026-03-28

## 1. 一句话结论

如果美国公路首版只研究 `最新快照` 且只收 `motorway / trunk / primary`，那么美国这条线的官方主源是可以直接成立的：`2024 TIGER/Line Roads` 能提供当前全国道路几何，`FHWA NHPN` 能补“国家主干公路系统”口径，首版没有必要默认退回到 OSM 做主几何。

## 2. 研究边界

- 只研究 `最新快照`
- 只看：
  - `motorway`
  - `trunk`
  - `primary`
- 不研究：
  - 历史回溯
  - routing
  - `secondary` 及以下
  - 复杂节点体系
  - 互通点专题

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Census `2024 TIGER/Line Roads`](https://www.census.gov/cgi-bin/geo/shapefiles/index.php?layergroup=Roads&year=2024) | 美国全国，分州 | 线 | 2024 版 | 联邦公开地理数据，适合研究与产品评估；页面未见明显限制性条款 | Tier A | 是 | 当前快照口径清楚，主干与全道路都能取到，是最现实的官方当前几何主源 |
| [NTAD `Census TIGERLine Roads 2021-Present`](https://rosap.ntl.bts.gov/view/dot/87774) | 美国全国 | 线 | 2021-present；归档页含 2024 各区域包 | 联邦公开归档，可研究与产品评估 | Tier A | 是，偏工程化入口 | 适合工程使用与全国整合，也证明 TIGER 路网仍在持续纳入 NTAD |
| [FHWA `National Highway Planning Network (NHPN)`](https://rosap.ntl.bts.gov/view/dot/54952) | 美国全国 | 线 | 1996-present | 联邦公开归档，可研究与产品评估 | Tier A | `部分适合` | 它对“国家主干公路系统”很强，但范围天然收在 major highway system，不适合单独承担全部 `primary` 口径 |
| [OpenStreetMap / Geofabrik U.S.](https://download.geofabrik.de/north-america/us.html) | 美国全国 | 线 | 日更 | ODbL 1.0 | Tier C | `只能作后备` | 如果以后要补官方分类之外的边缘特征可用，但首版不必让 OSM 反客为主 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 当前主几何：`2024 TIGER/Line Roads`
- 主干路网强化判断：`FHWA NHPN`

这意味着美国公路首版可以明确写成：

- `官方主几何可成立`
- `官方主源不缺位`
- `OSM 不必进入首版主链路`

### 4.2 后备源

- `NTAD Census TIGERLine Roads 2021-Present`
  - 用途：更适合全国打包和归档式接入
- `OpenStreetMap / Geofabrik`
  - 用途：如后续需要验证名称、编号或边缘段，可做后备 QA

### 4.3 排除项

- 地方级收费道路数据库
- routing 专用数据
- 二手导航底图
- 为了“看起来更全”而把 `secondary` 以下全放进首版

## 5. 与现有仓库架构的承接判断

美国公路和日本不同，不必预设 `OSM 主几何 + 官方加固`。

更稳的承接判断是：

- `roads` pack：官方主几何可直接成立
- `road_labels` pack：可用 TIGER 路号与 NHPN/NHS 口径做编号与等级辅助
- 前端继续按现有方法做：
  - 等级过滤
  - 缩放分层
  - 懒加载

## 6. 与日本最明显的不同

美国和日本在公路上的最大差异，是 `美国全国当前主干路网官方主源更强`。

- 日本公路更适合 `OSM 主几何 + 官方高速加固`。
- 美国公路则可以直接让官方主源成立。
- 日本的核心工程问题是“怎么不让 OSM 和官方打架”。
- 美国的核心工程问题更像“怎么把官方路网分类稳定映射到产品等级，并控制线密度”。

## 7. 风险与下一步建议

1. 最大风险不是缺源，而是把官方道路分类直接等同于产品显示等级。
2. `TIGER` 很全，但如果不做严格过滤，会把大量低价值路段带进来。
3. `NHPN` 很适合当主干公路强化层，但不能简单替代全部 `primary` 范围。
4. 首版建议：
   1. 以 `2024 TIGER Primary Roads + Primary and Secondary Roads` 为主几何池
   2. 用 `NHPN` 做国家主干系统强化与 QA
   3. 仍然只收 `motorway / trunk / primary`
   4. 明确把 OSM 放在后备位置，而不是默认主链路

## 8. 关键来源列表

- [2024 TIGER/Line Roads](https://www.census.gov/cgi-bin/geo/shapefiles/index.php?layergroup=Roads&year=2024)
- [NTAD Census TIGERLine Roads 2021-Present](https://rosap.ntl.bts.gov/view/dot/87774)
- [FHWA NHPN 数据集](https://rosap.ntl.bts.gov/view/dot/54952)
- [OpenStreetMap / Geofabrik U.S.](https://download.geofabrik.de/north-america/us.html)
