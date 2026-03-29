# 法国工业区试点探索归档

日期：2026-03-28

## 1. 一句话结论

如果法国这条线要找的是 `真实工业园区 / 工业活动用地`，而不是单纯规划工业分区，那么当前不存在一个像日本那样可以直接全国铺开的单一官方主源；最现实的方案是用 Cerema 的 FUSAC 做国家级预识别底，再叠加地方官方 `ZAE / sites économiques` 数据做真实落盘。

## 2. 研究边界

本轮固定边界如下：

- 研究对象是 `真实工业园区 / 工业活动用地 / 经济活动用地中的工业园区对象`
- 首版几何必须以 `面` 为主
- 不先用单纯规划工业分区替代真实园区
- 不把招商目录、产业政策名单、企业厂房点集合直接替代园区面层

## 3. 数据源判断表

| 来源 | 覆盖 | 几何 | 更新时间 | 许可 / 使用边界 | Tier | 适不适合当主源 | 判断 |
|---|---|---|---|---|---|---|---|
| Cerema `FUSAC - Base nationale des fonciers à usage d'activités` | 法国全国 | 面；含 sites contours / terrains / établissements 三张主表 | 主元数据 2024-10-28；文档 2025-05-21 | Open Licence 2.0 | Tier B | `否，不能单独当主源` | 国家级最好用的预识别底，但对象集合过宽，覆盖工业、商业、第三产业、设备用地等，不等于真实工业园区清单 |
| Cerema 关于 ZAE 法定清查说明 | 法国全国法规背景 | 不适用 | 在线文章 | 引用公开网页即可 | Tier B | `不是数据源` | 证明地方 EPCI 必须做 ZAE 清查，说明全国应优先走地方正式清单 |
| 地方官方 `ZAE / sites d'activité économique` 数据，例如 Saint-Louis Agglomération | 地方级 | 面 | 2024-01-23 | Open Licence 2.0 | Tier A | `地方层面是` | 真实空间对象强、适合正式落盘，但全国覆盖不齐 |
| 地方官方 `Sites d'activité économique - Tarn` | 地方级 | 面 | 2025-12-20，文件 2024-11-15/2026-01-16 | Open Licence 2.0 | Tier A | `地方层面条件更好，但不是全国主源` | 明确是活动经济用地站点/园区面，且对接 CNIG 2023；但内容部分来自规划文档，仍需区分真实管理类型 |
| data.gouv 上部分地方 ZAE 清单仅 CSV 名录 | 地方级 | 常无 GIS 几何 | 不一 | 多为 Open Licence | Tier A | `否` | 可以补名称，不能单独做空间主层 |
| 规划用地分区（UX, AUX 等） | 地方或全国碎片化 | 面 | 不一 | 不一 | Tier A | `否` | 这是规划分区，不应直接替代真实工业区 |
| OSM、招商网站、园区名录站 | 地方或全国 | 点 / 面 / 文本 | 不一 | 需分开核条款 | Tier C | `仅在官方缺口时补缺` | 只适合补名、补边界、补运营主体，不能先于官方层使用 |

## 4. 主源 / 后备源 / 排除项

### 4.1 主源结论

`法国工业区线当前没有单一全国官方主源。`

这是这条线最重要的结论，比“选哪一个数据集”更重要。

### 4.2 最可行组合

- 国家级预识别底：`FUSAC`
- 地方正式落盘层：地方官方 `ZAE / sites d'activité économique / sites économiques` 数据

这样分层的原因是：

- FUSAC 全国覆盖最好
- 但 FUSAC 本体是 `fonciers à usages d'activités`
- 它主动承认自己是国家级综合活动用地资源，而不是“真实工业园区母表”
- 真正贴近法规和落地管理对象的，仍然是地方 EPCI / DDT / agglomération 维护的 ZAE 或 sites économiques 数据

### 4.3 后备源

- 地方官方 CSV 名录
  - 用途：补园区名称和主属性
  - 问题：常没有几何
- Tier C 可信公开协作源
  - 用途：在地方官方完全缺失时补边界或园区名
  - 问题：必须标注降级原因，不能伪装成官方主层

### 4.4 排除项

- 单纯城市规划用途分区
- 招商型园区目录
- 企业厂房 POI 点
- 产业政策名单

## 5. 为什么 FUSAC 不能直接当全国工业区主源

FUSAC 很强，但它不是这条线的完美主源。

它强在：

- 全国覆盖
- Open Licence 2.0
- 有面几何
- 有 sites / terrains / establishments 的层次化结构
- 有明确 CNIG 标准承接

但它不够对题的地方也很清楚：

- 它覆盖的是 `fonciers à usages d’activités`
- 官方描述明确包含 `industrielles, commerciales, tertiaires, équipements, etc.`
- 它的设计目标之一，是帮助地方做后续库存与诊断
- 官方背景文字还明确提到“全国层面缺数据或差异很大”，所以它本身更像“预识别与整合底图”

因此：

- FUSAC 可以做法国工业区线的国家级骨架
- 但不能替代地方正式 ZAE / sites économiques 图层

## 6. 与日本最明显的不同

法国和日本在工业区线上的差异，是这次研究里最明显的。

### 6.1 日本更接近“全国单源先落面层”

- 日本样例可以先用全国统一官方工业用地/园区相关面层构建首版
- 即使数据偏旧，也仍然更像一个完整的国家级主层

### 6.2 法国必须接受“国家级预识别 + 地方正式层”的双层结构

- 国家级最强数据是 FUSAC，但它不是纯工业园区母表
- 地方正式数据质量反而更贴近真实对象
- 全国要想落得稳，不能硬找一个并不存在的单一全国工业区主源

这条差异决定了法国工业区线的工程方案不能照搬日本。

## 7. 与现有仓库架构的承接判断

这条线不适合先做点层。

推荐承接方式：

- 逻辑层名称：`industrial_zones`
- 几何：面
- 数据结构分两层：
  - `national_prefill_layer`
    - 来源：FUSAC
    - 用途：预识别、补空白、做统一字段底
  - `local_authoritative_layer`
    - 来源：地方官方 ZAE / sites économiques
    - 用途：正式展示和优先覆盖

最小字段集建议：

- `name`
- `zone_type`
- `management_type`
- `source_tier`
- `source_scope`
- `is_authoritative_local`
- `geometry_quality`
- `source_update`

其中 `is_authoritative_local` 很关键，因为法国工业区后续很可能是“地方正式数据压过国家预识别底”。

## 8. 风险与下一步建议

### 8.1 风险

- 最大风险是把 `规划分区`、`活动用地预识别`、`真实工业园区` 三者混成一个层
- FUSAC 因为全国覆盖强，最容易被误用成工业园区母表
- 地方数据虽然更对题，但命名、字段、管理主体和分类会高度异构
- 某些地方只给 CSV 名录不给 GIS 面，届时就会出现必须降级到 Tier C 补几何的场景

### 8.2 下一步建议

1. 不要承诺法国工业区全国单源首版。
2. 先选 2 到 4 个地方官方数据较完整的地区做样板。
3. 先固定 `FUSAC -> local authoritative override` 的覆盖规则。
4. 在地方只有规划分区、没有真实园区数据时，明确标成缺口，不要偷换。
5. 只有在地方官方完全没有空间数据时，才允许降级到 Tier C，并在属性中写明降级原因。

## 9. 试点判断

如果按“最稳妥、最短路径”来排，法国工业区不适合作为第一优先。

但如果目标是尽快验证 `polygon context layer + national/local merge` 这套仓库能力，它又是最有代表性的复杂样本。

所以它更适合：

- 不做第一优先试点
- 但作为方法学验证样本尽早开工

## 10. 必须降级到非官方但可信公开源的场景

### 10.1 园区边界缺失

当地方只有名称名单、没有 GIS 面时：

- 先保留官方名单为主
- 允许用 Tier C 补边界
- 但必须在字段里标明 `geometry_from_non_authoritative_public_source`

### 10.2 园区名称或别名不统一

当地方官方面层没有规范名称，只有代码或缩写时：

- 先保持官方原值
- 再用 Tier C 辅助补常用名
- 不允许反过来用 Tier C 改写官方对象身份

## 11. 关键来源

- Cerema FUSAC 国家级活动用地数据库：https://www.data.gouv.fr/fr/datasets/fusac-base-nationale-des-fonciers-a-usage-dactivites/
- Cerema 关于 ZAE 法定清查说明：https://www.cerema.fr/fr/actualites/recensement-zones-activite-economique-enjeu-leur
- 地方官方 ZAE 示例（Saint-Louis Agglomération）：https://www.data.gouv.fr/datasets/sla-zones-dactivites-economiques-existantes/
- 地方官方 sites d'activité économique 示例（Tarn）：https://www.data.gouv.fr/datasets/sites-dactivite-economique-tarn
- 地方官方仅名录示例（Pays de l'Or）：https://www.data.gouv.fr/datasets/jeu-de-donnees-zones-dactivites-economiques-zae
