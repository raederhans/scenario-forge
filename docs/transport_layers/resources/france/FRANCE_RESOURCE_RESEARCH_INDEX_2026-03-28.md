# 法国资源专题研究总览

日期：2026-03-28

## 1. 一句话结论

法国三条线里，`工业矿产`最接近可以直接承接入库，`能源设施`可以先落到“电力生产/储能设施”这一层，`工业区`则没有像日本那样干净的全国单一官方主源，必须接受国家级预识别数据与地方正式清单混合承接。

## 2. 研究边界

本轮只研究三条线：

- 工业矿产：矿床、矿化点、资源分布
- 能源设施：点状设施，不含管线
- 工业区：真实园区或工业用地，不先用规划工业分区替代

明确不纳入：

- 铁路、公路、机场、港口
- 输油、输气、输电等线状网络
- 仅有产业政策含义、没有真实空间对象的名单

## 3. 三条线总体成熟度判断

| 线别 | 总体成熟度 | 当前最可信主抓法 | 结论 |
|---|---|---|---|
| 工业矿产 | 高 | 以 BRGM / MineralInfo 的 `Gisements, gîtes et indices France` 体系为主 | 有国家级地调主链路，语义与“资源分布”高度对题，可先做点层 |
| 能源设施 | 中 | 以全国电力生产与储能设施登记为主，再单独补气体终端等子类 | 有全国统一官方登记，但主要稳在电力生产/储能，不等于“全部能源设施” |
| 工业区 | 中低 | 国家级只适合用 FUSAC 做预识别，真正落盘仍要依赖地方正式 ZAE / sites économiques 数据 | 没有日本式单一全国官方工业园区主源，必须混源 |

## 4. 哪条线最适合先试点

最适合先试点的是 `工业矿产`。

原因不是因为它最贴近现实工业活动，而是因为：

- 国家级主源最清楚，优先级也最稳定
- 几何天然适合做点层
- “矿床/资源分布”与数据语义几乎正对题
- 不需要先解决复杂网络或园区边界定义问题

如果希望先做“更新更频繁、公共认知更强”的对象，则可以把 `能源设施` 作为第二试点，但首版应明确写成“以电力生产/储能设施为主”。

## 5. 和日本最明显的差异

### 5.1 总体差异

- 日本样例三条线都更接近“单一全国主源先落一版”的思路。
- 法国只有矿产线接近这种状态。
- 法国能源线虽然全国统一登记更新更近，但对象边界收在电力生产/储能，不是全能源设施总表。
- 法国工业区线最明显地不同于日本：日本还能用全国工业用地/园区类官方面数据先起一版，法国更现实的路径是国家级预识别 + 地方正式清单拼装。

### 5.2 对仓库承接方式的影响

- 法国矿产：适合直接做 `point context layer`
- 法国能源：适合先做 `point context layer`，但图层名和产品文案必须写清首版边界
- 法国工业区：更适合 `polygon context layer`，且要接受分区域建设、分批覆盖，不宜承诺一次性全国齐平

## 6. 哪些地方必须降级到非官方但可信公开源

按固定顺序应始终先做 `Tier A -> Tier B -> Tier C`。法国这轮必须考虑降级的地方主要有两类。

### 6.1 工业区名称、边界或运营主体缺口

在很多地区，国家级没有可直接用作主源的真实工业园区统一面层。若地方开放数据也缺失，才需要降级到：

- Tier C：可信公开协作源或行业公开目录
- 典型用途：补园区名称、补大致边界、补园区类型说明
- 降级原因：全国没有对题的单一官方母库，地方官方覆盖不齐

### 6.2 能源线中的非电力子类

如果后续要扩到：

- 炼油厂
- LNG 终端
- 油库
- 其他非电力能源节点

则法国也很可能出现“子类能找到官方名单，但几何、更新频率、机器可用性不一致”的问题。此时可能需要：

- 先用 Tier A / Tier B 官方名单确认对象存在
- 再用 Tier C 补点位或校名

降级原因不是主源失效，而是法国当前没有一个把这些子类都统一收进同一国家级点层的官方母表。

## 7. 三条线主源 / 后备源 / 排除项总判断

### 7.1 工业矿产

- 主源：BRGM / MineralInfo 的 `Gisements, gîtes et indices France` 体系
- 后备源：BRGM 区域性可采资源面层、地质图与相关专题图
- 排除项：矿业权边界、历史污染场地、单纯地球物理异常

### 7.2 能源设施

- 主源：全国电力生产与储能设施登记
- 后备源：国家级燃气基础设施数据、LNG 终端运营数据
- 排除项：管线网络、仅有统计无点位的表、把危险工业站点数据库直接当能源设施总表

### 7.3 工业区

- 主源结论：`无单一全国官方主源`
- 最可行组合：FUSAC 作为国家级预识别底，再叠加地方官方 ZAE / sites économiques 数据
- 排除项：单纯规划用地分区、招商目录、企业厂房 POI 点

## 8. 与现有仓库架构的承接判断

建议承接方式如下：

- `mineral_resources`
  - 点层
  - 首版按矿种大类、资源等级、是否多金属做最小字段集
- `energy_facilities`
  - 点层
  - 首版明确写成“以电力生产/储能设施为主”
- `industrial_zones`
  - 面层
  - 不承诺一次性全国齐平，按有正式地方源的地区分批补齐

这和日本最大的工程差异在于：法国工业区不宜假设存在一个像日本 L05 那样能直接全国铺开的干净官方面层。

## 9. 风险判断

- 法国矿产线最大的风险不是数据不存在，而是许可边界和公开下载入口并不总像 data.gouv.fr 那样统一，要把 BRGM/InfoTerre 的复用条件写清楚。
- 法国能源线最大的风险是产品命名会误导用户，以为首版已覆盖炼油、LNG、油库、变电站等全部能源节点。
- 法国工业区最大的风险是把 `规划分区`、`经济活动用地预识别` 和 `真实园区清单` 混成一个图层。

## 10. 下一步建议

1. 先把 `工业矿产` 做成法国首个试点层。
2. 第二步做 `能源设施`，但只承诺全国电力生产/储能设施。
3. `工业区` 不要急着全国一锅端，先挑几个地方官方数据质量高的地区做验证样板。
4. 工业区若进入实施，先固定“国家级预识别层”和“地方正式层”的合并规则，再谈全国扩展。

## 11. 关键来源

- BRGM / InfoTerre 数据使用条件：https://infoterre.brgm.fr/page/conditions-dutilisation-donnees
- MineralInfo 门户首页：https://mineralinfo.fr/fr
- MineralInfo 2023 资源图集（2024 报告）：https://www.mineralinfo.fr/sites/default/files/documents/2025-03/ANNEXE1_PRUSS_public.pdf
- MineralInfo 2022 图集说明：https://www.mineralinfo.fr/fr/actualite/actualite/publication-dun-atlas-des-substances-minieres-metropole
- 全国电力生产与储能设施登记：https://www.data.gouv.fr/datasets/registre-national-des-installations-de-production-et-de-stockage-delectricite-au-31-01-2026
- 法国大燃气基础设施数据：https://www.data.gouv.fr/datasets/grandes-infrastructures-gazieres-en-france
- Cerema FUSAC 国家级活动用地数据库：https://www.data.gouv.fr/fr/datasets/fusac-base-nationale-des-fonciers-a-usage-dactivites/
- Cerema 关于 ZAE 法定义务说明：https://www.cerema.fr/fr/actualites/recensement-zones-activite-economique-enjeu-leur
- 地方官方 ZAE 示例（Saint-Louis Agglomération）：https://www.data.gouv.fr/datasets/sla-zones-dactivites-economiques-existantes/
- 地方官方 sites économiques 示例（Tarn）：https://www.data.gouv.fr/datasets/sites-dactivite-economique-tarn
