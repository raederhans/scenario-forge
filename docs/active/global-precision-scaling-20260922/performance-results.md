# 性能中低风险阶段与高风险判断

日期：2026-09-22。工作树：`precision-expansion-20260922/mapcreator`。本记录仅属于性能工作线，生产数据清单交由主线整合。

## 全国县级候选：改色路径复用续作

用户授权继续优化后，使用 Modern World 3,144 县候选在 localhost 重测。视口为 1123×960、DPR 1.5、世界缩放 1；通过 Chase County 选择 Nebraska 的 State 层级，双击修改 93 县，随后撤销和重做。记录的是绘制完成后的 frame，而非尚未绘制的 action 时间。

| 操作 | 修改前完整帧 | 修改后完整帧 | 修改前背景缓存构建 | 修改后背景缓存构建 |
| --- | ---: | ---: | ---: | ---: |
| 州级填色 | 618.8 ms | 134.3 ms | 527.8 ms | 46.9 ms |
| 撤销 | 733.3 ms | 264.0 ms | 572.4 ms | 102.7 ms |
| 重做 | 798.9 ms | 271.0 ms | 634.9 ms | 105.5 ms |

以上为同机同视口的单次操作对照，不是多轮统计、FPS 或目标设备保证。修改前每次重建 13,389–13,435 个路径；修改后三次均为 built=0、reusedPrevious=13,947，LRU 条目 7,031 -> 7,031，仍走原有 dirty-feature-threshold 全量重绘分支。

根因是旧完整背景分组仍持有有效 Path2D，但改色重组仅查询有容量限制的 LRU，顺序遍历触发大量淘汰和重复投影。political_background_render_owner.js 现在用调用内临时 Map 索引上一完整分组，要求 feature 对象、构建时 geometryRef、path/transform 签名、scenarioId、sceneGeneration 和 scenarioDataGeneration 匹配。外层条目缓存更新保留旧 artifact 作为受检查的路径来源，并清除 replay key；颜色重新计算。没有扩大 LRU、局部重绘预算，也没有增加独立长期路径缓存。map_renderer.js 的已有性能叠层增加 fallback 和路径来源指标。

验证：owner 行为测试 28/28、boundary contract 4/4、三处代码的 diff whitespace 检查通过。覆盖外层 landDataFull !== landData、改色/撤销、LRU 清空、同 ID 或同对象的 geometry 替换、各身份失效、无 Path2D fallback，以及 deferred/replay 流程。浏览器实际填色、撤销、重做完成，重做后 Undo 可用、Redo 禁用。

截图比较：填色和撤销分别对照修改前相同状态，画面美国区域 [420,220,760,445] 均为零差异。较大区域 [300,190,1020,799] 共 438,480 像素，均仅 64 像素有差异，最大通道差 1，位于 x=1016..1019、y=680..695 的叠层边缘；不声明整个屏幕逐像素相同。证据：.runtime/tmp/us-county-upgrade/perf-followup-baseline.json、perf-followup-after.json、perf-followup-pixel-comparison.json 及 perf-{baseline,after}-{filled,undo}.png。

本轮保留全部县级精度，印度与数据文件未改。撤销/重做仍约 264–271 ms，背景分组合并和实际绘制仍有成本；首载、缩放、低配置设备表现不在此次收益声明内。后续优先测量未变颜色组的 mergedPath 重建和首载 coarse 成本，再决定下一项优化。候选的外国边界接缝、旧项目 ID 迁移与历史剧本适配仍需独立完成，release_ready:false 不变。

## 判断与交付边界

### CLI 并行续作：合并路径与分片接缝

本轮用户明确授权更多 CLI 协助。共派发四条工作线：Gemini 3.1 Pro High 负责合并路径实现，Gemini 3.8 Flash High 只读分析首载，GLM-4.5-Air 提取接入缺口，另一 Gemini 3.1 Pro High 负责分片边界。主代理核验交付后，退回并纠正了首载参数拆包误报；分片首版未实际修改 builder，测试只比较总轮廓，因此未接受其完成声明，停止该 CLI 后由主代理完成实现和回归。Air 初稿引用及转义错误由主代理纠正，不将其原稿当作验收证据。

合并路径现在仅在原有身份门槛通过，且颜色组键、填色、成员顺序、feature/geometry/path 引用全部匹配时复用上一完整帧的 mergedPath。每次州级改色只构建 1–2 个多成员组，复用 169 个组。没有增加长期缓存、扩大 LRU 或修改 partial repaint 阈值。

同条件浏览器对照使用同一 national-v2 数据与相同视口，仅在对照模块中禁用合并组复用，单 feature 路径复用始终开启。操作顺序是填色、撤销、重做、撤销、重做。对照帧耗时 218.0/404.0/413.6/425.0/419.6 ms；优化后 216.8/345.9/441.2/369.4/379.9 ms。首次填色基本持平，四个历史操作中位数 416.6 -> 374.65 ms，样本少且分布重叠，不宣称普遍稳定加速。两组重做后的美国截图区域 [420,220,760,445] 零像素差异。证据 .runtime/browser/us-county-merged/ab.json、ab-summary.json、ab-{baseline,optimized}-redo.png。早期并行任务运行时的 exploratory.json 不作为对照收益依据。

本轮 owner 行为测试共 32 项通过（含实际 mergedPath 对象身份、addPath 次数、成员顺序、几何替换和投影/场景/data fences），原 owner boundary contract 4 项通过。首载 setMapData 的重复工作是待进一步验证的候选；本轮没有删除启动初始化或降低 coarse prewarm 的门槛。

低风险请求优先级修复和成本诊断已实现；中风险的声明式 LOD 预热消费已接入实际 runtime，并完成真实 TNO 三分片候选验证。生产 manifest 未修改，因此尚未声明 family 的现有数据仍按原方式预热。没有重做已有调度器、缓存预算、增量 store 或 worker 紧凑几何成果。

高风险主线程权威格式迁移、全球 canonical 重分片、渲染器重写本轮 **不进入实施**。当前证据支持继续发布受控的 LOD family 和观察瓶颈，但不支持直接选择上述高风险路线；缺少当前目标设备上的完整交互 trace 和内存基线。

## 低风险：共享请求优先级与可观测成本

`chunk_payload_loader.js` 中复用同一请求的后续调用原来直接 reprioritize。一个优先级为 1 的可见请求可被后来优先级为 0 的 prewarm 调低，导致更早的背景请求排到它前面。新增调度器 `promote` 仅单调提升共享请求的排队优先级；只有最新 selection 替换时仍可明确降低已过时请求的优先级。

调度器新增 `queuedEstimatedBytes`、`completed`、`cancelledBeforeStart`。队列字节在入队、启动和排队取消时用常数成本维护，不为诊断持有 payload 或几何副本。`completed` 表示实际操作已结束的计数，包含成功、失败及运行中取消后结束的操作，并非成功数。

现有两并发、32 MiB 在途估算预算保持；不可分割的超大任务仍只能单独执行，不能据此宣称硬性 heap 上限。运行中的取消也仍需等底层操作真正结束才能释放 reservation，防止忽略 abort 的 decode 无界重叠。

回退：撤销 loader 的 `promote` 调用及调度器新增 API/指标即可；数据和持久化格式没有迁移。

## 中风险：按当前 LOD 预热

`selectScenarioFocusPrewarmChunks` 新增 `zoom`、`loadedChunkIds` 和 `requireDetail` 参数。实际 `chunk_runtime.js` 传入当前缩放及已驻留 ID。显式声明 `lodGroupId` 的分片只预热此时可用的等级，并复用已有 family hysteresis。原先无条件预热 detail 会在 regional 视图提前支付完整 detail 下载/处理成本，本次消除这条路径。

未声明 family 的 legacy detail 和未提供 zoom 的旧调用保留原行为。预热仍受原有视口选择、最多两块、decoded/cache/source 最大成本及路径预算约束。`requireDetail: true` 可供明确精确消费请求强制预热 detail，覆盖当前缩放和驻留 regional，但不改变 LOD 驻留选择状态；退出此请求后恢复正常选择。当前显示 runtime 不自动设置该标志，未把“已预热”误当作编辑/导出精度完整保证。

回退：停止给特定分片声明 family，或撤销 runtime 的新参数，即恢复原预热路线；现有完整 detail 数据始终保留。family 发布前仍须检验 ID 集合、固定外周、混合等级接缝和编辑/导出契约。

## 验证及真实成本

Node 共 111 项通过：33 项聚焦 scheduler、LOD、空间选择、loader 与取消；78 项既有 quick chunk contracts、promotion 与 viewport reuse。覆盖同请求去重/优先级、两个预算、运行中/排队取消、场景切换、旧 generation、滞回、精确优先及其退出恢复、80 个合成 family 的有界预热。真实 TNO manifest 的 political 成本分布重复三批，验证 admission 始终最多两个并发；超出字节预算时只允许一个任务，结束后排队和在途估算字节归零。该测试使用真实元数据配合异步 gate，不是网络/解码压力实测。

Python 既有 LOD 几何测试 7 项通过。`git diff --check` 对本线变更通过。未扩大 timeout、allowlist 或降低断言。

现有 builder 为 FRA part.0、NOV、RKM part.5 生成了三个 regional 候选，几何检查全部成功。NOV 的 9 个异常或日期变更线对象保持精确原始几何；未修复或隐藏它们。相同稳定 ID 集合经额外成本探针核对。

| family | detail 点数 | regional 点数 | detail compact JSON 字节 | regional compact JSON 字节 |
| --- | ---: | ---: | ---: | ---: |
| FRA part.0 | 72,826 | 51,420 | 1,654,897 | 1,078,414 |
| NOV | 53,596 | 45,680 | 1,878,979 | 1,609,292 |
| RKM part.5 | 56,807 | 46,625 | 2,015,288 | 1,665,021 |
| 合计 | 183,229 | 143,725 | 5,549,164 | 4,352,727 |

这是分别隔离一个 family、zoom=2 下的预热选择成本：点数减少 21.56%，等口径 compact JSON 字节减少约 21.56%。比较双方都重新 compact 序列化，避免把源 pretty JSON 与候选 compact JSON 的格式差异算成优化收益。数据构建与其他代理构建并行，未用其墙钟计时作为性能基准；未测端到端 FPS、真实浏览器 heap 或新数据全面上线成本。world 候选全局点数为 1,885,672→1,841,662，仅代表这三个 family 对现有 coarse 的影响。

产物：`.runtime/reports/generated/performance-lod-20260922/` 内 `build.log`、`display-lod-report.json`、`prewarm-cost.json` 和候选清单/几何。它们是 staged overlay，不是 canonical release，也不能直接覆盖主线正在更新的数据清单。

复现命令：

```powershell
node --test tests/precision_scaling_scheduler_behavior.test.mjs tests/precision_scaling_lod_selection_behavior.test.mjs tests/scenario_spatial_chunk_selection_behavior.test.mjs tests/scenario_chunk_payload_loader_behavior.test.mjs tests/scenario_chunk_cancellation_behavior.test.mjs
node --test tests/scenario_chunk_contracts.quick.test.mjs tests/scenario_chunk_promotion_queries_behavior.test.mjs tests/scenario_chunk_viewport_reuse_behavior.test.mjs
python -m unittest tests.test_political_display_lods -q
python tools/build_political_display_lods.py --source-root . --scenario-id tno_1962 --output-root .runtime/reports/generated/performance-lod-20260922 --chunk-id political.detail.country.fra.part.0 --chunk-id political.detail.country.rkm.part.5 --chunk-id political.detail.country.nov
node tests/precision_scaling_prewarm_cost.mjs .runtime/reports/generated/performance-lod-20260922
```

builder 唯一 owner 为性能代理；无端口/共享数据库，输出目录独占；已 exit 0，无残留 live process。成功条件为 exit 0 且生成 report/manifest，几何 fallback 必须保留并披露。性能代理完成后主线可只读使用产物。

## 高风险阶段的进入条件与实验顺序

建议先在中低风险版本和将发布的精度资产上采集同一设备、同一 TNO 路线：冷启动、快速跨国拖动、world/regional/detail 往返、选中/涂色/撤销、存档重载、PNG 导出。记录 p50/p95 首次可交互和 settle、主线程长任务归因、每次选择排队/取消成本、运行中估算字节与浏览器实际峰值 heap；同时确认接缝、ID、归属、控制权和导出无回归。

进入高风险实验的门槛应来自该基线。例如，如果解析/几何物化仍占 settle 主线程时间的显著比例（建议以超过 30% 作为调查阈值），才比较主线程紧凑表示；如果必须单独运行的超大 canonical 块持续主导等待，则优先研究重新分片。阈值是下一阶段建议，不是本轮已测事实。若时间主要消耗在全量 metadata/颜色扫描，先修复具体扫描热点；如果 GPU/raster 主导，格式迁移未必解决问题。

1. 只对一个独立场景/owner family 做离线实验，保持原 GeoJSON、manifest 和存档权威路径可恢复；记录完整几何、邻接、ID 集合与混合等级输出一致性。
2. 对紧凑表示采用只读 shadow 消费，与旧路径逐要素/像素/导出对照。只有 trace 显示收益且内存不恶化，才研究权威数据迁移；不同时改变几何来源、分片和 renderer。
3. 对重新分片先生成候选，验证所有 ID 恰好归属一次、空间选择完整、失败恢复和存档兼容；保留旧清单作一键数据回退点。全球推广前先选一个大国。
4. 在独立分支完成目标设备回归、取消压力与持续使用测试后再做 go/no-go。建议要求 p95 settle 或峰值 heap 至少一项有可重复的实质改善（如 20%），其他关键指标无显著回退，所有精度/编辑/导出断言全通过。渲染器重写必须有独立 trace 证明上述局部路线仍不能解决瓶颈。

当前结论：中低风险代码可以进入主线集成验收；三分片 LOD 是候选，生产发布需主线数据治理与目标浏览器验收；高风险生产实施 no-go，下一步是采集基线并按主导成本选择一个可撤销实验，而不是一次迁移整个系统。
# Continuation: measured build memory and export consumers

The continuation removes padded arc allocation in `tools/scenario_topology_decode.py`, used by the existing regional/chunk builders. Arc storage now scales with actual coordinate count, while the library's float64 accumulation, geometry assembly and winding are retained. Decoder tests compare serialized output bytes and input immutability, including quantized/reversed arcs and different geometry types; 49 related Python checks passed.

The exact Japan input was rebuilt with the same full stage command. The old run used 17,400,205,312 B peak working set; the new run used 2,391,736,320 B (86.25% less). Elapsed times were 292.688 s and 183.5 s. All generated JSON files are byte-identical and all chunk cost metrics match. These are single before/after runs; the memory result is a full offline build measurement, not browser heap/FPS. Evidence: `.runtime/reports/generated/jp-precision-stage-v2/{comparison.json,tno_1962.build-report.json,validation.json}`.

`ensureScenarioPoliticalDetailForExport()` now upgrades admitted display families to detail, awaits the existing promotion commit and rejects stale scenario/camera/selection or uncommitted geometry. Toolbar composite, single-layer and bake paths call it. Normal color edits/project JSON remain stable-ID consumers. Twelve new JS behavior tests and 63 existing LOD/chunk checks passed.

Browser evidence: the real toolbar generated a valid 1418x2062 PNG, 695,730 B, with no console warnings/errors. Native download notification timed out; a temporary download-anchor capture verified the generated data URL, then the hook was restored. A later routing audit found this continuation preview did not intercept `/app/data/`, so that run proves code-path PNG generation with canonical assets, not new staged geometry. The corrected v3 preview then verified a temporary registry family against the actual staged Japan payload: regional loaded first; readiness replaced it with `political.detail.country.jap`, with 47 JPN IDs / 12,428 coordinates committed and no pending promotion. Working tabs and the parent preview service were closed. This does not substitute for production multi-country family manifests, full bake-pack acceptance, or target-device performance baselines.

Corrected staged browser boot reproduced a first-frame timing failure twice: the immediate startup assertion saw `interacting`, while later runtime diagnostics showed an accepted idle frame behind the retained error overlay. Startup now awaits the existing layout interaction/settling transition, bounded to 2 seconds of active frame progression, before flushing and retaining the strict first-visible-frame assertion. It does not force renderer state or accept missing geometry. Six support-module behavior checks and five startup boundary checks pass; the actual staged browser reload reached `bootPhase=ready`, empty boot error, `firstVisibleFramePainted=true`, and `bootBlocking=false`.
