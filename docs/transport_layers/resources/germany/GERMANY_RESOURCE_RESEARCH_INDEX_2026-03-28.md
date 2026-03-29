# 德国工业矿产、能源设施、工业区研究总览

日期：2026-03-28

## 1. 总体结论

德国这三条线里，`能源设施`最适合先试点，`工业矿产`可以做但要接受联邦制和图系尺度限制，`工业区`没有日本那种全国统一且语义精确的现成国家主源，首版必须把“全国代理层”和“州级补名录”拆开处理。

## 2. 三条线总体成熟度判断

| 线别 | 成熟度判断 | 现在能不能直接落盘 | 核心原因 |
|---|---|---|---|
| 能源设施 | 高 | 可以 | [Bundesnetzagentur MaStR](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/Marktstammdatenregister/start.html) 有全国统一、点状、公开下载、带坐标、更新频繁的官方主源。 |
| 工业矿产 | 中 | 可以 | [BGR KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html) 对 `工业矿物/浅层原料` 最贴题，是全国官方资源分布主轴，但它是 1:200,000 图系，且德国高分辨率地学数据天然分散到各州地调。 |
| 工业区 | 中低 | 可以，但必须写清“代理层” | 全国公开统一、语义严格等于“真实工业园区/工业用地”的官方主源没有查到；只能用 [BKG LBM-DE2021](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-landschaftsmodelle/digitales-landbedeckungsmodell-deutschland-stand-2021-lbm-de.html) 的实际工业/商业用地类做国家级代理，再用州级门户补命名园区。 |

## 3. 哪条线最适合先试点

最适合先试点的是 `能源设施`。

原因很直接：

1. 主源是联邦监管机构的正式登记系统，不是拼凑名录。
2. 几何天然是点，和“点状设施，不含管线”的任务边界完全对齐。
3. 公开数据下载和字段说明都比较完整，许可也最清楚。
4. 和日本相比，德国这条线反而更强，因为日本首版更像“较旧的全国发电设施锚点”，德国则是“持续更新的全国登记库”。

## 4. 和日本最明显的差异

### 4.1 总体差异

日本现成的全国统一专题地理数据包更强；德国更依赖“联邦级总表 + 州级专业机构/州级招商门户”的组合。

### 4.2 工业矿产

日本矿产试点更像直接找到全国资源点清单；德国更像找到全国官方矿产图系，再接受细尺度信息要下沉到州地调。这个差异来自德国联邦制地学数据分工。BGR 自己也明确写了：德国全国面状数据由 BGR 负责 `1:250,000 及更小比例尺`，更高分辨率由各州地质调查机构负责。

### 4.3 能源设施

德国明显强于日本。日本首版偏“旧全国设施包 + 明确边界”；德国有 [MaStR](https://www.marktstammdatenregister.de/MaStR/Datendownload) 这种全国登记库，公开导出按日更新，字段里直接包含经纬度。

### 4.4 工业区

日本有更接近“真实工业用地”的全国专题层思路；德国全国公开统一层更像国家基础地表/地类模型，真正带园区名称和招商语义的源头更碎，常常落在州级或城市级经济促进门户。

## 5. 哪些地方必须降级到非官方但可信公开源

### 5.1 明确需要降级的地方

- `能源设施`里如果首版一定要同时覆盖炼厂，而又要求全国统一公开点位，当前检到的联邦级开放主源不足，只能降级到 Tier C 的 [en2x 炼厂与生产页面](https://en2x.de/maerkte/raffinerien-und-produktion/) 做站点清单核对。
- `工业区`里如果首版一定要拿到“全国命名工业园区/招商园区”而不是实际工业用地代理层，必须大量降级到 Tier B/Tier C 的州级招商主管门户、商会门户、城市经济促进门户。

### 5.2 当前不必降级的地方

- `工业矿产`首版不必急着降到协作源，因为 [BGR KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html) 已经能提供全国官方骨架。
- `能源设施`首版如果边界收敛到“电力与储能等已登记点状单元”，不必降级。

## 6. 可直接承接到仓库架构的判断

### 6.1 工业矿产

不建议硬做成日本那种“纯点层”。德国主源天然更像 `资源区面 + 开采点/重点符号` 的双轨结构。首版更稳的承接方式是：

- `mineral_resources` 作为独立资源包。
- 主表达优先保留 `resource_areas` 面层。
- 如后续产品端确实只接点，再由构建过程派生 `representative_points`，不要在研究层面先把语义损坏。

### 6.2 能源设施

适合直接做成 `energy_facilities` 点层资源包。

- 主体字段可围绕 `name / energy_source / unit_type / operator / status / commissioning_date / lat / lon`。
- 首版只承诺能被 MaStR 或 Kraftwerksliste稳定支撑的设施子类，不把炼厂、LNG、油库强行揉进统一主层。

### 6.3 工业区

适合做成 `industrial_zones` 面层资源包。

- 国家级代理层：BKG LBM-DE 的 `121 Industrie-und Gewerbeflächen`。
- 命名园区补充层：州级或城市级招商主管门户。
- 两层不要混成一个“看起来统一其实语义不同”的表。

## 7. 风险判断

1. 德国很多“全国可得”数据其实是全国基础模型，不等于全国专题业务名录。
2. 工业区这条线最容易误把“工业/商业实际用地”当成“命名工业园区清单”。
3. 矿产这条线最容易误把“资源分布图系”理解成“现势矿山经营清单”。
4. 能源这条线最容易因为 MaStR 太强，反过来让人误以为炼厂、LNG、油库也都能在同一官方库里无缝拿到。

## 8. 下一步建议

1. 先做德国 `energy_facilities` 首版，范围锁定在 MaStR/Kraftwerksliste 能稳定覆盖的点状设施。
2. 并行做 `mineral_resources` 研究转译，先把 KOR 200 的几何和字段结构摸清。
3. 工业区先接受“全国代理层 + 州级补名录”的两层法，不要强行追求一个并不存在的完美全国主源。

## 9. 本轮使用的关键来源

- Tier A: [Bundesnetzagentur - Marktstammdatenregister](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/Marktstammdatenregister/start.html)
- Tier A: [MaStR - Datendownload](https://www.marktstammdatenregister.de/MaStR/Datendownload)
- Tier A: [Bundesnetzagentur - Kraftwerksliste](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Versorgungssicherheit/Erzeugungskapazitaeten/Kraftwerksliste/start.html?r=1)
- Tier A: [BGR - KOR 200](https://www.bgr.bund.de/DE/Themen/Min_rohstoffe/Produkte/Schriften/KOR_200.html)
- Tier A: [BGR - Geoportal](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/Geoportal/geoportal_node_en.html)
- Tier A: [BGR - Webdienste](https://www.bgr.bund.de/DE/Themen/Geodatenmanagement/Webdienste/webdienste_node.html)
- Tier A: [BGR - Geodatenmanagement / 分工说明](https://www.bgr.bund.de/EN/Themen/Geodatenmanagement/geoinformationen_node_en.html)
- Tier A: [BKG - LBM-DE2021](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/digitale-landschaftsmodelle/digitales-landbedeckungsmodell-deutschland-stand-2021-lbm-de.html)
- Tier A: [BKG - Basis-DLM](https://gdz.bkg.bund.de/index.php/default/digitales-basis-landschaftsmodell-ebenen-basis-dlm-ebenen.html)
- Tier B: [Standortportal Bayern](https://www.invest-in-bavaria.com/info-center/standortportal)
- Tier B: [Berlin Business Location Center - Immobilienportal](https://www.businesslocationcenter.de/immoportal/)
- Tier C: [en2x - Raffinerien und Produktion](https://en2x.de/maerkte/raffinerien-und-produktion/)
