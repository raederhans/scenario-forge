# 德国工业区研究草稿

日期：2026-03-28

## 1. 一句话结论

如果德国这条线坚持研究 `真实园区 / 工业用地` 而不是规划工业分区，那么当前没有查到一个全国统一、公开、语义严格等于“命名工业园区”的 Tier A 主源；首版最稳妥的做法是把 [BKG LBM-DE2021](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-landschaftsmodelle/digitales-landbedeckungsmodell-deutschland-stand-2021-lbm-de.html) 的实际工业/商业用地类当成全国代理层，再用州级经济促进门户补命名园区。

## 2. 研究边界

- 研究对象是 `真实工业园区 / 工业用地 / 工业商业用地`
- 首版几何优先是 `面`
- 不用规划工业分区直接替代真实工业区
- 不把招商文章、园区新闻、企业园区宣传页直接当主几何

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适合当主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [BKG - LBM-DE2021](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-landschaftsmodelle/digitales-landbedeckungsmodell-deutschland-stand-2021-lbm-de.html) | 德国全国 | 面 | 参考年 `2021`；3 年更新周期；页面显示 2026-02-24 提供 GeoPackage、2025-03-28 切换为 CC BY 4.0 | 明确 `CC BY 4.0`，可共享、复制、改作，需按来源标注 | Tier A | 否，不能严格当“工业区主源”；可当全国代理层 | 这是当前最可落盘的全国公开官方面层，但语义是 CLC/土地覆盖分类里的 `121 Industrie-und Gewerbeflächen, öffentliche Einrichtungen`，不是命名园区清单 |
| [BKG - Basis-DLM](https://gdz.bkg.bund.de/index.php/default/digitales-basis-landschaftsmodell-ebenen-basis-dlm-ebenen.html) | 德国全国 | 面 | 当前产品状态 2026-01，数据更新到 2025-09 | 需签许可协议后获取；不是面向公众的无门槛开放下载 | Tier A | 否，开放首版不适合 | 语义更接近真实地表对象，含 `AX_IndustrieUndGewerbeflaeche`，但许可门槛高，不适合直接当公开主源 |
| [LBM-DE 文档里的 CLC 类 121](https://sgx.geodatenzentrum.de/web_public/gdz/dokumentation/deu/lbm-de2012.pdf) | 德国全国分类说明 | 面类定义 | 文档可访问；用于解释类目 | 跟随主数据许可 | Tier A | 否，说明文档 | 关键价值是确认全国代理层本质属于实际工业/商业/公共设施用地类，而不是规划区 |
| [Standortportal Bayern](https://www.invest-in-bavaria.com/info-center/standortportal) | 巴伐利亚州 | 点/面/条目视站点而定 | 门户页未给统一批量发布日期；按访问日 2026-03-28 记录 | 州级合作门户；适合查询，不等于统一开放全国底库 | Tier B | 否，全国层面不适合 | 由 Invest in Bavaria、巴州经济部和 IHK 合作运营，适合补充州级命名园区/可用地 |
| [Berlin Business Location Center - Immobilienportal](https://www.businesslocationcenter.de/immoportal/) | 柏林 | 点/面/条目视条目而定 | 门户页未给统一批量发布日期；按访问日 2026-03-28 记录 | 经济促进门户，含公私房地产业主条目；不是标准全国开源 GIS 数据 | Tier B | 否，全国层面不适合 | 适合补 Berlin 的命名产业空间和可用工业地块，但不应冒充全国主源 |
| 其他州级/市级招商主管门户与商会门户 | 多为州级、城市级 | 点/面/条目不一 | 不统一 | 需逐站确认 | Tier B / Tier C | 否 | 德国真实命名工业园区信息高度碎片化，这是后续补名录的现实来源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

这条线没有“语义完全对题”的全国 Tier A 主源。

因此本稿给出的结论不是虚构一个主源，而是：

- `全国代理层主源`： [BKG LBM-DE2021](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-landschaftsmodelle/digitales-landbedeckungsmodell-deutschland-stand-2021-lbm-de.html)
- `命名园区补充层`：州级经济促进门户，先以 [Standortportal Bayern](https://www.invest-in-bavaria.com/info-center/standortportal) 和 [Berlin Business Location Center](https://www.businesslocationcenter.de/immoportal/) 作为已确认入口

### 4.2 后备源

- [Basis-DLM](https://gdz.bkg.bund.de/index.php/default/digitales-basis-landschaftsmodell-ebenen-basis-dlm-ebenen.html)：如果项目以后具备许可，可作为更强的官方基础对象层
- 州级招商主管门户：用于补园区名称、招商语义、可用地块
- 城市级经济促进门户：用于补具体园区页面

### 4.3 排除项

- 规划工业分区
- 纯招商新闻
- 企业官网园区宣传页
- 只有地块销售而没有稳定范围语义的商业地产信息

## 5. 与现有仓库架构的承接判断

德国工业区不能被简化成一个层。

更稳的承接方式是：

1. 建 `industrial_zones` 独立资源包。
2. 把 `national_proxy_polygons` 和 `named_zone_registry` 分开。
3. `national_proxy_polygons` 用 LBM-DE 的 class 121 做国家级实际工业/商业用地代理。
4. `named_zone_registry` 单独存州级或城市级命名园区条目，并保留 `source_tier`。

这样做的好处是：

- 不会把“真实工业用地”与“招商命名园区”混成一个假统一图层。
- 后续哪个州补得好，就在哪个州提升质量，不影响全国底层。

## 6. 德国和日本相比最明显的不同

日本的工业区线可以更直接地指向全国统一的真实工业用地主层思路；德国没有这么顺手。

德国最明显的不同是：

- 全国公开官方层更像国家基础地表/地类模型。
- 真正的命名园区和可招商工业地块更常见于州级或城市级经济促进门户。
- 所以德国首版必须承认“双层结构”，而日本首版更接近“全国单层可用”。

## 7. 风险与下一步建议

### 7.1 风险

1. 这条线最容易被误做成“规划工业分区”。
2. LBM-DE 的 `121` 类包含 `Industrie-und Gewerbeflächen, öffentliche Einrichtungen`，语义比“工业园区”更宽。
3. 州级门户更新活跃，但数据结构高度不统一，难以一次性全国拼齐。

### 7.2 下一步建议

1. 首版明确把全国层命名为 `工业/商业实际用地代理层`，不要直接写成 `全国工业园区完整名录`。
2. 先挑 2 到 3 个工业核心州做命名园区补层，例如 Bayern、Berlin、NRW。
3. 产品端如果只允许一个层，宁可先上国家代理层，也不要用规划工业分区来凑。

## 8. 本轮使用的关键来源

- Tier A: [BKG - LBM-DE2021](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-landschaftsmodelle/digitales-landbedeckungsmodell-deutschland-stand-2021-lbm-de.html)
- Tier A: [BKG - Basis-DLM](https://gdz.bkg.bund.de/index.php/default/digitales-basis-landschaftsmodell-ebenen-basis-dlm-ebenen.html)
- Tier A: [LBM-DE 分类文档](https://sgx.geodatenzentrum.de/web_public/gdz/dokumentation/deu/lbm-de2012.pdf)
- Tier B: [Standortportal Bayern](https://www.invest-in-bavaria.com/info-center/standortportal)
- Tier B: [Berlin Business Location Center - Immobilienportal](https://www.businesslocationcenter.de/immoportal/)
