# 法国铁路试点探索归档

日期：2026-03-28

## 1. 一句话结论

法国铁路这条线当前最稳的判断是 `官方主源 + OSM 补缺`：SNCF Réseau 的官方线网和官方车站来源已经足够构成全国主轴，OSM 只需要保留给生命周期补充和个别边缘缺口。

## 2. 研究边界

- 研究对象固定为 `铁路线 + 主要车站`
- 不研究时间轴
- 不研究班次、routing、运行图
- 不研究全量车站
- 不把城市轨道运营信息、客流、票务信息并入首版

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Fichier de formes des lignes du RFN](https://www.data.gouv.fr/datasets/fichier-de-formes-des-lignes-du-rfn/) | 法国全国 RFN | 线 | data.gouv 页面显示 2026-02-19 更新；资源文件时间口径主要为 2022-03-24 | ODbL 1.0 | Tier A | 是 | 当前最稳的全国官方线路主源 |
| [Gares de voyageurs du réseau ferré national](https://transport.data.gouv.fr/datasets/gares-de-voyageurs-1?locale=en) | 法国全国旅客车站 | 点 | 资源显示 2026-03-28 修改 | 页面未直观展示统一开放许可句式，落地前需回源复核 | Tier A | 是，作为主要车站主源 | 题目最对，但许可展示不如数据集本体清楚 |
| [Gares du réseau ferré national](https://www.data.gouv.fr/datasets/gares-du-reseau-ferre-national/) | 法国全国车站对象 | 点 | 页面显示 2024-03-28 更新，资源文件可见 2026-02 时间口径 | 页面显示 `licence-odc-odbl` 及特定使用条件 | Tier A | 可作后备/核对 | 适合补齐非旅客站和核对名称 |
| [OpenStreetMap / Geofabrik France](https://download.geofabrik.de/europe/france.html) | 法国全国 | 线、点 | 近乎日更 | ODbL 1.0 | Tier C | 只作补缺 | 适合补生命周期状态和边缘缺口，不应反客为主 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 线路主源：`Fichier de formes des lignes du RFN`
- 主要车站主源：`Gares de voyageurs du réseau ferré national`

### 4.2 后备源

- `Gares du réseau ferré national`
- `OpenStreetMap / Geofabrik France`

### 4.3 排除项

- 客流、班次、票务和运营图
- 全量小站点专题
- 只给统计不给几何的铁路报告

## 5. 与现有仓库架构的承接判断

- 适合 `独立 deferred context layer pack`
- 线路和主要车站应拆成两组资源
- 线路可复用日本铁路的 `status + class` 思路
- 车站继续保留 `主要车站` 口径，不把法国全量旅客站一次性塞进首版

## 6. 与日本最明显的不同

- 日本更像“铁路专题产品规格先在”；法国更像“官方业务数据集 + 开放平台发布”。
- 法国官方线网里铁路生命周期信息的业务背景更强，但文件时间口径不如页面更新时间那样新，需要显式写清。
- 法国主要车站数据能直接从官方旅客车站层切入，这一点并不弱于日本。

## 7. 风险与下一步建议

1. 最大风险是把 data.gouv 页面更新时间直接误当几何更新时间。
2. 第二个风险是把全量车站当作首版默认范围，导致点密度失控。
3. 建议首版继续沿用日本的 `官方主源 + OSM 补缺` 路线，不要把法国铁路重新改成 `OSM 主几何`。

## 8. 关键来源

- <https://www.data.gouv.fr/datasets/fichier-de-formes-des-lignes-du-rfn/>
- <https://transport.data.gouv.fr/datasets/gares-de-voyageurs-1?locale=en>
- <https://www.data.gouv.fr/datasets/gares-du-reseau-ferre-national/>
- <https://download.geofabrik.de/europe/france.html>
