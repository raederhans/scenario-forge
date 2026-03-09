# QA-071 TNO 1962 Runtime Political Seam Fix

**日期**: 2026-03-08  
**状态**: 已实现并完成浏览器回归验证  
**范围**: `TNO 1962` 在高缩放下的 runtime political 渲染 seam 伪影修复  
**约束**: 严格 renderer-only；不改任何 1962 数据生成脚本，不改 `data/scenarios/tno_1962/*` 产物

---

## 0) 结论摘要

这次问题的主因不是 1962 数据“坏了”，而是运行时政治层在 `runtimePoliticalTopology` 上仍沿用“逐 feature 填色后再同色描边”的策略。  
当 1962 场景出现大量高碎片几何时，这会把共享边反复压黑，形成截图里那种密集短黑线。

本次修复只改了 [js/core/map_renderer.js](../js/core/map_renderer.js)，分两步处理：

1. 在 `scene mode + runtimePoliticalTopology` 下，为当前 owner/controller 语义先做合并底色填充。
2. 对普通陆地 feature 停止逐个同色 `stroke()`，只保留 `Atlantropa sea` 的特例描边。

结果：

- `TNO 1962` 东欧/俄区和中国高碎片区域的同色 seam 伪影明显下降。
- `TNO 1962` 的 `ownership` 与 `frontline` 两种视图都通过了浏览器复测。
- `HOI4 1936` 与 `HOI4 1939` 没有引入新的白缝、海岸线缺失或交互异常。
- 地中海沿岸的 1962 数据重建链路没有被触碰。

---

## 1) 背景与用户症状

用户最初报告：

- 在一定缩放高度上，`TNO 1962` 某些国家内部会出现大量丑陋的短线条。
- 这些线条在 `1936` 和 `1939` 中不明显或看不到。
- 俄罗斯最明显，但中国区域也会出现类似现象。
- 用户正在大规模重置 `1962` 剧本的地中海沿岸，明确要求本次修复不能干扰数据重建工作。

从用户截图和后续浏览器复现来看，问题主要集中在：

- 俄区高碎片 runtime 拓扑区域
- 中国北方/华中高密度细分区域
- 部分东欧高密度政治碎片区

---

## 2) 证据与排查过程

### 2.1 Console

修复后浏览器控制台无新增错误与警告：

- [tmp_pw/after-fix-console.txt](../tmp_pw/after-fix-console.txt)

记录摘要：

- `Total messages: 36 (Errors: 0, Warnings: 0)`

### 2.2 Network

修复后场景资源均正常加载：

- [tmp_pw/after-fix-network.txt](../tmp_pw/after-fix-network.txt)

关键资源均为 `200 OK`：

- `data/scenarios/tno_1962/manifest.json`
- `data/scenarios/tno_1962/countries.json`
- `data/scenarios/tno_1962/owners.by_feature.json`
- `data/scenarios/tno_1962/controllers.by_feature.json`
- `data/scenarios/tno_1962/relief_overlays.geojson`
- `data/scenarios/tno_1962/runtime_topology.topo.json`
- `data/scenarios/hoi4_1939/*`

日志开头出现的多条 `net::ERR_ABORTED` 来自 Playwright 强制刷新与场景切换时中断旧请求，不是应用资源缺失，也不是本次修复造成的运行时失败。

### 2.3 截图证据

修复后关键视角截图：

- `TNO 1962` 东欧 ownership: [after-fix-tno1962-east-europe.png](../after-fix-tno1962-east-europe.png)
- `TNO 1962` 中国 ownership: [after-fix-tno1962-china.png](../after-fix-tno1962-china.png)
- `TNO 1962` 东欧 frontline: [after-fix-tno1962-frontline-east-europe.png](../after-fix-tno1962-frontline-east-europe.png)
- `HOI4 1939` 回归: [after-fix-hoi4-1939-europe.png](../after-fix-hoi4-1939-europe.png)
- `HOI4 1936` 回归: [after-fix-hoi4-1936-europe.png](../after-fix-hoi4-1936-europe.png)

修复前的排查截图仍保留在仓库中，可用于前后对比：

- [tno1962-eastern-europe-ish.png](../tno1962-eastern-europe-ish.png)
- [tno1962-context-off.png](../tno1962-context-off.png)
- [tno1962-context-and-borders-off.png](../tno1962-context-and-borders-off.png)

### 2.4 复现路径

浏览器复现步骤：

1. 打开本地页面 `/?render_profile=full`
2. 载入 `TNO 1962`
3. 放大到约 `606%`
4. 平移到东欧/俄罗斯或中国北方/华中
5. 分别在 `Ownership` 与 `Frontline` 视图观察政治层

排查过程中还做了这些隔离动作：

- 关闭 `Scenario Special Regions`
- 关闭 `Physical / Urban / Rivers / Water Regions`
- 把常规边界宽度拉到 `0`

结论是：主问题并不来自普通 border mesh，也不是 `special_regions`，而是政治底色 pass 本身。

---

## 3) 根因分析

### 3.1 为什么 1962 更严重

`TNO 1962` manifest 明确启用了 runtime topology：

- [data/scenarios/tno_1962/manifest.json](../data/scenarios/tno_1962/manifest.json) 第 `100` 行：`owner_controller_split_feature_count: 606`
- [data/scenarios/tno_1962/manifest.json](../data/scenarios/tno_1962/manifest.json) 第 `114` 行：`runtime_topology_url`

这意味着 1962 不是单纯的静态政治面，而是包含 owner/controller split 的运行时政治拓扑。

俄罗斯最夸张，是因为存在大量 `_FB_` shell fallback 相关碎片；但这不是俄罗斯专属 bug。

### 3.2 为什么中国也有

中国虽然没有俄罗斯那类 `_FB_` shell fallback 密集特征，但自身就有极高的运行时碎片密度。  
在这种情况下，只要渲染器还对每个小 feature 做同色描边，共享边就会堆出密集短线。

因此真正的问题模型是：

- `高碎片 runtime political geometry`
- `per-feature fill + same-color stroke`
- `共享边被重复压黑`

不是“俄罗斯特例”，而是“1962 运行时政治层的通用渲染缺陷”。

### 3.3 不是哪些原因

这次明确排除了以下方向：

- 不是 `special_regions.geojson` 主导，因为当前 `tno_1962` 的 special regions 为空。
- 不是普通边界 mesh，因为把边界宽度压到 `0` 后主问题仍在。
- 不是地中海回填 relief hatch 的主问题；那部分纹理是另一类视觉层。

---

## 4) 实现约束与为什么不影响数据重建

本次实现严格遵守以下边界：

- 不改 [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py)
- 不改 [tools/build_runtime_political_topology.py](../tools/build_runtime_political_topology.py)
- 不改任何 `data/scenarios/tno_1962/*` 文件
- 不改地中海回填区的 relief / hatch / shoreline contour 参数

之所以能保证不影响地中海沿岸重建，是因为：

- `tools/patch_tno_1962_bundle.py` 负责生成 `runtime_topology.topo.json`、`water_regions.geojson`、`relief_overlays.geojson` 等产物，见 [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py) 第 `3454` 到 `3461` 行。
- 场景文件最终写出发生在 [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py) 的后续写盘逻辑中。
- [tools/build_runtime_political_topology.py](../tools/build_runtime_political_topology.py) 是纯 Python 构建脚本，不参与前端渲染决策。

这次实际只改了渲染器。  
因此：

- 不会改变 1962 的构建产物
- 不会改变你的数据重建结果
- 只会改变这些产物在浏览器中的显示方式

---

## 5) 具体代码改动

### 5.1 新增 runtime scenario political background cache

新增 cache 定义：

- [js/core/map_renderer.js](../js/core/map_renderer.js) 第 `187` 行起

作用：

- 记录当前 `runtimePoliticalTopology`
- 记录 `scenarioId / viewMode / topologyRevision / colorRevision`
- 记录 `sovereigntyRevision / controllerRevision / shellRevision`
- 记录视口尺寸与 feature 数量

设计目的：

- 合并背景面只在真正的语义变化时重建
- 平移、缩放、hover、select 不触发 cache 失效

### 5.2 新增 runtime scenario merged background fill

新增逻辑入口：

- [js/core/map_renderer.js](../js/core/map_renderer.js) 第 `5813` 到 `5925` 行

关键行为：

1. 仅在 `PROD + activeScenario + runtimePoliticalTopology + topojson.merge` 条件下启用。
2. 对当前可渲染 land features 取 ID 集合。
3. 跳过 `Atlantropa sea` 特例。
4. 按当前显示语义分组：
   - `Ownership` 视图按 display owner
   - `Frontline` 视图按 display controller
5. 再按最终 `fillColor` 分组，形成 `displayCode::fillColor` 组合键。
6. 对每组调用 `topojson.merge()` 得到 merged background shape。
7. 在政治层 per-feature fill 之前先统一铺底色。

这一步的核心收益是：

- 去掉逐 feature 同色描边后，不会因为抗锯齿直接露出白缝
- 同色碎片共享边不再靠反复描边去“遮”

### 5.3 调整 `drawPoliticalPass()`

修改位置：

- [js/core/map_renderer.js](../js/core/map_renderer.js) 第 `6006` 到 `6066` 行

行为变化：

- runtime scenario 政治层启用 merged background 时：
  - 普通陆地 feature 只 `fill`
  - 不再做逐个同色 `stroke`
- `Atlantropa sea` 仍保留原有特例描边，防止海域边缘直接丢掉轮廓
- 非 runtime-topology 场景仍走原来的 `drawAdmin0BackgroundFills()` 路径

这保证了：

- `1936/1939` 这种非问题场景不被扩大修改范围
- 真实边界继续交给现有 border mesh 渲染链

---

## 6) 验证结果

### 6.1 `TNO 1962` ownership

验证区域：

- 东欧/俄罗斯
- 中国北方/华中

结果：

- 原先那种大面积“同色块内部短黑线”明显下降。
- 剩余可见线条主要来自真实边界 mesh、行政层级边界、以及特定 context layer，不再是政治层自身重复描边产生的脏 seam。

### 6.2 `TNO 1962` frontline

结果：

- `Frontline` 视图下 merged background 仍按 controller 语义生效。
- 没有出现 owner/controller 切换后白缝或底色错组。

### 6.3 `HOI4 1939` 回归

结果：

- 没有新白缝
- 没有国家边界消失
- 没有海岸线明显变弱

### 6.4 `HOI4 1936` 回归

结果：

- 同样未观察到新的边界回归
- 场景正常载入和渲染

### 6.5 静态校验

执行过：

- `git diff --check -- js/core/map_renderer.js`

结果：

- 无尾随空格、无 patch 结构问题

---

## 7) 残余风险与未纳入本次修复的内容

### 7.1 残余风险

- 由于 `TNO 1962` 本身是高碎片场景，仍然会看到真实内部边界线；这不是本次要消灭的对象。
- merged background 构建依赖 `topojson.merge()`，理论上在极端情况下可能对少数分组 merge 失败；当前代码会安全跳过失败分组并回退到 per-feature fill，不会把整层画挂。

### 7.2 明确未纳入

以下内容本次刻意不动：

- Atlantropa 回填区的 `salt_flat_texture`
- drained basin contour
- new shoreline
- 任何地中海沿岸数据重建脚本
- 任何场景 manifest / topo / relief 数据文件

如果后续还要继续优化“地中海回填区纹理线太重”，那应该单开一个 renderer 视觉任务，不应该和这次 seam 修复混在一起。

---

## 8) 本次留档的价值

这份 QA 需要保留，原因有三：

1. 它明确记录了“1962 seam 不是数据重建 bug，而是 renderer 策略 bug”。
2. 它把“不得影响地中海沿岸数据重建”的实现边界写死了，后续维护者不容易误改构建脚本。
3. 它为后续类似问题提供了决策先例：
   - 高碎片 runtime scenario 优先考虑 merged background + selective stroke
   - 不要继续把 per-feature 同色描边当作通用 seam 修复手段

---

## 9) 相关文件与工件

代码：

- [js/core/map_renderer.js](../js/core/map_renderer.js)

未修改但被明确确认不应触碰的构建链路：

- [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py)
- [tools/build_runtime_political_topology.py](../tools/build_runtime_political_topology.py)
- [data/scenarios/tno_1962/manifest.json](../data/scenarios/tno_1962/manifest.json)

浏览器工件：

- [tmp_pw/after-fix-console.txt](../tmp_pw/after-fix-console.txt)
- [tmp_pw/after-fix-network.txt](../tmp_pw/after-fix-network.txt)
- [after-fix-tno1962-east-europe.png](../after-fix-tno1962-east-europe.png)
- [after-fix-tno1962-china.png](../after-fix-tno1962-china.png)
- [after-fix-tno1962-frontline-east-europe.png](../after-fix-tno1962-frontline-east-europe.png)
- [after-fix-hoi4-1939-europe.png](../after-fix-hoi4-1939-europe.png)
- [after-fix-hoi4-1936-europe.png](../after-fix-hoi4-1936-europe.png)

---

## 10) Deferred Performance Follow-up (Not Executed in This Round)

这次额外做了 `TNO 1962` 的 `context` pass 调查与 benchmark 扩展，但只执行了前半部分：

- 已执行：
  - 在 [js/core/map_renderer.js](../js/core/map_renderer.js) 为 `drawPhysicalAtlasLayer`、`drawPhysicalContourLayer`、`drawUrbanLayer`、`drawRiversLayer`、`drawScenarioRegionOverlaysPass`、`drawScenarioReliefOverlaysLayer` 增加独立计时
  - 为 `applyPhysicalLandClipMask` 和 `applyOceanClipMask` 增加 clip 诊断字段
  - 扩展 [ops/browser-mcp/editor-performance-benchmark.py](../ops/browser-mcp/editor-performance-benchmark.py)，新增 `contextBreakdown` 和 `tno_1962` 的只读 A/B probe
- 明确未执行：
  - 不改 `runtime_topology.topo.json` 结构
  - 不新增 `context_land_mask`
  - 不改 [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py) 的 land mask 派生逻辑
  - 不重跑任何地中海 / Atlantropa 构建链

### 10.1 当前观察结果与证据

新的 benchmark 报告位于：

- [.mcp-artifacts/perf/editor-performance-benchmark.json](../.mcp-artifacts/perf/editor-performance-benchmark.json)

关键观察：

- `none` 的 idle `context` 约为 `390 ms`
- `hoi4_1939` 的 idle `context` 约为 `388.3 ms`
- `tno_1962` 的 idle `context` 约为 `9214 ms`

`tno_1962` 的 `contextBreakdown` 非常集中：

- `drawPhysicalAtlasLayer`: `4554.5 ms`
- `drawPhysicalContourLayer`: `4621.0 ms`
- `drawUrbanLayer`: `1.0 ms`
- `drawRiversLayer`: `34.5 ms`
- `drawScenarioRegionOverlaysPass`: `2.7 ms`
- `drawScenarioReliefOverlaysLayer`: `0 ms`（默认关闭）

`applyPhysicalLandClipMask` 的诊断结果进一步说明问题集中在 clip 掩膜本身：

- `none` / `hoi4_1939`：
  - `maskSource = landBgData`
  - `maskArcRefEstimate = 12428`
  - `clip duration ≈ 320 ms`
- `tno_1962`：
  - `maskSource = scenarioLandMask`
  - `maskArcRefEstimate = 64296`
  - `clip duration ≈ 9140 ms`

这说明当前瓶颈不是“scenario 多了很多附加 overlay”，而是：

- `TNO 1962` 物理层仍要正常绘制
- 但物理 atlas 和 contour 每次都被一个极重的 `scenarioLandMask` 裁切
- 这个 mask 的几何复杂度远高于基础 land mask，导致 `context` 成本暴涨

### 10.2 A/B probe 归因结论

同一 `tno_1962` 视口下新增的只读 probe 结果如下：

- `baseline`: `context ≈ 9212 ms`
- `showPhysical = false`: `context ≈ 34.7 ms`
- `showUrban = false`: `context ≈ 9143.6 ms`
- `showRivers = false`: `context ≈ 9151.9 ms`
- `showWaterRegions = false`: `context ≈ 9079.1 ms`
- `showPhysical = false, showUrban = false, showRivers = false`: `context ≈ 4.7 ms`

因此可以直接下结论：

1. `context` 的最大头不是 `urban`、不是 `rivers`、也不是 `scenario water`
2. `context` 的主瓶颈几乎全部来自 `physical atlas + physical contours`
3. `applyPhysicalLandClipMask` 占比极高，并且和 `physical` 两个子层一起构成了绝大多数成本
4. 这已经满足后续进入 builder/runtime 级优化的门槛：
   - `physical` 两个子项合计明显超过 `context` 的 `50%`
   - 关闭 `physical` 后，`tno_1962 context` 下降远超 `40%`

### 10.3 后半部分思路（本轮只记录，不执行）

当前保留的后半部分方案是：

- 在 `runtime topology` 中派生一个只服务于 `physical/ocean` 裁切的轻量 land mask
- 让 renderer 的 `context` 层优先使用该轻量 mask，而不是当前精确版 `scenarioLandMask`
- 保持政治层、ownership / controller、命中、边界、Atlantropa 海陆语义全部继续使用现有精确数据

具体方向包括：

- `context_land_mask`
- builder-side mask simplification
- runtime topology 中的专用裁切掩膜对象

这套方案的核心思想是：

- “几何语义精确” 和 “context 裁切足够好” 不是同一个约束
- `physical/ocean` clip 并不需要承担政治编辑和命中职责
- 因此它可以使用更轻的几何版本来止损性能

### 10.4 为什么这次不执行后半部分

这次刻意不执行后半部分，原因不是它方向不对，而是它会和你当前的地中海区域重建共用同一条 scenario 产物链：

- 会碰 `runtime_topology.topo.json`
- 会碰 [tools/patch_tno_1962_bundle.py](../tools/patch_tno_1962_bundle.py)
- 会引入新的 runtime topology object / audit 诊断

这不会直接改变地中海重建的政治语义，但会造成：

- 产物持续抖动
- builder 输出增加噪音
- 与正在进行的地中海 / Atlantropa 重建工作流发生不必要的交叉

所以本轮只做“定位瓶颈”和“记录方案”，不做构建链改造。

### 10.5 重新开启后半部分的前提

后半部分只有在以下前提满足时才应重新开启：

1. 已确认 `context` 主瓶颈确实来自 `scenarioLandMask` 裁切和 `physical` 层
2. 地中海区域重建阶段进入相对稳定期，不再高频重写 `tno_1962` runtime 产物
3. 后续任务目标明确转为“builder/runtime 级性能止损”，而不是继续做 renderer-only 修复

### 10.6 本轮补充验证

补充验证结果：

- Console:
  - [.playwright-cli/console-2026-03-08T20-58-28-484Z.log](../.playwright-cli/console-2026-03-08T20-58-28-484Z.log)
  - `Errors: 0, Warnings: 0`
- Network:
  - [.playwright-cli/network-2026-03-08T20-58-29-650Z.log](../.playwright-cli/network-2026-03-08T20-58-29-650Z.log)
  - `tno_1962` 的 `manifest / owners / controllers / cores / water / special / relief / runtime_topology` 均为 `200 OK`

本节仅作为后续性能工作留档，不回写本次 seam fix 的主结论。
