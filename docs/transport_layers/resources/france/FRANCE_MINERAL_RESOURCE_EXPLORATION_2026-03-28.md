# 法国工业矿产试点探索归档

日期：2026-03-28

## 1. 一句话结论

如果法国这条线的目标是 `矿床 / 矿化点 / 资源分布`，而不是“当前在产矿山”，那么 BRGM / MineralInfo 维护的 `Gisements, gîtes et indices France` 体系已经足够构成国家级主源骨架，首版应以点状资源分布层承接。

## 2. 研究边界

本轮固定边界如下：

- 研究对象是 `矿床 / 矿化点 / 资源分布`
- 首版几何优先为 `点`
- 不承诺反映当前是否在产
- 不把矿业权边界直接当资源分布
- 不把历史污染场地、单纯钻孔、单纯地球物理异常直接当矿产资源对象

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可 / 使用边界 | Tier | 适不适合当主源 | 判断 |
|---|---|---|---|---|---|---|---|
| BRGM / MineralInfo `Atlas des ressources minérales relatives au sous-sol français – État des lieux 2023`，基于 `Gisements, gîtes et indices France` | 法国全国，含本土与 DROM 的总体资源清单框架 | 点状发生地 / 矿床发生点；图集中明确是 sites / occurrences | 报告版本 2024-02-27；图集说明对应 2023 状态 | 报告正文本身有版权限制，不宜直接当开放数据再分发；但它明确指向 BRGM/InfoTerre/MineralInfo 数据链路 | Tier A | `接近主源，但更像主源说明书与验证材料` | 最强的国家级官方论证材料，证明主链路存在且语义对题 |
| MineralInfo 可视化与提取入口，接 BRGM / InfoTerre | 法国全国多专题 | 以点图层为主，也能叠加专题图层 | 门户持续更新；帮助页 2020-02-18 说明可提取源数据 | 需遵守 BRGM / InfoTerre 使用条件；默认可免费复用并注明 BRGM 与更新时间，例外数据需单独看 | Tier A | `是` | 最适合作为工程上的主抓取入口 |
| BRGM / InfoTerre 数据使用条件 | BRGM 数据通用规则 | 不适用 | 当前在线页面 | 除非另有说明，数据可免费复用，但必须注明来源和最后更新时间，不得歪曲数据含义 | Tier A | `不是数据源，但决定能否入库` | 是主链路的许可依据，必须与矿产主源一起记录 |
| BRGM 区域性可采资源数据，如 Nouvelle-Aquitaine `gisements potentiellement exploitables` / `gisements techniquement exploitables` | 区域级，不全国统一 | 面 | 2024-02-05 等区域更新口径 | 许可在 data.gouv 元数据里未完全统一，需逐项核 | Tier A | `否` | 可作为区域增强层，不适合当法国全国主源 |
| `Cadastre minier Camino` | 国家级 | 面 / 面-线行政边界 | 日更 | Open Licence 2.0 | Tier A | `否` | 这是矿业权 / 申请边界，不是资源分布 |
| BASIAS / BASOL | 国家级 | 点或面 | 持续维护 | 各自元数据单列 | Tier A | `否` | 这是工业遗留/污染语义，不是资源分布 |
| 各类地方矿产潜力图、学术图集 | 区域或专题 | 点 / 面混合 | 不一 | 常常不是统一开放许可 | Tier B / C | `否` | 只能做补充，不应盖过 BRGM 主链路 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源

- `MineralInfo + BRGM / InfoTerre` 中可视化、查询和提取的 `Gisements, gîtes et indices France` 体系

主因不是“它最新”，而是它最对题：

- BRGM 是法国国家级地调机构，符合 Tier A
- 2024 图集明确写明这些站点来自 `Gisements, gîtes et indices France`
- 图集明确说明这些对象是 `gisements / gîtes / indices`
- 语义就是资源发生地和矿床分布，而不是矿业权边界或工业设施

### 4.2 后备源

- 区域级 BRGM / DREAL 资源面层
  - 典型用途：做区域试点时补多边形潜力区
  - 问题：不全国统一，且常是“可采潜力”而不是国家统一矿床母表
- BRGM 地质图、专题图
  - 典型用途：做地带解释、资源背景说明
  - 问题：更适合分析，不适合直接替代矿床分布主层

### 4.3 排除项

- `Cadastre minier Camino`
  - 排除原因：它描述的是矿业权和申请，不是资源分布
- BASIAS / BASOL
  - 排除原因：它们描述的是历史工业场地或污染风险，不是矿床
- 仅有论文图件、无稳定开放数据入口的专题研究
  - 排除原因：难以工程化、难以全国统一

## 5. 为什么法国矿产线可以先落点层

2024 年的 MineralInfo 图集给出的关键信号非常清楚：

- `Les sites représentés ... sont issus de la base de données « Gisements, gîtes et indices France »`
- 数据库由 BRGM 建立并持续更新
- 资源对象按矿床、矿化点、指标点分级
- 图集中以 occurrence / site 逻辑表达，而不是以行政许可边界表达

这意味着法国矿产首版最稳的做法不是去追全国矿区面，也不是去追当前生产状态，而是：

- 先做 `资源分布点`
- 再用矿种大类和规模等级做前端筛选

## 6. 与日本最明显的不同

和日本相比，法国矿产线有两个明显差异：

### 6.1 法国的“主源说明材料”更强，但工程入口更像门户而不是一个单独的 data.gouv 下载页

- 日本样例更像“直接点一个全国数据集附件”
- 法国这里更像“BRGM / MineralInfo / InfoTerre 组成同一条官方主链路”
- 这不是坏事，但意味着工程文档必须把 `数据本体` 和 `许可条件页` 一起记住

### 6.2 法国图区同时覆盖陆上 concessible resources、部分非能源矿物和若干海洋/区域专题

- 日本样例更容易保持首版边界干净
- 法国如果不先写清边界，容易把海洋矿产潜力、区域可采面层、矿业权边界一起混进主层

所以法国矿产线虽然成熟，但首版必须更严格地控语义。

## 7. 与现有仓库架构的承接判断

这条线非常适合先走点图层。

建议承接方式：

- 逻辑层名称：`mineral_resources`
- 几何：点
- 最小字段集建议：
  - `name`
  - `resource_family`
  - `resource_substance`
  - `occurrence_class`
  - `resource_size_class`
  - `source_system`
  - `source_update`
- 前端行为：
  - 惰性加载
  - 按矿种大类和等级筛选
  - 文案固定写成“资源分布”而非“在产矿山”

## 8. 风险与下一步建议

### 8.1 风险

- 报告 PDF 本身不等于开放原始数据，不能把“可读报告”误当“可自由再分发数据包”
- BRGM 使用条件页面写的是“除非另有说明”，所以具体图层若有特殊限制仍需再核
- 同一 occurrence 可能在多种矿种图中重复出现，后续 schema 需要允许一对多矿种映射
- 法国本土与海外地区放在同一国家框架里，若前端只做本土法国，要提前决定是否裁剪 DROM

### 8.2 下一步建议

1. 先以 `MineralInfo / InfoTerre` 抽样验证 20 到 50 个 occurrence 的可提取字段。
2. 先固定 `resource_family / resource_substance / occurrence_class / size_class` 四层最小映射。
3. 把 `Cadastre minier` 明确另立专题，不并入矿产资源层。
4. 若后续要做面层，只把区域性 `gisement potentiellement exploitable` 作为增强层，不替代国家级点层。

## 9. 试点判断

在法国这三条专题层里，`工业矿产` 仍然是最适合优先进入产品试点的对象。

原因很直接：

- 国家级主链路明确
- 几何天然简单
- 主题边界清晰
- 和仓库里的点层承接方式最顺

## 10. 关键来源

- MineralInfo 门户首页：https://mineralinfo.fr/fr
- MineralInfo 可视化与数据提取帮助：https://assistance.brgm.fr/mineralinfo/comment-acceder-aux-donnees-thematiques-mineralinfo-visualiseur-cartographique
- BRGM / InfoTerre 数据使用条件：https://infoterre.brgm.fr/page/conditions-dutilisation-donnees
- 2022 图集说明页面：https://www.mineralinfo.fr/fr/actualite/actualite/publication-dun-atlas-des-substances-minieres-metropole
- 2024 报告《Atlas des ressources minérales relatives au sous-sol français – État des lieux 2023》：https://www.mineralinfo.fr/sites/default/files/documents/2025-03/ANNEXE1_PRUSS_public.pdf
- BRGM 区域矿产潜力示例（Nouvelle-Aquitaine GPE）：https://www.data.gouv.fr/datasets/nouvelle-aquitaine-gisements-potentiellement-exploitables-gpe
- Cadastre minier Camino：https://www.data.gouv.fr/datasets/cadastre-minier
