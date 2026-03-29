# 法国公路试点探索归档

日期：2026-03-28

## 1. 一句话结论

法国公路这条线当前最稳的判断是 `OSM 主几何 + 官方属性加固`：如果首版只做 `最新快照` 的 `motorway / trunk / primary`，当前最可靠的全国几何主源仍然是 OSM，官方数据更适合补国家路网层级与编号语义。

## 2. 研究边界

- 只研究 `最新快照`
- 只看 `motorway / trunk / primary`
- 不研究历史回溯
- 不研究 routing
- 不研究 `secondary` 及以下
- 不研究复杂节点体系

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Réseau routier dans OpenStreetMap](https://www.data.gouv.fr/datasets/reseau-routier-dans-openstreetmap/) | 法国全国 | 线 | data.gouv 页面显示 2026-03-26 更新 | ODbL 1.0 | Tier C | 是，作为当前几何主源 | 当前最接近全国最新主干路网快照 |
| [Hiérarchisation du réseau routier national](https://www.data.gouv.fr/datasets/hierarchisation-du-reseau-routier-national/) | 法国国家公路网络 | 线 | 页面显示 2025-08-05 更新 | Etalab Open Licence 2.0 | Tier A | 否，适合属性加固 | 只覆盖国家路网，不等于产品需要的全部 trunk/primary |
| [ROUTE 500](https://transport.data.gouv.fr/datasets/route-500?locale=en) | 法国全国 | 线 | 页面可见 2026-03-06 资源修改；数据版本说明仍为最终 2021 版 | 公开分发，但当前主要适合作参考层 | Tier A | 否，时间口径不足 | 全国覆盖好，但不适合承接“最新快照” |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 几何主源：`Réseau routier dans OpenStreetMap`

### 4.2 后备源

- `Hiérarchisation du réseau routier national`
- `ROUTE 500`

### 4.3 排除项

- 历史版本道路库
- 只覆盖国家公路的官方专题直接替代全国主干功能等级路网
- `secondary` 及以下道路

## 5. 与现有仓库架构的承接判断

- 适合 `roads + road_labels` 双 pack
- 前端继续按 `motorway / trunk / primary` 做缩放分层
- 官方数据只适合做 `official_ref`、国家道路层级和编号校正
- 不建议把法国官方专题道路数据直接当全国路网几何主源

## 6. 与日本最明显的不同

- 日本公路也是 `OSM 主几何 + 官方加固`，法国这点和日本反而接近。
- 不同之处在于法国国家路网官方等级数据更像强补强层，而日本高速专题的官方锚点更集中。
- 法国如果强行追求“官方几何主源”，更容易掉进时间口径不够新的问题。

## 7. 风险与下一步建议

1. 最大风险是把 `Hiérarchisation du réseau routier national` 误写成“全国当前主干路网主源”。
2. 第二个风险是把 `ROUTE 500` 当成现势快照，而忽略其最终版本仍是 2021。
3. 建议法国公路继续严格按 `OSM 主几何 + 官方属性加固` 推进，不要额外发明第四种策略。

## 8. 关键来源

- <https://www.data.gouv.fr/datasets/reseau-routier-dans-openstreetmap/>
- <https://www.data.gouv.fr/datasets/hierarchisation-du-reseau-routier-national/>
- <https://transport.data.gouv.fr/datasets/route-500?locale=en>
