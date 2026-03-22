# QA-088 World Wrap Feasibility Assessment And Scenario Staging

**日期**: 2026-03-22  
**状态**: 研究完成，未实施  
**范围**: 评估当前地图编辑器从“左右移动上线固定、世界不连贯”升级为“像即时战略游戏一样左右完全连贯”的可行性、改动范围、风险、数据需求、投影与数据构建修正方向，以及在排除 `TNO 1962` 后的首个承载剧本选择  
**约束**: 本轮仅做研究与结论归档，不修改运行时代码、不修改构建链、不改任何 scenario 资产

---

## 0. 结论摘要

这次调研的结论可以压缩成 4 句话：

1. “左右完全连贯世界”在当前工程里是 **可做** 的，但它不是样式级增强，而是一次 **渲染模型升级**。
2. 如果把所有剧本都算上，尤其包括 `TNO 1962`，这件事属于 **高风险、高耦合、高验证成本** 的改造。
3. 如果先明确 **排除 `TNO 1962`**，难度会明显下降，问题会回到“通用 wrap 渲染 + 反经线数据正规化”，不再被 1962 的场景级 runtime topology、mask、clip cache 拖住。
4. 在 `blank_base / HOI4 1936 / HOI4 1939 / modern_world` 之间，**`HOI4 1936` 是最适合的首个正式承载剧本**；`modern_world` 更适合作为通用回归样本，`HOI4 1939` 更适合作为第二阶段验证样本。

一句话判断：

> 如果目标是认真推进“左右连贯世界”，正确路径不是从 `TNO 1962` 开始，而是先用 `HOI4 1936` 把通用渲染与交互链跑通，再用 `modern_world` 和 `HOI4 1939` 做通用性与复杂语义验证，最后才考虑 `TNO 1962`。

---

## 1. 背景与问题定义

用户提出的不是“能否做一个视觉上的世界复制效果”，而是一个更强的目标：

- 地图不再是“拖到左右边界就停”的有限视口
- 世界在水平方向上是周期连续的
- 这种连续性不仅要体现在渲染上，还要体现在：
  - 拖拽
  - 缩放
  - hover / hit-testing
  - 选择
  - 填色
  - 场景切换
  - runtime political topology
  - coastline / land mask / context mask

这意味着，真正要回答的问题不是“能不能复制一份地图”，而是：

- 当前架构是否默认“世界只有一份”？
- 这个假设进入了哪些层？
- 去掉这个假设后，各剧本中谁最先会出问题？
- 如果先不碰 `TNO 1962`，能否拿到一个可用版本？

---

## 2. 本地架构事实

### 2.1 当前前端是单世界投影模型

当前渲染器核心位于 [js/core/map_renderer.js](../../js/core/map_renderer.js)。

关键事实：

- 渲染器当前初始化 `d3.geoEqualEarth()`，[map_renderer.js:15501](../../js/core/map_renderer.js#L15501)
- 加载数据后通过 `projection.fitExtent(...)` 把世界拟合到当前视口，[map_renderer.js:15389](../../js/core/map_renderer.js#L15389)
- 平移边界通过 `zoomBehavior.translateExtent(...)` 限定在计算出的 pan extent 内，[map_renderer.js:15327](../../js/core/map_renderer.js#L15327)
- 鼠标命中和交互坐标依赖 `projection.invert(...)` 反算为单份经纬度，[map_renderer.js:5982](../../js/core/map_renderer.js#L5982), [map_renderer.js:13644](../../js/core/map_renderer.js#L13644)

这 4 点合在一起，说明当前系统理解的是：

- 一个投影后的世界
- 一组被边界限制的平移状态
- 一个可反算回单一经纬度空间的坐标系

它不是周期世界，不是环绕相机，也不是多 world-copy 渲染模型。

### 2.2 当前代码里已经有“wrap artifact”概念，但那不是 world wrap

渲染器里存在 `wrapArtifact` 过滤逻辑，[map_renderer.js:2771](../../js/core/map_renderer.js#L2771)。

这很重要，因为它说明系统已经意识到投影/反经线可能产生异常几何或异常投影结果，但当前采用的策略是：

- 抑制伪影
- 跳过可疑特征
- 修复 seam

而不是：

- 把左右边界视为同一世界的连续点

换句话说，当前系统面对“世界边界问题”的哲学是 **防守式处理异常**，不是 **原生建模周期世界**。

### 2.3 当前 scenario 体系里，1962 和其他剧本不是一个复杂度级别

scenario 激活核心位于 [js/core/scenario_manager.js](../../js/core/scenario_manager.js)。

关键事实：

- 所有场景都可以接管 runtime political topology 状态
- 但只有某些场景真的提供了独立的 `runtime_topology_url`
- 应用 scenario 时，如果场景没有自己的 runtime topology，会回退到默认 runtime political topology，[scenario_manager.js:2504](../../js/core/scenario_manager.js#L2504) 到 [scenario_manager.js:2508](../../js/core/scenario_manager.js#L2508)

这意味着：

- 非 `TNO 1962` 场景大体仍走“默认 runtime topology + 自己的 owner/controller/cores”模式
- `TNO 1962` 额外引入了场景级 runtime topology、land mask、context land mask

这正是为什么 `TNO 1962` 不是一个普通 scenario，而是一个会放大渲染器脆弱点的重场景。

---

## 3. 各剧本复杂度基线

本地 manifest 汇总结果如下：

| Scenario | feature_count | owner/controller split | scenario runtime topology | context land mask arc refs |
|---|---:|---:|---|---:|
| `blank_base` | 0 | 0 | no | 0 |
| `hoi4_1936` | 22502 | 0 | no | 0 |
| `hoi4_1939` | 22512 | 606 | no | 0 |
| `modern_world` | 11724 | 0 | no | 0 |
| `tno_1962` | 12829 | 606 | yes | 63986 |

直接含义：

- `1936` 与 `1939` 的几何体量其实比 `1962` 更大
- 但 `1962` 的风险不来自纯 feature 数，而来自它的场景级 runtime topology 和 mask 链
- `modern_world` 更轻，但代表性也更弱

相关证据：

- [data/scenarios/hoi4_1936/manifest.json](../../data/scenarios/hoi4_1936/manifest.json)
- [data/scenarios/hoi4_1939/manifest.json](../../data/scenarios/hoi4_1939/manifest.json)
- [data/scenarios/modern_world/manifest.json](../../data/scenarios/modern_world/manifest.json)
- [data/scenarios/tno_1962/manifest.json](../../data/scenarios/tno_1962/manifest.json)

---

## 4. 为什么“全剧本一起评估”时风险很高

### 4.1 `TNO 1962` 已经证明自己对 renderer 架构很敏感

现有 QA 记录过两类重要问题：

- 运行时政治层 seam 伪影并非数据坏，而是 renderer 在高碎片 runtime topology 下的绘制策略触发的，[QA-071](../QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md#L12)
- 后续性能收益主要来自 renderer 级缓存，而不是 builder 级简化，[QA-079](../QA-079_tno_1962_heavy_scenario_clip_cache_and_context_persistence_2026-03-09.md#L121)

这说明如果现在把“左右完全连贯”直接叠到 `1962` 上，风险会集中在：

- clip path
- context base
- runtime political pass
- scenario mask source
- cache key 与 invalidation

### 4.2 `1962` 的场景级 coastline / land mask 路径和 `1936/1939` 不同

[QA-084](../QA-084_tno_1962_scenario_coastline_source_gating_2026-03-11.md#L125) 明确指出：

- `HOI4 1936` 和 `HOI4 1939` 没出现相同 defect 的关键原因，不是“scenario active vs inactive”
- 而是它们没有像 `TNO 1962` 那样把 coastline generation 交给一个有问题的 scenario land mask

这条证据进一步证明：

- 非 1962 剧本的风险更接近“通用 wrap 问题”
- `1962` 的风险是“通用 wrap 问题 + 特有 mask / coastline 问题”

---

## 5. 当前数据构建链对反经线并不友好

### 5.1 现在的全局化工作只完成了一部分

你们已经把主配置推进到了全球边界：

- `GLOBAL_BOUNDS = (-180, -90, 180, 90)`，[map_builder/config.py:207](../../map_builder/config.py#L207)
- `MAP_BOUNDS = GLOBAL_BOUNDS`，[map_builder/config.py:268](../../map_builder/config.py#L268)
- `clip_to_europe_bounds(...)` 已变成对 `clip_to_map_bounds(...)` 的兼容别名，[map_builder/geo/utils.py:73](../../map_builder/geo/utils.py#L73)

这说明全球化基础已经搭起来了，但它不等于“反经线安全”已经解决。

### 5.2 反经线问题在构建链里仍然被部分回避，而不是被一等建模

最典型证据是：

- `map_builder/processors/russia_ukraine.py` 仍然使用 `clip_box(-20.0, 0.0, 179.99, 90.0)` 来避免 dateline wrapping artifact，[russia_ukraine.py:173](../../map_builder/processors/russia_ukraine.py#L173)

这类逻辑在做“静态全球图”时还可以接受，但在做“左右周期连续世界”时会直接变成结构性问题。

### 5.3 邻接图仍是平面相交思维

`compute_neighbor_graph()` 基于 GeoPandas/Shapely 的普通几何相交来算邻接，[topology.py:16](../../map_builder/geo/topology.py#L16)。

这本身不是 bug，但它意味着：

- 现有拓扑与邻接推导默认工作在一个非周期平面上
- 一旦把左右边界视为连续，就要重新界定哪些逻辑仍可复用，哪些逻辑只是“凑巧可用”

---

## 6. 如果真的要做左右连贯，系统需要发生什么变化

### 6.1 渲染层需要从“单世界”升级为“周期世界”

至少需要增加这些概念：

- wrap-aware camera / viewport
- 中心世界 + 左副本 + 右副本的 world copy 渲染模型
- 同一 feature 在多个副本中的统一业务身份
- 能把视觉副本去重回同一 feature id 的 hit-testing

### 6.2 交互层需要从“单点反算”升级为“模 360 反算”

当前 `projection.invert(...)` 返回的是单点经纬度。  
world wrap 之后，交互不再只是“我点中了哪个经纬度”，而是：

- 我点中了哪个视觉副本
- 这个副本对应的标准经度归一后是哪一个真实 feature
- 在副本 A 点中的对象，是否应该映射回中心世界的同一个 feature id

### 6.3 数据层需要引入反经线正规化

如果不做这一步，最容易出现的就是：

- Aleutian
- 俄罗斯远东
- 太平洋岛国链
- 接近 ±180° 的多部件 MultiPolygon

在世界复制或周期命中时出现错误包裹、超长投影、异常 bbox 或错误命中。

GeoJSON 官方规范明确建议跨反经线的几何应切开处理，而不是让单个 geometry 直接跨越反经线：[RFC 7946](https://www.rfc-editor.org/rfc/rfc7946.txt)。

---

## 7. 如果把 `TNO 1962` 暂时排除，可以期待什么

把 `1962` 从首轮目标里排除后，项目性质会改变。

### 7.1 难度下降的原因

- 不需要先处理 scenario 级 `runtime_topology.topo.json`
- 不需要先处理 scenario 级 `land_mask` / `context_land_mask`
- 不需要一开始就卷入 `1962` 的 clip cache / context cache / coastline source gating 复杂度
- 不需要把“通用 wrap 正确性”和“1962 特化正确性”混在同一个调试循环里

### 7.2 难度并不会低到“只是小修”

即便不做 `1962`，仍然必须面对：

- 单世界平移模型升级
- 周期命中
- 反经线数据正规化
- 投影策略选择

所以排除 `1962` 后的正确判断不是“很简单了”，而是：

> 这件事终于回到了一个可以认真做、并且能较早拿到阶段性成果的范围。

### 7.3 可以期待的成果层级

如果排除 `1962`，合理预期是：

- 能做出真正可用的左右连贯原型
- 第一版主要以 renderer + interaction 为主，不必一上来大改 scenario 资产体系
- 可以先用 HOI4/modern 级场景证明世界 wrap 是通用能力，而不是 TNO 特例

---

## 8. 为什么首个正式承载剧本应选 `HOI4 1936`

### 8.1 `1936` 最接近“高代表性 + 低场景语义干扰”

它的优点是：

- feature 数量大，足以代表真实压力
- 没有 owner/controller split
- 没有 scenario runtime topology
- 已有 QA 证明它的 scenario 数据接入闭环完整

[QA-046](../QA-046_hoi4_1936_scenario_data_load_ui_audit_2026-03-04.md#L54) 的判断很关键：

- 1936 已完成从原始 HOI4 数据到前端消费资产再到运行时主权切换的完整闭环
- 它的问题更多在 UI 语义桥接，而不是 scenario 本体无法工作

这意味着如果把 `1936` 用作 world wrap 首个承载剧本，出了问题时更容易定位为：

- wrap 渲染问题
- wrap 命中问题
- 交互桥接问题

而不是 scenario 自身语义故障。

### 8.2 `1939` 不适合当第一承载剧本

`1939` 的问题不在于它比 `1936` 重很多，而在于它多了一层 split/frontline 语义，并且历史上确实出现过基线漂移与 controller 失效回归。

[QA-053](../QA-053_hoi4_1939_regression_hotfix_2026-03-05.md#L4) 记录了：

- 1939 曾回退成类似 modern fallback ownership
- controller/frontline layer 实质失效
- 修复依赖 `1936 baseline + 1939 delta + 1939 controller`

因此如果第一轮 wrap 正确性验证放在 `1939`，调试时很容易混淆：

- 是世界 wrap 出错
- 还是 split/frontline 语义出错
- 还是 scenario rule stack 出错

这不适合作为第一块试验田。

### 8.3 `modern_world` 更适合作为通用回归样本

`modern_world` 的优点是简单、轻量、无 split。  
但它的问题是：

- 复杂度不够代表你真正关心的剧本形态
- 它更像“证明通用能力存在”的回归样本，而不是“扛首轮主验证压力”的承载剧本

所以它更适合放在 `1936` 之后，用来回答：

- 这套左右连贯是否只对 HOI4 系列成立？
- 在更简单的现代主权语义下，是否依然正确？

---

## 9. 最合理的验证顺序

如果把这次研究结论转成后续决策顺序，最合理的 staging 应该是：

1. `blank_base`
   - 只用作纯技术沙盒
   - 验证周期相机、平移、世界副本与 hit-testing 是否成立

2. `HOI4 1936`
   - 第一个正式承载剧本
   - 验证高 feature 数量下的 wrap 正确性
   - 验证 scenario tag 体系与现有交互桥是否能共存

3. `modern_world`
   - 通用回归样本
   - 验证这不是 HOI4 特化能力

4. `HOI4 1939`
   - 第二阶段验证样本
   - 专门验证 owner/controller split 与 frontline 语义

5. `TNO 1962`
   - 最后验收对象
   - 不应作为第一块试验田

---

## 10. 关于投影的判断

这次调研没有进入实施阶段，但投影结论已经足够明确：

- 当前 `geoEqualEarth` 用于静态全球图是合理的
- 但如果目标是“像 RTS 那样天然左右循环”，它不是工程上最省事的选择
- 真正要做 world wrap，最好引入一个明确的 wrap projection 模式，而不是要求所有模式都在 `geoEqualEarth` 上硬实现到底

这不是说 `Equal Earth` 不能支持，而是说：

- 它更适合全球主题可视化
- 不一定最适合周期横向世界的交互心智模型

这个判断也和外部资料一致：

- D3 Geo 本身提供投影、裁切与拟合能力，但它不是一个原生 world copy 引擎，[D3 Geo](https://d3js.org/d3-geo), [Projection API](https://d3js.org/d3-geo/projection)
- 像 MapLibre 这类引擎之所以能自然处理世界副本，是因为它们把 `world copies` 作为产品级能力暴露了出来，例如 `renderWorldCopies`，[MapLibre Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)

本项目当前并未处在那种引擎语境里，因此不能假设“开启一个选项就会自然得到环绕世界”。

---

## 11. 最终判断

### 11.1 对“要不要做”的判断

可以做，而且值得做。  
因为这不是为了炫技，而是会显著改善：

- 世界尺度浏览体验
- 太平洋视角
- 远东 / 阿拉斯加 / 日本一线的空间连续性认知

### 11.2 对“现在该怎么判断范围”的判断

正确的范围判断应该是：

- 全剧本一起做，风险高
- 先排除 `TNO 1962`，风险明显下降
- 先用 `HOI4 1936` 做正式承载，最稳

### 11.3 对“首个承载剧本是谁”的判断

明确结论：

> 首个正式承载剧本应选 `HOI4 1936`。

排序建议：

1. `HOI4 1936`
2. `modern_world`
3. `HOI4 1939`
4. `TNO 1962`

---

## 12. 参考依据

### 本地代码与资产

- [js/core/map_renderer.js](../../js/core/map_renderer.js)
- [js/core/scenario_manager.js](../../js/core/scenario_manager.js)
- [data/scenarios/hoi4_1936/manifest.json](../../data/scenarios/hoi4_1936/manifest.json)
- [data/scenarios/hoi4_1939/manifest.json](../../data/scenarios/hoi4_1939/manifest.json)
- [data/scenarios/modern_world/manifest.json](../../data/scenarios/modern_world/manifest.json)
- [data/scenarios/tno_1962/manifest.json](../../data/scenarios/tno_1962/manifest.json)
- [map_builder/config.py](../../map_builder/config.py)
- [map_builder/geo/utils.py](../../map_builder/geo/utils.py)
- [map_builder/geo/topology.py](../../map_builder/geo/topology.py)
- [map_builder/processors/russia_ukraine.py](../../map_builder/processors/russia_ukraine.py)

### 本地 QA / RFC / Research 文档

- [QA-046 HOI4 1936 Scenario Data Load UI Audit](../QA-046_hoi4_1936_scenario_data_load_ui_audit_2026-03-04.md)
- [QA-053 HOI4 1939 Regression Hotfix](../QA-053_hoi4_1939_regression_hotfix_2026-03-05.md)
- [QA-071 TNO 1962 Runtime Political Seam Fix](../QA-071_tno_1962_runtime_political_seam_fix_2026-03-08.md)
- [QA-079 TNO 1962 Heavy Scenario Clip Cache And Context Persistence](../QA-079_tno_1962_heavy_scenario_clip_cache_and_context_persistence_2026-03-09.md)
- [QA-084 TNO 1962 Scenario Coastline Source Gating](../QA-084_tno_1962_scenario_coastline_source_gating_2026-03-11.md)
- [RFC_GLOBAL_MIGRATION.md](../../docs/RFC_GLOBAL_MIGRATION.md)
- [RESEARCH_GLOBAL_DATA.md](../../docs/RESEARCH_GLOBAL_DATA.md)

### 外部官方资料

- [D3 Geo](https://d3js.org/d3-geo)
- [D3 Projection API](https://d3js.org/d3-geo/projection)
- [RFC 7946 GeoJSON](https://www.rfc-editor.org/rfc/rfc7946.txt)
- [GeoPandas antimeridian / reprojection notes](https://geopandas.org/en/stable/docs/user_guide/reproject_fiona.html)
- [MapLibre Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)

---

## 13. 归档说明

本文件记录的是一次纯研究结论，不包含实施计划、不包含代码修改、不包含 schedule。

它的用途是：

- 作为后续是否推进 world wrap 的决策依据
- 作为“为什么不应从 `TNO 1962` 开始”的书面说明
- 作为“为什么首个正式承载剧本应选 `HOI4 1936`”的依据归档
