# 法国交通专题研究总览

日期：2026-03-28

## 1. 一句话结论

法国这四条线里，`铁路` 最适合先试点，`机场` 次之，`公路` 适合按 `OSM 主几何 + 官方属性加固` 推进，`港口` 虽然有官方开放源，但更像“开放得足够、口径不够干净”的设施层。

## 2. 四条线总体成熟度判断

| 线别 | 总体成熟度 | 当前最强判断 | 结论 |
|---|---|---|---|
| 铁路 | 高 | SNCF Réseau 官方线网 + 官方车站数据已经能构成全国主轴 | 最适合先试点 |
| 公路 | 中 | 当前全国最新主干路网几何仍更适合用 OSM，官方更适合做等级与国家干线加固 | 可以做，但不宜假装有完美官方全国主源 |
| 机场 | 中高 | 官方国家级机场清单和坐标查询都存在，但没有日本那样一份干净的开放机场点包 | 可以做，且点图层方向明确 |
| 港口 | 中 | 官方开放港口与港区数据存在，但对象集合过宽、需要再筛商港和主要节点 | 可以研究并做样层，但比机场更碎 |

## 3. 哪条线最适合先试点

当前最适合法国先试点的是 `铁路`。

原因很直接：

- 国家级官方线网和车站来源都存在
- 主题边界比道路、港口更清楚
- 和现有仓库的 `线图层 + 主要点位` 承接方式最贴合
- 与日本对照时，也最容易保持方法一致

如果你希望先做设施点层而不是线层，法国第二适合试点的是 `机场`。

## 4. 和日本最明显的差异

- 日本铁路和机场都更接近“一份专题地理包直接拿来用”；法国更常见的是 `官方业务库 + 开放平台分发 + 条件页` 的组合。
- 日本公路至少在高速专题上更容易找到官方锚点；法国当前全国主干路网如果要求 `最新快照 + motorway/trunk/primary`，更现实的方案仍然是 `OSM 主几何`。
- 日本港口研究时最大问题是旧和非商用；法国港口更像“数据较新且开放，但对象集合太宽，不是天然的主要商港点层”。

## 5. 哪些地方必须降级到非官方但可信公开源

当前最明确需要降级的是 `公路` 的全国最新主干路网几何。

- 如果要做 `最新快照` 的 `motorway / trunk / primary`，当前最稳的主几何仍然是 OSM 系来源。
- 法国官方路网开放数据要么覆盖的是国家公路体系的一部分，要么时间口径不够新，要么并不天然等于产品需要的功能等级路网。

其余三条线目前都能先以官方或准官方来源起步，不需要一开始就降级到 Tier C。

## 6. 与现有仓库架构的承接判断

- `rail`
  - 适合 `独立 deferred context layer pack`
  - 线路和主要车站分开
- `road`
  - 适合 `roads + road_labels` 双 pack
  - 先做缩放分层和降噪
- `airports`
  - 适合复用 `cityPoints` 风格链路
- `ports`
  - 也适合点图层优先，但要接受先从官方港区/港口对象里筛主要商港再派生点

## 7. 风险与下一步建议

1. 法国四条线里，最容易误判的是 `港口`，因为官方数据开放不等于它已经天然适合“主要商港点层”。
2. 法国 `公路` 的最大风险是把国家级官方专题道路数据误说成“全国当前主干路网主源”。
3. 法国 `机场` 的最大风险是把官方查询平台误说成“现成可直接入产品的统一开放点包”。
4. 建议的法国交通推进顺序：
   1. `铁路`
   2. `机场`
   3. `公路`
   4. `港口`

## 8. 关键来源

- SNCF Réseau `Fichier de formes des lignes du RFN`：<https://www.data.gouv.fr/datasets/fichier-de-formes-des-lignes-du-rfn/>
- `Gares de voyageurs du réseau ferré national`：<https://transport.data.gouv.fr/datasets/gares-de-voyageurs-1?locale=en>
- `Réseau routier dans OpenStreetMap`：<https://www.data.gouv.fr/datasets/reseau-routier-dans-openstreetmap/>
- `Hiérarchisation du réseau routier national`：<https://www.data.gouv.fr/datasets/hierarchisation-du-reseau-routier-national/>
- `ROUTE 500`：<https://transport.data.gouv.fr/datasets/route-500?locale=en>
- PIAF `airports table`：<https://piaf.stac.aviation-civile.gouv.fr/airports/table>
- SIA `AIP FRANCE AD 1.3`：<https://www.sia.aviation-civile.gouv.fr/documents/html/aip_france/AIP/AD-1.3_fr.html>
- `Ports - Espace maritime français`：<https://www.data.gouv.fr/datasets/ports-espace-maritime-francais>
- Ministère de la Transition écologique `Les ports maritimes de France`：<https://www.ecologie.gouv.fr/les-ports-maritimes-france>
