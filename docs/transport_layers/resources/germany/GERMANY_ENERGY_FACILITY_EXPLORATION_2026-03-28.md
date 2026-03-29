# 德国能源设施研究草稿

日期：2026-03-28

## 1. 一句话结论

如果德国这条线的首版范围收敛到 `点状能源设施`，尤其是 `发电/储能/部分气体市场单元`，那么 [Bundesnetzagentur 的 Marktstammdatenregister（MaStR）](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/Marktstammdatenregister/start.html) 已经足够构成全国统一官方主源，而且比日本同类首版更强。

## 2. 研究边界

- 研究对象是 `点状能源设施`
- 明确排除：油气管线、输电线路、长距离网络
- 首版优先保障：发电设施、储能设施、已纳入 MaStR 的相关市场单元
- 不预设德国存在一个同时覆盖 `发电站 + 炼厂 + LNG + 油库 + 所有其他设施` 的全国统一官方开放点库

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可/使用边界 | Tier | 适合当主源 | 判断 |
|---|---|---|---|---|---|---|---|
| [Bundesnetzagentur - Marktstammdatenregister](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/Marktstammdatenregister/start.html) | 德国全国 | 点 | 官方页说明：公共数据实时展示；总导出通常每天约 05:00 更新 | 官方页明确：站内 `.xml/.csv` 与 web service 数据如无另行标注，适用 `Datenlizenz Deutschland – Namensnennung – Version 2.0` | Tier A | 是 | 当前最稳、最清楚、最适合产品化的全国官方主源 |
| [MaStR - Datendownload](https://www.marktstammdatenregister.de/MaStR/Datendownload) | 德国全国 | 点 | 页面说明：总导出通常每天约 05:00 按当时有效数据更新 | 跟随 MaStR 公开数据规则；字段说明可核对导出结构 | Tier A | 是，作为主源下载入口 | 对工程化最关键，适合真正落盘 |
| [MaStR 总导出文档](https://www.marktstammdatenregister.de/MaStRHilfe/files/gesamtdatenexport/Dokumentation%20MaStR%20Gesamtdatenexport/Dokumentation%20MaStR%20Gesamtdatenexport.pdf) | 德国全国导出结构说明 | 点字段说明 | 文档版本 `Revision 25.2`，日期 `01.10.2025` | 文档本身是说明书，复用以 MaStR 数据许可为准 | Tier A | 否，配套文档 | 关键价值在于确认存在 `Breitengrad / Laengengrad / Bundesland / Landkreis / Gemeinde` 等字段 |
| [Bundesnetzagentur - Kraftwerksliste](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Versorgungssicherheit/Erzeugungskapazitaeten/Kraftwerksliste/start.html?r=1) | 德国全国发电设施 | 点/表 | 当前页面数据状态 `3. November 2025`；页面发布时间 `19.11.2025` | 页面未像 MaStR 总页那样再次明确统一许可，使用时应按页面与源数据分别复核 | Tier A | 否，建议作后备/QA | 适合核对大中型机组、状态和公开发布口径；自 2021 起其底层已转向 MaStR |
| [BMWK - LNG 终端规划与容量说明](https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/2023/03/20230303-bmwk-legt-bericht-zu-planungen-und-kapazitaeten-der-schwimmenden-und-festen-lng-terminals-vor.html) | 德国少数 LNG 终端 | 无统一 GIS 几何，需人工点位化 | 2023-03-03 | 官方新闻稿，可作事实校核；不是统一开放空间主源 | Tier A | 否 | 适合补充 LNG 设施事实，不适合当全国主层 |
| [Deutsche Energy Terminal / BMWK 新闻稿](https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/2023/01/20230116-deutsche-energy-terminal-gmbh-nimmt-den-geschaftsbetrieb-auf.html) | Wilhelmshaven、Brunsbüttel、Stade、Lubmin 等少数站点 | 无统一 GIS 几何 | 2023-01-16 | 官方新闻稿 | Tier A | 否 | 适合做 LNG 子类事实核验 |
| [en2x - Raffinerien und Produktion](https://en2x.de/maerkte/raffinerien-und-produktion/) | 德国炼厂站点 | 需人工点位化 | 页面为当前在线页面，检索时间 2026-03-28 | 行业协会公开信息，不是联邦监管开放数据；引用需标注 Tier C | Tier C | 否 | 如果以后一定要把炼厂并入首版，只能作为降级后备，不应冒充官方主源 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- [MaStR 总入口](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/Marktstammdatenregister/start.html)
- [MaStR Datendownload](https://www.marktstammdatenregister.de/MaStR/Datendownload)

它适合作为主源，不只是因为官方，而是因为它同时满足：

- 全国统一
- 点状设施
- 有公开导出
- 有字段文档
- 有明确许可
- 更新频率足够高

### 4.2 后备源

- [Kraftwerksliste](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Versorgungssicherheit/Erzeugungskapazitaeten/Kraftwerksliste/start.html?r=1)：做大中型机组核对
- [BMWK LNG 终端说明](https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/2023/03/20230303-bmwk-legt-bericht-zu-planungen-und-kapazitaeten-der-schwimmenden-und-festen-lng-terminals-vor.html)：做 LNG 子类事实补充
- [DET / BMWK 新闻稿](https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/2023/01/20230116-deutsche-energy-terminal-gmbh-nimmt-den-geschaftsbetrieb-auf.html)：做 FSRU 站点核对
- [en2x 炼厂页面](https://en2x.de/maerkte/raffinerien-und-produktion/)：仅在明确接受 Tier C 时用于炼厂站点补充

### 4.3 排除项

- 输电线路、天然气长输管网
- 没有公开坐标、只能看新闻稿存在性的设施
- 把“能源设施”首版默认理解成“电力、炼厂、LNG、油库全部一次收口”

## 5. 与现有仓库架构的承接判断

德国能源设施非常适合直接承接成点层：

1. 建 `energy_facilities` 独立资源包。
2. 首版主层只放 MaStR 能稳定支撑的点状设施子类。
3. `facility_type`、`energy_source`、`operator`、`status`、`commissioning_date` 可以直接围绕官方字段设计。
4. 炼厂和 LNG 如后续进入产品，建议先做 `energy_facilities_ext` 或专题子层，不要污染首版主层。

## 6. 德国和日本相比最明显的不同

德国这条线比日本强很多。

- 日本更像“可以做发电设施锚点，但范围要提前讲清楚”。
- 德国则是“已经有联邦监管登记库，可公开导出，还能按日更新”。
- 所以德国的问题不是“有没有官方主源”，而是“首版要不要克制范围，不把炼厂等无统一开放主源的子类硬塞进去”。

## 7. 风险与下一步建议

### 7.1 风险

1. MaStR 很强，但它不自动等于“所有能源设施全集”。
2. 如果首版标题过大，用户会自然期待炼厂、LNG、油库、变电站一起出现，这会把范围拖垮。
3. Kraftwerksliste 是好后备，但从 2021 起其底层也来自 MaStR，本质不是另一套独立主源。

### 7.2 下一步建议

1. 首版明确写成：`能源设施（以 MaStR 可公开登记的点状设施为主）`。
2. 先以 MaStR 导出跑通全国点层。
3. 用 Kraftwerksliste 对大机组和状态做抽样 QA。
4. 如果业务强要炼厂，再明确标注为 Tier C 扩展，不要冒充 Tier A。

## 8. 本轮使用的关键来源

- Tier A: [Bundesnetzagentur - Marktstammdatenregister](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Monitoringberichte/Marktstammdatenregister/start.html)
- Tier A: [MaStR - Öffentliche Einheitenübersicht](https://www.marktstammdatenregister.de/MaStR/Einheit/Einheiten/OeffentlicheEinheitenuebersicht)
- Tier A: [MaStR - Datendownload](https://www.marktstammdatenregister.de/MaStR/Datendownload)
- Tier A: [MaStR - Gesamtdatenexport 文档](https://www.marktstammdatenregister.de/MaStRHilfe/files/gesamtdatenexport/Dokumentation%20MaStR%20Gesamtdatenexport/Dokumentation%20MaStR%20Gesamtdatenexport.pdf)
- Tier A: [Bundesnetzagentur - Kraftwerksliste](https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/Versorgungssicherheit/Erzeugungskapazitaeten/Kraftwerksliste/start.html?r=1)
- Tier A: [BMWK - LNG 终端规划说明](https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/2023/03/20230303-bmwk-legt-bericht-zu-planungen-und-kapazitaeten-der-schwimmenden-und-festen-lng-terminals-vor.html)
- Tier A: [BMWK - Deutsche Energy Terminal 新闻稿](https://www.bmwk.de/Redaktion/DE/Pressemitteilungen/2023/01/20230116-deutsche-energy-terminal-gmbh-nimmt-den-geschaftsbetrieb-auf.html)
- Tier C: [en2x - Raffinerien und Produktion](https://en2x.de/maerkte/raffinerien-und-produktion/)
