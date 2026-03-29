# 德国工业矿产研究草稿

日期：2026-03-28

## 1. 一句话结论

如果德国这条线的目标严格定义为 `工业矿物/浅层原料的矿床与资源分布` 而不是“现势矿山企业清单”，那么 [BGR KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html) 可以构成首版全国官方主源，但要接受它是 `1:200,000 图系`、以 `资源区面 + 开采点/重点符号` 表达、且高分辨率细化天然下沉到联邦州地调。

## 2. 研究边界

- 研究对象是 `工业矿物/浅层原料的矿床 / 资源分布 / 资源潜力`
- 不承诺反映当前是否在产
- 不把企业经营主体、产量、储量动态混进首版主层
- 允许首版保留面状资源区，而不是强行点化

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适合当主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [BGR - KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html) | 德国全国，55 幅图 | 面为主，附开采点/重点符号 | 页面标注 `Bearbeitungsstand 03/2014`；2026-03-28 仍可通过 BGR 体系访问 | BGR 产品页说明数字数据可免费获得，但未见类似 CC BY 的统一开放许可；应按 Produktcenter / BGR AGB 使用 | Tier A | 是 | 这是当前最贴题的全国官方资源分布主轴，语义对题，但不是“现势矿山 POI 库” |
| [BGR Geoportal](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/Geoportal/geoportal_node_en.html) | 德国全国及国际专题入口 | 视具体图层而定 | 持续维护 | 下载与复用边界按具体产品单独确认 | Tier A | 否 | 更像官方目录和分发入口，适合查图层、查下载、做复核 |
| [BGR Webdienste](https://www.bgr.bund.de/DE/Themen/Geodatenmanagement/Webdienste/webdienste_node.html) | 德国全国专题服务入口 | WMS 等服务几何视图层而定 | 持续维护 | 明确有 Web 服务和 Atom 下载，但具体许可仍随产品走 | Tier A | 否 | 适合工程接入和可视化，不等于单一矿产主数据集 |
| [BGR 地学分工说明](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/geoinformationen_node_en.html) | 全国制度说明 | 无 | 现行说明页 | 无直接下载许可问题 | Tier A | 否 | 关键约束：BGR 负责 `1:250,000 及更小比例尺` 的全国面状数据，更高分辨率由各州地调负责 |
| 各州地质调查机构（由 BGR/Geoportal 继续下钻） | 州级 | 点/线/面不一 | 各州不同 | 许可、下载格式、公开程度各州不同 | Tier A | 否，全国层面不适合 | 这是后续细化不可绕开的补充层，但不能替代全国主源 |
| [DERA / BGR 德国原料形势报告](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Downloads/rohsit-2021.pdf?__blob=publicationFile&v=4) | 德国全国 | 无稳定 GIS 几何 | 2021 | 报告可读，不能直接当 GIS 主几何 | Tier B | 否 | 适合做背景判断、矿种重要性和口径核对，不适合做空间主源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- [BGR KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html)

主因不是“它最新”，而是“它最对题”：

- 它明确描述的是德国 `oberflächennahe Rohstoffe` 的 `Vorkommen und Lagerstätten`
- 页面明确写出图上既有 `Lagerstätten- bzw. Rohstoffflächen`，也有 `Abbaustellen` 或其重点
- 它是全国统一图系，不是临时拼接企业站点

### 4.2 后备源

- [BGR Geoportal](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/Geoportal/geoportal_node_en.html)：用于定位具体产品、检查图层存在性、寻找下载入口
- [BGR Webdienste](https://www.bgr.bund.de/DE/Themen/Geodatenmanagement/Webdienste/webdienste_node.html)：用于服务式接入、在线复核
- 各州地调数据：用于后续做重点州的高分辨率补丁
- [DERA / BGR 原料形势报告](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Downloads/rohsit-2021.pdf?__blob=publicationFile&v=4)：用于矿种和政策背景核对

### 4.3 排除项

- 现势矿山企业目录
- 企业年报里的矿山资产表
- 只给矿权说明不给统一几何的数据
- 把“矿产资源分布”误替换成“采矿企业分布”

## 5. 与现有仓库架构的承接判断

德国矿产线不建议照搬日本的“先做点层”。

更稳的承接方式是：

1. 建 `mineral_resources` 独立资源包。
2. 首版以 `resource_areas` 面层承接 KOR 200 的资源区面。
3. 如后续产品端只接受点，再从面层派生 `representative_points`，不要在研究稿阶段先损坏语义。
4. 若后续真要做联邦州细化，再单独开 `state_detail` 子表，不要把州级精细数据硬拼进全国总表。

## 6. 德国和日本相比最明显的不同

最明显的不同不是矿种本身，而是数据组织方式。

- 日本更接近直接找到全国统一资源点清单。
- 德国更接近“全国官方图系 + 州级高分辨率补充”的结构。
- 这不是偶然，而是制度分工结果：BGR 自己就明确说明，全国面状地学数据做到 `1:250,000 及更小比例尺`，更细由州级机构负责。

这意味着德国首版比日本更需要接受：

- 全国主源是中比例尺图系
- 精细化天然要分州推进
- 几何很可能不是“一个简单 CSV 点表”就能解决

## 7. 风险与下一步建议

### 7.1 风险

1. 如果产品侧强行要求“全国矿产点”，会把德国主源的原始语义压扁。
2. KOR 200 的时间口径不新，适合表达资源分布，不适合暗示现势开发强度。
3. 这套主源更贴近 `oberflächennahe Rohstoffe`；如果以后业务扩到金属矿，全国公开主源仍需另补 BGR/州级专题。
4. 许可虽然看起来比商业数据友好，但没有查到像 MaStR 或 LBM-DE 那样一眼清楚的开放许可句式，落地前仍要逐产品复核。

### 7.2 下一步建议

1. 先从 BGR Geoportal / Produktcenter 确认 KOR 200 可提取的实际下载格式和字段结构。
2. 先抽样验证莱茵褐煤带、德国北部盐类/钾盐区、南部工业矿物区等典型区域。
3. 首版产品文案统一写成 `资源分布`，不要写成 `在产矿山`。
4. 如果后续业务要扩到金属矿或更细尺度，再以州为单位补充州地调与 BGR 其他专题数据。

## 8. 本轮使用的关键来源

- Tier A: [BGR - KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html)
- Tier A: [BGR - Geoportal](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/Geoportal/geoportal_node_en.html)
- Tier A: [BGR - Webdienste](https://www.bgr.bund.de/DE/Themen/Geodatenmanagement/Webdienste/webdienste_node.html)
- Tier A: [BGR - Geodatenmanagement / 分工说明](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/geoinformationen_node_en.html)
- Tier A: [BGR - Produktcenter / 产品说明入口](https://www.bgr.bund.de/EN/Gemeinsames/Produkte/produkte_node_en.html)
- Tier B: [DERA / BGR - 德国原料形势报告 2021](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Downloads/rohsit-2021.pdf?__blob=publicationFile&v=4)
