# 精度继续增长时的性能扩容计划

日期：2026-09-20。审查基线：`2e241f4a0c662c78115ad6196491a6ecd4a08704`，已合并 PR #138。

状态：本次只实现 worker 路径缓存抗扫描抖动及回归测试。下文其余阶段是建议，不是已完成的改造。未改 `data/`、主分支或部署配置，未生成发布 dist。合并前仍需原生浏览器、完整仓库目标测试和规范构建验收。

## 1. 判断依据与边界

现有系统不是“完全没有优化”：它已经有全局 coarse、视口选择、detail 分片、增量 geometry store、空间索引复用、rAF hover、无损传输、worker 栅格化以及有预算的缓存。应继续演进这些边界，而不是并行建立另一套缓存/加载系统。

| 证据 | 已确认现状 | 含义 |
| --- | --- | --- |
| PR #138、俄罗斯精度报告 | political gzip6 估算 24.06 → 52.17 MB；coarse 8.13 → 21.29 MB；每语言 startup 2.78 → 2.87 MB；分片 197 → 208 | 主要膨胀不只在初始 startup 或 detail。低缩放表示也必须审查。估算不是浏览器实际传输量。 |
| precision-performance/context.md | 增量 store 已落地，但兼容 feature 数组仍有 O(N) 扫描/物化 | 缓存单项计算不能消除全集合工作的增长。历史局部微基准不是现在的完整 promotion 时延。 |
| geometry_cache_budget.js、相关 owners | 主政治、水体、worker path 各 32 MiB 权重目标；worker geometry 64 MiB | 权重不等于真实 JS/native heap；这些也不是全应用内存上限。 |
| scenario/bundle_cache_policy.js | bundle 数量 3；chunk 缓存数量 32、源字节权重 64 MiB；活动/必需/在途受保护 | 已有字节缓存，下一步是活动集与调度协调，不是重复添加 LRU。 |
| scenario/chunk_payload_loader.js | 批次 Promise.all、请求去重、场景切换取消、generation 安全检查 | 细节变大后应控制在途解码成本；现有取消不是完全缺失。 |
| geometry_transfer_codec_shared.js | Float64/Uint32 传输，接收端重建普通 GeoJSON | 解决的是一段传输成本，不是消除所有对象分配与两端表示。 |

不可破坏：稳定 feature ID、owner/controller/core、split children、手动编辑、撤销/重做、全局语义覆盖、水体孔洞、日期变更线、邻接与混合 LOD、项目导入的 baseline 校验以及导出。显示几何可以分级，权威数据不得为获得好看的性能数字而删除或降精度。

## 2. 本次实现：worker 路径缓存抗扫描抖动

旧行为：缓存容量只能留 A/B/C 中两个路径时，顺序绘制 A/B/C 可能在处理前面的 miss 时淘汰后面本可复用的 hit。相同视图的后续完整帧于是再次构建所有路径。

新行为在 `js/core/renderer/geometry_raster_worker_kernel.js`：

- 绘制前按唯一 ID 计算本帧已驻留路径的权重，并将这些路径移到 LRU 活跃端。
- 仅用剩余预算接纳新路径。超额路径仍按原顺序、原坐标临时绘制，不丢地块，不额外缓存一整帧 Path2D。
- 非活动缓存仍由原 LRU 按需淘汰；同 ID 更新、场景/投影 reset、geometry eviction acknowledgements 不变。
- 超大单路径继续使用原 `oversizedSkips` 计数。新增每帧 `cacheBudget.paths.frameAdmissionSkips`，现有 worker client 已整体转发 cacheBudget。
- 保留 32 MiB 默认路径权重目标。新增工作是 O(可见唯一 ID) 的元数据预扫；同一个 ID Set 复用于末尾的 geometry pin/trim，不新增第二份路径集合。

本次实际验证：原 kernel、预算模块和 codec 从固定提交读取，重建的本地文件用 Git blob SHA 校验。初始 11 项测试在原 kernel 下 5 项失败，修改后 11 项通过；新增取消恢复及 40 帧视图/替换序列后，独立目标套件 **13/13 通过**。kernel 与新测试 `node --check` 通过。

确定性例子：3 个等权路径、容纳 2 个的预算，原行为 warm frame 重建 3 个，新行为重建 1 个。这个计数不是帧率提升 3 倍，更不是整个 TNO 的速度保证。

独立测试使用真实 kernel/cache/codec，但 D3/canvas 边界是显式测试替身，仅证明缓存接纳、绘制调用顺序和生命周期。既有真实 D3 测试保留，并接入新增套件；本环境未执行完整真实 D3 套件、原生 Path2D/OffscreenCanvas、应用 E2E、Pages 构建、完整测试路由或目标 Windows 设备性能测试。不能将逻辑回归通过表述为发布验收通过。

复现命令：

```sh
node --test tests/geometry_raster_worker_cache_pressure_behavior.test.mjs
node --check js/core/renderer/geometry_raster_worker_kernel.js
```

完整仓库合并前运行既有 `tests/geometry_raster_worker_kernel_behavior.test.mjs`、相关 worker-client/缓存套件，以及 `tests/e2e/dev/precision_geometry_transfer.dev.spec.js` 的真实 worker/cache-pressure 用例。依照仓库既有入口运行 localhost TNO 缩放、编辑/撤销、导入/PNG 导出和规范构建；不放宽超时、像素/控制台或路由检查。

适用边界：该策略保留本帧可复用集合，不是全局最优的路径价值排序，也不能使超预算的全部路径同时驻留。主线程政治与水体缓存需要各自的 profile/回归后再考虑同类策略；本次没有自动改动它们。

## 3. 阶段 A：建立当前版本的端到端基线

先固定浏览器版本、viewport、DPR、设备配置、数据 hash 和启动参数。冷缓存与暖缓存分开。记录 TNO 启动、欧洲高密度区域、俄罗斯跨区域移动、缩放后稳定、detail promotion 中编辑/撤销、样例导入、普通/高分辨率导出及反复场景切换。同时观察中等硬件，不能只依据高端开发机。

分别记录网络实际传输/解压、JSON parse、pack/unpack、worker round trip、集合物化、派生状态、空间索引、路径 build/hit、hit surface、bitmap 应用与最终交互恢复。用现有 `politicalDerivedStateBreakdown`、`geometryWorkerRoundTrip`、缓存预算指标补齐关联时间线，避免另起一套互不关联的日志。

验收：保存可重放用例、p50/p95、长任务、路径构建率、活动顶点/字节数、pin 超额量、场景切换后的资源释放。明确 JS heap、路径估算和可观测浏览器进程/native 内存的差别。先发现瓶颈占比，再设置绝对时延与回归门槛；本报告不伪造尚未测量的目标 FPS。

## 4. 阶段 B：拓扑一致的多级 LOD，优先解决 coarse 膨胀

将“全精度权威几何”和“当前缩放的显示几何”分开。建议形成 world/regional/local 多级派生产物，级别选择依据投影后的屏幕误差、活动成本与缩放滞回，而不只统一缩放数字。保持完整世界语义覆盖；不能通过隐藏未加载国家来获得加速。

关键不是各国家独立 simplify，而是共享边界一致的简化与跨级边界约束。共享弧、势力分割边、海岸/水体边和日期变更线共同参与构建。当前俄罗斯报告已有混合 LOD 与邻接约束，也明确记录目标外接缝限制，必须保留并扩展验证。渲染可以使用派生 fragment，但 feature/parent ID、owner 与 edit history 仍指向规范对象。

精确编辑前确保对应权威几何可用；使用同一父 ID 消解显示碎片的选择结果。导出按输出分辨率加载所需全精度数据，不能把屏幕上临时降级的几何当作源数据保存。

验收：同视图误差可解释；选定邻接/混合 LOD 组合无新增裂缝、重叠、孔洞和归属漂移；相同编辑/撤销/导出结果成立；扩大 detail 数据时 world 视图的活动顶点预算不随其同步膨胀。

## 5. 阶段 C：按成本分片并实行需求驱动调度

在现有 `scenario_chunk_manager.js` 和 chunk runtime 中扩展，而不是重新实现视口剔除。分片上限联合考虑空间范围、顶点数、解码后权重、预计 path cost 和源字节；不能只依据“6 个 chunk”或行政国家数。巨型多部件要素的显示分片需要稳定 parent 映射，不改变编辑实体。

现有默认 hints 的 `max_required_byte_size` 为 0，实际场景可覆盖；先审计实际 manifest，不应直接断言所有场景都没有字节限制。用 manifest 提供可核验的成本元数据，避免为决定是否加载而先解码整块。

将批次 Promise.all 的资源需求纳入统一调度：精确编辑需求优先，其次可见块，再近视口/预热；并发受在途预计解码字节与 worker 处理能力共同约束。旧视口请求应可重排/取消，但保持请求去重、generation 检查和当前可见/事务中资源的安全 pin。不要直接删除现有 zoom-end 保护来“修内存”，它承担防闪烁作用。

合并到显示集合前按有界批次提交 delta；取消必须覆盖网络、解码与过期 promotion，而非只忽略最终画面。不同代的工作不能覆盖最新选择。

验收：快速往返移动不出现旧视图覆盖新视图、空白或 ownership 丢失；活动/在途超额有明确可观测理由并能回落；同视图不反复下载相同块；比较完整 promotion p95 而非只比较传输子步骤。

## 6. 阶段 D：真正增量的数据与渲染表示

当前增量 store 的收益应继续传到下游。长期目标是稳定语义 registry + 视口 ID 集合 + changed/removed delta，而非每次为所有消费者重建全世界 FeatureCollection。按消费者逐一迁移，保留正确的全量 fallback，不能一次取消整个兼容层。

分开 geometry revision、style revision、view revision。改颜色只更新颜色/必要的受影响边界；geometry 到达仅重算受影响的 bounds、索引条目、路径与 hit 数据；鼠标 hover 不触发全世界派生重建。metadata 的可变性检查不能为减少 O(N) 扫描而无依据删除。

编码方面先剖析：现在的 Float64 传输是无损的，但两侧转换依然存在。进一步可探索 renderer 专用 packed geometry、offset table、共享弧、列式属性，以及版本化的预编码块。仅在消费端能直接使用时才逐步减少嵌套数组重建，避免永久同时保留 GeoJSON、typed buffer、worker 副本三套表示。不能把权威坐标直接改 Float32。

验收：几何/属性/项目序列化往返一致、无源 buffer 意外 detach、相同颜色编辑不增加 geometry upload；新旧路径结果等价；固定视图成本随可见变化量增长，而不是随所有已导入国家总量增长。

## 7. 阶段 E：统一内存、交付与离线构建预算

应用内存台账要覆盖 source chunks、主线程对象、worker geometry、投影路径、空间索引、canvas/bitmap、撤销历史和导出临时资源。不同缓存的预算是局部权重，不能相加后称为整页内存保证。活动集超过目标时需要降低预热、推迟 promotion 或选择合规 LOD，不能仅依赖淘汰受保护对象。及时关闭替换/过期 bitmap，场景切换后验证释放和回到稳态。

静态交付先验证实际部署响应的压缩、缓存和 Range/CORS 支持。以内容 hash/version 标识不可变运行时资产，排除不属于发布物的离线源数据。PMTiles/向量瓦片是可选的范围读取与分片交付方案，不等于必须换引擎；瓦片切边不能成为编辑权威边界。

离线端也有风险：俄罗斯报告的首版构建约 293.985 秒、峰值工作集约 17.3 GB，是此前作者的测量，不是本次测量。建议按 source hash + 工具版本 + 参数做增量构建/验证，共享边界变更连同邻接组一起失效；限制并发组总内存，避免多个进程各复制全世界几何。先 bbox 候选再精确验证，必要时流式/分区处理。不得通过缩小测试覆盖、放松容差或复用失效报告换速度。

验收：新增一个国家主要重建它及受影响邻接组；全量回放结果可复现；受控压力下缓存与构建峰值可回落；实际站点传输量而非 gzip 估算进入发布报告。

## 8. 阶段 F：GPU/瓦片渲染原型的进入条件

只有在 LOD、活动集、增量传播与分配问题得到控制后，profile 仍表明投影/栅格化是主要瓶颈，才推进独立 renderer adapter 原型。WebGL/可选 WebGPU 或 MapLibre 的代价包括投影兼容、三角剖分、孔洞、描边、透明叠放、picking、导出与上下文丢失恢复。GPU 不会自动减少网络、JSON parse 或每次全量重建。

原型先覆盖一个代表性高密度区，旧 renderer 可回退。验证 Equal Earth 视觉、跨日期变更线、水体/多部件、编辑/撤销、命中结果与 PNG 导出。未达到相同正确性与更好的端到端指标前，不替换生产后端。

## 9. 推进顺序与容量验收

建议顺序：本次窄修复和原生回归 → 当前版本基线 → topology-aware LOD 与成本分片 → 有界需求调度 → 下游 delta/packed representation → 依据 profile 决定 GPU。内存台账和离线增量构建可在相关阶段并行，但保持独立 PR 和可回退边界。

容量测试同时扩大要素数量、每要素顶点数和数据分布，不只复制同一 geometry/ID 以制造虚假的缓存命中。保存当前、2 倍、4 倍的可复现实验输入；相同视口分别比较冷/暖、跨区域移动、场景切换和高分辨率导出。预算由实际基线制定，不用微基准改善百分比承诺整体 FPS。

## 来源

仓库内证据均读取于上述固定 SHA：

- [PR #138](https://github.com/raederhans/scenario-forge/pull/138)
- [当日性能实施记录](../precision-performance-20260920/context.md)
- [俄罗斯精度及构建报告](../russia-precision-20260920/full-results.md)
- `js/core/renderer/geometry_raster_worker_kernel.js`
- `js/core/renderer/geometry_cache_budget.js`
- `js/core/renderer/political_path_cache_owner.js`
- `js/core/geometry_transfer_codec_shared.js`
- `js/core/scenario_chunk_manager.js`
- `js/core/scenario/chunk_runtime.js`
- `js/core/scenario/chunk_payload_loader.js`
- `js/core/scenario/bundle_cache_policy.js`

外部一手资料（2026-09-20 查阅，用于架构选择，不是本项目性能测量）：

- [MapLibre: Optimising performance of large GeoJSON datasets](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/)
- [PMTiles 概念与范围读取](https://docs.protomaps.com/pmtiles/)
- [MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [D3 geoPath](https://d3js.org/d3-geo/path)
