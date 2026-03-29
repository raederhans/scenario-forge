# 德国铁路专题研究归档

日期：2026-03-28

## 1. 一句话结论

按当前项目的 `context layer` 目标，德国铁路可以明确走 `官方主源 + OSM 补缺`：官方全国开放主源可用但偏泛化，适合做铁路线骨架与主要客运站；如果目标抬高到运营级高精度铁路网络，则 `官方全国主源缺口成立`，因为详细的 `StreckeDB` 并不向公众开放。

## 2. 研究边界

- 研究对象只包括 `铁路线` 和 `主要车站`
- 首版只讨论 `最新快照`，不讨论时间轴
- 不研究班次、routing、运行图、线路容量、信号系统
- 不研究全量小站和全部铁路设施物件
- 当前判断以是否适合做本仓库的上下文图层为准，不以运营调度级 GIS 为准

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [BKG Open Data / DLM250](https://www.bkg.bund.de/DE/Produkte-und-Dienste/GDZ/OpenData/OpenData.html) | 德国全国 | 线 | BKG 公开说明为持续维护的全国开源基础地理数据；DLM250 为 1:250,000 级别 | BKG 开源数据，适用德国数据许可 `Datenlizenz Deutschland – Namensnennung – Version 2.0` | Tier A | 是，但只适合上下文层主骨架 | 这是当前能公开拿到的全国官方铁路线几何主源，但它是泛化后的基础地理产品，不是运营级铁路网 |
| [Deutsche Bahn Open Data / OpenStation](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-data) | 德国客运站点全国范围 | 点 | DB 开放接口持续在线更新 | DB 开放数据页面标注 `CC0 1.0` | Tier A | 是，适合作为主要客运站主源 | 官方、开放、站点语义明确，但它是客运站点源，不是完整铁路设施源 |
| [BKG 产品目录中的 StreckeDB 说明](https://www.bkg.bund.de/SharedDocs/Downloads/BKG/DE/Publikationen/Downloads-DE-Flyer/BKG-Produktkatalog-Bund.pdf?__blob=publicationFile&v=51) | 德国全国 | 线、点及多类铁路设施 | 产品目录写明年度更新 | 仅供联邦机构在 DB InfraGO 同意后用于法定任务，不是公众开放主源 | Tier A | 否 | 这说明德国存在更细的官方全国铁路数据，但它不是公众可直接产品化使用的开放源 |
| [Geofabrik Germany / OpenStreetMap](https://download.geofabrik.de/europe/germany.html) | 德国全国 | 线、点 | 频繁更新 | ODbL；衍生使用需遵守 OSM 署名和共享约束 | Tier C | 是，但只适合补缺 | 适合补充非 DB 线、细分类、命名、低级别站点与官方泛化层细节缺口 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- 线：`BKG DLM250` 作为全国官方开放线骨架
- 点：`DB OpenStation` 作为主要客运站点主源

对当前仓库来说，这个组合已经足够支持：

- 全国铁路主骨架显示
- 主要客运站点点层
- 低到中缩放级别的上下文表达

### 4.2 后备源

- `OSM / Geofabrik Germany`：补充细分类、线路命名、非 DB 线、官方泛化缺口
- `StreckeDB`：只作为“官方更细数据存在但不开放”的证据，不作为当前公开产品主源

### 4.3 排除项

- 班次、路线规划、运营调度数据
- 只面向联邦机构开放的 `StreckeDB` 细网直接落地
- 把全部运营站、线路设施、里程点、桥隧等一次性并入首版

## 5. 与现有仓库架构的承接判断

德国铁路可以直接复用日本铁路那套 `deferred context pack` 思路，但要把数据层拆清楚：

- `rail_lines`：官方线骨架包，主源为 `BKG DLM250`
- `rail_stations`：主要客运站点包，主源为 `DB OpenStation`
- 如果后续要补强，再增加 `rail_lines_osm_patch` 作为构建期补丁，不要在研究层把多源混成一张模糊主表

也就是说，仓库侧最稳的接法是：

- 线层按日本铁路的懒加载线包处理
- 点层复用现有 `city points` 的点图层承接方式
- 不把德国铁路硬做成运营级主拓扑

## 6. 与日本最明显的不同

和日本相比，德国铁路最明显的不同不是“没有官方数据”，而是“公开能拿到的官方全国数据层级偏基础地理，精细铁路网掌握在受限数据里”。

- 日本试点更像“官方专题数据做主底座，OSM 只补缺”
- 德国则更像“官方开放骨架 + 官方开放站点 + OSM 补细节”
- 所以德国铁路不是完全缺源，而是缺一个公众可直接使用、精度足够高、同时覆盖线与站的统一官方专题包

## 7. 风险与下一步建议

### 7.1 风险

1. `DLM250` 是 1:250,000 级别的泛化数据，适合上下文图层，不适合被误写成精细运营网。
2. `OpenStation` 解决的是客运站点，不等于完整铁路站场设施库。
3. 如果后续产品要求铁路细节接近日本官方专题层级，德国这条线必须承认“开放官方细网缺口”这个事实，不能靠措辞遮过去。

### 7.2 下一步建议

1. 首版德国铁路按 `官方主源 + OSM 补缺` 落地，但文档里明确限定为“上下文铁路层”。
2. 构建时先用 `DLM250 + OpenStation` 跑通，再决定是否引入 `OSM` 只做有限补强。
3. 如果业务以后要放大到高精度线位、桥隧、公里点等，直接另开专题并写明“公开官方主源缺口成立”。

## 8. 关键来源列表

- Tier A: [BKG Open Data](https://www.bkg.bund.de/DE/Produkte-und-Dienste/GDZ/OpenData/OpenData.html)
- Tier A: [BKG 产品目录（含 StreckeDB 说明）](https://www.bkg.bund.de/SharedDocs/Downloads/BKG/DE/Publikationen/Downloads-DE-Flyer/BKG-Produktkatalog-Bund.pdf?__blob=publicationFile&v=51)
- Tier A: [DB Open Data Marketplace](https://developers.deutschebahn.com/db-api-marketplace/apis/product/open-data)
- Tier C: [Geofabrik Germany](https://download.geofabrik.de/europe/germany.html)
