# 德国港口专题研究归档

日期：2026-03-28

## 1. 一句话结论

德国港口可以做，但最稳的结论不是“单一官方业务专题源已经完美就位”，而是 `官方点位主源可用 + 准官方港口语义补强`：全国官方开放点位主源可用，不过如果首版目标是“主要商港/关键港口节点”，还需要准官方海事来源来筛掉不相关港点。

## 2. 研究边界

- 只研究 `设施本体`
- 只做 `点图层优先`
- 只优先收 `主要商港/关键港口节点`
- 不研究航路、港域界、港湾区域线、渔港专题
- 当前判断以是否适合做上下文设施点层为准

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适不适合作为主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [BKG POI-Open](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/poi-open.html) | 德国全国 | 点 | 产品页说明半年更新一次 | BKG 开源数据，适用 `Datenlizenz Deutschland – Namensnennung – Version 2.0` | Tier A | 是，但只适合几何主源 | 这是当前最稳的全国官方开放港口点位源，但它不自动等于“主要商港/关键港口业务层” |
| [German Maritime Centre Maritime Map](https://dmz-maritim.de/en/maritime-map/) | 德国海港与内河港等海事主体 | 点和名录视图 | 页面说明为持续更新和扩展 | 准官方公共机构工具页，可用于核对港口类型、联系方式和部分处理数据；不是标准开放下载主源 | Tier B | 否，适合作为语义补强 | 很适合把“港口点”收敛成“主要商港/关键港口节点” |
| [ELWIS / Inland ECDIS and waterway information](https://www.elwis.de/DE/dynamisch/karten/index.php) | 德国内河航道体系 | 线、面、航道服务信息 | 持续维护 | 官方航道信息服务，偏航道与航运信息，不是全国港口点主源 | Tier A | 否 | 适合作为未来航道层参考，不适合当前港口设施点层 |
| [Geofabrik Germany / OpenStreetMap](https://download.geofabrik.de/europe/germany.html) | 德国全国 | 点、线、面 | 频繁更新 | ODbL；衍生使用需遵守 OSM 规则 | Tier C | 是，但只适合作为补缺 | 若部分港口命名、类别或点位缺失，可降级补缺，但不能冒充官方主源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `BKG POI-Open` 作为全国港口点位几何主源

### 4.2 后备源

- `DMZ Maritime Map`：用于筛选和核对哪些港口应进入“主要商港/关键港口节点”
- `OSM / Geofabrik Germany`：只在明确缺口时做有限补缺

### 4.3 排除项

- 航路、航道网络
- 港域边界和港区面
- 渔港专题
- 把所有港点一股脑当成“主要商港层”而不做筛选

## 5. 与现有仓库架构的承接判断

德国港口最适合走和机场一样的点图层路线：

- 图层名直接落到 `ports`
- 几何保持为点
- “是否属于主要商港/关键节点”的判断在构建期完成，不塞进前端渲染逻辑

比较稳的首版结构是：

- `ports_all_official_points`：全国官方港口点位全集
- `ports_major`：基于 `DMZ Maritime Map` 等来源筛出的主要海港和重点内河港子集

## 6. 与日本最明显的不同

日本港口试点面临的核心问题是官方专题源较旧、许可边界更敏感；德国这边更像“官方开放点位有了，但业务语义要靠第二层去收敛”。

- 日本的问题更偏“专题源能不能直接产品化”
- 德国的问题更偏“全国开放点位可用，但哪些算首版关键港口需要再筛”

## 7. 风险与下一步建议

### 7.1 风险

1. 仅用 `POI-Open` 会得到“全国港点集合”，不一定天然等于“主要商港/关键港口节点”。
2. `DMZ Maritime Map` 很有用，但它不是一个标准开放下载主源，适合作为筛选和核对层，不适合冒充几何主源。
3. 如果后续把目标扩成港域边界、码头、航道体系，当前结论就不够用了，必须另开专题层。

### 7.2 下一步建议

1. 首版德国港口先跑通 `POI-Open` 点位层。
2. 用 `DMZ Maritime Map` 收敛成“主要商港/关键港口节点”子集，优先覆盖汉堡、不来梅/不来梅港、威廉港、罗斯托克、杜伊斯堡等关键节点。
3. 如果出现局部点位缺失，再显式降级到 `OSM` 补缺，并把许可风险写清。

## 8. 关键来源列表

- Tier A: [BKG POI-Open](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/poi-open.html)
- Tier B: [German Maritime Centre Maritime Map](https://dmz-maritim.de/en/maritime-map/)
- Tier A: [ELWIS Karten und Wasserstraßeninformationen](https://www.elwis.de/DE/dynamisch/karten/index.php)
- Tier C: [Geofabrik Germany](https://download.geofabrik.de/europe/germany.html)
